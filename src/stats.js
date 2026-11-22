// stats.js — the High Scores screen's records and totals, kept across runs. No DOM access (runs
// under Node for tests).
//
// The game counts into a plain object of numbers (see emptyStats) and saves it through its store
// now and then (Game.saveStats). Anything read back is checked: a field that isn't a sensible
// number starts again from 0.

/** Records (the most in one go) and totals. Times are in 1/70 s steps, distances in metres. */
export const STAT_KEYS = [
  'maxAir', 'topSpeed', 'mostFlips', 'longestWheelie', 'bestChain', 'longestChain',
  'distance', 'driveSteps', 'runs', 'stages', 'wrecks', 'selfWrecks', 'bails', 'endlessMetres', 'takedowns',
];

/** The tricks counted one by one (by kind: no counts or airtimes in the name). */
export const TRICK_KINDS = ['Backflip', 'Frontflip', 'Big Air', 'Huge Air', 'Wheelie', 'Nose Wheelie', 'Clean'];

export function emptyStats() {
  const s = Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
  s.tricks = Object.fromEntries(TRICK_KINDS.map((k) => [k, 0]));
  s.backflips = 0;  // turns, not tricks: a Double Backflip adds 2
  s.frontflips = 0;
  return s;
}

const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e12;

/** Saved stats, checked; anything missing or wrong starts from 0. */
export function validStats(v) {
  const s = emptyStats();
  if (!v || typeof v !== 'object') return s;
  for (const k of [...STAT_KEYS, 'backflips', 'frontflips']) if (ok(v[k])) s[k] = v[k];
  if (v.tricks && typeof v.tricks === 'object') for (const k of TRICK_KINDS) if (ok(v.tricks[k])) s.tricks[k] = v.tricks[k];
  return s;
}

/** Count a trick (as TrickTracker.onTrick hears it) into the stats. */
export function countTrick(s, kind, info = {}) {
  if (kind in s.tricks) s.tricks[kind]++;
  if (kind === 'Backflip') s.backflips += info.turns || 1;
  if (kind === 'Frontflip') s.frontflips += info.turns || 1;
  if (info.turns) s.mostFlips = Math.max(s.mostFlips, info.turns);
  if (kind.endsWith('Wheelie') && info.steps) s.longestWheelie = Math.max(s.longestWheelie, info.steps);
}

/** Count a trick chain's payout into the stats. */
export function countChain(s, points, tricks, bailed) {
  if (bailed) s.bails++;
  s.bestChain = Math.max(s.bestChain, points);
  s.longestChain = Math.max(s.longestChain, tricks);
}
