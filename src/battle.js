// battle.js — the other trucks on the track, and your boost, jump and missiles: Sandbox's rival
// and enemy cars (see sandbox.js, which places them and sets the tuning). No DOM access (runs
// under Node for tests). It was written for Battle Mode (enemy trucks in waves) and Rally Mode
// (racers), which are kept on the feat/battle-rally branch.
//
// Rival cars ('racer') drive your way; enemy cars (bashers, speeders, heavies and gunners) come
// at you from the right. You can get past them, or knock the enemies out with missiles, rams and
// stomps.
//
// Each enemy is a whole Truck, driven by the same physics as yours. Your truck faces right, so an
// enemy is simulated in a mirror image of the world (x -> -x, see MirrorWorld): there it faces
// right too, and the physics does exactly what it does for yours. Its points are mirrored back
// wherever it meets the real world: hitting you, missiles, explosions, and drawing (the renderer
// flips it). In this file `s` is a body's mirror sign: 1 for yours (and a racer's, which drives
// the same way as you), -1 for an enemy's, so a point's x in the world is s * T[i].
//
// Trucks hit each other as circles, one on each wheel and two along the body. Overlapping circles
// are pushed apart (the lighter truck moves more), and trucks closing on each other bounce, as a
// whole: the closing speed decides the damage. Explosions push every point near them outwards
// (and a little up), so they turn trucks over and scatter wrecks.

import { Truck } from './game.js';
import { Wreck } from './wreck.js';

const TILE = 64;
const PI = Math.PI;

/** The tuning. Speeds are px per step, times in steps (70 a second), damage out of 1000. */
export const BATTLE = {
  start: { missiles: 3, jumps: 2, boost: 60 },
  boost: { use: 0.7, regen: 0.02, push: 0.14 },  // meter a step used / regained; push a step
  jump: 6.5,                           // upward speed added
  jumpCooldown: 25, fireCooldown: 16,
  missile: { speed: 10, life: 150, turn: 0.05, cone: 1.1, range: 800, hurt: 1050 },
  enemyMissile: { speed: 5, life: 260, turn: 0.012, hurt: 220, every: [200, 320], range: [180, 900] },
  blast: { radius: 95, power: 6.5 },     // a missile's explosion
  bigBlast: { radius: 120, power: 5.5, hurt: 450 }, // an enemy truck blowing up
  ram: { from: 2.5, per: 32, bounce: 0.35, theyTake: 1.5, boost: 3, stomp: 2.5 },
  enemyScrape: 3,                      // an enemy's damage a step while its cab scrapes
  points: { takedown: 500, pass: 100 },
  comboFor: 210,                       // steps between takedowns for a combo
  stuckFor: 240,                       // steps without progress before an enemy backs up
};

/**
 * The kinds of car: drive power (1 = yours), mass (yours is 1), health and the speed it keeps to.
 * A gunner fires slow missiles at you.
 */
export const ENEMY_KINDS = {
  basher: { power: 1, mass: 1, health: 1000, top: 6.5 },
  speeder: { power: 1.3, mass: 0.8, health: 600, top: 9 },
  heavy: { power: 1.15, mass: 2.2, health: 1800, top: 5 },
  gunner: { power: 0.95, mass: 1, health: 900, top: 5.5, gun: true },
  // Rival cars: trucks like yours, going your way, that can't be wrecked.
  racer: { power: 1, mass: 1, health: Infinity, top: Infinity },
};

/** Rivals that get stuck: steps upside down before they flip back over, and their hop over a wall. */
export const RACER = { flipAfter: 120, righting: 80, hopAfter: 1, hop: 5, hopMore: 1.5, hopBoost: 40, skipAfter: 2, skip: 6 };

/** A collision world seen in a mirror (x -> -x): what an enemy truck drives on. */
export class MirrorWorld {
  /** @param get  returns the CollisionWorld to mirror (it changes as Endless scrolls) */
  constructor(get) { this.get = get; }
  collide(ax, ay, cx, cy) {
    const h = this.get().collide(-ax, ay, -cx, cy);
    return h && { x: -h.x, y: h.y, nx: -h.nx, ny: h.ny, type: h.type };
  }
}

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

