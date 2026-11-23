// wreck-lab.js — the Wreck Lab page: real crashes (bots driving the nine stages, see
// tools/make-wreck-crashes.mjs) replayed, then wrecked live with the game's own Wreck, sprites and
// tiles, looping. Not part of the game.

import { loadAssets, tileImage } from '../src/assets.js';
import { Renderer } from '../src/render.js';
import { WRECK } from '../src/wreck.js';
import { BODIES, CrashRun, tally } from './wreck-lab-sim.mjs';

const TILE = 64, VIEW_W = 300, VIEW_H = 200, HZ = 70;
const $ = (id) => document.getElementById(id);

const [assets, crashes] = await Promise.all([
  loadAssets('../assets/'),
  fetch('wreck-crashes.json').then((r) => r.json()),
]);
const data = assets.levels;
$('loading').remove();

// remembered choices
const FIELDS = ['stage', 'lie', 'body', 'speed', 'lead', 'boxes'];
const saved = (() => { try { return JSON.parse(localStorage.getItem('funkytruck.wreckLab2')) || {}; } catch { return {}; } })();
const save = () => {
  const o = {};
  for (const f of FIELDS) o[f] = $(f).type === 'checkbox' ? $(f).checked : $(f).value;
  try { localStorage.setItem('funkytruck.wreckLab2', JSON.stringify(o)); } catch { /* fine */ }
};
$('stage').innerHTML = '<option value="all">All stages</option>' + data.levels.map((_, i) => `<option value="${i}">Stage ${i + 1}</option>`).join('');
$('body').innerHTML = '<option value="cycle">Each in turn</option>' + [...Array(BODIES).keys()].map((i) => `<option value="${i}">Body ${i + 1}</option>`).join('');
for (const f of FIELDS) {
  if (saved[f] === undefined) continue;
  if ($(f).type === 'checkbox') $(f).checked = saved[f]; else $(f).value = saved[f];
  if ($(f).value === '') $(f).selectedIndex = 0;
}

let cells = [];
const seen = new IntersectionObserver((entries) => { for (const e of entries) e.target.cell.visible = e.isIntersecting; });

function chosen() {
  return crashes.filter((c) => ($('stage').value === 'all' || c.stage === Number($('stage').value))
    && ($('lie').value === 'all' || c.lie === $('lie').value));
}

function build() {
  save();
  const grid = $('grid');
  seen.disconnect();
  grid.innerHTML = '';
  cells = [];
  const list = chosen();
  $('count').textContent = `${list.length} crash${list.length === 1 ? '' : 'es'}`;
  for (const crash of list) {
    const el = document.createElement('div');
    el.className = 'cell';
    el.innerHTML = `<canvas></canvas><div class="cap"><span><b>#${crash.id} Stage ${crash.stage + 1}</b> · ${crash.lie}, ${crash.kmh} km/h · <span class="bd"></span></span><span class="out"></span></div>`;
    grid.append(el);
    const canvas = el.querySelector('canvas');
    const cell = { crash, canvas, el, out: el.querySelector('.out'), bd: el.querySelector('.bd'), r: new Renderer(canvas, assets), body: -1, visible: true };
    el.cell = cell;
    seen.observe(el);
    canvas.addEventListener('click', () => start(cell));
    start(cell);
    cells.push(cell);
  }
  sizeCanvases();
}

function start(cell) {
  const b = $('body').value;
  cell.body = b === 'cycle' ? (cell.body + 1 + BODIES) % BODIES : Number(b);
  cell.run = new CrashRun(data, cell.crash, cell.body, { leadUp: $('lead').checked });
  cell.prev = snapshot(cell.run);
  cell.wait = 0;
  cell.cam = null;
  cell.bd.textContent = `Body ${cell.body + 1}`;
  cell.out.textContent = cell.run.wreck ? 'wrecked…' : '';
}

/** What's drawn: the truck's or the wreck's points and wheel turns. */
function snapshot(run) {
  if (run.wreck) return { W: run.wreck.T.slice(), rot: run.wreck.wheels.map((w) => w.rot) };
  const p = run.truckPose;
  return { T: p.slice(0, 10), rot: [p[10], p[11]] };
}

function sizeCanvases() {
  const dpr = window.devicePixelRatio || 1;
  for (const c of cells) {
    const w = c.canvas.clientWidth;
    c.canvas.width = Math.round(w * dpr);
    c.canvas.height = Math.round(w * dpr * VIEW_H / VIEW_W);
  }
}
addEventListener('resize', sizeCanvases);

const lerp = (a, b, k) => a + (b - a) * k;

function draw(cell, k) {
  const { r, canvas, run } = cell, ctx = r.ctx;
  const cur = snapshot(run), prev = cell.prev;
  const same = !!prev.W === !!cur.W;
  const pts = (cur.W || cur.T).map((v, i) => (same ? lerp((prev.W || prev.T)[i], v, k) : v));
  const rot = cur.rot.map((v, i) => (same ? lerp(prev.rot[i], v, k) : v));
  // camera: follows the truck, then the wreck's body
  const focus = run.wreck ? run.wreck.centre : [pts[0], pts[1]];
  if (!cell.cam) cell.cam = focus.slice();
  cell.cam[0] += (focus[0] - cell.cam[0]) * 0.2;
  cell.cam[1] += (focus[1] - cell.cam[1]) * 0.2;
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
  // what the wheels hit (the outline with its underside flat)
  ctx.strokeStyle = '#f80';
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  W.wheelOutline().forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#0ff';
  for (const w of W.wheels) {
    ctx.beginPath();
    ctx.arc(pts[w.p * 2], pts[w.p * 2 + 1], WRECK.wheelRadius, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function outcome(cell) {
  const top = cell.run.wheelsOnTop().filter(Boolean).length;
  const txt = top === 0 ? 'both wheels off' : top === 1 ? 'one wheel on top' : 'both wheels on top';
  const slow = cell.run.wreck.steps > HZ * 10 ? ' · never settled' : '';
  cell.out.innerHTML = top === 2 || slow ? `<span class="warn">${txt}${slow}</span>` : txt;
}

let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000) * Number($('speed').value) * HZ;
  last = now;
  const steps = Math.floor(acc);
  acc -= steps;
  for (const cell of cells) {
    if (!cell.visible) continue;
    for (let i = 0; i < steps; i++) {
      cell.prev = snapshot(cell.run);
      if (!cell.run.done) {
        const was = !!cell.run.wreck;
        cell.run.step();
        if (cell.run.done) outcome(cell);
        else if (!was && cell.run.wreck) cell.out.textContent = 'wrecked…';
      } else if (++cell.wait > HZ * 1.5) { start(cell); break; }
    }
    draw(cell, acc);
  }
  requestAnimationFrame(frame);
}

for (const id of ['stage', 'lie']) $(id).addEventListener('change', build);
for (const id of ['speed', 'boxes', 'body', 'lead']) $(id).addEventListener('change', save);
$('replay').addEventListener('click', () => cells.forEach((c) => start(c)));
$('tally').addEventListener('click', () => {
  $('stats').textContent = 'Running…';
  setTimeout(() => {
    const rows = tally(data, chosen());
    const count = [0, 0, 0];
    const lines = ['Wheels left on top, per body 1-6 (. none, 1 one, 2 both), and the longest it took to settle'];
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

build();
requestAnimationFrame(frame);
