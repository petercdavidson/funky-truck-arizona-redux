// The title truck, the speedometer, the Esc wreck, flip counts, airtimes, Endless milestones and stats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, TILE, KICK, MILESTONE_SHOW } from '../src/game.js';
import { TrickTracker, airName } from '../src/tricks.js';
import { SoundWatcher } from '../src/sound-events.js';
import { validStats } from '../src/stats.js';
import { memoryStore } from './helpers.mjs';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
const settle = (g, n = 120) => { for (let i = 0; i < n; i++) g.step(); };

test('the speedometer reads the centre of mass, so it doesn\'t wobble while the truck turns over', () => {
  const g = new Game(data);
  g.startPractice(0);
  settle(g, 150);
  const t = g.truck;
  // Up high, falling and spinning, with nothing touching it: the centre of mass only speeds up.
  for (let i = 0; i < 10; i += 2) { t.T[i + 1] -= 3000; t.P[i] = t.T[i] - 8; t.P[i + 1] = t.T[i + 1] - 1; }
  t.probePrev = null;
  t.addSpin(0.12);
  g.speedKmh = 0;
  let centreDrops = 0, lastKmh = 0, apart = 0;
  for (let i = 0; i < 120; i++) {
    g.step();
    const chassis = Math.hypot(t.T[0] - t.P[0], t.T[1] - t.P[1]);
    if (i > 0 && g.speedKmh < lastKmh - 1e-9) centreDrops++;
    apart = Math.max(apart, Math.abs(chassis - t.speed));
    lastKmh = g.speedKmh;
  }
  assert.equal(centreDrops, 0, 'the speedometer never dropped');
  assert.ok(apart > 0.5, `the chassis point's speed swung away from the centre's (by ${apart.toFixed(2)} px a step)`);
});

test('the title truck jumps when tapped, turns over the way it was hit, and stays in the middle', () => {
  const g = new Game(data);
  settle(g, 300);
  const t = g.garageTruck;
  assert.equal(g.kickTitleTruck(0, 0), false, 'a tap away from it misses');
  const y0 = t.centre()[1];
  assert.ok(g.kickTitleTruck(t.T[2], t.T[3]), 'the back wheel is hit');
  settle(g, 20);
  assert.ok(t.centre()[1] < y0 - 40, 'it jumped');
  assert.ok(t.bodyRot > 10, `hit at the back, it turns nose down (${t.bodyRot.toFixed(0)}°)`);
  // Tapped again and again, it flies up out of sight (no limit), and comes back down.
  for (let i = 0; i < 60; i++) { if (i % 10 === 0) g.kickTitleTruck(t.T[0], t.T[1]); g.step(); }
  let top = Infinity;
  for (let i = 0; i < 300; i++) { g.step(); top = Math.min(top, t.centre()[1]); }
  assert.ok(top < -300, `flew well above the page (${Math.round(top)})`);
  assert.ok(KICK.push > 0);
  settle(g, 1500);
  assert.ok(Math.abs(t.centre()[0] - 288) < 1, 'kept in the middle');
  assert.ok(t.T[3] <= 170.01 && t.T[5] <= 170.01, 'resting on its floor');
  // The garage's truck can't be knocked about.
  g.showMenu('garage');
  assert.equal(g.kickTitleTruck(t.T[0], t.T[1]), false);
});

test('Esc wreck: only outside Classic and Time Trial, once, and the run goes on', () => {
  const g = new Game(data);
  g.startCampaign(true);
  assert.equal(g.selfWreck(), false, 'not in Classic');
  g.startTrial(0);
  assert.equal(g.selfWreck(), false, 'not in Time Trial');
  g.practiceClassic = true;
  g.startPractice(1);
  assert.equal(g.selfWreck(), false, 'not by Classic rules in Practice');
  g.startEndless();
  settle(g, 150);
  assert.ok(g.selfWreck());
  assert.ok(g.wreck && g.selfWrecked);
  assert.equal(g.selfWreck(), false, 'already wrecked');
  settle(g, 1500);
  assert.equal(g.screen, 'playing', 'no damage: the pieces tumble until you leave');
  assert.equal(g.damage, 0);
  assert.equal(g.stats.selfWrecks, 1);
});

