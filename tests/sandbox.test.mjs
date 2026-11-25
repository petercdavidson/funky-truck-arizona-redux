// Sandbox Mode (sandbox.js): its settings, its cars, its finish line and clock, and High Scores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, TILE, unpackLevel } from '../src/game.js';
import { SANDBOX_ROWS, defaultSandbox, validSandbox, sandboxValue, AWAY_FOR } from '../src/sandbox.js';
import { memoryStore } from './helpers.mjs';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
data.stunts = JSON.parse(readFileSync(new URL('../assets/stunts.json', import.meta.url))).map(unpackLevel);
const seeded = (seed) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const finite = (A) => A.every(Number.isFinite);

/** Put your truck just over (or short of) x, on the ground. */
function moveTo(g, x) {
  const t = g.truck, y = g.battle.groundAt(x) - 30;
  const dx = x - t.T[0], dy = y - t.T[1];
  for (const A of [t.T, t.P]) for (let i = 0; i < 10; i += 2) { A[i] += dx; A[i + 1] += dy; }
  t.probePrev = null;
}

test('sandbox settings: defaults, saving, checking what is read back', () => {
  const d = defaultSandbox();
  for (const row of SANDBOX_ROWS) assert.ok(Number.isInteger(d[row.key]));
  assert.equal(d.course, 0, 'Endless is the default track');
  assert.equal(sandboxValue(d, 'gravity'), 1);
  assert.equal(sandboxValue(d, 'power'), 1);
  assert.equal(sandboxValue(d, 'rivals'), 0, 'no rival cars by default');
  assert.equal(sandboxValue(d, 'enemies'), 0, 'no enemy cars by default');
  assert.equal(sandboxValue(d, 'hitboxes'), false);
  for (const gone of ['boost', 'ammo', 'traffic', 'track']) assert.ok(!SANDBOX_ROWS.some((r) => r.key === gone), `${gone} is not a setting`);
  assert.deepEqual(validSandbox({ power: 99, gravity: 0, course: 11, slow: -1 }, 13), { ...d, gravity: 0, course: 11 });
  assert.deepEqual(validSandbox('junk'), d);
  const store = memoryStore();
  const g = new Game(data, { store });
  assert.equal(g.sandboxCourses, 13);
  assert.deepEqual([0, 1, 9, 10, 12].map((i) => g.sandboxCourseName(i)), ['Endless', 'Stage 1', 'Stage 9', 'Mega Ramp', 'Halfpipe']);
  g.stepSandbox('gravity', -1);
  assert.equal(store.get('sandbox').gravity, d.gravity - 1);
  g.stepSandbox('power', -5); // wraps round
  assert.ok(g.sandbox.power >= 0 && g.sandbox.power < SANDBOX_ROWS.find((r) => r.key === 'power').choices.length);
  g.resetSandbox();
  assert.deepEqual({ ...g.sandbox, course: 0 }, { ...d, course: 0 });
});

test('sandbox: tapping a setting opens its list of choices, and picking one sets it', () => {
  const store = memoryStore();
  const g = new Game(data, { store });
  g.showMenu('sandbox');
  g.pickSandbox('gravity');
  assert.equal(g.sandboxPick, 'gravity');
  g.setSandbox(g.sandboxPick, 5); // Jupiter
  assert.equal(sandboxValue(g.sandbox, 'gravity'), 2.5);
  assert.equal(g.sandboxPick, null, 'the list closes');
  assert.equal(store.get('sandbox').gravity, 5);
  g.pickSandbox('course');
  g.setSandbox('course', 12);
  assert.equal(g.sandbox.course, 12);
  g.setSandbox('course', 99); // out of range: ignored
  assert.equal(g.sandbox.course, 12);
  g.pickSandbox('nonsense');
  assert.equal(g.sandboxPick, null);
  g.pickSandbox('slow');
  g.showMenu('title');
  assert.equal(g.sandboxPick, null, 'leaving the screen closes it');
});

