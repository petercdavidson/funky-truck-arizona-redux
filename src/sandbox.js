// sandbox.js — Sandbox Mode's settings, and its traffic (rival and enemy cars). No DOM access
// (runs under Node for tests).
//
// Sandbox is Endless's course, any stage or any stunt track, with no damage, unlimited boost,
// jumps and missiles, and the physics turned up (or down) as you like. Stages keep their finish
// line. Each setting is a list of choices; what's saved is which one is chosen (an index), as
// `funkytruck.sandbox`. They can be changed on the Sandbox screen before a run, and from the pause
// menu's Tweaks during one. Nothing done in Sandbox counts towards the High Scores screen.
//
// Traffic is Battle's trucks (battle.js): rival cars drive your way, like Rally's racers; enemy
// cars come at you, like Battle's. On a stage they're spread along the track. On Endless's course
// and the stunt tracks they loop: one that's been out of sight for a while comes back, just out
// of view (an enemy ahead of you, a rival on the other side from where it went).

import { BATTLE, enemyLook } from './battle.js';

const TILE = 64;
const COUNTS = [0, 1, 2, 3, 4, 6, 8].map((n) => [n, n ? String(n) : 'None']);

/**
 * The settings: key, name, the choices [value, label], the default choice, and `live` false for
 * those only set before a run (the track).
 */
export const SANDBOX_ROWS = [
  { key: 'course', name: 'Track', choices: [], dflt: 0, live: false }, // filled in by the game: Endless, the stages, the stunt tracks
  { key: 'power', name: 'Drive Power', choices: [[0.5, '×½'], [1, '×1'], [1.5, '×1.5'], [2, '×2'], [3, '×3'], [5, '×5']], dflt: 1 },
  { key: 'gravity', name: 'Gravity', choices: [[0, 'None'], [0.17, 'Moon'], [0.5, 'Low'], [1, 'Earth'], [1.6, 'High'], [2.5, 'Jupiter']], dflt: 3 },
  { key: 'spin', name: 'Air Spin', choices: [[0.5, '×½'], [1, '×1'], [2, '×2'], [4, '×4']], dflt: 1 },
  { key: 'springs', name: 'Suspension', choices: [[0.03, 'Floppy'], [0.1, 'Normal'], [0.25, 'Stiff'], [0.7, 'Rigid']], dflt: 1 },
  { key: 'boostPower', name: 'Boost Power', choices: [[0.5, '×½'], [1, '×1'], [2, '×2'], [4, '×4'], [8, '×8']], dflt: 1 },
  { key: 'jump', name: 'Jump Power', choices: [[0.5, '×½'], [1, '×1'], [2, '×2'], [3, '×3'], [5, '×5']], dflt: 1 },
  { key: 'airJumps', name: 'Air Jumps', choices: [[false, 'Off'], [true, 'On']], dflt: 0 },
  { key: 'rivals', name: 'Rival Cars', choices: COUNTS, dflt: 0 },
  { key: 'enemies', name: 'Enemy Cars', choices: COUNTS, dflt: 0 },
  { key: 'slow', name: 'Slow Motion', choices: [[1, 'Off'], [0.5, 'Half'], [0.25, 'Quarter']], dflt: 0 },
  { key: 'hitboxes', name: 'Hitboxes', choices: [[false, 'Hidden'], [true, 'Shown']], dflt: 0 },
];
export const SANDBOX_ROW = Object.fromEntries(SANDBOX_ROWS.map((r) => [r.key, r]));

/** The default settings: { key: choice index }. */
export function defaultSandbox() { return Object.fromEntries(SANDBOX_ROWS.map((r) => [r.key, r.dflt])); }

/** Saved settings, checked: anything missing or out of range goes back to its default. `courses` is how many tracks there are. */
export function validSandbox(v, courses = 13) {
  const s = defaultSandbox();
  if (!v || typeof v !== 'object') return s;
  for (const r of SANDBOX_ROWS) {
    const n = r.key === 'course' ? courses : r.choices.length;
    if (Number.isInteger(v[r.key]) && v[r.key] >= 0 && v[r.key] < n) s[r.key] = v[r.key];
  }
  return s;
}

/** The chosen value of setting `key`. */
export const sandboxValue = (settings, key) => SANDBOX_ROW[key].choices[settings[key]]?.[0];

/** Boost, jumps and missiles never run out in Sandbox; these are its weapons' settings. */
function sandboxTune(v) {
  return {
    boostPush: BATTLE.boost.push * v('boostPower'),
    jump: BATTLE.jump * v('jump'),
    unlimitedBoost: true,
    unlimited: true,
    airJumps: v('airJumps'),
    fireCooldown: 9,
  };
}

/**
 * Put the settings into the game: your truck's power, gravity, spin and springs, the weapons'
 * tuning, and the traffic (cars added or taken away to match).
 */
