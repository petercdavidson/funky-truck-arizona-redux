// wreck-lab-sim.mjs — the Wreck Lab's scenes, run without the game (no DOM). The lab page
// (tools/wreck-lab.html) draws them; run this file with Node for a tally of how the wheels end up:
//
//   node tools/wreck-lab-sim.mjs [runs per scene and body, default 40]
//
// A scene puts a truck somewhere real on a stage, at an angle and speed, and runs the truck's own
// physics (as Game.stepTruck does) until its cab has scraped the ground for `scrape` steps, which
// is how damage wrecks it in a run; then the Wreck takes over. `esc` wrecks it at once instead.

import { Truck, CollisionWorld, emptyKeys } from '../src/game.js';
import { Wreck, WRECK, nearestOnPolygon } from '../src/wreck.js';
import { BODY_SHAPES } from '../src/wreck-shapes.js';

const TILE = 64;
export const BODIES = BODY_SHAPES.length;

/**
 * stage, col: where (a stage index and a tile column; the truck's centre is put mid-column).
 * angle: degrees clockwise (180 is upside down). lift: px between its lowest point and the ground.
 * vx, vy: px a step. spin: degrees a step (clockwise). wheelSpin: the wheels' spin, degrees a step.
 * gas: holds the gas. scrape: steps of cab scraping before it's wrecked. esc: wrecked at once.
 */
export const SCENES = [
  { id: 'roof-drop', name: 'Drops onto its roof', stage: 4, col: 148, angle: 180, lift: 25, vx: 0, scrape: 40 },
  { id: 'roof-flop', name: 'Topples onto its roof', stage: 4, col: 148, angle: 125, lift: 4, vx: 0.5, spin: 2.2, scrape: 30 },
  { id: 'roof-slide', name: 'Slides on its roof', stage: 4, col: 145, angle: 180, lift: 1, vx: 4, scrape: 25 },
  { id: 'roof-gas', name: 'On its roof, wheels spinning', stage: 4, col: 148, angle: 180, lift: 2, vx: 0, wheelSpin: 18, gas: true, scrape: 30 },
  { id: 'backflip', name: 'Over-rotated backflip', stage: 4, col: 146, angle: -110, lift: 45, vx: 3, vy: 0.5, spin: -5, wheelSpin: 10, scrape: 15 },
  { id: 'frontflip', name: 'Nose-first landing', stage: 4, col: 146, angle: 70, lift: 45, vx: 3.5, vy: 1, spin: 4, wheelSpin: 12, scrape: 15 },
  { id: 'side', name: 'On its side', stage: 4, col: 148, angle: 90, lift: 3, vx: 0, scrape: 30 },
  { id: 'roof-downhill', name: 'On its roof, downhill', stage: 5, col: 16, angle: 180, lift: 3, vx: 1, scrape: 20 },
  { id: 'speed', name: 'At speed (Esc)', stage: 4, col: 144, angle: 0, lift: 0, vx: 8, wheelSpin: 18, esc: true },
];

/** The scenes where the truck ends up on its roof: the ones whose wheels shouldn't stay on top. */
export const ROOF = new Set(['roof-drop', 'roof-flop', 'roof-slide', 'roof-gas', 'backflip', 'roof-downhill']);

const worlds = new Map();
/** The wheel and thin collision worlds of a stage (made once). */
export function worldsFor(data, stage) {
  if (!worlds.has(stage)) {
    const L = data.levels[stage];
    worlds.set(stage, {
      level: L,
      wheel: new CollisionWorld(L, data.collision, 22.5, { ceiling: false }),
      thin: new CollisionWorld(L, data.collision, 3, { ceiling: false }),
    });
  }
  return worlds.get(stage);
}

/** A small seeded random number generator (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The scene with small random differences (seed 0: the scene as written). */
export function varied(scene, seed) {
  if (!seed) return { ...scene };
  const r = rng(seed), j = (a) => (r() * 2 - 1) * a;
  return {
    ...scene,
    angle: scene.angle + j(14),
    lift: Math.max(0, (scene.lift || 0) + j(Math.max(3, (scene.lift || 0) * 0.5))),
    vx: (scene.vx || 0) + j(1.2),
    spin: (scene.spin || 0) + j(1.2),
    wheelSpin: (scene.wheelSpin || 0) * (0.5 + r()),
    scrape: scene.esc ? 0 : 1 + Math.floor(r() * 80),
  };
}

/**
 * One run of a scene with one body. step() moves it on a step; `wreck` is set once it's wrecked;
 * `done` once the wreck has settled (or a long time has passed).
 */
