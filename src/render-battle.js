// render-battle.js — drawing Sandbox's cars (battle.js): rival and enemy trucks, missiles,
// explosions, and the extra HUD. Called by Renderer (render.js), in the same stage coordinates.
//
// Enemies are simulated in a mirror image of the world, so they're drawn flipped (scale -1, 1)
// from their own points: the same truck sprites as yours, facing the other way. Rivals go your
// way, so they're drawn as yours is.

import { HUD_FONT } from './assets.js';

const INK = '#3b2f2a';            // outlines: the dark brown of the game's shadows
const GOLD = '#ffe27a';
const WARN = '#ff8a5c';

/**
 * Icons, as SVG path data in a 24x24 box, drawn as round-capped white strokes like the on-screen
 * controls (index.html uses the same paths on Sandbox's buttons).
 */
export const ICONS = {
  missile: 'M3 9.5h11l5.5 2.5-5.5 2.5H3z M6 9.5L3.5 5.5 M6 14.5l-2.5 4',
  jump: 'M12 2.5v7 M8.5 6L12 2.5 15.5 6 M7 12.5h10l-10 3h10l-10 3h10 M6 21.5h12',
  boost: 'M13.5 2.5L5.5 13.5h6l-1 8 8-11.5h-6z',
};

/** Where to draw enemy `e` and missile `m` this frame: interpolated if the frame has them. */
const enemyPose = (v, e) => v.B?.e.get(e.id) || { T: e.wreck ? e.wreck.T : e.truck.T, rr: e.truck.rearWheelRot, fr: e.truck.frontWheelRot };
const missilePos = (v, m) => v.B?.m.get(m.id) || [m.x, m.y];

// ---- in the world (behind and in front of your truck)

/** Rival and enemy trucks and wrecks, and your boost flame: drawn before your truck. */
export function battleBack(r, game, v) {
  const b = game.battle, ctx = r.ctx;
  for (const e of b.racers) {
    const d = enemyPose(v, e);
    if (e.hopFor > 0) flame(ctx, d.T);
    r.truck(d.T, d.rr, d.fr, e.look);
  }
  for (const e of b.enemies) {
    const d = enemyPose(v, e);
    ctx.save();
    ctx.scale(-1, 1);
    if (e.wreck) {
      ctx.globalAlpha = Math.max(0, Math.min(1, (900 - e.wreckAge) / 120));
      r.wreck(e.wreck, d.T, e.look);
    } else {
      r.truck(d.T, d.rr, d.fr, e.look);
      kit(ctx, e.kind, d.T);
    }
    ctx.restore();
  }
  if (b.boosting && !game.wreck) flame(ctx, v.T);
}

/** Missiles, explosions, particles and the enemies' health bars: drawn after your truck. */
export function battleFront(r, game, v) {
  const b = game.battle, ctx = r.ctx;
  for (const m of b.missiles) missile(ctx, m, missilePos(v, m), b.steps);
  for (const bit of b.bits) particle(r, bit);
  for (const x of b.blasts) blast(ctx, x);
  for (const e of b.enemies) {
    if (e.wreck || e.showHealth <= 0) continue;
    const T = enemyPose(v, e).T;
    const x = -(T[0] + T[2] + T[4] + T[6] + T[8]) / 5, y = Math.min(T[7], T[9]) - 44;
    healthBar(r, x, y, e.health / e.type.health, Math.min(1, e.showHealth / 20));
  }
}

function kit(ctx, kind, T) {
  ctx.save();
  ctx.translate(T[6], T[7]);
  ctx.rotate(Math.atan2(T[9] - T[7], T[8] - T[6]));
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
  const shape = (pts, fill) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.stroke();
  };
  if (kind === 'basher') {
    // a bull bar on the front
    shape([[58, -12], [66, -10], [66, 8], [58, 10]], '#4a403b');
    ctx.strokeStyle = '#9a8f88'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(62, -9); ctx.lineTo(62, 7); ctx.stroke();
  } else if (kind === 'speeder') {
    // a spoiler at the back
    shape([[-2, -24], [1, -24], [-1, -33], [-4, -33]], '#3f3a37');
    shape([[-16, -37], [6, -36], [6, -32], [-14, -32]], '#d9533b');
  } else if (kind === 'heavy') {
    // an armoured ram plate on the front, with rivets
    shape([[56, -20], [72, -14], [72, 12], [56, 12]], '#8d9094');
    ctx.fillStyle = INK;
    for (const [x, y] of [[61, -12], [67, -7], [61, 5], [67, 5]]) { ctx.beginPath(); ctx.arc(x, y, 1.4, 0, 7); ctx.fill(); }
    // and armour along the side
    ctx.strokeStyle = 'rgba(59,47,42,0.6)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-6, 4); ctx.lineTo(54, 4); ctx.stroke();
  } else if (kind === 'gunner') {
    // a rocket launcher on the roof, pointing forwards and up a little
    shape([[18, -24], [26, -24], [24, -30], [20, -30]], '#3f3a37');
    ctx.save();
    ctx.translate(22, -32);
    ctx.rotate(-0.15);
    shape([[-14, -5], [16, -5], [16, 5], [-14, 5]], '#5d625f');
    shape([[16, -6], [20, -6], [20, 6], [16, 6]], '#d9533b');
    ctx.restore();
  }
  ctx.restore();
}

