// endless.js — Endless Mode's course generator. No DOM access (runs under Node for tests).
//
// The course is built a column of tiles at a time, using only joins that the original nine
// stages use. Every column of every stage is reduced to its top few tiles (its "shape"; below
// that is solid ground), and each place one shape sits next to another in a stage is recorded,
// with how far the ground steps up or down between them. Generating a course is a random walk
// over those recorded joins. So every seam in the course is one the original designer drew, but
// the hills, jumps and valleys come in new orders, forever.
//
// The walk is steered so it stays fun:
//   - it stays inside a vertical band, so it never climbs or falls without end;
//   - joins are weighted by the stage they came from, and the "difficulty" stage drifts from the
//     early stages towards the later ones as the player gets further;
//   - it avoids shapes that only lead to dead ends (the last column of each stage);
//   - it never climbs more than MAX_RISE tiles over RISE_SPAN columns, so there's no wall too
//     tall and steep to drive up.
//
// The course lives in a window of tiles that scrolls: when the truck is far enough along, the
// oldest columns are dropped, new ones are added, and the game moves everything left.

export const ENDLESS_WIDTH = 128;   // columns kept in the window
export const ENDLESS_HEIGHT = 48;   // rows
export const ENDLESS_SHIFT = 48;    // columns dropped (and added) each time the window moves
const DEPTH = 8;                    // tiles per column shape (below that is solid ground, tile 1)
const BAND = [14, 40];              // rows the ground's top may use
/**
 * The steepest climb allowed: at most MAX_RISE tiles up over any RISE_SPAN columns. The stages
 * have taller, steeper walls than this, but only in later stages, each with a run-up designed for
 * it; strung together at random they can make a wall nobody can drive up.
 */
export const MAX_RISE = 5;
export const RISE_SPAN = 4;
/** How many columns ahead the walk checks it can go on without a climb steeper than that. */
const LOOKAHEAD = 10;
const FILL = 1, SKY = 0;

/** Longest run of columns used as context when choosing the next one (see pick()). */
const ORDER = 3;

/**
 * Learn the shapes and joins from the stages in levels.json.
 * joins[n - 1] maps a context (the last n columns: their shapes and steps between them) to the
 * columns that followed it somewhere in the stages. `back` is the same read right to left (the
 * columns that came before each context), for the course's leftward end: { joins, alive, safe }.
 */
export function buildGrammar(levels, { keepDeep = false } = {}) {
  const shapes = [];            // index -> array of DEPTH tile ids
  const index = new Map();      // shape key -> index
  const id = (shape) => {
    const k = shape.join('.');
    if (!index.has(k)) { index.set(k, shapes.length); shapes.push(shape); }
    return index.get(k);
  };
  // Each stage's columns as runs of { s, top, stage } (broken where a column can't be used).
  const runs = [];
  levels.forEach((l, stage) => {
    // Leave out the walls at each end of a stage (the first column, and everything past the
    // finish line) and any column with no ground at all.
    let run = [];
    for (let x = 1; x < l.width - 9; x++) {
      let top = 0;
      while (top < l.height && l.tiles[top][x] === SKY) top++;
      // Skip columns with more than solid ground below their shape (caves, the floating bottom
      // edge of some stages): the course fills below every shape with solid ground. With
      // `keepDeep` (the stunt tracks' builder) keep them, filling below the shape all the same:
      // Stage Six's smooth 63° drop and climb are among them.
      let deep = false;
      for (let r = top + DEPTH; r < l.height && !deep && !keepDeep; r++) deep = l.tiles[r][x] !== FILL;
      if (top >= l.height - 1 || deep) { if (run.length) runs.push(run); run = []; continue; }
      const shape = [];
      for (let r = top; r < top + DEPTH; r++) shape.push(r < l.height ? l.tiles[r][x] : FILL);
      run.push({ s: id(shape), top, stage });
    }
    if (run.length) runs.push(run);
  });
  const learn = (seqs) => {
    const joins = Array.from({ length: ORDER }, () => new Map());
    for (const seq of seqs) {
      for (let i = 1; i < seq.length; i++) {
        const c = seq[i], prev = seq.slice(0, i);
        for (let n = 1; n <= ORDER && n <= prev.length; n++) {
          const key = contextKey(prev.slice(-n));
          const m = joins[n - 1];
          const step = c.top - prev[prev.length - 1].top;
          if (!m.has(key)) m.set(key, new Map());
          const opts = m.get(key), k = `${c.s},${step}`;
          if (!opts.has(k)) opts.set(k, { to: c.s, step, count: 0, stages: new Set() });
          const j = opts.get(k);
          j.count++; j.stages.add(c.stage);
        }
      }
    }
    const out = joins.map((m) => new Map([...m].map(([k, opts]) => [k, [...opts.values()].map((j) => ({ ...j, stages: [...j.stages] }))])));
    const alive = shapes.map((_, i) => out[0].has(contextKey([{ s: i, top: 0 }])));
    // safe[s][top - BAND[0]]: from shape s at that height, the walk can keep going for a long way
    // without leaving the band. Some stretches (a long drop into a valley) only go one way, so
    // the walk must not start down one unless there is room for all of it.
    const rows = BAND[1] - BAND[0] + 1;
    let safe = shapes.map(() => new Array(rows).fill(true));
    for (let k = 0; k < 40; k++) {
      safe = shapes.map((_, i) => {
        const opts = out[0].get(contextKey([{ s: i, top: 0 }])) || [];
        return Array.from({ length: rows }, (_, r) => opts.some((j) => {
          const t = r + j.step;
          return t >= 0 && t < rows && safe[j.to][t];
        }));
      });
    }
    return { joins: out, alive, safe };
  };
  const ahead = learn(runs), back = learn(runs.map((r) => r.slice().reverse()));
  return { shapes, index, ...ahead, back };
}

