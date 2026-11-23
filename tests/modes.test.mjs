// Play, Classic, Practice options, the ragdoll wreck, one-button controls and flip upright.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, TILE, BALANCE_ANGLE, STUCK_STEPS, CAMERA, UPRIGHT_LINGER, TRICK_COOLDOWN, KMH_PER_PX_STEP, unpackLevel } from '../src/game.js';
import { turnOver, memoryStore } from './helpers.mjs';
import { WRECK, Wreck } from '../src/wreck.js';
import { BODY_SHAPES } from '../src/wreck-shapes.js';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
const settle = (g, n = 120) => { for (let i = 0; i < n; i++) g.step(); };

/** Move the truck up near the top of the stage and throw it straight up. Returns its highest point. */
function launch(g, speed = 10) {
  const t = g.truck;
  const dy = 140 - t.T[1];
  for (let i = 1; i < 10; i += 2) { t.T[i] += dy; t.P[i] = t.T[i] + speed; }
  t.probePrev = null;
  g.camY = t.T[1] - g.viewH / 2; // the truck was moved, so start the camera on it
  let top = Infinity, cam = Infinity, onScreen = 0;
  for (let i = 0; i < 120; i++) {
    g.step();
    // onScreen: how far down the view the truck shows at the top of its flight
    if (t.T[1] < top) onScreen = (t.T[1] - g.camY) / g.zoom;
    top = Math.min(top, t.T[1]); cam = Math.min(cam, g.camY);
  }
  return { top, cam, onScreen };
}

test('Classic keeps the ceiling and the camera at the top; Play lets the truck fly above it', () => {
  const g = new Game(data);
  g.startCampaign(true);
  settle(g);
  const classic = launch(g);
  assert.ok(classic.top > 0, `Classic: stopped by the ceiling (${classic.top.toFixed(1)})`);
  assert.ok(classic.cam >= 0);
  g.dynamicCamera = false; // the plain camera, which keeps the truck in the middle
  g.startCampaign();
  settle(g);
  const play = launch(g);
  assert.ok(play.top < -100, `Play: flew above the top of the stage (${play.top.toFixed(1)})`);
  assert.ok(play.cam < 0, 'the camera rose to follow');
  // The original camera only kept a truck above the stage 110 down from the top edge; now it follows.
  assert.ok(play.onScreen > 160 && play.onScreen < 300, `and kept the truck well inside the view (${play.onScreen.toFixed(0)} down)`);
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
  for (let i = 0; i < 600; i++) w.step(); // (a loose wheel can rock back and forth in a dip for a while)
  let moving = 0;
  for (let i = 0; i < w.T.length; i++) moving = Math.max(moving, Math.abs(w.T[i] - w.P[i]));
  assert.ok(moving < 0.5, `the pieces came to rest (${moving.toFixed(2)})`);

  const c = new Game(data);
  c.startCampaign(true);
  settle(c);
  c.damage = 1000; c.step();
  assert.equal(c.wreck, null, 'Classic wrecks stay in one piece');
});

test('a wreck\'s wheels hit each other and the body instead of passing through', () => {
  const g = new Game(data, { random: () => 0.5 });
  g.startCampaign();
  settle(g);
  g.damage = 1000;
  g.step();
  const w = g.wreck, T = w.T, [a, b] = w.wheels.map((h) => h.p), R = WRECK.wheelRadius;
  // throw the front wheel at the rear one, and the rear one into the middle of the body
  // (both stopped dead, so only the collisions can part them)
  const box = w.body;
  const mid = (k) => box.reduce((sum, i) => sum + T[i * 2 + k], 0) / box.length;
  const ax = mid(0), ay = mid(1);
  for (const [p, x, y] of [[a, ax, ay], [b, ax + 10, ay]]) { T[p * 2] = w.P[p * 2] = x; T[p * 2 + 1] = w.P[p * 2 + 1] = y; }
  // (as once they've come apart since the wreck: until then, a wheel still in its arch passes the body)
  w.ghost = { ww: false, wb: [false, false] };
  let worst = 0;
  for (let i = 0; i < 70; i++) {
    w.step();
    if (i < 3) continue; // (a few steps to push them out)
    worst = Math.max(worst, 2 * R - Math.hypot(T[b * 2] - T[a * 2], T[b * 2 + 1] - T[a * 2 + 1]));
  }
  assert.ok(worst < 3, `the wheels overlapped by up to ${worst.toFixed(1)} px`);
  const inBox = (x, y) => {
    const pts = box.map((i) => [T[i * 2], T[i * 2 + 1]]);
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if ((pts[j][1] > y) !== (pts[i][1] > y) && x < pts[j][0] + (y - pts[j][1]) / (pts[i][1] - pts[j][1]) * (pts[i][0] - pts[j][0])) inside = !inside;
    return inside;
  };
  for (const p of [a, b]) assert.ok(!inBox(T[p * 2], T[p * 2 + 1]), 'no wheel ends up inside the body');
  for (const v of T) assert.ok(Number.isFinite(v));
});

test('a truck wrecked at rest comes apart gently: nothing is flung off', () => {
  for (let body = 0; body < 6; body++) {
    const g = new Game(data, { random: () => 0.5 });
    g.look.body = body; g.look.paint = body;
    g.startCampaign();
    settle(g, 200);
    g.selfWreck();
    const w = g.wreck;
    let up = 0, sideways = 0;
    for (let i = 0; i < 280; i++) {
      w.step();
      for (let p = 0; p < w.T.length; p += 2) {
        up = Math.max(up, w.P[p + 1] - w.T[p + 1]);
        sideways = Math.max(sideways, Math.abs(w.T[p] - w.P[p]));
      }
    }
    // (it collapses: pieces fall and tip, but none is thrown up or shot sideways; before the
    // collisions eased in, pieces left at 9 px a step up and 6 sideways)
    assert.ok(up < 3, `body ${body}: a piece went up at ${up.toFixed(2)} px a step`);
    assert.ok(sideways < 4, `body ${body}: a piece went ${sideways.toFixed(2)} px a step sideways`);
  }
});

