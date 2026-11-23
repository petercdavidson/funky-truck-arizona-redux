// wreck-lab.js — the Wreck Lab page: real crashes (bots driving the nine stages, see
// tools/make-wreck-crashes.mjs), two at a time, each with all six bodies: the driving before the
// crash is replayed, then the wreck runs live with the game's own Wreck, sprites and tiles. When
// all twelve have run for the time asked, it moves on to the next two. Not part of the game.

import { loadAssets, tileImage } from '../src/assets.js';
import { Renderer } from '../src/render.js';
import { WRECK } from '../src/wreck.js';
import { BODIES, CrashRun, tally } from './wreck-lab-sim.mjs';

const TILE = 64, VIEW_W = 300, VIEW_H = 200, HZ = 70, CAM = 0.2;
const $ = (id) => document.getElementById(id);

const [assets, crashes] = await Promise.all([
  loadAssets('../assets/'),
  fetch('wreck-crashes.json').then((r) => r.json()),
]);
const data = assets.levels;
$('loading').remove();

// remembered choices
const FIELDS = ['stage', 'lie', 'lead', 'after', 'speed', 'hold', 'boxes'];
const KEY = 'funkytruck.wreckLab3';
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
const save = () => {
  const o = { at };
  for (const f of FIELDS) o[f] = $(f).type === 'checkbox' ? $(f).checked : $(f).value;
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* fine */ }
};
$('stage').innerHTML = '<option value="all">All stages</option>' + data.levels.map((_, i) => `<option value="${i}">Stage ${i + 1}</option>`).join('');
for (const f of FIELDS) {
  if (saved[f] === undefined) continue;
  if ($(f).type === 'checkbox') $(f).checked = saved[f]; else $(f).value = saved[f];
  if ($(f).value === '') $(f).selectedIndex = 0;
}
let at = Number(saved.at) || 0; // the first of the two crashes showing, in the chosen list

/** A number box's value in seconds, to a tenth, kept in range. */
function seconds(id) {
  const el = $(id), v = Math.round(Math.min(Number(el.max), Math.max(Number(el.min), Number(el.value) || 0)) * 10) / 10;
  el.value = v.toFixed(1);
  return v;
}

function chosen() {
  return crashes.filter((c) => ($('stage').value === 'all' || c.stage === Number($('stage').value))
    && ($('lie').value === 'all' || c.lie === $('lie').value));
}

// Twelve cells, made once: six showing crash A with bodies 1-6 (on a desktop, the left two columns,
// three down), six crash B (the right two), each under its heading.
const cells = [], heads = [];
for (let i = 0; i < 12; i++) {
  if (i % 6 === 0) {
    const h = document.createElement('div');
    h.className = 'head' + (i ? ' b' : '');
    $('grid').append(h);
    heads.push(h);
  }
  const el = document.createElement('div');
  el.className = 'cell';
  const j = i % 6;
  el.style.gridRow = String(2 + Math.floor(j / 2));
  el.style.gridColumn = String((i < 6 ? 1 : 4) + (j % 2));
  el.innerHTML = '<canvas></canvas><div class="cap"><span class="who"></span><span class="out"></span></div>';
  $('grid').append(el);
  const canvas = el.querySelector('canvas');
  cells.push({ el, canvas, who: el.querySelector('.who'), out: el.querySelector('.out'), r: new Renderer(canvas, assets), body: i % BODIES, side: i < 6 ? 0 : 1 });
}

let pair = [];
let waiting = 0;
const describe = (c) => `<b>#${c.id} Stage ${c.stage + 1}</b> · ${c.lie}, ${c.kmh} km/h`;

/** Show the two crashes from `at` in the chosen list (wrapping round). */
function show() {
  const list = chosen();
  if (!list.length) { heads[0].textContent = 'No crashes match.'; heads[1].textContent = ''; $('where').textContent = ''; pair = []; return; }
  at = ((at % list.length) + list.length) % list.length;
  pair = [list[at], list[(at + 1) % list.length]];
  if (list.length === 1) pair = [list[0], list[0]];
  pair.forEach((c, i) => { heads[i].innerHTML = describe(c); });
  $('where').textContent = `${at + 1}–${Math.min(at + 2, list.length)} of ${list.length}`;
  save();
  restart();
}

