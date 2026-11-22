// make-wreck-shapes.mjs — traces each truck body's outline from its sprite, for the ragdoll wreck's
// collisions (src/wreck.js), and writes src/wreck-shapes.js.
//
//   npm start            (in another terminal; or set BASE to wherever the game is served)
//   node tools/make-wreck-shapes.mjs
//
// Each body is drawn as Renderer.wreck draws it, in the wreck's body frame (origin at the rear body
// mount, x towards the front mount), and its outline is sampled: the top and the bottom of the
// sprite at evenly spaced places along it, pulled in a little so the body sits on the ground
// convincingly. Needs Chrome (set CHROME if it isn't in the usual macOS place).

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.env.BASE || 'http://127.0.0.1:8765/';
const chromePath = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SAMPLES = 9, INSET = 2;

// Runs in the page: for each body, [[x, y], ...] around its outline (top left to right, then the
// bottom right to left), in the body frame.
function trace(samples, inset) {
  const { renderer } = window.__funkyTruck;
  const W = 400, H = 300, ox = 150, oy = 150; // where the body frame's origin goes on the canvas
  const out = [];
  for (let body = 0; body < 6; body++) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const old = renderer.ctx;
    renderer.ctx = ctx;
    // as Renderer.wreck: Wreck.bodyPose puts the sprite's origin at the rear body mount, scale 0.7
    ctx.translate(ox, oy);
    ctx.scale(0.7, 0.7);
    renderer.body({ body, paint: body, tyre: 0, hub: 0 });
    renderer.ctx = old;
    const px = ctx.getImageData(0, 0, W, H).data, solid = (x, y) => px[(y * W + x) * 4 + 3] > 128;
    let x0 = W, x1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (solid(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    const top = [], bottom = [];
    for (let i = 0; i < samples; i++) {
      const x = Math.round(x0 + inset + (x1 - x0 - 2 * inset) * i / (samples - 1));
      let t = 0, b = H - 1;
      while (t < H && !solid(x, t)) t++;
      while (b > 0 && !solid(x, b)) b--;
      if (t > b) continue;
      top.push([x - ox, t + inset - oy]);
      bottom.push([x - ox, b - inset - oy]);
    }
    out.push([...top, ...bottom.reverse()]);
  }
  return out;
}

const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ft-shapes-'))}`, 'about:blank'], { stdio: 'ignore' });
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
  await sleep(500);
  const shapes = await evaluate(`(${trace})(${SAMPLES}, ${INSET})`);
  const rows = shapes.map((s) => `  [${s.map(([x, y]) => `[${x}, ${y}]`).join(', ')}],`).join('\n');
  writeFileSync(new URL('../src/wreck-shapes.js', import.meta.url), `// wreck-shapes.js — each truck body's outline, for the ragdoll wreck's collisions (src/wreck.js).
// Made by tools/make-wreck-shapes.mjs from the body sprites: don't edit by hand, rerun it.
// One per body: [x, y] points around the outline (the top from the back to the front, then the
// bottom from the front to the back), in the wreck's body frame: origin at the rear body mount,
// x towards the front mount, px.

export const BODY_SHAPES = [
${rows}
];
`);
  console.log('wrote src/wreck-shapes.js');
  ws.close();
} finally {
  chrome.kill();
}
