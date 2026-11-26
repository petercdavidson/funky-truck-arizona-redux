// Endless Mode: the course generator and the game's handling of an endless run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, TILE } from '../src/game.js';
import { buildGrammar, EndlessCourse, ENDLESS_WIDTH, ENDLESS_HEIGHT, ENDLESS_SHIFT, V_ANGLE } from '../src/endless.js';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
const seeded = (seed) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const grammar = buildGrammar(data.levels, { collision: data.collision });   // as the game builds it

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

test('Endless has no damage; End Run finishes it and saves the best distance; quitting saves it too', () => {
  const store = memoryStore();
  const g = new Game(data, { random: seeded(5), store });
  g.startEndless();
  assert.equal(g.rules.damage, false);
  g.distance = 120;
  g.togglePause();
  g.endRun();
  assert.equal(g.screen, 'gameOver');
  assert.equal(g.wrecked, false);
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

test('Endless never builds a climb too tall and steep to drive up, but keeps its hills', async () => {
  const { MAX_RISE, RISE_SPAN } = await import('../src/endless.js');
  const g = buildGrammar(data.levels);
  const topOf = (l, x) => { let r = 0; while (r < l.height && l.tiles[r][x] === 0) r++; return r; };
  let steepest = 0, hills = 0, cols = 0;
  for (let seed = 1; seed <= 20; seed++) {
    let s = seed * 7919;
    const c = new EndlessCourse(g, data.levels, () => (s = (s * 16807) % 2147483647) / 2147483647);
    const tops = [];
    for (let n = 0; n < 12; n++) {
      for (let x = 0; x < (n ? 48 : 128); x++) tops.push(topOf(c.level, n ? 80 + x : x));
      c.scroll(48);
    }
    for (let x = RISE_SPAN; x < tops.length; x++) {
      steepest = Math.max(steepest, Math.max(...tops.slice(x - RISE_SPAN, x)) - tops[x]);
      if (tops[x - 4] - tops[x] >= 4) hills++;
    }
    cols += tops.length;
  }
  assert.ok(steepest <= MAX_RISE, `climbed ${steepest} tiles within ${RISE_SPAN} columns`);
  assert.ok(hills / cols > 0.04, `still hilly (${(hills / cols * 100).toFixed(1)}% of columns end a real climb)`);
});

test('the course goes on for ever to the left too, built from the same joins, and stays the same when you drive back', async () => {
  const { MAX_RISE, RISE_SPAN } = await import('../src/endless.js');
  const topOf = (c, x) => { let r = 0; while (r < ENDLESS_HEIGHT && c.tiles[r][x] === 0) r++; return r; };
  let steepest = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const c = new EndlessCourse(grammar, data.levels, seeded(seed));
    const tops = [];   // the ground's tops, walking left from the start
    for (let k = 0; k < 12; k++) {
      c.scrollBack(ENDLESS_SHIFT);
      for (let x = ENDLESS_SHIFT - 1; x >= 0; x--) tops.push(topOf(c, x));
      for (const row of c.tiles) {
        assert.equal(row.length, ENDLESS_WIDTH);
        for (let x = 0; x + 1 < row.length; x++) assert.ok(authoredPairs.has(`${row[x]},${row[x + 1]}`), `seed ${seed}: ${row[x]} next to ${row[x + 1]} is not in any stage`);
      }
      for (let x = 0; x < ENDLESS_WIDTH; x++) { const t = topOf(c, x); assert.ok(t >= 10 && t <= 41, `seed ${seed}: ground top ${t} stays in the band`); }
    }
    // (driving left, a climb is the ground rising to the left)
    for (let x = RISE_SPAN; x < tops.length; x++) steepest = Math.max(steepest, Math.max(...tops.slice(x - RISE_SPAN, x)) - tops[x]);
    // there and back: the same course both ways
    const snap = c.tiles.map((r) => r.slice());
    const d0 = c.dropped;
    for (let k = 0; k < 5; k++) c.scroll(ENDLESS_SHIFT);
    for (let k = 0; k < 5; k++) c.scrollBack(ENDLESS_SHIFT);
    assert.equal(c.dropped, d0);
    assert.deepEqual(c.tiles, snap, `seed ${seed}: the same course after driving away and back`);
  }
  assert.ok(steepest <= MAX_RISE + 1, `climbed ${steepest} tiles within ${RISE_SPAN} columns going left`);
});

test('an endless run scrolls back when you drive left, and counts the ground behind the start', () => {
  const g = new Game(data, { random: seeded(9), store: memoryStore() });
  g.startEndless();
  g.step();
  for (let lap = 0; lap < 3; lap++) {
    const col = 39;
    let top = 0;
    while (g.levelData.tiles[top][col] === 0) top++;
    const dx = col * TILE + 32 - g.truck.T[0], dy = (top - 2) * TILE - g.truck.T[1];
    for (let i = 0; i < 10; i += 2) { g.truck.T[i] += dx; g.truck.P[i] += dx; g.truck.T[i + 1] += dy; g.truck.P[i + 1] += dy; }
    g.truck.probePrev = null;
    const shifts = g.shiftCount, dropped = g.course.dropped;
    g.step();
    assert.equal(g.shiftCount, shifts + 1, 'the world scrolled');
    assert.equal(g.course.dropped, dropped - ENDLESS_SHIFT);
    assert.ok(g.truck.T[0] > 80 * TILE, 'the truck moved right with the world');
  }
  for (let i = 0; i < 30; i++) g.step();
  assert.ok(g.distanceBack > 2 * ENDLESS_SHIFT, `ground behind the start counted (${g.distanceBack} columns)`);
  assert.equal(g.metres, Math.floor((g.distance + g.distanceBack) * 2.5));
});

test('no sharp V: a slope down never meets a slope up at less than V_ANGLE (either way along the course)', () => {
  // the ground's height at x (px) in a column of tiles: the topmost up-facing collision line
  const ground = (col, x) => {
    let best = Infinity;
    col.forEach((id, r) => {
      const d = data.collision[id] || [];
      for (let i = 0; i < d.length; i += 5) {
        const [ax, ay, bx, by] = d.slice(i, i + 4);
        if (bx < ax && x >= bx && x <= ax) best = Math.min(best, ay + (by - ay) * (x - ax) / (bx - ax) + r * TILE);
      }
    });
    return best;
  };
  const deg = (dy) => (Number.isFinite(dy) ? Math.atan2(dy, 8) * 180 / Math.PI : 0);
  let joins = 0, before = 0;
  const vees = (c) => {
    const cols = c.tiles[0].map((_, x) => c.tiles.map((row) => row[x]));
    let n = 0;
    for (let x = 1; x < cols.length; x++) {
      const down = deg(ground(cols[x - 1], 63) - ground(cols[x - 1], 55)), up = deg(ground(cols[x], 1) - ground(cols[x], 9));
      joins++;
      if (down > 0 && up > 0 && 180 - down - up < V_ANGLE) n++;
    }
    return n;
  };
  for (let seed = 1; seed <= 6; seed++) {
    const c = new EndlessCourse(grammar, data.levels, seeded(seed));
    let n = 0;
    for (let k = 0; k < 12; k++) { c.scroll(ENDLESS_SHIFT); n += vees(c); }
    for (let k = 0; k < 30; k++) { c.scrollBack(ENDLESS_SHIFT); n += vees(c); }
    assert.equal(n, 0, `seed ${seed}: ${n} sharp V's`);
    // (without the collision lines the generator doesn't know, and makes them)
    const old = new EndlessCourse(buildGrammar(data.levels), data.levels, seeded(seed));
    for (let k = 0; k < 12; k++) { old.scroll(ENDLESS_SHIFT); before += vees(old); }
  }
  assert.ok(joins > 1000 && before > 0, `${joins} joins checked; ${before} V's without the check`);
});
