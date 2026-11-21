/* =============================================================================
 * sprites.js --- 《保卫萝卜》复刻 · 程序化美术模块（契约 6.1 · v2 画风重制）
 *
 * 画风目标（契约 §5）：明亮、饱和、圆润的卡通。
 *   所有元素统一规则：深色描边（#3b2f2a, 2~3px）+ 顶部高光（半透明白）+ 底部阴影。
 *
 * 约定：
 *   - 网格一格 64px，所有坐标为世界像素（中心点）。
 *   - 每个对外函数内部成对 ctx.save() / ctx.restore()，不泄漏任何状态。
 *   - 不使用 shadowBlur / 滤镜 / 离屏图：发光一律用半透明叠层。
 *   - drawTile 每帧每格调用（240 格），只做 fillRect / 极少量三角或弧线，
 *     且不使用 ctx.save()；细节位置由确定性哈希决定，不会逐帧闪烁。
 *   - 本文件不依赖任何外部资源与其它 JS 文件，可单独引入。
 * ========================================================================== */
(function (global) {
  'use strict';

  var TILE = 64;
  var TAU = Math.PI * 2;
  var INK = '#3b2f2a';                 // 统一深色描边（契约 §5）

  /* 契约 §5 色板 ---------------------------------------------------------- */
  var C = {
    grass: '#7ec850', grassDeep: '#4a8a32', road: '#e8c88a',
    orange: '#ff9f43', pink: '#ff7aa8', blue: '#4aa3ff',
    cream: '#fff6e5', ink: '#3b2f2a', gold: '#ffd93d', goldDeep: '#b98a00'
  };

  /* -------------------------------------------------------------------------
   * 通用小工具
   * ---------------------------------------------------------------------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : (d || 0); }

  // 颜色缓存：任意 '#rgb' / '#rrggbb' / 'rgb(r,g,b)' -> [r,g,b]
  var _rgb = Object.create(null);
  function rgbOf(color) {
    if (typeof color !== 'string') return [136, 136, 136];
    var c = _rgb[color];
    if (c) return c;
    if (color.charAt(0) === '#') {
      var s = color.slice(1);
      if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      var n = parseInt(s, 16);
      if (isNaN(n)) n = 0x888888;
      c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    } else if (color.indexOf('rgb') === 0) {
      var m = color.match(/-?[\d.]+/g) || [];
      c = [parseInt(m[0], 10) || 0, parseInt(m[1], 10) || 0, parseInt(m[2], 10) || 0];
    } else {
      c = [136, 136, 136];
    }
    _rgb[color] = c;
    return c;
  }
  function mix(a, b, k) {
    var x = rgbOf(a), y = rgbOf(b);
    return 'rgb(' + Math.round(lerp(x[0], y[0], k)) + ',' +
      Math.round(lerp(x[1], y[1], k)) + ',' + Math.round(lerp(x[2], y[2], k)) + ')';
  }
  function lift(color, k) { return k >= 0 ? mix(color, '#ffffff', k) : mix(color, '#000000', -k); }
  function rgba(color, a) {
    var c = rgbOf(color);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  function hexA(hex, a) {   // 只接受 #rrggbb，用于拼 rgba 字符串（不走缓存）
    var c = rgbOf(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  // 确定性哈希 0..1：同一格 / 同一实体每帧都一样，噪点不会跳变闪烁
  function hash01(a, b, seed) {
    var h = Math.imul((a | 0) + 31, 374761393) ^
            Math.imul((b | 0) + 17, 668265263) ^
            Math.imul((seed | 0) + 7, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function rotPt(x, y, a) {
    var c = Math.cos(a), s = Math.sin(a);
    return { x: x * c - y * s, y: x * s + y * c };
  }

  /* --- 路径 / 形状 ------------------------------------------------------- */
  function rr(ctx, x, y, w, h, r) {
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    if (r > w * 0.5) r = w * 0.5;
    if (r > h * 0.5) r = h * 0.5;
    if (r < 0) r = 0;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function shapeRR(ctx, x, y, w, h, r, fill, stroke, lw) {
    rr(ctx, x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  }
  function pathEllipse(ctx, x, y, rx, ry, rot) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot || 0, 0, TAU);
  }
  function shapeEllipse(ctx, x, y, rx, ry, rot, fill, stroke, lw) {
    pathEllipse(ctx, x, y, rx, ry, rot);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  }
  function shapeCircle(ctx, x, y, r, fill, stroke, lw) {
    ctx.beginPath();
    ctx.arc(x, y, Math.abs(r), 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  }
  function poly(ctx, pts, close) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    if (close !== false) ctx.closePath();
  }
  function shapePoly(ctx, pts, fill, stroke, lw) {
    poly(ctx, pts, true);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  }
  function star(ctx, x, y, r, fill, rot) {
    var i, a, rad;
    ctx.beginPath();
    for (i = 0; i < 10; i++) {
      a = (rot || 0) + (i / 10) * TAU - Math.PI / 2;
      rad = (i % 2 === 0) ? r : r * 0.44;
      if (i === 0) ctx.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
      else ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
  // 顶部高光：半透明白椭圆（所有元素的统一语言）
  function gloss(ctx, x, y, rx, ry, rot, a) {
    shapeEllipse(ctx, x, y, rx, ry, rot || 0, 'rgba(255,255,255,' + (a === undefined ? 0.55 : a) + ')');
  }
  // 底部阴影：压暗 + 半透明黑
  function underShade(ctx, x, y, rx, ry, a) {
    shapeEllipse(ctx, x, y, rx, ry, 0, 'rgba(0,0,0,' + (a === undefined ? 0.16 : a) + ')');
  }
  function dropShadow(ctx, x, y, rx, ry) {
    shapeEllipse(ctx, x, y, rx, ry, 0, 'rgba(59,47,42,0.20)');
  }

  /* 炮口火光：在已旋转的坐标系里画，沿 +x 喷出 */
  function muzzleFlash(ctx, x, y, size, accent, t) {
    var fl = 0.72 + 0.28 * Math.abs(Math.sin(t * 34));
    ctx.save();
    ctx.globalAlpha = 0.92 * fl;
    ctx.fillStyle = '#fff4c2';
    ctx.beginPath();
    ctx.moveTo(x - 2, y - size * 0.52);
    ctx.lineTo(x + size * 1.5, y);
    ctx.lineTo(x - 2, y + size * 0.52);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(x + 1, y - size * 0.30);
    ctx.lineTo(x + size * 1.05, y);
    ctx.lineTo(x + 1, y + size * 0.30);
    ctx.closePath();
    ctx.fill();
    shapeCircle(ctx, x + size * 0.30, y, size * 0.44, '#fffdf2');
    ctx.globalAlpha = 0.45 * fl;
    shapeCircle(ctx, x + size * 0.2, y, size * 0.86, rgba('#fff6c2', 0.5));
    ctx.restore();
  }

  /* =========================================================================
   * 炮塔数据：12 种 × 3 级
   * 每级：更高（base 抬升）、更大（body 放大）、更亮（颜色 lift）、更多装饰
   * ====================================================================== */
  var TOWERS = {
    bottle:  { name: '瓶子塔', main: '#4aa3ff', dark: '#1d5aa0', accent: '#bfe4ff', tilt: 0.00 },
    arrow:   { name: '弓箭塔', main: '#6fbf4a', dark: '#2e6f28', accent: '#d8f5c0', tilt: 0.00 },
    fan:     { name: '风扇塔', main: '#39c9c0', dark: '#126e6a', accent: '#d0fbf6', tilt: 0.00 },
    ice:     { name: '冰冻塔', main: '#7fd8ff', dark: '#2a7fa8', accent: '#eafaff', tilt: 0.00 },
    cannon:  { name: '火炮塔', main: '#ff9f43', dark: '#a8531a', accent: '#ffe0b8', tilt: 0.00 },
    magic:   { name: '魔法塔', main: '#b07bff', dark: '#5a2fa8', accent: '#efe0ff', tilt: 0.00 },
    tesla:   { name: '闪电塔', main: '#ffd93d', dark: '#a87c00', accent: '#fff8c2', tilt: 0.00 },
    sun:     { name: '太阳花塔', main: '#ffb02e', dark: '#a86300', accent: '#fff0b8', tilt: 0.00 },
    poison:  { name: '毒菇塔', main: '#8fd94b', dark: '#3f7a1c', accent: '#e6ffc4', tilt: 0.00 },
    sniper:  { name: '狙击塔', main: '#7c93b8', dark: '#2f3f5c', accent: '#d7e6ff', tilt: 0.00 },
    missile: { name: '导弹塔', main: '#ff6b6b', dark: '#9c2626', accent: '#ffd9d9', tilt: 0.00 },
    drum:    { name: '战鼓塔', main: '#ffb84d', dark: '#a05a12', accent: '#ffe6b8', tilt: 0.00 }
  };

  /* 塔身（不旋转部分）：以 (0,0) 为塔身中心，body 直径约 34~40 */
  var BODY = {
    bottle: function (ctx, S) {
      shapeCircle(ctx, 0, 2, 15, S.main, INK, 2.4);
      shapeEllipse(ctx, 0, 10, 12, 4.4, 0, rgba(S.dark, 0.55));
      gloss(ctx, -5, -4, 6.5, 5, -0.5, 0.5);
      shapeCircle(ctx, 6, 6, 3, rgba(S.accent, 0.8));
      if (S.level >= 2) {
        shapeRR(ctx, -13, -13, 7, 7, 2.4, S.accent, INK, 1.5);
        shapeRR(ctx, 6, -13, 7, 7, 2.4, S.accent, INK, 1.5);
      }
      if (S.level >= 3) star(ctx, 0, 2, 4.4, 'rgba(255,226,122,0.9)', S.t * 0.9);
    },
    arrow: function (ctx, S) {
      shapeEllipse(ctx, 0, 2, 16, 14, 0, S.main, INK, 2.4);
      shapeEllipse(ctx, 0, 8, 13, 5, 0, rgba(S.dark, 0.5));
      gloss(ctx, -5, -5, 7, 4.6, -0.4, 0.5);
      // 箭袋
      shapeRR(ctx, -6, -18, 12, 10, 3, '#b98a55', INK, 1.8);
      shapeRR(ctx, -4.6, -22, 2.4, 6, 1.2, '#f0dcb4', INK, 1);
      shapeRR(ctx, 0.4, -22, 2.4, 6, 1.2, '#f0dcb4', INK, 1);
      if (S.level >= 2) shapeEllipse(ctx, 0, 2, 9, 7, 0, rgba(S.accent, 0.5));
      if (S.level >= 3) star(ctx, 0, 2, 4, '#ffe27a', S.t * 1.2);
    },
    fan: function (ctx, S) {
      shapeRR(ctx, -16, -13, 32, 28, 12, S.main, INK, 2.4);
      shapeRR(ctx, -11, -9, 22, 6, 3, 'rgba(255,255,255,0.45)', null);
      shapeRR(ctx, -12, 8, 24, 5, 2.4, rgba(S.dark, 0.55), null);
      // 通风口
      for (var i = 0; i < 3; i++) shapeCircle(ctx, -7 + i * 7, 2, 2.2, rgba(S.dark, 0.75));
      if (S.level >= 2) {
        shapeCircle(ctx, -15, -12, 3.4, S.accent, INK, 1.4);
        shapeCircle(ctx, 15, -12, 3.4, S.accent, INK, 1.4);
      }
      if (S.level >= 3) shapeRR(ctx, -17, -4, 4, 8, 2, '#ffe27a', INK, 1.2);
    },
    ice: function (ctx, S) {
      shapeCircle(ctx, 0, 3, 16, S.main, INK, 2.4);
      shapeEllipse(ctx, 0, 9, 13, 6, 0, S.accent, INK, 1.6);
      // 冰棱
      for (var i = 0; i < 3; i++) {
        var a = -Math.PI * 0.5 + (i - 1) * 0.85;
        ctx.save();
        ctx.rotate(a);
        ctx.translate(0, -14);
        shapePoly(ctx, [-3.4, 8, 0, -6, 3.4, 8], '#e6f9ff', '#4a9fc4', 1.3);
        ctx.restore();
      }
      gloss(ctx, -6, -3, 6, 4, -0.5, 0.6);
      if (S.level >= 2) shapeCircle(ctx, 0, 3, 7, rgba('#ffffff', 0.30));
      if (S.level >= 3) star(ctx, 0, 3, 3.6, '#ffffff', S.t * 0.8);
    },
    cannon: function (ctx, S) {
      shapeRR(ctx, -17, -13, 34, 28, 11, S.main, INK, 2.4);
      shapeRR(ctx, -12, -9, 24, 7, 3, 'rgba(255,255,255,0.42)', null);
      shapeEllipse(ctx, 0, 10, 14, 4.4, 0, rgba(S.dark, 0.5));
      shapeCircle(ctx, -9, 6, 2.6, rgba(S.dark, 0.8));
      shapeCircle(ctx, 9, 6, 2.6, rgba(S.dark, 0.8));
      // 炮弹堆
      shapeCircle(ctx, -13, -11, 4.4, '#3b3b44', INK, 1.6);
      shapeCircle(ctx, -14.4, -12.4, 1.6, 'rgba(255,255,255,0.55)');
      if (S.level >= 2) shapeCircle(ctx, 13, -11, 4.4, '#3b3b44', INK, 1.6);
      if (S.level >= 3) {
        shapeRR(ctx, -4, 9, 8, 5, 2, '#ffe27a', INK, 1.2);
      }
    },
    magic: function (ctx, S) {
      shapeCircle(ctx, 0, 2, 15.5, S.main, INK, 2.4);
      gloss(ctx, -6, -5, 6, 4.4, -0.5, 0.55);
      // 符文环
      ctx.strokeStyle = rgba(S.accent, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 2, 10, 0.35, 2.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 2, 10, 3.5, 5.7); ctx.stroke();
      // 环绕三星
      for (var i = 0; i < (S.level >= 2 ? 3 : 2); i++) {
        var a = S.t * 1.8 + i * TAU / 3;
        shapeCircle(ctx, Math.cos(a) * 15, 2 + Math.sin(a) * 5, 2, rgba('#ffffff', 0.85));
      }
      if (S.level >= 3) star(ctx, 0, 2, 4.2, '#ffe27a', S.t * 0.9);
    },
    tesla: function (ctx, S) {
      shapeRR(ctx, -16, -14, 32, 30, 10, S.main, INK, 2.4);
      shapeRR(ctx, -11, 6, 22, 6, 3, rgba(S.dark, 0.6), INK, 1.2);
      // 线圈
      for (var i = 0; i < 3; i++) {
        ctx.strokeStyle = i % 2 ? rgba(S.accent, 0.9) : rgba(S.dark, 0.85);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, -4 + i * 5, 12 - i, 3.4, 0, 0, TAU);
        ctx.stroke();
      }
      gloss(ctx, -7, -10, 6, 3.4, -0.3, 0.45);
      if (S.level >= 2) {
        shapeCircle(ctx, -14, -13, 2.6, '#fff8c2', INK, 1.2);
        shapeCircle(ctx, 14, -13, 2.6, '#fff8c2', INK, 1.2);
      }
      if (S.level >= 3) star(ctx, 0, 10, 3.4, '#fff8c2', S.t * 1.4);
    },
    sun: function (ctx, S) {
      // 花瓣底
      for (var i = 0; i < 10; i++) {
        var a = i * TAU / 10 + S.t * 0.5;
        ctx.save(); ctx.rotate(a);
        shapeEllipse(ctx, 0, -15, 5, 9, 0, rgba(S.accent, 0.95), INK, 1.4);
        ctx.restore();
      }
      shapeCircle(ctx, 0, 2, 13, '#8f5a1a', INK, 2.4);
      for (var k = 0; k < 5; k++) {
        var b = k * TAU / 5 + 0.6;
        shapeCircle(ctx, Math.cos(b) * 5, 2 + Math.sin(b) * 5, 1.7, '#ffe8a8');
      }
      if (S.level >= 3) shapeCircle(ctx, 0, 2, 6, rgba('#fff6c2', 0.5));
    },
    poison: function (ctx, S) {
      shapeRR(ctx, -13, -6, 26, 22, 9, '#f4e0b8', INK, 2.2);
      shapeEllipse(ctx, 0, 14, 12, 4, 0, rgba(S.dark, 0.4));
      gloss(ctx, -6, 2, 5, 6, 0, 0.45);
      if (S.level >= 2) {
        shapeCircle(ctx, -14, 8, 3, '#c2691c', INK, 1.3);
        shapeCircle(ctx, 14, 8, 3, '#c2691c', INK, 1.3);
      }
      if (S.level >= 3) star(ctx, 0, 12, 3.2, S.accent, S.t);
    },
    sniper: function (ctx, S) {
      shapeRR(ctx, -15, -12, 30, 26, 9, S.main, INK, 2.4);
      shapeRR(ctx, -10, -8, 20, 6, 3, 'rgba(255,255,255,0.38)', null);
      shapeRR(ctx, -16, 4, 32, 6, 3, rgba(S.dark, 0.7), INK, 1.2);
      // 沙袋
      shapeEllipse(ctx, -12, 13, 8, 5, 0, '#c9b48a', INK, 1.4);
      shapeEllipse(ctx, 12, 13, 8, 5, 0, '#c9b48a', INK, 1.4);
      if (S.level >= 2) shapeCircle(ctx, 0, -11, 3, S.accent, INK, 1.2);
      if (S.level >= 3) shapeRR(ctx, -4, 8, 8, 4, 2, '#ffe27a', INK, 1.2);
    },
    missile: function (ctx, S) {
      shapeRR(ctx, -17, -12, 34, 26, 8, S.main, INK, 2.4);
      shapeRR(ctx, -13, -8, 26, 6, 3, 'rgba(255,255,255,0.4)', null);
      // 弹仓格
      for (var i = 0; i < 4; i++) shapeCircle(ctx, -11 + i * 7.4, 8, 2.4, rgba(S.dark, 0.7));
      // 尾焰口
      shapeRR(ctx, -22, 1, 6, 10, 3, '#6b6b78', INK, 1.6);
      if (S.level >= 2) shapeCircle(ctx, 14, -8, 3.2, '#ffe27a', INK, 1.2);
      if (S.level >= 3) star(ctx, 0, -13, 3.4, '#ffd9d9', S.t * 1.3);
    },
    drum: function (ctx, S) {
      shapeRR(ctx, -15, -14, 30, 30, 9, '#b98a55', INK, 2.4);
      shapeEllipse(ctx, 0, 2, 14, 13, 0, S.main, INK, 2.2);
      shapeEllipse(ctx, 0, 2, 10, 9.4, 0, rgba('#fff6e5', 0.92), null);
      // 鼓钉
      for (var i = 0; i < 8; i++) {
        var a = i * TAU / 8 + 0.3;
        shapeCircle(ctx, Math.cos(a) * 12.4, 2 + Math.sin(a) * 11.4, 1.5, '#8a5a2b');
      }
      gloss(ctx, -4, -3, 5, 4, -0.4, 0.75);
      if (S.level >= 2) {
        shapeRR(ctx, -19, -6, 5, 14, 2, '#ffe27a', INK, 1.3);
        shapeRR(ctx, 14, -6, 5, 14, 2, '#ffe27a', INK, 1.3);
      }
      if (S.level >= 3) star(ctx, 0, 2, 4, '#ffb84d', S.t * 0.8);
    }
  };

  /* 炮塔头部（旋转部分）：以 (0,0) 为转轴，炮口朝 +x */
  var TURRET = {
    // 横躺的玻璃瓶 + 瓶口
    bottle: function (ctx, S) {
      shapeRR(ctx, -14, -10, 26, 20, 9, S.main, INK, 2.4);
      shapeRR(ctx, 9, -6.5, 13, 13, 5.5, S.main, INK, 2.2);
      shapeRR(ctx, 20, -5.5, 6, 11, 3.5, S.dark, INK, 1.8);
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      rr(ctx, -10, -7, 15, 4, 2); ctx.fill();
      shapeEllipse(ctx, -2, 5, 9, 2.6, 0, 'rgba(255,255,255,0.28)');
      if (S.level >= 2) shapeRR(ctx, -16, -8, 4.5, 16, 2, S.accent, INK, 1.5);
      if (S.level >= 3) {
        shapeCircle(ctx, 3, 0, 3.2, 'rgba(255,255,255,0.85)');
        star(ctx, -6, 0, 3, '#ffe27a', S.t * 1.4);
      }
      if (S.firing) muzzleFlash(ctx, 26, 0, 9, S.accent, S.t);
    },
    // 弩：弓臂 + 箭
    arrow: function (ctx, S) {
      ctx.beginPath();
      ctx.moveTo(2, -16); ctx.quadraticCurveTo(-11, 0, 2, 16);
      ctx.strokeStyle = INK; ctx.lineWidth = 4.4; ctx.stroke();
      ctx.strokeStyle = S.main; ctx.lineWidth = 2.6; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(2, -14); ctx.quadraticCurveTo(-8.5, 0, 2, 14); ctx.stroke();
      // 弦
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(2, -16); ctx.lineTo(-4, 0); ctx.lineTo(2, 16); ctx.stroke();
      // 箭杆 + 箭头
      shapeRR(ctx, -9, -2.2, 24, 4.4, 2.2, '#f2e0bb', INK, 1.6);
      shapePoly(ctx, [14, -6, 24, 0, 14, 6], S.accent, INK, 1.8);
      shapePoly(ctx, [-9, 0, -15, -5.5, -11, 0, -15, 5.5], S.main, INK, 1.4);
      if (S.level >= 2) shapeRR(ctx, -2, -9, 8, 3.4, 1.6, S.dark, INK, 1.2);
      if (S.level >= 3) star(ctx, -17, 0, 3.2, '#ffe27a', S.t * 1.5);
      if (S.firing) muzzleFlash(ctx, 22, 0, 9, S.accent, S.t);
    },
    // 转动的三叶扇 + 导流罩
    fan: function (ctx, S) {
      shapeRR(ctx, -13, -13, 20, 26, 9, S.main, INK, 2.3);
      shapeRR(ctx, -10, -9, 8, 6, 3, 'rgba(255,255,255,0.5)', null);
      var spin = S.t * 13;
      for (var i = 0; i < 3; i++) {
        ctx.save();
        ctx.rotate(spin + i * TAU / 3);
        ctx.translate(12, 0);
        shapeEllipse(ctx, 7, 0, 9.5, 4.6, 0, (i === 0 ? '#ffffff' : S.accent), INK, 1.6);
        ctx.restore();
      }
      shapeCircle(ctx, 12, 0, 4.6, S.dark, INK, 1.8);
      shapeCircle(ctx, 11, -1.4, 1.6, 'rgba(255,255,255,0.8)');
      if (S.level >= 2) {
        for (var k = 0; k < 4; k++) {
          var a = spin * 1.4 + k * TAU / 4;
          shapeCircle(ctx, 12 + Math.cos(a) * 12, Math.sin(a) * 12, 1.6, rgba('#ffffff', 0.7));
        }
      }
      if (S.level >= 3) shapeRR(ctx, -17, -3, 4.5, 6, 2, '#ffe27a', INK, 1.2);
      if (S.firing) muzzleFlash(ctx, 21, 0, 9, S.accent, S.t);
    },
    // 六棱冰晶炮 + 寒气
    ice: function (ctx, S) {
      shapePoly(ctx, [-12, -11, 8, -13, 20, 0, 8, 13, -12, 11], S.main, INK, 2.3);
      shapePoly(ctx, [-4, -6, 6, -8, 13, 0, 4, 5, -4, 3], 'rgba(255,255,255,0.6)');
      shapePoly(ctx, [16, -5, 24, 0, 16, 5, 12, 0], S.accent, INK, 1.6);
      var p = (S.t * 0.7) % 1;
      shapeCircle(ctx, 22 + p * 8, -8 - p * 7, 2.4 * (1 - p), rgba('#eafaff', 0.7 * (1 - p)));
      if (S.level >= 2) shapeRR(ctx, -15, -4, 4.5, 8, 2, S.dark, INK, 1.2);
      if (S.level >= 3) star(ctx, 2, 0, 3.4, '#ffffff', S.t * 0.9);
      if (S.firing) muzzleFlash(ctx, 24, 0, 9, S.accent, S.t);
    },
    // 粗炮管 + 炮口制退器 + 后坐
    cannon: function (ctx, S) {
      shapeRR(ctx, -15, -13, 20, 26, 8, S.dark, INK, 2.3);
      shapeRR(ctx, -6, -8, 26, 16, 7, S.main, INK, 2.3);
      shapeRR(ctx, 16, -10, 8, 20, 4, S.dark, INK, 2);
      // 加固环
      shapeRR(ctx, 8, -9.5, 4, 19, 2, rgba('#000000', 0.16), null);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      rr(ctx, -4, -6, 18, 4.2, 2); ctx.fill();
      shapeCircle(ctx, 20, 0, 4.2, '#2f2a26', INK, 1.6);
      if (S.level >= 2) shapeRR(ctx, -2, 9, 12, 5, 2.4, lift(S.main, -0.15), INK, 1.4);
      if (S.level >= 3) {
        shapeRR(ctx, -18, -9, 4.5, 18, 2, '#ffe27a', INK, 1.4);
        star(ctx, -10, -13, 3.4, '#ffe27a', S.t * 1.1);
      }
      if (S.firing) muzzleFlash(ctx, 26, 0, 12, '#ffd08a', S.t);
    },
    // 悬浮宝珠法杖
    magic: function (ctx, S) {
      shapeRR(ctx, -16, -4.5, 22, 9, 4.5, '#8a5a2b', INK, 2);
      shapeRR(ctx, -19, -6, 6, 12, 3, S.dark, INK, 1.6);
      var pulse = 1 + Math.sin(S.t * 5) * 0.09;
      ctx.save();
      ctx.translate(15, 0);
      ctx.strokeStyle = rgba(S.accent, 0.85); ctx.lineWidth = 2.4;
      pathEllipse(ctx, 0, 0, 10 * pulse, 4.4 * pulse, Math.sin(S.t * 2) * 0.6);
      ctx.stroke();
      shapeCircle(ctx, 0, 0, 7.8 * pulse, S.main, INK, 2);
      shapeCircle(ctx, -2.4, -2.6, 3, 'rgba(255,255,255,0.92)');
      for (var i = 0; i < (S.level >= 2 ? 3 : 2); i++) {
        var a = S.t * 2.4 + i * TAU / 3;
        shapeCircle(ctx, Math.cos(a) * 13, Math.sin(a) * 13, 1.7, S.accent);
      }
      ctx.restore();
      if (S.level >= 3) shapeRR(ctx, -8, -13, 6, 6, 2, '#ffe27a', INK, 1.2);
      if (S.firing) muzzleFlash(ctx, 24, 0, 11, S.accent, S.t);
    },
    // 双叉线圈 + 电弧
    tesla: function (ctx, S) {
      shapeRR(ctx, -15, -9, 22, 18, 7, S.dark, INK, 2.3);
      for (var i = 0; i < 3; i++) {
        ctx.strokeStyle = (i % 2 === 0) ? S.accent : S.main;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(-4 + i * 6, 0, 9 - i * 0.8, -1.15, 1.15);
        ctx.stroke();
      }
      // 双叉
      shapeRR(ctx, 14, -10, 9, 4.4, 2.2, S.accent, INK, 1.5);
      shapeRR(ctx, 14, 5.6, 9, 4.4, 2.2, S.accent, INK, 1.5);
      shapeCircle(ctx, 17, 0, 5.6, S.accent, INK, 1.8);
      shapeCircle(ctx, 15.6, -1.6, 1.8, 'rgba(255,255,255,0.85)');
      var flick = Math.sin(S.t * 23) + Math.sin(S.t * 37) * 0.6;
      if (S.firing || flick > 0.9) {
        ctx.strokeStyle = '#fffbe0'; ctx.lineWidth = 1.9;
        ctx.beginPath();
        ctx.moveTo(23, -10); ctx.lineTo(29, -4); ctx.lineTo(25, 0); ctx.lineTo(30, 6);
        ctx.stroke();
      }
      if (S.level >= 3) star(ctx, -11, -12, 3.4, '#fff8c2', S.t * 1.6);
      if (S.firing) muzzleFlash(ctx, 26, 0, 10, S.accent, S.t);
    },
    // 太阳花光束头：光芒轮
    sun: function (ctx, S) {
      ctx.save();
      ctx.translate(14, 0);
      var pulse = 1 + Math.sin(S.t * 4.2) * 0.08;
      for (var i = 0; i < 8; i++) {
        ctx.save();
        ctx.rotate(S.t * 1.7 + i * TAU / 8);
        ctx.fillStyle = (i % 2 === 0) ? S.accent : S.main;
        ctx.beginPath();
        ctx.moveTo(6.5, -2.6);
        ctx.lineTo(13 * pulse, 0);
        ctx.lineTo(6.5, 2.6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      shapeCircle(ctx, 0, 0, 8.4 * pulse, S.main, INK, 2);
      shapeCircle(ctx, 0, 0, 4.6, '#fff6c2');
      shapeCircle(ctx, -2.2, -2.6, 1.8, 'rgba(255,255,255,0.9)');
      ctx.restore();
      shapeRR(ctx, -14, -3, 16, 6, 3, '#8a5a2b', INK, 1.8);
      if (S.level >= 2) shapeCircle(ctx, -13, 0, 3, S.accent, INK, 1.4);
      if (S.firing) muzzleFlash(ctx, 28, 0, 11, '#fff0b8', S.t);
    },
    // 毒菇：歪头菌盖 + 毒囊
    poison: function (ctx, S) {
      shapeRR(ctx, -12, -7, 20, 14, 6, '#f4e0b8', INK, 2.2);
      shapeEllipse(ctx, 8, -2, 15, 10, -0.22, S.main, INK, 2.3);
      shapeEllipse(ctx, 8, -2, 9, 5.6, -0.22, rgba(S.accent, 0.55));
      shapeCircle(ctx, 2, -8, 2.6, 'rgba(255,255,255,0.8)');
      shapeCircle(ctx, 13, 2, 1.8, 'rgba(255,255,255,0.7)');
      shapeRR(ctx, 18, -3.4, 8, 7, 3.4, S.dark, INK, 1.6);
      // 毒滴
      var d = (S.t * 0.9) % 1;
      shapeCircle(ctx, 24, 2 + d * 9, 2.2 * (1 - d * 0.6), rgba(S.accent, 0.75 * (1 - d)));
      if (S.level >= 3) star(ctx, -6, 0, 3, S.accent, S.t);
      if (S.firing) muzzleFlash(ctx, 25, 0, 9, S.accent, S.t);
    },
    // 狙击：细长枪管 + 瞄准镜
    sniper: function (ctx, S) {
      shapeRR(ctx, -14, -8, 18, 16, 7, S.dark, INK, 2.2);
      shapeRR(ctx, -4, -3.4, 30, 6.8, 3.4, S.main, INK, 2);
      shapeRR(ctx, 24, -5, 6, 10, 3, '#2f3f5c', INK, 1.8);
      // 瞄准镜
      shapeRR(ctx, -2, -12, 12, 6, 3, S.accent, INK, 1.6);
      shapeCircle(ctx, 9, -9, 2.4, '#7fe0ff');
      if (S.level >= 2) shapeRR(ctx, -8, 2, 5, 8, 2, S.accent, INK, 1.2);
      if (S.level >= 3) {
        ctx.strokeStyle = 'rgba(255,226,122,0.95)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(26, -12); ctx.lineTo(26, 12); ctx.stroke();
      }
      if (S.firing) muzzleFlash(ctx, 30, 0, 8, S.accent, S.t);
    },
    // 导弹：三联发射管
    missile: function (ctx, S) {
      shapeRR(ctx, -12, -12, 20, 24, 7, S.dark, INK, 2.2);
      for (var i = -1; i <= 1; i++) {
        shapeRR(ctx, 4, i * 7.4 - 3, 20, 6, 3, S.main, INK, 1.8);
        shapeCircle(ctx, 23, i * 7.4, 2.4, '#fff2d9', INK, 1.1);
      }
      shapeRR(ctx, -2, -10, 8, 20, 3, S.accent, INK, 1.4);
      if (S.level >= 3) star(ctx, -6, 0, 3.2, '#ffe27a', S.t * 1.2);
      if (S.firing) {
        muzzleFlash(ctx, 26, -7.4, 7, '#ffd08a', S.t);
        muzzleFlash(ctx, 26, 7.4, 7, '#ffd08a', S.t);
      }
    },
    // 战鼓：鼓槌 + 音波环
    drum: function (ctx, S) {
      shapeRR(ctx, -12, -5, 18, 10, 4, '#8a5a2b', INK, 2);
      shapeRR(ctx, -6, -9, 5, 18, 2.4, '#d9b98a', INK, 1.6);
      // 鼓槌
      var swing = Math.sin(S.t * 6) * 0.35;
      ctx.save();
      ctx.translate(10, 0);
      ctx.rotate(swing);
      shapeRR(ctx, 0, -2, 16, 4, 2, '#f0dcb4', INK, 1.5);
      shapeCircle(ctx, 17, 0, 4.2, S.main, INK, 1.8);
      ctx.restore();
      // 音波
      for (var k = 0; k < 2; k++) {
        var ph = (S.t * 1.2 + k * 0.5) % 1;
        ctx.strokeStyle = rgba(S.accent, 0.75 * (1 - ph));
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(12, 0, 8 + ph * 20, -0.9, 0.9);
        ctx.stroke();
      }
      if (S.level >= 3) star(ctx, -8, 0, 3.2, '#ffe27a', S.t);
      if (S.firing) muzzleFlash(ctx, 22, 0, 8, '#ffe6b8', S.t);
    }
  };

  /* -------------------------------------------------------------------------
   * drawTower —— 12 种 × 3 级
   * ctx, towerId, level(1..3), x, y, t(秒), opts:{angle, firing, teamColor}
   * ---------------------------------------------------------------------- */
  function drawTower(ctx, towerId, level, x, y, t, opts) {
    opts = opts || {};
    var id = TOWERS[towerId] ? towerId : 'bottle';
    var P = TOWERS[id];
    var lv = clamp(Math.round(num(level, 1)), 1, 3) - 1;
    t = num(t, 0);
    var main = lift(P.main, lv * 0.10);
    var dark = lift(P.dark, lv * 0.08);
    var accent = lift(P.accent, lv * 0.06);
    var firing = !!opts.firing;
    var angle = num(opts.angle, -Math.PI / 2);
    var bob = Math.sin(t * 2.2 + (x + y) * 0.02) * 0.7;
    var grow = 1 + lv * 0.06;
    var liftY = lv * 4;

    ctx.save();
    ctx.translate(x, y);

    // ---- 底座：石台（三级逐级加高、加金饰）
    dropShadow(ctx, 0, 20, 23, 7.5);
    shapeEllipse(ctx, 0, 14, 23, 9, 0, '#c8a878', INK, 2.4);
    shapeEllipse(ctx, 0, 11, 21, 8, 0, '#efdfc2', INK, 2.2);
    shapeEllipse(ctx, 0, 10, 16, 5.6, 0, '#fbfff0', null);
    // 台面高光
    shapeEllipse(ctx, -6, 8, 8, 2.6, -0.2, 'rgba(255,255,255,0.62)');
    // 螺柱装饰（随等级增加）
    var studs = 3 + lv * 3;
    for (var i = 0; i < studs; i++) {
      var sa = -Math.PI * 0.92 + (i / Math.max(1, studs - 1)) * Math.PI * 1.84;
      var sx = Math.cos(sa) * 19.5;
      var sy = 14 + Math.sin(sa) * 5.4;
      shapeCircle(ctx, sx, sy, 2.2, (lv >= 2 ? C.gold : dark), INK, 1);
    }
    if (lv >= 1) {
      // 2 级：金环 + 两侧能量珠
      ctx.strokeStyle = 'rgba(255,215,80,0.95)';
      ctx.lineWidth = 2.2;
      pathEllipse(ctx, 0, 11, 21, 8, 0);
      ctx.stroke();
      shapeCircle(ctx, -20, 12, 3.6, '#ffe27a', INK, 1.4);
      shapeCircle(ctx, 20, 12, 3.6, '#ffe27a', INK, 1.4);
    }
    if (lv >= 2) {
      // 3 级：内环 + 四颗宝石
      ctx.strokeStyle = 'rgba(255,246,200,0.8)';
      ctx.lineWidth = 1.6;
      pathEllipse(ctx, 0, 10, 15, 5.2, 0);
      ctx.stroke();
      for (var g = 0; g < 4; g++) {
        var ga = g * TAU / 4 + t * 0.8;
        shapeCircle(ctx, Math.cos(ga) * 17, 13 + Math.sin(ga) * 4.5, 2.2, '#ffffff');
      }
    }

    // ---- 塔身
    ctx.save();
    ctx.translate(0, -6 - liftY + bob * 0.4);
    ctx.scale(grow, grow);
    // 胶圈
    shapeEllipse(ctx, 0, 15, 16 * grow, 6, 0, rgba(dark, 0.45));
    (BODY[id] || BODY.bottle)(ctx, {
      main: main, dark: dark, accent: accent, level: lv + 1, t: t
    });

    // ---- 炮塔（朝向 + 后坐）
    ctx.save();
    ctx.rotate(angle);
    if (firing) ctx.translate(-3.6, 0);
    (TURRET[id] || TURRET.bottle)(ctx, {
      main: main, dark: dark, accent: accent, level: lv + 1, t: t, firing: firing
    });
    ctx.restore();

    ctx.restore();  // 塔身

    // ---- 满级：头顶星光
    if (lv >= 2) {
      var tw = 0.6 + 0.4 * Math.abs(Math.sin(t * 2));
      ctx.globalAlpha = tw;
      star(ctx, 0, -44 - bob, 5, '#ffe27a', t * 0.9);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }
  /* =========================================================================
   * 怪物：12 种 + 3 Boss
   * 统一「圆润兔子」骨架：大脑袋、大眼、腮红、深描边 + 顶部高光 + 底部阴影
   * ====================================================================== */
  var ENEMIES = {
    rabbit:        { body: '#ffffff', accent: '#ffb3cd', eye: '#3b2f2a', kind: 'plain',    hop: 6.0,  rk: 1.00 },
    rabbitFast:    { body: '#eaf8ff', accent: '#5ec8ff', eye: '#3b2f2a', kind: 'fast',     hop: 10.0, rk: 0.96 },
    rabbitTank:    { body: '#cfd8dc', accent: '#78909c', eye: '#3b2f2a', kind: 'tank',     hop: 3.0,  rk: 1.12 },
    rabbitJump:    { body: '#fff3c4', accent: '#ffb74d', eye: '#3b2f2a', kind: 'jump',     hop: 8.5,  rk: 1.00 },
    rabbitHeal:    { body: '#e6ffe6', accent: '#5ec269', eye: '#3b2f2a', kind: 'heal',     hop: 5.2,  rk: 1.02 },
    rabbitShield:  { body: '#ffe0b2', accent: '#a1887f', eye: '#3b2f2a', kind: 'shield',   hop: 5.0,  rk: 1.06 },
    rabbitFly:     { body: '#ffe9f4', accent: '#ff9ec4', eye: '#3b2f2a', kind: 'fly',      hop: 4.0,  rk: 1.00 },
    rabbitSplit:   { body: '#d9ffe0', accent: '#7be08a', eye: '#3b2f2a', kind: 'split',    hop: 6.4,  rk: 1.02 },
    rabbitGhost:   { body: '#dfe9ff', accent: '#9fb8ff', eye: '#5a6fa8', kind: 'ghost',    hop: 4.6,  rk: 1.02 },
    rabbitBerserk: { body: '#ffd9d9', accent: '#ff5a5a', eye: '#3b2f2a', kind: 'berserk',  hop: 9.0,  rk: 1.04 },
    rabbitArmored: { body: '#c3ccd8', accent: '#5d6b7d', eye: '#3b2f2a', kind: 'armored',  hop: 3.6,  rk: 1.10 },
    rabbitBoss:    { body: '#fff0f5', accent: '#ff5c8a', eye: '#3b2f2a', kind: 'boss',     hop: 4.4,  rk: 1.55, boss: true, bar: 1.82 },
    rabbitKing:    { body: '#fff6e0', accent: '#ffa62e', eye: '#3b2f2a', kind: 'king',     hop: 4.0,  rk: 1.80, boss: true, bar: 2.34 },
    finalBoss:     { body: '#7a5cc4', accent: '#ffd93d', eye: '#ffe9a8', kind: 'final',    hop: 3.6,  rk: 2.15, boss: true, bar: 1.96 }
  };
  // 受伤闪白：整体替换成纯白配色
  var WHITE = { body: '#ffffff', accent: '#ffffff', eye: '#ffffff', kind: 'plain', hop: 0, rk: 1 };

  /* 血条（怪物 / 建筑共用） */
  function hpBar(ctx, w, y, ratio) {
    var h = 6;
    shapeRR(ctx, -w / 2 - 2, y - 2, w + 4, h + 4, 4, 'rgba(59,47,42,0.70)');
    shapeRR(ctx, -w / 2, y, w, h, 3, '#2b2420');
    var col = ratio > 0.6 ? '#5ec269' : (ratio > 0.3 ? '#ffb02e' : '#ff5a5a');
    var fw = Math.max(3, w * clamp(ratio, 0, 1));
    shapeRR(ctx, -w / 2, y, fw, h, 3, col);
    shapeRR(ctx, -w / 2 + 1, y + 1, Math.max(2, fw - 2), 2, 1, 'rgba(255,255,255,0.55)');
  }

  /* 兔子骨架：pal 决定配色（闪白时传 WHITE） */
  function rabbitCore(ctx, r, pal, kind, t, facing, isBoss) {
    var earTilt = Math.sin(t * 7) * 0.09;
    var droopEar = (kind === 'tank' || kind === 'armored') ? 0.55 : 1;

    // 尾巴
    shapeCircle(ctx, -r * 0.92, r * 0.20, r * 0.26, pal.body, INK, 2);
    // 耳朵（后 / 前）
    ctx.save();
    ctx.rotate(-0.26 * droopEar + earTilt);
    shapeEllipse(ctx, -r * 0.34, -r * 1.10, r * 0.21, r * 0.54, 0, pal.body, INK, 2.2);
    shapeEllipse(ctx, -r * 0.34, -r * 1.08, r * 0.10, r * 0.37, 0, pal.accent);
    ctx.restore();
    ctx.save();
    ctx.rotate(0.18 * droopEar - earTilt * 0.8);
    shapeEllipse(ctx, r * 0.32, -r * 1.14, r * 0.21, r * 0.56, 0, pal.body, INK, 2.2);
    shapeEllipse(ctx, r * 0.32, -r * 1.12, r * 0.10, r * 0.38, 0, pal.accent);
    ctx.restore();

    // 身体
    shapeEllipse(ctx, 0, 0, r * 0.96, r * 0.92, 0, pal.body, INK, 2.6);
    // 底部阴影
    shapeEllipse(ctx, 0, r * 0.46, r * 0.66, r * 0.40, 0, rgba(mix(pal.body, '#000000', 0.16), 0.55));
    // 肚子
    shapeEllipse(ctx, 0, r * 0.40, r * 0.54, r * 0.36, 0, pal.accent);
    // 顶部高光
    shapeEllipse(ctx, -r * 0.34, -r * 0.44, r * 0.36, r * 0.24, -0.5, 'rgba(255,255,255,0.58)');

    // 后脚
    shapeEllipse(ctx, -r * 0.50, r * 0.84, r * 0.29, r * 0.17, -0.16, pal.body, INK, 2);
    shapeEllipse(ctx, r * 0.50, r * 0.84, r * 0.29, r * 0.17, 0.16, pal.body, INK, 2);

    // 眼睛（大而圆，带高光）
    var fx = facing * r * 0.05;
    var er = r * (isBoss ? 0.28 : 0.24);
    var ex1 = -r * 0.30 + fx, ex2 = r * 0.30 + fx, ey = -r * 0.12;
    shapeEllipse(ctx, ex1, ey, er * 0.86, er, 0, '#ffffff', INK, 1.8);
    shapeEllipse(ctx, ex2, ey, er * 0.86, er, 0, '#ffffff', INK, 1.8);
    if (kind === 'berserk') {
      shapeEllipse(ctx, ex1, ey + r * 0.02, er * 0.30, er * 0.66, 0, '#e03030');
      shapeEllipse(ctx, ex2, ey + r * 0.02, er * 0.30, er * 0.66, 0, '#e03030');
      ctx.strokeStyle = INK; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(ex1 - er, ey - er * 1.2); ctx.lineTo(ex1 + er * 0.7, ey - er * 0.7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex2 + er, ey - er * 1.2); ctx.lineTo(ex2 - er * 0.7, ey - er * 0.7); ctx.stroke();
    } else if (kind === 'ghost') {
      shapeCircle(ctx, ex1 + facing * 1.2, ey, er * 0.62, pal.eye);
      shapeCircle(ctx, ex2 + facing * 1.2, ey, er * 0.62, pal.eye);
      shapeCircle(ctx, ex1 + facing * 1.2 - er * 0.2, ey - er * 0.24, er * 0.2, 'rgba(255,255,255,0.85)');
      shapeCircle(ctx, ex2 + facing * 1.2 - er * 0.2, ey - er * 0.24, er * 0.2, 'rgba(255,255,255,0.85)');
    } else if (kind === 'final') {
      shapeEllipse(ctx, ex1, ey, er * 0.28, er * 0.82, 0, '#ffdf5a');
      shapeEllipse(ctx, ex2, ey, er * 0.28, er * 0.82, 0, '#ffdf5a');
      shapeEllipse(ctx, ex1, ey, er * 0.11, er * 0.62, 0, '#8f1d1d');
      shapeEllipse(ctx, ex2, ey, er * 0.11, er * 0.62, 0, '#8f1d1d');
    } else {
      shapeCircle(ctx, ex1 + facing * r * 0.06, ey, er * 0.56, pal.eye);
      shapeCircle(ctx, ex2 + facing * r * 0.06, ey, er * 0.56, pal.eye);
      shapeCircle(ctx, ex1 + facing * r * 0.06 - er * 0.22, ey - er * 0.26, er * 0.24, '#ffffff');
      shapeCircle(ctx, ex2 + facing * r * 0.06 - er * 0.22, ey - er * 0.26, er * 0.24, '#ffffff');
      shapeCircle(ctx, ex1 + facing * r * 0.06 + er * 0.24, ey + er * 0.24, er * 0.12, 'rgba(255,255,255,0.75)');
      shapeCircle(ctx, ex2 + facing * r * 0.06 + er * 0.24, ey + er * 0.24, er * 0.12, 'rgba(255,255,255,0.75)');
    }

    // 腮红
    shapeEllipse(ctx, -r * 0.62 + fx, r * 0.16, r * 0.15, r * 0.09, 0, 'rgba(255,130,160,0.55)');
    shapeEllipse(ctx, r * 0.62 + fx, r * 0.16, r * 0.15, r * 0.09, 0, 'rgba(255,130,160,0.55)');

    // 鼻子 + 嘴
    shapeEllipse(ctx, fx, r * 0.08, r * 0.10, r * 0.08, 0, '#ff8fb4', INK, 1.2);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(fx, r * 0.16);
    ctx.quadraticCurveTo(fx - r * 0.16, r * 0.32, fx - r * 0.28, r * 0.18);
    ctx.moveTo(fx, r * 0.16);
    ctx.quadraticCurveTo(fx + r * 0.16, r * 0.32, fx + r * 0.28, r * 0.18);
    ctx.stroke();
  }

  /* 各变体的标志性装饰
   * backDeco  = 画在身体之前（披风、翅膀、光环、药箱底座）
   * frontDeco = 画在身体之后（皇冠、龙角、护盾、纹路、头盔）
   */
  function enemyBackDeco(ctx, r, pal, kind, t, facing) {
    var i, a;
    if (kind === 'heal') {
      var pulse = 0.55 + Math.sin(t * 3) * 0.35;
      ctx.strokeStyle = 'rgba(127,224,168,' + (0.30 + pulse * 0.45).toFixed(2) + ')';
      ctx.lineWidth = 2.4;
      pathEllipse(ctx, 0, r * 1.0, r * 1.25, r * 0.34, 0);
      ctx.stroke();
      for (i = 0; i < 3; i++) {
        a = t * 2.2 + i * TAU / 3;
        shapeCircle(ctx, Math.cos(a) * r * 1.2, -r * 0.2 + Math.sin(a) * r * 0.5, 2.2, 'rgba(191,242,210,0.95)', INK, 0.8);
      }
    } else if (kind === 'fly') {
      var flap = Math.sin(t * 12) * 0.38;
      ctx.save(); ctx.rotate(-0.5 + flap);
      shapeEllipse(ctx, -r * 1.0, -r * 0.56, r * 0.56, r * 0.30, -0.5, 'rgba(255,255,255,0.94)', INK, 2);
      ctx.restore();
      ctx.save(); ctx.rotate(0.42 - flap);
      shapeEllipse(ctx, r * 0.66, -r * 0.76, r * 0.54, r * 0.28, 0.4, 'rgba(255,255,255,0.94)', INK, 2);
      ctx.restore();
    } else if (kind === 'berserk') {
      var rage = 0.5 + Math.sin(t * 9) * 0.3;
      ctx.strokeStyle = 'rgba(255,80,80,' + (0.35 + rage * 0.35).toFixed(2) + ')';
      ctx.lineWidth = 3;
      pathEllipse(ctx, 0, r * 0.95, r * 1.15, r * 0.30, 0);
      ctx.stroke();
      for (i = 0; i < 3; i++) {
        var fa = -Math.PI / 2 + (i - 1) * 0.5 + Math.sin(t * 6 + i) * 0.12;
        var fxx = Math.cos(fa) * r * 0.5, fyy = -r * 1.45 + Math.sin(fa) * r * 0.12;
        shapePoly(ctx, [fxx - r * 0.16, fyy + r * 0.26, fxx, fyy - r * 0.26, fxx + r * 0.16, fyy + r * 0.26],
          'rgba(255,120,60,0.92)', '#c2410c', 1.4);
      }
    } else if (kind === 'ghost') {
      ctx.strokeStyle = 'rgba(159,184,255,0.55)'; ctx.lineWidth = 2.4;
      for (i = 0; i < 3; i++) {
        var ph = (t * 0.7 + i * 0.33) % 1;
        ctx.beginPath();
        ctx.moveTo(-r * 0.7 + i * r * 0.7, r * 0.8);
        ctx.quadraticCurveTo(-r * 0.5 + i * r * 0.7, r * (1.1 + ph * 0.4), -r * 0.9 + i * r * 0.7, r * (1.3 + ph * 0.5));
        ctx.stroke();
      }
    } else if (kind === 'boss') {
      // 披风
      shapePoly(ctx, [-r * 0.90, r * 0.02, r * 0.90, r * 0.02, r * 1.10, r * 1.06, -r * 1.10, r * 1.06], '#d6345f', INK, 2.4);
      shapePoly(ctx, [-r * 0.36, r * 0.08, 0, r * 0.08, 0, r * 1.0, -r * 0.36, r * 1.0], 'rgba(255,255,255,0.22)');
    } else if (kind === 'king') {
      // 红披风（带金边）
      shapePoly(ctx, [-r * 1.02, r * 0.02, r * 1.02, r * 0.02, r * 1.20, r * 1.12, -r * 1.20, r * 1.12], '#e04a6e', INK, 2.6);
      shapePoly(ctx, [-r * 0.34, r * 0.06, 0, r * 0.06, 0, r * 1.04, -r * 0.34, r * 1.04], 'rgba(255,255,255,0.30)');
      ctx.strokeStyle = '#ffd93d'; ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-r * 1.14, r * 1.02); ctx.lineTo(r * 1.14, r * 1.02);
      ctx.stroke();
    } else if (kind === 'final') {
      var flap2 = Math.sin(t * 3.4) * 0.18;
      // 龙翼（先画，压在身体后面）
      ctx.save(); ctx.rotate(-0.30 + flap2);
      shapePoly(ctx, [-r * 0.55, -r * 0.30, -r * 1.85, -r * 1.05, -r * 1.60, -r * 0.10, -r * 1.95, r * 0.42, -r * 0.55, r * 0.30],
        '#5b3f9c', INK, 2.6);
      shapePoly(ctx, [-r * 0.9, -r * 0.5, -r * 1.6, -r * 0.85, -r * 1.35, -r * 0.05], 'rgba(255,190,80,0.30)');
      ctx.restore();
      ctx.save(); ctx.rotate(0.30 - flap2);
      shapePoly(ctx, [r * 0.55, -r * 0.30, r * 1.85, -r * 1.05, r * 1.60, -r * 0.10, r * 1.95, r * 0.42, r * 0.55, r * 0.30],
        '#5b3f9c', INK, 2.6);
      shapePoly(ctx, [r * 0.9, -r * 0.5, r * 1.6, -r * 0.85, r * 1.35, -r * 0.05], 'rgba(255,190,80,0.30)');
      ctx.restore();
      // 暗影火焰
      for (i = 0; i < 4; i++) {
        var aa = t * 2.2 + i * TAU / 4;
        shapeCircle(ctx, Math.cos(aa) * r * 1.40, Math.sin(aa) * r * 1.08, 3, 'rgba(255,140,60,0.55)');
      }
    }
  }

  function enemyFrontDeco(ctx, r, pal, kind, t, facing) {
    var i;
    if (kind === 'fast') {
      // 速度围巾 + 速度线
      shapeRR(ctx, -r * 0.74, r * 0.28, r * 1.48, r * 0.24, r * 0.12, '#ff7aa8', INK, 1.8);
      shapeEllipse(ctx, -r * 1.12, r * 0.38, r * 0.34, r * 0.11, 0.36, '#ff7aa8', INK, 1.6);
      ctx.strokeStyle = 'rgba(120,220,255,0.85)'; ctx.lineWidth = 2.2;
      for (i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-r * (1.25 + i * 0.16), -r * 0.44 + i * r * 0.34);
        ctx.lineTo(-r * (1.85 + i * 0.16), -r * 0.44 + i * r * 0.34);
        ctx.stroke();
      }
    } else if (kind === 'tank' || kind === 'armored') {
      // 头盔 + 铆钉
      ctx.beginPath();
      ctx.arc(0, -r * 0.34, r * 0.92, Math.PI * 1.04, Math.PI * 1.96);
      ctx.closePath();
      ctx.fillStyle = (kind === 'armored') ? '#8e9bb0' : '#9aa8ba';
      ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 2.4; ctx.stroke();
      shapeRR(ctx, -r * 0.98, -r * 0.50, r * 1.96, r * 0.24, r * 0.12,
        (kind === 'armored' ? '#6d7a8c' : '#7b8798'), INK, 2);
      gloss(ctx, -r * 0.34, -r * 0.80, r * 0.36, r * 0.14, -0.35, 0.5);
      // 胸甲
      shapeRR(ctx, -r * 0.62, r * 0.34, r * 1.24, r * 0.38, r * 0.18,
        (kind === 'armored' ? '#b7c3d4' : '#c8d3e0'), INK, 2);
      shapeCircle(ctx, -r * 0.34, r * 0.52, r * 0.07, '#8fa0b4');
      shapeCircle(ctx, r * 0.34, r * 0.52, r * 0.07, '#8fa0b4');
      if (kind === 'armored') {
        shapeEllipse(ctx, -r * 0.92, r * 0.16, r * 0.30, r * 0.22, -0.3, '#7d8a9c', INK, 2);
        shapeEllipse(ctx, r * 0.92, r * 0.16, r * 0.30, r * 0.22, 0.3, '#7d8a9c', INK, 2);
        shapeCircle(ctx, 0, r * 0.70, r * 0.11, '#ffd93d', INK, 1.4);
      }
    } else if (kind === 'jump') {
      // 弹簧 + 弹跳弧
      ctx.strokeStyle = '#c2691c'; ctx.lineWidth = 2.2;
      for (i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(-r * 0.50, r * 1.06, r * (0.09 + i * 0.045), Math.PI * 0.06, Math.PI * 0.94, true);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(r * 0.50, r * 1.06, r * (0.09 + i * 0.045), Math.PI * 0.06, Math.PI * 0.94, true);
        ctx.stroke();
      }
      shapeRR(ctx, -r * 0.70, r * 0.90, r * 0.44, r * 0.26, r * 0.12, '#ffb74d', INK, 1.8);
      shapeRR(ctx, r * 0.26, r * 0.90, r * 0.44, r * 0.26, r * 0.12, '#ffb74d', INK, 1.8);
      ctx.strokeStyle = 'rgba(255,183,77,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, r * 1.10, r * 0.92, 0.28, Math.PI - 0.28); ctx.stroke();
    } else if (kind === 'heal') {
      // 药箱 + 十字
      shapeRR(ctx, -r * 0.34, r * 0.12, r * 0.68, r * 0.56, r * 0.14, '#fff6e5', INK, 2);
      shapeRR(ctx, -r * 0.10, r * 0.18, r * 0.20, r * 0.44, r * 0.06, '#3fbf74');
      shapeRR(ctx, -r * 0.28, r * 0.30, r * 0.56, r * 0.20, r * 0.06, '#3fbf74');
    } else if (kind === 'shield') {
      // 木盾（挡在身前）
      ctx.save();
      ctx.translate(r * 0.44 * facing, r * 0.16);
      shapePoly(ctx, [-r * 0.36, -r * 0.44, r * 0.40, -r * 0.38, r * 0.48, r * 0.10, r * 0.06, r * 0.54, -r * 0.34, r * 0.24],
        '#c9964f', INK, 2.4);
      shapePoly(ctx, [-r * 0.22, -r * 0.26, r * 0.26, -r * 0.22, r * 0.30, r * 0.08, r * 0.02, r * 0.34, -r * 0.18, r * 0.14],
        'rgba(255,255,255,0.30)');
      shapeCircle(ctx, r * 0.04, 0, r * 0.12, '#8fa0b4', INK, 1.4);
      ctx.restore();
    } else if (kind === 'split') {
      ctx.strokeStyle = 'rgba(59,47,42,0.72)'; ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.72);
      ctx.lineTo(-r * 0.10, -r * 0.18);
      ctx.lineTo(r * 0.10, r * 0.18);
      ctx.lineTo(0, r * 0.66);
      ctx.stroke();
      for (i = 0; i < 4; i++) {
        var sa = t * 1.6 + i * TAU / 4;
        shapeCircle(ctx, Math.cos(sa) * r * 1.34, Math.sin(sa) * r * 0.94, 2.2, 'rgba(123,224,138,0.9)', INK, 0.7);
      }
    } else if (kind === 'ghost') {
      shapeCircle(ctx, -r * 1.15, -r * 0.5, r * 0.12, 'rgba(255,255,255,0.8)');
      shapeCircle(ctx, r * 1.15, -r * 0.22, r * 0.09, 'rgba(255,255,255,0.7)');
    } else if (kind === 'boss') {
      // 皇冠（画在头顶之上）
      shapePoly(ctx, [-r * 0.62, -r * 1.32, -r * 0.62, -r * 0.92, -r * 0.28, -r * 1.16, 0, -r * 1.56,
        r * 0.28, -r * 1.16, r * 0.62, -r * 0.92, r * 0.62, -r * 1.32], '#ffd93d', '#8a6a00', 2.4);
      shapeCircle(ctx, 0, -r * 1.20, r * 0.09, '#ff5a8a');
      shapeCircle(ctx, -r * 0.42, -r * 1.26, r * 0.07, '#7fd8ff');
      shapeCircle(ctx, r * 0.42, -r * 1.26, r * 0.07, '#7fd8ff');
      gloss(ctx, -r * 0.28, -r * 1.24, r * 0.18, r * 0.06, -0.2, 0.55);
      star(ctx, 0, r * 0.56, r * 0.20, '#ffd93d', t * 0.6);
    } else if (kind === 'king') {
      // 巨冠
      ctx.save();
      ctx.translate(0, -r * 1.58);
      shapePoly(ctx, [-r * 0.88, r * 0.36, -r * 0.88, -r * 0.32, -r * 0.44, r * 0.02, 0, -r * 0.58,
        r * 0.44, r * 0.02, r * 0.88, -r * 0.32, r * 0.88, r * 0.36], '#ffd93d', '#8a6a00', 2.6);
      shapeCircle(ctx, 0, r * 0.10, r * 0.13, '#ff5a8a', INK, 1.4);
      shapeCircle(ctx, -r * 0.58, r * 0.18, r * 0.09, '#7fd8ff', INK, 1.2);
      shapeCircle(ctx, r * 0.58, r * 0.18, r * 0.09, '#7fd8ff', INK, 1.2);
      gloss(ctx, -r * 0.30, -r * 0.16, r * 0.24, r * 0.07, -0.2, 0.6);
      ctx.restore();
      star(ctx, 0, r * 0.58, r * 0.24, '#ffd93d', t * 0.7);
      // 权杖
      shapeRR(ctx, r * 1.08, -r * 0.62, r * 0.12, r * 1.34, r * 0.06, '#b98a55', INK, 1.8);
      shapeCircle(ctx, r * 1.14, -r * 0.74, r * 0.20, '#ffd93d', '#8a6a00', 2);
    } else if (kind === 'final') {
      // 龙角
      shapePoly(ctx, [-r * 0.50, -r * 0.74, -r * 0.76, -r * 1.66, -r * 0.22, -r * 1.00], '#ffe9a8', '#8a6a00', 2.2);
      shapePoly(ctx, [r * 0.50, -r * 0.74, r * 0.76, -r * 1.66, r * 0.22, -r * 1.00], '#ffe9a8', '#8a6a00', 2.2);
      // 头顶宝石
      shapePoly(ctx, [0, -r * 1.00, r * 0.22, -r * 1.30, 0, -r * 1.54, -r * 0.22, -r * 1.30], '#ffd93d', '#8a6a00', 2);
      gloss(ctx, -r * 0.08, -r * 1.32, r * 0.07, r * 0.12, 0, 0.65);
      // 背棘
      for (i = 0; i < 3; i++) {
        shapePoly(ctx, [-r * 0.34 + i * r * 0.30, r * 0.34, -r * 0.18 + i * r * 0.30, r * 0.04, -r * 0.02 + i * r * 0.30, r * 0.34],
          '#ffd93d', '#8a6a00', 1.4);
      }
      // 胸前能量核
      var core = 0.6 + Math.sin(t * 4) * 0.3;
      shapeCircle(ctx, 0, r * 0.50, r * 0.26 + core * 2, 'rgba(255,217,61,' + (0.30 + core * 0.25).toFixed(2) + ')');
      shapeCircle(ctx, 0, r * 0.50, r * 0.15, '#ffd93d', '#8a6a00', 1.8);
    }
  }
  /* -------------------------------------------------------------------------
   * drawEnemy —— 15 种
   * ctx, enemyId, x, y, t, opts:{hp, facing, size, frozen, hitFlash, slowed, shield}
   * ---------------------------------------------------------------------- */
  function drawEnemy(ctx, enemyId, x, y, t, opts) {
    opts = opts || {};
    var def = ENEMIES[enemyId] || ENEMIES.rabbit;
    var kind = def.kind;
    var isBoss = !!def.boss;
    var rBase = (typeof opts.size === 'number' && opts.size > 0) ? opts.size : 16;
    var r = rBase * def.rk;
    var facing = opts.facing === -1 ? -1 : 1;
    var hp = (typeof opts.hp === 'number') ? clamp(opts.hp, 0, 1) : 1;
    var flash = clamp(num(opts.hitFlash, 0), 0, 1);
    var frozen = !!opts.frozen;
    t = num(t, 0);

    var hop = Math.abs(Math.sin(t * def.hop)) * r * 0.20;
    if (kind === 'fly') hop = Math.sin(t * 3.4) * r * 0.16 + r * 0.26;
    if (kind === 'jump') hop = Math.abs(Math.sin(t * def.hop)) * r * 0.34;
    if (kind === 'ghost') hop = Math.sin(t * 2.2) * r * 0.10;

    ctx.save();
    ctx.translate(x, y);

    var shK = clamp(1 - hop / (r * 1.4), 0.40, 1);
    shapeEllipse(ctx, 0, r * 0.92, r * 0.86 * shK, r * 0.26 * shK, 0,
      'rgba(59,47,42,' + (0.24 * shK).toFixed(3) + ')');

    if (isBoss) {
      var aura = 0.45 + Math.sin(t * 2.6) * 0.2;
      shapeEllipse(ctx, 0, r * 0.94, r * 1.35, r * 0.36, 0, 'rgba(255,210,74,' + (0.18 + aura * 0.18).toFixed(3) + ')');
      ctx.strokeStyle = 'rgba(255,226,122,' + (0.55 + aura * 0.3).toFixed(2) + ')';
      ctx.lineWidth = 2.6;
      pathEllipse(ctx, 0, r * 0.94, r * 1.35, r * 0.36, 0);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(0, -hop);
    if (kind === 'ghost') ctx.globalAlpha = 0.78;
    if (facing === -1) ctx.scale(-1, 1);

    enemyBackDeco(ctx, r, def, kind, t, facing);
    rabbitCore(ctx, r, def, kind, t, facing, isBoss);
    enemyFrontDeco(ctx, r, def, kind, t, facing);

    if (flash > 0.01) {
      ctx.save();
      ctx.globalAlpha = flash * 0.85;
      rabbitCore(ctx, r, WHITE, kind, t, facing, isBoss);
      ctx.restore();
    }

    if (frozen) {
      shapeRR(ctx, -r * 1.10, -r * 1.70, r * 2.20, r * 2.72, r * 0.5,
        'rgba(150,215,255,0.42)', 'rgba(235,250,255,0.92)', 2.2);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 1.55); ctx.lineTo(r * 0.1, -r * 0.3); ctx.lineTo(-r * 0.35, r * 0.7);
      ctx.stroke();
      shapeCircle(ctx, r * 0.55, -r * 1.1, r * 0.12, 'rgba(255,255,255,0.85)');
    }

    if (typeof opts.shield === 'number' && opts.shield > 0) {
      ctx.strokeStyle = 'rgba(120,210,255,0.9)';
      ctx.lineWidth = 2.4;
      pathEllipse(ctx, 0, 0, r * 1.18, r * 1.10, 0);
      ctx.stroke();
    }

    // 血条：默认不画——由 render.js 统一绘制（含护盾条，只有一份，
    // 避免精灵和渲染层各画一条导致"双血条"）。需要时传 opts.hpBar=true。
    if (opts.hpBar) {
      var barW = Math.max(22, r * 1.9);
      var barY = -r * (def.bar || 1.95) - 6;
      hpBar(ctx, barW, barY, hp);
    }

    ctx.restore();
    ctx.restore();
  }

  /* -------------------------------------------------------------------------
   * drawCarrot —— 守护萝卜
   * opts:{hp 0..1, hurtFlash, shield}
   * ---------------------------------------------------------------------- */
  function drawCarrot(ctx, x, y, t, opts) {
    opts = opts || {};
    var hp = (typeof opts.hp === 'number') ? clamp(opts.hp, 0, 1) : 1;
    var hurt = clamp(num(opts.hurtFlash, 0), 0, 1);
    t = num(t, 0);
    var sway = Math.sin(t * 1.7) * 0.10;
    var breathe = 1 + Math.sin(t * 2.2) * 0.015;
    var low = hp < 0.35;

    ctx.save();
    ctx.translate(x, y);
    dropShadow(ctx, 0, 36, 32, 10);

    ctx.save();
    ctx.scale(breathe, breathe);

    var leafRot = [-0.66, -0.24, 0.20, 0.58, 0.86];
    for (var i = 0; i < leafRot.length; i++) {
      var rot = leafRot[i] + sway * (i % 2 === 0 ? 1 : -1) * 0.8;
      ctx.save();
      ctx.translate(0, -20);
      ctx.rotate(rot);
      shapeEllipse(ctx, 0, -16, 7.5, 18, 0, (i % 2 === 0) ? '#5ec269' : '#4fb95c', '#2b6b33', 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(0, -31); ctx.lineTo(0, -4); ctx.stroke();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.moveTo(-27, -15);
    ctx.bezierCurveTo(-32, 6, -16, 25, 0, 38);
    ctx.bezierCurveTo(16, 25, 32, 6, 27, -15);
    ctx.quadraticCurveTo(0, -32, -27, -15);
    ctx.closePath();
    ctx.fillStyle = '#ff9f43';
    ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 2.8; ctx.stroke();

    shapeEllipse(ctx, 0, 22, 17, 10, 0, 'rgba(200,90,10,0.30)');
    ctx.strokeStyle = 'rgba(196,100,16,0.55)'; ctx.lineWidth = 2;
    for (var k = 0; k < 3; k++) {
      var yy = -6 + k * 12, halfW = 22 - k * 6;
      ctx.beginPath();
      ctx.moveTo(-halfW, yy);
      ctx.quadraticCurveTo(0, yy + 5, halfW, yy);
      ctx.stroke();
    }
    shapeEllipse(ctx, -9, -15, 11, 7, -0.5, 'rgba(255,255,255,0.5)');
    shapeCircle(ctx, -14, -10, 3, 'rgba(255,255,255,0.6)');

    var ex = low ? 0 : Math.sin(t * 0.9) * 1.4;
    if (low) {
      ctx.strokeStyle = INK; ctx.lineWidth = 2.6;
      var oxs = [-10, 10];
      for (var j = 0; j < 2; j++) {
        var ox = oxs[j];
        ctx.beginPath();
        ctx.moveTo(ox - 4.4 + ex, -4); ctx.lineTo(ox + 4.4 + ex, 4);
        ctx.moveTo(ox + 4.4 + ex, -4); ctx.lineTo(ox - 4.4 + ex, 4);
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(ex, 14, 6, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
    } else {
      shapeEllipse(ctx, -10 + ex, 0, 4.4, 5, 0, '#ffffff', INK, 1.8);
      shapeEllipse(ctx, 10 + ex, 0, 4.4, 5, 0, '#ffffff', INK, 1.8);
      shapeCircle(ctx, -10 + ex + 0.4, 0.4, 2.6, INK);
      shapeCircle(ctx, 10 + ex + 0.4, 0.4, 2.6, INK);
      shapeCircle(ctx, -11.4 + ex, -1.2, 1.2, '#ffffff');
      shapeCircle(ctx, 8.6 + ex, -1.2, 1.2, '#ffffff');
      ctx.strokeStyle = INK; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(ex, 8, 7, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke();
      shapeEllipse(ctx, -19, 8, 5, 3.2, 0, 'rgba(255,120,150,0.5)');
      shapeEllipse(ctx, 19, 8, 5, 3.2, 0, 'rgba(255,120,150,0.5)');
    }

    if (hurt > 0.01) {
      ctx.save();
      ctx.globalAlpha = hurt * 0.5;
      ctx.beginPath();
      ctx.moveTo(-27, -15);
      ctx.bezierCurveTo(-32, 6, -16, 25, 0, 38);
      ctx.bezierCurveTo(16, 25, 32, 6, 27, -15);
      ctx.closePath();
      ctx.fillStyle = '#ff3b3b';
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    if (opts.shield) {
      var sp = 0.75 + Math.sin(t * 4) * 0.25;
      shapeCircle(ctx, 0, 4, 39 + sp * 2, 'rgba(120,200,255,0.16)', 'rgba(150,220,255,' + (0.55 + sp * 0.3) + ')', 2.6);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(0, 4, 33, -2.4, -1.4); ctx.stroke();
    }
    if (low) {
      ctx.strokeStyle = 'rgba(255,70,70,' + (0.4 + Math.sin(t * 6) * 0.3).toFixed(2) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 4, 44, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  /* -------------------------------------------------------------------------
   * drawPortal —— 敌人出生传送门
   * ---------------------------------------------------------------------- */
  function drawPortal(ctx, x, y, t, opts) {
    opts = opts || {};
    t = num(t, 0);
    ctx.save();
    ctx.translate(x, y);

    shapeEllipse(ctx, 0, 20, 34, 12, 0, 'rgba(140,90,220,0.22)');
    shapeEllipse(ctx, 0, 20, 24, 8, 0, 'rgba(200,160,255,0.26)');

    var spin = t * 1.2;
    for (var i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate(spin + i * 0.5);
      ctx.strokeStyle = 'rgba(' + (150 + i * 25) + ',' + (110 + i * 30) + ',255,' + (0.70 - i * 0.16) + ')';
      ctx.lineWidth = 4.4 - i * 0.9;
      pathEllipse(ctx, 0, 0, 26 - i * 5, 36 - i * 7, 0);
      ctx.stroke();
      ctx.restore();
    }

    var g = 0.36 + Math.sin(t * 3) * 0.12;
    shapeEllipse(ctx, 0, 0, 17, 27, 0, 'rgba(58,28,108,' + g.toFixed(3) + ')');
    ctx.strokeStyle = 'rgba(206,176,255,0.9)';
    ctx.lineWidth = 2.4;
    for (var j = 0; j < 4; j++) {
      var a0 = t * 2.2 + j * TAU / 4;
      ctx.beginPath();
      ctx.ellipse(0, 0, 12, 20, a0 * 0.15, a0, a0 + 1.1);
      ctx.stroke();
    }

    for (var p = 0; p < 4; p++) {
      var ph = (t * 0.55 + p * 0.25) % 1;
      var px = Math.sin(t * 2 + p * 2.1) * 22;
      var py = 18 - ph * 56;
      shapeCircle(ctx, px, py, 2.6 * (1 - ph * 0.4), 'rgba(214,184,255,' + ((1 - ph) * 0.85).toFixed(2) + ')');
    }

    shapeEllipse(ctx, 0, 22, 30, 10, 0, '#4a3a6b', INK, 2.4);
    shapeEllipse(ctx, 0, 19, 26, 7.4, 0, '#6a5596', null);
    shapeEllipse(ctx, -9, 17, 10, 2.6, -0.15, 'rgba(255,255,255,0.28)');
    ctx.restore();
  }  /* =========================================================================
   * 障碍 / 建筑：8 种，支持多格（opts.w × opts.h 格，宽 = w*64）
   * 设计基准：名义坐标下物体约占 56×56（±28），再按格数整体缩放。
   * ====================================================================== */
  var OBSTACLES = {
    rock:         function (ctx, S) {
      dropShadow(ctx, 0, 22, 26, 8);
      // 主石
      shapePoly(ctx, [-26, 12, -22, -8, -12, -20, 4, -23, 18, -14, 26, 0, 25, 14, 14, 22, -12, 22], '#a8b0bb', INK, 2.6);
      // 亮面
      shapePoly(ctx, [-18, -2, -10, -16, 2, -18, 8, -6, -2, 2], '#c9d1db', null);
      shapePoly(ctx, [-8, 6, 0, -2, 10, 0, 6, 10, -4, 12], '#bcc5d0', null);
      // 暗面
      shapePoly(ctx, [14, 12, 23, 2, 24, 13, 15, 21], '#8892a0', null);
      // 顶部高光
      gloss(ctx, -8, -14, 9, 5, -0.5, 0.55);
      // 底部草簇
      shapePoly(ctx, [-24, 20, -20, 12, -16, 20], '#5ec269', null);
      shapePoly(ctx, [16, 21, 20, 13, 24, 21], '#5ec269', null);
      if (S.hurt) crack(ctx, S.hp);
    },
    mushroom:     function (ctx, S) {
      dropShadow(ctx, 0, 22, 24, 7);
      // 菌柄
      shapeRR(ctx, -10, -2, 20, 24, 8, '#fff3df', INK, 2.6);
      gloss(ctx, -5, 4, 4, 8, 0, 0.5);
      // 菌盖
      shapeEllipse(ctx, 0, -3, 25, 20, 0, '#e8574f', INK, 2.6);
      shapeEllipse(ctx, 0, -8, 24, 10, 0, '#ff6b60', null);
      // 白点
      shapeCircle(ctx, -11, -6, 4.6, 'rgba(255,255,255,0.92)');
      shapeCircle(ctx, 10, 1, 3.8, 'rgba(255,255,255,0.92)');
      shapeCircle(ctx, 0, -13, 3.4, 'rgba(255,255,255,0.92)');
      shapeCircle(ctx, -17, 4, 2.8, 'rgba(255,255,255,0.85)');
      gloss(ctx, -8, -13, 10, 4, -0.35, 0.45);
      // 底部小草
      shapeEllipse(ctx, 0, 22, 16, 4, 0, 'rgba(94,194,105,0.55)');
      if (S.hurt) crack(ctx, S.hp);
    },
    crate:        function (ctx, S) {
      dropShadow(ctx, 0, 23, 24, 7);
      shapeRR(ctx, -24, -20, 48, 44, 6, '#d9a45b', INK, 2.6);
      shapeRR(ctx, -19, -15, 38, 34, 4, '#e8bb79', null);
      // 木纹
      ctx.strokeStyle = 'rgba(168,115,47,0.65)';
      ctx.lineWidth = 2;
      for (var i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-18, -8 + i * 11);
        ctx.quadraticCurveTo(0, -11 + i * 11, 18, -8 + i * 11);
        ctx.stroke();
      }
      // 对角加固
      ctx.strokeStyle = '#a8732f'; ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.moveTo(-19, -15); ctx.lineTo(19, 19); ctx.stroke();
      // 上下边框
      shapeRR(ctx, -24, -20, 48, 7, 3.5, '#c08a45', INK, 2);
      shapeRR(ctx, -24, 17, 48, 7, 3.5, '#c08a45', INK, 2);
      gloss(ctx, -16, -16, 14, 3, 0, 0.45);
      // 钉子
      shapeCircle(ctx, -15, -12, 2.2, '#7c511c');
      shapeCircle(ctx, 15, -12, 2.2, '#7c511c');
      shapeCircle(ctx, -15, 12, 2.2, '#7c511c');
      shapeCircle(ctx, 15, 12, 2.2, '#7c511c');
      if (S.hurt) crack(ctx, S.hp);
    },
    crystal:      function (ctx, S) {
      var glow = 0.55 + Math.sin(S.t * 2.6) * 0.18;
      dropShadow(ctx, 0, 22, 24, 7);
      shapeEllipse(ctx, 0, 0, 30, 26, 0, 'rgba(120,200,255,' + (0.10 + glow * 0.10).toFixed(3) + ')');
      var shards = [[-14, 8, -0.30, 26], [-2, 2, -0.05, 40], [13, 7, 0.32, 30]];
      for (var i = 0; i < shards.length; i++) {
        var sx = shards[i][0], sy = shards[i][1], rr2 = shards[i][2], hgt = shards[i][3];
        ctx.save();
        ctx.translate(sx, sy + 12);
        ctx.rotate(rr2);
        shapePoly(ctx, [0, -hgt, 9, -hgt * 0.34, 6, 7, -6, 7, -9, -hgt * 0.34],
          (i === 1 ? '#9fe4ff' : '#7fd8ff'), '#256d8f', 2.2);
        shapePoly(ctx, [0, -hgt + 4, 3, -hgt * 0.4, 1, 3, -3, -hgt * 0.4], 'rgba(255,255,255,0.62)');
        ctx.restore();
      }
      gloss(ctx, -4, -22, 5, 8, 0.1, 0.5);
      // 地面碎晶
      shapePoly(ctx, [-22, 20, -17, 12, -13, 20], '#bfefff', '#256d8f', 1.6);
      shapePoly(ctx, [16, 21, 21, 13, 25, 21], '#bfefff', '#256d8f', 1.6);
      if (S.hurt) crack(ctx, S.hp);
    },
    tree:         function (ctx, S) {
      dropShadow(ctx, 0, 24, 26, 8);
      // 树干
      shapeRR(ctx, -8, -4, 16, 28, 5, '#a8732f', INK, 2.4);
      ctx.strokeStyle = 'rgba(124,81,28,0.7)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(-4, 20); ctx.stroke();
      // 树冠（三层）
      var sway = Math.sin(S.t * 1.2) * 1.2;
      shapeCircle(ctx, sway - 12, -12, 15, '#4fb95c', INK, 2.6);
      shapeCircle(ctx, sway + 13, -14, 14, '#4fb95c', INK, 2.6);
      shapeCircle(ctx, sway + 0, -25, 17, '#5ec269', INK, 2.6);
      // 高光
      shapeEllipse(ctx, sway - 6, -30, 8, 5, -0.4, 'rgba(255,255,255,0.45)');
      shapeCircle(ctx, sway + 6, -20, 4, 'rgba(255,255,255,0.30)');
      // 果实
      shapeCircle(ctx, sway - 14, -8, 3.4, '#ff5a5a', INK, 1.4);
      shapeCircle(ctx, sway + 13, -22, 3, '#ff5a5a', INK, 1.4);
      // 草丛
      shapeEllipse(ctx, 0, 24, 20, 4.4, 0, 'rgba(94,194,105,0.5)');
      if (S.hurt) crack(ctx, S.hp);
    },
    house:        function (ctx, S) {
      dropShadow(ctx, 0, 24, 27, 8);
      // 墙体
      shapeRR(ctx, -22, -6, 44, 30, 5, '#ffe8c8', INK, 2.6);
      // 屋顶
      shapePoly(ctx, [-28, -4, 0, -28, 28, -4], '#e8574f', INK, 2.6);
      shapePoly(ctx, [-22, -6, 0, -24, 22, -6], '#ff6b60', null);
      // 烟囱
      shapeRR(ctx, 10, -26, 8, 14, 2.5, '#c9958a', INK, 2);
      var smoke = (S.t * 0.5) % 1;
      shapeCircle(ctx, 14 + Math.sin(S.t * 1.6) * 3, -30 - smoke * 12, 3 * (1 - smoke * 0.5), 'rgba(255,255,255,' + (0.55 * (1 - smoke)).toFixed(2) + ')');
      // 门
      shapeRR(ctx, -7, 8, 14, 16, 3, '#a8732f', INK, 2);
      shapeCircle(ctx, 3.4, 16, 1.5, '#ffe27a');
      // 窗
      shapeRR(ctx, -18, 2, 10, 10, 2.4, '#9fe4ff', INK, 1.8);
      shapeRR(ctx, 8, 2, 10, 10, 2.4, '#9fe4ff', INK, 1.8);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-13, 2); ctx.lineTo(-13, 12); ctx.moveTo(-18, 7); ctx.lineTo(-8, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(13, 2); ctx.lineTo(13, 12); ctx.moveTo(8, 7); ctx.lineTo(18, 7); ctx.stroke();
      gloss(ctx, -14, 0, 6, 2.4, 0, 0.5);
      if (S.hurt) crack(ctx, S.hp);
    },
    fence:        function (ctx, S) {
      dropShadow(ctx, 0, 23, 26, 6);
      // 横杆
      shapeRR(ctx, -26, -2, 52, 6.5, 3, '#d9a45b', INK, 2);
      shapeRR(ctx, -26, 11, 52, 6.5, 3, '#d9a45b', INK, 2);
      // 立柱
      var posts = [-22, -8, 6, 20];
      for (var i = 0; i < posts.length; i++) {
        shapeRR(ctx, posts[i] - 4, -16, 8, 36, 3, '#c08a45', INK, 2.2);
        shapePoly(ctx, [posts[i] - 4, -16, posts[i], -22, posts[i] + 4, -16], '#c08a45', INK, 2.2);
        gloss(ctx, posts[i] - 2, -12, 1.8, 12, 0, 0.35);
      }
      // 草
      shapePoly(ctx, [-24, 20, -20, 12, -16, 20], '#5ec269', null);
      shapePoly(ctx, [14, 20, 18, 13, 22, 20], '#5ec269', null);
      if (S.hurt) crack(ctx, S.hp);
    },
    tower_rubble: function (ctx, S) {
      dropShadow(ctx, 0, 24, 27, 8);
      // 断塔
      shapePoly(ctx, [-22, 24, -22, -6, -16, -14, -8, -8, 0, -22, 10, -10, 20, -16, 22, 4, 22, 24], '#b9c3cf', INK, 2.6);
      // 砖纹
      ctx.strokeStyle = 'rgba(110,124,142,0.7)'; ctx.lineWidth = 1.6;
      for (var i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(-20, -2 + i * 9); ctx.lineTo(20, -2 + i * 9); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(-6, 22); ctx.moveTo(8, -10); ctx.lineTo(8, 22); ctx.stroke();
      // 破口
      shapePoly(ctx, [-4, -20, 6, -14, 2, -2, -6, -6], '#8d99a8', INK, 1.8);
      // 碎石
      shapePoly(ctx, [-28, 24, -22, 15, -16, 24], '#a8b0bb', INK, 1.8);
      shapePoly(ctx, [18, 25, 24, 16, 29, 25], '#a8b0bb', INK, 1.8);
      // 断旗
      shapeRR(ctx, -2, -34, 2.6, 16, 1.2, '#8a6a3a', INK, 1.2);
      shapePoly(ctx, [0, -34, 14, -30, 0, -25], '#ff7aa8', INK, 1.4);
      gloss(ctx, -12, -4, 8, 12, 0.1, 0.28);
      if (S.hurt) crack(ctx, S.hp);
    }
  };

  /* 裂纹（血量越低越多） */
  function crack(ctx, hp) {
    ctx.strokeStyle = 'rgba(40,32,28,0.72)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, -12); ctx.lineTo(-2, -2); ctx.lineTo(-8, 5);
    ctx.stroke();
    if (hp < 0.55) {
      ctx.beginPath();
      ctx.moveTo(9, -8); ctx.lineTo(4, 3); ctx.lineTo(11, 12);
      ctx.stroke();
    }
    if (hp < 0.28) {
      ctx.beginPath();
      ctx.moveTo(-14, 8); ctx.lineTo(-6, 12); ctx.lineTo(-3, 19);
      ctx.stroke();
    }
  }

  /* -------------------------------------------------------------------------
   * drawObstacle —— 8 种，支持多格
   * ctx, kind, x, y, t, opts:{hp 0..1, size, w, h, hitFlash}
   *   opts.w / opts.h 为占格数（默认 1）：整体绘制宽 = w*64、高 = h*64。
   *   x, y 为建筑的中心像素（多格时为 w*h 块的中心）。
   * ---------------------------------------------------------------------- */
  function drawObstacle(ctx, kind, x, y, t, opts) {
    opts = opts || {};
    t = num(t, 0);
    var hp = (typeof opts.hp === 'number') ? clamp(opts.hp, 0, 1) : 1;
    var ghost = OBSTACLES[kind] ? kind : 'rock';
    var cw = Math.max(1, Math.round(num(opts.w, 1)));
    var ch = Math.max(1, Math.round(num(opts.h, 1)));

    // 尺寸优先级：
    //   1) 显式给了 w/h（格数）→ 按 w*64 × h*64 铺满整块；
    //   2) 只给 size（像素，渲染层用）→ 按 size / 56 缩放；
    //   3) 都没有 → 1 格基准。
    // 注意：渲染层会同时传 size 与 w/h，两者不能叠加，否则建筑会翻倍。
    // 设计基准是 56×56（±28）：把整块内容撑到 w*64 × h*64。
    // 0.92 内缩只是为了让屋顶 / 树冠 / 旗杆不顶到占用格顶部的血条。
    var INSET = 0.92;
    var sx, sy;
    if (opts.w !== undefined || opts.h !== undefined) {
      sx = cw * (TILE / 56) * INSET;
      sy = ch * (TILE / 56) * INSET;
    } else {
      var size = num(opts.size, 0);
      var k = (size > 0 ? size / 56 : 1) * INSET;
      sx = k; sy = k;
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, sy);

    OBSTACLES[ghost](ctx, { hp: hp, t: t, hurt: hp < 0.9 });

    // 受击闪白
    var flash = clamp(num(opts.hitFlash, 0), 0, 1);
    if (flash > 0.01) {
      ctx.globalAlpha = flash * 0.5;
      shapeCircle(ctx, 0, 0, 30, 'rgba(255,255,255,0.9)');
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  /* -------------------------------------------------------------------------
   * drawObstacleHp —— v2 常驻血条
   * ctx, x, y, w, h, ratio    x, y 为建筑中心；宽度按 w*64；h 决定上移距离。
   * ---------------------------------------------------------------------- */
  function drawObstacleHp(ctx, x, y, w, h, ratio) {
    var cw = Math.max(1, num(w, 1)) * TILE;
    var ch = Math.max(1, num(h, 1)) * TILE;
    var barW = Math.max(44, cw * 0.78);
    var barY = y - ch * 0.5 + 6;
    var r = clamp(num(ratio, 1), 0, 1);

    ctx.save();
    ctx.translate(x, barY);
    // 底槽
    shapeRR(ctx, -barW / 2 - 2, -2, barW + 4, 12, 6, 'rgba(59,47,42,0.72)');
    shapeRR(ctx, -barW / 2, 0, barW, 8, 4, '#2b2420');
    // 填充
    var col = r > 0.6 ? '#5ec269' : (r > 0.28 ? '#ffb02e' : '#ff5a5a');
    var fw = Math.max(4, barW * r);
    shapeRR(ctx, -barW / 2, 0, fw, 8, 4, col);
    shapeRR(ctx, -barW / 2 + 1, 1, Math.max(2, fw - 2), 3, 1.5, 'rgba(255,255,255,0.5)');
    ctx.restore();
  }
  /* =========================================================================
   * 弹丸
   * kind 与炮塔 id 同名，另兼容 common 别名
   * ====================================================================== */
  function drawProjectile(ctx, kind, x, y, t, opts) {
    opts = opts || {};
    var ang = num(opts.angle, 0);
    t = num(t, 0);
    ctx.save();
    ctx.translate(x, y);

    switch (kind) {
      case 'arrow':
        ctx.rotate(ang);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(-24, 0); ctx.lineTo(-9, 0); ctx.stroke();
        shapeRR(ctx, -10, -1.8, 20, 3.6, 1.8, '#f0dcb4', INK, 1.4);
        shapePoly(ctx, [8, -5.4, 16, 0, 8, 5.4], '#6fbf4a', INK, 1.6);
        shapePoly(ctx, [-10, 0, -16, -5, -12, 0, -16, 5], '#d8f5c0', INK, 1.2);
        break;
      case 'fan':
        for (var f = 0; f < 3; f++) {
          ctx.save();
          ctx.rotate(t * 16 + f * TAU / 3);
          shapeEllipse(ctx, 6, 0, 7.5, 2.8, 0, (f === 0 ? '#ffffff' : '#39c9c0'), INK, 1.2);
          ctx.restore();
        }
        shapeCircle(ctx, 0, 0, 3.4, '#126e6a', INK, 1.2);
        break;
      case 'ice':
        ctx.rotate(ang);
        shapePoly(ctx, [11, 0, 0, 6, -9, 0, 0, -6], '#bdeaff', '#2a7fa8', 1.8);
        shapePoly(ctx, [7, 0, 0, 2.6, -5, 0, 0, -2.6], 'rgba(255,255,255,0.9)');
        ctx.strokeStyle = 'rgba(180,235,255,0.7)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(-19, 0); ctx.stroke();
        break;
      case 'cannon':
        shapeCircle(ctx, 0, 0, 7.6, '#3b3b44', INK, 2);
        shapeCircle(ctx, -2.4, -2.4, 2.8, 'rgba(255,255,255,0.55)');
        ctx.strokeStyle = 'rgba(255,180,90,0.65)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 10, 0.4, 2.2); ctx.stroke();
        break;
      case 'magic':
        var mp = 1 + Math.sin(t * 14) * 0.12;
        shapeCircle(ctx, 0, 0, 7.6 * mp, 'rgba(176,123,255,0.42)');
        shapeCircle(ctx, 0, 0, 5.4 * mp, '#b07bff', '#5a2fa8', 1.8);
        shapeCircle(ctx, -1.8, -2, 2, 'rgba(255,255,255,0.92)');
        for (var m = 0; m < 3; m++) {
          var ma = t * 6 + m * TAU / 3;
          shapeCircle(ctx, Math.cos(ma) * 9.5, Math.sin(ma) * 9.5, 1.6, 'rgba(239,224,255,0.92)');
        }
        break;
      case 'tesla':
        ctx.strokeStyle = 'rgba(255,217,61,0.75)'; ctx.lineWidth = 4.6;
        spark(ctx);
        break;
      case 'sun':
        var sb = 0.7 + Math.sin(t * 12) * 0.3;
        shapeCircle(ctx, 0, 0, 8 * sb, 'rgba(255,214,102,0.35)');
        shapeCircle(ctx, 0, 0, 5, '#ffd666', '#a86300', 1.6);
        shapeCircle(ctx, -1.6, -1.6, 1.8, 'rgba(255,255,255,0.9)');
        break;
      case 'poison':
        shapeCircle(ctx, 0, 0, 6.4, '#8fd94b', '#3f7a1c', 1.8);
        shapeCircle(ctx, -1.8, -2, 2, 'rgba(255,255,255,0.75)');
        for (var pd = 0; pd < 3; pd++) {
          var pa = t * 5 + pd * TAU / 3;
          shapeCircle(ctx, Math.cos(pa) * 9, Math.sin(pa) * 9, 1.8, 'rgba(143,217,75,0.8)');
        }
        break;
      case 'sniper':
        ctx.rotate(ang);
        ctx.strokeStyle = 'rgba(215,230,255,0.8)'; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(-8, 0); ctx.stroke();
        shapeRR(ctx, -10, -1.4, 22, 2.8, 1.4, '#d7e6ff', '#2f3f5c', 1.2);
        shapeCircle(ctx, 10, 0, 3, '#7fe0ff', '#2f3f5c', 1.2);
        break;
      case 'missile':
        ctx.rotate(ang);
        // 尾焰
        var mf = 0.7 + Math.abs(Math.sin(t * 26)) * 0.3;
        shapePoly(ctx, [-9, 0, -18 * mf, -4.4, -14 * mf, 0, -18 * mf, 4.4], 'rgba(255,170,60,0.9)', null);
        shapePoly(ctx, [0, -5.4, 12, 0, 0, 5.4, -8, 0], '#ff6b6b', INK, 1.8);
        shapePoly(ctx, [-1, -4, 8, 0, -1, 4], 'rgba(255,255,255,0.45)');
        break;
      case 'drum':
        for (var wv = 0; wv < 3; wv++) {
          var wp = (t * 1.6 + wv / 3) % 1;
          ctx.strokeStyle = 'rgba(255,230,184,' + (0.85 * (1 - wp)).toFixed(2) + ')';
          ctx.lineWidth = 2.6;
          ctx.beginPath(); ctx.arc(0, 0, 4 + wp * 12, 0, TAU); ctx.stroke();
        }
        break;
      case 'bottle':
      default:
        ctx.rotate(ang);
        ctx.strokeStyle = 'rgba(160,210,255,0.75)'; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-16, 0); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(9, 0);
        ctx.bezierCurveTo(7, 5.4, -3, 6.4, -4.4, 0);
        ctx.bezierCurveTo(-5.4, -6.4, 4.4, -6.4, 9, 0);
        ctx.closePath();
        ctx.fillStyle = '#6db8ff'; ctx.fill();
        ctx.strokeStyle = '#1d5aa0'; ctx.lineWidth = 1.8; ctx.stroke();
        shapeCircle(ctx, 2, -1.8, 1.8, 'rgba(255,255,255,0.9)');
        break;
    }
    ctx.restore();
  }

  /* 闪电锯齿 */
  function spark(ctx) {
    ctx.beginPath();
    ctx.moveTo(-12, -5);
    ctx.lineTo(-4, 1);
    ctx.lineTo(-7, 5);
    ctx.lineTo(5, 0);
    ctx.lineTo(2, -4);
    ctx.lineTo(12, -7);
    ctx.stroke();
    ctx.strokeStyle = '#fffbe0';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /* =========================================================================
   * 道具图标 drawPickup(ctx, kind, x, y, t)
   * bomb / freeze / lightning —— 徽章底盘 + 一眼可辨的符号
   * ====================================================================== */
  function drawPickup(ctx, kind, x, y, t) {
    t = num(t, 0);
    var bob = Math.sin(t * 3) * 2.4;
    var pulse = 0.85 + Math.sin(t * 4) * 0.15;
    var theme = {
      bomb:      { ring: '#ff8f5a', badge: '#fff1e2', glow: 'rgba(255,140,80,' },
      freeze:    { ring: '#4aa3ff', badge: '#e8f7ff', glow: 'rgba(90,190,255,' },
      lightning: { ring: '#ffb400', badge: '#fff8dd', glow: 'rgba(255,200,40,' }
    };
    var T2 = theme[kind] || theme.bomb;

    ctx.save();
    ctx.translate(x, y + bob);

    // 光晕
    shapeCircle(ctx, 0, 0, 26 * pulse, T2.glow + (0.22 * pulse).toFixed(2) + ')');
    shapeCircle(ctx, 0, 0, 18, 'rgba(255,255,255,0.35)');
    // 徽章
    shapeCircle(ctx, 0, 0, 17, T2.ring, INK, 2.6);
    shapeCircle(ctx, 0, 0, 14, T2.badge, null);
    gloss(ctx, -5, -8, 7, 4.4, -0.4, 0.75);

    if (kind === 'freeze') {
      // 雪花
      ctx.strokeStyle = '#2a7fa8'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      for (var i = 0; i < 3; i++) {
        var a = i * Math.PI / 3;
        ctx.beginPath();
        ctx.moveTo(-Math.cos(a) * 9, -Math.sin(a) * 9);
        ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9);
        ctx.stroke();
      }
      ctx.lineWidth = 1.8;
      for (var k = 0; k < 3; k++) {
        var b = k * Math.PI / 3, ex = Math.cos(b) * 6.4, ey = Math.sin(b) * 6.4;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(b - 0.9) * 3.6, ey - Math.sin(b - 0.9) * 3.6);
        ctx.moveTo(-ex, -ey);
        ctx.lineTo(-ex + Math.cos(b - 0.9) * 3.6, -ey + Math.sin(b - 0.9) * 3.6);
        ctx.stroke();
      }
      shapeCircle(ctx, 0, 0, 2.6, '#bfefff', '#2a7fa8', 1);
      ctx.lineCap = 'butt';
    } else if (kind === 'lightning') {
      shapePoly(ctx, [3.4, -11, -6, 1.4, -1, 1.4, -3.6, 11, 6.4, -1.6, 1.4, -1.6], '#ffd93d', '#8a5a00', 2.2);
      gloss(ctx, 0.4, -5.4, 2.6, 3.4, -0.3, 0.6);
    } else {
      // 炸弹
      shapeCircle(ctx, 0, 1.6, 8.4, '#3b3b44', INK, 2.2);
      shapeCircle(ctx, -2.6, -1.4, 2.8, 'rgba(255,255,255,0.55)');
      // 引线
      ctx.strokeStyle = '#a8732f'; ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(3.2, -6.4);
      ctx.quadraticCurveTo(8, -10, 6.4, -13.6);
      ctx.stroke();
      // 火花
      shapeCircle(ctx, 6.4, -14.4, 3.4 * pulse, 'rgba(255,190,60,0.8)');
      shapeCircle(ctx, 6.4, -14.4, 1.8, '#fff6c2');
    }
    ctx.restore();
  }

  /* =========================================================================
   * drawSlot —— 空塔位
   * ====================================================================== */
  function drawSlot(ctx, x, y, opts) {
    opts = opts || {};
    var hover = !!opts.hover;
    var aff = (opts.affordable === undefined) ? true : !!opts.affordable;
    var t = num(opts.t, 0);
    var base = aff ? '#8ef0a8' : '#c9cfd6';
    var edge = aff ? '#3d9e5b' : '#8b949e';

    ctx.save();
    ctx.translate(x, y);
    shapeRR(ctx, -25, -25, 50, 50, 13, rgba(base, hover ? 0.55 : 0.32), rgba(edge, hover ? 0.95 : 0.6), 2.4);
    if (hover) {
      ctx.strokeStyle = rgba(edge, 0.95);
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -t * 12;
      rr(ctx, -21, -21, 42, 42, 10);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = rgba(edge, hover ? 1 : 0.8);
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(-8, 0); ctx.lineTo(8, 0);
    ctx.moveTo(0, -8); ctx.lineTo(0, 8);
    ctx.stroke();
    if (hover) {
      var corners = [[-18, -18], [18, -18], [-18, 18], [18, 18]];
      for (var i = 0; i < corners.length; i++) shapeCircle(ctx, corners[i][0], corners[i][1], 2.2, rgba(edge, 0.9));
    }
    ctx.restore();
  }  /* =========================================================================
   * 地砖：6 种主题（forest desert snow candy volcano sky）
   * 性能：drawTile 每帧每格调用（240 格）——
   *   - 不用 ctx.save()/restore()，全部属性显式设置；
   *   - 主体只用 fillRect，细节用单路径多三角 / 多段圆弧合并成 1~2 次 fill；
   *   - 位置来自确定性哈希，不会逐帧抖动。
   * ====================================================================== */
  var THEMES = {
    forest:  { bases: ['#7ec850', '#79c34b', '#84cf56'], tintA: 'rgba(255,255,255,0.055)',
               tintB: 'rgba(36,92,40,0.05)', grass: '#4a8a32', grass2: '#5fae42' },
    desert:  { bases: ['#e8c88a', '#e2c181', '#efd49a'], tintA: 'rgba(255,255,255,0.07)',
               tintB: 'rgba(150,110,50,0.055)', sandA: 'rgba(255,250,230,0.42)', sandB: 'rgba(176,132,72,0.22)' },
    snow:    { bases: ['#e8f2ff', '#e1ecfb', '#f1f8ff'], tintA: 'rgba(255,255,255,0.35)',
               tintB: 'rgba(130,170,215,0.06)', ice: 'rgba(255,255,255,0.85)', iceB: 'rgba(150,200,240,0.5)' },
    candy:   { bases: ['#ffd9ea', '#ffd2e6', '#ffe3f1'], tintA: 'rgba(255,255,255,0.12)',
               tintB: 'rgba(214,120,170,0.05)' },
    volcano: { bases: ['#5e4b46', '#57443f', '#66524c'], tintA: 'rgba(255,255,255,0.035)',
               tintB: 'rgba(0,0,0,0.09)', lava: 'rgba(255,132,50,0.85)' },
    sky:     { bases: ['#c2e5ff', '#b8ddfb', '#cdeaff'], tintA: 'rgba(255,255,255,0.16)',
               tintB: 'rgba(70,130,200,0.05)', cloud: 'rgba(255,255,255,0.75)' }
  };

  /* 草簇：把三角形追加到当前路径（由调用方一次性 fill，减少 fill 次数） */
  function tuftPath(ctx, gx, gy, s) {
    ctx.moveTo(gx - 6 * s, gy); ctx.lineTo(gx - 3.6 * s, gy - 9 * s); ctx.lineTo(gx - 1.2 * s, gy);
    ctx.closePath();
    ctx.moveTo(gx - 0.6 * s, gy); ctx.lineTo(gx + 2.2 * s, gy - 12 * s); ctx.lineTo(gx + 4.6 * s, gy);
    ctx.closePath();
    ctx.moveTo(gx + 3.6 * s, gy); ctx.lineTo(gx + 6.2 * s, gy - 8 * s); ctx.lineTo(gx + 8.4 * s, gy);
    ctx.closePath();
  }
  function tuftLightPath(ctx, gx, gy, s) {
    ctx.moveTo(gx - 1.4 * s, gy); ctx.lineTo(gx + 1.6 * s, gy - 8 * s); ctx.lineTo(gx + 3.6 * s, gy);
    ctx.closePath();
  }

  /* 小花：花瓣一次 fill + 花心一次 fill */
  function smallFlower(ctx, fx, fy, s, petal) {
    ctx.fillStyle = petal;
    ctx.beginPath();
    ctx.arc(fx, fy - 3 * s, 2.4 * s, 0, TAU);
    ctx.arc(fx + 3 * s, fy, 2.4 * s, 0, TAU);
    ctx.arc(fx, fy + 3 * s, 2.4 * s, 0, TAU);
    ctx.arc(fx - 3 * s, fy, 2.4 * s, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffd93d';
    ctx.beginPath();
    ctx.arc(fx, fy, 1.9 * s, 0, TAU);
    ctx.fill();
  }

  function pebble(ctx, px, py, s, col) {
    ctx.fillStyle = col || 'rgba(150,150,150,0.55)';
    ctx.beginPath();
    ctx.arc(px, py, 2.2 * s, 0, TAU);
    ctx.arc(px + 4 * s, py + 2 * s, 1.5 * s, 0, TAU);
    ctx.fill();
  }

  /* -------------------------------------------------------------------------
   * drawTile(ctx, theme, col, row, t)
   * ---------------------------------------------------------------------- */
  function drawTile(ctx, theme, col, row, t) {
    var pal = THEMES[theme] || THEMES.forest;
    var x = col * TILE, y = row * TILE;
    var h1 = hash01(col, row, 11);
    var h2 = hash01(col, row, 37);
    var h3 = hash01(col, row, 71);
    var h4 = hash01(col, row, 113);

    // 1) 底色（三档之一，按格固定）
    ctx.fillStyle = pal.bases[(h1 * 3) | 0];
    ctx.fillRect(x, y, TILE, TILE);

    // 2) 棋盘微色差
    ctx.fillStyle = ((col + row) & 1) ? pal.tintA : pal.tintB;
    ctx.fillRect(x, y, TILE, TILE);

    // 3) 底部柔和阴影（圆润的“小土堆”感）
    ctx.fillStyle = 'rgba(0,0,0,0.045)';
    ctx.fillRect(x, y + TILE - 4, TILE, 4);

    // 4) 主题细节
    if (pal === THEMES.forest) {
      // 草簇：深色底 + 亮色芯，全部合并成 2 次 fill
      var gx1 = x + 10 + h2 * 34, gy1 = y + 16 + h3 * 30;
      var gx2 = x + 12 + h3 * 34, gy2 = y + 20 + h1 * 28;
      var hasTuft2 = h4 > 0.42;
      ctx.fillStyle = pal.grass;
      ctx.beginPath();
      tuftPath(ctx, gx1, gy1, 1);
      if (hasTuft2) tuftPath(ctx, gx2, gy2, 0.78);
      ctx.fill();
      ctx.fillStyle = pal.grass2;
      ctx.beginPath();
      tuftLightPath(ctx, gx1, gy1, 1);
      if (hasTuft2) tuftLightPath(ctx, gx2, gy2, 0.78);
      ctx.fill();
      if (h3 > 0.74) {
        smallFlower(ctx, x + 16 + h1 * 32, y + 18 + h2 * 26, 0.95,
          (h4 > 0.5 ? '#ffffff' : '#ff9ec4'));
      } else if (h2 > 0.62) {
        pebble(ctx, x + 20 + h4 * 26, y + 26 + h1 * 18, 1, 'rgba(158,160,150,0.55)');
      }
    } else if (pal === THEMES.desert) {
      // 沙纹：两条方向一致的流线
      ctx.strokeStyle = pal.sandA;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      var wy = y + 16 + h2 * 12;
      ctx.moveTo(x + 4, wy);
      ctx.quadraticCurveTo(x + 24, wy - 7, x + 46, wy + 2);
      ctx.moveTo(x + 12, wy + 18);
      ctx.quadraticCurveTo(x + 32, wy + 12, x + 56, wy + 20);
      ctx.stroke();
      ctx.strokeStyle = pal.sandB;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x + 8, wy + 28);
      ctx.quadraticCurveTo(x + 30, wy + 22, x + 54, wy + 30);
      ctx.stroke();
      // 小石子 / 干草
      if (h4 > 0.62) pebble(ctx, x + 18 + h1 * 24, y + 40 + h3 * 12, 1, 'rgba(150,116,66,0.55)');
      if (h3 > 0.86) {
        ctx.strokeStyle = 'rgba(180,150,90,0.85)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(x + 22 + h1 * 20, y + 46);
        ctx.lineTo(x + 24 + h1 * 20, y + 34);
        ctx.moveTo(x + 26 + h1 * 20, y + 46);
        ctx.lineTo(x + 30 + h1 * 20, y + 37);
        ctx.stroke();
      }
    } else if (pal === THEMES.snow) {
      // 雪面凸起
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.ellipse(x + 20 + h1 * 24, y + 24 + h2 * 20, 12, 6, 0, 0, TAU);
      ctx.fill();
      // 反光亮点（十字星）
      var sx = x + 10 + h3 * 44, sy = y + 12 + h4 * 40;
      ctx.fillStyle = pal.ice;
      ctx.fillRect(sx - 5, sy - 0.9, 10, 1.8);
      ctx.fillRect(sx - 0.9, sy - 5, 1.8, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(sx + 12, sy + 14, 5, 1.4);
      // 淡蓝阴影边
      ctx.fillStyle = pal.iceB;
      ctx.fillRect(x, y + TILE - 6, TILE, 2);
    } else if (pal === THEMES.candy) {
      // 糖粒：小圆点 + 小方糖
      var candies = ['#ffffff', '#ff9ec4', '#9fd8ff', '#ffe27a'];
      var c1 = candies[(h1 * 4) | 0];
      var c2 = candies[(h3 * 4) | 0];
      ctx.fillStyle = c1;
      ctx.beginPath();
      ctx.arc(x + 14 + h2 * 30, y + 18 + h3 * 26, 3.4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.arc(x + 34 + h4 * 18, y + 34 + h1 * 16, 2.6, 0, TAU);
      ctx.fill();
      // 方糖
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(x + 8 + h3 * 40, y + 8 + h2 * 40, 5, 4);
      // 糖霜条纹
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(x, y + 18 + h2 * 20, TILE, 3);
    } else if (pal === THEMES.volcano) {
      // 岩浆裂纹
      ctx.strokeStyle = pal.lava;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x + 6 + h1 * 14, y + TILE - 8);
      ctx.lineTo(x + 18 + h1 * 14, y + 30);
      ctx.lineTo(x + 14 + h1 * 14, y + 14);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,150,70,0.22)';
      ctx.fillRect(x + 10 + h1 * 14, y + 12, 10, 26);
      ctx.fillStyle = 'rgba(255,190,120,0.5)';
      ctx.beginPath();
      ctx.arc(x + 30 + h3 * 24, y + 20 + h2 * 26, 2.6, 0, TAU);
      ctx.fill();
    } else if (pal === THEMES.sky) {
      // 云团
      ctx.fillStyle = pal.cloud;
      ctx.beginPath();
      ctx.arc(x + 20 + h1 * 18, y + 28 + h2 * 12, 11, 0, TAU);
      ctx.arc(x + 34 + h1 * 18, y + 31 + h2 * 12, 8, 0, TAU);
      ctx.arc(x + 26 + h1 * 18, y + 20 + h2 * 12, 7.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x, y + TILE - 8, TILE, 2);
    }

    // 5) 网格细线（很淡，帮助读格子）
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x + TILE - 1, y, 1, TILE);
    ctx.fillRect(x, y + TILE - 1, TILE, 1);
  }

  /* -------------------------------------------------------------------------
   * drawDecor —— 地图点缀（比 doco 更“大件”，由渲染层稀疏放置）
   * ---------------------------------------------------------------------- */
  function drawDecor(ctx, theme, x, y, t) {
    t = num(t, 0);
    var sway = Math.sin(t * 1.1 + x * 0.05) * 0.05;
    ctx.save();
    ctx.translate(x, y);

    if (theme === 'desert') {
      // 仙人掌
      dropShadow(ctx, 0, 22, 18, 6);
      shapeRR(ctx, -7, -30, 14, 42, 7, '#5fae5a', INK, 2.4);
      shapeRR(ctx, -19, -18, 12, 9, 4.5, '#5fae5a', INK, 2.2);
      shapeRR(ctx, 7, -10, 12, 9, 4.5, '#5fae5a', INK, 2.2);
      shapeCircle(ctx, 0, -30, 7, '#7ec86a', INK, 2.2);
      gloss(ctx, -2.5, -12, 2.4, 12, 0, 0.4);
      // 刺
      ctx.strokeStyle = 'rgba(40,80,36,0.7)'; ctx.lineWidth = 1.2;
      for (var i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(-7, -22 + i * 9); ctx.lineTo(-11, -24 + i * 9); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(7, -18 + i * 9); ctx.lineTo(11, -20 + i * 9); ctx.stroke();
      }
    } else if (theme === 'snow') {
      // 雪松
      dropShadow(ctx, 0, 20, 20, 6);
      shapeRR(ctx, -5, 0, 10, 20, 3, '#7a5a3a', INK, 2);
      shapePoly(ctx, [-18, 6, 0, -30, 18, 6], '#3f7d63', INK, 2.6);
      shapePoly(ctx, [-15, -12, 0, -42, 15, -12], '#4a8f72', INK, 2.6);
      shapeEllipse(ctx, -2, -34, 8, 4, -0.2, 'rgba(255,255,255,0.85)');
      shapeEllipse(ctx, -6, -2, 9, 3.4, -0.1, 'rgba(255,255,255,0.7)');
      shapeCircle(ctx, 14, -42, 2, 'rgba(255,255,255,0.85)');
    } else if (theme === 'candy') {
      // 棒棒糖
      dropShadow(ctx, 0, 22, 12, 5);
      shapeRR(ctx, -2.6, -16, 5.2, 36, 2.6, '#fff6e5', INK, 2);
      shapeCircle(ctx, 0, -22, 14, '#ff7aa8', INK, 2.6);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, -22, 8.5, 0.2, 2.4); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -22, 4, 3.4, 5.6); ctx.stroke();
      gloss(ctx, -5, -28, 5, 3.4, -0.4, 0.8);
    } else if (theme === 'volcano') {
      // 岩浆石
      dropShadow(ctx, 0, 18, 18, 6);
      shapePoly(ctx, [-16, 12, -12, -6, -2, -14, 10, -8, 16, 2, 14, 12], '#5b4a45', '#2e2523', 2.4);
      var glow = 0.55 + Math.sin(t * 2.4) * 0.25;
      ctx.strokeStyle = 'rgba(255,140,60,' + glow.toFixed(2) + ')';
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(-4, -10); ctx.lineTo(0, -2); ctx.lineTo(-5, 6); ctx.stroke();
      shapeCircle(ctx, 6, -4, 2.4, 'rgba(255,170,80,0.75)');
    } else if (theme === 'sky') {
      // 云朵
      shapeEllipse(ctx, 0, 0, 24, 13, 0, 'rgba(255,255,255,0.9)');
      shapeEllipse(ctx, -15, 4, 14, 9, 0, 'rgba(255,255,255,0.9)');
      shapeEllipse(ctx, 16, 4, 13, 8, 0, 'rgba(255,255,255,0.9)');
      shapeEllipse(ctx, 2, -9, 14, 11, 0, 'rgba(255,255,255,0.95)');
      shapeEllipse(ctx, -6, -12, 8, 5, -0.3, 'rgba(255,255,255,0.7)');
    } else {
      // 森林小树
      dropShadow(ctx, 0, 18, 16, 5);
      ctx.save();
      ctx.rotate(sway);
      shapeRR(ctx, -4, -6, 8, 16, 3, '#a8732f', INK, 2);
      shapeCircle(ctx, 0, -18, 15, '#4fb95c', INK, 2.6);
      shapeCircle(ctx, -10, -11, 10, '#5ec269', INK, 2.6);
      shapeCircle(ctx, 10, -11, 10, '#5ec269', INK, 2.6);
      shapeEllipse(ctx, -4, -24, 6, 4, -0.4, 'rgba(255,255,255,0.45)');
      shapeCircle(ctx, 8, -14, 3, 'rgba(255,255,255,0.28)');
      ctx.restore();
    }
    ctx.restore();
  }

  /* =========================================================================
   * init —— 预热颜色缓存（无外部资源，纯查表）
   * ====================================================================== */
  var _inited = false;
  function init() {
    if (_inited) return true;
    _inited = true;
    var k;
    for (k in TOWERS) {
      if (!Object.prototype.hasOwnProperty.call(TOWERS, k)) continue;
      rgbOf(TOWERS[k].main); rgbOf(TOWERS[k].dark); rgbOf(TOWERS[k].accent);
    }
    for (k in ENEMIES) {
      if (!Object.prototype.hasOwnProperty.call(ENEMIES, k)) continue;
      rgbOf(ENEMIES[k].body); rgbOf(ENEMIES[k].accent); rgbOf(ENEMIES[k].eye);
    }
    rgbOf(INK); rgbOf(C.gold);
    return true;
  }

  /* =========================================================================
   * 导出（契约 6.1）
   * ====================================================================== */
  global.Sprites = {
    init: init,
    drawTower: drawTower,
    drawEnemy: drawEnemy,
    drawCarrot: drawCarrot,
    drawPortal: drawPortal,
    drawObstacle: drawObstacle,
    drawObstacleHp: drawObstacleHp,
    drawProjectile: drawProjectile,
    drawSlot: drawSlot,
    drawTile: drawTile,
    drawDecor: drawDecor,
    drawPickup: drawPickup,
    // 调试 / 自测页使用的清单（非契约要求，但便于遍历）
    TOWER_IDS: ['bottle', 'arrow', 'fan', 'ice', 'cannon', 'magic', 'tesla', 'sun', 'poison', 'sniper', 'missile', 'drum'],
    ENEMY_IDS: ['rabbit', 'rabbitFast', 'rabbitTank', 'rabbitJump', 'rabbitHeal', 'rabbitShield',
      'rabbitFly', 'rabbitSplit', 'rabbitGhost', 'rabbitBerserk', 'rabbitArmored',
      'rabbitBoss', 'rabbitKing', 'finalBoss'],
    OBSTACLE_IDS: ['rock', 'mushroom', 'crate', 'crystal', 'tree', 'house', 'fence', 'tower_rubble'],
    PICKUP_IDS: ['bomb', 'freeze', 'lightning'],
    THEME_IDS: ['forest', 'desert', 'snow', 'candy', 'volcano', 'sky']
  };

}(typeof window !== 'undefined' ? window : this));