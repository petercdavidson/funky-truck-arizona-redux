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
// wheels start overlapping the body where they sat in their wheel arches. Each edge of the body
// lets a wheel overlap it only as much as it did at the wreck, less and less over WRECK.release
// steps, and never more than it has since (so a wheel can't sink back in, or slide round its arch
// to sit deeper). Upright, the wheels are pushed out from under the body as that overlap goes;
// on its roof, a wheel in an arch that opens upwards hops up and out of it instead. A wheel on top
// of the body rolls along it; one under or beside it grips it, and one pinned under the body
// drags on the ground rather than carrying the body off. The body grips the ground as a whole,
// with friction from its whole weight (WRECK.bodyGrip), so it doesn't glide down gentle slopes.
// A wheel's spin counts: touching the ground or the body, its tyre grips and trades speed between
// its turning and its travel (a wheel landing while spinning is driven along by it); two wheels
// touching grip each other the same way, turning against each other like gears, and bounce off
// each other a little (the one on top taking all of it when the other is on the ground). A tyre's
// grip on the body is as strong as the weight pressing them together allows.
// Collisions are soft, too (an overlap is undone over a few steps).

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
  bodyShare: 0.3,
  groundedShare: 0.9,                                     // the same for a wheel on the ground under the body                                         // how much of a wheel-body overlap the (heavier) body is moved
  easeIn: 140,                                            // steps (2 s) before a wreck can settle
  release: 60,                                            // steps over which an overlap at the wreck stops being allowed
  soft: 0.35,                                             // the share of an overlap undone each pass (3 passes a step)
  restSpeed: 1,                                           // px a step into the ground (or another piece) below which nothing bounces
  slop: 0.5,                                              // px of overlap between pieces let be (so resting contact doesn't jitter)
  grip: 0.8,                                              // pieces sliding along each other keep this share of it a pass
  onTop: 0.5,                                             // a wheel is resting on top of the body if the way out of it points up at least this much
  bodyGrip: 0.3,                                          // the body on the ground: friction as a share of its weight on it (sliding stops on slopes gentler than about atan of this)
  roll: 0.995,
  pinnedGrip: 0.9,                                        // a wheel on the ground under the body: the share of their sliding over each other kept a pass
  tyreBounce: 0.45,                                       // two wheels meeting bounce apart with this share of how fast they met
  tyreRest: 0.25,                                         // px a step they must meet at to bounce at all (lower than the ground's: a little bounce even gently)
  spinInertia: 0.5,                                       // how hard a wheel is to spin up, for its weight (0.5 a solid disc, 1 a hoop)
  tyreGrip: 1,                                            // a tyre's grip: the most speed it can trade a step, for how hard it's pressed on
  staticSpeed: 0.15,                                      // px a step: a body or bar point on the ground sliding slower than this stops (static friction)
  sleepSpeed: 0.2,                                        // px a step: slower than this everywhere, on the ground, for sleepAfter steps, and the wreck stops
  sleepAfter: 35,
  popUp: 0.3,                                             // a wheel hops out of its arch if the way out points up at least this much (the y of the direction)
  popAway: 0.15,                                          // and a little away from the body's middle: this much of that direction added
  popClear: 4,                                            // px above the arch it hops (its speed is just enough to rise its depth plus this)
  liftEase: 12,                                           // steps over which the body and bars rise clear of any ground the cab had scraped into
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

/**
 * Where a circle at (x, y) of radius R overlaps the polygon's edges: one contact per edge it's
 * within R of (a corner shared by two edges counted once), each with how deep (pen) and which way
 * out (nx, ny). For a centre inside the polygon, null.
 */
