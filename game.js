'use strict';
/* 小斗士 Mini Fighter v2 —— 原创角色与美术，玩法致敬经典横版格斗
 * 依赖 characters.js 中的 CLASSES 数据
 */

let ctx = document.getElementById('cv').getContext('2d');   // 画像生成时临时切换
const mainCtx = ctx;
const W = 960, H = 540;
const GROUND_TOP = 310, GROUND_BOT = 505, GRAV = 0.7;
const SLOTC = ['#ff5a4e', '#4ea3ff', '#54d66a', '#ffd24e'];

const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const eo = t => 1 - (1 - t) * (1 - t);
const clampY = y => Math.max(GROUND_TOP, Math.min(GROUND_BOT, y));

// ============ 音效（WebAudio 合成，M 键静音） ============
const SFX = (() => {
  let ac = null, on = true;
  const A = () => {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (ac && ac.state === 'suspended') ac.resume();
    return ac;
  };
  function tone(f0, f1, dur, type, vol) {
    const a = A(); if (!a || !on) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, a.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), a.currentTime + dur);
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + dur);
  }
  function noise(dur, vol, fc) {
    const a = A(); if (!a || !on) return;
    const n = (a.sampleRate * dur) | 0, b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = a.createBufferSource(); s.buffer = b;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fc;
    const g = a.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(a.destination); s.start();
  }
  const fx = {
    swing() { noise(0.09, 0.5, 1600); },
    shoot() { noise(0.06, 0.6, 2600); },
    hit() { tone(180, 60, 0.1, 'square', 0.22); noise(0.05, 0.4, 900); },
    hit2() { tone(140, 40, 0.18, 'square', 0.26); noise(0.12, 0.5, 500); },
    block() { tone(700, 420, 0.06, 'triangle', 0.15); },
    cast() { tone(300, 900, 0.18, 'sine', 0.16); },
    explode() { tone(120, 30, 0.35, 'sawtooth', 0.25); noise(0.3, 0.6, 300); },
    freeze() { tone(1500, 2300, 0.2, 'triangle', 0.13); },
    heal() { tone(523, 784, 0.3, 'sine', 0.13); },
    ko() { tone(500, 60, 0.5, 'sawtooth', 0.2); },
  };
  addEventListener('keydown', e => { if (e.code === 'KeyM') on = !on; });
  return { play(n) { if (fx[n]) fx[n](); } };
})();

// ============ 输入 ============
const keys = {}, pressed = {};
addEventListener('keydown', e => {
  if (!keys[e.code]) pressed[e.code] = true;
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape') backToMenu();
});
addEventListener('keyup', e => { keys[e.code] = false; });

function readPlayerInput() {
  const inp = {
    left: keys.KeyA || keys.ArrowLeft, right: keys.KeyD || keys.ArrowRight,
    up: keys.KeyW || keys.ArrowUp, down: keys.KeyS || keys.ArrowDown,
    block: keys.KeyL,
    jump: pressed.KeyK || pressed.Space, punch: pressed.KeyJ,
    s1: pressed.KeyU, s2: pressed.KeyI, s3: pressed.KeyO,
  };
  for (const k in pressed) delete pressed[k];
  return inp;
}

// ============ 世界状态 ============
let mode = null;                 // 'local' | 'online'
let pendingMode = null;
let fighters = [null, null, null, null];
let projectiles = [];
let effects = [], texts = [], ghosts = [];
let mySlot = 0, frame = 0;
let net = null, lastSent = 0;
let shakeT = 0, shakeMag = 0;
function addShake(m) { shakeT = Math.max(shakeT, 8); shakeMag = Math.max(shakeMag, m); }
function addEffect(k, x, y, big) {
  const MAX = { spark: 12, bolt: 16, ring: 24, ringG: 30, heal: 40, tp: 16, explosion: 22, dust: 16, blockfx: 10 };
  effects.push({ k, x, y, t: 0, max: MAX[k] || 14, big, seed: Math.random() * 6.28 });
}
function addText(x, y, str, c) { texts.push({ x, y, str, c, t: 0 }); }

// ============ 姿势动画（骨骼角度：0=垂直向下，正=朝面向方向摆出） ============
function basePose() {
  return { lean: 0, crouch: 0, rot: 0, lying: 0, wAng: 2.5, draw01: 0, hideW: 0,
           armF: [0.25, 0.35], armB: [-0.2, 0.3], legF: [0.12, -0.1], legB: [-0.12, -0.08] };
}
const ANIMS = {
  idle(tt, at) {
    const p = basePose();
    p.crouch = Math.sin(at * 0.06) * 0.8 + 0.8;
    p.armF[0] += Math.sin(at * 0.06) * 0.05;
    return p;
  },
  walk(tt, at) {
    const p = basePose(), s = Math.sin(at * 0.28);
    p.legF = [0.55 * s, -0.25 - 0.4 * Math.max(0, -s)];
    p.legB = [-0.55 * s, -0.25 - 0.4 * Math.max(0, s)];
    p.armF = [-0.5 * s, 0.4]; p.armB = [0.5 * s, 0.4];
    p.crouch = Math.abs(Math.cos(at * 0.28)) * 1.2;
    return p;
  },
  slash(tt) {
    const p = basePose();
    const w = eo(seg(tt, 0, 0.35)), s = eo(seg(tt, 0.35, 0.55)), r = seg(tt, 0.75, 1);
    let a = lerp(0.3, 3.0, w); a = lerp(a, 1.0, s); a = lerp(a, 0.3, r);
    let wa = lerp(2.5, -2.8, w); wa = lerp(wa, 0.9, s); wa = lerp(wa, 2.5, r);
    p.armF = [a, 0.15]; p.wAng = wa;
    p.armB = [-0.45 * s, 0.5];
    p.lean = 0.18 * s * (1 - r) - 0.1 * w * (1 - s);
    p.crouch = 1.5 * s * (1 - r);
    p.legF = [0.4 * s, -0.2]; p.legB = [-0.55 * s, 0.3];
    return p;
  },
  thrust(tt) {
    const p = basePose();
    const w = eo(seg(tt, 0, 0.4)), j = eo(seg(tt, 0.4, 0.55)), r = seg(tt, 0.75, 1);
    let a = lerp(0.3, -0.5, w); a = lerp(a, 1.6, j); a = lerp(a, 0.3, r);
    let el = lerp(0.4, 0.9, w); el = lerp(el, 0.05, j); el = lerp(el, 0.4, r);
    p.armF = [a, el];
    let wa = lerp(2.5, 0.25, Math.max(w, j)); wa = lerp(wa, 2.5, r);
    p.wAng = wa - 0.2 * j;
    p.armB = [0.3 * j, 0.6];
    p.lean = 0.25 * j * (1 - r); p.crouch = 2.5 * j * (1 - r);
    p.legF = [0.7 * j, -0.3]; p.legB = [-0.9 * j, 0.5];
    return p;
  },
  kick(tt) {
    const p = basePose();
    const k = eo(seg(tt, 0.15, 0.45)) * (1 - seg(tt, 0.7, 1));
    p.legF = [1.95 * k, -0.05]; p.legB = [-0.15, -0.1];
    p.lean = -0.2 * k; p.armF = [0.9, 1.3]; p.armB = [-0.7, 0.5];
    p.crouch = 1;
    return p;
  },
  shoot(tt) {
    const p = basePose();
    const hold = eo(seg(tt, 0, 0.3)), rel = tt > 0.55, r = seg(tt, 0.85, 1);
    p.armF = [lerp(0.25, 1.55, hold) * (1 - r) + 0.25 * r, 0.06];
    p.armB = rel ? [1.05, 0.5] : [lerp(-0.2, 1.05, hold), lerp(0.3, 1.95, hold)];
    p.draw01 = rel ? 0 : eo(seg(tt, 0.15, 0.5));
    p.wAng = lerp(2.5, 0, hold);
    p.lean = 0.06 * hold;
    return p;
  },
  shootUp(tt) {
    const p = ANIMS.shoot(tt);
    p.armF[0] += 0.7; p.armB[0] += 0.4; p.wAng -= 0.85; p.lean = -0.1;
    return p;
  },
  cast(tt) {
    const p = basePose();
    const w = eo(seg(tt, 0, 0.35)), u = eo(seg(tt, 0.35, 0.55)), r = seg(tt, 0.8, 1);
    let a = lerp(0.25, -0.5, w); a = lerp(a, 1.55, u); a = lerp(a, 0.25, r);
    let el = lerp(0.35, 0.7, w); el = lerp(el, 0.1, u); el = lerp(el, 0.35, r);
    p.armF = [a, el]; p.armB = [a - 0.12, el + 0.1];
    p.lean = 0.12 * u * (1 - r); p.crouch = 1.5 * u;
    p.wAng = -0.6;
    return p;
  },
  jabs(tt, at) {
    const p = basePose();
    const fade = 1 - seg(tt, 0.85, 1);
    const jA = Math.max(0, Math.sin(at * 0.55)) * fade, jB = Math.max(0, -Math.sin(at * 0.55)) * fade;
    p.armF = [0.25 + 1.45 * jA, 0.5 - 0.42 * jA];
    p.armB = [-0.2 + 1.85 * jB, 0.55 - 0.45 * jB];
    p.lean = 0.1 * (jA + jB); p.crouch = 1.2;
    p.legF = [0.3, -0.2]; p.legB = [-0.4, 0.15];
    return p;
  },
  upper() {
    const p = basePose();
    p.armF = [3.0, 0.05]; p.armB = [-0.7, 0.8];
    p.legF = [0.9, -1.5]; p.legB = [-0.3, -1.7];
    p.lean = -0.12; p.wAng = -1.5; p.crouch = 0;
    return p;
  },
  spin(tt, at) {
    const p = basePose();
    p.rot = at * 0.5;
    p.armF = [1.5, 0.05]; p.armB = [-1.5, 0.05];
    p.legF = [0.45, -0.3]; p.legB = [-0.45, -0.3];
    p.crouch = 2; p.wAng = 0.1;
    return p;
  },
  slam(tt) {
    const p = basePose();
    const u = eo(seg(tt, 0, 0.4)), d = eo(seg(tt, 0.4, 0.55)), r = seg(tt, 0.8, 1);
    let a = lerp(0.25, 2.95, u); a = lerp(a, 0.95, d); a = lerp(a, 0.25, r);
    p.armF = [a, 0.2]; p.armB = [a - 0.15, 0.25];
    let wa = lerp(2.5, -2.9, u); wa = lerp(wa, 1.25, d); wa = lerp(wa, 2.5, r);
    p.wAng = wa;
    p.lean = 0.22 * d * (1 - r); p.crouch = 4 * d * (1 - r);
    p.legF = [0.35 * d, -0.3]; p.legB = [-0.45 * d, 0.3];
    return p;
  },
  throw(tt) {
    const p = basePose();
    const w = eo(seg(tt, 0, 0.35)), f = eo(seg(tt, 0.35, 0.5)), r = seg(tt, 0.75, 1);
    let a = lerp(0.25, -0.8, w); a = lerp(a, 1.65, f); a = lerp(a, 0.25, r);
    let el = lerp(0.35, 1.3, w); el = lerp(el, 0.05, f); el = lerp(el, 0.35, r);
    p.armF = [a, el]; p.armB = [0.4 * f, 0.4];
    p.lean = 0.12 * f * (1 - r); p.crouch = 1; p.hideW = 1;
    return p;
  },
  dashAtk() {
    const p = basePose();
    p.lean = 0.32; p.crouch = 3;
    p.armF = [1.5, 0.1]; p.armB = [-1.0, 0.6];
    p.legF = [1.0, -0.5]; p.legB = [-1.2, 0.5];
    p.wAng = 0.1;
    return p;
  },
  pray(tt) {
    const p = basePose();
    const u = eo(seg(tt, 0, 0.4)) * (1 - seg(tt, 0.85, 1));
    p.armF = [lerp(0.25, 2.6, u), 0.25]; p.armB = [lerp(-0.2, 2.5, u), 0.25];
    p.wAng = -2.6; p.crouch = -1.2 * u;
    return p;
  },
  hurt() {
    const p = basePose();
    p.lean = -0.3; p.armF = [-0.7, 0.5]; p.armB = [0.9, 0.6];
    p.legF = [0.5, -0.3]; p.legB = [-0.45, 0.25]; p.crouch = 1.5;
    return p;
  },
  fall(tt, at) {
    const p = basePose();
    p.rot = -0.6 - Math.min(at * 0.22, 4.4);
    p.armF = [2.2, 0.3]; p.armB = [-1.8, 0.4];
    p.legF = [1.0, -0.9]; p.legB = [-0.8, -0.5];
    return p;
  },
  down() {
    const p = basePose();
    p.lying = 1; p.armF = [1.2, 0.2]; p.armB = [-0.5, 0.2];
    p.legF = [0.3, -0.2]; p.legB = [-0.2, -0.1];
    return p;
  },
  block() {
    const p = basePose();
    p.armF = [1.2, 2.1]; p.armB = [1.05, 2.2]; p.crouch = 2; p.lean = 0.05;
    return p;
  },
  frozen() { return basePose(); },
};
const STATE_ANIM = { idle: 'idle', walk: 'walk', hurt: 'hurt', fall: 'fall', down: 'down',
                     dead: 'down', block: 'block', frozen: 'frozen' };
