// assets.js — loads images and level data, and prepares tiles.

import { TILE, unpackLevel } from './game.js';
import { baseOf, formOf, formMatrix } from './tile-forms.js';

const IMAGE_FILES = [
  'bg.jpg', 'tiles_rgb.jpg', 'tiles_alpha.png',
  'screen_help.png', 'screen_garage.png', 'screen_practice.png', 'screen_plain.png',
  'tumbleweed.png', 'missile.png',
];

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Lets the game read the tile pixels when the images come from another origin (a CDN, or a
    // preview service such as raw.githack.com). Harmless when they come from the same site.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Multiply an image's colour channels by `mul` (Flash colour transform), returning a canvas. */
function tint(img, mul) {
  const c = makeCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i] *= mul; d.data[i + 1] *= mul; d.data[i + 2] *= mul;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

/**
 * Tile `id`'s image: a sheet tile turned or flipped (src/tile-forms.js), made the first time it's
 * needed and kept in `a.tiles`.
 */
export function tileImage(a, id) {
  if (a.tiles[id]) return a.tiles[id];
  const c = makeCanvas(TILE, TILE), g = c.getContext('2d'), [p, q, r, s] = formMatrix(formOf(id));
  g.setTransform(p, r, q, s, TILE / 2, TILE / 2);
  g.drawImage(a.tiles[baseOf(id)], -TILE / 2, -TILE / 2);
  a.tiles[id] = c;
  return c;
}

/**
 * B1D03: merge the RGB tile sheet with the separate alpha sheet (red channel -> alpha),
 * then cut it into individual 64x64 tiles (row-major, 10 per row). Separate canvases avoid
 * neighbouring tiles bleeding into each other when scaled.
 */
function buildTiles(rgb, alpha) {
  const w = rgb.width, h = rgb.height;
  const sheet = makeCanvas(w, h);
  const ctx = sheet.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(alpha, 0, 0);
  const a = ctx.getImageData(0, 0, w, h).data;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(rgb, 0, 0);
  const c = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < c.data.length; i += 4) c.data[i + 3] = a[i];
  ctx.putImageData(c, 0, 0);
  const tiles = [];
  for (let r = 0; r < h / TILE; r++) {
    for (let col = 0; col < w / TILE; col++) {
      const t = makeCanvas(TILE, TILE);
      t.getContext('2d').drawImage(sheet, col * TILE, r * TILE, TILE, TILE, 0, 0, TILE, TILE);
      tiles.push(t);
    }
  }
  return tiles;
}

// ---- body paint
//
// Each body sprite is one paint colour, shaded, plus a window. These are the colour clusters of
// each body's pixels (found once with k-means): the window's glass first, then three shades of
// paint. A pixel is glass when the glass colour is the nearest of the four.
const BODY_COLOURS = [
  [[126, 139, 70], [183, 161, 55], [206, 186, 92], [201, 197, 149]],
  [[108, 129, 65], [192, 83, 54], [210, 116, 86], [217, 130, 102]],
  [[120, 142, 69], [150, 185, 63], [166, 200, 83], [179, 210, 105]],
  [[58, 136, 102], [73, 178, 189], [101, 197, 208], [122, 210, 219]],
  [[132, 139, 126], [192, 213, 215], [216, 233, 235], [228, 241, 242]],
  [[105, 123, 90], [122, 144, 104], [143, 165, 125], [157, 178, 141]],
];