/**
 * A truck driven by the game: an enemy coming at you (s = -1, simulated in the mirror world), or
 * a racer going your way (s = 1, in the world as it is). x is where it goes in the world.
 */
export class Enemy {
  constructor(id, kind, look, x, y, s = -1) {
    this.id = id;
    this.kind = kind;
    this.type = ENEMY_KINDS[kind];
    this.racer = kind === 'racer';
    this.s = s;
    this.look = look;
    this.name = '';
    this.tries = 0;                // times it has backed up without getting any further
    this.upsideDown = 0;           // steps on its roof (a racer flips back over)
    this.righting = 0;
    this.hopFor = 0;               // steps of its boosted hop over a wall
    this.truck = new Truck();
    this.truck.power = this.type.power;
    this.truck.reset(s * x, y);
    this.health = this.type.health;
    this.keys = { up: true, down: false, left: false, right: false };
    this.wreck = null;
    this.wreckAge = 0;
    this.landed = false;
    this.best = this.truck.T[0];   // furthest it has got (its own x), for noticing it's stuck
    this.since = 0;
    this.backFor = 0;
    this.showHealth = 0;           // steps its health bar stays up after a hit
    this.fireIn = 140;
  }

  /** Where it is in the world: its body's middle (or its wreck's). */
  get centre() {
    const [x, y] = this.wreck ? this.wreck.centre : this.truck.centre();
    return [this.s * x, y];
  }
}

/** What a run uses: your weapons (boost, jump and missiles), and `tune`, their settings (Sandbox's own). */
const DEFAULT_OPTS = { weapons: true };
export const DEFAULT_TUNE = {
  boostPush: BATTLE.boost.push, jump: BATTLE.jump, fireCooldown: BATTLE.fireCooldown,
  unlimitedBoost: false, unlimited: false, airJumps: false,
};

export class Battle {
  /** @param game  the Game: its world, truck, keys, camera, score and random */
  constructor(game, opts = {}) {
    this.game = game;
    this.opts = { ...DEFAULT_OPTS, ...opts };
    this.tune = { ...DEFAULT_TUNE, ...(opts.tune || {}) };
    this.enemies = [];
    this.racers = [];             // rival cars
    this.missiles = [];
    this.blasts = [];
    this.bits = [];               // particles: dirt, sparks, smoke and fire
    this.events = [];             // what happened this step, for the sound (cleared by Game.step)
    this.requests = new Set();    // 'fire' / 'jump' pressed since the last step
    this.nextId = 1;
    this.missilesLeft = BATTLE.start.missiles;
    this.jumps = BATTLE.start.jumps;
    this.boost = BATTLE.start.boost;
    this.boosting = false;
    this.fireCooldown = 0; this.jumpCooldown = 0;
    this.takedowns = 0; this.passed = 0;
    // (for Sandbox's stats) your missiles fired, and those that got something they aim for (a bird,
    // or a car: not a tumbleweed or the ground); enemy missiles you shot down; stomps; the best combo
    this.fired = 0; this.onTarget = 0; this.intercepts = 0; this.stomps = 0; this.bestCombo = 0;
    this.combo = 0; this.lastTakedown = -1e9;
    this.steps = 0;
    this.callout = null;          // { text, timer, gold }: a takedown, a stomp...
    this.hurt = 0;                // steps of the red flash after you're hit
    this.mirror = new MirrorWorld(() => game.world);
    this.mirrorThin = new MirrorWorld(() => game.thinWorld);
  }

