// High up: the truck holds its heading like a plane above 1 km, the engine fades out by 10 km,
// and the scrape isn't heard for ever where it does no damage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, Truck, HOLD_TURN } from '../src/game.js';
import { SoundWatcher, SCRAPE_LIMIT, engineVolume } from '../src/sound-events.js';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));

/** A truck alone in the air, turning: its turn each step (rad), with left held for `held` steps then let go. */
function spin(holdTurn, held, steps) {
  const t = new Truck();
  t.reset(0, 0);
  t.holdTurn = holdTurn;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const before = Math.atan2(t.T[5] - t.T[3], t.T[4] - t.T[2]);
    t.tilt({ left: i < held });
    // (just the points moving on: no gravity, no ground)
    for (let j = 0; j < 10; j++) { const v = t.T[j] - t.P[j]; t.P[j] = t.T[j]; t.T[j] += v; }
    t.constrain();
    let w = Math.atan2(t.T[5] - t.T[3], t.T[4] - t.T[2]) - before;
    if (w > Math.PI) w -= 2 * Math.PI; else if (w < -Math.PI) w += 2 * Math.PI;
    out.push(w);
  }
  return out;
}

test('high up, the truck turns at a steady rate while steered and stops when let go', () => {
  const plane = spin(1, 70, 140), truck = spin(0, 70, 140);
  // steered: it turns the way left turns, at about the set rate (not faster and faster)
  assert.ok(plane[69] < 0 && Math.abs(plane[69] + HOLD_TURN.rate) < HOLD_TURN.rate * 0.2, `turning ${plane[69]}`);
  // let go: it stops within a second (the truck's own way keeps on spinning)
  assert.ok(Math.abs(plane[139]) < 0.002, `still turning ${plane[139]} after letting go`);
  assert.ok(Math.abs(truck[139]) > 0.02, 'down low it keeps spinning');
});

test('the truck\'s height: above where the stage starts', () => {
  const g = new Game(data);
  g.startSandbox();
  for (let i = 0; i < 200; i++) g.step();
  assert.ok(g.height < 30, `near the start: ${g.height.toFixed(1)} m`);
  // (lift it to 2 km above the start: the lower wheel there)
  const lift = Math.max(g.truck.T[3], g.truck.T[5]) - (g.levelData.start[1] - g.shiftTotal[1]) + 64 / 2.5 * 2000;
  for (let j = 1; j < 10; j += 2) g.truck.T[j] -= lift, g.truck.P[j] -= lift;
  g.updateHeight();
  assert.ok(Math.abs(g.height - 2000) < 1, `${g.height.toFixed(0)} m`);
  assert.equal(g.truck.holdTurn, 0);
  g.step();
  assert.equal(g.truck.holdTurn, 1, 'holding its heading at 2 km');
});

test('the engine fades out going up, gone by 10 km', () => {
  assert.equal(engineVolume(0), 1);
  assert.equal(engineVolume(1000), 1);
  assert.ok(engineVolume(5500) > 0.2 && engineVolume(5500) < 0.8);
  assert.equal(engineVolume(10000), 0);
  const g = new Game(data);
  g.startSandbox();
  for (let i = 0; i < 50; i++) g.step();
  g.height = 12000;
  assert.equal(new SoundWatcher().observe(g).engine.on, false);
});

test('the scrape fades away after as long as it would take to wreck, unless it\'s doing damage', () => {
  const run = (damage) => {
    const g = new Game(data);
    g.startSandbox();
    g.rules = { ...g.rules, damage };
    const w = new SoundWatcher();
    w.observe(g);
    g.scraping = true;
    const vols = [];
    for (let i = 0; i < SCRAPE_LIMIT + 200; i++) { const s = w.observe(g).scrape; vols.push(s.on ? s.volume : 0); }
    return vols;
  };
  const off = run(false), on = run(true);
  assert.equal(off[SCRAPE_LIMIT - 1], 1, 'full at first');
  assert.ok(off[SCRAPE_LIMIT + 30] > 0 && off[SCRAPE_LIMIT + 30] < 1, 'fading');
  assert.equal(off[SCRAPE_LIMIT + 150], 0, 'then silent');
  assert.ok(on.every((v) => v === 1), 'full while it does damage');
});
