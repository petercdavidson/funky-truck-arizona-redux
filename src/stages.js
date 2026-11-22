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

import { isTileId } from './tile-forms.js';

const TILE = 64;
export const MAX_STAGES = 40;          // the most kept in the game's storage
export const MAX_TILES = 4e6;          // width x height
const MAX_NAME = 40;

/**
 * A stage, checked: a clean copy, or null if it isn't one. `tileCount` is how many tiles the sheet
 * has; a tile may also be one of those turned or flipped (src/tile-forms.js).
 */
export function validStage(v, tileCount) {
  if (!v || typeof v !== 'object') return null;
  const { tiles, start } = v;
  if (!Array.isArray(tiles) || !tiles.length || !Array.isArray(tiles[0])) return null;
  const h = tiles.length, w = tiles[0].length;
  if (!w || w * h > MAX_TILES) return null;
  if (!tiles.every((row) => Array.isArray(row) && row.length === w && row.every((id) => isTileId(id, tileCount)))) return null;
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
