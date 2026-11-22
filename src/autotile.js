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
  const sorted = [...raw].sort((p, q) => p - q), canon = new Map();
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] - sorted[j] <= 1) j++;
    for (let k = i; k <= j; k++) canon.set(sorted[k], sorted[j]);
    i = j + 1;
  }
  const c = (v) => canon.get(snap(v)) ?? snap(v);

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
  const kit = { T, pieces, byId, byEntry, isPiece, joins, fillPick, variants, fills };
  if (opts.edges) Object.assign(kit, artOf(opts.edges));
  return kit;
}

// ---- the look: how well tiles' art meets at their edges (src/tile-art.js)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * `seam(a, b, dir)`: how badly tile a's art meets tile b's: dir 0 is a left of b, 1 a above b. 0 is
 * seamless; 1 is opaque against clear all along the edge. Counts the dirt's outline (opacity) not
 * lining up, and where both are dirt, a jump in brightness (the rim against plain dirt).
 */
function artOf(edges) {
  const n = edges.length, A = new Float32Array(n * 128), Lu = new Float32Array(n * 128);
  edges.forEach((s, id) => {
    for (let e = 0; e < 4; e++) for (let k = 0; k < 32; k++) {
      A[id * 128 + e * 32 + k] = B64.indexOf(s[e * 64 + k]) / 63;
      Lu[id * 128 + e * 32 + k] = B64.indexOf(s[e * 64 + 32 + k]);
    }
  });
  const cache = new Float32Array(n * n * 2).fill(-1);
  const seam = (a, b, dir) => {
    if (a >= n || b >= n) return 0;
    const i = (a * n + b) * 2 + dir;
    let c = cache[i];
    if (c >= 0) return c;
    const ea = a * 128 + (dir ? 64 : 32), eb = b * 128 + (dir ? 0 : 96);
    c = 0;
    for (let k = 0; k < 32; k++) {
      const pa = A[ea + k], pb = A[eb + k];
      // brightness: a line that carries on a pixel or two along still looks joined
      const la = Lu[ea + k], lb = Lu[eb + k];
      let dl = Math.abs(la - lb);
      if (k > 0) dl = Math.min(dl, (Math.abs(la - Lu[eb + k - 1]) + Math.abs(Lu[ea + k - 1] - lb)) / 2);
      if (k < 31) dl = Math.min(dl, (Math.abs(la - Lu[eb + k + 1]) + Math.abs(Lu[ea + k + 1] - lb)) / 2);
      c += Math.abs(pa - pb) + Math.min(pa, pb) * Math.min(1, dl * 0.08);
    }
    return (cache[i] = c / 32);
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
  if (!cand.size) return;
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
