// game.js — game logic for Funky Truck. No DOM access, so it also runs under Node for tests.
//
// This is a port of the native Swift version (FunkyTruckMac/Sources/Game.swift), which in turn is
// a line-for-line port of the original Flash ActionScript. Comments name the original obfuscated
// identifiers where that helps cross-checking. Everything runs at the original 70 steps/second.

import { validPadMap, assignPad, defaultPadMap } from './pad.js';
import { Critters, CRITTERS } from './critters.js';
import { buildGrammar, EndlessCourse, ENDLESS_WIDTH, ENDLESS_SHIFT } from './endless.js';
import { TrickTracker } from './tricks.js';
import { Wreck } from './wreck.js';
import { TRIAL_ALL, TRIAL_TRACKS, TRIAL_STUNTS, GHOST_EVERY, validBests, validStuntBests, loadGhost, saveGhost, ghostPose } from './trial.js';
import { validStats, emptyStats, countTrick, countChain } from './stats.js';
import { Battle } from './battle.js';
import { validSandbox, applySandbox, stepTraffic, SANDBOX_ROW } from './sandbox.js';
import { validStage, validStages, addStage } from './stages.js';
import { formTable } from './tile-forms.js';

export const TILE = 64;          // s4c2
export const STAGE_W = 576;      // Z7552
export const STAGE_H = 448;      // B9752
export const STEP_HZ = 70;       // the SWF frame rate

const PI = Math.PI;
/** 0 at 0, 1 at 1 (and beyond), easing in and out. */
const smoothstep = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** Endless Mode: metres shown per tile column travelled, and points per column. */
export const METRES_PER_TILE = 2.5;
/** The speedometer: km/h for a speed of one pixel per step (70 steps a second, 2.5 m a tile). */
export const KMH_PER_PX_STEP = STEP_HZ * METRES_PER_TILE / TILE * 3.6;
const POINTS_PER_TILE = 10;
/** The fastest anything goes (only Sandbox gets near it): 9999 km/h, in px per step. */
export const MAX_SPEED = 9999 / KMH_PER_PX_STEP;
/**
 * Air drag, only past 999 km/h (no stage, nor anything short of Sandbox's boost or gravity, gets
 * near): each step a truck going faster loses DRAG[0] times how far over it is, plus DRAG[1] times
 * that squared (px/step). Light enough that Sandbox's ×8 boost, pointing straight up, still gains
 * speed all the way to MAX_SPEED (in about 30 s from 1000 km/h).
 */
export const DRAG_FROM = 999 / KMH_PER_PX_STEP;
export const DRAG = [0.000435, 6.5e-7];
const dragLoss = (v) => (v <= DRAG_FROM ? 0 : Math.min(v - DRAG_FROM, DRAG[0] * (v - DRAG_FROM) + DRAG[1] * (v - DRAG_FROM) ** 2));
/** How many choices Sandbox setting `key` has. */

// ---------------------------------------------------------------------------------------------
// Collision world (H312 / i0c3 / F335 / a80D / k44F)

function normal(ax, ay, bx, by) { // s2a7
  let dx = bx - ax, dy = by - ay;
  const l = Math.sqrt(dx * dx + dy * dy);
  dx /= l; dy /= l;
  return [-dy, dx];
}

function near(a, b, c, d) { // s849
  return Math.abs(a - c) <= 1 && Math.abs(b - d) <= 1;
}