function poseFor(st, an, at, ad, animFrame) {
  if (st === 'act') {
    const fn = ANIMS[an] || ANIMS.idle;
    return fn(Math.min(1, at / (ad || 24)), at);
  }
  return ANIMS[STATE_ANIM[st] || 'idle'](0, animFrame);
}

// ============ 人物渲染 ============
function line(x1, y1, x2, y2, w, c) {
  ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}
function limb(x, y, a, L1, L2, w, c1, c2) {
  const ex = x + Math.sin(a[0]) * L1, ey = y + Math.cos(a[0]) * L1;
  const hx = ex + Math.sin(a[0] + a[1]) * L2, hy = ey + Math.cos(a[0] + a[1]) * L2;
  line(x, y, ex, ey, w, c1); line(ex, ey, hx, hy, w * 0.85, c2);
  return [hx, hy];
}
function dot(x, y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }

function drawWeapon(lk, h, pose) {
  ctx.save(); ctx.translate(h[0], h[1]); ctx.rotate(pose.wAng);
  switch (lk.weapon) {
    case 'sword':
      line(-7, 0, 0, 0, 3.5, '#5a3b22'); line(0, -4.5, 0, 4.5, 2.5, '#c9a227');
      ctx.fillStyle = '#dfe6ee';
      ctx.beginPath(); ctx.moveTo(1, -2.4); ctx.lineTo(30, -1.4); ctx.lineTo(35, 0);
      ctx.lineTo(30, 1.4); ctx.lineTo(1, 2.4); ctx.fill();
      line(2, -0.6, 31, -0.2, 0.8, '#ffffff');
      break;
    case 'katana':
      line(-6, 0, 0, 0, 3, '#2b2b33'); line(0, -3.5, 0, 3.5, 2, '#888');
      ctx.strokeStyle = '#e8eef5'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(1, 0); ctx.quadraticCurveTo(16, -2.5, 31, -4); ctx.stroke();
      break;
    case 'dagger':
      line(-4, 0, 0, 0, 3, '#3a2b4d');
      ctx.fillStyle = '#cfd8e3';
      ctx.beginPath(); ctx.moveTo(1, -2); ctx.lineTo(15, 0); ctx.lineTo(1, 2); ctx.fill();
      break;
    case 'spear':
      line(-18, 0, 46, 0, 3, '#7a5230');
      ctx.fillStyle = '#cfd8e3';
      ctx.beginPath(); ctx.moveTo(46, -3); ctx.lineTo(60, 0); ctx.lineTo(46, 3); ctx.fill();
      dot(45, 0, 2.5, '#c0392b');
      break;
    case 'axe':
      line(-6, 0, 30, 0, 3.5, '#5a3b22');
      ctx.fillStyle = '#b9c2cc';
      ctx.beginPath(); ctx.moveTo(26, -2); ctx.quadraticCurveTo(30, -15, 42, -10);
      ctx.quadraticCurveTo(38, -2, 38, 0); ctx.quadraticCurveTo(38, 2, 42, 10);
      ctx.quadraticCurveTo(30, 15, 26, 2); ctx.fill();
      line(41, -9, 41, 9, 1.2, '#fff');
      break;
    case 'staff':
      line(-12, 0, 34, 0, 3, '#6b4a2f');
      dot(38, 0, 4.5, lk.accent);
      ctx.globalAlpha = 0.35; dot(38, 0, 8, lk.accent); ctx.globalAlpha = 1;
      break;
    case 'bow': {
      ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(3, -23); ctx.quadraticCurveTo(15, 0, 3, 23); ctx.stroke();
      const pull = (pose.draw01 || 0) * 10;
      ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(3, -23); ctx.lineTo(2 - pull, 0); ctx.lineTo(3, 23); ctx.stroke();
      if (pose.draw01 > 0.1) {
        line(2 - pull, 0, 24, 0, 1.6, '#9c6b3a');
        ctx.fillStyle = '#cfd8e3';
        ctx.beginPath(); ctx.moveTo(24, -2); ctx.lineTo(30, 0); ctx.lineTo(24, 2); ctx.fill();
      }
      break;
    }
  }
  ctx.restore();
}

