// game.js — game logic for Funky Truck. No DOM access, so it also runs under Node for tests.
//
// This is a port of the native Swift version (FunkyTruckMac/Sources/Game.swift), which in turn is
// a line-for-line port of the original Flash ActionScript. Comments name the original obfuscated
// identifiers where that helps cross-checking. Everything runs at the original 70 steps/second.

import { buildGrammar, EndlessCourse, ENDLESS_WIDTH, ENDLESS_SHIFT } from './endless.js';
import { TrickTracker } from './tricks.js';
import { Wreck } from './wreck.js';

export const TILE = 64;          // s4c2
export const STAGE_W = 576;      // Z7552
export const STAGE_H = 448;      // B9752
export const STEP_HZ = 70;       // the SWF frame rate

const PI = Math.PI;

/** Endless Mode: metres shown per tile column travelled, and points per column. */
export const METRES_PER_TILE = 2.5;
/** The speedometer: km/h for a speed of one pixel per step (70 steps a second, 2.5 m a tile). */
export const KMH_PER_PX_STEP = STEP_HZ * METRES_PER_TILE / TILE * 3.6;
const POINTS_PER_TILE = 10;

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
    this.grid = [];
    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) row.push([]);
      this.grid.push(row);
    }
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) this.addTile(tx, ty, level, table);
    const B = this.offset;
    this.segs.push({ x1: B, y1: H * TILE, x2: B, y2: 0, nx: 1, ny: 0, type: 1 });
    this.segs.push({ x1: W * TILE - B, y1: 0, x2: W * TILE - B, y2: H * TILE, nx: -1, ny: 0, type: 1 });
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
          this.grid[gy][gx].push(idx);
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
        for (let gx = gx0; gx <= gx1; gx++) {
          for (const idx of row[gx]) {
            const p = this.test(a00, b11, c22, d33, this.segs[idx]);
            if (p) { done = false; c22 = p[0]; d33 = p[1]; last = this.segs[idx]; }
          }
        }
      }
    }
    if (!last) return null;
    return { x: c22, y: d33, nx: last.nx, ny: last.ny, type: last.type };
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
    this.rearN = [0, 0]; this.frontN = [0, 0];           // g8e45, k2255
    this.rearV = [0, 0]; this.frontV = [0, 0];           // i0055, m4455
    this.rearSpin = 0; this.frontSpin = 0;               // H9F45, L3355
    this.rearWheelRot = 0; this.frontWheelRot = 0;       // degrees, unwrapped
    this.bodyRot = 0;                                    // L7935._rotation (degrees)
    this.probePrev = null;                               // N5555
    this.probeHit = null;                                // what the roof probe last touched
    this.airborne = false; this.flipLast = 0; this.flipAccum = 0; // s0a55, T1B55, u2c55
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
      T[i + 1] += (y - P[i + 1]) + 0.11;
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
      this.rearV = [T[2] - P[2], T[3] - P[3]];
      T[2] = h.x; T[3] = h.y;
      this.rearN = [h.nx, h.ny];
    }
    h = w.collide(P[4], P[5], T[4], T[5]);
    if (h) {
      this.frontContact = true;
      this.frontV = [T[4] - P[4], T[5] - P[5]];
      T[4] = h.x; T[5] = h.y;
      this.frontN = [h.nx, h.ny];
    }
  }

  drive(keys) { // F7Fc5
    const k = 0.4, P = this.P;
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
      if (!this.rearContact && !this.frontContact) { P[4] += px * 0.2; P[5] += py * 0.2; }
      else if (this.rearContact) {
        const n = this.rearN, s = (n[0] * px + n[1] * py) * 0.1;
        P[4] += n[0] * s; P[5] += n[1] * s;
      }
    } else if (keys.right) {
      if (!this.rearContact && !this.frontContact) { P[4] -= px * 0.2; P[5] -= py * 0.2; }
      else if (this.frontContact) {
        const n = this.frontN, s = (n[0] * px + n[1] * py) * 0.1;
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

  // a4eF5: returns a completed flip's total rotation (degrees) when the truck lands.
  trackFlip() {
    let rot = this.bodyRot;
    if (rot < 0) rot += 360;
    if (!this.airborne && !this.rearContact && !this.frontContact) {
      this.airborne = true; this.flipLast = rot; this.flipAccum = 0;
    }
    if (!this.airborne) return null;
    let d = this.flipLast - rot;
    if (d < -180) { d += 360; d = -d; } else if (d > 180) { d -= 360; d = -d; }
    this.flipLast = rot;
    this.flipAccum += d;
    if (this.rearContact || this.frontContact) {
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

  // u6a33 / g0406: idle bounce used on the title and garage screens.
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
}

// ---------------------------------------------------------------------------------------------
// Game state machine (_ma)

export const STAGE_NAMES = ['Stage One', 'Stage Two', 'Stage Three', 'Stage Four', 'Stage Five',
  'Stage Six', 'Stage Seven', 'Stage Eight', 'Stage Nine', 'Stage Ten'];

/** A saved whole number of metres, or 0 if what was saved isn't one. */
function validCount(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 1e9 ? n : 0;
}

export function emptyKeys() {
  // `one` is the single button of the one-button controls. `back` is the touch zones' left zone:
  // reverse on the ground, tilt back in the air.
  return { up: false, down: false, left: false, right: false, pause: false, restart: false, one: false, back: false, upright: false };
}

/**
 * The rules a run is played by.
 *   classic  the original game: no tricks, no ragdoll wreck, the invisible ceiling, the original
 *            flip bonus, and no one-button controls
 *   damage   scraping the cab adds damage, and 1000 damage wrecks the truck
 */
export const RULES = {
  play: { classic: false, damage: true },
  classic: { classic: true, damage: true },
  endless: { classic: false, damage: false },
};

/**
 * The dynamic camera (outside Classic, when switched on): it pulls back to show more when the
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

/** Flip-upright assist: steps of being stuck before the button appears. */
export const STUCK_STEPS = 140;
/** ...and how long it stays once the truck no longer looks stuck (3 s). */
export const UPRIGHT_LINGER = 210;
/** After a flip upright, steps on the ground before tricks are watched for again (1 s). */
export const TRICK_COOLDOWN = 70;
/**
 * Outside Classic, the body touching ground that's underneath it (the chassis bottoming out on a
 * hard landing or a ramp) isn't a scrape. Underneath means the ground's normal is within about
 * 65° of the truck's up direction.
 */
const UNDERSIDE = 0.42;
const RIGHTING_STEPS = 80;
const ONE_BUTTON_AIR = 4;        // steps off the ground before one-button and touch-zone controls count as in the air

/**
 * Screens: 'title' | 'help' | 'garage' | 'practiceSelect' | 'playing' | 'paused' | 'gameOver'
 * Modes: 'campaign' (all nine stages), 'practice' (one stage), 'endless' (a generated course).
 * The title screen's Play and Classic both start a campaign, under different rules.
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
    this.tricks = new TrickTracker();
    this.damage = 0;                  // X5B4 (0..1000)
    this.endTimer = 0;                // L5B72
    this.tickerTimer = 0;             // e8472
    this.ticker = '';
    this.rules = RULES.play;
    // Best scores: Classic keeps the original game's saved best; Play and Endless have their own.
    this.best = validCount(this.store.get('bestScore')); // a0a82
    this.bestPlay = validCount(this.store.get('bestPlay'));
    this.bestEndless = validCount(this.store.get('bestEndless'));
    // Options (all off by default, apart from damage in Practice).
    const flag = (k, dflt) => { const v = this.store.get(k); return typeof v === 'boolean' ? v : dflt; };
    this.soundOn = flag('sound', false);
    this.oneButton = flag('oneButton', false);
    this.practiceDamage = flag('practiceDamage', true);
    this.practiceClassic = flag('practiceClassic', false);
    this.dynamicCamera = flag('dynamicCamera', true);
    this.wreck = null;                // the pieces of a wrecked truck (outside Classic)
    this.scraping = false;            // the cab is scraping the ground this step
    this.speedKmh = 0;                // the speedometer (outside Classic), smoothed a little
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
    this.lastScore = 0;
    this.wrecked = false;
    this.finished = false;
    this.camX = 0; this.camY = 0;     // J1Fc4 / k20D4
    this.zoom = 1;                    // the dynamic camera's pull-back (outside Classic)
    // Dynamic camera springs: each a value and its velocity per step.
    this.ground = 0; this.groundV = 0;     // smoothed height above the ground
    this.camSpeed = 0; this.camSpeedV = 0; // smoothed speed
    this.zoomV = 0;
    this.back = 0; this.backV = 0;         // how far the camera has eased back for reversing (0-1)
    // How much of the world the driving view shows across and top to bottom (at zoom 1) when it
    // fills the window: never less than Classic's 576x448, and more one way to match the window's
    // shape. The renderer keeps these up to date, even on the menus, so a stage starts with its
    // camera in the right place. Classic always shows 576x448 (see viewW, viewH).
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
  get viewH() { return this.rules.classic ? STAGE_H : this.fillViewH; }
  set viewH(h) { this.fillViewH = h; }
  /** How much of the world shows across at zoom 1. It only moves the camera. */
  get viewW() { return this.rules.classic ? STAGE_W : this.fillViewW; }
  set viewW(w) { this.fillViewW = w; }
  /** Where the camera keeps the truck across the view (at zoom 1): 150 from the left of a
   *  Classic-sized view, centred in a wider one, and eased right a little while reversing. */
  get camAnchorX() { return 150 + (this.viewW - STAGE_W) / 2 + this.back * CAMERA.lookBack; }

  get levelData() {
    if (this.mode === 'endless') return this.course.level;
    return this.isStunt ? this.stunts[this.level - this.data.levels.length] : this.data.levels[this.level];
  }

  /** Practice's stunt tracks (assets/stunts.json), which come after the nine stages. */
  get stunts() { return this.data.stunts || []; }
  /** Whether this run is on a stunt track. */
  get isStunt() { return this.mode === 'practice' && this.level >= this.data.levels.length; }
  /** The name of stage `i` of Practice: "Stage One" ... "Stage Nine", then the stunt tracks. */
  stageName(i) { return i < this.data.levels.length ? STAGE_NAMES[i] : this.stunts[i - this.data.levels.length]?.name ?? ''; }
  get maxCamX() { return this.levelData.width * TILE - this.viewW * this.zoom; }   // N53D4
  get maxCamY() { return this.levelData.height * TILE - this.viewH * this.zoom; }  // o64D4

  saveLook() { this.store.set('truckLook', { ...this.look }); }

  /** Step 'body', 'tyre', 'hub' or 'paint' by `delta`. A new body comes in its own colour. */
  cycleLook(part, delta) {
    const L = this.look;
    L[part] = (L[part] + delta + 6) % 6;
    if (part === 'body') L.paint = L.body;
    this.saveLook();
  }

  /** Flip an on/off option and save it: 'soundOn', 'oneButton', 'practiceDamage', 'practiceClassic', 'dynamicCamera'. */
  toggle(option) {
    const key = { soundOn: 'sound', oneButton: 'oneButton', practiceDamage: 'practiceDamage', practiceClassic: 'practiceClassic', dynamicCamera: 'dynamicCamera' }[option];
    if (!key) return;
    this[option] = !this[option];
    this.store.set(key, this[option]);
  }

  /** The dynamic camera applies outside Classic, when switched on. */
  get dynamicCameraActive() { return this.dynamicCamera && !this.rules.classic; }

  /** One-button controls apply outside Classic. */
  get oneButtonActive() { return this.oneButton && !this.rules.classic; }

  /** The flip-upright assist is offered in damage-free runs outside Classic. */
  get uprightAllowed() { return !this.rules.damage && !this.rules.classic; }

  // ---- flow

  /** The nine stages, as Play (`classic` false) or as the original game (`classic` true). */
  startCampaign(classic = false) { this.mode = 'campaign'; this.rules = classic ? RULES.classic : RULES.play; this.beginRun(0); }
  startPractice(l) {
    this.mode = 'practice';
    this.rules = { classic: this.practiceClassic, damage: this.practiceDamage };
    this.beginRun(l);
  }

  startEndless() {
    this.mode = 'endless';
    this.rules = RULES.endless;
    if (!this.grammar) this.grammar = buildGrammar(this.data.levels);
    this.course = new EndlessCourse(this.grammar, this.data.levels, this.random);
    this.distance = 0;
    this.beginRun(0);
  }

  beginRun(firstLevel) { // H5D52
    if (this.mode === 'campaign') { this.lastLevel = this.data.levels.length - 1; this.level = 0; }
    else { this.level = firstLevel; this.lastLevel = firstLevel; }
    this.score = 0; this.bonus = 0; this.damage = 0;
    this.wrecked = false; this.finished = false;
    this.startStage();
  }

  makeWorld(radius = this.truck.wheelRadius) {
    return new CollisionWorld(this.levelData, this.data.collision, radius, { ceiling: this.rules.classic });
  }

  startStage() { // u8a62
    this.world = this.makeWorld();
    this.wreck = null;
    this.stuck = 0; this.canUpright = false; this.righting = 0; this.airSteps = 0;
    this.landed = false; // the truck is dropped in at the start; until it lands it isn't driving
    this.uprightLinger = 0; this.trickCooldown = 0;
    const s = this.levelData.start;
    this.truck.reset(s[0], s[1]);
    this.truck.rearWheelRot = 0; this.truck.frontWheelRot = 0;
    this.speedKmh = 0;
    this.zoom = 1; this.zoomV = 0; this.ground = 0; this.groundV = 0; this.camSpeed = 0; this.camSpeedV = 0;
    this.back = 0; this.backV = 0;
    this.camX = Math.min(Math.max(s[0] - this.camAnchorX, 0), this.maxCamX);       // s4833
    this.camY = s[1] - this.viewH / 2;
    if (this.rules.classic) this.camY = Math.min(Math.max(this.camY, 0), this.maxCamY);
    this.updateCamera();
    this.ticker = this.stageName(this.level); this.tickerTimer = 140;   // m2813
    this.endTimer = 0;
    this.score += this.bonus;
    this.bonus = (this.level + 1) * 10000;
    if (this.mode === 'endless') { this.ticker = 'Endless'; this.bonus = 0; }
    if (this.isStunt) this.bonus = 0; // stunt tracks are all about the tricks: no time bonus
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
    if (this.mode === 'campaign') this.startCampaign(this.rules.classic);
    else if (this.mode === 'endless') this.startEndless();
    else this.startPractice(this.lastLevel);
  }

  saveEndlessBest() {
    if (this.metres > this.bestEndless) { this.bestEndless = this.metres; this.store.set('bestEndless', this.bestEndless); }
  }

  /** Endless Mode: metres travelled so far. */
  get metres() { return Math.floor(this.distance * METRES_PER_TILE); }

  /** Endless Mode: score new ground, and scroll the world when the truck nears the window's end. */
  updateEndless() {
    const col = Math.floor(this.truck.T[0] / TILE) + this.course.dropped;
    if (col > this.distance) {
      if (this.endTimer === 0) this.score += (col - this.distance) * POINTS_PER_TILE;
      this.distance = col;
    }
    if (this.truck.T[0] > (ENDLESS_WIDTH - 40) * TILE) this.scrollWorld(ENDLESS_SHIFT);
  }

  /** Drop `n` columns off the left of the course and move everything left to match. */
  scrollWorld(n) {
    const dx = n * TILE;
    this.course.scroll(n);
    const t = this.truck;
    for (let i = 0; i < 10; i += 2) { t.T[i] -= dx; t.P[i] -= dx; }
    if (t.probePrev) t.probePrev[0] -= dx;
    for (const d of this.dirt) d.x -= dx;
    this.camX -= dx;
    this.world = this.makeWorld();
    this.shiftCount++;
    this.lastShift = dx;
  }

  showMenu(screen) {
    // Leaving an Endless run part-way (quitting from pause, say) still counts its distance.
    if (this.mode === 'endless' && (this.screen === 'playing' || this.screen === 'paused')) this.saveEndlessBest();
    if (screen === 'title' || screen === 'garage') this.garageTruck.reset(STAGE_W / 2, 120);
    this.screen = screen;
    this.teleportCount++;
  }

  bankTricks() {
    const paid = this.tricks.bank();
    if (paid > 0) this.payTricks(paid);
  }

  /** What the camera follows: the truck, or the body of a wrecked one. */
  get focus() { return this.wreck ? this.wreck.centre : [this.truck.T[0], this.truck.T[1]]; }

  updateCamera() { // T5933 + w6015
    const [fx, fy] = this.focus;
    if (this.dynamicCameraActive) this.updateZoom();
    else { this.zoom = 1; this.back = 0; this.backV = 0; }
    // The original camera: it keeps the truck 150 from the left and halfway down, moving a fifth
    // of the way there each step, at most a tile. The dynamic camera is the same with the frame
    // pulled back: distances on the stage scale with the zoom, so on screen it behaves alike.
    const z = this.zoom;
    const dx = Math.max(Math.min((fx - this.camAnchorX * z - this.camX) * 0.2, TILE * z), -TILE * z);
    const dy = Math.max(Math.min((fy - this.viewH * z / 2 - this.camY) * 0.2, TILE * z), -TILE * z);
    this.camX = Math.min(Math.max(this.camX + dx, 0), this.maxCamX);
    // Classic stays inside the level. Elsewhere the camera follows the truck up and down wherever
    // it goes: above the level there's sky, and below it the renderer keeps drawing dirt (every
    // column of every stage ends in solid dirt).
    this.camY += dy;
    if (this.rules.classic) this.camY = Math.min(Math.max(this.camY, 0), this.maxCamY);
  }

  /** How far below the point (x, y) the ground is (a wheel centre's resting height), up to `max`. */
  groundBelow(x, y, max = 1000) {
    const h = this.world.collide(x, y, x, y + max);
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
      backwards = t.P[0] - t.T[0];
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
    let s = Math.max(Math.min(spin, 10), -10);
    if (Math.abs(s) <= 5) return;
    s *= 0.3;
    const x = this.truck.T[wheel * 2] - n[0] * this.truck.wheelRadius;
    const y = this.truck.T[wheel * 2 + 1] - n[1] * this.truck.wheelRadius;
    const a = (-10 - this.random() * 35) * 0.017453292519943295;
    const c = Math.cos(a), sn = Math.sin(a);
    this.spawnDirt(x, y, (n[0] * c - n[1] * sn) * s, (n[0] * sn + n[1] * c) * Math.abs(s));
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
   * The keys the truck sees. With one-button controls, the button drives on the ground and tilts
   * back in the air; the touch zones' left zone (`back`) reverses on the ground and tilts back in
   * the air.
   */
  driveKeys() {
    const k = this.keys;
    if (!this.oneButtonActive || !(k.one || k.back)) return k;
    const air = this.airSteps >= ONE_BUTTON_AIR;
    return { ...k, up: k.up || (k.one && !air), down: k.down || (k.back && !air), left: k.left || ((k.one || k.back) && air) };
  }

  stepTruck(w) { // V7B33
    const t = this.truck;
    t.integrate();
    t.rearContact = false; t.frontContact = false;
    for (let i = 0; i < 2; i++) { t.constrain(); t.collideWheels(w); }
    this.airSteps = t.rearContact || t.frontContact ? 0 : this.airSteps + 1;
    if (this.airSteps === 0) this.landed = true;
    const keys = this.driveKeys();
    t.drive(keys);
    t.spinWheels();
    if (t.rearContact) this.kickDirt(t.rearSpin, 1, t.rearN);
    if (t.frontContact) this.kickDirt(t.frontSpin, 2, t.frontN);
    t.tilt(keys);
    const type = t.probeBody(w);
    // The cab (the truck above its wheels) is touching the ground. Outside Classic, ground under
    // the body doesn't count: that's the chassis bottoming out, not the cab scraping.
    const touching = type !== null && type !== 1 && (this.rules.classic || !this.underside(t));
    this.scraping = touching; // heard even after the finish line
    // It only damages the truck or bails a chain before the stage is over.
    const scraped = touching && this.endTimer === 0;
    if (scraped && this.rules.damage) this.damage = Math.min(1000, this.damage + 6);
    const flip = t.trackFlip();
    if (this.rules.classic) {
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
    const scoring = (this.mode === 'endless' || this.isStunt || this.bonus !== 0) && this.endTimer === 0;
    if (this.righting > 0 || this.trickCooldown > 0) {
      // A flip upright isn't a trick: tricks aren't watched for until the truck has been back on
      // its wheels for a moment, and then the trick tracker starts afresh.
      if (this.righting === 0 && (t.rearContact || t.frontContact) && --this.trickCooldown === 0) this.tricks.reset();
    } else {
      const paid = this.tricks.step(t, flip, scraped, scoring);
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

  // ---- flip-upright assist (damage-free runs outside Classic)

  /** Watch for the truck being stuck: on its roof or side, or with the cab dragging, for a while. */
  updateStuck(cabTouching) {
    const t = this.truck;
    if (this.righting > 0) { this.stepRighting(); return; }
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
    if (this.mode !== 'endless' && this.truck.T[0] >= (this.levelData.width - 9) * TILE) {
      this.ticker = 'Stage Complete !'; this.tickerTimer = 140; this.endTimer = 210;
      this.bankTricks(); // a chain still going at the finish line is paid out
    }
    if (this.damage === 1000 && this.rules.damage) {
      this.ticker = 'Your truck is wrecked - Game over !'; this.tickerTimer = 140; this.endTimer = 210;
      if (!this.rules.classic) {
        // The truck comes apart and collapses; the pieces tumble for a moment before the game-over screen.
        this.wreck = new Wreck(this.truck, this.world, this.makeWorld(3));
        this.endTimer = 160;
        this.tricks.reset();
      }
    }
  }

  finishStage() { // V9B62 / J7F52
    for (const d of this.dirt) d.life = 0;
    const isWrecked = this.damage === 1000;
    if (this.level === this.lastLevel || isWrecked) {
      this.score += this.bonus;
      if (this.mode === 'campaign' && !isWrecked) this.score += 100000;
      this.bonus = 0;
      this.wrecked = isWrecked;
      this.finished = !isWrecked;
      this.lastScore = this.score;
      if (this.mode === 'endless') this.saveEndlessBest();
      else if (this.rules.damage && !this.isStunt) this.saveBest(this.score);
      this.restartLatch = true;
      this.screen = 'gameOver';
    } else {
      this.level++;
      this.startStage();
    }
  }

  /** The best score for the current rules (Classic and Play are kept apart). */
  get bestForRules() { return this.rules.classic ? this.best : this.bestPlay; }

  saveBest(score) {
    if (this.rules.classic) { if (score > this.best) { this.best = score; this.store.set('bestScore', score); } }
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
    this.restartLatch = true;
    this.screen = 'gameOver';
  }

  /** Advance one 1/70 s frame. */
  step() {
    switch (this.screen) {
      case 'playing':
        if (!this.world) return;
        if (this.wreck) this.wreck.step(); else this.stepTruck(this.world);
        this.updateSpeedometer();
        if (this.keys.upright) this.upright();
        if (this.mode === 'endless') this.updateEndless();
        this.updateCamera();
        this.updateDirt();
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
      case 'title':
        this.garageTruck.garageStep();
        break;
      case 'gameOver':
        // A wrecked truck's pieces keep tumbling behind the game-over box.
        if (this.wreck) { this.wreck.step(); this.updateCamera(); }
        if (!this.keys.restart) this.restartLatch = false;
        else if (!this.restartLatch) this.restart();
        break;
      default:
        break;
    }
  }

  /** The speedometer reads the truck's speed, smoothed so it doesn't flicker; a wreck, and a truck
   *  still being dropped in at the start, read 0. */
  updateSpeedometer() {
    const t = this.truck;
    const raw = this.wreck || !this.landed ? 0 : Math.hypot(t.T[0] - t.P[0], t.T[1] - t.P[1]) * KMH_PER_PX_STEP;
    this.speedKmh += (raw - this.speedKmh) * 0.15;
  }

  /** Toggle pause directly (for touch/gamepad buttons, which are taps rather than held keys). */
  togglePause() {
    if (this.screen === 'playing') { this.screen = 'paused'; this.pauseStage = 99; }
    else if (this.screen === 'paused') this.screen = 'playing';
  }
}