/** Key for a run of columns: their shapes, and how far the ground steps between them. */
function contextKey(run) {
  let k = String(run[0].s);
  for (let i = 1; i < run.length; i++) k += `:${run[i].top - run[i - 1].top}:${run[i].s}`;
  return k;
}

/** The difficulty stage (0 = like Stage One, 8 = like Stage Nine) after `columns` of course. */
export function difficultyAt(columns) {
  return Math.min(8, columns / 160);
}

/** The most columns kept off each side of the window (about 50 km): beyond that the furthest are forgotten. */
const KEEP = 20000;

/**
 * One end of the course, walking away from the start: the grammar it walks by (`g`: forwards for
 * the right-hand end, `back` for the left), the column it's on and the ones before it.
 */
class Walker {
  constructor(g, state, tops) {
    this.g = g;
    this.state = state;          // { s: shape index, top: row of its top tile }
    this.history = [state];      // the last few states, for context
    this.tops = tops;            // the ground's top row in the last RISE_SPAN columns (newest last)
    this.generated = 0;          // columns made by this walk
  }
}

export class EndlessCourse {
  /**
   * @param {ReturnType<typeof buildGrammar>} grammar
   * @param {Array} levels  the stages (the course opens with Stage One's starting stretch)
   * @param {() => number} random
   *
   * The course goes on for ever both ways. Columns scrolled off one side are kept (up to KEEP),
   * so driving back the other way finds the course as it was; past them, new course is made.
   */
  constructor(grammar, levels, random = Math.random) {
    this.g = grammar;
    this.random = random;
    this.width = ENDLESS_WIDTH;
    this.height = ENDLESS_HEIGHT;
    this.tiles = Array.from({ length: this.height }, () => []);
    this.dropped = 0;            // columns scrolled off the left (less those scrolled back on)
    this.steepAllowed = 0;       // times the limit on climbs had to give way
    this.leftStore = [];         // columns scrolled off the left, the nearest last
    this.rightStore = [];        // ...and off the right
    // Open with the first columns of Stage One, lifted into the band: a familiar start.
    const l = levels[0];
    const open = 12;
    let firstTop = 0;
    while (l.tiles[firstTop][0] === SKY) firstTop++;
    const lift = BAND[0] + 12 - firstTop;
    for (let x = 0; x < open; x++) {
      for (let r = 0; r < this.height; r++) {
        const src = r - lift;
        let v = src >= 0 && src < l.height ? l.tiles[src][x] : FILL;
        if (src >= l.height || (v === SKY && src > firstTop + DEPTH)) v = FILL;
        this.tiles[r].push(v);
      }
    }
    // Pick up the walk to the right from the shape of the last opening column, and the walk to
    // the left from the first.
    const stateOf = (x, dir) => {
      let top = 0;
      while (this.tiles[top][x] === SKY) top++;
      const shape = [];
      for (let r = top; r < top + DEPTH; r++) shape.push(this.tiles[r][x]);
      const s = grammar.index ? grammar.index.get(shape.join('.')) ?? -1 : grammar.shapes.findIndex((sh) => sh.join('.') === shape.join('.'));
      return { s: s >= 0 && dir.alive[s] ? s : dir.alive.findIndex((a) => a), top };
    };
    const topsOf = (xs) => xs.map((x) => { let t = 0; while (this.tiles[t][x] === SKY) t++; return t; });
    this.right = new Walker(grammar, stateOf(open - 1, grammar), topsOf(Array.from({ length: Math.min(open, RISE_SPAN) }, (_, i) => open - Math.min(open, RISE_SPAN) + i)));
    this.right.generated = open;
    this.left = grammar.back ? new Walker(grammar.back, stateOf(0, grammar.back), topsOf(Array.from({ length: Math.min(open, RISE_SPAN) }, (_, i) => Math.min(open, RISE_SPAN) - 1 - i))) : null;
    this.start = [l.start[0], (l.start[1] / 64 + lift) * 64];
    while (this.tiles[0].length < this.width) this.addColumn(this.right);
    // Shaped like an entry of levels.json, so the game and renderer can use it as a stage.
    // `tiles` is the same array the course keeps changing.
    this.level = { width: this.width, height: this.height, tiles: this.tiles, start: this.start };
  }