test('each body\'s wreck outline is drawn where the truck\'s body was', () => {
  for (let body = 0; body < 6; body++) {
    const g = new Game(data);
    g.look.body = body;
    g.startCampaign();
    settle(g);
    const t = g.truck, mount = [t.T[6], t.T[7]], ang = Math.atan2(t.T[9] - t.T[7], t.T[8] - t.T[6]);
    g.selfWreck();
    const w = g.wreck;
    assert.equal(w.shape, BODY_SHAPES[body]);
    const pose = Wreck.bodyPose(w.T, w.body, w.shape);
    assert.ok(Math.hypot(pose.x - mount[0], pose.y - mount[1]) < 8, `body ${body}: drawn at the mount (${pose.x.toFixed(1)}, ${pose.y.toFixed(1)})`);
    assert.ok(Math.abs(pose.ang - ang) < 0.1, `body ${body}: at the body's angle`);
  }
});

test('a wreck\'s wheels bounce like rubber', () => {
  const g = new Game(data, { random: () => 0.5 });
  g.startCampaign();
  settle(g);
  g.selfWreck();
  const w = g.wreck, p = w.wheels[0].p, T = w.T, P = w.P;
  // drop it from above the ground, clear of the other pieces, falling at 8 px a step
  const x = T[p * 2] + 300, ground = g.world.collide(x, T[p * 2 + 1] - 1000, x, T[p * 2 + 1] + 600);
  T[p * 2] = P[p * 2] = x; T[p * 2 + 1] = ground.y - 200; P[p * 2 + 1] = T[p * 2 + 1] - 8;
  const slope = Math.abs(ground.nx);
  let down = 0, up = 0;
  for (let i = 0; i < 60; i++) {
    w.step();
    const vy = T[p * 2 + 1] - P[p * 2 + 1];
    if (vy > 0 && !up) down = Math.max(down, vy); else if (vy < 0) up = Math.max(up, -vy);
  }
  assert.ok(up > down * 0.5, `it bounced back up at ${up.toFixed(1)} of ${down.toFixed(1)} px a step (ground slope ${slope.toFixed(2)})`);
});

