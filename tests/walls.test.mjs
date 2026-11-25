// The invisible side walls of a stage: outside Classic, a wheel against one isn't on the ground.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game } from '../src/game.js';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));

/** Throw the truck, high up, at the left wall, turning over; step until a wheel touches it. */
function throwAtWall(classic) {
  const g = new Game(data);
  g.practiceClassic = classic;
  g.practiceDamage = false;
  g.startPractice(0);
  for (let i = 0; i < 120; i++) g.step();
  const t = g.truck;
  for (let i = 0; i < 10; i += 2) { t.T[i] += 120 - t.T[0]; t.T[i + 1] -= 1500; }
  t.probePrev = null;
  t.P = t.T.map((v, i) => (i % 2 === 0 ? v + 6 : v));     // flying left
  t.addSpin(0.05);
  for (let i = 0; i < 200; i++) {
    g.step();
    if (t.rearContact || t.frontContact) return { g, t };
  }
  throw new Error('never reached the wall');
}

test('outside Classic, hitting a side wall in the air keeps the jump going (no landing, no end to the trick)', () => {
  const { g, t } = throwAtWall(false);
  assert.ok(g.groundBelow(t.T[2] + 30, t.T[3]) > 300, 'still high above the ground');
  assert.equal(t.rearDown || t.frontDown, false, 'the wall is not ground');
  assert.equal(t.airborne, true, 'the flip is still being counted');
  assert.ok(g.airSteps > 0 && g.tricks.air > 0, 'still in the air for tricks');
});

test('in Classic, the side wall counts as the original game had it', () => {
  const { t } = throwAtWall(true);
  assert.equal(t.rearDown || t.frontDown, true);
  assert.equal(t.airborne, false);
});
