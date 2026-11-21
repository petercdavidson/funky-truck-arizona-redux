// assets.js — loads images and level data, and prepares tiles.

import { TILE } from './game.js';

const IMAGE_FILES = [
  'bg.jpg', 'tiles_rgb.jpg', 'tiles_alpha.png',
  'screen_help.png', 'screen_garage.png', 'screen_practice.png', 'screen_plain.png',
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

// Fonts already installed on the player's device, so the game ships no font files.
export const HUD_FONT = '"Arial Rounded MT Bold", "Varela Round", "Nunito", "Avenir Next", system-ui, sans-serif';
export const TITLE_FONT = '"Avenir Next", Avenir, "Nunito", "Segoe UI", system-ui, sans-serif';

export async function loadAssets(base = 'assets/', onProgress = () => {}) {
  const [levels, frames] = await Promise.all([
    fetch(base + 'levels.json').then((r) => r.json()),
    fetch(base + 'sprites.json').then((r) => r.json()),
  ]);
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

  return { levels, sprites, images, tiles: buildTiles(images['tiles_rgb.jpg'], images['tiles_alpha.png']) };
}
