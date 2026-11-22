// autotile.js — turns a sketched line into tiles, for the level editor's Path tool. No DOM access
// (runs under Node for tests).
//
// Every tile with collision lines is a piece of floor: its lines run from one point on the tile's
// edge (where the ground comes in from the left) to another (where it leaves, to the right; on a
// steep piece that can be the top or bottom edge). Pieces join where one leaves and the next comes
// in, so a whole track's surface is a chain of pieces, and a sketch can be turned into the chain
// that follows it most closely: a shortest-path search over those edge points. The search prefers
// joins the nine stages use, so the result looks like the stages.
//
// The tiles with no collision are the ground's fill (the faces under slopes and walls), and the
// stages place them by what is above and beside them; that is learned from the stages too, and
// used to fill below the new surface.

import { baseOf, formOf, makeId, formCollision, NO_MIRROR } from './tile-forms.js';

const SKY = 0, DIRT = 1;

// The tiles' mirrors (and their turned and flipped forms) are in tile-forms.js.
export { MIRROR_PAIRS, NO_MIRROR, mirrorOf, flipTiles } from './tile-forms.js';

/**
 * Learn the pieces and the fill from the stages.
 * `collision[id]` is a tile's lines, five numbers each (x1, y1, x2, y2, flag), drawn from the right
 * end to the left end. `levels` are the nine stages ({ width, height, tiles }).
 */
