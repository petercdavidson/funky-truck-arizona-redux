// endless.js — Endless Mode's course generator. No DOM access (runs under Node for tests).
//
// The course is built a column of tiles at a time, using only joins that the original nine
// stages use. Every column of every stage is reduced to its top few tiles (its "shape"; below
// that is solid ground), and each place one shape sits next to another in a stage is recorded,
// with how far the ground steps up or down between them. Generating a course is a random walk
// over those recorded joins. So every seam in the course is one the original designer drew, but
// the hills, jumps and valleys come in new orders, forever.
//
// The walk is steered so it stays fun, and the same fun 30 minutes in as 30 seconds in:
//   - it stays inside a vertical band, so it never climbs or falls without end;
//   - joins are weighted by the stage they came from, towards a "theme" stage that wanders from
//     stage to stage at random every minute or so of driving (no difficulty ramp: Endless is free
//     play, and a ramp used to leave it on Stage Eight's pieces alone for ever);
//   - stretches it made lately are less likely to come again (RECENT);
//   - it avoids shapes that only lead to dead ends (the last column of each stage);
//   - it never climbs more than MAX_RISE tiles over RISE_SPAN columns, and (given the tiles'
//     collision lines) any slope steeper than MAX_CLIMB (a steep face: a kicker, a wall) comes
//     only after a run-up (FACE), so there's always room to back up and take it at speed:
//     nobody gets stuck (drops can be as steep as they like);
//   - (given the tiles' collision lines) it never joins a slope down straight onto a slope up
//     where they meet at less than V_ANGLE: a sharp V a wheel (or a tumbleweed) gets caught in.
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
/** The sharpest a slope down may meet a slope up at a join (degrees between them; flat is 180). */
export const V_ANGLE = 120;
/** How many columns ahead the walk checks it can go on without a climb steeper than that. */
const LOOKAHEAD = 10;
/**
 * The steepest the ground may climb in a column, in the way the walk goes (degrees), and still be
 * driven up from a standstill. The stages' slopes climb at up to 45° or 54°, or at 60° and more
 * (kickers' faces and walls, 2 to 12 tiles tall): those need speed, so they're steep faces (FACE).
 */
export const MAX_CLIMB = 58;
/**
 * A steep face (columns climbing steeper than MAX_CLIMB) starts only after a run-up: `runUp`
 * columns that climb no more than `flat` degrees anywhere and end no higher than they start,
 * then at most `leadIn` columns climbing more than that (the ramp into the face), then the face.
 * From a standstill at the start of the run-up, holding the gas gets the truck over every face
 * the walk makes (tests/endless.test.mjs drives them): so if one stops you, back up and go again.
 * Without a run-up, faces like these stopped a relaxed driver dead in more than half of 10-minute
 * runs; with a 2-column ramp into a 4-tile 72° face the truck hits it too fast and flips; with a
 * run-up of only 4 columns, backing up too far (down a hill behind it) can leave you slower.
 * Only on the course ahead: behind the start you drive in reverse, and nothing there climbs
 * steeper than MAX_CLIMB.
 */
export const FACE = { runUp: 6, flat: 20, leadIn: 1 };
/** A stretch (4 columns) made within the last RECENT columns is RECENT_WEIGHT as likely again. */
const RECENT = 600, RECENT_WEIGHT = 0.2;
/** The theme stage moves on every THEME_LEN[0] to THEME_LEN[1] columns, gliding over THEME_GLIDE. */
const THEME_LEN = [150, 300], THEME_GLIDE = 40;
const FILL = 1, SKY = 0;

/** Longest run of columns used as context when choosing the next one (see pick()). */
const ORDER = 3;

/**
 * Learn the shapes and joins from the stages in levels.json.
 * joins[n - 1] maps a context (the last n columns: their shapes and steps between them) to the
 * columns that followed it somewhere in the stages. `back` is the same read right to left (the
 * columns that came before each context), for the course's leftward end: { joins, alive, safe }.
 * `slabs: false` leaves out the stages that are floating slabs, as before 1.26 (the stunt tracks'
 * builder, so its tracks come out as they were designed). With `collision` (the game's tiles'
 * collision lines), `climb` is each shape's steepest climb (degrees) in the walk's direction.
 */
