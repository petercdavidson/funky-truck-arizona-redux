// make-stunts.mjs — builds the Practice stunt tracks into assets/stunts.json.
//
//   node tools/make-stunts.mjs
//
// Each track is drawn as a target height for every column (the ground's top row: smaller is
// higher). The track is then built only from column shapes and joins that the original nine
// stages use (the same grammar Endless Mode learns, src/endless.js), so every seam is one the
// original artist drew. A Viterbi search picks, column by column, the shapes and heights that
// follow the target most closely.
//
// The stunt tracks have no finish line. A track with `loop: { from, period, drop }` goes on for
// ever: from column `from`, every `period` columns it repeats itself `drop` rows lower, and the
// game jumps the truck back a repeat (see Game.updateLoop) when it gets far enough along.
//
// This file can also be imported (tools/tune-stunts.mjs does, to try designs out): it only writes
// the JSON when run directly.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildGrammar } from '../src/endless.js';

const root = new URL('../', import.meta.url);
export const data = JSON.parse(readFileSync(new URL('assets/levels.json', root)));
const g = buildGrammar(data.levels);
const DEPTH = 8, FILL = 1, SKY = 0;

/** A target profile from a start height and [columns, height to reach] pieces, straight between. */
export function profile(start, pieces) {
  const out = [];
  let y = start;
  for (const [len, to] of pieces) {
    for (let i = 1; i <= len; i++) out.push(y + (to - y) * i / len);
    y = to;
  }
  return out;
}

/** Pieces with `null` heights stay level. */
export const flat = (len) => [len, null];
export function tidy(start, pieces) {
  let y = start;
  return profile(start, pieces.map(([len, to]) => { y = to ?? y; return [len, y]; }));
}

/** The stages' standard flat ground: the shape that most often carries on as itself, level. */
export function flatShape(grammar = g) {
  let best = -1, most = 0;
  for (const [key, opts] of grammar.joins[0]) {
    for (const j of opts) if (String(j.to) === key && j.step === 0 && j.count > most) { most = j.count; best = j.to; }
  }
  return best;
}

const joinsFrom = (grammar, s) => grammar.joins[0].get(String(s)) || [];
/** Whether shape `s` at row `top` can be followed by shape `to` at row `toTop`. */
const joins = (grammar, s, top, to, toTop) => joinsFrom(grammar, s).some((j) => j.to === to && top + j.step === toTop);

/**
 * Follow `target` as closely as the joins allow. Returns [{ s, top }] per column.
 *   start   the first column ({ s, top }); by default the flat shape at the target's height
 *   end     a column the last one must be able to join on to ({ s, top }), for loops and pieces
 *   rows    how many rows the ground may use (by default, enough for the target)
 *   bend    cost of the ground's slope changing from one column to the next (smoothness)
 *   grammar the shapes and joins to build from
 * Each column also carries its `shape` (its top tiles).
 */