export function buildKit(collision, levels, T = 64, opts = {}) {
  // Edge positions in the data are 0..63 and a pixel or so apart where pieces meet (15 and 16, 31
  // and 32): snap each to one value. 63 is the far edge (T).
  // Only the ends are snapped (the points inside a tile are left as drawn).
  const snap = (v) => (v >= T - 1 ? T : v);
  const ends = (d) => [[d[d.length - 3], d[d.length - 2]], [d[0], d[1]]];
  const raw = new Set();
  for (const d of collision) if (d?.length) for (const [x, y] of ends(d)) { raw.add(snap(x)); raw.add(snap(y)); }
  // The values are made symmetric (v and T - v), so a piece turned a quarter (x -> T - y) meets the
  // same edge points as the pieces the right way up.
  for (const v of [...raw]) raw.add(T - v);
  const sorted = [...raw].sort((p, q) => p - q), group = new Map();
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] - sorted[j] <= 1) j++;
    for (let k = i; k <= j; k++) group.set(sorted[k], sorted[j]);
    i = j + 1;
  }
  const low = (v) => Math.min(T / 2, group.get(v) ?? v);
  const c = (v) => { v = snap(v); return v <= T / 2 ? low(v) : T - low(T - v); };

  const pieces = [];       // { id, inX, inY, outX, outY, pts: [[x, y], ...] left to right }
  const isPiece = new Set();
  collision.forEach((d, id) => {
    if (!d || !d.length) return;
    const pts = [];
    for (let i = d.length - 5; i >= 0; i -= 5) {
      if (!pts.length) pts.push([c(d[i + 2]), c(d[i + 3])]);
      pts.push(i === 0 ? [c(d[i]), c(d[i + 1])] : [snap(d[i]), snap(d[i + 1])]);
    }
    const [inX, inY] = pts[0], [outX, outY] = pts[pts.length - 1];
    const onEdge = (x, y) => x === 0 || x === T || y === 0 || y === T;
    if (!onEdge(inX, inY) || !onEdge(outX, outY) || outX <= inX) return;
    // the ground's direction where it comes in and goes out, and the bends inside the piece
    const ang = (i) => Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
    const bends = [];
    for (let i = 1; i + 1 < pts.length; i++) bends.push([pts[i][0], Math.abs(ang(i) - ang(i - 1))]);
    pieces.push({ id, inX, inY, outX, outY, pts, aIn: ang(0), aOut: ang(pts.length - 2), bends });
    isPiece.add(id);
  });
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const byEntry = new Map();  // "x,y" where a piece comes in -> pieces
  for (const p of pieces) {
    const k = `${p.inX},${p.inY}`;
    if (!byEntry.has(k)) byEntry.set(k, []);
    byEntry.get(k).push(p);
  }

  // Which piece follows which in the stages, and the fill around the pieces.
  const joins = new Set();   // a * 1024 + b: piece b follows piece a somewhere in the stages
  const fill = new Map();  // context key -> Map(tile -> count)
  const seen = (key, id) => {
    if (!fill.has(key)) fill.set(key, new Map());
    const m = fill.get(key); m.set(id, (m.get(id) || 0) + 1);
  };
  for (const l of levels) {
    const at = (x, y) => (y < 0 ? SKY : y >= l.height || x < 0 || x >= l.width ? DIRT : l.tiles[y][x]);
    for (let y = 0; y < l.height; y++) for (let x = 0; x < l.width; x++) {
      const id = l.tiles[y][x];
      const p = byId.get(id);
      if (p) {
        // the next piece: in whichever neighbouring cell has a piece coming in where this one leaves
        for (const [dx, dy] of cellsAt(p.outX, p.outY, T)) {
          const q = byId.get(at(x + dx, y + dy));
          if (q && q.inX === p.outX - dx * T && q.inY === p.outY - dy * T) joins.add(id * 1024 + q.id);
        }
      } else if (id !== SKY) {
        for (const key of fillKeys(at(x, y - 1), at(x - 1, y), at(x + 1, y), isPiece)) seen(key, id);
      }
    }
  }
  const fillPick = new Map();
  for (const [key, m] of fill) {
    let best = DIRT, n = 0, total = 0;
    for (const [id, k] of m) { total += k; if (k > n) { best = id; n = k; } }
    fillPick.set(key, { id: best, share: n / total, total });
  }
  // The tiles the stages use: pieces that share a shape (the same ground, drawn differently), and
  // the fill tiles the look pass may choose from.
  const used = new Set(levels.flatMap((l) => l.tiles.flat()));
  const shape = (p) => p.pts.map((q) => q.join(',')).join(' ');
  const variants = new Map();
  for (const p of pieces) variants.set(p.id, pieces.filter((q) => used.has(q.id) && shape(q) === shape(p)).map((q) => q.id));
  const fills = [...used].filter((id) => id !== SKY && !isPiece.has(id)).sort((p, q) => p - q);
  const kit = { T, pieces, byId, byEntry, isPiece, joins, fillPick, variants, fills, collision };
  if (opts.edges) Object.assign(kit, artOf(opts.edges));
  // every piece turned each way (forms 0 to 3): for paths that run any way round
  const turn = ([x, y]) => [c(T - y), c(x)];
  const turnIn = ([x, y]) => [T - y, x];
  const opieces = [];
  for (const p of pieces) {
    let pts = p.pts;
    for (let r = 0; r < 4; r++) {
      const id = makeId(p.id, r), n = pts.length;
      const ang = (i) => Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
      const bends = [];
      for (let i = 1; i + 1 < n; i++) bends.push([pts[i][0], pts[i][1], Math.abs(wrap(ang(i) - ang(i - 1)))]);
      let len = 0;
      for (let i = 1; i < n; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      opieces.push({ id, base: p.id, form: r, pts, inX: pts[0][0], inY: pts[0][1], outX: pts[n - 1][0], outY: pts[n - 1][1], aIn: ang(0), aOut: ang(n - 2), bends, len });
      pts = pts.map((q, i) => (i === 0 || i === n - 1 ? turn(q) : turnIn(q)));
    }
  }
  opieces.forEach((p, i) => { p.index = i; });
  kit.opieces = opieces;
  kit.oById = new Map(opieces.map((p) => [p.id, p]));
  kit.oByEntry = new Map();
  for (const p of opieces) {
    const k = `${p.inX},${p.inY}`;
    if (!kit.oByEntry.has(k)) kit.oByEntry.set(k, []);
    kit.oByEntry.get(k).push(p);
  }
  return kit;
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---- the look: how well tiles' art meets at their edges (src/tile-art.js)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * `seam(a, b, dir)`: how badly tile a's art meets tile b's: dir 0 is a left of b, 1 a above b. 0 is
 * seamless; 1 is opaque against clear all along the edge. Counts the dirt's outline (opacity) not
 * lining up, and where both are dirt, a jump in brightness (the rim against plain dirt).
 */
function artOf(edges) {
  const n = edges.length;
  // each tile's edges: opacity (0-1) and brightness, 32 samples on each of top, right, bottom, left
  const A = [], Lu = [];
  edges.forEach((s, id) => {
    A[id] = new Float32Array(128); Lu[id] = new Float32Array(128);
    for (let e = 0; e < 4; e++) for (let k = 0; k < 32; k++) {
      A[id][e * 32 + k] = B64.indexOf(s[e * 64 + k]) / 63;
      Lu[id][e * 32 + k] = B64.indexOf(s[e * 64 + 32 + k]);
    }
  });
  // a turned tile's edges are its sheet tile's, moved round (and reversed where they run backwards)
  const moved = (src, order) => {
    const out = new Float32Array(128);
    order.forEach(([from, rev], e) => { for (let k = 0; k < 32; k++) out[e * 32 + k] = src[from * 32 + (rev ? 31 - k : k)]; });
    return out;
  };
  const TURN = [[3, true], [0, false], [1, true], [2, false]];     // a quarter clockwise: new top was the left, reversed...
  const UPSIDE = [[2, false], [1, true], [0, false], [3, true]];    // flipped top to bottom
  const edgesOf = (id) => {
    if (A[id]) return id;
    const b = baseOf(id), f = formOf(id);
    if (b >= n) return -1;
    let a = A[b], l = Lu[b];
    if (f & 4) { a = moved(a, UPSIDE); l = moved(l, UPSIDE); }
    for (let r = 0; r < (f & 3); r++) { a = moved(a, TURN); l = moved(l, TURN); }
    A[id] = a; Lu[id] = l;
    return id;
  };
  const cache = new Float32Array(n * n * 2).fill(-1), more = new Map();
  const seam = (a, b, dir) => {
    const plain = a < n && b < n, i = plain ? (a * n + b) * 2 + dir : (a * 4096 + b) * 2 + dir;
    let c = plain ? cache[i] : more.get(i);
    if (c >= 0) return c;
    if (edgesOf(a) < 0 || edgesOf(b) < 0) return 0;
    const pa0 = A[a], pb0 = A[b], la0 = Lu[a], lb0 = Lu[b], ea = dir ? 64 : 32, eb = dir ? 0 : 96;
    c = 0;
    for (let k = 0; k < 32; k++) {
      const pa = pa0[ea + k], pb = pb0[eb + k];
      // brightness: a line that carries on a pixel or two along still looks joined
      const la = la0[ea + k], lb = lb0[eb + k];
      let dl = Math.abs(la - lb);
      if (k > 0) dl = Math.min(dl, (Math.abs(la - lb0[eb + k - 1]) + Math.abs(la0[ea + k - 1] - lb)) / 2);
      if (k < 31) dl = Math.min(dl, (Math.abs(la - lb0[eb + k + 1]) + Math.abs(la0[ea + k + 1] - lb)) / 2);
      c += Math.abs(pa - pb) + Math.min(pa, pb) * Math.min(1, dl * 0.08);
    }
    c /= 32;
    if (plain) cache[i] = c; else more.set(i, c);
    return c;
  };
  /** The seams over columns x0..x1-1 (and where they meet the columns either side). */
  const seamTotal = (tiles, x0, x1) => {
    const H = tiles.length, W = tiles[0].length;
    let s = 0;
    for (let y = 0; y < H; y++) for (let x = Math.max(0, x0 - 1); x < Math.min(W, x1 + 1); x++) {
      if (x + 1 < W && x + 1 <= x1) s += seam(tiles[y][x], tiles[y][x + 1], 0);
      if (y + 1 < H && x >= x0 && x < x1) s += seam(tiles[y][x], tiles[y + 1][x], 1);
    }
    return s;
  };
  return { seam, seamTotal };
}

/** Offsets of the cells (relative to the one a point belongs to) that touch a point on its edge. */
function cellsAt(x, y, T) {
  const xs = x === 0 ? [-1, 0] : x === T ? [0, 1] : [0];
  const ys = y === 0 ? [-1, 0] : y === T ? [0, 1] : [0];
  const out = [];
  for (const dx of xs) for (const dy of ys) if (dx || dy) out.push([dx, dy]);
  return out;
}

/** The contexts a fill tile is looked up by, most specific first: what's above, left, right. */
function fillKeys(up, left, right, isPiece) {
  const kind = (id) => (id === SKY ? 'sky' : isPiece.has(id) ? id : 'g');  // 'g': ground fill
  const r = kind(right);
  return [`a${up} l${left} r${r}`, `a${up} r${r}`, `a${up} l${left}`, `a${up}`, `l${left} r${r}`, `l${left}`, `r${r}`];
}

/**
 * A sketched line (points in stage pixels, any order along x) turned into tiles.
 * Returns { tiles, chain, x0, x1 } where `tiles` is a new tiles array for the whole level and
 * `chain` the pieces placed ([{ x, y, id }] by cell). Columns x0..x1-1 are rebuilt: sky above the
 * new surface, the chain, ground below. The chain joins the existing ground at either end when
 * that ground is near the sketch.
 */
export function drawPath(level, sketch, kit, opts = {}) {
  const { T, pieces, byId, byEntry, joins } = kit;
  const W = level.width, H = level.height;
  let pts = sketch.map(([x, y]) => [x, y]);
  if (pts.length < 2) return null;
  if (opts.free || (opts.free !== false && !leftToRight(pts))) return drawPathFree(level, pts, kit, opts);
  if (pts[pts.length - 1][0] < pts[0][0]) pts.reverse();
  // keep it going left to right
  const mono = [pts[0]];
  for (const p of pts) if (p[0] > mono[mono.length - 1][0]) mono.push(p);
  if (mono.length < 2) return null;
  const x0 = Math.max(0, Math.floor(mono[0][0] / T)), x1 = Math.min(W, Math.ceil(mono[mono.length - 1][0] / T));
  if (x1 - x0 < 1) return null;
  const X0 = x0 * T, X1 = x1 * T;

  // the sketch as a height at every pixel column, smoothed, flat past its ends
  const n = X1 - X0 + 1, ys = new Float64Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const x = X0 + i;
    while (k < mono.length - 2 && mono[k + 1][0] < x) k++;
    const [ax, ay] = mono[k], [bx, by] = mono[k + 1];
    ys[i] = x <= ax ? ay : x >= bx ? by : ay + (by - ay) * (x - ax) / (bx - ax);
  }
  const smooth = opts.smooth ?? 12, sm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - smooth); j <= Math.min(n - 1, i + smooth); j++) { s += ys[j]; c++; }
    sm[i] = s / c;
  }
  const sy = (x) => sm[Math.max(0, Math.min(n - 1, Math.round(x - X0)))];
  const slope = (x) => (sy(x + 4) - sy(x - 4)) / 8;
  // how much the sketch itself bends around x (radians): bends in the ground cost only beyond that
  const sketchBend = (x) => Math.abs(Math.atan((sy(x + 32) - sy(x)) / 32) - Math.atan((sy(x) - sy(x - 32)) / 32));
  const KINK = opts.kink ?? 2;
  const bendCost = (x, b) => KINK * Math.max(0, b - sketchBend(x) - 0.05);

  // how far a piece placed in cell (cx, cy) strays from the sketch
  const costCache = new Map();
  const strayCost = (p, cx, cy) => {
    const key = (p.id * W + cx) * H + cy;
    if (costCache.has(key)) return costCache.get(key);
    let cost = 0;
    for (let i = 1; i < p.pts.length; i++) {
      const [ax, ay] = p.pts[i - 1], [bx, by] = p.pts[i];
      const len = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(len / 4));
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps, x = cx * T + ax + (bx - ax) * t, y = cy * T + ay + (by - ay) * t;
        const d = Math.abs(y - sy(x)) / Math.hypot(1, slope(x));
        cost += (d + d * d / 24) * len / steps / T;
      }
    }
    for (const [bx, b] of p.bends) cost += bendCost(cx * T + bx, b);
    costCache.set(key, cost);
    return cost;
  };

  // where the existing ground meets the edges of the rebuilt columns
  const existingEdge = (cx, side) => {
    if (cx < 0 || cx >= W) return [];
    const out = [];
    for (let y = 0; y < H; y++) {
      const p = byId.get(level.tiles[y][cx]);
      if (p) out.push(side === 'out' ? [cx * T + p.outX, y * T + p.outY, p.id] : [cx * T + p.inX, y * T + p.inY, p.id]);
    }
    return out;
  };
  const joinLeft = existingEdge(x0 - 1, 'out').filter(([X]) => X === X0);
  const joinRight = existingEdge(x1, 'in').filter(([X]) => X === X1);

  // ---- the search: states are (edge point, last piece); cost is straying plus odd joins
  const band = opts.band ?? 3 * T;
  const UNSEEN = opts.unseenJoin ?? 1.5, PER = opts.perPiece ?? 0.05;
  // with the tiles' art (kit.seam), a join whose art doesn't meet costs more
  const { seam } = kit, ART = opts.art ?? 3;
  const joinSeam = (last, X, Y, p, cx, cy) => {
    const q = byId.get(last), lx = (X - q.outX) / T, ly = (Y - q.outY) / T;
    if (ly === cy && lx + 1 === cx) return seam(last, p.id, 0);
    if (lx === cx && ly === cy + 1) return seam(p.id, last, 1);
    if (lx === cx && ly + 1 === cy) return seam(last, p.id, 1);
    return 0;
  };
  const heap = new Heap();
  const best = new Map(), from = new Map();
  const push = (X, Y, last, cost, prev, cell) => {
    const key = ((X * (H * T + 1)) + Y) * 1024 + last + 1;   // a number: much quicker than a string
    const had = best.get(key);
    if (had !== undefined && had <= cost) return;
    best.set(key, cost); from.set(key, { prev, cell });
    heap.push(cost, key, X, Y, last);
  };
  // starts: any point on the left edge near the sketch, best where the old ground ends
  const startY = sy(X0);
  for (const [X, Y, id] of joinLeft) if (Math.abs(Y - startY) <= T * 1.5) push(X, Y, id, Math.abs(Y - startY) / T * 0.5, null, null);
  const yEdges = new Set();
  for (const p of pieces) { if (p.inX === 0) yEdges.add(p.inY); }
  for (let cy = 0; cy < H; cy++) for (const e of yEdges) {
    const Y = cy * T + e;
    if (Math.abs(Y - startY) <= T * 1.5) push(X0, Y, -1, Math.abs(Y - startY) / T * 2 + (joinLeft.length ? 1 : 0), null, null);
  }
  const endY = sy(X1);
  const endBonus = new Map(joinRight.map(([X, Y, id]) => [`${X},${Y}`, id]));
  let done = null;
  while (heap.size) {
    const [cost, key, X, Y, last] = heap.pop();
    if (best.get(key) < cost) continue;
    if (X === X1) {
      // finishing here: how far from the sketch's end, and whether it meets the old ground
      const right = endBonus.get(`${X},${Y}`);
      const extra = right !== undefined ? (joins.has(last * 1024 + right) ? 0 : UNSEEN * 0.5) : Math.abs(Y - endY) / T * 2 + (joinRight.length ? 1 : 0);
      const total = cost + extra;
      if (!done || total < done.cost) done = { cost: total, key };
      if (done && heap.peek() !== undefined && heap.peek() > done.cost) break;
      continue;
    }
    if (done && cost > done.cost) break;
    const lx = Math.floor(X / T), ly = Math.floor(Y / T);
    const cells = [[lx, ly], ...cellsAt(X - lx * T, Y - ly * T, T).map(([dx, dy]) => [lx + dx, ly + dy])];
    // the cell the last piece is in: a cell holds one tile, so the next piece goes in another
    const lp = last >= 0 ? byId.get(last) : null;
    const lcx = lp ? (X - lp.outX) / T : -1, lcy = lp ? (Y - lp.outY) / T : -1;
    for (const [cx, cy] of cells) {
      if (cx < x0 || cx >= x1 || cy < 0 || cy >= H) continue;
      if (cx === lcx && cy === lcy) continue;
      const ix = X - cx * T, iy = Y - cy * T;
      if (ix < 0 || ix > T || iy < 0 || iy > T) continue;
      if (Math.abs(cy * T + T / 2 - sy(cx * T + T / 2)) > band) continue;
      for (const p of byEntry.get(`${ix},${iy}`) || []) {
        let c = cost + strayCost(p, cx, cy) + PER;
        if (last >= 0 && !joins.has(last * 1024 + p.id)) c += UNSEEN;
        if (last >= 0 && seam) c += ART * joinSeam(last, X, Y, p, cx, cy);
        if (last >= 0) c += bendCost(X, Math.abs(p.aIn - byId.get(last).aOut));
        push(cx * T + p.outX, cy * T + p.outY, p.id, c, key, { x: cx, y: cy, id: p.id });
      }
    }
  }
  if (!done) return null;
  const chain = [];
  for (let key = done.key; key && from.get(key)?.cell; key = from.get(key).prev) chain.unshift(from.get(key).cell);
  const { tiles, tops } = buildTiles(level, chain, x0, x1, kit);
  if (seam && opts.look !== false) polish(tiles, chain, x0, x1, kit, tops);
  return { chain, x0, x1, tiles };
}

