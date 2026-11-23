// wreck.js — outside Classic, a wrecked truck comes apart: the body, both wheels and the four
// suspension bars come loose and the truck collapses. Each piece keeps the speed and spin it had;
// nothing is added. No DOM access (runs under Node for tests).
//
// Every piece is made of Verlet points like the truck itself, under the same gravity. The body is
// a rigid box of four points, each bar is two points (one end pinned to the body), and each wheel
// is one point that collides
// with the normal (wheel-sized) collision world. The box and bars use a second collision world
// built with a thin offset, so they rest on the ground rather than floating a wheel's height up.
// The two wheels also hit each other and the body (the bars pass through everything). The body is
// each body sprite's own outline (BODY_SHAPES, traced from the sprites), not a plain box. The
// wheels start overlapping the body where they sat in their wheel arches, so that overlap is let
// be at first and cleared over WRECK.release steps, pushing the wheel outwards (towards the body's
// nearer end) as well as out of the arch, so it comes out of its wheel well rather than up onto
// the chassis. A wheel against the body rolls along it rather than gripping it, so upside down a wheel landing
// on the chassis rolls off unless it settles in a dip such as a wheel arch. Collisions are soft,
// too (an overlap is undone over a few steps).

import { BODY_SHAPES } from './wreck-shapes.js';

const GRAVITY = 0.11;     // the truck's gravity per step (Truck.integrate)

// A body's outline in its own frame (origin at the rear body mount, x towards the front mount, 0.7
// scale as drawn), shrunk a little so it sits on the ground convincingly: a plain box, used if a
// body has no traced outline (see BODY_SHAPES). Points go round the outline in order.
const BODY_BOX = [[-10, -26], [14, -26], [38, -26], [62, -26], [62, 10], [38, 10], [14, 10], [-10, 10]];

// Per piece: share of the speed into the ground that bounces back, share of the speed along the
// ground kept on each contact, and share of the speed kept each step in the air.
export const WRECK = {
  part: { bounce: 0.3, friction: 0.86, air: 0.998 },     // the body and bars scrape to a halt
  wheel: { bounce: 0.75, friction: 0.993, air: 0.9998 }, // the wheels roll on and bounce, like rubber
  wheelRadius: 22.5,                                      // the wheels hit each other and the body as circles this size
  bodyShare: 0.3,                                         // how much of a wheel-body overlap the (heavier) body is moved
  easeIn: 140,                                            // steps (2 s) before a wreck can settle
  release: 60,                                            // steps over which an overlap at the wreck stops being allowed
  soft: 0.35,                                             // the share of an overlap undone each pass (3 passes a step)
  restSpeed: 1,                                           // px a step into the ground (or another piece) below which nothing bounces
  slop: 0.5,                                              // px of overlap between pieces let be (so resting contact doesn't jitter)
  grip: 0.8,                                              // pieces sliding along each other keep this share of it a pass
  roll: 0.995,                                            // a wheel rolling along the body keeps this share (it rolls, it doesn't scrape)                                            // a wheel rolling along the body keeps this share (it rolls, it doesn't scrape)
  staticSpeed: 0.15,                                      // px a step: a body or bar point on the ground sliding slower than this stops (static friction)
  sleepSpeed: 0.2,                                        // px a step: slower than this everywhere, on the ground, for sleepAfter steps, and the wreck stops
  sleepAfter: 35,
};

/** The point nearest (x, y) on the polygon `poly` ([[x, y], ...]), and whether (x, y) is inside it. */
export function nearestOnPolygon(poly, x, y) {
  let best = null, bd = Infinity, inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    if ((ay > y) !== (by > y) && x < ax + (y - ay) / (by - ay) * (bx - ax)) inside = !inside;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    const px = ax + t * dx, py = ay + t * dy, d = Math.hypot(x - px, y - py);
    if (d < bd) { bd = d; best = [px, py]; }
  }
  return { x: best[0], y: best[1], d: bd, inside };
}

