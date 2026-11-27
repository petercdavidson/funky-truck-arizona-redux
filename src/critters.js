// critters.js — Sandbox's birds and tumbleweeds, and where its clouds are. No DOM access (runs
// under Node for tests).
//
// Birds fly across the sky in little flocks, climbing over the ground and turning back from walls;
// drive (or fly) into one, or blow it up with a missile (missiles home in on them), and it's
// knocked tumbling, in a puff of feathers, and falls to the ground. Tumbleweeds sit on the ground
// and roll down slopes; hit one and it's sent flying. Both collide with the ground as the truck's
// wheels do (the collision world's lines, pushed out by their size), so nothing falls through it,
// and neither ever touches the truck: they're scenery you can hit. They live round the view: one
// left behind out of sight goes, and a new one comes in out of sight, the way you're heading.
//
// Clouds aren't simulated: `cloudsNear` says where they are from a hash of where you look, the
// same every time, so they stay put in the sky (a long way up there are more of them). They show
// which way you're going when there's no ground in sight.

import { WRECK } from './wreck.js';

const TILE = 64;
export const CRITTERS = {
  birdRadius: 9,          // px: how near the truck a bird is hit
  weedRadius: 25 * 45 / 72, // px: a tumbleweed's size: its art's 50 px circle, drawn at the tyres' scale (45/72; Game.weedWorld pushes out by this)
  truckRadius: 46,        // px round the truck's chassis centre and its wheels that hits things
  gravity: 0.11,          // px/step² for things falling (the truck's own, at Earth gravity)
  gone: 500,              // px out of sight: further than that, it goes (and a new one comes)
  look: 26,               // steps a bird looks ahead for ground in its way
  wallLook: 90,           // px ahead a bird sees a wall it should turn back from
  turn: 0.07,             // px/step² a bird's speed changes by as it turns round
  clear: 70,              // px a bird keeps above the ground
  highest: 150 * 64 / 2.5, // px: no bird comes in more than 150 m above the ground
  weedBounce: 0.12,       // the share of a tumbleweed's speed into the ground it bounces back with
  weedKick: 0.15,         // ...and off the truck (its tyres, its chassis): pushed along, hardly thrown
  weedStill: 0.12,        // px/step: a tumbleweed moving less than this...
  weedSettle: 25,         // ...for this many steps comes to rest (asleep: it stays put until something moves it)
  weedRub: 0.2,           // the share of the speed two tumbleweeds slide against each other with that they lose each step
  weedGravity: 0.5,       // tumbleweeds are light: this share of the truck's gravity pulls them down...
  weedAir: 0.008,         // ...and they lose this share of their speed each step in the air (so they float down)
  weedSpinAir: 0.06,      // a big, airy ball: in the air it loses this share of its spin each step
  weedLand: 1.0,          // the truck coming down on one squirts it out sideways and up, this many times as fast as it came down
  weedBlast: 3,           // a blast throws a tumbleweed this many times as hard as a bird
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
 * the course's scrolling taken out). Each: { x, y, w, h, kind, puffs: [[dx, dy, r], ...],
 * bottom (its lowest point below y), alpha }.
 * One may sit in each cell of a CELL_W x CELL_H grid; above `top` (the level's top) there are
 * more, higher up more still. Each layer of clouds (`seed`) has its own, `density` times as many.
 * `depth`: the layer's share of the world's speed; heights count in the world (cloud space's over
 * `depth`), so a far layer, which hardly moves, still has its clouds where the sky is.
 */
export const CLOUD_CELL = [520, 300];
export const CLOUD_KINDS = ['heap', 'heap', 'sheet', 'puff', 'tower', 'ragged'];
export function cloudsNear(x0, y0, x1, y1, top = 0, seed = 0, density = 1, depth = 1) {
  const [CW, CH] = CLOUD_CELL, out = [];
  for (let cy = Math.floor(y0 / CH) - 1; cy <= Math.floor(y1 / CH) + 1; cy++) {
    const height = (top - cy * CH) / depth;   // how far above the level's top (world px)
    const chance = density * (height < -2 * TILE ? 0 : height < 6 * TILE ? 0.18 : height < 30 * TILE ? 0.45 : 0.6);
    if (!chance) continue;
    for (let cx = Math.floor(x0 / CW) - 1; cx <= Math.floor(x1 / CW) + 1; cx++) {
      if (hash2(cx, cy, 1 + 16 * seed) >= chance) continue;
      const H = (k) => hash2(cx, cy, k + 16 * seed);
      const x = (cx + 0.15 + 0.7 * H(4)) * CW, y = (cy + 0.15 + 0.7 * H(5)) * CH;
      const R = (i, k = 0) => hash2(cx * 7 + i, cy * 3 + k, 7 + 16 * seed);
      const puffs = [];
      // A row of puffs along a flat base, biggest in the middle (`bulge`), `lift` px up.
      const row = (w, h, n, lift = 0, bulge = 0.35, k = 0) => {
        for (let i = 0; i < n; i++) {
          const t = n > 1 ? i / (n - 1) : 0.5;
          const r = h * (0.45 + bulge * Math.sin(Math.PI * t)) * (0.8 + 0.4 * R(i, k));
          puffs.push([(t - 0.5) * (w - h * 0.6) + (R(i, k + 9) - 0.5) * h * 0.3, h * 0.12 - r * 0.35 - lift, r]);
        }
      };
      // Its shape (CLOUD_KINDS): a fair-weather heap, a long flat sheet, a little puff, a tall
      // tower, or a ragged line of bits.
      const kind = CLOUD_KINDS[Math.floor(H(9) * CLOUD_KINDS.length)];
      let w, h;
      if (kind === 'heap') {
        w = 120 + 170 * H(2); h = w * (0.32 + 0.12 * H(3));
        row(w, h, 4 + Math.floor(4 * H(6)));
        row(w * (0.45 + 0.2 * H(10)), h * 0.8, 2 + Math.floor(3 * H(11)), h * 0.45, 0.3, 1);
      } else if (kind === 'sheet') {
        w = 260 + 260 * H(2); h = w * (0.1 + 0.05 * H(3));
        row(w, h, 8 + Math.floor(6 * H(6)), 0, 0.15);
      } else if (kind === 'puff') {
        w = 45 + 60 * H(2); h = w * (0.45 + 0.15 * H(3));
        row(w, h, 2 + Math.floor(2 * H(6)), 0, 0.3);
      } else if (kind === 'tower') {
        w = 120 + 110 * H(2); h = w * (0.35 + 0.1 * H(3));
        const tiers = 3 + Math.floor(2 * H(6));
        for (let j = 0; j < tiers; j++) {
          const f = 1 - j / (tiers + 0.5);
          row(w * f, h * (0.75 + 0.25 * f), Math.max(2, Math.round(5 * f)), j * h * 0.6, 0.3, j);
        }
        h *= 1 + 0.6 * (tiers - 1);
      } else {
        // ragged: a few small heaps strung out in a line, a little up and down
        w = 220 + 200 * H(2); h = w * (0.13 + 0.05 * H(3));
        const bits = 3 + Math.floor(3 * H(6));
        for (let j = 0; j < bits; j++) {
          const bx = (j / (bits - 1) - 0.5) * w * 0.85, by = (R(j, 5) - 0.5) * h * 0.8, br = h * (0.6 + 0.7 * R(j, 6));
          for (let i = 0; i < 3; i++) puffs.push([bx + (i - 1) * br * 0.8, by - (i === 1 ? br * 0.3 : 0), br * (i === 1 ? 1 : 0.7)]);
        }
      }
      out.push({ x, y, w, h, kind, puffs, bottom: Math.max(...puffs.map(([, dy, r]) => dy + r)), alpha: 0.55 + 0.35 * H(8) });
    }
  }
  return out;
}

/** The moon's synodic month (days) and a new moon to count from (2000-01-06 18:14 UTC). */
export const LUNAR_MONTH = 29.530588853;
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);

