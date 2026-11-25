// Time Trial: the race clock, best times and ghosts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, TILE, unpackLevel } from '../src/game.js';
import { TRIAL_ALL, TRIAL_STUNTS, POSE, formatTime, formatGap, encodePoses, decodePoses, loadGhost, validBests } from '../src/trial.js';
import { memoryStore } from './helpers.mjs';
import { drive } from './bot.mjs';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
data.stunts = JSON.parse(readFileSync(new URL('../assets/stunts.json', import.meta.url))).map(unpackLevel);

test('times read as m:ss.cc, and gaps as signed seconds', () => {
  assert.equal(formatTime(0), '0:00.00');
  assert.equal(formatTime(70 * 61.5), '1:01.50');
  assert.equal(formatTime(70 * 3600), '60:00.00');
  assert.equal(formatGap(-29.4), '-0.42');
  assert.equal(formatGap(84), '+1.20');
});

test('ghost poses pack small and unpack exactly, big jumps included', () => {
  const v = [];
  // like a real run: points a few pixels apart, moving a few pixels a step
  for (let i = 0; i < 400; i++) v.push(i < 200 ? 0 : 1, ...Array.from({ length: POSE - 1 }, (_, k) => Math.round(40 * Math.sin(i / 9 + k) + i * 9 + k * 30)));
  v[POSE * 50 + 3] += 90000; // a sudden big change
  const packed = encodePoses(v);
  assert.deepEqual(decodePoses(packed), v);
  assert.ok(packed.length < v.length * 1.5, `${packed.length} characters for ${v.length} numbers`);
});

test('saved Time Trial data is checked before use', () => {
  assert.deepEqual(validBests({ 0: 2000, 1: -5, 2: 'x', 9: 99999 }), { 0: 2000, 9: 99999 });
  assert.deepEqual(validBests('nonsense'), {});
  assert.equal(loadGhost({ v: 1, track: 0, time: 100, poses: '!!!', marks: {} }, 0), null);
  assert.equal(loadGhost({ v: 1, track: 1, time: 100, poses: encodePoses([0, ...Array(POSE - 1).fill(1)]), marks: {} }, 0), null, 'another track\'s ghost');
  assert.equal(loadGhost(null, 0), null);
});

/** Run a trial of Stage One with the simulated driver; returns the game. */
function runStageOne(store) {
  const g = new Game(data, { store });
  g.startTrial(0);
  // The simulated driver isn't careful enough for damage, so it drives without; a time without
  // damage doesn't count, so the run is let count anyway (that rule has a test of its own).
  g.rules = { ...g.rules, damage: false };
  Object.defineProperty(g, 'timeCounts', { get: () => true });
  drive(g, { steps: 6000 });
  for (let i = 0; i < 400 && g.screen === 'playing'; i++) g.step();
  return g;
}

test('a Time Trial times the stage from landing to the finish line, and keeps the best and its ghost', () => {
  const store = memoryStore();
  const g = new Game(data, { store });
  g.startTrial(0);
  assert.equal(g.mode, 'trial');
  assert.equal(g.bonus, 0, 'no time bonus');
  for (let i = 0; i < 200 && !g.landed; i++) { g.step(); if (!g.landed) assert.equal(g.clock, 0, 'the clock waits for the truck to land'); }

  const first = runStageOne(store);
  assert.equal(first.screen, 'gameOver');
  assert.ok(first.finished && !first.wrecked, 'finished');
  const r = first.trialResult;
  assert.ok(r.record && r.best === null && r.time > 70 * 10, `a first time of ${formatTime(r.time)} is a record`);
  assert.equal(store.get('trialBests')[0], r.time);
  assert.ok(store.get('ghost0'), 'its ghost is saved');
  assert.equal(store.get('bestPlay'), null, 'not a Play best');

  // The same drive again takes exactly as long (the game is deterministic), racing the ghost,
  // and only equals the best, so isn't a record.
  const second = runStageOne(store);
  assert.ok(second.ghost, 'the ghost is loaded');
  assert.equal(second.trialResult.time, r.time);
  assert.ok(!second.trialResult.record, 'equalling the best isn\'t a record');
  assert.equal(store.get('trialBests')[0], r.time);

  // While racing it, the ghost is drawn and the split says how far behind you are.
  const g3 = new Game(data, { store });
  g3.startTrial(0);
  let shown = 0, split = null;
  for (let i = 0; i < 700; i++) { g3.keys.up = g3.landed && i > 300; g3.step(); if (g3.ghostT) shown++; split = g3.split ?? split; }
  assert.ok(shown > 600, 'the ghost is on screen');
  assert.ok(split > 0, `behind the ghost (${formatGap(split)})`);
  // ...unless ghosts are switched off
  const g4 = new Game(data, { store });
  g4.toggle('ghostOn');
  g4.startTrial(0);
  assert.equal(g4.ghost, null);
});

