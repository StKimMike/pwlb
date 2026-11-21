/* global window */
/**
 * 保卫萝卜复刻版 · 游戏内核
 * 负责路径、敌人、炮塔、弹丸、波次等纯逻辑（不含绘制与 DOM）。
 */
(function () {
  'use strict';

  var PWLB = (window.PWLB = window.PWLB || {});

  var TILE = 64;
  var COLS = 20;
  var ROWS = 12;
  var W = COLS * TILE;
  var H = ROWS * TILE;

  PWLB.TILE = TILE;
  PWLB.COLS = COLS;
  PWLB.ROWS = ROWS;
  PWLB.W = W;
  PWLB.H = H;

  // ---------------------------------------------------------------- 工具
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function cellKey(c, r) { return c + ',' + r; }

  PWLB.util = { lerp: lerp, clamp: clamp, dist2: dist2, cellKey: cellKey };

  // ---------------------------------------------------------------- 路径
  function Path(tilePoints) {
    var pts = [];
    for (var i = 0; i < tilePoints.length; i++) {
      pts.push({ x: (tilePoints[i][0] + 0.5) * TILE, y: (tilePoints[i][1] + 0.5) * TILE, c: tilePoints[i][0], r: tilePoints[i][1] });
    }
    this.points = pts;
    this.segs = [];
    var total = 0;
    for (var j = 0; j < pts.length - 1; j++) {
      var a = pts[j], b = pts[j + 1];
      var len = Math.hypot(b.x - a.x, b.y - a.y);
      this.segs.push({ a: a, b: b, len: len, start: total });
      total += len;
    }
    this.length = total;
    this.cells = [];
    var seen = {};
    for (var k = 0; k < pts.length - 1; k++) {
      var p = pts[k], q = pts[k + 1];
      var c0 = Math.min(p.c, q.c), c1 = Math.max(p.c, q.c);
      var r0 = Math.min(p.r, q.r), r1 = Math.max(p.r, q.r);
      for (var cc = c0; cc <= c1; cc++) {
        for (var rr = r0; rr <= r1; rr++) {
          var key = cellKey(cc, rr);
          if (!seen[key]) { seen[key] = 1; this.cells.push([cc, rr]); }
        }
      }
    }
    this.cellSet = seen;
  }

  Path.prototype.posAt = function (d) {
    if (d <= 0) return { x: this.segs[0].a.x, y: this.segs[0].a.y, dir: this.dirOf(0) };
    if (d >= this.length) {
      var last = this.segs[this.segs.length - 1];
      return { x: last.b.x, y: last.b.y, dir: this.dirOf(this.length - 0.001) };
    }
    for (var i = 0; i < this.segs.length; i++) {
      var s = this.segs[i];
      if (d <= s.start + s.len) {
        var t = s.len === 0 ? 0 : (d - s.start) / s.len;
        return { x: lerp(s.a.x, s.b.x, t), y: lerp(s.a.y, s.b.y, t), dir: this.dirOf(d) };
      }
    }
    var l = this.segs[this.segs.length - 1];
    return { x: l.b.x, y: l.b.y, dir: { x: 0, y: 1 } };
  };

  Path.prototype.dirOf = function (d) {
    for (var i = 0; i < this.segs.length; i++) {
      var s = this.segs[i];
      if (d <= s.start + s.len) {
        var len = s.len || 1;
        return { x: (s.b.x - s.a.x) / len, y: (s.b.y - s.a.y) / len };
      }
    }
    var l = this.segs[this.segs.length - 1];
    var ll = l.len || 1;
    return { x: (l.b.x - l.a.x) / ll, y: (l.b.y - l.a.y) / ll };
  };

  PWLB.Path = Path;

  // ---------------------------------------------------------------- 敌人
  function Enemy(def, opts) {
    opts = opts || {};
    this.id = opts.id || 0;
    this.type = def.id;
    this.def = def;
    this.maxHp = Math.round(def.hp * (opts.hpScale || 1));
    this.hp = this.maxHp;
    this.baseSpeed = def.speed;
    this.radius = def.radius || 16;
    this.armor = clamp(def.armor || 0, 0, 0.85);
    this.reward = def.reward || 0;
    this.boss = !!def.boss;
    this.pathIndex = opts.pathIndex || 0;
    this.path = opts.path;
    this.dist = opts.dist || 0;
    this.shieldMax = Math.round((def.shield || 0) * (opts.hpScale || 1));
    this.shield = this.shieldMax;
    this.regen = def.regen || 0;
    this.poisonPct = 0;
    this.poisonTime = 0;
    this.slowTime = 0;
    this.slowPct = 0;
    this.frozen = 0;
    this.hitFlash = 0;
    this.alive = true;
    this.leaked = false;
    this.walkT = Math.random() * 6.28;
    this.facing = 1;
    this.x = 0;
    this.y = 0;
    this.syncPos();
  }

  /** 同一关里越靠后的波次越硬：第 1 波 1.0，之后每波 +18%，最多 ×2.6。 */
  Enemy.prototype.applyWaveScale = function (waveIndex) {
    var scale = 1 + Math.min(0.9, Math.max(0, waveIndex) * 0.12);
    this.maxHp = Math.round(this.maxHp * scale);
    this.hp = this.maxHp;
  };

  Enemy.prototype.syncPos = function () {
    var p = this.path.posAt(this.dist);
    this.x = p.x;
    this.y = p.y;
    if (p.dir.x > 0.01) this.facing = 1;
    else if (p.dir.x < -0.01) this.facing = -1;
    this.dir = p.dir;
  };

  Enemy.prototype.speedNow = function () {
    if (this.frozen > 0) return this.baseSpeed * 0.35;
    return this.baseSpeed * (1 - this.slowPct);
  };

  Enemy.prototype.update = function (dt, game) {
    if (!this.alive) return;
    this.walkT += dt * (this.frozen > 0 ? 4 : 9);
    if (this.slowTime > 0) {
      this.slowTime -= dt;
      if (this.slowTime <= 0) { this.slowTime = 0; this.slowPct = 0; }
    }
    if (this.frozen > 0) this.frozen = Math.max(0, this.frozen - dt);
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 3.5);

    // 自带回血
    if (this.regen > 0 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.regen * dt);
    }
    // 中毒：每秒掉血，可叠加刷新
    if (this.poisonTime > 0) {
      this.poisonTime -= dt;
      this.hp -= this.poisonPct * dt;
      if (this.hp <= 0) { this.alive = false; game.onEnemyKilled(this); return; }
    }
    // 护盾缓慢自我修复（重装类）
    if (this.shieldMax > 0 && this.shield < this.shieldMax && this.regen > 0) {
      this.shield = Math.min(this.shieldMax, this.shield + this.regen * 0.5 * dt);
    }

    // Boss 半血狂暴：速度提高、护甲降低（更好打，但压力也更大）
    if (this.boss && this.hp / this.maxHp <= 0.5 && !this._enraged) {
      this._enraged = true;
      this.baseSpeed *= 1.25;
      this.armor = Math.max(0, this.armor - 0.1);
      if (PWLB.GameAudioRef) PWLB.GameAudioRef.play('boss');
    }

    this.dist += this.speedNow() * dt;
    this.syncPos();

    if (this.def.healAura) {
      var aura = this.def.healAura;
      for (var i = 0; i < game.enemies.length; i++) {
        var other = game.enemies[i];
        if (other === this || !other.alive) continue;
        if (dist2(other.x, other.y, this.x, this.y) <= aura.radius * aura.radius) {
          other.hp = Math.min(other.maxHp, other.hp + aura.hps * dt);
        }
      }
    }

    if (this.dist >= this.path.length) {
      this.leaked = true;
      this.alive = false;
      game.onEnemyLeaked(this);
    }
  };

  Enemy.prototype.hurt = function (amount, game, opts) {
    if (!this.alive) return 0;
    opts = opts || {};
    var dmg = amount * (1 - this.armor);
    if (opts.ignoreArmor) dmg = amount;
    dmg = Math.max(1, dmg);

    // 护盾先吃伤害
    if (this.shield > 0) {
      var absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
      this.hitFlash = 1;
      if (this.shield <= 0 && PWLB.GameAudioRef) PWLB.GameAudioRef.play('hit');
      if (dmg <= 0) return absorbed;
    }

    this.hp -= dmg;
    this.hitFlash = 1;

    // 狂暴兔：越掉血跑越快
    if (this.def.berserk) {
      var lost = 1 - this.hp / this.maxHp;
      this.baseSpeed = this.def.speed * (1 + lost * 0.9);
    }

    if (this.hp <= 0) {
      this.alive = false;
      game.onEnemyKilled(this);
      // 分裂兔：死后裂成小怪
      if (this.def.split > 0 && game.spawnSplit) game.spawnSplit(this);
    }
    return dmg;
  };

  /** 中毒：每秒 poison 点伤害，持续 dur 秒。 */
  Enemy.prototype.applyPoison = function (poisonDps, dur) {
    this.poisonPct = Math.max(this.poisonPct, poisonDps);
    this.poisonTime = Math.max(this.poisonTime, dur);
  };

  Enemy.prototype.applySlow = function (pct, dur) {
    if (this.boss && pct > 0.3) pct = 0.3;
    if (pct >= this.slowPct) { this.slowPct = pct; this.slowTime = Math.max(this.slowTime, dur); }
    else if (this.slowTime <= 0) { this.slowPct = pct; this.slowTime = dur; }
  };

  PWLB.Enemy = Enemy;

  // ---------------------------------------------------------------- 炮塔
  function Tower(def, level, col, row) {
    this.def = def;
    this.id = def.id;
    this.level = level || 1;
    this.col = col;
    this.row = row;
    this.cx = (col + 0.5) * TILE;
    this.cy = (row + 0.5) * TILE;
    this.angle = -Math.PI / 2;
    this.cooldown = 0;
    this.firing = 0;
    this.spin = 0;
    this.kills = 0;
    this.totalDamage = 0;
    this.beamTarget = null;
    this.beamFx = 0;
  }

  Tower.prototype.stat = function () {
    return this.def.levels[Math.min(this.level, this.def.levels.length) - 1];
  };
  Tower.prototype.range = function () { return this.stat().range; };
  Tower.prototype.upgradeCost = function () {
    var costs = this.def.upgradeCost || [];
    return this.level < 3 ? costs[this.level - 1] || 0 : null;
  };
  Tower.prototype.sellValue = function () {
    var spent = this.def.cost;
    var costs = this.def.upgradeCost || [];
    for (var i = 0; i < this.level - 1; i++) spent += costs[i] || 0;
    return Math.floor(spent * (this.def.sellRatio || 0.7));
  };

  /**
   * 选目标。优先级：
   *   1) 玩家锁定且在射程内的敌人（锁定的障碍由建筑伤害逻辑处理）
   *   2) 射程内最靠前的敌人
   * 未锁定时绝不主动选建筑当目标——建筑只能被"打目标时的溅射/穿透"顺带打到，
   * 或被玩家锁定后专打。
   */
  Tower.prototype.pickTarget = function (game) {
    var r2 = this.range() * this.range();

    // 1) 锁定目标优先（只锁敌人；建筑由 pickBuilding 处理）
    var lock = game.lockedTarget;
    if (lock && lock.type === 'enemy' && lock.ref && lock.ref.alive) {
      var lr = lock.ref;
      if (dist2(lr.x, lr.y, this.cx, this.cy) <= r2) return lr;
    }

    // 2) 否则打最靠前的敌人
    var best = null;
    var bestDist = -1;
    for (var i = 0; i < game.enemies.length; i++) {
      var e = game.enemies[i];
      if (!e.alive) continue;
      if (dist2(e.x, e.y, this.cx, this.cy) > r2) continue;
      if (e.dist > bestDist) { bestDist = e.dist; best = e; }
    }
    return best;
  };

  /** 锁定的建筑是否在我射程内（是则可作为攻击目标）。 */
  Tower.prototype.lockedBuilding = function (game) {
    var lock = game.lockedTarget;
    if (!lock || lock.type !== 'building' || !lock.ref) return null;
    var o = lock.ref;
    if (o.hp <= 0) return null;
    var cx = (o.col + o.w / 2) * TILE;
    var cy = (o.row + o.h / 2) * TILE;
    var half = Math.max(o.w, o.h) * TILE * 0.5;
    var r = this.range() + half;
    if (dist2(cx, cy, this.cx, this.cy) > r * r) return null;
    return o;
  };

  /** 当前等级的攻击力（含光环加成）。 */
  Tower.prototype.power = function (game) {
    var base = this.stat().damage || 0;
    return base * (1 + (this.buff || 0));
  };

  Tower.prototype.update = function (dt, game) {
    var st = this.stat();
    if (this.firing > 0) this.firing = Math.max(0, this.firing - dt * 4);
    this.spin += dt * (this.id === 'fan' ? 6 : this.id === 'drum' ? 3 : 0.8);

    // 光环塔：不攻击，只给周围友军加攻
    if (st.strategy === 'aura') {
      this.updateAura(game, st);
      return;
    }

    // 激光塔：持续伤害
    if (st.strategy === 'beam') { this.updateBeam(dt, game, st); return; }

    // 锁定了建筑 → 优先打建筑（必须在自己射程内）
    var lb = this.lockedBuilding(game);
    if (lb) {
      var bx = (lb.col + lb.w / 2) * TILE;
      var by = (lb.row + lb.h / 2) * TILE;
      var bang = Math.atan2(by - this.cy, bx - this.cx);
      var bdiff = bang - this.angle;
      while (bdiff > Math.PI) bdiff -= Math.PI * 2;
      while (bdiff < -Math.PI) bdiff += Math.PI * 2;
      this.angle += bdiff * Math.min(1, dt * 14);

      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        this.cooldown = st.cooldown || 1;
        this.firing = 1;
        game.damageBuildings(bx, by, this.power(game) * 1.15, 10);
        game.effects.push({ type: 'spark', x: bx, y: by, life: 0.2, maxLife: 0.2, hue: 40 });
        if (PWLB.GameAudioRef) PWLB.GameAudioRef.play('shoot_' + this.id);
      }
      return;
    }

    var target = this.pickTarget(game);
    if (target) {
      var want = Math.atan2(target.y - this.cy, target.x - this.cx);
      var diff = want - this.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.angle += diff * Math.min(1, dt * 14);
    }

    this.cooldown -= dt;
    if (this.cooldown > 0 || !target) return;
    this.cooldown = st.cooldown || 1;

    if (st.strategy === 'chain') { this.fireChain(game, st, target); return; }
    this.fireProjectiles(game, st, target);
  };

  /** 光环：范围内友军攻击力 +auraBuff（取最高，不叠加）。 */
  Tower.prototype.updateAura = function (game, st) {
    this.firing = 0.6;
    var r2 = (st.auraRadius || 120) * (st.auraRadius || 120);
    for (var i = 0; i < game.towerList.length; i++) {
      var t = game.towerList[i];
      if (t === this) continue;
      if (dist2(t.cx, t.cy, this.cx, this.cy) <= r2) {
        t.buff = Math.max(t.buff || 0, st.auraBuff || 0);
        t.buffedBy = this;
      }
    }
  };

  /** 弹丸统一入口：按 strategy 决定弹道与命中行为。 */
  Tower.prototype.fireProjectiles = function (game, st, target) {
    this.firing = 1;
    var strategy = st.strategy || 'single';
    var shots = strategy === 'fan' ? (st.shots || 3) : (strategy === 'burst' ? (st.burst || 3) : 1);
    if (strategy === 'fan') shots = st.shots || 3;
    var spread = st.spread || 0;
    var baseAngle = Math.atan2(target.y - this.cy, target.x - this.cx);
    this.angle = baseAngle;

    var power = this.power(game);
    var isCrit = strategy === 'crit' && Math.random() < (st.critChance || 0.25);
    var dmg = power * (isCrit ? (st.critMult || 2) : 1);

    for (var i = 0; i < shots; i++) {
      var offset = shots === 1 ? 0 : (i - (shots - 1) / 2) * spread;
      var ang = baseAngle + offset;
      var p = new PWLB.Projectile({
        kind: this.id,
        x: this.cx + Math.cos(this.angle) * 18,
        y: this.cy + Math.sin(this.angle) * 18,
        angle: ang,
        speed: st.projSpeed || 480,
        damage: dmg,
        splash: st.splash || 0,
        slowPct: st.slowPct || 0,
        slowDur: st.slowDur || 0,
        pierce: st.pierce || 0,
        poison: st.poison || 0,
        poisonDur: st.poisonDur || 0,
        homing: strategy === 'homing' || !!st.homing,
        crit: isCrit,
        target: target,
        owner: this
      });
      game.projectiles.push(p);
    }

    if (isCrit) {
      game.effects.push({ type: 'crit', x: target.x, y: target.y - 20, life: 0.5, maxLife: 0.5 });
    }
    if (PWLB.GameAudioRef) PWLB.GameAudioRef.play('shoot_' + this.id);
  };

  Tower.prototype.fireChain = function (game, st, target) {
    this.firing = 1;
    var hit = [];
    var cur = target;
    var damage = this.power(game);
    var maxTargets = st.chain || 3;
    var range = st.chainRange || 110;
    var pts = [{ x: this.cx, y: this.cy }];
    for (var i = 0; i < maxTargets && cur; i++) {
      hit.push(cur);
      pts.push({ x: cur.x, y: cur.y });
      cur.hurt(damage, game);
      damage *= 0.85;
      var next = null;
      var bestD = range * range;
      for (var j = 0; j < game.enemies.length; j++) {
        var e = game.enemies[j];
        if (!e.alive || hit.indexOf(e) >= 0) continue;
        var d = dist2(e.x, e.y, pts[pts.length - 1].x, pts[pts.length - 1].y);
        if (d < bestD) { bestD = d; next = e; }
      }
      cur = next;
    }
    game.effects.push({ type: 'lightning', points: pts, life: 0.18, maxLife: 0.18, seed: Math.random() * 999 });
    if (PWLB.GameAudioRef) PWLB.GameAudioRef.play('shoot_tesla');
  };

  Tower.prototype.updateBeam = function (dt, game, st) {
    var target = this.pickTarget(game);
    if (!target) { this.beamTarget = null; this.beamFx = Math.max(0, this.beamFx - dt * 5); return; }
    this.beamTarget = target;
    this.beamFx = 1;
    var ang = Math.atan2(target.y - this.cy, target.x - this.cx);
    this.angle = ang;
    this.firing = 1;
    var dmg = (st.beamDps || 0) * (1 + (this.buff || 0)) * dt;
    target.hurt(dmg, game, { ignoreArmor: true });
    if (Math.random() < dt * 6) {
      game.effects.push({ type: 'spark', x: target.x, y: target.y, life: 0.25, maxLife: 0.25, hue: 45 });
    }
    if (PWLB.GameAudioRef && Math.random() < dt * 3) PWLB.GameAudioRef.play('shoot_sun');
  };

  PWLB.Tower = Tower;

  // ---------------------------------------------------------------- 弹丸
  function Projectile(o) {
    this.kind = o.kind;
    this.x = o.x;
    this.y = o.y;
    this.angle = o.angle || 0;
    this.speed = o.speed || 480;
    this.damage = o.damage || 0;
    this.splash = o.splash || 0;
    this.slowPct = o.slowPct || 0;
    this.slowDur = o.slowDur || 0;
    this.pierce = o.pierce || 0;
    this.poison = o.poison || 0;
    this.poisonDur = o.poisonDur || 0;
    this.homing = !!o.homing;
    this.crit = !!o.crit;
    this.hitList = [];
    this.target = o.target;
    this.owner = o.owner;
    this.tx = o.target ? o.target.x : o.x;
    this.ty = o.target ? o.target.y : o.y;
    this.alive = true;
    this.age = 0;
    this.spin = 0;
  }

  Projectile.prototype.update = function (dt, game) {
    if (!this.alive) return;
    this.age += dt;
    this.spin += dt * 12;

    // 追踪弹：目标还活着就一直锁着它
    if (this.target && this.target.alive) { this.tx = this.target.x; this.ty = this.target.y; }
    var dx = this.tx - this.x, dy = this.ty - this.y;
    var d = Math.hypot(dx, dy) || 1;

    // 追踪弹转向有速度上限，看起来才像导弹
    if (this.homing) {
      var want = Math.atan2(dy, dx);
      var diff = want - this.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.angle += diff * Math.min(1, dt * 6);
      this.x += Math.cos(this.angle) * this.speed * dt;
      this.y += Math.sin(this.angle) * this.speed * dt;
      if (d <= 14 || (this.target && !this.target.alive)) {
        this.impact(game);
        this.alive = false;
        return;
      }
    } else {
      var step = this.speed * dt;
      if (d <= step + 6) {
        this.x = this.tx; this.y = this.ty;
        this.impact(game);
        this.alive = false;
        return;
      }
      this.angle = Math.atan2(dy, dx);
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
    }

    // 穿透：飞行途中碰到敌人就结算，可穿 pierce 个
    if (this.pierce > 0) {
      for (var i = 0; i < game.enemies.length; i++) {
        var e = game.enemies[i];
        if (!e.alive || this.hitList.indexOf(e) >= 0) continue;
        if (dist2(e.x, e.y, this.x, this.y) <= (e.radius + 8) * (e.radius + 8)) {
          this.hitList.push(e);
          e.hurt(this.damage, game);
          game.effects.push({ type: 'spark', x: e.x, y: e.y, life: 0.16, maxLife: 0.16, hue: 90 });
          if (this.hitList.length > this.pierce) { this.alive = false; return; }
        }
      }
    }

    // 打到建筑也能掉血（穿透弹沿路削）
    if (this.pierce > 0 && game.damageBuildings) game.damageBuildings(this.x, this.y, this.damage * 0.6);

    if (this.x < -80 || this.x > W + 80 || this.y < -80 || this.y > H + 80) this.alive = false;
  };

  Projectile.prototype.impact = function (game) {
    var i, e;
    if (this.splash > 0) {
      for (i = 0; i < game.enemies.length; i++) {
        e = game.enemies[i];
        if (!e.alive) continue;
        var dd = Math.sqrt(dist2(e.x, e.y, this.x, this.y));
        if (dd <= this.splash + e.radius * 0.5) {
          var falloff = clamp(1 - dd / (this.splash * 1.3), 0.45, 1);
          e.hurt(this.damage * falloff, game);
        }
      }
      game.effects.push({
        type: 'explosion', x: this.x, y: this.y, r: this.splash,
        life: 0.36, maxLife: 0.36, hue: this.kind === 'magic' ? 275 : 25
      });
      if (PWLB.GameAudioRef) PWLB.GameAudioRef.play('explode');
    } else if (this.target && this.target.alive) {
      this.target.hurt(this.damage, game);
      game.effects.push({ type: 'spark', x: this.x, y: this.y, life: 0.2, maxLife: 0.2, hue: 195 });
      if (PWLB.GameAudioRef) PWLB.GameAudioRef.play('hit');
    }

    if (this.slowPct > 0) {
      for (i = 0; i < game.enemies.length; i++) {
        e = game.enemies[i];
        if (!e.alive) continue;
        if (dist2(e.x, e.y, this.x, this.y) <= 60 * 60) e.applySlow(this.slowPct, this.slowDur);
      }
      game.effects.push({ type: 'frost', x: this.x, y: this.y, r: 46, life: 0.4, maxLife: 0.4 });
      if (PWLB.GameAudioRef) PWLB.GameAudioRef.play('freeze');
    }

    // 中毒：给命中的敌人挂持续掉血
    if (this.poison > 0) {
      if (this.splash > 0) {
        for (i = 0; i < game.enemies.length; i++) {
          e = game.enemies[i];
          if (e.alive && dist2(e.x, e.y, this.x, this.y) <= this.splash * this.splash) {
            e.applyPoison(this.poison, this.poisonDur);
          }
        }
      } else if (this.target && this.target.alive) {
        this.target.applyPoison(this.poison, this.poisonDur);
      }
      game.effects.push({ type: 'poison', x: this.x, y: this.y, r: this.splash || 34, life: 0.45, maxLife: 0.45 });
    }

    // 建筑：只有玩家锁定了建筑时才吃伤害。
    // 未锁定时炮台不主动打建筑（这是需求明确要求的）。
    if (game.damageBuildings && game.lockedTarget && game.lockedTarget.type === 'building') {
      game.damageBuildings(this.x, this.y, this.damage, this.splash);
    }
  };

  PWLB.Projectile = Projectile;

  // ---------------------------------------------------------------- 波次
  function WaveManager(level, game) {
    this.level = level;
    this.game = game;
    this.waves = level.waves || [];
    this.index = -1;
    this.timer = this.waves.length ? this.waves[0].delay : 0;
    this.spawners = [];
    this.active = false;
    this.finished = false;
    this.spawnCount = 0;
  }

  WaveManager.prototype.startNext = function () {
    this.index++;
    if (this.index >= this.waves.length) { this.finished = true; return; }
    var wave = this.waves[this.index];
    this.spawners = [];
    for (var i = 0; i < wave.groups.length; i++) {
      var g = wave.groups[i];
      this.spawners.push({
        enemy: g.enemy,
        left: g.count,
        interval: Math.max(0.08, g.interval || 0.8),
        // delay：这一组延后几秒才开始刷（用来让 Boss 压轴登场）
        timer: Math.max(0, g.delay || 0),
        pathIndex: g.path || 0,
        started: false
      });
    }
    // 最后一波：保证有终极 Boss（即使关卡数据漏配，也不会出现"没有 BOSS"的关卡）
    var isLast = this.index === this.waves.length - 1;
    if (isLast && this.game.enemyDefs && this.game.enemyDefs.finalBoss) {
      var hasFinal = wave.groups.some(function (g) { return g.enemy === 'finalBoss'; });
      if (!hasFinal) {
        wave.groups.push({ enemy: 'finalBoss', count: 1, interval: 1, path: 0 });
      }
    }

    this.active = true;
    this.game.currentWave = this.index;
    this.game.onWaveStart(this.index + 1, this.waves.length);
  };

  WaveManager.prototype.update = function (dt) {
    if (this.finished) return;

    if (!this.active) {
      this.timer -= dt;
      if (this.timer <= 0) this.startNext();
      return;
    }

    var allDone = true;
    for (var i = 0; i < this.spawners.length; i++) {
      var s = this.spawners[i];
      if (s.left <= 0) continue;
      allDone = false;
      s.timer -= dt;
      if (s.timer <= 0) {
        s.timer = s.interval;
        s.left--;
        this.spawnCount++;
        this.game.spawnEnemy(s.enemy, s.pathIndex);
      }
    }

    if (allDone && this.game.enemies.length === 0 && !this.game.pendingSpawns) {
      this.active = false;
      if (this.index + 1 >= this.waves.length) {
        this.finished = true;
        this.game.onAllWavesCleared();
      } else {
        this.timer = this.waves[this.index + 1].delay;
      }
    }
  };

  WaveManager.prototype.timeLeft = function () {
    return this.active ? 0 : Math.max(0, this.timer);
  };

  PWLB.WaveManager = WaveManager;


  // ---------------------------------------------------------------- 特殊武器（场上拾取）
  var PICKUP_DEFS = {
    bomb: { name: '炸弹', color: '#ff7043', radius: 14, damage: 260, splash: 120 },
    freeze: { name: '冰冻', color: '#4fc3f7', radius: 14, slowPct: 0.75, slowDur: 4.0, radiusFx: 150 },
    lightning: { name: '闪电', color: '#ffd93d', radius: 14, damage: 180, chain: 8 }
  };
  PWLB.PICKUP_DEFS = PICKUP_DEFS;

  /** 使用一个拾取物：在指定位置释放它的效果。 */
  PWLB.usePickup = function (game, kind, x, y) {
    var def = PICKUP_DEFS[kind];
    if (!def) return false;
    var i, e;
    if (kind === 'bomb') {
      for (i = 0; i < game.enemies.length; i++) {
        e = game.enemies[i];
        if (!e.alive) continue;
        var d = Math.sqrt(dist2(e.x, e.y, x, y));
        if (d <= def.splash) e.hurt(def.damage * (1 - d / (def.splash * 1.6)), game, { ignoreArmor: true });
      }
      game.effects.push({ type: 'explosion', x: x, y: y, r: def.splash, life: 0.55, maxLife: 0.55, hue: 18 });
    } else if (kind === 'freeze') {
      for (i = 0; i < game.enemies.length; i++) {
        e = game.enemies[i];
        if (!e.alive) continue;
        if (Math.sqrt(dist2(e.x, e.y, x, y)) <= def.radiusFx) {
          e.frozen = Math.max(e.frozen, def.slowDur);
          e.applySlow(def.slowPct, def.slowDur);
        }
      }
      game.effects.push({ type: 'frost', x: x, y: y, r: def.radiusFx, life: 0.7, maxLife: 0.7 });
    } else if (kind === 'lightning') {
      var targets = game.enemies.filter(function (q) { return q.alive; })
        .map(function (q) { return { e: q, d: dist2(q.x, q.y, x, y) }; })
        .sort(function (a, b) { return a.d - b.d; })
        .slice(0, def.chain);
      var pts = [{ x: x, y: y }];
      for (i = 0; i < targets.length; i++) {
        pts.push({ x: targets[i].e.x, y: targets[i].e.y });
        targets[i].e.hurt(def.damage, game, { ignoreArmor: true });
      }
      game.effects.push({ type: 'lightning', points: pts, life: 0.35, maxLife: 0.35, seed: Math.random() * 999 });
    }
    return true;
  };

  PWLB.engineReady = true;
})();
