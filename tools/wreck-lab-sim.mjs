// wreck-lab-sim.mjs — the Wreck Lab's crashes, run without the game (no DOM). The crashes are real
// ones, found by bots driving the nine stages (tools/make-wreck-crashes.mjs, which writes
// tools/wreck-crashes.json). The lab page (tools/wreck-lab.html) draws them; run this file with Node
// for a tally of how the wheels end up:
//
//   node tools/wreck-lab-sim.mjs
//
// A run replays the last two seconds of driving before the crash (recorded poses), then starts the
// Wreck from the truck exactly as it was when it was wrecked, with whichever body, and runs it live:
// so a change to src/wreck.js shows up at once, with no need to find the crashes again.

import { Truck, CollisionWorld } from '../src/game.js';
import { Wreck, WRECK, nearestOnPolygon } from '../src/wreck.js';
import { BODY_SHAPES } from '../src/wreck-shapes.js';

export const BODIES = BODY_SHAPES.length;
const TILE = 64;

const worlds = new Map();
/** The wheel and thin collision worlds of a stage (made once), as Practice has them (no ceiling). */
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

/**
 * The lead-up's poses, packed small for the JSON: each number in tenths, as the change from the
 * pose before (the first pose as is). A pose is [T (10 numbers), rear wheel turn, front wheel turn].
 */
export function packPoses(poses) {
  const out = [];
  let prev = new Array(12).fill(0);
  for (const p of poses) {
    const q = p.map((v) => Math.round(v * 10));
    out.push(...q.map((v, i) => v - prev[i]));
    prev = q;
  }
  return out;
}

export function unpackPoses(packed) {
  const poses = [];
  let prev = new Array(12).fill(0);
  for (let i = 0; i < packed.length; i += 12) {
    const q = prev.map((v, k) => v + packed[i + k]);
    poses.push(q.map((v) => v / 10));
    prev = q;
  }
  return poses;
}

/**
 * One crash with one body. step() moves it on; `wreck` is set once it's wrecked; `done` once
 * `after` seconds have passed since (or, with no `after`, once the wreck has settled). `lead` is
 * how many seconds of driving before the crash to replay first (up to the five recorded).
 */
export class CrashRun {
  constructor(data, crash, body, { lead = 2, after = null } = {}) {
    this.crash = crash;
    this.body = body;
    this.after = after;
    this.w = worldsFor(data, crash.stage);
    // (ending with the truck as it was at the wreck itself)
    const k = crash.truck;
    this.poses = crash.unpacked ||= [...unpackPoses(crash.poses), [...k.T, k.rearWheelRot, k.frontWheelRot]];
    this.pose = Math.max(0, this.poses.length - Math.round(lead * 70));
    this.wreck = null;
    this.done = false;
    if (this.pose >= this.poses.length) this.wreckNow();
  }

  /** The truck's pose while the lead-up plays: [T (10 numbers), rear wheel turn, front wheel turn]. */
  get truckPose() { return this.poses[Math.min(this.pose, this.poses.length - 1)]; }

  /**
   * The middle of the body: what the camera follows, before the wreck (from a truck pose's T, its
   * body placed on its mounts as the Wreck places it) and after (the wreck's own body).
   */
  bodyCentre(T) {
    if (this.wreck) { const c = this.wreck.centre; return [c[0] + this.camShift[0], c[1] + this.camShift[1]]; }
    const shape = BODY_SHAPES[this.body], a = Math.atan2(T[9] - T[7], T[8] - T[6]), c = Math.cos(a), s = Math.sin(a);
    let x = 0, y = 0;
    for (const [px, py] of shape) { x += T[6] + px * c - py * s; y += T[7] + px * s + py * c; }
    return [x / shape.length, y / shape.length];
  }

  wreckNow() {
    const s = this.crash.truck, t = new Truck();
    t.T = s.T.slice(); t.P = s.P.slice();
    t.rearSpin = s.rearSpin; t.frontSpin = s.frontSpin;
    t.rearWheelRot = s.rearWheelRot; t.frontWheelRot = s.frontWheelRot;
    t.probePrev = s.probePrev ? s.probePrev.slice() : null;
    t.gravity = s.gravity;
    t.updateBodyRot();
    this.wreck = null;
    const was = this.bodyCentre(t.T);
    this.wreck = new Wreck(t, this.w.wheel, this.w.thin, this.body);
    // (the Wreck lifts the body clear of any ground its cab had scraped into: keep the camera's
    // point where it was, so the view doesn't jump)
    const c = this.wreck.centre;
    this.camShift = [was[0] - c[0], was[1] - c[1]];
  }

  step() {
    if (this.wreck) {
      this.wreck.step();
      if (this.after != null ? this.wreck.steps >= this.after * 70 : this.wreck.asleep || this.wreck.steps > 70 * 10) this.done = true;
    } else if (++this.pose >= this.poses.length) this.wreckNow();
  }

  /** Which wheels are resting on top of the body (not on the ground): [rear, front] booleans. */
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
    if (!this.wreck) this.wreckNow();
    while (!this.done) this.step();
    return this;
  }
}

/** Every crash with every body: how many wheels were left on top, and how long it took to settle. */
export function tally(data, crashes) {
  return crashes.map((crash) => {
    const on = [], settle = [];
    for (let body = 0; body < BODIES; body++) {
      const r = new CrashRun(data, crash, body, { lead: 0 }).finish();
      on.push(r.wheelsOnTop().filter(Boolean).length);
      settle.push(r.wreck.steps / 70);
    }
    return { crash, on, settle };
  });
}

/** The crashes (tools/wreck-crashes.json), in Node. */
export async function loadCrashes() {
  const { readFileSync } = await import('node:fs');
  return JSON.parse(readFileSync(new URL('./wreck-crashes.json', import.meta.url)));
}

// Run directly: print the tally.
if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
  const rows = tally(data, await loadCrashes());
  const count = [0, 0, 0];
  console.log('Wheels left on top of the body, per body (1-6): . none, 1 one, 2 both');
  for (const { crash: c, on, settle } of rows) {
    on.forEach((n) => count[n]++);
    const max = Math.max(...settle);
    console.log(`#${String(c.id).padStart(2)} stage ${c.stage + 1}  ${c.lie.padEnd(12)} ${String(c.kmh).padStart(3)} km/h   ${on.map((n) => (n ? n : '.')).join(' ')}   settles in ${max.toFixed(1)} s${max >= 10 ? ' (never)' : ''}`);
  }
  const all = count[0] + count[1] + count[2];
  console.log(`All: both on top ${count[2]} (${Math.round(count[2] / all * 100)}%), one ${count[1]} (${Math.round(count[1] / all * 100)}%), none ${count[0]}`);
}
