// rally.js — Rally Mode: race five rival trucks to the finish line of one of the nine stages, or
// all nine as a championship. No DOM access (runs under Node for tests).
//
// The rivals are Battle's racers (battle.js): trucks like yours, with the same physics and the
// same truck-on-truck collisions, going your way. There are no weapons and no damage. Everyone is
// dropped onto the grid together, ahead of the start (the stages start near their left edge, so
// you start at the back), and nobody moves until the countdown's GO.
//
// Places: whoever crosses the finish line first. When you cross, you're placed behind everyone
// who already has; the rest are behind you. If every rival has finished and you still haven't
// after RALLY.dnfAfter, the race is over and you're last. A championship scores each stage's
// places (RALLY.points) and adds them up.

import { Battle } from './battle.js';

const TILE = 64;
export const RALLY_ALL = 9;   // the championship: all nine stages

export const RALLY = {
  rivals: 5,
  gap: 130,                   // px between trucks on the grid
  countdown: 210,             // steps of 3, 2, 1 (then GO)
  dnfAfter: 2100,             // steps after the last rival finishes before your race is over (30 s)
  points: [10, 8, 6, 5, 4, 3],
  // How the racers keep it close: a little faster well behind you, a little slower well ahead.
  catchUp: { behind: 700, ahead: 1400, faster: 1.12, slower: 0.94 },
};

/** The rivals' names: places in Utah. */
export const NAMES = ['Moab', 'Zion', 'Bryce', 'Kanab', 'Arches', 'Escalante', 'Bonneville', 'Goblin', 'Capitol', 'Wasatch'];

export const ordinal = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/**
 * Five rivals, each a different body from each other and from yours, and in a paint that's not
 * yours (the two greens count as one), with tyres and wheels that aren't yours either.
 */
export function rivalLooks(you, random = Math.random) {
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const notMine = (no) => [0, 1, 2, 3, 4, 5].filter((i) => !no.includes(i));
  const greens = [2, 5];
  const bodies = shuffle(notMine([you.body]));
  const paints = shuffle(notMine(greens.includes(you.paint) ? greens : [you.paint]));
  const pick = (no) => { const ok = notMine(no); return ok[Math.floor(random() * ok.length)]; };
  return bodies.slice(0, RALLY.rivals).map((body, i) => ({ body, paint: paints[i % paints.length], tyre: pick([you.tyre]), hub: pick([you.hub]) }));
}

/** Saved best places: { track: place } (1 is a win), checked. */
export function validRallyBests(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  for (let t = 0; t <= RALLY_ALL; t++) {
    const p = Number(v[t]);
    if (Number.isInteger(p) && p >= 1 && p <= RALLY.rivals + 1) out[t] = p;
  }
  return out;
}