/** How far through its month of phases the moon is at `ms` (0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter). */
export function moonPhase(ms = Date.now()) {
  const p = ((ms - NEW_MOON_MS) / 86400000 / LUNAR_MONTH) % 1;
  return p < 0 ? p + 1 : p;
}

/**
 * The moon's shadow at `phase` (moonPhase), as a polygon on a disc of radius 1 centred at 0,0 (as
 * seen from the northern hemisphere: lit from the right while waxing, from the left while waning).
 * Each point is [x, y]; null when it's full (no shadow).
 */
export function moonShadow(phase, n = 48) {
  const k = Math.cos(2 * Math.PI * phase);   // where the terminator crosses the middle (1 new, -1 full)
  if (k <= -0.999) return null;
  const waxing = phase < 0.5, pts = [];
  // down the dark limb, then back up the terminator
  for (let i = 0; i <= n; i++) {
    const y = -1 + 2 * i / n, w = Math.sqrt(Math.max(0, 1 - y * y));
    pts.push([waxing ? -w : w, y]);
  }
  for (let i = n; i >= 0; i--) {
    const y = -1 + 2 * i / n, w = Math.sqrt(Math.max(0, 1 - y * y));
    pts.push([(waxing ? k : -k) * w, y]);
  }
  return pts;
}

