// trace.js — turns raster art into vector shapes (used by tools/vectorize.mjs, runs in a browser).
//
// A "shape" is { d: SVG path data, fill: '#rrggbb' | gradient, rule?: 'evenodd' }, where a gradient
// is { type: 'linear', x0, y0, x1, y1, stops: [[offset, '#rrggbb'], ...] } or
// { type: 'radial', x, y, r, stops }. src/vector.js draws these with Path2D.
//
// Method: quantise the opaque pixels into a few colours (k-means), build a soft mask per colour,
// trace each mask's 0.5 contour with marching squares (sub-pixel accurate), simplify, and emit
// smooth quadratic curves (keeping sharp corners). Each colour region gets the linear or radial
// gradient that best fits its pixels, so the soft shading of the original art survives.

const hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

/** Tiny seeded PRNG so a re-run gives the same output. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** k-means over colours; points = [[r,g,b,weight]]. Returns centres sorted by total weight (desc). */
export function kmeans(points, k, seed = 1) {
  const rand = rng(seed);
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const centres = [points[Math.floor(rand() * points.length)].slice(0, 3)];
  while (centres.length < k) { // k-means++
    const w = points.map((p) => Math.min(...centres.map((c) => d2(p, c))) * p[3]);
    let r = rand() * w.reduce((a, b) => a + b, 0);
    let i = 0;
    for (; i < w.length - 1 && r > w[i]; i++) r -= w[i];
    centres.push(points[i].slice(0, 3));
  }
  let assign = new Array(points.length).fill(0);
  for (let it = 0; it < 30; it++) {
    assign = points.map((p) => { let best = 0, bd = Infinity; centres.forEach((c, j) => { const d = d2(p, c); if (d < bd) { bd = d; best = j; } }); return best; });
    const sum = centres.map(() => [0, 0, 0, 0]);
    points.forEach((p, i) => { const s = sum[assign[i]]; s[0] += p[0] * p[3]; s[1] += p[1] * p[3]; s[2] += p[2] * p[3]; s[3] += p[3]; });
    sum.forEach((s, j) => { if (s[3] > 0) centres[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const weight = centres.map(() => 0);
  points.forEach((p, i) => { weight[assign[i]] += p[3]; });
  return centres.map((c, j) => ({ c, w: weight[j] })).filter((x) => x.w > 0).sort((a, b) => b.w - a.w).map((x) => x.c);
}

export function nearest(c, centres) {
  let best = 0, bd = Infinity;
  centres.forEach((p, j) => { const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; if (d < bd) { bd = d; best = j; } });
  return best;
}

/** Separable Gaussian blur of a w*h Float32Array (edges clamped). */
export function blur(f, w, h, sigma) {
  if (sigma <= 0) return f;
  const r = Math.ceil(sigma * 3), ker = [];
  let ks = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); ker.push(v); ks += v; }
  for (let i = 0; i < ker.length; i++) ker[i] /= ks;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += f[y * w + Math.min(w - 1, Math.max(0, x + i))] * ker[i + r];
    tmp[y * w + x] = s;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] * ker[i + r];
    out[y * w + x] = s;
  }
  return out;
}

/**
 * Marching squares: closed contours of field f (w*h, values at pixel centres) at threshold t.
 * `pad` is the value assumed outside the image, or 'clamp' to repeat the edge pixels (so a shape
 * that touches the edge runs a little past it, which hides seams between tiles).
 * Returns arrays of [x, y] in pixel coordinates (pixel (0,0) covers 0..1).
 */
