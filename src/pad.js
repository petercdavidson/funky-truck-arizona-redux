// pad.js — the gamepad's buttons for each action while driving, which the player can change on
// the Controller screen (Options). No DOM access. Saved as `funkytruck.padMap`: { action: [button
// index, ...] }. Indices are the browser's standard gamepad layout. The menus always use the
// stick or d-pad, A and B, whatever's set here.

/** [action, name, default buttons]. */
export const PAD_ACTIONS = [
  ['gas', 'Drive', [0, 7]],
  ['brake', 'Reverse', [1, 6]],
  ['top', 'Jump, or flip upright', [3]],
  ['jump', 'Jump', [4]],
  ['fire', 'Fire a missile', [2]],
  ['boost', 'Boost (hold)', [5]],
  ['wreck', 'Wreck the truck', [11]],
  ['pause', 'Pause', [9]],
];

/** The standard layout's buttons, by index (Xbox names; on other pads, the same places). */
export const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'Left Stick', 'Right Stick',
  'D-pad Up', 'D-pad Down', 'D-pad Left', 'D-pad Right', 'Home'];
export const padName = (i) => PAD_NAMES[i] ?? `Button ${i}`;

export function defaultPadMap() { return Object.fromEntries(PAD_ACTIONS.map(([a, , b]) => [a, b.slice()])); }

/** A saved map, checked: anything missing or not a list of small whole numbers is the default. */
export function validPadMap(v) {
  const m = defaultPadMap();
  if (!v || typeof v !== 'object') return m;
  for (const [a] of PAD_ACTIONS) {
    const b = v[a];
    if (Array.isArray(b) && b.length && b.length <= 4 && b.every((i) => Number.isInteger(i) && i >= 0 && i < 32)) m[a] = b.slice();
  }
  return m;
}

/**
 * Set `action` to button `i` alone. A button does one thing: it's taken off any other action
 * that had it (an action left with none goes back to its default, unless that's `i` too).
 */
export function assignPad(map, action, i) {
  const m = { ...map };
  m[action] = [i];
  for (const [a, , dflt] of PAD_ACTIONS) {
    if (a === action || !m[a].includes(i)) continue;
    m[a] = m[a].filter((b) => b !== i);
    if (!m[a].length) m[a] = dflt.filter((b) => b !== i && !Object.values(m).some((l) => l.includes(b)));
  }
  return m;
}
