// Play, Classic, Practice options, the ragdoll wreck, one-button controls and flip upright.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, TILE, STUCK_STEPS, CAMERA } from '../src/game.js';
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
  const want = Math.min(fy - 400 * g.zoom, g.maxCamY); // centred, unless that would show below the level
  assert.ok(Math.abs(g.zoom - 1) < 0.01, `at rest the camera is close in (${g.zoom.toFixed(3)})`);
  assert.equal(g.maxCamY, data.levels[0].height * TILE - 800 * g.zoom);
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

test('each body keeps its own paint, starting in its own colour, and the choice is saved', () => {
  const store = memoryStore();
  const g = new Game(data, { store });
  assert.deepEqual(g.look.paint, [0, 1, 2, 3, 4, 5], 'every body starts in its own colour');
  g.cycleLook('body', 1);                 // body 1
  g.cycleLook('paint', -1);               // body 1 now wears body 0's colour
  g.cycleLook('paint', -1);               // ...and then body 5's (it wraps round)
  assert.equal(g.look.paint[1], 5);
  g.cycleLook('body', 1);                 // body 2 is still in its own colour
  assert.equal(g.look.paint[g.look.body], 2);
  const again = new Game(data, { store });
  assert.deepEqual(again.look.paint, [0, 5, 2, 3, 4, 5]);
  assert.equal(again.look.body, 2);

  for (const bad of [{ paint: [0, 1, 2] }, { paint: [0, 1, 2, 3, 4, 9] }, { paint: 'red' }, { paint: [0, 1, 2, 3, 4, 1.5] }]) {
    const s = memoryStore();
    s.set('truckLook', { body: 1, tyre: 2, hub: 3, ...bad });
    const h = new Game(data, { store: s });
    assert.deepEqual(h.look.paint, [0, 1, 2, 3, 4, 5], `ignored ${JSON.stringify(bad.paint)}`);
    assert.equal(h.look.body, 1);
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

test('in a tall window the camera starts steady, and a resize part-way through causes no runaway', () => {
  for (const stage of [0, 3, 5]) {
    for (const resized of [false, true]) {
      const g = new Game(data);
      g.viewH = resized ? 448 : 1100; // the renderer keeps this up to date, even on the menus
      g.startPractice(stage);
      g.viewH = 1100;
      let prev = [g.camX, g.camY], fastest = 0;
      for (let i = 0; i < 280; i++) {
        g.step();
        // A resize can push the camera off the level's edge for a single step; after that it must be calm.
        if (!resized || i > 0) fastest = Math.max(fastest, Math.hypot(g.camX - prev[0], g.camY - prev[1]));
        prev = [g.camX, g.camY];
      }
      assert.ok(fastest < 30, `stage ${stage + 1}${resized ? ', resized' : ''}: the camera moved ${fastest.toFixed(0)} px in one step`);
    }
  }
});

test('the pause screen names the run, and offers the controls switch outside Classic', async () => {
  const { runName, BUTTONS } = await import('../src/render.js');
  const actions = (g) => BUTTONS.paused.filter((b) => b.show(g)).map((b) => b.action);
  const g = new Game(data, { random: () => 0.4 });
  g.startCampaign();
  assert.equal(runName(g), 'Play  ·  Stage One');
  assert.deepEqual(actions(g), ['resume', 'menu', 'sound', 'oneButton']);
  g.startCampaign(true);
  assert.equal(runName(g), 'Classic  ·  Stage One');
  assert.deepEqual(actions(g), ['resume', 'menu', 'sound'], 'Classic keeps the original controls');
  g.practiceDamage = false;
  g.startPractice(3);
  assert.equal(runName(g), 'Practice  ·  Stage Four  (no damage)');
  g.practiceClassic = true; g.practiceDamage = true;
  g.startPractice(8);
  assert.equal(runName(g), 'Practice  ·  Stage Nine  (Classic rules)');
  g.startEndless();
  assert.equal(runName(g), 'Endless  ·  0 m');
  assert.deepEqual(actions(g), ['resume', 'endRun', 'menu', 'sound', 'oneButton']);
});

test('the tall menu layouts keep every button on the page, apart from the others, and big enough to tap', async () => {
  const { TALL_BUTTONS, TALL_W, TALL_H, BUTTONS, hitButton } = await import('../src/render.js');
  const g = new Game(data);
  for (const [screen, list] of Object.entries(TALL_BUTTONS)) {
    if (!list.length) continue;
    for (const kind of [null, (b) => b.show({ mode: 'endless', rules: {} })]) {
      const shown = list.filter((b) => !b.show || !kind || kind(b));
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
  // Every action on the usual layout can be reached on the tall one too.
  for (const screen of Object.keys(BUTTONS)) {
    const actions = (l) => new Set(l.map((b) => b.action));
    assert.deepEqual(actions(TALL_BUTTONS[screen]), actions(BUTTONS[screen]), screen);
  }
  const practice = TALL_BUTTONS.title.find((b) => b.action === 'practice').rect;
  assert.equal(hitButton('title', practice.x + 5, practice.y + 5, g, true).action, 'practice');
});
