// Wreck tests using the Wreck Lab's scenes (tools/wreck-lab-sim.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LabRun, SCENES, BODIES, ROOF } from '../tools/wreck-lab-sim.mjs';
import { WRECK } from '../src/wreck.js';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));

test('a truck wrecked on its roof never leaves both wheels sitting on top of it', () => {
  for (const scene of SCENES.filter((s) => ROOF.has(s.id))) {
    for (let body = 0; body < BODIES; body++) {
      let oneOn = 0, runs = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const r = new LabRun(data, scene, body, seed).finish();
        if (r.missed) continue;
        runs++;
        const on = r.wheelsOnTop().filter(Boolean).length;
        assert.ok(on < 2, `${scene.id}, body ${body}, seed ${seed}: both wheels stayed on top`);
        if (on) oneOn++;
      }
      // (one may catch in a wheel arch now and then; mostly they fall off)
      assert.ok(oneOn <= runs / 2, `${scene.id}, body ${body}: a wheel stayed on top in ${oneOn} of ${runs} runs`);
    }
  }
});

test('upside down, the wheels hit the body: they jolt off their arches quickly, then never sink into it', () => {
  for (let body = 0; body < BODIES; body++) {
    for (let seed = 0; seed <= 4; seed++) {
      const r = new LabRun(data, SCENES.find((s) => s.id === 'roof-drop'), body, seed);
      while (!r.wreck && !r.done) r.step();
      if (!r.wreck) continue;
      const W = r.wreck;
      let up = 0, sunk = 0;
      for (let i = 0; i < 280; i++) {
        W.step();
        for (const w of W.wheels) up = Math.max(up, W.P[w.p * 2 + 1] - W.T[w.p * 2 + 1]);
        // (once the overlap at the wreck has had time to clear)
        if (i > WRECK.release + 5) sunk = Math.max(sunk, ...W.overlaps().wb);
      }
      assert.ok(sunk < 4, `body ${body}, seed ${seed}: a wheel sank ${sunk.toFixed(1)} px into the body`);
      assert.ok(up < 3, `body ${body}, seed ${seed}: a wheel went up at ${up.toFixed(2)} px a step`);
    }
  }
});
