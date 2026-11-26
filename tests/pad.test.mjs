// The gamepad's buttons (src/pad.js) and the Controller screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPadMap, validPadMap, assignPad, PAD_ACTIONS } from '../src/pad.js';

test('a saved button map is checked: anything odd goes back to the default', () => {
  assert.deepEqual(validPadMap(null), defaultPadMap());
  assert.deepEqual(validPadMap({ gas: 'A', fire: [2.5], jump: [8] }), { ...defaultPadMap(), jump: [8] });
});

test('a button does one thing: setting it takes it off whatever had it', () => {
  let m = assignPad(defaultPadMap(), 'fire', 3);       // Y fires now
  assert.deepEqual(m.fire, [3]);
  assert.ok(!m.top.includes(3));
  for (const [a] of PAD_ACTIONS) for (const [b] of PAD_ACTIONS) if (a !== b) for (const i of m[a]) assert.ok(!m[b].includes(i), `${i} on ${a} and ${b}`);
  m = assignPad(m, 'gas', 1);                           // B drives: reverse keeps LT
  assert.deepEqual(m.gas, [1]);
  assert.deepEqual(m.brake, [6]);
});