test('sandbox: gravity, drive power, spin and springs change your truck (and only in Sandbox)', () => {
  const g = new Game(data, { random: seeded(12) });
  g.sandbox = { ...defaultSandbox(), course: 1, gravity: 0, power: 4, spin: 3, springs: 3 };
  g.startSandbox();
  const t = g.truck;
  assert.equal(t.gravity, 0);
  assert.equal(t.power, 3);
  assert.equal(t.tiltPower, 4);
  assert.equal(t.springK, 0.7);
  const y = t.T[1];
  for (let i = 0; i < 100; i++) g.step();
  assert.ok(Math.abs(t.T[1] - y) < 1, 'with no gravity it floats where it was dropped');
  g.startPractice(0);
  assert.deepEqual([t.gravity, t.power, t.tiltPower, t.springK], [0.11, 1, 1, 0.1], 'back to normal elsewhere');
});

test('sandbox: boost, jumps and missiles never run out; air jumps work in the air', () => {
  const g = new Game(data, { random: seeded(13) });
  g.sandbox = { ...defaultSandbox(), course: 1, airJumps: 1 };
  g.startSandbox();
  for (let i = 0; i < 150; i++) g.step();
  const b = g.battle;
  g.keys.boost = true;
  for (let i = 0; i < 400; i++) g.step();
  assert.equal(b.boosting, true, 'still boosting after more than a full meter');
  g.keys.boost = false;
  for (let i = 0; i < 30; i++) { if (i % 10 === 0) g.press('fire'); g.step(); }
  assert.equal(b.missilesLeft, 3);
  assert.ok(b.missiles.length + b.blasts.length > 0);
  // in the air: jump, and jump again
  for (let i = 0; i < 2; i++) { g.press('jump'); g.step(); for (let j = 0; j < 20; j++) g.step(); }
  assert.ok(g.airSteps > 10, 'up in the air');
  const vy = g.truck.T[1] - g.truck.P[1];
  g.press('jump'); g.step();
  assert.ok(g.truck.T[1] - g.truck.P[1] < vy - 3, 'an air jump');
});

test('sandbox cars: rivals and enemies, as many as asked for, added and taken away during a run', () => {
  const g = new Game(data, { random: seeded(14) });
  g.sandbox = { ...defaultSandbox(), course: 1, rivals: 3, enemies: 2 };
  g.startSandbox();
  assert.equal(g.battle.racers.length, 3);
  assert.equal(g.battle.enemies.length, 2);
  assert.ok(g.battle.racers.every((e) => e.s === 1), 'rivals drive your way');
  assert.ok(g.battle.enemies.every((e) => e.s === -1 && e.kind !== 'racer'), 'enemies come at you');
  g.openTweaks(); // only from pause
  assert.equal(g.screen, 'playing');
  g.togglePause(); g.openTweaks();
  assert.equal(g.screen, 'sandboxTweaks');
  g.stepSandbox('rivals', 2); // 6
  assert.equal(g.battle.racers.length, 6);
  g.setSandbox('enemies', 0);
  assert.equal(g.battle.enemies.length, 0);
  g.setSandbox('rivals', 0);
  assert.equal(g.battle.racers.length, 0);
  g.closeTweaks();
  assert.equal(g.screen, 'paused');
});

test('sandbox on a stage: the enemy cars are spread out along it', () => {
  const g = new Game(data, { random: seeded(21) });
  g.sandbox = { ...defaultSandbox(), course: 3, enemies: 4 };
  g.startSandbox();
  const xs = g.battle.enemies.map((e) => e.centre[0]).sort((a, b) => a - b);
  assert.equal(xs.length, 4);
  const end = g.levelData.width * TILE;
  assert.ok(xs[0] > g.truck.T[0] + 300 && xs[3] < end, 'between you and the finish');
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  assert.ok(Math.min(...gaps) > (end / 4) * 0.4, `evenly spread (${gaps.map(Math.round)})`);
});

