// The level editor's Path tool: sketched lines turned into tiles (src/autotile.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, TILE } from '../src/game.js';
import { buildKit, drawPath } from '../src/autotile.js';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
const kit = buildKit(data.collision, data.levels, TILE);

/** The ground's height every 4 px over columns x0..x1 of a level: its topmost collision line. */
function surface(level, x0, x1) {
  const out = [];
  for (let X = x0 * TILE; X <= x1 * TILE; X += 4) {
    let best = Infinity;
    const c = Math.min(level.width - 1, Math.floor(X / TILE));
    for (const cx of [c - 1, c]) for (let y = 0; y < level.height; y++) {
      const p = kit.byId.get(level.tiles[y][cx]);
      if (!p) continue;
      const lx = X - cx * TILE;
      for (let i = 1; i < p.pts.length; i++) {
        const [ax, ay] = p.pts[i - 1], [bx, by] = p.pts[i];
        if (lx < ax || lx > bx) continue;
        best = Math.min(best, y * TILE + (bx === ax ? Math.min(ay, by) : ay + (by - ay) * (lx - ax) / (bx - ax)));
      }
    }
    if (Number.isFinite(best)) out.push([X, best]);
  }
  return out;
}

function blank(w, h, row) {
  const tiles = Array.from({ length: h }, (_, y) => Array(w).fill(y > row ? 1 : 0));
  for (let x = 0; x < w; x++) tiles[row][x] = 2;   // flat ground, its top at row * TILE + 32
  return { width: w, height: h, tiles, start: [3 * TILE, (row - 3) * TILE] };
}

/** Each piece in the chain starts where the one before it ends. */
function assertJoined(chain) {
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1], b = chain[i], p = kit.byId.get(a.id), q = kit.byId.get(b.id);
    assert.equal(a.x * TILE + p.outX, b.x * TILE + q.inX, `piece ${i} joins in x`);
    assert.equal(a.y * TILE + p.outY, b.y * TILE + q.inY, `piece ${i} joins in y`);
  }
}

test('every tile with collision is a piece of ground, and each one joins others in the stages', () => {
  const solid = data.collision.filter((d) => d && d.length).length;
  assert.equal(kit.pieces.length, solid);
  for (const p of kit.pieces) {
    assert.ok([...kit.joins].some((j) => Math.floor(j / 1024) === p.id), `something follows ${p.id}`);
    assert.ok([...kit.joins].some((j) => j % 1024 === p.id), `${p.id} follows something`);
  }
});

test("the stages' own ground, drawn as a line, comes back exactly", () => {
  for (const [s, l] of data.levels.entries()) for (const x0 of [10, 45]) {
    const line = surface(l, x0, x0 + 20);
    const r = drawPath(l, line, kit);
    assert.ok(r, `stage ${s + 1} from ${x0}`);
    assertJoined(r.chain);
    const after = new Map(surface({ ...l, tiles: r.tiles }, x0, x0 + 20));
    for (const [X, Y] of line) assert.equal(after.get(X), Y, `stage ${s + 1}, x ${X}`);
  }
});

// A hand-drawn-looking line: flat, a wobbly hill, a 40° climb to a table top, a drop, flat.
function sketchLine(row) {
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const base = row * TILE + 32, pts = [];
  for (let x = 4 * TILE + 10; x <= 56 * TILE - 10; x += 10) {
    let y = base;
    if (x > 500 && x < 1300) y -= 180 * Math.sin((x - 500) / 800 * Math.PI);
    else if (x >= 1500 && x < 2000) y -= (x - 1500) * 0.85;
    else if (x >= 2000 && x < 2300) y -= 425;
    else if (x >= 2300 && x < 2700) y -= 425 - (x - 2300) * 1.06;
    pts.push([x, Math.min(base, y) + (rnd() - 0.5) * 8]);
  }
  return pts;
}

