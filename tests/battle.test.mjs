// Sandbox's cars (battle.js): enemy trucks, truck collisions, missiles and explosions, your boost and jump.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, TILE, emptyKeys } from '../src/game.js';
import { BATTLE, ENEMY_KINDS, MirrorWorld, enemyLook, circles } from '../src/battle.js';
import { defaultSandbox } from '../src/sandbox.js';
import { SoundWatcher } from '../src/sound-events.js';
import { CUES } from '../src/audio.js';
import { memoryStore } from './helpers.mjs';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
const seeded = (seed) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };

/** A Sandbox run on Endless's course, landed, with no cars unless asked for. */
function battle({ seed = 1, store, rivals = 0, enemies = 0 } = {}) {
  const g = new Game(data, { random: seeded(seed), store });
  g.sandbox = { ...defaultSandbox(), course: 0, rivals, enemies };
  g.startSandbox();
  for (let i = 0; i < 150; i++) g.step();
  assert.ok(g.landed);
  return g;
}

/** Put a new enemy of `kind` `dx` px ahead of your truck, on the ground. */
function enemyAt(g, dx, kind = 'basher') {
  return g.battle.addEnemy(kind, g.truck.T[0] + dx);
}

const finite = (A) => A.every(Number.isFinite);

test('a mirrored world collides exactly as the world does, seen in a mirror', () => {
  const g = battle();
  const w = g.world, m = new MirrorWorld(() => w);
  const rnd = seeded(9);
  let hits = 0;
  for (let i = 0; i < 300; i++) {
    const x = 200 + rnd() * 4000, y = 600 + rnd() * 1800, dx = (rnd() - 0.5) * 300, dy = (rnd() - 0.2) * 300;
    const a = w.collide(x, y, x + dx, y + dy), b = m.collide(-x, y, -x - dx, y + dy);
    assert.equal(!!a, !!b);
    if (!a) continue;
    hits++;
    assert.deepEqual([b.x, b.y, b.nx, b.ny], [-a.x, a.y, -a.nx, a.ny]);
  }
  assert.ok(hits > 10, `some of them hit the ground (${hits})`);
});

test('an enemy truck drives left, towards you, on its own wheels', () => {
  const g = battle();
  const e = enemyAt(g, 900);
  const x0 = e.centre[0];
  for (let i = 0; i < 300; i++) g.step();
  assert.ok(!e.wreck, 'it is still in one piece');
  assert.ok(e.centre[0] < x0 - 200, `it came at you (${Math.round(x0 - e.centre[0])} px)`);
  assert.ok(finite(e.truck.T));
});

test('enemies never share your body, paint, tyres or wheels', () => {
  const rnd = seeded(3);
  for (let body = 0; body < 6; body++) for (let paint = 0; paint < 6; paint++) {
    const you = { body, paint, tyre: (body + paint) % 6, hub: paint };
    for (let n = 0; n < 20; n++) {
      const e = enemyLook(you, rnd);
      assert.notEqual(e.body, you.body);
      assert.notEqual(e.paint, you.paint);
      assert.notEqual(e.tyre, you.tyre);
      assert.notEqual(e.hub, you.hub);
      if (paint === 2 || paint === 5) assert.ok(e.paint !== 2 && e.paint !== 5, 'no green on green');
      for (const k of ['body', 'paint', 'tyre', 'hub']) assert.ok(Number.isInteger(e[k]) && e[k] >= 0 && e[k] < 6);
    }
  }
});

test('trucks bump into each other instead of passing through, and a hard hit hurts both', () => {
  const g = battle();
  const e = enemyAt(g, 260);
  let closest = Infinity;
  for (let i = 0; i < 200; i++) {
    g.keys.up = true;
    g.step();
    const mine = circles(g.truck.T, 1), theirs = circles(e.truck.T, -1);
    for (const a of mine) for (const b of theirs) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r);
  }
  assert.ok(closest > -12, `they never sank far into each other (${closest.toFixed(1)})`);
  assert.ok(g.damage > 0 || e.health < ENEMY_KINDS.basher.health, 'the crash did some damage');
});

test('a missile flies ahead, homes in, blows up the enemy and pays for the takedown', () => {
  const store = memoryStore();
  const g = battle({ store });
  const e = enemyAt(g, 450);
  const score = g.score;
  g.press('fire');
  g.step();
  assert.ok(g.battle.events.some((v) => v.type === 'missile'));
  for (let i = 0; i < 120 && !e.wreck; i++) g.step();
  assert.ok(e.wreck, 'one missile takes out a basher');
  assert.equal(g.battle.takedowns, 1);
  assert.ok(g.score >= score + BATTLE.points.takedown);
  assert.ok(g.damage < 50, 'your own missile does not hurt you');
  for (let i = 0; i < 100; i++) g.step();
  assert.ok(finite(e.wreck.T), 'the wreck tumbles');
});

