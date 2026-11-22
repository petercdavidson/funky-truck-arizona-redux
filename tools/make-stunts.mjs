// make-stunts.mjs — builds the Practice stunt tracks into assets/stunts.json.
//
//   node tools/make-stunts.mjs
//
// Each track is drawn as a target height for every column (the ground's top row: smaller is
// higher). The track is then built only from column shapes and joins that the original nine stages
// use (the same grammar Endless Mode learns, src/endless.js), so every seam is one the original
// artist drew. A Viterbi search picks, column by column, the shapes and heights that follow the
// target most closely.

import { readFileSync, writeFileSync } from 'node:fs';
import { buildGrammar } from '../src/endless.js';

const root = new URL('../', import.meta.url);
const data = JSON.parse(readFileSync(new URL('assets/levels.json', root)));
const g = buildGrammar(data.levels);
const DEPTH = 8, FILL = 1, SKY = 0;
const HEIGHT = 150;      // rows in each track
const FINISH = 9;        // columns past the finish line, as in the stages

/** A target profile from a start height and [columns, height to reach] pieces, straight between. */
function profile(start, pieces) {
  const out = [];
  let y = start;
  for (const [len, to] of pieces) {
    for (let i = 1; i <= len; i++) out.push(y + (to - y) * i / len);
    y = to;
  }
  return out;
}

/** The stages' standard flat ground: the shape that most often carries on as itself, level. */
function flatShape() {
  let best = -1, most = 0;
  for (const [key, opts] of g.joins[0]) {
    for (const j of opts) if (String(j.to) === key && j.step === 0 && j.count > most) { most = j.count; best = j.to; }
  }
  return best;
}

/** Follow `target` as closely as the joins allow. Returns [{ s, top }] per column. */
function build(target) {
  const n = target.length, rows = HEIGHT - DEPTH - 2;
  const S = g.shapes.length;
  const idx = (s, top) => s * rows + top;
  let cost = new Float64Array(S * rows).fill(Infinity);
  const back = [];
  const s0 = flatShape(), t0 = Math.round(target[0]);
  cost[idx(s0, t0)] = 0;
  for (let c = 1; c < n; c++) {
    const next = new Float64Array(S * rows).fill(Infinity);
    const from = new Int32Array(S * rows).fill(-1);
    for (let s = 0; s < S; s++) {
      const opts = g.joins[0].get(String(s));
      if (!opts) continue;
      for (let top = 2; top < rows; top++) {
        const k = cost[idx(s, top)];
        if (k === Infinity) continue;
        for (const j of opts) {
          const t = top + j.step;
          if (t < 2 || t >= rows) continue;
          // stay close to the target; a little preference for joins the stages use often
          const d = t - target[c];
          const v = k + d * d + 0.3 / Math.sqrt(j.count);
          const i = idx(j.to, t);
          if (v < next[i]) { next[i] = v; from[i] = idx(s, top); }
        }
      }
    }
    cost = next; back.push(from);
  }
  let best = 0;
  for (let i = 1; i < cost.length; i++) if (cost[i] < cost[best]) best = i;
  const path = [];
  for (let c = n - 1, i = best; c >= 0; c--) {
    path.push({ s: Math.floor(i / rows), top: i % rows });
    if (c > 0) i = back[c - 1][i];
  }
  return path.reverse();
}

function level(name, target) {
  const path = build(target);
  const width = path.length;
  const tiles = Array.from({ length: HEIGHT }, () => []);
  for (const { s, top } of path) {
    for (let r = 0; r < HEIGHT; r++) tiles[r].push(r < top ? SKY : r - top < DEPTH ? g.shapes[s][r - top] : FILL);
  }
  const off = path.map((p, c) => Math.abs(p.top - target[c]));
  console.log(`${name}: ${width} columns, ground within ${Math.max(...off).toFixed(1)} rows of the design (average ${(off.reduce((a, b) => a + b) / width).toFixed(2)})`);
  return { name, width, height: HEIGHT, tiles, start: [3 * 64, (path[3].top - 3) * 64] };
}

const flat = (len) => [len, null];
/** Pieces with `null` heights stay level. */
function tidy(start, pieces) {
  let y = start;
  return profile(start, pieces.map(([len, to]) => { y = to ?? y; return [len, y]; }));
}

const stunts = [
  // One giant run-in to one giant kicker; the ground falls away under the flight for a long way,
  // so the truck comes down on a slope going its way.
  level('Mega Ramp', tidy(12, [
    flat(8), [44, 78], flat(3), [3, 72], [40, 100], [80, 132], [20, 136], flat(10 + FINISH),
  ])),
  // A long descent broken by kickers: launch, land on the downslope, go again.
  level('Kicker Run', tidy(10, [
    flat(6),
    ...Array.from({ length: 18 }, (_, i) => {
      const at = 10 + Math.floor(i / 3) * 15, part = i % 3;
      return part === 0 ? [9, at + 12] : part === 1 ? [2, at + 9] : [5, at + 15];
    }),
    flat(12 + FINISH),
  ])),
  // A long run-in to a steep quarter-pipe lip that throws the truck nearly straight up, still
  // going forwards; beyond the lip the ground falls away to a long landing slope. Big hang time
  // for flips. (The stages' joins allow steep climbs but not steep drops, so the drops are long.)
  level('Sky Launch', tidy(14, [
    flat(6), [40, 84], flat(3), [3, 76], [6, 68], [30, 96], [40, 120], flat(10 + FINISH),
  ])),
];

writeFileSync(new URL('assets/stunts.json', root), JSON.stringify(stunts));
console.log('wrote assets/stunts.json');
