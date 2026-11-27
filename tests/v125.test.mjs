// 1.25.0: View Width and the Camera screen, the crash cam at a level's side, Sandbox's Autopilot,
// clouds only up high, dead birds' poses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, TILE, unpackLevel, VIEW_WIDTHS, CRASH_CAM } from '../src/game.js';
import { SANDBOX_ROW, SANDBOX_ROWS } from '../src/sandbox.js';
import { skyAt, cloudsNear, CLOUD_KINDS } from '../src/critters.js';
import { soundSpeedKmh, formatMach } from '../src/units.js';
import { memoryStore } from './helpers.mjs';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
data.stunts = JSON.parse(readFileSync(new URL('../assets/stunts.json', import.meta.url))).map(unpackLevel);
const settle = (g, n = 120) => { for (let i = 0; i < n; i++) g.step(); };
const halfpipe = 9 + data.stunts.findIndex((s) => s.name === 'Halfpipe');

test('View Width: saved, the least the camera pulls back, and not in 2006 Mode', () => {
  const store = memoryStore();
  const g = new Game(data, { store });
  assert.equal(g.viewWidth, 0);
  g.cycleViewWidth(); g.cycleViewWidth();
  assert.equal(new Game(data, { store }).viewWidth, 2, 'saved');
  g.viewWidth = VIEW_WIDTHS.length - 1;
  for (const dyn of [true, false]) {
    g.dynamicCamera = dyn;
    g.startCampaign();
    settle(g, 200);
    assert.ok(g.zoom >= VIEW_WIDTHS.at(-1)[1] - 1e-9, `dynamic ${dyn}: zoom ${g.zoom}`);
  }
  g.startCampaign({ retro: true });
  settle(g, 200);
  assert.equal(g.zoom, 1, '2006 Mode keeps the original view');
  const junk = memoryStore(); junk.set('viewWidth', 99);
  assert.equal(new Game(data, { store: junk }).viewWidth, 0, 'junk read back');
});

test('the Camera screen opens from Options and from the pause menu\'s Options, and goes back', () => {
  const g = new Game(data);
  g.showMenu('options'); g.openCamera();
  assert.equal(g.screen, 'cameraOptions');
  g.closeCamera();
  assert.equal(g.screen, 'options');
  g.startCampaign(); g.togglePause(); g.openPauseOptions(); g.openCamera();
  assert.equal(g.screen, 'pauseCamera');
  settle(g, 30);
  assert.equal(g.screen, 'pauseCamera', 'stays paused');
  g.openPauseOptions();
  assert.equal(g.screen, 'pauseOptions');
});

test('a level narrower than the view sits in the middle of it, and the crash cam at its side stays put', () => {
  for (const vw of [0, 3]) {
    const g = new Game(data, { random: () => 0.4 });
    g.practiceDamage = false;
    g.viewW = 900; g.viewH = 448; g.viewWidth = vw;
    g.startPractice(halfpipe);
    settle(g, 100);
    const W = g.levelData.width * TILE;
    // Wreck it heading hard for the right-hand side.
    const t = g.truck;
    for (let i = 0; i < 10; i += 2) { t.P[i] = t.T[i] - 25; t.P[i + 1] = t.T[i + 1] + 6; }
    g.selfWreck();
    let most = 0, leftmost = Infinity;
    for (let i = 0; i < 500; i++) {
      g.step();
      most = Math.max(most, g.zoom);
      leftmost = Math.min(leftmost, g.camX + g.viewW * g.zoom / 2);
    }
    // the view's middle never runs off left of the level's middle by more than half a view
    assert.ok(leftmost > W / 2 - g.viewW, `view width ${vw}: the view's middle got to ${leftmost.toFixed(0)} (level ${W} wide)`);
    assert.ok(most < CRASH_CAM.maxZoom * g.baseZoom * 0.6, `view width ${vw}: pulled back to ${most.toFixed(2)}`);
    if (g.maxCamX < 0) assert.ok(Math.abs(g.camX - g.maxCamX / 2) < 1e-6, 'centred');
  }
});

