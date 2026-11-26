// critters.js — Sandbox's birds and tumbleweeds, and where its clouds are. No DOM access (runs
// under Node for tests).
//
// Birds fly across the sky in little flocks; drive (or fly) into one and it's knocked tumbling,
// in a puff of feathers, and falls to the ground. Tumbleweeds roll along the ground in the wind,
// hopping over bumps; hit one and it's sent flying. Each has its own simple physics, and neither
// ever touches the truck: they're scenery you can hit. They live near the view: one that's been
// left far behind comes back, out of sight, somewhere ahead.
//
// Clouds aren't simulated: `cloudsNear` says where they are from a hash of where you look, the
// same every time, so they stay put in the sky (a long way up there are more of them). They show
// which way you're going when there's no ground in sight.

const TILE = 64;
export const CRITTERS = {
  birdRadius: 9,          // px: how near the truck a bird is hit
  weedRadius: 18,         // px: a tumbleweed's size
  truckRadius: 46,        // px round the truck's chassis centre and its wheels that hits things
  gravity: 0.11,          // px/step² for things falling (the truck's own, at Earth gravity)
  wind: 0.012,            // px/step² pushing tumbleweeds along
  farAway: 1400,          // px from the view's middle: further than that, it comes back elsewhere
};

/** A small, repeatable hash of two integers to [0, 1). */
export function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * The clouds whose middles are in the box (x0, y0)-(x1, y1), in cloud space (the world with
 * the course's scrolling taken out). Each: { x, y, w, h, puffs: [[dx, dy, r], ...], alpha }.
 * One may sit in each cell of a CELL_W x CELL_H grid; above `top` (the level's top) there are
 * more, higher up more still.
 */
export const CLOUD_CELL = [520, 300];
export function cloudsNear(x0, y0, x1, y1, top = 0) {
  const [CW, CH] = CLOUD_CELL, out = [];
  for (let cy = Math.floor(y0 / CH) - 1; cy <= Math.floor(y1 / CH) + 1; cy++) {
    const height = top - cy * CH;   // how far above the level's top (px)
    const chance = height < -2 * TILE ? 0 : height < 6 * TILE ? 0.18 : height < 30 * TILE ? 0.45 : 0.6;
    if (!chance) continue;
    for (let cx = Math.floor(x0 / CW) - 1; cx <= Math.floor(x1 / CW) + 1; cx++) {
      if (hash2(cx, cy, 1) >= chance) continue;
      const w = 110 + 190 * hash2(cx, cy, 2), h = w * (0.32 + 0.12 * hash2(cx, cy, 3));
      const x = (cx + 0.15 + 0.7 * hash2(cx, cy, 4)) * CW, y = (cy + 0.15 + 0.7 * hash2(cx, cy, 5)) * CH;
      const n = 4 + Math.floor(4 * hash2(cx, cy, 6)), puffs = [];
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 0.5;
        const r = h * (0.45 + 0.35 * Math.sin(Math.PI * t)) * (0.85 + 0.3 * hash2(cx * 7 + i, cy, 7));
        puffs.push([(t - 0.5) * (w - h * 0.6), h * 0.12 - r * 0.35, r]);
      }
      out.push({ x, y, w, h, puffs, alpha: 0.55 + 0.35 * hash2(cx, cy, 8) });
    }
  }
  return out;
}

export class Critters {
  /** `random` returns [0, 1) (the game's, so tests can fix it). */
  constructor(random = Math.random) {
    this.random = random;
    this.birds = [];
    this.weeds = [];
    this.feathers = [];
    this.wantBirds = 0;
    this.wantWeeds = 0;
    this.events = [];  // this step's hits: { kind: 'bird' | 'weed', x, y, speed } (for sounds)
  }

  /** How many birds and tumbleweeds to keep about. */
  setCounts(birds, weeds) {
    this.wantBirds = birds; this.wantWeeds = weeds;
    this.birds.length = Math.min(this.birds.length, birds);
    this.weeds.length = Math.min(this.weeds.length, weeds);
  }

  /** Move them all left by dx and up by dy (the world moved: Endless's scrolling, a loop's repeat). */
  shift(dx, dy) {
    for (const A of [this.birds, this.weeds, this.feathers]) for (const o of A) { o.x -= dx; o.y -= dy; }
  }

  /** The ground's height under x, from y up to `depth` px below; null if there's none. */
  static groundAt(world, x, y, depth = 900) {
    const h = world?.down(x, y, y + depth);
    return h ? h.y + (world.offset || 0) : null;
  }

  /**
   * A new bird somewhere just out of sight round the view (centre cx, cy; half sizes hw, hh),
   * flying across it. A flock is a few together.
   */
  spawnBird(view, flock = null) {
    const R = this.random;
    let x, y, dir;
    if (flock) { dir = flock.dir; x = flock.x - dir * (20 + 30 * R()); y = flock.y + (R() - 0.5) * 50; }
    else {
      dir = R() < 0.5 ? -1 : 1;
      // from the side it flies away from, or above or below
      x = view.cx - dir * (view.hw + 60 + 200 * R());
      y = view.cy + (R() - 0.5) * 2 * view.hh * 1.2;
    }
    const b = { x, y, vx: dir * (1.6 + 1.2 * R()), vy: 0, dir, flap: R() * 6, hit: false, spin: 0, rot: 0, rest: 0, life: 0 };
    this.birds.push(b);
    return b;
  }

  /** A new tumbleweed out of sight on the ground, upwind of the view. */
  spawnWeed(view, world) {
    const R = this.random;
    const side = R() < 0.5 ? -1 : 1;
    const x = view.cx + side * (view.hw + 80 + 300 * R());
    const g = Critters.groundAt(world, x, view.cy - view.hh * 2, view.hh * 6);
    if (g === null) return null;
    const w = { x, y: g - CRITTERS.weedRadius, vx: (0.5 + R()) * (side > 0 ? -1 : 1) * 0.6, vy: 0, rot: R() * 6, flying: false, life: 0 };
    this.weeds.push(w);
    return w;
  }

  /**
   * One step. `truck`: the Truck (read only, never changed). `view`: { cx, cy, hw, hh } in world
   * px. `world`: the CollisionWorld (for the ground under tumbleweeds and falling birds).
   */
  step(truck, view, world, gravity = CRITTERS.gravity) {
    const C = CRITTERS, R = this.random;
    this.events.length = 0;
    const far = (o) => Math.abs(o.x - view.cx) > C.farAway + view.hw || Math.abs(o.y - view.cy) > C.farAway + view.hh;
    // keep the numbers up (a few at a time: no crowd appearing at once)
    this.birds = this.birds.filter((b) => !far(b) && !(b.hit && b.rest > 400));
    this.weeds = this.weeds.filter((w) => !far(w));
    if (this.birds.length < this.wantBirds && R() < 0.05) {
      const lead = this.spawnBird(view);
      const n = Math.min(this.wantBirds - this.birds.length, Math.floor(R() * 4));
      for (let i = 0; i < n; i++) this.spawnBird(view, lead);
    }
    if (this.weeds.length < this.wantWeeds && R() < 0.03) this.spawnWeed(view, world);
    // what hits: circles round the truck's chassis centre and its wheels (and how fast each moves)
    const T = truck?.T, P = truck?.P;
    const hitters = truck ? [0, 1, 2].map((p) => [T[p * 2], T[p * 2 + 1], T[p * 2] - P[p * 2], T[p * 2 + 1] - P[p * 2 + 1], p ? truck.wheelRadius + 6 : C.truckRadius]) : [];
    const hitBy = (o, r) => hitters.find(([x, y, , , hr]) => (o.x - x) ** 2 + (o.y - y) ** 2 < (r + hr) ** 2);

    for (const b of this.birds) {
      b.life++;
      if (!b.hit) {
        b.flap += 0.35;
        b.vy += (Math.sin(b.life * 0.03 + b.flap * 0.1) * 0.02) - b.vy * 0.05;
        b.x += b.vx; b.y += b.vy;
        const h = hitBy(b, C.birdRadius);
        if (h) {
          // knocked away with (most of) the truck's speed, and a bit outward from it, spinning
          const [hx, hy, vx, vy] = h, dx = b.x - hx, dy = b.y - hy, d = Math.hypot(dx, dy) || 1;
          const sp = Math.hypot(vx, vy);
          b.hit = true;
          b.vx = vx * 0.9 + dx / d * (2 + sp * 0.3); b.vy = vy * 0.9 + dy / d * (2 + sp * 0.3) - 2;
          b.spin = (R() - 0.5) * 0.6;
          for (let i = 0; i < 10; i++) {
            const a = R() * Math.PI * 2, s = 0.5 + R() * 2.5;
            this.feathers.push({ x: b.x, y: b.y, vx: b.vx * 0.3 + Math.cos(a) * s, vy: b.vy * 0.3 + Math.sin(a) * s, rot: R() * 6, spin: (R() - 0.5) * 0.3, life: 90 + R() * 80 });
          }
          this.events.push({ kind: 'bird', x: b.x, y: b.y, speed: sp });
        }
      } else if (b.rest === 0) {
        // tumbling down until it lands
        b.vy += gravity; b.vx *= 0.995;
        b.x += b.vx; b.y += b.vy; b.rot += b.spin;
        const g = Critters.groundAt(world, b.x, b.y - b.vy - 8, Math.abs(b.vy) + 16);
        if (g !== null && b.y + 4 >= g) { b.y = g - 4; b.rest = 1; }
      } else b.rest++;
    }

    for (const w of this.weeds) {
      w.life++;
      const g = Critters.groundAt(world, w.x, w.y - 40, 80 + Math.max(0, w.vy) + 400);
      if (g === null) { w.vy += gravity; w.x += w.vx; w.y += w.vy; w.rot += w.vx / C.weedRadius; continue; }
      // the slope under it, from either side
      const gl = Critters.groundAt(world, w.x - 12, w.y - 60, 500) ?? g, gr = Critters.groundAt(world, w.x + 12, w.y - 60, 500) ?? g;
      const slope = (gr - gl) / 24;
      const onGround = w.y + C.weedRadius >= g - 1;
      if (onGround) {
        // rolling: gravity down the slope, the wind, rolling friction; now and then a little hop
        w.vx += gravity * slope / Math.sqrt(1 + slope * slope) + C.wind * Math.sign(w.vx || 1) - w.vx * 0.01;
        if (Math.abs(w.vy) < 0.5 && R() < 0.01) w.vy = -1.5 - R() * 2;
      }
      w.vy += gravity;
      w.x += w.vx; w.y += w.vy;
      const g2 = Critters.groundAt(world, w.x, w.y - 40, 80 + Math.max(0, w.vy) + 400) ?? g;
      if (w.y + C.weedRadius > g2) {
        w.y = g2 - C.weedRadius;
        if (w.vy > 0) w.vy = w.vy > 1.5 ? -w.vy * 0.45 : 0;
        w.flying = false;
      }
      w.rot += w.vx / C.weedRadius;
      const h = hitBy(w, C.weedRadius);
      if (h && !w.cool) {
        const [hx, hy, vx, vy] = h, dx = w.x - hx, dy = w.y - hy, d = Math.hypot(dx, dy) || 1, sp = Math.hypot(vx, vy);
        w.vx = vx * 1.1 + dx / d * 2; w.vy = Math.min(vy, 0) - 2 - sp * 0.4 + dy / d;
        w.flying = true; w.cool = 20;
        this.events.push({ kind: 'weed', x: w.x, y: w.y, speed: sp });
      }
      if (w.cool) w.cool--;
    }

    for (const f of this.feathers) {
      f.vy += gravity * 0.15; f.vx *= 0.96; f.vy *= 0.96;
      f.x += f.vx + Math.sin(f.life * 0.15) * 0.4; f.y += f.vy; f.rot += f.spin; f.life--;
    }
    this.feathers = this.feathers.filter((f) => f.life > 0);
  }
}