/** The level's tiles with columns x0..x1-1 rebuilt around `chain`. */
function buildTiles(level, chain, x0, x1, kit) {
  const { T, byId, isPiece, fillPick } = kit;
  const W = level.width, H = level.height;
  const tiles = level.tiles.map((r) => r.slice());
  // the surface's height at each pixel column of the rebuilt part
  const surf = new Float64Array((x1 - x0) * T + 1).fill(Infinity);
  for (const { x, y, id } of chain) {
    const p = byId.get(id);
    for (let i = 1; i < p.pts.length; i++) {
      const [ax, ay] = p.pts[i - 1], [bx, by] = p.pts[i];
      for (let px = Math.ceil(ax); px <= bx; px++) {
        const yy = bx === ax ? Math.min(ay, by) : ay + (by - ay) * (px - ax) / (bx - ax);
        const j = (x - x0) * T + px;
        surf[j] = Math.min(surf[j], y * T + yy);
      }
    }
  }
  const onChain = new Map(chain.map((c) => [`${c.x},${c.y}`, c.id]));
  // Each column: the chain, ground below it, and sky above it, as far up as the old ground went
  // (up to its first sky). Anything above that gap (an overhang, a ceiling) is left as it was.
  // tops[x - x0] is the column's first rebuilt row.
  const tops = new Int32Array(x1 - x0);
  for (let x = x0; x < x1; x++) {
    const s = surf[(x - x0) * T + T / 2];
    let top = H;
    for (let y = 0; y < H; y++) if (onChain.has(`${x},${y}`) || y * T + T / 2 > s) { top = y; break; }
    for (let y = top; y < H; y++) {
      const id = onChain.get(`${x},${y}`);
      tiles[y][x] = id !== undefined ? id : y * T + T / 2 > s ? DIRT : SKY;
    }
    let y = top - 1;
    for (; y >= 0 && level.tiles[y][x] !== SKY; y--) tiles[y][x] = SKY;
    tops[x - x0] = y + 1;
  }
  // the fill: the stages' tile for what's above, left and right, top down
  const at = (x, y) => (y < 0 ? SKY : y >= H || x < 0 || x >= W ? DIRT : tiles[y][x]);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) {
      if (y < tops[x - x0] || tiles[y][x] === SKY || isPiece.has(tiles[y][x])) continue;
      let pick = DIRT;
      for (const key of fillKeysFor(at(x, y - 1), at(x - 1, y), at(x + 1, y), isPiece)) {
        const f = fillPick.get(key);
        if (f && f.total >= 2 && f.share >= 0.6) { pick = f.id; break; }
      }
      tiles[y][x] = pick;
    }
  }
  return { tiles, tops };
}

