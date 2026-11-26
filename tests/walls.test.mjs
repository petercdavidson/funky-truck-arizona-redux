// The invisible side walls of a stage: except by the original scoring (Classic with tricks off), a
// wheel against one isn't on the ground.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game } from '../src/game.js';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));

/** Throw the truck, high up, at the left wall, turning over; step until a wheel touches it. */
function throwAtWall(classic) {
  const g = new Game(data);
  g.startCampaign({ tricks: !classic });
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

test('with tricks, hitting a side wall in the air keeps the jump going (no landing, no end to the trick)', () => {
  const { g, t } = throwAtWall(false);
  assert.ok(g.groundBelow(t.T[2] + 30, t.T[3]) > 300, 'still high above the ground');
  assert.equal(t.rearDown || t.frontDown, false, 'the wall is not ground');
  assert.equal(t.airborne, true, 'the flip is still being counted');
  assert.ok(g.airSteps > 0 && g.tricks.air > 0, 'still in the air for tricks');
});

test('in Classic with tricks off, the side wall counts as the original game had it', () => {
  const { t } = throwAtWall(true);
  assert.equal(t.rearDown || t.frontDown, true);
  assert.equal(t.airborne, false);
});

test('dirt flies from a wrecked truck\'s wheels and body, and from a cab scraping along (not in 2006 Mode)', async () => {
  const { turnOver } = await import('./helpers.mjs');
  const live = (g) => g.dirt.filter((d) => d.life > 0).length;
  // a wreck at speed
  let g = new Game(data);
  g.practiceDamage = false;
  g.startPractice(2);
  g.keys.up = true;
  for (let i = 0; i < 280; i++) g.step();
  g.keys.up = false;
  for (const d of g.dirt) d.life = 0;
  g.selfWreck();
  let most = 0;
  for (let i = 0; i < 120; i++) { g.step(); most = Math.max(most, live(g)); }
  assert.ok(most > 0, 'a wreck kicks up dirt');
  // a cab sliding on its roof
  for (const classic of [false, true]) {
    g = new Game(data);
    g.practiceDamage = false; g.trialRetro = classic;
    g.startPractice(0);
    for (let i = 0; i < 150; i++) g.step();
    turnOver(g.truck);
    for (let i = 0; i < 10; i += 2) g.truck.P[i] -= 5;     // sliding along
    // (no wait left over from dirt thrown while driving: it could last till the cab had slowed below
    // SCRAPE_DIRT_FROM, and then none came, about one time in 30)
    g.dirtCooldown = 0;
    for (const d of g.dirt) d.life = 0;                     // (nor dirt still flying from the drop-in)
    let scraped = 0; most = 0;
    for (let i = 0; i < 45; i++) { g.step(); if (g.scraping) scraped++; most = Math.max(most, live(g)); }
    assert.ok(scraped > 0, 'the cab scraped');
    if (classic) assert.equal(most, 0, '2006 Mode: no dirt from the cab');
    else assert.ok(most > 0, 'dirt from the scraping cab');
  }
});