test('a rough sketch becomes joined-up ground close to the line, meeting the ground either side', () => {
  const level = blank(64, 30, 22);
  const line = sketchLine(22);
  const r = drawPath(level, line, kit);
  assert.ok(r);
  assert.equal(r.x0, 4); assert.equal(r.x1, 56);
  assertJoined(r.chain);
  // the ends meet the old flat ground: the first piece starts at its height, the last ends there
  const first = kit.byId.get(r.chain[0].id), last = kit.byId.get(r.chain.at(-1).id);
  assert.equal(r.chain[0].y * TILE + first.inY, 22 * TILE + 32);
  assert.equal(r.chain.at(-1).y * TILE + last.outY, 22 * TILE + 32);
  // close to the line all the way
  const after = new Map(surface({ ...level, tiles: r.tiles }, 4, 56));
  let sum = 0, n = 0, worst = 0;
  for (const [x, y] of line) {
    const X = Math.round(x / 4) * 4;
    if (!after.has(X)) continue;
    const d = Math.abs(after.get(X) - y);
    sum += d; n++; worst = Math.max(worst, d);
  }
  assert.ok(sum / n < 12, `mean distance ${(sum / n).toFixed(1)} px`);
  assert.ok(worst < 48, `worst ${worst.toFixed(0)} px`);
  // sky above the ground, ground below
  for (const { x, y } of r.chain) {
    assert.equal(r.tiles[0][x], 0);
    assert.ok(r.tiles.slice(y + 1).every((row) => row[x] !== 0), `column ${x} is solid below its piece`);
  }
});

test('the sketched track can be driven end to end', () => {
  const level = blank(64, 30, 22);
  const r = drawPath(level, sketchLine(22), kit);
  const custom = { name: 'Sketch', ...level, tiles: r.tiles };
  const g = new Game({ ...data, stunts: [custom] });
  g.practiceDamage = false;
  g.startPractice(data.levels.length);
  // full gas, keeping the nose from tipping too far either way
  const t = g.truck;
  g.keys.up = true;
  for (let i = 0; i < 3000 && t.T[0] < 58 * TILE; i++) {
    g.keys.right = t.bodyRot < -15; g.keys.left = t.bodyRot > 35;
    g.step();
  }
  assert.equal(g.screen, 'playing');
  assert.ok(t.T[0] >= 58 * TILE, `reached x ${t.T[0].toFixed(0)}, past the sketched part`);
});

test('a long sketch on a wide level is quick', () => {
  const level = blank(400, 40, 30);
  const pts = [];
  for (let x = 100; x < 395 * TILE; x += 16) pts.push([x, 30 * TILE + 32 - 300 * (1 - Math.cos(x / 900)) / 2]);
  const t0 = performance.now();
  const r = drawPath(level, pts, kit);
  const ms = performance.now() - t0;
  assert.ok(r);
  assertJoined(r.chain);
  assert.ok(ms < 2500, `${ms.toFixed(0)} ms`);
});

// ---- the look (the tiles' art at their edges) and mirrors

import { TILE_EDGES } from '../src/tile-art.js';
import { MIRROR_PAIRS, NO_MIRROR, mirrorOf, flipTiles } from '../src/autotile.js';

const artKit = buildKit(data.collision, data.levels, TILE, { edges: TILE_EDGES });

/** A hill on flat ground, as a sketch (tile units in, px out). */
function hillSketch(f) {
  const pts = [];
  for (let x = 1; x <= 16; x += 0.1) pts.push([x * TILE, f(x) * TILE]);
  return pts;
}

test('the look pass joins the art up without changing the ground', () => {
  let before = 0, after = 0;
  for (const f of [(x) => Math.min(8.5, 3.55 + 0.88 * (x - 6.3) ** 2), (x) => Math.min(8.5, 3.6 + 1.25 * (x - 6.5) ** 2),
    (x) => Math.min(8.5, 4.2 + 0.25 * (x - 8) ** 2), (x) => 8.5 - 1.2 * Math.max(0, Math.sin((x - 2) / 8 * Math.PI))]) {
    const level = blank(18, 14, 8), line = hillSketch(f);
    const plain = drawPath(level, line, artKit, { smooth: 2, look: false, art: 0 });
    const looked = drawPath(level, line, artKit, { smooth: 2 });
    assertJoined(looked.chain);
    before += artKit.seamTotal(plain.tiles, 0, 18); after += artKit.seamTotal(looked.tiles, 0, 18);
    // the same ground to drive on: only tiles with the same collision were swapped
    assert.deepEqual(surface({ ...level, tiles: looked.tiles }, 1, 16), surface({ ...level, tiles: plain.tiles }, 1, 16));
  }
  assert.ok(after < before * 0.85, `seams ${before.toFixed(2)} -> ${after.toFixed(2)}`);
});

test('a sharp peak never puts two pieces in one cell', () => {
  const r = drawPath(blank(18, 14, 8), hillSketch((x) => Math.min(8.5, 3.6 + 1.25 * (x - 6.5) ** 2)), artKit, { smooth: 2 });
  const cells = r.chain.map((c) => `${c.x},${c.y}`);
  assert.equal(new Set(cells).size, cells.length, cells.join(' '));
  // each piece is in the tiles (or one of the same shape)
  for (const c of r.chain) assert.ok(artKit.variants.get(c.id).includes(r.tiles[c.y][c.x]), `piece ${c.id} at ${c.x},${c.y}`);
});

