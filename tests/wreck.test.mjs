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

test('no real crash leaves both wheels sitting on top of the body, with any body', () => {
  for (const crash of crashes) {
    for (let body = 0; body < BODIES; body++) {
      const r = new CrashRun(data, crash, body, { leadUp: false }).finish();
      assert.ok(r.wheelsOnTop().filter(Boolean).length < 2, `crash #${crash.id} (stage ${crash.stage + 1}, ${crash.lie}), body ${body + 1}`);
    }
  }
});

test('on its roof, the wheels hit the body: once the overlap at the wreck has cleared, none sinks into it', () => {
  for (const crash of crashes.filter((c) => c.lie === 'on its roof')) {
    for (let body = 0; body < BODIES; body++) {
      const W = new CrashRun(data, crash, body, { leadUp: false }).wreck;
      let sunk = 0;
      for (let i = 0; i < 280; i++) {
        W.step();
        if (i > WRECK.release + 5) sunk = Math.max(sunk, ...W.overlaps().wb);
      }
      assert.ok(sunk < 4, `crash #${crash.id}, body ${body + 1}: a wheel sank ${sunk.toFixed(1)} px into the body`);
    }
  }
});
