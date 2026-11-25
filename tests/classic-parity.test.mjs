// Classic with tricks off plays exactly as Classic did before Standard and Classic were merged
// (v1.24.6): the same inputs give the same truck, step for step, and the same score.
//
// tests/fixtures/classic-runs.json holds runs recorded with v1.24.6's Classic, a few on each of
// the nine stages, chosen to cover wrecks (with flips the whole truck landed after it was
// wrecked), finishes (with flips after the line), the invisible ceiling (Stages 2, 4, 6 and 9) and
// the cab bottoming out. Each has its inputs (up/down/left/right as a bitmask, run-length) and the
// truck's points, the score and the damage every 250 steps and at the end. It can't be made again
// from the current code; it's the record of how the original plays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game } from '../src/game.js';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
const { runs } = JSON.parse(readFileSync(new URL('./fixtures/classic-runs.json', import.meta.url)));
const KEYS = ['up', 'down', 'left', 'right'];
const hashT = (T) => T.map((v) => v.toFixed(6)).join(',');

/** Replay a recorded run in Classic with tricks off (`retro`: in 2006 Mode). */
function replay(run, retro) {
  const g = new Game(data, { random: () => 0.5 });
  g.startCampaign({ tricks: false, retro });
  if (run.stage > 0) { g.level = run.stage; g.startStage(); }
  const inputs = run.inputs.flatMap(([mask, n]) => Array(n).fill(mask));
  const checks = [];
  let step = 0;
  for (; step < inputs.length && g.screen === 'playing' && g.level === run.stage; step++) {
    KEYS.forEach((k, i) => { g.keys[k] = !!(inputs[step] & (1 << i)); });
    g.step();
    if (step % 250 === 0) checks.push([step, hashT(g.truck.T), g.score, g.damage]);
  }
  return { g, step, checks };
}

for (const retro of [false, true]) {
  test(`Classic, tricks off${retro ? ', 2006 Mode' : ''}: the recorded runs play out exactly as before`, () => {
    assert.ok(runs.length >= 18, 'runs on every stage');
    for (const run of runs) {
      const name = `Stage ${run.stage + 1} (${run.style} ${run.seed})`;
      const { g, step, checks } = replay(run, retro);
      assert.equal(step, run.steps, `${name}: ran as long`);
      for (let i = 0; i < run.checks.length; i++) assert.deepEqual(checks[i], run.checks[i], `${name}: step ${run.checks[i][0]}`);
      assert.equal(hashT(g.truck.T), run.end.T, `${name}: the truck ends where it did`);
      assert.equal(g.score, run.end.score, `${name}: score`);
      assert.equal(g.damage, run.end.damage, `${name}: damage`);
      assert.equal(g.screen, run.end.screen, `${name}: screen`);
      assert.equal(g.lastScore, run.end.lastScore, `${name}: final score`);
      // In the new view, a truck wrecked by damage comes apart; its score is unchanged.
      if (run.end.damage === 1000) assert.equal(!!g.wreck, !retro, `${name}: ${retro ? 'no ragdoll in 2006 Mode' : 'the ragdoll wreck'}`);
    }
  });
}
