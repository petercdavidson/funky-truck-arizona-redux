// Play, Classic, Practice options, the ragdoll wreck, one-button controls and flip upright.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, TILE, STUCK_STEPS } from '../src/game.js';
import { turnOver, memoryStore } from './helpers.mjs';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
const settle = (g, n = 120) => { for (let i = 0; i < n; i++) g.step(); };

/** Move the truck up near the top of the stage and throw it straight up. Returns its highest point. */
function launch(g, speed = 10) {
  const t = g.truck;
  const dy = 140 - t.T[1];
  for (let i = 1; i < 10; i += 2) { t.T[i] += dy; t.P[i] = t.T[i] + speed; }
  t.probePrev = null;
  let top = Infinity, cam = Infinity;
  for (let i = 0; i < 120; i++) { g.step(); top = Math.min(top, t.T[1]); cam = Math.min(cam, g.camY); }
  return { top, cam };
}

test('Classic keeps the ceiling and the camera at the top; Play lets the truck fly above it', () => {
  const g = new Game(data);
  g.startCampaign(true);
  settle(g);
  const classic = launch(g);
  assert.ok(classic.top > 0, `Classic: stopped by the ceiling (${classic.top.toFixed(1)})`);
  assert.ok(classic.cam >= 0);
  g.startCampaign();
  settle(g);
  const play = launch(g);
  assert.ok(play.top < -100, `Play: flew above the top of the stage (${play.top.toFixed(1)})`);
  assert.ok(play.cam < 0, 'the camera rose to follow');
  assert.ok(play.top - play.cam > 60, 'and kept the truck on screen');
});

test('Classic scores a landed flip at once, as the original did, and has no trick chain', () => {
  const g = new Game(data);
  g.startCampaign(true);
  settle(g);
  const t = g.truck;
  for (let i = 1; i < 10; i += 2) { t.T[i] -= 30; t.P[i] = t.T[i]; }
  t.probePrev = null;
  g.step();
  // as if it had turned right over on the way up
  t.flipAccum = 300;
  const before = g.score;
  for (let i = 0; i < 60 && g.flipBonusTimer === 0; i++) g.step();
  assert.ok(g.flipBonusTimer > 0, 'the flip bonus showed');
  assert.ok(g.score - before >= 190, 'and was added to the score straight away');
  assert.equal(g.tricks.chain.length, 0);
  assert.equal(g.tricks.done, 0);
});

test('Play and Classic keep separate best scores; damage-free Practice saves none', () => {
  const store = memoryStore();
  const g = new Game(data, { store });
  const wreckWith = (score) => { g.damage = 1000; g.score = score; for (let i = 0; i < 400 && g.screen === 'playing'; i++) g.step(); };
  g.startCampaign(); wreckWith(5000);
  assert.ok(store.get('bestPlay') >= 5000);
  assert.equal(store.get('bestScore'), null);
  const play = store.get('bestPlay');
  g.startCampaign(true); wreckWith(3000);
  assert.ok(store.get('bestScore') >= 3000);
  assert.equal(store.get('bestPlay'), play, 'a Classic run leaves the Play best alone');
  g.toggle('practiceDamage');
  g.startPractice(0);
  assert.equal(g.rules.damage, false);
  g.score = 999999; g.damage = 1000;
  settle(g, 300);
  assert.equal(g.screen, 'playing', 'no damage, no wreck');
  assert.ok(store.get('bestPlay') < 999999);
  const again = new Game(data, { store });
  assert.equal(again.practiceDamage, false);
  assert.equal(again.bestPlay, g.bestPlay);
  store.set('bestPlay', -4); store.set('practiceClassic', 'yes');
  const bad = new Game(data, { store });
  assert.equal(bad.bestPlay, 0);
  assert.equal(bad.practiceClassic, false);
});

test('Practice can be played by Classic rules', () => {
  const g = new Game(data);
  g.toggle('practiceClassic');
  g.startPractice(2);
  assert.equal(g.rules.classic, true);
  assert.equal(g.rules.damage, true);
  g.restart();
  assert.equal(g.rules.classic, true);
});

