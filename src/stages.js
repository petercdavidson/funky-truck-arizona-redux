// stages.js — custom stages: the levels people make in the Stage Editor (editor/) and play from
// the Stage Editor screen. No DOM access (runs under Node for tests).
//
// This file is the contract between the editor and the game. A stage is
//   { name, width, height, start: [x, y], tiles: [[id, ...], ...], finish?: x }
// in the same units as the game's levels: `tiles` is `height` rows of `width` tile ids (0 sky,
// 1 solid dirt, the rest pieces of ground), `start` is where the truck drops in (px; tiles are
// 64 px), and `finish`, if there is one, is the x (px) of the finish line: the stage is complete
// when the truck gets past it. With no finish the stage goes on until you quit, like a stunt
// track. The editor's own extras (its Path tool's `path`) are ignored.
//
// Stages the editor saves into the game are kept in localStorage as `funkytruck.stages`: a list
// of stages, each with `saved` (a time in ms). Stages loaded from a file are added to that list.

const TILE = 64;
export const MAX_STAGES = 40;          // the most kept in the game's storage
export const MAX_TILES = 4e6;          // width x height
const MAX_NAME = 40;

/** A stage, checked: a clean copy, or null if it isn't one. `tileCount` is how many tile ids there are. */
export function validStage(v, tileCount) {
  if (!v || typeof v !== 'object') return null;
  const { tiles, start } = v;
  if (!Array.isArray(tiles) || !tiles.length || !Array.isArray(tiles[0])) return null;
  const h = tiles.length, w = tiles[0].length;
  if (!w || w * h > MAX_TILES) return null;
  if (!tiles.every((row) => Array.isArray(row) && row.length === w && row.every((id) => Number.isInteger(id) && id >= 0 && id < tileCount))) return null;
  const s = Array.isArray(start) && start.length === 2 && start.every(Number.isFinite)
    ? [Math.min(Math.max(start[0], TILE / 2), w * TILE - TILE / 2), Math.min(Math.max(start[1], 0), h * TILE)]
    : [3 * TILE, 3 * TILE];
  const stage = {
    name: (typeof v.name === 'string' && v.name.trim() ? v.name.trim() : 'My Stage').slice(0, MAX_NAME),
    width: w, height: h, start: s, tiles: tiles.map((row) => row.slice()),
  };
  if (Number.isFinite(v.finish) && v.finish > 0 && v.finish < w * TILE) stage.finish = v.finish;
  if (Number.isFinite(v.saved)) stage.saved = v.saved;
  return stage;
}

/** The saved list of stages, checked (anything that isn't a stage is left out). */
export function validStages(v, tileCount) {
  if (!Array.isArray(v)) return [];
  return v.map((s) => validStage(s, tileCount)).filter(Boolean).slice(0, MAX_STAGES);
}

/**
 * Add `stage` to `list` (a copy is returned): it replaces one of the same name, otherwise it goes
 * first; the oldest go once there are more than MAX_STAGES. Returns { list, index }.
 */
export function addStage(list, stage, now = Date.now()) {
  const s = { ...stage, saved: now };
  const rest = list.filter((o) => o.name !== s.name);
  const out = [s, ...rest].slice(0, MAX_STAGES);
  return { list: out, index: 0 };
}

/**
 * Where the ground is at x (px): the highest collision line over x in the first column tile that
 * isn't sky (`table` is the collision table), or that tile's top if it has none there. Null if the
 * column is all sky.
 */
export function groundTop(stage, x, table = null) {
  const col = Math.floor(x / TILE);
  if (col < 0 || col >= stage.width) return null;
  for (let r = 0; r < stage.height; r++) {
    const id = stage.tiles[r][col];
    if (id === 0) continue;
    const d = table?.[id] || [], lx = x - col * TILE;
    let best = null;
    for (let i = 0; i < d.length; i += 5) {
      const [x1, y1, x2, y2] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
      if (lx < Math.min(x1, x2) || lx > Math.max(x1, x2) || x1 === x2) continue;
      const y = y1 + (y2 - y1) * (lx - x1) / (x2 - x1);
      if (best === null || y < best) best = y;
    }
    if (best !== null) return r * TILE + best;
    if (!d.length) return r * TILE; // solid dirt or a fill tile with no line: its top
  }
  return null;
}
