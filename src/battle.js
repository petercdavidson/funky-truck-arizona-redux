// battle.js — Battle Mode. No DOM access (runs under Node for tests).
//
// Battle is played on Endless's generated course, with damage. Enemy trucks come at you from the
// right, in waves: get past them, or knock them out. You have missiles, a jump, a boost and the
// pickups along the course (more missiles, jumps, boost, repairs and a shield).
//
// Each enemy is a whole Truck, driven by the same physics as yours. Your truck faces right, so an
// enemy is simulated in a mirror image of the world (x -> -x, see MirrorWorld): there it faces
// right too, and the physics does exactly what it does for yours. Its points are mirrored back
// wherever it meets the real world: hitting you, missiles, explosions, and drawing (the renderer
// flips it). In this file `s` is a body's mirror sign: 1 for yours, -1 for an enemy's, so a point's
// x in the world is s * T[i].
//
// Trucks hit each other as circles, one on each wheel and two along the body. Overlapping circles
// are pushed apart (the lighter truck moves more), and trucks closing on each other bounce, as a
// whole: the closing speed decides the damage. Explosions push every point near them outwards
// (and a little up), so they turn trucks over and scatter wrecks.

import { Truck } from './game.js';
import { Wreck } from './wreck.js';

const TILE = 64;
const PI = Math.PI;

/** Battle's tuning. Speeds are px per step, times in steps (70 a second), damage out of 1000. */
export const BATTLE = {
  scrape: 2.5,                         // damage a step while your cab scrapes (Standard: 6)
  start: { missiles: 3, jumps: 2, boost: 60 },
  boost: { use: 0.7, regen: 0.02, push: 0.14 },  // meter a step used / regained; push a step
  jump: 6.5,                           // upward speed added
  jumpCooldown: 25, fireCooldown: 16,
  missile: { speed: 10, life: 150, turn: 0.05, cone: 1.1, range: 800, hurt: 1050 },
  enemyMissile: { speed: 5, life: 260, turn: 0.012, hurt: 220, every: [200, 320], range: [180, 900] },
  blast: { radius: 95, power: 6.5 },     // a missile's explosion
  bigBlast: { radius: 120, power: 5.5, hurt: 450 }, // an enemy truck blowing up
  ram: { from: 2.5, per: 32, bounce: 0.35, theyTake: 1.5, boost: 3, shield: 2, stomp: 2.5 },
  enemyScrape: 3,                      // an enemy's damage a step while its cab scrapes
  shield: 560,                         // steps a shield lasts (8 s)
  repair: 350,
  pickupEvery: [650, 1150],            // px between pickups along the course
  points: { takedown: 500, pass: 100, wave: 400 },
  comboFor: 210,                       // steps between takedowns for a combo
  stuckFor: 240,                       // steps without progress before an enemy backs up
};

/**
 * The kinds of enemy: drive power (1 = yours), mass (yours is 1), health, the speed it keeps to,
 * and the wave it first comes in. A gunner fires slow missiles at you.
 */
export const ENEMY_KINDS = {
  basher: { power: 1, mass: 1, health: 1000, top: 6.5, from: 1 },
  speeder: { power: 1.3, mass: 0.8, health: 600, top: 9, from: 2 },
  heavy: { power: 1.15, mass: 2.2, health: 1800, top: 5, from: 3 },
  gunner: { power: 0.95, mass: 1, health: 900, top: 5.5, from: 4, gun: true },
};

export const PICKUPS = ['missile', 'boost', 'jump', 'repair', 'shield'];
const PICKUP_WEIGHT = { missile: 3, boost: 3, jump: 2, repair: 2, shield: 1 };

/** A collision world seen in a mirror (x -> -x): what an enemy truck drives on. */
export class MirrorWorld {
  /** @param get  returns the CollisionWorld to mirror (it changes as Endless scrolls) */
  constructor(get) { this.get = get; }
  collide(ax, ay, cx, cy) {
    const h = this.get().collide(-ax, ay, -cx, cy);
    return h && { x: -h.x, y: h.y, nx: -h.nx, ny: h.ny, type: h.type };
  }
}

/** Waves: how many enemies, and of which kinds (new kinds come in as the waves go on). */
export function waveKinds(n, random = Math.random) {
  const count = Math.min(2 + Math.floor(n / 2), 10);
  const kinds = Object.keys(ENEMY_KINDS).filter((k) => ENEMY_KINDS[k].from <= n);
  const list = [];
  // A kind's first wave has one of it in the middle.
  const fresh = kinds.find((k) => ENEMY_KINDS[k].from === n);
  for (let i = 0; i < count; i++) list.push(kinds[Math.floor(random() * kinds.length)]);
  if (fresh && !list.includes(fresh)) list[Math.floor(count / 2)] = fresh;
  return list;
}
/** How many enemies may be on the course at once in wave n. */
export const maxAlive = (n) => Math.min(2 + Math.floor(n / 3), 5);

