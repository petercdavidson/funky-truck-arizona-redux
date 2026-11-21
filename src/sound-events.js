// sound-events.js — turns game state into sound cues. No DOM access (runs under Node for tests).
//
// The game logic knows nothing about sound. After every 1/70 s step, SoundWatcher.observe(game)
// compares the game with the previous step and returns what happened (a landing, a scrape, a
// flip...), plus what the engine should sound like right now.

const LAND_AIR = 8;     // steps a wheel must be off the ground for touching down to be a landing
const BUMP_AIR = 2;     // ...or a bump

export class SoundWatcher {
  constructor() { this.reset(); }

  reset() {
    this.air = [0, 0];        // steps each wheel (rear, front) has been off the ground
    this.fall = [0, 0];       // its downward speed on the last step it was in the air
    this.damage = 0;
    this.scrapeCooldown = 0;
    this.flipTimer = 0;
    this.ticker = '';
    this.tickerTimer = 0;
    this.teleports = -1;
    this.screen = '';
  }

  /** Returns { events: [{ type, ... }], engine: { on, throttle, speed, airborne } }. */
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
      if (playing && !wasPlaying) events.push({ type: 'start' });
    }
    if (playing) {
      const contact = [t.rearContact, t.frontContact];
      const vy = [t.T[3] - t.P[3], t.T[5] - t.P[5]];
      for (let w = 0; w < 2; w++) {
        if (!contact[w]) { this.air[w]++; this.fall[w] = vy[w]; continue; }
        const air = this.air[w], fall = this.fall[w];
        this.air[w] = 0;
        if (air >= LAND_AIR && fall > 1) events.push({ type: 'land', force: Math.min(1, fall / 9), wheel: w });
        else if (air >= BUMP_AIR && fall > 1.5) events.push({ type: 'bump', force: Math.min(1, fall / 6), wheel: w });
      }
      if (this.scrapeCooldown > 0) this.scrapeCooldown--;
      if (game.damage > this.damage && this.scrapeCooldown === 0) {
        events.push({ type: 'scrape', amount: game.damage - this.damage });
        this.scrapeCooldown = 9;
      }
      if (game.flipBonusTimer > this.flipTimer) events.push({ type: 'flip', degrees: game.flipBonus });
    }
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
    return {
      events,
      engine: {
        on: playing,
        throttle: playing && (game.keys.up || game.keys.down) ? 1 : 0,
        speed: Math.min(1, speed / 14),
        airborne: !t.rearContact && !t.frontContact,
      },
    };
  }
}