function fillKeysFor(up, left, right, isPiece) { return fillKeys(up, left, right, isPiece); }

/**
 * The look pass: with the ground's shape settled, choose each fill tile (and which of the pieces
 * with the same shape) so the art joins up: the dirt's outline and rim carry on from tile to tile.
 * Each column, then each row, is solved exactly (a shortest path through its choices) with the
 * tiles either side held, a few times over. Only tiles near the surface change; the rest stay
 * dirt. Changes `tiles` in place.
 */
function polish(tiles, chain, x0, x1, kit, tops, rounds = 3) {
  const { seam, isPiece, variants, fills } = kit;
  const H = tiles.length, W = tiles[0].length;
  const PRIOR = 0.04;        // choosing other than the stages' usual tile there
  const onChain = new Set(chain.map((c) => c.y * W + c.x));
  // the choices for each cell (null: it stays as it is) and what it was to begin with
  const cand = new Map(), first = new Map();
  const nearSurface = (x, y) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const t = tiles[y + dy]?.[x + dx];
      if (t === SKY || onChain.has((y + dy) * W + x + dx)) return true;
    }
    return false;
  };
  for (let x = x0; x < x1; x++) for (let y = tops[x - x0]; y < H; y++) {
    const id = tiles[y][x];
    if (id === SKY) continue;
    if (onChain.has(y * W + x)) { const v = variants.get(id); if (v && v.length > 1) cand.set(y * W + x, v); }
    else if (!isPiece.has(id) && nearSurface(x, y)) cand.set(y * W + x, fills);
    if (cand.has(y * W + x)) first.set(y * W + x, id);
  }
  solveLook(tiles, cand, first, kit, rounds);
}

