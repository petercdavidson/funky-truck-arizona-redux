// render.js — draws the game onto a 2D canvas.
//
// All drawing uses the original 576x448 stage coordinates (y down, clockwise rotation), scaled to
// the canvas. Tiles are drawn in device pixels with snapped edges so they never show seams.

import { TILE, STAGE_W, STAGE_H, STAGE_NAMES } from './game.js';
import { HUD_FONT, TITLE_FONT } from './assets.js';
import { TRICK } from './tricks.js';
import { VERSION, BUILD } from './version.js';
import { Wreck } from './wreck.js';

const DEG = Math.PI / 180;
const FILL_SCREENS = new Set(['playing', 'paused', 'gameOver']);
const MENU_SCREENS = new Set(['title', 'help', 'garage', 'practiceSelect']);
const FILL_TILE = 1;   // solid dirt
const BUTTON_FILL = 'rgba(107, 74, 64, 0.92)';

// ---------------------------------------------------------------------------------------------
// Clickable areas per screen. `label` buttons are drawn by us; the rest are hotspots over the
// original art. `show(game)` hides a button when it returns false. Actions are handled in main.js.
//
// Each screen has two layouts. BUTTONS is the usual one, on the original 576x448 stage, with the
// options as small on/off switches down the right-hand side. TALL_BUTTONS is for windows at least
// as tall as they are wide (a phone held upright): a narrower page, TALL_W across and TALL_H[screen]
// down, that is scaled up to fill the width, with everything in one column.

const r = (x, y, w, h) => ({ x, y, w, h });
const onOff = (v) => (v ? 'On' : 'Off');
const option = (y, label, action) => ({ rect: r(428, y, 132, 20), label, action, small: true });

const TITLE_OPTIONS = [
  [(g) => `♪ Sound: ${onOff(g.soundOn)}`, 'sound'],
  [(g) => `One Button: ${onOff(g.oneButton)}`, 'oneButton'],
  [(g) => `Dynamic Camera: ${onOff(g.dynamicCamera)}`, 'dynamicCamera'],
];
const MODES = [['Play', 'play'], ['Classic', 'classic'], ['Endless', 'endless'], ['Practice', 'practice'], ['Change Truck', 'garage']];
const PRACTICE_OPTIONS = [
  [(g) => `Damage: ${onOff(g.practiceDamage)}`, 'practiceDamage'],
  [(g) => `Classic: ${onOff(g.practiceClassic)}`, 'practiceClassic'],
];
const LOOK_PARTS = ['body', 'paint', 'tyre', 'hub'];
/** The garage's note that the truck's look is only a look. */
const COSMETIC = 'Looks only: every truck drives exactly the same';

/**
 * The pause menu's buttons, placed by `place(i)`. Each kind of run gets its own column: Endless
 * can end the run, and Classic has no controls switch (it always uses the original controls).
 */
function pauseButtons(place) {
  return [['endless', (g) => g.mode === 'endless'], ['classic', (g) => g.mode !== 'endless' && g.rules.classic],
    ['other', (g) => g.mode !== 'endless' && !g.rules.classic]].flatMap(([kind, when]) => [
    { label: 'Resume', action: 'resume' },
    kind === 'endless' && { label: 'End Run', action: 'endRun' },
    { label: 'Quit to Menu', action: 'menu' },
    { label: (g) => `Sound: ${onOff(g.soundOn)}`, action: 'sound' },
    kind !== 'classic' && { label: (g) => `Controls: ${g.oneButton ? 'One Button' : 'Standard'}`, action: 'oneButton' },
  ].filter(Boolean).map((b, i) => ({ ...b, rect: place(i), show: when })));
}

/**
 * The game-over buttons. Practice gets four in a 2x2 grid (placed by `grid(i)`): the same stage
 * again, the next stage (if there is one), the stage list, and the main menu. Other runs get Play
 * Again and Menu in a column (placed by `column(i)`).
 */
function gameOverButtons(column, grid) {
  const practice = (g) => g.mode === 'practice', other = (g) => g.mode !== 'practice';
  return [
    { label: 'Play Again', action: 'again', rect: column(0), show: other },
    { label: 'Menu', action: 'menu', rect: column(1), show: other },
    { label: 'Again', action: 'again', rect: grid(0), show: practice },
    { label: 'Next', action: 'nextStage', rect: grid(1), show: (g) => practice(g) && g.hasNextPractice },
    { label: 'Stages', action: 'practice', rect: grid(2), show: practice },
    { label: 'Menu', action: 'menu', rect: grid(3), show: practice },
  ];
}