function renderBody(sx, sy, cls, pose, face, opts = {}) {
  const lk = cls.look, S = lk.scale || 1, LW = lk.lw || 1;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(face * S, S);
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  if (opts.flash) ctx.filter = 'brightness(2.2) saturate(0.4)';
  if (pose.lying) { ctx.rotate(-1.45); ctx.translate(0, 14); }
  ctx.rotate((pose.rot || 0) + (pose.lean || 0));

  const cr = pose.crouch || 0;
  const hipY = -22 + cr, shY = -44 + cr, headY = -57 + cr;
  const slv = lk.top === 'vest' ? lk.skin : lk.c1;
  const aw = 5.5 * LW, lw = 6 * LW;

  // 披风（背后）
  if (lk.top === 'cloak') {
    ctx.fillStyle = lk.c2;
    ctx.beginPath(); ctx.moveTo(0, shY);
    ctx.quadraticCurveTo(-17, hipY, -13, -1);
    ctx.lineTo(-3, hipY + 2); ctx.closePath(); ctx.fill();
  }
  // 后臂
  const hB = limb(-4, shY + 2, pose.armB, 9, 9, aw, slv, lk.skin);
  dot(hB[0], hB[1], lk.weapon === 'fist' ? 4 * LW : 2.6, lk.weapon === 'fist' ? lk.c2 : lk.skin);
  if (lk.weapon === 'dagger' && !pose.hideW) {
    ctx.save(); ctx.translate(hB[0], hB[1]); ctx.rotate(0.5);
    ctx.fillStyle = '#cfd8e3';
    ctx.beginPath(); ctx.moveTo(1, -1.8); ctx.lineTo(13, 0); ctx.lineTo(1, 1.8); ctx.fill();
    ctx.restore();
  }
  // 腿
  const fB = limb(-3, hipY, pose.legB, 11, 11, lw, lk.pants, lk.pants);
  dot(fB[0] + 2, fB[1] - 1, 3.2, '#2a2118');
  const fF = limb(3, hipY, pose.legF, 11, 11, lw, lk.pants, lk.pants);
  dot(fF[0] + 2, fF[1] - 1, 3.2, '#2a2118');
  // 长袍下摆（盖住腿根）
  if (lk.top === 'robe') {
    ctx.fillStyle = lk.c1;
    ctx.beginPath(); ctx.moveTo(-10, shY + 10); ctx.lineTo(10, shY + 10);
    ctx.lineTo(14, -1); ctx.lineTo(-14, -1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = lk.c2; ctx.fillRect(-14, -4, 28, 3.5);
  }
  // 躯干
  const tw = 10 * (lk.top === 'vest' ? 1.15 : 1);
  ctx.fillStyle = lk.c1;
  ctx.beginPath(); ctx.roundRect(-tw, shY - 2, tw * 2, hipY - shY + 6, 6); ctx.fill();
  switch (lk.top) {
    case 'gi':
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-5, shY); ctx.lineTo(1, shY + 9); ctx.lineTo(7, shY); ctx.stroke();
      ctx.fillStyle = '#222'; ctx.fillRect(-tw, hipY - 1, tw * 2, 4);
      break;
    case 'tunic':
      ctx.fillStyle = lk.c2; ctx.fillRect(-tw, hipY - 1, tw * 2, 4);
      ctx.strokeStyle = lk.c2; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-3, shY - 1); ctx.lineTo(-3, hipY); ctx.stroke();
      break;
    case 'armor': case 'armorB':
      ctx.strokeStyle = lk.c2; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-tw, shY + 6); ctx.lineTo(tw, shY + 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-tw, shY + 13); ctx.lineTo(tw, shY + 13); ctx.stroke();
      dot(-6, shY + 1, 5, lk.c2); dot(6, shY + 1, 5, lk.c2);
      if (lk.top === 'armorB') {
        ctx.fillStyle = '#33302e';
        ctx.beginPath(); ctx.moveTo(-9, shY - 3); ctx.lineTo(-6, shY - 10); ctx.lineTo(-3, shY - 3); ctx.fill();
        ctx.beginPath(); ctx.moveTo(3, shY - 3); ctx.lineTo(6, shY - 10); ctx.lineTo(9, shY - 3); ctx.fill();
      }
      break;
    case 'vest':
      ctx.fillStyle = lk.skin;
      ctx.beginPath(); ctx.roundRect(-tw + 2, shY - 1, tw * 2 - 4, hipY - shY + 4, 5); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(-3, shY + 7, 4, 0.3, 2.6); ctx.stroke();
      ctx.beginPath(); ctx.arc(5, shY + 7, 4, 0.5, 2.8); ctx.stroke();
      ctx.fillStyle = lk.c1;
      ctx.fillRect(-tw - 1, shY - 2, 5, hipY - shY + 6); ctx.fillRect(tw - 4, shY - 2, 5, hipY - shY + 6);
      ctx.fillStyle = '#222'; ctx.fillRect(-tw, hipY, tw * 2, 4);
      break;
    case 'ninja':
      ctx.strokeStyle = lk.c2; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-8, shY); ctx.lineTo(8, hipY - 2); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.fillRect(-tw, hipY - 1, tw * 2, 4);
      break;
    case 'cloak':
      dot(2, shY + 3, 2.5, lk.accent);
      break;
    case 'robe':
      ctx.fillStyle = lk.c2; ctx.fillRect(-tw, hipY - 2, tw * 2, 4);
      break;
  }
  // 佛珠
  if (lk.beads) {
    for (let i = 0; i < 5; i++) {
      dot(-7 + i * 3.5, shY + 5 + Math.sin(i / 4 * Math.PI) * 4, 2, '#6b4a2f');
    }
  }
  // 头
  line(1, shY, 1.5, headY + 7, 5, lk.skin);
  dot(1.5, headY, 9.5, lk.skin);
  if (lk.mask) { ctx.fillStyle = lk.c1; ctx.fillRect(-7.5, headY + 1, 18, 8.5); }
  // 眼睛与表情
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(6, headY - 1.5, 2.6, 2.1, 0, 0, 7); ctx.fill();
  dot(6.8, headY - 1.5, 1.2, '#222');
  line(3.2, headY - 5.5, 8.5, headY - 4.2, 1.4, '#3a2a1a');
  if (!lk.mask) line(4, headY + 4.5, 7.5, headY + 4.5, 1.2, 'rgba(0,0,0,.4)');
  // 发型
  ctx.fillStyle = lk.hair;
  switch (lk.hairStyle) {
    case 'spiky':
      ctx.beginPath(); ctx.moveTo(-9, headY + 1);
      ctx.lineTo(-8, headY - 12); ctx.lineTo(-4, headY - 6); ctx.lineTo(-1, headY - 15);
      ctx.lineTo(3, headY - 7); ctx.lineTo(7, headY - 13); ctx.lineTo(10, headY - 3);
      ctx.quadraticCurveTo(2, headY - 8, -9, headY + 1); ctx.fill();
      break;
    case 'ponytail':
      ctx.beginPath(); ctx.arc(1.5, headY - 1, 9.8, Math.PI * 0.85, Math.PI * 2.05); ctx.fill();
      ctx.strokeStyle = lk.hair; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-7, headY - 5);
      ctx.quadraticCurveTo(-17, headY + 2, -13, headY + 16); ctx.stroke();
      dot(-7.5, headY - 5, 2, lk.accent);
      break;
    case 'long':
      ctx.beginPath(); ctx.arc(1.5, headY - 1, 9.8, Math.PI * 0.8, Math.PI * 2.1); ctx.fill();
      line(-8, headY - 2, -9, headY + 14, 3.5, lk.hair);
      line(10, headY - 2, 11, headY + 10, 3, lk.hair);
      break;
    case 'headband':
      ctx.beginPath(); ctx.arc(1.5, headY - 2, 9.6, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
      ctx.fillStyle = lk.accent; ctx.fillRect(-8.5, headY - 6.5, 20, 4);
      line(-9, headY - 4, -14, headY + 2, 2, lk.accent);
      break;
    case 'bun':
      ctx.beginPath(); ctx.arc(1.5, headY - 1, 9.7, Math.PI * 0.9, Math.PI * 2.1); ctx.fill();
      dot(0, headY - 12, 4, lk.hair);
      break;
    case 'cowl':
      ctx.beginPath(); ctx.arc(1.5, headY, 10.6, 0, 7); ctx.fill();
      ctx.fillStyle = lk.skin;
      ctx.beginPath(); ctx.ellipse(5, headY - 1, 5.5, 4.5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(6, headY - 1.5, 2.4, 2, 0, 0, 7); ctx.fill();
      dot(6.8, headY - 1.5, 1.1, '#222');
      break;
    case 'hood':
      ctx.fillStyle = lk.c1;
      ctx.beginPath(); ctx.moveTo(-11, headY + 7);
      ctx.quadraticCurveTo(-13, headY - 13, 1, headY - 12);
      ctx.quadraticCurveTo(14, headY - 11, 12, headY + 4);
      ctx.quadraticCurveTo(9, headY - 5, 2, headY - 5);
      ctx.quadraticCurveTo(-7, headY - 5, -7, headY + 7); ctx.closePath(); ctx.fill();
      break;
    case 'wild':
      for (let i = 0; i < 7; i++) {
        const a = -2.6 + i * 0.45;
        ctx.beginPath();
        ctx.moveTo(1.5 + Math.cos(a) * 8, headY + Math.sin(a) * 8);
        ctx.lineTo(1.5 + Math.cos(a + 0.25) * 17, headY + Math.sin(a + 0.25) * 17);
        ctx.lineTo(1.5 + Math.cos(a + 0.5) * 8, headY + Math.sin(a + 0.5) * 8);
        ctx.fill();
      }
      break;
    case 'bald':
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, headY - 3, 6, Math.PI * 1.15, Math.PI * 1.6); ctx.stroke();
      break;
  }
  // 法师帽
  if (lk.hat === 'wizard') {
    ctx.fillStyle = lk.c2;
    ctx.beginPath(); ctx.ellipse(1.5, headY - 6, 13, 4, -0.08, 0, 7); ctx.fill();
    ctx.fillStyle = lk.c1;
    ctx.beginPath(); ctx.moveTo(-7, headY - 7); ctx.lineTo(-1, headY - 27); ctx.lineTo(9, headY - 7); ctx.fill();
    ctx.fillStyle = lk.accent; ctx.fillRect(-7, headY - 10, 16, 3);
  }
  // 围巾
  if (lk.scarf) {
    line(-3, shY - 1, 5, shY - 1, 5, lk.scarf);
    ctx.strokeStyle = lk.scarf; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-4, shY);
    ctx.quadraticCurveTo(-14, shY + 4, -17, shY + 12); ctx.stroke();
  }
  // 前臂 + 武器
  const hF = limb(4, shY + 1, pose.armF, 9, 9, aw, slv, lk.skin);
  dot(hF[0], hF[1], lk.weapon === 'fist' ? 4.2 * LW : 2.6, lk.weapon === 'fist' ? lk.c2 : lk.skin);
  if (!pose.hideW && lk.weapon !== 'fist') drawWeapon(lk, hF, pose);

  ctx.restore();
  ctx.filter = 'none'; ctx.globalAlpha = 1;
}

