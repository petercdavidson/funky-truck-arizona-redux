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
// Options are small on/off switches down the right-hand side of a screen.

const r = (x, y, w, h) => ({ x, y, w, h });
const onOff = (v) => (v ? 'On' : 'Off');
const option = (y, label, action) => ({ rect: r(428, y, 132, 20), label, action, small: true });

export const BUTTONS = {
  title: [
    { rect: r(229, 250, 120, 25), label: 'Play', action: 'play' },
    { rect: r(229, 278, 120, 25), label: 'Classic', action: 'classic' },
    { rect: r(229, 306, 120, 25), label: 'Endless', action: 'endless' },
    { rect: r(229, 334, 120, 25), label: 'Practice', action: 'practice' },
    { rect: r(229, 362, 120, 25), label: 'Change Truck', action: 'garage' },
    { rect: r(238, 425, 100, 17), label: 'How to Play', action: 'help', small: true },
    option(252, (g) => `♪ Sound: ${onOff(g.soundOn)}`, 'sound'),
    option(276, (g) => `One Button: ${onOff(g.oneButton)}`, 'oneButton'),
    option(300, (g) => `Dynamic Camera: ${onOff(g.dynamicCamera)}`, 'dynamicCamera'),
  ],
  help: [{ rect: r(229, 386, 120, 25), label: 'Menu', action: 'menu' }],
  garage: [
    { rect: r(229, 413, 120, 25), label: 'Menu', action: 'menu' },
    ...['body', 'paint', 'tyre', 'hub'].flatMap((part, i) => [
      { rect: r(200, 226 + 34 * i, 32, 32), action: `${part}-1` },
      { rect: r(344, 226 + 34 * i, 32, 32), action: `${part}+1` },
    ]),
  ],
  practiceSelect: [
    ...Array.from({ length: 9 }, (_, i) => ({ rect: r(136 + 34 * i, 228.05, 32, 32), action: `stage${i}` })),
    { rect: r(229, 413, 120, 25), label: 'Menu', action: 'menu' },
    option(290, (g) => `Damage: ${onOff(g.practiceDamage)}`, 'practiceDamage'),
    option(314, (g) => `Classic: ${onOff(g.practiceClassic)}`, 'practiceClassic'),
  ],
  gameOver: [
    { rect: r(229, 250, 120, 25), label: 'Play Again', action: 'again' },
    { rect: r(229, 281, 120, 25), label: 'Menu', action: 'menu' },
  ],
  // Each kind of run gets its own column of buttons: Endless can end the run, and Classic has no
  // controls switch (it always uses the original controls).
  paused: [['endless', (g) => g.mode === 'endless'], ['classic', (g) => g.mode !== 'endless' && g.rules.classic],
    ['other', (g) => g.mode !== 'endless' && !g.rules.classic]].flatMap(([kind, when]) => [
    { label: 'Resume', action: 'resume' },
    kind === 'endless' && { label: 'End Run', action: 'endRun' },
    { label: 'Quit to Menu', action: 'menu' },
    { label: (g) => `Sound: ${onOff(g.soundOn)}`, action: 'sound' },
    kind !== 'classic' && { label: (g) => `Controls: ${g.oneButton ? 'One Button' : 'Standard'}`, action: 'oneButton' },
  ].filter(Boolean).map((b, i) => ({ ...b, rect: r(213, 250 + 31 * i, 150, 25), show: when }))),
  playing: [],
};

/** Which run this is, for the pause screen: "Play  ·  Stage Three", "Endless  ·  420 m", ... */
export function runName(game) {
  if (game.mode === 'endless') return `Endless  ·  ${game.metres} m`;
  const stage = STAGE_NAMES[game.level];
  if (game.mode === 'campaign') return `${game.rules.classic ? 'Classic' : 'Play'}  ·  ${stage}`;
  const rules = [game.rules.classic && 'Classic rules', !game.rules.damage && 'no damage'].filter(Boolean);
  return `Practice  ·  ${stage}${rules.length ? `  (${rules.join(', ')})` : ''}`;
}

