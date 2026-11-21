// Emulates a phone in headless Chrome (via the DevTools protocol) to screenshot the touch layout
// and check that tapping the on-screen pedals drives the truck.
//
// Usage: node tools/serve.mjs 8790 &   then   node tests/phone-check.mjs [outDir] [baseUrl]
// Needs Google Chrome installed in the usual place (or set CHROME=/path/to/chrome). No npm packages.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = process.argv[2] || '.';
const base = process.argv[3] || 'http://127.0.0.1:8790/';
const chromePath = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ft-chrome-'))}`, 'about:blank',
], { stdio: 'ignore' });

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

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
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const phone = async (w, h) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  };
  const load = async (query) => {
    await send('Page.navigate', { url: base + query });
    for (let i = 0; i < 50; i++) { await sleep(100); if (await evaluate('!!window.__funkyTruck')) break; }
    await sleep(400);
  };
  const center = (sel) => evaluate(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null; })()`);
  const touch = (type, points) => send('Input.dispatchTouchEvent', {
    type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i })),
  });

  await send('Page.enable');
  await send('Runtime.enable');

  // Portrait phone: layout and the menu.
  await phone(390, 844);
  await load('');
  check(await evaluate('innerWidth') === 390, 'viewport is 390px wide');
  check(await evaluate('document.body.classList.contains("touch-mode")'), 'touch mode is detected');
  await shot('phone-portrait-title');

  // Tap PLAY on the canvas (stage 289,274 -> CSS pixels via the renderer's mapping).
  const playAt = await evaluate(`(() => { const { renderer } = window.__funkyTruck; const r = document.getElementById('game').getBoundingClientRect();
    const dpr = 1 / renderer.cssPerDevice; return [r.x + (renderer.offX + 289 * renderer.scale) / dpr, r.y + (renderer.offY + 274 * renderer.scale) / dpr]; })()`);
  await touch('touchStart', [playAt]); await touch('touchEnd', []);
  await sleep(300);
  check(await evaluate('window.__funkyTruck.game.screen') === 'playing', 'tapping PLAY starts the game');

  // Hold the gas pedal and check the truck moves forwards.
  await sleep(1500);
  const x0 = await evaluate('window.__funkyTruck.game.truck.T[0]');
  const gas = await center('[data-key="up"]');
  check(!!gas, 'gas pedal is visible in portrait');
  if (gas) {
    await touch('touchStart', [gas]);
    await sleep(2500);
    const held = await evaluate('window.__funkyTruck.game.keys.up');
    await shot('phone-portrait-driving');
    const layout = await evaluate(`(() => { const s = document.getElementById('stage').getBoundingClientRect(), c = document.getElementById('game').getBoundingClientRect(),
      { renderer } = window.__funkyTruck; return { stageTop: s.top, stageH: s.height, canvasTop: c.top, canvasH: c.height, bufH: renderer.canvas.height, offY: renderer.offY, screen: document.body.dataset.screen }; })()`);
    const winH = await evaluate('window.innerHeight');
    check(layout.canvasTop <= 1 && layout.canvasH >= winH - 1 && layout.offY === 0,
      `game fills the screen in portrait (${JSON.stringify(layout)}, window ${winH}px high)`);
    check(!(await evaluate('!!document.getElementById("rotate-tip")')), 'no tip to turn the phone sideways');
    await touch('touchEnd', []);
    const x1 = await evaluate('window.__funkyTruck.game.truck.T[0]');
    check(held, 'holding the gas pedal presses "up"');
    check(x1 - x0 > 50, `truck drove forwards while gas held (moved ${Math.round(x1 - x0)}px)`);
    check(!(await evaluate('window.__funkyTruck.game.keys.up')), 'releasing the pedal releases "up"');
  }

  // Two pedals at once (gas + tilt) must both register.
  const tiltBack = await center('[data-key="left"]');
  if (gas && tiltBack) {
    await touch('touchStart', [gas, tiltBack]);
    await sleep(200);
    const both = await evaluate('(() => { const k = window.__funkyTruck.game.keys; return k.up && k.left; })()');
    await touch('touchEnd', []);
    check(both, 'gas and tilt can be held at the same time');
  }

  // Pause button.
  const pause = await center('#pause-button');
  await touch('touchStart', [pause]); await touch('touchEnd', []);
  await sleep(200);
  check(await evaluate('window.__funkyTruck.game.screen') === 'paused', 'pause button pauses');
  await shot('phone-portrait-paused');
  await sleep(500);
  check(await evaluate('window.__funkyTruck.game.screen') === 'paused', 'game stays paused');

  // Landscape phone.
  await phone(844, 390);
  await load('?test=play&stage=1&frames=300&touch=1');
  await shot('phone-landscape-driving');
  const gasL = await center('[data-key="up"]');
  check(!!gasL && gasL[0] < 844 && gasL[1] < 390, 'gas pedal is on screen in landscape');

  // One-button controls: the pedals go, and holding anywhere drives.
  await evaluate('(() => { const g = window.__funkyTruck.game; g.oneButton = true; g.startCampaign(); })()');
  await sleep(1500);
  check(await evaluate('getComputedStyle(document.querySelector(".pad-right")).visibility') === 'hidden', 'one-button: the pedals are hidden');
  const xa = await evaluate('window.__funkyTruck.game.truck.T[0]');
  await touch('touchStart', [[600, 250]]);
  await sleep(1500);
  check(await evaluate('window.__funkyTruck.game.keys.one'), 'one-button: holding the screen presses the button');
  await shot('phone-landscape-one-button');
  await touch('touchEnd', []);
  const xb = await evaluate('window.__funkyTruck.game.truck.T[0]');
  check(xb - xa > 50, `one-button: the truck drove (moved ${Math.round(xb - xa)}px)`);
  const pauseL = await center('#pause-button');
  await touch('touchStart', [pauseL]); await touch('touchEnd', []);
  await sleep(200);
  check(await evaluate('window.__funkyTruck.game.screen') === 'paused', 'one-button: the pause button still works');

  ws.close();
} catch (err) {
  console.error(err);
  failures++;
} finally {
  chrome.kill();
}
console.log(failures ? `${failures} check(s) failed` : 'All phone checks passed');
process.exit(failures ? 1 : 0);