export class Wreck {
  /**
   * @param truck     the Truck at the moment it was wrecked
   * @param wheelWorld the game's CollisionWorld (offset for the wheel radius)
   * @param thinWorld  a CollisionWorld of the same level built with a small offset
   * @param bodyType   which truck body (look.body), for its outline
   */
  constructor(truck, wheelWorld, thinWorld, bodyType = 0) {
    this.wheelWorld = wheelWorld;
    this.thinWorld = thinWorld;
    this.T = [];
    this.P = [];
    this.thin = [];        // per point: true = thin world, false = wheel world
    this.sticks = [];      // [a, b, rest]
    const T = truck.T, P = truck.P;
    const cx = T[0], cy = T[1];
    const add = (x, y, px, py, thin) => {
      this.T.push(x, y); this.P.push(px, py); this.thin.push(thin);
      return this.thin.length - 1;
    };
    const stick = (a, b) => this.sticks.push([a, b, Math.hypot(this.T[b * 2] - this.T[a * 2], this.T[b * 2 + 1] - this.T[a * 2 + 1])]);

    // Body: its outline's points, placed from the body mounts now and a step ago.
    this.shape = BODY_SHAPES[bodyType] || BODY_BOX;
    const frame = (A, ax, ay, bx, by) => {
      const ang = Math.atan2(by - ay, bx - ax), c = Math.cos(ang), s = Math.sin(ang);
      return this.shape.map(([x, y]) => [ax + x * c - y * s, ay + x * s + y * c]);
    };
    const now = frame(T, T[6], T[7], T[8], T[9]);
    const before = frame(P, P[6], P[7], P[8], P[9]);
    this.body = now.map((p, i) => add(p[0], p[1], before[i][0], before[i][1], true));
    const n = this.body.length;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) stick(this.body[a], this.body[b]);
    // A truck is wrecked by scraping its cab, so part of the body box often starts inside the
    // ground, where the collision test can't see it (it only stops points crossing a surface from
    // the front). Lift the whole box clear first, or it sinks into the ground.
    // The wheel centres and the cab's roof probe are kept clear of the ground by the truck's own
    // collisions, so they are safe places to measure from (the chassis centre is not: it can sit
    // inside a sharp crest with a wheel either side).
    const refs = [[T[2], T[3]], [T[4], T[5]]];
    if (truck.probePrev) refs.push(truck.probePrev.slice());
    this.liftClear(this.body, refs);

    // Wheels, keeping their spin.
    this.wheels = [
      { p: add(T[2], T[3], P[2], P[3], false), rot: truck.rearWheelRot, spin: truck.rearSpin },
      { p: add(T[4], T[5], P[4], P[5], false), rot: truck.frontWheelRot, spin: truck.frontSpin },
    ];
    this.circumference = truck.circumference;

