// The sound cues the game produces (sound-events.js) and the saved sound setting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, SOUND_SETS, TILE } from '../src/game.js';
import { SoundWatcher } from '../src/sound-events.js';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
function memoryStore() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) };
}

/** Run the game, collecting every sound cue. */
function listen(g, w, frames, each = () => {}) {
  const heard = [];
  for (let i = 0; i < frames; i++) {
    each(i);
    g.step();
    const r = w.observe(g);
    heard.push(...r.events.map((e) => e.type));
  }
  return heard;
}

test('starting a stage and dropping onto the ground make start and landing cues', () => {
  const g = new Game(data), w = new SoundWatcher();
  w.observe(g);
  g.startPractice(0);
  const heard = listen(g, w, 140);
  assert.equal(heard.filter((t) => t === 'start').length, 1);
  assert.ok(heard.includes('land') || heard.includes('bump'), `heard ${heard}`);
});

test('the engine follows the throttle and goes quiet when paused', () => {
  const g = new Game(data), w = new SoundWatcher();
  g.startPractice(0);
  for (let i = 0; i < 100; i++) { g.step(); w.observe(g); }
  g.keys.up = true;
  let r;
  for (let i = 0; i < 60; i++) { g.step(); r = w.observe(g); }
  assert.equal(r.engine.on, true);
  assert.equal(r.engine.throttle, 1);
  assert.ok(r.engine.speed > 0 && r.engine.speed <= 1);
  g.keys.up = false;
  g.togglePause();
  g.step();
  r = w.observe(g);
  assert.equal(r.engine.on, false);
});

test('scraping the cab, landing a flip, finishing and wrecking all make cues', () => {
  const g = new Game(data), w = new SoundWatcher();
  g.startCampaign();
  listen(g, w, 100);
  g.damage = 10; // as if the cab scraped
  let heard = listen(g, w, 2);
  assert.ok(heard.includes('scrape'));
  g.flipBonus = 400; g.flipBonusTimer = 70; // as if a flip just landed
  heard = listen(g, w, 1);
  assert.ok(heard.includes('flip'));
  // Over the finish line.
  const dx = (data.levels[0].width - 9) * TILE + 1 - g.truck.T[0];
  for (let i = 0; i < 10; i += 2) { g.truck.T[i] += dx; g.truck.P[i] += dx; }
  g.truck.probePrev = null;
  heard = listen(g, w, 5);
  assert.ok(heard.includes('stage'), `heard ${heard}`);
  listen(g, w, 300);
  g.damage = 1000;
  heard = listen(g, w, 5);
  assert.ok(heard.includes('wreck'), `heard ${heard}`);
});

test('the sound set is saved, cycles through every set, and a bad saved value is ignored', () => {
  const store = memoryStore();
  const g = new Game(data, { store });
  assert.equal(g.soundSet, 'classic');
  const seen = [];
  for (let i = 0; i < SOUND_SETS.length; i++) { g.cycleSound(); seen.push(g.soundSet); }
  assert.deepEqual([...seen].sort(), [...SOUND_SETS].sort());
  assert.equal(g.soundSet, 'classic');
  g.cycleSound();
  assert.equal(new Game(data, { store }).soundSet, g.soundSet);
  store.set('soundSet', 'kazoo');
  assert.equal(new Game(data, { store }).soundSet, 'classic');
});