/**
 * The look pass's solver: each cell in `cand` (y * W + x -> the tiles it may be) gets one of its
 * choices so the art joins up, `first` (y * W + x -> tile) being the one to prefer a little. Each
 * column, then each row, of cells with choices is solved exactly (a shortest path through its
 * choices) with the tiles either side held, a few times over. Changes `tiles` in place.
 */
function solveLook(tiles, cand, first, kit, rounds = 3) {
  const { seam } = kit;
  const H = tiles.length, W = tiles[0].length;
  const PRIOR = 0.04;        // choosing other than the stages' usual tile there
  if (!cand.size) return;
  let x0 = W, x1 = 0;
  for (const k of cand.keys()) { const x = k % W; x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); }
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : tiles[y][x]);
  const sm = (a, b, dir) => (a < 0 || b < 0 ? 0 : seam(a, b, dir));
  // one line of cells (a column or a row) solved exactly, the cells beside it held
  const line = (cells, dir) => {
    // dir 1: a column (cells top to bottom; the sides are left and right); 0: a row
    const opts = cells.map(([x, y]) => cand.get(y * W + x) || [tiles[y][x]]);
    const cost = [], back = [];
    cells.forEach(([x, y], i) => {
      const o = opts[i], k0 = first.get(y * W + x);
      const [ax, ay, bx, by] = dir ? [x - 1, y, x + 1, y] : [x, y - 1, x, y + 1];
      const c = new Float64Array(o.length), b = new Int32Array(o.length);
      o.forEach((t, j) => {
        let u = (k0 !== undefined && t !== k0 ? PRIOR : 0);
        u += dir ? sm(at(ax, ay), t, 0) + sm(t, at(bx, by), 0) : sm(at(ax, ay), t, 1) + sm(t, at(bx, by), 1);
        if (i === 0) {
          const [px, py] = dir ? [x, y - 1] : [x - 1, y];
          c[j] = u + sm(at(px, py), t, dir);
        } else {
          let best = Infinity, bi = 0;
          opts[i - 1].forEach((s, k) => { const v = cost[i - 1][k] + seam(s, t, dir); if (v < best) { best = v; bi = k; } });
          c[j] = u + best; b[j] = bi;
        }
        if (i === cells.length - 1) { const [nx, ny] = dir ? [x, y + 1] : [x + 1, y]; c[j] += sm(t, at(nx, ny), dir); }
      });
      cost.push(c); back.push(b);
    });
    let j = 0;
    const last = cost[cost.length - 1];
    for (let k = 1; k < last.length; k++) if (last[k] < last[j]) j = k;
    let changed = false;
    for (let i = cells.length - 1; i >= 0; i--) {
      const [x, y] = cells[i], t = opts[i][j];
      if (tiles[y][x] !== t) { tiles[y][x] = t; changed = true; }
      j = back[i][j];
    }
    return changed;
  };
  // the runs of cells with choices, by column and by row
  const runs = (dir) => {
    const out = [];
    const [na, nb] = dir ? [x1 - x0, H] : [H, x1 - x0];
    for (let a = 0; a < na; a++) {
      let run = [];
      for (let b = 0; b <= nb; b++) {
        const [x, y] = dir ? [x0 + a, b] : [x0 + b, a];
        if (b < nb && cand.has(y * W + x)) run.push([x, y]);
        else if (run.length) { out.push(run); run = []; }
      }
    }
    return out;
  };
  const cols = runs(1), rows = runs(0);
  for (let r = 0; r < rounds; r++) {
    let changed = false;
    for (const c of cols) changed = line(c, 1) || changed;
    for (const c of rows) changed = line(c, 0) || changed;
    if (!changed) break;
  }
}

// ---- which side of a tile is ground, and filling ground in

/** A tile's collision lines (any form). */
function linesOf(kit, id) {
  if (id < 256) return kit.collision[id] || [];
  return (kit.formLines ||= new Map()).get(id) || kit.formLines.set(id, formCollision(kit.collision[baseOf(id)] || [], formOf(id))).get(id);
}

/**
 * How much of each edge of a tile is ground (0 to 1): { top, right, bottom, left }. From its
 * collision lines: a line's ground is on the side away from its normal. A tile with no lines is all
 * ground (dirt, fill) or none (sky).
 */
export function sidesOf(kit, id) {
  const memo = (kit.sides ||= new Map());
  if (memo.has(id)) return memo.get(id);
  const d = linesOf(kit, id);
  let out;
  if (!d.length) { const v = id === SKY ? 0 : 1; out = { top: v, right: v, bottom: v, left: v, surface: false }; }
  else {
    const ground = (px, py) => {
      let best = Infinity, side = 0;
      for (let i = 0; i < d.length; i += 5) {
        const ax = d[i], ay = d[i + 1], bx = d[i + 2], by = d[i + 3], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)), qx = ax + dx * t, qy = ay + dy * t;
        const dist = Math.hypot(px - qx, py - qy);
        if (dist < best) { best = dist; const l = Math.sqrt(l2); side = (px - qx) * (-dy / l) + (py - qy) * (dx / l); }
      }
      return side < 0 ? 1 : 0;
    };
    const edge = (f) => { let g = 0; for (let k = 0; k < 16; k++) g += f(k * 4 + 2); return g / 16; };
    out = { top: edge((v) => ground(v, 0.5)), bottom: edge((v) => ground(v, 62.5)), left: edge((v) => ground(0.5, v)), right: edge((v) => ground(62.5, v)), surface: true };
  }
  memo.set(id, out);
  return out;
}
const GROUND = 0.6;