  get random() { return this.game.random(); }
  /** Every truck the game drives: enemies, then racers. */
  get bots() { return this.racers.length ? this.enemies.concat(this.racers) : this.enemies; }
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
    if (you && this.opts.weapons) this.abilities(you); else this.boosting = false;
    this.requests.clear();
    for (const e of this.bots) this.stepEnemy(e, you);
    this.collideTrucks(you);
    this.stepMissiles(you);
    this.stepEffects();
    this.cleanUp();
    if (this.fireCooldown > 0) this.fireCooldown--;
    if (this.jumpCooldown > 0) this.jumpCooldown--;
    if (this.hurt > 0) this.hurt--;
    if (this.callout && --this.callout.timer <= 0) this.callout = null;
  }

  // ---- your truck

  abilities(t) {
    const g = this.game, T = t.T, P = t.P;
    // Boost: a push along the truck, on the ground or in the air, while the meter lasts.
    const was = this.boosting, U = this.tune;
    this.boosting = !!g.keys.boost && (this.boost > 0 || U.unlimitedBoost);
    if (this.boosting) {
      if (!U.unlimitedBoost) this.boost = Math.max(0, this.boost - BATTLE.boost.use);
      const [ux, uy] = facing(T), k = U.boostPush;
      for (let i = 0; i < 10; i += 2) { P[i] -= ux * k; P[i + 1] -= uy * k; }
      if (!was) this.events.push({ type: 'boost' });
      if (this.steps % 2 === 0) this.exhaust(t);
    } else this.boost = Math.min(100, this.boost + BATTLE.boost.regen);
    // Jump: straight up, from the ground (or just after leaving it; anywhere with air jumps).
    if (this.requests.has('jump') && (this.jumps > 0 || U.unlimited) && this.jumpCooldown === 0 && (U.airJumps || t.rearContact || t.frontContact || g.airSteps < 8)) {
      if (!U.unlimited) this.jumps--;
      this.jumpCooldown = U.airJumps ? 12 : BATTLE.jumpCooldown;
      for (let i = 1; i < 10; i += 2) P[i] += U.jump;
      this.events.push({ type: 'jump' });
      for (const w of [1, 2]) for (let n = 0; n < 4; n++) this.bit('smoke', T[w * 2] + (this.random - 0.5) * 20, T[w * 2 + 1] + 18, (this.random - 0.5) * 2, -this.random, 30);
    }
    if (this.requests.has('fire') && (this.missilesLeft > 0 || U.unlimited) && this.fireCooldown === 0) this.fire(t);
  }

  /** Flames out of the back of the truck while boosting. */
  exhaust(t, s = 1) {
    const T = t.T, [ux, uy] = facing(T);
    const x = T[6] - ux * 12 - uy * 4, y = T[7] - uy * 12 + ux * 4;
    // (before 1.24.25 it started a step's travel ahead of the truck as drawn: past about 100 km/h,
    // in front of it)
    const P = t.P;
    this.bit('fire', s * x, y, s * (-ux * 3 + (this.random - 0.5)), -uy * 3 + (this.random - 0.5), 14, [s * (T[6] - P[6]), T[7] - P[7]]);
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
    if (!this.tune.unlimited) this.missilesLeft--;
    this.fireCooldown = this.tune.fireCooldown;
    this.fired++;
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

  /** Take damage (not after the run is over). */
  hurtYou(amount) {
    const g = this.game;
    if (amount <= 0 || g.endTimer > 0 || g.wreck) return;
    g.damage = Math.min(1000, g.damage + amount);
    if (amount > 15) this.hurt = 14;
  }

  // ---- enemies

  stepEnemy(e, you) {
    if (e.wreck) { e.wreck.step(); e.wreckAge++; return; }
    const g = this.game, t = e.truck, k = e.keys, w = e.s === 1 ? g.world : this.mirror;
    if (e.showHealth > 0) e.showHealth--;
    // Drive at you (or along the course), keeping to its speed, leaning to keep its nose down on
    // climbs (as the test driver does), and backing up for another go when it's stuck.
    const rot = t.bodyRot, air = !t.rearContact && !t.frontContact;
    t.gravity = g.truck.gravity; // (Sandbox's gravity is everyone's)
    if (e.righting > 0) {
      k.up = false; k.down = false; k.left = false; k.right = false;
      this.rightBot(e);
    } else if (e.backFor > 0) {
      e.backFor--;
      k.up = false; k.down = true; k.left = rot < -25; k.right = rot > 25;
    } else {
      k.down = false;
      k.up = t.speed < e.type.top;
      k.right = air ? rot < -12 : rot < -15;
      k.left = air ? rot > 12 : rot > 35;
      if (t.T[0] > e.best + 1) {
        e.best = t.T[0]; e.since = 0;
        // (Stuck at a wall, jostling along a little isn't getting past it: that's 3 tiles on.)
        if (e.stuckAt === undefined || t.T[0] > e.stuckAt + 3 * TILE) { e.tries = 0; e.hops = 0; e.stuckAt = undefined; }
      } else if (++e.since > BATTLE.stuckFor) {
        e.stuckAt ??= e.best;
        e.backFor = 50 + Math.floor(this.random * 40); e.since = 0; e.best = t.T[0];
        // A rival that keeps getting stuck at a wall hops it, with a burst of boost, a bit
        // harder each time. Still stuck where you can't see it, it's moved on past.
        if (e.racer && ++e.tries > RACER.hopAfter) {
          e.backFor = 0; e.tries = 0; e.hops = (e.hops || 0) + 1;
          // (After many tries it's moved on even in view, in a puff of smoke.)
          if (e.hops > RACER.skipAfter && (!this.onScreen(e) || e.hops > RACER.skipAfter + 2) && this.skipAhead(e)) e.hops = 0;
          else this.hop(e);
        }
      }
    }
    if (e.racer) {
      // A racer on its roof turns itself back over (as your Flip button does).
      e.upsideDown = Math.abs(rot) > 100 && e.righting === 0 ? e.upsideDown + 1 : 0;
      if (e.upsideDown > RACER.flipAfter) { e.upsideDown = 0; this.startRighting(e); }
      if (e.hopFor > 0) {
        e.hopFor--;
        const [ux, uy] = facing(t.T);
        for (let i = 0; i < 10; i += 2) { t.P[i] -= ux * 0.12; t.P[i + 1] -= uy * 0.12; }
        if (e.hopFor % 2 === 0) this.exhaust(t, e.s);
      }
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
    if (!e.racer && type !== null && type !== 1 && !underside(t)) this.hit(e, BATTLE.enemyScrape, false);
    if (e.type.gun && you && e.landed) this.aim(e, you);
  }

  /** A stuck racer's hop: up, and a burst of boost along the truck. */
  hop(e) {
    const t = e.truck, up = RACER.hop + RACER.hopMore * Math.min(4, (e.hops || 1) - 1);
    for (let i = 1; i < 10; i += 2) t.P[i] += up;
    e.hopFor = RACER.hopBoost;
  }

  /** Whether a truck is in (or near) the view. */
  onScreen(e) {
    const g = this.game, [x, y] = e.centre, m = 150;
    return x > g.camX - m && x < g.camX + g.viewW * g.zoom + m && y > g.camY - m && y < g.camY + g.viewH * g.zoom + m;
  }

  /** Move a hopelessly stuck racer a few tiles on, dropped onto the ground there. */
  skipAhead(e) {
    const x = e.centre[0] + RACER.skip * TILE;
    if (x > (this.game.levelData.width - 10) * TILE) return false;
    const ys = [x - 40, x, x + 40].map((gx) => this.groundAt(gx));
    if (ys.includes(null)) return false;
    const t = e.truck, rr = t.rearWheelRot, fr = t.frontWheelRot;
    for (const [px, py] of [e.centre, [x, Math.min(...ys) - 30]]) for (let n = 0; n < 8; n++) this.bit('smoke', px + (this.random - 0.5) * 60, py + (this.random - 0.5) * 30, (this.random - 0.5) * 2, -this.random, 50);
    t.reset(e.s * x, Math.min(...ys) - 30);
    e.stuckAt = undefined; e.tries = 0;
    t.rearWheelRot = rr; t.frontWheelRot = fr;
    e.best = t.T[0]; e.since = 0;
    return true;
  }

  /** Start turning a racer back onto its wheels: a hop up, then a spin (Game.upright's way). */
  startRighting(e) {
    const t = e.truck;
    for (let i = 0; i < 10; i += 2) { t.P[i] = t.T[i]; t.P[i + 1] = t.T[i + 1] + 4.2; }
    e.righting = RACER.righting;
    e.lastRot = t.bodyRot;
  }

  rightBot(e) {
    const t = e.truck, DEG = PI / 180;
    const wrap = (a) => ((a + 540) % 360) - 180;
    const err = wrap(t.bodyRot), spin = wrap(t.bodyRot - e.lastRot) * DEG;
    e.lastRot = t.bodyRot;
    t.addSpin((Math.max(-0.13, Math.min(0.13, -err * DEG * 0.12)) - spin) * 0.35);
    if (e.righting > RACER.righting - 40) for (let i = 1; i < 10; i += 2) t.P[i] += 0.07;
    e.righting--;
    if (Math.abs(err) < 6 && (t.rearContact || t.frontContact)) e.righting = 0;
  }

  /** A rival car going your way at x, dropped in clear of the ground. */
  addRacer(look, x, name = '') {
    const ys = [x - 40, x, x + 40].map((gx) => this.groundAt(gx));
    if (ys.includes(null)) return null;
    const e = new Enemy(this.nextId++, 'racer', look, x, Math.min(...ys) - 30, 1);
    e.name = name;
    e.truck.gravity = this.game.truck.gravity;
    this.racers.push(e);
    return e;
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
    e.wreck = new Wreck(e.truck, this.mirror, this.mirrorThin, e.look.body);
    e.health = 0;
    const [x, y] = e.centre;
    this.takedowns++;
    this.combo = this.steps - this.lastTakedown < BATTLE.comboFor ? this.combo + 1 : 1;
    this.lastTakedown = this.steps;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const points = BATTLE.points.takedown * this.combo;
    if (g.endTimer === 0) g.score += points;
    const name = ['Takedown!', 'Double Takedown!', 'Triple Takedown!'][this.combo - 1] || `Takedown x${this.combo}!`;
    this.say(`${name}  +${points}`, true);
    this.events.push({ type: 'takedown', combo: this.combo });
    const B = BATTLE.bigBlast;
    this.explode(x, y, { radius: B.radius, power: B.power, hurtEnemies: B.hurt, big: true });
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

  /**
   * Where a wheel's centre would rest on the ground at x (the top surface), or null. (A hit's
   * point is pushed out along the ground's normal, not straight up, so on a slope it isn't the
   * height at x: the probe is shortened until it only just reaches the ground instead.)
   */
  groundAt(x) {
    const w = this.game.world, H = this.game.levelData.height * TILE;
    for (let y = -400; y < H; y += 240) {
      if (!w.collide(x, y, x, y + 240)) continue;
      let lo = 0, hi = 240;
      for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (w.collide(x, y, x, y + mid)) hi = mid; else lo = mid; }
      return y + hi;
    }
    return null;
  }

  // ---- trucks hitting trucks

  collideTrucks(you) {
    const bodies = [];
    const g = this.game;
    if (you) bodies.push({ T: you.T, P: you.P, s: 1, mass: 1, c: circles(you.T, 1), you: true, w: g.world });
    for (const e of this.bots) if (!e.wreck) bodies.push({ T: e.truck.T, P: e.truck.P, s: e.s, mass: e.type.mass, c: circles(e.truck.T, e.s), e, w: e.s === 1 ? g.world : this.mirror });
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) this.contact(bodies[i], bodies[j]);
  }

  contact(A, B) {
    if (Math.abs(A.c[2].x - B.c[2].x) > 200 || Math.abs(A.c[2].y - B.c[2].y) > 200) return;
    const shareA = B.mass / (A.mass + B.mass), shareB = A.mass / (A.mass + B.mass);
    // Pushing a truck apart moves its points (now and a step ago, so no speed is added). A wheel
    // must not be pushed into the ground: from inside it, it would fall straight through.
    const move = (body, pts, dx, dy) => {
      const { T, P } = body;
      for (const p of pts) {
        const i = p * 2, ox = T[i], oy = T[i + 1];
        let nx = ox + body.s * dx, ny = oy + dy;
        if (p === 1 || p === 2) { const h = body.w.collide(ox, oy, nx, ny); if (h) { nx = h.x; ny = h.y; } }
        P[i] += nx - ox; P[i + 1] += ny - oy;
        T[i] = nx; T[i + 1] = ny;
      }
    };
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
    const j = -(1 + BATTLE.ram.bounce) * vrel;
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
    // (Rivals only bump: they can't be wrecked.)
    if (A.you && !B.e.racer) this.ram(B, impact, best.nx, best.ny);
    else if (B.you && !A.e.racer) this.ram(A, impact, -best.nx, -best.ny);
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
    const e = E.e;
    if (stomp && them > 150) this.stomps++;
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
        // Enemy cars first, then rival cars, and only with neither ahead in range, Sandbox's birds
        // (never its tumbleweeds, though they blow up on one): the nearest ahead of the first of
        // those with any.
        const groups = [
          this.enemies.filter((e) => !e.wreck).map((e) => e.centre),
          this.racers.filter((e) => !e.wreck).map((e) => e.centre),
          (g.critters?.flying || []).map((b) => [b.x, b.y]),
        ];
        for (const aims of groups) {
          let bestD = BATTLE.missile.range;
          for (const [ex, ey] of aims) {
            const d = Math.hypot(ex - m.x, ey - m.y);
            if (d < bestD && Math.abs(wrapAngle(Math.atan2(ey - m.y, ex - m.x) - m.ang)) < BATTLE.missile.cone) { bestD = d; target = [ex, ey]; }
          }
          if (target) break;
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
      if (m.owner === 'you' && this.bots.some((e) => !e.wreck && hits(e.truck.T, e.s))) { this.blowMissile(m, m.x, m.y); continue; }
      if (m.owner === 'you' && g.critters?.flying.some((b) => Math.hypot(b.x - m.x, b.y - m.y) < 14)) { this.blowMissile(m, m.x, m.y); continue; }
      // (and a tumbleweed in the way: it blows up on one, though it never aims for one)
      if (g.critters?.weedAt(m.x, m.y, 4)) { this.blowMissile(m, m.x, m.y); continue; }
      if (m.owner === 'enemy' && you && hits(you.T, 1)) { this.blowMissile(m, m.x, m.y); continue; }
      if (--m.life <= 0) { this.blowMissile(m, m.x, m.y, 0.6); continue; }
    }
    // Missiles that meet blow each other up.
    for (const a of this.missiles) {
      if (a.dead || a.owner !== 'you') continue;
      for (const b of this.missiles) {
        if (b.dead || b.owner !== 'enemy' || Math.hypot(a.x - b.x, a.y - b.y) > 16) continue;
        this.blowMissile(a, a.x, a.y, 0.8); b.dead = true; this.intercepts++;
        this.say('Intercepted!');
        break;
      }
    }
  }

  blowMissile(m, x, y, scale = 1) {
    m.dead = true;
    const B = BATTLE.blast;
    if (m.owner === 'you') { if (this.explode(x, y, { radius: B.radius * scale, power: B.power * scale, hurtEnemies: BATTLE.missile.hurt * scale, yours: true })) this.onTarget++; }
    else this.explode(x, y, { radius: B.radius * 0.9 * scale, power: B.power * 0.8 * scale, hurtYou: BATTLE.enemyMissile.hurt * scale, hurtEnemies: 300 * scale });
  }

  /**
   * An explosion: it pushes everything near it (your own blast only pushes you a little, and
   * never hurts you: rocket jumps are allowed), and damages what's close. Returns whether it got
   * something a missile aims for: a bird knocked out, or a car (enemy or rival) in its damage.
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
    const birds = g.critters?.blast(x, y, radius, power, yours) || 0;
    if (you) blastPoints(you.T, you.P, 1, x, y, radius, power * (yours ? 0.6 : 1));
    if (g.wreck) blastPoints(g.wreck.T, g.wreck.P, 1, x, y, radius, power);
    for (const e of this.bots) {
      if (e.wreck) blastPoints(e.wreck.T, e.wreck.P, e.s, x, y, radius, power * 1.4);
      else blastPoints(e.truck.T, e.truck.P, e.s, x, y, radius, power);
    }
    // Damage: full in the middle, none at three quarters of the way out.
    const near = (T, s) => Math.max(0, Math.min(...circles(T, s).map((c) => Math.hypot(c.x - x, c.y - y) - c.r)));
    const share = (d) => Math.max(0, 1 - d / (radius * 0.75));
    if (hurtYou && you) this.hurtYou(hurtYou * share(near(you.T, 1)));
    const cars = this.bots.filter((e) => !e.wreck && share(near(e.truck.T, e.s)) > 0);
    if (hurtEnemies) for (const e of this.enemies) if (!e.wreck) this.hit(e, hurtEnemies * share(near(e.truck.T, -1)));
    return birds > 0 || cars.length > 0;
  }

  // ---- particles

  /**
   * A particle. (px, py) is where it was a step ago, for drawing it between steps as the trucks
   * are; `moved`: how far what it came out of moved this step, so one out of a fast truck starts
   * from where the truck's drawn, not a step's travel ahead of it.
   */
  bit(kind, x, y, vx, vy, life, moved = null) {
    if (this.bits.length >= 500) this.bits.shift();
    this.bits.push({ kind, x, y, vx, vy, life, max: life, frame: Math.floor(this.random * 8), size: 0.5 + this.random * 0.6,
      px: x - (moved ? moved[0] : 0), py: y - (moved ? moved[1] : 0), fresh: true });
  }

  stepEffects() {
    for (const b of this.blasts) b.age++;
    this.blasts = this.blasts.filter((b) => b.age < b.life);
    for (const b of this.bits) {
      b.life--;
      if (!b.fresh) { b.px = b.x; b.py = b.y; }
      b.fresh = false;
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
      if (e.wreck) return (e.wreckAge < 900 || this.onScreen(e)) && x > left - 300; // (an old wreck goes once out of sight)
      if (y > bottom) return false;
      if (x < left) {
        // It got past you (or you got past it).
        this.passed++;
        if (g.endTimer === 0 && g.screen === 'playing') { g.score += BATTLE.points.pass; this.say(`Passed!  +${BATTLE.points.pass}`); }
        return false;
      }
      return true;
    });
    // A rival that falls out of the world (Sandbox's gravity can do that) is gone.
    if (this.racers.length) this.racers = this.racers.filter((e) => e.centre[1] < bottom && Number.isFinite(e.truck.T[0]));
    this.missiles = this.missiles.filter((m) => !m.dead);
  }

  /** Move everything left by dx and up by dy (Endless scrolling the world: see Game.shiftWorld). */
  shift(dx, dy) {
    for (const e of this.bots) {
      const move = (A) => { for (let i = 0; i < A.length; i += 2) { A[i] -= e.s * dx; A[i + 1] -= dy; } };
      move(e.truck.T); move(e.truck.P);
      if (e.truck.probePrev) move(e.truck.probePrev);
      if (e.wreck) { move(e.wreck.T); move(e.wreck.P); }
      e.best -= e.s * dx;
    }
    for (const list of [this.missiles, this.blasts, this.bits]) for (const o of list) { o.x -= dx; o.y -= dy; }
    for (const o of this.bits) { o.px -= dx; o.py -= dy; }
  }

  /** What the renderer interpolates between steps: the enemies' points and the missiles. */
  snapshot() {
    return {
      e: this.bots.map((e) => [e.id, (e.wreck ? e.wreck.T : e.truck.T).slice(), e.truck.rearWheelRot, e.truck.frontWheelRot]),
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