/**
 * The sky's colour high up (every mode but 2006 Mode): how much it darkens over the backdrop's
 * blue, and to what, at `km` above where the stage starts, from what the sky looks like straight
 * up at those heights: an airliner's deeper blue at 10 km, the U-2's dark blue at 20 km, a
 * balloon's navy at 30 km, near black past the stratopause (50 km) and black space by the
 * Kármán line (100 km). Stars come out as it goes dark. Clouds stop at the top of the weather
 * (thunderstorm tops, 12 to 18 km), and are only above CLOUDS_FROM. Returns { color: [r, g, b], alpha, stars, clouds } (0 to 1).
 */
export const SKY = [
  // km, colour, how much it covers the backdrop
  [6, [74, 128, 205], 0],
  [10, [42, 98, 196], 0.28],
  [20, [23, 63, 143], 0.62],
  [30, [11, 32, 86], 0.84],
  [50, [4, 12, 42], 0.95],
  [80, [1, 3, 12], 1],
  [100, [0, 0, 4], 1],
];
/**
 * Clouds are only in the sky above this height (km above the start): none from the ground. Climb
 * past it and they show from the top of the view down, as that height comes into it (no fade).
 */
export const CLOUDS_FROM = 0.3;
export function skyAt(km) {
  const ease = (a, b) => Math.max(0, Math.min(1, (km - a) / (b - a)));
  const t = (x) => x * x * (3 - 2 * x);
  let color = SKY[0][1], alpha = 0;
  if (km >= SKY[SKY.length - 1][0]) { color = SKY[SKY.length - 1][1]; alpha = 1; }
  else for (let i = 1; i < SKY.length; i++) {
    const [k0, c0, a0] = SKY[i - 1], [k1, c1, a1] = SKY[i];
    if (km > k1) continue;
    if (km <= k0) break;
    const f = (km - k0) / (k1 - k0);
    color = c0.map((c, j) => Math.round(c + (c1[j] - c) * f)); alpha = a0 + (a1 - a0) * f;
    break;
  }
  // (`clouds`: only the top of the weather; they're only above CLOUDS_FROM, which the renderer
  // shows from where that height is in the view up)
  return { color, alpha, stars: t(ease(30, 90)), clouds: 1 - t(ease(12, 18)) };
}