export function edgeContacts(poly, x, y, R) {
  const out = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    if (t <= 0) continue; // (that corner is the previous edge's end)
    const px = ax + t * dx, py = ay + t * dy, d = Math.hypot(x - px, y - py);
    if (d >= R) continue;
    out.push({ edge: j, end: i, t, pen: R - d, nx: (x - px) / (d || 1e-6), ny: (y - py) / (d || 1e-6) });
  }
  return out;
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
    // the front). So it's lifted clear (with the bars, gradually: see below), or it would sink.
    // The wheel centres and the cab's roof probe are kept clear of the ground by the truck's own
    // collisions, so they are safe places to measure from (the chassis centre is not: it can sit
    // inside a sharp crest with a wheel either side).
    const refs = [[T[2], T[3]], [T[4], T[5]]];
    if (truck.probePrev) refs.push(truck.probePrev.slice());

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
    const nb = this.body.length, anchors = [0, Math.floor(nb / 3), Math.floor(nb * 2 / 3)].map((i) => this.body[i]);
    for (const bar of this.bars) if (bar.mount) for (const c of anchors) stick(bar.b, c);
    // How far the wheels overlap each other and the body to begin with, as the truck was (allowed,
    // at first). `allow` is how much is allowed now: it only ever shrinks, so a wheel that has
    // come partly out of the body can't sink back in.
    this.overlap0 = this.overlaps();
    this.allow = { ww: this.overlap0.ww };
    // (against the body, per edge: so a wheel can't slide round its arch to sit deeper in it either)
    const poly0 = this.outline();
    this.edges0 = this.wheels.map((w) => {
      const a = new Array(poly0.length).fill(0);
      for (const c of edgeContacts(poly0, this.T[w.p * 2], this.T[w.p * 2 + 1], WRECK.wheelRadius)) a[c.edge] = c.pen;
      return a;
    });
    this.allowEdges = this.edges0.map((a) => a.slice());
    // A wheel sitting in its arch with the arch's open side facing up (the truck on its roof or
    // side) can't fall out of it: it hops out instead, up out of the arch and a little away from
    // the body, just fast enough to clear it (as if the suspension let it go).
    this.wheels.forEach((w, n) => {
      const depth = this.overlap0.wb[n];
      if (depth <= 0) return;
      const h = nearestOnPolygon(poly0, this.T[w.p * 2], this.T[w.p * 2 + 1]);
      if (h.inside) return;
      let nx = this.T[w.p * 2] - h.x, ny = this.T[w.p * 2 + 1] - h.y;
      const l = Math.hypot(nx, ny) || 1e-6;
      nx /= l; ny /= l;
      if (ny > -WRECK.popUp) return; // (open side not facing up: it falls out by itself)
      const [cx, cy] = this.centre, away = Math.hypot(this.T[w.p * 2] - cx, this.T[w.p * 2 + 1] - cy) || 1;
      let dx = nx + (this.T[w.p * 2] - cx) / away * WRECK.popAway, dy = ny + (this.T[w.p * 2 + 1] - cy) / away * WRECK.popAway;
      const dl = Math.hypot(dx, dy) || 1;
      const v = Math.sqrt(2 * this.gravityAt(truck) * (depth + WRECK.popClear));
      this.P[w.p * 2] -= dx / dl * v; this.P[w.p * 2 + 1] -= dy / dl * v;
    });
    // How far the body and bars need lifting to be clear of the ground (see the comment above),
    // done gradually over WRECK.liftEase steps from where they are, not at once (a jump): until
    // then, the ground they hit is lowered by however much lift is still to come.
    const parts = this.thin.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
    const T0 = this.T.slice();
    this.liftClear(parts, refs);
    this.lift = [this.T[parts[0] * 2] - T0[parts[0] * 2], this.T[parts[0] * 2 + 1] - T0[parts[0] * 2 + 1]];
    for (const i of parts) {
      this.T[i * 2] -= this.lift[0]; this.T[i * 2 + 1] -= this.lift[1];
      this.P[i * 2] -= this.lift[0]; this.P[i * 2 + 1] -= this.lift[1];
    }
    this.steps = 0;
    this.gravity = this.gravityAt(truck); // (Sandbox can change it)
  }

  gravityAt(truck) { return truck.gravity ?? GRAVITY; }

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
    const stop = (A, B, nx, ny, share, keep = WRECK.grip, bounce = WRECK.wheel.bounce, rest = WRECK.restSpeed) => {
      const avg = (L) => L.reduce((s, i) => { const v = vel(i); return [s[0] + v[0] / L.length, s[1] + v[1] / L.length]; }, [0, 0]);
      const va = avg(A), vb = avg(B), rx = vb[0] - va[0], ry = vb[1] - va[1], vn = rx * nx + ry * ny;
      // grip: some of their sliding along each other goes (pieces can rest on each other, not skate)
      const tx = rx - vn * nx, ty = ry - vn * ny, g = 1 - keep;
      for (const i of A) speedUp(i, tx * g * (1 - share), ty * g * (1 - share));
      for (const i of B) speedUp(i, -tx * g * share, -ty * g * share);
      if (vn >= 0) return 0; // already parting
      const j = -vn * (1 + (-vn > rest ? bounce : 0));
      for (const i of A) speedUp(i, -nx * j * (1 - share), -ny * j * (1 - share));
      for (const i of B) speedUp(i, nx * j * share, ny * j * share);
      return -vn; // (how hard they came together)
    };
    // wheel against wheel: equal shares
    const dx = T[b * 2] - T[a * 2], dy = T[b * 2 + 1] - T[a * 2 + 1];
    const A = this.allow, d = Math.hypot(dx, dy);
    A.ww = Math.min(A.ww, O.ww * ease, Math.max(0, 2 * R - d));
    const o = 2 * R - d - A.ww - WRECK.slop;
    if (o > 0) {
      const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0, m = o * k;
      // (one resting on the ground under the other is held by the ground: the one on top takes the
      // whole push and the whole bounce, rather than half of it going into the ground)
      const G = this.restingOnGround || [false, false];
      const aHeld = G[0] && ny < -WRECK.popUp, bHeld = G[1] && ny > WRECK.popUp;
      const share = aHeld && !bHeld ? 1 : bHeld && !aHeld ? 0 : 0.5;
      move(a, -nx * m * (1 - share), -ny * m * (1 - share));
      move(b, nx * m * share, ny * m * share);
      // (they bounce off each other a little even when they meet gently; their sliding over each
      // other is left to their tyres' grip, with their spin, in step())
      this.wheelsHit = Math.max(this.wheelsHit, stop([a], [b], nx, ny, share, WRECK.roll, WRECK.tyreBounce, WRECK.tyreRest));
      this.wheelsTouch = [nx, ny];
    }
    // wheel against the body's outline (the body, heavier, moves WRECK.bodyShare of it), edge by
    // edge: each edge allows only the overlap it had with that wheel at the wreck, less and less
    // over WRECK.release steps, and never more than it has had since
    const poly = this.outline();
    [a, b].forEach((w, n) => {
      const x = T[w * 2], y = T[w * 2 + 1];
      let contacts = edgeContacts(poly, x, y, R);
      const AE = this.allowEdges[n], E0 = this.edges0[n];
      if (nearestOnPolygon(poly, x, y).inside) {
        // (its centre got inside: straight out the nearest way, allowing nothing)
        const h = nearestOnPolygon(poly, x, y);
        const l = Math.hypot(h.x - x, h.y - y) || 1e-6;
        contacts = [{ edge: -1, pen: R + h.d, nx: (h.x - x) / l, ny: (h.y - y) / l }];
      }
      // (the edges it's too far into make one contact: out the way they all push, by the deepest)
      let sx = 0, sy = 0, deepest = 0, at = null;
      for (const c of contacts) {
        let allowed = 0;
        if (c.edge >= 0) allowed = AE[c.edge] = Math.min(AE[c.edge], E0[c.edge] * ease, c.pen);
        const over = c.pen - allowed - WRECK.slop;
        if (over <= 0) continue;
        sx += c.nx * over; sy += c.ny * over;
        if (over > deepest) { deepest = over; at = c.edge >= 0 ? [this.body[c.edge], this.body[c.end], c.t] : null; }
      }
      if (deepest <= 0) return;
      let l = Math.hypot(sx, sy) || 1e-6, nx = sx / l, ny = sy / l;
      // A wheel still coming out of an arch above it (the truck the right way up, more or less) is
      // pushed out from under the body, towards its nearer end: the wheels roll out from under it
      // and the body comes down between them, rather than being lifted onto them and rolling off.
      if (this.steps < WRECK.release && ny > WRECK.popUp && E0.some((v) => v > 0)) {
        const [cx, cy] = this.centre, ang = Wreck.bodyPose(T, this.body, this.shape).ang;
        const ax = Math.cos(ang), ay = Math.sin(ang), side = Math.sign((x - cx) * ax + (y - cy) * ay) || 1;
        nx += ax * side; ny += ay * side;
        l = Math.hypot(nx, ny) || 1e-6; nx /= l; ny /= l;
      }
      this.wheelOnBody = true;
      this.rubbing[n] = [nx, ny];
      this.rubAt[n] = at; // (where on the body: the edge's two points and how far along it)
      // (a wheel on the ground, with the body on it, is held there by the ground: the body takes
      // most of the push, rather than its weight squeezing the wheel out sideways step by step)
      const s = this.grounded?.[n] && ny > WRECK.onTop ? WRECK.groundedShare : WRECK.bodyShare;
      const m = deepest * k;
      move(w, nx * m * (1 - s), ny * m * (1 - s));
      for (const i of this.body) move(i, -nx * m * s, -ny * m * s);
      // (their sliding along each other is left to the tyre's grip, with its spin, in step(): as much
      // as how hard they're pressed together allows, so a wheel against the body's side slides off
      // it rather than clinging to it)
      // (but one on the ground with the body resting on it holds the body too: it can't skate over it)
      const pinned = this.grounded?.[n] && ny > WRECK.onTop;
      this.rubHit[n] = Math.max(this.rubHit[n], stop(this.body, [w], nx, ny, 1 - s, pinned ? WRECK.pinnedGrip : WRECK.roll));
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
    // The body and bars rise a little more out of the ground (moved now and a step ago alike: no speed).
    const lifting = this.steps < WRECK.liftEase;
    const liftLeft = (n) => { const t = Math.min(1, n / WRECK.liftEase); return 1 - t * t * (3 - 2 * t); };
    const now = lifting ? liftLeft(this.steps + 1) : 0;
    if (lifting) {
      const up = liftLeft(this.steps) - now, [lx, ly] = this.lift;
      for (let i = 0; i < this.thin.length; i++) {
        if (!this.thin[i]) continue;
        T[i * 2] += lx * up; T[i * 2 + 1] += ly * up; P[i * 2] += lx * up; P[i * 2 + 1] += ly * up;
      }
    }
    // (until they've risen all the way, the ground they hit is lowered by what's still to come)
    const ox = lifting ? this.lift[0] * now : 0, oy = lifting ? this.lift[1] * now : 0;
    this.wheelOnBody = false;
    this.wheelsTouch = null;
    this.rubbing = [null, null]; // per wheel: the body's normal where the wheel touches it
    this.rubAt = [null, null];   // and where
    this.rubHit = [0, 0];        // and how hard it came against it
    this.wheelsHit = 0;          // how hard the wheels came together
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
        const thin = this.thin[i], w = thin ? this.thinWorld : this.wheelWorld;
        const sx = thin ? ox : 0, sy = thin ? oy : 0;
        const h = w.collide(from[i * 2] + sx, from[i * 2 + 1] + sy, T[i * 2] + sx, T[i * 2 + 1] + sy);
        if (h) { T[i * 2] = h.x - sx; T[i * 2 + 1] = h.y - sy; touched[i] = h; }
      }
    }
    // Whether the body is touching the ground (any side of it) or resting on a wheel, for damage to a truck wrecked on purpose.
    this.bodyTouching = this.wheelOnBody || this.body.some((i) => touched[i]);
    // What the game kicks dirt up from (it reads these, and never changes the pieces): each
    // wheel's ground contact, and the body's first point on the ground, { i, h }.
    this.wheelHit = this.wheels.map((w) => touched[w.p]);
    const bi = this.body.find((i) => touched[i]);
    this.bodyHit = bi === undefined ? null : { i: bi, h: touched[bi] };
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
      // (a wheel with the body on it, pinned between the body and the ground, can't roll freely
      // under that weight: it drags like the body does, rather than carrying the body off on it)
      const pinned = wheel && this.wheels.some((w, n) => w.p === i && this.rubbing[n] && this.rubbing[n][1] > WRECK.onTop);
      if ((!wheel || pinned) && Math.hypot(tx, ty) < WRECK.staticSpeed) { tx = 0; ty = 0; }
      const m = this.thin[i] || pinned ? WRECK.part : WRECK.wheel;
      // (a slow touch doesn't bounce: resting on the ground, gravity alone would make it hop)
      const out = vn < -WRECK.restSpeed ? -vn * m.bounce : vn < 0 ? 0 : vn;
      P[i * 2] = T[i * 2] - (tx * m.friction + h.nx * out);
      P[i * 2 + 1] = T[i * 2 + 1] - (ty * m.friction + h.ny * out);
    }
    // The body on the ground: friction on the body as a whole, from its whole weight on the ground
    // (and how hard it hit it), not just at the points that happen to touch. It takes away up to
    // WRECK.bodyGrip of that from its sliding, and stops it if that's all there is.
    const down = this.body.filter((i) => touched[i]);
    if (down.length) {
      let nx = 0, ny = 0, hit = 0;
      for (const i of down) {
        nx += touched[i].nx; ny += touched[i].ny;
        const vin = (aimed[i * 2] - from[i * 2]) * touched[i].nx + (aimed[i * 2 + 1] - from[i * 2 + 1]) * touched[i].ny;
        hit = Math.max(hit, -vin);
      }
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
      let vx = 0, vy = 0;
      for (const i of this.body) { vx += T[i * 2] - P[i * 2]; vy += T[i * 2 + 1] - P[i * 2 + 1]; }
      vx /= this.body.length; vy /= this.body.length;
      const vn = vx * nx + vy * ny, tx = vx - vn * nx, ty = vy - vn * ny, vt = Math.hypot(tx, ty);
      const weight = this.gravity * Math.max(0, -ny); // (its weight's push into the ground: g cos(slope))
      const cut = Math.min(vt, WRECK.bodyGrip * (weight + Math.max(0, hit - this.gravity)));
      if (vt > 1e-9 && cut > 0) {
        for (const i of this.body) { P[i * 2] += tx / vt * cut; P[i * 2 + 1] += ty / vt * cut; }
      }
    }
    // Wheels and their spin. A wheel keeps spinning in the air. Touching the ground or the body,
    // its tyre grips: if it's turning faster or slower than it's rolling, the grip trades speed
    // between the two until they match. So a wheel landing while spinning fast is driven along
    // (or back, spinning backwards), one landing without spin is slowed a little as it spins up,
    // and one already rolling as fast as it turns just rolls on. How much the grip can trade in a
    // step is limited by how hard the wheel presses on what it touches (WRECK.tyreGrip of that).
    const bodyV = () => {
      let bx = 0, by = 0;
      for (const i of this.body) { bx += T[i * 2] - P[i * 2]; by += T[i * 2 + 1] - P[i * 2 + 1]; }
      return [bx / this.body.length, by / this.body.length];
    };
    /** Wheel w touching a surface with normal (nx, ny) (out of it, towards the wheel), sliding over it at (rvx, rvy), pressed on it with `press` (speed): returns the change to the sliding velocity. */
    const grip = (w, nx, ny, rvx, rvy, press) => {
      const tx = ny, ty = -nx;                                   // along the surface (the way spin rolls it)
      const slide = rvx * tx + rvy * ty;                         // how fast it's moving along the surface
      const turn = -w.spin * this.circumference / 360;           // how fast its turning would roll it
      const k = WRECK.spinInertia, lim = WRECK.tyreGrip * press;
      const d = Math.max(-lim, Math.min(lim, (turn - slide) * k / (1 + k)));
      w.spin = -(turn - d / k) * 360 / this.circumference;       // (what the wheel gains in speed, its turning loses)
      return [tx * d, ty * d];
    };
    this.wheels.forEach((w, n) => {
      const h = touched[w.p], p = w.p;
      if (h) {
        // on the ground: pressed on it by how hard it came down, or at least its weight
        const vin = (aimed[p * 2] - from[p * 2] + this.kick[p * 2]) * h.nx + (aimed[p * 2 + 1] - from[p * 2 + 1] + this.kick[p * 2 + 1]) * h.ny;
        const press = Math.max(this.gravity * Math.max(0, -h.ny), -vin);
        const [dx, dy] = grip(w, h.nx, h.ny, T[p * 2] - P[p * 2], T[p * 2 + 1] - P[p * 2 + 1], press);
        P[p * 2] -= dx; P[p * 2 + 1] -= dy;
      }
      // (a wheel still coming off its axle, out of its arch, isn't gripping the body yet)
      const leaving = this.steps < WRECK.release && this.edges0[n].some((v) => v > 0);
      if (this.rubbing[n] && !leaving) {
        // against the body: the same, relative to the body, which takes WRECK.bodyShare of the change
        // (the body's surface where the wheel touches it: it may be turning, not just moving)
        const [nx, ny] = this.rubbing[n], at = this.rubAt[n];
        // (a wheel on the ground under the body passes most of the change to the body, as with the push)
        const sh = this.grounded?.[n] && ny > WRECK.onTop ? WRECK.groundedShare : WRECK.bodyShare;
        let [bx, by] = bodyV();
        if (at) {
          const [i, j, t] = at;
          bx = (T[i * 2] - P[i * 2]) * (1 - t) + (T[j * 2] - P[j * 2]) * t;
          by = (T[i * 2 + 1] - P[i * 2 + 1]) * (1 - t) + (T[j * 2 + 1] - P[j * 2 + 1]) * t;
        }
        // (pressed together by the weight of whichever is on top, and how hard they met: the grip
        // can change the one on top's speed by up to its weight's worth, its share of the change)
        const press = (ny > 0 ? this.gravity * ny / sh : this.gravity * -ny / (1 - sh)) + this.rubHit[n];
        const [dx, dy] = grip(w, nx, ny, T[p * 2] - P[p * 2] - bx, T[p * 2 + 1] - P[p * 2 + 1] - by, press);
        P[p * 2] -= dx * (1 - sh); P[p * 2 + 1] -= dy * (1 - sh);
        for (const i of this.body) { P[i * 2] += dx * sh; P[i * 2 + 1] += dy * sh; }
      }
    });
    // Wheel against wheel: their tyres grip each other the same way, turning against each other
    // like gears, so one on top of the other rolls off it rather than sitting there (or spinning
    // freely on it).
    if (this.wheelsTouch) {
      const [nx, ny] = this.wheelsTouch, tx = ny, ty = -nx, [wa, wb] = this.wheels, k = WRECK.spinInertia;
      const va = (T[wa.p * 2] - P[wa.p * 2]) * tx + (T[wa.p * 2 + 1] - P[wa.p * 2 + 1]) * ty;
      const vb = (T[wb.p * 2] - P[wb.p * 2]) * tx + (T[wb.p * 2 + 1] - P[wb.p * 2 + 1]) * ty;
      const ta = -wa.spin * this.circumference / 360, tb = -wb.spin * this.circumference / 360;
      // (how fast their surfaces slide over each other where they touch; a push j along the
      // contact speeds b along and a back, and slows both their turning)
      const slip = (vb - tb) - (va + ta);
      const lim = WRECK.tyreGrip * (this.gravity * Math.abs(ny) + this.wheelsHit);
      const j = Math.max(-lim, Math.min(lim, -slip / (2 * (1 + 1 / k))));
      P[wb.p * 2] -= tx * j; P[wb.p * 2 + 1] -= ty * j;
      P[wa.p * 2] += tx * j; P[wa.p * 2 + 1] += ty * j;
      wa.spin = -(ta - j / k) * 360 / this.circumference;
      wb.spin = -(tb - j / k) * 360 / this.circumference;
    }
    for (const w of this.wheels) w.rot += w.spin;
    this.grounded = this.wheels.map((w) => !!touched[w.p]);
    // (a wheel resting on the ground doesn't touch it every step: on it in any of the last few)
    this.groundAge = this.wheels.map((w, n) => (touched[w.p] ? 0 : (this.groundAge?.[n] ?? 99) + 1));
    this.restingOnGround = this.groundAge.map((a) => a <= 3);
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
