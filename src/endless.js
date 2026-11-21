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
//   - it avoids shapes that only lead to dead ends (the last column of each stage).
//
// The course lives in a window of tiles that scrolls: when the truck is far enough along, the
// oldest columns are dropped, new ones are added, and the game moves everything left.

export const ENDLESS_WIDTH = 128;   // columns kept in the window
export const ENDLESS_HEIGHT = 48;   // rows
export const ENDLESS_SHIFT = 48;    // columns dropped (and added) each time the window moves
const DEPTH = 8;                    // tiles per column shape (below that is solid ground, tile 1)
const BAND = [14, 40];              // rows the ground's top may use
const FILL = 1, SKY = 0;

/** Longest run of columns used as context when choosing the next one (see pick()). */
const ORDER = 3;

/**
 * Learn the shapes and joins from the stages in levels.json.
 * joins[n - 1] maps a context (the last n columns: their shapes and steps between them) to the
 * columns that followed it somewhere in the stages.
 */
export function buildGrammar(levels) {
  const shapes = [];            // index -> array of DEPTH tile ids
  const index = new Map();      // shape key -> index
  const joins = Array.from({ length: ORDER }, () => new Map());
  const id = (shape) => {
    const k = shape.join('.');
    if (!index.has(k)) { index.set(k, shapes.length); shapes.push(shape); }
    return index.get(k);
  };
  levels.forEach((l, stage) => {
    // Leave out the walls at each end of a stage (the first column, and everything past the
    // finish line) and any column with no ground at all.
    const run = [];
    for (let x = 1; x < l.width - 9; x++) {
      let top = 0;
      while (top < l.height && l.tiles[top][x] === SKY) top++;
      // Skip columns with more than solid ground below their shape (caves, the floating bottom
      // edge of some stages): the course fills below every shape with solid ground.
      let deep = false;
      for (let r = top + DEPTH; r < l.height && !deep; r++) deep = l.tiles[r][x] !== FILL;
      if (top >= l.height - 1 || deep) { run.length = 0; continue; }
      const shape = [];
      for (let r = top; r < top + DEPTH; r++) shape.push(r < l.height ? l.tiles[r][x] : FILL);
      const s = id(shape);
      for (let n = 1; n <= ORDER && n <= run.length; n++) {
        const key = contextKey(run.slice(-n));
        const m = joins[n - 1];
        const step = top - run[run.length - 1].top;
        if (!m.has(key)) m.set(key, new Map());
        const opts = m.get(key), k = `${s},${step}`;
        if (!opts.has(k)) opts.set(k, { to: s, step, count: 0, stages: new Set() });
        const j = opts.get(k);
        j.count++; j.stages.add(stage);
      }
      run.push({ s, top });
    }
  });
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
  return { shapes, joins: out, alive, safe };
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

export class EndlessCourse {
  /**
   * @param {ReturnType<typeof buildGrammar>} grammar
   * @param {Array} levels  the stages (the course opens with Stage One's starting stretch)
   * @param {() => number} random
   */
  constructor(grammar, levels, random = Math.random) {
    this.g = grammar;
    this.random = random;
    this.width = ENDLESS_WIDTH;
    this.height = ENDLESS_HEIGHT;
    this.tiles = Array.from({ length: this.height }, () => []);
    this.generated = 0;          // columns generated since the start
    this.dropped = 0;            // columns scrolled off the left
    this.state = null;           // { s: shape index, top: row of its top tile }
    this.history = [];           // the last few states, for context
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
    // Pick up the walk from the shape of the last opening column.
    let top = 0;
    while (this.tiles[top][open - 1] === SKY) top++;
    const shape = [];
    for (let r = top; r < top + DEPTH; r++) shape.push(this.tiles[r][open - 1]);
    const key = shape.join('.');
    const s = grammar.shapes.findIndex((sh) => sh.join('.') === key);
    this.state = { s: s >= 0 && grammar.alive[s] ? s : this.anyAlive(), top };
    this.history = [this.state];
    this.generated = open;
    this.start = [l.start[0], (l.start[1] / 64 + lift) * 64];
    while (this.tiles[0].length < this.width) this.addColumn();
    // Shaped like an entry of levels.json, so the game and renderer can use it as a stage.
    // `tiles` is the same array the course keeps changing.
    this.level = { width: this.width, height: this.height, tiles: this.tiles, start: this.start };
  }

  anyAlive() {
    const i = this.g.alive.findIndex((a) => a);
    return i;
  }

  /**
   * Choose the next column. Usually the last two or three columns are matched against the
   * stages, so whole hills and ramps come out as the designer drew them; sometimes only the
   * last column is, which is where the course turns into something new.
   */
  pick() {
    const r = this.random();
    let order = r < 0.55 ? 3 : r < 0.85 ? 2 : 1;
    for (; order >= 1; order--) {
      if (this.history.length < order) continue;
      const options = this.g.joins[order - 1].get(contextKey(this.history.slice(-order)));
      if (!options) continue;
      const choice = this.choose(options, order > 1);
      if (choice) return choice;
    }
    return this.choose(this.g.joins[0].get(contextKey([this.state])), false);
  }

  /** Pick one of `options`, weighted (see the notes at the top). With `strict`, null if none fit. */
  choose(options, strict) {
    const level = difficultyAt(this.generated);
    const mid = (BAND[0] + BAND[1]) / 2;
    const weights = options.map((j) => {
      const top = this.state.top + j.step;
      if (top < BAND[0] || top > BAND[1] || !this.g.safe[j.to][top - BAND[0]]) return 0;
      let w = Math.sqrt(j.count);
      // closest source stage to the current difficulty
      const near = Math.min(...j.stages.map((st) => Math.abs(st - level)));
      w *= Math.exp(-(near * near) / 2.5);
      // drift back towards the middle of the band when far from it
      const pull = (top - this.state.top) * (mid - this.state.top);
      if (Math.abs(this.state.top - mid) > 6 && pull < 0) w *= 0.35;
      return w;
    });
    let total = weights.reduce((a, b) => a + b, 0);
    if (total === 0 && strict) return null;
    if (total === 0) {
      // Nothing keeps us in the band: take whatever moves towards its middle.
      options.forEach((j, i) => { weights[i] = Math.abs(this.state.top + j.step - mid) < Math.abs(this.state.top - mid) ? 1 : 1e-6; });
      total = weights.reduce((a, b) => a + b, 0);
    }
    let r = this.random() * total;
    for (let i = 0; i < options.length; i++) { r -= weights[i]; if (r <= 0) return options[i]; }
    return options[options.length - 1];
  }

  addColumn() {
    const j = this.pick();
    const top = this.state.top + j.step;
    const shape = this.g.shapes[j.to];
    for (let r = 0; r < this.height; r++) {
      let v = SKY;
      if (r >= top) v = r - top < DEPTH ? shape[r - top] : FILL;
      this.tiles[r].push(v);
    }
    this.state = { s: j.to, top };
    this.history.push(this.state);
    if (this.history.length > ORDER) this.history.shift();
    this.generated++;
  }

  /** Drop `n` columns from the left and generate `n` more on the right. */
  scroll(n) {
    for (const row of this.tiles) row.splice(0, n);
    this.dropped += n;
    for (let i = 0; i < n; i++) this.addColumn();
  }
}
