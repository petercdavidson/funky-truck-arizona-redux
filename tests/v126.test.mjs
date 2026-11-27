// Sandbox's Flat and Battlefield tracks, the saved track moving past them, and missiles going for
// enemy cars before rival cars before birds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, TILE } from '../src/game.js';
import { EndlessCourse, flatGrammar, battlefieldGrammar, FLAT_SHAPE, BATTLEFIELD } from '../src/endless.js';
import { SANDBOX_ROW } from '../src/sandbox.js';
import { memoryStore } from './helpers.mjs';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
const seeded = (seed) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const topOf = (c, x) => { let t = 0; while (c.tiles[t][x] === 0) t++; return t; };

/** Every column of course c seen while scrolling it `n` windows right, then back past the start as far. */
function columns(c, n) {
  const out = [];
  const grab = () => { for (let x = 0; x < c.width; x++) out.push(c.tiles.map((row) => row[x])); };
  for (let i = 0; i < n; i++) { grab(); c.scroll(48); }
  for (let i = 0; i < 2 * n; i++) { grab(); c.scrollBack(48); }
  return out;
}

test('Flat: flat ground at one height, for ever both ways', () => {
  const c = new EndlessCourse(flatGrammar(), data.levels, seeded(5));
  const cols = columns(c, 20);
  const top = cols[0].findIndex((v) => v !== 0);
  for (const col of cols) {
    assert.equal(col.findIndex((v) => v !== 0), top);
    assert.deepEqual(col.slice(top, top + FLAT_SHAPE.length), FLAT_SHAPE);
    assert.ok(col.slice(top + FLAT_SHAPE.length).every((v) => v === 1), 'solid below');
  }
});

test('Battlefield: gentle slopes only, rolling within a narrow band, both ways', () => {
  const g = battlefieldGrammar(data.levels, data.collision);
  for (const seed of [1, 2, 3]) {
    const c = new EndlessCourse(g, data.levels, seeded(seed));
    const tops = new Set();
    for (let i = 0; i < 30; i++) { for (let x = 0; x < c.width; x++) tops.add(topOf(c, x)); c.scroll(48); }
    for (let i = 0; i < 60; i++) { for (let x = 0; x < c.width; x++) tops.add(topOf(c, x)); c.scrollBack(48); }
    assert.ok(Math.min(...tops) >= BATTLEFIELD.band[0] && Math.max(...tops) <= BATTLEFIELD.band[1], [...tops].join());
    assert.ok(tops.size >= 4, 'it goes up and down, not just flat');
    assert.equal(c.faceForced, 0);
  }
  // every shape it can use is no steeper than BATTLEFIELD.slope either way
  g.alive.forEach((a, s) => { if (a) assert.ok(Math.max(g.climb[s], g.back.climb[s]) <= BATTLEFIELD.slope); });
});

test('Sandbox: Flat and Battlefield come after the stunt tracks, and drive like Endless', () => {
  const g = new Game(data, { store: memoryStore(), random: seeded(9) });
  const flat = g.sandboxBase - 2;
  assert.equal(g.sandboxCourseName(flat), 'Flat');
  assert.equal(g.sandboxCourseName(flat + 1), 'Battlefield');
  for (const [course, name] of [[flat, 'Flat'], [flat + 1, 'Battlefield']]) {
    g.sandbox.course = course; g.sandbox.birds = 0; g.sandbox.weeds = 0;
    g.startSandbox();
    assert.ok(g.onCourse && !g.isStunt);
    assert.equal(g.courseName, name);
    for (let i = 0; i < 1500; i++) { g.keys.up = true; g.step(); }
    assert.ok(g.metres > 200, `${name}: ${g.metres} m`);
    assert.equal(g.screen, 'playing');
  }
});

test('a saved Sandbox track on a stage of your own stays on it after Flat and Battlefield came in', () => {
  const tiles = Array.from({ length: 8 }, (_, y) => Array.from({ length: 30 }, () => (y >= 6 ? 1 : 0)));
  const stage = { name: 'Mine', width: 30, height: 8, start: [3 * TILE, 4 * TILE], tiles, finish: 25 * TILE };
  const store = memoryStore();
  const g0 = new Game(data, { store });
  g0.bringInStage(stage);
  const oldBase = g0.sandboxBase - 2;
  store.set('sandbox', { course: oldBase });          // saved before 1.26.3: the first stage of your own
  const g = new Game(data, { store });
  assert.equal(g.sandboxCourseName(g.sandbox.course), 'Mine');
  store.set('sandbox', { course: 4 });                 // a stage: unchanged
  assert.equal(new Game(data, { store }).sandbox.course, 4);
  store.set('sandbox', { ...g.sandbox, course: g.sandboxBase - 1 });   // saved since: Battlefield stays Battlefield
  assert.equal(new Game(data, { store }).sandbox.course, g.sandboxBase - 1);
});

test('your missiles go for enemy cars first, then rival cars, and birds only with neither in range', () => {
  const g = new Game(data, { store: memoryStore(), random: seeded(2) });
  g.sandbox.birds = 0; g.sandbox.weeds = 0;
  g.startSandbox();
  const b = g.battle, x = g.truck.T[0], y = g.truck.T[1] - 3000;   // (well up in the sky: nothing to hit)
  // (a stand-in car: aimed at by its centre; it's hit where your truck is, far below)
  const car = (cx, cy) => ({ wreck: null, centre: [cx, cy], truck: g.truck, s: 1 });
  const aimAt = (enemies, racers, birds) => {
    b.enemies = enemies; b.racers = racers; g.critters.birds = birds.map(([bx, by]) => ({ x: bx, y: by, alive: true }));
    const m = { owner: 'you', x, y, ang: 0, speed: 10, life: 150, age: 0 };
    b.missiles = [m];
    b.stepMissiles(null);
    return Math.sign(m.ang);   // (y is down: + turns towards something below)
  };
  const above = [x + 300, y - 150], below = [x + 300, y + 150], nearAbove = [x + 120, y - 40];
  assert.equal(aimAt([car(...below)], [car(...nearAbove)], [nearAbove]), 1, 'enemy over a nearer rival and bird');
  assert.equal(aimAt([], [car(...below)], [nearAbove]), 1, 'rival over a nearer bird');
  assert.equal(aimAt([car(x - 600, y)], [], [above]), -1, 'a bird, with the only enemy behind');
  assert.equal(aimAt([car(x + 2000, y + 300)], [car(...below)], []), 1, 'a rival, with the only enemy out of range');
});

test('Sandbox: Rival Cars, Enemy Cars and Autopilot have notes on what they do', () => {
  for (const key of ['rivals', 'enemies', 'autopilot']) assert.ok(SANDBOX_ROW[key].info?.length > 40, key);
  const g = new Game(data, { store: memoryStore() });
  g.infoSandbox('rivals');
  assert.equal(g.sandboxInfo, 'rivals');
  g.pickSandbox('gravity');
  assert.equal(g.sandboxInfo, null, 'a list of choices closes it');
  g.infoSandbox('gravity');
  assert.equal(g.sandboxInfo, null, 'only settings with a note');
});
