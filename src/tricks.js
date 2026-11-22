// tricks.js — spots tricks and scores them in chains. No DOM access (runs under Node for tests).
//
// It only watches the truck; it never changes the physics. Tricks:
//   Backflip / Frontflip   a flip completed by landing (as the original game scored it), with
//                          Double, Triple... for more turns; worth the degrees turned, as before.
//                          Each turn is counted out (+1, +2...) in the air as it's completed.
//   Big Air / Huge Air     a second (two seconds) or more with all wheels off the ground, named
//                          with the airtime: "Big Air (1.7s)"
//   Wheelie / Nose Wheelie driving along on the back (front) wheel alone
//   Clean                  landing a jump on both wheels at once, without scraping the cab
// Tricks done close together form a chain. The chain is worth its tricks' points added up, times
// the number of tricks in it (up to x5), and it's paid out a moment after the last trick.
// Scraping the cab bails the chain: its tricks still pay, but without the multiplier.

const STEP = 1 / 70;
export const TRICK = {
  minAir: 10,            // steps off the ground before a touchdown counts as a landing
  bigAir: 70,            // steps of airtime for Big Air
  hugeAir: 140,          // ...and Huge Air
  airPoints: 3,          // per step of airtime beyond half a second, for Big/Huge Air
  wheelieStart: 50,      // steps on one wheel before it counts as a wheelie
  wheeliePoints: 2,      // per step of wheelie
  cleanWindow: 6,        // both wheels must touch down within this many steps of each other
  cleanBonus: 0.5,       // Clean adds this share of the jump's points
  chainGap: 105,         // steps on the ground with no trick before the chain is paid out
  maxMultiplier: 5,
  showFor: 90,           // steps a trick's name stays on screen
  readFor: 55,           // ...and at least this long before the next trick's name replaces it
  popFor: 50,            // steps a flip's count (+1, +2...) stays by the truck in the air
};

const COUNT = ['', '', 'Double ', 'Triple ', 'Quadruple ', 'Quintuple '];

/**
 * Whole turns in a rotation (degrees, either way). A flip that lands needs most of a turn, so
 * 260° to 619° is one turn, 620° to 979° two, and so on (a landed flip of 190° to 259°, the
 * original game's minimum, still counts as one).
 */
export function flipTurns(degrees) { return Math.floor((Math.abs(degrees) + 100) / 360); }
/** 'Backflip' for a rotation backwards (positive, as Truck.flipAccum counts), else 'Frontflip'. */
export function flipKind(degrees) { return degrees > 0 ? 'Backflip' : 'Frontflip'; }
/** Big Air or Huge Air, with the airtime: "Big Air (1.7s)". */
export function airName(steps) { return `${steps >= TRICK.hugeAir ? 'Huge Air' : 'Big Air'} (${(Math.floor(steps * STEP * 10) / 10).toFixed(1)}s)`; }

/** Name of a flip from its total rotation (positive = backwards, as Truck.flipAccum counts). */
export function flipName(degrees) {
  const turns = Math.max(1, flipTurns(degrees));
  const kind = flipKind(degrees);
  return turns < COUNT.length ? COUNT[turns] + kind : `${turns}x ${kind}`;
}

export class TrickTracker {
  /**
   * `onTrick(kind, info)` hears each trick as it's scored (kind is the trick without counts or
   * airtime: 'Backflip', 'Big Air'...; info has `turns` for flips, `steps` for airtime and
   * wheelies), and `onBank(points, tricks, bailed)` each chain as it's paid out. Both are
   * optional (the game keeps its stats with them).
   */
  constructor({ onTrick = null, onBank = null } = {}) {
    this.onTrick = onTrick;
    this.onBank = onBank;
    this.reset();
  }