// ============ 人设画像 ============
const PORTRAITS = [];
function makePortraits() {
  for (const cls of CLASSES) {
    const c = document.createElement('canvas');
    c.width = 120; c.height = 156;
    const g = c.getContext('2d');
    const old = ctx; ctx = g;
    const bg = g.createLinearGradient(0, 0, 0, 156);
    bg.addColorStop(0, '#23263a'); bg.addColorStop(1, '#101220');
    g.fillStyle = bg; g.fillRect(0, 0, 120, 156);
    const glow = g.createRadialGradient(60, 70, 8, 60, 70, 75);
    glow.addColorStop(0, cls.look.accent + '55'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow; g.fillRect(0, 0, 120, 156);
    g.strokeStyle = cls.look.accent + '22'; g.lineWidth = 7;
    for (let i = -2; i < 5; i++) {
      g.beginPath(); g.moveTo(i * 34, 156); g.lineTo(i * 34 + 50, 0); g.stroke();
    }
    const lk = cls.look;
    const pose = ANIMS[lk.pAnim](lk.pT, lk.pT * 26 + 8);
    renderBody(56, 140, cls, pose, 1, { animFrame: 10 });
    ctx = old;
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 130, 120, 26);
    g.fillStyle = '#fff'; g.font = 'bold 14px sans-serif'; g.textAlign = 'center';
    g.fillText(`${cls.cls}·${cls.name}`, 60, 148);
    g.strokeStyle = cls.look.accent; g.lineWidth = 2.5;
    g.strokeRect(1, 1, 118, 154);
    PORTRAITS.push(c);
  }
}

// ============ 角色 ============
class Fighter {
  constructor(slot, name, kind, ci) {
    this.slot = slot; this.name = name; this.kind = kind;
    this.ci = ci; this.cls = CLASSES[ci];
    this.kills = 0; this.deaths = 0;
    this.aiCd = 0; this.aiInp = {};
    this.tx = undefined;
    this.dispHp = this.cls.hp;
    this.spawn();
  }
  spawn() {
    this.x = 80 + Math.random() * (W - 160);
    this.y = GROUND_TOP + 20 + Math.random() * (GROUND_BOT - GROUND_TOP - 40);
    this.z = 0; this.vx = 0; this.vz = 0;
    this.face = this.x > W / 2 ? -1 : 1;
    this.maxhp = this.cls.hp; this.hp = this.maxhp; this.mp = 60;
    this.st = 'idle'; this.t = 0; this.anim = 0; this.act = null;
    this.an = 'idle'; this.at = 0; this.ad = 24;
    this.cds = [0, 0, 0];
    this.invuln = 90; this.shield = 0; this.poison = 0; this.flash = 0; this.stop = 0;
    this.hitSet = new Set(); this.bounced = false;
  }
  get alive() { return this.st !== 'dead'; }
  setSt(s, t = 0) { this.st = s; this.t = t; this.anim = 0; this.act = null; }
  clampPos() {
    this.x = Math.max(25, Math.min(W - 25, this.x));
    this.y = clampY(this.y);
  }

  step(inp) {
    if (this.stop > 0) { this.stop--; return; }   // 命中顿帧
    this.anim++;
    if (this.st === 'dead') {
      if (--this.t <= 0) { this.spawn(); broadcastNow(); }
      return;
    }
    this.mp = Math.min(100, this.mp + 0.09);
    for (let i = 0; i < 3; i++) if (this.cds[i] > 0) this.cds[i]--;
    if (this.invuln > 0) this.invuln--;
    if (this.shield > 0) this.shield--;
    if (this.flash > 0) this.flash--;
    if (this.poison > 0) {
      this.poison--;
      if (this.poison % 50 === 0) {
        this.hp -= 3; this.flash = 2;
        addText(this.x, this.y - this.z - 80, '-3', '#7ad65a');
        if (this.hp <= 0) { this.die(this.poisonFrom ?? this.slot); return; }
        broadcastNow();
      }
    }
    // 重力与落地
    if (this.z > 0 || this.vz !== 0) {
      const pv = this.vz;
      this.z += this.vz; this.vz -= GRAV;
      if (this.z <= 0) { this.z = 0; this.vz = 0; this.onLand(-pv); }
    }
    if (this.st === 'frozen') {
      if (--this.t <= 0) this.setSt('idle');
      return;
    }
    switch (this.st) {
      case 'idle': case 'walk': case 'block': {
        if (inp.block && this.z === 0) { this.st = 'block'; break; }
        if (this.st === 'block') this.st = 'idle';
        const mx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        const my = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
        this.x += mx * this.cls.spd; this.y += my * this.cls.spd * 0.72;
        if (mx) this.face = mx;
        this.clampPos();
        this.st = (mx || my) ? 'walk' : 'idle';
        if (this.z === 0) {
          if (inp.jump) { this.vz = 11.5; this.z = 0.01; }
          else if (inp.punch) this.startAction(this.cls.atk);
          else if (inp.s1) this.trySkill(0);
          else if (inp.s2) this.trySkill(1);
          else if (inp.s3) this.trySkill(2);
        } else if (inp.punch) {
          this.startAction(this.cls.atk);   // 空中攻击
        }
        break;
      }
      case 'act': this.runAction(); break;
      case 'hurt':
        this.x += this.vx; this.vx *= 0.86; this.clampPos();
        if (--this.t <= 0) this.setSt('idle');
        break;
      case 'fall':
        this.x += this.vx; this.vx *= 0.985; this.clampPos();
        break;
      case 'down':
        if (--this.t <= 0) this.setSt('idle');
        break;
    }
  }

  onLand(imp) {
    if (imp > 6) addEffect('dust', this.x, this.y);
    if (this.st === 'fall') {
      if (!this.bounced && imp > 8) {            // LF2 式落地反弹
        this.bounced = true; this.vz = imp * 0.38; this.z = 0.01;
        SFX.play('hit');
      } else {
        this.setSt('down', 70); this.invuln = 160; this.vx = 0;
        broadcastNow();
      }
    } else if (this.st === 'act' && this.act && this.act.def.endOnLand && this.act.t > 4) {
      const d = this.act.def;
      if (d.land) this.fireEvent(d.land);
      this.setSt('idle');
      broadcastNow();
    }
  }