export const BUTTONS = {
  title: [
    ...MODES.map(([label, action], i) => ({ rect: r(229, 250 + 28 * i, 120, 25), label, action })),
    { rect: r(238, 425, 100, 17), label: 'How to Play', action: 'help', small: true },
    ...TITLE_OPTIONS.map(([label, action], i) => option(252 + 24 * i, label, action)),
  ],
  help: [{ rect: r(229, 386, 120, 25), label: 'Menu', action: 'menu' }],
  garage: [
    { rect: r(229, 413, 120, 25), label: 'Menu', action: 'menu' },
    ...LOOK_PARTS.flatMap((part, i) => [
      { rect: r(200, 226 + 34 * i, 32, 32), action: `${part}-1` },
      { rect: r(344, 226 + 34 * i, 32, 32), action: `${part}+1` },
    ]),
  ],
  practiceSelect: [
    ...Array.from({ length: 9 }, (_, i) => ({ rect: r(136 + 34 * i, 228.05, 32, 32), action: `stage${i}` })),
    { rect: r(229, 413, 120, 25), label: 'Menu', action: 'menu' },
    ...PRACTICE_OPTIONS.map(([label, action], i) => option(290 + 24 * i, label, action)),
  ],
  gameOver: gameOverButtons((i) => r(229, 250 + 31 * i, 120, 25), (i) => r(165 + 126 * (i % 2), 250 + 31 * Math.floor(i / 2), 120, 25)),
  paused: pauseButtons((i) => r(213, 250 + 31 * i, 150, 25)),
  playing: [],
};

export const TALL_W = 360;
export const TALL_H = { title: 690, help: 560, garage: 580, practiceSelect: 490, paused: 410, gameOver: 330 };
/** The tall layouts are used once the view is at least this tall (in stage units, 576 across). */
export const TALL_FROM = 576;
const T_BIG = { size: 15 }, T_SMALL = { small: true, size: 12.5 };
const tallStage = (i) => ({ x: 64 + 80 * (i % 3), y: 80 + 80 * Math.floor(i / 3) });

export const TALL_BUTTONS = {
  title: [
    ...MODES.map(([label, action], i) => ({ rect: r(60, 246 + 43 * i, 240, 35), label, action, ...T_BIG })),
    ...TITLE_OPTIONS.map(([label, action], i) => ({ rect: r(60, 470 + 35 * i, 240, 28), label, action, ...T_SMALL })),
    { rect: r(110, 638, 140, 26), label: 'How to Play', action: 'help', ...T_SMALL },
  ],
  help: [{ rect: r(80, 500, 200, 38), label: 'Menu', action: 'menu', ...T_BIG }],
  garage: [
    { rect: r(80, 532, 200, 38), label: 'Menu', action: 'menu', ...T_BIG },
    ...LOOK_PARTS.flatMap((part, i) => [
      { rect: r(30, 268 + 56 * i, 48, 48), action: `${part}-1` },
      { rect: r(282, 268 + 56 * i, 48, 48), action: `${part}+1` },
    ]),
  ],
  practiceSelect: [
    ...Array.from({ length: 9 }, (_, i) => ({ rect: r(tallStage(i).x, tallStage(i).y, 72, 72), action: `stage${i}` })),
    ...PRACTICE_OPTIONS.map(([label, action], i) => ({ rect: r(60, 340 + 35 * i, 240, 28), label, action, ...T_SMALL })),
    { rect: r(80, 436, 200, 38), label: 'Menu', action: 'menu', ...T_BIG },
  ],
  gameOver: gameOverButtons((i) => ({ ...r(60, 200 + 50 * i, 240, 40), ...T_BIG }),
    (i) => ({ ...r(60 + 125 * (i % 2), 200 + 50 * Math.floor(i / 2), 115, 40), ...T_BIG })),
  paused: pauseButtons((i) => ({ ...r(60, 160 + 48 * i, 240, 40), ...T_BIG })),
  playing: [],
};
// pauseButtons and gameOverButtons put the extra fields in the rect for the tall layout; move
// them onto the button.
for (const b of [...TALL_BUTTONS.paused, ...TALL_BUTTONS.gameOver]) { const { x, y, w, h, ...rest } = b.rect; Object.assign(b, rest); b.rect = { x, y, w, h }; }

/** The buttons a screen shows in the usual or the tall layout. */
export function buttonsFor(screen, tall = false) {
  return ((tall ? TALL_BUTTONS : BUTTONS)[screen]) || [];
}

/** Which run this is, for the pause screen: "Play  ·  Stage Three", "Endless  ·  420 m", ... */
export function runName(game) {
  if (game.mode === 'endless') return `Endless  ·  ${game.metres} m`;
  const stage = STAGE_NAMES[game.level];
  if (game.mode === 'campaign') return `${game.rules.classic ? 'Classic' : 'Play'}  ·  ${stage}`;
  const rules = [game.rules.classic && 'Classic rules', !game.rules.damage && 'no damage'].filter(Boolean);
  return `Practice  ·  ${stage}${rules.length ? `  (${rules.join(', ')})` : ''}`;
}

