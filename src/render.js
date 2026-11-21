// render.js — draws the game onto a 2D canvas.
//
// All drawing uses the original 576x448 stage coordinates (y down, clockwise rotation), scaled to
// the canvas. Tiles are drawn in device pixels with snapped edges so they never show seams.

import { TILE, STAGE_W, STAGE_H } from './game.js';
import { HUD_FONT, TITLE_FONT } from './assets.js';

const DEG = Math.PI / 180;
const BUTTON_FILL = 'rgba(107, 74, 64, 0.92)';

// ---------------------------------------------------------------------------------------------
// Clickable areas per screen. `label` buttons are drawn by us; the rest are hotspots over the
// original art. Actions are handled in main.js.

const r = (x, y, w, h) => ({ x, y, w, h });

export const BUTTONS = {
  title: [
    { rect: r(229, 250, 120, 25), label: 'Play', action: 'play' },
    { rect: r(229, 278, 120, 25), label: 'Endless', action: 'endless' },
    { rect: r(229, 306, 120, 25), label: 'Practice', action: 'practice' },
    { rect: r(229, 334, 120, 25), label: 'Change Truck', action: 'garage' },
    { rect: r(229, 362, 120, 25), label: 'How to Play', action: 'help' },
  ],
  help: [{ rect: r(229, 386, 120, 25), label: 'Menu', action: 'menu' }],
  garage: [
    { rect: r(229, 413, 120, 25), label: 'Menu', action: 'menu' },
    { rect: r(200, 226, 32, 32), action: 'body-1' }, { rect: r(344, 226, 32, 32), action: 'body+1' },
    { rect: r(200, 260, 32, 32), action: 'tyre-1' }, { rect: r(344, 260, 32, 32), action: 'tyre+1' },
    { rect: r(200, 294, 32, 32), action: 'hub-1' }, { rect: r(344, 294, 32, 32), action: 'hub+1' },
  ],
  practiceSelect: [
    ...Array.from({ length: 9 }, (_, i) => ({ rect: r(136 + 34 * i, 228.05, 32, 32), action: `stage${i}` })),
    { rect: r(229, 413, 120, 25), label: 'Menu', action: 'menu' },
  ],
  gameOver: [
    { rect: r(229, 250, 120, 25), label: 'Play Again', action: 'again' },
    { rect: r(229, 281, 120, 25), label: 'Menu', action: 'menu' },
  ],
  paused: [
    { rect: r(229, 262, 120, 25), label: 'Resume', action: 'resume' },
    { rect: r(229, 293, 120, 25), label: 'Quit to Menu', action: 'menu' },
  ],
  playing: [],
};