  startAction(def) {
    this.st = 'act'; this.act = { def, t: 0 };
    this.an = def.anim; this.at = 0; this.ad = def.dur === 999 ? 40 : def.dur;
    this.anim = 0; this.hitSet.clear();
    if (def.launch) { this.vz = def.launch; this.z = Math.max(this.z, 0.01); }
    if (def.sfx) SFX.play(def.sfx);
    broadcastNow();
  }
  trySkill(i) {
    const sk = this.cls.skills[i];
    if (this.cds[i] > 0 || this.mp < sk.mp) return;
    this.mp -= sk.mp; this.cds[i] = sk.cd;
    this.startAction(sk);
  }
  runAction() {
    const a = this.act, d = a.def;
    if (d.move) { this.x += this.face * d.move; this.clampPos(); }
    if (d.trail && a.t % 3 === 0) {
      ghosts.push({ x: this.x, y: this.y, z: this.z, cls: this.cls, an: this.an,
                    at: a.t, ad: this.ad, face: this.face, life: 12 });
    }
    for (const ev of d.events || []) {
      if (ev.loop) {
        const L = ev.loop;
        if (a.t >= L.from && a.t <= L.to && (a.t - L.from) % L.every === 0) this.fireEvent(ev);
      } else if (ev.at === a.t) this.fireEvent(ev);
    }
    a.t++; this.at = a.t;
    if (!d.endOnLand && a.t >= d.dur) this.setSt('idle');
  }
  fireEvent(ev) {
    if (ev.rehit) this.hitSet.clear();
    if (ev.melee) this.melee(...ev.melee);
    if (ev.aoe) this.aoe(...ev.aoe);
    if (ev.proj) {
      const ps = Array.isArray(ev.proj) ? ev.proj : [ev.proj];
      for (const p of ps) spawnProj(this, p);
    }
    if (ev.sp) SPECIALS[ev.sp](this);
    if (ev.shake) addShake(ev.shake);
    if (ev.fx === 'explosion') { addEffect('explosion', this.x + this.face * 20, this.y - 20); sendFx('explosion', this.x + this.face * 20, this.y - 20); }
    if (ev.sfx) SFX.play(ev.sfx);
  }
  melee(reach, depth, dmg, kx, kz) {
    for (const f of fighters) {
      if (!f || f === this || !f.alive || this.hitSet.has(f.slot)) continue;
      const dx = (f.x - this.x) * this.face;
      if (dx > -14 && dx < reach && Math.abs(f.y - this.y) < depth && Math.abs(f.z - this.z) < 70) {
        this.hitSet.add(f.slot); this.stop = 3;
        dealHit(this, f, dmg, this.face * kx, kz);
      }
    }
  }
  aoe(radius, depth, dmg, kx, kz) {
    for (const f of fighters) {
      if (!f || f === this || !f.alive || this.hitSet.has(f.slot)) continue;
      const dx = f.x - this.x;
      if (Math.abs(dx) < radius && Math.abs(f.y - this.y) < depth && Math.abs(f.z - this.z) < 70) {
        this.hitSet.add(f.slot); this.stop = 2;
        dealHit(this, f, dmg, Math.sign(dx || this.face) * kx, kz);
      }
    }
  }

  applyHit(dmg, kx, kz, from, o = {}) {
    if (!this.alive) return;
    if (this.shield > 0) { addEffect('blockfx', this.x, this.y - this.z - 40); SFX.play('block'); return; }
    if (this.invuln > 0) return;
    let heavy = kz > 0 || dmg >= 15;
    const blocking = this.st === 'block';
    if (blocking) {
      dmg = Math.ceil(dmg * 0.25); kx *= 0.3; kz = 0; heavy = false;
      this.x += kx * 2; this.clampPos();
      addEffect('blockfx', this.x + this.face * 14, this.y - this.z - 38);
      SFX.play('block');
    } else {
      SFX.play(heavy ? 'hit2' : 'hit');
    }
    this.hp -= dmg; this.flash = 4; this.stop = 3;
    addText(this.x, this.y - this.z - 80, '-' + dmg, heavy ? '#ffd24e' : '#fff');
    addEffect('spark', this.x + (Math.random() * 12 - 6), this.y - this.z - 40, heavy);
    if (heavy) addShake(3);
    if (this.hp <= 0) { this.die(from); return; }
    if (o.fz) {
      this.setSt('frozen', o.fz); this.vx = 0; SFX.play('freeze');
      broadcastNow(); return;
    }
    if (o.ps) { this.poison = o.ps; this.poisonFrom = from; }
    if (blocking) { broadcastNow(); return; }
    if (kz > 0) {
      this.setSt('fall'); this.vz = kz; this.vx = kx;
      this.z = Math.max(this.z, 0.01); this.bounced = false;
    } else {
      this.setSt('hurt', 16); this.vx = kx; this.invuln = 8;
    }
    broadcastNow();
  }
  die(from) {
    this.hp = 0; this.deaths++;
    this.setSt('dead', 180);
    SFX.play('ko'); addShake(4);
    if (from !== this.slot && fighters[from]) fighters[from].kills++;
    if (this.kind !== 'remote') netSend({ t: 'd', by: from });
    broadcastNow();
  }

  // ------ 远程同步 ------
  applyRemote(m) {
    this.tx = m.x; this.ty = m.y; this.tz = m.z;
    this.face = m.f; this.hp = m.hp; this.mp = m.mp;
    this.kills = m.k; this.deaths = m.dt;
    this.shield = m.sh || 0; this.poison = m.po ? 60 : 0;
    if (m.st !== this.st || m.an !== this.an) { this.anim = 0; }
    this.st = m.st; this.an = m.an; this.at = m.at; this.ad = m.ad;
    projectiles = projectiles.filter(p => p.owner !== this.slot);
    for (const p of (m.pj || [])) {
      projectiles.push({ owner: this.slot, type: p[0], x: p[1], y: p[2], z: p[3],
                         vx: p[4], vy: p[5], vz: p[6], c: p[7] || undefined,
                         life: 120, hits: new Set(), rot: Math.random() * 6 });
    }
  }
  stepRemote() {
    this.anim++; this.at++;
    if (this.tx !== undefined) {
      this.x += (this.tx - this.x) * 0.35;
      this.y += (this.ty - this.y) * 0.35;
      this.z += (this.tz - this.z) * 0.35;
    }
  }
}

// ============ 命中分发与特殊技 ============
function dealHit(att, vic, dmg, kx, kz, o) {
  if (vic.kind === 'remote') {
    addEffect('spark', vic.x, vic.y - vic.z - 40, dmg >= 15);
    netSend({ t: 'h', to: vic.slot, d: dmg, kx, kz, fz: o && o.fz, ps: o && o.ps });
  } else {
    vic.applyHit(dmg, kx, kz, att.slot, o || {});
  }
}
function sendFx(k, x, y) { netSend({ t: 'e', k, x, y }); }

function spawnProj(f, def) {
  projectiles.push({
    owner: f.slot, type: def.type,
    x: f.x + f.face * 28, y: f.y, z: def.z0 ?? (def.type === 'quake' ? 0 : 34),
    vx: f.face * def.vx, vy: def.vy || 0, vz: def.vz || 0,
    dmg: def.dmg, kx: def.kx ?? 4, kz: def.kz || 0,
    pierce: def.pierce, splash: def.splash, fz: def.fz, ps: def.ps, c: def.c,
    life: 120, hits: new Set(), rot: 0,
  });
  broadcastNow();
}

const SPECIALS = {
  rain(f) {
    for (let i = 0; i < 9; i++) {
      projectiles.push({
        owner: f.slot, type: 'arrow',
        x: f.x + f.face * (100 + Math.random() * 220), y: clampY(f.y + (Math.random() * 120 - 60)),
        z: 230 + Math.random() * 60, vx: f.face * 0.6, vy: 0, vz: -(6 + Math.random() * 2.5),
        dmg: 10, kx: 3, kz: 6, c: '#cfe06a', life: 90, hits: new Set(), rot: 0,
      });
    }
    broadcastNow();
  },
  bolt(f) {
    const ts = fighters.filter(o => o && o !== f && o.alive)
      .sort((a, b) => Math.abs(a.x - f.x) - Math.abs(b.x - f.x)).slice(0, 3);
    for (const t of ts) {
      addEffect('bolt', t.x, t.y - t.z); sendFx('bolt', t.x, t.y - t.z);
      dealHit(f, t, 22, 0, 8);
    }
    SFX.play('explode');
  },
  teleport(f) {
    let e = null, best = 1e9;
    for (const o of fighters) {
      if (!o || o === f || !o.alive) continue;
      const d = Math.abs(o.x - f.x) + Math.abs(o.y - f.y);
      if (d < best) { best = d; e = o; }
    }
    if (!e) return;
    addEffect('tp', f.x, f.y - f.z - 35); sendFx('tp', f.x, f.y - f.z - 35);
    f.x = e.x - e.face * 42; f.y = e.y; f.face = e.face;
    f.clampPos();
    addEffect('tp', f.x, f.y - 35); sendFx('tp', f.x, f.y - 35);
  },
  heal(f) {
    const v = Math.min(35, f.maxhp - f.hp);
    f.hp += v;
    addText(f.x, f.y - f.z - 80, '+' + v, '#7ad65a');
    addEffect('heal', f.x, f.y); sendFx('heal', f.x, f.y);
    broadcastNow();
  },
  shield(f) {
    f.shield = 240;
    addEffect('ringG', f.x, f.y); sendFx('ringG', f.x, f.y);
    broadcastNow();
  },
  roar(f) {
    addEffect('ring', f.x, f.y); sendFx('ring', f.x, f.y);
  },
};