test('Esc wreck with damage on: the loose cab takes damage until it\'s wrecked for real', () => {
  const g = new Game(data);
  g.startCampaign();
  settle(g, 150);
  assert.ok(g.selfWreck());
  let steps = 0;
  while (g.screen === 'playing' && steps < 3000) { g.step(); steps++; }
  assert.equal(g.screen, 'gameOver');
  assert.ok(g.wrecked, 'a wreck');
  assert.equal(g.damage, 1000);
});

test('Esc wreck: a body that rolls over the finish line still finishes the stage', () => {
  const g = new Game(data);
  g.practiceDamage = false;
  g.startPractice(0);
  settle(g, 150);
  const t = g.truck, x = (g.levelData.width - 10.5) * TILE;
  const ground = g.world.collide(x, 0, x, g.levelData.height * TILE);
  const dx = x - t.T[0], dy = ground.y - 40 - t.T[1];
  for (let i = 0; i < 10; i += 2) { t.T[i] += dx; t.T[i + 1] += dy; t.P[i] = t.T[i] - 9; t.P[i + 1] = t.T[i + 1]; }
  t.probePrev = null;
  assert.ok(g.selfWreck());
  let steps = 0;
  while (g.screen === 'playing' && steps < 800) { g.step(); steps++; }
  assert.equal(g.screen, 'gameOver');
  assert.ok(g.finished && !g.wrecked, 'finished, not wrecked');
});

test('flips are counted out in the air as each turn is completed', () => {
  const tr = new TrickTracker();
  const truck = { rearContact: false, frontContact: false, airborne: true, flipAccum: 0, T: [0, 0], P: [0, 0] };
  const pops = [];
  for (let deg = 0; deg <= 960; deg += 10) {
    truck.flipAccum = deg;
    tr.step(truck, null, false, true);
    if (tr.flipPop && pops[pops.length - 1] !== tr.flipPop.turns) pops.push(tr.flipPop.turns);
  }
  assert.deepEqual(pops, [1, 2], '+1 at 260°, +2 at 620°');
  assert.equal(tr.flipCounts, 2);
  assert.equal(tr.flipPop.kind, 'Backflip');
  truck.rearContact = truck.frontContact = true;
  truck.airborne = false;
  tr.step(truck, 960, false, true);
  assert.deepEqual(tr.show.names.slice(0, 1), ['Double Backflip'], 'the landing names the whole flip');
  const w = new SoundWatcher(), g = new Game(data);
  g.startPractice(0);
  w.observe(g);
  g.tricks.flipCounts++; g.tricks.flipPop = { turns: 3, kind: 'Frontflip', timer: 10 };
  assert.deepEqual(w.observe(g).events.filter((e) => e.type === 'flipCount'), [{ type: 'flipCount', turns: 3 }]);
});

test('Big Air and Huge Air say their airtime', () => {
  assert.equal(airName(119), 'Big Air (1.7s)');
  assert.equal(airName(139), 'Big Air (1.9s)');
  assert.equal(airName(140), 'Huge Air (2.0s)');
  assert.equal(airName(200), 'Huge Air (2.8s)');
});

test('Endless celebrates distances, scores and a new best, one at a time', () => {
  const g = new Game(data, { random: () => 0.4 });
  g.bestEndless = 600;
  g.startEndless();
  assert.equal(Game.milestoneMetres(4), 1000);
  assert.equal(Game.milestoneMetres(5), 1500);
  g.distance = 41;  // 102 m
  g.checkMilestones();
  assert.equal(g.milestone.text, '100 m!');
  g.distance = 260; g.score = 12000;  // 650 m
  g.checkMilestones();
  assert.deepEqual(g.milestones, ['250 m!', '500 m!', '5,000 points!', '10,000 points!', 'New best distance!']);
  g.checkMilestones();
  assert.equal(g.milestones.length, 5, 'each only once');
  const seen = [g.milestone.text];
  for (let i = 0; i < 2000 && g.milestone; i++) { g.tickMilestone(); if (g.milestone && g.milestone.text !== seen[seen.length - 1]) seen.push(g.milestone.text); }
  assert.deepEqual(seen, ['100 m!', '250 m!', '500 m!', '5,000 points!', '10,000 points!', 'New best distance!']);
  assert.ok(MILESTONE_SHOW > 60);
});

