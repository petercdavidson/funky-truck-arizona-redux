// path-worker.js — the Stage Editor's path search, in a background thread so the page never stalls
// while a long path is laid (editor/index.html sends it work; it falls back to doing it itself if
// this can't start). It builds its own kit from the stages, the tile art and the sheet's sets.
//   { op: 'init', rules }                         the look pass's rules (the game's and the browser's)
//   { op: 'lay', seq, level, line, opts }   ->   { op: 'laid', seq, r }   (drawPath's result, or null)
//   { op: 'look', seq }                     ->   { op: 'looked', seq, tiles }   (the look pass on a lay
//                                                  made with look: false; null if it's been forgotten)
import { TILE } from '../src/game.js';
import { buildKit, drawPath, lookPath } from '../src/autotile.js';
import { TILE_EDGES } from '../src/tile-art.js';
import { TILE_SETS } from '../src/tile-sets.js';

let kit = null, rules = null;
const ready = fetch(new URL('../assets/levels.json', import.meta.url)).then((r) => r.json()).then((d) => d);
const kept = new Map();   // seq -> a lay made without the look pass, for 'look' (the last few)

self.onmessage = async (e) => {
  const m = e.data;
  if (m.op === 'init') { rules = m.rules || null; if (kit) kit.rules = rules; return; }
  if (!kit) {
    const d = await ready;
    kit ||= buildKit(d.collision, d.levels, TILE, { edges: TILE_EDGES, sets: TILE_SETS, rules });
  }
  if (m.op === 'lay') {
    let r = null;
    try { r = drawPath(m.level, m.line, kit, m.opts); } catch { r = null; }
    if (r && m.opts.look === false) { kept.set(m.seq, r); while (kept.size > 6) kept.delete(kept.keys().next().value); }
    self.postMessage({ op: 'laid', seq: m.seq, r });
  } else if (m.op === 'look') {
    const r = kept.get(m.seq);
    kept.delete(m.seq);
    if (r) lookPath(r, kit);
    self.postMessage({ op: 'looked', seq: m.seq, tiles: r ? r.tiles : null });
  }
};
