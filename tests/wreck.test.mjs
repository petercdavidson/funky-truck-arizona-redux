// Wreck tests using the Wreck Lab's real crashes (bots driving the stages: tools/wreck-crashes.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CrashRun, BODIES } from '../tools/wreck-lab-sim.mjs';
import { WRECK } from '../src/wreck.js';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
const crashes = JSON.parse(readFileSync(new URL('../tools/wreck-crashes.json', import.meta.url)));

test('the crashes cover every stage, with trucks on their roofs among them', () => {
  for (let s = 0; s < data.levels.length; s++) assert.ok(crashes.some((c) => c.stage === s), `stage ${s + 1}`);
  assert.ok(crashes.filter((c) => c.lie === 'on its roof').length >= 9);
});

test('real crashes almost never leave both wheels sitting on top of the body, with any body', () => {
  // (it can happen, rarely, when the body rolls over onto both its loose wheels: at most 1%)
  let both = 0, runs = 0;
  for (const crash of crashes) {
    for (let body = 0; body < BODIES; body++) {
      const r = new CrashRun(data, crash, body, { lead: 0 }).finish();
      runs++;
      if (r.wheelsOnTop().filter(Boolean).length === 2) both++;
    }
  }
  assert.ok(both <= runs / 100, `both wheels stayed on top in ${both} of ${runs} runs`);
});

test('a wheel never ends up further into the body than it was when the truck was wrecked', () => {
  for (const crash of crashes) {
    for (let body = 0; body < BODIES; body++) {
      const W = new CrashRun(data, crash, body, { lead: 0 }).wreck, o0 = W.overlap0.wb;
      let worst = 0;
      for (let i = 0; i < 210; i++) { W.step(); W.overlaps().wb.forEach((o, k) => { worst = Math.max(worst, o - o0[k]); }); }
      assert.ok(worst < 5, `crash #${crash.id}, body ${body + 1}: a wheel went ${worst.toFixed(1)} px further in`);
    }
  }
});

test('the body rises out of the ground it was in at the wreck, without a jump', () => {
  for (const crash of crashes) {
    const W = new CrashRun(data, crash, 0, { lead: 0 }).wreck;
    const s = crash.truck.T, c0 = W.centre;
    let fastest = 0, prev = c0;
    for (let i = 0; i < WRECK.liftEase; i++) {
      W.step();
      const c = W.centre;
      fastest = Math.max(fastest, Math.hypot(c[0] - prev[0], c[1] - prev[1]) - Math.hypot(s[0] - crash.truck.P[0], s[1] - crash.truck.P[1]));
      prev = c;
    }
    assert.ok(fastest < 6, `crash #${crash.id}: the body moved ${fastest.toFixed(1)} px a step faster than the truck was going`);
  }
});

test('on its roof, the wheels hit the body: once the overlap at the wreck has cleared, none sinks into it', () => {
  for (const crash of crashes.filter((c) => c.lie === 'on its roof')) {
    for (let body = 0; body < BODIES; body++) {
      const W = new CrashRun(data, crash, body, { lead: 0 }).wreck;
      let sunk = 0;
      for (let i = 0; i < 280; i++) {
        W.step();
        if (i > WRECK.release + 5) sunk = Math.max(sunk, ...W.overlaps().wb);
      }
      assert.ok(sunk < 4, `crash #${crash.id}, body ${body + 1}: a wheel sank ${sunk.toFixed(1)} px into the body`);
    }
  }
});