test('stats are counted as you play, saved, and checked when read back', () => {
  const store = memoryStore();
  const g = new Game(data, { store });
  g.startPractice(0);
  settle(g, 200);
  const t = g.truck;
  for (let i = 0; i < 10; i += 2) { t.T[i + 1] -= 900; t.P[i + 1] -= 900; }
  t.probePrev = null;
  g.keys.left = true;
  settle(g, 120);
  g.keys.left = false;
  settle(g, 600);
  assert.equal(g.stats.runs, 1);
  assert.ok(g.stats.maxAir > 60, `the jump's airtime (${g.stats.maxAir})`);
  assert.ok(g.stats.distance > 0 && g.stats.topSpeed > 0 && g.stats.driveSteps > 0);
  const before = g.stats.frontflips;
  g.tricks.addFlip(-720, 720);
  assert.ok(g.stats.mostFlips >= 2);
  assert.equal(g.stats.frontflips, before + 2, 'a Double Frontflip is two flips');
  assert.ok(g.stats.tricks.Frontflip >= 1);
  g.showMenu('practiceSelect');
  assert.deepEqual(store.get('stats'), g.stats, 'saved on leaving the run');
  assert.deepEqual(new Game(data, { store }).stats, g.stats, 'read back');
  store.set('stats', { runs: -3, maxAir: 'lots', topSpeed: 1e99, tricks: { Clean: NaN, Wheelie: 4 }, distance: 12.5 });
  const s = new Game(data, { store }).stats;
  assert.deepEqual([s.runs, s.maxAir, s.topSpeed, s.tricks.Clean, s.tricks.Wheelie, s.distance], [0, 0, 0, 0, 4, 12.5]);
  assert.deepEqual(validStats('junk'), validStats(null));
});

test('the crash cam takes over smoothly: no jolt in the camera at the moment of the wreck', () => {
  for (const moving of [true, false]) {
    const g = new Game(data, { random: () => 0.5 });
    g.startCampaign();
    for (let i = 0; i < 300; i++) { g.keys.up = moving; g.step(); }
    g.keys.up = false;
    g.step();
    let pc = [g.camX, g.camY], last = null, jerk = 0;
    g.damage = 1000;
    for (let i = 0; i < 70; i++) {
      g.step();
      const m = [g.camX - pc[0], g.camY - pc[1]];
      if (last) jerk = Math.max(jerk, Math.hypot(m[0] - last[0], m[1] - last[1]));
      last = m; pc = [g.camX, g.camY];
    }
    // (before it eased in what it follows and its keeping-in-view, this was over 6)
    assert.ok(jerk < 2.5, `${moving ? 'moving' : 'at rest'}: the camera's motion changed by ${jerk.toFixed(2)} px in a step`);
  }
});