test('sandbox on Endless and the stunt tracks: cars that drop out of sight come back', () => {
  for (const course of [0, 12]) {
    const g = new Game(data, { random: seeded(22) });
    g.sandbox = { ...defaultSandbox(), course, rivals: 2, enemies: 2 };
    g.startSandbox();
    for (let i = 0; i < 100; i++) g.step();
    const b = g.battle;
    // send one of each a long way off
    for (const e of [b.racers[0], b.enemies[0]]) {
      const ids = new Set(b.bots.map((o) => o.id));
      e.truck.reset(e.s * (g.camX - 3000), -5000);
      for (let i = 0; i < AWAY_FOR + 40; i++) g.step();
      assert.ok(b.bots.some((o) => !ids.has(o.id)), `course ${course}: a car came back`);
    }
    for (let i = 0; i < 100; i++) g.step();
    assert.equal(b.racers.length, 2, `course ${course}: still two rivals`);
    assert.equal(b.enemies.length, 2, `course ${course}: still two enemies`);
  }
});

test('sandbox on a stage has a finish line, and a clock from the first landing', () => {
  const g = new Game(data, { random: seeded(15) });
  g.sandbox = { ...defaultSandbox(), course: 1 };
  g.startSandbox();
  assert.equal(g.levelData, data.levels[0]);
  for (let i = 0; i < 100; i++) g.step();
  assert.ok(g.clock > 0 && g.clock < 100, 'the clock is running');
  moveTo(g, (g.levelData.width - 6) * TILE);
  for (let i = 0; i < 400 && g.screen === 'playing'; i++) g.step();
  assert.equal(g.screen, 'gameOver', 'finished');
  assert.equal(g.finished, true);
  const t = g.clock;
  for (let i = 0; i < 50; i++) g.step();
  assert.equal(g.clock, t, 'the clock stops at the finish');
  g.damage = 999;
  assert.equal(g.rules.damage, false);
  assert.equal(g.quitScreen, 'sandbox');
});

test('sandbox on Endless\'s course and on a stunt track: no finish, no damage', () => {
  for (const course of [0, 10]) {
    const g = new Game(data, { random: seeded(16) });
    g.sandbox = { ...defaultSandbox(), course };
    g.startSandbox();
    assert.equal(g.onCourse, course === 0);
    assert.equal(g.isStunt, course === 10);
    if (course === 10) assert.equal(g.levelData.name, data.stunts[0].name);
    for (let i = 0; i < 600; i++) { g.keys.up = true; g.step(); }
    assert.equal(g.screen, 'playing');
  }
});

test('nothing done in Sandbox counts towards High Scores', () => {
  const store = memoryStore();
  const g = new Game(data, { random: seeded(17), store });
  const before = JSON.stringify(g.stats);
  g.sandbox = { ...defaultSandbox(), course: 1, power: 5 };
  g.startSandbox();
  for (let i = 0; i < 1500; i++) { g.keys.up = true; g.step(); }
  g.selfWreck();
  for (let i = 0; i < 200; i++) g.step();
  g.showMenu('stats');
  assert.equal(JSON.stringify(g.stats), before, 'the stats are as they were');
  assert.equal(JSON.stringify(store.get('stats') ?? JSON.parse(before)), before, 'and so are the saved ones');
  assert.equal(store.get('bestEndless'), null);
  // and they still count elsewhere
  g.startCampaign();
  for (let i = 0; i < 300; i++) { g.keys.up = true; g.step(); }
  g.showMenu('stats');
  assert.ok(g.stats.distance > 0);
  assert.ok(store.get('stats').distance > 0);
});

test('sandbox, all settings turned up, for a long while: nothing breaks', () => {
  for (const course of [0, 3, 11]) {
    const g = new Game(data, { random: seeded(16) });
    g.sandbox = { ...defaultSandbox(), power: 5, gravity: 1, boostPower: 4, jump: 4, airJumps: 1, rivals: 6, enemies: 6, hitboxes: 1, course };
    g.startSandbox();
    for (let i = 0; i < 3000; i++) {
      g.keys.up = true; g.keys.boost = i % 300 < 100;
      if (i % 40 === 0) g.press('fire');
      if (i % 90 === 0) g.press('jump');
      g.step();
      if (g.screen === 'gameOver') break;
      assert.ok(finite(g.truck.T) && Number.isFinite(g.camX) && Number.isFinite(g.camY), `course ${course} step ${i}`);
      for (const e of g.battle.bots) assert.ok(finite(e.wreck ? e.wreck.T : e.truck.T), `course ${course} step ${i}: a car`);
    }
  }
});

