// The trick system: naming, chains, multipliers, bails, and its hook-up to the game's score.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game } from '../src/game.js';
import { TrickTracker, TRICK, flipName } from '../src/tricks.js';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));

/** A stand-in truck: just the fields the tracker reads. It throws if anything writes to it. */
function fakeTruck() {
  const state = { rearContact: true, frontContact: true, T: [0, 0], P: [-2, 0], flipAccum: 0 };
  const truck = new Proxy(state, { set() { throw new Error('the trick tracker must not change the truck'); } });
  return { truck, state };
}
const run = (tr, ft, n, { rear = true, front = true, flip = null, scraped = false, scoring = true } = {}) => {
  let paid = 0;
  for (let i = 0; i < n; i++) {
    ft.state.rearContact = rear; ft.state.frontContact = front;
    paid += tr.step(ft.truck, i === 0 ? flip : null, scraped, scoring);
  }
  return paid;
};

test('flips are named by direction and number of turns', () => {
  assert.equal(flipName(370), 'Backflip');
  assert.equal(flipName(-200), 'Frontflip');
  assert.equal(flipName(584), 'Backflip');
  assert.equal(flipName(700), 'Double Backflip');
  assert.equal(flipName(-1080), 'Triple Frontflip');
});

test('a flip with big air and a clean landing chains, and pays out with a multiplier', () => {
  const tr = new TrickTracker(), ft = fakeTruck();
  run(tr, ft, 100, { rear: false, front: false });           // 100 steps of air
  ft.state.flipAccum = 372;
  let paid = run(tr, ft, 1, { flip: 372 });                  // both wheels down together
  assert.deepEqual(tr.chain.map((t) => t.name), ['Backflip', 'Big Air (1.4s)', 'Clean']);
  assert.deepEqual(tr.show.names, ['Backflip', 'Big Air (1.4s)', 'Clean']);
  const air = (100 - 35) * TRICK.airPoints, clean = Math.round((372 + air) * TRICK.cleanBonus);
  assert.equal(tr.chainPoints, 372 + air + clean);
  assert.equal(tr.multiplier, 3);
  paid += run(tr, ft, TRICK.chainGap);
  assert.equal(paid, (372 + air + clean) * 3);
  assert.equal(tr.chain.length, 0);
});

test('a landing on one wheel is not clean, and a short hop is not big air', () => {
  const tr = new TrickTracker(), ft = fakeTruck();
  run(tr, ft, 30, { rear: false, front: false });
  run(tr, ft, 20, { rear: true, front: false });
  assert.equal(tr.chain.length, 0);
});

test('wheelies count after a moment on one wheel, and keep the chain open while they last', () => {
  const tr = new TrickTracker(), ft = fakeTruck();
  ft.state.T = [10, 0]; ft.state.P = [8, 0];                 // rolling forwards
  run(tr, ft, TRICK.wheelieStart - 1, { rear: true, front: false });
  assert.equal(tr.show, null);
  let paid = run(tr, ft, 200, { rear: true, front: false });
  assert.deepEqual(tr.show?.names ?? [], []);                // the name has faded by now
  assert.equal(paid, 0, 'nothing paid while the wheelie goes on');
  paid += run(tr, ft, 1);                                    // front wheel down: wheelie over
  assert.equal(tr.chain[0].name, 'Wheelie');
  assert.equal(tr.chain[0].points, (TRICK.wheelieStart - 1 + 200) * TRICK.wheeliePoints);
  paid += run(tr, ft, TRICK.chainGap);
  assert.ok(paid > 0);
  // Rolling backwards on one wheel isn't a wheelie.
  ft.state.T = [8, 0]; ft.state.P = [10, 0];
  run(tr, ft, 200, { rear: true, front: false });
  run(tr, ft, TRICK.chainGap + 1);
  assert.equal(tr.chain.length, 0);
  assert.equal(tr.banked.points, paid, 'no new payout');
});

test('scraping the cab bails the chain: its tricks pay, but with no multiplier', () => {
  const tr = new TrickTracker(), ft = fakeTruck();
  run(tr, ft, 150, { rear: false, front: false });
  ft.state.flipAccum = -400;
  run(tr, ft, 1, { flip: 400, rear: true, front: false });  // Frontflip + Huge Air, not clean
  assert.deepEqual(tr.chain.map((t) => t.name), ['Frontflip', 'Huge Air (2.1s)']);
  const points = tr.chainPoints;
  const paid = run(tr, ft, 1, { scraped: true });
  assert.equal(paid, points);
  assert.equal(tr.banked.bailed, true);
  // A bail isn't shown as a trick: the names stay, with a bail note under them.
  assert.deepEqual(tr.show.names, ['Frontflip', 'Huge Air (2.1s)']);
  assert.ok(tr.bail);
  assert.equal(tr.queue.length, 0);
});

test('a trick name stays up long enough to read before the next one replaces it', () => {
  const tr = new TrickTracker();
  tr.announce(['Backflip']);
  const done = tr.done;
  tr.announce(['Big Air']);
  assert.equal(tr.done, done + 1, 'the second trick counts (and sounds) at once');
  assert.deepEqual(tr.fresh, ['Big Air']);
  assert.deepEqual(tr.show.names, ['Backflip']);
  for (let i = 0; i < TRICK.readFor - 1; i++) tr.tickShow();
  assert.deepEqual(tr.show.names, ['Backflip']);
  tr.tickShow();
  assert.deepEqual(tr.show.names, ['Big Air']);
  tr.announce(['Big Air', 'Clean'], ['Clean']);
  assert.deepEqual(tr.show.names, ['Big Air', 'Clean'], 'a Clean joins the name already showing');
});

test('nothing scores when scoring is off', () => {
  const tr = new TrickTracker(), ft = fakeTruck();
  run(tr, ft, 150, { rear: false, front: false, scoring: false });
  assert.equal(run(tr, ft, 200, { flip: 400, scoring: false }), 0);
  assert.equal(tr.chain.length, 0);
});

test('in the game, a dropped truck that turns over in the air scores its tricks', () => {
  const g = new Game(data);
  g.startPractice(0);
  for (let i = 0; i < 10; i += 2) { g.truck.T[i + 1] -= 900; g.truck.P[i + 1] -= 900; }
  g.truck.probePrev = null;
  const names = new Set();
  let payouts = 0;
  for (let f = 0; f < 1400; f++) {                          // it bounces a good while
    g.keys.left = f < 120;                                  // tilt back in the air
    const before = g.score;
    g.step();
    if (g.tricks.show) for (const n of g.tricks.show.names) names.add(n);
    if (g.score > before) payouts++;
  }
  assert.ok([...names].some((n) => /^(Big|Huge) Air \(\d\.\d+s\)$/.test(n)), `tricks seen: ${[...names]}`);
  assert.ok([...names].some((n) => n.endsWith('Backflip')), `tricks seen: ${[...names]}`);
  assert.ok(payouts >= 1 && g.score > 0, `score ${g.score}`);
  assert.equal(g.flipBonus, g.tricks.banked.points);
});

test('a chain still open at the finish line is paid out', () => {
  const g = new Game(data);
  g.startPractice(0);
  for (let i = 0; i < 30; i++) g.step();
  g.tricks.add('Backflip', 360);
  const score = g.score;
  const dx = (data.levels[0].width - 9) * 64 + 1 - g.truck.T[0];
  for (let i = 0; i < 10; i += 2) { g.truck.T[i] += dx; g.truck.P[i] += dx; }
  g.truck.probePrev = null;
  g.step();
  assert.equal(g.score, score + 360);
  assert.equal(g.tricks.chain.length, 0);
});