export class Critters {
  /** `random` returns [0, 1). */
  constructor(random = Math.random) {
    this.random = random;
    this.birds = [];
    this.weeds = [];
    this.feathers = [];
    this.wantBirds = 0;
    this.wantWeeds = 0;
    // (for the stats) birds knocked out of the sky and tumbleweeds hit, by the truck or its loose
    // pieces; and those your own missiles' blasts got (`blast` with `yours`)
    this.whacked = 0;
    this.tumbled = 0;
    this.shot = 0;
    this.exploded = 0;
    this.events = [];  // this step's hits: { kind: 'bird' (the truck hit it, or a blast: `blast`) | 'weed' (the truck hit it) | 'weedBounce' (a tumbleweed off the ground or another), x, y, speed } (for sounds; tumbleweeds' only in sight)
  }

  /** How many birds and tumbleweeds to keep about. */
  setCounts(birds, weeds) {
    this.wantBirds = birds; this.wantWeeds = weeds;
    this.birds.length = Math.min(this.birds.length, birds);
    this.weeds.length = Math.min(this.weeds.length, weeds);
  }

  /** Move them all left by dx and up by dy (the world moved: Endless's scrolling, a loop's repeat). */
  shift(dx, dy) {
    for (const A of [this.birds, this.weeds, this.feathers]) for (const o of A) { o.x -= dx; o.y -= dy; o.px -= dx; o.py -= dy; }
  }

  /**
   * Move o by its velocity through `world` (one-sided lines pushed out by o's size): where it would
   * cross one, it's put back out of it, and its velocity loses what went into the ground (keeping
   * `bounce` of it) and `rub` of what went along it. Returns the line's normal it hit, or null.
   */
  static move(o, world, bounce = 0, rub = 0) {
    const nx = o.x + o.vx, ny = o.y + o.vy;
    const h = world.collide(o.x, o.y, nx, ny);
    if (!h) { o.x = nx; o.y = ny; return null; }
    o.x = h.x; o.y = h.y;
    const vn = o.vx * h.nx + o.vy * h.ny;
    if (vn < 0) {
      const tx = o.vx - vn * h.nx, ty = o.vy - vn * h.ny;
      o.vx = tx * (1 - rub) - vn * bounce * h.nx; o.vy = ty * (1 - rub) - vn * bounce * h.ny;
    }
    return [h.nx, h.ny];
  }

  /** Whether (x, y) is open sky with room below it: no ground over it, and none within `clear` under it. */
  static openSky(world, x, y, clear) {
    if (world.down(x, y - 1200, y)) return false;
    return !world.down(x, y, y + clear);
  }

  /**
   * Where a new one goes: just out of sight round the view (centre cx, cy; half sizes hw, hh) on
   * the side you're heading for (any side when you're slow), at [x, y].
   */
  spawnPoint(view, heading) {
    const R = this.random, [vx, vy] = heading, sp = Math.hypot(vx, vy);
    const out = 60 + 260 * R();
    if (sp > 2 && Math.abs(vy) > Math.abs(vx) * 1.5) {
      // going up or down: above or below the view
      const s = Math.sign(vy);
      return [view.cx + (R() - 0.5) * 2 * view.hw * 1.3, view.cy + s * (view.hh + out)];
    }
    const s = sp > 2 ? Math.sign(vx) : R() < 0.5 ? -1 : 1;
    return [view.cx + s * (view.hw + out), view.cy + (R() - 0.5) * 2 * view.hh * 1.3];
  }

  /** A new bird (and a few more in a flock with it) in open sky out of sight. */
  spawnBird(view, world, heading, sky = () => true) {
    const R = this.random;
    for (let tries = 0; tries < 6; tries++) {
      const [x, y] = this.spawnPoint(view, heading);
      if (!Critters.openSky(world, x, y, CRITTERS.clear) || !sky(x, y)) continue;
      // (and not too high: ground within 150 m below)
      if (!world.down(x, y, y + CRITTERS.highest)) continue;
      const dir = R() < 0.5 ? -1 : 1;
      const n = 1 + Math.min(this.wantBirds - this.birds.length - 1, Math.floor(R() * 4));
      for (let i = 0; i < n; i++) {
        const bx = x - dir * i * (20 + 30 * R()), by = y + (R() - 0.5) * 50;
        if (i && (!Critters.openSky(world, bx, by, CRITTERS.clear) || !sky(bx, by))) continue;
        const cruise = 1.6 + 1.2 * R();
        this.birds.push({ x: bx, y: by, px: bx, py: by, vx: dir * cruise, vy: 0, dir, cruise, flap: R() * 6, hit: false, spin: 0, rot: 0, rest: 0, life: 0 });
      }
      return true;
    }
    return false;
  }