export function buildGrammar(levels, { keepDeep = false, collision = null, slabs = true, maxSlope = null, band = BAND, opening = null } = {}) {
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
      // Skip columns with more than solid ground below their shape (caves): the course fills
      // below every shape with solid ground. Stages Two, Four, Six and Nine are slabs of ground
      // floating in the sky, so below the solid ground there is only sky: the course's fill is
      // as good, so they're kept (with `slabs`). With `keepDeep`, keep every column, filling below
      // the shape all the same: Stage Six's smooth 63° drop and climb are among them.
      let deep = false;
      if (!keepDeep) {
        // (a slab's underside: the row below its lowest ground, with only sky under that)
        let under = l.height;
        while (under > top && l.tiles[under - 1][x] === SKY) under--;
        if (under < l.height && (!slabs || under - top < DEPTH)) deep = true;   // (too thin a slab)
        for (let r = top + DEPTH; r < under && !deep; r++) deep = l.tiles[r][x] !== FILL;
      }
      if (top >= l.height - 1 || deep) { if (run.length) runs.push(run); run = []; continue; }
      const shape = [];
      for (let r = top; r < top + DEPTH; r++) shape.push(r < l.height ? l.tiles[r][x] : FILL);
      run.push({ s: id(shape), top, stage });
    }
    if (run.length) runs.push(run);
  });
  // Each shape's steepest climb (degrees), driving right and driving left (for the back walk).
  const climbs = collision ? shapes.map((sh) => shapeClimb(sh, collision)) : null;
  // With `maxSlope` (Sandbox's Battlefield), only shapes no steeper than that either way are
  // used: the runs are cut where any other is.
  if (maxSlope != null && climbs) {
    const ok = (c) => Math.max(climbs[c.s].right, climbs[c.s].left) <= maxSlope;
    const cut = [];
    for (const run of runs) {
      let part = [];
      for (const c of run) { if (ok(c)) part.push(c); else { if (part.length > 1) cut.push(part); part = []; } }
      if (part.length > 1) cut.push(part);
    }
    runs.length = 0; runs.push(...cut);
  }
  const learn = (seqs, climb) => {
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
    // safe[s][top - band[0]]: from shape s at that height, the walk can keep going for a long way
    // without leaving the band. Some stretches (a long drop into a valley) only go one way, so
    // the walk must not start down one unless there is room for all of it. (Not counting steep
    // faces, which need a run-up first: there must always be a way on without one.)
    const rows = band[1] - band[0] + 1;
    let safe = shapes.map(() => new Array(rows).fill(true));
    for (let k = 0; k < 40; k++) {
      safe = shapes.map((_, i) => {
        const opts = out[0].get(contextKey([{ s: i, top: 0 }])) || [];
        return Array.from({ length: rows }, (_, r) => opts.some((j) => {
          const t = r + j.step;
          if (climb && climb[j.to] > MAX_CLIMB) return false;
          return t >= 0 && t < rows && safe[j.to][t];
        }));
      });
    }
    return { joins: out, alive, safe };
  };
  const climbR = climbs?.map((c) => c.right) ?? null, climbL = climbs?.map((c) => c.left) ?? null;
  const ahead = learn(runs, climbR), back = learn(runs.map((r) => r.slice().reverse()), climbL);
  // Each shape's ground at its two edges: how steeply it goes down to the right edge (`down`) and
  // up from the left edge (`up`), in degrees. A join of a down onto an up makes a V.
  const edges = collision ? shapes.map((sh) => shapeEdges(sh, collision)) : null;
  const vee = edges ? (a, b) => edges[a].down > 0 && edges[b].up > 0 && 180 - edges[a].down - edges[b].up < V_ANGLE : () => false;
  // (steep faces only on the course ahead: behind the start you drive in reverse, and reversing up
  // one hardly ever works)
  const faces = maxSlope == null || maxSlope > MAX_CLIMB;
  return { shapes, index, ...ahead, vee, climb: climbR, faces, band, opening, back: { ...back, vee: (a, b) => vee(b, a), climb: climbL, faces: false, band } };
}

