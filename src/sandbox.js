// sandbox.js — Sandbox Mode's settings: drive power, gravity, boost, jumps, traffic and the rest.
// No DOM access (runs under Node for tests).
//
// Sandbox is any stage or stunt track with no damage and no finish line, your boost, jump and
// missiles from Battle, and the physics turned up (or down) as you like. Each setting is a list
// of choices; what's saved is which one is chosen (an index), as `funkytruck.sandbox`. They can be
// changed on the Sandbox screen before a run, and from the pause menu's Tweaks during one.

import { BATTLE } from './battle.js';

/**
 * The settings: key, name, the choices [value, label], the default choice, and `live` false for
 * those only set before a run (the track).
 */
export const SANDBOX_ROWS = [
  { key: 'track', name: 'Track', choices: [], dflt: 0, live: false }, // filled in by the game (stages and stunt tracks)
  { key: 'power', name: 'Drive Power', choices: [[0.5, '×½'], [1, '×1'], [1.5, '×1.5'], [2, '×2'], [3, '×3'], [5, '×5']], dflt: 1 },
  { key: 'gravity', name: 'Gravity', choices: [[0, 'None'], [0.17, 'Moon'], [0.5, 'Low'], [1, 'Earth'], [1.6, 'High'], [2.5, 'Jupiter']], dflt: 3 },
  { key: 'spin', name: 'Air Spin', choices: [[0.5, '×½'], [1, '×1'], [2, '×2'], [4, '×4']], dflt: 1 },
  { key: 'springs', name: 'Suspension', choices: [[0.03, 'Floppy'], [0.1, 'Normal'], [0.25, 'Stiff'], [0.7, 'Rigid']], dflt: 1 },
  { key: 'boostPower', name: 'Boost Power', choices: [[0.5, '×½'], [1, '×1'], [2, '×2'], [4, '×4'], [8, '×8']], dflt: 1 },
  { key: 'boost', name: 'Boost', choices: [[false, 'Normal'], [true, 'Unlimited']], dflt: 1 },
  { key: 'jump', name: 'Jump Power', choices: [[0.5, '×½'], [1, '×1'], [2, '×2'], [3, '×3'], [5, '×5']], dflt: 1 },
  { key: 'ammo', name: 'Jumps & Missiles', choices: [[false, 'Normal'], [true, 'Unlimited']], dflt: 1 },
  { key: 'airJumps', name: 'Air Jumps', choices: [[false, 'Off'], [true, 'On']], dflt: 0 },
  { key: 'traffic', name: 'Traffic', choices: [0, 1, 2, 3, 4, 6, 8].map((n) => [n, n ? `${n} truck${n > 1 ? 's' : ''}` : 'None']), dflt: 3 },
  { key: 'slow', name: 'Slow Motion', choices: [[1, 'Off'], [0.5, 'Half'], [0.25, 'Quarter']], dflt: 0 },
];
export const SANDBOX_ROW = Object.fromEntries(SANDBOX_ROWS.map((r) => [r.key, r]));

/** The default settings: { key: choice index }. */
export function defaultSandbox() { return Object.fromEntries(SANDBOX_ROWS.map((r) => [r.key, r.dflt])); }

/** Saved settings, checked: anything missing or out of range goes back to its default. */
export function validSandbox(v, tracks = 12) {
  const s = defaultSandbox();
  if (!v || typeof v !== 'object') return s;
  for (const r of SANDBOX_ROWS) {
    const n = r.key === 'track' ? tracks : r.choices.length;
    if (Number.isInteger(v[r.key]) && v[r.key] >= 0 && v[r.key] < n) s[r.key] = v[r.key];
  }
  return s;
}

/** The chosen value of setting `key`. */
export const sandboxValue = (settings, key) => SANDBOX_ROW[key].choices[settings[key]]?.[0];

/**
 * Put the settings into the game: your truck's power, gravity, spin and springs, the weapons'
 * tuning, and the traffic (trucks added or taken away to match).
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
  Object.assign(b.tune, {
    boostPush: BATTLE.boost.push * v('boostPower'),
    jump: BATTLE.jump * v('jump'),
    unlimitedBoost: v('boost'),
    unlimited: v('ammo'),
    airJumps: v('airJumps'),
    fireCooldown: v('ammo') ? 9 : BATTLE.fireCooldown,
  });
  for (const e of b.racers) { e.truck.springK = t.springK; e.truck.tiltPower = t.tiltPower; }
  const want = v('traffic');
  while (b.racers.length > want) b.racers.pop();
  if (b.racers.length < want) game.addTraffic(want - b.racers.length);
}