test('mirrored tiles have mirrored collision, and flipping twice changes nothing', () => {
  const seg = (d) => { const out = []; for (let i = 0; i < d.length; i += 5) out.push([d[i], d[i + 1], d[i + 2], d[i + 3]].map((v) => (v >= 63 ? 64 : v))); return out; };
  const seen = new Set();
  for (const [a, b] of MIRROR_PAIRS) {
    assert.ok(!seen.has(a) && !seen.has(b), `${a} or ${b} listed twice`); seen.add(a); seen.add(b);
    assert.ok(!NO_MIRROR.has(a) && !NO_MIRROR.has(b));
    const A = seg(data.collision[a]), B = seg(data.collision[b]);
    assert.equal(A.length, B.length, `${a} and ${b}: the same number of lines`);
    for (const [x1, y1, x2, y2] of A) {
      const m = [64 - x2, y2, 64 - x1, y1];
      assert.ok(B.some((s) => s.every((v, k) => Math.abs(v - m[k]) <= 2)), `${a} mirrored is a line of ${b}`);
    }
    assert.equal(mirrorOf(mirrorOf(a)), a);
  }
  // every piece of ground but the kickers has a mirror (2 is its own)
  for (const p of kit.pieces) if (!NO_MIRROR.has(p.id) && p.id !== 2) assert.ok(seen.has(p.id), `piece ${p.id} has a mirror`);
  const rows = [[0, 4, 14, 97], [45, 1, 110, 2]];
  assert.deepEqual(flipTiles(rows), [[94, 34, 24, 0], [2, 117, 1, 45 + 256 * 6]]);   // a kicker: its own art, mirrored
  assert.deepEqual(flipTiles(flipTiles(rows)), rows);
});

test('a path leaves an overhang above a gap of sky alone, and clears old ground just above it', () => {
  const level = blank(30, 16, 9);
  // a ledge (ground on top, a ceiling under it) at rows 3 and 4, over columns 8 to 14
  for (let x = 8; x <= 14; x++) { level.tiles[3][x] = 2; level.tiles[4][x] = 2 + 256 * 2; }
  // the sketch dips two rows below the flat ground under the ledge
  const line = [];
  for (let x = 4 * TILE; x <= 24 * TILE; x += 8) line.push([x, 9 * TILE + 32 + (x > 8 * TILE && x < 18 * TILE ? 2 * TILE : 0)]);
  const r = drawPath(level, line, artKit, { smooth: 2 });
  assert.ok(r);
  for (let x = 8; x <= 14; x++) {
    assert.equal(r.tiles[3][x], 2, `ledge top at ${x}`);
    assert.equal(r.tiles[4][x], 2 + 256 * 2, `ledge underside at ${x}`);
    assert.equal(r.tiles[9][x], 0, `the old ground above the dip is cleared at ${x}`);
  }
});

// ---- paths any way round, and filling ground in

import { sidesOf, fillGround, paintFill } from '../src/autotile.js';
import { makeId, formOf, turnId, flipUpId } from '../src/tile-forms.js';

/** A path through points given in tiles, as px every 8th of a tile. */
function poly(P) {
  const out = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const [a, b] = [P[i], P[i + 1]], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 8);
    for (let k = 0; k < n; k++) out.push([(a[0] + (b[0] - a[0]) * k / n) * TILE, (a[1] + (b[1] - a[1]) * k / n) * TILE]);
  }
  out.push(P.at(-1).map((v) => v * TILE));
  return out;
}
/** Each piece of a chain laid any way round starts where the one before it ends. */
function assertJoinedAnyWay(chain) {
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1], b = chain[i], p = artKit.oById.get(a.id), q = artKit.oById.get(b.id);
    assert.equal(a.x * TILE + p.outX, b.x * TILE + q.inX, `piece ${i} joins in x`);
    assert.equal(a.y * TILE + p.outY, b.y * TILE + q.inY, `piece ${i} joins in y`);
  }
}

test('which side of a tile is ground: up, down, walls, every way round', () => {
  const s2 = sidesOf(artKit, 2);
  assert.ok(s2.bottom === 1 && s2.top === 0 && s2.surface);
  const ceiling = sidesOf(artKit, flipUpId(2));
  assert.ok(ceiling.top === 1 && ceiling.bottom === 0);
  const wall = sidesOf(artKit, turnId(2));      // its top turned to the right: ground on the left
  assert.ok(wall.left === 1 && wall.right === 0);
  assert.deepEqual(sidesOf(artKit, 1), { top: 1, right: 1, bottom: 1, left: 1, surface: false });
  // the look pass knows turned tiles' art: two tiles side by side, turned, are one above the other
  for (const [a, b] of [[2, 2], [4, 14], [60, 61], [110, 111]]) assert.ok(Math.abs(artKit.seam(a, b, 0) - artKit.seam(turnId(a), turnId(b), 1)) < 1e-6);
});

