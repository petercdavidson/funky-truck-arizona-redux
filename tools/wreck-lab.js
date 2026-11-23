// wreck-lab.js — the Wreck Lab page: every scene (tools/wreck-lab-sim.mjs) with every truck body,
// drawn with the game's own sprites and tiles, looping. Not part of the game.

import { loadAssets, tileImage } from '../src/assets.js';
import { Renderer } from '../src/render.js';
import { WRECK } from '../src/wreck.js';
import { SCENES, BODIES, LabRun, ROOF, tally } from './wreck-lab-sim.mjs';

const TILE = 64, VIEW_W = 300, VIEW_H = 200, HZ = 70;
const $ = (id) => document.getElementById(id);
const BODY_NAMES = ['Body 1', 'Body 2', 'Body 3', 'Body 4', 'Body 5', 'Body 6'];

const assets = await loadAssets('../assets/');
const data = assets.levels;
$('loading').remove();

// remembered choices
const saved = (() => { try { return JSON.parse(localStorage.getItem('funkytruck.wreckLab')) || {}; } catch { return {}; } })();
const save = () => { try { localStorage.setItem('funkytruck.wreckLab', JSON.stringify({ scene: $('scene').value, body: $('body').value, speed: $('speed').value, vary: $('vary').checked, boxes: $('boxes').checked })); } catch { /* fine */ } };

$('scene').innerHTML = '<option value="all">All scenes</option>' + SCENES.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
$('body').innerHTML = '<option value="all">All bodies</option>' + BODY_NAMES.slice(0, BODIES).map((n, i) => `<option value="${i}">${n}</option>`).join('');
if (saved.scene) $('scene').value = saved.scene; else $('scene').value = 'roof-drop';
if (saved.body) $('body').value = saved.body;
if (saved.speed) $('speed').value = saved.speed;
if (saved.vary !== undefined) $('vary').checked = saved.vary;
if (saved.boxes !== undefined) $('boxes').checked = saved.boxes;
if (!$('scene').value) $('scene').value = 'roof-drop';
if (!$('body').value) $('body').value = 'all';

let cells = [];

function build() {
  save();
  const scenes = $('scene').value === 'all' ? SCENES : SCENES.filter((s) => s.id === $('scene').value);
  const bodies = $('body').value === 'all' ? [...Array(BODIES).keys()] : [Number($('body').value)];
  const grid = $('grid');
  grid.innerHTML = '';
  cells = [];
  for (const scene of scenes) for (const body of bodies) {
    const el = document.createElement('div');
    el.className = 'cell';
    el.innerHTML = `<canvas></canvas><div class="cap"><span><b>${scene.name}</b> · ${BODY_NAMES[body]}</span><span class="out"></span></div>`;
    grid.append(el);
    const canvas = el.querySelector('canvas');
    const cell = { scene, body, canvas, out: el.querySelector('.out'), r: new Renderer(canvas, assets), seed: 0, wait: 0 };
    canvas.addEventListener('click', () => start(cell, true));
    start(cell, false);
    cells.push(cell);
  }
  sizeCanvases();
}

function start(cell, next) {
  if (next || $('vary').checked) cell.seed = $('vary').checked ? Math.floor(Math.random() * 1e9) + 1 : 0;
  cell.run = new LabRun(data, cell.scene, cell.body, cell.seed);
  cell.prev = snapshot(cell.run);
  cell.wait = 0;
  cell.cam = null;
  cell.out.textContent = '';
}

/** What's drawn: the truck's or the wreck's points and wheel turns. */
function snapshot(run) {
  if (run.wreck) return { W: run.wreck.T.slice(), rot: run.wreck.wheels.map((w) => w.rot) };
  const t = run.truck;
  return { T: t.T.slice(), rot: [t.rearWheelRot, t.frontWheelRot] };
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
  // camera: follows the truck or the wreck's body, gently
  const focus = run.wreck ? run.wreck.centre : [pts[0], pts[1]];
  if (!cell.cam) cell.cam = focus.slice();
  cell.cam[0] += (focus[0] - cell.cam[0]) * 0.15;
  cell.cam[1] += (focus[1] - cell.cam[1]) * 0.15;
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
      const id = gy > last ? (last >= 0 && L.tiles[last][gx] === 1 ? 1 : 0) : L.tiles[gy][gx];
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
    const saved = W.wheels.map((w) => w.rot);
    W.wheels.forEach((w, i) => { w.rot = rot[i]; });
    r.wreck(W, pts, look);
    W.wheels.forEach((w, i) => { w.rot = saved[i]; });
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
  const run = cell.run;
  if (run.missed) { cell.out.innerHTML = '<span class="warn">landed on its wheels</span>'; return; }
  const top = run.wheelsOnTop().filter(Boolean).length;
  const roof = ROOF.has(cell.scene.id);
  const txt = top === 0 ? 'both wheels off' : top === 1 ? 'one wheel on top' : 'both wheels on top';
  cell.out.innerHTML = roof && top === 2 ? `<span class="warn">${txt}</span>` : txt;
}

let last = performance.now(), acc = 0;
function frame(now) {
  const speed = Number($('speed').value);
  acc += Math.min(0.1, (now - last) / 1000) * speed * HZ;
  last = now;
  let steps = Math.floor(acc);
  acc -= steps;
  for (const cell of cells) {
    for (let i = 0; i < steps; i++) {
      cell.prev = snapshot(cell.run);
      if (!cell.run.done) {
        const was = !!cell.run.wreck;
        cell.run.step();
        if (cell.run.done) outcome(cell);
        else if (!was && cell.run.wreck) cell.out.textContent = 'wrecked…';
      } else if (++cell.wait > HZ * 1.5) { start(cell, false); break; }
    }
    draw(cell, acc);
  }
  requestAnimationFrame(frame);
}

for (const id of ['scene', 'body']) $(id).addEventListener('change', build);
for (const id of ['speed', 'vary', 'boxes']) $(id).addEventListener('change', save);
$('replay').addEventListener('click', () => cells.forEach((c) => start(c, true)));
$('tally').addEventListener('click', () => {
  $('stats').textContent = 'Running…';
  setTimeout(() => {
    const scenes = $('scene').value === 'all' ? SCENES : SCENES.filter((s) => s.id === $('scene').value);
    const rows = tally(data, 30, scenes);
    const lines = ['Wheels left on top of the body after 30 varied runs: both / one / none'];
    for (const s of scenes) {
      const list = rows.filter((r) => r.scene === s.id);
      lines.push(`${s.name.padEnd(30)} ${list.map((r) => `${r.both}/${r.one}/${r.none}`.padEnd(10)).join('')}`);
    }
    $('stats').textContent = lines.join('\n');
  }, 20);
});

build();
requestAnimationFrame(frame);
