// Units (metric / imperial), the speedometer's scale, and the speed limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, MAX_SPEED, KMH_PER_PX_STEP } from '../src/game.js';
import { formatSpeed, formatHeight, speedoShare, SPEEDO_FULL } from '../src/units.js';
import { memoryStore } from './helpers.mjs';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));

test('speeds and heights in metric and imperial', () => {
  assert.equal(formatSpeed(100), '100 km/h');
  assert.equal(formatSpeed(100, true), '62 mph');
  assert.equal(formatHeight(350), '350 m');
  assert.equal(formatHeight(1500), '1.5 km');
  assert.equal(formatHeight(350, true), '1,148 ft');
  assert.equal(formatHeight(1609.344 * 2.5, true), '2.5 mi', 'miles once past a mile');
  assert.equal(formatHeight(1600, true), '5,249 ft', 'feet up to a mile');
});

test('the speedometer moves at everyday speeds and is full at its top speed', () => {
  assert.equal(speedoShare(0), 0);
  assert.ok(speedoShare(50) > 0.3, 'a third of the way at 50 km/h');
  assert.ok(speedoShare(100) > speedoShare(50) && speedoShare(200) > speedoShare(100));
  assert.equal(speedoShare(SPEEDO_FULL), 1);
  assert.equal(speedoShare(5000), 1);
});

test('the Units option is saved', () => {
  const store = memoryStore();
  const g = new Game(data, { store });
  assert.equal(g.imperial, false);
  g.toggle('imperial');
  assert.equal(new Game(data, { store }).imperial, true);
});

test('nothing goes faster than 9999 km/h', () => {
  const g = new Game(data);
  g.sandbox.course = 0; g.sandbox.gravity = 0; g.sandbox.boostPower = 3;
  g.startSandbox();
  const t = g.truck;
  for (let i = 0; i < 10; i += 2) { t.T[i + 1] -= 4000; t.P[i] = t.T[i] - 2000; t.P[i + 1] = t.T[i + 1]; }
  t.probePrev = null;
  g.step();
  assert.ok(t.speed <= MAX_SPEED + 1e-6, `${Math.round(t.speed * KMH_PER_PX_STEP)} km/h`);
  assert.ok(t.speed > MAX_SPEED * 0.99);
});
