// The Stage Editor's stages (src/stages.js) and playing them (Game.startCustom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, TILE, STAGES_PER_PAGE } from '../src/game.js';
import { validStage, validStages, addStage, MAX_STAGES } from '../src/stages.js';
import { memoryStore } from './helpers.mjs';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
const N = data.collision.length;

/** A flat stage w tiles long, with ground at row 14 of 20, and a finish at column `finish` (or none). */
function flat(w = 60, finish = null, name = 'Flat') {
  const h = 20;
  const tiles = Array.from({ length: h }, (_, y) => Array(w).fill(y > 14 ? 1 : 0));
  for (let x = 0; x < w; x++) tiles[14][x] = 2;
  return { name, width: w, height: h, start: [3 * TILE, 11 * TILE], tiles, ...(finish ? { finish: finish * TILE } : {}) };
}

test('stages are checked when read: anything that is not one is left out', () => {
  const s = validStage(flat(40, 30), N);
  assert.equal(s.width, 40);
  assert.equal(s.finish, 30 * TILE);
  assert.equal(validStage(null, N), null);
  assert.equal(validStage({ tiles: [[0, 1], [1]] }, N), null, 'ragged rows');
  assert.equal(validStage({ tiles: [[0, N]] }, N), null, 'a tile id out of range');
  assert.equal(validStage({ tiles: [[0, 1.5]] }, N), null);
  const odd = validStage({ ...flat(40), finish: 99999, start: 'x', name: '' }, N);
  assert.equal(odd.finish, undefined, 'a finish past the end is dropped');
  assert.deepEqual(odd.start, [3 * TILE, 3 * TILE]);
  assert.equal(odd.name, 'My Stage');
  assert.ok(!('path' in validStage({ ...flat(40), path: [{ x: 1, y: 2 }] }, N)), 'the editor\'s path is not kept');
  assert.deepEqual(validStages('junk', N), []);
  assert.equal(validStages([flat(40), { tiles: 7 }, flat(50)], N).length, 2);
});

test('adding a stage puts it first, replaces one of the same name, and keeps at most MAX_STAGES', () => {
  let list = [];
  ({ list } = addStage(list, validStage(flat(40, null, 'A'), N), 1));
  ({ list } = addStage(list, validStage(flat(40, null, 'B'), N), 2));
  ({ list } = addStage(list, validStage(flat(50, null, 'A'), N), 3));
  assert.deepEqual(list.map((s) => [s.name, s.width]), [['A', 50], ['B', 40]]);
  for (let i = 0; i < MAX_STAGES + 5; i++) ({ list } = addStage(list, validStage(flat(40, null, `S${i}`), N), 10 + i));
  assert.equal(list.length, MAX_STAGES);
});

test('a custom stage with a finish line can be completed; its score is not a best', () => {
  const store = memoryStore();
  const g = new Game(data, { store });
  assert.ok(g.bringInStage(flat(60, 30, 'Short')));
  assert.equal(g.stagePick, 0);
  g.customDamage = true;
  g.startCustom();
  assert.equal(g.mode, 'custom');
  assert.equal(g.levelData.name, 'Short');
  assert.equal(g.rules.damage, true);
  assert.equal(!!g.rules.retro, false);
  assert.equal(g.rules.ceiling, undefined, 'no ceiling on a custom stage');
  assert.equal(g.isStunt, false);
  assert.equal(g.quitScreen, 'stageLoad');
  let at = null;
  for (let i = 0; i < 1500 && g.screen === 'playing'; i++) {
    g.keys.up = at === null;
    g.step();
    if (at === null && g.endTimer > 0) at = g.focus[0];
  }
  assert.ok(at !== null && at >= 30 * TILE && at < 33 * TILE, `the stage ended at its own finish line (${Math.round(at / TILE)})`);
  assert.equal(g.screen, 'gameOver');
  assert.equal(g.finished, true);
  assert.equal(store.get('bestPlay'), null);
  g.restart();
  assert.equal(g.mode, 'custom');
  assert.equal(g.screen, 'playing');
});

test('a custom stage with no finish goes on until you quit, like a stunt track', () => {
  const g = new Game(data, { store: memoryStore() });
  g.bringInStage(flat(60, null, 'Open'));
  g.customRetro = true;
  g.startCustom(0);
  assert.equal(g.isStunt, true);
  assert.equal(g.rules.retro, true);
  assert.equal(g.rules.flipBonus, true, '2006 Mode scores flips the original way');
  for (let i = 0; i < 1500; i++) { g.keys.up = true; g.step(); }
  assert.equal(g.screen, 'playing');
});

test('Load Stage: stages saved by the editor are read again; pages, picking and deleting', () => {
  const store = memoryStore();
  const g = new Game(data, { store });
  assert.deepEqual(g.stages, []);
  // the editor, in another tab, saves some
  store.set('stages', Array.from({ length: STAGES_PER_PAGE + 2 }, (_, i) => ({ ...flat(40, null, `S${i}`), saved: i })));
  g.openStageLoad();
  assert.equal(g.screen, 'stageLoad');
  assert.equal(g.stages.length, STAGES_PER_PAGE + 2);
  g.turnStagePage(1);
  assert.equal(g.stagePage, 1);
  g.turnStagePage(1);
  assert.equal(g.stagePage, 0, 'wraps round');
  g.pickStage(3);
  g.deleteStage(1);
  assert.equal(g.stagePick, 2, 'the pick follows its stage');
  assert.equal(store.get('stages').length, STAGES_PER_PAGE + 1);
  g.deleteStage(2);
  assert.equal(g.stagePick, -1);
  g.startCustom(); // nothing picked: nothing happens
  assert.equal(g.screen, 'stageLoad');
  assert.equal(g.bringInStage({ nope: 1 }), false);
});
