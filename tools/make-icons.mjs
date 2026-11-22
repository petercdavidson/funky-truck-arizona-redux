// make-icons.mjs — draws the site / app icons from the game's own art: your truck (the garage's
// resting truck, default look) on the game's sky and ground tiles, at the game's own proportions.
//
//   npm start            (in another terminal; or set BASE to wherever the game is served)
//   node tools/make-icons.mjs
//
// Writes assets/icon-512.png, assets/icon-256.png and assets/favicon-32.png. Needs Chrome
// (set CHROME if it isn't in the usual macOS place).

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.env.BASE || 'http://127.0.0.1:8765/';
const chromePath = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in the page: returns { size: dataURL } for each size.
function drawIcons(sizes) {
  const { game, renderer } = window.__funkyTruck;
  const g = game.garageTruck, look = { body: 0, paint: 0, tyre: 0, hub: 0 };
  // The truck alone, on a big scratch canvas, to find its edges.
  const scratch = document.createElement('canvas');
  scratch.width = scratch.height = 1024;
  const old = renderer.ctx;
  const drawTruck = (ctx) => { renderer.ctx = ctx; renderer.truck(g.T, 0, 0, look); renderer.ctx = old; };
  const sctx = scratch.getContext('2d');
  sctx.translate(512 - g.T[0], 512 - g.T[1]);
  drawTruck(sctx);
  const px = sctx.getImageData(0, 0, 1024, 1024).data;
  let x0 = 1024, y0 = 1024, x1 = 0, y1 = 0;
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
    if (px[(y * 1024 + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  // truck edges, in the truck's own coordinates
  const box = { x0: x0 - 512 + g.T[0], x1: x1 - 512 + g.T[0], y0: y0 - 512 + g.T[1], y1: y1 - 512 + g.T[1] };
  const out = {};
  for (const size of sizes) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const S = size / 512;
    ctx.scale(S, S);
    // The truck fills most of the width; the tiles and sky keep the game's scale to it.
    const small = size <= 32;
    const k = (small ? 500 : 380) / (box.x1 - box.x0);
    const groundY = small ? 470 : 400;
    // sky: the game's backdrop, its upper part
    const bg = renderer.a.images['bg.jpg'];
    const bw = bg.width, bh = bg.height, cropH = bh * 0.72;
    ctx.drawImage(bg, (bw - cropH) / 2, 0, cropH, cropH, 0, 0, 512, 512);
    // ground: a row of flat-topped tiles, then solid dirt below
    const T = 64 * k;
    for (let x = -T / 2; x < 512; x += T) {
      ctx.drawImage(renderer.a.tiles[2], x, groundY - T * 0.42, T, T);
      for (let y = groundY - T * 0.42 + T; y < 512; y += T) ctx.drawImage(renderer.a.tiles[1], x, y, T + 1, T + 1);
    }
    // the truck, centred, its tyres on the ground
    ctx.save();
    ctx.translate(256 - k * (box.x0 + box.x1) / 2, groundY - k * box.y1);
    ctx.scale(k, k);
    drawTruck(ctx);
    ctx.restore();
    out[size] = c.toDataURL('image/png');
  }
  return out;
}

const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ft-icons-'))}`, 'about:blank'], { stdio: 'ignore' });
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  if (!target) throw new Error('Chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'page error');
    return r.result.value;
  };
  await send('Page.navigate', { url: `${base}?test=title` });
  for (let i = 0; i < 100; i++) { await sleep(100); if (await evaluate('!!window.__funkyTruck')) break; }
  await sleep(1500); // the garage truck settles
  const icons = await evaluate(`(${drawIcons})([512, 256, 32])`);
  const save = (name, url) => { writeFileSync(new URL(`../assets/${name}`, import.meta.url), Buffer.from(url.split(',')[1], 'base64')); console.log(`wrote assets/${name}`); };
  save('icon-512.png', icons[512]);
  save('icon-256.png', icons[256]);
  save('favicon-32.png', icons[32]);
  ws.close();
} finally {
  chrome.kill();
}