function restart() {
  const lead = seconds('lead'), after = seconds('after');
  waiting = 0;
  for (const cell of cells) {
    const crash = pair[cell.side];
    cell.el.style.visibility = crash ? '' : 'hidden';
    if (!crash) continue;
    cell.run = new CrashRun(data, crash, cell.body, { lead, after });
    cell.prev = snapshot(cell.run);
    cell.cam = null;
    cell.who.innerHTML = `<b>#${crash.id}</b> · Body ${cell.body + 1}`;
    cell.out.textContent = cell.run.wreck ? 'wrecked…' : '';
  }
}

/** What's drawn: the truck's or the wreck's points and wheel turns. */
function snapshot(run) {
  if (run.wreck) return { W: run.wreck.T.slice(), rot: run.wreck.wheels.map((w) => w.rot) };
  const p = run.truckPose;
  return { T: p.slice(0, 10), rot: [p[10], p[11]] };
}

/** Size the twelve to fit the window, 4 across and 3 down (2 across on a phone, scrolling). */
function layout() {
  const grid = $('grid'), dpr = window.devicePixelRatio || 1;
  const narrow = innerWidth <= 640;
  if (narrow) grid.style.width = '';
  else {
    const top = grid.getBoundingClientRect().top + scrollY, capH = 20, gap = 8, headH = 30, mid = 6 + gap;
    const byHeight = ((innerHeight - top - 20 - headH - 3 * gap) / 3 - capH) * VIEW_W / VIEW_H;
    const byWidth = (innerWidth - 32 - 3 * gap - mid) / 4;
    const w = Math.max(160, Math.min(byWidth, byHeight));
    grid.style.width = `${4 * w + 3 * gap + mid + 32}px`;
  }
  for (const c of cells) {
    const w = c.canvas.clientWidth;
    c.canvas.width = Math.round(w * dpr);
    c.canvas.height = Math.round(w * dpr * VIEW_H / VIEW_W);
  }
}
addEventListener('resize', layout);

const lerp = (a, b, k) => a + (b - a) * k;

function draw(cell, k) {
  const { r, canvas, run } = cell, ctx = r.ctx;
  const cur = snapshot(run), prev = cell.prev;
  const same = !!prev.W === !!cur.W;
  const pts = (cur.W || cur.T).map((v, i) => (same ? lerp((prev.W || prev.T)[i], v, k) : v));
  const rot = cur.rot.map((v, i) => (same ? lerp(prev.rot[i], v, k) : v));
  // camera: follows the middle of the body, the same way before the wreck and after
  const focus = run.bodyCentre(run.wreck ? null : pts);
  if (!cell.cam) cell.cam = focus.slice();
  cell.cam[0] += (focus[0] - cell.cam[0]) * CAM;
  cell.cam[1] += (focus[1] - cell.cam[1]) * CAM;
  const s = canvas.width / VIEW_W;
  const camX = cell.cam[0] - VIEW_W / 2, camY = cell.cam[1] - VIEW_H * 0.55;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#8fb8d8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // tiles (below a column's last tile, if it's dirt, more dirt, as the game draws it)
  const L = run.w.level;
  for (let gx = Math.floor(camX / TILE); gx <= Math.floor((camX + VIEW_W) / TILE); gx++) {
    if (gx < 0 || gx >= L.width) continue;
    let last = L.height - 1;
    while (last >= 0 && L.tiles[last][gx] === 0) last--;
    for (let gy = Math.floor(camY / TILE); gy <= Math.floor((camY + VIEW_H) / TILE); gy++) {
      if (gy < 0) continue;
      const id = gy > last ? (last >= 0 && L.tiles[last][gx] === 1 ? 1 : 0) : gy < L.height ? L.tiles[gy][gx] : 0;
      if (!id) continue;
      const x0 = Math.round((gx * TILE - camX) * s), y0 = Math.round((gy * TILE - camY) * s);
      const x1 = Math.round(((gx + 1) * TILE - camX) * s), y1 = Math.round(((gy + 1) * TILE - camY) * s);
      ctx.drawImage(assets.tiles[id] || tileImage(assets, id), x0, y0, x1 - x0, y1 - y0);
    }
  }
  ctx.setTransform(s, 0, 0, s, -camX * s, -camY * s);
  const look = { body: cell.body, tyre: 0, hub: 0, paint: cell.body };
  if (run.wreck) {
    const W = run.wreck;
    const keep = W.wheels.map((w) => w.rot);
    W.wheels.forEach((w, i) => { w.rot = rot[i]; });
    r.wreck(W, pts, look);
    W.wheels.forEach((w, i) => { w.rot = keep[i]; });
    if ($('boxes').checked) hitboxes(ctx, W, pts);
  } else {
    r.truck(pts, rot[0], rot[1], look);
  }
}