export class LabRun {
  constructor(data, scene, body, seed = 0) {
    this.scene = varied(scene, seed);
    this.body = body;
    this.seed = seed;
    const s = this.scene;
    this.w = worldsFor(data, s.stage);
    const t = this.truck = new Truck();
    const x = (s.col + 0.5) * TILE;
    t.reset(x, 0);
    // turn it about its centre
    const T = t.T, a = (s.angle || 0) * Math.PI / 180, c = Math.cos(a), si = Math.sin(a);
    for (let i = 2; i < 10; i += 2) {
      const dx = T[i] - T[0], dy = T[i + 1] - T[1];
      T[i] = T[0] + dx * c - dy * si; T[i + 1] = T[1] + dx * si + dy * c;
    }
    // its lowest point: the wheels' bottoms, the roof probe, the body's outline
    const shape = BODY_SHAPES[body];
    const ang = Math.atan2(T[9] - T[7], T[8] - T[6]), bc = Math.cos(ang), bs = Math.sin(ang);
    const pts = [[T[2], T[3] + 22.5], [T[4], T[5] + 22.5], [T[0] + 10 * c + 30 * si, T[1] + 10 * si - 30 * c],
      ...shape.map(([px, py]) => [T[6] + px * bc - py * bs, T[7] + px * bs + py * bc])];
    // (the ground under each of them, so it starts clear of a slope)
    const dy = Math.min(...pts.map(([px, py]) => this.groundY(px) - py)) - (s.lift || 0);
    for (let i = 1; i < 10; i += 2) T[i] += dy;
    // speed and spin: where each point was a step ago
    const w0 = -(s.spin || 0) * Math.PI / 180, wc = Math.cos(w0), ws = Math.sin(w0);
    for (let i = 0; i < 10; i += 2) {
      const dx = T[i] - T[0], dyy = T[i + 1] - T[1];
      t.P[i] = T[0] + dx * wc - dyy * ws - (s.vx || 0);
      t.P[i + 1] = T[1] + dx * ws + dyy * wc - (s.vy || 0);
    }
    t.rearSpin = t.frontSpin = s.wheelSpin || 0;
    t.updateBodyRot();
    this.keys = { ...emptyKeys(), up: !!s.gas };
    this.scraped = 0;
    this.steps = 0;
    this.wreck = null;
    this.done = false;
    if (s.esc) this.wreckNow();
  }

  /** The ground's height below x (the thin world's surface). */
  groundY(x) {
    // (in short steps: a long sweep onto a slope is pushed out along the slope's whole line)
    for (let y = 0; y < this.w.level.height * TILE; y += 8) {
      const h = this.w.thin.collide(x, y, x, y + 8);
      if (h) return h.y;
    }
    return this.w.level.height * TILE;
  }

  wreckNow() {
    this.wreck = new Wreck(this.truck, this.w.wheel, this.w.thin, this.body);
    this.wreckedAt = this.steps;
  }

  step() {
    this.steps++;
    if (this.wreck) {
      this.wreck.step();
      if (this.wreck.asleep || this.wreck.steps > 70 * 10) this.done = true;
      return;
    }
    // Game.stepTruck, without the tricks and scoring
    const t = this.truck, w = this.w.wheel;
    t.integrate();
    t.rearContact = false; t.frontContact = false;
    for (let i = 0; i < 2; i++) { t.constrain(); t.collideWheels(w); }
    t.drive(this.keys);
    t.spinWheels();
    t.tilt(this.keys);
    const type = t.probeBody(w);
    t.updateBodyRot();
    // (Game.underside: ground under the body is the chassis bottoming out, not the cab scraping)
    let under = false;
    if (t.probeHit) {
      const r = t.bodyRot * Math.PI / 180, h = t.probeHit;
      under = h.nx * Math.sin(r) - h.ny * Math.cos(r) > 0.42;
    }
    if (type !== null && type !== 1 && !under) this.scraped++;
    if (this.scraped >= (this.scene.scrape || 1)) this.wreckNow();
    else if (this.steps > 70 * 6) { this.done = true; this.missed = true; } // landed on its wheels: never wrecked
  }

  /** Which wheels are resting on top of the body: [rear, front] booleans. */
  wheelsOnTop() {
    const W = this.wreck, T = W.T, poly = W.outline(), R = WRECK.wheelRadius;
    return W.wheels.map(({ p }) => {
      const x = T[p * 2], y = T[p * 2 + 1], h = nearestOnPolygon(poly, x, y);
      const onGround = !!W.wheelWorld.collide(x, y - 1, x, y + 5);
      // (resting on the body from above, not leaning on its side)
      return !onGround && (h.inside || (h.d < R + 5 && (h.y - y) / (h.d || 1) > 0.5));
    });
  }

  /** Run to the end (for the tally). */
  finish() {
    while (!this.done) this.step();
    return this;
  }
}

/** For each scene and body, how many of `runs` varied runs left both, one or no wheels on top. */
export function tally(data, runs = 40, scenes = SCENES) {
  const rows = [];
  for (const scene of scenes) {
    for (let body = 0; body < BODIES; body++) {
      const n = [0, 0, 0];
      let missed = 0, settle = 0;
      for (let seed = 1; seed <= runs; seed++) {
        const r = new LabRun(data, scene, body, seed).finish();
        if (r.missed) { missed++; continue; }
        n[r.wheelsOnTop().filter(Boolean).length]++;
        settle += r.wreck.steps;
      }
      rows.push({ scene: scene.id, body, none: n[0], one: n[1], both: n[2], missed, settle: settle / Math.max(1, runs - missed) / 70 });
    }
  }
  return rows;
}

// Run directly: print the tally.
if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
  const runs = Number(process.argv[2]) || 40;
  const only = process.argv[3];
  const rows = tally(data, runs, only ? SCENES.filter((s) => s.id === only) : SCENES);
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.scene)) by.set(r.scene, []);
    by.get(r.scene).push(r);
  }
  console.log(`${runs} varied runs per scene and body. Wheels left on top of the body: both / one / none (missed = never wrecked)`);
  for (const [scene, list] of by) {
    const cells = list.map((r) => `${r.both}/${r.one}/${r.none}${r.missed ? ` m${r.missed}` : ''}`.padEnd(13)).join('');
    const both = list.reduce((s, r) => s + r.both, 0), tot = list.reduce((s, r) => s + r.both + r.one + r.none, 0);
    const settle = list.reduce((s, r) => s + r.settle, 0) / list.length;
    console.log(`${(ROOF.has(scene) ? '* ' : '  ') + scene.padEnd(15)} ${cells} both ${Math.round(both / Math.max(1, tot) * 100)}%  settles ${settle.toFixed(1)}s`);
  }
}