test('a wrecked Time Trial run sets no time', () => {
  const store = memoryStore();
  const g = new Game(data, { store });
  g.startTrial(1);
  for (let i = 0; i < 100; i++) g.step();
  g.damage = 1000;
  for (let i = 0; i < 400 && g.screen === 'playing'; i++) g.step();
  assert.equal(g.screen, 'gameOver');
  assert.ok(g.wrecked && !g.trialResult);
  assert.deepEqual(store.get('trialBests'), null);
});

test('All Nine runs the stages in a row on one clock', () => {
  const g = new Game(data, { store: memoryStore() });
  g.startTrial(TRIAL_ALL);
  assert.equal(g.level, 0);
  for (let i = 0; i < 300; i++) g.step();
  const before = g.clock;
  g.truck.reset((g.levelData.width - 8) * TILE, g.truck.T[1] - 40); // at the finish line
  for (let i = 0; i < 260 && g.level === 0; i++) g.step();
  assert.equal(g.level, 1, 'on to Stage Two');
  assert.equal(g.screen, 'playing');
  for (let i = 0; i < 300; i++) g.step();
  assert.ok(g.clock > before, 'the clock carried on');
  assert.ok(!g.hasNextTrial, 'All Nine has no next track');
  const s = new Game(data);
  s.startTrial(3);
  assert.ok(s.hasNextTrial);
  s.nextTrial();
  assert.equal(s.track, 4);
  assert.equal(s.level, 4);
});

test('over the finish line the split stays put, even if the truck rolls back', () => {
  const store = memoryStore();
  runStageOne(store); // sets a best, with its ghost
  // Skew the ghost's timings so the split is different at every column (this run would otherwise
  // match the ghost exactly, and the split would be 0 everywhere).
  const saved = store.get('ghost0');
  store.set('ghost0', { ...saved, marks: { 0: saved.marks[0].map((v, c) => (v === null ? null : v + 3 * c)) } });
  const g = new Game(data, { store });
  g.startTrial(0);
  g.rules = { ...g.rules, damage: false };
  const t = g.truck, realStep = g.step.bind(g);
  let split = null, clock = null;
  g.step = () => {
    realStep();
    if (split === null && g.endTimer > 0) {
      // just over the finish line: roll back down the track while the stage-complete message shows
      split = g.split; clock = g.clock;
      t.reset(t.T[0] - 6 * TILE, t.T[1] - 60);
    }
  };
  drive(g, { steps: 6000 });
  for (let i = 0; i < 400 && g.screen === 'playing'; i++) g.step();
  assert.ok(clock !== null && split !== null, 'crossed the finish line racing the ghost');
  assert.equal(g.screen, 'gameOver');
  assert.equal(g.split, split, 'the split is locked');
  assert.equal(g.clock, clock, 'so is the clock');
});

test('quitting Practice or Time Trial goes back to its list of stages', () => {
  const g = new Game(data);
  g.startTrial(2);
  assert.equal(g.quitScreen, 'trialSelect');
  g.startPractice(4);
  assert.equal(g.quitScreen, 'trialSelect', 'Practice is part of Time Trial now');
  g.startCampaign();
  assert.equal(g.quitScreen, 'classicSelect', 'and Classic to its own screen');
  g.startEndless();
  assert.equal(g.quitScreen, 'title');
});