  /** Columns made to the right since the start (the right-hand walk's, for its difficulty). */
  get generated() { return this.right.generated; }

  /**
   * Choose the next column for walker w. Usually the last two or three columns are matched against
   * the stages, so whole hills and ramps come out as the designer drew them; sometimes only the
   * last column is, which is where the course turns into something new.
   */
  pick(w = this.right) {
    const r = this.random();
    let order = r < 0.55 ? 3 : r < 0.85 ? 2 : 1;
    for (; order >= 1; order--) {
      if (w.history.length < order) continue;
      const options = w.g.joins[order - 1].get(contextKey(w.history.slice(-order)));
      if (!options) continue;
      const choice = this.choose(w, options, order > 1);
      if (choice) return choice;
    }
    return this.choose(w, w.g.joins[0].get(contextKey([w.state])), false);
  }

  /**
   * Pick one of `options`, weighted (see the notes at the top). With `strict`, null if none fit.
   * Otherwise, if none fit, the limit on climbs gives way first (some valleys in the stages only
   * lead out uphill), and only then the band.
   */
  choose(w, options, strict, steepOk = false) {
    if (!options) return null;
    const memo = new Map();
    const level = difficultyAt(w.generated);
    const mid = (BAND[0] + BAND[1]) / 2;
    const weights = options.map((j) => {
      const top = w.state.top + j.step;
      if (top < BAND[0] || top > BAND[1] || !w.g.safe[j.to][top - BAND[0]]) return 0;
      if (!steepOk) {
        if (w.tops.length && Math.max(...w.tops) - top > MAX_RISE) return 0; // too steep a climb
        // ...or a way into somewhere (a valley) that can only be left by one
        if (!this.canGoOn(w, j.to, [...w.tops.slice(1 - RISE_SPAN), top], LOOKAHEAD, memo)) return 0;
      }
      let wt = Math.sqrt(j.count);
      // closest source stage to the current difficulty
      const near = Math.min(...j.stages.map((st) => Math.abs(st - level)));
      wt *= Math.exp(-(near * near) / 2.5);
      // drift back towards the middle of the band when far from it
      const pull = (top - w.state.top) * (mid - w.state.top);
      if (Math.abs(w.state.top - mid) > 6 && pull < 0) wt *= 0.35;
      return wt;
    });
    let total = weights.reduce((a, b) => a + b, 0);
    if (total === 0 && strict) return null;
    if (total === 0 && !steepOk) {
      this.steepAllowed++;
      return this.choose(w, options, false, true);
    }
    if (total === 0) {
      // Nothing keeps us in the band: take whatever moves towards its middle.
      options.forEach((j, i) => { weights[i] = Math.abs(w.state.top + j.step - mid) < Math.abs(w.state.top - mid) ? 1 : 1e-6; });
      total = weights.reduce((a, b) => a + b, 0);
    }
    let r = this.random() * total;
    for (let i = 0; i < options.length; i++) { r -= weights[i]; if (r <= 0) return options[i]; }
    return options[options.length - 1];
  }