test('a sketch up a wall lays turned pieces, joined, with ground behind the wall', () => {
  const level = blank(20, 16, 12);
  const r = drawPath(level, poly([[1, 12.5], [8, 12.5], [8.5, 12], [8.5, 6], [9, 5.5], [17, 5.5]]), artKit, { smooth: 2 });
  assert.ok(r && r.free);
  assertJoinedAnyWay(r.chain);
  const walls = r.chain.filter((c) => formOf(c.id) === 3);
  assert.ok(walls.length >= 3, `turned pieces up the wall (${walls.length})`);
  assert.ok(walls.every((c) => c.x === 8));
  // the plateau is solid down to the old ground; to the left of the wall is sky
  for (let y = 7; y <= 11; y++) { assert.equal(r.tiles[y][12], 1); assert.equal(r.tiles[y][5], 0); }
});

test('a sketch back over itself makes an overhang: two grounds in one column, a cave under the lip', () => {
  const level = blank(20, 16, 12);
  const r = drawPath(level, poly([[1, 5.5], [10, 5.5], [10.8, 6], [10.5, 7], [8, 7.5], [7.5, 8.2], [7.5, 11.5], [8.2, 12.5], [17, 12.5]]), artKit, { smooth: 2 });
  assert.ok(r && r.free);
  assertJoinedAnyWay(r.chain);
  const surfaces = (x) => r.tiles.map((row, y) => [y, row[x]]).filter(([, id]) => sidesOf(artKit, id).surface);
  const col = surfaces(9);
  assert.ok(col.length >= 3, `the lip's top, its underside and the floor below (${col.map(([y, id]) => `${id}@${y}`)})`);
  assert.ok(sidesOf(artKit, col[1][1]).top >= 0.6, 'the underside is a ceiling');
  for (let y = col[1][0] + 1; y < col[2][0]; y++) assert.equal(r.tiles[y][9], 0, 'the cave is sky');
  for (let y = col[0][0] + 1; y < col[1][0]; y++) assert.notEqual(r.tiles[y][9], 0, 'the lip is solid');
});

test('fill ground: between ground facing up and down, and to the top or bottom; nothing taken away', () => {
  const W = 6, H = 12;
  const tiles = Array.from({ length: H }, () => Array(W).fill(0));
  tiles[3][1] = flipUpId(2);                  // a ceiling: ground above it, to the top
  tiles[2][2] = 2; tiles[7][2] = flipUpId(2); // a floor above a ceiling: ground between
  tiles[8][3] = 2;                            // a floor: ground below it, to the bottom
  tiles[4][4] = flipUpId(2); tiles[9][4] = 2; // a ceiling above a floor: a cave, left alone
  tiles[5][5] = turnId(2);                    // a wall: nothing up or down
  const r = fillGround({ width: W, height: H, tiles }, artKit, null, { look: false });
  const col = (x) => r.tiles.map((row) => row[x]);
  assert.deepEqual(col(1).slice(0, 3), [1, 1, 1]); assert.equal(col(1)[4], 0);
  assert.deepEqual(col(2).slice(3, 7), [1, 1, 1, 1]); assert.equal(col(2)[1], 0); assert.equal(col(2)[8], 0);
  assert.deepEqual(col(3).slice(9), [1, 1, 1]); assert.equal(col(3)[7], 0);
  assert.deepEqual(col(4).slice(5, 9), [0, 0, 0, 0]); assert.deepEqual(col(4).slice(0, 4), [1, 1, 1, 1]); assert.deepEqual(col(4).slice(10), [1, 1]);
  assert.ok(col(5).every((id, y) => (y === 5 ? id === turnId(2) : id === 0)));
  // only in an area
  const a = fillGround({ width: W, height: H, tiles }, artKit, { x0: 3, y0: 9, x1: 3, y1: 10 }, { look: false });
  assert.deepEqual(a.tiles.map((row) => row[3]).slice(9), [1, 1, 0]);
  assert.equal(a.tiles[0][1], 0);
});

