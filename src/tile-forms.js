// tile-forms.js — tiles turned and flipped: the Stage Editor's walls, ceilings and overhangs, made
// from the tile sheet's own tiles. No DOM access (runs under Node for tests).
//
// A tile id is `base + 256 * form`: `base` is a tile in the sheet (0 to 229) and `form` (0 to 7)
// how it is turned: optionally flipped upside down, then turned a quarter clockwise `form & 3`
// times (`form & 4` is the flip). Form 0 is the tile as it is, so the stages' ids are unchanged.
// The art and the collision lines are turned the same way, about the tile's centre. The editor
// only makes turned tiles (makeId: forms 1 to 3), except for the kickers, which have no mirror
// tile; any form can be read and drawn.
//
// Left-right mirrors use the sheet's own mirrored tiles where there is one (MIRROR_PAIRS: the art
// differs a little on purpose), so a tile turned and mirrored stays drawn from real art.

export const FORMS = 8;
export const FORM_STEP = 256;
/** The highest id a tile can have, plus one. */
export const MAX_TILE_ID = FORMS * FORM_STEP;

/**
 * Tiles that are each other's left-right mirror image (in what they do: the art differs a little on
 * purpose). Found from the collision lines (each pair's lines mirror within a pixel or two; tested)
 * and from the tile sheet, which lays mirrored tiles out in mirrored rows. 41 to 55 (the kickers)
 * have none. Tiles not listed (sky, plain dirt, the flat piece 2) are their own mirror.
 */
export const MIRROR_PAIRS = [
  [4, 24], [5, 25], [6, 26], [10, 20], [11, 21], [12, 22], [13, 23], [14, 34], [15, 35], [16, 36],
  [60, 63], [61, 62], [64, 67], [65, 66], [70, 73], [71, 72], [74, 77], [75, 76],
  [80, 83], [81, 82], [84, 87], [85, 86], [90, 93], [91, 92], [94, 97], [95, 96],
  [100, 103], [101, 102], [104, 107], [105, 106],
  [110, 117], [111, 116], [112, 115], [113, 114], [120, 127], [121, 126], [122, 125], [123, 124],
  [130, 135], [131, 134], [132, 133], [140, 145], [141, 144], [142, 143],
  [150, 153], [151, 152], [154, 155], [160, 163], [161, 162], [164, 165],
  [170, 183], [171, 182], [172, 181], [173, 180], [174, 186], [175, 185], [176, 184], [177, 188], [178, 187], [179, 189],
  [190, 213], [191, 212], [192, 211], [193, 210], [194, 216], [195, 215], [196, 214], [197, 218], [198, 217], [199, 219],
  [200, 223], [201, 222], [202, 221], [203, 220], [204, 226], [205, 225], [206, 224], [207, 228], [208, 227], [209, 229],
];
/** Tiles with no mirror (the kickers): mirroring one flips its art instead. */
export const NO_MIRROR = new Set([41, 43, 45, 50, 51, 52, 53, 54, 55]);
const mirrors = new Map(MIRROR_PAIRS.flatMap(([a, b]) => [[a, b], [b, a]]));
/** A sheet tile's left-right mirror (itself when it has none, or is symmetric). */
export const mirrorOf = (id) => mirrors.get(id) ?? id;

export const baseOf = (id) => id % FORM_STEP;
export const formOf = (id) => Math.floor(id / FORM_STEP);

/** Whether `id` is a tile: a sheet tile (below `count`) in one of the forms. */
export function isTileId(id, count) {
  return Number.isInteger(id) && id >= 0 && id < MAX_TILE_ID && baseOf(id) < count;
}

// A form as a 2x2 matrix [a, b, c, d] taking (u, v) (from the tile's centre, y down) to
// (a u + b v, c u + d v).
const FLIP = [1, 0, 0, -1], TURN = [0, -1, 1, 0];     // upside down; a quarter turn clockwise
const mul = (p, q) => [p[0] * q[0] + p[1] * q[2], p[0] * q[1] + p[1] * q[3], p[2] * q[0] + p[3] * q[2], p[2] * q[1] + p[3] * q[3]];
const MATRICES = Array.from({ length: FORMS }, (_, f) => {
  let m = f & 4 ? FLIP : [1, 0, 0, 1];
  for (let i = 0; i < (f & 3); i++) m = mul(TURN, m);
  return m;
});
const formFrom = (m) => MATRICES.findIndex((q) => q.every((v, i) => v === m[i]));
/** Form f's matrix [a, b, c, d]. */
export const formMatrix = (f) => MATRICES[f].slice();
const MIRROR = [-1, 0, 0, 1];