  /**
   * Whether, from shape `s` with the ground's last tops `tops` (the newest last), walker w can go
   * on for `depth` more columns inside the band without a climb steeper than MAX_RISE.
   */
  canGoOn(w, s, tops, depth, memo) {
    if (depth === 0) return true;
    const key = `${s}|${tops.join(',')}|${depth}`;
    if (memo.has(key)) return memo.get(key);
    const top = tops[tops.length - 1], highest = Math.max(...tops);
    const opts = w.g.joins[0].get(contextKey([{ s, top: 0 }])) || [];
    let ok = false;
    for (const j of opts) {
      const t = top + j.step;
      if (t < BAND[0] || t > BAND[1] || !w.g.safe[j.to][t - BAND[0]] || highest - t > MAX_RISE) continue;
      if (this.canGoOn(w, j.to, [...tops.slice(1 - RISE_SPAN), t], depth - 1, memo)) { ok = true; break; }
    }
    memo.set(key, ok);
    return ok;
  }

  /** Make a new column with walker w: on the right for the right-hand walk, on the left for the left. */
  addColumn(w = this.right) {
    const j = this.pick(w);
    const top = w.state.top + j.step;
    const shape = this.g.shapes[j.to];
    const col = [];
    for (let r = 0; r < this.height; r++) col.push(r >= top ? (r - top < DEPTH ? shape[r - top] : FILL) : SKY);
    this.putColumn(col, w === this.left);
    w.state = { s: j.to, top };
    w.tops.push(top);
    if (w.tops.length > RISE_SPAN) w.tops.shift();
    w.history.push(w.state);
    if (w.history.length > ORDER) w.history.shift();
    w.generated++;
  }

  putColumn(col, left) { for (let r = 0; r < this.height; r++) { if (left) this.tiles[r].unshift(col[r]); else this.tiles[r].push(col[r]); } }
  takeColumn(left) { return this.tiles.map((row) => (left ? row.shift() : row.pop())); }

  /** Drop `n` columns from the left and bring `n` on at the right (kept ones first, then new). */
  scroll(n) {
    for (let i = 0; i < n; i++) this.leftStore.push(this.takeColumn(true));
    this.forget(this.leftStore, this.left);
    for (let i = 0; i < n; i++) {
      if (this.rightStore.length) this.putColumn(this.rightStore.pop(), false);
      else this.addColumn(this.right);
    }
    this.dropped += n;
  }

  /** The other way: drop `n` columns from the right and bring `n` on at the left. */
  scrollBack(n) {
    for (let i = 0; i < n; i++) this.rightStore.push(this.takeColumn(false));
    this.forget(this.rightStore, this.right);
    for (let i = 0; i < n; i++) {
      if (this.leftStore.length) this.putColumn(this.leftStore.pop(), true);
      else if (this.left) this.addColumn(this.left);
      else this.putColumn(new Array(this.height).fill(FILL), true);
    }
    this.dropped -= n;
  }

  /**
   * Past KEEP columns kept on one side, forget the furthest; that side's walk then carries on from
   * the furthest one still kept (by its shape alone).
   */
  forget(store, w) {
    if (store.length <= KEEP || !w) return;
    store.splice(0, store.length - KEEP);
    const col = store[0];
    let top = 0;
    while (top < this.height && col[top] === SKY) top++;
    const s = this.g.index?.get(col.slice(top, top + DEPTH).join('.')) ?? -1;
    w.state = { s: s >= 0 && w.g.alive[s] ? s : w.g.alive.findIndex((a) => a), top };
    w.history = [w.state];
    w.tops = [top];
  }
}
