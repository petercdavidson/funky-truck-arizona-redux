// Sandbox's birds, tumbleweeds and clouds (src/critters.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game } from '../src/game.js';
import { cloudsNear, CRITTERS } from '../src/critters.js';
import { SoundWatcher } from '../src/sound-events.js';

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
    for (const w of g.critters.weeds) { checked++; if (below(g.weedWorld, w)) under++; }
    for (const b of g.critters.birds) { checked++; if (below(g.thinWorld, b)) under++; if (!b.hit) sky++; }
  }
  assert.ok(checked > 500 && sky > 100, `${checked} looked at`);
  assert.equal(under, 0, `${under} of ${checked} in the ground`);
  assert.ok(g.critters.birds.some((b) => b.rest > 0), 'a knocked bird has landed');
});

test('nothing comes in where there is no open sky straight up, nor birds more than 150 m up', () => {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const g = new Game(data, { random: rnd });
  g.sandbox.birds = 3; g.sandbox.weeds = 3;
  g.startSandbox();
  // a sky that's closed everywhere (a pipe, all ground): none come in at all
  const C = g.critters;
  C.birds.length = 0; C.weeds.length = 0;
  const z = g.zoom, hw = g.viewW * z / 2, hh = g.viewH * z / 2, view = { cx: g.camX + hw, cy: g.camY + hh, hw, hh };
  for (let i = 0; i < 400; i++) C.step(g.truck, view, g.world, g.thinWorld, 0.11, Infinity, () => false);
  assert.equal(C.birds.length + C.weeds.length, 0);
  // the level's own sky: everything that comes in has open sky above it
  for (let i = 0; i < 400; i++) {
    const n = C.birds.length;
    g.step();
    for (const b of C.birds.slice(n)) {
      assert.ok(g.skyAbove(b.x, b.y), 'bird under open sky');
      assert.ok(g.world.down(b.x, b.y, b.y + 150 * 64 / 2.5), 'ground within 150 m');
    }
  }
  // skyAbove: under the ground, no; well above it, yes
  const t = g.truck.T;
  assert.equal(g.skyAbove(t[0], t[1] + 400), false);
  assert.equal(g.skyAbove(t[0], -100), true);
});

test('tumbleweeds knock into each other rather than pass through', () => {
  const g = new Game(data);
  g.sandbox.birds = 0; g.sandbox.weeds = 2;
  g.startSandbox();
  const C = g.critters, t = g.truck.T;
  const y = g.world.down(t[0] + 600, t[1] - 300, t[1] + 600).y - 30;
  C.weeds = [
    { x: t[0] + 500, y, vx: 4, vy: 0, rot: 0, life: 0, cool: 0 },
    { x: t[0] + 700, y, vx: -4, vy: 0, rot: 0, life: 0, cool: 0 },
  ];
  let minGap = Infinity;
  for (let i = 0; i < 60; i++) {
    C.step(null, { cx: t[0], cy: t[1], hw: 2000, hh: 2000 }, g.world, g.thinWorld);
    if (C.weeds.length === 2) minGap = Math.min(minGap, Math.abs(C.weeds[1].x - C.weeds[0].x));
  }
  assert.ok(minGap > 25, `closest ${minGap.toFixed(1)} px apart`);
});

test('tumbleweeds are drawn and collide at the tyres\' scale, a little smaller than a tyre', () => {
  const g = new Game(data);
  assert.ok(CRITTERS.weedRadius < g.truck.wheelRadius && CRITTERS.weedRadius > g.truck.wheelRadius * 0.6);
});

test('a pile of tumbleweeds comes to rest (no rolling or jiggling), and wakes when hit', () => {
  for (const course of [0, 1, 3]) {
    const g = new Game(data);
    g.sandbox.birds = 0; g.sandbox.weeds = 0; g.sandbox.course = course;
    g.startSandbox();
    const C = g.critters, t = g.truck.T, r = CRITTERS.weedRadius;
    const x0 = t[0] + 300, gy = g.weedWorld.down(x0, t[1] - 600, t[1] + 1500).y;
    for (let i = 0; i < 10; i++) C.weeds.push({ x: x0 + (i % 4) * r * 1.6 - r * 2.4, y: gy - r - Math.floor(i / 4) * r * 2.2 - 40, vx: 0, vy: 0, rot: 0, life: 0, cool: 0 });
    const view = { cx: x0, cy: gy, hw: 3000, hh: 2000 };   // (wide: none rolls out of it and goes)
    const step = () => { C.events.length = 0; C.step(null, view, g.weedWorld, g.thinWorld, g.truck.gravity, Infinity); };
    for (let i = 0; i < 900; i++) step();
    const rots = C.weeds.map((w) => w.rot);
    let moved = 0;
    for (let i = 0; i < 200; i++) { step(); for (const w of C.weeds) moved += Math.hypot(w.x - w.px, w.y - w.py); }
    assert.ok(C.weeds.length > 3, `course ${course}: ${C.weeds.length} left`);
    assert.equal(moved, 0, `course ${course}: still moving`);
    assert.deepEqual(C.weeds.map((w) => w.rot), rots, `course ${course}: still turning`);
    // a blast sends them off again
    const w = C.weeds[0];
    C.blast(w.x, w.y + 10, 80, 6);
    step();
    assert.ok(Math.hypot(w.x - w.px, w.y - w.py) > 0.5, 'blown away');
  }
});

test('missiles blow up on tumbleweeds (never aiming for one), and a bird a missile gets is heard', () => {
  const g = new Game(data);
  g.sandbox.birds = 0; g.sandbox.weeds = 0; g.sandbox.course = 0;
  g.startSandbox();
  g.screen = 'playing';
  const C = g.critters, B = g.battle, t = g.truck.T;
  // a tumbleweed in the air in front of the truck, a missile fired at it
  C.weeds.push({ x: t[0] + 160, y: t[1] - 40, vx: 0, vy: -0.11, rot: 0, life: 0, cool: 0 });
  B.missiles.push({ id: 999, owner: 'you', x: t[0] + 60, y: t[1] - 40, ang: 0, speed: 8, age: 0, life: 200 });
  let booms = 0;
  for (let i = 0; i < 30; i++) { g.step(); booms += B.events.filter((e) => e.type === 'boom').length; }
  assert.ok(booms >= 1, 'blew up on the tumbleweed');
  // a bird blown up by a missile: the sound watcher hears it
  const sw = new SoundWatcher();
  sw.observe(g);
  C.birds.push({ x: t[0] + 160, y: t[1] - 120, px: t[0] + 160, py: t[1] - 120, vx: 0, vy: 0, dir: 1, cruise: 0, flap: 0, hit: false, spin: 0, rot: 0, rest: 0, life: 0 });
  B.missiles.push({ id: 1000, owner: 'you', x: t[0] + 100, y: t[1] - 120, ang: 0, speed: 8, age: 0, life: 200 });
  let heard = 0;
  for (let i = 0; i < 30; i++) { g.step(); heard += sw.observe(g).events.filter((e) => e.type === 'bird').length; }
  assert.equal(heard, 1, 'the bird hit sound');
});