export function contours(f, w, h, t, pad = 0) {
  const W = w + 2, H = h + 2;
  const g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x - 1, sy = y - 1;
    if (sx >= 0 && sx < w && sy >= 0 && sy < h) g[y * W + x] = f[sy * w + sx];
    else g[y * W + x] = pad === 'clamp' ? f[Math.min(h - 1, Math.max(0, sy)) * w + Math.min(w - 1, Math.max(0, sx))] : pad;
  }
  const v = (x, y) => g[y * W + x];
  const pos = new Map();
  const point = (key, ax, ay, bx, by) => {
    if (!pos.has(key)) {
      const fa = v(ax, ay), fb = v(bx, by);
      const u = fa === fb ? 0.5 : (t - fa) / (fb - fa);
      const off = pad === 'clamp' ? 0.5 : 0.5;
      pos.set(key, [ax + (bx - ax) * u - 1 + off, ay + (by - ay) * u - 1 + off]);
    }
    return key;
  };
  const links = new Map();
  const link = (a, b) => {
    if (!links.has(a)) links.set(a, []);
    if (!links.has(b)) links.set(b, []);
    links.get(a).push(b); links.get(b).push(a);
  };
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
    const tl = v(i, j) >= t, tr = v(i + 1, j) >= t, br = v(i + 1, j + 1) >= t, bl = v(i, j + 1) >= t;
    const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
    if (c === 0 || c === 15) continue;
    const T = () => point(`h${i},${j}`, i, j, i + 1, j);
    const B = () => point(`h${i},${j + 1}`, i, j + 1, i + 1, j + 1);
    const L = () => point(`v${i},${j}`, i, j, i, j + 1);
    const R = () => point(`v${i + 1},${j}`, i + 1, j, i + 1, j + 1);
    const centre = (v(i, j) + v(i + 1, j) + v(i + 1, j + 1) + v(i, j + 1)) / 4 >= t;
    switch (c) {
      case 1: case 14: link(L(), B()); break;
      case 2: case 13: link(B(), R()); break;
      case 3: case 12: link(L(), R()); break;
      case 4: case 11: link(T(), R()); break;
      case 6: case 9: link(T(), B()); break;
      case 7: case 8: link(L(), T()); break;
      case 5: if (centre) { link(L(), T()); link(B(), R()); } else { link(L(), B()); link(T(), R()); } break;
      case 10: if (centre) { link(T(), R()); link(L(), B()); } else { link(L(), T()); link(B(), R()); } break;
    }
  }
  const seen = new Set(), out = [];
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let prev = null, cur = start;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      loop.push(pos.get(cur));
      const next = links.get(cur).find((n) => n !== prev && !seen.has(n));
      prev = cur; cur = next;
    }
    if (loop.length >= 3) out.push(loop);
  }
  return out;
}

function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return a / 2;
}

/** Ramer–Douglas–Peucker on a closed loop. */
export function simplify(loop, tol) {
  if (loop.length < 8) return loop;
  const rdp = (pts) => {
    if (pts.length < 3) return pts;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
    let idx = -1, md = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / L;
      if (d > md) { md = d; idx = i; }
    }
    if (md <= tol) return [a, b];
    const l = rdp(pts.slice(0, idx + 1)), r = rdp(pts.slice(idx));
    return l.slice(0, -1).concat(r);
  };
  // split at the point farthest from the first one
  let far = 0, fd = 0;
  loop.forEach((p, i) => { const d = (p[0] - loop[0][0]) ** 2 + (p[1] - loop[0][1]) ** 2; if (d > fd) { fd = d; far = i; } });
  const a = rdp(loop.slice(0, far + 1)), b = rdp(loop.slice(far).concat([loop[0]]));
  return a.slice(0, -1).concat(b.slice(0, -1));
}

const fmt = (n) => (Math.round(n * 100) / 100).toString();

/** Smooth closed path: quadratic curves through edge midpoints, with sharp corners kept. */
export function toPath(loop, cornerDeg = 55, ox = 0, oy = 0) {
  const n = loop.length;
  const P = loop.map(([x, y]) => [x + ox, y + oy]);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const corner = P.map((p, i) => {
    const a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
    const u = [p[0] - a[0], p[1] - a[1]], v = [b[0] - p[0], b[1] - p[1]];
    const cos = (u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(...u) * Math.hypot(...v)) || 1);
    return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI > cornerDeg;
  });
  const m0 = mid(P[n - 1], P[0]);
  let d = `M${fmt(m0[0])} ${fmt(m0[1])}`;
  for (let i = 0; i < n; i++) {
    const p = P[i], m = mid(p, P[(i + 1) % n]);
    d += corner[i] ? `L${fmt(p[0])} ${fmt(p[1])}L${fmt(m[0])} ${fmt(m[1])}` : `Q${fmt(p[0])} ${fmt(p[1])} ${fmt(m[0])} ${fmt(m[1])}`;
  }
  return d + 'Z';
}