test('the crash cam pulls back to keep the wreck\'s pieces in view, and can be switched off', async () => {
  const { CRASH_CAM } = await import('../src/game.js');
  for (const on of [true, false]) {
    const g = new Game(data, { random: () => 0.4 });
    if (!on) g.toggle('crashCam');
    g.dynamicCamera = false;
    g.startEndless();
    settle(g, 150);
    const t = g.truck;
    for (let i = 0; i < 10; i += 2) { t.P[i] = t.T[i] - 12; t.P[i + 1] = t.T[i + 1] + 4; } // flung forwards and up
    g.selfWreck();
    let most = 1;
    for (let i = 0; i < 300; i++) {
      g.step();
      most = Math.max(most, g.zoom);
      if (on) {
        // every piece is in the frame (or the body is, once they're too far apart)
        const { zoom } = g.crashFrame();
        if (zoom < CRASH_CAM.maxZoom && g.zoom >= zoom - 0.001 && i > 150) {
          const W = g.wreck.T;
          for (let p = 0; p < W.length; p += 2) {
            assert.ok(W[p] >= g.camX - 5 && W[p] <= g.camX + g.viewW * g.zoom + 5, 'a piece is out of frame across');
          }
        }
      }
    }
    if (on) assert.ok(most > 1.1, `pulled back (${most.toFixed(2)})`);
    else assert.equal(most, 1, 'switched off: no pull-back');
  }
  // Spread too far for the most it zooms out, it stays centred on all the pieces.
  const y = new Game(data, { random: () => 0.4 });
  y.startEndless();
  settle(y, 150);
  y.selfWreck();
  settle(y, 100);
  const W = y.wreck.T, p = y.wreck.wheels[1].p;
  W[p * 2 + 1] -= 9000; y.wreck.P[p * 2 + 1] -= 9000; // one wheel, a long way up
  settle(y, 60);
  const { centre, zoom } = y.crashFrame();
  assert.equal(zoom, CRASH_CAM.maxZoom);
  assert.ok(Math.abs(y.camY + y.viewH * y.zoom / 2 - centre[1]) < 60, `centred where every piece would fit (${Math.round(y.camY + y.viewH * y.zoom / 2 - centre[1])})`);
  const c = new Game(data);
  c.crashCam = true;
  c.startCampaign(true);
  assert.equal(c.crashCamActive, false, 'not in Classic');
});

test('the pause menu\'s Options shows only the options that apply', async () => {
  const { BUTTONS, TALL_BUTTONS } = await import('../src/render.js');
  const g = new Game(data);
  for (const layout of [BUTTONS, TALL_BUTTONS]) {
    const shown = (game) => layout.pauseOptions.filter((b) => b.show(game)).map((b) => b.action);
    g.startCampaign();
    assert.deepEqual(shown(g), ['sound', 'oneButton', 'dynamicCamera', 'crashCam', 'imperial', 'showFps', 'pauseBack']);
    g.startCampaign(true);
    assert.deepEqual(shown(g), ['sound', 'showFps', 'pauseBack'], 'Classic: no controls or cameras');
  }
  g.startCampaign();
  g.togglePause();
  g.openPauseOptions();
  assert.equal(g.screen, 'pauseOptions');
  settle(g, 50);
  assert.equal(g.screen, 'pauseOptions', 'the game stays paused');
  g.closePauseOptions();
  assert.equal(g.screen, 'paused');
});

test('High Scores reset: Yes only works after five seconds, and clears every best and stat', () => {
  const store = memoryStore();
  const g = new Game(data, { store });
  g.bestPlay = 1234; g.bestEndless = 50; g.trialBests = { 0: 700 }; g.stats.runs = 9;
  store.set('ghost0', { v: 1 });
  g.showMenu('stats');
  g.askReset();
  settle(g, 349);
  assert.equal(g.resetScores(), false, 'not yet');
  assert.equal(g.bestPlay, 1234);
  g.step();
  assert.ok(g.resetScores());
  assert.deepEqual([g.bestPlay, g.bestEndless, g.trialBests, g.stats.runs, g.resetConfirm], [0, 0, {}, 0, null]);
  assert.equal(store.get('ghost0'), null);
  assert.equal(store.get('stats').runs, 0);
  g.askReset();
  g.cancelReset();
  assert.equal(g.resetConfirm, null);
});

test('the garage can reset the truck to the one you start with', () => {
  const store = memoryStore();
  const g = new Game(data, { store });
  g.cycleLook('body', 2); g.cycleLook('tyre', 1);
  g.resetLook();
  assert.deepEqual(g.look, { body: 0, tyre: 0, hub: 0, paint: 0 });
  assert.deepEqual(store.get('truckLook'), g.look);
});
