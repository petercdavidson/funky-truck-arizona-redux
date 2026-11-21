// Checks the generated vector art (assets/vector.json) has everything the renderer draws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const art = JSON.parse(readFileSync(new URL('../assets/vector.json', import.meta.url)));
const levels = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));

const isColour = (c) => /^#[0-9a-f]{6}$/.test(c) || /^rgba\(\d+,\d+,\d+,[\d.]+\)$/.test(c);
function checkDrawing(d, where) {
  assert.ok(Array.isArray(d.shapes), `${where} has shapes`);
  for (const s of d.shapes) {
    assert.match(s.d, /^M[-\d.]/, `${where}: path data starts with a move`);
    assert.ok(!/NaN|undefined/.test(s.d), `${where}: path data is all numbers`);
    if (typeof s.fill === 'string') assert.ok(isColour(s.fill), `${where}: fill ${s.fill}`);
    else {
      assert.ok(['linear', 'radial'].includes(s.fill.type), `${where}: gradient type`);
      for (const [o, c] of s.fill.stops) { assert.ok(o >= 0 && o <= 1, `${where}: stop offset ${o}`); assert.ok(isColour(c), `${where}: stop colour ${c}`); }
    }
  }
}

test('every sprite frame the game uses has a vector drawing', () => {
  const counts = { body: 6, tyre: 6, hub: 6, bar: 2, dirt: 8 };
  for (const [key, n] of Object.entries(counts)) {
    assert.equal(art.sprites[key].length, n, `${key} frames`);
    art.sprites[key].forEach((f, i) => { assert.ok(f.shapes.length > 0, `${key} ${i} is not empty`); checkDrawing(f, `${key} ${i}`); });
  }
});

test('every tile used by a level has a drawing, and the backdrops exist', () => {
  for (const l of levels.levels) for (const row of l.tiles) for (const id of row) {
    assert.ok(art.tiles[id], `tile ${id}`);
    if (id !== 0) assert.ok(art.tiles[id].shapes.length > 0, `tile ${id} is drawn`);
  }
  art.tiles.forEach((t, i) => checkDrawing(t, `tile ${i}`));
  checkDrawing(art.bg, 'bg');
  checkDrawing(art.screen, 'screen');
});
