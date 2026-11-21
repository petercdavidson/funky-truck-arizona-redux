// Game logic tests. Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, STAGE_W, TILE } from '../src/game.js';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));

function memoryStore() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), map: m };
}

/** Simple bot: hold the gas and tilt to keep the truck level. Returns frames run. */
function drive(g, maxFrames) {
  g.keys.up = true;
  let f = 0;
  while (f < maxFrames && g.screen === 'playing') {
    g.keys.right = g.truck.bodyRot < -25;
    g.keys.left = g.truck.bodyRot > 25;
    g.step();
    f++;
    for (const v of g.truck.T) if (!Number.isFinite(v)) throw new Error(`non-finite truck state at frame ${f}`);
  }
  return f;
}

test('level data has 9 stages with tiles and a collision entry for every tile id', () => {
  assert.equal(data.levels.length, 9);
  for (const l of data.levels) {
    assert.equal(l.tiles.length, l.height);
    for (const row of l.tiles) {
      assert.equal(row.length, l.width);
      for (const id of row) assert.ok(Array.isArray(data.collision[id]), `tile ${id} has collision data`);
    }
  }
});

test('every stage starts cleanly and the truck stays finite for 20 seconds', () => {
  const g = new Game(data);
  for (let s = 0; s < 9; s++) {
    g.startPractice(s);
    assert.equal(g.screen, 'playing');
    assert.equal(g.ticker, ['Stage One', 'Stage Two', 'Stage Three', 'Stage Four', 'Stage Five', 'Stage Six', 'Stage Seven', 'Stage Eight', 'Stage Nine'][s]);
    drive(g, 70 * 20);
  }
});

test('a simple bot can finish stage 1, and finishing ends a practice run', () => {
  const g = new Game(data, { random: () => 0.5 });
  g.startPractice(0);
  drive(g, 70 * 60);
  assert.equal(g.screen, 'gameOver');
  assert.equal(g.wrecked, false);
  assert.ok(g.truck.T[0] >= (data.levels[0].width - 9) * TILE);
  assert.ok(g.lastScore > 0);
});

test('with no input the truck rocks in the start dip but stays on the ground', () => {
  const g = new Game(data);
  g.startPractice(0);
  const [x0] = data.levels[0].start;
  for (let i = 0; i < 70 * 10; i++) {
    g.step();
    assert.ok(Math.abs(g.truck.T[0] - x0) < 200, 'stays near the start');
    assert.ok(g.truck.T[1] < data.levels[0].height * TILE, 'never falls out of the level');
  }
  assert.ok(g.truck.rearContact && g.truck.frontContact, 'both wheels end up touching the ground');
});

/** Move the whole truck (current and previous positions) sideways without changing its shape. */
function shiftTruck(g, dx) {
  for (let i = 0; i < 10; i += 2) { g.truck.T[i] += dx; g.truck.P[i] += dx; }
  g.truck.probePrev = null;
}

test('reaching 1000 damage wrecks the truck and ends the run', () => {
  const g = new Game(data);
  g.startCampaign();
  g.damage = 1000;
  for (let i = 0; i < 300 && g.screen === 'playing'; i++) g.step();
  assert.equal(g.screen, 'gameOver');
  assert.equal(g.wrecked, true);
});

test('campaign advances to the next stage and carries the time bonus into the score', () => {
  const g = new Game(data);
  g.startCampaign();
  shiftTruck(g, (data.levels[0].width - 9) * TILE + 1 - g.truck.T[0]); // drop it past the finish line
  let frames = 0;
  for (; frames < 300 && g.level === 0; frames++) g.step();
  assert.equal(g.level, 1);
  assert.equal(g.screen, 'playing');
  // The bonus counts down by 1 per frame until the next stage starts, then goes into the score.
  assert.ok(Math.abs(g.score - (10000 - frames)) <= 2, `score ${g.score} ~ ${10000 - frames}`);
  assert.equal(g.bonus, 20000 - 1); // the new stage's countdown starts in the same frame
});

test('best score is saved, and a bad saved value is ignored', () => {
  const store = memoryStore();
  store.set('truckLook', { body: 99, tyre: 'x', hub: 2 });
  const g = new Game(data, { store });
  assert.deepEqual(g.look, { body: 0, tyre: 0, hub: 2, paint: [0, 1, 2, 3, 4, 5] });
  g.practiceClassic = true; // Classic keeps the original saved best
  g.startPractice(0);
  g.damage = 1000;
  g.score = 1234;
  for (let i = 0; i < 300 && g.screen === 'playing'; i++) g.step();
  assert.equal(store.get('bestScore'), g.best);
  assert.ok(g.best >= 1234);
  assert.equal(new Game(data, { store }).best, g.best);
});

test('P pauses on press-release and resumes on the next press-release', () => {
  const g = new Game(data);
  g.startPractice(0);
  g.keys.pause = true; g.step();
  assert.equal(g.screen, 'paused');
  g.step(); assert.equal(g.screen, 'paused');          // still held
  g.keys.pause = false; g.step(); assert.equal(g.screen, 'paused');
  g.keys.pause = true; g.step(); assert.equal(g.screen, 'paused');
  g.keys.pause = false; g.step(); assert.equal(g.screen, 'playing');
});

test('tap-to-pause stays paused until tapped again', () => {
  const g = new Game(data);
  g.startPractice(0);
  g.togglePause();
  for (let i = 0; i < 10; i++) g.step();
  assert.equal(g.screen, 'paused');
  g.togglePause();
  assert.equal(g.screen, 'playing');
});

test('restart key on the game-over screen needs a fresh press', () => {
  const g = new Game(data);
  g.startPractice(3);
  g.keys.restart = true;                 // held through the crash
  g.damage = 1000;
  for (let i = 0; i < 300 && g.screen === 'playing'; i++) g.step();
  assert.equal(g.screen, 'gameOver');
  g.step(); assert.equal(g.screen, 'gameOver');
  g.keys.restart = false; g.step();
  g.keys.restart = true; g.step();
  assert.equal(g.screen, 'playing');
  assert.equal(g.level, 3, 'practice restarts the same stage');
});

test('garage cycles parts with wrap-around and the idle truck settles', () => {
  const g = new Game(data, { store: memoryStore() });
  g.cycleLook('body', -1);
  assert.equal(g.look.body, 5);
  g.cycleLook('body', 1);
  assert.equal(g.look.body, 0);
  g.showMenu('garage');
  for (let i = 0; i < 300; i++) g.step();
  assert.equal(g.garageTruck.T[3], 170);
  assert.ok(Math.abs(g.garageTruck.T[0] - STAGE_W / 2) < 5);
});
