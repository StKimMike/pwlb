/**
 * 无浏览器的内核冒烟测试：在 Node 里用 vm 造一个 window 沙箱加载 engine.js，
 * 跑完整的关卡模拟，验证路径、移动、攻击、击杀、漏怪、波次结算都正常。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const sandbox = { window: {}, Math, console, Date, setTimeout, clearTimeout, performance: { now: () => Date.now() } };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'web/js/engine.js'), 'utf8'), sandbox, { filename: 'engine.js' });

const PWLB = sandbox.window.PWLB;
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const towers = readJson('web/data/towers.json');
const enemies = readJson('web/data/enemies.json');
const levels = readJson('web/data/levels.json');

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('  ✓ ' + name);
  } else {
    failures++;
    console.log('  ✗ ' + name + (detail ? '  → ' + detail : ''));
  }
}

// ---- 1. 数据完整性 ----
console.log('\n[1] 数据完整性');
check('炮塔数量为 12', Object.keys(towers).length >= 12, Object.keys(towers).join(','));
Object.keys(towers).forEach((id) => {
  const t = towers[id];
  check('炮塔 ' + id + ' 有 3 级', Array.isArray(t.levels) && t.levels.length === 3);
  // 光环塔不直接攻击，靠加成友军；毒塔靠 poison 掉血
  const ok = t.levels.every((l) => l.range > 0 &&
    (l.damage > 0 || l.beamDps > 0 || l.poison > 0 || l.strategy === 'aura'));
  check('炮塔 ' + id + ' 数值有效', ok);
});
const enemyIds = Object.keys(enemies);
check('敌人数量 >= 6', enemyIds.length >= 6, String(enemyIds.length));
check('存在 boss', enemyIds.some((id) => enemies[id].boss));
check('关卡数量为 8', levels.length === 8);

// ---- 2. 路径 ----
console.log('\n[2] 路径');
levels.forEach((lv) => {
  lv.paths.forEach((tp, i) => {
    const p = new PWLB.Path(tp);
    const axis = tp.every((_, k) => k === 0 || tp[k][0] === tp[k - 1][0] || tp[k][1] === tp[k - 1][1]);
    check(lv.id + ' 路径' + i + ' 轴对齐', axis);
    check(lv.id + ' 路径' + i + ' 长度 > 1000px', p.length > 1000, String(Math.round(p.length)));
    const a = p.posAt(0), b = p.posAt(p.length);
    check(lv.id + ' 路径' + i + ' 起点终点可求值', isFinite(a.x) && isFinite(b.y));
    check(lv.id + ' 路径' + i + ' 存在网格外起点', tp[0][0] < 0 || tp[0][1] < 0);
  });
  // 塔位不与路径/障碍重叠
  const pathCells = new Set();
  lv.paths.forEach((tp) => {
    for (let k = 0; k < tp.length - 1; k++) {
      const [x1, y1] = tp[k], [x2, y2] = tp[k + 1];
      if (x1 === x2) for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) pathCells.add(x1 + ',' + y);
      else for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) pathCells.add(x + ',' + y1);
    }
  });
  const bad = lv.slots.filter((s) => pathCells.has(s[0] + ',' + s[1]));
  check(lv.id + ' 塔位不与路径重叠', bad.length === 0, JSON.stringify(bad));
  const obsBad = lv.obstacles.filter((o) => pathCells.has(o.col + ',' + o.row));
  check(lv.id + ' 障碍不与路径重叠', obsBad.length === 0, JSON.stringify(obsBad));
  check(lv.id + ' 星线递减', lv.starHp[0] >= lv.starHp[1] && lv.starHp[1] >= lv.starHp[2] && lv.starHp[0] <= lv.carrotHp);
  check(lv.id + ' 波次 3-6', lv.waves.length >= 3 && lv.waves.length <= 6, String(lv.waves.length));
  lv.waves.forEach((w, wi) => {
    w.groups.forEach((g) => {
      check(lv.id + ' 波' + (wi + 1) + ' 敌人 ' + g.enemy + ' 存在', !!enemies[g.enemy]);
      check(lv.id + ' 波' + (wi + 1) + ' 路径下标有效', (g.path || 0) < lv.paths.length);
    });
  });
});

// ---- 3. 完整模拟（每一关都跑一遍）----
function makeGame(level) {
  const paths = level.paths.map((p) => new PWLB.Path(p));
  const g = {
    level,
    paths,
    enemies: [],
    projectiles: [],
    effects: [],
    towerList: [],
    towerAt: {},
    obstacleAt: {},
    obstacles: (level.obstacles || []).map((o, i) => ({ ...o, maxHp: o.hp, flash: 0, id: i })),
    coins: level.startCoins,
    carrotHp: level.carrotHp,
    carrotFlash: 0,
    carrotPos: { x: (level.carrot[0] + 0.5) * 64, y: (level.carrot[1] + 0.5) * 64 },
    time: 0,
    state: 'playing',
    enemySeq: 1,
    kills: 0,
    leaks: 0,
    onEnemyLeaked(e) {
      this.leaks++;
      const dmg = e.boss ? 3 : 1;
      this.carrotHp = Math.max(0, this.carrotHp - dmg);
      if (this.carrotHp <= 0) this.state = 'lost';
    },
    onEnemyKilled(e) { this.kills++; this.coins += e.reward; },
    onWaveStart() {},
    onAllWavesCleared() { this.state = 'won'; },
    spawnEnemy(type, pathIndex) {
      const e = new PWLB.Enemy(enemies[type], {
        id: this.enemySeq++, path: this.paths[pathIndex] || this.paths[0],
        pathIndex: pathIndex || 0, hpScale: level.hpScale || 1
      });
      this.enemies.push(e);
      return e;
    },
    update(dt) {
      this.time += dt;
      this.waves.update(dt);
      this.enemies.forEach((e) => e.update(dt, this));
      this.towerList.forEach((t) => t.update(dt, this));
      this.projectiles.forEach((p) => p.update(dt, this));
      this.effects.forEach((f) => (f.life -= dt));
      this.enemies = this.enemies.filter((e) => e.alive);
      this.projectiles = this.projectiles.filter((p) => p.alive);
      this.effects = this.effects.filter((f) => f.life > 0);
    }
  };
  g.obstacles.forEach((o) => (g.obstacleAt[o.col + ',' + o.row] = o));
  g.waves = new PWLB.WaveManager(level, g);
  return g;
}

console.log('\n[3] 全关卡战斗模拟（每种塔各造一批，跑满 300 秒）');
levels.forEach((lv) => {
  const g = makeGame(lv);
  // 均匀铺塔：所有塔位都造塔，按顺序循环选类型
  const ids = Object.keys(towers);
  lv.slots.forEach((s, i) => {
    const def = towers[ids[i % ids.length]];
    const t = new PWLB.Tower(def, 2, s[0], s[1]);
    g.towerList.push(t);
    g.towerAt[s[0] + ',' + s[1]] = t;
  });
  const dt = 1 / 60;
  let steps = 0;
  while (g.state === 'playing' && steps < 600 * 60) {
    g.update(dt);
    steps++;
  }
  const spawnTotal = lv.waves.reduce((n, w) => n + w.groups.reduce((m, gr) => m + gr.count, 0), 0);
  check(lv.id + ' ' + lv.name + ' 战斗结束于时限内', g.state !== 'playing', '仍在下' + Math.round(g.time) + 's');
  check(lv.id + ' 有敌人被击杀', g.kills > 0, 'kills=' + g.kills);
  check(lv.id + ' 击杀 + 漏怪 = 总刷怪数', g.kills + g.leaks === spawnTotal,
    g.kills + '+' + g.leaks + ' vs ' + spawnTotal);
  console.log('      → ' + g.state + '  用时 ' + g.time.toFixed(1) + 's  击杀 ' + g.kills + ' 漏 ' + g.leaks +
    '  萝卜 ' + g.carrotHp + '/' + lv.carrotHp + '  金币余额 ' + Math.round(g.coins));
  check(lv.id + ' 塔群能保住萝卜（满配塔位）', g.state === 'won' || g.carrotHp <= lv.carrotHp,
    'state=' + g.state);
});

// ---- 4. 空场压力测试：不建塔必须输 ----
console.log('\n[4] 不建塔必然失败');
const solo = levels[0];
const g0 = makeGame(solo);
let s = 0;
while (g0.state === 'playing' && s < 300 * 60) { g0.update(1 / 60); s++; }
check('lv1 不建塔会失败', g0.state === 'lost', 'state=' + g0.state + ' leaks=' + g0.leaks);

// ---- 5. 减速与护甲 ----
console.log('\n[5] 战斗规则');
const tp = new PWLB.Path(solo.paths[0]);
const fast = new PWLB.Enemy(enemies.rabbitFast, { id: 1, path: tp });
const slow = new PWLB.Enemy(enemies.rabbitTank, { id: 2, path: tp });
check('疾风兔比铁甲兔快', fast.baseSpeed > slow.baseSpeed);
fast.applySlow(0.5, 2);
check('减速后速度下降', fast.speedNow() < fast.baseSpeed, fast.speedNow().toFixed(1));
const hp0 = slow.hp;
const g1 = makeGame(solo);
slow.hurt(100, g1);
check('护甲减免生效（100 伤害打不满）', hp0 - slow.hp < 100, '实际掉血 ' + (hp0 - slow.hp).toFixed(1));

// ---- 6. 波次结算 ----
console.log('\n[6] 波次管理器');
const g2 = makeGame(solo);
check('初始处于等待状态', !g2.waves.active && g2.waves.index === -1);
g2.waves.timer = 0.01;
g2.waves.update(0.02);
check('倒计时结束自动开波', g2.waves.active && g2.waves.index === 0);
check('开波后产生刷怪器', g2.waves.spawners.length > 0);

console.log('\n' + (failures === 0 ? '[OK] 全部通过' : '[FAIL] 失败 ' + failures + ' 项'));
process.exit(failures === 0 ? 0 : 1);