test('Autopilot: off by default; Drive Itself gets along Endless with nothing pressed; Cruise holds the gas', () => {
  assert.equal(SANDBOX_ROW.autopilot.dflt, 0);
  assert.ok(!SANDBOX_ROWS.some((r) => r.key === 'clouds'), 'no Clouds setting');
  const run = (choice, steps = 3000) => {
    const g = new Game(data, { random: () => 0.4 });
    g.sandbox.course = 0; g.sandbox.autopilot = choice; g.sandbox.birds = 0; g.sandbox.weeds = 0;
    g.startSandbox();
    settle(g, steps);
    return g;
  };
  assert.ok(run(0).metres < 20, 'off: it stays put');
  const drive = run(3, 6000);
  assert.ok(drive.metres > 300, `Drive Itself: ${drive.metres} m`);
  assert.ok(run(2).metres > 100, 'Cruise drives on');
  // What you press wins: braking with Cruise on holds it back.
  const g = new Game(data, { random: () => 0.4 });
  g.sandbox.course = 0; g.sandbox.autopilot = 2;
  g.startSandbox(); settle(g, 100);
  g.keys.down = true;
  assert.equal(g.driveKeys().up, false); assert.equal(g.driveKeys().down, true);
});

test('Autopilot: Land Level brings a truck dropped nose-down round to land on its wheels', () => {
  for (const [choice, wheels] of [[1, true], [0, false]]) {
    const g = new Game(data, { random: () => 0.4 });
    g.sandbox.course = 0; g.sandbox.autopilot = choice; g.sandbox.birds = 0; g.sandbox.weeds = 0;
    g.startSandbox(); settle(g, 150);
    const t = g.truck, [cx, cy] = [t.T[0], t.T[1] - 500];
    // turn it 120° and lift it 500 px
    const a = 120 * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), o = [t.T[0], t.T[1]];
    for (const A of [t.T, t.P]) for (let i = 0; i < 10; i += 2) {
      const dx = A[i] - o[0], dy = A[i + 1] - o[1];
      A[i] = cx + dx * c - dy * s; A[i + 1] = cy + dx * s + dy * c;
    }
    t.probePrev = null;
    let rot = null;
    for (let i = 0; i < 400 && rot === null; i++) { g.step(); if (g.airSteps === 0) rot = t.bodyRot; }
    assert.ok(rot !== null, 'landed');
    if (wheels) assert.ok(Math.abs(rot) < 30, `landed at ${rot.toFixed(0)}°`);
  }
});

test('clouds: no fade in (they show from CLOUDS_FROM up), out at the top of the weather', () => {
  assert.ok(skyAt(0).clouds === 1 && skyAt(1).clouds === 1 && skyAt(8).clouds === 1);
  assert.equal(skyAt(30).clouds, 0);
});

test('clouds come in several shapes, each with its bottom below its puffs', () => {
  const kinds = new Set();
  for (const c of cloudsNear(0, -60000, 200000, -1000)) {
    kinds.add(c.kind);
    assert.ok(c.puffs.length >= 2 && c.puffs.every(([, dy, r]) => dy + r <= c.bottom + 1e-9));
  }
  for (const k of CLOUD_KINDS) assert.ok(kinds.has(k), k);
});

test('Mach: by the speed of sound where you are (9,999 km/h is Mach 8.1 at the ground, faster through cold thin air)', () => {
  assert.equal(Math.round(soundSpeedKmh(0)), 1225);
  assert.equal(formatMach(9999, 0), 'Mach 8.1');
  assert.equal(formatMach(1300, 0), 'Mach 1.0');
  assert.equal(formatMach(1200, 0), '');
});

test('a controller jumps the title truck, and tips it back or forwards', () => {
  const g = new Game(data);
  g.showMenu('title');
  settle(g, 100);
  const y0 = g.garageTruck.T[1];
  assert.ok(g.nudgeTitleTruck('jump'));
  settle(g, 6);
  assert.ok(g.garageTruck.T[1] < y0 - 10, 'up it goes');
  for (const [how, sign] of [['back', -1], ['forwards', 1]]) {
    const h = new Game(data);
    h.showMenu('title'); settle(h, 100);
    const r0 = h.garageTruck.bodyRot;
    for (let i = 0; i < 3; i++) { h.nudgeTitleTruck(how); settle(h, 3); }
    assert.ok(sign * (h.garageTruck.bodyRot - r0) > 5, `${how}: turned ${(h.garageTruck.bodyRot - r0).toFixed(0)}°`);
  }
  g.showMenu('options');
  assert.equal(g.nudgeTitleTruck('jump'), false, 'only on the title screen');
});