/** The bodies' paint colours (the two main shades of each), for things drawn in the game's own colours. */
export const BODY_PAINTS = BODY_COLOURS.flatMap((c) => c.slice(1, 3).map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`));

function toHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1)), m = l - c / 2;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** How much of a pixel is glass (0 to 1), softened at the window's edge. */
function glassShare(k, r, g, b) {
  const dist = (c) => Math.hypot(r - c[0], g - c[1], b - c[2]);
  const [glass, ...paint] = BODY_COLOURS[k];
  const dg = dist(glass), dp = Math.min(...paint.map(dist));
  return Math.max(0, Math.min(1, 0.5 + (dp - dg) / 16));
}

/** A body's paint colour (hue, saturation, lightness), averaged over its painted pixels. */
function paintOf(k, img) {
  const d = img.getContext('2d').getImageData(0, 0, img.width, img.height).data;
  let hx = 0, hy = 0, s = 0, l = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128 || glassShare(k, d[i], d[i + 1], d[i + 2]) > 0) continue;
    const [ph, ps, pl] = toHsl(d[i], d[i + 1], d[i + 2]);
    hx += Math.cos(ph * Math.PI / 180) * ps; hy += Math.sin(ph * Math.PI / 180) * ps;
    s += ps; l += pl; n++;
  }
  return [Math.atan2(hy, hx) * 180 / Math.PI, s / n, l / n];
}

/**
 * Body `k` repainted in colour `to` (a paint from paintOf): each painted pixel's hue moves by
 * the difference between the two paints, its saturation scales, and its lightness is remapped so
 * the old paint's lightness becomes the new one's (keeping black and white where they are).
 * The window is left alone.
 */
function repaint(k, img, from, to) {
  const c = makeCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height), d = id.data;
  const [fh, fs, fl] = from, [th, ts, tl] = to;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const w = 1 - glassShare(k, r, g, b);
    if (w === 0) continue;
    const [h, s, l] = toHsl(r, g, b);
    const nl = l <= fl ? l / fl * tl : tl + (l - fl) / (1 - fl) * (1 - tl);
    const [nr, ng, nb] = fromHsl(h + th - fh, Math.min(1, s * ts / fs), nl);
    d[i] = r + (nr - r) * w; d[i + 1] = g + (ng - g) * w; d[i + 2] = b + (nb - b) * w;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

/** paints[body][colour]: a sprite frame of each body in each body's paint. */
function buildPaints(bodies) {
  const imgs = bodies.map((f) => {
    const c = makeCanvas(f.img.width, f.img.height);
    c.getContext('2d', { willReadFrequently: true }).drawImage(f.img, 0, 0);
    return c;
  });
  const colours = imgs.map((img, k) => paintOf(k, img));
  return bodies.map((f, k) => colours.map((to, j) => (j === k ? f : { ...f, img: repaint(k, imgs[k], colours[k], to) })));
}

// Fonts already installed on the player's device, so the game ships no font files.
export const HUD_FONT = '"Arial Rounded MT Bold", "Varela Round", "Nunito", "Avenir Next", system-ui, sans-serif';
export const TITLE_FONT = '"Avenir Next", Avenir, "Nunito", "Segoe UI", system-ui, sans-serif';

export async function loadAssets(base = 'assets/', onProgress = () => {}) {
  const [levels, frames, stunts] = await Promise.all([
    fetch(base + 'levels.json').then((r) => r.json()),
    fetch(base + 'sprites.json').then((r) => r.json()),
    // Practice's stunt tracks (built by tools/make-stunts.mjs); the game manages without them.
    fetch(base + 'stunts.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
  ]);
  levels.stunts = Array.isArray(stunts) ? stunts.map(unpackLevel) : [];
  const spriteFiles = new Set();
  for (const list of Object.values(frames)) for (const f of list) spriteFiles.add(f.file);
  const files = [...IMAGE_FILES, ...spriteFiles];
  let done = 0;
  const images = {};
  await Promise.all(files.map(async (f) => {
    images[f] = await loadImage(base + f);
    onProgress(++done / files.length);
  }));

  // Sprite frames: an image (pre-tinted where the original used a colour transform) plus the
  // Flash registration offset.
  const sprites = {};
  for (const [key, list] of Object.entries(frames)) {
    sprites[key] = list.map((f) => ({
      img: f.mul !== 1 ? tint(images[f.file], f.mul) : images[f.file],
      tx: f.tx, ty: f.ty, sx: f.sx, sy: f.sy,
    }));
  }

  return {
    levels, sprites, images,
    tiles: buildTiles(images['tiles_rgb.jpg'], images['tiles_alpha.png']),
    paints: buildPaints(sprites.body),
  };
}
