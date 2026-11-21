/* =============================================================================
 * audio.js —— 《保卫萝卜》复刻 · 程序化音频模块（契约 4.1）
 *
 * 全部声音用 WebAudio 实时合成：不加载任何外部音频文件。
 *   - AudioContext 只在用户交互后创建（init 幂等；已是 running 直接返回）。
 *   - 每个音效 < 0.6s，振荡器 + 增益包络（快起、指数衰减），不会爆音。
 *   - 背景音乐是循环旋律（三角/方波 + 低通滤波），音量明显低于音效。
 * ========================================================================== */
(function (global) {
  'use strict';

  var actx = null;
  var master = null;      // 总输出
  var sfxBus = null;      // 音效总线
  var musicBus = null;    // 音乐总线 → 低通 → musGain → master
  var musGain = null;
  var musFilter = null;
  var noiseBuf = null;

  var soundOn = true;
  var musicOn = true;
  var volume = 0.8;       // 0..1

  var _wantTrack = null;  // 期望播放的曲目（stopMusic 清空）
  var musicTimer = null;
  var noteIdx = 0;
  var nextTime = 0;
  var activeMusic = [];   // 已排程的音符振荡器，便于停止

  var SFX_LEVEL = 0.55;   // 音效总线电平
  var MUS_LEVEL = 0.16;   // 音乐总线电平（明显低于音效）

  function now() { return actx ? actx.currentTime : 0; }

  /* ---------------------------------------------------------------------------
   * 初始化
   * ------------------------------------------------------------------------ */
  function init() {
    if (actx) {
      // 幂等：已创建则只确保运行状态
      if (actx.state === 'suspended' && actx.resume) {
        try { actx.resume(); } catch (e) { /* 忽略 */ }
      }
      return actx.state === 'running';
    }
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return false;
    try { actx = new AC(); } catch (e) { actx = null; return false; }

    master = actx.createGain();
    master.gain.value = volume;
    master.connect(actx.destination);

    sfxBus = actx.createGain();
    sfxBus.gain.value = SFX_LEVEL;
    sfxBus.connect(master);

    // 音乐：总线 → 低通 → 音量 → 总输出
    musicBus = actx.createGain();
    musicBus.gain.value = 1;
    musFilter = actx.createBiquadFilter();
    musFilter.type = 'lowpass';
    musFilter.frequency.value = 1400;
    musFilter.Q.value = 0.6;
    musGain = actx.createGain();
    musGain.gain.value = 0.0001;
    musicBus.connect(musFilter);
    musFilter.connect(musGain);
    musGain.connect(master);

    // 噪声缓冲（白噪声 1 秒），供爆炸/打击类音效复用
    try {
      var len = Math.floor(actx.sampleRate * 1.0);
      noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch (e) { noiseBuf = null; }

    if (actx.state === 'suspended' && actx.resume) {
      try { actx.resume(); } catch (e2) { /* 浏览器策略，交给下次交互 */ }
    }
    return actx.state === 'running';
  }

  /* ---------------------------------------------------------------------------
   * 合成原语
   * ------------------------------------------------------------------------ */

  // 单个振荡器音符：type 波形，f0→f1 频率滑动，peak 峰值增益，指数衰减
  function P(type, f0, f1, dur, peak, when, dest) {
    if (!actx) return null;
    var t0 = (typeof when === 'number' && when > 0) ? when : now() + 0.001;
    var osc = actx.createOscillator();
    var g = actx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, f0), t0);
    if (f1 != null && f1 !== f0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur * 0.95);
    }
    var atk = Math.min(0.012, dur * 0.25);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0006, peak), t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(dest || sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.04);
    return osc;
  }

  // 噪声爆破：滤波后的短噪声（爆炸、冲击、气流）
  function N(dur, peak, when, cutoff, type) {
    if (!actx || !noiseBuf) return null;
    var t0 = (typeof when === 'number' && when > 0) ? when : now() + 0.001;
    var src = actx.createBufferSource();
    src.buffer = noiseBuf;
    var f = actx.createBiquadFilter();
    f.type = type || 'lowpass';
    f.frequency.setValueAtTime(cutoff || 1200, t0);
    if (dur > 0.06) {
      // 扫频：让噪声有"呼"过去的感觉
      f.frequency.exponentialRampToValueAtTime(Math.max(120, (cutoff || 1200) * 0.35), t0 + dur);
    }
    var g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0006, peak), t0 + Math.min(0.008, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
    return src;
  }

  /* ---------------------------------------------------------------------------
   * 音效表：每个音效 < 0.6s
   * ------------------------------------------------------------------------ */
  function at() { return now() + 0.001; }

  var SFX = {
    // 界面
    click: function () { P('square', 880, 760, 0.055, 0.20); },
    hover: function () { P('sine', 1180, 1260, 0.042, 0.09); },

    // 建造 / 升级 / 卖出
    build: function () {
      var w = at();
      P('triangle', 300, 560, 0.13, 0.26, w);
      P('sine', 620, 900, 0.15, 0.14, w + 0.05);
      N(0.09, 0.10, w, 1400);
    },
    upgrade: function () {
      var w = at(), f = [660, 880, 1108];
      for (var i = 0; i < 3; i++) P('triangle', f[i], f[i], 0.11, 0.20, w + i * 0.06);
      P('sine', 1320, 1568, 0.17, 0.11, w + 0.14);
    },
    sell: function () {
      var w = at();
      P('triangle', 900, 300, 0.17, 0.20, w);
      P('sine', 1240, 520, 0.14, 0.09, w + 0.03);
    },

    // 各塔射击：波形与音高刻意区分
    shoot_bottle: function () { P('sine', 540, 300, 0.09, 0.20); },
    shoot_arrow: function () {
      var w = at();
      P('sawtooth', 1000, 1500, 0.055, 0.13, w);
      N(0.05, 0.09, w, 3200, 'highpass');
    },
    shoot_fan: function () {
      var w = at();
      P('triangle', 760, 700, 0.055, 0.15, w);
      P('triangle', 1140, 1050, 0.045, 0.10, w + 0.02);
    },
    shoot_ice: function () {
      var w = at();
      P('sine', 1180, 1900, 0.13, 0.15, w);
      P('sine', 2100, 2600, 0.09, 0.07, w + 0.02);
    },
    shoot_cannon: function () {
      var w = at();
      P('square', 140, 62, 0.17, 0.26, w);
      N(0.13, 0.22, w, 700);
    },
    shoot_magic: function () {
      var w = at();
      P('sine', 720, 1560, 0.12, 0.15, w);
      P('triangle', 1560, 2100, 0.10, 0.08, w + 0.04);
    },
    shoot_tesla: function () {
      var w = at();
      P('sawtooth', 1900, 2400, 0.05, 0.12, w);
      P('sawtooth', 2400, 1700, 0.045, 0.10, w + 0.045);
      N(0.04, 0.07, w, 5000, 'highpass');
    },
    shoot_poison: function () { P('square', 260, 140, 0.16, 0.16); P('sawtooth', 180, 90, 0.20, 0.10); },
    shoot_sniper: function () { P('square', 900, 180, 0.14, 0.22); P('sine', 1400, 400, 0.06, 0.12); },
    shoot_missile: function () { P('sawtooth', 320, 700, 0.22, 0.14); },
    shoot_drum: function () { P('sine', 120, 70, 0.18, 0.22); },
    lock: function () { P('square', 1200, 900, 0.06, 0.14); P('sine', 1800, 1400, 0.05, 0.10); },
    crit: function () { P('square', 1200, 700, 0.10, 0.20); P('sine', 1800, 1200, 0.07, 0.14); },
    shield_break: function () { P('triangle', 800, 300, 0.20, 0.18); },
    shoot_sun: function () {
      var w = at();
      P('triangle', 980, 1240, 0.07, 0.16, w);
      P('sine', 1560, 1860, 0.08, 0.10, w + 0.03);
    },

    // 命中 / 效果
    explode: function () {
      var w = at();
      N(0.30, 0.30, w, 1500);
      P('sine', 120, 42, 0.31, 0.24, w);
      P('square', 80, 40, 0.20, 0.10, w + 0.01);
    },
    freeze: function () {
      var w = at();
      P('sine', 1200, 2400, 0.20, 0.14, w);
      P('triangle', 2400, 1600, 0.18, 0.09, w + 0.05);
      N(0.12, 0.06, w, 6000, 'highpass');
    },
    chain: function () {
      var w = at(), f = [1400, 1760, 2093];
      for (var i = 0; i < 3; i++) {
        P('square', f[i], f[i] * 0.9, 0.045, 0.11, w + i * 0.05);
        N(0.03, 0.05, w + i * 0.05, 4800, 'highpass');
      }
    },
    hit: function () {
      var w = at();
      P('square', 240, 150, 0.045, 0.16, w);
      N(0.04, 0.08, w, 2200);
    },
    die: function () {
      var w = at();
      P('sawtooth', 430, 78, 0.26, 0.18, w);
      P('sine', 620, 120, 0.22, 0.09, w + 0.02);
    },

    // 资源 / 节奏提示
    coin: function () {
      var w = at();
      P('triangle', 1046, 1046, 0.07, 0.17, w);
      P('triangle', 1568, 1568, 0.16, 0.15, w + 0.07);
    },
    wave: function () {
      var w = at(), f = [392, 523, 659];
      for (var i = 0; i < 3; i++) P('triangle', f[i], f[i], 0.34, 0.12, w + i * 0.015);
    },
    boss: function () {
      var w = at();
      P('sawtooth', 92, 72, 0.46, 0.20, w);
      P('square', 55, 48, 0.50, 0.12, w + 0.03);
      N(0.34, 0.10, w, 500);
    },

    // 结算
    win: function () {
      // 四音上行，整体控制在 0.6s 内
      var w = at(), f = [523, 659, 784, 1046];
      for (var i = 0; i < 4; i++) P('triangle', f[i], f[i], 0.13, 0.17, w + i * 0.075);
      P('sine', 1568, 1568, 0.16, 0.06, w + 0.30);
    },
    lose: function () {
      var w = at(), f = [392, 330, 262, 196];
      for (var i = 0; i < 4; i++) P('triangle', f[i], f[i] * 0.99, 0.22, 0.16, w + i * 0.10);
    },
    error: function () {
      var w = at();
      P('square', 165, 150, 0.065, 0.16, w);
      P('square', 165, 138, 0.075, 0.14, w + 0.095);
    }
  };

  /* ---------------------------------------------------------------------------
   * 播放音效
   * ------------------------------------------------------------------------ */
  function play(name) {
    if (!soundOn) return false;
    if (!actx) { if (!init()) return false; }
    if (actx.state === 'suspended' && actx.resume) {
      try { actx.resume(); } catch (e) { /* 忽略 */ }
    }
    var fn = SFX[name];
    if (!fn) return false;   // 未知名静默忽略
    try { fn(); } catch (e2) { return false; }
    return true;
  }

  /* ---------------------------------------------------------------------------
   * 背景音乐
   * ------------------------------------------------------------------------ */

  // 音名 → 频率（十二平均律，A4 = 440）
  var SEMI = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  function noteFreq(name) {
    if (!name || name === 'R') return 0;
    var m = /^([A-G]#?)(-?\d)$/.exec(name);
    if (!m) return 0;
    var midi = SEMI[m[1]] + (parseInt(m[2], 10) + 1) * 12;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  var TRACKS = {
    // 主菜单：舒缓、明亮，三角波
    menu: {
      name: '菜单',
      bpm: 82, step: 0.46, type: 'triangle', cutoff: 1600, vol: MUS_LEVEL,
      notes: ['C5', 'E5', 'G5', 'E5', 'D5', 'F5', 'A5', 'F5',
              'E5', 'C5', 'D5', 'B4', 'C5', 'R',  'G4', 'R'],
      bass:  ['C3', 'R', 'G3', 'R', 'F3', 'R', 'G3', 'R',
              'C3', 'R', 'G3', 'R', 'A2', 'R', 'G2', 'R'],
      bassStepMul: 2
    },

    // 战斗：中速、有推进感，方波
    battle: {
      name: '战斗',
      bpm: 132, step: 0.28, type: 'square', cutoff: 1900, vol: MUS_LEVEL * 1.05,
      notes: ['A4', 'A4', 'C5', 'A4', 'D5', 'C5', 'A4', 'G4',
              'A4', 'E5', 'D5', 'C5', 'B4', 'A4', 'G4', 'R'],
      bass:  ['A2', 'A2', 'E2', 'E2', 'F2', 'F2', 'G2', 'G2'],
      bassStepMul: 2
    },

    // Boss：低沉、压迫，方波低八度 + 慢速低音
    boss: {
      name: 'Boss',
      bpm: 148, step: 0.24, type: 'square', cutoff: 1050, vol: MUS_LEVEL * 1.1,
      notes: ['D4', 'D4', 'F4', 'D4', 'G4', 'F4', 'E4', 'D4',
              'D4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4', 'R'],
      bass:  ['D2', 'D2', 'D2', 'D2', 'C2', 'C2', 'D2', 'D2'],
      bassStepMul: 2
    }
  };

  function musicNote(freq, when, dur, type, peak) {
    if (!actx || !freq) return;
    var osc = actx.createOscillator();
    var g = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0006, peak), when + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g);
    g.connect(musicBus);
    osc.start(when);
    osc.stop(when + dur + 0.02);
    osc.__end = when + dur + 0.02;   // 记录自然结束时刻，停止音乐时不重复 stop
    activeMusic.push(osc);
    osc.onended = function () {
      var i = activeMusic.indexOf(osc);
      if (i >= 0) activeMusic.splice(i, 1);
    };
  }

  // 定时调度器：提前 lookahead 排程，避免 setInterval 抖动造成节奏不稳
  function tick() {
    if (!actx || !musicOn || !_wantTrack) return;
    var tr = TRACKS[_wantTrack];
    if (!tr) return;
    var look = 0.22;
    var guard = 0;
    while (nextTime < actx.currentTime + look && guard++ < 32) {
      var step = tr.step;
      var n = tr.notes[noteIdx % tr.notes.length];
      var nf = noteFreq(n);
      if (nf) musicNote(nf, nextTime, step * 0.92, tr.type, 0.30);

      // 低音层（每 bassStepMul 格触发一次）
      var mul = tr.bassStepMul || 2;
      if (noteIdx % mul === 0) {
        var bi = Math.floor(noteIdx / mul) % tr.bass.length;
        var bf = noteFreq(tr.bass[bi]);
        if (bf) musicNote(bf, nextTime, step * mul * 0.85, tr.type === 'square' ? 'sine' : 'triangle', 0.20);
      }

      nextTime += step;
      noteIdx++;
    }
  }

  function killMusic(immediate) {
    if (musicTimer) { global.clearInterval(musicTimer); musicTimer = null; }
    if (!actx) { activeMusic.length = 0; return; }
    var t = actx.currentTime;
    if (musGain) {
      try {
        musGain.gain.cancelScheduledValues(t);
        var cur = musGain.gain.value;
        musGain.gain.setValueAtTime(Math.max(0.0001, cur), t);
        musGain.gain.exponentialRampToValueAtTime(0.0001, t + (immediate ? 0.02 : 0.18));
      } catch (e) { /* 忽略 */ }
    }
    var list = activeMusic.slice();
    activeMusic.length = 0;
    var stopAt = t + (immediate ? 0.02 : 0.18);
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      // 已经排定在该时刻之前结束的音符无需再停，避免重复 stop 抛 InvalidStateError
      if (o.__end != null && o.__end <= stopAt) continue;
      try { o.stop(stopAt); } catch (e2) { /* 已停止 */ }
    }
  }

  function applyMusic() {
    killMusic(true);
    if (!actx || !musicOn || !_wantTrack) return;
    var tr = TRACKS[_wantTrack];
    if (!tr) return;
    noteIdx = 0;
    var t = actx.currentTime;
    try {
      musFilter.frequency.cancelScheduledValues(t);
      musFilter.frequency.setValueAtTime(tr.cutoff, t);
      musFilter.frequency.exponentialRampToValueAtTime(tr.cutoff * 1.12, t + 4);
    } catch (e) { /* 忽略 */ }
    musGain.gain.cancelScheduledValues(t);
    musGain.gain.setValueAtTime(0.0001, t);
    musGain.gain.exponentialRampToValueAtTime(tr.vol, t + 0.45);
    nextTime = t + 0.07;
    noteIdx = 0;
    musicTimer = global.setInterval(tick, 30);
    tick();
  }

  function startMusic(track) {
    if (!TRACKS[track]) return false;
    _wantTrack = track;
    if (!actx) init();
    if (!actx) return false;
    applyMusic();
    return true;
  }

  function stopMusic() {
    _wantTrack = null;
    killMusic(false);
  }

  /* ---------------------------------------------------------------------------
   * 开关与音量
   * ------------------------------------------------------------------------ */
  function setSound(on) {
    soundOn = !!on;
    if (!soundOn && sfxBus) {
      // 立刻静音正在播放的音效，避免关掉后还拖尾
      try {
        var t = now();
        sfxBus.gain.cancelScheduledValues(t);
        sfxBus.gain.setValueAtTime(SFX_LEVEL, t);
        sfxBus.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      } catch (e) { /* 忽略 */ }
    } else if (soundOn && sfxBus) {
      try {
        var t2 = now();
        sfxBus.gain.cancelScheduledValues(t2);
        sfxBus.gain.setValueAtTime(sfxBus.gain.value, t2);
        sfxBus.gain.exponentialRampToValueAtTime(SFX_LEVEL, t2 + 0.08);
      } catch (e2) { /* 忽略 */ }
    }
    return soundOn;
  }

  function setMusic(on) {
    musicOn = !!on;
    if (!musicOn) killMusic(false);
    else if (_wantTrack) applyMusic();
    return musicOn;
  }

  function setVolume(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0.8;
    volume = Math.max(0, Math.min(1, n));
    if (master) {
      try {
        var t = now();
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(volume, t + 0.08);
      } catch (e) { /* 忽略 */ }
    }
    return volume;
  }

  function isReady() {
    return !!actx && actx.state === 'running';
  }

  /* ---------------------------------------------------------------------------
   * 导出
   * ------------------------------------------------------------------------ */
  global.GameAudio = {
    init: init,
    play: play,
    setSound: setSound,
    setMusic: setMusic,
    setVolume: setVolume,
    startMusic: startMusic,
    stopMusic: stopMusic,
    isReady: isReady,
    // 便于调试与自测页展示（不属于契约，但只读且无副作用）
    listSfx: function () { return Object.keys(SFX); },
    listTracks: function () { return Object.keys(TRACKS); },
    currentTrack: function () { return _wantTrack; }
  };

}(typeof window !== 'undefined' ? window : this));