test('Time Trial without damage shows the time but sets no record; 2006 Mode\'s times count', () => {
  const store = memoryStore();
  const g = new Game(data, { store });
  g.toggle('practiceDamage');
  g.startTrial(0);
  assert.equal(g.timeCounts, false);
  drive(g, { steps: 6000 });
  for (let i = 0; i < 400 && g.screen === 'playing'; i++) g.step();
  assert.equal(g.screen, 'gameOver');
  assert.ok(g.finished);
  assert.ok(g.trialResult && g.trialResult.time > 0 && !g.trialResult.record && !g.trialResult.counts);
  assert.equal(store.get('trialBests'), null, 'no best time saved');
  assert.equal(store.get('ghost0'), null, 'no ghost saved');
  g.toggle('practiceDamage'); g.toggle('trialRetro');
  g.startTrial(0);
  assert.equal(g.timeCounts, true);
  assert.equal(g.rules.tricks, false, '2006 Mode: no tricks, whatever the switch says');
});

test('Time Trial\'s nine stages keep the original ceiling and scrape; its stunt tracks don\'t', () => {
  const g = new Game({ ...data, stunts: [{ ...data.levels[0], name: 'Stunt' }] });
  g.startTrial(4);
  assert.equal(g.rules.ceiling, true);
  assert.equal(g.rules.scrapeAll, true);
  g.startTrial(TRIAL_ALL);
  assert.equal(g.rules.ceiling, true);
  g.startTrial(TRIAL_STUNTS);
  assert.equal(g.rules.ceiling, false);
  assert.equal(g.rules.scrapeAll, false);
});

test('Time Trial tricks can be switched off; with them on, tricks score on a timed stage', async () => {
  const { turnOver } = await import('./helpers.mjs');
  for (const on of [true, false]) {
    const g = new Game(data, { store: memoryStore() });
    if (!on) g.toggle('trialTricks');
    g.startTrial(0);
    assert.equal(g.rules.tricks, on);
    for (let i = 0; i < 150; i++) g.step();
    // a big drop with a flip
    const t = g.truck;
    for (let i = 0; i < 10; i += 2) { t.T[i + 1] -= 700; t.P[i + 1] = t.T[i + 1]; t.P[i] = t.T[i]; }
    t.probePrev = null; t.addSpin(0.09);
    let named = 0;
    for (let i = 0; i < 400; i++) { g.step(); if (g.tricks.show) named++; }
    if (on) assert.ok(named > 0 && g.score > 0, `tricks scored (${g.score})`);
    else assert.ok(named === 0 && g.score === 0, 'no tricks with them off');
    void turnOver;
  }
});

test('Time Trial\'s stunt tracks: no clock, and the best trick score is kept when the run ends', async () => {
  const { TRIAL_STUNTS } = await import('../src/trial.js');
  const store = memoryStore();
  const g = new Game(data, { store });
  g.startTrial(TRIAL_STUNTS);
  assert.equal(g.levelData.name, data.stunts[0].name);
  assert.ok(g.isStunt && !g.timeCounts && g.stuntCounts);
  assert.equal(g.hasNextTrial, true, 'on to the next stunt track');
  for (let i = 0; i < 200; i++) g.step();
  g.score = 4321;
  g.togglePause();
  g.showMenu(g.quitScreen);
  assert.equal(g.screen, 'trialSelect');
  assert.equal(store.get('stuntBests')[TRIAL_STUNTS], 4321);
  // a lower score doesn't replace it; a wreck ends the run and keeps a better one
  g.startTrial(TRIAL_STUNTS);
  g.score = 100;
  g.restart();
  assert.equal(store.get('stuntBests')[TRIAL_STUNTS], 4321);
  g.score = 9000;
  g.damage = 1000;
  for (let i = 0; i < 400 && g.screen === 'playing'; i++) g.step();
  assert.equal(g.screen, 'gameOver');
  assert.equal(new Game(data, { store }).stuntBests[TRIAL_STUNTS], 9000);
  assert.ok(g.stuntResult.record);
  // without damage it isn't kept
  g.toggle('practiceDamage');
  g.startTrial(TRIAL_STUNTS + 1);
  g.score = 50000;
  g.showMenu('trialSelect');
  assert.equal(store.get('stuntBests')[TRIAL_STUNTS + 1], undefined);
});