  reset() {
    this.air = 0;              // steps with no wheel on the ground
    this.jump = null;          // tricks from the jump being landed: { tricks, points, landedAt }
    this.wheelie = null;       // { kind, steps }
    this.chain = [];           // [{ name, points }]
    this.idle = 0;             // steps since the chain's last trick
    this.since = 0;            // steps since the last landing
    this.firstTouch = -1;      // step (of `since`) the first wheel touched down
    this.banked = null;        // last payout: { points, multiplier, bailed }
    this.show = null;          // what the HUD shows: { names, timer }
    this.queue = [];           // names waiting their turn on screen
    this.bail = null;          // a bail's note under the names: { timer }
    this.done = 0;             // bumped each time tricks are performed (for the sound)
    this.fresh = [];           // the tricks just performed
    this.airTurns = 0;         // whole turns counted out so far in this jump
    this.flipPop = null;       // the count on screen: { turns, kind, timer }
    this.flipCounts = 0;       // bumped each time a turn is counted out (for the sound)
  }

  get multiplier() { return Math.min(TRICK.maxMultiplier, Math.max(1, this.chain.length)); }
  get chainPoints() { return this.chain.reduce((s, t) => s + t.points, 0); }

  add(name, points, kind = name, info = {}) {
    this.chain.push({ name, points: Math.round(points) });
    this.idle = 0;
    this.onTrick?.(kind, info);
  }

  /** A landed flip, from its total rotation and its points (the original game's degrees). */
  addFlip(degrees, points) {
    this.add(flipName(degrees), points, flipKind(degrees), { turns: Math.max(1, flipTurns(degrees)) });
    return flipName(degrees);
  }

  /**
   * Put trick names on screen. `fresh` are the tricks just performed (the sound plays for them at
   * once); `names` is what to show. A name still being read isn't replaced straight away: the new
   * one waits its turn, unless it only adds to what's showing (a Clean on the same landing).
   */
  announce(names, fresh = names) {
    if (!names.length) return;
    this.done++;
    this.fresh = fresh;
    const s = this.show;
    const adds = s && names.length > s.names.length && s.names.every((n, i) => n === names[i]);
    if (adds) { s.names = names; return; }
    if (s && TRICK.showFor - s.timer < TRICK.readFor) this.queue.push(names);
    else this.show = { names, timer: TRICK.showFor };
  }

  /** Count down the name on screen, and bring on the next one when its turn comes. */
  tickShow() {
    if (this.flipPop && --this.flipPop.timer <= 0) this.flipPop = null;
    if (this.bail && --this.bail.timer <= 0) this.bail = null;
    const s = this.show;
    if (s) {
      s.timer--;
      if (this.queue.length && TRICK.showFor - s.timer >= TRICK.readFor) this.show = { names: this.queue.shift(), timer: TRICK.showFor };
      else if (s.timer <= 0) this.show = null;
    } else if (this.queue.length) this.show = { names: this.queue.shift(), timer: TRICK.showFor };
  }