// ============ AI ============
const GAP_SKILL = { spear: 1, ninja: 1, rogue: 1 };
function aiInput(f) {
  if (--f.aiCd > 0) return f.aiInp;
  f.aiCd = 7 + Math.random() * 9;
  const inp = {};
  let t = null, best = 1e9;
  for (const o of fighters) {
    if (!o || o === f || !o.alive || o.invuln > 80) continue;
    const d = Math.abs(o.x - f.x) + Math.abs(o.y - f.y) * 2;
    if (d < best) { best = d; t = o; }
  }
  f.aiInp = inp;
  if (!t || !f.alive) return inp;
  const dx = t.x - f.x, dy = t.y - f.y, adx = Math.abs(dx);
  const aligned = Math.abs(dy) < 24;
  const canSk = i => f.cds[i] <= 0 && f.mp >= f.cls.skills[i].mp;
  if (Math.abs(dy) > 12) (dy > 0 ? inp.down = 1 : inp.up = 1);
  if (f.cls.ranged) {
    if (adx < 80) (dx > 0 ? inp.left = 1 : inp.right = 1);    // 拉开距离
    else if (adx > 320) (dx > 0 ? inp.right = 1 : inp.left = 1);
    if (Math.sign(dx) !== f.face && adx > 60) (dx > 0 ? inp.right = 1 : inp.left = 1);
    const r = Math.random();
    if (aligned && adx > 90 && Math.sign(dx) === f.face) {
      if (r < 0.3 && canSk(0)) inp.s1 = 1;
      else if (r < 0.42 && canSk(1)) inp.s2 = 1;
      else if (r < 0.5 && canSk(2)) inp.s3 = 1;
    } else if (adx < 60 && r < 0.5) inp.punch = 1;
  } else {
    if (adx > 52) (dx > 0 ? inp.right = 1 : inp.left = 1);
    else if (adx < 22) (dx > 0 ? inp.left = 1 : inp.right = 1);
    const r = Math.random();
    if (f.cls.id === 'monk' && f.hp < f.maxhp * 0.5 && canSk(1) && r < 0.6) { inp.s2 = 1; return inp; }
    if (aligned && adx < 65) {
      if (r < 0.42) inp.punch = 1;
      else if (r < 0.52 && canSk(1)) inp.s2 = 1;
      else if (r < 0.6 && canSk(2)) inp.s3 = 1;
      else if (r < 0.7) inp.block = 1;
    } else if (aligned && adx > 120) {
      const g = GAP_SKILL[f.cls.id];
      if (g !== undefined && adx < 280 && canSk(g) && r < 0.18) {
        if (Math.sign(dx) === f.face) inp['s' + (g + 1)] = 1;
      } else if (canSk(0) && r < 0.15 && Math.sign(dx) === f.face) inp.s1 = 1;
    }
  }
  return inp;
}

// ============ 联机 ============
function netSend(msg) { if (net && net.readyState === 1) net.send(JSON.stringify(msg)); }
function broadcastNow() { lastSent = -99; }
function myStateMsg() {
  const me = fighters[mySlot];
  return {
    t: 's', x: +me.x.toFixed(1), y: +me.y.toFixed(1), z: +me.z.toFixed(1),
    f: me.face, st: me.st, an: me.an, at: me.at, ad: me.ad,
    hp: Math.round(me.hp), mp: Math.round(me.mp), k: me.kills, dt: me.deaths,
    sh: me.shield, po: me.poison > 0 ? 1 : 0,
    pj: projectiles.filter(p => p.owner === mySlot)
      .map(p => [p.type, +p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1),
                 +p.vx.toFixed(2), +(p.vy || 0).toFixed(2), +(p.vz || 0).toFixed(2), p.c || 0]),
  };
}
function startOnline(name, room, ci) {
  if (location.protocol === 'file:') { setStatus('联机需要通过服务器访问页面（npm start）'); return; }
  setStatus('连接中…');
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  net = new WebSocket(`${proto}//${location.host}`);
  net.onopen = () => netSend({ t: 'join', room, name, ch: ci });
  net.onerror = () => setStatus('连接失败，请确认服务器已启动');
  net.onclose = () => { if (mode === 'online') { backToMenu(); setStatus('连接已断开'); } };
  net.onmessage = ev => {
    const m = JSON.parse(ev.data);
    switch (m.t) {
      case 'joined':
        mySlot = m.slot;
        fighters = [null, null, null, null];
        fighters[mySlot] = new Fighter(mySlot, name, 'me', ci);
        for (const p of m.peers) fighters[p.slot] = new Fighter(p.slot, p.name, 'remote', p.ch || 0);
        projectiles = []; effects = []; texts = []; ghosts = [];
        mode = 'online';
        hideMenus(); setStatus('');
        break;
      case 'full': setStatus('房间已满（最多4人）'); net.close(); net = null; break;
      case 'peer': fighters[m.slot] = new Fighter(m.slot, m.name, 'remote', m.ch || 0); break;
      case 'left':
        if (fighters[m.slot]) projectiles = projectiles.filter(p => p.owner !== m.slot);
        fighters[m.slot] = null;
        break;
      case 's': if (fighters[m.f] && m.f !== mySlot) fighters[m.f].applyRemote(m); break;
      case 'h': if (m.to === mySlot && fighters[mySlot])
        fighters[mySlot].applyHit(m.d, m.kx, m.kz, m.f, { fz: m.fz, ps: m.ps }); break;
      case 'd': if (m.f !== mySlot && m.by !== m.f && fighters[m.by]) fighters[m.by].kills++; break;
      case 'e': addEffect(m.k, m.x, m.y); break;
    }
  };
}

// ============ 菜单 / 选人 ============
const $ = id => document.getElementById(id);
function setStatus(s) { $('status').textContent = s; }
function hideMenus() { $('menu').style.display = 'none'; $('select').style.display = 'none'; }
function backToMenu() {
  mode = null; pendingMode = null;
  if (net) { net.onclose = null; net.close(); net = null; }
  $('select').style.display = 'none';
  $('menu').style.display = 'flex';
}
function showSelect() {
  $('menu').style.display = 'none';
  $('select').style.display = 'flex';
}
function buildSelect() {
  const grid = $('grid');
  CLASSES.forEach((cls, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.appendChild(PORTRAITS[i]);
    const info = document.createElement('div');
    info.className = 'skills';
    info.innerHTML =
      `<b style="color:${cls.look.accent}">HP ${cls.hp} · 速度 ${cls.spd}</b><br>` +
      cls.skills.map((s, j) => `<span>${'UIO'[j]}·${s.name}<i>${s.mp}MP</i></span>`).join('');
    card.appendChild(info);
    card.onclick = () => pickChar(i);
    grid.appendChild(card);
  });
}
function pickChar(ci) {
  if (pendingMode === 'local') {
    const pool = CLASSES.map((_, i) => i).filter(i => i !== ci);
    fighters = [new Fighter(0, '玩家', 'me', ci)];
    for (let s = 1; s <= 3; s++) {
      const pick = pool.splice((Math.random() * pool.length) | 0, 1)[0];
      fighters.push(new Fighter(s, CLASSES[pick].cls + '·' + CLASSES[pick].name, 'ai', pick));
    }
    mySlot = 0; projectiles = []; effects = []; texts = []; ghosts = [];
    mode = 'local';
    hideMenus();
  } else if (pendingMode === 'online') {
    startOnline(pendingName, pendingRoom, ci);
  }
}
let pendingName = '', pendingRoom = '';
$('btnLocal').onclick = () => { pendingMode = 'local'; showSelect(); };
$('btnOnline').onclick = () => {
  pendingName = $('inName').value.trim() || '无名氏';
  pendingRoom = $('inRoom').value.trim();
  if (!pendingRoom) { setStatus('请输入房间号'); return; }
  pendingMode = 'online'; showSelect();
};
$('btnBack').onclick = backToMenu;

// ============ 主循环：更新 ============
function update() {
  frame++;
  if (!mode) return;
  for (const f of fighters) {
    if (!f) continue;
    if (f.kind === 'remote') f.stepRemote();
    else if (f.kind === 'ai') f.step(aiInput(f));
    else f.step(readPlayerInput());
  }
  // 飞行道具（碰撞只由所有者结算）
  for (const p of projectiles) {
    p.x += p.vx; p.y += (p.vy || 0); p.z += (p.vz || 0);
    p.rot += 0.45; p.life--;
    p.y = clampY(p.y);
    if (p.z < 0) {
      p.z = 0;
      if (p.type === 'arrow') { p.vx = 0; p.vy = 0; p.vz = 0; p.life = Math.min(p.life, 10); }
      else if (p.type !== 'quake') p.life = 0;
    }
    if (p.type === 'quake' && p.life % 4 === 0) addEffect('dust', p.x, p.y);
    if (p.x < -50 || p.x > W + 50) p.life = 0;
    const mine = mode === 'local' || p.owner === mySlot;
    if (!mine || p.life <= 0 || p.dmg === undefined) continue;
    for (const f of fighters) {
      if (!f || f.slot === p.owner || !f.alive || p.hits.has(f.slot)) continue;
      if (Math.abs(f.x - p.x) < 27 && Math.abs(f.y - p.y) < 28 && p.z > f.z - 18 && p.z < f.z + 75) {
        p.hits.add(f.slot);
        dealHit(fighters[p.owner], f, p.dmg, Math.sign(p.vx || 1) * p.kx, p.kz, { fz: p.fz, ps: p.ps });
        if (p.splash) {
          addEffect('explosion', p.x, p.y - p.z); sendFx('explosion', p.x, p.y - p.z);
          SFX.play('explode');
          for (const o of fighters) {
            if (!o || o.slot === p.owner || o === f || !o.alive) continue;
            if (Math.abs(o.x - p.x) < 70 && Math.abs(o.y - p.y) < 45) dealHit(fighters[p.owner], o, 8, Math.sign(o.x - p.x) * 4, 4);
          }
        }
        if (!p.pierce) p.life = 0;
        break;
      }
    }
  }
  projectiles = projectiles.filter(p => p.life > 0);
  effects = effects.filter(e => ++e.t < e.max);
  texts = texts.filter(t => ++t.t < 45);
  ghosts = ghosts.filter(g => --g.life > 0);
  if (shakeT > 0) shakeT--; else shakeMag = 0;

  if (mode === 'online' && frame - lastSent >= 4) { lastSent = frame; netSend(myStateMsg()); }
}