test('a wreck settles completely: no trembling, no wheel turning for ever, and it wakes if pushed', () => {
  for (const [stage, drive, body] of [[0, 400, 0], [1, 300, 2], [2, 500, 4], [3, 250, 0], [5, 600, 4]]) {
    const g = new Game(data, { random: () => 0.5 });
    g.look.body = body;
    g.startPractice(stage);
    g.rules = { classic: false, damage: false };
    for (let i = 0; i < drive; i++) { g.keys.up = true; g.step(); }
    g.keys.up = false;
    g.selfWreck();
    const w = g.wreck;
    for (let i = 0; i < 1400; i++) w.step();
    const before = w.T.slice(), rot = w.wheels.map((h) => h.rot);
    for (let i = 0; i < 140; i++) w.step();
    const moved = Math.max(...w.T.map((v, i) => Math.abs(v - before[i])));
    assert.ok(moved < 0.01, `stage ${stage + 1}, body ${body}: still moving (${moved.toFixed(3)} px in 2 s)`);
    assert.deepEqual(w.wheels.map((h) => h.rot), rot, `stage ${stage + 1}, body ${body}: a wheel still turning`);
    // something knocks it (a blast pushes its points): it wakes and moves
    for (let i = 0; i < w.P.length; i += 2) w.P[i + 1] += 3;
    w.step();
    assert.ok(Math.max(...w.T.map((v, i) => Math.abs(v - before[i]))) > 1, 'woken by a push');
  }
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

/** A long flat track, as a Practice stunt track. */
function flatGame(oneButton = true) {
  const w = 200, h = 30, row = 22;
  const tiles = Array.from({ length: h }, (_, y) => Array(w).fill(y > row ? 1 : 0));
  for (let x = 0; x < w; x++) tiles[row][x] = 2;
  const g = new Game({ ...data, stunts: [{ name: 'Flat', width: w, height: h, tiles, start: [3 * TILE, (row - 3) * TILE] }] });
  if (oneButton) g.toggle('oneButton');
  g.practiceDamage = false;
  g.startPractice(data.levels.length);
  settle(g, 150);
  return g;
}
/** Turn the truck `deg` degrees (clockwise) about one of its wheels, at rest. */
function tipOnto(t, deg, front) {
  const i = front ? 4 : 2, cx = t.T[i], cy = t.T[i + 1], r = deg * Math.PI / 180;
  for (let k = 0; k < 10; k += 2) {
    const x = t.T[k] - cx, y = t.T[k + 1] - cy;
    t.T[k] = cx + x * Math.cos(r) - y * Math.sin(r); t.T[k + 1] = cy + x * Math.sin(r) + y * Math.cos(r);
  }
  t.P = t.T.slice(); t.probePrev = null;
}
test('one-button balance assist: tipped steeply with both wheels down, the button also presses the tilt back towards level', () => {
  const pick = ({ up, down, left, right }) => ({ up, down, left, right });
  // the keys the truck sees, tipped `deg` (clockwise) about a wheel, with the given wheels down
  const keysAt = (deg, rear, front, setup = (g) => { g.keys.one = true; }) => {
    const g = flatGame(), t = g.truck;
    tipOnto(t, deg, deg > 0);
    t.rearContact = rear; t.frontContact = front; g.airSteps = 0;
    setup(g);
    return pick(g.driveKeys());
  };
  const a = BALANCE_ANGLE, drive = { up: true, down: false, left: false, right: false };
  assert.deepEqual(keysAt(a + 5, true, true), { ...drive, left: true }, 'nose down: drive and tilt back');
  assert.deepEqual(keysAt(a + 5, false, true), drive, 'not nose down on the front wheel alone (tilting back would do nothing)');
  assert.deepEqual(keysAt(-(a + 5), true, true), { ...drive, right: true }, 'nose up (a steep climb): drive and tilt forwards');
  assert.deepEqual(keysAt(-(a + 5), true, false), drive, 'not in a wheelie (tilting forwards would do nothing)');
  assert.deepEqual(keysAt(a + 5, true, false), drive, 'not on the other wheel either');
  assert.deepEqual(keysAt(-(a + 5), false, true), drive, 'not on the other wheel either');
  assert.deepEqual(keysAt(a - 5, true, true), drive, 'not under the angle');
  assert.deepEqual(keysAt(-(a - 5), true, true), drive, 'not under the angle');
  assert.deepEqual(keysAt(a + 5, true, true, () => {}), { ...drive, up: false }, 'nothing without the button');
  assert.deepEqual(keysAt(a + 5, true, true, (g) => { g.oneButton = false; g.keys.up = true; }), drive, 'not with the standard controls');
  assert.deepEqual(keysAt(a + 5, true, true, (g) => { g.rules = { ...g.rules, classic: true }; g.keys.up = true; }), drive, 'not in Classic');

  // A wheelie on the back wheel alone plays out exactly as holding the gas and tilt-forwards on
  // the arrow keys: the tilt key can't act there, so the assist leaves it alone.
  const one = flatGame(), std = flatGame(false);
  tipOnto(one.truck, -55, false); tipOnto(std.truck, -55, false);
  one.keys.one = true; std.keys.up = true; std.keys.right = true;
  for (let i = 0; i < 20; i++) { one.step(); std.step(); }
  assert.deepEqual(one.truck.T, std.truck.T);
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

test('a taller view keeps the truck centred top to bottom, even down at the bottom of the level', () => {
  const g = new Game(data);
  g.startCampaign();
  g.viewH = 800;
  settle(g, 300);
  const [, fy] = g.focus;
  assert.ok(Math.abs(g.zoom - 1) < 0.01, `at rest the camera is close in (${g.zoom.toFixed(3)})`);
  assert.ok(fy - 400 > g.maxCamY, 'the truck is low enough that the old camera would have stopped at the level\'s bottom');
  assert.ok(Math.abs(g.camY - (fy - 400)) < 20, `camera at ${Math.round(g.camY)}, expected about ${Math.round(fy - 400)}`);
});

test('outside Classic the camera follows a big jump up and back down; Classic stays inside the level', () => {
  for (const classic of [false, true]) {
    const g = new Game(data);
    g.dynamicCamera = false; // the plain camera, so the truck should sit at the middle
    g.startCampaign(classic);
    settle(g);
    const t = g.truck;
    for (let i = 1; i < 10; i += 2) t.P[i] = t.T[i] + 16; // a huge jump, about 1000 px up
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      g.step();
      if (!classic) worst = Math.max(worst, Math.abs((t.T[1] - g.camY) - g.viewH / 2));
      else assert.ok(g.camY >= 0 && g.camY <= g.maxCamY, 'Classic keeps the camera inside the level');
    }
    if (!classic) assert.ok(worst < g.viewH * 0.3, `the truck stayed near the middle of the view (off by up to ${worst.toFixed(0)})`);
  }
});

test('wreck wheels keep rolling and turning after a crash', () => {
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
  assert.ok(wheels > 1, `a wheel is still rolling (${wheels.toFixed(2)} px/step)`);
  assert.ok(w.wheels.some((x) => Math.abs(x.spin) > 0.5), 'and turning as it rolls');
});

test('a wreck that starts with its cab in the ground is lifted clear and never sinks in', () => {
  // Places where the truck used to wreck with part of its body box already inside the ground,
  // which then fell through (the body "lost its hitbox").
  for (const [stage, frames, vy] of [[4, 250, 3], [4, 400, 0], [1, 400, 6], [5, 282, 0], [8, 1059, 4]]) {
    const g = new Game(data, { random: () => 0.5 });
    g.startPractice(stage);
    g.keys.up = true;
    for (let i = 0; i < frames; i++) { g.keys.right = g.truck.bodyRot < -25; g.keys.left = g.truck.bodyRot > 25; g.step(); }
    for (let i = 1; i < 10; i += 2) g.truck.P[i] -= vy;
    g.damage = 1000;
    g.step();
    const w = g.wreck;
    // How far a point is below the surface: sweep down to it from a little above.
    const depth = (i) => {
      const world = w.thin[i] ? w.thinWorld : w.wheelWorld, x = w.T[i * 2], y = w.T[i * 2 + 1];
      const h = world.collide(x, y - 80, x, y);
      return h ? y - h.y : 0;
    };
    for (let s = 0; s < 300; s++) {
      for (let i = 0; i < w.thin.length; i++) assert.ok(depth(i) < 3, `stage ${stage + 1}: point ${i} is ${depth(i).toFixed(1)} into the ground after ${s} steps`);
      w.step();
    }
  }
});

test('a body comes in its own colour; paint is chosen for the body in hand, and saved', () => {
  const store = memoryStore();
  const g = new Game(data, { store });
  assert.deepEqual(g.look, { body: 0, tyre: 0, hub: 0, paint: 0 }, 'a new player gets the standard yellow truck');
  g.cycleLook('body', 1);
  assert.equal(g.look.paint, 1, 'body 1 in its own colour');
  g.cycleLook('paint', -1); g.cycleLook('paint', -1);
  assert.equal(g.look.paint, 5, 'repainted (it wraps round)');
  const again = new Game(data, { store });
  assert.deepEqual(again.look, { body: 1, tyre: 0, hub: 0, paint: 5 }, 'the loadout is remembered');
  g.cycleLook('body', 1); g.cycleLook('body', -1);
  assert.equal(g.look.paint, 1, 'leaving the body and coming back: its own colour again');

  for (const bad of [[0, 1, 2, 3, 4, 5], 9, 'red', 1.5]) {
    const s = memoryStore();
    s.set('truckLook', { body: 3, tyre: 2, hub: 1, paint: bad });
    const h = new Game(data, { store: s });
    assert.equal(h.look.paint, 3, `ignored ${JSON.stringify(bad)}: the body's own colour`);
    assert.equal(h.look.body, 3);
  }
});

test('outside Classic the camera pulls back high in the air, keeps the truck in view, and closes in again', () => {
  const g = new Game(data);
  g.startCampaign();
  settle(g, 200);
  assert.ok(g.zoom < 1.02, `close in at rest (${g.zoom.toFixed(3)})`);
  const t = g.truck;
  for (let i = 1; i < 10; i += 2) t.P[i] = t.T[i] + 14; // thrown straight up, about 900 px high
  let most = 1;
  for (let i = 0; i < 250; i++) {
    g.step();
    most = Math.max(most, g.zoom);
    const x = (t.T[0] - g.camX) / g.zoom, y = (t.T[1] - g.camY) / g.zoom; // where it shows on screen
    assert.ok(x > 0 && x < 576 && y > 0 && y < g.viewH, `truck on screen at step ${i} (${x.toFixed(0)}, ${y.toFixed(0)})`);
  }
  assert.ok(most > 1.3, `pulled back for the height (${most.toFixed(2)})`);
  assert.ok(most <= CAMERA.maxZoom);
  settle(g, 800);
  assert.ok(g.zoom < 1.05, `closed in again once down (${g.zoom.toFixed(3)})`);

  const off = new Game(data);
  off.toggle('dynamicCamera');
  off.startCampaign();
  settle(off);
  for (let i = 1; i < 10; i += 2) off.truck.P[i] = off.truck.T[i] + 14;
  for (let i = 0; i < 250; i++) { off.step(); assert.equal(off.zoom, 1, 'switched off, the camera stays close in'); }

  const c = new Game(data);
  c.startCampaign(true);
  settle(c);
  const ct = c.truck;
  for (let i = 1; i < 10; i += 2) ct.P[i] = ct.T[i] + 11;
  for (let i = 0; i < 200; i++) { c.step(); assert.equal(c.zoom, 1, 'Classic keeps the original camera'); }
});

test('the camera pulls back a little when the truck is going fast', () => {
  const g = new Game(data);
  g.practiceDamage = false;
  g.startPractice(0);
  g.keys.up = true;
  let fastest = 0, zoomAtSpeed = 1;
  for (let i = 0; i < 1500; i++) {
    g.keys.right = g.truck.bodyRot < -25; g.keys.left = g.truck.bodyRot > 25;
    g.step();
    const t = g.truck, v = Math.hypot(t.T[0] - t.P[0], t.T[1] - t.P[1]);
    if (g.ground < CAMERA.heightFrom && v > fastest) { fastest = v; zoomAtSpeed = g.zoom; }
  }
  assert.ok(fastest > CAMERA.speedFrom + 2, `got going (${fastest.toFixed(1)} px/step)`);
  assert.ok(zoomAtSpeed > 1.03, `pulled back at speed (${zoomAtSpeed.toFixed(3)})`);
});

test('the dynamic camera is steady: it rarely changes direction and never lurches', () => {
  for (const stage of [0, 2, 5]) {
    const g = new Game(data);
    g.practiceDamage = false;
    g.startPractice(stage);
    g.viewH = 330;
    g.keys.up = true;
    let reversals = 0, prevDir = 0, prevZ = g.zoom, worstDz = 0, worstAccel = 0;
    let prevCam = [g.camX, g.camY], prevVel = [0, 0];
    for (let i = 0; i < 2000 && g.screen === 'playing'; i++) {
      g.keys.right = g.truck.bodyRot < -25; g.keys.left = g.truck.bodyRot > 25;
      g.step();
      const dz = g.zoom - prevZ;
      worstDz = Math.max(worstDz, Math.abs(dz));
      if (Math.abs(dz) > 1e-4) { const dir = Math.sign(dz); if (prevDir && dir !== prevDir) reversals++; prevDir = dir; }
      prevZ = g.zoom;
      const vel = [g.camX - prevCam[0], g.camY - prevCam[1]];
      if (i > 0) worstAccel = Math.max(worstAccel, Math.hypot(vel[0] - prevVel[0], vel[1] - prevVel[1]));
      prevVel = vel; prevCam = [g.camX, g.camY];
    }
    assert.ok(reversals <= 20, `stage ${stage + 1}: zoom changed direction ${reversals} times in 30 s`);
    assert.ok(worstDz <= CAMERA.maxRate + 1e-9, `stage ${stage + 1}: zoom moved ${worstDz.toFixed(4)} in one step`);
    assert.ok(worstAccel <= 3, `stage ${stage + 1}: camera speed changed by ${worstAccel.toFixed(1)} px/step in one step`);
  }
});

test('in a tall window the camera starts steady, and settles back after a resize part-way through', () => {
  for (const stage of [0, 3, 5]) {
    for (const resized of [false, true]) {
      const g = new Game(data);
      g.viewH = resized ? 448 : 1100; // the renderer keeps this up to date, even on the menus
      g.startPractice(stage);
      g.viewH = 1100;
      let prev = [g.camX, g.camY], fastest = 0;
      for (let i = 0; i < 280; i++) {
        g.step();
        fastest = Math.max(fastest, Math.hypot(g.camX - prev[0], g.camY - prev[1]));
        prev = [g.camX, g.camY];
      }
      // A resize moves the camera as the original did (up to a tile a step); otherwise it's calm.
      if (!resized) assert.ok(fastest < 30, `stage ${stage + 1}: the camera moved ${fastest.toFixed(0)} px in one step`);
      const y = (g.focus[1] - g.camY) / g.zoom;
      assert.ok(Math.abs(y - 550) < 80, `stage ${stage + 1}${resized ? ', resized' : ''}: the truck settled ${y.toFixed(0)} down a 1100 view`);
    }
  }
});

test('the pause screen names the run, and offers the controls switch outside Classic', async () => {
  const { runName, BUTTONS } = await import('../src/render.js');
  const actions = (g) => BUTTONS.paused.filter((b) => b.show(g)).map((b) => b.action);
  const g = new Game(data, { random: () => 0.4 });
  g.startCampaign();
  assert.equal(runName(g), 'Standard  ·  Stage One');
  assert.deepEqual(actions(g), ['resume', 'menu', 'pauseOptions']);
  g.startCampaign(true);
  assert.equal(runName(g), 'Classic  ·  Stage One');
  assert.deepEqual(actions(g), ['resume', 'menu', 'pauseOptions']);
  g.practiceDamage = false;
  g.startPractice(3);
  assert.equal(runName(g), 'Practice  ·  Stage Four  (no damage)');
  g.practiceClassic = true; g.practiceDamage = true;
  g.startPractice(8);
  assert.equal(runName(g), 'Practice  ·  Stage Nine  (Classic rules)');
  g.startEndless();
  assert.equal(runName(g), 'Endless  ·  0 m');
  assert.deepEqual(actions(g), ['resume', 'endRun', 'menu', 'pauseOptions']);
});

test('the tall menu layouts keep every button on the page, apart from the others, and big enough to tap', async () => {
  const { TALL_BUTTONS, TALL_W, TALL_H, BUTTONS, hitButton } = await import('../src/render.js');
  const g = new Game(data);
  for (const [screen, list] of Object.entries(TALL_BUTTONS)) {
    if (!list.length) continue;
    for (const kind of [null, (b) => b.show({ mode: 'endless', rules: {} })]) {
      // (Sandbox's list of choices is checked on its own, below: it opens over the rest.)
      const shown = list.filter((b) => !b.picker && (!b.show || !kind || kind(b)));
      shown.forEach((b, i) => {
        const { x, y, w, h } = b.rect;
        assert.ok(x >= 0 && y >= 0 && x + w <= TALL_W && y + h <= TALL_H[screen], `${screen} ${b.action} is on the page`);
        assert.ok(h >= 26, `${screen} ${b.action} is ${h} high`);
        for (const o of shown.slice(i + 1)) {
          if (b.show && o.show && b.show !== o.show) continue; // never shown together
          const apart = x + w <= o.rect.x || o.rect.x + o.rect.w <= x || y + h <= o.rect.y || o.rect.y + o.rect.h <= y;
          assert.ok(apart, `${screen}: ${b.action} and ${o.action} overlap`);
        }
      });
    }
  }
  // Sandbox's list of choices, for every setting: on the page, and apart.
  const { SANDBOX_ROWS } = await import('../src/sandbox.js');
  for (const tall of [true, false]) for (const screen of ['sandbox', 'sandboxTweaks']) {
    for (const row of SANDBOX_ROWS) {
      g.sandboxPick = row.key;
      const W = tall ? TALL_W : 576, H = tall ? TALL_H[screen] : 448;
      const picks = (tall ? TALL_BUTTONS : BUTTONS)[screen].filter((b) => b.picker && !b.noHover && b.show(g)).map((b) => b.rect(g));
      const n = row.key === 'course' ? g.sandboxCourses : row.choices.length;
      assert.equal(picks.length, n, `${row.key}: every choice listed`);
      picks.forEach((R, i) => {
        assert.ok(R.x >= 0 && R.y >= 0 && R.x + R.w <= W && R.y + R.h <= H, `${row.key} choice ${i} is on the page (${tall ? 'tall' : 'wide'})`);
        for (const O of picks.slice(i + 1)) assert.ok(R.x + R.w <= O.x || O.x + O.w <= R.x || R.y + R.h <= O.y || O.y + O.h <= R.y, `${row.key}: choices apart`);
      });
    }
  }
  g.sandboxPick = null;
  // Every action on the usual layout can be reached on the tall one too.
  for (const screen of Object.keys(BUTTONS)) {
    const actions = (l) => new Set(l.map((b) => b.action));
    assert.deepEqual(actions(TALL_BUTTONS[screen]), actions(BUTTONS[screen]), screen);
  }
  const practice = TALL_BUTTONS.modes.find((b) => b.action === 'practice').rect;
  assert.equal(hitButton('modes', practice.x + 5, practice.y + 5, g, true).action, 'practice');
});

test('the chassis bottoming out on a hard landing is no scrape outside Classic; Classic still counts it', () => {
  for (const classic of [false, true]) {
    const g = new Game(data);
    g.startCampaign(classic);
    settle(g, 150);
    const t = g.truck;
    for (let i = 1; i < 10; i += 2) t.P[i] = t.T[i] - 16; // slammed down onto flat ground
    let touched = 0, scraping = 0;
    for (let i = 0; i < 60; i++) { g.step(); if (t.probeHit) touched++; if (g.scraping) scraping++; }
    assert.ok(touched > 0, 'the body did touch the ground');
    if (classic) assert.ok(g.damage > 0, 'Classic: damage, as the original');
    else {
      assert.equal(g.damage, 0, 'no damage');
      assert.equal(scraping, 0, 'no scrape (so no sound and no bail)');
    }
  }
  // On its roof is still a scrape everywhere.
  const g = new Game(data);
  g.startCampaign();
  settle(g);
  turnOver(g.truck);
  settle(g, 60);
  assert.ok(g.damage > 0 && g.scraping, 'on its roof: damage and scraping');
});

test('the scrape still sounds after the finish line, without adding damage', () => {
  const g = new Game(data);
  g.startCampaign();
  settle(g);
  g.endTimer = 200; // the stage is over
  turnOver(g.truck);
  let scraping = 0;
  for (let i = 0; i < 60; i++) { g.step(); if (g.scraping) scraping++; }
  assert.ok(scraping > 10, `scraping (${scraping} steps)`);
  assert.equal(g.damage, 0);
});

test('the Flip button stays a few seconds after the truck stops looking stuck', () => {
  const g = new Game(data, { random: () => 0.3 });
  g.startEndless();
  settle(g);
  turnOver(g.truck);
  let n = 0;
  while (!g.canUpright && n++ < STUCK_STEPS * 3) g.step();
  assert.ok(g.canUpright);
  // Set it back on its wheels by hand (not with the button): it no longer looks stuck.
  g.startEndless();
  settle(g, 60);
  g.canUpright = true; g.uprightLinger = UPRIGHT_LINGER; // as it was a moment ago
  let shown = 0;
  while (g.canUpright && shown < UPRIGHT_LINGER * 2) { g.step(); shown++; }
  assert.ok(shown >= UPRIGHT_LINGER - 1 && shown <= UPRIGHT_LINGER + 1, `stayed ${shown} steps`);
});

test('a flip upright is not a trick, and tricks count again a moment after it lands', () => {
  const g = new Game(data, { random: () => 0.3 });
  g.startEndless();
  settle(g);
  turnOver(g.truck);
  while (!g.canUpright) g.step();
  const score = g.score;
  assert.ok(g.upright());
  assert.equal(g.tricks.done, 0, 'the trick tracker starts afresh');
  let wasCooling = false, shown = false;
  for (let i = 0; i < 400; i++) { g.step(); if (g.trickCooldown > 0) wasCooling = true; if (g.tricks.show) shown = true; }
  assert.ok(wasCooling);
  assert.equal(g.trickCooldown, 0, 'the cooldown ends once the truck is back on its wheels');
  const done = g.tricks.done;
  assert.equal(done, 0, 'no trick sounds from the flip');
  assert.equal(shown, false, 'no trick names from the flip');
  assert.equal(g.tricks.chain.length, 0);
  assert.ok(g.score - score < 200, `no trick points (score went up ${g.score - score}, from distance only)`);
  // Tricks are watched for again: a big drop scores Big Air.
  const t = g.truck;
  for (let i = 1; i < 10; i += 2) t.P[i] = t.T[i] + 9;
  for (let i = 0; i < 300; i++) g.step();
  assert.ok(g.tricks.done > done, 'tricks count again');
});

test('the dynamic camera keeps the truck where the original camera would on screen', (t) => {
  // (Leaving out the look back while reversing, which the driver here does when it rolls back off
  // a hill; that has its own test.)
  const lookBack = CAMERA.lookBack;
  CAMERA.lookBack = 0;
  t.after(() => { CAMERA.lookBack = lookBack; });
  for (const stage of [0, 1, 4, 5]) {
    const run = (dynamic) => {
      const g = new Game(data);
      g.practiceDamage = false; g.dynamicCamera = dynamic;
      g.startPractice(stage);
      g.keys.up = true;
      const pos = [];
      for (let i = 0; i < 1500 && g.screen === 'playing'; i++) {
        g.keys.right = g.truck.bodyRot < -25; g.keys.left = g.truck.bodyRot > 25;
        g.step();
        const [fx, fy] = g.focus;
        pos.push([(fx - g.camX) / g.zoom, (fy - g.camY) / g.zoom, g.zoom]); // where it shows on screen
      }
      return pos;
    };
    const plain = run(false), dyn = run(true);
    let worst = 0, zoomed = 1;
    for (let i = 0; i < Math.min(plain.length, dyn.length); i++) {
      worst = Math.max(worst, Math.abs(plain[i][0] - dyn[i][0]), Math.abs(plain[i][1] - dyn[i][1]));
      zoomed = Math.max(zoomed, dyn[i][2]);
    }
    assert.ok(zoomed > 1.1, `stage ${stage + 1}: the dynamic camera did pull back (${zoomed.toFixed(2)})`);
    assert.ok(worst < 40, `stage ${stage + 1}: the truck showed up to ${worst.toFixed(0)} away from where the original camera puts it`);
  }
});

test('Endless scrolling the world never makes the camera jump', () => {
  const g = new Game(data, { random: () => 0.37 });
  g.practiceDamage = false;
  g.startEndless();
  g.keys.up = true;
  let shifts = 0, worst = 0;
  for (let i = 0; i < 6000 && g.screen === 'playing'; i++) {
    g.keys.right = g.truck.bodyRot < -25; g.keys.left = g.truck.bodyRot > 25;
    const before = g.shiftCount, [fx0] = g.focus, x0 = (fx0 - g.camX) / g.zoom;
    g.step();
    const [fx] = g.focus, x = (fx - g.camX) / g.zoom;
    if (g.shiftCount !== before) shifts++;
    worst = Math.max(worst, Math.abs(x - x0));
  }
  assert.ok(shifts > 0, 'the world scrolled');
  assert.ok(worst < 25, `the truck moved up to ${worst.toFixed(0)} across the screen in one step`);
});

test('the speedometer reads the truck speed in km/h, from when it first lands', () => {
  assert.ok(Math.abs(KMH_PER_PX_STEP - 9.84375) < 1e-9, '1 px/step is about 9.8 km/h');
  const g = new Game(data);
  g.startCampaign();
  g.keys.up = true;
  let max = 0, landedAt = -1;
  for (let i = 0; i < 400; i++) {
    g.step();
    const t = g.truck, raw = Math.hypot(t.T[0] - t.P[0], t.T[1] - t.P[1]) * KMH_PER_PX_STEP;
    if (!g.landed) { assert.equal(g.speedKmh, 0, `reads 0 while the truck is dropped in (falling at ${raw.toFixed(0)})`); continue; }
    if (landedAt < 0) landedAt = i;
    if (i > landedAt + 30) assert.ok(Math.abs(g.speedKmh - raw) < 25, `reads ${g.speedKmh.toFixed(0)}, truck doing ${raw.toFixed(0)}`);
    max = Math.max(max, g.speedKmh);
  }
  assert.ok(max > 40 && max < 200, `a sensible top speed (${max.toFixed(0)} km/h)`);
  assert.ok(landedAt > 0, 'the truck landed');
});

test('reversing, the dynamic camera eases back a little to show where the truck is going', () => {
  const frameX = (dynamic, classic = false) => {
    const g = new Game(data);
    g.dynamicCamera = dynamic;
    g.startCampaign(classic);
    g.keys.up = true; // away from the start, where the camera can't go any further left
    settle(g, 250);
    g.keys.up = false;
    settle(g, 100);
    const x0 = (g.truck.T[0] - g.camX) / g.zoom;
    g.keys.down = true;
    for (let i = 0; i < 200; i++) g.step();
    assert.ok(g.truck.P[0] > g.truck.T[0], 'it is reversing');
    return { before: x0, after: (g.truck.T[0] - g.camX) / g.zoom, back: g.back };
  };
  const dyn = frameX(true);
  assert.ok(dyn.back > 0.5 && dyn.back <= 1, `eased back (${dyn.back.toFixed(2)})`);
  assert.ok(dyn.after > dyn.before + 40 && dyn.after < dyn.before + CAMERA.lookBack + 30,
    `the truck sits further right on screen, but not much (${dyn.before.toFixed(0)} -> ${dyn.after.toFixed(0)})`);
  for (const [name, r] of [['camera off', frameX(false)], ['Classic', frameX(true, true)]]) {
    assert.equal(r.back, 0, `${name}: no look back`);
  }
});

test('the view never shows less than Classic, and a wide one centres the usual frame', () => {
  const g = new Game(data);
  g.viewW = 1000; g.viewH = 448;
  g.dynamicCamera = false;
  g.startCampaign();
  g.keys.up = true; // away from the start, where the camera can't go any further left
  settle(g, 250);
  g.keys.up = false;
  settle(g, 100);
  const x = g.truck.T[0] - g.camX;
  assert.ok(Math.abs(x - (150 + (1000 - 576) / 2)) < 30, `the truck sits ${x.toFixed(0)} from the left of a 1000-wide view`);
  const c = new Game(data);
  c.viewW = 1000; c.viewH = 900;
  c.startCampaign(true);
  assert.equal(c.viewW, 576); assert.equal(c.viewH, 448);
});

test('Practice offers the stunt tracks after the nine stages; they have no finish and their scores are not bests', () => {
  const packed = JSON.parse(readFileSync(new URL('../assets/stunts.json', import.meta.url)));
  const stunts = packed.map(unpackLevel);
  assert.deepEqual(stunts.map((s) => s.name), ['Mega Ramp', 'Kicker Run', 'Halfpipe']);
  const withStunts = { ...data, stunts };
  for (const [i, s] of stunts.entries()) {
    assert.ok(s.width > 30 && s.tiles.length === s.height && s.tiles.every((row) => row.length === s.width), `${s.name} is a well-formed track`);
    for (let x = 0; x < s.width; x++) assert.equal(s.tiles[s.height - 1][x], 1, `${s.name}: column ${x} ends in solid dirt`);
    const store = memoryStore();
    const g = new Game(withStunts, { store });
    g.practiceDamage = false; // (this is about the tracks, not driving them well)
    g.startPractice(9 + i);
    assert.equal(g.stageName(9 + i), s.name);
    assert.equal(g.bonus, 0, 'no time bonus on a stunt track');
    g.keys.up = true;
    for (let steps = 0; steps < 3000 && g.screen === 'playing'; steps++) {
      g.keys.right = g.truck.bodyRot < -20; g.keys.left = g.truck.bodyRot > 30;
      g.step();
    }
    assert.ok(g.truck.T[0] > 0 && g.truck.T[0] < s.width * TILE && g.truck.T[1] < s.height * TILE, `${s.name}: the truck stays on the track`);
    assert.equal(store.get('bestPlay'), null, 'a stunt score is not a best');
    assert.equal(g.hasNextPractice, i < stunts.length - 1);
    // Right at the end of the track (or a long way down Kicker Run) there's still no finish.
    g.rules = { ...g.rules, damage: false };
    g.truck.reset(s.width * TILE - 3 * TILE, 0); g.endTimer = 0;
    for (let steps = 0; steps < 300; steps++) g.step();
    assert.equal(g.screen, 'playing', `${s.name} has no finish`);
  }
  const g = new Game(withStunts);
  g.startPractice(8);
  assert.ok(g.hasNextPractice, 'Stage Nine leads on to the first stunt track');
  g.nextPractice();
  assert.equal(g.levelData, stunts[0]);
});

/** Drive a stunt track with full gas, nose down on the ground and level in the air. */
function driveStunt(g, steps, each = () => {}) {
  const t = g.truck;
  g.keys.up = true;
  for (let i = 0; i < steps && g.screen === 'playing'; i++) {
    if (g.airSteps > 3) { g.keys.left = t.bodyRot > 8; g.keys.right = t.bodyRot < -8; } else { g.keys.right = t.bodyRot < -15; g.keys.left = t.bodyRot > 35; }
    g.step();
    each(i);
  }
}

const stuntGame = (name, damage = false) => {
  const stunts = JSON.parse(readFileSync(new URL('../assets/stunts.json', import.meta.url))).map(unpackLevel);
  const g = new Game({ ...data, stunts });
  g.practiceDamage = damage;
  g.startPractice(9 + stunts.findIndex((s) => s.name === name));
  return g;
};

test('Mega Ramp: a long accelerator and launch ramp for huge speed and air time', () => {
  const g = stuntGame('Mega Ramp', true);
  // The longest flight: how long, and how high above where it took off.
  let top = 0, longest = 0, high = 0, takeoff = 0, peak = 0;
  driveStunt(g, 15000, () => {
    top = Math.max(top, g.speedKmh);
    const y = g.truck.T[1];
    if (g.airSteps === 1) { takeoff = y; peak = y; }
    peak = Math.min(peak, y);
    if (g.airSteps > longest) { longest = g.airSteps; high = takeoff - peak; }
  });
  assert.equal(g.screen, 'playing', 'the truck survives the jump');
  assert.ok(top > 400, `top speed ${top.toFixed(0)} km/h`);
  assert.ok(longest / 70 > 10, `${(longest / 70).toFixed(1)} s in the air`);
  assert.ok(high / TILE > 100, `flies ${(high / TILE).toFixed(0)} rows above the lip`);
  const W = g.levelData.width * TILE;
  assert.ok(g.truck.T[0] > W / 2 && g.truck.T[0] < W && g.truck.T[1] > 0 && g.truck.T[1] < g.levelData.height * TILE,
    'the quarter pipe at the far end keeps the truck in');
});

test('Kicker Run goes downhill for ever: the world jumps back a repeat and nothing on screen moves', () => {
  const g = stuntGame('Kicker Run');
  const L = g.levelData.loop;
  assert.ok(L && L.period > 0 && L.drop > 0);
  // the track really repeats: each column matches the one a repeat on, a repeat's drop lower
  const T = g.levelData.tiles, H = g.levelData.height;
  for (let x = L.from; x + L.period < g.levelData.width; x++) {
    for (let r = 0; r + L.drop < H; r++) assert.equal(T[r + L.drop][x + L.period], T[r][x], `column ${x}, row ${r}`);
  }
  // On screen, the truck moves on at a jump back just as it did the step before.
  let shifts = 0, worst = 0, travelled = 0;
  let last = g.shiftCount, prev = [g.truck.T[0] - g.camX, g.truck.T[1] - g.camY], move = [0, 0], px = g.truck.T[0];
  driveStunt(g, 9000, () => {
    const now = [g.truck.T[0] - g.camX, g.truck.T[1] - g.camY], m = [now[0] - prev[0], now[1] - prev[1]];
    if (g.shiftCount !== last) {
      shifts++; last = g.shiftCount; travelled += L.period * TILE;
      worst = Math.max(worst, Math.hypot(m[0] - move[0], m[1] - move[1]));
    }
    prev = now; move = m;
  });
  travelled += g.truck.T[0] - px;
  assert.ok(shifts >= 3, `the world jumped back ${shifts} times`);
  assert.ok(travelled > 4 * L.period * TILE, `went ${Math.round(travelled / TILE)} columns`);
  assert.ok(worst < 8, `at a jump back the truck's motion on screen changed by up to ${worst.toFixed(1)}`);
  assert.ok(g.truck.T[1] < g.levelData.height * TILE && g.truck.T[0] < g.levelData.width * TILE, 'still inside the track');
});

test('Halfpipe: drop in and ride it back and forth between its ledges', () => {
  const g = stuntGame('Halfpipe');
  const W = g.levelData.width * TILE;
  let minX = Infinity, maxX = -Infinity;
  driveStunt(g, 900, () => { minX = Math.min(minX, g.truck.T[0]); maxX = Math.max(maxX, g.truck.T[0]); });
  g.keys.up = g.keys.left = g.keys.right = false;
  for (let i = 0; i < 1500; i++) g.step(); // let it roll back and forth
  assert.ok(maxX > W * 0.6, 'rode up the far side');
  assert.ok(g.truck.T[0] > 0 && g.truck.T[0] < W, 'stays in the halfpipe');
  assert.equal(g.screen, 'playing');
});

test('one-button controls: the up arrow is the button, and the other arrows do nothing', () => {
  const g = new Game(data);
  g.toggle('oneButton');
  g.startCampaign();
  settle(g);
  const pick = (k) => (({ up, down, left, right }) => ({ up, down, left, right }))(k);
  g.keys.up = true;
  assert.deepEqual(pick(g.driveKeys()), { up: true, down: false, left: false, right: false }, 'up drives on the ground, like Space');
  g.keys = { ...g.keys, up: false, down: true, left: true, right: true };
  assert.deepEqual(pick(g.driveKeys()), { up: false, down: false, left: false, right: false }, 'down, left and right do nothing');
  g.airSteps = 20;
  g.keys = { ...g.keys, up: true };
  assert.deepEqual(pick(g.driveKeys()), { up: false, down: false, left: true, right: false }, 'up tilts back in the air');
});

test('every screen\'s buttons can be shown for every kind of run', async () => {
  const { BUTTONS, TALL_BUTTONS, reachedLine } = await import('../src/render.js');
  const g = new Game(data);
  const runs = [() => g.startCampaign(), () => g.startCampaign(true), () => g.startEndless(), () => g.startPractice(2)];
  for (const start of runs) {
    start();
    g.wrecked = true;
    for (const layout of [BUTTONS, TALL_BUTTONS]) {
      for (const [screen, list] of Object.entries(layout)) {
        for (const b of list) {
          if (b.show) b.show(g);
          if (typeof b.label === 'function') assert.equal(typeof b.label(g, { touchMode: true }), 'string', `${screen} ${b.action}`);
        }
      }
    }
    assert.equal(typeof reachedLine(g), 'string');
  }
  g.startCampaign(); g.level = 2; g.wrecked = true;
  assert.equal(reachedLine(g), 'Got to stage 3 of 9');
});