/**
 * The id of `base` in `form`. Only turns are used: a flipped form is the sheet's mirror tile turned
 * instead (upside down is the mirror tile turned half round), so every tile is drawn from the
 * sheet's own art, only turned. The kickers have no mirror tile, so theirs are flipped. Sky (0) and
 * plain dirt (1) look the same every way round, so they stay as they are.
 */
export function makeId(base, form) {
  if (base <= 1) return base;
  if (form & 4 && !NO_MIRROR.has(base)) { form = formFrom(mul(MATRICES[form], MIRROR)); base = mirrorOf(base); }
  return base + FORM_STEP * form;
}

/** The tile turned a quarter clockwise (or anticlockwise). */
export function turnId(id, clockwise = true) {
  const t = clockwise ? TURN : mul(TURN, mul(TURN, TURN));
  return makeId(baseOf(id), formFrom(mul(t, MATRICES[formOf(id)])));
}
/** The tile turned upside down (flipped top to bottom where it stands). */
export function flipUpId(id) {
  return makeId(baseOf(id), formFrom(mul(FLIP, MATRICES[formOf(id)])));
}
/**
 * The tile mirrored left to right where it stands: the sheet's mirrored tile, turned to match,
 * where there is one; a kicker's own art flipped otherwise.
 */
export function mirrorId(id) {
  const base = baseOf(id), m = MATRICES[formOf(id)];
  if (NO_MIRROR.has(base)) return makeId(base, formFrom(mul(MIRROR, m)));
  return makeId(mirrorOf(base), formFrom(mul(MIRROR, mul(m, MIRROR))));
}

/** Tiles (rows of ids) flipped left to right, each tile swapped for its mirror. */
export function flipTiles(rows) {
  return rows.map((r) => r.slice().reverse().map(mirrorId));
}
/** Tiles flipped top to bottom, each tile turned upside down. */
export function flipTilesUp(rows) {
  return rows.slice().reverse().map((r) => r.map(flipUpId));
}
/** Tiles turned a quarter (clockwise or not): the rows become columns. */
export function turnTiles(rows, clockwise = true) {
  const h = rows.length, w = rows[0].length;
  return Array.from({ length: w }, (_, y) => Array.from({ length: h }, (_, x) =>
    turnId(clockwise ? rows[h - 1 - x][y] : rows[x][w - 1 - y], clockwise)));
}

/** A pixel coordinate in a 64 px tile (0 to 63) moved by form f: [x, y]. */
export function formPoint(f, x, y) {
  const [a, b, c, d] = MATRICES[f], u = x - 31.5, v = y - 31.5;
  return [a * u + b * v + 31.5, c * u + d * v + 31.5];
}

/**
 * A tile's collision lines (x1, y1, x2, y2, type, ...) turned by form f. The ends swap when the
 * form is a flip, so each line's ground stays on the same side of it (the side its normal points
 * away from).
 */
export function formCollision(lines, f) {
  if (!f || !lines?.length) return lines || [];
  const flip = (f & 4) !== 0, out = [];
  for (let i = 0; i < lines.length; i += 5) {
    const [x1, y1] = formPoint(f, lines[i], lines[i + 1]), [x2, y2] = formPoint(f, lines[i + 2], lines[i + 3]);
    if (flip) out.push(x2, y2, x1, y1, lines[i + 4]); else out.push(x1, y1, x2, y2, lines[i + 4]);
  }
  return out;
}

/**
 * The collision table with entries for the turned tiles a level uses (the table itself when it
 * uses none). `table[id]` is a tile's lines, as in levels.json.
 */
export function formTable(table, level) {
  let out = table;
  for (const row of level.tiles) for (const id of row) {
    if (id < FORM_STEP || out[id]) continue;
    if (out === table) out = table.slice();
    out[id] = formCollision(table[baseOf(id)], formOf(id));
  }
  return out;
}

/** A short label for a tile: its sheet number, and an arrow for where its top now points (↕ when upside down). */
export function tileLabel(id) {
  const f = formOf(id);
  return `${baseOf(id)}${['', '→', '↓', '←', '↕', '↕←', '↕↑', '↕→'][f]}`;
}