// ============ 绘制 ============
function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_TOP);
  sky.addColorStop(0, '#1b2a4a'); sky.addColorStop(1, '#4a3a5e');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, GROUND_TOP - 30);
  ctx.fillStyle = '#2a2440';
  ctx.beginPath(); ctx.moveTo(0, GROUND_TOP - 30);
  for (let i = 0; i <= 8; i++) ctx.lineTo(i * 120, GROUND_TOP - 30 - (i % 2 ? 70 : 30) - (i * 37 % 25));
  ctx.lineTo(W, GROUND_TOP - 30); ctx.fill();
  ctx.fillStyle = '#ffeebb'; ctx.beginPath(); ctx.arc(820, 70, 26, 0, 7); ctx.fill();
  const gnd = ctx.createLinearGradient(0, GROUND_TOP - 30, 0, H);
  gnd.addColorStop(0, '#6b5a3e'); gnd.addColorStop(1, '#3e3424');
  ctx.fillStyle = gnd; ctx.fillRect(0, GROUND_TOP - 30, W, H - GROUND_TOP + 30);
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  for (let i = 1; i < 5; i++) {
    ctx.beginPath(); ctx.moveTo(0, GROUND_TOP - 30 + i * 48); ctx.lineTo(W, GROUND_TOP - 30 + i * 48); ctx.stroke();
  }
}