export function applySandbox(game) {
  const S = game.sandbox, v = (k) => sandboxValue(S, k), t = game.truck;
  t.power = v('power');
  t.gravity = 0.11 * v('gravity');
  t.tiltPower = v('spin');
  t.springK = v('springs');
  if (game.wreck) game.wreck.gravity = t.gravity;
  const b = game.battle;
  if (!b) return;
  Object.assign(b.tune, sandboxTune(v));
  for (const e of b.bots) matchTruck(game, e);
  setTraffic(game, v('rivals'), v('enemies'));
}

/** A car's springs and spin follow yours (its gravity does too: see Battle.stepEnemy). */
function matchTruck(game, e) {
  e.truck.springK = game.truck.springK;
  e.truck.tiltPower = game.truck.tiltPower;
  if (e.racer) e.truck.power = e.skill * game.truck.power;
}

/** Whether the cars loop (Endless's course and the stunt tracks: tracks with no finish). */
export const trafficLoops = (game) => game.onCourse || game.isStunt;

/** Add or take away cars until there are `rivals` rival cars and `enemies` enemy cars. */
export function setTraffic(game, rivals, enemies) {
  const b = game.battle, you = game.truck.T[0];
  // too many: the ones furthest from you go
  const far = (list) => list.sort((p, q) => Math.abs(q.centre[0] - you) - Math.abs(p.centre[0] - you));
  if (b.racers.length > rivals) b.racers = far(b.racers).slice(b.racers.length - rivals);
  if (b.enemies.length > enemies) b.enemies = far(b.enemies).slice(b.enemies.length - enemies);
  // too few: rivals just ahead of you; enemies spread along the track, or just out of view
  for (let n = rivals - b.racers.length, x = you + 260; n > 0; n--) {
    while (b.racers.some((e) => Math.abs(e.centre[0] - x) < 140)) x += 140;
    if (!addRival(game, x)) addRival(game, Math.max(300, you - 400 - 160 * n));
    x += 160;
  }
  const missing = enemies - b.enemies.length;
  if (missing <= 0) return;
  if (trafficLoops(game)) { for (let n = 0; n < missing; n++) comeBack(game, null); return; }
  // On a stage: spread evenly between just ahead of you and the finish.
  const from = you + 500, to = (game.levelData.width - 12) * TILE;
  for (let i = 0; i < missing; i++) {
    const x = to > from ? from + (to - from) * (i + 0.5) / missing : from + 300 * i;
    addFoe(game, x);
  }
}

function addRival(game, x, look = enemyLook(game.look, game.random)) {
  const end = (game.levelData.width - 4) * TILE;
  if (x < 4 * TILE || x > end) return null;
  const e = game.battle.addRacer(look, x);
  if (e) { e.skill = 0.9 + game.random() * 0.2; matchTruck(game, e); }
  return e;
}

function addFoe(game, x, kind) {
  const end = (game.levelData.width - 4) * TILE;
  if (x < 4 * TILE || x > end) return null;
  const kinds = ['basher', 'speeder', 'heavy', 'gunner'];
  const e = game.battle.addEnemy(kind || kinds[Math.floor(game.random() * kinds.length)], x);
  if (e) matchTruck(game, e);
  return e;
}

/** How long (steps) a car can be out of sight before it comes back, when the cars loop. */
export const AWAY_FOR = 140;

/**
 * Bring a car back just out of view: an enemy ahead of you (it comes at you again), a rival on the
 * side it didn't leave by (so it passes you again). `e` null adds a new enemy. On a short track
 * with no room out of view, it comes back at the far end instead.
 */
export function comeBack(game, e) {
  const b = game.battle, left = game.camX, right = game.camX + game.viewW * game.zoom;
  const rival = !!e?.racer;
  const ahead = rival ? e.centre[0] < left : true;
  const spots = ahead ? [right + 220, right + 520, left - 220] : [left - 220, left - 520, right + 220];
  const end = (game.levelData.width - 5) * TILE;
  spots.push(ahead ? end : 5 * TILE);
  if (e) {
    const list = rival ? b.racers : b.enemies;
    list.splice(list.indexOf(e), 1);
  }
  for (const x of spots) {
    const busy = b.bots.some((o) => !o.wreck && Math.abs(o.centre[0] - x) < 150);
    if (busy) continue;
    const back = rival ? addRival(game, x, e.look) : addFoe(game, x, e?.kind);
    if (back) return back;
  }
  return null;
}

/** Each step of a Sandbox run: on looping tracks, cars out of sight for a while come back. */
export function stepTraffic(game) {
  const b = game.battle;
  if (!b || !trafficLoops(game)) return;
  for (const e of b.bots.slice()) {
    // (a wreck comes back as a new car once it's out of sight)
    e.away = b.onScreen(e) ? 0 : (e.away || 0) + 1;
    if (e.away > AWAY_FOR) comeBack(game, e);
  }
  // Any that fell out of the world come back too.
  if (b.steps % 35 === 0) {
    const v = (k) => sandboxValue(game.sandbox, k);
    if (b.racers.length < v('rivals') || b.enemies.length < v('enemies')) setTraffic(game, v('rivals'), v('enemies'));
  }
}
