// Wreck tests using the Wreck Lab's scenes (tools/wreck-lab-sim.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LabRun, SCENES, BODIES, ROOF } from '../tools/wreck-lab-sim.mjs';

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

test('upside down, a wheel still in its arch drops off past the body rather than rising out of it', () => {
  for (let body = 0; body < BODIES; body++) {
    const r = new LabRun(data, SCENES.find((s) => s.id === 'roof-drop'), body, 0);
    while (!r.wreck) r.step();
    const W = r.wreck, rise = [0, 0], landed = [false, false];
    for (let i = 0; i < 140; i++) {
      W.step();
      W.wheels.forEach((w, n) => {
        const x = W.T[w.p * 2], y = W.T[w.p * 2 + 1];
        // (until it first reaches the ground: then it may bounce)
        if (W.wheelWorld.collide(x, y - 1, x, y + 2)) landed[n] = true;
        if (W.ghost.wb[n] && !landed[n]) rise[n] = Math.max(rise[n], W.P[w.p * 2 + 1] - y);
      });
    }
    assert.ok(Math.max(...rise) < 0.3, `body ${body}: a wheel rose out of the body at ${Math.max(...rise).toFixed(2)} px a step`);
  }
});