test('a missile fired with the nose in the ground goes off there, not underground', () => {
  const g = battle();
  const b = g.battle, t = g.truck;
  // point the truck straight down into the ground
  const cx = t.T[0], cy = t.T[1];
  for (let i = 0; i < 10; i += 2) {
    const dx = t.T[i] - cx, dy = t.T[i + 1] - cy;
    t.T[i] = cx - dy; t.T[i + 1] = cy + dx; t.P[i] = t.T[i]; t.P[i + 1] = t.T[i + 1];
  }
  const ground = b.groundAt(cx);
  for (let i = 1; i < 10; i += 2) { t.T[i] += ground - cy; t.P[i] = t.T[i]; }
  b.fire(t);
  assert.ok(b.missiles.length === 1 && b.missiles[0].dead, 'it went off at once');
  assert.ok(b.blasts.length > 0);
});

test('the jump throws you up, the boost speeds you up, and (when they are not unlimited) both run out', () => {
  const g = battle();
  const b = g.battle, t = g.truck;
  Object.assign(b.tune, { unlimited: false, unlimitedBoost: false });
  for (let i = 0; i < 60; i++) g.step();
  const jumps = b.jumps;
  g.press('jump');
  g.step();
  assert.equal(b.jumps, jumps - 1);
  assert.ok(t.T[1] - t.P[1] < -4, 'going up fast');
  for (let i = 0; i < 200; i++) g.step();
  b.jumps = 0;
  g.press('jump');
  const y = t.T[1] - t.P[1];
  g.step();
  assert.ok(t.T[1] - t.P[1] > y - 2, 'no jumps left: no jump');
  // Boost: faster than plain driving, until the meter's empty.
  const speedAfter = (boost) => {
    const h = battle({ seed: 2 });
    for (let i = 0; i < 100; i++) { h.keys.up = true; h.keys.boost = boost; h.step(); }
    return h.truck.T[0];
  };
  assert.ok(speedAfter(true) > speedAfter(false) + 100);
  b.boost = 1;
  g.keys.boost = true;
  for (let i = 0; i < 5; i++) g.step();
  assert.ok(b.boost < 0.1, 'empty (it creeps back very slowly)');
  assert.equal(b.boosting, false);
});

test('a gunner fires at you', () => {
  const g = battle();
  const e = enemyAt(g, 500, 'gunner');
  e.fireIn = 1;
  let fired = false;
  for (let i = 0; i < 40 && !fired; i++) { g.step(); fired = g.battle.missiles.some((m) => m.owner === 'enemy'); }
  assert.ok(fired);
});

test('everything moves with the world when the course scrolls', () => {
  const g = battle();
  const e = enemyAt(g, 400);
  const gap = () => e.centre[0] - g.truck.T[0];
  const a = gap();
  g.scrollWorld(48);
  assert.ok(Math.abs(gap() - a) < 1e-6);
  for (let i = 0; i < 50; i++) g.step();
  assert.ok(finite(e.truck.T) && !e.wreck, 'and it drives on in the new world');
});

test('the cars\' sounds reach the sound watcher, and every cue exists', () => {
  const g = battle(), w = new SoundWatcher();
  w.observe(g);
  enemyAt(g, 450);
  g.press('fire');
  const heard = [];
  for (let i = 0; i < 120; i++) { g.step(); heard.push(...w.observe(g).events.map((e) => e.type)); }
  assert.ok(heard.includes('missile') && heard.includes('boom') && heard.includes('takedown'), `heard ${heard}`);
  for (const c of ['missile', 'enemyMissile', 'boom', 'crunch', 'jump', 'boost', 'takedown']) assert.ok(CUES.includes(c), c);
});

test('presses only count in a Sandbox run that is being played', () => {
  const g = new Game(data);
  g.startEndless();
  g.press('fire'); // nothing to do it, no harm done
  const h = battle();
  h.togglePause();
  h.press('fire');
  assert.equal(h.battle.requests.size, 0);
  assert.equal(emptyKeys().boost, false);
});

test('a long Sandbox run with rival and enemy cars, a simple driver firing and jumping, never breaks', () => {
  for (const seed of [1, 2, 3, 4]) {
    const g = battle({ seed, rivals: 3, enemies: 4 });
    let takedowns = 0;
    for (let i = 0; i < 5000 && g.screen === 'playing'; i++) {
      const t = g.truck;
      g.keys.up = true; g.keys.right = t.bodyRot < -15; g.keys.left = t.bodyRot > 35;
      g.keys.boost = i % 400 < 50;
      if (i % 70 === 0) g.press('fire');
      if (i % 150 === 0) g.press('jump');
      g.step();
      if (g.canUpright) g.upright();
      assert.ok(finite(t.T) && Number.isFinite(g.camX) && Number.isFinite(g.camY) && Number.isFinite(g.score), `seed ${seed} step ${i}`);
      for (const e of g.battle.bots) assert.ok(finite(e.wreck ? e.wreck.T : e.truck.T));
      takedowns = g.battle.takedowns;
    }
    assert.ok(takedowns >= 2, `seed ${seed}: took out ${takedowns} enemies (they keep coming back)`);
    assert.equal(g.battle.racers.length, 3, 'the rivals are all still around');
  }
});

test('the tile size the battle assumes is the game\'s', () => assert.equal(TILE, 64));
