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
  // Tapped again and again, it never goes up too fast to stay about on screen.
  for (let i = 0; i < 30; i++) { g.kickTitleTruck(t.T[0], t.T[1]); g.step(); }
  assert.ok(t.centre(t.P)[1] - t.centre()[1] <= KICK.max + 0.5);
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
