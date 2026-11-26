// sound-events.js — turns game state into sound cues. No DOM access (runs under Node for tests).
//
// The game logic knows nothing about sound. After every 1/70 s step, SoundWatcher.observe(game)
// compares the game with the previous step and returns what happened (a landing, a trick...),
// plus what the engine and the cab scraping the ground should sound like right now.

const LAND_AIR = 8;     // steps a wheel must be off the ground for touching down to be a landing
const BUMP_AIR = 2;     // ...or a bump
const SCRAPE_HOLD = 6;  // steps the scrape keeps sounding after the cab last touched (it flickers)
// The scrape is heard at full loudness for as long as Classic's scraping would take to wreck the
// truck (1000 damage at 6 a step: 167 steps, about 2.4 s, some 17 hits), then fades away over
// SCRAPE_FADE steps: a truck lying on its roof where scraping does no damage (Sandbox with damage
// off, say) isn't heard for ever. While it's doing damage it's always heard in full. It starts
// over once the cab has been off the ground for SCRAPE_REST steps.
export const SCRAPE_LIMIT = Math.ceil(1000 / 6);
const SCRAPE_FADE = 70;
const SCRAPE_REST = 35;
// The engine fades out going up, gone by 10 km (only the rocket up there).
export const ENGINE_FADE = [1000, 10000];

export class SoundWatcher {
  constructor() { this.reset(); }

  reset() {
    this.air = [0, 0];        // steps each wheel (rear, front) has been off the ground
    this.fall = [0, 0];       // its downward speed on the last step it was in the air
    this.damage = 0;
    this.scrapeHold = 0;
    this.scrapeRun = 0;       // steps of scraping in a row that did no damage
    this.scrapeOff = 0;       // steps since the cab last scraped
    this.flipTimer = 0;
    this.tricksDone = 0;
    this.flipCounts = 0;
    this.milestone = 0;
    this.ticker = '';
    this.tickerTimer = 0;
    this.teleports = -1;
    this.screen = '';
  }