export function build(target, { start, end, rows = Math.ceil(Math.max(...target)) + 40, bend = 0, grammar = g } = {}) {
  const n = target.length;
  const S = grammar.shapes.length;
  const idx = (s, top) => s * rows + top;
  let cost = new Float64Array(S * rows).fill(Infinity);
  let slope = new Float64Array(S * rows);          // the step into each state on its best path
  const back = [];
  const s0 = start ?? { s: flatShape(grammar), top: Math.round(target[0]) };
  cost[idx(s0.s, s0.top)] = 0;
  for (let c = 1; c < n; c++) {
    const next = new Float64Array(S * rows).fill(Infinity);
    const nextSlope = new Float64Array(S * rows);
    const from = new Int32Array(S * rows).fill(-1);
    // Only look near the target (the joins step at most 4 rows a column).
    const lo = Math.max(2, Math.floor(target[c]) - 30), hi = Math.min(rows - 1, Math.ceil(target[c]) + 30);
    for (let s = 0; s < S; s++) {
      const opts = joinsFrom(grammar, s);
      if (!opts.length) continue;
      for (let top = Math.max(2, lo - 4); top <= Math.min(rows - 1, hi + 4); top++) {
        const k = cost[idx(s, top)];
        if (k === Infinity) continue;
        for (const j of opts) {
          const t = top + j.step;
          if (t < lo || t > hi) continue;
          // stay close to the target; a little preference for joins the stages use often
          const d = t - target[c], b = j.step - slope[idx(s, top)];
          const v = k + d * d + 0.3 / Math.sqrt(j.count) + bend * b * b;
          const i = idx(j.to, t);
          if (v < next[i]) { next[i] = v; from[i] = idx(s, top); nextSlope[i] = j.step; }
        }
      }
    }
    cost = next; slope = nextSlope; back.push(from);
  }
  let best = -1;
  for (let i = 0; i < cost.length; i++) {
    if (cost[i] === Infinity) continue;
    if (end && !joins(grammar, Math.floor(i / rows), i % rows, end.s, end.top)) continue;
    if (best < 0 || cost[i] < cost[best]) best = i;
  }
  if (best < 0) return null;
  const path = [];
  for (let c = n - 1, i = best; c >= 0; c--) {
    const sh = Math.floor(i / rows);
    path.push({ s: sh, top: i % rows, shape: grammar.shapes[sh] });
    if (c > 0) i = back[c - 1][i];
  }
  path.reverse();
  path.cost = cost[best];
  return path;
}

/**
 * One repeat of a loop: `target` (a column per column of the repeat) is followed, starting from
 * some column A and ending on a column that joins on to A again, `drop` rows lower. Tries every
 * shape for A and keeps the closest fit.
 */
export function buildLoop(target, drop) {
  let best = null;
  for (let s = 0; s < g.shapes.length; s++) {
    if (!g.alive[s]) continue;
    const top = Math.round(target[0]);
    const p = build(target, { start: { s, top }, end: { s, top: top + drop } });
    if (p && (!best || p.cost < best.cost)) best = p;
  }
  return best;
}

/** The track as stored: a column of tiles per path entry, and the truck's starting point. */
export function makeLevel(name, path, { startCol = 3, loop = null, target = null, lipCol = null } = {}) {
  const width = path.length;
  const height = Math.max(...path.map((p) => p.top)) + DEPTH + 4;
  const tiles = Array.from({ length: height }, () => []);
  for (const { top, shape } of path) {
    for (let r = 0; r < height; r++) tiles[r].push(r < top ? SKY : r - top < DEPTH ? shape[r - top] : FILL);
  }
  if (target && process.argv[1] === fileURLToPath(import.meta.url)) {
    const off = path.map((p, c) => Math.abs(p.top - target[c]));
    console.log(`${name}: ${width} columns, ground within ${Math.max(...off).toFixed(1)} rows of the design (average ${(off.reduce((a, b) => a + b) / width).toFixed(2)})`);
  }
  const level = { name, width, height, tiles, start: [startCol * 64, (path[startCol].top - 3) * 64] };
  if (loop) level.loop = loop;
  if (lipCol !== null) Object.defineProperty(level, 'lipCol', { value: lipCol }); // for tools/tune-stunts.mjs, not saved
  return level;
}

// ---------------------------------------------------------------------------------------------
// The tracks.

/**
 * Kicker Run: a bumpy downhill for ever. A short flat start, then a repeat of three kickers
 * (launch, land on the downslope, go again) that drops REPEAT_DROP rows every REPEAT columns.
 */
// Tuned by simulation for a good pace without running away: the physics has no air drag, so too
// steep a slope (or kickers too small to scrub off speed) speeds up without end.
export const KICKER = { repeat: 48, kickers: 4, drop: 18, kick: 2, kickLen: 2 };
export function kickerRun(k = KICKER) {
  const LEAD = 8, TOP = 10, COPIES = 5;
  const len = k.repeat / k.kickers, per = k.drop / k.kickers;
  // one kicker: down most of the way, a short kick up, then down again to land on
  const down1 = Math.round((len - k.kickLen) * 0.6), down2 = len - k.kickLen - down1;
  const d1 = (per + k.kick) * 0.6, d2 = per + k.kick - d1;
  const kick = (at) => [[down1, at + d1], [k.kickLen, at + d1 - k.kick], [down2, at + per]];
  const t0 = TOP + 2;
  const repeat = profile(t0, Array.from({ length: k.kickers }, (_, i) => kick(t0 + i * per)).flat());
  // the repeat starts at its first column, so shift the design by one to start on t0
  const loopTarget = [t0, ...repeat.slice(0, k.repeat - 1)];
  const loop = buildLoop(loopTarget, k.drop);
  const A = loop[0];
  const lead = build(tidy(TOP, [flat(4), [LEAD - 4, A.top - 1]]), { end: A });
  const path = [...lead];
  for (let c = 0; c < COPIES; c++) for (const p of loop) path.push({ ...p, top: p.top + c * k.drop });
  return makeLevel('Kicker Run', path, { loop: { from: lead.length, period: k.repeat, drop: k.drop } });
}