/** The boost's flame out of the back of your truck (T: your truck's points). */
function flame(ctx, T) {
  ctx.save();
  ctx.translate(T[6], T[7]);
  ctx.rotate(Math.atan2(T[9] - T[7], T[8] - T[6]));
  const L = 26 + Math.random() * 16;
  const cone = (len, h, fill) => {
    ctx.beginPath();
    ctx.moveTo(-8, -4 - h);
    ctx.quadraticCurveTo(-8 - len * 0.6, -4 - h * 0.8, -8 - len, -4);
    ctx.quadraticCurveTo(-8 - len * 0.6, -4 + h * 0.8, -8, -4 + h);
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
  };
  cone(L, 7, 'rgba(240, 120, 50, 0.85)');
  cone(L * 0.6, 4.5, 'rgba(255, 226, 122, 0.95)');
  cone(L * 0.25, 2.5, 'rgba(255, 255, 240, 0.95)');
  ctx.restore();
}

function missile(ctx, m, [x, y], steps) {
  const yours = m.owner === 'you';
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(m.ang);
  ctx.scale(1.25, 1.25);
  ctx.lineJoin = 'round';
  // flame
  const L = 6 + Math.random() * 6;
  ctx.fillStyle = 'rgba(240, 120, 50, 0.9)';
  ctx.beginPath(); ctx.moveTo(-9, -2.6); ctx.lineTo(-9 - L, 0); ctx.lineTo(-9, 2.6); ctx.fill();
  ctx.fillStyle = 'rgba(255, 226, 122, 0.95)';
  ctx.beginPath(); ctx.moveTo(-9, -1.4); ctx.lineTo(-9 - L * 0.5, 0); ctx.lineTo(-9, 1.4); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 1.1;
  const fin = yours ? '#d9533b' : WARN;
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(-9, 2.6 * s); ctx.lineTo(-4, 2.6 * s); ctx.lineTo(-10, 6.5 * s); ctx.closePath();
    ctx.fillStyle = fin; ctx.fill(); ctx.stroke();
  }
  ctx.beginPath(); ctx.roundRect(-9, -3, 17, 6, 2);
  ctx.fillStyle = yours ? '#efe9df' : '#55534f'; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8, -3); ctx.quadraticCurveTo(13, -1.5, 14, 0); ctx.quadraticCurveTo(13, 1.5, 8, 3); ctx.closePath();
  ctx.fillStyle = yours ? '#d9533b' : '#2f2c2a'; ctx.fill(); ctx.stroke();
  if (!yours && Math.floor(steps / 6) % 2 === 0) { ctx.fillStyle = '#ff4a3a'; ctx.beginPath(); ctx.arc(1, 0, 1.6, 0, 7); ctx.fill(); }
  ctx.restore();
}

function blast(ctx, b) {
  const t = b.age / b.life;
  ctx.save();
  // the fireball: grows in a few steps, then fades as it shrinks
  const R = b.r * (b.big ? 0.8 : 0.62) * Math.min(1, (b.age + 1) / 5) * (1 - t * 0.45);
  const a = 1 - t;
  const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, R);
  g.addColorStop(0, `rgba(255, 252, 230, ${a})`);
  g.addColorStop(0.3, `rgba(255, 211, 107, ${a})`);
  g.addColorStop(0.7, `rgba(240, 120, 50, ${a * 0.8})`);
  g.addColorStop(1, 'rgba(160, 70, 40, 0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, 7); ctx.fill();
  // the shock ring
  ctx.strokeStyle = `rgba(255, 240, 210, ${0.7 * a})`;
  ctx.lineWidth = 4 * a;
  ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (0.35 + t * 0.85), 0, 7); ctx.stroke();
  ctx.restore();
}