  /** Returns { events: [{ type, ... }], engine: { on, throttle, speed, airborne }, scrape: { on, speed } }. */
  observe(game) {
    const events = [];
    const t = game.truck;
    const playing = game.screen === 'playing';
    if (game.teleportCount !== this.teleports) {
      // A new stage (or a restart): forget the old truck's state.
      const wasPlaying = this.screen === 'playing' || this.screen === 'paused';
      this.teleports = game.teleportCount;
      this.air = [0, 0];
      this.damage = game.damage;
      this.flipTimer = game.flipBonusTimer;
      this.tricksDone = game.tricks.done;
      this.flipCounts = game.tricks.flipCounts;
      this.milestone = game.milestone?.n ?? 0;
      this.scrapeHold = 0; this.scrapeRun = 0;
      if (playing && !wasPlaying) events.push({ type: 'start' });
    }
    if (playing && !game.wreck) {
      const contact = [t.rearContact, t.frontContact];
      const vy = [t.T[3] - t.P[3], t.T[5] - t.P[5]];
      for (let w = 0; w < 2; w++) {
        if (!contact[w]) { this.air[w]++; this.fall[w] = vy[w]; continue; }
        const air = this.air[w], fall = this.fall[w];
        this.air[w] = 0;
        if (air >= LAND_AIR && fall > 1) events.push({ type: 'land', force: Math.min(1, fall / 9), wheel: w });
        else if (air >= BUMP_AIR && fall > 1.5) events.push({ type: 'bump', force: Math.min(1, fall / 6), wheel: w });
      }
      this.scrapeHold = game.scraping ? SCRAPE_HOLD : Math.max(0, this.scrapeHold - 1);
      if (game.scraping) {
        this.scrapeOff = 0;
        if (game.rules.damage && game.endTimer === 0 && game.damage < 1000) this.scrapeRun = 0; else this.scrapeRun++;
      } else if (++this.scrapeOff >= SCRAPE_REST) this.scrapeRun = 0;
      if (game.rules.flipBonus) {
        // The original flip bonus (Classic, tricks off), heard as it's paid (the moment it lands).
        if (game.flipBonusTimer > this.flipTimer) events.push({ type: 'flip', degrees: game.flipBonus });
      } else if (game.tricks.done > this.tricksDone) {
        // Tricks sound as they're done, not when their points are added up later.
        events.push({ type: 'trick', names: game.tricks.fresh });
      }
      // Each turn of a flip, counted out in the air (+1, +2...).
      if (game.tricks.flipCounts > this.flipCounts && game.tricks.flipPop) events.push({ type: 'flipCount', turns: game.tricks.flipPop.turns });
    } else this.scrapeHold = 0;
    this.tricksDone = game.tricks.done;
    this.flipCounts = game.tricks.flipCounts;
    // Endless milestones, as each comes on screen.
    if (playing && game.milestone && game.milestone.n !== this.milestone) events.push({ type: game.milestone.sound || 'milestone' });
    // Battle Mode says what happened each step (missiles, explosions, pickups...).
    if (game.battle) for (const e of game.battle.events) events.push(e);
    // Sandbox's critters: a bird hit by the truck or a missile's blast; tumbleweeds hit by the
    // truck, or bouncing off the ground or each other.
    if (playing && game.critters) {
      for (const e of game.critters.events) {
        if (e.kind === 'bird') events.push({ type: 'bird', force: e.blast ? Math.max(0.7, Math.min(1, e.speed / 10)) : Math.min(1, e.speed / 10) });
        if (e.kind === 'weed') events.push({ type: 'weed', force: Math.min(1, e.speed / 10) });
        else if (e.kind === 'weedBounce') events.push({ type: 'weed', force: Math.min(0.6, e.speed / 12), soft: true });
      }
    }
    this.milestone = game.milestone?.n ?? this.milestone;
    if (game.tickerTimer > this.tickerTimer || game.ticker !== this.ticker) {
      if (game.ticker.startsWith('Stage Complete')) events.push({ type: 'stage' });
      else if (game.ticker.startsWith('Your truck is wrecked')) events.push({ type: 'wreck' });
    }
    if (game.screen === 'gameOver' && this.screen !== 'gameOver' && game.finished && !game.wrecked) events.push({ type: 'win' });
    this.damage = game.damage;
    this.flipTimer = game.flipBonusTimer;
    this.ticker = game.ticker;
    this.tickerTimer = game.tickerTimer;
    this.screen = game.screen;
    const speed = (Math.abs(t.rearSpin) + Math.abs(t.frontSpin)) / 2;
    const slide = Math.hypot(t.T[0] - t.P[0], t.T[1] - t.P[1]);
    return {
      events,
      scrape: { on: this.scrapeHold > 0 && this.scrapeRun < SCRAPE_LIMIT + SCRAPE_FADE, speed: Math.min(1, slide / 7), volume: Math.max(0, Math.min(1, 1 - (this.scrapeRun - SCRAPE_LIMIT) / SCRAPE_FADE)) },
      // A truck wrecked on purpose (Esc) has no wheels to drive, but its engine still revs.
      engine: game.height >= ENGINE_FADE[1] ? { on: false } : game.wreck ? {
        on: playing && game.selfWrecked,
        throttle: game.keys.up || game.keys.one || game.keys.down ? 1 : 0,
        speed: 0,
        airborne: false,
        volume: engineVolume(game.height),
      } : {
        on: playing,
        throttle: playing && (game.driveKeys().up || game.keys.down) ? 1 : 0,
        speed: Math.min(1, speed / 14),
        airborne: !t.rearContact && !t.frontContact,
        volume: engineVolume(game.height),
      },
    };
  }
}

/** The engine's loudness at `metres` up: full low down, fading to nothing by 10 km. */
export function engineVolume(metres = 0) {
  const f = Math.max(0, Math.min(1, (metres - ENGINE_FADE[0]) / (ENGINE_FADE[1] - ENGINE_FADE[0])));
  return 1 - f * f * (3 - 2 * f);
}
