// vector.js — draws the game's vector art (assets/vector.json) on a 2D canvas.
//
// A drawing is a list of shapes: { d: SVG path data, fill, rule?, alpha? }. `fill` is a CSS colour
// or a gradient: { type: 'linear', x0, y0, x1, y1, stops } / { type: 'radial', x, y, r, stops },
// with stops as [[offset, colour], ...]. If `clip` is set on a drawing, every shape after the
// first is clipped to the first (the silhouette), so colour regions never spill past the outline.
// Everything is drawn from paths, so it stays sharp at any size.

const paths = new WeakMap();

function path(shape) {
  let p = paths.get(shape);
  if (!p) { p = new Path2D(shape.d); paths.set(shape, p); }
  return p;
}

function paint(ctx, fill) {
  if (typeof fill === 'string') return fill;
  let g;
  if (fill.type === 'radial') g = ctx.createRadialGradient(fill.x, fill.y, 0, fill.x, fill.y, fill.r);
  else g = ctx.createLinearGradient(fill.x0, fill.y0, fill.x1, fill.y1);
  for (const [o, c] of fill.stops) g.addColorStop(o, c);
  return g;
}

/** Gradients depend on the context, so cache them per context and shape. */
const gradients = new WeakMap();
function fillStyle(ctx, shape) {
  if (typeof shape.fill === 'string') return shape.fill;
  let m = gradients.get(ctx);
  if (!m) { m = new WeakMap(); gradients.set(ctx, m); }
  let g = m.get(shape);
  if (!g) { g = paint(ctx, shape.fill); m.set(shape, g); }
  return g;
}

/** Draw one drawing ({ shapes, clip? }) at the current transform. */
export function drawVector(ctx, drawing) {
  const shapes = drawing.shapes;
  if (!shapes.length) return;
  const first = shapes[0];
  ctx.fillStyle = fillStyle(ctx, first);
  if (first.alpha !== undefined) ctx.globalAlpha *= first.alpha;
  ctx.fill(path(first), first.rule || 'nonzero');
  if (first.alpha !== undefined) ctx.globalAlpha /= first.alpha;
  if (shapes.length === 1) return;
  if (drawing.clip) { ctx.save(); ctx.clip(path(first), first.rule || 'nonzero'); }
  for (let i = 1; i < shapes.length; i++) {
    const s = shapes[i];
    ctx.fillStyle = fillStyle(ctx, s);
    if (s.alpha !== undefined) { ctx.save(); ctx.globalAlpha *= s.alpha; }
    ctx.fill(path(s), s.rule || 'nonzero');
    if (s.alpha !== undefined) ctx.restore();
  }
  if (drawing.clip) ctx.restore();
}

/** Render a drawing into a new canvas `size` device pixels square, covering `units` drawing units. */
export function rasterize(drawing, size, units, makeCanvas) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.scale(size / units, size / units);
  drawVector(ctx, drawing);
  return c;
}
