// main.js — boots the game in the page: loading, the fixed-step loop, and all input
// (keyboard, mouse/touch on menus, on-screen driving controls, gamepads).

import { Game, STEP_HZ, emptyKeys } from './game.js';
import { loadAssets } from './assets.js';
import { Renderer, hitButton, buttonsFor } from './render.js';
import { Sound } from './audio.js';
import { SoundWatcher } from './sound-events.js';
import { lerpBattle } from './battle.js';

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
  KeyC: 'boost', ShiftLeft: 'boost', ShiftRight: 'boost', // Battle's boost (held)
  Space: ['restart', 'one'], Enter: 'restart', NumpadEnter: 'restart', ControlLeft: 'restart', ControlRight: 'restart',
};

function setTouchMode(on) {
  if (renderer.touchMode === on) return;
  renderer.touchMode = on;
  document.body.classList.toggle('touch-mode', on);
}

/** The mode picker's buttons, and moving its highlight (the arrow keys, or a gamepad) by `delta`. */
const modeButtons = () => buttonsFor('modes', renderer.tall);
function moveModeChoice(delta) {
  const list = modeButtons(), i = list.indexOf(renderer.hover);
  renderer.hover = list[i < 0 ? 0 : (i + delta + list.length) % list.length];
}
/** Start the mode highlighted in the mode picker (Standard if none is). */
function chooseMode() {
  const b = modeButtons().includes(renderer.hover) ? renderer.hover : null;
  doAction(b ? b.action : 'standard');
}

/**
 * Esc: the easter egg first (outside Classic and Time Trial, a truck being driven is wrecked on
 * the spot, and its pieces tumble with no game over), then back a level as usual.
 */
function escape() {
  if (game.screen === 'playing' && game.selfWreck()) { sound.play('wreck'); return; }
  if (game.screen === 'pauseOptions') { doAction('pauseBack'); return; }
  if (game.screen === 'sandboxTweaks') { doAction('tweaksBack'); return; }
  if (game.screen === 'stats' && game.resetConfirm) { doAction('resetNo'); return; }
  if (game.screen !== 'title') goMenu();
}

/** Battle's presses: a missile, and the jump. */
const PRESS_KEYS = { KeyX: 'fire', KeyZ: 'jump' };

function onKey(e, down) {
  const name = KEY_MAP[e.code];
  if (name || e.code === 'Escape' || PRESS_KEYS[e.code]) e.preventDefault();
  if (down) setTouchMode(false);
  if (down && !e.repeat) {
    if (e.code === 'Escape') { escape(); return; }
    if (e.code === 'KeyF') { toggleFullscreen(); return; }
    if (e.code === 'KeyM') { doAction('sound'); return; }
    if (PRESS_KEYS[e.code]) { game.press(PRESS_KEYS[e.code]); return; }
    if (game.screen === 'title' && (e.code === 'Space' || e.code === 'Enter')) { doAction('play'); moveModeChoice(0); return; }
    if (game.screen === 'modes') {
      if (name === 'up' || name === 'down') { moveModeChoice(name === 'up' ? -1 : 1); return; }
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') { chooseMode(); return; }
    }
  }
  if (name) { for (const n of [name].flat()) keyboard[n] = down; combineKeys(); }
}

window.addEventListener('keydown', (e) => onKey(e, true));
window.addEventListener('keyup', (e) => onKey(e, false));
document.addEventListener('visibilitychange', () => { if (document.hidden && game) game.saveStats(); });
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

/** Back a level: from a run, to its stage list (Practice, Time Trial) or the title; else the title. */
function goMenu() {
  const inRun = game.screen === 'playing' || game.screen === 'paused' || game.screen === 'gameOver';
  game.showMenu(inRun ? game.quitScreen : 'title');
}