export function hitButton(screen, x, y) {
  return (BUTTONS[screen] || []).find((b) => x >= b.rect.x && x < b.rect.x + b.rect.w && y >= b.rect.y && y < b.rect.y + b.rect.h) || null;
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

  /** Fit the 576x448 stage into the canvas element's size, letterboxed. */
  resize(cssW, cssH, dpr) {
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.scale = Math.min(this.canvas.width / STAGE_W, this.canvas.height / STAGE_H);
    this.offX = Math.round((this.canvas.width - STAGE_W * this.scale) / 2);
    this.offY = Math.round((this.canvas.height - STAGE_H * this.scale) / 2);
    this.cssPerDevice = 1 / dpr;
  }

  /** Convert a point in canvas CSS pixels to stage coordinates. */
  toStage(cssX, cssY) {
    const dx = cssX / this.cssPerDevice, dy = cssY / this.cssPerDevice;
    return [(dx - this.offX) / this.scale, (dy - this.offY) / this.scale];
  }

  stageTransform() {
    this.ctx.setTransform(this.scale, 0, 0, this.scale, this.offX, this.offY);
  }

  // ---- drawing helpers (stage space)

  /** Draw a sprite frame the way Flash places a bitmap in a symbol: top-left at (tx, ty). */
  frame(key, i) {
    const f = this.a.sprites[key][i];
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

  buttons(screen) {
    for (const b of BUTTONS[screen] || []) {
      const { x, y, w, h } = b.rect;
      if (b.label) {
        this.roundRect(x, y, w, h, 4, BUTTON_FILL);
        this.text(b.label.toUpperCase(), x + w / 2, y + 6.5, { size: 11.5, weight: '800' });
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
    this.frame('body', look.body);
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

  // ---- world

  tiles(level, camX, camY) {
    // Draw in device pixels with edges snapped to whole pixels so adjacent tiles meet exactly.
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.offX, this.offY, Math.round(STAGE_W * this.scale), Math.round(STAGE_H * this.scale));
    ctx.clip();
    const s = this.scale;
    const tx0 = Math.floor(camX / TILE), ty0 = Math.floor(camY / TILE);
    const edgeX = (gx) => Math.round((gx * TILE - camX) * s) + this.offX;
    const edgeY = (gy) => Math.round((gy * TILE - camY) * s) + this.offY;
    for (let r = 0; r < 8; r++) {
      const gy = ty0 + r;
      if (gy < 0 || gy >= level.height) continue;
      const y0 = edgeY(gy), y1 = edgeY(gy + 1);
      for (let c = 0; c < 10; c++) {
        const gx = tx0 + c;
        if (gx < 0 || gx >= level.width) continue;
        const id = level.tiles[gy][gx];
        if (id === 0) continue; // tile 0 is empty sky
        const x0 = edgeX(gx), x1 = edgeX(gx + 1);
        ctx.drawImage(this.a.tiles[id], x0, y0, x1 - x0, y1 - y0);
      }
    }
    ctx.restore();
    this.stageTransform();
  }

  world(game, v) {
    const ctx = this.ctx;
    this.image('bg.jpg');
    this.tiles(game.levelData, v.camX, v.camY);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, STAGE_W, STAGE_H);
    ctx.clip();
    ctx.translate(-v.camX, -v.camY);
    for (const d of game.dirt) {
      if (d.life === 0) continue;
      const f = this.a.sprites.dirt[d.frame];
      ctx.globalAlpha = d.alpha;
      ctx.drawImage(f.img, d.x + f.tx * d.scale, d.y + f.ty * d.scale, f.img.width * d.scale, f.img.height * d.scale);
    }
    ctx.globalAlpha = 1;
    this.truck(v.T, v.rr, v.fr, game.look);
    ctx.restore();
    this.hud(game);
  }

  hud(game) { // Symbol 305 / X3323
    const ctx = this.ctx;
    this.text('damage', 9.5, 7.5, { size: 15, font: HUD_FONT, weight: '800', align: 'left' });
    this.text('score', 566.5, 9, { size: 12.5, font: HUD_FONT, weight: '800', align: 'right' });
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(13.1, 25, 80, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(13.1, 25, 80 * game.damage / 1000, 10);
    const hud = { size: 12.85, font: HUD_FONT, weight: '800', align: 'right' };
    this.text(String(game.score), 566, 22, hud);
    if (game.mode === 'endless') this.text(`${game.metres} m`, 566, 34, { ...hud, color: 'rgba(255,255,255,0.9)' });
    else this.text(`+${game.bonus}`, 566, 34, { ...hud, color: 'rgba(255,255,255,0.9)' });
    if (game.flipBonusTimer > 0) this.text(`+${game.flipBonus}`, 566, 46, { ...hud, color: 'rgba(255,255,255,0.9)' });
    if (game.tickerTimer > 0 && game.screen !== 'gameOver') {
      this.text(game.ticker, STAGE_W / 2, 82, { size: 15, font: HUD_FONT, weight: '800' });
    }
  }

  // ---- screens

  title(game, v) {
    this.image('screen_plain.png');
    const shadow = 'rgba(38,38,38,0.85)';
    this.text('funky truck', STAGE_W / 2, 18, { size: 62, weight: '900', color: '#f5f5f5', shadow });
    this.text('UTAH', 470, 94, { size: 28, weight: '900', color: '#f5f5f5', shadow, align: 'right' });
    this.ctx.save();
    this.ctx.translate(0, 48);
    this.truck(v.gT, v.grr, v.gfr, game.look);
    this.ctx.restore();
    this.buttons('title');
    const bests = [];
    if (game.best > 0) bests.push(`Best score: ${game.best}`);
    if (game.bestEndless > 0) bests.push(`Endless: ${game.bestEndless} m`);
    if (bests.length) this.text(bests.join('   ·   '), STAGE_W / 2, 396, { size: 14, weight: '600' });
    const hint = this.touchMode
      ? 'Use the on-screen pedals and tilt buttons to drive'
      : 'Arrow keys drive and tilt  ·  P pauses  ·  Esc returns to the menu';
    this.text(hint, STAGE_W / 2, 422, { size: 11, weight: '600', color: 'rgba(255,255,255,0.78)' });
  }

  // The menu screens were bitmaps with their text baked in. They are now drawn from the plain
  // backdrop plus the original art's keycaps and boxes, with the words as live text.

  help() {
    this.image('screen_plain.png');
    this.piece('screen_help.png', 205, 45, 62, 145); // the four arrow keycaps
    const label = { size: 14, weight: '600', align: 'left' };
    ['Forwards', 'Reverse', 'Tilt Back', 'Tilt Forwards'].forEach((name, i) => this.text(name, 269, 65 + i * 29.7, label));
    const line = { size: 14, weight: '600' };
    this.text('Press P to Pause', STAGE_W / 2, 202, line);
    this.text('Your truck is four-wheel drive.', STAGE_W / 2, 262, line);
    this.text('To climb steep hills, tilt forwards so that your front wheel stays on the ground.', STAGE_W / 2, 296, { ...line, size: 13.5 });
    this.buttons('help');
  }

  garage(game, v) {
    this.image('screen_plain.png');
    this.box('screen_garage.png', 10, 10, 556, 25, 10, 10, 556, 25, 12); // title bar
    this.text('Your Truck', STAGE_W / 2, 15.5, { size: 14, weight: '700' });
    this.truck(v.gT, v.grr, v.gfr, game.look);
    ['Body', 'Tyres', 'Wheels'].forEach((name, i) => {
      const y = 226 + i * 34;
      this.piece('screen_garage.png', 200, y, 32, 32); // arrow buttons
      this.piece('screen_garage.png', 344, y, 32, 32);
      this.text(name, STAGE_W / 2, y + 8, { size: 14, weight: '700' });
    });
    this.buttons('garage');
  }

  practiceSelect() {
    this.image('screen_plain.png');
    this.text('Choose a Stage', STAGE_W / 2, 164, { size: 14, weight: '700' });
    for (let i = 0; i < 9; i++) {
      const x = 136 + 34 * i;
      this.box('screen_practice.png', 136, 228, 32, 32, x, 228, 32, 32);
      this.text(String(i + 1), x + 16, 234.5, { size: 17, weight: '700' });
    }
    this.buttons('practiceSelect');
  }

  overlayDim(alpha) {
    this.ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    this.ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  }

  gameOver(game) {
    this.overlayDim(0.45);
    this.roundRect(158, 112, 260, 232, 10, 'rgba(140,97,79,0.96)', 'rgba(255,255,255,0.6)');
    const title = game.wrecked ? 'Truck Wrecked' : (game.finished && game.mode === 'campaign' ? 'Well Driven!' : 'Game Over');
    this.text(title, STAGE_W / 2, 128, { size: 30, weight: '900' });
    if (game.mode === 'endless') {
      this.text(`${game.metres} m  ·  ${game.lastScore}`, STAGE_W / 2, 182, { size: 17, weight: '600' });
      this.text(`Best: ${game.bestEndless} m`, STAGE_W / 2, 206, { size: 17, weight: '600' });
    } else {
      this.text(`Score: ${game.lastScore}`, STAGE_W / 2, 182, { size: 17, weight: '600' });
      this.text(`Best: ${game.best}`, STAGE_W / 2, 206, { size: 17, weight: '600' });
    }
    this.buttons('gameOver');
    const hint = this.touchMode ? '' : 'or press Space / Ctrl';
    if (hint) this.text(hint, STAGE_W / 2, 316, { size: 11, weight: '600', color: 'rgba(255,255,255,0.78)' });
  }

  paused() {
    this.overlayDim(0.3);
    this.text('Paused', STAGE_W / 2, 180, { size: 36, weight: '900', shadow: 'rgba(38,38,38,0.85)' });
    this.text(this.touchMode ? '' : 'Press P to resume play', STAGE_W / 2, 230, { size: 14, weight: '600' });
    this.buttons('paused');
  }

  /** Draw a full frame. `v` holds interpolated positions. */
  draw(game, v) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    this.stageTransform();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, STAGE_W, STAGE_H);
    ctx.clip();
    switch (game.screen) {
      case 'title': this.title(game, v); break;
      case 'help': this.help(); break;
      case 'garage': this.garage(game, v); break;
      case 'practiceSelect': this.practiceSelect(); break;
      case 'playing': this.world(game, v); break;
      case 'paused': this.world(game, v); this.paused(); break;
      case 'gameOver': this.world(game, v); this.gameOver(game); break;
    }
    ctx.restore();
  }
}