export class CollisionWorld {
  /** `ceiling` false leaves out the invisible wall along the top of the level (outside Classic). */
  constructor(level, table, wheelRadius, { ceiling = true } = {}) {
    this.cell = 20;                    // V151
    this.offset = wheelRadius - 1;     // B7B1
    this.segs = [];                    // H77: {x1,y1,x2,y2,nx,ny,type}
    const W = level.width, H = level.height;
    this.cols = Math.ceil(W * TILE / this.cell);
    this.rows = Math.ceil(H * TILE / this.cell);
    // grid[row] is a Map from column to the segments in that cell. Only cells with segments in
    // them are stored, so a big track (mostly sky and solid ground) costs little memory.
    this.grid = [];
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) this.addTile(tx, ty, level, table);
    const B = this.offset;
    // The invisible side walls (`wall`: outside Classic, touching one isn't landing on the ground).
    this.segs.push({ x1: B, y1: H * TILE, x2: B, y2: 0, nx: 1, ny: 0, type: 1, wall: true });
    this.segs.push({ x1: W * TILE - B, y1: 0, x2: W * TILE - B, y2: H * TILE, nx: -1, ny: 0, type: 1, wall: true });
    if (ceiling) this.segs.push({ x1: 0, y1: B, x2: W * TILE, y2: B, nx: 0, ny: 1, type: 1 });
    this.buildGrid();
  }

  // i0c3: offset each tile segment along its normal, then join its ends with neighbouring segments.
  addTile(gx, gy, level, table) {
    const ox = gx * TILE, oy = gy * TILE;
    const d = table[level.tiles[gy][gx]];
    const B = this.offset;
    for (let i = 0; i < d.length; i += 5) {
      const ax = d[i] + ox, ay = d[i + 1] + oy, bx = d[i + 2] + ox, by = d[i + 3] + oy;
      const n = normal(ax, ay, bx, by);
      let sx = ax + n[0] * B, sy = ay + n[1] * B, ex = bx + n[0] * B, ey = by + n[1] * B;
      const join = (e, j, px, py) => {
        const cx = e[j] + px, cy = e[j + 1] + py, dx = e[j + 2] + px, dy = e[j + 3] + py;
        const m = normal(cx, cy, dx, dy);
        const c2x = cx + m[0] * B, c2y = cy + m[1] * B, d2x = dx + m[0] * B, d2y = dy + m[1] * B;
        if (near(ax, ay, dx, dy)) { sx += (d2x - sx) * 0.5; sy += (d2y - sy) * 0.5; }
        if (near(bx, by, cx, cy)) { ex += (c2x - ex) * 0.5; ey += (c2y - ey) * 0.5; }
      };
      for (let j = 0; j < d.length; j += 5) if (j !== i) join(d, j, ox, oy);
      const nb = [-1, 0, -1, -1, 0, -1, 1, -1, 1, 0, 1, 1, 0, 1, -1, 1];
      for (let k = 0; k < nb.length; k += 2) {
        const nx = gx + nb[k], ny = gy + nb[k + 1];
        if (nx >= 0 && nx < level.width && ny >= 0 && ny < level.height) {
          const e = table[level.tiles[ny][nx]];
          for (let m = 0; m < e.length; m += 5) join(e, m, nx * TILE, ny * TILE);
        }
      }
      const n2 = normal(sx, sy, ex, ey);
      this.segs.push({ x1: sx, y1: sy, x2: ex, y2: ey, nx: n2[0], ny: n2[1], type: d[i + 4] });
    }
  }

  buildGrid() { // F335 (cells outside the grid are skipped, as the original silently did)
    this.segs.forEach((s, idx) => {
      const x0 = Math.floor(Math.min(s.x1, s.x2) / this.cell), x1 = Math.floor(Math.max(s.x1, s.x2) / this.cell);
      const y0 = Math.floor(Math.min(s.y1, s.y2) / this.cell), y1 = Math.floor(Math.max(s.y1, s.y2) / this.cell);
      for (let gy = Math.max(0, y0); gy <= Math.min(y1, this.rows - 1); gy++)
        for (let gx = Math.max(0, x0); gx <= Math.min(x1, this.cols - 1); gx++)
          {
            const row = this.grid[gy] ||= new Map();
            if (!row.has(gx)) row.set(gx, []);
            row.get(gx).push(idx);
          }
    });
  }

  // k44F: swept test of a moving point against one segment; returns the pushed-out end point.
  test(a00, b11, c22, d33, s) {
    let side = s.nx * (a00 - s.x1) + s.ny * (b11 - s.y1);
    if (side < 0) return null;
    const l9 = b11 - s.y1, l17 = s.y2 - s.y1, l13 = d33 - b11;
    const l14 = s.x2 - s.x1, l12 = a00 - s.x1, l8 = c22 - a00;
    const n18 = l9 * l14 - l12 * l17;
    const den = l8 * l17 - l13 * l14;
    const n22 = l9 * l8 - l12 * l13;
    if (den === 0) return null;
    const t = n18 / den, u = n22 / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    side = s.nx * (c22 - s.x1) + s.ny * (d33 - s.y1) - 0.1;
    return [c22 - s.nx * side, d33 - s.ny * side];
  }

  // a80D
  collide(a00, b11, cIn, dIn) {
    let c22 = cIn, d33 = dIn;
    let minX = Math.min(a00, c22), minY = Math.min(b11, d33), maxX = Math.max(a00, c22), maxY = Math.max(b11, d33);
    const pad = Math.max(maxX - minX, maxY - minY) * 0.5 + 1;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    let gx0 = Math.floor(minX / this.cell), gy0 = Math.floor(minY / this.cell);
    let gx1 = Math.floor(maxX / this.cell), gy1 = Math.floor(maxY / this.cell);
    if (gx1 < 0 || gy1 < 0 || gx0 >= this.cols || gy0 >= this.rows) return null;
    gx0 = Math.max(gx0, 0); gy0 = Math.max(gy0, 0);
    gx1 = Math.min(gx1, this.cols - 1); gy1 = Math.min(gy1, this.rows - 1);
    let last = null, done = false, guard = 0;
    while (!done && guard < 64) {
      done = true;
      guard++;
      for (let gy = gy0; gy <= gy1; gy++) {
        const row = this.grid[gy];
        if (!row) continue;
        for (let gx = gx0; gx <= gx1; gx++) {
          const cell = row.get(gx);
          if (!cell) continue;
          for (const idx of cell) {
            const p = this.test(a00, b11, c22, d33, this.segs[idx]);
            if (p) { done = false; c22 = p[0]; d33 = p[1]; last = this.segs[idx]; }
          }
        }
      }
    }
    if (!last) return null;
    return { x: c22, y: d33, nx: last.nx, ny: last.ny, type: last.type, wall: !!last.wall };
  }

  /**
   * The first ground straight down from (x, y0) to y1, as collide() finds it, looked for a piece
   * at a time: collide() searches a box as wide as its line is long, so one long line down
   * through a stage would look through a great many empty cells. (For the camera and altimeter.)
   */
  down(x, y0, y1, piece = 256) {
    for (let y = y0; y < y1; y += piece) {
      const h = this.collide(x, y, x, Math.min(y + piece, y1));
      if (h) return h;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Truck: a soft body of 5 Verlet points.
// 0 = chassis centre, 1 = rear wheel, 2 = front wheel, 3 = rear body mount, 4 = front body mount.

export class Truck {
  constructor() {
    this.T = new Array(10).fill(0);    // T9F13 current
    this.P = new Array(10).fill(0);    // T5145 previous
    this.armRear = 36;                 // e8eF4
    this.armFront = 36;                // V7345
    this.angRear = -2.356194490192345; // w8445
    this.angFront = -0.7853981633974483; // y0645
    this.diagRear = 0; this.diagFront = 0; // a2845, B3945
    this.springK = 0.1;                // c4a45
    this.wheelRadius = 22.5;           // J532
    this.circumference = PI * this.wheelRadius * 2; // s4045
    this.rearContact = false; this.frontContact = false; // F7D45, J1155
    // ...touching the ground, not just an invisible side wall (set with the contacts).
    this.rearGround = false; this.frontGround = false;
    // Whether touching a side wall counts as being on the ground, for flips and tricks (the
    // original's way, kept in Classic). Outside Classic the game sets it false.
    this.wallsCount = true;
    this.rearN = [0, 0]; this.frontN = [0, 0];           // g8e45, k2255
    this.rearV = [0, 0]; this.frontV = [0, 0];           // i0055, m4455
    this.rearSpin = 0; this.frontSpin = 0;               // H9F45, L3355
    this.rearWheelRot = 0; this.frontWheelRot = 0;       // degrees, unwrapped
    this.bodyRot = 0;                                    // L7935._rotation (degrees)
    this.probePrev = null;                               // N5555
    this.probeHit = null;                                // what the roof probe last touched
    this.airborne = false; this.flipLast = 0; this.flipAccum = 0; // s0a55, T1B55, u2c55
    // Drive power, gravity and how hard the tilt keys turn it. The original's values; Sandbox's
    // cars have their own power, and Sandbox changes all three.
    this.power = 1;
    this.gravity = 0.11;
    this.tiltPower = 1;
  }

  reset(x, y) { // u4095 + parts of s46B2
    const T = this.T;
    T[0] = x; T[1] = y;
    T[2] = x - this.armRear; T[3] = y;
    T[4] = x + this.armFront; T[5] = y;
    T[6] = x + Math.cos(this.angRear) * this.armRear; T[7] = y + Math.sin(this.angRear) * this.armRear;
    T[8] = x + Math.cos(this.angFront) * this.armFront; T[9] = y + Math.sin(this.angFront) * this.armFront;
    this.diagRear = Math.hypot(T[2] - T[6], T[3] - T[7]);
    this.diagFront = Math.hypot(T[4] - T[8], T[5] - T[9]);
    this.P = T.slice();
    this.probePrev = null;
    this.rearSpin = 0; this.frontSpin = 0;
    this.airborne = false;
    this.updateBodyRot();
  }

  updateBodyRot() { // rotation part of V5195
    const T = this.T;
    this.bodyRot = Math.atan2(T[9] - T[7], T[8] - T[6]) * 57.29577951308232;
  }

  integrate() { // J9F95
    const T = this.T, P = this.P;
    for (let i = 0; i < 10; i += 2) {
      const x = T[i], y = T[i + 1];
      T[i] += x - P[i];
      T[i + 1] += (y - P[i + 1]) + this.gravity;
      P[i] = x; P[i + 1] = y;
    }
  }

  stick(a, b, rest, k) {
    const T = this.T;
    let dx = T[b * 2] - T[a * 2], dy = T[b * 2 + 1] - T[a * 2 + 1];
    const l = Math.sqrt(dx * dx + dy * dy);
    const f = (l - rest) / l * -0.5 * k;
    dx *= f; dy *= f;
    T[a * 2] -= dx; T[a * 2 + 1] -= dy;
    T[b * 2] += dx; T[b * 2 + 1] += dy;
  }

  static wrap(a) {
    if (a > PI) a -= 2 * PI;
    if (a < -PI) a += 2 * PI;
    return a;
  }

  vec(p) {
    const T = this.T;
    const dx = T[p * 2] - T[0], dy = T[p * 2 + 1] - T[1];
    return [Math.atan2(dy, dx), Math.sqrt(dx * dx + dy * dy)];
  }

  centroid(a, b, c) {
    const T = this.T;
    return [(T[a * 2] + T[b * 2] + T[c * 2]) / 3, (T[a * 2 + 1] + T[b * 2 + 1] + T[c * 2 + 1]) / 3];
  }

  place(p, ang, len) {
    const T = this.T;
    T[p * 2] = T[0] + Math.cos(ang) * len;
    T[p * 2 + 1] = T[1] + Math.sin(ang) * len;
  }

  shift(pts, c0, c1) {
    const sx = c1[0] - c0[0], sy = c1[1] - c0[1];
    for (const p of pts) { this.T[p * 2] -= sx; this.T[p * 2 + 1] -= sy; }
  }

  // Clamp the angle between arm p (ang8) and arm q (ang7) into [lo, hi].
  limit(q, p, lo, hi) {
    const a7 = this.vec(q), a8 = this.vec(p);
    const d = Truck.wrap(a8[0] - a7[0]);
    let corr = 0;
    if (d < lo) corr = lo - d; else if (d > hi) corr = hi - d;
    if (corr === 0) return;
    const c0 = this.centroid(0, q, p);
    corr *= 0.25;
    this.place(p, a8[0] + corr, a8[1]);
    this.place(q, a7[0] - corr, a7[1]);
    this.shift([0, q, p], c0, this.centroid(0, q, p));
  }

  constrain() { // R77a5
    const T = this.T;
    this.stick(0, 1, this.armRear, 1);
    this.stick(0, 2, this.armFront, 1);
    this.stick(0, 3, this.armRear, 1);
    this.stick(0, 4, this.armFront, 1);
    this.stick(1, 3, this.diagRear, this.springK);
    this.stick(2, 4, this.diagFront, this.springK);

    // Keep the body mounts (3, 4) at right angles about the centre.
    let dx = T[0] - T[8], dy = T[1] - T[9];
    let a7 = Math.atan2(dy, dx); const l15 = Math.sqrt(dx * dx + dy * dy);
    dx = T[6] - T[0]; dy = T[7] - T[1];
    let a8 = Math.atan2(dy, dx); const l14 = Math.sqrt(dx * dx + dy * dy);
    const d = Truck.wrap(a8 - a7);
    const corr = (PI / 2 - d) * 0.05;
    const c0 = this.centroid(0, 3, 4);
    a8 += corr;
    T[6] = T[0] + Math.cos(a8) * l14; T[7] = T[1] + Math.sin(a8) * l14;
    a7 += PI; a7 -= corr;
    T[8] = T[0] + Math.cos(a7) * l15; T[9] = T[1] + Math.sin(a7) * l15;
    this.shift([0, 3, 4], c0, this.centroid(0, 3, 4));

    this.limit(2, 4, -0.8726646259971648, -0.17453292519943295);
    this.limit(1, 3, 0.17453292519943295, 0.8726646259971648);
  }

  collideWheels(w) { // B3Bc5
    const T = this.T, P = this.P;
    let h = w.collide(P[2], P[3], T[2], T[3]);
    if (h) {
      this.rearContact = true;
      if (!h.wall) this.rearGround = true;
      this.rearV = [T[2] - P[2], T[3] - P[3]];
      T[2] = h.x; T[3] = h.y;
      this.rearN = [h.nx, h.ny];
    }
    h = w.collide(P[4], P[5], T[4], T[5]);
    if (h) {
      this.frontContact = true;
      if (!h.wall) this.frontGround = true;
      this.frontV = [T[4] - P[4], T[5] - P[5]];
      T[4] = h.x; T[5] = h.y;
      this.frontN = [h.nx, h.ny];
    }
  }

  drive(keys) { // F7Fc5
    const k = 0.4 * this.power, P = this.P;
    let s;
    if (keys.up) s = -k; else if (keys.down) s = k; else return;
    if (this.rearContact) { P[2] -= this.rearN[1] * s; P[3] -= -this.rearN[0] * s; }
    if (this.frontContact) { P[4] -= this.frontN[1] * s; P[5] -= -this.frontN[0] * s; }
  }

  spinWheels() { // c06e5
    if (this.rearContact) {
      const s = this.rearN[1] * this.rearV[0] + -this.rearN[0] * this.rearV[1];
      this.rearSpin = -s / this.circumference * 360;
    }
    this.rearWheelRot += this.rearSpin;
    if (this.frontContact) {
      const s = this.frontN[1] * this.frontV[0] + -this.frontN[0] * this.frontV[1];
      this.frontSpin = -s / this.circumference * 360;
    }
    this.frontWheelRot += this.frontSpin;
  }

  tilt(keys) { // g80D5
    const T = this.T, P = this.P;
    let dx = T[4] - T[2], dy = T[5] - T[3];
    const l = Math.sqrt(dx * dx + dy * dy);
    if (l !== 0) { dx /= l; dy /= l; }
    const px = -dy, py = dx;
    if (keys.left) {
      if (!this.rearContact && !this.frontContact) { P[4] += px * (0.2 * this.tiltPower); P[5] += py * (0.2 * this.tiltPower); }
      else if (this.rearContact) {
        const n = this.rearN, s = (n[0] * px + n[1] * py) * (0.1 * this.tiltPower);
        P[4] += n[0] * s; P[5] += n[1] * s;
      }
    } else if (keys.right) {
      if (!this.rearContact && !this.frontContact) { P[4] -= px * (0.2 * this.tiltPower); P[5] -= py * (0.2 * this.tiltPower); }
      else if (this.frontContact) {
        const n = this.frontN, s = (n[0] * px + n[1] * py) * (0.1 * this.tiltPower);
        P[2] += n[0] * s; P[3] += n[1] * s;
      }
    }
  }

  // e28e5: probe point on the cab roof. Returns the surface type if the body scraped the ground.
  probeBody(w) {
    const T = this.T;
    const r = this.bodyRot * 0.017453292519943295;
    const lx = 10, ly = -30;
    let x = lx * Math.cos(r) - ly * Math.sin(r) + T[0];
    let y = lx * Math.sin(r) + ly * Math.cos(r) + T[1];
    if (!this.probePrev) { this.probePrev = [x, y]; return null; }
    let result = null;
    const h = w.collide(this.probePrev[0], this.probePrev[1], x, y);
    this.probeHit = h; // the surface touched (its normal says which side of the truck it's on)
    if (h) {
      const sx = h.x - x, sy = h.y - y;
      for (const p of [0, 3, 4]) { T[p * 2] += sx; T[p * 2 + 1] += sy; }
      x = h.x; y = h.y;
      result = h.type;
    }
    this.probePrev = [x, y];
    return result;
  }

  /** A wheel on the ground, for flips and tricks (a side wall only counts where wallsCount). */
  get rearDown() { return this.wallsCount ? this.rearContact : this.rearGround; }
  get frontDown() { return this.wallsCount ? this.frontContact : this.frontGround; }

  // a4eF5: returns a completed flip's total rotation (degrees) when the truck lands.
  trackFlip() {
    let rot = this.bodyRot;
    if (rot < 0) rot += 360;
    if (!this.airborne && !this.rearDown && !this.frontDown) {
      this.airborne = true; this.flipLast = rot; this.flipAccum = 0;
    }
    if (!this.airborne) return null;
    let d = this.flipLast - rot;
    if (d < -180) { d += 360; d = -d; } else if (d > 180) { d -= 360; d = -d; }
    this.flipLast = rot;
    this.flipAccum += d;
    if (this.rearDown || this.frontDown) {
      this.airborne = false;
      const a = Math.abs(this.flipAccum);
      if (a >= 190) return Math.floor(a);
    }
    return null;
  }

  /** Add `d` radians per step of clockwise spin about the truck's middle (flip-upright assist). */
  addSpin(d) {
    const T = this.T, P = this.P;
    let cx = 0, cy = 0;
    for (let i = 0; i < 10; i += 2) { cx += T[i]; cy += T[i + 1]; }
    cx /= 5; cy /= 5;
    for (let i = 0; i < 10; i += 2) {
      const rx = T[i] - cx, ry = T[i + 1] - cy;
      P[i] += ry * d; P[i + 1] -= rx * d;
    }
  }

  /** The truck's centre of mass (the average of its five points, which all weigh the same), now and a step ago. */
  centre(A = this.T) {
    let x = 0, y = 0;
    for (let i = 0; i < 10; i += 2) { x += A[i]; y += A[i + 1]; }
    return [x / 5, y / 5];
  }

  /** How fast the centre of mass is moving, in pixels per step. */
  get speed() {
    const [x, y] = this.centre(), [px, py] = this.centre(this.P);
    return Math.hypot(x - px, y - py);
  }

  // u6a33 / g0406: idle bounce used on the garage screen.
  garageStep() {
    this.integrate();
    for (let i = 0; i < 2; i++) {
      this.constrain();
      if (this.T[3] > 170) this.T[3] = 170;
      if (this.T[5] > 170) this.T[5] = 170;
    }
    this.rearWheelRot += 4; this.frontWheelRot += 4;
    this.updateBodyRot();
  }

  /**
   * The title screen's truck: the garage's idle bounce, but it can be knocked into the air (see
   * kick) and tumble. The floor holds up the whole truck, not just its wheels, so it can land on
   * its roof or its side, and it's kept in the middle across.
   */
  titleStep() {
    const T = this.T, P = this.P;
    this.integrate();
    for (let i = 0; i < 2; i++) {
      this.constrain();
      if (T[3] > 170) T[3] = 170;
      if (T[5] > 170) T[5] = 170;
      // The body: its outline's lowest corner rests on the floor (the wheels' bottoms, 192.5).
      const ang = Math.atan2(T[9] - T[7], T[8] - T[6]), c = Math.cos(ang), sn = Math.sin(ang);
      let low = -Infinity;
      for (const [x, y] of TITLE_BODY) low = Math.max(low, T[7] + x * sn + y * c);
      if (low > TITLE_FLOOR) {
        for (const p of [0, 3, 4]) { T[p * 2 + 1] -= low - TITLE_FLOOR; P[p * 2] += (T[p * 2] - P[p * 2]) * 0.15; }
      }
    }
    const [cx] = this.centre();
    for (let i = 0; i < 10; i += 2) { T[i] -= cx - STAGE_W / 2; P[i] -= cx - STAGE_W / 2; }
    this.rearWheelRot += 4; this.frontWheelRot += 4;
    this.updateBodyRot();
  }

  /** Whether the point (x, y) is on the truck (a wheel or the body), with a little to spare. */
  hits(x, y) {
    const T = this.T;
    if (Math.hypot(x - T[2], y - T[3]) < 26 || Math.hypot(x - T[4], y - T[5]) < 26) return true;
    // in the body's own frame (from the rear mount, x along to the front mount)
    const ang = Math.atan2(T[9] - T[7], T[8] - T[6]), c = Math.cos(ang), sn = Math.sin(ang);
    const dx = x - T[6], dy = y - T[7], u = dx * c + dy * sn, v = -dx * sn + dy * c;
    return (u > -16 && u < 68 && v > -32 && v < 16) || Math.hypot(x - T[0], y - T[1]) < 20;
  }

  /**
   * Knock the truck up from the point (x, y): every point is pushed up, the ones nearest the hit
   * most, so hitting the back wheel lifts the back and turns it over forwards. There's no limit:
   * hit it often enough and it flies up out of sight, and falls back down.
   */
  kick(x, y) {
    const T = this.T, P = this.P;
    for (let i = 0; i < 10; i += 2) {
      const d = Math.hypot(T[i] - x, T[i + 1] - y);
      P[i + 1] += KICK.push * (KICK.even + (1 - KICK.even) * Math.max(0, 1 - d / KICK.reach));
    }
  }
}

/** The title truck's floor (where its wheels' bottoms rest), and its body's outline as Wreck has it. */
const TITLE_FLOOR = 192.5;
const TITLE_BODY = [[-10, -26], [62, -26], [62, 10], [-10, 10]];
/** A kick on the title truck: px per step up, the share every point gets, and how far the rest reaches. */
export const KICK = { push: 5.2, even: 0.3, reach: 80 };

// ---------------------------------------------------------------------------------------------
// Game state machine (_ma)

export const STAGE_NAMES = ['Stage One', 'Stage Two', 'Stage Three', 'Stage Four', 'Stage Five',
  'Stage Six', 'Stage Seven', 'Stage Eight', 'Stage Nine', 'Stage Ten'];

/**
 * The stunt tracks are stored a column at a time (assets/stunts.json, built by
 * tools/make-stunts.mjs): each column is [top, ...tiles], its ground's top row and the tiles from
 * there down; above is sky and below is solid ground. This turns one back into a level, shaped
 * like an entry of levels.json. Anything else is passed through unchanged.
 */
export function unpackLevel(l) {
  if (!l || !Array.isArray(l.columns)) return l;
  const { columns, ...rest } = l;
  const tiles = Array.from({ length: l.height }, () => new Array(columns.length));
  columns.forEach(([top, ...shape], x) => {
    for (let r = 0; r < l.height; r++) tiles[r][x] = r < top ? 0 : r - top < shape.length ? shape[r - top] : 1;
  });
  return { ...rest, width: columns.length, tiles };
}

/** A saved whole number of metres, or 0 if what was saved isn't one. */
function validCount(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 1e9 ? n : 0;
}

export function emptyKeys() {
  // `one` is the single button of the one-button controls (Space, or holding the touch screen).
  // `boost` is Sandbox's boost (held); its missiles and jump are presses (Game.press).
  return { up: false, down: false, left: false, right: false, pause: false, restart: false, one: false, upright: false, boost: false };
}

/**
 * The rules a run is played by (each missing one is off):
 *   damage     scraping the cab adds damage, and 1000 damage wrecks the truck
 *   ceiling    the invisible ceiling along the top of the level (the nine stages, in Classic and
 *              Time Trial). The camera never shows above it.
 *   scrapeAll  the original scrape: any ground the cab's probe touches counts, even ground under
 *              the body (bottoming out on a hard landing or a ramp). Without it, only ground beside
 *              or above the cab does. Either way, bottoming out never bails a trick chain.
 *   flipBonus  the original scoring: a landed flip's degrees, paid at once while the time bonus
 *              runs (after the finish line too), and the side walls count as ground. No tricks.
 *   tricks     false: no tricks are watched for
 *   retro      2006 Mode: the original's look (576x448, 30 fps, letterboxed), its camera, no
 *              speedometer or altimeter, no ragdoll wreck (the truck keeps driving, whole), no Esc wreck
 */
export const RULES = {
  endless: { damage: false },
  sandbox: { damage: false },
};

/**
 * Classic Mode's rules: the original game on the nine stages, with or without tricks, and in the
 * new view or 2006 Mode (which always has tricks off). Tricks off plays exactly as the original.
 */
export function classicRules({ tricks = false, retro = false } = {}) {
  const flip = !tricks || retro;
  return { damage: true, ceiling: true, scrapeAll: true, flipBonus: flip, tricks: !flip, retro: !!retro };
}

/**
 * The dynamic camera (outside 2006 Mode, when switched on): it pulls back to show more when the
 * truck is going fast (mostly) or has been high above the ground for a while, and closes in again
 * when it settles. `zoom` is how many times the usual view it shows (1 = the usual view, never
 * less than Classic's 576x448). It follows the truck just as the original camera does, with the
 * frame scaled by the zoom. While the truck rolls backwards it also eases the frame back a little
 * (`lookBack` stage units at most), so you can see where you're reversing to.
 *
 * The zoom moves like a spring, so it never starts or stops suddenly: speed, height and zoom are
 * each followed by a critically damped spring, and height fades in over the first second in the
 * air. `w` values are a spring's stiffness per step (bigger is quicker): it settles in about 5/w
 * steps.
 */
export const CAMERA = {
  maxZoom: 1.8,
  speedFrom: 5, speedTo: 12, speedZoom: 0.65,      // px per step (~10 km/h each): none at 5, full at 12
  heightFrom: 80, heightTo: 600, heightZoom: 0.35, // px above the ground
  airFrom: 10, airTo: 70,                          // height fades in between these steps in the air
  speedW: 0.035, heightW: 0.05, zoomW: 0.045,      // springs for the smoothed speed, height and zoom
  maxRate: 0.006,                                  // most the zoom changes in one step
  lookBack: 100, backFrom: 1, backTo: 4, backW: 0.025, // reversing: px per step backwards, and its spring
};

/**
 * The dynamic crash cam (outside 2006 Mode, when switched on): once the truck is wrecked, the camera
 * pulls back to keep every piece in view, centred on them, up to `maxZoom` times the usual view
 * (beyond that it stays centred on them all). `margin` is room
 * left round the pieces (stage units, at zoom 1), `maxRate` the most the zoom changes in a step
 * (times the zoom), and `easeIn` the steps it takes to take over from the driving camera.
 */
export const CRASH_CAM = { maxZoom: 8, margin: 70, maxRate: 0.03, easeIn: 90 };
/** The slowest a scraping cab or body throws up dirt (px a step). */
const SCRAPE_DIRT_FROM = 1.5;
/** Above this speed (px a step, about 100 km/h) the camera keeps pace with the truck (Game.updateCamera). */
export const PACE_FROM = 12;
/** Steps the High Scores reset waits before its Yes can be pressed (5 s). */
export const RESET_WAIT = 350;

/** Flip-upright assist: steps of being stuck before the button appears. */
export const STUCK_STEPS = 140;
/** ...and how long it stays once the truck no longer looks stuck (3 s). */
export const UPRIGHT_LINGER = 210;
/** ...and it's never offered with the truck more than this far above the ground (50 m, in px). */
export const UPRIGHT_HEIGHT = 50 / METRES_PER_TILE * TILE;
/** After a flip upright, steps on the ground before tricks are watched for again (1 s). */
export const TRICK_COOLDOWN = 70;
/**
 * Without the original scrape (`scrapeAll`), the body touching ground that's underneath it (the
 * chassis bottoming out on a hard landing or a ramp) isn't a scrape, and it never bails a trick
 * chain. Underneath means the ground's normal is within about 65° of the truck's up direction.
 */
const UNDERSIDE = 0.42;
const RIGHTING_STEPS = 80;
const ONE_BUTTON_AIR = 4;        // steps off the ground before the one-button controls count as in the air
/**
 * One-button balance assist: with both wheels on the ground and tipped more than this many degrees
 * (nose down, or nose up as on a steep climb), the button also presses the tilt key that turns the
 * truck back towards level, just as Standard's arrow keys would. On one wheel (a wheelie or a nose
 * stand) it doesn't: a tilt key on the ground only acts through the wheel it pushes on (back for
 * tilting back, front for tilting forwards), so there it would do nothing.
 */
export const BALANCE_ANGLE = 45;
/** The cab of a truck wrecked on purpose (Esc) takes this much damage a step while it touches the ground (as scraping does). */
const SELF_WRECK_DAMAGE = 6;
/** Endless Mode's milestones: distances (then every `every` metres), and scores. */
export const MILESTONES = { metres: [100, 250, 500, 750, 1000], every: 500, scores: [5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000] };
/** Steps a milestone stays on screen. */
export const MILESTONE_SHOW = 150;
/** Stats are saved at least this often while driving (10 s). */
const STATS_SAVE_EVERY = 700;
/** How many saved stages the Load Stage screen lists at a time. */
export const STAGES_PER_PAGE = 6;

/**
 * Screens: 'title' | 'modes' (the mode picker over the title) | 'stats' | 'options' | 'help' | 'garage' |
 * 'trialSelect' | 'playing' | 'paused' | 'pauseOptions' | 'gameOver'
 * Modes: 'campaign' (all nine stages), 'practice' (one stage), 'endless' (a generated course),
 * 'trial' (Time Trial: a stage or all nine against the clock, see trial.js), 'sandbox' (any track,
 * the physics as you like, with rival and enemy cars: see sandbox.js and battle.js).
 * Classic (mode 'campaign', the nine stages) has its own screen ('classicSelect') with its Tricks
 * and 2006 Mode switches.
 */
export class Game {
  /**
   * @param {{levels: Array, collision: Array}} data  contents of assets/levels.json
   * @param {{random?: () => number, store?: {get(k): any, set(k, v): void}}} opts
   */
  constructor(data, opts = {}) {
    this.data = data;
    this.random = opts.random || Math.random;
    this.store = opts.store || { get: () => null, set: () => {} };
    this.screen = 'title';
    this.mode = 'campaign';           // F9572 / g0672
    this.level = 0;                   // F3DD2
    this.lastLevel = 0;               // k4a72
    this.world = null;
    this.truck = new Truck();
    this.garageTruck = new Truck();
    // y66D2. `paint` is the index of the body whose colour the truck wears. Choosing a body puts
    // it in its own colour; another colour is chosen for the body in hand.
    this.look = { body: 0, tyre: 0, hub: 0, paint: 0 };
    this.score = 0;                   // D9522
    this.bonus = 0;                   // Z3F62
    this.flipBonus = 0;               // a4072 (now: the last trick chain's payout)
    this.flipBonusTimer = 0;          // B5172
    // High Scores screen: records and totals (stats.js), counted as you play.
    this.stats = validStats(this.store.get('stats'));
    this.realStats = this.stats;      // (a Sandbox run counts into a throwaway copy instead: see beginRun)
    this.statsSince = 0;              // steps since the stats were last saved
    this.tricks = new TrickTracker({
      onTrick: (kind, info) => countTrick(this.stats, kind, info),
      onBank: (points, n, bailed) => countChain(this.stats, points, n, bailed),
    });
    this.damage = 0;                  // X5B4 (0..1000)
    this.endTimer = 0;                // L5B72
    this.tickerTimer = 0;             // e8472
    this.ticker = '';
    this.rules = { damage: true };
    // Best scores: Classic keeps the original game's saved best ('bestScore'); Classic with tricks
    // ('bestPlay', which Standard's best became) and Endless have their own.
    this.best = validCount(this.store.get('bestScore')); // a0a82
    this.bestPlay = validCount(this.store.get('bestPlay'));
    this.bestEndless = validCount(this.store.get('bestEndless'));
    this.battle = null;               // Sandbox's cars and missiles (battle.js)
    this.critters = null;             // Sandbox's birds and tumbleweeds (critters.js)
    // Sandbox Mode's settings (sandbox.js): which choice of each.
    // The Stage Editor's stages (stages.js), and the one picked on the Load Stage screen. (Before
    // Sandbox's settings: its tracks include them.)
    this.stages = validStages(this.store.get('stages'), data.collision.length);
    this.sandbox = validSandbox(this.store.get('sandbox'), this.sandboxCourses);
    this.sandboxPick = null;          // the setting whose list of choices is open on the Sandbox screen
    this.stagePick = -1;
    this.stagePage = 0;
    this.customLevel = null;          // the custom stage being played
    // Options (all off by default, apart from damage in Practice).
    const flag = (k, dflt) => { const v = this.store.get(k); return typeof v === 'boolean' ? v : dflt; };
    this.soundOn = flag('sound', false);
    this.oneButton = flag('oneButton', false);
    this.practiceDamage = flag('practiceDamage', true);
    this.customDamage = flag('customDamage', false);
    this.customRetro = flag('customRetro', false);   // custom stages in 2006 Mode
    this.classicTricks = flag('classicTricks', true);  // Classic: tricks on (2006 Mode always has them off)
    this.classicRetro = flag('classicRetro', false);   // Classic: 2006 Mode
    this.trialRetro = flag('trialRetro', false);     // Time Trial: 2006 Mode
    this.trialTricks = flag('trialTricks', true);   // Time Trial: tricks spotted and scored
    this.dynamicCamera = flag('dynamicCamera', true);
    this.crashCam = flag('crashCam', true);
    this.ghostOn = flag('ghost', true);
    this.showFps = flag('showFps', false);
    this.imperial = flag('imperial', false);
    this.padMap = validPadMap(this.store.get('padMap'));   // the gamepad's buttons (pad.js)
    this.padListen = null;            // the Controller screen: the action waiting for a button press   // speeds in mph, heights in ft and mi (units.js)
    // Time Trial: the best time on each track (see trial.js), and the run under way.
    this.trialBests = validBests(this.store.get('trialBests'));
    this.stuntBests = validStuntBests(this.store.get('stuntBests'));   // the stunt tracks' best trick scores
    this.track = 0;                   // which track (0-8 a stage, TRIAL_ALL all nine)
    this.clock = 0;                   // the race clock, in steps
    this.runStep = 0;                 // steps since the run began (the ghost's timeline)
    this.ghost = null;                // the best run's ghost, if there is one and ghosts are on
    this.ghostT = null;               // where the ghost truck is this step (null: not on screen)
    this.split = null;                // clock now minus the ghost's at this point of the track
    this.trialResult = null;          // { time, best, record } at the end of a finished run
    this.wreck = null;                // the pieces of a wrecked truck (outside 2006 Mode)
    this.resetConfirm = null;         // High Scores: the reset being confirmed, { steps } since asked
    this.selfWrecked = false;         // the wreck was done on purpose (Esc), not by damage
    this.crashSteps = 0;              // steps the crash cam has been on
    this.milestone = null;            // Endless: the celebration on screen { text, timer, n }
    this.milestones = [];             // ...and ones waiting their turn
    this.milestoneCount = 0;          // bumped for each one (for the sound and the confetti)
    this.scraping = false;            // the cab is scraping the ground this step
    this.speedKmh = 0;                // the speedometer (outside 2006 Mode), smoothed a little
    this.stuck = 0;                   // steps the truck has spent stuck (flip-upright assist)
    this.canUpright = false;
    this.righting = 0;                // steps left of a flip upright
    this.uprightLinger = 0;           // steps the Flip button stays after the truck looks unstuck
    this.trickCooldown = 0;           // steps on the ground after a flip upright before tricks count
    this.airSteps = 0;                // steps with no wheel on the ground (one-button controls)
    this.grammar = null;              // Endless Mode's course grammar, learned from the stages
    this.course = null;               // the current EndlessCourse
    this.distance = 0;                // Endless Mode: furthest tile column reached
    this.shiftCount = 0;              // bumped when Endless Mode scrolls the world left...
    this.lastShift = 0;               // ...by this many pixels (so the renderer can follow)
    this.lastShiftY = 0;              // ...and up by this many (a looping stunt track)
    this.lastScore = 0;
    this.wrecked = false;
    this.finished = false;
    this.camX = 0; this.camY = 0;     // J1Fc4 / k20D4
    this.zoom = 1;                    // the dynamic camera's pull-back (outside 2006 Mode)
    // Dynamic camera springs: each a value and its velocity per step.
    this.ground = 0; this.groundV = 0;     // smoothed height above the ground
    this.camSpeed = 0; this.camSpeedV = 0; // smoothed speed
    this.zoomV = 0;
    this.back = 0; this.backV = 0;         // how far the camera has eased back for reversing (0-1)
    // How much of the world the driving view shows across and top to bottom (at zoom 1) when it
    // fills the window: never less than the original's 576x448, and more one way to match the
    // window's shape. The renderer keeps these up to date, even on the menus, so a stage starts
    // with its camera in the right place. 2006 Mode always shows 576x448 (see viewW, viewH).
    this.fillViewW = STAGE_W;
    this.fillViewH = STAGE_H;
    this.dirt = [];                   // Z5D11
    for (let i = 0; i < 16; i++) this.dirt.push({ life: 0, x: 0, y: 0, vx: 0, vy: 0, frame: 0, scale: 1, alpha: 1 });
    this.dirtCooldown = 0;            // y4c11
    this.pauseStage = 0;
    this.keys = emptyKeys();
    this.restartLatch = false;
    this.teleportCount = 0;           // bumped when things jump, so the renderer won't interpolate
    const look = this.store.get('truckLook');
    if (look && typeof look === 'object') {
      const ok = (v) => Number.isInteger(v) && v >= 0 && v < 6;
      for (const k of ['body', 'tyre', 'hub']) if (ok(look[k])) this.look[k] = look[k];
      this.look.paint = ok(look.paint) ? look.paint : this.look.body;
    }
    this.garageTruck.reset(STAGE_W / 2, 120);
  }

  /** How much of the world shows top to bottom at zoom 1. It only moves the camera. */
  get viewH() { return this.rules.retro ? STAGE_H : this.fillViewH; }
  set viewH(h) { this.fillViewH = h; }
  /** How much of the world shows across at zoom 1. It only moves the camera. */
  get viewW() { return this.rules.retro ? STAGE_W : this.fillViewW; }
  set viewW(w) { this.fillViewW = w; }
  /** Where the camera keeps the truck across the view (at zoom 1): 150 from the left of a
   *  576-wide view, centred in a wider one, and eased right a little while reversing. */
  get camAnchorX() { return 150 + (this.viewW - STAGE_W) / 2 + this.back * CAMERA.lookBack; }

  get levelData() {
    if (this.onCourse) return this.course.level;
    if (this.mode === 'custom' || this.sandboxCustom) return this.customLevel;
    return this.isStunt ? this.stunts[this.level - this.data.levels.length] : this.data.levels[this.level];
  }

  /** Endless, and Sandbox's Endless track, are played on a generated course (endless.js). */
  get onCourse() { return this.mode === 'endless' || (this.mode === 'sandbox' && this.sandboxEndless); }

  /** The level's collision world with a thin offset (for wreck pieces and missiles), made when first needed. */
  get thinWorld() { return (this.thin ||= this.makeWorld(3)); }
  /** Sandbox's tumbleweeds' collision world: pushed out by their radius (CRITTERS.weedRadius). */
  get weedWorld() { return (this.weedW ||= this.makeWorld(CRITTERS.weedRadius + 1)); }

  /** Practice's stunt tracks (assets/stunts.json), which come after the nine stages. */
  get stunts() { return this.data.stunts || []; }
  /** Whether this run is on a stunt track. */
  get isStunt() {
    // (a custom stage with no finish line is played like a stunt track)
    if (this.mode === 'custom' || this.sandboxCustom) return !Number.isFinite(this.customLevel?.finish);
    return (this.mode === 'practice' || this.mode === 'sandbox' || this.mode === 'trial') && !this.onCourse && this.level >= this.data.levels.length;
  }
  /** Where this stage's finish line is (px): the stages' own, or a custom stage's. */
  get finishX() { return this.mode === 'custom' || this.sandboxCustom ? this.customLevel.finish : (this.levelData.width - 9) * TILE; }
  /** The name of stage `i` of Practice: "Stage One" ... "Stage Nine", then the stunt tracks. */
  stageName(i) { return i < this.data.levels.length ? STAGE_NAMES[i] : this.stunts[i - this.data.levels.length]?.name ?? ''; }
  get maxCamX() { return this.levelData.width * TILE - this.viewW * this.zoom; }   // N53D4
  get maxCamY() { return this.levelData.height * TILE - this.viewH * this.zoom; }  // o64D4

  saveLook() { this.store.set('truckLook', { ...this.look }); }

  /** Back to the truck you start with. */
  resetLook() { Object.assign(this.look, { body: 0, tyre: 0, hub: 0, paint: 0 }); this.saveLook(); }

  /** Step 'body', 'tyre', 'hub' or 'paint' by `delta`. A new body comes in its own colour. */
  cycleLook(part, delta) {
    const L = this.look;
    L[part] = (L[part] + delta + 6) % 6;
    if (part === 'body') L.paint = L.body;
    this.saveLook();
  }

  /** Flip an on/off option and save it: 'soundOn', 'oneButton', 'classicTricks', 'classicRetro', 'practiceDamage', 'trialRetro', 'dynamicCamera', 'crashCam', 'ghostOn', 'showFps', ... */
  toggle(option) {
    const key = { soundOn: 'sound', oneButton: 'oneButton', classicTricks: 'classicTricks', classicRetro: 'classicRetro', practiceDamage: 'practiceDamage', trialRetro: 'trialRetro', trialTricks: 'trialTricks', customDamage: 'customDamage', customRetro: 'customRetro', dynamicCamera: 'dynamicCamera', crashCam: 'crashCam', ghostOn: 'ghost', showFps: 'showFps', imperial: 'imperial' }[option];
    if (!key) return;
    this[option] = !this[option];
    this.store.set(key, this[option]);
  }

  /** The Controller screen: set `action` to gamepad button i (or put them all back, with no action). */
  setPad(action, i) {
    this.padMap = action ? assignPad(this.padMap, action, i) : defaultPadMap();
    this.padListen = null;
    this.store.set('padMap', this.padMap);
  }

  /** The dynamic camera applies outside 2006 Mode, when switched on. */
  get dynamicCameraActive() { return this.dynamicCamera && !this.rules.retro; }

  /** The crash cam works on a wrecked truck outside 2006 Mode, when switched on. */
  get crashCamActive() { return this.crashCam && !this.rules.retro && !!this.wreck; }

  /** One-button controls apply everywhere (nothing they do is beyond the arrow keys). */
  get oneButtonActive() { return this.oneButton; }

  /** The flip-upright assist is offered in damage-free runs outside 2006 Mode. */
  get uprightAllowed() { return !this.rules.damage && !this.rules.retro; }

  // ---- flow

  /**
   * Classic: the nine stages by the original rules, with tricks or not, in the new view or 2006
   * Mode (as the Classic screen's switches have them, unless given).
   */
  startCampaign({ tricks = this.classicTricks, retro = this.classicRetro } = {}) {
    this.mode = 'campaign';
    this.rules = classicRules({ tricks, retro });
    this.beginRun(0);
  }

  /**
   * The rules for one of Time Trial's tracks (`stage`: one of the nine, rather than a stunt
   * track): the nine stages keep the original ceiling and scrape, as Classic has them.
   */
  trackRules(stage, tricks) {
    const retro = this.trialRetro;
    return { damage: this.practiceDamage, ceiling: stage, scrapeAll: stage, retro, tricks: tricks && !retro };
  }

  startPractice(l) {
    this.mode = 'practice';
    this.rules = this.trackRules(l < this.data.levels.length, true);
    this.beginRun(l);
  }

  startEndless() {
    this.mode = 'endless';
    this.rules = RULES.endless;
    this.newCourse();
    this.bestToBeat = this.bestEndless; // a new best distance is a milestone too
    this.beginRun(0);
  }

  newCourse() {
    if (!this.grammar) this.grammar = buildGrammar(this.data.levels, { collision: this.data.collision });
    this.course = new EndlessCourse(this.grammar, this.data.levels, this.random);
    this.distance = 0; this.distanceBack = 0;
    this.nextMetres = 0; this.nextScore = 0;
    this.milestone = null; this.milestones = [];
  }

  /** Sandbox: fire a missile or jump ('fire', 'jump') at the next step. */
  press(what) { if (this.battle?.opts.weapons && this.screen === 'playing') this.battle.request(what); }

  // ---- the Stage Editor's stages (stages.js)

  /** Read the saved stages again (the editor, in another tab, may have saved more). */
  reloadStages() {
    this.stages = validStages(this.store.get('stages'), this.data.collision.length);
    if (this.stagePick >= this.stages.length) this.stagePick = -1;
    this.stagePage = Math.min(this.stagePage, Math.max(0, Math.ceil(this.stages.length / STAGES_PER_PAGE) - 1));
  }

  /** The Load Stage screen, with the stages read again. */
  openStageLoad() { this.reloadStages(); this.showMenu('stageLoad'); }

  /** A stage from a file (parsed JSON): kept with the others and picked. Returns whether it was a stage. */
  bringInStage(v) {
    const stage = validStage(v, this.data.collision.length);
    if (!stage) return false;
    const { list, index } = addStage(this.stages, stage);
    this.stages = list;
    this.store.set('stages', list);
    this.stagePick = index; this.stagePage = 0;
    return true;
  }

  pickStage(i) { if (i >= 0 && i < this.stages.length) this.stagePick = i; }

  /** Forget saved stage i. */
  deleteStage(i) {
    if (i < 0 || i >= this.stages.length) return;
    this.stages = this.stages.filter((_, k) => k !== i);
    this.store.set('stages', this.stages);
    // Sandbox's track: a stage after this one moves up one; this one goes back to Endless.
    const c = this.sandbox.course, k = this.sandboxBase + i;
    if (c >= k) { this.sandbox.course = c === k ? 0 : c - 1; this.store.set('sandbox', this.sandbox); }
    if (this.stagePick === i) this.stagePick = -1; else if (this.stagePick > i) this.stagePick--;
    this.reloadStages();
  }

  turnStagePage(d) {
    const pages = Math.max(1, Math.ceil(this.stages.length / STAGES_PER_PAGE));
    this.stagePage = (this.stagePage + d + pages) % pages;
  }

  /** Play saved stage i (or `level`, a stage given directly), with the Damage and 2006 Mode switches as set. */
  startCustom(i = this.stagePick, level = null) {
    const stage = level || this.stages[i];
    if (!stage) return;
    this.mode = 'custom';
    this.customIndex = level ? -1 : i;
    this.customLevel = stage;
    // (no ceiling; 2006 Mode scores flips the original way, as Classic does)
    const retro = this.customRetro;
    this.rules = { damage: this.customDamage, retro, flipBonus: retro, tricks: !retro };
    this.beginRun(0);
  }

  /** Sandbox: where its custom stages start in its list of tracks (after Endless, the nine stages and the stunt tracks). */
  get sandboxBase() { return 1 + this.data.levels.length + (this.data.stunts?.length || 0); }
  /** Sandbox: how many tracks it offers (Endless, the nine stages, the stunt tracks, then the stages saved into the game). */
  get sandboxCourses() { return this.sandboxBase + this.stages.length; }
  /** The name of Sandbox track `i` (the stages by number, to keep its list short). */
  sandboxCourseName(i) {
    if (i >= this.sandboxBase) return this.stages[i - this.sandboxBase]?.name ?? '';
    return i === 0 ? 'Endless' : i <= this.data.levels.length ? `Stage ${i}` : this.stageName(i - 1);
  }
  /** Whether this Sandbox run is on a custom stage (played from `customLevel`, like Custom mode's). */
  get sandboxCustom() { return this.mode === 'sandbox' && this.sandboxOnStage; }

  /**
   * Sandbox: the chosen track, with the physics as set (sandbox.js). No damage. Stages keep their
   * finish line; the clock runs from the first landing.
   */
  startSandbox() {
    this.mode = 'sandbox';
    this.rules = RULES.sandbox;
    this.sandboxPick = null;
    if (this.sandbox.course >= this.sandboxCourses) this.sandbox.course = 0;   // a stage since forgotten
    this.sandboxEndless = this.sandbox.course === 0;
    const custom = this.stages[this.sandbox.course - this.sandboxBase] || null;
    this.sandboxOnStage = !!custom;
    if (custom) { this.customLevel = custom; this.customIndex = this.sandbox.course - this.sandboxBase; }
    this.clock = 0;
    if (this.sandboxEndless) { this.newCourse(); this.bestToBeat = 0; }
    this.beginRun(this.sandboxEndless || custom ? 0 : this.sandbox.course - 1);
  }

  /** Sandbox: step setting `key` by `delta` choices (wrapping round), save it, and use it now. */
  stepSandbox(key, delta) {
    const n = key === 'course' ? this.sandboxCourses : SANDBOX_ROW[key].choices.length;
    this.setSandbox(key, (this.sandbox[key] + delta + n) % n);
  }

  /** Sandbox: choose choice `i` of setting `key`, save it, and use it now. */
  setSandbox(key, i) {
    const n = key === 'course' ? this.sandboxCourses : SANDBOX_ROW[key]?.choices.length;
    if (!n || !Number.isInteger(i) || i < 0 || i >= n) return;
    this.sandbox[key] = i;
    this.sandboxPick = null;
    this.store.set('sandbox', this.sandbox);
    if (this.mode === 'sandbox' && this.battle) applySandbox(this);
  }

  /** Sandbox: open (or close, with null) the list of choices for setting `key`. */
  pickSandbox(key) {
    if (key !== null && !SANDBOX_ROW[key]) return;
    if (key === 'course' && this.screen !== 'sandbox') return;
    this.sandboxPick = key;
  }

  /** Sandbox: every setting back to its default. */
  resetSandbox() {
    // (the track too, back to Endless, unless this is mid-run, from the pause menu's Tweaks)
    const course = this.screen === 'sandboxTweaks' ? this.sandbox.course : 0;
    this.sandbox = { ...validSandbox(null), course };
    this.store.set('sandbox', this.sandbox);
    if (this.mode === 'sandbox' && this.battle) applySandbox(this);
  }

  /** Sandbox's slow motion: the share of the usual steps a second that run (1: none). */
  get slowMotion() { return SANDBOX_ROW.slow.choices[this.sandbox.slow]?.[0] ?? 1; }

  /** Sandbox: the pause menu's Tweaks (the settings, during a run). */
  openTweaks() { if (this.screen === 'paused' && this.mode === 'sandbox') this.screen = 'sandboxTweaks'; }
  closeTweaks() { if (this.screen === 'sandboxTweaks') { this.screen = 'paused'; this.pauseStage = 99; this.sandboxPick = null; } }

  /**
   * Time Trial (with Practice in it): a stage (0-8), all nine in a row (TRIAL_ALL), against the
   * clock, or a stunt track (TRIAL_STUNTS + i), for tricks. The switches on its screen choose the
   * rules: Tricks (spotted and scored, or not), Damage and 2006 Mode (which has tricks off). The
   * nine stages have the original ceiling and scrape. The clock runs from when the truck first
   * lands on each stage to its finish line; a time only goes on the board with damage on
   * (`timeCounts`). A stunt track has no finish and no clock: its best trick score is kept
   * instead (with damage on), when the run ends.
   */
  startTrial(track) {
    this.mode = 'trial';
    this.rules = this.trackRules(track < TRIAL_STUNTS, this.trialTricks);
    this.track = track;
    this.clock = 0; this.runStep = 0; this.split = null; this.trialResult = null;
    this.poses = []; this.marks = {};
    const stunt = track >= TRIAL_STUNTS;
    this.ghost = this.ghostOn && !stunt ? loadGhost(this.store.get(`ghost${track}`), track) : null;
    this.ghostT = null;
    this.beginRun(stunt ? this.data.levels.length + track - TRIAL_STUNTS : track === TRIAL_ALL ? 0 : track);
  }

  /** Time Trial: whether this run's time can go on the board (a stage, with damage). */
  get timeCounts() { return this.mode === 'trial' && this.rules.damage && this.track < TRIAL_STUNTS; }
  /** Time Trial: whether this run's trick score can be a stunt track's best. */
  get stuntCounts() { return this.mode === 'trial' && this.track >= TRIAL_STUNTS && this.rules.damage && this.rules.tricks !== false; }

  /** Time Trial: whether there's a track after this one to go on to (the stages, then the stunt tracks, each in turn). */
  get hasNextTrial() {
    if (this.mode !== 'trial') return false;
    return this.track >= TRIAL_STUNTS ? this.track - TRIAL_STUNTS < this.stunts.length - 1 : this.track < this.data.levels.length - 1;
  }
  nextTrial() { if (this.hasNextTrial) this.startTrial(this.track + 1); }

  /** Time Trial on a stunt track: keep the run's score if it's the track's best. Returns whether it was. */
  saveStuntBest() {
    if (!this.stuntCounts || this.stuntSaved) return false;
    this.stuntSaved = true;
    const best = this.stuntBests[this.track] ?? 0;
    this.stuntResult = { score: this.score, best, record: this.score > best };
    if (this.score > best) { this.stuntBests[this.track] = this.score; this.store.set('stuntBests', this.stuntBests); }
    return this.score > best;
  }

  /** Time Trial, each step: the clock, the ghost being recorded and the one being raced. */
  updateTrial() {
    const t = this.truck;
    if (this.landed && this.endTimer === 0 && !this.wreck) this.clock++;
    if (this.runStep % GHOST_EVERY === 0) this.poses.push(this.level, ...t.T.map(Math.round));
    // The clock when the truck first reached each tile column, for the split against a ghost.
    const col = Math.floor(t.T[0] / TILE), m = (this.marks[this.level] ||= []);
    if (this.landed) for (let c = m.length; c <= col; c++) m[c] = this.clock;
    if (this.ghost) {
      this.ghostT = ghostPose(this.ghost, this.runStep, this.level);
      // The split only moves while the clock runs: once over the finish line it stays put.
      const g = this.ghost.marks[this.level];
      if (this.landed && this.endTimer === 0 && !this.wreck && g && g[col] != null && m[col] != null) this.split = m[col] - g[col];
    }
    this.runStep++;
  }

  /** Time Trial: the run is over (finished, not wrecked); keep the time if it's the best. */
  finishTrial() {
    const time = this.clock, best = this.trialBests[this.track] ?? null;
    // (without damage, the time is shown but can't be a record)
    const counts = this.timeCounts;
    const record = counts && (best === null || time < best);
    this.trialResult = { time, best, record, counts };
    if (record) {
      this.trialBests[this.track] = time;
      this.store.set('trialBests', this.trialBests);
      this.store.set(`ghost${this.track}`, saveGhost(this.track, time, this.poses, this.marks));
    }
  }

  beginRun(firstLevel) { // H5D52
    if (this.mode !== 'trial') { this.ghost = null; this.ghostT = null; this.split = null; }
    this.stuntSaved = false; this.stuntResult = null;
    this.battle = null; this.critters = null;
    // Nothing done in Sandbox counts towards the High Scores screen.
    this.stats = this.mode === 'sandbox' ? emptyStats() : this.realStats;
    if (this.mode === 'campaign' || (this.mode === 'trial' && this.track === TRIAL_ALL)) { this.lastLevel = this.data.levels.length - 1; this.level = 0; }
    else { this.level = firstLevel; this.lastLevel = firstLevel; }
    this.score = 0; this.bonus = 0; this.damage = 0;
    this.wrecked = false; this.finished = false;
    this.stats.runs++;
    this.startStage();
  }

  makeWorld(radius = this.truck.wheelRadius) {
    return new CollisionWorld(this.levelData, this.tileTable, radius, { ceiling: !!this.rules.ceiling });
  }

  /**
   * The collision lines of each tile id the level uses. A custom stage may use tiles turned or
   * flipped (walls, ceilings, overhangs: src/tile-forms.js); every other level is the table as is.
   */
  get tileTable() {
    if (this.mode !== 'custom' && !this.sandboxCustom) return this.data.collision;
    if (this.formsFor !== this.levelData) { this.formsFor = this.levelData; this.forms = formTable(this.data.collision, this.levelData); }
    return this.forms;
  }

  startStage() { // u8a62
    this.world = this.makeWorld(); this.thin = null; this.weedW = null;
    this.wreck = null; this.selfWrecked = false;
    this.stuck = 0; this.canUpright = false; this.righting = 0; this.airSteps = 0;
    this.landed = false; // the truck is dropped in at the start; until it lands it isn't driving
    this.uprightLinger = 0; this.trickCooldown = 0;
    const s = this.levelData.start;
    // Your truck's own physics (Sandbox changes them; everywhere else they're the original's).
    Object.assign(this.truck, { power: 1, gravity: 0.11, tiltPower: 1, springK: 0.1 });
    this.truck.reset(s[0], s[1]);
    this.truck.rearWheelRot = 0; this.truck.frontWheelRot = 0;
    this.speedKmh = 0;
    this.altitude = null;
    this.zoom = 1; this.zoomV = 0; this.ground = 0; this.groundV = 0; this.camSpeed = 0; this.camSpeedV = 0;
    this.back = 0; this.backV = 0;
    this.lastFocus = null; this.paceSpeed = 0; this.reversing = 0; this.shiftTotal = [0, 0];
    // Endless (and Sandbox on it) starts near the course's left end, and its first step would add
    // course to the left, moving everything right: do that now, before the camera's placed. (Before
    // 1.24.25 a camera placed first was held at the left end, x = 0, in a wide view, then whipped
    // into place once the course behind the start was there.)
    if (this.onCourse && this.truck.T[0] < 40 * TILE) this.scrollWorld(-ENDLESS_SHIFT);
    const sx = s[0] - this.shiftTotal[0], sy = s[1] - this.shiftTotal[1];   // (the start, moved with it)
    this.camX = Math.min(Math.max(sx - this.camAnchorX, 0), this.maxCamX);       // s4833
    this.camY = sy - this.viewH / 2;
    this.clampCamY();
    this.updateCamera();
    this.ticker = this.mode === 'custom' || this.sandboxCustom ? this.customLevel.name : this.stageName(this.level); this.tickerTimer = 140;   // m2813
    this.endTimer = 0;
    this.score += this.bonus;
    this.bonus = (this.level + 1) * 10000;
    if (this.onCourse) { this.ticker = 'Endless'; this.bonus = 0; }
    if (this.isStunt) this.bonus = 0; // stunt tracks are all about the tricks: no time bonus
    if (this.mode === 'trial' || this.mode === 'sandbox') this.bonus = 0; // the clock (or nothing) is what counts
    if (this.mode === 'sandbox') {
      this.battle = new Battle(this, { weapons: true });
      // (their own random numbers, seeded from the game's: they never change what else happens)
      let seed = Math.floor(this.random() * 2147483646) + 1;
      this.critters = new Critters(() => (seed = (seed * 16807) % 2147483647) / 2147483647);
      this.ticker = `Sandbox  ·  ${this.onCourse ? 'Endless' : this.stageName(this.level)}`;
      applySandbox(this);
    }
    this.flipBonusTimer = 0;
    this.tricks.reset();
    for (const d of this.dirt) d.life = 0;
    this.teleportCount++;
    this.screen = 'playing';
  }

  /** Practice: whether there's a stage after this one to go on to. */
  get hasNextPractice() { return this.mode === 'practice' && this.lastLevel + 1 < this.practiceCount; }
  /** How many stages Practice offers. */
  get practiceCount() { return this.data.levels.length + this.stunts.length; }

  /** Practice: go on to the next stage. */
  nextPractice() { if (this.hasNextPractice) this.startPractice(this.lastLevel + 1); }

  restart() {
    if (this.mode === 'campaign') this.startCampaign({ tricks: !this.rules.flipBonus, retro: this.rules.retro });
    else if (this.mode === 'endless') this.startEndless();
    else if (this.mode === 'sandbox') this.startSandbox();
    else if (this.mode === 'custom') this.startCustom(this.customIndex, this.customIndex < 0 ? this.customLevel : null);
    else if (this.mode === 'trial') { this.saveStuntBest(); this.startTrial(this.track); }
    else this.startPractice(this.lastLevel);
  }

  saveEndlessBest() {
    if (this.metres > this.bestEndless) { this.bestEndless = this.metres; this.store.set('bestEndless', this.bestEndless); }
  }

  /**
   * Endless Mode: metres of course covered so far, both ways (the course goes on for ever to the
   * left too: ground behind the start counts as well).
   */
  get metres() { return Math.floor((this.distance + (this.distanceBack || 0)) * METRES_PER_TILE); }

  /** Endless Mode: score new ground (either way), and scroll the world when the truck nears either end of the window. */
  updateEndless() {
    // (A truck wrecked on purpose still counts the ground its pieces tumble over.)
    const x = this.focus[0];
    const col = Math.floor(x / TILE) + this.course.dropped;
    const add = (cols) => {
      if (this.endTimer === 0) this.score += cols * POINTS_PER_TILE;
      this.stats.endlessMetres += cols * METRES_PER_TILE;
    };
    if (col > this.distance) { add(col - this.distance); this.distance = col; }
    // (behind the start: the opening's first column is column 0)
    if (-col > (this.distanceBack || 0)) { add(-col - (this.distanceBack || 0)); this.distanceBack = -col; }
    if (this.mode === 'endless') this.checkMilestones();
    if (x > (ENDLESS_WIDTH - 40) * TILE) this.scrollWorld(ENDLESS_SHIFT);
    else if (x < 40 * TILE) this.scrollWorld(-ENDLESS_SHIFT);
  }

  /** The distance of Endless milestone `i`: the listed ones, then every MILESTONES.every metres. */
  static milestoneMetres(i) {
    const M = MILESTONES.metres;
    return i < M.length ? M[i] : M[M.length - 1] + (i - M.length + 1) * MILESTONES.every;
  }

  /** Endless: celebrate distances, scores and a new best distance as they're passed. */
  checkMilestones() {
    const found = [];
    while (this.metres >= Game.milestoneMetres(this.nextMetres)) found.push(`${Game.milestoneMetres(this.nextMetres++).toLocaleString('en-US')} m!`);
    const S = MILESTONES.scores;
    while (this.nextScore < S.length && this.score >= S[this.nextScore]) found.push(`${S[this.nextScore++].toLocaleString('en-US')} points!`);
    if (this.bestToBeat > 0 && this.metres > this.bestToBeat) { found.push('New best distance!'); this.bestToBeat = 0; }
    for (const text of found) this.announce(text);
  }

  /**
   * Put news up in big letters (Endless milestones), or queue it behind what's up.
   * `extra` goes with it to the renderer and the sound: { confetti: false, sound: 'wave' }.
   */
  announce(text, extra = null) {
    this.milestoneCount++;
    const item = extra ? { text, ...extra } : text;
    if (this.milestone) this.milestones.push(item);
    else this.milestone = { ...(extra || {}), text, timer: MILESTONE_SHOW, n: this.milestoneCount };
  }

  /** Count down the milestone on screen; the next one waiting comes on once it's been seen a while. */
  tickMilestone() {
    const m = this.milestone;
    if (!m) return;
    m.timer--;
    if (this.milestones.length && m.timer < MILESTONE_SHOW - 60) {
      const next = this.milestones.shift();
      this.milestone = { ...(typeof next === 'string' ? { text: next } : next), timer: MILESTONE_SHOW, n: m.n + 1 };
    }
    else if (m.timer <= 0) this.milestone = null;
  }

  /** Drop `n` columns off the left of the course and move everything left to match (n < 0: the other way). */
  scrollWorld(n) {
    if (n > 0) this.course.scroll(n); else this.course.scrollBack(-n);
    this.shiftWorld(n * TILE, 0);
    this.world = this.makeWorld(); this.thin = null; this.weedW = null;
    // A wreck tumbling across the scroll goes on in the new world.
    if (this.wreck) { this.wreck.wheelWorld = this.world; this.wreck.thinWorld = this.thinWorld; }
  }

  /**
   * A looping track (a stunt track with `loop`): past the second repeat, jump everything back one
   * repeat, left and up. The track is the same there, so nothing on screen changes, and it goes
   * on for ever.
   */
  updateLoop() {
    const L = this.levelData.loop;
    if (!L || this.focus[0] < (L.from + 2 * L.period) * TILE) return;
    this.shiftWorld(L.period * TILE, L.drop * TILE);
  }

  /** Sandbox's birds and tumbleweeds: a step, round the view (a wrecked truck's loose pieces hit them). */
  stepCritters() {
    const z = this.zoom, hw = this.viewW * z / 2, hh = this.viewH * z / 2;
    const view = { cx: this.camX + hw, cy: this.camY + hh, hw, hh };
    this.critters.step(this.wreck ? null : this.truck, view, this.weedWorld, this.thinWorld, this.truck.gravity, this.levelData.height * TILE + 400, (x, y) => this.skyAbove(x, y), this.wreck);
  }

  /**
   * Whether (x, y) is out under the open sky: inside the level's sides, with no tile at all in its
   * column from its own cell up to the top (so not in a pipe, a cave or the ground itself).
   */
  skyAbove(x, y) {
    const L = this.levelData, gx = Math.floor(x / TILE);
    if (gx < 0 || gx >= L.width) return false;
    for (let gy = Math.min(L.height - 1, Math.floor(y / TILE)); gy >= 0; gy--) if (L.tiles[gy][gx]) return false;
    return true;
  }

  /** Move everything (truck, wreck, dirt, camera) left by dx and up by dy. */
  shiftWorld(dx, dy) {
    const move = (A) => { for (let i = 0; i < A.length; i += 2) { A[i] -= dx; A[i + 1] -= dy; } };
    const t = this.truck;
    move(t.T); move(t.P);
    if (t.probePrev) move(t.probePrev);
    if (this.wreck) { move(this.wreck.T); move(this.wreck.P); }
    for (const d of this.dirt) { d.x -= dx; d.y -= dy; }
    if (this.battle) this.battle.shift(dx, dy);
    if (this.critters) this.critters.shift(dx, dy);
    this.camX -= dx; this.camY -= dy;
    if (this.lastFocus) { this.lastFocus[0] -= dx; this.lastFocus[1] -= dy; }
    // How far everything has moved in all (the backdrop moves by where the camera really is).
    this.shiftTotal[0] += dx; this.shiftTotal[1] += dy;
    this.shiftCount++;
    this.lastShift = dx; this.lastShiftY = dy;
  }

  /**
   * Where quitting a run goes: back to its list of stages for Practice and Time Trial, to Classic's
   * screen, to Sandbox's settings, otherwise the title screen.
   */
  get quitScreen() {
    return { campaign: 'classicSelect', practice: 'trialSelect', trial: 'trialSelect', sandbox: 'sandbox', custom: 'stageLoad' }[this.mode] || 'title';
  }

  showMenu(screen) {
    // Leaving an Endless run part-way (quitting from pause, say) still counts its distance.
    if (this.mode === 'endless' && (this.screen === 'playing' || this.screen === 'paused')) this.saveEndlessBest();
    if (this.screen === 'playing' || this.screen === 'paused') {
      this.saveStuntBest();
      // Quitting Classic part-way still counts the points scored so far as a high score.
      if (this.mode === 'campaign' && this.rules.damage) { this.bankTricks(); this.saveBest(this.score); }
      this.saveStats();
    }
    this.stats = this.realStats; // (back from a Sandbox run's throwaway stats)
    this.sandboxPick = null;
    this.padListen = null;
    // The title's truck carries on as it was under the mode picker, and back from it.
    const overTitle = (a, b) => (a === 'title' && b === 'modes') || (a === 'modes' && b === 'title');
    if ((screen === 'title' || screen === 'garage') && !overTitle(this.screen, screen)) this.garageTruck.reset(STAGE_W / 2, 120);
    this.resetConfirm = null;
    this.screen = screen;
    this.teleportCount++;
  }

  saveStats() { this.statsSince = 0; this.store.set('stats', this.realStats); }

  // ---- High Scores: reset (asked, then confirmed once RESET_WAIT steps have passed)

  askReset() { if (this.screen === 'stats') this.resetConfirm = { steps: 0 }; }
  cancelReset() { this.resetConfirm = null; }
  get resetReady() { return !!this.resetConfirm && this.resetConfirm.steps >= RESET_WAIT; }

  /** Clear every best score, best time, ghost and stat. Only once the wait is over. */
  resetScores() {
    if (!this.resetReady) return false;
    this.best = 0; this.bestPlay = 0; this.bestEndless = 0;
    this.trialBests = {}; this.stuntBests = {};
    this.stats = this.realStats = emptyStats();
    for (const k of ['bestScore', 'bestPlay', 'bestEndless']) this.store.set(k, 0);
    this.store.set('trialBests', {}); this.store.set('stuntBests', {});
    for (let t = 0; t < TRIAL_TRACKS; t++) this.store.set(`ghost${t}`, null);
    this.saveStats();
    this.resetConfirm = null;
    return true;
  }

  // ---- the pause menu's Options

  openPauseOptions() { if (this.screen === 'paused') this.screen = 'pauseOptions'; }
  closePauseOptions() { if (this.screen === 'pauseOptions') { this.screen = 'paused'; this.pauseStage = 99; } }

  /** Knock the title screen's truck up from (x, y), in its own coordinates. Returns whether it was hit. */
  kickTitleTruck(x, y) {
    const t = this.garageTruck;
    if ((this.screen !== 'title') || !t.hits(x, y)) return false;
    t.kick(x, y);
    return true;
  }

  // ---- the Esc easter egg: wreck the truck on purpose

  /** Wrecking on purpose works outside 2006 Mode (which has no ragdoll wreck). */
  get selfWreckAllowed() { return !this.rules.retro; }

  /** Esc pauses instead of wrecking in Classic and in a Time Trial run that could set a time. */
  get escPauses() { return this.mode === 'campaign' || this.timeCounts; }

  /**
   * Whether a truck wrecked on purpose can still finish the stage, its body rolling over the line:
   * not in Classic or Time Trial (as a truck wrecked by damage can't).
   */
  get selfWreckFinishes() { return !['campaign', 'trial', 'practice'].includes(this.mode); }

  /**
   * Wreck the truck now: it comes apart as a damage wreck does, but there's no game over. With
   * damage on, the loose cab takes damage whenever it touches the ground (any side of it) until
   * it's wrecked for real; without, the pieces tumble until you leave. If the body rolls over the
   * finish line, the stage still counts, outside Classic and Time Trial (`selfWreckFinishes`).
   * Returns false if it can't (already wrecked, over the finish line, or in 2006 Mode).
   */
  selfWreck() {
    if (!this.selfWreckAllowed || this.screen !== 'playing' || this.wreck || this.endTimer > 0) return false;
    this.bankTricks();
    this.wreck = new Wreck(this.truck, this.world, this.thinWorld, this.look.body);
    this.selfWrecked = true;
    this.tricks.reset();
    this.canUpright = false; this.righting = 0; this.stuck = 0;
    this.stats.selfWrecks++;
    return true;
  }

  bankTricks() {
    const paid = this.tricks.bank();
    if (paid > 0) this.payTricks(paid);
  }

  /** What the camera follows: the truck, or the body of a wrecked one. */
  get focus() { return this.wreck ? this.wreck.centre : [this.truck.T[0], this.truck.T[1]]; }

  updateCamera() { // T5933 + w6015
    const crash = this.crashCamActive ? this.crashFrame() : null;
    // The crash cam eases in from the driving camera over CRASH_CAM.easeIn steps: what it frames
    // moves from the body to the middle of the pieces, and its zoom starts slowly.
    if (crash) this.crashSteps++; else this.crashSteps = 0;
    const ease = crash ? smoothstep(this.crashSteps / CRASH_CAM.easeIn) : 0;
    // What the camera follows jumps from the truck's chassis to the wreck's body when it's
    // wrecked: carry the difference over, and let it fade as the crash cam eases in.
    if (crash && this.crashSteps === 1) {
      const c = this.wreck.centre;
      this.crashFrom = [this.truck.T[0] - c[0], this.truck.T[1] - c[1]];
    }
    let [bx, by] = this.focus;
    // How fast what it follows is moving (px a step), for keeping pace at high speed (below).
    // (Not across the moment the truck is wrecked: what's followed jumps to the wreck's body.)
    const lf = this.lastFocus?.[2] === !!this.wreck ? this.lastFocus : null;
    const fvx = lf ? bx - lf[0] : 0, fvy = lf ? by - lf[1] : 0;
    this.lastFocus = [bx, by, !!this.wreck];
    if (crash && this.crashFrom) { bx += this.crashFrom[0] * (1 - ease); by += this.crashFrom[1] * (1 - ease); }
    const fx = crash ? bx + (crash.centre[0] - bx) * ease : bx;
    const fy = crash ? by + (crash.centre[1] - by) * ease : by;
    // (its zoom may change faster the further out it is, so a flying wheel stays in view)
    if (crash) {
      const z0 = this.zoom, cx = this.camX + this.viewW * z0 / 2, cy = this.camY + this.viewH * z0 / 2;
      // Never zoomed in so far that a piece is out of the view as it is now (the camera trails
      // the pieces a little; a wheel that shoots off pulls it out at once). The zoom eases towards
      // whichever is further out, so the two never pull against each other.
      const cover = Math.min(CRASH_CAM.maxZoom, this.coverZoom(cx, cy));
      this.zoomTo(Math.max(crash.zoom, cover), CRASH_CAM.maxRate * this.zoom * ease);
      // (that keeping-in-view eases in too, or the first moment of a wreck could snap the zoom out)
      this.zoom = Math.min(CRASH_CAM.maxZoom, Math.max(this.zoom, z0 + (cover - z0) * ease));
      // zoom about the view's middle
      this.camX -= this.viewW * (this.zoom - z0) / 2;
      this.camY -= this.viewH * (this.zoom - z0) / 2;
    }
    else if (this.dynamicCameraActive) this.updateZoom();
    else { this.zoom = 1; this.back = 0; this.backV = 0; }
    // The original camera: it keeps the truck 150 from the left and halfway down, moving a fifth
    // of the way there each step, at most a tile. The dynamic camera is the same with the frame
    // pulled back: distances on the stage scale with the zoom, so on screen it behaves alike.
    const z = this.zoom;
    // The original camera moves at most a tile a step. Outside 2006 Mode the truck can go faster
    // than that (the stunt tracks), so there the limit rises to keep up with it.
    const t = this.truck;
    const lim = this.rules.retro ? TILE * z : Math.max(TILE * z, 1.5 * Math.hypot(t.T[0] - t.P[0], t.T[1] - t.P[1]));
    // (The crash cam keeps the pieces in the middle.)
    const anchorX = this.camAnchorX + (this.viewW / 2 - this.camAnchorX) * ease;
    // The original follows a fifth of the way each step, so it trails five steps' travel behind:
    // fine at the original's speeds, but at Sandbox's (a boost, no gravity) the truck would leave
    // the screen. Outside 2006 Mode, past 1.5 PACE_FROM px a step it follows a bigger share, so the
    // trail never gets longer than at that speed. The share goes by the speed alone, smoothed (not
    // the direction): going round a loop fast, the camera then follows the circle smoothly, where
    // pushing it along with a smoothed velocity (as before 1.24.15) lagged the turn and wobbled.
    let k = 0.2;
    if (!this.rules.retro) {
      const sp = Math.hypot(fvx, fvy);
      if (sp < 400) this.paceSpeed += (sp - this.paceSpeed) * 0.1;   // (not a jump: a world shift)
      k = Math.max(0.2, this.paceSpeed / (this.paceSpeed + 8 * PACE_FROM));
    }
    const dx = Math.max(Math.min((fx - anchorX * z - this.camX) * k, lim), -lim);
    const dy = Math.max(Math.min((fy - this.viewH * z / 2 - this.camY) * k, lim), -lim);
    this.camX = Math.min(Math.max(this.camX + dx, 0), this.maxCamX);
    this.camY += dy;
    this.clampCamY();
  }

  /**
   * 2006 Mode's camera stays inside the level, as the original's did. Elsewhere it follows the
   * truck up and down wherever it goes: below the level the renderer keeps drawing dirt (every
   * column of every stage ends in solid dirt), and above it there's sky, unless the level has the
   * invisible ceiling: then the camera stops there, so it never shows where the truck can't go.
   */
  clampCamY() {
    if (this.rules.retro) this.camY = Math.min(Math.max(this.camY, 0), this.maxCamY);
    else if (this.rules.ceiling) this.camY = Math.max(this.camY, 0);
  }

  /**
   * The crash cam's frame: the middle of all the wreck's pieces, and the zoom that shows them all
   * with a margin, up to CRASH_CAM.maxZoom. Spread further than that, it stays on their middle,
   * where it would be if it could zoom out further, so it doesn't jump between pieces.
   */
  crashFrame() {
    const W = this.wreck.T;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < W.length; i += 2) {
      x0 = Math.min(x0, W[i]); x1 = Math.max(x1, W[i]); y0 = Math.min(y0, W[i + 1]); y1 = Math.max(y1, W[i + 1]);
    }
    const m = 2 * CRASH_CAM.margin;
    const fit = Math.max(1, (x1 - x0 + m) / this.viewW, (y1 - y0 + m) / this.viewH);
    return { centre: [(x0 + x1) / 2, (y0 + y1) / 2], zoom: Math.min(CRASH_CAM.maxZoom, fit) };
  }

  /** The zoom that shows every piece of the wreck (with the margin) in a view centred on (cx, cy). */
  coverZoom(cx, cy) {
    const W = this.wreck.T, m = CRASH_CAM.margin;
    let z = 1;
    for (let i = 0; i < W.length; i += 2) {
      z = Math.max(z, (Math.abs(W[i] - cx) + m) / (this.viewW / 2), (Math.abs(W[i + 1] - cy) + m) / (this.viewH / 2));
    }
    return z;
  }

  /** Move the zoom towards `target` on its spring, at most `maxRate` a step. */
  zoomTo(target, maxRate) {
    const w = 0.06;
    let v = this.zoomV + w * w * (target - this.zoom) - 2 * w * this.zoomV;
    v = Math.max(-maxRate, Math.min(maxRate, v));
    this.zoom = Math.max(1, this.zoom + v); this.zoomV = v;
  }

  /** How far below the point (x, y) the ground is (a wheel centre's resting height), up to `max`. */
  groundBelow(x, y, max = 1000) {
    const h = this.world.down(x, y, y + max);
    return h ? Math.max(0, h.y - y) : max;
  }

  /** The dynamic camera: pull back for sustained speed and for time spent high above the ground. */
  updateZoom() {
    const C = CAMERA, t = this.truck;
    const smoothstep = (v, a, b) => { const x = Math.max(0, Math.min(1, (v - a) / (b - a))); return x * x * (3 - 2 * x); };
    // A critically damped spring: no overshoot, and no sudden starts or stops.
    const spring = (x, v, to, w) => { v += w * w * (to - x) - 2 * w * v; return [x + v, v]; };
    let speed = 0, height = 0, backwards = 0;
    if (!this.wreck && this.landed) { // a wreck: close in on it. Being dropped in at the start doesn't count.
      speed = Math.hypot(t.T[0] - t.P[0], t.T[1] - t.P[1]);
      // Reversing: moving against the way the truck faces, as it was last on the ground (not just
      // moving left: round a loop, upside down along its top, it's going forwards; before 1.24.15
      // that swung the frame back and forth every time round; and a flip doesn't count).
      if (this.airSteps === 0) {
        // (the way it faces: from the rear wheel to the front one)
        const fx = t.T[4] - t.T[2], fy = t.T[5] - t.T[3], fl = Math.hypot(fx, fy) || 1;
        this.reversing = -((t.T[0] - t.P[0]) * fx + (t.T[1] - t.P[1]) * fy) / fl;
      }
      backwards = this.reversing || 0;
      // Height fades in over the first second in the air, so bumps and hops hardly count. Look
      // down from the wheel centres, which are always clear of the ground.
      const air = smoothstep(this.airSteps, C.airFrom, C.airTo);
      if (air > 0) height = air * Math.min(this.groundBelow(t.T[2], t.T[3]), this.groundBelow(t.T[4], t.T[5]));
    }
    [this.camSpeed, this.camSpeedV] = spring(this.camSpeed, this.camSpeedV, speed, C.speedW);
    [this.ground, this.groundV] = spring(this.ground, this.groundV, height, C.heightW);
    this.ground = Math.max(0, this.ground);
    const ramp = (v, a, b) => Math.max(0, Math.min(1, (v - a) / (b - a)));
    const target = Math.min(C.maxZoom, 1
      + ramp(this.camSpeed, C.speedFrom, C.speedTo) * C.speedZoom
      + ramp(this.ground, C.heightFrom, C.heightTo) * C.heightZoom);
    let [z, v] = spring(this.zoom, this.zoomV, target, C.zoomW);
    v = Math.max(-C.maxRate, Math.min(C.maxRate, v));
    this.zoom = Math.max(1, this.zoom + v); this.zoomV = v;
    // Reversing: ease the frame back, slowly, and only as far as lookBack.
    [this.back, this.backV] = spring(this.back, this.backV, ramp(backwards, C.backFrom, C.backTo), C.backW);
    this.back = Math.max(0, Math.min(1, this.back));
  }

  spawnDirt(x, y, vx, vy) { // X7381
    if (this.dirtCooldown !== 0) { this.dirtCooldown--; return; }
    this.dirtCooldown = Math.ceil(this.random() * 5) + 2;
    for (const d of this.dirt) {
      if (d.life === 0) {
        d.life = 50; d.x = x; d.y = y; d.vx = vx; d.vy = vy;
        d.frame = Math.floor(this.random() * 8);
        d.scale = (25 + this.random() * 50) / 100;
        d.alpha = 1;
        return;
      }
    }
  }

  kickDirt(spin, wheel, n) { // T77F5 (one wheel)
    this.kickDirtAt(this.truck.T[wheel * 2], this.truck.T[wheel * 2 + 1], spin, n);
  }

  /** A wheel centred at (cx, cy), spinning `spin` degrees a step, on ground with normal n: dirt off its tyre. */
  kickDirtAt(cx, cy, spin, n) {
    let s = Math.max(Math.min(spin, 10), -10);
    if (Math.abs(s) <= 5) return;
    s *= 0.3;
    const x = cx - n[0] * this.truck.wheelRadius;
    const y = cy - n[1] * this.truck.wheelRadius;
    const a = (-10 - this.random() * 35) * 0.017453292519943295;
    const c = Math.cos(a), sn = Math.sin(a);
    this.spawnDirt(x, y, (n[0] * c - n[1] * sn) * s, (n[0] * sn + n[1] * c) * Math.abs(s));
  }

  /**
   * Outside 2006 Mode: the cab or body scraping along the ground at (x, y) (ground normal (nx, ny)),
   * moving at (vx, vy) px a step, throws dirt up off the ground and on the way it's going.
   */
  scrapeDirt(x, y, nx, ny, vx, vy) {
    const sp = Math.hypot(vx, vy);
    if (sp < SCRAPE_DIRT_FROM) return;
    const k = Math.min(sp, 12) * 0.3, up = 1 + this.random() * 1.6;
    this.spawnDirt(x, y, vx / sp * k + nx * up + (this.random() - 0.5), vy / sp * k + ny * up);
  }

  updateDirt() { // e4a81
    for (const d of this.dirt) {
      if (d.life === 0) continue;
      d.life--;
      if (d.life === 0) continue;
      if (d.life < 10) d.alpha = d.life / 10;
      d.x += d.vx; d.y += d.vy; d.vy += 0.1;
    }
  }

  /**
   * The keys the truck sees. With one-button controls there's one button (Space, the up arrow, or
   * holding the touch screen): it drives on the ground and tilts back in the air. Nothing else
   * drives or tilts. With both wheels down, tipped past BALANCE_ANGLE, it also tilts back towards level.
   */
  driveKeys() {
    const k = this.keys;
    if (!this.oneButtonActive) return k;
    const one = k.one || k.up;
    const air = this.airSteps >= ONE_BUTTON_AIR;
    if (air) return { ...k, up: false, down: false, left: one, right: false };
    // On the ground, the balance assist (BALANCE_ANGLE) leans the truck back towards level.
    const t = this.truck, tilt = Math.atan2(t.T[5] - t.T[3], t.T[4] - t.T[2]) * 180 / PI; // clockwise
    const both = one && t.rearContact && t.frontContact;
    const left = both && tilt > BALANCE_ANGLE;
    const right = both && tilt < -BALANCE_ANGLE;
    return { ...k, up: one, down: false, left, right };
  }

  /**
   * One step of your truck. `hidden`: it's wrecked (Classic with tricks off), and its pieces are
   * what's shown, but the whole truck still drives on unseen for the moments before the game-over
   * box, as the original's did, so a flip it lands still scores just as it would have.
   */
  stepTruck(w, hidden = false) { // V7B33
    const t = this.truck;
    t.integrate();
    t.rearContact = false; t.frontContact = false; t.rearGround = false; t.frontGround = false;
    t.wallsCount = !!this.rules.flipBonus;
    for (let i = 0; i < 2; i++) { t.constrain(); t.collideWheels(w); }
    // (Except with the original scoring, a wheel against an invisible side wall is still in the air.)
    const down = t.rearDown || t.frontDown;
    // The longest jump (not the drop in at the start, before the truck has landed).
    if (!hidden && down && this.landed && this.airSteps > this.stats.maxAir) this.stats.maxAir = this.airSteps;
    this.airSteps = down ? 0 : this.airSteps + 1;
    if (this.airSteps === 0) this.landed = true;
    const keys = this.driveKeys();
    t.drive(keys);
    t.spinWheels();
    if (!hidden && t.rearContact) this.kickDirt(t.rearSpin, 1, t.rearN);
    if (!hidden && t.frontContact) this.kickDirt(t.frontSpin, 2, t.frontN);
    t.tilt(keys);
    const type = t.probeBody(w);
    // The cab (the truck above its wheels) is touching the ground. Ground under the body is the
    // chassis bottoming out: by the original scrape (scrapeAll) it counts too, otherwise not.
    const cab = type !== null && type !== 1;
    const under = cab && this.underside(t);
    const touching = cab && (this.rules.scrapeAll || !under);
    if (!hidden) this.scraping = touching; // heard even after the finish line
    if (touching && !hidden && !this.rules.retro) {
      const h = t.probeHit, B = w.offset ?? 0;
      this.scrapeDirt(h.x - h.nx * B, h.y - h.ny * B, h.nx, h.ny, t.T[0] - t.P[0], t.T[1] - t.P[1]);
    }
    // It only damages the truck or bails a chain before the stage is over. (Bottoming out never
    // bails a chain.)
    const scraped = touching && this.endTimer === 0;
    const bailed = cab && !under && this.endTimer === 0;
    if (scraped && this.rules.damage) this.damage = Math.min(1000, this.damage + 6);
    const flip = t.trackFlip();
    if (this.rules.flipBonus) {
      // The original flip bonus: a landed flip's degrees, paid at once while the time bonus runs.
      if (flip !== null && this.bonus !== 0) {
        this.flipBonus = flip; this.flipBonusTimer = 70;
        this.score += flip;
      }
      t.updateBodyRot();
      return;
    }
    t.updateBodyRot();
    // Flips and the other tricks are scored in chains by TrickTracker. A flip still pays the
    // original game's points (its degrees), as part of its chain.
    // Tricks score while the time bonus is running (as flips always did), or all run in Endless.
    // (Time Trial's stages have no time bonus: there, tricks score all run, when they're on.)
    const scoring = (this.onCourse || this.isStunt || this.bonus !== 0 || this.mode === 'sandbox' || this.mode === 'trial') && this.endTimer === 0;
    if (this.rules.tricks === false) {
      // Tricks switched off (Time Trial): none are watched for.
    } else if (this.righting > 0 || this.trickCooldown > 0) {
      // A flip upright isn't a trick: tricks aren't watched for until the truck has been back on
      // its wheels for a moment, and then the trick tracker starts afresh.
      if (this.righting === 0 && (t.rearContact || t.frontContact) && --this.trickCooldown === 0) this.tricks.reset();
    } else {
      const paid = this.tricks.step(t, flip, bailed, scoring);
      if (paid > 0) this.payTricks(paid);
    }
    if (this.uprightAllowed) this.updateStuck(touching);
  }

  /** Whether what the roof probe touched is under the truck's body rather than above or beside it. */
  underside(t) {
    const h = t.probeHit;
    if (!h) return false;
    const r = t.bodyRot * PI / 180;
    return h.nx * Math.sin(r) - h.ny * Math.cos(r) > UNDERSIDE; // normal . the truck's up
  }

  // ---- flip-upright assist (damage-free runs outside 2006 Mode)

  /** Watch for the truck being stuck: on its roof or side, or with the cab dragging, for a while. */
  updateStuck(cabTouching) {
    const t = this.truck;
    if (this.righting > 0) { this.stepRighting(); return; }
    // High in the air, upside down isn't stuck (before 1.24.24 a long tumble or a boosted climb
    // counted, so Recover came up in the sky): no offer more than 50 m above the ground.
    const high = Math.min(this.groundBelow(t.T[2], t.T[3], UPRIGHT_HEIGHT + 1),
      this.groundBelow(t.T[4], t.T[5], UPRIGHT_HEIGHT + 1)) > UPRIGHT_HEIGHT;
    if (high) { this.stuck = 0; this.canUpright = false; this.uprightLinger = 0; return; }
    const bad = cabTouching || Math.abs(t.bodyRot) > 100;
    this.stuck = bad ? this.stuck + 1 : Math.max(0, this.stuck - 3);
    if (this.stuck >= STUCK_STEPS) { this.canUpright = true; this.uprightLinger = UPRIGHT_LINGER; }
    // Once offered, the button stays a few seconds after the truck stops looking stuck.
    else if (this.canUpright && !bad && --this.uprightLinger <= 0) this.canUpright = false;
  }

  /** Flip the truck back onto its wheels: hop it up and turn it over in the air. */
  upright() {
    if (!this.canUpright || this.righting > 0 || this.screen !== 'playing') return false;
    const t = this.truck;
    for (let i = 0; i < 10; i += 2) { t.P[i] = t.T[i]; t.P[i + 1] = t.T[i + 1] + 4.2; }
    this.righting = RIGHTING_STEPS;
    this.canUpright = false;
    this.uprightLinger = 0;
    this.stuck = 0;
    this.tricks.reset();
    this.trickCooldown = TRICK_COOLDOWN;
    this.lastRot = t.bodyRot;
    return true;
  }

  stepRighting() {
    const t = this.truck;
    const DEG = PI / 180;
    const wrap = (a) => ((a + 540) % 360) - 180;
    const err = wrap(t.bodyRot);
    const spin = wrap(t.bodyRot - this.lastRot) * DEG;
    this.lastRot = t.bodyRot;
    const target = Math.max(-0.13, Math.min(0.13, -err * DEG * 0.12));
    t.addSpin((target - spin) * 0.35);
    // lighten gravity for the first part of the hop, so it has time to turn over
    if (this.righting > RIGHTING_STEPS - 40) for (let i = 1; i < 10; i += 2) t.P[i] += 0.07;
    this.righting--;
    if (Math.abs(err) < 6 && (t.rearContact || t.frontContact)) this.righting = 0;
  }

  payTricks(points) {
    this.flipBonus = points; this.flipBonusTimer = 105;
    this.score += points;
  }

  checkStageEnd() { // P5B13
    if (this.endTimer > 0) {
      this.endTimer--;
      if (this.endTimer === 0) this.finishStage();
      return;
    }
    // The stunt tracks have no finish: they're for playing on.
    // (A truck wrecked on purpose finishes if its body gets over the line, outside Classic and Time Trial.)
    const canFinish = !this.selfWrecked || this.selfWreckFinishes;
    if (!this.onCourse && !this.isStunt && canFinish && this.focus[0] >= this.finishX) {
      this.ticker = 'Stage Complete !'; this.tickerTimer = 140; this.endTimer = 210;
      this.bankTricks(); // a chain still going at the finish line is paid out
      // Classic: the stage counts as beaten now, so quitting before the next one starts keeps it.
      if (this.mode === 'campaign' && this.damage < 1000 && this.level + 1 > this.stats.classicStage) {
        this.stats.classicStage = this.level + 1;
        this.saveStats();
      }
    }
    if (this.damage === 1000 && this.rules.damage) {
      this.ticker = 'Your truck is wrecked - Game over !'; this.tickerTimer = 140; this.endTimer = 210;
      if (!this.rules.retro) {
        // The truck comes apart and collapses; the pieces tumble for a moment before the game-over
        // screen. (One wrecked on purpose is in pieces already.) Classic keeps the original's
        // 3 s before it, as the time bonus still left then is added to the score.
        if (!this.wreck) this.wreck = new Wreck(this.truck, this.world, this.thinWorld, this.look.body);
        if (this.mode !== 'campaign') this.endTimer = 160;
        this.tricks.reset();
      }
    }
  }

  finishStage() { // V9B62 / J7F52
    for (const d of this.dirt) d.life = 0;
    const isWrecked = this.damage === 1000;
    if (isWrecked) this.stats.wrecks++; else this.stats.stages++;
    if (this.mode === 'campaign' && !isWrecked) this.stats.classicStage = Math.max(this.stats.classicStage, this.level + 1);
    if (this.level === this.lastLevel || isWrecked) {
      this.score += this.bonus;
      if (this.mode === 'campaign' && !isWrecked) this.score += 100000;
      this.bonus = 0;
      this.wrecked = isWrecked;
      this.finished = !isWrecked;
      this.lastScore = this.score;
      if (this.mode === 'endless') this.saveEndlessBest();
      else if (this.mode === 'trial') { if (this.isStunt) this.saveStuntBest(); else if (!isWrecked) this.finishTrial(); }
      else if (this.rules.damage && !this.isStunt && this.mode !== 'custom') this.saveBest(this.score);
      this.restartLatch = true;
      this.screen = 'gameOver';
      this.saveStats();
    } else {
      this.level++;
      this.startStage();
    }
  }

  /** The best score for the current rules (Classic, and Classic with tricks, are kept apart). */
  get bestForRules() { return this.rules.flipBonus ? this.best : this.bestPlay; }

  saveBest(score) {
    if (this.rules.flipBonus) { if (score > this.best) { this.best = score; this.store.set('bestScore', score); } }
    else if (score > this.bestPlay) { this.bestPlay = score; this.store.set('bestPlay', score); }
  }

  /** Endless Mode: stop here and show the result (from the pause menu). */
  endRun() {
    if (this.mode !== 'endless' || (this.screen !== 'playing' && this.screen !== 'paused')) return;
    this.bankTricks();
    for (const d of this.dirt) d.life = 0;
    this.lastScore = this.score;
    this.wrecked = false; this.finished = true;
    this.saveEndlessBest();
    this.saveStats();
    this.restartLatch = true;
    this.screen = 'gameOver';
  }

  /** Advance one 1/70 s frame. */
  step() {
    if (this.battle) this.battle.events.length = 0;
    if (this.critters) this.critters.events.length = 0;
    switch (this.screen) {
      case 'playing':
        if (!this.world) return;
        if (this.wreck) this.stepWreck(); else this.stepTruck(this.world);
        this.capSpeed();
        if (this.battle) this.battle.step();
        if (this.critters) this.stepCritters();
        if (this.mode === 'sandbox') { stepTraffic(this); if (this.landed && this.endTimer === 0 && !this.wreck) this.clock++; }
        this.updateSpeedometer();
        this.stats.driveSteps++;
        if (++this.statsSince >= STATS_SAVE_EVERY) this.saveStats();
        this.tickMilestone();
        if (this.keys.upright) this.upright();
        if (this.onCourse) this.updateEndless();
        else this.updateLoop();
        if (!this.wreck && !this.rules.ceiling) this.keepInside();
        this.updateCamera();
        this.updateAltitude();
        this.updateDirt();
        if (this.mode === 'trial') this.updateTrial();
        this.checkStageEnd();
        if (this.tickerTimer > 0) this.tickerTimer--;                 // o4a13
        this.bonus = Math.max(0, this.bonus - 1);                     // D9923
        if (this.flipBonusTimer > 0) this.flipBonusTimer--;
        if (this.screen === 'playing' && this.keys.pause) { this.screen = 'paused'; this.pauseStage = 0; }
        break;
      case 'paused':
        // P3562 -> q4662 -> R5762 -> i6e52: release, press, release.
        if (this.pauseStage === 99) { if (this.keys.pause) this.pauseStage = 2; }   // paused by a tap
        else if (this.pauseStage === 0) { if (!this.keys.pause) this.pauseStage = 1; }
        else if (this.pauseStage === 1) { if (this.keys.pause) this.pauseStage = 2; }
        else if (!this.keys.pause) this.screen = 'playing';
        break;
      case 'garage':
        this.garageTruck.garageStep();
        break;
      case 'stats':
        if (this.resetConfirm) this.resetConfirm.steps++;
        break;
      case 'title':
      case 'modes':
        this.garageTruck.titleStep();
        break;
      case 'gameOver':
        // A wrecked truck's pieces keep tumbling behind the game-over box.
        if (this.wreck) { this.wreck.step(); this.updateCamera(); }
        if (this.battle) this.battle.step();
        if (!this.keys.restart) this.restartLatch = false;
        else if (!this.restartLatch) this.restart();
        break;
      default:
        break;
    }
  }

  /**
   * Keep your truck between the level's side walls. The walls only reach the top of the level, and
   * without the ceiling, so a truck high enough (Sandbox's boost, low gravity) could
   * otherwise fly over them, and one hitting a wall fast could leave its body on the far side.
   * Pushed back in, it loses its speed into the wall. Inside, it never does anything.
   */
  keepInside() {
    const t = this.truck, T = t.T, P = t.P, W = this.levelData.width * TILE, B = this.world.offset;
    let dx = 0;
    for (let i = 0; i < 10; i += 2) {
      const m = i === 2 || i === 4 ? B : 0;   // wheel centres stay a radius in, as at the walls
      dx = Math.max(dx, m - T[i]);
      dx = Math.min(dx, W - m - T[i]);
    }
    if (dx === 0) return;
    for (let i = 0; i < 10; i += 2) {
      T[i] += dx; P[i] += dx;
      if ((T[i] - P[i]) * dx < 0) P[i] = T[i];   // moving out: stop
    }
    t.probePrev = null;
  }

  /**
   * Classic with tricks off, wrecked by damage: the whole truck drives on unseen behind its pieces
   * until the game-over box, as the original's did, so its score is just what the original's was.
   */
  get hiddenTruck() { return this.rules.flipBonus && !this.selfWrecked && !!this.wreck; }

  /** The wrecked truck's pieces, and (wrecked on purpose, with damage on) the damage to its cab. */
  stepWreck() {
    this.wreck.step();
    if (this.hiddenTruck) this.stepTruck(this.world, true);
    // Dirt: off the loose wheels' tyres as they spin on the ground, and from the body scraping along.
    const W = this.wreck, T = W.T, P = W.P;
    W.wheels.forEach((wh, n) => {
      const h = W.wheelHit?.[n];
      if (h) this.kickDirtAt(T[wh.p * 2], T[wh.p * 2 + 1], wh.spin, [h.nx, h.ny]);
    });
    if (W.bodyHit) {
      const { i, h } = W.bodyHit, B = this.thinWorld.offset;
      this.scrapeDirt(h.x - h.nx * B, h.y - h.ny * B, h.nx, h.ny, T[i * 2] - P[i * 2], T[i * 2 + 1] - P[i * 2 + 1]);
    }
    if (this.selfWrecked && this.rules.damage && this.endTimer === 0 && this.wreck.bodyTouching) {
      this.damage = Math.min(1000, this.damage + SELF_WRECK_DAMAGE);
    }
  }

  /**
   * The speedometer reads the speed of the truck's centre of mass, smoothed so it doesn't flicker;
   * a wreck, and a truck still being dropped in at the start, read 0. (The chassis point, which
   * the camera follows, sits below the centre of mass, so while the truck turns over in the air
   * it swings around it: its speed would rise and fall with each turn.)
   */
  updateSpeedometer() {
    const t = this.truck;
    // (An Esc wreck reads its body's speed: you meant it, so you'll want to see how fast it goes.)
    const raw = this.wreck ? (this.selfWrecked ? this.wreck.bodySpeed * KMH_PER_PX_STEP : 0)
      : !this.landed ? 0 : t.speed * KMH_PER_PX_STEP;
    this.speedKmh += (raw - this.speedKmh) * 0.15;
    if (!this.wreck && this.landed) {
      this.stats.topSpeed = Math.max(this.stats.topSpeed, this.speedKmh);
      if (this.airSteps === 0) this.stats.distance += t.speed * METRES_PER_TILE / TILE;
    }
  }

  /**
   * Nothing goes faster than MAX_SPEED: your truck as a whole (its points keep their speeds
   * relative to each other), and a wreck's pieces each. Only Sandbox's boost and gravity get near.
   */
  capSpeed() {
    const cap = (T, P, whole) => {
      if (whole) {
        let vx = 0, vy = 0;
        for (let i = 0; i < T.length; i += 2) { vx += T[i] - P[i]; vy += T[i + 1] - P[i + 1]; }
        const n = T.length / 2, v0 = Math.hypot(vx / n, vy / n), loss = dragLoss(v0);
        // (the drag slows the whole truck alike, leaving how it spins alone)
        if (loss) for (let i = 0; i < T.length; i += 2) { P[i] += vx / n / v0 * loss; P[i + 1] += vy / n / v0 * loss; }
        const v = v0 - loss;
        if (v <= MAX_SPEED) return;
        const k = MAX_SPEED / v;
        for (let i = 0; i < T.length; i++) P[i] = T[i] - (T[i] - P[i]) * k;
        return;
      }
      for (let i = 0; i < T.length; i += 2) {
        const v0 = Math.hypot(T[i] - P[i], T[i + 1] - P[i + 1]), loss = dragLoss(v0);
        if (loss) { P[i] += (T[i] - P[i]) / v0 * loss; P[i + 1] += (T[i + 1] - P[i + 1]) / v0 * loss; }
        const v = v0 - loss;
        if (v > MAX_SPEED) { const k = MAX_SPEED / v; P[i] = T[i] - (T[i] - P[i]) * k; P[i + 1] = T[i + 1] - (T[i + 1] - P[i + 1]) * k; }
      }
    };
    if (this.wreck) cap(this.wreck.T, this.wreck.P, false);
    if (!this.wreck || this.hiddenTruck) cap(this.truck.T, this.truck.P, true);
  }

  /**
   * The altimeter (outside 2006 Mode): how high the truck is above the ground under it, in metres,
   * while that ground is out of sight below the view; otherwise null. (With no ground under it at
   * all, past a level's side, also null.)
   */
  updateAltitude() {
    this.altitude = null;
    if (this.rules.retro || (this.wreck && !this.selfWrecked) || !this.landed) return;
    // (After an Esc wreck, from its body.)
    const t = this.truck, [x, y] = this.wreck ? this.wreck.centre : [(t.T[2] + t.T[4]) / 2, Math.min(t.T[3], t.T[5])];
    const bottom = this.camY + this.viewH * this.zoom;
    if (y > bottom) return;
    // (from just below the view's bottom edge: ground any nearer would be in sight)
    const max = this.levelData.height * TILE + 200 - y;
    if (max <= 0) return;
    const h = this.world.down(x, Math.max(y, bottom - this.world.offset), y + max);
    if (!h || h.y < bottom - this.world.offset) return;
    this.altitude = Math.max(0, (h.y - y) / TILE * METRES_PER_TILE);
  }

  /** Toggle pause directly (for touch/gamepad buttons, which are taps rather than held keys). */
  togglePause() {
    if (this.screen === 'playing') { this.screen = 'paused'; this.pauseStage = 99; }
    else if (this.screen === 'paused') this.screen = 'playing';
  }
}