test('Sandbox can play a custom stage saved into the game; forgetting it moves the track back', () => {
  const g = new Game(data, { store: memoryStore(), random: seeded(3) });
  const base = g.sandboxCourses;
  const tiles = Array.from({ length: 8 }, (_, y) => Array.from({ length: 30 }, () => (y >= 6 ? 1 : 0)));
  assert.ok(g.bringInStage({ name: 'Flat', width: 30, height: 8, start: [3 * TILE, 4 * TILE], tiles, finish: 25 * TILE }));
  assert.equal(g.sandboxCourses, base + 1);
  assert.equal(g.sandboxCourseName(base), 'Flat');
  g.setSandbox('course', base);
  g.startSandbox();
  assert.ok(g.sandboxCustom);
  assert.equal(g.levelData.name, 'Flat');
  assert.equal(g.finishX, 25 * TILE);
  for (let i = 0; i < 200; i++) g.step();
  assert.ok(finite(g.truck.T));
  g.deleteStage(0);
  assert.equal(g.sandbox.course, 0);
  g.startSandbox();
  assert.ok(!g.sandboxCustom && g.onCourse);
});

test('sandbox: boost ×8 never takes the truck out of the level (over the side walls, or under the ground)', () => {
  for (const course of [0, 1, 4, 10]) for (const run of [0, 1]) {
    const rnd = seeded(run * 7919 + course * 31 + 1);
    const g = new Game(data, { store: memoryStore(), random: rnd });
    g.sandbox = { ...defaultSandbox(), course, boostPower: 4, power: 5 };
    g.startSandbox(); g.screen = 'playing';
    let tilt = null, fastest = 0, under = 0;
    const sunk = (T, j) => { const h = g.world.collide(T[j], T[j + 1] - 400, T[j], T[j + 1]); return h && h.ny < -0.5 && T[j + 1] - h.y > 30; };
    for (let s = 0; s < 2000 && g.screen === 'playing'; s++) {
      if (s % 40 === 0) tilt = [null, 'left', 'right'][Math.floor(rnd() * 3)];
      Object.assign(g.keys, { up: rnd() < 0.8, boost: rnd() < 0.85, left: tilt === 'left', right: tilt === 'right' });
      if (rnd() < 0.01) g.battle.requests.add('jump');
      g.step();
      if (g.wreck) break;
      const W = g.levelData.width * TILE, H = g.levelData.height * TILE, T = g.truck.T;
      assert.ok(finite(T));
      for (let i = 0; i < 10; i += 2) {
        assert.ok(T[i] >= 0 && T[i] <= W && T[i + 1] <= H, `course ${course}: point ${i / 2} out of the level at step ${s}`);
      }
      under = sunk(T, 2) && sunk(T, 4) ? under + 1 : 0;   // a hard landing can dip it in for a moment
      assert.ok(under < 70, `course ${course}: under the ground for a second at step ${s}`);
      fastest = Math.max(fastest, g.truck.speed);
    }
    assert.ok(fastest > 20, 'it still goes fast');
  }
});

test('the truck is kept between the side walls even above the top of the level', () => {
  const g = new Game(data, { store: memoryStore() });
  g.sandbox = { ...defaultSandbox(), course: 1, gravity: 0 };
  g.startSandbox(); g.screen = 'playing';
  const t = g.truck, W = g.levelData.width * TILE;
  const dx = W - 100 - t.T[0];
  for (let i = 0; i < 10; i += 2) { t.T[i] += dx; t.T[i + 1] -= 3000; t.P[i] = t.T[i] - 30; t.P[i + 1] = t.T[i + 1]; } // flying right, fast, high above the level
  t.probePrev = null;
  for (let s = 0; s < 60; s++) { g.step(); for (let i = 0; i < 10; i += 2) assert.ok(t.T[i] <= W, `step ${s}`); }
  assert.ok(t.T[0] - t.P[0] < 1, 'its speed into the wall is gone');
});