/** Sandbox's Flat: the stages' flat ground (tile 2, ground at half a tile down, over solid fill). */
export const FLAT_SHAPE = [2, 1, 1, 1, 1, 1, 1, 1];
/**
 * A grammar of nothing but flat ground, for Sandbox's Flat: the course is FLAT_SHAPE, at the
 * same height, for ever both ways.
 */
export function flatGrammar() {
  const one = { joins: [new Map([[contextKey([{ s: 0, top: 0 }]), [{ to: 0, step: 0, count: 1, stages: [0] }]]])], alive: [true], safe: [[true]] };
  // (contexts of 2 and 3 columns find nothing: pick() falls back to the last column alone)
  one.joins.push(new Map(), new Map());
  const band = [27, 27];
  return { shapes: [FLAT_SHAPE], index: new Map([[FLAT_SHAPE.join('.'), 0]]), ...one, vee: () => false, climb: [0], faces: false, band, opening: FLAT_SHAPE,
    back: { ...one, vee: () => false, climb: [0], faces: false, band } };
}

/**
 * Sandbox's Battlefield: the stages' gentlest ground (no slope steeper than BATTLEFIELD.slope
 * degrees either way), kept within BATTLEFIELD.band rows: rolling, never far up or down.
 */
// (`flat`: how likely, against sloping ground, flat ground is to come next)
export const BATTLEFIELD = { slope: 27, band: [24, 30], flat: 0.3 };
export function battlefieldGrammar(levels, collision) {
  const g = buildGrammar(levels, { collision, maxSlope: BATTLEFIELD.slope, band: BATTLEFIELD.band, opening: FLAT_SHAPE });
  // (`fall`: each shape's steepest drop, so a shape that only goes down counts as sloping too)
  g.roll = BATTLEFIELD.flat; g.fall = g.back.climb;
  g.back.roll = BATTLEFIELD.flat; g.back.fall = g.climb;
  return g;
}

/** The topmost up-facing collision line's height (px down from the shape's top) at x, or Infinity. */
function groundAt(shape, collision, x) {
  let best = Infinity;
  shape.forEach((id, r) => {
    const d = collision[id] || [];
    for (let i = 0; i < d.length; i += 5) {
      const ax = d[i], ay = d[i + 1], bx = d[i + 2], by = d[i + 3];
      if (bx >= ax || x < bx || x > ax) continue;   // (up-facing lines run right to left)
      best = Math.min(best, ay + (by - ay) * (x - ax) / (bx - ax) + r * 64);
    }
  });
  return best;
}

/** A column shape's steepest climb driving right and driving left (degrees; 0 if it never climbs). */
function shapeClimb(shape, collision) {
  let right = 0, left = 0;
  for (let x = 0; x + 8 <= 64; x += 4) {
    const a = groundAt(shape, collision, x), b = groundAt(shape, collision, x + 8);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    right = Math.max(right, Math.atan2(a - b, 8) * 180 / Math.PI);
    left = Math.max(left, Math.atan2(b - a, 8) * 180 / Math.PI);
  }
  return { right, left };
}

/**
 * The ground's slope at a column shape's two edges (degrees; positive is downhill to the right at
 * the right edge, `down`, and uphill to the right at the left edge, `up`), from the topmost
 * up-facing collision line over each point.
 */
function shapeEdges(shape, collision) {
  const y = (x) => groundAt(shape, collision, x);
  const deg = (dy) => (Number.isFinite(dy) ? Math.atan2(dy, 8) * 180 / Math.PI : 0);
  return { down: deg(y(63) - y(55)), up: deg(y(1) - y(9)) };
}