/**
 * A look for an enemy: never your body, paint, tyres or wheels (and never a paint like yours:
 * the two greens count as one).
 */
export function enemyLook(you, random = Math.random) {
  const pick = (no) => { const ok = [0, 1, 2, 3, 4, 5].filter((i) => !no.includes(i)); return ok[Math.floor(random() * ok.length)]; };
  const greens = [2, 5];
  const paints = greens.includes(you.paint) ? greens : [you.paint];
  return { body: pick([you.body]), paint: pick(paints), tyre: pick([you.tyre]), hub: pick([you.hub]) };
}

// ---- geometry helpers

/** A truck's facing (unit vector along its body, rear mount to front mount), in its own frame. */
function facing(T) {
  const dx = T[8] - T[6], dy = T[9] - T[7], l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

const BODY_PTS = [0, 3, 4];
/** A truck's collision circles, in the world: the wheels, and two along the body. */
export function circles(T, s) {
  const [ux, uy] = facing(T);
  // the body's middle: halfway between the mounts, 8 up (as Wreck's outline has it)
  const mx = (T[6] + T[8]) / 2 + uy * 8, my = (T[7] + T[9]) / 2 - ux * 8;
  return [
    { x: s * T[2], y: T[3], r: 22, pts: [1] },
    { x: s * T[4], y: T[5], r: 22, pts: [2] },
    { x: s * (mx - ux * 17), y: my - uy * 17, r: 19, pts: BODY_PTS },
    { x: s * (mx + ux * 17), y: my + uy * 17, r: 19, pts: BODY_PTS },
  ];
}

/** The average of a body's points (T, mirror sign s), in the world. */
function middle(T, s) {
  let x = 0, y = 0;
  const n = T.length / 2;
  for (let i = 0; i < T.length; i += 2) { x += T[i]; y += T[i + 1]; }
  return [s * x / n, y / n];
}

/** Push every point of (T, P) within `radius` of (x, y) outwards, and a little up. */
function blastPoints(T, P, s, x, y, radius, power) {
  for (let i = 0; i < T.length; i += 2) {
    const dx = s * T[i] - x, dy = T[i + 1] - y, d = Math.hypot(dx, dy);
    if (d >= radius) continue;
    const f = power * (1 - d / radius);
    let nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : -1;
    ny -= 0.6;
    const l = Math.hypot(nx, ny) || 1;
    P[i] -= s * nx / l * f; P[i + 1] -= ny / l * f;
  }
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Whether what a truck's roof probe touched is under its body (see Game.underside). */
function underside(t) {
  const h = t.probeHit;
  if (!h) return false;
  const r = t.bodyRot * PI / 180;
  return h.nx * Math.sin(r) - h.ny * Math.cos(r) > 0.42;
}

// ---------------------------------------------------------------------------------------------

export class Enemy {
  constructor(id, kind, look, x, y) {
    this.id = id;
    this.kind = kind;
    this.type = ENEMY_KINDS[kind];
    this.look = look;
    this.truck = new Truck();
    this.truck.power = this.type.power;
    this.truck.reset(-x, y);
    this.health = this.type.health;
    this.keys = { up: true, down: false, left: false, right: false };
    this.wreck = null;
    this.wreckAge = 0;
    this.landed = false;
    this.best = this.truck.T[0];   // furthest it has got (mirror x), for noticing it's stuck
    this.since = 0;
    this.backFor = 0;
    this.showHealth = 0;           // steps its health bar stays up after a hit
    this.fireIn = 140;
  }

  /** Where it is in the world: its body's middle (or its wreck's). */
  get centre() {
    if (this.wreck) { const [x, y] = this.wreck.centre; return [-x, y]; }
    const [x, y] = this.truck.centre();
    return [-x, y];
  }
}

export class Battle {
  /** @param game  the Game: its world, truck, keys, camera, score and random */
  constructor(game) {
    this.game = game;
    this.enemies = [];
    this.missiles = [];
    this.pickups = [];
    this.blasts = [];
    this.bits = [];               // particles: dirt, sparks, smoke and fire
    this.events = [];             // what happened this step, for the sound (cleared by Game.step)
    this.requests = new Set();    // 'fire' / 'jump' pressed since the last step
    this.nextId = 1;
    this.missilesLeft = BATTLE.start.missiles;
    this.jumps = BATTLE.start.jumps;
    this.boost = BATTLE.start.boost;
    this.shield = 0;
    this.boosting = false;
    this.fireCooldown = 0; this.jumpCooldown = 0;
    this.wave = 0;
    this.queue = [];              // enemies still to come this wave
    this.spawnIn = 0;
    this.breakIn = 90;            // steps before the next wave
    this.cleared = true;
    this.takedowns = 0; this.passed = 0;
    this.combo = 0; this.lastTakedown = -1e9;
    this.steps = 0;
    this.callout = null;          // { text, timer, gold }: a takedown, a pickup...
    this.hurt = 0;                // steps of the red flash after you're hit
    this.nextPickup = null;       // where along the course the next pickup goes
    this.mirror = new MirrorWorld(() => game.world);
    this.mirrorThin = new MirrorWorld(() => game.thinWorld);
  }

  get random() { return this.game.random(); }
  between([a, b]) { return a + this.random * (b - a); }

  /** Fire a missile, or jump, at the next step. */
  request(what) { this.requests.add(what); }

  say(text, gold = false) { this.callout = { text, timer: 90, gold }; }

  /** Advance one step. */
  step() {
    const g = this.game;
    this.steps++;
    const live = g.screen === 'playing' && g.endTimer === 0;
    const you = live && !g.wreck ? g.truck : null;
    if (you) this.abilities(you); else this.boosting = false;
    this.requests.clear();
    for (const e of this.enemies) this.stepEnemy(e, you);
    this.collideTrucks(you);
    this.stepMissiles(you);
    this.stepPickups(you);
    this.stepEffects();
    if (live) this.updateWaves();
    this.cleanUp();
    if (this.fireCooldown > 0) this.fireCooldown--;
    if (this.jumpCooldown > 0) this.jumpCooldown--;
    if (this.shield > 0) this.shield--;
    if (this.hurt > 0) this.hurt--;
    if (this.callout && --this.callout.timer <= 0) this.callout = null;
  }

  // ---- your truck

  abilities(t) {
    const g = this.game, T = t.T, P = t.P;
    // Boost: a push along the truck, on the ground or in the air, while the meter lasts.
    const was = this.boosting;
    this.boosting = !!g.keys.boost && this.boost > 0;
    if (this.boosting) {
      this.boost = Math.max(0, this.boost - BATTLE.boost.use);
      const [ux, uy] = facing(T), k = BATTLE.boost.push;
      for (let i = 0; i < 10; i += 2) { P[i] -= ux * k; P[i + 1] -= uy * k; }
      if (!was) this.events.push({ type: 'boost' });
      if (this.steps % 2 === 0) this.exhaust(t);
    } else this.boost = Math.min(100, this.boost + BATTLE.boost.regen);
    // Jump: straight up, from the ground (or just after leaving it).
    if (this.requests.has('jump') && this.jumps > 0 && this.jumpCooldown === 0 && (t.rearContact || t.frontContact || g.airSteps < 8)) {
      this.jumps--;
      this.jumpCooldown = BATTLE.jumpCooldown;
      for (let i = 1; i < 10; i += 2) P[i] += BATTLE.jump;
      this.events.push({ type: 'jump' });
      for (const w of [1, 2]) for (let n = 0; n < 4; n++) this.bit('smoke', T[w * 2] + (this.random - 0.5) * 20, T[w * 2 + 1] + 18, (this.random - 0.5) * 2, -this.random, 30);
    }
    if (this.requests.has('fire') && this.missilesLeft > 0 && this.fireCooldown === 0) this.fire(t);
  }

  /** Flames out of the back of the truck while boosting. */
  exhaust(t) {
    const T = t.T, [ux, uy] = facing(T);
    const x = T[6] - ux * 12 - uy * 4, y = T[7] - uy * 12 + ux * 4;
    this.bit('fire', x, y, -ux * 3 + (this.random - 0.5), -uy * 3 + (this.random - 0.5), 14);
  }

  fire(t) {
    const T = t.T, [ux, uy] = facing(T);
    const mx = (T[6] + T[8]) / 2, my = (T[7] + T[9]) / 2;
    const [cx, cy] = t.centre(), [px, py] = t.centre(t.P);
    const ahead = Math.max(0, (cx - px) * ux + (cy - py) * uy);
    this.launch({
      id: this.nextId++, owner: 'you', x: mx + ux * 38 + uy * 4, y: my + uy * 38 - ux * 4,
      ang: Math.atan2(uy, ux), speed: BATTLE.missile.speed + ahead, life: BATTLE.missile.life, age: 0,
    }, mx, my);
    this.missilesLeft--;
    this.fireCooldown = BATTLE.fireCooldown;
    this.events.push({ type: 'missile' });
  }

  /**
   * Send missile m on its way from the truck whose body's middle is at (fromX, fromY). If the
   * truck has its nose (or roof) in the ground, the missile would start inside it, where the
   * collision test can't see the ground; it goes off where it meets the ground instead.
   */
  launch(m, fromX, fromY) {
    this.missiles.push(m);
    const h = this.game.thinWorld.collide(fromX, fromY, m.x, m.y);
    if (h) this.blowMissile(m, h.x, h.y);
  }

  /** Take damage (not after the run is over, and not through the shield). */
  hurtYou(amount) {
    const g = this.game;
    if (amount <= 0 || g.endTimer > 0 || g.wreck || this.shield > 0) return;
    g.damage = Math.min(1000, g.damage + amount);
    if (amount > 15) this.hurt = 14;
  }

  // ---- enemies

  stepEnemy(e, you) {
    if (e.wreck) { e.wreck.step(); e.wreckAge++; return; }
    const t = e.truck, k = e.keys, w = this.mirror;
    if (e.showHealth > 0) e.showHealth--;
    // Drive at you, keeping to its speed, leaning to keep its nose down on climbs (as the test
    // driver does), and backing up for another go when it's stuck.
    const rot = t.bodyRot, air = !t.rearContact && !t.frontContact;
    if (e.backFor > 0) {
      e.backFor--;
      k.up = false; k.down = true; k.left = rot < -25; k.right = rot > 25;
    } else {
      k.down = false;
      k.up = t.speed < e.type.top;
      k.right = air ? rot < -12 : rot < -15;
      k.left = air ? rot > 12 : rot > 35;
      if (t.T[0] > e.best + 1) { e.best = t.T[0]; e.since = 0; } else if (++e.since > BATTLE.stuckFor) { e.backFor = 50 + Math.floor(this.random * 40); e.since = 0; e.best = t.T[0]; }
    }
    t.integrate();
    t.rearContact = false; t.frontContact = false;
    for (let i = 0; i < 2; i++) { t.constrain(); t.collideWheels(w); }
    if (t.rearContact || t.frontContact) e.landed = true;
    t.drive(k);
    t.spinWheels();
    t.tilt(k);
    const type = t.probeBody(w);
    t.updateBodyRot();
    // Its cab scraping hurts it, just as yours does: an enemy knocked over soon wrecks.
    if (type !== null && type !== 1 && !underside(t)) this.hit(e, BATTLE.enemyScrape, false);
    if (e.type.gun && you && e.landed) this.aim(e, you);
  }

  /** A gunner fires slow missiles at you when you're in range ahead of it. */
  aim(e, you) {
    if (--e.fireIn > 0) return;
    const [ex, ey] = e.centre, [yx, yy] = you.centre(), dx = ex - yx;
    const [near, far] = BATTLE.enemyMissile.range;
    if (dx < near || dx > far || Math.abs(ey - yy) > 400) { e.fireIn = 20; return; }
    e.fireIn = Math.round(this.between(BATTLE.enemyMissile.every));
    const T = e.truck.T, [ux, uy] = facing(T);
    // the launcher on its roof (mirror back to the world)
    const x = -((T[6] + T[8]) / 2 + ux * 20 + uy * 30), y = (T[7] + T[9]) / 2 + uy * 20 - ux * 30;
    this.launch({ id: this.nextId++, owner: 'enemy', x, y, ang: Math.atan2(yy - 10 - y, yx - x), speed: BATTLE.enemyMissile.speed, life: BATTLE.enemyMissile.life, age: 0 }, ex, ey);
    this.events.push({ type: 'enemyMissile' });
  }

  /** Damage an enemy; it's wrecked when its health runs out. `show` puts its health bar up. */
  hit(e, amount, show = true) {
    if (e.wreck || amount <= 0) return;
    e.health -= amount;
    if (show) e.showHealth = 140;
    if (e.health <= 0) this.takedown(e);
  }

  /** An enemy is wrecked: it comes apart, blows up, and pays out. */
  takedown(e) {
    const g = this.game;
    e.wreck = new Wreck(e.truck, this.mirror, this.mirrorThin);
    e.health = 0;
    const [x, y] = e.centre;
    this.takedowns++;
    g.stats.takedowns = (g.stats.takedowns || 0) + 1;
    this.combo = this.steps - this.lastTakedown < BATTLE.comboFor ? this.combo + 1 : 1;
    this.lastTakedown = this.steps;
    const points = BATTLE.points.takedown * this.combo;
    if (g.endTimer === 0) g.score += points;
    const name = ['Takedown!', 'Double Takedown!', 'Triple Takedown!'][this.combo - 1] || `Takedown x${this.combo}!`;
    this.say(`${name}  +${points}`, true);
    this.events.push({ type: 'takedown', combo: this.combo });
    const B = BATTLE.bigBlast;
    this.explode(x, y, { radius: B.radius, power: B.power, hurtEnemies: B.hurt, big: true });
    // Sometimes it leaves something behind.
    if (this.random < 0.45) this.placePickup(x, this.pickPickup());
  }

  spawn(kind) {
    const g = this.game, course = g.levelData;
    let x = g.camX + g.viewW * g.zoom + 180;
    for (const e of this.enemies) if (!e.wreck && Math.abs(e.centre[0] - x) < 220) x = e.centre[0] + 220;
    if (x > (course.width - 4) * TILE) return false;
    return !!this.addEnemy(kind, x);
  }

  /**
   * A new enemy of `kind` at x, dropped in clear of the ground under both its wheels (a wheel
   * that started inside a slope would fall through it). Returns it, or null if there's no ground.
   */
  addEnemy(kind, x) {
    const ys = [x - 40, x, x + 40].map((gx) => this.groundAt(gx));
    if (ys.includes(null)) return null;
    const e = new Enemy(this.nextId++, kind, enemyLook(this.game.look, () => this.random), x, Math.min(...ys) - 30);
    this.enemies.push(e);
    return e;
  }

  /** Where a wheel's centre would rest on the ground at x (the top surface), or null. */
  groundAt(x) {
    const g = this.game, H = g.levelData.height * TILE;
    for (let y = -400; y < H; y += 240) {
      const h = g.world.collide(x, y, x, y + 240);
      if (h) return h.y;
    }
    return null;
  }

  updateWaves() {
    const g = this.game;
    if (!g.landed || g.wreck) return;
    const alive = this.enemies.filter((e) => !e.wreck).length;
    if (this.queue.length === 0 && alive === 0) {
      if (!this.cleared) {
        this.cleared = true;
        const bonus = BATTLE.points.wave * this.wave;
        g.score += bonus;
        g.announce(`Wave ${this.wave} cleared!  +${bonus}`);
        this.breakIn = 210;
      }
      if (--this.breakIn <= 0) this.startWave();
      return;
    }
    if (this.queue.length && --this.spawnIn <= 0 && alive < maxAlive(this.wave)) {
      if (this.spawn(this.queue[0])) {
        this.queue.shift();
        this.spawnIn = Math.max(50, Math.round(this.between([110, 220]) - this.wave * 8));
      } else this.spawnIn = 20;
    }
  }

  startWave() {
    this.wave++;
    this.cleared = false;
    this.queue = waveKinds(this.wave, () => this.random);
    this.spawnIn = 30;
    this.game.announce(`Wave ${this.wave}`, { confetti: false, sound: 'wave' });
  }

  // ---- trucks hitting trucks

  collideTrucks(you) {
    const bodies = [];
    if (you) bodies.push({ T: you.T, P: you.P, s: 1, mass: 1, c: circles(you.T, 1), you: true });
    for (const e of this.enemies) if (!e.wreck) bodies.push({ T: e.truck.T, P: e.truck.P, s: -1, mass: e.type.mass, c: circles(e.truck.T, -1), e });
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) this.contact(bodies[i], bodies[j]);
  }

  contact(A, B) {
    if (Math.abs(A.c[2].x - B.c[2].x) > 200 || Math.abs(A.c[2].y - B.c[2].y) > 200) return;
    const shareA = B.mass / (A.mass + B.mass), shareB = A.mass / (A.mass + B.mass);
    const move = (body, pts, dx, dy) => { for (const p of pts) { body.T[p * 2] += body.s * dx; body.T[p * 2 + 1] += dy; body.P[p * 2] += body.s * dx; body.P[p * 2 + 1] += dy; } };
    let best = null;
    for (const a of A.c) for (const b of B.c) {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), o = a.r + b.r - d;
      if (o <= 0) continue;
      const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
      move(A, a.pts, -nx * o * shareA, -ny * o * shareA);
      move(B, b.pts, nx * o * shareB, ny * o * shareB);
      if (!best || o > best.o) best = { o, nx, ny, x: a.x + nx * a.r, y: a.y + ny * a.r };
    }
    if (!best) return;
    const [ax, ay] = middle(A.T, A.s), [apx, apy] = middle(A.P, A.s);
    const [bx, by] = middle(B.T, B.s), [bpx, bpy] = middle(B.P, B.s);
    const vrel = (bx - bpx - (ax - apx)) * best.nx + (by - bpy - (ay - apy)) * best.ny;
    if (vrel >= 0) return; // already moving apart
    const shield = (A.you || B.you) && this.shield > 0;
    const j = -(1 + BATTLE.ram.bounce * (shield ? 2.5 : 1)) * vrel;
    const kick = (body, vx, vy) => { for (let i = 0; i < 10; i += 2) { body.P[i] -= body.s * vx; body.P[i + 1] -= vy; } };
    kick(A, -best.nx * j * shareA, -best.ny * j * shareA);
    kick(B, best.nx * j * shareB, best.ny * j * shareB);
    const impact = -vrel;
    if (impact > 1.2) {
      for (let n = 0; n < Math.min(12, Math.round(impact * 1.5)); n++) {
        const a = this.random * 2 * PI, sp = 1 + this.random * impact * 0.5;
        this.bit('spark', best.x, best.y, Math.cos(a) * sp, Math.sin(a) * sp - 1, 12 + this.random * 10);
      }
    }
    if (impact > 2.5) this.events.push({ type: 'crunch', force: Math.min(1, impact / 12) });
    if (A.you) this.ram(B, impact, best.nx, best.ny);
    else if (B.you) this.ram(A, impact, -best.nx, -best.ny);
  }

  /** You hit enemy body E at `impact` px per step; (nx, ny) points from you to it. */
  ram(E, impact, nx, ny) {
    const R = BATTLE.ram;
    if (impact <= R.from) return;
    const base = (impact - R.from) * R.per, heft = Math.sqrt(E.mass);
    let you = base * heft, them = base / heft * R.theyTake;
    const stomp = ny > 0.55; // you came down on top of it
    if (this.boosting) { them *= R.boost; you *= 0.25; }
    if (stomp) { them *= R.stomp; you *= 0.3; }
    this.hurtYou(you);
    if (this.shield > 0) them *= R.shield;
    const e = E.e;
    if (stomp && them > 150 && them < e.health) this.say('Stomp!');
    this.hit(e, them);
  }

  // ---- missiles and explosions

  stepMissiles(you) {
    const g = this.game;
    for (const m of this.missiles) {
      if (m.dead) continue;
      m.age++;
      // Steering: yours home in on the nearest enemy ahead of them; theirs drift towards you.
      let target = null;
      if (m.owner === 'you') {
        let bestD = BATTLE.missile.range;
        for (const e of this.enemies) {
          if (e.wreck) continue;
          const [ex, ey] = e.centre, d = Math.hypot(ex - m.x, ey - m.y);
          if (d < bestD && Math.abs(wrapAngle(Math.atan2(ey - m.y, ex - m.x) - m.ang)) < BATTLE.missile.cone) { bestD = d; target = [ex, ey]; }
        }
      } else if (you) target = you.centre();
      if (target) {
        const turn = m.owner === 'you' ? BATTLE.missile.turn : BATTLE.enemyMissile.turn;
        const diff = wrapAngle(Math.atan2(target[1] - m.y, target[0] - m.x) - m.ang);
        m.ang += Math.max(-turn, Math.min(turn, diff));
      }
      const nx = m.x + Math.cos(m.ang) * m.speed, ny = m.y + Math.sin(m.ang) * m.speed;
      const h = g.thinWorld.collide(m.x, m.y, nx, ny);
      if (h) { this.blowMissile(m, h.x, h.y); continue; }
      m.x = nx; m.y = ny;
      if (m.age % 2 === 0) this.bit('smoke', m.x - Math.cos(m.ang) * 12, m.y - Math.sin(m.ang) * 12, 0, -0.2, 34);
      // Hitting a truck.
      const hits = (T, s) => circles(T, s).some((c) => Math.hypot(c.x - m.x, c.y - m.y) < c.r + 5);
      if (m.owner === 'you' && this.enemies.some((e) => !e.wreck && hits(e.truck.T, -1))) { this.blowMissile(m, m.x, m.y); continue; }
      if (m.owner === 'enemy' && you && hits(you.T, 1)) { this.blowMissile(m, m.x, m.y); continue; }
      if (--m.life <= 0) { this.blowMissile(m, m.x, m.y, 0.6); continue; }
    }
    // Missiles that meet blow each other up.
    for (const a of this.missiles) {
      if (a.dead || a.owner !== 'you') continue;
      for (const b of this.missiles) {
        if (b.dead || b.owner !== 'enemy' || Math.hypot(a.x - b.x, a.y - b.y) > 16) continue;
        this.blowMissile(a, a.x, a.y, 0.8); b.dead = true;
        this.say('Intercepted!');
        break;
      }
    }
  }

  blowMissile(m, x, y, scale = 1) {
    m.dead = true;
    const B = BATTLE.blast;
    if (m.owner === 'you') this.explode(x, y, { radius: B.radius * scale, power: B.power * scale, hurtEnemies: BATTLE.missile.hurt * scale, yours: true });
    else this.explode(x, y, { radius: B.radius * 0.9 * scale, power: B.power * 0.8 * scale, hurtYou: BATTLE.enemyMissile.hurt * scale, hurtEnemies: 300 * scale });
  }

  /**
   * An explosion: it pushes everything near it (your own blast only pushes you a little, and
   * never hurts you: rocket jumps are allowed), and damages what's close.
   */
  explode(x, y, { radius, power, hurtEnemies = 0, hurtYou = 0, yours = false, big = false }) {
    const g = this.game;
    this.blasts.push({ x, y, r: radius, age: 0, life: big ? 42 : 30, big });
    this.events.push({ type: 'boom', big });
    for (let n = 0; n < (big ? 16 : 10); n++) {
      const a = -PI / 2 + (this.random - 0.5) * 2.6, sp = 2 + this.random * (big ? 6 : 4.5);
      this.bit('dirt', x, y, Math.cos(a) * sp, Math.sin(a) * sp, 40 + this.random * 25);
    }
    for (let n = 0; n < (big ? 10 : 6); n++) this.bit('smoke', x + (this.random - 0.5) * radius * 0.5, y + (this.random - 0.5) * radius * 0.4, (this.random - 0.5) * 1.5, -0.4 - this.random * 0.6, 60 + this.random * 30);
    const you = g.wreck ? null : g.truck;
    if (you) blastPoints(you.T, you.P, 1, x, y, radius, power * (yours ? 0.6 : 1));
    if (g.wreck) blastPoints(g.wreck.T, g.wreck.P, 1, x, y, radius, power);
    for (const e of this.enemies) {
      if (e.wreck) blastPoints(e.wreck.T, e.wreck.P, -1, x, y, radius, power * 1.4);
      else blastPoints(e.truck.T, e.truck.P, -1, x, y, radius, power);
    }
    // Damage: full in the middle, none at three quarters of the way out.
    const near = (T, s) => Math.max(0, Math.min(...circles(T, s).map((c) => Math.hypot(c.x - x, c.y - y) - c.r)));
    const share = (d) => Math.max(0, 1 - d / (radius * 0.75));
    if (hurtYou && you) this.hurtYou(hurtYou * share(near(you.T, 1)));
    if (hurtEnemies) for (const e of this.enemies) if (!e.wreck) this.hit(e, hurtEnemies * share(near(e.truck.T, -1)));
  }

  // ---- pickups

  pickPickup() {
    const g = this.game, w = { ...PICKUP_WEIGHT };
    if (g.damage > 500) w.repair *= 2.5;
    if (this.missilesLeft === 0) w.missile *= 2;
    const total = PICKUPS.reduce((a, k) => a + w[k], 0);
    let r = this.random * total;
    for (const k of PICKUPS) { r -= w[k]; if (r <= 0) return k; }
    return 'missile';
  }

  /** Put a pickup on the ground at x (floating just above it), or none if there's no ground. */
  placePickup(x, kind) {
    const y = this.groundAt(x);
    if (y === null) return;
    this.pickups.push({ id: this.nextId++, x, y: y - 12, kind, age: Math.floor(this.random * 100), taken: 0 });
  }

  stepPickups(you) {
    const g = this.game;
    const ahead = g.camX + g.viewW * g.zoom + 300, end = (g.levelData.width - 2) * TILE;
    if (this.nextPickup === null) this.nextPickup = g.truck.T[0] + 500;
    while (this.nextPickup < ahead && this.nextPickup < end) {
      this.placePickup(this.nextPickup, this.pickPickup());
      this.nextPickup += this.between(BATTLE.pickupEvery);
    }
    for (const p of this.pickups) {
      p.age++;
      if (p.taken) { p.taken++; continue; }
      if (!you) continue;
      const by = p.y + Math.sin(p.age * 0.08) * 4;
      if (circles(you.T, 1).some((c) => Math.hypot(c.x - p.x, c.y - by) < c.r + 16)) this.collect(p);
    }
  }

  collect(p) {
    const g = this.game;
    p.taken = 1;
    if (p.kind === 'missile') { this.missilesLeft += 3; this.say('+3 Missiles'); }
    else if (p.kind === 'jump') { this.jumps += 2; this.say('+2 Jumps'); }
    else if (p.kind === 'boost') { this.boost = Math.min(100, this.boost + 50); this.say('Boost!'); }
    else if (p.kind === 'repair') { g.damage = Math.max(0, g.damage - BATTLE.repair); this.say('Repaired!'); }
    else if (p.kind === 'shield') { this.shield = BATTLE.shield; this.say('Shield!'); }
    this.events.push({ type: 'pickup', kind: p.kind });
  }

  // ---- particles

  bit(kind, x, y, vx, vy, life) {
    if (this.bits.length >= 500) this.bits.shift();
    this.bits.push({ kind, x, y, vx, vy, life, max: life, frame: Math.floor(this.random * 8), size: 0.5 + this.random * 0.6 });
  }

  stepEffects() {
    for (const b of this.blasts) b.age++;
    this.blasts = this.blasts.filter((b) => b.age < b.life);
    for (const b of this.bits) {
      b.life--;
      b.x += b.vx; b.y += b.vy;
      if (b.kind === 'dirt' || b.kind === 'spark') b.vy += 0.15;
      else { b.vx *= 0.96; b.vy *= 0.96; } // smoke and fire drift and slow
    }
    this.bits = this.bits.filter((b) => b.life > 0);
  }

  // ---- tidying up

  cleanUp() {
    const g = this.game, left = g.camX - 350, bottom = g.levelData.height * TILE + 400;
    this.enemies = this.enemies.filter((e) => {
      const [x, y] = e.centre;
      if (e.wreck) return e.wreckAge < 900 && x > left - 300;
      if (y > bottom) return false;
      if (x < left) {
        // It got past you (or you got past it).
        this.passed++;
        if (g.endTimer === 0 && g.screen === 'playing') { g.score += BATTLE.points.pass; this.say(`Passed!  +${BATTLE.points.pass}`); }
        return false;
      }
      return true;
    });
    this.missiles = this.missiles.filter((m) => !m.dead);
    this.pickups = this.pickups.filter((p) => p.taken < 16 && p.x > left - 100);
  }

  /** Move everything left by dx and up by dy (Endless scrolling the world: see Game.shiftWorld). */
  shift(dx, dy) {
    const mirror = (A) => { for (let i = 0; i < A.length; i += 2) { A[i] += dx; A[i + 1] -= dy; } };
    for (const e of this.enemies) {
      mirror(e.truck.T); mirror(e.truck.P);
      if (e.truck.probePrev) mirror(e.truck.probePrev);
      if (e.wreck) { mirror(e.wreck.T); mirror(e.wreck.P); }
      e.best += dx;
    }
    for (const list of [this.missiles, this.pickups, this.blasts, this.bits]) for (const o of list) { o.x -= dx; o.y -= dy; }
    if (this.nextPickup !== null) this.nextPickup -= dx;
  }

  /** What the renderer interpolates between steps: the enemies' points and the missiles. */
  snapshot() {
    return {
      e: this.enemies.map((e) => [e.id, (e.wreck ? e.wreck.T : e.truck.T).slice(), e.truck.rearWheelRot, e.truck.frontWheelRot]),
      m: this.missiles.map((m) => [m.id, m.x, m.y]),
    };
  }
}

/** Between two snapshots: { e: Map(id -> { T, rr, fr }), m: Map(id -> [x, y]) }. */
export function lerpBattle(a, b, t) {
  const L = (x, y) => x + (y - x) * t;
  const before = new Map(a ? a.e.map((r) => [r[0], r]) : []), mb = new Map(a ? a.m.map((r) => [r[0], r]) : []);
  const e = new Map(), m = new Map();
  for (const r of b.e) {
    const p = before.get(r[0]);
    const ok = p && p[1].length === r[1].length;
    e.set(r[0], { T: ok ? r[1].map((x, i) => L(p[1][i], x)) : r[1], rr: ok ? L(p[2], r[2]) : r[2], fr: ok ? L(p[3], r[3]) : r[3] });
  }
  for (const r of b.m) { const p = mb.get(r[0]); m.set(r[0], p ? [L(p[1], r[1]), L(p[2], r[2])] : [r[1], r[2]]); }
  return { e, m };
}