/** Trace a mask field into one path string (all loops, even-odd). Drops specks smaller than minArea. */
export function tracePath(f, w, h, { t = 0.5, pad = 0, tol = 0.35, minArea = 1.2, minThick = 0, ox = 0, oy = 0, cornerDeg = 55 } = {}) {
  const perim = (l) => l.reduce((s, p, i) => s + Math.hypot(p[0] - l[(i + 1) % l.length][0], p[1] - l[(i + 1) % l.length][1]), 0);
  return contours(f, w, h, t, pad)
    .map((l) => simplify(l, tol))
    .filter((l) => l.length >= 3 && Math.abs(polyArea(l)) >= minArea && 2 * Math.abs(polyArea(l)) / perim(l) >= minThick)
    .map((l) => toPath(l, cornerDeg, ox, oy))
    .join('');
}

function solve3(A, b) { // Gaussian elimination, 3x3
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-9) return null;
    for (let r = 0; r < 3; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let k2 = c; k2 < 4; k2++) M[r][k2] -= k * M[c][k2]; }
  }
  return M.map((r, i) => r[3] / M[i][i]);
}

/**
 * Best gradient (or flat colour) for a set of pixels [[x, y, r, g, b, weight]].
 * Tries a linear fit in x/y and, when `centre` is given, a radial fit around it.
 */
export function fitFill(px, centre = null, ox = 0, oy = 0) {
  let W = 0;
  const mean = [0, 0, 0], cx = [0, 0];
  for (const p of px) { W += p[5]; cx[0] += p[0] * p[5]; cx[1] += p[1] * p[5]; for (let k = 0; k < 3; k++) mean[k] += p[2 + k] * p[5]; }
  if (W === 0) return '#000000';
  mean.forEach((_, k) => { mean[k] /= W; }); cx[0] /= W; cx[1] /= W;
  const resid = (pred) => { let s = 0; for (const p of px) { const q = pred(p); for (let k = 0; k < 3; k++) s += (p[2 + k] - q[k]) ** 2 * p[5]; } return s / W; };
  const flatErr = resid(() => mean);
  // linear: colour = a + bx*(x-cx) + by*(y-cy)
  let Sxx = 0, Sxy = 0, Syy = 0; const Sxc = [0, 0, 0], Syc = [0, 0, 0];
  for (const p of px) {
    const dx = p[0] - cx[0], dy = p[1] - cx[1], w = p[5];
    Sxx += dx * dx * w; Sxy += dx * dy * w; Syy += dy * dy * w;
    for (let k = 0; k < 3; k++) { Sxc[k] += dx * (p[2 + k] - mean[k]) * w; Syc[k] += dy * (p[2 + k] - mean[k]) * w; }
  }
  const det = Sxx * Syy - Sxy * Sxy;
  let best = { err: flatErr, fill: hex(mean) };
  if (det > 1e-6) {
    const B = [0, 1, 2].map((k) => [(Syy * Sxc[k] - Sxy * Syc[k]) / det, (Sxx * Syc[k] - Sxy * Sxc[k]) / det]);
    // Direction of strongest luminance change.
    let gx = 0.299 * B[0][0] + 0.587 * B[1][0] + 0.114 * B[2][0];
    let gy = 0.299 * B[0][1] + 0.587 * B[1][1] + 0.114 * B[2][1];
    const gl = Math.hypot(gx, gy);
    if (gl > 1e-6) {
      gx /= gl; gy /= gl;
      const s = px.map((p) => (p[0] - cx[0]) * gx + (p[1] - cx[1]) * gy).sort((a, b) => a - b);
      const s0 = s[Math.floor(s.length * 0.02)], s1 = s[Math.floor(s.length * 0.98)];
      const along = B.map((b) => b[0] * gx + b[1] * gy);
      const col = (sv) => mean.map((m, k) => m + along[k] * sv);
      const pred = (p) => col((p[0] - cx[0]) * gx + (p[1] - cx[1]) * gy);
      const err = resid(pred);
      const change = Math.abs(lum(col(s1)) - lum(col(s0)));
      if (change > 5 && s1 - s0 > 1 && err < best.err * 0.85) {
        best = {
          err,
          fill: {
            type: 'linear',
            x0: +fmt(cx[0] + gx * s0 + ox), y0: +fmt(cx[1] + gy * s0 + oy),
            x1: +fmt(cx[0] + gx * s1 + ox), y1: +fmt(cx[1] + gy * s1 + oy),
            stops: [[0, hex(col(s0))], [1, hex(col(s1))]],
          },
        };
      }
    }
  }
  if (centre) {
    let Srr = 0, Sr = 0; const Src = [0, 0, 0], Sc = [0, 0, 0];
    for (const p of px) {
      const r = Math.hypot(p[0] - centre[0], p[1] - centre[1]), w = p[5];
      Srr += r * r * w; Sr += r * w;
      for (let k = 0; k < 3; k++) { Src[k] += r * p[2 + k] * w; Sc[k] += p[2 + k] * w; }
    }
    const dd = W * Srr - Sr * Sr;
    if (dd > 1e-6) {
      const b = [0, 1, 2].map((k) => (W * Src[k] - Sr * Sc[k]) / dd);
      const a = [0, 1, 2].map((k) => (Sc[k] - b[k] * Sr) / W);
      const rs = px.map((p) => Math.hypot(p[0] - centre[0], p[1] - centre[1])).sort((x, y) => x - y);
      const r0 = rs[Math.floor(rs.length * 0.01)], r1 = rs[Math.floor(rs.length * 0.99)];
      const col = (r) => a.map((v, k) => v + b[k] * r);
      const err = resid((p) => col(Math.hypot(p[0] - centre[0], p[1] - centre[1])));
      if (err < best.err * 0.85 && r1 > 1) {
        const o0 = r0 / r1;
        best = {
          err,
          fill: { type: 'radial', x: +fmt(centre[0] + ox), y: +fmt(centre[1] + oy), r: +fmt(r1), stops: [[+o0.toFixed(3), hex(col(r0))], [1, hex(col(r1))]] },
        };
      }
    }
  }
  return best.fill;
}