/** The button at (x, y) in menu coordinates (see Renderer.toMenu), or null. */
export function hitButton(screen, x, y, game, tall = false) {
  return buttonsFor(screen, tall).find((b) => (!b.show || b.show(game))
    && x >= b.rect.x && x < b.rect.x + b.rect.w && y >= b.rect.y && y < b.rect.y + b.rect.h) || null;
}

// ---------------------------------------------------------------------------------------------

export class Renderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.a = assets;
    this.scale = 1;      // device pixels per stage unit
    this.offX = 0; this.offY = 0;
    this.hover = null;
    this.touchMode = false;
  }

  resize(cssW, cssH, dpr) {
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.cssPerDevice = 1 / dpr;
    this.layout(null);
  }

  /**
   * Work out how the view fits the canvas. Driving in Classic shows the original 576x448 stage,
   * letterboxed. Everything else fills the window: it always shows the same 576 units across
   * (what matters for seeing the terrain ahead), and as much height as the window's shape gives.
   * Menus are drawn on a page centred in that view: the original 576x448 stage, or in a view at
   * least as tall as it is wide, the screen's tall layout (TALL_W across), scaled up to fill the
   * width. Sets game.viewH so the camera knows.
   */
  layout(game) {
    const W = this.canvas.width, H = this.canvas.height;
    const screen = game ? game.screen : 'title';
    const letterbox = !!game && game.rules.classic && FILL_SCREENS.has(screen);
    if (!letterbox) {
      this.scale = W / STAGE_W;
      this.viewH = H / this.scale;
      this.offX = 0; this.offY = 0;
    } else {
      this.scale = Math.min(W / STAGE_W, H / STAGE_H);
      this.viewH = STAGE_H;
      this.offX = Math.round((W - STAGE_W * this.scale) / 2);
      this.offY = Math.round((H - STAGE_H * this.scale) / 2);
    }
    this.tall = this.viewH >= TALL_FROM && screen in TALL_H;
    this.page = this.tall ? { w: TALL_W, h: TALL_H[screen] } : { w: STAGE_W, h: STAGE_H };
    // The page fills the width if it can, and shrinks to fit a short view.
    this.menuK = Math.min(STAGE_W / this.page.w, this.viewH / this.page.h);
    // The camera always knows the filled view's height (Classic uses 448 regardless), so a stage
    // started from a menu begins with its camera in the right place.
    if (game) game.viewH = H * STAGE_W / W;
  }

  /** Convert a point in canvas CSS pixels to menu (page) coordinates. */
  toMenu(cssX, cssY) {
    const dx = cssX / this.cssPerDevice, dy = cssY / this.cssPerDevice;
    const x = (dx - this.offX) / this.scale, y = (dy - this.offY) / this.scale;
    const k = this.menuK, P = this.page;
    return [(x - STAGE_W / 2) / k + P.w / 2, (y - this.viewH / 2) / k + P.h / 2];
  }

  /** The inverse of toMenu: a point in menu coordinates to canvas CSS pixels. */
  fromMenu(x, y) {
    const k = this.menuK, P = this.page;
    const sx = (x - P.w / 2) * k + STAGE_W / 2, sy = (y - P.h / 2) * k + this.viewH / 2;
    return [(sx * this.scale + this.offX) * this.cssPerDevice, (sy * this.scale + this.offY) * this.cssPerDevice];
  }

  /** Where the button for `action` on the current screen is, in canvas CSS pixels (for tests). */
  buttonCentre(screen, action, game) {
    const b = buttonsFor(screen, this.tall).find((x) => x.action === action && (!x.show || x.show(game)));
    return b ? this.fromMenu(b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2) : null;
  }

  /** Switch to menu coordinates: the page, centred (and scaled to fit) in the view. */
  menuTransform() {
    const ctx = this.ctx, k = this.menuK, P = this.page;
    ctx.translate(STAGE_W / 2, this.viewH / 2);
    ctx.scale(k, k);
    ctx.translate(-P.w / 2, -P.h / 2);
  }

  stageTransform() {
    this.ctx.setTransform(this.scale, 0, 0, this.scale, this.offX, this.offY);
  }

  // ---- drawing helpers (stage space)

  /** Draw a sprite frame the way Flash places a bitmap in a symbol: top-left at (tx, ty). */
  frame(key, i, f = this.a.sprites[key][i]) {
    const ctx = this.ctx;
    if (f.sx !== 1 || f.sy !== 1) {
      ctx.save();
      ctx.scale(f.sx, f.sy);
      ctx.drawImage(f.img, f.tx / f.sx, f.ty / f.sy);
      ctx.restore();
    } else {
      ctx.drawImage(f.img, f.tx, f.ty);
    }
  }

  text(str, x, y, { size = 13, font = TITLE_FONT, weight = '800', color = '#fff', align = 'center', shadow = null } = {}) {
    const ctx = this.ctx;
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    if (shadow) {
      ctx.fillStyle = shadow;
      ctx.fillText(str, x + size * 0.05, y + size * 0.05);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  roundRect(x, y, w, h, rad, fill, stroke = null, lineWidth = 2) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rad);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
  }

  /** Like text(), but shrinks the font until the line is no wider than maxW. */
  fitText(str, x, y, maxW, opts = {}) {
    const ctx = this.ctx, o = { size: 13, font: TITLE_FONT, weight: '800', ...opts };
    ctx.font = `${o.weight} ${o.size}px ${o.font}`;
    const w = ctx.measureText(str).width;
    this.text(str, x, y, w > maxW ? { ...o, size: o.size * maxW / w } : o);
  }

  /** Centred text wrapped to lines no wider than maxW; returns the y below the last line. */
  wrapText(str, x, y, maxW, opts = {}, lineH = (opts.size || 13) * 1.3) {
    const ctx = this.ctx, o = { size: 13, font: TITLE_FONT, weight: '800', ...opts };
    ctx.font = `${o.weight} ${o.size}px ${o.font}`;
    // Break at the "  ·  " separators where there are any, otherwise between words.
    const parts = str.includes('  ·  ') ? str.split('  ·  ') : str.split(' ');
    const join = str.includes('  ·  ') ? '  ·  ' : ' ';
    let line = '';
    for (const p of parts) {
      const next = line ? line + join + p : p;
      if (line && ctx.measureText(next).width > maxW) { this.text(line, x, y, o); y += lineH; line = p; } else line = next;
    }
    if (line) { this.text(line, x, y, o); y += lineH; }
    return y;
  }

  image(name) { this.ctx.drawImage(this.a.images[name], 0, 0); }

  /** Copy part of an image (stage pixels) to the same place, or to a new rect. */
  piece(name, sx, sy, sw, sh, dx = sx, dy = sy, dw = sw, dh = sh) {
    this.ctx.drawImage(this.a.images[name], sx, sy, sw, sh, dx, dy, dw, dh);
  }

  /**
   * A box from the original art, stretched to (x, y, w, h) without its contents: the left and
   * right ends are copied as they are, and a plain slice just inside the left end fills the middle.
   */
  box(name, sx, sy, sw, sh, x, y, w, h, end = 8) {
    this.piece(name, sx, sy, end, sh, x, y, end, h);
    this.piece(name, sx + end - 2, sy, 2, sh, x + end, y, w - 2 * end, h);
    this.piece(name, sx + sw - end, sy, end, sh, x + w - end, y, end, h);
  }

  buttons(screen, game) {
    for (const b of buttonsFor(screen, this.tall)) {
      if (b.show && !b.show(game)) continue;
      const { x, y, w, h } = b.rect;
      if (b.label) {
        const label = typeof b.label === 'function' ? b.label(game) : b.label;
        const size = b.size || (b.small ? 10 : 11.5);
        this.roundRect(x, y, w, h, this.tall ? 6 : 4, b.small ? 'rgba(107, 74, 64, 0.7)' : BUTTON_FILL);
        this.fitText(label.toUpperCase(), x + w / 2, y + h / 2 - size * 0.55, w - 8, { size, weight: '800' });
      }
      if (this.hover === b) this.roundRect(x, y, w, h, this.tall ? 6 : 4, 'rgba(255,255,255,0.16)');
    }
  }

  // ---- truck (s46B2 / V5195)

  truck(T, rearRot, frontRot, look) {
    const ctx = this.ctx;
    // J5735, k6835 (darker frame), then H3535, i4635: bars from the centre to each point.
    const bars = [[6, 1], [8, 1], [2, 0], [4, 0]];
    for (const [p, fr] of bars) {
      const dx = T[p] - T[0], dy = T[p + 1] - T[1];
      ctx.save();
      ctx.translate(T[0], T[1]);
      ctx.rotate(Math.atan2(dy, dx));
      const s = Math.sqrt(dx * dx + dy * dy) / 64;
      ctx.scale(s, s);
      // _inner is placed with a = -1 at (68, -8)
      ctx.translate(68, -8);
      ctx.scale(-1, 1);
      this.frame('bar', fr);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(T[6], T[7]);
    ctx.rotate(Math.atan2(T[9] - T[7], T[8] - T[6]));
    ctx.scale(0.7, 0.7);
    this.body(look);
    ctx.restore();
    for (const [p, rot] of [[2, rearRot], [4, frontRot]]) {
      ctx.save();
      ctx.translate(T[p], T[p + 1]);
      ctx.rotate(rot * DEG);
      ctx.scale(45 / 72, 45 / 72);
      this.frame('tyre', look.tyre);
      this.frame('hub', look.hub);
      ctx.restore();
    }
  }

  /** The truck's body in its paint. */
  body(look) {
    this.frame('body', look.body, this.a.paints[look.body][look.paint]);
  }

  /** A suspension bar from point (ax, ay) to (bx, by), drawn as in truck(). */
  bar(ax, ay, bx, by, fr) {
    const ctx = this.ctx;
    const dx = bx - ax, dy = by - ay;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(dy, dx));
    const s = Math.sqrt(dx * dx + dy * dy) / 64;
    ctx.scale(s, s);
    ctx.translate(68, -8);
    ctx.scale(-1, 1);
    this.frame('bar', fr);
    ctx.restore();
  }

  /** A wrecked truck's loose pieces. W holds the (interpolated) points of game.wreck. */
  wreck(wreck, W, look) {
    const ctx = this.ctx;
    for (const b of wreck.bars) this.bar(W[b.a * 2], W[b.a * 2 + 1], W[b.b * 2], W[b.b * 2 + 1], b.frame);
    const pose = Wreck.bodyPose(W, wreck.body);
    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.ang);
    ctx.scale(0.7, 0.7);
    this.body(look);
    ctx.restore();
    for (const w of wreck.wheels) {
      ctx.save();
      ctx.translate(W[w.p * 2], W[w.p * 2 + 1]);
      ctx.rotate(w.rot * DEG);
      ctx.scale(45 / 72, 45 / 72);
      this.frame('tyre', look.tyre);
      this.frame('hub', look.hub);
      ctx.restore();
    }
  }

  // ---- world

  /** `zoom` is the dynamic camera's pull-back: the view shows `zoom` times as much of the world. */
  tiles(level, camX, camY, zoom = 1) {
    // Draw in device pixels with edges snapped to whole pixels so adjacent tiles meet exactly.
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.offX, this.offY, Math.round(STAGE_W * this.scale), Math.round(this.viewH * this.scale));
    ctx.clip();
    const s = this.scale / zoom;
    const tx0 = Math.floor(camX / TILE), ty0 = Math.floor(camY / TILE);
    const edgeX = (gx) => Math.round((gx * TILE - camX) * s) + this.offX;
    const edgeY = (gy) => Math.round((gy * TILE - camY) * s) + this.offY;
    const rows = Math.ceil(this.viewH * zoom / TILE) + 1;
    const cols = Math.ceil(STAGE_W * zoom / TILE) + 1;
    for (let c = 0; c < cols; c++) {
      const gx = tx0 + c;
      if (gx < 0 || gx >= level.width) continue;
      const x0 = edgeX(gx), x1 = edgeX(gx + 1);
      // The stages only have ground tiles as deep as the original 448-high view could see. A
      // taller view can look further down, so below a column's last tile, if that tile is solid
      // dirt, keep drawing dirt.
      let last = level.height - 1;
      while (last >= 0 && level.tiles[last][gx] === 0) last--;
      const fillFrom = last >= 0 && level.tiles[last][gx] === FILL_TILE ? last + 1 : Infinity;
      for (let r = 0; r < rows; r++) {
        const gy = ty0 + r;
        if (gy < 0) continue;
        const id = gy >= fillFrom ? FILL_TILE : gy < level.height ? level.tiles[gy][gx] : 0;
        if (id === 0) continue; // tile 0 is empty sky
        const y0 = edgeY(gy), y1 = edgeY(gy + 1);
        ctx.drawImage(this.a.tiles[id], x0, y0, x1 - x0, y1 - y0);
      }
    }
    ctx.restore();
    this.stageTransform();
  }

  world(game, v) {
    const ctx = this.ctx;
    // The backdrop is scaled up evenly to cover a taller view, and centred.
    const bg = this.a.images['bg.jpg'], k = Math.max(1, this.viewH / STAGE_H);
    ctx.drawImage(bg, (STAGE_W - STAGE_W * k) / 2, (this.viewH - STAGE_H * k) / 2, STAGE_W * k, STAGE_H * k);
    const zoom = game.rules.classic ? 1 : v.zoom || 1;
    this.tiles(game.levelData, v.camX, v.camY, zoom);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, STAGE_W, this.viewH);
    ctx.clip();
    ctx.scale(1 / zoom, 1 / zoom);
    ctx.translate(-v.camX, -v.camY);
    for (const d of game.dirt) {
      if (d.life === 0) continue;
      const f = this.a.sprites.dirt[d.frame];
      ctx.globalAlpha = d.alpha;
      ctx.drawImage(f.img, d.x + f.tx * d.scale, d.y + f.ty * d.scale, f.img.width * d.scale, f.img.height * d.scale);
    }
    ctx.globalAlpha = 1;
    if (game.wreck && v.W) this.wreck(game.wreck, v.W, game.look);
    else this.truck(v.T, v.rr, v.fr, game.look);
    ctx.restore();
    this.hud(game);
  }

  hud(game) { // Symbol 305 / X3323
    const ctx = this.ctx;
    if (game.rules.damage) {
      // The label's left edge lines up with the damage bar's.
      const label = { size: 15, font: HUD_FONT, weight: '800', align: 'left' };
      ctx.font = `${label.weight} ${label.size}px ${label.font}`;
      ctx.textAlign = 'left';
      this.text('damage', 13.1 + ctx.measureText('damage').actualBoundingBoxLeft, 7.5, label);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(13.1, 25, 80, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(13.1, 25, 80 * game.damage / 1000, 10);
    }
    this.text('score', 566.5, 9, { size: 12.5, font: HUD_FONT, weight: '800', align: 'right' });
    const hud = { size: 12.85, font: HUD_FONT, weight: '800', align: 'right' };
    this.text(String(game.score), 566, 22, hud);
    if (game.mode === 'endless') this.text(`${game.metres} m`, 566, 34, { ...hud, color: 'rgba(255,255,255,0.9)' });
    else this.text(`+${game.bonus}`, 566, 34, { ...hud, color: 'rgba(255,255,255,0.9)' });
    const chain = game.tricks.chain;
    if (game.rules.classic) {
      if (game.flipBonusTimer > 0) this.text(`+${game.flipBonus}`, 566, 46, { ...hud, color: 'rgba(255,255,255,0.9)' });
    } else if (chain.length && game.screen !== 'gameOver') {
      const m = game.tricks.multiplier;
      this.text(`+${game.tricks.chainPoints}${m > 1 ? `  x${m}` : ''}`, 566, 46, { ...hud, color: 'rgba(255,255,255,0.6)' });
    } else if (game.flipBonusTimer > 0) this.text(`+${game.flipBonus}`, 566, 46, { ...hud, color: 'rgba(255,255,255,0.9)' });
    if (!game.rules.classic) this.trickNames(game);
    if (game.tickerTimer > 0 && game.screen !== 'gameOver') {
      this.text(game.ticker, STAGE_W / 2, 82, { size: 15, font: HUD_FONT, weight: '800' });
    }
  }

  /** The name of the trick just done, popping in under the ticker and fading out. */
  trickNames(game) {
    const show = game.tricks.show, bail = game.tricks.bail;
    if (game.screen === 'gameOver') return;
    const ctx = this.ctx;
    if (bail) {
      // A bail ends the chain: a muted note under the trick names, not another trick.
      const age = TRICK.showFor - bail.timer;
      ctx.save();
      ctx.globalAlpha = 0.75 * Math.min(1, bail.timer / 20, age / 6);
      this.text('bail', STAGE_W / 2, 126, { size: 14, font: HUD_FONT, weight: 'italic 700', color: '#e4e4e4', shadow: 'rgba(38,38,38,0.6)' });
      ctx.restore();
    }
    if (!show) return;
    const age = TRICK.showFor - show.timer;
    const pop = 1 + 0.3 * Math.max(0, 1 - age / 7) ** 2;
    ctx.save();
    ctx.globalAlpha = Math.min(1, show.timer / 20, age / 3 + 0.3);
    ctx.translate(STAGE_W / 2, 112);
    ctx.scale(pop, pop);
    this.text(show.names.join('  +  '), 0, -9, { size: 17, font: HUD_FONT, weight: '800', shadow: 'rgba(38,38,38,0.55)' });
    ctx.restore();
  }

  // ---- screens
  //
  // Menu screens draw in page coordinates (see layout): the 576x448 stage, or in the tall layout
  // a page TALL_W across. `this.tall` says which. The menu screens were bitmaps with their text
  // baked in; they are now drawn from the plain backdrop plus the original art's keycaps and
  // boxes, with the words as live text.

  /** The hint about the controls, for the title screen. */
  controlsHint(game) {
    if (game.oneButton) return this.touchMode ? 'Hold anywhere to drive, and to tilt back in the air' : 'Hold Space to drive, and to tilt back in the air  ·  P pauses  ·  Esc returns to the menu';
    return this.touchMode ? 'Use the on-screen pedals and tilt buttons to drive' : 'Arrow keys drive and tilt  ·  P pauses  ·  M sound  ·  Esc returns to the menu';
  }

  bestsLine(game) {
    const bests = [];
    if (game.bestPlay > 0) bests.push(`Play: ${game.bestPlay}`);
    if (game.best > 0) bests.push(`Classic: ${game.best}`);
    if (game.bestEndless > 0) bests.push(`Endless: ${game.bestEndless} m`);
    return bests.length ? `Best  ·  ${bests.join('   ·   ')}` : '';
  }

  /** The garage truck, with its resting point (288, 170) moved to (x, y) and scaled by k. */
  showTruck(game, v, x, y, k = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.translate(-STAGE_W / 2, -170);
    this.truck(v.gT, v.grr, v.gfr, game.look);
    ctx.restore();
  }

  title(game, v) {
    const shadow = 'rgba(38,38,38,0.85)';
    const version = `v${VERSION}${BUILD === 'dev' ? '' : `  ·  ${BUILD}`}`;
    const small = { size: 12, weight: '700', color: 'rgba(255,255,255,0.8)', align: 'right', shadow: 'rgba(38,38,38,0.5)' };
    const hintStyle = { weight: '600', color: 'rgba(255,255,255,0.78)' };
    const best = this.bestsLine(game);
    if (this.tall) {
      const cx = TALL_W / 2;
      this.fitText('funky truck', cx, 22, 340, { size: 54, weight: '900', color: '#f5f5f5', shadow });
      this.text('UTAH', 334, 84, { size: 26, weight: '900', color: '#f5f5f5', shadow, align: 'right' });
      this.showTruck(game, v, cx, 212, 1.15);
      this.buttons('title', game);
      if (best) this.fitText(best, cx, 578, 340, { size: 13, weight: '600' });
      this.wrapText(this.controlsHint(game), cx, 600, 330, { size: 12, ...hintStyle }, 15);
      this.text(version, TALL_W - 8, 670, { ...small, size: 14 });
      return;
    }
    this.text('funky truck', STAGE_W / 2, 18, { size: 62, weight: '900', color: '#f5f5f5', shadow });
    this.text('UTAH', 470, 94, { size: 28, weight: '900', color: '#f5f5f5', shadow, align: 'right' });
    this.showTruck(game, v, STAGE_W / 2, 218);
    this.buttons('title', game);
    if (best) this.text(best, STAGE_W / 2, 393, { size: 14, weight: '600' });
    this.text(this.controlsHint(game), STAGE_W / 2, 410, { size: 11, ...hintStyle });
    this.text(version, STAGE_W - 8, 430, small);
  }

  help() {
    const keys = ['Forwards', 'Reverse', 'Tilt Back', 'Tilt Forwards'];
    const lines = ['Your truck is four-wheel drive.',
      'To climb steep hills, tilt forwards so that your front wheel stays on the ground.',
      'One Button: hold Space (or the screen) to drive, and to tilt back in the air.'];
    if (this.tall) {
      const k = 1.25, x0 = 72, y0 = 36;
      this.piece('screen_help.png', 205, 45, 62, 145, x0, y0, 62 * k, 145 * k); // the four arrow keycaps
      keys.forEach((name, i) => this.text(name, x0 + 64 * k + 6, y0 + (20 + i * 29.7) * k, { size: 17, weight: '600', align: 'left' }));
      let y = this.wrapText('Press P to Pause', TALL_W / 2, 250, 320, { size: 16, weight: '600' });
      y += 18;
      for (const line of lines) y = this.wrapText(line, TALL_W / 2, y, 320, { size: 16, weight: '600' }, 21) + 14;
      this.buttons('help');
      return;
    }
    this.piece('screen_help.png', 205, 45, 62, 145); // the four arrow keycaps
    keys.forEach((name, i) => this.text(name, 269, 65 + i * 29.7, { size: 14, weight: '600', align: 'left' }));
    const line = { size: 14, weight: '600' };
    this.text('Press P to Pause', STAGE_W / 2, 202, line);
    this.text(lines[0], STAGE_W / 2, 262, line);
    this.text(lines[1], STAGE_W / 2, 296, { ...line, size: 13.5 });
    this.text(lines[2], STAGE_W / 2, 330, { ...line, size: 13.5 });
    this.buttons('help');
  }

  garage(game, v) {
    const names = ['Body', 'Paint', 'Tyres', 'Wheels'];
    if (this.tall) {
      this.box('screen_garage.png', 10, 10, 556, 25, 10, 10, TALL_W - 20, 32, 12); // title bar
      this.text('Your Truck', TALL_W / 2, 17, { size: 17, weight: '700' });
      this.showTruck(game, v, TALL_W / 2, 200, 1.45);
      names.forEach((name, i) => {
        const y = 268 + 56 * i;
        // The arrow buttons, from the original art's first row (it only had three rows).
        this.piece('screen_garage.png', 200, 226, 32, 32, 30, y, 48, 48);
        this.piece('screen_garage.png', 344, 226, 32, 32, 282, y, 48, 48);
        this.text(name, TALL_W / 2, y + 14, { size: 19, weight: '700' });
      });
      this.text(COSMETIC, TALL_W / 2, 498, { size: 13, weight: '600', color: 'rgba(255,255,255,0.78)' });
      this.buttons('garage');
      return;
    }
    this.box('screen_garage.png', 10, 10, 556, 25, 10, 10, 556, 25, 12); // title bar
    this.text('Your Truck', STAGE_W / 2, 15.5, { size: 14, weight: '700' });
    this.showTruck(game, v, STAGE_W / 2, 170);
    names.forEach((name, i) => {
      const y = 226 + i * 34;
      // The arrow buttons, from the original art's first row (it only had three rows).
      this.piece('screen_garage.png', 200, 226, 32, 32, 200, y);
      this.piece('screen_garage.png', 344, 226, 32, 32, 344, y);
      this.text(name, STAGE_W / 2, y + 8, { size: 14, weight: '700' });
    });
    this.text(COSMETIC, STAGE_W / 2, 378, { size: 12, weight: '600', color: 'rgba(255,255,255,0.78)' });
    this.buttons('garage');
  }

  practiceSelect(game) {
    if (this.tall) {
      this.text('Choose a Stage', TALL_W / 2, 38, { size: 19, weight: '700' });
      for (let i = 0; i < 9; i++) {
        const { x, y } = tallStage(i);
        this.box('screen_practice.png', 136, 228, 32, 32, x, y, 72, 72, 10);
        this.text(String(i + 1), x + 36, y + 22, { size: 28, weight: '700' });
      }
      this.buttons('practiceSelect', game);
      return;
    }
    this.text('Choose a Stage', STAGE_W / 2, 164, { size: 14, weight: '700' });
    for (let i = 0; i < 9; i++) {
      const x = 136 + 34 * i;
      this.box('screen_practice.png', 136, 228, 32, 32, x, 228, 32, 32);
      this.text(String(i + 1), x + 16, 234.5, { size: 17, weight: '700' });
    }
    this.buttons('practiceSelect', game);
  }

  overlayDim(alpha) {
    this.ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    this.ctx.save();
    this.stageTransform();
    this.ctx.fillRect(0, 0, STAGE_W, this.viewH);
    this.ctx.restore();
  }

  gameOver(game) {
    this.overlayDim(0.45);
    let title = game.wrecked ? 'Truck Wrecked' : (game.finished && game.mode === 'campaign' ? 'Well Driven!' : 'Game Over');
    if (game.mode === 'endless') title = 'Nice Run!';
    else if (game.mode === 'practice' && !game.wrecked) title = 'Practice Complete';
    const lines = game.mode === 'endless'
      ? [`${game.metres} m  ·  ${game.lastScore}`, `Best: ${game.bestEndless} m`]
      : [`Score: ${game.lastScore}`, game.rules.damage ? `Best: ${game.bestForRules}` : ''];
    const hint = this.touchMode ? '' : 'or press Space / Ctrl';
    const hintStyle = { size: 11, weight: '600', color: 'rgba(255,255,255,0.78)' };
    if (this.tall) {
      const cx = TALL_W / 2;
      this.roundRect(20, 10, TALL_W - 40, 310, 12, 'rgba(140,97,79,0.96)', 'rgba(255,255,255,0.6)');
      this.fitText(title, cx, 32, 290, { size: 36, weight: '900' });
      lines.forEach((l, i) => l && this.fitText(l, cx, 100 + 32 * i, 290, { size: 20, weight: '600' }));
      this.buttons('gameOver');
      if (hint) this.text(hint, cx, 298, { ...hintStyle, size: 12 });
      return;
    }
    this.roundRect(158, 112, 260, 232, 10, 'rgba(140,97,79,0.96)', 'rgba(255,255,255,0.6)');
    this.text(title, STAGE_W / 2, 128, { size: 30, weight: '900' });
    lines.forEach((l, i) => l && this.text(l, STAGE_W / 2, 182 + 24 * i, { size: 17, weight: '600' }));
    this.buttons('gameOver');
    if (hint) this.text(hint, STAGE_W / 2, 316, hintStyle);
  }

  paused(game) {
    this.overlayDim(0.3);
    const name = { weight: '700', color: 'rgba(255,255,255,0.9)', shadow: 'rgba(38,38,38,0.7)' };
    const big = { weight: '900', shadow: 'rgba(38,38,38,0.85)' };
    const hint = this.touchMode ? '' : 'Press P to resume play';
    if (this.tall) {
      const cx = TALL_W / 2;
      this.fitText(runName(game), cx, 24, 340, { ...name, size: 18 });
      this.text('Paused', cx, 52, { ...big, size: 46 });
      if (hint) this.text(hint, cx, 118, { size: 15, weight: '600' });
      this.buttons('paused', game);
      return;
    }
    this.text(runName(game), STAGE_W / 2, 132, { ...name, size: 15 });
    this.text('Paused', STAGE_W / 2, 158, { ...big, size: 36 });
    if (hint) this.text(hint, STAGE_W / 2, 210, { size: 14, weight: '600' });
    this.buttons('paused', game);
  }

  /** Draw a full frame. `v` holds interpolated positions. */
  draw(game, v) {
    const ctx = this.ctx;
    this.layout(game);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // The menus' backdrop (a plain gradient) fills the whole window, with the page on top.
    if (MENU_SCREENS.has(game.screen)) ctx.drawImage(this.a.images['screen_plain.png'], 0, 0, this.canvas.width, this.canvas.height);
    this.stageTransform();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, STAGE_W, this.viewH);
    ctx.clip();
    if (!MENU_SCREENS.has(game.screen)) this.world(game, v);
    if (game.screen !== 'playing') this.menuTransform();
    switch (game.screen) {
      case 'title': this.title(game, v); break;
      case 'help': this.help(); break;
      case 'garage': this.garage(game, v); break;
      case 'practiceSelect': this.practiceSelect(game); break;
      case 'paused': this.paused(game); break;
      case 'gameOver': this.gameOver(game); break;
    }
    ctx.restore();
  }
}
