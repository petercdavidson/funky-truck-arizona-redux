// Tiles turned and flipped (src/tile-forms.js): the Stage Editor's walls, ceilings and overhangs,
// and custom stages that use them in the game (the physics itself is unchanged).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, TILE, CollisionWorld } from '../src/game.js';
import { validStage } from '../src/stages.js';
import {
  makeId, baseOf, formOf, turnId, flipUpId, mirrorId, formCollision, formTable, isTileId,
  flipTiles, flipTilesUp, turnTiles, tileLabel, NO_MIRROR, mirrorOf,
} from '../src/tile-forms.js';
import { memoryStore } from './helpers.mjs';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
const N = data.collision.length;
const used = new Set(data.levels.flatMap((l) => l.tiles.flat()));

/** A line's normal (the side its ground is away from), as in CollisionWorld. */
const normal = (d, i = 0) => { const dx = d[i + 2] - d[i], dy = d[i + 3] - d[i + 1], l = Math.hypot(dx, dy); return [-dy / l, dx / l]; };
const close = (p, q) => p.every((v, i) => Math.abs(v - q[i]) < 1e-9);

test('turning four times, or flipping twice, gets the tile back', () => {
  for (let base = 0; base < N; base++) for (let f = 0; f < 8; f++) {
    const id = makeId(base, f);
    assert.equal(turnId(turnId(turnId(turnId(id)))), id);
    assert.equal(turnId(turnId(id, false)), id);
    assert.equal(flipUpId(flipUpId(id)), id);
    assert.equal(mirrorId(mirrorId(id)), id);
    assert.ok(isTileId(id, N));
  }
  assert.equal(mirrorId(24), 4);                       // a sheet tile's mirror is the sheet's own
  assert.equal(formOf(mirrorId(45)), 6);               // a kicker has none: its art is mirrored
  assert.ok(!isTileId(N, N) && !isTileId(8 * 256, N) && !isTileId(-1, N) && !isTileId(1.5, N));
  assert.equal(tileLabel(2), '2'); assert.equal(tileLabel(turnId(2)), '2→'); assert.equal(tileLabel(flipUpId(2)), '2↓');
  // only turned: upside down is the mirror tile turned half round; just the kickers get flipped art
  assert.equal(flipUpId(4), makeId(24, 2));
  for (let base = 2; base < N; base++) for (let f = 0; f < 8; f++) assert.ok(formOf(makeId(base, f)) < 4 || NO_MIRROR.has(base));
});

test("turned and flipped tiles' collision lines turn with them, ground on the same side", () => {
  const floor = data.collision[2];                     // flat ground across the middle, normal up
  assert.ok(close(normal(floor), [0, -1]));
  const wallR = formCollision(floor, formOf(turnId(2)));         // top turned to the right
  assert.ok(close(normal(wallR), [1, 0]), 'a wall facing right');
  assert.ok(Math.abs(wallR[0] - wallR[2]) < 1e-9, 'vertical');
  assert.ok(close(normal(formCollision(floor, formOf(turnId(2, false)))), [-1, 0]), 'a wall facing left');
  assert.ok(close(normal(formCollision(floor, formOf(flipUpId(2)))), [0, 1]), 'a ceiling');
  // every piece, every form: the lines stay inside the tile and their normals turn as the tile does
  for (const [id, d] of data.collision.entries()) {
    if (!d.length) continue;
    for (let f = 1; f < 8; f++) {
      const e = formCollision(d, f);
      assert.equal(e.length, d.length);
      for (const v of e) assert.ok(v >= 0 && v <= 63, `tile ${id} form ${f}`);
    }
    const up = formCollision(d, 4);
    for (let i = 0; i < d.length; i += 5) {
      const [nx, ny] = normal(d, i), [mx, my] = normal(up, i);
      assert.ok(Math.abs(nx - mx) < 1e-9 && Math.abs(ny + my) < 1e-9, `tile ${id} upside down`);
    }
  }
  // the table: as it is for a level with no turned tiles; with entries for the ones a level uses
  const level = { tiles: [[0, 2, makeId(2, 1)], [1, makeId(60, 4), 1]] };
  assert.equal(formTable(data.collision, { tiles: [[0, 2], [1, 1]] }), data.collision);
  const t = formTable(data.collision, level);
  assert.notEqual(t, data.collision);
  assert.deepEqual(t[makeId(2, 1)], formCollision(data.collision[2], 1));
  assert.deepEqual(t[makeId(60, 4)], formCollision(data.collision[60], 4));
});