export class Race {
  /** @param track  a stage (0-8), or RALLY_ALL for the championship */
  constructor(game, track) {
    this.game = game;
    this.track = track;
    const names = [...NAMES];
    for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(game.random() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
    // The same rivals, in the same trucks, all championship.
    this.rivals = rivalLooks(game.look, game.random).map((look, i) => ({ name: names[i], look, skill: 0.96 + game.random() * 0.1 }));
    this.points = Object.fromEntries([['You', 0], ...this.rivals.map((r) => [r.name, 0])]);
    this.stageResults = [];       // per stage: names in finishing order
    this.result = null;           // at the end: { place, time, dnf, points }
  }

  get championship() { return this.track === RALLY_ALL; }
  get finishX() { return (this.game.levelData.width - 9) * TILE; }
  /** Whether the countdown is still on: nobody drives. */
  get holding() { return this.countdown > 0; }
  get battle() { return this.game.battle; }

  /** A new stage: the rivals on the grid ahead of you, and the countdown. */
  startStage() {
    const g = this.game;
    g.battle = new Battle(g, { waves: false, pickups: false, weapons: false });
    const x0 = g.levelData.start[0];
    this.rivals.forEach((r, i) => {
      const e = g.battle.addRacer(r.look, x0 + RALLY.gap * (RALLY.rivals - i), r.name);
      if (e) { e.skill = r.skill; e.truck.power = r.skill; }
    });
    this.countdown = RALLY.countdown;
    this.clock = 0;
    this.order = [];              // racers in the order they finished
    this.you = null;              // your finish: { place, time, dnf }
    this.dnfTimer = 0;
  }

  step() {
    const g = this.game, b = this.battle;
    if (this.countdown > 0) {
      // 3, 2, 1 as each second starts, then GO.
      if (this.countdown % 70 === 0) b.events.push({ type: 'count', n: this.countdown / 70 });
      if (--this.countdown === 0) { b.events.push({ type: 'go' }); g.ticker = 'GO!'; g.tickerTimer = 60; }
      return;
    }
    if (!this.you) this.clock++;
    const youX = g.focus[0];
    for (const e of b.racers) {
      if (e.finished === null && e.centre[0] >= this.finishX) { e.finished = this.clock; this.order.push(e); }
      // Keeping it close, while you're racing.
      if (!this.you && e.finished === null) {
        const C = RALLY.catchUp, d = e.centre[0] - youX;
        e.truck.power = e.skill * (d < -C.behind ? C.faster : d > C.ahead ? C.slower : 1);
      } else e.truck.power = e.skill;
    }
    if (!this.you && this.order.length >= b.racers.length && g.endTimer === 0 && ++this.dnfTimer > RALLY.dnfAfter) g.raceOver();
  }

  /** Your place now: behind everyone finished, and everyone further along than you. */
  get place() {
    if (this.you) return this.you.place;
    const x = this.game.focus[0];
    return 1 + this.order.length + this.battle.racers.filter((e) => e.finished === null && e.centre[0] > x).length;
  }

  /** How many are in the race. */
  get field() { return this.battle.racers.length + 1; }

  /** You crossed the finish line (or ran out of time: `dnf`). */
  finish(dnf = false) {
    if (this.you) return;
    this.you = { place: dnf ? this.field : this.order.length + 1, time: dnf ? null : this.clock, dnf };
    if (this.you.place === 1) this.game.stats.rallyWins = (this.game.stats.rallyWins || 0) + 1;
  }

  /** The stage's finishing order, by name: those finished, then by how far along they are. */
  standings() {
    const g = this.game, all = [...this.order.map((e) => e.name)];
    const rest = this.battle.racers.filter((e) => e.finished === null).map((e) => [e.name, e.centre[0]]);
    rest.push(['You', g.focus[0]]);
    rest.sort((a, b) => b[1] - a[1]);
    for (const [name] of rest) if (name !== 'You' || !this.you) all.push(name);
    if (this.you) all.splice(this.you.place - 1, 0, 'You');
    return all;
  }

  /** The stage is over: score its places (in a championship). */
  award() {
    const list = this.standings();
    this.stageResults.push(list);
    list.forEach((name, i) => { this.points[name] = (this.points[name] || 0) + (RALLY.points[i] || 0); });
  }

  /** The championship table: [name, points], best first (you ahead on a tie). */
  table() {
    return Object.entries(this.points).sort((a, b) => b[1] - a[1] || (a[0] === 'You' ? -1 : b[0] === 'You' ? 1 : 0));
  }

  /** The run's over: what you got, and your best kept. */
  finishRun() {
    const g = this.game;
    const place = this.championship ? this.table().findIndex(([n]) => n === 'You') + 1 : this.you?.place ?? this.field;
    this.result = { place, time: this.championship ? null : this.you?.time ?? null, dnf: !!this.you?.dnf && !this.championship, points: this.points.You };
    const best = g.rallyBests[this.track];
    this.result.best = best ?? null;
    this.result.record = best === undefined || place < best;
    if (this.result.record) { g.rallyBests[this.track] = place; g.store.set('rallyBests', g.rallyBests); }
  }
}