  /** A new tumbleweed out of sight, on the first ground down from above the view. */
  spawnWeed(view, world, heading, sky = () => true) {
    for (let tries = 0; tries < 6; tries++) {
      const [x] = this.spawnPoint(view, [heading[0], 0]);
      const h = world.down(x, view.cy - view.hh - 1200, view.cy + view.hh + 1200);
      if (!h || h.ny > -0.5) continue;   // (only on ground facing up)
      const y = h.y - 1;
      if (!sky(h.x, y - CRITTERS.weedRadius)) continue;   // (out in the open, under the sky)
      if (Math.abs(y - view.cy) < view.hh + 30 && Math.abs(x - view.cx) < view.hw + 30) continue;   // (never in sight)
      this.weeds.push({ x: h.x, y, px: h.x, py: y, vx: 0, vy: 0, rot: this.random() * 6, spin: 0, life: 0, cool: 0, still: 0, sleep: false, ground: true });
      return true;
    }
    return false;
  }

  /** Knock bird b away with velocity (vx, vy): it tumbles, with a puff of feathers. */
  knock(b, vx, vy) {
    const R = this.random;
    b.hit = true; b.rest = 0;
    // how it'll lie once it's down (the renderer's poses): from where it was hit, not the random
    // numbers, so nothing else the critters do changes
    b.pose = Math.floor(Math.abs(Math.sin(b.x * 12.9898 + b.y * 78.233) * 43758.5453)) % 1024;
    b.vx = vx; b.vy = vy;
    b.spin = (R() - 0.5) * 0.6;
    for (let i = 0; i < 10; i++) {
      const a = R() * Math.PI * 2, s = 0.5 + R() * 2.5;
      this.feathers.push({ x: b.x, y: b.y, px: b.x, py: b.y, vx: vx * 0.3 + Math.cos(a) * s, vy: vy * 0.3 + Math.sin(a) * s, rot: R() * 6, spin: (R() - 0.5) * 0.3, life: 90 + R() * 80 });
    }
  }

  /**
   * An explosion at (x, y): birds within `radius` are knocked out, tumbleweeds thrown. `yours`: one
   * of your missiles (counted in `shot` and `exploded`). Returns how many birds it knocked out.
   */
  blast(x, y, radius, power, yours = false) {
    let got = 0;
    let heard = false;   // (one bird hit sound for the blast, however many birds it gets)
    for (const b of this.birds) {
      const dx = b.x - x, dy = b.y - y, d = Math.hypot(dx, dy) || 1;
      if (d > radius) continue;
      const k = power * (1 - d / radius) + 1;
      if (!b.hit) {
        this.knock(b, dx / d * k, dy / d * k - 1);
        got++;
        if (!heard) this.events.push({ kind: 'bird', x: b.x, y: b.y, speed: k, blast: true });
        heard = true;
      }
      else if (!b.rest) { b.vx += dx / d * k; b.vy += dy / d * k; }
    }
    for (const w of this.weeds) {
      const dx = w.x - x, dy = w.y - y, d = Math.hypot(dx, dy) || 1;
      if (d > radius) continue;
      const k = power * CRITTERS.weedBlast * (1 - d / radius) + 2;
      w.sleep = false; w.still = 0;
      if (yours) this.exploded++;
      w.vx += dx / d * k; w.vy += dy / d * k - k * 0.6;
      w.spin = (w.spin || 0) + (this.random() - 0.5) * 0.02 * k + Math.sign(dx) * 0.01 * k;
    }
    if (yours) this.shot += got;
    return got;
  }

