/* global window */
/** 通用格式化与小工具。 */
(function () {
  'use strict';
  var F = {};

  F.time = function (seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  };

  F.num = function (n) {
    n = Math.round(n || 0);
    if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  };

  F.stars = function (n) {
    var out = '';
    for (var i = 0; i < 3; i++) out += i < n ? '★' : '☆';
    return out;
  };

  F.el = function (id) { return document.getElementById(id); };

  /** 安全取元素：不存在时返回一个空壳，避免整条链路崩掉。 */
  F.maybe = function (id) {
    var el = document.getElementById(id);
    if (el) return el;
    var stub = document.createElement('div');
    stub.classList.add('hidden');
    return stub;
  };

  F.on = function (el, type, fn, opts) {
    if (el) el.addEventListener(type, fn, opts || false);
  };

  F.clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };

  F.toast = function (text, kind) {
    var layer = F.el('toast-layer');
    if (!layer) return;
    var div = document.createElement('div');
    div.className = 'toast' + (kind ? ' ' + kind : '');
    div.textContent = text;
    layer.appendChild(div);
    setTimeout(function () {
      div.classList.add('out');
      setTimeout(function () { if (div.parentNode) div.parentNode.removeChild(div); }, 320);
    }, 1400);
  };

  window.Fmt = F;
})();