/**
 * Trace a sprite (ImageData-like {width, height, data}) into layered shapes.
 * The first shape is the silhouette; the rest are colour regions drawn clipped to it.
 * opts: k (colours), sigma (mask blur), centre ([x,y] for radial fits), ox/oy (offset added to
 * every coordinate, e.g. the sprite's registration offset), tol, minArea.
 */
export function traceSprite(img, opts = {}) {
  const { width: w, height: h, data } = img;
  const { k = 6, sigma = 0.7, centre = null, ox = 0, oy = 0, tol = 0.3, minArea = 1.5, minThick = 0.9, seed = 7, grow = 0.42, passes = 2 } = opts;
  const alpha = new Float32Array(w * h);
  const pts = [], pix = [];
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    alpha[i] = a;
    if (a > 0.35) { const c = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]; pts.push([...c, a]); pix.push(i); }
  }
  const shapes = [];
  const sil = tracePath(alpha, w, h, { t: 0.5, tol: 0.25, ox, oy, minArea });
  const all = pix.map((i) => [i % w + 0.5, Math.floor(i / w) + 0.5, data[i * 4], data[i * 4 + 1], data[i * 4 + 2], alpha[i]]);
  shapes.push({ d: sil, fill: fitFill(all, centre, ox, oy), rule: 'evenodd' });
  if (k <= 1 || pts.length < 4) return shapes;
  const centres = kmeans(pts, k, seed);
  const label = new Int16Array(w * h).fill(-1);
  pix.forEach((i, n) => { label[i] = nearest(pts[n], centres); });
  // Majority filter: removes the thin rings of in-between colours that anti-aliasing leaves
  // along every edge, which would otherwise trace as slivers.
  for (let pass = 0; pass < passes; pass++) {
    const prev = label.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (prev[i] < 0) continue;
      const count = new Map();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const l = prev[yy * w + xx];
        if (l >= 0) count.set(l, (count.get(l) || 0) + (dx === 0 && dy === 0 ? 1.5 : 1));
      }
      let best = prev[i], bc = 0;
      for (const [l, c] of count) if (c > bc) { bc = c; best = l; }
      label[i] = best;
    }
  }
  // Biggest regions first; skip the very biggest, which the silhouette fill already covers well
  // unless its colour differs a lot from the silhouette's fit.
  centres.forEach((_, j) => {
    const m = new Float32Array(w * h);
    const mine = [];
    for (let i = 0; i < w * h; i++) if (label[i] === j) { m[i] = 1; mine.push([i % w + 0.5, Math.floor(i / w) + 0.5, data[i * 4], data[i * 4 + 1], data[i * 4 + 2], alpha[i]]); }
    if (mine.length < 3) return;
    const d = tracePath(blur(m, w, h, sigma), w, h, { t: grow, tol, ox, oy, minArea, minThick });
    if (d) shapes.push({ d, fill: fitFill(mine, centre, ox, oy), rule: 'evenodd' });
  });
  return shapes;
}