  /** A tumbleweed within `r` of (x, y), if any (what a missile blows up on; they never home in on one). */
  weedAt(x, y, r) { return this.weeds.find((w) => Math.hypot(w.x - x, w.y - y) < CRITTERS.weedRadius + r); }

  /** The birds still flying (what missiles home in on). */
  get flying() { return this.birds.filter((b) => !b.hit); }

  /**
   * One step. `truck`: the Truck (read only, never changed), or null (wrecked: then `wreck`'s
   * loose pieces, its body and wheels, hit things instead; also read only).
   * `view`: { cx, cy, hw, hh } in world px. `world`: the collision world for tumbleweeds (pushed
   * out by their size); `thin`: the one for birds (pushed out a little). `bottom`: below that,
   * something's fallen out of the level and goes. `sky(x, y)`: whether there's open sky straight
   * up from there (nothing comes in where there isn't: in a pipe, under the ground). `events`
   * isn't emptied here (a missile's blast before the step adds to it): the game empties it.
   */
  step(truck, view, world, thin, gravity = CRITTERS.gravity, bottom = Infinity, sky = () => true, wreck = null) {
    const C = CRITTERS, R = this.random;
    // (where each was, for drawing between steps)
    for (const A of [this.birds, this.weeds, this.feathers]) for (const o of A) { o.px = o.x; o.py = o.y; }
    const gone = (o) => o.y > bottom || Math.abs(o.x - view.cx) > view.hw + C.gone || Math.abs(o.y - view.cy) > view.hh + C.gone;
    this.birds = this.birds.filter((b) => !gone(b) && !(b.hit && b.rest > 400));
    this.weeds = this.weeds.filter((w) => !gone(w));
    // new ones out of sight, the way you're heading
    const heading = truck ? [truck.T[0] - truck.P[0], truck.T[1] - truck.P[1]] : wreck ? [wreck.T[0] - wreck.P[0], wreck.T[1] - wreck.P[1]] : [0, 0];
    if (this.birds.length < this.wantBirds && R() < 0.25) this.spawnBird(view, thin, heading, sky);
    if (this.weeds.length < this.wantWeeds && R() < 0.15) this.spawnWeed(view, world, heading, sky);
    // what hits: circles round the truck's chassis centre and its wheels (and how fast each moves)
    const T = truck?.T, P = truck?.P;
    const hitters = truck ? [0, 1, 2].map((p) => [T[p * 2], T[p * 2 + 1], T[p * 2] - P[p * 2], T[p * 2 + 1] - P[p * 2 + 1], p ? truck.wheelRadius + 6 : C.truckRadius]) : [];
    if (!truck && wreck) {
      // a wreck: its loose wheels, and its body (a circle round its middle)
      const WT = wreck.T, WP = wreck.P;
      for (const w of wreck.wheels) hitters.push([WT[w.p * 2], WT[w.p * 2 + 1], WT[w.p * 2] - WP[w.p * 2], WT[w.p * 2 + 1] - WP[w.p * 2 + 1], WRECK.wheelRadius + 6]);
      let vx = 0, vy = 0;
      for (const i of wreck.body) { vx += WT[i * 2] - WP[i * 2]; vy += WT[i * 2 + 1] - WP[i * 2 + 1]; }
      const [cx, cy] = wreck.centre;
      hitters.push([cx, cy, vx / wreck.body.length, vy / wreck.body.length, C.truckRadius * 0.8]);
    }
    const inView = (o) => Math.abs(o.x - view.cx) < view.hw + 60 && Math.abs(o.y - view.cy) < view.hh + 60;
    const hitBy = (o, r) => hitters.find(([x, y, , , hr]) => (o.x - x) ** 2 + (o.y - y) ** 2 < (r + hr) ** 2);

    for (const b of this.birds) {
      b.life++;
      if (!b.hit) {
        b.flap += 0.35;
        // a gentle drift up and down
        b.vy += Math.sin(b.life * 0.03 + b.flap * 0.1) * 0.02 - b.vy * 0.05;
        // ground in the way ahead, or too near below: climb; a wall right ahead: turn back
        const ahead = thin.collide(b.x, b.y, b.x + b.vx * C.look, b.y + b.vy * C.look + C.clear * 0.5);
        const under = thin.down(b.x + b.vx * 8, b.y, b.y + C.clear);
        if (ahead || under) b.vy = Math.max(-2.5, b.vy - 0.18);
        // a wall ahead: turn round, smoothly (slowing, then speeding up the other way, rising a
        // little as it goes round); `dir` is the way it's turning to
        const cruise = b.cruise || 2, going = Math.sign(b.vx) || b.dir;
        if (going === b.dir) {
          const wall = thin.collide(b.x, b.y, b.x + b.dir * C.wallLook, b.y);
          if (wall && Math.abs(wall.nx) > 0.6) b.dir = -b.dir;
        }
        const want = b.dir * cruise;
        if (Math.abs(want - b.vx) > 1e-6) {
          b.vx += Math.max(-C.turn, Math.min(C.turn, want - b.vx));
          if (Math.sign(b.vx) !== b.dir) b.vy -= 0.04;
        }
        // flown into something anyway: it stops dead that way and turns from there
        if (Critters.move(b, thin, 0, 0)) { b.dir = -going; b.vy = Math.min(b.vy, -0.8); }
        const h = hitBy(b, C.birdRadius);
        if (h) {
          // knocked away with (most of) the truck's speed, and a bit outward from it
          const [hx, hy, vx, vy] = h, dx = b.x - hx, dy = b.y - hy, d = Math.hypot(dx, dy) || 1, sp = Math.hypot(vx, vy);
          this.knock(b, vx * 0.9 + dx / d * (2 + sp * 0.3), vy * 0.9 + dy / d * (2 + sp * 0.3) - 2);
          this.events.push({ kind: 'bird', x: b.x, y: b.y, speed: sp });
          this.whacked++;
        }
      } else if (b.rest === 0) {
        // tumbling down until it lands (bouncing off walls)
        b.vy += gravity; b.vx *= 0.995;
        const n = Critters.move(b, thin, 0.3, 0.3);
        b.rot += b.spin;
        if (n && n[1] < -0.5 && Math.abs(b.vy) < 1.2) { b.rest = 1; b.vx = b.vy = 0; b.lie = Math.atan2(n[1], n[0]) + Math.PI / 2; }
      } else b.rest++;
    }

    for (const w of this.weeds) {
      w.life++;
      if (w.cool) w.cool--;
      if (w.sleep) {
        // at rest: it stays put (no jiggling in a pile) until the truck, a blast or another one moves it
        // (a truck sitting still against it doesn't: only one moving)
        const h = hitBy(w, C.weedRadius);
        if (h && Math.hypot(h[2], h[3]) > 0.3) { w.sleep = false; w.still = 0; } else continue;
      }
      // light and airy: a weak pull down, and the air slows it (so it floats down, and drifts far)
      w.vy += gravity * C.weedGravity;
      if (!w.ground) { w.vx *= 1 - C.weedAir; w.vy *= 1 - C.weedAir; } else w.vx *= 0.999;
      const fall = w.vy;
      const n = Critters.move(w, world, w.vy > 3 ? C.weedBounce : 0, 0.004);
      w.ground = !!n;
      if (n && fall > 2.5 && inView(w)) this.events.push({ kind: 'weedBounce', x: w.x, y: w.y, speed: fall });
      // on the ground it rolls (turning as far as it goes along); in the air its spin soon dies away
      if (n) w.spin = w.vx / C.weedRadius; else w.spin = (w.spin || 0) * (1 - C.weedSpinAir);
      w.rot += w.spin;
      if (n && Math.hypot(w.vx, w.vy) < 0.02) { w.vx = 0; w.vy = 0; }
      const h = hitBy(w, C.weedRadius);
      if (h) {
        // pushed out of the truck's way and given the speed it meets the truck with, bouncing off
        // with only a little of it (a soft, light thing): along, not thrown into the air
        const [hx, hy, vx, vy, hr] = h, dx = w.x - hx, dy = w.y - hy, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
        const vn = (w.vx - vx) * nx + (w.vy - vy) * ny;
        if (vn < 0) {
          w.vx -= (1 + C.weedKick) * vn * nx; w.vy -= (1 + C.weedKick) * vn * ny;
          w.vy = Math.max(w.vy, Math.min(vy, 0) - 5);
          // the truck coming down on it: squeezed out from under, sideways and up
          if (vy > 1.5 && hy < w.y + C.weedRadius) {
            const pop = vy * C.weedLand, side = Math.sign(dx) || (R() < 0.5 ? -1 : 1);
            w.vx += side * pop * 0.8 + vx * 0.5; w.vy = Math.min(w.vy, -pop * 0.9);
            w.spin = side * pop * 0.02;
          }
          if (!w.cool && inView(w)) this.events.push({ kind: 'weed', x: w.x, y: w.y, speed: -vn });
          if (!w.cool) this.tumbled++;
          w.cool = 12;
        }
        const ox = w.vx, oy = w.vy, out = C.weedRadius + hr - d;
        w.vx = nx * out; w.vy = ny * out;
        Critters.move(w, world, 0, 0);
        w.vx = ox; w.vy = oy;
      }
    }

    // tumbleweeds knock into each other: pushed apart, trading the speed they meet with
    // (one at rest is as if fixed, unless the other hits it hard enough to move it; both at rest: nothing to do)
    const W = this.weeds, D = C.weedRadius * 2 * 0.9;
    for (let i = 0; i < W.length; i++) for (let j = i + 1; j < W.length; j++) {
      const a = W[i], b = W[j];
      if (a.sleep && b.sleep) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
      if (d2 >= D * D || d2 === 0) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
      let vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      // (one at rest wakes when the other hits it, or moves off: what it's resting on may be going)
      for (const [o, q] of [[a, b], [b, a]]) if (o.sleep && (vn < -0.6 || Math.hypot(q.vx, q.vy) > 0.3)) { o.sleep = false; o.still = 0; }
      const ma = a.sleep ? 0 : 1, mb = b.sleep ? 0 : 1, share = (D - d) / (ma + mb);
      // (pushed apart only where the ground lets them go)
      for (const [o, s, m] of [[a, -1, ma], [b, 1, mb]]) {
        if (!m) continue;
        const ox = o.vx, oy = o.vy;
        o.vx = s * nx * share; o.vy = s * ny * share;
        Critters.move(o, world, 0, 0);
        o.vx = ox; o.vy = oy;
      }
      if (vn < 0) {
        if (vn < -1.5 && inView(a)) this.events.push({ kind: 'weedBounce', x: a.x, y: a.y, speed: -vn });
        const k = -vn * (1 + (vn < -1 ? C.weedBounce : 0)) / (ma + mb);
        a.vx -= ma * k * nx; a.vy -= ma * k * ny; b.vx += mb * k * nx; b.vy += mb * k * ny;
      }
      // rubbing: the speed they slide past each other with dies away (so a pile settles)
      const tx = -ny, ty = nx, vt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty, f = vt * C.weedRub / (ma + mb);
      a.vx += ma * f * tx; a.vy += ma * f * ty; b.vx -= mb * f * tx; b.vy -= mb * f * ty;
    }
    // hardly moving for a while: at rest
    for (const w of W) {
      if (w.sleep) continue;
      if (Math.hypot(w.x - w.px, w.y - w.py) < C.weedStill) { if ((w.still = (w.still || 0) + 1) >= C.weedSettle) { w.sleep = true; w.vx = w.vy = 0; } } else w.still = 0;
    }

    for (const f of this.feathers) {
      f.vy += gravity * 0.15; f.vx *= 0.96; f.vy *= 0.96;
      f.x += f.vx + Math.sin(f.life * 0.15) * 0.4; f.y += f.vy; f.rot += f.spin; f.life--;
    }
    this.feathers = this.feathers.filter((f) => f.life > 0);
  }
}