/**
 * Ground filled in, a column at a time: between ground facing up (above) and ground facing down
 * (below), from the top of the level down to ground facing down, and from ground facing up down to
 * the bottom. Only sky is filled (with dirt); nothing is taken away. `area` limits it
 * ({ x0, y0, x1, y1 }, tiles, inclusive). Returns { tiles, filled: [[x, y], ...] }.
 */
export function fillGround(level, kit, area = null, opts = {}) {
  const W = level.width, H = level.height;
  const tiles = level.tiles.map((r) => r.slice());
  const a = area || { x0: 0, y0: 0, x1: W - 1, y1: H - 1 };
  const filled = [];
  for (let x = Math.max(0, a.x0); x <= Math.min(W - 1, a.x1); x++) {
    const surf = [];
    for (let y = 0; y < H; y++) if (sidesOf(kit, tiles[y][x]).surface) surf.push(y);
    const fill = (from, to) => {
      for (let y = Math.max(from, a.y0); y <= Math.min(to, a.y1); y++) if (tiles[y][x] === SKY) { tiles[y][x] = DIRT; filled.push([x, y]); }
    };
    if (!surf.length) continue;
    const side = (y) => sidesOf(kit, tiles[y][x]);
    if (side(surf[0]).top >= GROUND) fill(0, surf[0] - 1);
    for (let i = 0; i + 1 < surf.length; i++) if (side(surf[i]).bottom >= GROUND && side(surf[i + 1]).top >= GROUND) fill(surf[i] + 1, surf[i + 1] - 1);
    if (side(surf[surf.length - 1]).bottom >= GROUND) fill(surf[surf.length - 1] + 1, H - 1);
  }
  if (opts.look !== false && kit.seam) lookAround(tiles, kit, filled);
  return { tiles, filled };
}

/**
 * Painting tile `id` at (x, y): the ground on its far side filled in down the column (or up, for a
 * ceiling), as far as ground facing the other way or the edge of the level. Changes `tiles`;
 * returns the cells changed. A wall (ground to one side) fills nothing.
 */
export function paintFill(tiles, kit, x, y) {
  const H = tiles.length, s = sidesOf(kit, tiles[y][x]), out = [];
  const go = (dy, stop) => {
    for (let r = y + dy; r >= 0 && r < H; r += dy) {
      const t = sidesOf(kit, tiles[r][x]);
      if (t.surface && stop(t)) break;
      if (tiles[r][x] !== DIRT) { tiles[r][x] = DIRT; out.push([x, r]); }
    }
  };
  if (s.bottom >= GROUND && s.top < GROUND) go(1, (t) => t.top >= GROUND);
  else if (s.top >= GROUND && s.bottom < GROUND) go(-1, (t) => t.bottom >= GROUND);
  return out;
}

/**
 * The look pass around some cells (and the cells next to them): fill tiles chosen, turned the way
 * of the ground near them, and pieces swapped for others of the same shape, so the art joins up.
 */
export function lookAround(tiles, kit, cells, opts = {}) {
  if (!kit.seam || !cells.length) return;
  const H = tiles.length, W = tiles[0].length, keep = opts.keep;
  const cand = new Map(), first = new Map(), seen = new Set();
  const formsNear = (x, y) => {
    const f = new Set();
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const t = tiles[y + dy]?.[x + dx];
      if (t !== undefined && sidesOf(kit, t).surface) f.add(formOf(t) & 3);
    }
    if (!f.size) f.add(0);
    return f;
  };
  const fillsFor = (fs) => { const out = new Set(); for (const r of fs) for (const t of kit.fills) out.add(makeId(t, r)); return [...out]; };
  for (const [cx, cy] of cells) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = cx + dx, y = cy + dy, k = y * W + x;
    if (x < 0 || y < 0 || x >= W || y >= H || seen.has(k)) continue;
    seen.add(k);
    const id = tiles[y][x];
    if (id === SKY || keep?.has(k)) continue;
    if (sidesOf(kit, id).surface) {
      const f = formOf(id), v = f < 4 ? kit.variants.get(baseOf(id)) : null;
      if (v && v.length > 1) { cand.set(k, v.map((b) => makeId(b, f))); first.set(k, id); }
    } else { cand.set(k, fillsFor(formsNear(x, y))); first.set(k, id); }
  }
  solveLook(tiles, cand, first, kit, opts.rounds ?? 2);
}

// ---- paths any way round: walls, overhangs, ceilings

/**
 * Whether a sketch runs left to right throughout (then the stages' way of laying ground, drawPath's,
 * is used): it never goes back, and it has no stretch near vertical (a wall) longer than a tile
 * and a quarter.
 */
function leftToRight(pts) {
  let last = pts[0], steep = 0;
  for (const p of pts) {
    const dx = p[0] - last[0], dy = p[1] - last[1], d = Math.hypot(dx, dy);
    if (d < 12) continue;
    if (dx < -2) return false;
    steep = Math.abs(dy) > 8 * Math.abs(dx) ? steep + d : 0;
    if (steep > 80) return false;
    last = p;
  }
  return true;
}

/**
 * A sketch turned into tiles when it doesn't simply run left to right: it may go up, down, back
 * over itself (an overhang) or upside down (a ceiling). The ground is on the right-hand side of
 * the way the sketch runs (below it, running left to right). Pieces may be turned (forms 0 to 3).
 * A search like drawPath's, over (edge point, last piece, how far along the sketch).
 */
