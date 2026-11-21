// wreck.js — outside Classic, a wrecked truck comes apart: the body, both wheels and the four
// suspension bars come loose and the truck collapses. Each piece keeps the speed and spin it had;
// nothing is added. No DOM access (runs under Node for tests).
//
// Every piece is made of Verlet points like the truck itself, under the same gravity. The body is
// a rigid box of four points, each bar is two points, and each wheel is one point that collides
// with the normal (wheel-sized) collision world. The box and bars use a second collision world
// built with a thin offset, so they rest on the ground rather than floating a wheel's height up.

const GRAVITY = 0.11;     // the truck's gravity per step (Truck.integrate)

// The body sprite's outline in its own frame (origin at the rear body mount, x towards the front
// mount, 0.7 scale as drawn), shrunk a little so the corners sit on the ground convincingly.
const BODY_BOX = [[-10, -26], [62, -26], [62, 10], [-10, 10]];

// Per piece: share of the speed into the ground that bounces back, share of the speed along the
// ground kept on each contact, and share of the speed kept each step in the air.
export const WRECK = {
  part: { bounce: 0.3, friction: 0.86, air: 0.998 },     // the body and bars scrape to a halt
  wheel: { bounce: 0.5, friction: 0.997, air: 0.9998 },  // the wheels roll on and bounce
};

export class Wreck {
  /**
   * @param truck     the Truck at the moment it was wrecked
   * @param wheelWorld the game's CollisionWorld (offset for the wheel radius)
   * @param thinWorld  a CollisionWorld of the same level built with a small offset
   */
  constructor(truck, wheelWorld, thinWorld) {
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

    // Body: the four box corners, placed from the body mounts now and a step ago.
    const frame = (A, ax, ay, bx, by) => {
      const ang = Math.atan2(by - ay, bx - ax), c = Math.cos(ang), s = Math.sin(ang);
      return BODY_BOX.map(([x, y]) => [ax + x * c - y * s, ay + x * s + y * c]);
    };
    const now = frame(T, T[6], T[7], T[8], T[9]);
    const before = frame(P, P[6], P[7], P[8], P[9]);
    this.body = now.map((p, i) => add(p[0], p[1], before[i][0], before[i][1], true));
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) stick(this.body[a], this.body[b]);

    // Wheels, keeping their spin.
    this.wheels = [
      { p: add(T[2], T[3], P[2], P[3], false), rot: truck.rearWheelRot, spin: truck.rearSpin },
      { p: add(T[4], T[5], P[4], P[5], false), rot: truck.frontWheelRot, spin: truck.frontSpin },
    ];
    this.circumference = truck.circumference;

    // Bars, from the chassis centre to each body mount and wheel (drawn as in Renderer.truck).
    this.bars = [[6, 1], [8, 1], [2, 0], [4, 0]].map(([p, frameIndex]) => {
      const a = add(cx, cy, P[0], P[1], true);
      const b = add(T[p], T[p + 1], P[p], P[p + 1], true);
      stick(a, b);
      return { a, b, frame: frameIndex };
    });
    this.steps = 0;
  }

  /** The body's middle, for the camera to follow. */
  get centre() {
    let x = 0, y = 0;
    for (const i of this.body) { x += this.T[i * 2]; y += this.T[i * 2 + 1]; }
    return [x / 4, y / 4];
  }

  step() {
    const T = this.T, P = this.P;
    for (let i = 0; i < T.length; i += 2) {
      const x = T[i], y = T[i + 1];
      const air = (this.thin[i >> 1] ? WRECK.part : WRECK.wheel).air;
      T[i] += (x - P[i]) * air;
      T[i + 1] += (y - P[i + 1]) * air + GRAVITY;
      P[i] = x; P[i + 1] = y;
    }
    // P now holds where each point was at the start of the step: sweep collisions from there.
    const from = P.slice(0);
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
      for (let i = 0; i < this.thin.length; i++) {
        const w = this.thin[i] ? this.thinWorld : this.wheelWorld;
        const h = w.collide(from[i * 2], from[i * 2 + 1], T[i * 2], T[i * 2 + 1]);
        if (h) { T[i * 2] = h.x; T[i * 2 + 1] = h.y; touched[i] = h; }
      }
    }
    // Bounce and friction for the points that touched the ground.
    for (let i = 0; i < touched.length; i++) {
      const h = touched[i];
      if (!h) continue;
      const vx = T[i * 2] - from[i * 2], vy = T[i * 2 + 1] - from[i * 2 + 1];
      const vn = vx * h.nx + vy * h.ny;
      const tx = vx - vn * h.nx, ty = vy - vn * h.ny;
      const m = this.thin[i] ? WRECK.part : WRECK.wheel;
      const out = vn < 0 ? -vn * m.bounce : vn;
      P[i * 2] = T[i * 2] - (tx * m.friction + h.nx * out);
      P[i * 2 + 1] = T[i * 2 + 1] - (ty * m.friction + h.ny * out);
    }
    // Wheels roll on the ground and keep spinning in the air.
    for (const w of this.wheels) {
      const h = touched[w.p];
      if (h) {
        const vx = T[w.p * 2] - P[w.p * 2], vy = T[w.p * 2 + 1] - P[w.p * 2 + 1];
        w.spin = (h.ny * vx - h.nx * vy) / this.circumference * -360;
      }
      w.rot += w.spin;
    }
    this.steps++;
  }

  /** Where to draw the body: the rear mount's position and the angle (radians). */
  static bodyPose(T, body) {
    const ax = T[body[0] * 2], ay = T[body[0] * 2 + 1], bx = T[body[1] * 2], by = T[body[1] * 2 + 1];
    const ang = Math.atan2(by - ay, bx - ax), c = Math.cos(ang), s = Math.sin(ang);
    const [x0, y0] = BODY_BOX[0];
    return { x: ax - (x0 * c - y0 * s), y: ay - (x0 * s + y0 * c), ang };
  }
}
