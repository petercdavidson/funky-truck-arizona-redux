// Sandbox's birds, tumbleweeds and clouds (src/critters.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game } from '../src/game.js';
import { cloudsNear } from '../src/critters.js';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));

test('clouds stay put: the same ones for the same patch of sky, and more of them high up', () => {
  const a = cloudsNear(0, -3000, 2000, -1000), b = cloudsNear(0, -3000, 2000, -1000);
  assert.deepEqual(a, b);
  const low = cloudsNear(0, -400, 20000, 0).length, high = cloudsNear(0, -6000, 20000, -5600).length;
  assert.ok(high > low, `${high} high vs ${low} low`);
  assert.equal(cloudsNear(0, 2000, 20000, 3000).length, 0, 'none underground');
});

test('birds and tumbleweeds come and go round the view, get knocked about, and never touch the truck', () => {
  let seed = 7;
  const g = new Game(data, { random: () => ((seed = (seed * 16807) % 2147483647) / 2147483647) });
  g.sandbox.birds = 3; g.sandbox.weeds = 3;
  g.startSandbox();
  assert.ok(g.critters);
  g.keys.up = true;
  let hits = 0;
  for (let i = 0; i < 2500 && g.screen === 'playing'; i++) {
    // the truck, before and after the critters' step, is just as the step left it
    g.step();
    hits += g.critters.events.length;
    // put a bird and a weed right in front of the truck now and then
    if (i % 150 === 0) {
      const t = g.truck.T;
      g.critters.birds.push({ x: t[0] + 8, y: t[1], vx: -1, vy: 0, dir: -1, flap: 0, hit: false, spin: 0, rot: 0, rest: 0, life: 0 });
    }
  }
  assert.ok(g.critters.birds.length > 0 && g.critters.birds.length <= 41, `${g.critters.birds.length} birds`);
  assert.ok(g.critters.weeds.length > 0 && g.critters.weeds.length <= 20, `${g.critters.weeds.length} tumbleweeds`);
  assert.ok(hits > 3, `${hits} hits`);
  for (const w of g.critters.weeds) assert.ok(Number.isFinite(w.x) && Number.isFinite(w.y));
});

test('hitting critters changes nothing about the truck', () => {
  const run = (n) => {
    let seed = 3;
    const g = new Game(data, { random: () => ((seed = (seed * 16807) % 2147483647) / 2147483647) });
    g.sandbox.birds = n; g.sandbox.weeds = n;
    g.startSandbox();
    g.keys.up = true;
    let hits = 0;
    for (let i = 0; i < 900; i++) {
      g.step();
      hits += g.critters.events.length;
      if (n && i % 60 === 0) g.critters.birds.push({ x: g.truck.T[0], y: g.truck.T[1], vx: 0, vy: 0, dir: 1, flap: 0, hit: false, spin: 0, rot: 0, rest: 0, life: 0 });
    }
    return { T: g.truck.T.map((v) => v.toFixed(6)).join(), hits };
  };
  const none = run(0), lots = run(3);
  assert.ok(lots.hits >= 10, `${lots.hits} hits`);
  assert.equal(lots.T, none.T);
});

test('nothing goes through the ground: tumbleweeds sit and roll on it, birds fly over it and fall onto it', () => {
  let seed = 11;
  const g = new Game(data, { random: () => ((seed = (seed * 16807) % 2147483647) / 2147483647) });
  g.sandbox.birds = 3; g.sandbox.weeds = 3; g.sandbox.power = 3;
  g.startSandbox();
  g.keys.up = true;
  let checked = 0, under = 0, sky = 0;
  const below = (w, o) => !!w.down(o.x, o.y - 1200, o.y - 3);   // ground over it: it's in the ground
  for (let i = 0; i < 3000 && g.screen === 'playing'; i++) {
    g.step();
    if (i % 60 === 30) {
      const t = g.truck.T;
      // knock a bird out right by the truck now and then, to see it land
      g.critters.birds.push({ x: t[0] + 4, y: t[1] - 4, vx: 0, vy: 0, dir: 1, flap: 0, hit: false, spin: 0, rot: 0, rest: 0, life: 0 });
    }
    if (i % 10) continue;
    for (const w of g.critters.weeds) { checked++; if (below(g.world, w)) under++; }
    for (const b of g.critters.birds) { checked++; if (below(g.thinWorld, b)) under++; if (!b.hit) sky++; }
  }
  assert.ok(checked > 500 && sky > 100, `${checked} looked at`);
  assert.equal(under, 0, `${under} of ${checked} in the ground`);
  assert.ok(g.critters.birds.some((b) => b.rest > 0), 'a knocked bird has landed');
});