function drawPathFree(level, sketch, kit, opts = {}) {
  const { T, joins, oById, oByEntry, opieces } = kit;
  const W = level.width, H = level.height;
  // the sketch, every 4 px along it, smoothed
  const raw = [sketch[0]];
  for (const p of sketch) {
    const q = raw[raw.length - 1], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    for (let s = 4; s <= d; s += 4) raw.push([q[0] + (p[0] - q[0]) * s / d, q[1] + (p[1] - q[1]) * s / d]);
    if (d > 0 && raw[raw.length - 1] !== p && Math.hypot(p[0] - raw[raw.length - 1][0], p[1] - raw[raw.length - 1][1]) > 2) raw.push(p);
  }
  const sm = opts.smooth ?? 2, n = raw.length;
  if (n < 4) return null;
  const S = raw.map((_, i) => {
    let x = 0, y = 0, c = 0;
    for (let j = Math.max(0, i - sm); j <= Math.min(n - 1, i + sm); j++) { x += raw[j][0]; y += raw[j][1]; c++; }
    return [x / c, y / c];
  });
  const dirAt = (i) => { const a = S[Math.max(0, i - 3)], b = S[Math.min(n - 1, i + 3)]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
  const turnAt = (i) => Math.abs(wrap(dirAt(Math.min(n - 1, i + 8)) - dirAt(Math.max(0, i - 8))));
  // which samples are near each cell (within a tile and a half)
  const near = new Map();
  S.forEach(([x, y], i) => {
    for (let cy = Math.floor((y - 1.5 * T) / T); cy <= Math.floor((y + 1.5 * T) / T); cy++) {
      if (cy < 0 || cy >= H) continue;
      for (let cx = Math.floor((x - 1.5 * T) / T); cx <= Math.floor((x + 1.5 * T) / T); cx++) {
        if (cx < 0 || cx >= W) continue;
        const k = cy * W + cx;
        if (!near.has(k)) near.set(k, []);
        near.get(k).push(i);
      }
    }
  });
  const KINK = opts.kink ?? 2, UNSEEN = opts.unseenJoin ?? 1.2, PER = opts.perPiece ?? 0.05, ART = opts.art ?? 3;
  const AHEAD = 48;       // samples a piece may reach ahead (192 px)
  // a piece in cell (cx, cy), the last piece having left the sketch at sample k: its cost, and how
  // far along the sketch it leaves it
  const cache = new Map();
  const place = (p, cx, cy, k) => {
    const kb = k >> 2, key = `${p.index},${cx},${cy},${kb}`;
    if (cache.has(key)) return cache.get(key);
    const list = near.get(cy * W + cx);
    let out = null;
    if (list) {
      // the sketch near here, from a little before where the chain has got to, to a way ahead
      const lo = kb * 4 - 8, hi = k + AHEAD, xs = [], ys = [], is = [];
      for (const i of list) if (i >= lo && i <= hi) { xs.push(S[i][0]); ys.push(S[i][1]); is.push(i); }
      const m = is.length;
      // where the piece leaves the sketch: the nearest sample at or after k
      const ox = cx * T + p.outX, oy = cy * T + p.outY;
      let best = Infinity, j0 = -1;
      for (let q = 0; q < m; q++) if (is[q] >= k) { const d = (xs[q] - ox) ** 2 + (ys[q] - oy) ** 2; if (d < best) { best = d; j0 = is[q]; } }
      if (j0 >= 0) {
        let cost = 0;
        for (let i = 1; i < p.pts.length; i++) {
          const [ax, ay] = p.pts[i - 1], [bx, by] = p.pts[i];
          const len = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(len / 8));
          for (let s = 0; s < steps; s++) {
            const t = (s + 0.5) / steps, px = cx * T + ax + (bx - ax) * t, py = cy * T + ay + (by - ay) * t;
            let d2 = Infinity;
            for (let q = 0; q < m; q++) if (is[q] <= j0 + 8) { const d = (xs[q] - px) ** 2 + (ys[q] - py) ** 2; if (d < d2) d2 = d; }
            const d = Number.isFinite(d2) ? Math.sqrt(d2) : 2 * T;
            cost += (d + d * d / 24) * len / steps / T;
          }
        }
        // skipping part of the sketch (a shortcut across a bend)
        cost += Math.max(0, (j0 - k) * 4 - 1.4 * p.len) / T;
        for (const [, , b] of p.bends) cost += KINK * Math.max(0, b - turnAt(k) - 0.05);
        out = { cost, j: Math.max(j0, k) };
      }
    }
    cache.set(key, out);
    return out;
  };
  const joinSeam = (q, X, Y, p, cx, cy) => {
    if (!kit.seam) return 0;
    const lx = (X - q.outX) / T, ly = (Y - q.outY) / T;
    if (ly === cy && lx + 1 === cx) return kit.seam(q.id, p.id, 0);
    if (ly === cy && lx - 1 === cx) return kit.seam(p.id, q.id, 0);
    if (lx === cx && ly === cy + 1) return kit.seam(p.id, q.id, 1);
    if (lx === cx && ly + 1 === cy) return kit.seam(q.id, p.id, 1);
    return 0;
  };

  // the ground already there, where the sketch starts and ends: pieces leaving (or coming in) near it
  const existing = (end, which) => {
    const out = [];
    const [ex, ey] = end;
    for (let cy = Math.floor(ey / T) - 2; cy <= Math.floor(ey / T) + 2; cy++) for (let cx = Math.floor(ex / T) - 2; cx <= Math.floor(ex / T) + 2; cx++) {
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      const p = oById.get(level.tiles[cy][cx]);
      if (!p) continue;
      const X = cx * T + (which === 'out' ? p.outX : p.inX), Y = cy * T + (which === 'out' ? p.outY : p.inY);
      if (Math.hypot(X - ex, Y - ey) <= 1.5 * T) out.push({ X, Y, p, cx, cy });
    }
    return out;
  };
  const startJoins = existing(S[0], 'out'), endJoins = existing(S[n - 1], 'in');
  const endAt = new Map(endJoins.map((e) => [`${e.X},${e.Y}`, e]));

  const heap = new Heap(), best = new Map(), from = new Map();
  const push = (X, Y, last, k, cost, prev, cell) => {
    const key = `${X},${Y},${last},${k >> 3}`;
    const had = best.get(key);
    if (had !== undefined && had <= cost) return;
    best.set(key, cost); from.set(key, { prev, cell });
    heap.push(cost, key, X, Y, last, k);
  };
  for (const e of startJoins) push(e.X, e.Y, e.p.index, 0, Math.hypot(e.X - S[0][0], e.Y - S[0][1]) / T * 0.5, null, null);
  // or anywhere near the start
  const [sx0, sy0] = S[0];
  for (let cy = Math.floor(sy0 / T) - 1; cy <= Math.floor(sy0 / T) + 1; cy++) for (let cx = Math.floor(sx0 / T) - 1; cx <= Math.floor(sx0 / T) + 1; cx++) {
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
    for (const k of oByEntry.keys()) {
      const [ix, iy] = k.split(',').map(Number), X = cx * T + ix, Y = cy * T + iy, d = Math.hypot(X - sx0, Y - sy0);
      if (d <= 1.2 * T) push(X, Y, -1, 0, d / T * 2 + (startJoins.length ? 1 : 0), null, null);
    }
  }
  const [ex0, ey0] = S[n - 1];
  let done = null, pops = 0;
  const LIMIT = opts.limit ?? 400000;
  while (heap.size && pops++ < LIMIT) {
    const [cost, key, X, Y, last, k] = heap.pop();
    if (best.get(key) < cost) continue;
    if (done && cost >= done.cost) break;
    if (k >= n - 9 && last >= 0) {
      const e = endAt.get(`${X},${Y}`), lp = opieces[last];
      const extra = e ? (joins.has(lp.base * 1024 + e.p.base) && lp.form === e.p.form ? 0 : UNSEEN * 0.5)
        : Math.hypot(X - ex0, Y - ey0) / T * 2 + (endJoins.length ? 1 : 0);
      if (!done || cost + extra < done.cost) done = { cost: cost + extra, key };
    }
    const lp = last >= 0 ? opieces[last] : null;
    const lcx = lp ? (X - lp.outX) / T : -9, lcy = lp ? (Y - lp.outY) / T : -9;
    const gx = Math.floor(X / T), gy = Math.floor(Y / T);
    for (const [cx, cy] of [[gx, gy], [gx - 1, gy], [gx, gy - 1], [gx - 1, gy - 1]]) {
      if (cx < 0 || cy < 0 || cx >= W || cy >= H || (cx === lcx && cy === lcy)) continue;
      const ix = X - cx * T, iy = Y - cy * T;
      if (ix < 0 || ix > T || iy < 0 || iy > T) continue;
      for (const p of oByEntry.get(`${ix},${iy}`) || []) {
        const r = place(p, cx, cy, k);
        if (!r) continue;
        let c = cost + r.cost + PER;
        if (lp) {
          if (!(joins.has(lp.base * 1024 + p.base) && lp.form === p.form)) c += UNSEEN;
          c += KINK * Math.max(0, Math.abs(wrap(p.aIn - lp.aOut)) - turnAt(k) - 0.05);
          c += ART * joinSeam(lp, X, Y, p, cx, cy);
        }
        push(cx * T + p.outX, cy * T + p.outY, p.index, r.j, c, key, { x: cx, y: cy, id: p.id });
      }
    }
  }
  if (!done) return null;
  const chain = [];
  for (let key = done.key; key && from.get(key)?.cell; key = from.get(key).prev) chain.unshift(from.get(key).cell);
  if (!chain.length) return null;
  const tiles = buildFree(level, chain, kit, opts);
  return { chain, tiles, x0: Math.min(...chain.map((c) => c.x)), x1: Math.max(...chain.map((c) => c.x)) + 1, free: true };
}