/**
 * Mega Ramp: one long accelerator ramp down, a launch ramp up, and then a whole lot of ground,
 * ending in a climb too tall to get over.
 * The design's numbers were tuned by simulation (tools/tune-stunts.mjs) for the most speed and
 * air time.
 */
export const MEGA = { top: 300, drop: 180, ease: 8, bottom: 0, rise: 18, riseLen: 12, gap: 4, land: 30, landLen: 40, run: 560, wall: 70, wallLen: 30 };
export function megaRamp(m = MEGA) {
  const bottom = m.top + m.drop, lip = bottom - m.rise;
  const target = tidy(m.top, [
    flat(6),
    // the accelerator: 45° (the steepest smooth slope the stages' tiles make), easing out at the bottom
    [m.drop - m.ease / 2, bottom - m.ease / 2], ...curve(bottom - m.ease / 2, bottom, m.ease, 'out'),
    flat(m.bottom),
    // the launch ramp: curving up ever steeper to the lip
    ...curve(bottom, lip, m.riseLen, 'in'),
    // past the lip the ground falls away, then a long landing slope and a long run-out
    [m.gap, lip + 6], [m.landLen, lip + m.land], flat(m.run),
    // and at the far end a quarter pipe, curving up nearly vertical: the truck goes straight up
    // and comes back down into it. (Lots of sky above the track, `top`, so it can't fly over the
    // top of the level and past the invisible walls at its ends.)
    ...curve(lip + m.land, lip + m.land - m.wall, m.wallLen, 'in'), flat(6),
  ]);
  const path = build(target, { bend: 0.4 });
  return makeLevel('Mega Ramp', path, { target, lipCol: 6 + m.drop + m.ease / 2 + m.bottom + m.riseLen });
}

/**
 * A curve from height a to b over n columns, as pieces: 'out' starts steep and levels out (a ramp
 * down into a valley), 'in' starts level and steepens (a ramp up to a lip).
 */
function curve(a, b, n, kind) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const u = i / n, f = kind === 'out' ? Math.sin(u * Math.PI / 2) : 1 - Math.cos(u * Math.PI / 2);
    out.push([1, a + (b - a) * f]);
  }
  return out;
}

/**
 * Halfpipe: designed by hand in the level editor (tools/stunts/halfpipe.json, the editor's own
 * JSON). It is used as it is, not generated.
 */
export function halfpipe() {
  const { name, width, height, start, tiles } = JSON.parse(readFileSync(new URL('tools/stunts/halfpipe.json', root)));
  return { name, width, height, start, tiles };
}

/** A level as stored: a column at a time (see unpackLevel in src/game.js). */
export function packLevel(l) {
  const { tiles, width, ...rest } = l;
  const columns = [];
  for (let x = 0; x < width; x++) {
    let top = 0;
    while (top < l.height && tiles[top][x] === SKY) top++;
    let end = l.height;
    while (end > top && tiles[end - 1][x] === FILL) end--;
    const col = [top];
    for (let r = top; r < end; r++) col.push(tiles[r][x]);
    columns.push(col);
  }
  return { ...rest, columns };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stunts = [megaRamp(), kickerRun(), halfpipe()];
  writeFileSync(new URL('assets/stunts.json', root), JSON.stringify(stunts.map(packLevel)));
  console.log('wrote assets/stunts.json');
}