export function hitButton(screen, x, y, game) {
  return (BUTTONS[screen] || []).find((b) => (!b.show || b.show(game))
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
   * Work out how the view fits the canvas. Menus, and everything in Classic, show the original
   * 576x448 stage, letterboxed. Outside Classic the driving view fills the window: it always
   * shows the same 576 units across (what matters for seeing the terrain ahead), and as much
   * height as the window's shape gives. Sets game.viewH so the camera knows.
   */
  layout(game) {
    const W = this.canvas.width, H = this.canvas.height;
    const fill = !!game && !game.rules.classic && FILL_SCREENS.has(game.screen);
    if (fill) {
      this.scale = W / STAGE_W;
      this.viewH = H / this.scale;
      this.offX = 0; this.offY = 0;
    } else {
      this.scale = Math.min(W / STAGE_W, H / STAGE_H);
      this.viewH = STAGE_H;
      this.offX = Math.round((W - STAGE_W * this.scale) / 2);
      this.offY = Math.round((H - STAGE_H * this.scale) / 2);
    }
    // The pause and game-over boxes stay centred, and shrink to fit a short view.
    this.menuK = Math.min(1, this.viewH / STAGE_H);
    // The camera always knows the filled view's height (Classic uses 448 regardless), so a stage
    // started from a menu begins with its camera in the right place.
    if (game) game.viewH = H * STAGE_W / W;
  }

  /** Convert a point in canvas CSS pixels to stage (menu) coordinates. */
  toStage(cssX, cssY) {
    const dx = cssX / this.cssPerDevice, dy = cssY / this.cssPerDevice;
    const x = (dx - this.offX) / this.scale, y = (dy - this.offY) / this.scale;
    const k = this.menuK;
    return [(x - STAGE_W / 2) / k + STAGE_W / 2, (y - this.viewH / 2) / k + STAGE_H / 2];
  }

  /** Switch to menu coordinates: the 576x448 stage, centred (and shrunk if need be) in the view. */
  menuTransform() {
    const ctx = this.ctx, k = this.menuK;
    ctx.translate(STAGE_W / 2, this.viewH / 2);
    ctx.scale(k, k);
    ctx.translate(-STAGE_W / 2, -STAGE_H / 2);
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
    for (const b of BUTTONS[screen] || []) {
      if (b.show && !b.show(game)) continue;
      const { x, y, w, h } = b.rect;
      if (b.label) {
        const label = typeof b.label === 'function' ? b.label(game) : b.label;
        this.roundRect(x, y, w, h, 4, b.small ? 'rgba(107, 74, 64, 0.7)' : BUTTON_FILL);
        this.text(label.toUpperCase(), x + w / 2, y + (b.small ? h / 2 - 5.5 : 6.5), { size: b.small ? 10 : 11.5, weight: '800' });
      }
      if (this.hover === b) this.roundRect(x, y, w, h, 4, 'rgba(255,255,255,0.16)');
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
    this.frame('body', look.body, this.a.paints[look.body][look.paint[look.body]]);
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

  title(game, v) {
    const shadow = 'rgba(38,38,38,0.85)';
    this.text('funky truck', STAGE_W / 2, 18, { size: 62, weight: '900', color: '#f5f5f5', shadow });
    this.text('UTAH', 470, 94, { size: 28, weight: '900', color: '#f5f5f5', shadow, align: 'right' });
    this.ctx.save();
    this.ctx.translate(0, 48);
    this.truck(v.gT, v.grr, v.gfr, game.look);
    this.ctx.restore();
    this.buttons('title', game);
    const bests = [];
    if (game.bestPlay > 0) bests.push(`Play: ${game.bestPlay}`);
    if (game.best > 0) bests.push(`Classic: ${game.best}`);
    if (game.bestEndless > 0) bests.push(`Endless: ${game.bestEndless} m`);
    if (bests.length) this.text(`Best  ·  ${bests.join('   ·   ')}`, STAGE_W / 2, 393, { size: 14, weight: '600' });
    let hint;
    if (game.oneButton) hint = this.touchMode ? 'Hold anywhere to drive, and to tilt back in the air' : 'Hold Space to drive, and to tilt back in the air  ·  P pauses  ·  Esc returns to the menu';
    else hint = this.touchMode ? 'Use the on-screen pedals and tilt buttons to drive' : 'Arrow keys drive and tilt  ·  P pauses  ·  M sound  ·  Esc returns to the menu';
    this.text(hint, STAGE_W / 2, 410, { size: 11, weight: '600', color: 'rgba(255,255,255,0.78)' });
    const build = BUILD === 'dev' ? '' : `  ·  ${BUILD}`;
    this.text(`v${VERSION}${build}`, STAGE_W - 8, 432, { size: 9, weight: '600', color: 'rgba(255,255,255,0.5)', align: 'right' });
  }

  // The menu screens were bitmaps with their text baked in. They are now drawn from the plain
  // backdrop plus the original art's keycaps and boxes, with the words as live text.

  help() {
    this.piece('screen_help.png', 205, 45, 62, 145); // the four arrow keycaps
    const label = { size: 14, weight: '600', align: 'left' };
    ['Forwards', 'Reverse', 'Tilt Back', 'Tilt Forwards'].forEach((name, i) => this.text(name, 269, 65 + i * 29.7, label));
    const line = { size: 14, weight: '600' };
    this.text('Press P to Pause', STAGE_W / 2, 202, line);
    this.text('Your truck is four-wheel drive.', STAGE_W / 2, 262, line);
    this.text('To climb steep hills, tilt forwards so that your front wheel stays on the ground.', STAGE_W / 2, 296, { ...line, size: 13.5 });
    this.text('One Button: hold Space (or the screen) to drive, and to tilt back in the air.', STAGE_W / 2, 330, { ...line, size: 13.5 });
    this.buttons('help');
  }

  garage(game, v) {
    this.box('screen_garage.png', 10, 10, 556, 25, 10, 10, 556, 25, 12); // title bar
    this.text('Your Truck', STAGE_W / 2, 15.5, { size: 14, weight: '700' });
    this.truck(v.gT, v.grr, v.gfr, game.look);
    ['Body', 'Paint', 'Tyres', 'Wheels'].forEach((name, i) => {
      const y = 226 + i * 34;
      // The arrow buttons, from the original art's first row (it only had three rows).
      this.piece('screen_garage.png', 200, 226, 32, 32, 200, y);
      this.piece('screen_garage.png', 344, 226, 32, 32, 344, y);
      this.text(name, STAGE_W / 2, y + 8, { size: 14, weight: '700' });
    });
    this.buttons('garage');
  }

  practiceSelect(game) {
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
    this.roundRect(158, 112, 260, 232, 10, 'rgba(140,97,79,0.96)', 'rgba(255,255,255,0.6)');
    let title = game.wrecked ? 'Truck Wrecked' : (game.finished && game.mode === 'campaign' ? 'Well Driven!' : 'Game Over');
    if (game.mode === 'endless') title = 'Nice Run!';
    this.text(title, STAGE_W / 2, 128, { size: 30, weight: '900' });
    if (game.mode === 'endless') {
      this.text(`${game.metres} m  ·  ${game.lastScore}`, STAGE_W / 2, 182, { size: 17, weight: '600' });
      this.text(`Best: ${game.bestEndless} m`, STAGE_W / 2, 206, { size: 17, weight: '600' });
    } else {
      this.text(`Score: ${game.lastScore}`, STAGE_W / 2, 182, { size: 17, weight: '600' });
      if (game.rules.damage) this.text(`Best: ${game.bestForRules}`, STAGE_W / 2, 206, { size: 17, weight: '600' });
    }
    this.buttons('gameOver');
    const hint = this.touchMode ? '' : 'or press Space / Ctrl';
    if (hint) this.text(hint, STAGE_W / 2, 316, { size: 11, weight: '600', color: 'rgba(255,255,255,0.78)' });
  }

  paused(game) {
    this.overlayDim(0.3);
    this.text(runName(game), STAGE_W / 2, 132, { size: 15, weight: '700', color: 'rgba(255,255,255,0.9)', shadow: 'rgba(38,38,38,0.7)' });
    this.text('Paused', STAGE_W / 2, 158, { size: 36, weight: '900', shadow: 'rgba(38,38,38,0.85)' });
    this.text(this.touchMode ? '' : 'Press P to resume play', STAGE_W / 2, 210, { size: 14, weight: '600' });
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
    // The menus' backdrop (a plain gradient) fills the whole window; their contents stay the
    // 576x448 stage, centred and scaled to fit.
    if (MENU_SCREENS.has(game.screen)) ctx.drawImage(this.a.images['screen_plain.png'], 0, 0, this.canvas.width, this.canvas.height);
    this.stageTransform();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, STAGE_W, this.viewH);
    ctx.clip();
    switch (game.screen) {
      case 'title': this.title(game, v); break;
      case 'help': this.help(); break;
      case 'garage': this.garage(game, v); break;
      case 'practiceSelect': this.practiceSelect(game); break;
      case 'playing': this.world(game, v); break;
      case 'paused': this.world(game, v); this.menuTransform(); this.paused(game); break;
      case 'gameOver': this.world(game, v); this.menuTransform(); this.gameOver(game); break;
    }
    ctx.restore();
  }
}
