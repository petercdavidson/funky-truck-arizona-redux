// Rally Mode (rally.js) and Sandbox Mode (sandbox.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, TILE, unpackLevel } from '../src/game.js';
import { RALLY, RALLY_ALL, rivalLooks, validRallyBests, ordinal } from '../src/rally.js';
import { SANDBOX_ROWS, defaultSandbox, validSandbox, sandboxValue } from '../src/sandbox.js';
import { SoundWatcher } from '../src/sound-events.js';
import { drive } from './bot.mjs';
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

// ---- Rally

test('a rally lines five rivals up ahead of you, all different from you and each other', () => {
  const g = new Game(data, { random: seeded(1) });
  g.startRally(0);
  const r = g.battle.racers;
  assert.equal(r.length, RALLY.rivals);
  assert.equal(new Set(r.map((e) => e.look.body)).size, RALLY.rivals, 'every rival a different body');
  for (const e of r) {
    assert.ok(e.centre[0] > g.truck.T[0], 'ahead of you on the grid');
    assert.notEqual(e.look.body, g.look.body);
    assert.notEqual(e.look.paint, g.look.paint);
    assert.ok(e.name);
  }
  for (let body = 0; body < 6; body++) for (const paint of [0, 2, 5]) {
    const looks = rivalLooks({ body, paint, tyre: 1, hub: 1 }, seeded(body + paint));
    for (const l of looks) { assert.notEqual(l.body, body); assert.notEqual(l.tyre, 1); assert.notEqual(l.hub, 1); }
  }
});

test('nobody goes anywhere until the countdown says GO', () => {
  const g = new Game(data, { random: seeded(2) });
  g.startRally(0);
  const w = new SoundWatcher();
  w.observe(g);
  const heard = [];
  g.keys.up = true;
  for (let i = 0; i < RALLY.countdown - 5; i++) { g.step(); heard.push(...w.observe(g).events.map((e) => e.type)); }
  assert.ok(g.race.holding);
  assert.equal(heard.filter((t) => t === 'count').length, 3, '3, 2, 1');
  assert.ok(Math.abs(g.truck.T[0] - g.data.levels[0].start[0]) < 40, 'you stayed on the line');
  for (let i = 0; i < 10; i++) { g.step(); heard.push(...w.observe(g).events.map((e) => e.type)); }
  assert.ok(heard.includes('go'));
  assert.equal(g.race.holding, false);
  const x = g.truck.T[0];
  for (let i = 0; i < 100; i++) g.step();
  assert.ok(g.truck.T[0] > x + 100, 'and then you go');
});

test('the rivals race to the finish of Stage One, and are placed in the order they cross', () => {
  const g = new Game(data, { random: seeded(3) });
  g.startRally(0);
  for (let i = 0; i < 9000 && g.race.order.length < RALLY.rivals; i++) g.step(); // you stay put
  assert.ok(g.race.order.length >= 4, `rivals finished (${g.race.order.length})`);
  const times = g.race.order.map((e) => e.finished);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.equal(g.race.place, g.race.order.length + 1 + g.battle.racers.filter((e) => e.finished === null && e.centre[0] > g.truck.T[0]).length);
  for (const e of g.battle.racers) assert.ok(finite(e.truck.T));
});

test('crossing the line first wins, keeps your best place, and counts a rally win', () => {
  const store = memoryStore();
  const g = new Game(data, { random: seeded(4), store });
  g.startRally(0);
  for (let i = 0; i < RALLY.countdown + 5; i++) g.step();
  moveTo(g, g.race.finishX + 30);
  for (let i = 0; i < 400 && g.screen === 'playing'; i++) g.step();
  assert.equal(g.screen, 'gameOver');
  assert.equal(g.race.result.place, 1);
  assert.equal(g.rallyBests[0], 1);
  assert.deepEqual(store.get('rallyBests'), { 0: 1 });
  assert.equal(g.stats.rallyWins, 1);
  assert.equal(g.quitScreen, 'rallySelect');
  assert.ok(g.hasNextRally);
  g.nextRally();
  assert.equal(g.track, 1);
  assert.equal(g.screen, 'playing');
});