function doAction(a) {
  if (a === 'sound') {
    game.toggle('soundOn');
    sound.setEnabled(game.soundOn);
    sound.play('start');
    return;
  }
  sound.play('click');
  if (['oneButton', 'practiceDamage', 'practiceClassic', 'dynamicCamera', 'crashCam', 'ghostOn', 'showFps'].includes(a)) { game.toggle(a); return; }
  if (a === 'play') game.showMenu('modes');
  else if (a === 'back') game.showMenu('title');
  else if (a === 'stats') game.showMenu('stats');
  else if (a === 'pauseOptions') game.openPauseOptions();
  else if (a === 'pauseBack') game.closePauseOptions();
  else if (a === 'lookReset') game.resetLook();
  else if (a === 'resetAsk') game.askReset();
  else if (a === 'resetNo') game.cancelReset();
  else if (a === 'resetYes') game.resetScores();
  else if (a === 'standard') game.startCampaign();
  else if (a === 'classic') game.startCampaign(true);
  else if (a === 'endless') game.startEndless();
  else if (a === 'battle') game.startBattle();
  else if (a === 'rally') game.showMenu('rallySelect');
  else if (/^rally\d$/.test(a)) game.startRally(Number(a.slice(5)));
  else if (a === 'sandbox') game.showMenu('sandbox');
  else if (a === 'sbGo') game.startSandbox();
  else if (a === 'sbReset') game.resetSandbox();
  else if (a.startsWith('sb:')) { const [, key, d] = a.split(':'); game.stepSandbox(key, Number(d)); }
  else if (a === 'tweaks') game.openTweaks();
  else if (a === 'tweaksBack') game.closeTweaks();
  else if (a === 'endRun') game.endRun();
  else if (a === 'practice') game.showMenu('practiceSelect');
  else if (a === 'trial') game.showMenu('trialSelect');
  else if (a === 'options') game.showMenu('options');
  else if (/^trial\d$/.test(a)) game.startTrial(Number(a.slice(5)));
  else if (a === 'garage') game.showMenu('garage');
  else if (a === 'help') game.showMenu('help');
  else if (a === 'menu') goMenu();
  else if (a === 'again') game.restart();
  else if (a === 'nextStage') { if (game.mode === 'trial') game.nextTrial(); else if (game.mode === 'rally') game.nextRally(); else game.nextPractice(); }
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

/** Whether the point (x, y) in menu coordinates is on the title screen's truck. */
function onTitleTruck(x, y) {
  return game.screen === 'title' && game.garageTruck.hits(...renderer.toTitleTruck(x, y));
}

canvas.addEventListener('pointerdown', (e) => {
  setTouchMode(e.pointerType === 'touch');
  const [x, y] = stagePoint(e);
  // The title's truck is drawn over everything, so it's hit first: tap it to knock it up.
  if (onTitleTruck(x, y)) { e.preventDefault(); game.kickTitleTruck(...renderer.toTitleTruck(x, y)); sound.play('boing'); return; }
  const b = hitButton(game.screen, x, y, game, renderer.tall);
  if (b) { e.preventDefault(); doAction(b.action); }
  // A tap away from the mode picker's buttons closes it.
  else if (game.screen === 'modes') { e.preventDefault(); doAction('back'); }
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  const [x, y] = stagePoint(e);
  const b = hitButton(game.screen, x, y, game, renderer.tall);
  renderer.hover = b;
  canvas.style.cursor = b || onTitleTruck(x, y) ? 'pointer' : '';
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

// Battle's fire and jump buttons: a press each (a quick tap still counts).
for (const btn of touchUI.querySelectorAll('[data-press]')) {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setTouchMode(true);
    game.press(btn.dataset.press);
    btn.classList.add('held');
    setTimeout(() => btn.classList.remove('held'), 120);
  });
}

// One button on a touch screen: holding anywhere on the screen (apart from the pause and flip
// buttons) is the button. Any number of fingers count as one.
{
  const tap = document.getElementById('tap');
  const pointers = new Set();
  const update = () => { touchKeys.one = pointers.size > 0; combineKeys(); };
  tap.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    setTouchMode(true);
    tap.setPointerCapture?.(e.pointerId);
    pointers.add(e.pointerId);
    update();
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
let padUpWasDown = false, padDownWasDown = false;
let padFireWasDown = false, padJumpWasDown = false;

function pollGamepads() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  Object.assign(padKeys, emptyKeys());
  let pauseDown = false, startDown = false, upDown = false, downDown = false, fireDown = false, jumpDown = false;
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
    padKeys.boost ||= b(5);                        // Battle: right bumper boosts,
    fireDown ||= b(2);                             // X fires a missile,
    jumpDown ||= b(4);                             // and the left bumper jumps
    pauseDown ||= b(9);                            // Start
    startDown ||= b(0) || b(9);
    upDown ||= b(12) || (p.axes[1] || 0) < -0.5;
    downDown ||= b(13) || (p.axes[1] || 0) > 0.5;
  }
  if (pads.length) {
    if (pauseDown && !padPauseWasDown && (game.screen === 'playing' || game.screen === 'paused')) game.togglePause();
    if (startDown && !padStartWasDown && game.screen === 'title') { doAction('play'); moveModeChoice(0); }
    else if (game.screen === 'modes') {
      if (startDown && !padStartWasDown) chooseMode();
      else if (upDown && !padUpWasDown) moveModeChoice(-1);
      else if (downDown && !padDownWasDown) moveModeChoice(1);
    }
    if (fireDown && !padFireWasDown) game.press('fire');
    if (jumpDown && !padJumpWasDown) game.press('jump');
    padKeys.restart = padKeys.restart && game.screen === 'gameOver';
    combineKeys();
  }
  padPauseWasDown = pauseDown;
  padStartWasDown = startDown;
  padUpWasDown = upDown;
  padDownWasDown = downDown;
  padFireWasDown = fireDown;
  padJumpWasDown = jumpDown;
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
    B: game.battle ? game.battle.snapshot() : null,
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
    B: b.B && lerpBattle(a.B, b.B, t),
  };
}