    // Bars, from the chassis centre to each body mount and wheel (drawn as in Renderer.truck). They
    // stay attached and flop about: on each side, the bar to the body mount hangs from its mount
    // (held to three of the body's corners, so it keeps its place on the body but swings), and the
    // bar to that side's wheel hangs from its lower end, a knee joint they share, its other end
    // free where the wheel came off. So each side is a leg: mount, knee, loose end.
    const knees = [add(cx, cy, P[0], P[1], true), add(cx, cy, P[0], P[1], true)]; // rear, front
    this.bars = [[6, 1, 0], [8, 1, 1], [2, 0, 0], [4, 0, 1]].map(([p, frameIndex, side]) => {
      const a = knees[side];
      const b = add(T[p], T[p + 1], P[p], P[p + 1], true);
      stick(a, b);
      return { a, b, frame: frameIndex, mount: frameIndex === 1 };
    });
    this.liftClear([...knees, ...this.bars.map((bar) => bar.b)], refs);
    const nb = this.body.length, anchors = [0, Math.floor(nb / 3), Math.floor(nb * 2 / 3)].map((i) => this.body[i]);
    for (const bar of this.bars) if (bar.mount) for (const c of anchors) stick(bar.b, c);
    // How far the wheels overlap each other and the body to begin with (allowed, at first).
    this.overlap0 = this.overlaps();
    this.steps = 0;
    this.gravity = truck.gravity ?? GRAVITY; // (Sandbox can change it)
  }

  /**
   * Move the points `pts` together (now and a step ago, so their speed is kept) until none of
   * them is inside the ground. Inside means the straight line out to the point from the nearest
   * of `refs`, places known to be clear of the ground, crosses a surface.
   */
  liftClear(pts, refs) {
    const T = this.T, P = this.P;
    for (let tries = 0; tries < 8; tries++) {
      let best = null, depth = 0;
      for (const i of pts) {
        const x = T[i * 2], y = T[i * 2 + 1];
        let ref = refs[0], rd = Infinity;
        for (const q of refs) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < rd) { rd = d; ref = q; } }
        const h = this.thinWorld.collide(ref[0], ref[1], x, y);
        if (!h) continue;
        const dx = h.x - T[i * 2], dy = h.y - T[i * 2 + 1], d = Math.hypot(dx, dy);
        if (d > depth) { depth = d; best = [dx, dy]; }
      }
      if (!best) return;
      for (const i of pts) {
        T[i * 2] += best[0]; T[i * 2 + 1] += best[1];
        P[i * 2] += best[0]; P[i * 2 + 1] += best[1];
      }
    }
  }

  /** The body's outline, as points in the world. */
  outline() { return this.body.map((i) => [this.T[i * 2], this.T[i * 2 + 1]]); }

  /** How far the wheels overlap each other ({ ww }) and the body ({ wb: [rear, front] }) now. */
  overlaps() {
    const T = this.T, R = WRECK.wheelRadius, [a, b] = this.wheels.map((w) => w.p), poly = this.outline();
    const ww = Math.max(0, 2 * R - Math.hypot(T[b * 2] - T[a * 2], T[b * 2 + 1] - T[a * 2 + 1]));
    const wb = [a, b].map((w) => {
      const h = nearestOnPolygon(poly, T[w * 2], T[w * 2 + 1]);
      return h.inside ? R + h.d : Math.max(0, R - h.d);
    });
    return { ww, wb };
  }

  /**
   * The loose wheels hit each other and the body. Overlaps are moved apart (now and a step ago
   * alike, so the move itself adds no speed), gently: the overlap there was at the wreck is
   * allowed at first, less and less over WRECK.release steps, a little (WRECK.slop) always is, and
   * each pass undoes only part of what's left (WRECK.soft). Then the speed they have towards each
   * other is taken away (bouncing back off a hard knock, as off the ground), so pieces resting on
   * each other stay put instead of trembling. The ground collisions after this keep anything from
   * being pushed into the ground.
   */
  collidePieces() {
    const T = this.T, P = this.P, R = WRECK.wheelRadius, k = WRECK.soft;
    const ease = Math.max(0, 1 - this.steps / WRECK.release), O = this.overlap0;
    const [a, b] = this.wheels.map((w) => w.p);
    // (`shift` keeps these moves, so the ground's bounce and friction, after, don't count them as speed)
    const sh = this.shift;
    const move = (i, dx, dy) => { T[i * 2] += dx; T[i * 2 + 1] += dy; P[i * 2] += dx; P[i * 2 + 1] += dy; sh[i * 2] += dx; sh[i * 2 + 1] += dy; };
    const vel = (i) => [T[i * 2] - P[i * 2], T[i * 2 + 1] - P[i * 2 + 1]];
    // (`kick` keeps these, so a wheel's ground bounce, after, starts from its speed with them)
    const kick = this.kick;
    const speedUp = (i, dx, dy) => { P[i * 2] -= dx; P[i * 2 + 1] -= dy; kick[i * 2] += dx; kick[i * 2 + 1] += dy; };
    /**
     * Pieces A and B (lists of points; B moves `share` of what they're moved apart) touching
     * along (nx, ny), from A to B: take away the speed they have towards each other, and some of
     * their sliding along each other.
     */
    const stop = (A, B, nx, ny, share, keep = WRECK.grip) => {
      const avg = (L) => L.reduce((s, i) => { const v = vel(i); return [s[0] + v[0] / L.length, s[1] + v[1] / L.length]; }, [0, 0]);
      const va = avg(A), vb = avg(B), rx = vb[0] - va[0], ry = vb[1] - va[1], vn = rx * nx + ry * ny;
      // grip: some of their sliding along each other goes (pieces can rest on each other, not skate)
      const tx = rx - vn * nx, ty = ry - vn * ny, g = 1 - keep;
      for (const i of A) speedUp(i, tx * g * (1 - share), ty * g * (1 - share));
      for (const i of B) speedUp(i, -tx * g * share, -ty * g * share);
      if (vn >= 0) return; // already parting
      const j = -vn * (1 + (-vn > WRECK.restSpeed ? WRECK.wheel.bounce : 0));
      for (const i of A) speedUp(i, -nx * j * (1 - share), -ny * j * (1 - share));
      for (const i of B) speedUp(i, nx * j * share, ny * j * share);
    };
    // wheel against wheel: equal shares
    const dx = T[b * 2] - T[a * 2], dy = T[b * 2 + 1] - T[a * 2 + 1];
    const d = Math.hypot(dx, dy), o = 2 * R - d - O.ww * ease - WRECK.slop;
    if (o > 0) {
      const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0, m = o * k / 2;
      move(a, -nx * m, -ny * m);
      move(b, nx * m, ny * m);
      stop([a], [b], nx, ny, 0.5);
    }
    // wheel against the body's outline (the body, heavier, moves WRECK.bodyShare of it)
    const poly = this.outline();
    [a, b].forEach((w, n) => {
      const x = T[w * 2], y = T[w * 2 + 1];
      const h = nearestOnPolygon(poly, x, y);
      const over = (h.inside ? R + h.d : R - h.d) - O.wb[n] * ease - WRECK.slop;
      if (over <= 0) return;
      this.wheelOnBody = true;
      // out of the body along the line from the nearest edge point (through it, if it's inside)
      let nx = x - h.x, ny = y - h.y;
      const l = Math.hypot(nx, ny) || 1e-6;
      nx /= l; ny /= l;
      if (h.inside) { nx = -nx; ny = -ny; }
      // A wheel still coming out of the arch it sat in leaves it outwards, towards the body's nearer
      // end as well as out of the arch: off the axle, out of the wheel well. (Straight out of the
      // arch, upside down, is straight up, onto the chassis.)
      if (this.steps < WRECK.release && O.wb[n] > 0) {
        const [cx, cy] = this.centre, ang = Wreck.bodyPose(T, this.body, this.shape).ang;
        const ax = Math.cos(ang), ay = Math.sin(ang), side = Math.sign((x - cx) * ax + (y - cy) * ay) || 1;
        const ox = nx + ax * side, oy = ny + ay * side, ol = Math.hypot(ox, oy) || 1e-6;
        nx = ox / ol; ny = oy / ol;
      }
      this.rubbing[n] = [nx, ny];
      const m = over * k, s = WRECK.bodyShare;
      move(w, nx * m * (1 - s), ny * m * (1 - s));
      for (const i of this.body) move(i, -nx * m * s, -ny * m * s);
      // (a wheel rolls along the body: hardly any of their sliding goes. So one on top rolls off a
      // slope, and one under the body is pushed out from under it rather than levering it over.)
      stop(this.body, [w], nx, ny, 1 - s, WRECK.roll);
    });
  }

  /** The body's middle, for the camera to follow. */
  get centre() {
    let x = 0, y = 0;
    for (const i of this.body) { x += this.T[i * 2]; y += this.T[i * 2 + 1]; }
    return [x / this.body.length, y / this.body.length];
  }

  step() {
    const T = this.T, P = this.P;
    // Asleep (settled, see below): nothing moves until something moves it (a blast, a truck).
    if (this.asleep) {
      let moved = false;
      for (let i = 0; i < T.length && !moved; i++) moved = T[i] !== this.asleep[i] || P[i] !== T[i];
      if (!moved) { this.steps++; return; }
      this.asleep = null; this.still = 0;
    }
    this.wheelOnBody = false;
    this.rubbing = [null, null]; // per wheel: the body's normal where the wheel touches it
    this.shift = new Float64Array(T.length);
    this.kick = new Float64Array(T.length);
    for (let i = 0; i < T.length; i += 2) {
      const x = T[i], y = T[i + 1];
      const air = (this.thin[i >> 1] ? WRECK.part : WRECK.wheel).air;
      T[i] += (x - P[i]) * air;
      T[i + 1] += (y - P[i + 1]) * air + this.gravity;
      P[i] = x; P[i + 1] = y;
    }
    // P now holds where each point was at the start of the step: sweep collisions from there.
    const from = P.slice(0);
    // (where each point was heading this step, before anything stopped it: a wheel's bounce is
    // from its speed coming in, not from how far it got before it touched the ground)
    const aimed = T.slice(0);
    const touched = new Array(this.thin.length).fill(null);
    for (let it = 0; it < 3; it++) {
      for (const [a, b, rest] of this.sticks) {
        let dx = T[b * 2] - T[a * 2], dy = T[b * 2 + 1] - T[a * 2 + 1];
        const l = Math.hypot(dx, dy) || 1e-6;
        const f = (l - rest) / l * 0.5;
        dx *= f; dy *= f;
        T[a * 2] += dx; T[a * 2 + 1] += dy;
        T[b * 2] -= dx; T[b * 2 + 1] -= dy;
      }
      this.collidePieces();
      for (let i = 0; i < this.thin.length; i++) {
        const w = this.thin[i] ? this.thinWorld : this.wheelWorld;
        const h = w.collide(from[i * 2], from[i * 2 + 1], T[i * 2], T[i * 2 + 1]);
        if (h) { T[i * 2] = h.x; T[i * 2 + 1] = h.y; touched[i] = h; }
      }
    }
    // Whether the body is touching the ground (any side of it) or resting on a wheel, for damage to a truck wrecked on purpose.
    this.bodyTouching = this.wheelOnBody || this.body.some((i) => touched[i]);
    // Bounce and friction for the points that touched the ground.
    for (let i = 0; i < touched.length; i++) {
      const h = touched[i];
      if (!h) continue;
      // (a wheel: its speed coming in; a body or bar point: where it got to, less any move out of a
      // wheel, which isn't speed)
      const wheel = !this.thin[i], sh = this.shift;
      const kk = this.kick;
      const vx = wheel ? aimed[i * 2] - from[i * 2] + kk[i * 2] : T[i * 2] - from[i * 2] - sh[i * 2];
      const vy = wheel ? aimed[i * 2 + 1] - from[i * 2 + 1] + kk[i * 2 + 1] : T[i * 2 + 1] - from[i * 2 + 1] - sh[i * 2 + 1];
      const vn = vx * h.nx + vy * h.ny;
      let tx = vx - vn * h.nx, ty = vy - vn * h.ny;
      // static friction: a body or bar point barely sliding on the ground stays put
      if (!wheel && Math.hypot(tx, ty) < WRECK.staticSpeed) { tx = 0; ty = 0; }
      const m = this.thin[i] ? WRECK.part : WRECK.wheel;
      // (a slow touch doesn't bounce: resting on the ground, gravity alone would make it hop)
      const out = vn < -WRECK.restSpeed ? -vn * m.bounce : vn < 0 ? 0 : vn;
      P[i * 2] = T[i * 2] - (tx * m.friction + h.nx * out);
      P[i * 2 + 1] = T[i * 2 + 1] - (ty * m.friction + h.ny * out);
    }
    // Wheels roll on the ground and along the body, and keep spinning in the air.
    this.wheels.forEach((w, n) => {
      const h = touched[w.p];
      if (h) {
        const vx = T[w.p * 2] - P[w.p * 2], vy = T[w.p * 2 + 1] - P[w.p * 2 + 1];
        w.spin = (h.ny * vx - h.nx * vy) / this.circumference * -360;
      } else if (this.rubbing[n]) {
        // rolling along the body: it turns with its speed along the body (as on the ground)
        const [nx, ny] = this.rubbing[n];
        let bx = 0, by = 0;
        for (const i of this.body) { bx += T[i * 2] - P[i * 2]; by += T[i * 2 + 1] - P[i * 2 + 1]; }
        const vx = T[w.p * 2] - P[w.p * 2] - bx / this.body.length, vy = T[w.p * 2 + 1] - P[w.p * 2 + 1] - by / this.body.length;
        w.spin = (ny * vx - nx * vy) / this.circumference * -360;
      }
      w.rot += w.spin;
    });
    this.steps++;
    // Settled: everything slower than WRECK.sleepSpeed, and on the ground, for a while. Then it
    // stops for good (until something moves it), rather than trembling for ever.
    let fastest = 0;
    for (let i = 0; i < T.length; i += 2) fastest = Math.max(fastest, Math.hypot(T[i] - P[i], T[i + 1] - P[i + 1]));
    const grounded = touched.some(Boolean);
    this.still = fastest < WRECK.sleepSpeed && grounded && this.gravity > 0 && this.steps > WRECK.easeIn ? (this.still || 0) + 1 : 0;
    if (this.still >= WRECK.sleepAfter) {
      for (let i = 0; i < T.length; i++) P[i] = T[i];
      for (const w of this.wheels) w.spin = 0;
      this.asleep = T.slice(0);
    }
  }

  /** Where to draw the body (points T, outline `shape`): the rear mount's position and the angle (radians). */
  static bodyPose(T, body, shape = BODY_BOX) {
    // from the outline's first point and the one furthest along it
    const j = shape.reduce((best, p, i) => (Math.hypot(p[0] - shape[0][0], p[1] - shape[0][1]) > Math.hypot(shape[best][0] - shape[0][0], shape[best][1] - shape[0][1]) ? i : best), 1);
    const ax = T[body[0] * 2], ay = T[body[0] * 2 + 1], bx = T[body[j] * 2], by = T[body[j] * 2 + 1];
    const [x0, y0] = shape[0], [x1, y1] = shape[j];
    const ang = Math.atan2(by - ay, bx - ax) - Math.atan2(y1 - y0, x1 - x0), c = Math.cos(ang), s = Math.sin(ang);
    return { x: ax - (x0 * c - y0 * s), y: ay - (x0 * s + y0 * c), ang };
  }
}