test('areas flip and turn: each tile with them', () => {
  const rows = [[0, 4, 14], [45, 1, makeId(2, 1)]];
  assert.deepEqual(flipTiles(flipTiles(rows)), rows);
  assert.deepEqual(flipTilesUp(flipTilesUp(rows)), rows);
  const t = turnTiles(rows);
  assert.equal(t.length, 3); assert.equal(t[0].length, 2);
  assert.equal(t[0][0], turnId(45)); assert.equal(t[0][1], turnId(0));
  assert.deepEqual(turnTiles(t, false), rows);
  assert.deepEqual(flipTilesUp([[2], [1]]), [[1], [flipUpId(2)]]);
  // mirroring and turning upside down can be done in either order
  for (let base = 0; base < N; base++) for (let f = 0; f < 8; f++) {
    const id = makeId(base, f);
    assert.equal(mirrorId(flipUpId(id)), flipUpId(mirrorId(id)));
  }
  for (const k of NO_MIRROR) assert.equal(baseOf(mirrorId(k)), k);
  assert.ok([...used].every((id) => baseOf(mirrorId(id)) === (NO_MIRROR.has(id) ? id : mirrorOf(id))));
});

// ---- in the game: custom stages with walls and ceilings

/** A flat stage: ground (tile 2) along row 14 of 20, solid below. */
function flat(w = 40) {
  const h = 20;
  const tiles = Array.from({ length: h }, (_, y) => Array(w).fill(y > 14 ? 1 : 0));
  for (let x = 0; x < w; x++) tiles[14][x] = 2;
  return { name: 'Forms', width: w, height: h, start: [3 * TILE, 12 * TILE], tiles };
}

function play(stage) {
  const g = new Game(data, { store: memoryStore() });
  assert.ok(g.bringInStage(stage));
  g.customDamage = false;
  g.startCustom(0);
  return g;
}

test('custom stages may use turned tiles; the game reads them and builds their collision', () => {
  const s = flat();
  s.tiles[13][20] = makeId(2, 3);
  assert.ok(validStage(s, N));
  assert.equal(validStage({ ...s, tiles: s.tiles.map((r, y) => (y === 13 ? r.map((v, x) => (x === 5 ? N : v)) : r)) }, N), null);
  const g = play(s);
  assert.deepEqual(g.tileTable[makeId(2, 3)], formCollision(data.collision[2], 3));
  // the stages and the other modes keep the table as it is
  const g2 = new Game(data, { store: memoryStore() });
  g2.startPractice(0);
  assert.equal(g2.tileTable, data.collision);
});

test('a wall of turned tiles stops the truck', () => {
  const s = flat();
  for (let y = 9; y <= 13; y++) s.tiles[y][15] = makeId(2, 3);      // the dirt on the right, facing left
  for (let y = 9; y <= 13; y++) for (let x = 16; x < 40; x++) s.tiles[y][x] = 1;
  s.tiles[8].fill(0);
  for (let x = 15; x < 40; x++) s.tiles[8][x] = 2;                  // its top: ground again
  s.tiles[8][15] = 0;
  const g = play(s);
  let furthest = 0;
  for (let i = 0; i < 900; i++) { g.keys.up = true; g.step(); furthest = Math.max(furthest, g.truck.T[0]); }
  assert.equal(g.screen, 'playing');
  assert.ok(furthest > 12 * TILE, `drove up to the wall (${(furthest / TILE).toFixed(2)} tiles)`);
  assert.ok(furthest < 15.5 * TILE, `stopped at the wall (got to ${(furthest / TILE).toFixed(2)} tiles)`);
});

test('a ceiling of upside-down tiles keeps the truck under it', () => {
  const s = flat();
  for (let x = 0; x < 40; x++) { s.tiles[10][x] = flipUpId(2); for (let y = 0; y < 10; y++) s.tiles[y][x] = 1; }
  s.start = [3 * TILE, 12.5 * TILE];
  const g = play(s);
  for (let i = 0; i < 60; i++) g.step();                             // land
  // throw it upwards, hard
  const t = g.truck;
  for (let i = 0; i < 10; i += 2) t.P[i + 1] = t.T[i + 1] + 40;
  let highest = Infinity;
  for (let i = 0; i < 200; i++) { g.step(); for (let k = 1; k < 10; k += 2) highest = Math.min(highest, t.T[k]); }
  // the ceiling's line is at 10 * 64 + 31.5; the wheels collide a wheel's radius under it
  assert.ok(highest < 12 * TILE, `it went up (top ${highest.toFixed(0)} px)`);
  assert.ok(highest > 10 * TILE + 31.5 + 15, `stayed under the ceiling (top ${highest.toFixed(0)} px)`);
  const world = new CollisionWorld(s, formTable(data.collision, s), 10);
  assert.ok(world.segs.some((q) => Math.abs(q.ny - 1) < 1e-9), 'the ceiling faces down');
});
