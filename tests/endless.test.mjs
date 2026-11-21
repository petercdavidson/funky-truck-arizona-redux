// Endless Mode: the course generator and the game's handling of an endless run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, TILE } from '../src/game.js';
import { buildGrammar, EndlessCourse, ENDLESS_WIDTH, ENDLESS_HEIGHT, ENDLESS_SHIFT } from '../src/endless.js';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
const seeded = (seed) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const grammar = buildGrammar(data.levels);

function memoryStore() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) };
}

/** Every left-right pair of neighbouring tiles that appears in the original stages. */
const authoredPairs = new Set();
for (const l of data.levels) for (const row of l.tiles) for (let x = 0; x + 1 < l.width; x++) authoredPairs.add(`${row[x]},${row[x + 1]}`);
authoredPairs.add('1,1'); authoredPairs.add('0,0');

test('generated courses stay in bounds and only use tiles side by side as the stages do', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const c = new EndlessCourse(grammar, data.levels, seeded(seed));
    for (let k = 0; k < 25; k++) {
      c.scroll(ENDLESS_SHIFT);
      assert.equal(c.tiles.length, ENDLESS_HEIGHT);
      for (const row of c.tiles) {
        assert.equal(row.length, ENDLESS_WIDTH);
        for (let x = 0; x < row.length; x++) {
          assert.ok(Array.isArray(data.collision[row[x]]), `tile ${row[x]} has collision data`);
          if (x + 1 < row.length) assert.ok(authoredPairs.has(`${row[x]},${row[x + 1]}`), `seed ${seed}: ${row[x]} next to ${row[x + 1]} is not in any stage`);
        }
      }
      for (let x = 0; x < ENDLESS_WIDTH; x++) {
        let top = 0;
        while (top < ENDLESS_HEIGHT && c.tiles[top][x] === 0) top++;
        assert.ok(top >= 10 && top <= 41, `seed ${seed}: ground top ${top} stays in the band`);
      }
    }
  }
});

test('the same seed gives the same course', () => {
  const a = new EndlessCourse(grammar, data.levels, seeded(42)), b = new EndlessCourse(grammar, data.levels, seeded(42));
  for (let k = 0; k < 5; k++) { a.scroll(ENDLESS_SHIFT); b.scroll(ENDLESS_SHIFT); }
  assert.deepEqual(a.tiles, b.tiles);
});

test('an endless run scrolls the world, keeps scoring distance, and never hits a finish line', () => {
  const g = new Game(data, { random: seeded(2), store: memoryStore() });
  g.startEndless();
  assert.equal(g.screen, 'playing');
  assert.equal(g.ticker, 'Endless');
  assert.equal(g.bonus, 0);
  for (let lap = 0; lap < 3; lap++) {
    // Lift the truck to just above the ground near the end of the window, as if it drove there.
    const col = ENDLESS_WIDTH - 39;
    let top = 0;
    while (g.levelData.tiles[top][col] === 0) top++;
    const dx = col * TILE + 32 - g.truck.T[0], dy = (top - 2) * TILE - g.truck.T[1];
    for (let i = 0; i < 10; i += 2) { g.truck.T[i] += dx; g.truck.P[i] += dx; g.truck.T[i + 1] += dy; g.truck.P[i + 1] += dy; }
    g.truck.probePrev = null;
    const before = g.truck.T[0], shifts = g.shiftCount, dropped = g.course.dropped;
    g.step();
    assert.equal(g.shiftCount, shifts + 1, 'the world scrolled');
    assert.equal(g.course.dropped, dropped + ENDLESS_SHIFT);
    assert.ok(Math.abs(g.truck.T[0] - (before - ENDLESS_SHIFT * TILE)) < 10, 'the truck moved back with the world');
    assert.ok(g.distance >= col + dropped, `distance ${g.distance}`);
    for (let i = 0; i < 140; i++) g.step();
    assert.equal(g.screen, 'playing', 'no finish line');
  }
  assert.ok(g.score >= g.distance * 10 - 50, `score ${g.score} counts distance ${g.distance}`);
});

test('wrecking ends an endless run and saves the best distance; quitting saves it too', () => {
  const store = memoryStore();
  const g = new Game(data, { random: seeded(5), store });
  g.startEndless();
  g.distance = 120;
  g.damage = 1000;
  for (let i = 0; i < 300 && g.screen === 'playing'; i++) g.step();
  assert.equal(g.screen, 'gameOver');
  assert.equal(g.wrecked, true);
  assert.equal(store.get('bestEndless'), 300);
  assert.equal(store.get('bestScore'), null, 'endless runs keep their own best');
  g.restart();
  assert.equal(g.mode, 'endless');
  g.distance = 200;
  g.togglePause();
  g.showMenu('title');
  assert.equal(store.get('bestEndless'), 500);
  assert.equal(new Game(data, { store }).bestEndless, 500);
  store.set('bestEndless', 'lots');
  assert.equal(new Game(data, { store }).bestEndless, 0, 'a bad saved value is ignored');
});

test('a simple bot can drive an endless course without the physics going wrong', () => {
  const g = new Game(data, { random: seeded(4) });
  g.startEndless();
  g.keys.up = true;
  for (let f = 0; f < 70 * 60 && g.screen === 'playing'; f++) {
    g.keys.right = g.truck.bodyRot < -25; g.keys.left = g.truck.bodyRot > 25;
    g.step();
    for (const v of g.truck.T) assert.ok(Number.isFinite(v));
  }
  assert.ok(g.distance > 30, `got ${g.distance} tiles`);
});