test('outside Classic a wreck comes apart into pieces that fall and settle on the ground', () => {
  const g = new Game(data, { random: () => 0.5 });
  g.startCampaign();
  settle(g);
  g.damage = 1000;
  g.step();
  assert.ok(g.wreck, 'the truck came apart');
  const w = g.wreck;
  const maxY = data.levels[0].height * TILE;
  let steps = 0;
  for (; steps < 400 && g.screen === 'playing'; steps++) {
    g.step();
    for (const v of w.T) assert.ok(Number.isFinite(v));
  }
  assert.equal(g.screen, 'gameOver');
  assert.ok(steps < 200, `game over after about two seconds (${steps} steps)`);
  for (let i = 1; i < w.T.length; i += 2) assert.ok(w.T[i] < maxY, 'no piece fell out of the level');
  for (let i = 0; i < 300; i++) w.step();
  let moving = 0;
  for (let i = 0; i < w.T.length; i++) moving = Math.max(moving, Math.abs(w.T[i] - w.P[i]));
  assert.ok(moving < 0.5, `the pieces came to rest (${moving.toFixed(2)})`);

  const c = new Game(data);
  c.startCampaign(true);
  settle(c);
  c.damage = 1000; c.step();
  assert.equal(c.wreck, null, 'Classic wrecks stay in one piece');
});

test('one-button controls: the button drives on the ground and tilts back in the air', () => {
  const g = new Game(data);
  g.toggle('oneButton');
  g.startCampaign();
  settle(g);
  const x0 = g.truck.T[0];
  g.keys.one = true;
  settle(g, 140);
  assert.ok(g.truck.T[0] > x0 + 40, 'drove forwards');
  g.keys.one = false;
  settle(g, 140);
  // in the air, holding the button turns the truck back (anticlockwise: bodyRot goes down)
  const t = g.truck;
  for (let i = 1; i < 10; i += 2) t.P[i] = t.T[i] + 6;
  for (let i = 0; i < 8; i++) g.step();
  const r0 = t.bodyRot;
  g.keys.one = true;
  for (let i = 0; i < 15; i++) g.step();
  assert.ok(t.bodyRot < r0 - 10, `tilted back (${r0.toFixed(1)} -> ${t.bodyRot.toFixed(1)})`);

  const c = new Game(data);
  c.oneButton = true;
  c.startCampaign(true);
  assert.equal(c.oneButtonActive, false, 'Classic uses the original controls');
});

test('stuck on its roof in a damage-free run, the truck can be flipped back onto its wheels', () => {
  for (const start of [(g) => g.startEndless(), (g) => { g.practiceDamage = false; g.startPractice(0); }]) {
    const g = new Game(data, { random: () => 0.3 });
    start(g);
    settle(g);
    turnOver(g.truck);
    assert.equal(g.upright(), false, 'not offered straight away');
    let n = 0;
    while (!g.canUpright && n < STUCK_STEPS * 3) { g.step(); n++; }
    assert.ok(g.canUpright, `offered after being stuck a while (${n} steps)`);
    assert.ok(g.upright());
    for (let i = 0; i < 220; i++) g.step();
    const t = g.truck;
    assert.ok(Math.abs(t.bodyRot) < 30, `upright again (${t.bodyRot.toFixed(1)}°)`);
    assert.ok(t.rearContact || t.frontContact, 'back on its wheels');
  }
  const p = new Game(data);
  p.startCampaign();
  settle(p);
  turnOver(p.truck);
  for (let i = 0; i < STUCK_STEPS * 2; i++) p.step();
  assert.equal(p.canUpright, false, 'not offered when damage is on');
});

test('a taller view keeps the truck centred top to bottom', () => {
  const g = new Game(data);
  g.startCampaign();
  g.viewH = 800;
  settle(g, 300);
  const [, fy] = g.focus;
  const want = Math.min(fy - 400, g.maxCamY); // centred, unless that would show below the level
  assert.equal(g.maxCamY, data.levels[0].height * TILE - 800);
  assert.ok(Math.abs(g.camY - want) < 20, `camera at ${Math.round(g.camY)}, expected about ${Math.round(want)}`);
});

test('wreck wheels keep rolling after the body has stopped', () => {
  const g = new Game(data);
  g.startCampaign();
  g.keys.up = true;
  settle(g, 300);
  g.keys.up = false;
  g.damage = 1000;
  g.step();
  const w = g.wreck;
  for (let i = 0; i < 140; i++) w.step();
  const speed = (i) => Math.hypot(w.T[i * 2] - w.P[i * 2], w.T[i * 2 + 1] - w.P[i * 2 + 1]);
  const wheels = Math.max(...w.wheels.map((x) => speed(x.p)));
  const body = Math.max(...w.body.map(speed));
  assert.ok(wheels > 1, `a wheel is still rolling (${wheels.toFixed(2)} px/step)`);
  assert.ok(body < wheels, `faster than the body (${body.toFixed(2)})`);
});