  /**
   * Call once per step after the truck has moved.
   * @param truck     the Truck
   * @param flip      degrees from Truck.trackFlip() this step (null if no flip was landed)
   * @param scraped   true if the cab hit the ground this step
   * @param scoring   false while tricks shouldn't score (after the finish line, say)
   * @returns points to add to the score this step (0 unless a chain was paid out)
   */
  step(truck, flip, scraped, scoring) {
    this.tickShow();
    if (!scoring) { this.chain = []; this.jump = null; this.wheelie = null; this.air = 0; this.airTurns = 0; return 0; }
    const rear = truck.rearContact, front = truck.frontContact;
    const forward = truck.T[0] - truck.P[0];
    let paid = 0;

    // ---- in the air
    if (!rear && !front) {
      this.air++;
      this.endWheelie();
      if (this.air >= TRICK.minAir) this.idle = 0; // a real jump keeps the chain going; bounces don't
      // Count each turn out as it's completed, before the landing that scores the flip.
      const turns = truck.airborne ? flipTurns(truck.flipAccum) : 0;
      if (turns > this.airTurns) {
        this.airTurns = turns;
        this.flipPop = { turns, kind: flipKind(truck.flipAccum), timer: TRICK.popFor };
        this.flipCounts++;
      }
      return 0;
    }
    this.airTurns = 0;

    // ---- touching down after a jump
    if (this.air >= TRICK.minAir) {
      const tricks = [];
      // The original game's flip, by the same rule (Truck.trackFlip), keeps its points.
      if (flip !== null) tricks.push({ name: this.addFlip(truck.flipAccum, flip), points: flip });
      if (this.air >= TRICK.bigAir) {
        const t = { name: airName(this.air), points: (this.air - 35) * TRICK.airPoints };
        this.add(t.name, t.points, this.air >= TRICK.hugeAir ? 'Huge Air' : 'Big Air', { steps: this.air });
        tricks.push(t);
      }
      this.jump = { tricks, points: tricks.reduce((s, t) => s + t.points, 0) };
      this.since = 0;
      this.firstTouch = 0;
      this.announce(tricks.map((t) => t.name));
    } else if (flip !== null) {
      // a flip on a short hop (rare): still the original flip points
      this.announce([this.addFlip(truck.flipAccum, flip)]);
    }
    this.air = 0;

    // ---- just landed: was it clean?
    if (this.jump) {
      this.since++;
      if (scraped) { this.jump = null; }
      else if (rear && front && this.since <= TRICK.cleanWindow) {
        if (this.jump.points > 0) {
          this.add('Clean', this.jump.points * TRICK.cleanBonus);
          const last = this.queue.length ? this.queue[this.queue.length - 1] : this.show?.names || [];
          if (this.queue.length) { this.queue[this.queue.length - 1] = [...last, 'Clean']; this.done++; this.fresh = ['Clean']; }
          else this.announce([...last, 'Clean'], ['Clean']);
        }
        this.jump = null;
      } else if (this.since > TRICK.cleanWindow) this.jump = null;
    }

    // ---- wheelies
    const one = rear !== front;
    if (one && forward > 0.8) {
      const kind = rear ? 'Wheelie' : 'Nose Wheelie';
      if (!this.wheelie || this.wheelie.kind !== kind) { this.endWheelie(); this.wheelie = { kind, steps: 0 }; }
      this.wheelie.steps++;
      if (this.wheelie.steps === TRICK.wheelieStart) this.announce([kind]);
      if (this.wheelie.steps >= TRICK.wheelieStart) this.idle = 0;
    } else this.endWheelie();

    // ---- bail, or pay out the chain once things go quiet (a wheelie in progress keeps it open)
    if (scraped && this.chain.length) paid = this.bank(true);
    else if (this.chain.length) {
      const busy = this.wheelie && this.wheelie.steps >= TRICK.wheelieStart;
      if (!busy && ++this.idle >= TRICK.chainGap) paid = this.bank(false);
    }
    return paid;
  }

  endWheelie() {
    const w = this.wheelie;
    this.wheelie = null;
    if (w && w.steps >= TRICK.wheelieStart) this.add(w.kind, w.steps * TRICK.wheeliePoints, w.kind, { steps: w.steps });
  }

  /** Pay out the chain now (also called when a stage ends). Returns the points. */
  bank(bailed = false) {
    this.endWheelie();
    if (!this.chain.length) return 0;
    const mult = bailed ? 1 : this.multiplier;
    const points = this.chainPoints * mult;
    this.banked = { points, multiplier: mult, bailed };
    this.onBank?.(points, this.chain.length, bailed);
    // A bail isn't a trick: it's noted under the chain's names, and makes no trick sound.
    if (bailed && this.chain.length > 1) this.bail = { timer: TRICK.showFor };
    this.chain = [];
    this.idle = 0;
    return points;
  }

  /** Seconds of airtime so far (for the HUD). */
  get airSeconds() { return this.air * STEP; }
}
