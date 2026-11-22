// make-tile-art.mjs — samples the pixels along each tile's four edges, so the editor's Path tool
// (src/autotile.js) can tell which tiles look joined up when placed side by side, and writes
// src/tile-art.js.
//
//   npm start            (in another terminal; or set BASE to wherever the game is served)
//   node tools/make-tile-art.mjs
//
// Each edge is 32 samples (2 px each, read 1-2 px in from the edge so the tile sheet's JPEG
// doesn't bleed in from the next tile): the opacity, and the brightness of the opaque part.
// Needs Chrome (set CHROME if it isn't in the usual macOS place). Rerun it if the tile art changes.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.env.BASE || 'http://127.0.0.1:8765/';
const chromePath = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9336;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in the page: one string per tile, its edges top, right, bottom, left; each 32 opacity
// characters then 32 brightness characters (base64 digits, 0-63). Top and bottom run left to
// right, left and right top to bottom.
async function sample() {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const { loadAssets } = await import(new URL('src/assets.js', location.href).href);
  const a = await loadAssets(new URL('assets/', location.href).href);
  return a.tiles.map((t) => {
    const d = t.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 64, 64).data;
    const at = (x, y) => (y * 64 + x) * 4;
    // (x, y) of sample k (0..31), at depth j (0..1) into the tile, for each edge
    const where = [
      (k, i, j) => [2 * k + i, 1 + j],
      (k, i, j) => [62 - j, 2 * k + i],
      (k, i, j) => [2 * k + i, 62 - j],
      (k, i, j) => [1 + j, 2 * k + i],
    ];
    let out = '';
    for (const w of where) {
      let al = '', lu = '';
      for (let k = 0; k < 32; k++) {
        let A = 0, L = 0;
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
          const p = at(...w(k, i, j)), alpha = d[p + 3] / 255;
          A += alpha; L += alpha * (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]);
        }
        al += B64[Math.round(A / 4 * 63)];
        lu += B64[A > 0.05 ? Math.min(63, Math.round(L / A / 4)) : 0];
      }
      out += al + lu;
    }
    return out;
  });
}

const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ft-art-'))}`, 'about:blank'], { stdio: 'ignore' });
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
  await sleep(800);
  const edges = await evaluate(`(${sample})()`);
  writeFileSync(new URL('../src/tile-art.js', import.meta.url), `// tile-art.js — the pixels along each tile's edges, for the Path tool's look (src/autotile.js).
// Made by tools/make-tile-art.mjs from the tile sheet: don't edit by hand, rerun it.
// One string per tile id: its edges top, right, bottom, left; each 32 opacity samples then 32
// brightness samples, base64 digits (0-63). Top and bottom run left to right, the sides top to bottom.

export const TILE_EDGES = [
${edges.map((s) => `  '${s}',`).join('\n')}
];
`);
  console.log(`wrote src/tile-art.js (${edges.length} tiles)`);
  ws.close();
} finally {
  chrome.kill();
}
