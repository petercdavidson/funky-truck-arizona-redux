// main.js — boots the game in the page: loading, the fixed-step loop, and all input
// (keyboard, mouse/touch on menus, on-screen driving controls, gamepads).

import { Game, STEP_HZ, emptyKeys } from './game.js';
import { loadAssets } from './assets.js';
import { Renderer, hitButton } from './render.js';
import { Sound } from './audio.js';
import { SoundWatcher } from './sound-events.js';

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
const sound = new Sound();
const watcher = new SoundWatcher();
let engineState = { on: false };
let scrapeState = { on: false, speed: 0 };

// Browsers only start audio after the player taps or presses a key.
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => sound.unlock(), { capture: true });

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
  KeyR: 'upright',
  Space: ['restart', 'one'], Enter: 'restart', NumpadEnter: 'restart', ControlLeft: 'restart', ControlRight: 'restart',
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
    if (e.code === 'KeyM') { doAction('sound'); return; }
    if (game.screen === 'title' && (e.code === 'Space' || e.code === 'Enter')) { doAction('play'); return; }
  }
  if (name) { for (const n of [name].flat()) keyboard[n] = down; combineKeys(); }
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
  sound.suspend(document.hidden);
});

function toggleFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else el.requestFullscreen?.().catch(() => {});
}

// ---- menus (mouse and touch)

function goMenu() { game.showMenu('title'); }

function doAction(a) {
  if (a === 'sound') {
    game.toggle('soundOn');
    sound.setEnabled(game.soundOn);
    sound.play('start');
    return;
  }
  sound.play('click');
  if (a === 'oneButton' || a === 'practiceDamage' || a === 'practiceClassic' || a === 'dynamicCamera' || a === 'ghostOn') { game.toggle(a); return; }
  if (a === 'play') game.startCampaign();
  else if (a === 'classic') game.startCampaign(true);
  else if (a === 'endless') game.startEndless();
  else if (a === 'endRun') game.endRun();
  else if (a === 'practice') game.showMenu('practiceSelect');
  else if (a === 'trial') game.showMenu('trialSelect');
  else if (/^trial\d$/.test(a)) game.startTrial(Number(a.slice(5)));
  else if (a === 'garage') game.showMenu('garage');
  else if (a === 'help') game.showMenu('help');
  else if (a === 'menu') goMenu();
  else if (a === 'again') game.restart();
  else if (a === 'nextStage') { if (game.mode === 'trial') game.nextTrial(); else game.nextPractice(); }
  else if (a === 'resume') game.togglePause();
  else if (a.startsWith('stage')) game.startPractice(Number(a.slice(5)));
  else {
    const m = /^(body|paint|tyre|hub)([+-]1)$/.exec(a);
    if (m) game.cycleLook(m[1], Number(m[2]));
  }
  renderer.hover = null;
  canvas.style.cursor = '';
}

function stagePoint(e) {
  const rect = canvas.getBoundingClientRect();
  return renderer.toMenu(e.clientX - rect.left, e.clientY - rect.top);
}

canvas.addEventListener('pointerdown', (e) => {
  setTouchMode(e.pointerType === 'touch');
  const [x, y] = stagePoint(e);
  const b = hitButton(game.screen, x, y, game, renderer.tall);
  if (b) { e.preventDefault(); doAction(b.action); }
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  const [x, y] = stagePoint(e);
  const b = hitButton(game.screen, x, y, game, renderer.tall);
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

// Touch zones (the one-button option on a touch screen): the screen (apart from the buttons) is in
// three parts. The middle drives, the right tilts forwards (clockwise), and the left tilts back
// (anticlockwise) in the air and reverses on the ground; held with the middle, the left tilts back
// on the ground too (the game decides: the `back` key). Fingers in several parts combine. A finger
// that slides into another part switches to it.
{
  const tap = document.getElementById('tap');
  const pointers = new Map(); // pointerId -> 'left' | 'middle' | 'right'
  const zoneAt = (e) => { const x = e.clientX / window.innerWidth; return x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : 'middle'; };
  const update = () => {
    const zones = new Set(pointers.values());
    touchKeys.up = zones.has('middle');
    touchKeys.right = zones.has('right');
    touchKeys.back = zones.has('left');
    combineKeys();
  };
  tap.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    setTouchMode(true);
    tap.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, zoneAt(e));
    update();
  });
  tap.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const zone = zoneAt(e);
    if (pointers.get(e.pointerId) !== zone) { pointers.set(e.pointerId, zone); update(); }
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    tap.addEventListener(ev, (e) => { pointers.delete(e.pointerId); update(); });
  }
}

document.getElementById('pause-button').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  game.togglePause();
});

document.getElementById('upright-button').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (game.upright()) sound.play('click');
});

// Stop long-press menus and double-tap zoom from getting in the way on phones.
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
// iOS Safari takes a double tap then a hold as selecting text, and pops up its magnifier.
// Cancelling the touch's default action stops that (and any other selection or zoom gesture);
// the game's own controls use pointer events, which still arrive.
for (const ev of ['touchstart', 'touchend']) {
  document.addEventListener(ev, (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
}

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
    padKeys.one ||= b(0);
    padKeys.upright ||= b(3);                      // Y
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
    T: t.T.slice(), camX: game.camX, camY: game.camY, zoom: game.zoom, rr: t.rearWheelRot, fr: t.frontWheelRot,
    G: game.ghostT && game.screen !== 'title' ? game.ghostT.slice() : null,
    gT: g.T.slice(), grr: g.rearWheelRot, gfr: g.frontWheelRot,
    W: game.wreck ? game.wreck.T.slice() : null,
  };
}