test('painting ground fills its far side: down under a floor, up over a ceiling', () => {
  const H = 10, tiles = Array.from({ length: H }, () => [0]);
  tiles[8][0] = flipUpId(2);                  // a cave's ceiling further down stops the fill
  tiles[3][0] = 2;
  paintFill(tiles, artKit, 0, 3);
  assert.deepEqual(tiles.map((r) => r[0]), [0, 0, 0, 2, 1, 1, 1, 1, flipUpId(2), 0]);
  const up = Array.from({ length: H }, () => [0]);
  up[5][0] = flipUpId(2);
  paintFill(up, artKit, 0, 5);
  assert.deepEqual(up.map((r) => r[0]).slice(0, 6), [1, 1, 1, 1, 1, flipUpId(2)]);
  const wall = Array.from({ length: H }, () => [0]);
  wall[5][0] = turnId(2);
  assert.deepEqual(paintFill(wall, artKit, 0, 5), []);
});

test('path-made walls and overhangs drive as they look in the game', async () => {
  const { memoryStore } = await import('./helpers.mjs');
  const play = (tiles, start) => {
    const g = new Game(data, { store: memoryStore() });
    assert.ok(g.bringInStage({ name: 'Free', width: tiles[0].length, height: tiles.length, start, tiles }));
    g.customDamage = false;
    g.startCustom(0);
    return g;
  };
  // the cliff stops the truck
  const cliff = drawPath(blank(20, 16, 12), poly([[1, 12.5], [8, 12.5], [8.5, 12], [8.5, 6], [9, 5.5], [17, 5.5]]), artKit, { smooth: 2 });
  let g = play(cliff.tiles, [2 * TILE, 11 * TILE]);
  let furthest = 0;
  for (let i = 0; i < 700; i++) { g.keys.up = true; g.step(); furthest = Math.max(furthest, g.truck.T[0]); }
  assert.ok(furthest > 5 * TILE && furthest < 8.6 * TILE, `stopped at the cliff (${(furthest / TILE).toFixed(2)})`);
  // under the overhang and out along the floor
  const lip = drawPath(blank(20, 16, 12), poly([[1, 5.5], [10, 5.5], [10.8, 6], [10.5, 7], [8, 7.5], [7.5, 8.2], [7.5, 11.5], [8.2, 12.5], [17, 12.5]]), artKit, { smooth: 2 });
  g = play(lip.tiles, [9.5 * TILE, 11 * TILE]);
  for (let i = 0; i < 700 && g.truck.T[0] < 16 * TILE; i++) { g.keys.up = true; g.keys.right = g.truck.bodyRot < -15; g.step(); }
  assert.ok(g.truck.T[0] >= 16 * TILE, `drove out from under the lip (${(g.truck.T[0] / TILE).toFixed(1)})`);
  // and on top of the lip, it stays up there
  g = play(lip.tiles, [3 * TILE, 4 * TILE]);
  for (let i = 0; i < 150; i++) g.step();
  assert.ok(g.truck.T[1] < 6 * TILE, `rests on the lip (y ${(g.truck.T[1] / TILE).toFixed(1)})`);
});

test('a closed sketch (the Shape tool) closes up: ground inside it running clockwise, a hole the other way', () => {
  const W = 24, H = 20, empty = { width: W, height: H, tiles: Array.from({ length: H }, () => Array(W).fill(0)) };
  const ring = (dir) => {
    const pts = [];
    for (let i = 0; i <= 120; i++) { const a = -Math.PI / 2 + dir * i / 120 * 2 * Math.PI; pts.push([12 * TILE + Math.cos(a) * 4 * TILE, 10 * TILE + Math.sin(a) * 3 * TILE]); }
    return pts;
  };
  for (const dir of [1, -1]) {
    const r = drawPath(empty, ring(dir), artKit, { smooth: 2, closed: true });
    assert.ok(r, 'laid');
    // each piece starts where the one before it ends, the last back at the first
    const ends = r.chain.map((c) => { const p = artKit.oById.get(c.id); return { i: [c.x * TILE + p.inX, c.y * TILE + p.inY], o: [c.x * TILE + p.outX, c.y * TILE + p.outY] }; });
    ends.forEach((e, k) => assert.deepEqual(ends[(k + 1) % ends.length].i, e.o, `piece ${k} joins the next`));
    assert.equal(new Set(r.chain.map((c) => `${c.x},${c.y}`)).size, r.chain.length, 'one piece per cell');
    // the middle: ground for a lump, sky for a hole; and above the top, sky for a lump
    assert.equal(r.tiles[10][12] !== 0, dir === 1);
    assert.equal(r.tiles[2][12], dir === 1 ? 0 : 1);
  }
});