function hitboxes(ctx, W, pts) {
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#ff0';
  ctx.beginPath();
  W.body.forEach((i, n) => (n ? ctx.lineTo(pts[i * 2], pts[i * 2 + 1]) : ctx.moveTo(pts[i * 2], pts[i * 2 + 1])));
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = '#0ff';
  for (const w of W.wheels) {
    ctx.beginPath();
    ctx.arc(pts[w.p * 2], pts[w.p * 2 + 1], WRECK.wheelRadius, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function outcome(cell) {
  const top = cell.run.wheelsOnTop().filter(Boolean).length;
  const txt = top === 0 ? 'both off' : top === 1 ? 'one on top' : 'both on top';
  cell.out.innerHTML = top === 2 ? `<span class="warn">${txt}</span>` : txt;
}

let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000) * Number($('speed').value) * HZ;
  last = now;
  const steps = Math.floor(acc);
  acc -= steps;
  if (pair.length) {
    for (let i = 0; i < steps; i++) {
      for (const cell of cells) {
        cell.prev = snapshot(cell.run);
        if (cell.run.done) continue;
        const was = !!cell.run.wreck;
        cell.run.step();
        if (cell.run.done) outcome(cell);
        else if (!was && cell.run.wreck) cell.out.textContent = 'wrecked…';
      }
      // all twelve done: a moment's pause, then the next two (or these again)
      if (cells.every((c) => c.run.done) && ++waiting > HZ) {
        if ($('hold').checked) restart(); else { at += 2; show(); }
        break;
      }
    }
    for (const cell of cells) draw(cell, acc);
  }
  requestAnimationFrame(frame);
}

for (const id of ['stage', 'lie']) $(id).addEventListener('change', () => { at = 0; show(); });
for (const id of ['lead', 'after']) $(id).addEventListener('change', () => { seconds(id); save(); restart(); });
for (const id of ['speed', 'hold', 'boxes']) $(id).addEventListener('change', save);
$('replay').addEventListener('click', restart);
$('next').addEventListener('click', () => { at += 2; show(); });
$('prev').addEventListener('click', () => { at -= 2; show(); });
for (const c of cells) c.canvas.addEventListener('click', restart);
$('tally').addEventListener('click', () => {
  if ($('stats').textContent) { $('stats').textContent = ''; layout(); return; }
  $('stats').textContent = 'Running…';
  setTimeout(() => {
    const rows = tally(data, chosen());
    const count = [0, 0, 0];
    const lines = ['Wheels left on top, per body 1-6 (. none, 1 one, 2 both), and the longest it took to settle (Tally again to hide)'];
    for (const { crash: c, on, settle } of rows) {
      on.forEach((n) => count[n]++);
      const max = Math.max(...settle);
      lines.push(`#${String(c.id).padStart(2)} Stage ${c.stage + 1}  ${c.lie.padEnd(12)} ${String(c.kmh).padStart(3)} km/h   ${on.map((n) => n || '.').join(' ')}   ${max >= 10 ? 'never settles' : `${max.toFixed(1)} s`}`);
    }
    const all = count[0] + count[1] + count[2] || 1;
    lines.push(`All: both on top ${Math.round(count[2] / all * 100)}%, one ${Math.round(count[1] / all * 100)}%, none ${Math.round(count[0] / all * 100)}%`);
    $('stats').textContent = lines.join('\n');
  }, 20);
});

show();
layout();
requestAnimationFrame(frame);