/** Key for a run of columns: their shapes, and how far the ground steps between them. */
function contextKey(run) {
  let k = String(run[0].s);
  for (let i = 1; i < run.length; i++) k += `:${run[i].top - run[i - 1].top}:${run[i].s}`;
  return k;
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
    this.recent = new Map();     // stretch (contextKey of 4 columns) -> when it was last made
    this.ground = [];            // the last few columns made: { top, climb } (newest last), for FACE
    // The theme stage: gliding from `from` to `to` since column `at`, for `len` columns. It
    // opens on Stage One, for a familiar start.
    this.theme = { from: 0, to: 0, at: 0, len: THEME_LEN[0] };
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
    this.faceForced = 0;         // times a steep face had to come with no run-up (tests check it never does)
    this.leftStore = [];         // columns scrolled off the left, the nearest last
    this.rightStore = [];        // ...and off the right
    // Open with the first columns of Stage One, lifted into the band: a familiar start. (Or,
    // with the grammar's `opening`, that shape flat across the middle of its band, the truck
    // as high over it as Stage One's start is over its ground.)
    const l = levels[0];
    const open = 12;
    const band = grammar.band || BAND;
    let firstTop = 0;
    while (l.tiles[firstTop][0] === SKY) firstTop++;
    const lift = band[0] + 12 - firstTop;
    const flatTop = Math.round((band[0] + band[1]) / 2);
    for (let x = 0; x < open; x++) {
      for (let r = 0; r < this.height; r++) {
        if (grammar.opening) { this.tiles[r].push(r < flatTop ? SKY : r - flatTop < DEPTH ? grammar.opening[r - flatTop] : FILL); continue; }
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
    // (Stage One's start is 3.5 tiles over its flat ground, half a tile into its top tile)
    this.start = grammar.opening ? [l.start[0], flatTop * 64 + 32 - 224] : [l.start[0], (l.start[1] / 64 + lift) * 64];
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
    const level = this.themeAt(w);
    const band = w.g.band || BAND, mid = (band[0] + band[1]) / 2;
    const weights = options.map((j) => {
      const top = w.state.top + j.step;
      if (top < band[0] || top > band[1] || !w.g.safe[j.to][top - band[0]]) return 0;
      if (w.g.vee?.(w.state.s, j.to)) return 0;   // a sharp V
      if (!this.faceOk(w, j.to)) return 0;        // a steep face with no run-up
      if (!steepOk) {
        if (w.tops.length && Math.max(...w.tops) - top > MAX_RISE) return 0; // too steep a climb
        // ...or a way into somewhere (a valley) that can only be left by one
        if (!this.canGoOn(w, j.to, [...w.tops.slice(1 - RISE_SPAN), top], LOOKAHEAD, memo)) return 0;
      }
      let wt = Math.sqrt(j.count);
      const made = w.recent.get(contextKey([...w.history.slice(-ORDER), { s: j.to, top }]));
      if (made !== undefined && w.generated - made < RECENT) wt *= RECENT_WEIGHT;
      // closest source stage to the theme
      const near = Math.min(...j.stages.map((st) => Math.abs(st - level)));
      wt *= Math.exp(-(near * near) / 2.5);
      // drift back towards the middle of the band when far from it
      const pull = (top - w.state.top) * (mid - w.state.top);
      if (Math.abs(w.state.top - mid) > 6 && pull < 0) wt *= 0.35;
      // (`roll`, Battlefield's narrow band: always drawn back to its middle, and sloping ground
      // preferred to flat, so it rolls gently up and down rather than lying flat at one edge)
      if (w.g.roll) {
        if (pull < 0) wt *= 0.25; else if (pull > 0) wt *= 3;
        if (!w.g.climb?.[j.to] && !w.g.fall?.[j.to]) wt *= w.g.roll;
      }
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
      options.forEach((j, i) => { weights[i] = !this.faceOk(w, j.to) ? 0 : Math.abs(w.state.top + j.step - mid) < Math.abs(w.state.top - mid) ? 1 : 1e-6; });
      if (!weights.some((x) => x > 0)) { this.faceForced++; weights.fill(1); }   // (never seen: tests check)
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
    // (looking ahead, the walk may finish a steep face it's on, but not start one: there's always
    // a way on without one)
    const climb = w.g.climb, onFace = w.g.faces && climb && climb[s] > MAX_CLIMB;
    if (depth === 0) return true;
    const key = `${s}|${tops.join(',')}|${depth}`;
    if (memo.has(key)) return memo.get(key);
    const top = tops[tops.length - 1], highest = Math.max(...tops), band = w.g.band || BAND;
    const opts = w.g.joins[0].get(contextKey([{ s, top: 0 }])) || [];
    let ok = false;
    for (const j of opts) {
      const t = top + j.step;
      if (t < band[0] || t > band[1] || !w.g.safe[j.to][t - band[0]] || highest - t > MAX_RISE || w.g.vee?.(s, j.to)) continue;
      if (climb && climb[j.to] > MAX_CLIMB && !onFace) continue;
      if (this.canGoOn(w, j.to, [...tops.slice(1 - RISE_SPAN), t], depth - 1, memo)) { ok = true; break; }
    }
    memo.set(key, ok);
    return ok;
  }

  /** Walker w's theme stage now (0 = Stage One ... 8 = Stage Nine; in between while it glides). */
  themeAt(w) {
    const t = w.theme;
    return t.from + (t.to - t.from) * Math.min(1, (w.generated - t.at) / THEME_GLIDE);
  }

  /** Every THEME_LEN columns, walker w's theme sets off for another stage, picked at random. */
  moveTheme(w) {
    const t = w.theme;
    if (w.generated - t.at < t.len) return;
    // (one of the other eight, from one random number)
    let next = Math.min(7, Math.floor(this.random() * 8));
    if (next >= t.to) next++;
    w.theme = { from: t.to, to: next, at: w.generated, len: THEME_LEN[0] + Math.floor(this.random() * (THEME_LEN[1] - THEME_LEN[0])) };
  }

  /** Whether shape s may come next for walker w: a steep face only after a run-up (FACE). */
  faceOk(w, s) {
    const climb = w.g.climb;
    if (!climb || climb[s] <= MAX_CLIMB) return true;
    if (!w.g.faces) return false;
    const gr = w.ground, n = gr.length;
    if (n && gr[n - 1].climb > MAX_CLIMB) return true;                   // carrying on a face
    let lead = 0;                                                         // the ramp into it
    while (lead < n && gr[n - 1 - lead].climb > FACE.flat) lead++;
    if (lead > FACE.leadIn) return false;
    const end = n - 1 - lead, start = end - FACE.runUp + 1;               // the run-up
    if (start < 0) return false;                                          // (not enough known yet)
    for (let i = start; i <= end; i++) if (gr[i].climb > FACE.flat) return false;
    return gr[end].top >= gr[start].top;                                  // (rows: bigger is lower)
  }

  /** Make a new column with walker w: on the right for the right-hand walk, on the left for the left. */
  addColumn(w = this.right) {
    this.moveTheme(w);
    const j = this.pick(w);
    const top = w.state.top + j.step;
    const shape = this.g.shapes[j.to];
    const col = [];
    for (let r = 0; r < this.height; r++) col.push(r >= top ? (r - top < DEPTH ? shape[r - top] : FILL) : SKY);
    this.putColumn(col, w === this.left);
    w.recent.set(contextKey([...w.history.slice(-ORDER), { s: j.to, top }]), w.generated);
    w.state = { s: j.to, top };
    w.ground.push({ top, climb: w.g.climb ? w.g.climb[j.to] : 0 });
    if (w.ground.length > FACE.runUp + FACE.leadIn + 2) w.ground.shift();
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
    w.ground = [];
  }
}
