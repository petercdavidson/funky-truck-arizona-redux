// sound-events.js — turns game state into sound cues. No DOM access (runs under Node for tests).
//
// The game logic knows nothing about sound. After every 1/70 s step, SoundWatcher.observe(game)
// compares the game with the previous step and returns what happened (a landing, a trick...),
// plus what the engine and the cab scraping the ground should sound like right now.

const LAND_AIR = 8;     // steps a wheel must be off the ground for touching down to be a landing
const BUMP_AIR = 2;     // ...or a bump
const SCRAPE_HOLD = 6;  // steps the scrape keeps sounding after the cab last touched (it flickers)

export class SoundWatcher {
  constructor() { this.reset(); }

  reset() {
    this.air = [0, 0];        // steps each wheel (rear, front) has been off the ground
    this.fall = [0, 0];       // its downward speed on the last step it was in the air
    this.damage = 0;
    this.scrapeHold = 0;
    this.flipTimer = 0;
    this.tricksDone = 0;
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
      this.scrapeHold = 0;
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
      if (game.rules.classic) {
        // Classic: the original flip bonus, heard as it's paid (which is the moment it lands).
        if (game.flipBonusTimer > this.flipTimer) events.push({ type: 'flip', degrees: game.flipBonus });
      } else if (game.tricks.done > this.tricksDone) {
        // Tricks sound as they're done, not when their points are added up later.
        events.push({ type: 'trick', names: game.tricks.fresh });
      }
    } else this.scrapeHold = 0;
    this.tricksDone = game.tricks.done;
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
      scrape: { on: this.scrapeHold > 0, speed: Math.min(1, slide / 7) },
      engine: {
        on: playing && !game.wreck,
        throttle: playing && (game.driveKeys().up || game.keys.down) ? 1 : 0,
        speed: Math.min(1, speed / 14),
        airborne: !t.rearContact && !t.frontContact,
      },
    };
  }
}
