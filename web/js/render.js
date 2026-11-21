/* global window, PWLB */
/**
 * 战场渲染：把游戏状态画到 Canvas 上。
 * 所有绘制依赖 window.Sprites；缺失时降级为纯色块，保证不白屏。
 */
(function () {
  'use strict';

  var PWLB = window.PWLB;
  var TILE = PWLB.TILE;
  var W = PWLB.W;
  var H = PWLB.H;

  var Render = {};

  function S() {
    return (window.Sprites && window.Sprites.drawTile) ? window.Sprites : null;
  }

  /** 圆角矩形路径（血条、面板都用得上）。 */
  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function safe(fn, fallback) {
    try { fn(); } catch (err) {
      if (window.__pwlbErrors) window.__pwlbErrors.push(String(err && err.stack || err));
      if (fallback) { try { fallback(); } catch (e2) { /* 忽略 */ } }
    }
  }

  Render.backgroundCache = null;
  Render.backgroundKey = '';

  /** 把地砖烘焙到离屏画布：主题不变就不重画，省掉每帧 240 次调用。 */
  Render.buildBackground = function (theme, t) {
    var key = theme + '|' + Math.floor(t / 6);
    if (Render.backgroundCache && Render.backgroundKey === key) return Render.backgroundCache;
    var cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    var g = cv.getContext('2d');
    var sp = S();
    for (var r = 0; r < PWLB.ROWS; r++) {
      for (var c = 0; c < PWLB.COLS; c++) {
        var x = c * TILE, y = r * TILE;
        if (sp) {
          safe(function () { sp.drawTile(g, theme, c, r, t); });
        } else {
          g.fillStyle = (c + r) % 2 ? '#8fd07a' : '#8ad274';
          g.fillRect(x, y, TILE, TILE);
        }
        if (sp && sp.drawDecor) {
          var seedv = (c * 7349 + r * 9176) % 23;
          if (seedv === 3) safe(function () { sp.drawDecor(g, theme, x + 32, y + 32, t); });
        }
      }
    }
    Render.backgroundCache = cv;
    Render.backgroundKey = key;
    return cv;
  };

  /** 路径：绘制一条带描边的土路 + 行进方向箭头。 */
  Render.drawPath = function (ctx, path, t) {
    if (!path) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    for (var i = 0; i < path.points.length; i++) {
      var p = path.points[i];
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = 'rgba(88, 62, 40, 0.22)';
    ctx.lineWidth = TILE * 1.02;
    ctx.stroke();

    ctx.strokeStyle = '#e8c98f';
    ctx.lineWidth = TILE * 0.88;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 244, 214, 0.35)';
    ctx.lineWidth = TILE * 0.5;
    ctx.stroke();

    // 虚线游行方向
    ctx.setLineDash([14, 26]);
    ctx.lineDashOffset = -t * 34;
    ctx.strokeStyle = 'rgba(150, 108, 62, 0.45)';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  };

  Render.drawSlots = function (ctx, game, t) {
    // 建塔模式：把每一格可建的空地都标出来（原版就是草地随便种）
    if (game.mode === 'build') {
      var affordable = game.affordable();
      ctx.save();
      for (var r = 0; r < PWLB.ROWS; r++) {
        for (var c = 0; c < PWLB.COLS; c++) {
          if (game.canPlace(c, r) !== 'ok') continue;
          var px = c * TILE;
          var py = r * TILE;
          var isHover = game.hoverSlot && game.hoverSlot[0] === c && game.hoverSlot[1] === r;
          var pulse = 0.30 + Math.sin(t * 3.0 + (c + r) * 0.6) * 0.10;
          if (isHover) {
            ctx.fillStyle = affordable ? 'rgba(255, 255, 190, 0.62)' : 'rgba(255, 90, 90, 0.55)';
            ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
            ctx.strokeStyle = affordable ? '#fff47a' : '#ff6b6b';
            ctx.lineWidth = 4;
            ctx.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
          } else {
            ctx.fillStyle = affordable
              ? 'rgba(190, 255, 175, ' + pulse + ')'
              : 'rgba(120, 120, 120, 0.18)';
            ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
            ctx.strokeStyle = affordable ? 'rgba(255, 255, 255, 0.80)' : 'rgba(255,255,255,0.20)';
            ctx.lineWidth = 2;
            ctx.strokeRect(px + 4, py + 4, TILE - 8, TILE - 8);
            // 中央一个小十字，明确“这里能种”
            if (affordable) {
              ctx.strokeStyle = 'rgba(90, 160, 70, 0.55)';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(px + TILE / 2 - 7, py + TILE / 2);
              ctx.lineTo(px + TILE / 2 + 7, py + TILE / 2);
              ctx.moveTo(px + TILE / 2, py + TILE / 2 - 7);
              ctx.lineTo(px + TILE / 2, py + TILE / 2 + 7);
              ctx.stroke();
            }
          }
        }
      }
      ctx.restore();
    }

    // 常驻：提示哪些点曾经是设计好的推荐位（暗一点，不喧宾夺主）
    var slots = game.level.slots;
    for (var i = 0; i < slots.length; i++) {
      var key = slots[i][0] + ',' + slots[i][1];
      if (game.towerAt[key]) continue;
      if (game.mode === 'build') continue;
      var x = (slots[i][0] + 0.5) * TILE;
      var y = (slots[i][1] + 0.5) * TILE;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.arc(x, y, 21, 0, 6.2832);
      ctx.stroke();
      ctx.restore();
    }

    // 建塔预览：范围圈（悬浮在合法格上就显示，方便先看覆盖范围再决定）
    if (game.mode === 'build' && game.hoverSlot) {
      var bx = (game.hoverSlot[0] + 0.5) * TILE;
      var by = (game.hoverSlot[1] + 0.5) * TILE;
      var def = game.towers[game.buildType];
      if (def) {
        var rng = def.levels[0].range;
        var ok = game.coins >= def.cost && !game.towerAt[game.hoverSlot[0] + ',' + game.hoverSlot[1]];
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, rng, 0, 6.2832);
        ctx.fillStyle = ok ? 'rgba(94, 194, 105, 0.20)' : 'rgba(230, 90, 90, 0.20)';
        ctx.fill();
        ctx.strokeStyle = ok ? 'rgba(94, 194, 105, 0.9)' : 'rgba(230, 90, 90, 0.9)';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 8]);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  Render.drawObstacles = function (ctx, game, t) {
    var sp = S();
    for (var i = 0; i < game.obstacles.length; i++) {
      var o = game.obstacles[i];
      var w = o.w || 1;
      var h = o.h || 1;
      var x = (o.col + w / 2) * TILE;
      var y = (o.row + h / 2) * TILE;
      var hp = o.maxHp > 0 ? Math.max(0, o.hp / o.maxHp) : 0;
      var size = Math.min(TILE * w, TILE * h) * 0.78 + (Math.min(w, h) - 1) * 10;

      if (sp && sp.drawObstacle) {
        safe(function () {
          sp.drawObstacle(ctx, o.kind, x, y, t, {
            hp: hp, size: size, w: w, h: h,
            hitFlash: o.flash, cols: w * TILE, rows: h * TILE
          });
        });
      } else {
        ctx.save();
        ctx.fillStyle = '#8d7b6b';
        ctx.fillRect(o.col * TILE + 6, o.row * TILE + 6, w * TILE - 12, h * TILE - 12);
        ctx.restore();
      }

      // 常驻血条：v2 建筑和怪物一样有血条，宽度随占地变化。
      // 唯一实现放在这里，不走 Sprites.drawObstacleHp（它的坐标约定与这里不同，
      // 混用会把血条画成横贯全屏的长条）。
      {
        var bw = Math.max(40, w * TILE * 0.76);
        var bh2 = 8;
        var bx = x - bw / 2;
        var by = o.row * TILE + 5;
        ctx.save();
        // 底槽
        ctx.fillStyle = 'rgba(30, 24, 18, 0.55)';
        roundRect(ctx, bx - 1, by - 1, bw + 2, bh2 + 2, 4);
        ctx.fill();
        // 血量
        var col = hp > 0.55 ? '#7ede5a' : hp > 0.28 ? '#ffc94a' : '#ff6b6b';
        ctx.fillStyle = col;
        if (hp > 0) roundRect(ctx, bx, by, Math.max(2, bw * hp), bh2, 3);
        ctx.fill();
        // 顶部高光
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        if (hp > 0) roundRect(ctx, bx, by, Math.max(2, bw * hp), bh2 * 0.45, 3);
        ctx.fill();
        ctx.restore();
      }
    }
  };

  Render.drawTowers = function (ctx, game, t) {
    var sp = S();
    for (var i = 0; i < game.towerList.length; i++) {
      var tw = game.towerList[i];
      // 边缘行：把塔身往下挪一点，避免塔顶被画布上沿裁掉
      var drawY = tw.cy;
      if (tw.row === 0) drawY = Math.max(tw.cy, 44);
      else if (tw.row === PWLB.ROWS - 1) drawY = Math.min(tw.cy, PWLB.H - 30);

      if (sp && sp.drawTower) {
        safe(function () {
          sp.drawTower(ctx, tw.id, tw.level, tw.cx, drawY, t, {
            angle: tw.angle, firing: tw.firing > 0, teamColor: tw.def.color
          });
        });
      } else {
        ctx.save();
        ctx.fillStyle = tw.def.color;
        ctx.beginPath();
        ctx.arc(tw.cx, tw.cy, 24, 0, 6.2832);
        ctx.fill();
        ctx.restore();
      }
      // 等级小星
      for (var k = 0; k < tw.level; k++) {
        ctx.save();
        ctx.fillStyle = '#ffd93d';
        ctx.beginPath();
        ctx.arc(tw.cx - 12 + k * 12, (tw.row === 0 ? Math.max(tw.cy, 44) : tw.cy) + 24, 4, 0, 6.2832);
        ctx.fill();
        ctx.restore();
      }
      // 光环塔：画一圈脉动的加成范围
      if (tw.stat().strategy === 'aura') {
        var ar = tw.stat().auraRadius || 120;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 214, 88, ' + (0.35 + Math.sin(t * 2.5) * 0.15) + ')';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 10]);
        ctx.lineDashOffset = -t * 20;
        ctx.beginPath();
        ctx.arc(tw.cx, tw.cy, ar, 0, 6.2832);
        ctx.stroke();
        ctx.restore();
      }
      if (game.selected === tw) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(tw.cx, tw.cy, tw.range(), 0, 6.2832);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([9, 7]);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 太阳花光束
    for (var j = 0; j < game.towerList.length; j++) {
      var st = game.towerList[j];
      if (st.id !== 'sun' || !st.beamTarget || !st.beamTarget.alive) continue;
      var a = st.cx, b = st.cy, tx = st.beamTarget.x, ty = st.beamTarget.y;
      var alpha = 0.55 + Math.sin(t * 22 + j) * 0.18;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255, 214, 102, ' + alpha + ')';
      ctx.lineWidth = 7 + Math.sin(t * 15) * 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a, b);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
  };

  Render.drawEnemies = function (ctx, game, t) {
    var sp = S();
    var list = game.enemies.slice().sort(function (a, b) { return a.y - b.y; });
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e.alive) continue;
      var opts = {
        hp: e.maxHp ? e.hp / e.maxHp : 0,
        facing: e.facing,
        size: e.radius,
        frozen: e.frozen > 0,
        hitFlash: e.hitFlash,
        serial: e.id,
        slowed: e.slowTime > 0
      };
      if (sp && sp.drawEnemy) {
        safe(function () { sp.drawEnemy(ctx, e.type, e.x, e.y, t + e.id * 0.37, opts); });
      } else {
        ctx.save();
        ctx.fillStyle = e.def.colors ? e.def.colors.body : '#fff';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius, 0, 6.2832);
        ctx.fill();
        ctx.restore();
      }
      // 护盾外壳
      if (e.shield > 0) {
        var sr = e.radius + 7;
        ctx.save();
        ctx.strokeStyle = 'rgba(140, 220, 255, 0.85)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(e.x, e.y, sr, 0, 6.2832);
        ctx.stroke();
        ctx.fillStyle = 'rgba(140, 220, 255, 0.16)';
        ctx.fill();
        ctx.restore();
      }
      // 中毒绿光
      if (e.poisonTime > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(150, 230, 90, ' + (0.20 + Math.sin(t * 8) * 0.08) + ')';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius + 4, 0, 6.2832);
        ctx.fill();
        ctx.restore();
      }
      // 血条（唯一绘制方；精灵内部已关闭，不会再出现两条）
      if (e.hp < e.maxHp || (e.shieldMax || 0) > 0) {
        var w = Math.max(26, e.radius * 2.2);
        var top = e.y - e.radius - (e.boss ? 30 : 16);
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(e.x - w / 2, top, w, 6);
        var ratio = PWLB.util.clamp(e.hp / e.maxHp, 0, 1);
        ctx.fillStyle = ratio > 0.5 ? '#6ddc6d' : ratio > 0.22 ? '#ffcc4d' : '#ff6b6b';
        ctx.fillRect(e.x - w / 2, top, w * ratio, 6);
        // 护盾条（画在血条下方，浅蓝）
        if (e.shieldMax > 0) {
          var sr2 = Math.max(0, e.shield / e.shieldMax);
          ctx.fillStyle = 'rgba(0,0,0,0.4)';
          ctx.fillRect(e.x - w / 2, top + 7, w, 4);
          ctx.fillStyle = '#7fd4ff';
          ctx.fillRect(e.x - w / 2, top + 7, w * sr2, 4);
        }
        ctx.restore();
      }
    }
  };

  /** 场上的特殊武器：漂浮 + 光晕，很容易看见。 */
  Render.drawPickups = function (ctx, game, t) {
    for (var i = 0; i < game.pickups.length; i++) {
      var p = game.pickups[i];
      var def = PWLB.PICKUP_DEFS && PWLB.PICKUP_DEFS[p.kind];
      if (!def) continue;
      var bob = Math.sin(t * 3 + i) * 4;
      var y = p.y + bob;
      ctx.save();
      // 光晕
      var g2 = ctx.createRadialGradient(p.x, y, 2, p.x, y, 32);
      g2.addColorStop(0, def.color + 'cc');
      g2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(p.x, y, 32, 0, 6.2832);
      ctx.fill();
      // 本体
      ctx.beginPath();
      ctx.arc(p.x, y, def.radius, 0, 6.2832);
      ctx.fillStyle = def.color;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.stroke();
      // 图标
      ctx.fillStyle = '#fff';
      ctx.font = '900 15px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.kind === 'bomb' ? '炸' : p.kind === 'freeze' ? '冰' : '电', p.x, y + 1);
      ctx.restore();
    }
  };

  Render.drawProjectiles = function (ctx, game, t) {
    var sp = S();
    for (var i = 0; i < game.projectiles.length; i++) {
      var p = game.projectiles[i];
      if (!p.alive) continue;

      // 追踪导弹拖尾
      if (p.homing) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 190, 120, 0.55)';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x - Math.cos(p.angle) * 26, p.y - Math.sin(p.angle) * 26);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.restore();
      }
      // 穿透弹的冷光
      if (p.pierce > 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(150, 255, 200, 0.5)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(p.x - Math.cos(p.angle) * 34, p.y - Math.sin(p.angle) * 34);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.restore();
      }

      if (sp && sp.drawProjectile) {
        safe(function () { sp.drawProjectile(ctx, p.kind, p.x, p.y, t, { angle: p.angle, spin: p.spin, crit: p.crit, poison: p.poison > 0 }); });
      } else {
        ctx.save();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, 6.2832);
        ctx.fill();
        ctx.restore();
      }
    }
  };

  Render.drawEffects = function (ctx, game, t) {
    for (var i = 0; i < game.effects.length; i++) {
      var fx = game.effects[i];
      var k = fx.life / fx.maxLife;
      ctx.save();
      if (fx.type === 'explosion') {
        var r = fx.r * (1.25 - k * 0.85);
        var alpha = 0.62 * k;
        var grd = ctx.createRadialGradient(fx.x, fx.y, 4, fx.x, fx.y, r);
        grd.addColorStop(0, 'hsla(' + fx.hue + ',100%,92%,' + alpha + ')');
        grd.addColorStop(0.55, 'hsla(' + fx.hue + ',95%,65%,' + (alpha * 0.7) + ')');
        grd.addColorStop(1, 'hsla(' + fx.hue + ',90%,50%,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, r, 0, 6.2832);
        ctx.fill();
      } else if (fx.type === 'spark') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'hsla(' + (fx.hue || 50) + ',100%,78%,' + k + ')';
        for (var s = 0; s < 5; s++) {
          var ang = (s / 5) * 6.2832 + fx.seed0;
          var rr = (1 - k) * 18 + 3;
          ctx.beginPath();
          ctx.arc(fx.x + Math.cos(ang) * rr, fx.y + Math.sin(ang) * rr, 3 * k + 1, 0, 6.2832);
          ctx.fill();
        }
      } else if (fx.type === 'frost') {
        ctx.strokeStyle = 'rgba(150, 226, 255, ' + k + ')';
        ctx.lineWidth = 4 * k + 1;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.r * (1.15 - k * 0.4), 0, 6.2832);
        ctx.stroke();
      } else if (fx.type === 'lightning') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(255, 240, 150, ' + (0.95 * k) + ')';
        ctx.lineWidth = 4.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (var pi = 0; pi < fx.points.length - 1; pi++) {
          var p0 = fx.points[pi], p1 = fx.points[pi + 1];
          ctx.moveTo(p0.x, p0.y);
          var steps = 6;
          for (var q = 1; q <= steps; q++) {
            var tt = q / steps;
            var jitter = q === steps ? 0 : (Math.sin(fx.seed + pi * 12.9898 + q * 78.233) * 9);
            var nx = -(p1.y - p0.y), ny = p1.x - p0.x;
            var nl = Math.hypot(nx, ny) || 1;
            ctx.lineTo(
              p0.x + (p1.x - p0.x) * tt + (nx / nl) * jitter,
              p0.y + (p1.y - p0.y) * tt + (ny / nl) * jitter
            );
          }
        }
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.9 * k) + ')';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      } else if (fx.type === 'coin') {
        var rise = (1 - k) * 34;
        var pop = k > 0.75 ? 1 + (k - 0.75) * 1.6 : 1;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '900 ' + Math.round(20 * pop) + 'px "Segoe UI", "Microsoft YaHei", sans-serif';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(72, 47, 12, ' + (k * 0.85) + ')';
        ctx.strokeText('+' + fx.value, fx.x, fx.y - rise);
        ctx.fillStyle = 'rgba(255, 224, 102, ' + Math.min(1, k * 1.5) + ')';
        ctx.fillText('+' + fx.value, fx.x, fx.y - rise);
        ctx.restore();
      } else if (fx.type === 'leak') {
        var rr = 30 + (1 - k) * 52;
        ctx.strokeStyle = 'rgba(255, 90, 90, ' + k + ')';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, rr, 0, 6.2832);
        ctx.stroke();
        ctx.fillStyle = 'rgba(220, 40, 40, ' + (k * 0.35) + ')';
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, rr * 0.82, 0, 6.2832);
        ctx.fill();
      } else if (fx.type === 'poison') {
        ctx.fillStyle = 'rgba(150, 230, 90, ' + (k * 0.4) + ')';
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.r * (1.2 - k * 0.5), 0, 6.2832);
        ctx.fill();
      } else if (fx.type === 'crit') {
        ctx.textAlign = 'center';
        ctx.font = '900 22px "Segoe UI", "Microsoft YaHei", sans-serif';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(120, 30, 0, ' + k + ')';
        ctx.strokeText('暴击!', fx.x, fx.y - (1 - k) * 24);
        ctx.fillStyle = 'rgba(255, 190, 40, ' + k + ')';
        ctx.fillText('暴击!', fx.x, fx.y - (1 - k) * 24);
      } else if (fx.type === 'spawn') {
        ctx.strokeStyle = 'rgba(180, 255, 190, ' + k + ')';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, 34 * (1.2 - k * 0.7), 0, 6.2832);
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  Render.drawCarrotAndPortal = function (ctx, game, t) {
    var sp = S();
    var carrot = game.carrotPos;
    var hp = game.carrotHp / game.level.carrotHp;
    if (sp && sp.drawCarrot) {
      safe(function () {
        sp.drawCarrot(ctx, carrot.x, carrot.y, t, { hp: hp, hurtFlash: game.carrotFlash });
      });
    } else {
      ctx.save();
      ctx.fillStyle = '#ff8a3d';
      ctx.beginPath();
      ctx.moveTo(carrot.x, carrot.y + 30);
      ctx.lineTo(carrot.x - 16, carrot.y - 6);
      ctx.lineTo(carrot.x + 16, carrot.y - 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    for (var i = 0; i < game.paths.length; i++) {
      var start = game.paths[i].points[0];
      if (sp && sp.drawPortal) {
        safe(function () { sp.drawPortal(ctx, start.x, start.y, t, { index: i }); });
      } else {
        ctx.save();
        ctx.strokeStyle = 'rgba(180, 124, 255, 0.8)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(start.x, start.y, 24, 0, 6.2832);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  /** 锁定标记：目标身上一圈旋转的准星 + 从炮塔连过去的细线。 */
  Render.drawLock = function (ctx, game, t) {
    var lock = game.lockedTarget;
    if (!lock || !lock.ref) return;
    var x, y, radius;
    if (lock.type === 'enemy') {
      if (!lock.ref.alive) return;
      x = lock.ref.x; y = lock.ref.y; radius = (lock.ref.radius || 16) + 12;
    } else {
      var o = lock.ref;
      if (o.hp <= 0) return;
      x = (o.col + o.w / 2) * TILE;
      y = (o.row + o.h / 2) * TILE;
      radius = Math.max(o.w, o.h) * TILE * 0.55;
    }

    ctx.save();
    // 旋转准星
    var spin = t * 1.6;
    ctx.translate(x, y);
    ctx.rotate(spin);
    ctx.strokeStyle = lock.type === 'enemy' ? '#ff5c8a' : '#ffb02e';
    ctx.lineWidth = 3;
    ctx.setLineDash([9, 7]);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, 6.2832);
    ctx.stroke();
    ctx.setLineDash([]);
    // 四个角箭头
    for (var i = 0; i < 4; i++) {
      var a = i * Math.PI / 2;
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(radius + 3, 0);
      ctx.lineTo(radius + 12, -5);
      ctx.lineTo(radius + 12, 5);
      ctx.closePath();
      ctx.fillStyle = lock.type === 'enemy' ? '#ff5c8a' : '#ffb02e';
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // 从射程内每座炮塔连一条细线到锁定目标
    ctx.save();
    ctx.strokeStyle = lock.type === 'enemy' ? 'rgba(255, 92, 138, 0.28)' : 'rgba(255, 176, 46, 0.30)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 8]);
    for (var j = 0; j < game.towerList.length; j++) {
      var tw = game.towerList[j];
      var rr = tw.range() + radius;
      if ((tw.cx - x) * (tw.cx - x) + (tw.cy - y) * (tw.cy - y) > rr * rr) continue;
      ctx.beginPath();
      ctx.moveTo(tw.cx, tw.cy);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.restore();
  };

  Render.frame = function (ctx, game, t) {
    ctx.clearRect(0, 0, W, H);

    var bg = Render.buildBackground(game.level.theme, t);
    ctx.drawImage(bg, 0, 0);

    for (var i = 0; i < game.paths.length; i++) Render.drawPath(ctx, game.paths[i], t);

    Render.drawSlots(ctx, game, t);
    Render.drawCarrotAndPortal(ctx, game, t);
    Render.drawObstacles(ctx, game, t);
    Render.drawPickups(ctx, game, t);
    Render.drawTowers(ctx, game, t);
    Render.drawEnemies(ctx, game, t);
    Render.drawProjectiles(ctx, game, t);
    Render.drawLock(ctx, game, t);
    Render.drawEffects(ctx, game, t);
  };

  PWLB.Render = Render;
})();
