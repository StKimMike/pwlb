/* global window, document, PWLB, Fmt */
/**
 * 保卫萝卜复刻版 · 主控
 * 屏幕切换、关卡流程、输入、HUD、存档。
 */
(function () {
  'use strict';

  var PWLB = window.PWLB;
  var F = window.Fmt;
  var TILE = PWLB.TILE;
  var W = PWLB.W;
  var H = PWLB.H;

  window.__pwlbErrors = window.__pwlbErrors || [];

  // ------------------------------------------------------------ 音频代理
  function audio() { return window.GameAudio; }
  function play(name) { var a = audio(); if (a && a.play) { try { a.play(name); } catch (e) {} } }
  PWLB.GameAudioRef = { play: play };

  // ------------------------------------------------------------ 全局状态
  var App = {
    profile: null,
    levels: [],
    towers: {},
    enemies: {},
    game: null,
    screen: 'menu',
    sound: true,
    music: true,
    volume: 0.7,
    paused: false,
    lastResults: null
  };
  window.App = App;

  // ------------------------------------------------------------ 存档
  function defaultProfile() {
    return { coins: 0, stars: {}, unlocked: ['lv1'], levels: {}, sound: true, music: true, volume: 0.7 };
  }

  function loadProfile() {
    return fetch('/api/profile', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : defaultProfile(); })
      .catch(function () { return defaultProfile(); })
      .then(function (p) {
        App.profile = Object.assign(defaultProfile(), p || {});
        return App.profile;
      });
  }

  function saveProfile() {
    if (!App.profile) return Promise.resolve();
    try { localStorage.setItem('pwlb-profile', JSON.stringify(App.profile)); } catch (e) {}
    return fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(App.profile)
    }).catch(function () { /* 离线也能玩，静默降级 */ });
  }

  function postScore(payload) {
    return fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(function () {});
  }

  // ------------------------------------------------------------ 屏幕
  var SCREENS = ['menu', 'levels', 'collection', 'game'];

  function showScreen(name) {
    App.screen = name;
    SCREENS.forEach(function (id) {
      var el = F.el('screen-' + id);
      if (!el) return;
      el.classList.toggle('active', id === name);
    });
    if (name === 'menu') {
      renderMenuProfile();
      if (audio() && audio().startMusic) audio().startMusic('menu');
    }
    if (name === 'levels') renderLevelGrid();
    if (name === 'collection') renderCollection(App.collTab || 'towers');
  }

  function renderMenuProfile() {
    var box = F.el('menu-profile');
    if (!box || !App.profile) return;
    var stars = 0;
    Object.keys(App.profile.stars || {}).forEach(function (k) { stars += App.profile.stars[k] || 0; });
    box.innerHTML =
      '<div class="profile-chip"><span class="ico">🪙</span><b>' + App.profile.coins + '</b> 萝卜币</div>' +
      '<div class="profile-chip"><span class="ico">⭐</span><b>' + stars + '</b> / ' + (App.levels.length * 3) + ' 星</div>';
  }

  // ------------------------------------------------------------ 关卡选择
  function starOf(id) { return (App.profile.stars || {})[id] || 0; }
  function unlockedOf(id) { return (App.profile.unlocked || ['lv1']).indexOf(id) >= 0; }

  function renderLevelGrid() {
    var grid = F.el('level-grid');
    if (!grid) return;
    grid.innerHTML = '';
    App.levels.forEach(function (lv, idx) {
      var unlocked = unlockedOf(lv.id);
      var stars = starOf(lv.id);
      var card = document.createElement('button');
      card.className = 'level-card' + (unlocked ? '' : ' locked');
      card.type = 'button';
      card.dataset.level = lv.id;
      var themeNames = {
        forest: '森林', desert: '沙漠', snow: '冰雪', candy: '糖果', volcano: '熔岩', sky: '天空'
      };
      var starHtml = '';
      for (var si = 0; si < 3; si++) {
        starHtml += '<span' + (unlocked && si < stars ? ' class="on"' : '') + '>★</span>';
      }
      card.innerHTML =
        '<div class="level-no">第 ' + (idx + 1) + ' 关</div>' +
        '<div class="level-name">' + (unlocked ? lv.name : '？？？') + '</div>' +
        '<div class="level-desc">' + (unlocked ? (themeNames[lv.theme] || lv.theme) + ' · ' + (lv.desc || '') : '通关前一关解锁') + '</div>' +
        '<div class="level-stars">' + starHtml + '</div>';
      card.addEventListener('click', function () {
        if (!unlocked) { play('error'); F.toast('先通关前一关才能解锁', 'warn'); return; }
        play('click');
        startLevel(lv.id);
      });
      grid.appendChild(card);
    });

    var total = 0;
    App.levels.forEach(function (lv) { total += starOf(lv.id); });
    var prog = F.el('levels-progress');
    if (prog) prog.textContent = '已获得 ' + total + ' / ' + (App.levels.length * 3) + ' 颗星';
  }

  /** 攻击策略的中文名，图鉴与塔面板共用。 */
  var STRATEGY_NAMES = {
    single: '单体', splash: '溅射', chain: '连锁', beam: '持续光束',
    pierce: '穿透', poison: '中毒', crit: '暴击', homing: '追踪',
    fan: '扇形', burst: '连射', aura: '光环'
  };
  window.STRATEGY_NAMES = STRATEGY_NAMES;

  // ------------------------------------------------------------ 图鉴
  function renderCollection(tab) {
    App.collTab = tab;
    var tabs = F.el('collection-tabs');
    if (tabs) {
      Array.prototype.forEach.call(tabs.querySelectorAll('button'), function (b) {
        b.classList.toggle('active', b.dataset.tab === tab);
      });
    }
    var box = F.el('collection-content');
    if (!box) return;
    box.innerHTML = '';
    box.classList.add('collection-grid');

    if (tab === 'towers') {
      Object.keys(App.towers).forEach(function (id) {
        var t = App.towers[id];
        var card = document.createElement('div');
        card.className = 'collection-card';
        var cv = document.createElement('canvas');
        cv.width = 72; cv.height = 72;
        cv.className = 'cc-swatch';
        var ctx = cv.getContext('2d');
        ctx.translate(36, 40);
        ctx.scale(0.95, 0.95);
        if (window.Sprites && window.Sprites.drawTower) {
          try { window.Sprites.drawTower(ctx, id, 2, 0, 0, 0.8, { angle: -Math.PI / 2 }); } catch (e) {}
        }
        var lv = t.levels[2];
        var strat = STRATEGY_NAMES[lv.strategy || 'single'] || '单体';
        var body = document.createElement('div');
        body.className = 'cc-body';
        body.innerHTML =
          '<div class="cc-name">' + t.name + ' <span class="cc-tag">' + strat + '</span></div>' +
          '<div class="cc-desc">' + (t.desc || '') + '</div>' +
          '<div class="cc-meta">造价 ' + t.cost + ' · 伤害 ' + (lv.damage || lv.beamDps) +
          ' · 射程 ' + lv.range + '</div>';
        card.appendChild(cv);
        card.appendChild(body);
        box.appendChild(card);
      });
    } else {
      Object.keys(App.enemies).forEach(function (id) {
        var e = App.enemies[id];
        var card = document.createElement('div');
        card.className = 'collection-card';
        var cv = document.createElement('canvas');
        cv.width = 72; cv.height = 72;
        cv.className = 'cc-swatch';
        var ctx = cv.getContext('2d');
        ctx.translate(36, 46);
        if (window.Sprites && window.Sprites.drawEnemy) {
          try { window.Sprites.drawEnemy(ctx, id, 0, 0, 0, { hp: 1, facing: 1, size: 24 }); } catch (err) {}
        }
        var body = document.createElement('div');
        body.className = 'cc-body';
        var traits = [];
        if (e.boss) traits.push('首领');
        if (e.armor > 0) traits.push('护甲 ' + Math.round(e.armor * 100) + '%');
        if (e.shield > 0) traits.push('护盾 ' + e.shield);
        if (e.regen > 0) traits.push('回血');
        if (e.split > 0) traits.push('分裂 ×' + e.split);
        if (e.healAura) traits.push('治疗光环');
        if (e.stealth) traits.push('隐身');
        if (e.berserk) traits.push('狂暴');
        body.innerHTML =
          '<div class="cc-name">' + e.name + (e.boss ? ' <span class="cc-tag boss">首领</span>' : '') + '</div>' +
          '<div class="cc-desc">' + (e.desc || '') + '</div>' +
          '<div class="cc-meta">血量 ' + e.hp + ' · 速度 ' + e.speed +
          (traits.length ? '<br>' + traits.join(' · ') : '') + '</div>';
        card.appendChild(cv);
        card.appendChild(body);
        box.appendChild(card);
      });
    }
  }

  // ------------------------------------------------------------ 游戏
  function Game(level) {
    this.level = level;
    this.towers = App.towers;
    this.enemyDefs = App.enemies;
    this.paths = (level.paths || []).map(function (p) { return new PWLB.Path(p); });
    this.towerList = [];
    this.towerAt = {};
    this.enemies = [];
    this.projectiles = [];
    this.effects = [];
    this.obstacles = (level.obstacles || []).map(function (o, i) {
      var w = o.w || 1;
      var h = o.h || 1;
      return {
        kind: o.kind, col: o.col, row: o.row, w: w, h: h,
        hp: o.hp, maxHp: o.hp, reward: o.reward || 0, flash: 0, id: i,
        blockTower: o.blockTower !== false
      };
    });
    this.obstacleAt = {};
    var self = this;
    this.obstacles.forEach(function (o) {
      for (var dy = 0; dy < o.h; dy++) {
        for (var dx = 0; dx < o.w; dx++) {
          self.obstacleAt[(o.col + dx) + ',' + (o.row + dy)] = o;
        }
      }
    });

    this.coins = level.startCoins;
    this.carrotHp = level.carrotHp;
    this.carrotFlash = 0;
    this.carrotPos = {
      x: (level.carrot ? level.carrot[0] : level.paths[0][level.paths[0].length - 1][0]) * TILE + TILE / 2,
      y: (level.carrot ? level.carrot[1] : level.paths[0][level.paths[0].length - 1][1]) * TILE + TILE / 2
    };
    this.buildType = 'bottle';
    this.mode = 'idle';
    this.selected = null;
    this.hoverSlot = null;
    this.hoverCell = null;
    this.time = 0;
    this.speed = 1;
    this.state = 'playing';
    this.enemySeq = 1;
    this.pendingSpawns = 0;
    this.bossEnemy = null;
    this.waveBannerTimer = 0;
    this.waves = new PWLB.WaveManager(level, this);
    this.coinsEarned = 0;

    // 锁定目标：{type:'enemy'|'building', ref, at}。点击一次锁定，再点一次取消
    this.lockedTarget = null;
    this._lastLockClick = { id: null, t: 0 };

    // 场上拾取物：每波开始时随机刷 1~2 个，捡到就能用
    this.pickups = [];
    this.inventory = { bomb: 0, freeze: 0, lightning: 0 };
    this.pendingPickups = 0;
  }

  /** 在当前可建范围里随机撒一个拾取物。 */
  Game.prototype.spawnPickup = function () {
    var kinds = ['bomb', 'freeze', 'lightning'];
    var kind = kinds[Math.floor(Math.random() * kinds.length)];
    var tries = 0;
    while (tries++ < 60) {
      var c = 1 + Math.floor(Math.random() * (PWLB.COLS - 2));
      var r = 1 + Math.floor(Math.random() * (PWLB.ROWS - 2));
      if (this.blockedByPath(c, r)) continue;
      if (this.towerAt[c + ',' + r] || this.obstacleAt[c + ',' + r]) continue;
      if (this.pickups.some(function (p) { return p.col === c && p.row === r; })) continue;
      this.pickups.push({ kind: kind, col: c, row: r, x: (c + 0.5) * TILE, y: (r + 0.5) * TILE, born: this.time, life: 999 });
      return;
    }
  };

  /** 捡起拾取物。 */
  Game.prototype.collectPickup = function (p) {
    var i = this.pickups.indexOf(p);
    if (i < 0) return false;
    this.pickups.splice(i, 1);
    this.inventory[p.kind] = (this.inventory[p.kind] || 0) + 1;
    this.effects.push({ type: 'spawn', x: p.x, y: p.y, life: 0.5, maxLife: 0.5 });
    play('coin');
    F.toast('捡到' + (PWLB.PICKUP_DEFS[p.kind] || {}).name + ' ×1', 'good');
    updatePickupBar(this);
    return true;
  };

  /** 丢出特殊武器：点一下格子就用掉一个。 */
  Game.prototype.usePickupAt = function (kind, col, row) {
    if (!this.inventory[kind]) { play('error'); return false; }
    this.inventory[kind]--;
    PWLB.usePickup(this, kind, (col + 0.5) * TILE, (row + 0.5) * TILE);
    play(kind === 'bomb' ? 'explode' : kind === 'freeze' ? 'freeze' : 'chain');
    updatePickupBar(this);
    return true;
  };

  /**
   * 锁定一个目标。同一目标短时间内再次点击 = 取消锁定。
   * 返回 'locked' / 'unlocked' / 'same'
   */
  Game.prototype.toggleLock = function (type, ref) {
    var cur = this.lockedTarget;
    var same = cur && cur.type === type && cur.ref === ref;
    if (same) {
      this.lockedTarget = null;
      play('click');
      F.toast('已取消锁定', 'good');
      return 'unlocked';
    }
    this.lockedTarget = { type: type, ref: ref, at: this.time };
    play('lock');
    var name = type === 'enemy' ? (ref.def && ref.def.name || '敌人') : '建筑';
    F.toast('锁定 ' + name + '（再点一次取消）', 'good');
    return 'locked';
  };

  /** 锁定的目标是否仍有效。 */
  Game.prototype.lockAlive = function () {
    var l = this.lockedTarget;
    if (!l) return false;
    if (l.type === 'enemy') return !!(l.ref && l.ref.alive);
    return !!(l.ref && l.ref.hp > 0);
  };

  Game.prototype.affordable = function () {
    var def = this.towers[this.buildType];
    return !!(def && this.coins >= def.cost);
  };

  Game.prototype.spawnEnemy = function (typeId, pathIndex) {
    var def = this.enemyDefs[typeId];
    if (!def) {
      // 数据里引用了不存在的敌人：不崩，退化成最常见的兔子
      def = this.enemyDefs.rabbit;
      if (!def) return;
    }
    var e = new PWLB.Enemy(def, {
      id: this.enemySeq++,
      path: this.paths[pathIndex] || this.paths[0],
      pathIndex: pathIndex || 0,
      dist: -Math.random() * 20,
      hpScale: this.level.hpScale || 1
    });
    if (this.currentWave > 0) e.applyWaveScale(this.currentWave);
    this.enemies.push(e);
    if (e.boss) {
      this.bossEnemy = e;
      updateBossBar(this);
      showBossWarning(e.def.name, !!e.def.final);
    }
    return e;
  };

  /** 分裂兔死亡后裂成小怪。 */
  Game.prototype.spawnSplit = function (parent) {
    var count = parent.def.split || 0;
    for (var i = 0; i < count; i++) {
      var def = this.enemyDefs.rabbitFast || this.enemyDefs.rabbit;
      if (!def) break;
      var child = new PWLB.Enemy(def, {
        id: this.enemySeq++,
        path: parent.path,
        pathIndex: parent.pathIndex,
        dist: Math.max(0, parent.dist - 10 - i * 12),
        hpScale: 0.55
      });
      if (this.currentWave > 0) child.applyWaveScale(this.currentWave);
      this.enemies.push(child);
    }
  };

  Game.prototype.onWaveStart = function (n, total) {
    var b = F.el('wave-banner');
    if (b) {
      b.textContent = n === total ? '最后一波 · 第 ' + n + ' 波' : '第 ' + n + ' 波 / 共 ' + total + ' 波';
      b.classList.remove('hidden');
      b.classList.remove('pop');
      void b.offsetWidth;
      b.classList.add('pop');
      clearTimeout(b.__t);
      b.__t = setTimeout(function () { b.classList.add('hidden'); }, 1800);
    }
    play(n === total ? 'boss' : 'wave');
    // v2：道具改为金币购买，不再掉落
    updatePickupBar(this);
    updateHud(this);
  };

  Game.prototype.onEnemyKilled = function (e) {
    this.kills = (this.kills || 0) + 1;
    this.coins += e.reward;
    this.coinsEarned += e.reward;
    this.effects.push({ type: 'coin', x: e.x, y: e.y - 10, value: e.reward, life: 0.9, maxLife: 0.9 });
    play(e.boss ? 'boss' : 'die');
    if (e === this.bossEnemy) { this.bossEnemy = null; updateBossBar(this); }
    updateHud(this);
  };

  Game.prototype.onEnemyLeaked = function (e) {
    var dmg = e.boss ? 3 : 1;
    this.carrotHp = Math.max(0, this.carrotHp - dmg);
    this.carrotFlash = 1;
    this.effects.push({ type: 'leak', x: this.carrotPos.x, y: this.carrotPos.y, life: 0.6, maxLife: 0.6 });
    play('error');
    if (e === this.bossEnemy) { this.bossEnemy = null; updateBossBar(this); }
    updateHud(this);
    if (this.carrotHp <= 0) this.lose();
  };

  Game.prototype.onAllWavesCleared = function () {
    this.win();
  };

  Game.prototype.win = function () {
    if (this.state !== 'playing') return;
    this.state = 'won';
    play('win');
    finishLevel(this, true);
  };

  Game.prototype.lose = function () {
    if (this.state !== 'playing') return;
    this.state = 'lost';
    play('lose');
    finishLevel(this, false);
  };

  Game.prototype.rebuildIndex = function () {
    this.towerAt = {};
    for (var i = 0; i < this.towerList.length; i++) {
      this.towerAt[this.towerList[i].col + ',' + this.towerList[i].row] = this.towerList[i];
    }
  };

  /** 这一格是否被怪物道路压过（路上不能建塔）。 */
  Game.prototype.blockedByPath = function (col, row) {
    for (var i = 0; i < this.paths.length; i++) {
      if (this.paths[i].cellSet[col + ',' + row]) return true;
    }
    return false;
  };

  /**
   * 建塔合法性。原版是「草地随便建」，只有路、已有塔、障碍三种情况不能建。
   * 返回 ok / outside / path / occupied / blocked
   */
  Game.prototype.canPlace = function (col, row) {
    if (col < 0 || col >= PWLB.COLS || row < 0 || row >= PWLB.ROWS) return 'outside';
    var key = col + ',' + row;
    if (this.towerAt[key]) return 'occupied';
    if (this.obstacleAt[key]) return 'blocked';
    if (this.blockedByPath(col, row)) return 'path';
    return 'ok';
  };

  /** 可建塔的格子总数（用于 HUD 提示，随建塔变化）。 */
  Game.prototype.openSpots = function () {
    var n = 0;
    for (var r = 0; r < PWLB.ROWS; r++) {
      for (var c = 0; c < PWLB.COLS; c++) {
        if (this.canPlace(c, r) === 'ok') n++;
      }
    }
    return n;
  };

  Game.prototype.placeTower = function (col, row, typeId) {
    var def = this.towers[typeId];
    if (!def) return false;
    var why = this.canPlace(col, row);
    if (why !== 'ok') { play('error'); return false; }
    if (this.coins < def.cost) { play('error'); F.toast('萝卜币不够啦', 'warn'); return false; }
    this.coins -= def.cost;
    var t = new PWLB.Tower(def, 1, col, row);
    this.towerList.push(t);
    this.towerAt[col + ',' + row] = t;
    t.spawnT = 1;
    play('build');
    this.effects.push({ type: 'spawn', x: t.cx, y: t.cy, life: 0.4, maxLife: 0.4, hue: 140 });
    updateHud(this);
    return t;
  };

  /** 把建筑从地图上清掉（含它占的所有格子）。 */
  Game.prototype.clearObstacle = function (o) {
    for (var dy = 0; dy < o.h; dy++) {
      for (var dx = 0; dx < o.w; dx++) {
        delete this.obstacleAt[(o.col + dx) + ',' + (o.row + dy)];
      }
    }
    var i = this.obstacles.indexOf(o);
    if (i >= 0) this.obstacles.splice(i, 1);
  };

  /**
   * 弹丸命中点对建筑造成伤害。建筑和怪物一样要挨打才会掉血。
   * 判定：把命中点扩成 radius 的圆，与建筑矩形求最近距离。
   */
  Game.prototype.damageBuildings = function (x, y, amount, splash) {
    if (!amount || amount <= 0) return;
    var radius = Math.max(26, splash || 26);
    var r2 = radius * radius;
    var list = this.obstacles.slice();
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || o.hp <= 0) continue;
      // 建筑矩形（像素）
      var left = o.col * TILE;
      var top = o.row * TILE;
      var right = left + o.w * TILE;
      var bottom = top + o.h * TILE;
      // 命中点到矩形的最近点
      var nx = Math.max(left, Math.min(x, right));
      var ny = Math.max(top, Math.min(y, bottom));
      var dx = x - nx;
      var dy = y - ny;
      if (dx * dx + dy * dy > r2) continue;
      o.hp -= amount;
      o.flash = 1;
      if (o.hp <= 0) this.destroyBuilding(o);
    }
  };

  /** 建筑被打碎：掉金币 + 爆炸特效。 */
  Game.prototype.destroyBuilding = function (o) {
    var cx = (o.col + o.w / 2) * TILE;
    var cy = (o.row + o.h / 2) * TILE;
    this.clearObstacle(o);
    this.coins += o.reward;
    this.coinsEarned += o.reward;
    this.effects.push({ type: 'coin', x: cx, y: cy, value: o.reward, life: 1.1, maxLife: 1.1 });
    this.effects.push({ type: 'explosion', x: cx, y: cy, r: Math.max(40, o.w * 30), life: 0.5, maxLife: 0.5, hue: 40 });
    play('coin');
    updateHud(this);
  };

  /** 障碍物拆除价格：按血量折算，最低 20。 */
  Game.prototype.obstacleCost = function (o) {
    if (!o) return 0;
    return Math.max(25, Math.round((o.maxHp || o.hp) * 0.18));
  };

  /** 花钱拆掉障碍，腾出格子。 */
  Game.prototype.removeObstacle = function (o) {
    if (!o || o.hp <= 0) return false;
    var cost = this.obstacleCost(o);
    if (this.coins < cost) {
      play('error');
      F.toast('金币不足，拆除需要 ' + cost, 'warn');
      return false;
    }
    this.coins -= cost;
    o.hp = 0;
    this.clearObstacle(o);
    this.effects.push({
      type: 'explosion',
      x: (o.col + o.w / 2) * TILE, y: (o.row + o.h / 2) * TILE,
      r: Math.max(46, o.w * 32), life: 0.45, maxLife: 0.45, hue: 35
    });
    play('sell');
    F.toast('障碍已拆除 -' + cost, 'good');
    updateHud(this);
    return true;
  };

  Game.prototype.upgradeTower = function (t) {
    if (!t) return;
    var cost = t.upgradeCost();
    if (cost === null) { F.toast('已经满级了', 'warn'); return; }
    if (this.coins < cost) { play('error'); F.toast('萝卜币不够啦', 'warn'); return; }
    this.coins -= cost;
    t.level++;
    play('upgrade');
    updateHud(this);
    openInspector(this, t);
  };

  Game.prototype.sellTower = function (t) {
    if (!t) return;
    var value = t.sellValue();
    this.coins += value;
    var i = this.towerList.indexOf(t);
    if (i >= 0) this.towerList.splice(i, 1);
    delete this.towerAt[t.col + ',' + t.row];
    if (this.selected === t) this.selected = null;
    this.effects.push({ type: 'coin', x: t.cx, y: t.cy - 6, value: value, life: 1, maxLife: 1 });
    closeInspector();
    play('sell');
    F.toast('卖出 +' + value, 'good');
    updateHud(this);
  };

  Game.prototype.update = function (dt) {
    if (this.state !== 'playing') return;
    this.time += dt;
    if (this.carrotFlash > 0) this.carrotFlash = Math.max(0, this.carrotFlash - dt * 2);

    this.waves.update(dt);

    var i;
    for (i = 0; i < this.enemies.length; i++) this.enemies[i].update(dt, this);
    for (i = 0; i < this.towerList.length; i++) this.towerList[i].update(dt, this);
    for (i = 0; i < this.projectiles.length; i++) this.projectiles[i].update(dt, this);
    for (i = 0; i < this.obstacles.length; i++) {
      if (this.obstacles[i].flash > 0) this.obstacles[i].flash = Math.max(0, this.obstacles[i].flash - dt * 4);
    }
    for (i = 0; i < this.effects.length; i++) this.effects[i].life -= dt;

    // 锁定的目标没了就自动解锁
    if (this.lockedTarget && !this.lockAlive()) {
      this.lockedTarget = null;
    }

    // 安全上限：极端情况下不让实体无限堆积，保证任何情况都不卡死
    if (this.enemies.length > 320) this.enemies.length = 320;
    if (this.projectiles.length > 700) this.projectiles.length = 700;
    if (this.effects.length > 260) this.effects.splice(0, this.effects.length - 260);

    // 清理
    this.obstacles = this.obstacles.filter(function (o) { return o.hp > 0; });
    this.enemies = this.enemies.filter(function (e) { return e.alive; });
    this.projectiles = this.projectiles.filter(function (p) { return p.alive; });
    this.effects = this.effects.filter(function (f) { return f.life > 0; });

    if (this.coins !== this._lastCoins) {
      this._lastCoins = this.coins;
      updateHud(this);
      updatePickupBar(this);
    }
    updateWaveTimer(this);
    updateBossBar(this);
  };

  // ------------------------------------------------------------ HUD
  var hudCache = {};

  function setText(id, value) {
    if (hudCache[id] === value) return;
    hudCache[id] = value;
    var el = F.el(id);
    if (el) el.textContent = value;
  }

  function updateHud(game) {
    game = game || App.game;
    if (!game) return;
    setText('hud-coins', String(game.coins));
    var hpEl = F.el('hud-carrot');
    var maxHp = game.level.carrotHp || 1;
    var hpText = game.carrotHp + ' / ' + maxHp;
    if (hpEl && hpEl.textContent !== hpText) {
      hpEl.textContent = hpText;
      if (game._lastHp !== undefined && game.carrotHp < game._lastHp) {
        hpEl.classList.remove('shake');
        void hpEl.offsetWidth;
        hpEl.classList.add('shake');
      }
      var bar = F.el('hud-carrot-bar');
      if (bar) {
        var ratio = Math.max(0, game.carrotHp / maxHp);
        bar.style.width = (ratio * 100) + '%';
        bar.classList.toggle('low', ratio <= 0.34);
      }
      game._lastHp = game.carrotHp;
    }
    setText('hud-open-spots', String(game.openSpots()));
    var waveEl = F.el('hud-wave');
    if (waveEl) {
      var n = Math.max(1, game.waves.index + 1);
      var txt = n + ' / ' + game.waves.waves.length;
      if (waveEl.textContent !== txt) waveEl.textContent = txt;
      // 最后一波给个醒目标记
      waveEl.classList.toggle('final-wave', !game.waves.finished && game.waves.index === game.waves.waves.length - 1);
    }
    var shop = F.el('tower-shop');
    if (shop) {
      Array.prototype.forEach.call(shop.querySelectorAll('.shop-card'), function (c) {
        var def = game.towers[c.dataset.tower];
        if (!def) return;
        c.classList.toggle('unaffordable', game.coins < def.cost);
        c.classList.toggle('selected', game.mode === 'build' && game.buildType === c.dataset.tower);
      });
    }
    var hint = F.el('build-hint');
    if (hint) {
      if (game.mode === 'build') {
        var bd = game.towers[game.buildType];
        hint.classList.remove('hidden');
        hint.innerHTML = '点草地连续建造 <b>' + (bd ? bd.name : '') + '</b> · 右键或 Esc 退出';
      } else {
        hint.classList.add('hidden');
      }
    }
  }

  function updateWaveTimer(game) {
    var el = F.el('hud-wave-timer');
    if (!el) return;
    var wm = game.waves;
    var nextEl = F.el('next-wave-preview');
    if (nextEl) {
      var preview = game.waves.waves[Math.max(0, wm.active ? wm.index : wm.index + 1)];
      if (!preview) {
        nextEl.textContent = '';
      } else {
        var counts = {};
        preview.groups.forEach(function (gr) { counts[gr.enemy] = (counts[gr.enemy] || 0) + gr.count; });
        var parts = Object.keys(counts).map(function (k) {
          var d = game.enemyDefs[k] || { name: k };
          return d.name + '×' + counts[k];
        });
        nextEl.textContent = '下一波：' + parts.join('  ');
      }
    }
    if (wm.finished) { el.textContent = '全部清空'; return; }
    if (wm.active) {
      var left = 0;
      for (var i = 0; i < wm.spawners.length; i++) left += wm.spawners[i].left;
      el.textContent = '本波剩余 ' + left;
    } else {
      el.textContent = '下一波 ' + Math.ceil(wm.timer) + 's';
    }
  }

  /** 道具价格（金币）。v2：道具靠买，不打掉。 */
  var ITEM_PRICES = { bomb: 120, freeze: 90, lightning: 150 };
  var ITEM_NAMES = { bomb: '炸弹', freeze: '冰冻', lightning: '闪电' };
  var ITEM_COLORS = { bomb: '#ff7043', freeze: '#4fc3f7', lightning: '#ffd93d' };

  /** 底部的道具商店：有钱就买，买了点按钮进入投放模式。 */
  function updatePickupBar(game) {
    var bar = F.el('item-bar');
    if (!bar) return;
    var html = '';
    ['bomb', 'freeze', 'lightning'].forEach(function (kind) {
      var n = game.inventory[kind] || 0;
      var price = ITEM_PRICES[kind];
      var canBuy = game.coins >= price;
      html += '<button type="button" class="item-btn' + (canBuy || n ? '' : ' empty') +
        (game.mode === 'item' && game.itemKind === kind ? ' selected' : '') +
        '" data-item="' + kind + '" style="--item-color:' + ITEM_COLORS[kind] + '">' +
        '<span class="item-dot"></span>' + ITEM_NAMES[kind] +
        '<span class="item-price">' + price + '</span>' +
        '<span class="item-count">' + n + '</span></button>';
    });
    bar.innerHTML = html;
    Array.prototype.forEach.call(bar.querySelectorAll('.item-btn'), function (btn) {
      btn.addEventListener('click', function () {
        var g = App.game;
        if (!g || g.state !== 'playing') return;
        var kind = btn.dataset.item;
        // 没库存先买一个
        if (!g.inventory[kind]) {
          var price = ITEM_PRICES[kind];
          if (g.coins < price) { play('error'); F.toast('金币不足，' + ITEM_NAMES[kind] + '需要 ' + price, 'warn'); return; }
          g.coins -= price;
          g.inventory[kind] = 1;
          play('coin');
          F.toast('购买 ' + ITEM_NAMES[kind] + ' -' + price, 'good');
        }
        if (g.mode === 'item' && g.itemKind === kind) {
          g.mode = 'build';
          g.itemKind = null;
        } else {
          g.mode = 'item';
          g.itemKind = kind;
          closeInspector();
        }
        play('click');
        updateHud(g);
        updatePickupBar(g);
      });
    });
  }

  function showBossWarning(name, isFinal) {
    var w = F.el('boss-warning');
    if (!w) return;
    w.textContent = (isFinal ? '最终 Boss 降临 · ' : 'BOSS 来袭 · ') + name;
    w.classList.remove('hidden');
    w.classList.remove('pop');
    void w.offsetWidth;
    w.classList.add('pop');
    clearTimeout(w.__t);
    w.__t = setTimeout(function () { w.classList.add('hidden'); }, 2600);
    play('boss');
  }

  function updateBossBar(game) {
    var bar = F.el('boss-bar');
    if (!bar) return;
    var boss = game.bossEnemy;
    if (!boss || !boss.alive) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    bar.style.overflow = 'visible';
    if (getComputedStyle(bar).position === 'static') bar.style.position = 'relative';
    bar.classList.toggle('final', !!(boss.def && boss.def.final));
    var fill = F.el('boss-bar-fill');
    if (fill) fill.style.width = Math.max(0, (boss.hp / boss.maxHp) * 100) + '%';
    var nm = F.el('boss-bar-name');
    if (nm && nm.textContent !== boss.def.name) nm.textContent = boss.def.name;
    // 血量数字：让"超长血条"看得见。样式在这里强制写死，避免被页面皮肤覆盖。
    var hpEl = F.el('boss-bar-hp');
    var hpTxt = Math.max(0, Math.ceil(boss.hp)).toLocaleString('en-US') + ' / ' + boss.maxHp.toLocaleString('en-US');
    if (hpEl) {
      if (hpEl.textContent !== hpTxt) hpEl.textContent = hpTxt;
      if (!hpEl.__styled) {
        hpEl.__styled = true;
        hpEl.style.cssText = 'position:absolute;right:16px;top:-26px;z-index:6;padding:2px 10px;' +
          'border-radius:9px;background:rgba(18,10,8,.85);color:#ffe6a8;font-size:12px;' +
          'font-weight:900;letter-spacing:.05em;line-height:1.7;font-variant-numeric:tabular-nums;' +
          'white-space:nowrap;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.4)';
      }
    }
    // 血量过半后进入狂暴阶段（视觉提示）
    var phase2 = boss.hp / boss.maxHp <= 0.5;
    bar.classList.toggle('phase2', phase2);
  }

  // ------------------------------------------------------------ 商店
  var shopTab = 'tower';

  function buildShop() {
    var shop = F.el('tower-shop');
    if (!shop) return;
    shop.innerHTML = '';
    shop.classList.toggle('tab-item', shopTab === 'item');
    if (shopTab === 'item') {
      buildItemShop(shop);
      return;
    }
    Object.keys(App.towers).forEach(function (id) {
      var def = App.towers[id];
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'shop-card';
      card.dataset.tower = id;
      var cv = document.createElement('canvas');
      cv.width = 44; cv.height = 44;
      cv.className = 'sc-icon';
      var ctx = cv.getContext('2d');
      ctx.translate(22, 24);
      ctx.scale(0.62, 0.62);
      if (window.Sprites && window.Sprites.drawTower) {
        try { window.Sprites.drawTower(ctx, id, 1, 0, 0, 0.4, { angle: -Math.PI / 2 }); } catch (e) {}
      }
      var label = document.createElement('div');
      label.className = 'sc-name';
      label.textContent = def.name;
      var price = document.createElement('div');
      price.className = 'sc-cost';
      price.textContent = def.cost;
      var tag = document.createElement('div');
      tag.className = 'sc-tag';
      tag.textContent = STRATEGY_NAMES[(def.levels[0] || {}).strategy || 'single'] || '';
      card.appendChild(tag);
      card.appendChild(cv);
      card.appendChild(label);
      card.appendChild(price);
      card.title = def.name + '：' + def.desc;
      card.addEventListener('click', function () {
        if (!App.game || App.game.state !== 'playing') return;
        var g = App.game;
        var same = g.mode === 'build' && g.buildType === id;
        g.buildType = id;
        g.mode = same ? 'idle' : 'build';
        g.selected = null;
        g.hoverSlot = null;
        closeInspector();
        play('click');
        updateHud(g);
      });
      shop.appendChild(card);
    });
  }

  /** 页面缺少商店分页时，注一个出来（UI 与逻辑解耦，任一缺失都不影响玩）。 */
  function ensureShopTabs() {
    if (F.el('shop-tabs')) return;
    var shop = F.el('tower-shop');
    if (!shop || !shop.parentNode) return;
    var tabs = document.createElement('div');
    tabs.id = 'shop-tabs';
    tabs.className = 'shop-tabs';
    tabs.innerHTML = '<button type="button" class="active" data-tab="tower">炮塔</button>' +
      '<button type="button" data-tab="item">道具</button>';
    shop.parentNode.insertBefore(tabs, shop);
  }

  /** 页面缺少 Boss 警告时补一个。 */
  /** 页面缺少 Boss 血量数字时补一个。 */
  function ensureBossHp() {
    if (F.el('boss-bar-hp')) return;
    var bar = F.el('boss-bar');
    if (!bar) return;
    var hp = document.createElement('div');
    hp.id = 'boss-bar-hp';
    hp.className = 'boss-hp';
    // 内联样式：不依赖外部 CSS 的层叠顺序，任何皮肤下都能正确显示
    hp.style.cssText = [
      'position:absolute', 'right:18px', 'top:-24px', 'z-index:6',
      'padding:1px 9px', 'border-radius:8px',
      'background:rgba(20,12,10,.82)', 'color:#ffe6a8',
      'font-size:12px', 'font-weight:900', 'letter-spacing:.04em',
      'line-height:1.6', 'font-variant-numeric:tabular-nums',
      'white-space:nowrap', 'pointer-events:none',
      'box-shadow:0 2px 6px rgba(0,0,0,.35)'
    ].join(';');
    bar.appendChild(hp);
  }

  function ensureBossWarning() {
    if (F.el('boss-warning')) return;
    var stage = F.el('game-stage');
    if (!stage) return;
    var w = document.createElement('div');
    w.id = 'boss-warning';
    w.className = 'boss-warning hidden';
    stage.appendChild(w);
  }

  /** 页面缺少下一波预告时补一个。 */
  function ensureNextWavePreview() {
    if (F.el('next-wave-preview')) return;
    var hud = F.el('hud');
    if (!hud) return;
    var p = document.createElement('div');
    p.id = 'next-wave-preview';
    p.className = 'next-wave-preview';
    hud.appendChild(p);
  }

  /** 商店切到「道具」页时，用卡片形式卖道具。 */
  function buildItemShop(shop) {
    Object.keys(ITEM_PRICES).forEach(function (kind) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'shop-card item-card';
      card.dataset.item = kind;
      card.style.setProperty('--item-color', ITEM_COLORS[kind]);
      var icon = document.createElement('div');
      icon.className = 'sc-icon item-icon';
      icon.style.background = ITEM_COLORS[kind];
      icon.textContent = kind === 'bomb' ? '炸' : kind === 'freeze' ? '冰' : '电';
      var name = document.createElement('div');
      name.className = 'sc-name';
      name.textContent = ITEM_NAMES[kind];
      var cost = document.createElement('div');
      cost.className = 'sc-cost';
      cost.textContent = ITEM_PRICES[kind];
      card.appendChild(icon);
      card.appendChild(name);
      card.appendChild(cost);
      card.addEventListener('click', function () {
        var g = App.game;
        if (!g || g.state !== 'playing') return;
        var price = ITEM_PRICES[kind];
        if (g.coins < price) { play('error'); F.toast('金币不足', 'warn'); return; }
        g.coins -= price;
        g.inventory[kind] = (g.inventory[kind] || 0) + 1;
        g.mode = 'item';
        g.itemKind = kind;
        closeInspector();
        play('coin');
        updateHud(g);
        updatePickupBar(g);
      });
      shop.appendChild(card);
    });
  }

  // ------------------------------------------------------------ 锚定浮层
  /**
   * 把浮层摆到某个格子旁边（优先右下，放不下就翻到左上），
   * 保证始终贴着你点的那一格，不会跑到屏幕另一边。
   */
  function anchorPopup(box, col, row) {
    if (!box) return;
    var stage = F.el('game-stage');
    if (!stage) return;
    var sr = stage.getBoundingClientRect();
    var cr = canvas.getBoundingClientRect();
    var scale = cr.width / W;
    var cx = cr.left - sr.left + (col + 0.5) * TILE * scale;
    var cy = cr.top - sr.top + (row + 0.5) * TILE * scale;
    var half = TILE * scale * 0.5;

    box.style.visibility = 'hidden';
    box.classList.remove('hidden');
    var bw = box.offsetWidth || 200;
    var bh = box.offsetHeight || 120;

    // 贴着格子的右下角弹出，留 2px 缝隙；右边放不下就翻到左边
    var gap = 2;
    var x = cx + half + gap;
    var y = cy + half + gap - bh * 0.35;
    if (x + bw > sr.width - 4) x = cx - half - gap - bw;
    if (x < 4) x = Math.max(4, Math.min(sr.width - bw - 4, cx - bw / 2));
    if (y + bh > sr.height - 4) y = Math.max(4, sr.height - bh - 4);
    if (y < 4) y = 4;

    box.style.left = Math.round(x) + 'px';
    box.style.top = Math.round(y) + 'px';
    box.style.right = 'auto';
    box.style.visibility = '';
  }

  /** 有塔：贴着塔显示升级 / 卖出。 */
  function openInspector(game, t) {
    var box = F.el('tower-inspect');
    if (!box) return;
    var st = t.stat();
    var upCost = t.upgradeCost();
    var dmgText = t.id === 'sun' ? ('每秒 ' + st.beamDps + ' 点灼烧') : ('每发 ' + st.damage);
    box.innerHTML =
      '<div class="inspect-head"><span class="inspect-name">' + t.def.name +
      '</span><span class="inspect-level">Lv.' + t.level + '</span></div>' +
      '<p class="inspect-strategy">' + (STRATEGY_NAMES[st.strategy || 'single'] || '单体') + '型</p>' +
      '<ul class="inspect-stats">' +
      '<li><span>伤害</span><b>' + dmgText + '</b></li>' +
      '<li><span>射程</span><b>' + st.range + '</b></li>' +
      '<li><span>冷却</span><b>' + (st.cooldown || 0) + 's</b></li>' +
      (st.splash ? '<li><span>溅射</span><b>' + st.splash + '</b></li>' : '') +
      (st.slowPct ? '<li><span>减速</span><b>' + Math.round(st.slowPct * 100) + '% / ' + st.slowDur + 's</b></li>' : '') +
      (st.chain ? '<li><span>连锁</span><b>' + st.chain + ' 个</b></li>' : '') +
      '</ul>' +
      '<div class="inspect-actions">' +
      (upCost !== null ? '<button type="button" class="btn primary" data-act="up">升级 ' + upCost + '🪙</button>'
        : '<button type="button" class="btn" disabled>已满级</button>') +
      '<button type="button" class="btn danger" data-act="sell">拆塔 +' + t.sellValue() + '</button>' +
      '</div>';
    anchorPopup(box, t.col, t.row);
    var up = box.querySelector('[data-act="up"]');
    if (up) up.addEventListener('click', function (ev) { ev.stopPropagation(); game.upgradeTower(t); });
    var sell = box.querySelector('[data-act="sell"]');
    if (sell) sell.addEventListener('click', function (ev) { ev.stopPropagation(); game.sellTower(t); });
    box.classList.add('pop');
    App.popup = 'tower';
  }

  /** 建筑：只能靠炮台打。点击即锁定，射程内的炮塔会集中火力。 */
  function openObstacleMenu(game, o, locked) {
    var box = F.el('tower-inspect');
    if (!box) return;
    var names = { rock: '石头', mushroom: '蘑菇', crate: '木箱', crystal: '水晶', tree: '大树', house: '房子', fence: '栅栏', tower_rubble: '废墟' };
    var inRange = 0;
    for (var i = 0; i < game.towerList.length; i++) {
      var t = game.towerList[i];
      var cx = (o.col + o.w / 2) * TILE;
      var cy = (o.row + o.h / 2) * TILE;
      var r = t.range() + Math.max(o.w, o.h) * TILE * 0.5;
      if (PWLB.util.dist2(cx, cy, t.cx, t.cy) <= r * r) inRange++;
    }
    box.innerHTML =
      '<div class="inspect-head"><span class="inspect-name">' + (names[o.kind] || '建筑') +
      '</span><span class="inspect-level">' + (locked ? '已锁定' : '挡住路') + '</span></div>' +
      '<ul class="inspect-stats">' +
      '<li><span>剩余血量</span><b>' + Math.max(0, Math.ceil(o.hp)) + '</b></li>' +
      '<li><span>射程内炮塔</span><b>' + inRange + ' 座</b></li>' +
      '</ul>' +
      '<p class="inspect-hint">' +
      (inRange > 0
        ? '射程内的炮塔会集中打它。再点它一次取消锁定。'
        : '附近没有炮塔能打到它，先造一座炮塔。') +
      '</p>';
    anchorPopup(box, o.col, o.row);
    App.popup = 'obstacle';
  }

  function closeInspector() {
    var box = F.el('tower-inspect');
    if (box) box.classList.add('hidden');
    App.popup = null;
  }

  /** 与 closeInspector 同义，供锁定路径使用（语义更清楚）。 */
  function hideInspector() { closeInspector(); }

  // ------------------------------------------------------------ 输入
  var canvas = null;
  var ctx = null;

  function canvasCoords(ev) {
    var rect = canvas.getBoundingClientRect();
    var x = (ev.clientX - rect.left) * (W / rect.width);
    var y = (ev.clientY - rect.top) * (H / rect.height);
    return { x: x, y: y };
  }

  function cellOf(x, y) {
    return { col: Math.floor(x / TILE), row: Math.floor(y / TILE) };
  }

  function onMove(ev) {
    var g = App.game;
    if (!g || g.state !== 'playing') return;
    var p = canvasCoords(ev);
    var c = cellOf(p.x, p.y);
    g.hoverCell = c;
    // 建塔模式下，任何可建格都高亮（不再是稀疏的预设点）
    if (g.mode === 'build' && g.canPlace(c.col, c.row) === 'ok') g.hoverSlot = [c.col, c.row];
    else g.hoverSlot = null;
  }

  /** 点到的敌人（按圆形判定，取最上层）。 */
  function enemyAt(game, x, y) {
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < game.enemies.length; i++) {
      var e = game.enemies[i];
      if (!e.alive) continue;
      var r = (e.radius || 16) + 8;
      var d = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y);
      if (d <= r * r && d < bestDist) { bestDist = d; best = e; }
    }
    return best;
  }

  function onClick(ev) {
    var g = App.game;
    if (!g || g.state !== 'playing' || App.paused) return;
    var p = canvasCoords(ev);
    var c = cellOf(p.x, p.y);
    var key = c.col + ',' + c.row;

    // 0) 点到敌人：锁定 / 取消锁定
    var hitEnemy = enemyAt(g, p.x, p.y);
    if (hitEnemy) {
      var res = g.toggleLock('enemy', hitEnemy);
      if (res === 'locked') hideInspector();
      updateHud(g);
      return;
    }

    // 1) 已有塔 → 贴着它弹升级/拆除
    var hitTower = g.towerAt[key];
    if (hitTower) {
      g.selected = hitTower;
      g.mode = 'idle';
      openInspector(g, hitTower);
      play('click');
      return;
    }

    // 2) 建筑 → 锁定 / 取消锁定（拆只能靠炮台打）
    var obs = g.obstacleAt[key];
    if (obs) {
      var obsRes = g.toggleLock('building', obs);
      if (obsRes === 'locked') {
        // 面板只作说明，真正的攻击交给炮台
        openObstacleMenu(g, obs, true);
      } else {
        hideInspector();
      }
      updateHud(g);
      return;
    }

    // 3) 场上的拾取物：走上去点一下就收进背包
    for (var pi = 0; pi < g.pickups.length; pi++) {
      var pk = g.pickups[pi];
      if (pk.col === c.col && pk.row === c.row) {
        g.collectPickup(pk);
        return;
      }
    }

    // 4) 手里举着特殊武器 → 点哪里扔哪里
    if (g.mode === 'item' && g.itemKind) {
      if (g.usePickupAt(g.itemKind, c.col, c.row)) {
        if (!g.inventory[g.itemKind]) { g.mode = 'build'; g.itemKind = null; }
        updateHud(g);
      }
      return;
    }

    // 5) 建塔模式 → 落塔并保持模式，可以连着种一排
    if (g.mode === 'build') {
      var why = g.canPlace(c.col, c.row);
      if (why === 'ok') {
        var res = g.placeTower(c.col, c.row, g.buildType);
        if (res) {
          g.selected = null;
          closeInspector();
          g.hoverSlot = null;
          updateHud(g);
        }
        return;
      }
      if (why === 'path') { play('error'); F.toast('道路上不能建塔', 'warn'); }
      else if (why === 'outside') { /* 点到画布外，忽略 */ }
      return;
    }

    // 4) 空白处 → 取消选中
    g.selected = null;
    closeInspector();
    play('click');
  }

  // ------------------------------------------------------------ 结算
  var THEME_BG = {
    forest: 'linear-gradient(160deg,#2d5a3d,#173225)',
    desert: 'linear-gradient(160deg,#7a5c2e,#3a2a13)',
    snow: 'linear-gradient(160deg,#3d5e7a,#1b2c3d)',
    candy: 'linear-gradient(160deg,#7a3d6b,#3b1b33)',
    volcano: 'linear-gradient(160deg,#7a2d2d,#331414)',
    sky: 'linear-gradient(160deg,#3d5a8a,#1a2440)'
  };

  function finishLevel(game, won) {
    App.paused = true;
    var level = game.level;
    var stars = 0;
    if (won) {
      var th = level.starHp || [level.carrotHp, level.carrotHp * 0.7, 1];
      if (game.carrotHp >= th[0]) stars = 3;
      else if (game.carrotHp >= th[1]) stars = 2;
      else stars = 1;
    }
    var elapsed = game.time;
    var results = {
      level: level.id,
      name: level.name,
      won: won,
      stars: stars,
      coins: game.coinsEarned,
      time: elapsed,
      carrotHp: game.carrotHp,
      maxHp: level.carrotHp,
      kills: game.kills || 0,
      waves: (game.waves.index + 1) || 0,
      totalWaves: game.waves.waves.length,
      towersBuilt: game.towerList.length
    };
    App.lastResults = results;

    if (won) {
      var prof = App.profile;
      prof.coins += stars * 30 + 20;
      var prev = prof.stars[level.id] || 0;
      if (stars > prev) prof.stars[level.id] = stars;
      prof.levels[level.id] = prof.levels[level.id] || {};
      var best = prof.levels[level.id];
      best.bestStars = Math.max(best.bestStars || 0, stars);
      best.bestTime = best.bestTime ? Math.min(best.bestTime, elapsed) : elapsed;
      best.bestCoins = Math.max(best.bestCoins || 0, game.coinsEarned);
      best.plays = (best.plays || 0) + 1;

      var idx = App.levels.findIndex(function (l) { return l.id === level.id; });
      if (idx >= 0 && idx + 1 < App.levels.length) {
        var nextId = App.levels[idx + 1].id;
        if (prof.unlocked.indexOf(nextId) < 0) prof.unlocked.push(nextId);
      }
      saveProfile();
      postScore({ level: level.id, stars: stars, time: elapsed, coins: game.coinsEarned });
    }

    setTimeout(function () { showResult(results); }, 650);
  }

  /** 结算面板缺击杀/波次槽位时补上（保持 UI 结构解耦）。 */
  function ensureResultSlots() {
    var dl = document.querySelector('#modal-result .result-stats');
    if (!dl || F.el('result-kills')) return;
    var mk = function (id, label) {
      var box = document.createElement('div');
      var dt = document.createElement('dt');
      dt.textContent = label;
      var dd = document.createElement('dd');
      dd.id = id;
      dd.textContent = '0';
      box.appendChild(dt);
      box.appendChild(dd);
      return box;
    };
    dl.appendChild(mk('result-kills', '击杀'));
    dl.appendChild(mk('result-waves', '波次'));
  }

  function showResult(r) {
    var modal = F.el('modal-result');
    if (!modal) return;
    ensureResultSlots();
    var title = F.el('result-title');
    if (title) title.textContent = r.won ? '守住啦！' : '萝卜被啃光了…';
    var sub = document.querySelector('#modal-result .modal-sub');
    if (sub) sub.textContent = r.won
      ? ('萝卜剩 ' + r.carrotHp + ' / ' + r.maxHp + ' 点血')
      : ('只撑到第 ' + Math.max(1, r.carrotHp) + ' 波就失守了');
    var starBox = F.el('result-stars');
    if (starBox) {
      starBox.innerHTML = '';
      for (var i = 0; i < 3; i++) {
        var s = document.createElement('span');
        if (i < r.stars) s.className = 'on';
        s.textContent = '★';
        starBox.appendChild(s);
      }
    }
    var coinsEl = F.el('result-coins');
    if (coinsEl) coinsEl.textContent = '+' + r.coins;
    var timeEl = F.el('result-time');
    if (timeEl) timeEl.textContent = F.time(r.time);
    // 击杀 / 波次：页面有这两个槽位就填，没有就用副标题兜底显示
    var killEl = F.el('result-kills');
    if (killEl) killEl.textContent = String(r.kills || 0);
    var waveEl = F.el('result-waves');
    if (waveEl) waveEl.textContent = (r.waves || 0) + ' / ' + (r.totalWaves || 0);
    if (!killEl && sub) {
      sub.textContent += ' · 击杀 ' + (r.kills || 0) + ' 只';
    }
    var next = F.el('btn-result-next');
    if (next) {
      var idx = App.levels.findIndex(function (l) { return l.id === r.level; });
      var hasNext = r.won && idx >= 0 && idx + 1 < App.levels.length;
      next.classList.toggle('hidden', !hasNext);
      next.dataset.next = hasNext ? App.levels[idx + 1].id : '';
    }
    modal.classList.remove('hidden');
  }

  // ------------------------------------------------------------ 关卡启动
  function startLevel(id) {
    var level = App.levels.find(function (l) { return l.id === id; });
    if (!level) return;
    closeAllModals();
    App.paused = false;
    var stage = F.el('game-stage');
    if (stage) stage.style.setProperty('--theme-bg', THEME_BG[level.theme] || THEME_BG.forest);

    if (!canvas) canvas = F.el('game-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    canvas.width = W;
    canvas.height = H;

    var g = new Game(level);
    App.game = g;
    PWLB.Render.backgroundCache = null;
    PWLB.Render.backgroundKey = '';
    App.speed = 1;
    var spd = F.el('btn-speed');
    if (spd) spd.textContent = '1×';
    var lvTitle = F.el('hud-level-name');
    if (lvTitle) lvTitle.textContent = level.name;

    shopTab = 'tower';
    buildShop();
    updatePickupBar(g);
    closeInspector();
    g.mode = 'build';
    g.buildType = 'bottle';
    updateHud(g);
    showScreen('game');
    if (audio() && audio().init) audio().init();
    if (audio() && audio().startMusic) audio().startMusic(level.waves.some(function (w) {
      return w.groups.some(function (grp) { return grp.enemy === 'rabbitBoss'; });
    }) ? 'boss' : 'battle');
  }

  function nextLevelFrom(id) {
    var idx = App.levels.findIndex(function (l) { return l.id === id; });
    if (idx >= 0 && idx + 1 < App.levels.length) startLevel(App.levels[idx + 1].id);
  }

  function restartLevel() {
    if (App.game) startLevel(App.game.level.id);
  }

  function quitTo(where) {
    App.game = null;
    App.paused = false;
    closeAllModals();
    showScreen(where || 'menu');
  }

  // ------------------------------------------------------------ 弹窗
  function closeAllModals() {
    ['modal-pause', 'modal-result', 'modal-settings'].forEach(function (id) {
      var el = F.el(id);
      if (el) el.classList.add('hidden');
    });
  }

  function openPause() {
    if (!App.game || App.paused) return;
    App.paused = true;
    var m = F.el('modal-pause');
    if (m) m.classList.remove('hidden');
    play('click');
  }

  function resumeGame() {
    var m = F.el('modal-pause');
    if (m) m.classList.add('hidden');
    var s = F.el('modal-settings');
    if (s) s.classList.add('hidden');
    App.paused = false;
    play('click');
  }

  function openSettings(from) {
    App.settingsFrom = from;
    var m = F.el('modal-settings');
    if (m) m.classList.remove('hidden');
    var snd = F.el('opt-sound');
    if (snd) snd.checked = App.sound;
    var mus = F.el('opt-music');
    if (mus) mus.checked = App.music;
    var vol = F.el('opt-volume');
    if (vol) vol.value = String(Math.round(App.volume * 100));
    play('click');
  }

  function applyAudioSettings() {
    var a = audio();
    if (a) {
      if (a.setSound) a.setSound(App.sound);
      if (a.setMusic) a.setMusic(App.music);
      if (a.setVolume) a.setVolume(App.volume);
      if (App.music && a.startMusic) a.startMusic(App.screen === 'game' ? 'battle' : 'menu');
      if (!App.music && a.stopMusic) a.stopMusic();
    }
    if (App.profile) {
      App.profile.sound = App.sound;
      App.profile.music = App.music;
      App.profile.volume = App.volume;
      saveProfile();
    }
  }

  // ------------------------------------------------------------ 主循环
  var lastTime = 0;
  var rafId = 0;

  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (!lastTime) lastTime = ts;
    var dt = Math.min(0.05, (ts - lastTime) / 1000);
    lastTime = ts;

    var g = App.game;
    if (!g) return;
    if (!App.paused && g.state === 'playing') {
      var steps = App.speed;
      if (steps >= 3) {
        g.update(dt);
        g.update(dt);
        g.update(dt);
      } else if (steps === 2) {
        g.update(dt);
        g.update(dt);
      } else {
        g.update(dt);
      }
    }
    if (ctx) PWLB.Render.frame(ctx, g, ts / 1000);
  }

  // ------------------------------------------------------------ 绑定
  function bind() {
    F.on(F.el('btn-play'), 'click', function () {
      play('click');
      var firstUnlocked = App.levels.filter(function (l) { return unlockedOf(l.id); });
      var target = firstUnlocked[firstUnlocked.length - 1] || App.levels[0];
      if (target) startLevel(target.id);
    });
    F.on(F.el('btn-levels'), 'click', function () { play('click'); showScreen('levels'); });
    F.on(F.el('btn-collection'), 'click', function () { play('click'); showScreen('collection'); });
    F.on(F.el('btn-settings'), 'click', function () { openSettings('menu'); });
    F.on(F.el('btn-levels-back'), 'click', function () { play('click'); showScreen('menu'); });
    F.on(F.el('btn-collection-back'), 'click', function () { play('click'); showScreen('menu'); });

    var tabs = F.el('collection-tabs');
    if (tabs) {
      tabs.addEventListener('click', function (ev) {
        var b = ev.target.closest('button[data-tab]');
        if (!b) return;
        play('click');
        renderCollection(b.dataset.tab);
      });
    }

    // 商店分页：炮塔 / 道具（页面没提供就自己补一个，保证功能可用）
    ensureShopTabs();
    var shopTabs = F.el('shop-tabs');
    if (shopTabs) {
      shopTabs.addEventListener('click', function (ev) {
        var b = ev.target.closest('button[data-tab]');
        if (!b) return;
        shopTab = b.dataset.tab;
        Array.prototype.forEach.call(shopTabs.querySelectorAll('button'), function (x) {
          x.classList.toggle('active', x === b);
        });
        if (App.game) {
          App.game.mode = shopTab === 'item' ? 'idle' : 'build';
          buildShop();
          updateHud(App.game);
        }
        play('click');
      });
    }

    F.on(F.el('btn-pause'), 'click', openPause);
    F.on(F.el('btn-resume'), 'click', resumeGame);
    F.on(F.el('btn-restart'), 'click', function () { play('click'); closeAllModals(); restartLevel(); });
    F.on(F.el('btn-quit'), 'click', function () { play('click'); quitTo('levels'); });
    F.on(F.el('btn-pause-settings'), 'click', function () { openSettings('pause'); });

    F.on(F.el('btn-result-retry'), 'click', function () { play('click'); closeAllModals(); restartLevel(); });
    F.on(F.el('btn-result-menu'), 'click', function () { play('click'); quitTo('levels'); });
    F.on(F.el('btn-result-next'), 'click', function () {
      var btn = F.el('btn-result-next');
      play('click');
      closeAllModals();
      if (btn && btn.dataset.next) startLevel(btn.dataset.next);
      else if (App.lastResults) nextLevelFrom(App.lastResults.level);
    });

    F.on(F.el('btn-settings-close'), 'click', function () {
      var m = F.el('modal-settings');
      if (m) m.classList.add('hidden');
      if (App.settingsFrom === 'pause') { /* 仍暂停 */ } else App.paused = !!App.game;
      play('click');
    });
    F.on(F.el('btn-settings-back'), 'click', function () {
      var m = F.el('modal-settings');
      if (m) m.classList.add('hidden');
      quitTo('menu');
    });

    F.on(F.el('opt-sound'), 'change', function (ev) { App.sound = ev.target.checked; applyAudioSettings(); });
    F.on(F.el('opt-music'), 'change', function (ev) { App.music = ev.target.checked; applyAudioSettings(); });
    F.on(F.el('opt-volume'), 'input', function (ev) {
      App.volume = F.clamp(Number(ev.target.value) / 100, 0, 1);
      applyAudioSettings();
    });

    F.on(F.el('btn-speed'), 'click', function () {
      if (!App.game) return;
      App.speed = App.speed >= 3 ? 1 : App.speed + 1;
      var el = F.el('btn-speed');
      if (el) el.textContent = App.speed + '×';
      play('click');
    });

    canvas = F.el('game-canvas');
    if (canvas) {
      canvas.addEventListener('mousemove', onMove);
      canvas.addEventListener('mouseleave', function () {
        if (App.game) { App.game.hoverSlot = null; App.game.hoverCell = null; }
      });
      canvas.addEventListener('click', onClick);
      canvas.addEventListener('contextmenu', function (ev) {
        ev.preventDefault();
        if (!App.game) return;
        App.game.mode = 'idle';
        App.game.hoverSlot = null;
        App.game.selected = null;
        closeInspector();
      });
    }

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        if (App.game && App.game.state === 'playing') {
          if (App.paused) resumeGame(); else openPause();
        }
      }
      if (ev.key === ' ' && App.game) {
        ev.preventDefault();
        if (App.paused) resumeGame(); else openPause();
      }
      if (ev.key === 'Escape') {
        if (App.game) { App.game.mode = 'idle'; App.game.hoverSlot = null; closeInspector(); updateHud(App.game); }
      }
      if (ev.key >= '1' && ev.key <= '8' && App.game) {
        var ids = Object.keys(App.towers);
        var pick = ids[Number(ev.key) - 1];
        if (pick) {
          App.game.buildType = pick;
          App.game.mode = 'build';
          App.game.selected = null;
          closeInspector();
          updateHud(App.game);
          play('click');
        }
      }
    });

    window.addEventListener('resize', function () {
      PWLB.Render.backgroundCache = null;
      PWLB.Render.backgroundKey = '';
      // 窗口变化后浮层要重新贴到对应的格子上
      var g = App.game;
      if (g && App.popup === 'tower' && g.selected) anchorPopup(F.el('tower-inspect'), g.selected.col, g.selected.row);
    });

    // 首次交互解锁音频
    var unlock = function () {
      if (audio() && audio().init) audio().init();
      if (App.music && audio() && audio().startMusic) audio().startMusic(App.screen === 'game' ? 'battle' : 'menu');
      document.removeEventListener('pointerdown', unlock);
    };
    document.addEventListener('pointerdown', unlock);
  }

  // ------------------------------------------------------------ 启动
  function boot() {
    var loading = F.el('boot-loading');
    Promise.all([
      fetch('data/towers.json', { cache: 'no-store' }).then(function (r) { return r.json(); }),
      fetch('data/enemies.json', { cache: 'no-store' }).then(function (r) { return r.json(); }),
      fetch('data/levels.json', { cache: 'no-store' }).then(function (r) { return r.json(); })
    ]).then(function (res) {
      App.towers = res[0];
      App.enemies = res[1];
      App.levels = res[2];
      return loadProfile();
    }).then(function (prof) {
      App.sound = prof.sound !== false;
      App.music = prof.music !== false;
      App.volume = typeof prof.volume === 'number' ? prof.volume : 0.7;
      if (window.GameAudio) {
        if (window.GameAudio.setSound) window.GameAudio.setSound(App.sound);
        if (window.GameAudio.setMusic) window.GameAudio.setMusic(App.music);
        if (window.GameAudio.setVolume) window.GameAudio.setVolume(App.volume);
      }
      ensureShopTabs();
      ensureBossWarning();
      ensureBossHp();
      ensureNextWavePreview();
      bind();
      renderMenuProfile();
      showScreen('menu');
      if (loading) loading.classList.add('hidden');
      lastTime = 0;
      if (!rafId) rafId = requestAnimationFrame(loop);
      window.__pwlbReady = true;
    }).catch(function (err) {
      window.__pwlbErrors.push('启动失败: ' + err);
      if (loading) loading.textContent = '加载失败：' + err;
      F.toast('数据加载失败，请用 python server.py 启动', 'warn');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  App.showScreen = showScreen;
  App.startLevel = startLevel;
  PWLB.App = App;
  PWLB.startLevel = startLevel;
  PWLB.showScreen = showScreen;
})();