/**
 * The tiles around a chain laid any way round. Each column it passes through: the chain; between
 * two of its pieces, ground or sky by which side of the upper one is ground; beyond its last piece
 * that way, ground up to ground facing the other way (or the edge of the level), or sky as far as
 * the old ground went (to its first sky). Then the look pass.
 */
function buildFree(level, chain, kit, opts = {}) {
  const W = level.width, H = level.height;
  const tiles = level.tiles.map((r) => r.slice());
  const cols = new Map();
  for (const c of chain) {
    tiles[c.y][c.x] = c.id;
    if (!cols.has(c.x)) cols.set(c.x, []);
    cols.get(c.x).push(c.y);
  }
  const onChain = new Set(chain.map((c) => c.y * W + c.x));
  const changed = [];
  const put = (x, y, id) => { if (tiles[y][x] !== id) { tiles[y][x] = id; changed.push([x, y]); } };
  for (const [x, ys] of cols) {
    ys.sort((p, q) => p - q);
    const side = (y) => sidesOf(kit, tiles[y][x]);
    for (let i = 0; i + 1 < ys.length; i++) {
      const g = side(ys[i]).bottom >= 0.5;
      for (let y = ys[i] + 1; y < ys[i + 1]; y++) put(x, y, g ? DIRT : SKY);
    }
    const top = ys[0], bottom = ys[ys.length - 1];
    // (up only from a real ceiling, ground on top and sky under; ground goes down from anything with
    // ground underneath)
    if (side(top).top >= GROUND && side(top).bottom < 0.4) {
      for (let y = top - 1; y >= 0; y--) { const t = sidesOf(kit, tiles[y][x]); if (t.surface && t.bottom >= GROUND && t.top < GROUND) break; put(x, y, DIRT); }
    } else for (let y = top - 1; y >= 0 && level.tiles[y][x] !== SKY; y--) put(x, y, SKY);
    if (side(bottom).bottom >= GROUND) {
      for (let y = bottom + 1; y < H; y++) { const t = sidesOf(kit, tiles[y][x]); if (t.surface && t.top >= GROUND && t.bottom < GROUND) break; put(x, y, DIRT); }
    } else for (let y = bottom + 1; y < H && level.tiles[y][x] !== SKY; y++) put(x, y, SKY);
  }
  if (opts.look !== false) lookAround(tiles, kit, [...changed, ...chain.map((c) => [c.x, c.y])], { rounds: 3 });
  // the chain's own pieces stay where they are (only swapped for others of the same shape)
  for (const c of chain) if (!onChain.has(c.y * W + c.x)) tiles[c.y][c.x] = c.id;
  return tiles;
}

/** A small binary heap of [cost, ...data]. */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  peek() { return this.a[0]?.[0]; }
  push(cost, ...data) {
    const a = this.a; a.push([cost, ...data]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}
