// main.js — boots the game in the page: loading, the fixed-step loop, and all input
// (keyboard, mouse/touch on menus, on-screen driving controls, gamepads).

import { Game, STEP_HZ, emptyKeys } from './game.js';
import { loadAssets } from './assets.js';
import { Renderer, hitButton } from './render.js';

const DT = 1000 / STEP_HZ;

// localStorage can be unavailable (private mode, blocked storage); never let that break the game.
const store = {
  get(k) {
    try { const v = localStorage.getItem('funkytruck.' + k); return v === null ? null : JSON.parse(v); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem('funkytruck.' + k, JSON.stringify(v)); } catch { /* ignore */ }
  },
};

const canvas = document.getElementById('game');
const loading = document.getElementById('loading');
const loadingBar = document.getElementById('loading-bar');
const touchUI = document.getElementById('touch');

let game, renderer;

// ---------------------------------------------------------------------------------------------
// Input state. Several sources can hold the same control, so each source keeps its own keys
// and the game sees the OR of all of them.

const keyboard = emptyKeys();
const touchKeys = emptyKeys();
const padKeys = emptyKeys();

function combineKeys() {
  const k = emptyKeys();
  for (const src of [keyboard, touchKeys, padKeys]) for (const n in k) k[n] = k[n] || src[n];
  game.keys = k;
}

const KEY_MAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  KeyP: 'pause',
  Space: 'restart', Enter: 'restart', NumpadEnter: 'restart', ControlLeft: 'restart', ControlRight: 'restart',
};

function setTouchMode(on) {
  if (renderer.touchMode === on) return;
  renderer.touchMode = on;
  document.body.classList.toggle('touch-mode', on);
}

function onKey(e, down) {
  const name = KEY_MAP[e.code];
  if (name || e.code === 'Escape') e.preventDefault();
  if (down) setTouchMode(false);
  if (down && !e.repeat) {
    if (e.code === 'Escape') { if (game.screen !== 'title') goMenu(); return; }
    if (e.code === 'KeyF') { toggleFullscreen(); return; }
    if (game.screen === 'title' && (e.code === 'Space' || e.code === 'Enter')) { doAction('play'); return; }
  }
  if (name) { keyboard[name] = down; combineKeys(); }
}

window.addEventListener('keydown', (e) => onKey(e, true));
window.addEventListener('keyup', (e) => onKey(e, false));
window.addEventListener('blur', () => {
  for (const src of [keyboard, touchKeys, padKeys]) Object.assign(src, emptyKeys());
  combineKeys();
  if (game?.screen === 'playing') game.togglePause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game?.screen === 'playing') game.togglePause();
});

function toggleFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else el.requestFullscreen?.().catch(() => {});
}

// ---- menus (mouse and touch)

function goMenu() { game.showMenu('title'); }

function doAction(a) {
  if (a === 'play') game.startCampaign();
  else if (a === 'practice') game.showMenu('practiceSelect');
  else if (a === 'garage') game.showMenu('garage');
  else if (a === 'help') game.showMenu('help');
  else if (a === 'menu') goMenu();
  else if (a === 'again') game.restart();
  else if (a === 'resume') game.togglePause();
  else if (a.startsWith('stage')) game.startPractice(Number(a.slice(5)));
  else {
    const m = /^(body|tyre|hub)([+-]1)$/.exec(a);
    if (m) game.cycleLook(m[1], Number(m[2]));
  }
  renderer.hover = null;
  canvas.style.cursor = '';
}

function stagePoint(e) {
  const rect = canvas.getBoundingClientRect();
  return renderer.toStage(e.clientX - rect.left, e.clientY - rect.top);
}

canvas.addEventListener('pointerdown', (e) => {
  setTouchMode(e.pointerType === 'touch');
  const [x, y] = stagePoint(e);
  const b = hitButton(game.screen, x, y);
  if (b) { e.preventDefault(); doAction(b.action); }
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  const [x, y] = stagePoint(e);
  const b = hitButton(game.screen, x, y);
  renderer.hover = b;
  canvas.style.cursor = b ? 'pointer' : '';
});

canvas.addEventListener('pointerleave', () => { renderer.hover = null; });

// ---- on-screen driving controls (multi-touch: each button tracks its own pointers)

for (const btn of touchUI.querySelectorAll('[data-key]')) {
  const name = btn.dataset.key;
  const pointers = new Set();
  const update = () => {
    touchKeys[name] = pointers.size > 0;
    btn.classList.toggle('held', pointers.size > 0);
    combineKeys();
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    setTouchMode(true);
    btn.setPointerCapture?.(e.pointerId);
    pointers.add(e.pointerId);
    update();
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    btn.addEventListener(ev, (e) => { pointers.delete(e.pointerId); update(); });
  }
}

document.getElementById('touch-pause').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  game.togglePause();
});

// Stop long-press menus and double-tap zoom from getting in the way on phones.
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// ---- gamepads

let padPauseWasDown = false;
let padStartWasDown = false;

