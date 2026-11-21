// Regenerates assets/vector.json (and the app icon, assets/icon.svg) from the raster originals in art/raster/, by running
// tools/vectorize/index.html in headless Chrome (it needs a canvas to decode the images).
//
// Usage: PORT=8790 npm start &   then   node tools/vectorize.mjs [baseUrl]
// Needs Google Chrome (or set CHROME=/path/to/chrome). No npm packages.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:8790/';
const chromePath = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ft-chrome-'))}`, 'about:blank',
], { stdio: 'ignore' });

/** One shape per line keeps diffs of the generated file readable. */
function stringify(v, ind = '') {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'd' in v) return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (!v.some((x) => x && typeof x === 'object')) return JSON.stringify(v);
    return '[\n' + v.map((x) => ind + ' ' + stringify(x, ind + ' ')).join(',\n') + '\n' + ind + ']';
  }
  if (v && typeof v === 'object') {
    return '{\n' + Object.entries(v).map(([k, x]) => `${ind} ${JSON.stringify(k)}: ${stringify(x, ind + ' ')}`).join(',\n') + '\n' + ind + '}';
  }
  return JSON.stringify(v);
}

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
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
  await send('Page.navigate', { url: base + 'tools/vectorize/index.html' });
  for (let i = 0; i < 600; i++) { await sleep(250); if (await evaluate('window.done === true')) break; }
  const err = await evaluate('window.error || null');
  if (err) throw new Error(err);
  const result = await evaluate('window.result');
  if (!result) throw new Error('No result (timed out?)');
  const text = stringify(result) + '\n';
  writeFileSync(new URL('../assets/vector.json', import.meta.url), text);
  writeFileSync(new URL('../assets/icon.svg', import.meta.url), await evaluate('window.icon'));
  console.log(`Wrote assets/vector.json (${Math.round(text.length / 1024)} KB)`, JSON.stringify(await evaluate('window.debug')));
  ws.close();
} finally {
  chrome.kill();
}