let last = 0, acc = 0, prev = null, seenTeleport = -1, seenShift = 0;

/** Tell the page where the game view is, so the pause and flip buttons sit inside it. */
let viewKey = '';
function placeView() {
  const rect = canvas.getBoundingClientRect(), k = renderer.cssPerDevice;
  const x = rect.left + renderer.offX * k, y = rect.top + renderer.offY * k, w = renderer.viewW * renderer.scale * k;
  const key = `${x.toFixed(1)},${y.toFixed(1)},${w.toFixed(1)},${renderer.viewH.toFixed(1)}`;
  if (key === viewKey) return;
  viewKey = key;
  const st = document.documentElement.style;
  st.setProperty('--view-x', `${x}px`); st.setProperty('--view-y', `${y}px`); st.setProperty('--view-w', `${w}px`);
  st.setProperty('--view-h', `${renderer.viewH * renderer.scale * k}px`);
}

// The frame rate (an option): frames drawn over the last half second, shown in the corner.
const fpsBox = document.getElementById('fps');
let fpsFrames = 0, fpsSince = 0;
function countFrame(now) {
  fpsBox.hidden = !game.showFps;
  if (!game.showFps) { fpsFrames = 0; fpsSince = now; return; }
  fpsFrames++;
  if (now - fpsSince >= 500) {
    fpsBox.textContent = `${Math.round(fpsFrames * 1000 / (now - fpsSince))} fps`;
    fpsFrames = 0; fpsSince = now;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  placeView();
  countFrame(now);
  if (!last) last = now;
  // Sandbox's slow motion runs fewer steps a second (each step is the same as ever).
  const slow = game.mode === 'sandbox' && game.screen === 'playing' ? game.slowMotion : 1;
  acc += Math.min(now - last, 250) * slow;
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
      prev.W = null; prev.B = null;
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
  const t = ['playing', 'title', 'modes', 'garage'].includes(game.screen) ? Math.min(acc / DT, 1) : 1;
  renderer.draw(game, prev ? lerpView(prev, cur, t) : { ...cur, B: cur.B && lerpBattle(null, cur.B, 1) });
  const one = game.oneButtonActive ? '1' : '0', up = game.canUpright && game.screen === 'playing' ? '1' : '0';
  if (ds.onebutton !== one) ds.onebutton = one;
  if (ds.upright !== up) ds.upright = up;
  if (ds.mode !== game.mode) ds.mode = game.mode;
  if (game.battle?.opts.weapons) showCounts(game.battle);
}

/** Battle: what's left, on the touch buttons. */
const fireCount = document.getElementById('fire-count'), jumpCount = document.getElementById('jump-count');
function showCounts(b) {
  const U = b.tune.unlimited, f = U ? '∞' : String(b.missilesLeft), j = U ? '∞' : String(b.jumps);
  if (fireCount.textContent !== f) { fireCount.textContent = f; fireCount.parentElement.classList.toggle('empty', !U && b.missilesLeft === 0); }
  if (jumpCount.textContent !== j) { jumpCount.textContent = j; jumpCount.parentElement.classList.toggle('empty', !U && b.jumps === 0); }
}

function fit() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const rect = canvas.getBoundingClientRect();
  renderer.resize(rect.width, rect.height, dpr);
}