function lerpView(a, b, t) {
  const L = (x, y) => x + (y - x) * t;
  return {
    T: a.T.map((x, i) => L(x, b.T[i])), camX: L(a.camX, b.camX), camY: L(a.camY, b.camY), zoom: L(a.zoom, b.zoom),
    rr: L(a.rr, b.rr), fr: L(a.fr, b.fr),
    gT: a.gT.map((x, i) => L(x, b.gT[i])), grr: L(a.grr, b.grr), gfr: L(a.gfr, b.gfr),
    W: a.W && b.W && a.W.length === b.W.length ? a.W.map((x, i) => L(x, b.W[i])) : b.W,
    G: a.G && b.G ? a.G.map((x, i) => L(x, b.G[i])) : b.G,
  };
}

let last = 0, acc = 0, prev = null, seenTeleport = -1, seenShift = 0;

/** Tell the page where the game view is, so the pause and flip buttons sit inside it. */
let viewKey = '';
function placeView() {
  const rect = canvas.getBoundingClientRect(), k = renderer.cssPerDevice;
  const x = rect.left + renderer.offX * k, y = rect.top + renderer.offY * k, w = renderer.viewW * renderer.scale * k;
  const key = `${x.toFixed(1)},${y.toFixed(1)},${w.toFixed(1)}`;
  if (key === viewKey) return;
  viewKey = key;
  const st = document.documentElement.style;
  st.setProperty('--view-x', `${x}px`); st.setProperty('--view-y', `${y}px`); st.setProperty('--view-w', `${w}px`);
}

function frame(now) {
  requestAnimationFrame(frame);
  placeView();
  if (!last) last = now;
  acc += Math.min(now - last, 250);
  last = now;
  pollGamepads();
  const before = game.screen;
  let steps = 0;
  while (acc >= DT && steps < 8) {
    prev = snapshot();
    game.step();
    if (game.shiftCount !== seenShift) {
      // Endless Mode scrolled the world left, or a looping track jumped back a repeat; move the
      // previous frame with it.
      seenShift = game.shiftCount;
      for (let i = 0; i < 10; i += 2) { prev.T[i] -= game.lastShift; prev.T[i + 1] -= game.lastShiftY; }
      prev.camX -= game.lastShift; prev.camY -= game.lastShiftY;
      prev.W = null;
    }
    const heard = watcher.observe(game);
    for (const e of heard.events) sound.play(e.type, e);
    engineState = heard.engine;
    scrapeState = heard.scrape;
    acc -= DT;
    steps++;
    if (game.screen !== before) break;
  }
  if (steps === 8 || game.screen !== before) acc = 0;
  if (game.teleportCount !== seenTeleport) { seenTeleport = game.teleportCount; prev = null; }
  if (game.screen !== 'playing') { engineState = { on: false }; scrapeState = { on: false, speed: 0 }; }
  sound.updateEngine(engineState);
  sound.updateScrape(scrapeState);
  // Tell the page which screen this is before drawing, so the on-screen controls always match it.
  const ds = document.body.dataset;
  if (ds.screen !== game.screen) ds.screen = game.screen;
  const cur = snapshot();
  const t = game.screen === 'playing' || game.screen === 'title' || game.screen === 'garage' ? Math.min(acc / DT, 1) : 1;
  renderer.draw(game, prev ? lerpView(prev, cur, t) : cur);
  const one = game.oneButtonActive ? '1' : '0', up = game.canUpright && game.screen === 'playing' ? '1' : '0';
  if (ds.onebutton !== one) ds.onebutton = one;
  if (ds.upright !== up) ds.upright = up;
}

function fit() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const rect = canvas.getBoundingClientRect();
  renderer.resize(rect.width, rect.height, dpr);
}

/**
 * Test hook for automated screenshots, e.g. ?test=play&stage=5&frames=400&touch=1
 *   test   = title | garage | help | practice | trials | play | trial | endless | paused | gameover
 *            (trial: a Time Trial of `stage`, 9 for All Nine)
 *   stage  = stage index for play (0-8), frames = steps to simulate with the gas held
 *   seed   = for endless: a number, so the same course comes up every time
 *   look   = body,tyre,hub[,paint] (e.g. 3,2,4,0), touch = 1 to show the touch controls
 * Nothing is saved to storage while this is active.
 */
function applyTestParams() {
  const q = new URLSearchParams(location.search);
  const test = q.get('test');
  if (!test) return;
  game.store = { get: () => null, set: () => {} };
  if (q.get('touch') === '1') setTouchMode(true);
  if (q.get('look')) {
    const [body, tyre, hub, paint] = q.get('look').split(',').map(Number);
    Object.assign(game.look, { body, tyre, hub, paint: Number.isInteger(paint) ? paint : body });
  }
  const frames = Number(q.get('frames')) || 0;
  const screens = { garage: 'garage', help: 'help', practice: 'practiceSelect', trials: 'trialSelect', title: 'title' };
  if (screens[test]) {
    game.showMenu(screens[test]);
    for (let i = 0; i < 300; i++) game.step();
    return;
  }
  if (test === 'endless') {
    let s = Number(q.get('seed')) || 1;
    game.random = () => (s = (s * 16807) % 2147483647) / 2147483647;
    game.startEndless();
  } else if (test === 'trial') {
    game.startTrial(Number(q.get('stage')) || 0);
  } else {
    if (q.get('classic') === '1') game.practiceClassic = true;
    if (q.get('damage') === '0') game.practiceDamage = false;
    game.startPractice(Number(q.get('stage')) || 0);
  }
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
    sound.setEnabled(game.soundOn);
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