function particle(r, b) {
  const ctx = r.ctx, f = b.life / b.max;
  if (b.kind === 'dirt') {
    const s = r.a.sprites.dirt[b.frame];
    ctx.globalAlpha = Math.min(1, b.life / 10);
    const k = b.size * 0.9;
    ctx.drawImage(s.img, b.x + s.tx * k, b.y + s.ty * k, s.img.width * k, s.img.height * k);
    ctx.globalAlpha = 1;
  } else if (b.kind === 'spark') {
    ctx.strokeStyle = `rgba(255, 226, 122, ${f})`;
    ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 2, b.y - b.vy * 2); ctx.stroke();
  } else if (b.kind === 'smoke') {
    ctx.fillStyle = `rgba(96, 84, 78, ${0.34 * f})`;
    ctx.beginPath(); ctx.arc(b.x, b.y, (5 + (1 - f) * 15) * b.size + 2, 0, 7); ctx.fill();
  } else if (b.kind === 'fire') {
    ctx.fillStyle = f > 0.5 ? `rgba(255, 211, 107, ${f})` : `rgba(240, 120, 50, ${f * 1.6})`;
    ctx.beginPath(); ctx.arc(b.x, b.y, (2 + 5 * f) * b.size + 1, 0, 7); ctx.fill();
  }
}

function healthBar(r, x, y, share, alpha) {
  const ctx = r.ctx;
  ctx.save();
  ctx.globalAlpha = alpha;
  r.roundRect(x - 23, y - 4, 46, 8, 4, 'rgba(0,0,0,0.35)', 'rgba(255,255,255,0.85)', 1.5);
  const s = Math.max(0, Math.min(1, share));
  if (s > 0) r.roundRect(x - 21, y - 2, 42 * s, 4, 2, s > 0.5 ? '#8ff0a4' : s > 0.25 ? GOLD : '#ff8a6a');
  ctx.restore();
}

// ---- the HUD (stage coordinates, the view `r.viewW` across)

/** Sandbox's HUD (boost, jumps and missiles never run out, so there's no meter): warnings, callouts and the keys. */
export function battleHud(r, game) {
  const b = game.battle, ctx = r.ctx;
  if (game.screen !== 'playing') return;
  warnings(r, game);
  if (b.callout) {
    const c = b.callout, age = 90 - c.timer, pop = 1 + 0.35 * Math.max(0, 1 - age / 7) ** 2;
    ctx.save();
    ctx.globalAlpha = Math.min(1, c.timer / 20, age / 3 + 0.3);
    ctx.translate(r.viewW / 2, 200);
    ctx.scale(pop, pop);
    r.text(c.text, 0, -10, { size: 19, font: HUD_FONT, weight: '900', color: c.gold ? GOLD : '#fff' });
    ctx.restore();
  }
  // The keys, for the first few seconds (touch screens have labelled buttons).
  if (!r.touchMode && b.steps < 560) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, (560 - b.steps) / 60);
    r.text('Z jump  ·  X fire a missile  ·  C or Shift boost', r.viewW / 2, r.viewH - 34, { size: 13, weight: '700', color: 'rgba(255,255,255,0.85)' });
    ctx.restore();
  }
  if (b.hurt > 0) {
    const g = ctx.createRadialGradient(r.viewW / 2, r.viewH / 2, Math.min(r.viewW, r.viewH) * 0.35, r.viewW / 2, r.viewH / 2, Math.max(r.viewW, r.viewH) * 0.7);
    g.addColorStop(0, 'rgba(200, 40, 30, 0)');
    g.addColorStop(1, `rgba(200, 40, 30, ${0.4 * b.hurt / 14})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, r.viewW, r.viewH);
  }
}

/** A pointer at the right edge for each enemy coming that's not on screen yet. */
function warnings(r, game) {
  const ctx = r.ctx, z = game.zoom;
  for (const e of game.battle.enemies) {
    if (e.wreck) continue;
    const [ex, ey] = e.centre, sx = (ex - game.camX) / z;
    if (sx < r.viewW + 8) continue;
    const near = Math.max(0.35, Math.min(1, 1 - (sx - r.viewW) / 900));
    const y = Math.max(80, Math.min(r.viewH - 110, (ey - game.camY) / z));
    const x = r.viewW - 24, pulse = 0.75 + 0.25 * Math.sin(game.battle.steps * 0.25);
    ctx.save();
    ctx.globalAlpha = near * pulse;
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(-6, -13); ctx.quadraticCurveTo(-12, -14, -12, -8); ctx.lineTo(-12, 8); ctx.quadraticCurveTo(-12, 14, -6, 13);
    ctx.closePath();
    ctx.fillStyle = e.type.gun ? '#ff6a4a' : WARN; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.stroke();
    r.text('!', -3, -9, { size: 15, font: HUD_FONT, weight: '900' });
    ctx.restore();
  }
}

/** For the help text and tests: what the keys do in Sandbox. */
export const BATTLE_KEYS = 'Z jumps, X fires a missile, C (or Shift) boosts';