test('finishing behind rivals places you behind them; a worse place does not replace your best', () => {
  const store = memoryStore();
  const g = new Game(data, { random: seeded(5), store });
  g.rallyBests = { 0: 2 };
  g.startRally(0);
  for (let i = 0; i < 9000 && g.race.order.length < 3; i++) g.step();
  moveTo(g, g.race.finishX + 30);
  for (let i = 0; i < 400 && g.screen === 'playing'; i++) g.step();
  assert.ok(g.race.result.place >= 4, `placed ${g.race.result.place}`);
  assert.equal(g.rallyBests[0], 2);
});

test('when every rival has finished and you have not, the race is over after a while', () => {
  const g = new Game(data, { random: seeded(6) });
  g.startRally(0);
  for (const e of g.battle.racers) e.finished = 1;
  g.race.order = [...g.battle.racers];
  g.race.countdown = 0;
  for (let i = 0; i < RALLY.dnfAfter + 400 && g.screen === 'playing'; i++) g.step();
  assert.equal(g.screen, 'gameOver');
  assert.equal(g.race.result.dnf, true);
  assert.equal(g.race.result.place, RALLY.rivals + 1);
});

test('the championship runs all nine stages and adds up the points', () => {
  const g = new Game(data, { random: seeded(7) });
  g.startRally(RALLY_ALL);
  assert.equal(g.lastLevel, 8);
  const names = g.battle.racers.map((e) => e.name);
  for (let stage = 0; stage < 9; stage++) {
    assert.equal(g.level, stage);
    assert.deepEqual(g.battle.racers.map((e) => e.name), names, 'the same rivals every stage');
    for (let i = 0; i < RALLY.countdown + 5; i++) g.step();
    moveTo(g, g.race.finishX + 30);
    for (let i = 0; i < 400 && g.level === stage && g.screen === 'playing'; i++) g.step();
  }
  assert.equal(g.screen, 'gameOver');
  assert.equal(g.race.points.You, 90, 'won all nine');
  assert.equal(g.race.result.place, 1);
  assert.equal(g.rallyBests[RALLY_ALL], 1);
});

test('rally helpers: ordinals and saved bests', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  assert.deepEqual(validRallyBests({ 0: 1, 3: 7, 4: 'x', 9: 2, 12: 1 }), { 0: 1, 9: 2 });
  assert.deepEqual(validRallyBests(null), {});
});

test('rally has no damage, no weapons, and no wrecking on purpose', () => {
  const g = new Game(data, { random: seeded(8) });
  g.startRally(2);
  assert.equal(g.rules.damage, false);
  g.press('fire');
  assert.equal(g.battle.requests.size, 0);
  assert.equal(g.selfWreck(), false);
  assert.equal(g.uprightAllowed, true);
});

test('a racer stuck on its roof turns itself back over', () => {
  const g = new Game(data, { random: seeded(9) });
  g.startRally(0);
  for (let i = 0; i < RALLY.countdown + 60; i++) g.step();
  const e = g.battle.racers[0], t = e.truck;
  const cx = t.T[0], cy = t.T[1] - 20;
  for (let i = 0; i < 10; i += 2) { t.T[i] = 2 * cx - t.T[i]; t.T[i + 1] = 2 * cy - t.T[i + 1] - 40; t.P[i] = t.T[i]; t.P[i + 1] = t.T[i + 1]; }
  t.probePrev = null; t.updateBodyRot();
  let upright = false;
  for (let i = 0; i < 600 && !upright; i++) { g.step(); upright = i > 200 && Math.abs(t.bodyRot) < 30 && (t.rearContact || t.frontContact); }
  assert.ok(upright);
});

test('racers get through every stage in a reasonable time (stuck ones hop, then skip on)', () => {
  for (const stage of [0, 3, 6]) {
    const g = new Game(data, { random: seeded(10 + stage) });
    g.startRally(stage);
    for (let i = 0; i < 15000 && g.race.order.length < 3; i++) g.step();
    assert.ok(g.race.order.length >= 3, `stage ${stage + 1}: ${g.race.order.length} finished`);
  }
});