function pollGamepads() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  Object.assign(padKeys, emptyKeys());
  let pauseDown = false, startDown = false;
  for (const p of pads) {
    const b = (i) => !!p.buttons[i]?.pressed;
    const ax = p.axes[0] || 0;
    padKeys.up ||= b(0) || b(7) || b(12);          // A, right trigger, d-pad up
    padKeys.down ||= b(1) || b(6) || b(13);        // B, left trigger, d-pad down
    padKeys.left ||= b(14) || ax < -0.4;
    padKeys.right ||= b(15) || ax > 0.4;
    padKeys.restart ||= b(0) || b(9);
    pauseDown ||= b(9);                            // Start
    startDown ||= b(0) || b(9);
  }
  if (pads.length) {
    if (pauseDown && !padPauseWasDown && (game.screen === 'playing' || game.screen === 'paused')) game.togglePause();
    if (startDown && !padStartWasDown && game.screen === 'title') doAction('play');
    padKeys.restart = padKeys.restart && game.screen === 'gameOver';
    combineKeys();
  }
  padPauseWasDown = pauseDown;
  padStartWasDown = startDown;
}

// ---------------------------------------------------------------------------------------------
// Fixed 70 Hz simulation with interpolated rendering, so motion is smooth at any refresh rate.

function snapshot() {
  const t = game.truck, g = game.garageTruck;
  return {
    T: t.T.slice(), camX: game.camX, camY: game.camY, rr: t.rearWheelRot, fr: t.frontWheelRot,
    gT: g.T.slice(), grr: g.rearWheelRot, gfr: g.frontWheelRot,
  };
}

function lerpView(a, b, t) {
  const L = (x, y) => x + (y - x) * t;
  return {
    T: a.T.map((x, i) => L(x, b.T[i])), camX: L(a.camX, b.camX), camY: L(a.camY, b.camY),
    rr: L(a.rr, b.rr), fr: L(a.fr, b.fr),
    gT: a.gT.map((x, i) => L(x, b.gT[i])), grr: L(a.grr, b.grr), gfr: L(a.gfr, b.gfr),
  };
}

let last = 0, acc = 0, prev = null, seenTeleport = -1;

function frame(now) {
  requestAnimationFrame(frame);
  if (!last) last = now;
  acc += Math.min(now - last, 250);
  last = now;
  pollGamepads();
  const before = game.screen;
  let steps = 0;
  while (acc >= DT && steps < 8) {
    prev = snapshot();
    game.step();
    acc -= DT;
    steps++;
    if (game.screen !== before) break;
  }
  if (steps === 8 || game.screen !== before) acc = 0;
  if (game.teleportCount !== seenTeleport) { seenTeleport = game.teleportCount; prev = null; }
  const cur = snapshot();
  const t = game.screen === 'playing' || game.screen === 'title' || game.screen === 'garage' ? Math.min(acc / DT, 1) : 1;
  renderer.draw(game, prev ? lerpView(prev, cur, t) : cur);
  document.body.dataset.screen = game.screen;
}

function fit() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const rect = canvas.getBoundingClientRect();
  renderer.resize(rect.width, rect.height, dpr);
}

/**
 * Test hook for automated screenshots, e.g. ?test=play&stage=5&frames=400&touch=1
 *   test   = title | garage | help | practice | play | paused | gameover
 *   stage  = stage index for play (0-8), frames = steps to simulate with the gas held
 *   look   = body,tyre,hub (e.g. 3,2,4), touch = 1 to show the touch controls
 * Nothing is saved to storage while this is active.
 */
function applyTestParams() {
  const q = new URLSearchParams(location.search);
  const test = q.get('test');
  if (!test) return;
  game.store = { get: () => null, set: () => {} };
  if (q.get('touch') === '1') setTouchMode(true);
  if (q.get('look')) {
    const [body, tyre, hub] = q.get('look').split(',').map(Number);
    Object.assign(game.look, { body, tyre, hub });
  }
  const frames = Number(q.get('frames')) || 0;
  const screens = { garage: 'garage', help: 'help', practice: 'practiceSelect', title: 'title' };
  if (screens[test]) {
    game.showMenu(screens[test]);
    for (let i = 0; i < 300; i++) game.step();
    return;
  }
  game.startPractice(Number(q.get('stage')) || 0);
  game.keys.up = true;
  for (let i = 0; i < frames && game.screen === 'playing'; i++) {
    game.keys.right = game.truck.bodyRot < -25; game.keys.left = game.truck.bodyRot > 25;
    game.step();
  }
  game.keys = emptyKeys();
  if (test === 'paused') game.togglePause();
  if (test === 'gameover') { game.damage = 1000; for (let i = 0; i < 400 && game.screen === 'playing'; i++) game.step(); }
}

async function boot() {
  try {
    const assets = await loadAssets('assets/', (p) => { loadingBar.style.width = `${Math.round(p * 100)}%`; });
    game = new Game(assets.levels, { store });
    renderer = new Renderer(canvas, assets);
    window.__funkyTruck = { game, renderer }; // handy for debugging in the console
    setTouchMode(window.matchMedia('(pointer: coarse)').matches);
    new ResizeObserver(fit).observe(canvas);
    fit();
    loading.hidden = true;
    applyTestParams();
    requestAnimationFrame(frame);
  } catch (err) {
    loading.textContent = `Couldn't start the game: ${err.message}`;
    throw err;
  }
}

boot();