function drawFighter(f) {
  const sy = f.y - f.z;
  const dead = f.st === 'dead';
  if (dead && f.t < 130 && (f.t >> 3) % 2) return;
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(f.x, f.y + 3, Math.max(10, 22 - f.z * 0.07), 6, 0, 0, 7); ctx.fill();
  const blink = !dead && f.invuln > 0 && f.shield <= 0 && (f.anim >> 2) % 2;
  const pose = poseFor(f.st, f.an, f.at, f.ad, f.anim);
  renderBody(f.x, sy, f.cls, pose, f.face,
    { flash: f.flash > 0, alpha: blink ? 0.4 : (dead ? 0.85 : undefined) });
  // 冰冻
  if (f.st === 'frozen') {
    ctx.fillStyle = 'rgba(140,210,255,.4)';
    ctx.strokeStyle = 'rgba(220,245,255,.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(f.x - 17, sy - 72, 34, 76, 7); ctx.fill(); ctx.stroke();
    line(f.x - 10, sy - 64, f.x - 2, sy - 30, 1.5, 'rgba(255,255,255,.7)');
  }
  // 护盾
  if (f.shield > 0) {
    ctx.strokeStyle = `rgba(255,210,80,${0.5 + 0.3 * Math.sin(f.anim * 0.3)})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(f.x, sy - 34, 26, 42, 0, 0, 7); ctx.stroke();
  }
  // 中毒气泡
  if (f.poison > 0 && f.anim % 9 < 2) {
    dot(f.x + Math.sin(f.anim) * 10, sy - 50 - (f.anim % 20), 2.5, 'rgba(122,214,90,.8)');
  }
  // 名字 + 小血条 + 本机标记
  if (!dead) {
    const ty = sy - 96;
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(f.x - 22, ty + 12, 44, 5);
    ctx.fillStyle = f.hp > f.maxhp * 0.3 ? '#5ad65a' : '#ff5a4e';
    ctx.fillRect(f.x - 22, ty + 12, 44 * Math.max(0, f.hp) / f.maxhp, 5);
    ctx.fillStyle = SLOTC[f.slot]; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(f.name, f.x, ty + 6);
    if (f.slot === mySlot && f.kind === 'me') {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(f.x - 5, ty - 14); ctx.lineTo(f.x + 5, ty - 14); ctx.lineTo(f.x, ty - 7); ctx.fill();
    }
  }
}

function drawProjectile(p) {
  const sy = p.y - p.z;
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(p.x, p.y + 4, 12, 4.5, 0, 0, 7); ctx.fill();
  ctx.save(); ctx.translate(p.x, sy);
  switch (p.type) {
    case 'energy': case 'wave': {
      const c = p.c || '#ffd24e';
      if (p.type === 'wave') {
        ctx.rotate(p.vx < 0 ? Math.PI : 0);
        ctx.strokeStyle = c; ctx.lineWidth = 4; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(-6, 0, 14, -1.1, 1.1); ctx.stroke();
        ctx.lineWidth = 2.5; ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.arc(-12, 0, 12, -1, 1); ctx.stroke();
      } else {
        const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 15);
        g.addColorStop(0, '#fff'); g.addColorStop(0.4, c); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.fill();
        ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.arc(-p.vx * 1.6, 0, 9, 0, 7); ctx.fill();
      }
      break;
    }
    case 'fire': {
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 14);
      g.addColorStop(0, '#fff8d0'); g.addColorStop(0.5, '#ff9f43'); g.addColorStop(1, 'rgba(200,50,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 14, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,120,30,.7)';
      for (let i = 0; i < 3; i++) {
        const a = p.rot * 2 + i * 2.1;
        ctx.beginPath(); ctx.moveTo(-Math.sign(p.vx) * 8, Math.sin(a) * 5);
        ctx.lineTo(-Math.sign(p.vx) * (16 + Math.sin(a * 1.7) * 5), Math.sin(a) * 8);
        ctx.lineTo(-Math.sign(p.vx) * 8, Math.sin(a) * 5 + 4); ctx.fill();
      }
      break;
    }
    case 'ice':
      ctx.rotate(p.rot * 0.4);
      ctx.fillStyle = '#bfe6ff';
      ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(0, -6); ctx.lineTo(-10, 0); ctx.lineTo(0, 6); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
      break;
    case 'arrow': {
      const ang = Math.atan2(p.vz ? -p.vz : 0, p.vx || 1);
      ctx.rotate(ang);
      line(-12, 0, 10, 0, 2, '#9c6b3a');
      ctx.fillStyle = '#cfd8e3';
      ctx.beginPath(); ctx.moveTo(10, -2.5); ctx.lineTo(17, 0); ctx.lineTo(10, 2.5); ctx.fill();
      ctx.fillStyle = p.c || '#cfe06a';
      ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-17, -3); ctx.lineTo(-14, 0); ctx.lineTo(-17, 3); ctx.fill();
      break;
    }
    case 'shuriken':
      ctx.rotate(p.rot * 1.5);
      ctx.fillStyle = '#aab4c0';
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(9, -2); ctx.lineTo(11, 2); ctx.fill();
      }
      dot(0, 0, 2, '#333');
      break;
    case 'dart':
      ctx.rotate(p.vx < 0 ? Math.PI : 0);
      line(-7, 0, 5, 0, 2.2, '#3d6b2f');
      ctx.fillStyle = '#7ad65a';
      ctx.beginPath(); ctx.moveTo(5, -2); ctx.lineTo(10, 0); ctx.lineTo(5, 2); ctx.fill();
      break;
    case 'axe':
      ctx.rotate(p.rot * 1.2);
      line(-14, 0, 10, 0, 3, '#5a3b22');
      ctx.fillStyle = '#b9c2cc';
      ctx.beginPath(); ctx.moveTo(8, -2); ctx.quadraticCurveTo(12, -13, 22, -8);
      ctx.quadraticCurveTo(18, 0, 22, 8); ctx.quadraticCurveTo(12, 13, 8, 2); ctx.fill();
      break;
    case 'quake':
      ctx.strokeStyle = 'rgba(180,140,90,.9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, -4, 12, Math.PI, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(140,100,60,.6)';
      ctx.beginPath(); ctx.arc(-Math.sign(p.vx) * 12, -2, 9, Math.PI, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#8a6a42';
      dot(4, -12, 3, '#8a6a42'); dot(-6, -9, 2.4, '#9a7a52');
      break;
  }
  ctx.restore(); ctx.globalAlpha = 1;
}

function drawEffect(e) {
  const p = e.t / e.max;
  ctx.save(); ctx.translate(e.x, e.y);
  switch (e.k) {
    case 'spark': {   // LF2 式星形火花
      ctx.rotate(e.seed);
      const r = (e.big ? 26 : 16) * eo(p) + 4;
      ctx.fillStyle = e.big ? '#ffd24e' : '#ffe9a8';
      ctx.globalAlpha = 1 - p;
      for (let i = 0; i < 6; i++) {
        ctx.rotate(Math.PI / 3);
        ctx.beginPath(); ctx.moveTo(0, -2.5); ctx.lineTo(r, 0); ctx.lineTo(0, 2.5); ctx.fill();
      }
      dot(0, 0, 5 * (1 - p) + 1, '#fff');
      break;
    }
    case 'blockfx':
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = '#bfd8ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 8 + 10 * p, -1.2, 1.2); ctx.stroke();
      break;
    case 'explosion': {
      ctx.globalAlpha = 1 - p;
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 40 * eo(p) + 6);
      g.addColorStop(0, '#fff6c8'); g.addColorStop(0.5, '#ff9f43'); g.addColorStop(1, 'rgba(180,40,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 40 * eo(p) + 6, 0, 7); ctx.fill();
      break;
    }
    case 'bolt': {
      ctx.globalAlpha = 1 - p * p;
      ctx.strokeStyle = '#bfe0ff'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(8, -280);
      let yy = -280, xx = 8;
      while (yy < -30) { xx += (Math.random() * 22 - 11); yy += 42; ctx.lineTo(xx, yy); }
      ctx.lineTo(0, -10); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = 'rgba(190,225,255,.6)';
      ctx.beginPath(); ctx.ellipse(0, 0, 26 * (1 - p), 8 * (1 - p), 0, 0, 7); ctx.fill();
      break;
    }
    case 'ring': case 'ringG':
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = e.k === 'ringG' ? '#ffd24e' : '#ffb0a0';
      ctx.lineWidth = 4 * (1 - p) + 1;
      ctx.beginPath(); ctx.ellipse(0, -20, 90 * eo(p) + 8, 38 * eo(p) + 4, 0, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, -20, 60 * eo(p) + 4, 25 * eo(p) + 2, 0, 0, 7); ctx.stroke();
      break;
    case 'heal':
      ctx.globalAlpha = 1 - p;
      for (let i = 0; i < 5; i++) {
        const a = e.seed + i * 1.3, rr = 16 + i * 4;
        const hx = Math.cos(a) * rr, hy = -20 - p * 50 - i * 8;
        ctx.strokeStyle = '#7ad65a'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(hx - 4, hy); ctx.lineTo(hx + 4, hy);
        ctx.moveTo(hx, hy - 4); ctx.lineTo(hx, hy + 4); ctx.stroke();
      }
      break;
    case 'tp':
      ctx.globalAlpha = 0.7 * (1 - p);
      for (let i = 0; i < 5; i++) {
        const a = e.seed + i * 1.26;
        dot(Math.cos(a) * 18 * p, Math.sin(a) * 24 * p - 10, 6 * (1 - p) + 2, '#a55eea');
      }
      break;
    case 'dust':
      ctx.globalAlpha = 0.5 * (1 - p);
      dot(-12 * p, -3 - 6 * p, 5, '#b9a888'); dot(12 * p, -3 - 5 * p, 4, '#b9a888');
      dot(0, -4 - 8 * p, 4.5, '#cdbd9d');
      break;
  }
  ctx.restore(); ctx.globalAlpha = 1;
}

function drawHUD() {
  ctx.textAlign = 'left';
  for (let i = 0; i < 4; i++) {
    const f = fighters[i];
    if (!f) continue;
    const x = 10 + i * 238, y = 8;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath(); ctx.roundRect(x, y, 228, 58, 8); ctx.fill();
    ctx.strokeStyle = SLOTC[i]; ctx.lineWidth = 2;
    ctx.strokeRect(x + 6, y + 6, 36, 46);
    ctx.drawImage(PORTRAITS[f.ci], 18, 4, 80, 102, x + 6, y + 6, 36, 46);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif';
    ctx.fillText(`${f.name}${f.kind === 'me' ? '（你）' : ''}`, x + 50, y + 18);
    ctx.font = '11px sans-serif'; ctx.fillStyle = '#aab';
    ctx.fillText(`K${f.kills} D${f.deaths}`, x + 178, y + 18);
    f.dispHp += (f.hp - f.dispHp) * 0.12;
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(x + 50, y + 25, 168, 9);
    ctx.fillStyle = '#ffe9e0'; ctx.fillRect(x + 50, y + 25, 168 * Math.max(0, f.dispHp) / f.maxhp, 9);
    ctx.fillStyle = '#ff5a4e'; ctx.fillRect(x + 50, y + 25, 168 * Math.max(0, f.hp) / f.maxhp, 9);
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(x + 50, y + 37, 168, 6);
    ctx.fillStyle = '#4ea3ff'; ctx.fillRect(x + 50, y + 37, 168 * f.mp / 100, 6);
    if (!f.alive) {
      ctx.fillStyle = '#ffd24e'; ctx.font = 'bold 11px sans-serif';
      ctx.fillText(`复活 ${Math.ceil(f.t / 60)}s`, x + 50, y + 53);
    }
  }
  // 我的技能栏
  const me = fighters[mySlot];
  if (me && me.kind === 'me') {
    const names = ['J', 'U', 'I', 'O'];
    for (let i = 0; i < 4; i++) {
      const x = 12 + i * 92, y = H - 46;
      const sk = i === 0 ? null : me.cls.skills[i - 1];
      const ok = !sk || (me.cds[i - 1] <= 0 && me.mp >= sk.mp);
      ctx.fillStyle = ok ? 'rgba(0,0,0,.6)' : 'rgba(0,0,0,.75)';
      ctx.beginPath(); ctx.roundRect(x, y, 86, 38, 6); ctx.fill();
      if (sk && me.cds[i - 1] > 0) {
        ctx.fillStyle = 'rgba(255,255,255,.12)';
        ctx.fillRect(x, y, 86 * (me.cds[i - 1] / sk.cd), 38);
      }
      ctx.strokeStyle = ok ? me.cls.look.accent : '#555'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(x, y, 86, 38, 6); ctx.stroke();
      ctx.fillStyle = ok ? '#ffd24e' : '#777'; ctx.font = 'bold 14px monospace';
      ctx.fillText(names[i], x + 8, y + 24);
      ctx.fillStyle = ok ? '#fff' : '#888'; ctx.font = '12px sans-serif';
      ctx.fillText(sk ? sk.name : me.cls.atk.name, x + 24, y + 17);
      ctx.fillStyle = '#7fb3ff'; ctx.font = '10px sans-serif';
      ctx.fillText(sk ? sk.mp + ' MP' : '普攻', x + 24, y + 31);
    }
  }
  if (mode === 'online') {
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = '12px sans-serif';
    ctx.fillText(`房间 ${fighters.filter(Boolean).length}/4 人 · Esc 退出 · M 静音`, W - 220, H - 12);
  }
}

// 菜单背景：十人列队展示
function drawLineup() {
  for (let i = 0; i < CLASSES.length; i++) {
    const cls = CLASSES[i];
    const x = 70 + i * 91, y = 415 + (i % 2) * 52;
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(x, y + 3, 18, 5, 0, 0, 7); ctx.fill();
    renderBody(x, y, cls, ANIMS.idle(0, frame + i * 9), x < W / 2 ? 1 : -1, {});
    ctx.fillStyle = 'rgba(255,255,255,.65)'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(cls.cls + '·' + cls.name, x, y + 16);
  }
}

function render() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (shakeT > 0) ctx.translate((Math.random() - 0.5) * shakeMag * 2, (Math.random() - 0.5) * shakeMag * 2);
  drawBackground();
  if (!mode) { drawLineup(); ctx.restore(); return; }
  // 残影
  for (const g of ghosts) {
    renderBody(g.x, g.y - g.z, g.cls, poseFor('act', g.an, g.at, g.ad, g.at), g.face, { alpha: g.life / 50 });
  }
  // 按纵深排序
  const ents = [];
  for (const f of fighters) if (f) ents.push({ y: f.y, d: () => drawFighter(f) });
  for (const p of projectiles) ents.push({ y: p.y, d: () => drawProjectile(p) });
  ents.sort((a, b) => a.y - b.y);
  for (const e of ents) e.d();
  for (const e of effects) drawEffect(e);
  for (const t of texts) {
    ctx.globalAlpha = 1 - t.t / 45;
    ctx.fillStyle = t.c; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(t.str, t.x, t.y - t.t * 1.1);
    ctx.globalAlpha = 1;
  }
  drawHUD();
  ctx.restore();
}

// ============ 启动 ============
makePortraits();
buildSelect();
(function loop() { update(); render(); requestAnimationFrame(loop); })();