test('the test driver can race a whole rally without anything breaking', () => {
  const g = new Game(data, { random: seeded(11) });
  g.startRally(1);
  drive(g, { steps: 6000 });
  assert.ok(finite(g.truck.T) && Number.isFinite(g.camX) && Number.isFinite(g.camY));
  assert.ok(g.race.place >= 1 && g.race.place <= 6);
});

// ---- Sandbox

test('sandbox settings: defaults, saving, checking what is read back', () => {
  const d = defaultSandbox();
  for (const row of SANDBOX_ROWS) assert.ok(Number.isInteger(d[row.key]));
  assert.equal(sandboxValue(d, 'gravity'), 1);
  assert.equal(sandboxValue(d, 'power'), 1);
  assert.deepEqual(validSandbox({ power: 99, gravity: 0, track: 11, slow: -1 }, 12), { ...d, gravity: 0, track: 11 });
  assert.deepEqual(validSandbox('junk'), d);
  const store = memoryStore();
  const g = new Game(data, { store });
  g.stepSandbox('gravity', -1);
  assert.equal(store.get('sandbox').gravity, d.gravity - 1);
  g.stepSandbox('power', -5); // wraps round
  assert.ok(g.sandbox.power >= 0 && g.sandbox.power < SANDBOX_ROWS.find((r) => r.key === 'power').choices.length);
  g.resetSandbox();
  assert.deepEqual({ ...g.sandbox, track: 0 }, { ...d, track: 0 });
});

test('sandbox: gravity, drive power, spin and springs change your truck (and only in Sandbox)', () => {
  const g = new Game(data, { random: seeded(12) });
  g.sandbox = { ...defaultSandbox(), gravity: 0, power: 4, spin: 3, springs: 3, traffic: 0 };
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

test('sandbox: unlimited boost, jumps and missiles never run out; air jumps work in the air', () => {
  const g = new Game(data, { random: seeded(13) });
  g.sandbox = { ...defaultSandbox(), traffic: 0, airJumps: 1 };
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

test('sandbox traffic: as many trucks as asked for, added and taken away during a run', () => {
  const g = new Game(data, { random: seeded(14) });
  g.sandbox = { ...defaultSandbox(), traffic: 3 }; // 3 trucks
  g.startSandbox();
  assert.equal(g.battle.racers.length, 3);
  g.openTweaks(); // only from pause
  assert.equal(g.screen, 'playing');
  g.togglePause(); g.openTweaks();
  assert.equal(g.screen, 'sandboxTweaks');
  g.stepSandbox('traffic', 2); // 6 trucks
  assert.equal(g.battle.racers.length, 6);
  g.stepSandbox('traffic', -5); // none
  assert.equal(g.battle.racers.length, 0);
  g.closeTweaks();
  assert.equal(g.screen, 'paused');
});

test('sandbox has no finish line, no damage, and works on the stunt tracks', () => {
  const g = new Game(data, { random: seeded(15) });
  g.sandbox = { ...defaultSandbox(), track: 9 };
  g.startSandbox();
  assert.equal(g.levelData.name, data.stunts[0].name);
  g.sandbox = { ...defaultSandbox(), track: 0 };
  g.startSandbox();
  g.battle.racers.length = 0;
  moveTo(g, (g.levelData.width - 6) * TILE);
  for (let i = 0; i < 400; i++) g.step();
  assert.equal(g.screen, 'playing', 'no finish');
  g.damage = 999;
  assert.equal(g.rules.damage, false);
  assert.equal(g.quitScreen, 'sandbox');
});

test('sandbox, all settings turned up, for a long while: nothing breaks', () => {
  const g = new Game(data, { random: seeded(16) });
  g.sandbox = { ...defaultSandbox(), power: 5, gravity: 1, boostPower: 4, jump: 4, airJumps: 1, traffic: 6, track: 10 };
  g.startSandbox();
  for (let i = 0; i < 3000; i++) {
    g.keys.up = true; g.keys.boost = i % 300 < 100;
    if (i % 40 === 0) g.press('fire');
    if (i % 90 === 0) g.press('jump');
    g.step();
    assert.ok(finite(g.truck.T) && Number.isFinite(g.camX) && Number.isFinite(g.camY), `step ${i}`);
  }
});