/**
 * Test hook for automated screenshots, e.g. ?test=play&stage=5&frames=400&touch=1
 *   test   = title | modes | stats | options | garage | help | practice | trials | rallies | sandboxSetup | play | trial
 *            | endless | battle | rally | sandbox | paused | gameover
 *            (trial: a Time Trial of `stage`, 9 for All Nine)
 *   stage  = stage index for play (0-8), frames = steps to simulate with the gas held
 *   seed   = for endless: a number, so the same course comes up every time
 *   test=custom plays the level being edited in tools/editor.html (damage=0 for no damage)
 *   look   = body,tyre,hub[,paint] (e.g. 3,2,4,0), touch = 1 to show the touch controls
 * Nothing is saved to storage while this is active.
 */
/** A level from the level editor, checked: { name, width, height, tiles, start }, or null. */
function customLevel(v) {
  if (!v || typeof v !== 'object') return null;
  const { width: w, height: h, tiles, start } = v;
  const ok = Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w * h <= 4e6
    && Array.isArray(tiles) && tiles.length === h
    && tiles.every((row) => Array.isArray(row) && row.length === w && row.every((id) => Number.isInteger(id) && id >= 0 && id < game.data.collision.length))
    && Array.isArray(start) && start.length === 2 && start.every(Number.isFinite);
  return ok ? { name: typeof v.name === 'string' && v.name ? v.name.slice(0, 40) : 'Custom', width: w, height: h, tiles, start } : null;
}

function applyTestParams() {
  const q = new URLSearchParams(location.search);
  const test = q.get('test');
  if (!test) return;
  // The level editor (tools/editor.html) leaves the level being edited here.
  const custom = test === 'custom' ? customLevel(store.get('editorLevel')) : null;
  game.store = { get: () => null, set: () => {} };
  if (q.get('touch') === '1') setTouchMode(true);
  if (q.get('look')) {
    const [body, tyre, hub, paint] = q.get('look').split(',').map(Number);
    Object.assign(game.look, { body, tyre, hub, paint: Number.isInteger(paint) ? paint : body });
  }
  const frames = Number(q.get('frames')) || 0;
  const screens = { garage: 'garage', help: 'help', practice: 'practiceSelect', trials: 'trialSelect', rallies: 'rallySelect', sandboxSetup: 'sandbox', title: 'title', modes: 'modes', stats: 'stats', options: 'options' };
  if (screens[test]) {
    game.showMenu(screens[test]);
    for (let i = 0; i < 300; i++) game.step();
    return;
  }
  if (test === 'endless') {
    let s = Number(q.get('seed')) || 1;
    game.random = () => (s = (s * 16807) % 2147483647) / 2147483647;
    game.startEndless();
  } else if (test === 'battle') {
    let s = Number(q.get('seed')) || 1;
    game.random = () => (s = (s * 16807) % 2147483647) / 2147483647;
    game.startBattle();
  } else if (test === 'rally') {
    let s = Number(q.get('seed')) || 1;
    game.random = () => (s = (s * 16807) % 2147483647) / 2147483647;
    game.startRally(Number(q.get('stage')) || 0);
  } else if (test === 'sandbox') {
    game.sandbox.track = Number(q.get('stage')) || 0;
    game.startSandbox();
  } else if (test === 'trial') {
    game.startTrial(Number(q.get('stage')) || 0);
  } else if (test === 'custom') {
    // Played like a stunt track in Practice: no finish line (Restart in the pause menu).
    if (!custom) { game.showMenu('title'); return; }
    if (q.get('damage') === '0') game.practiceDamage = false;
    game.data.stunts.push(custom);
    game.startPractice(game.data.levels.length + game.data.stunts.length - 1);
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
