# Stage Editor (editor/)

The game's level editor: one page, `editor/index.html` (its HTML, CSS and script are all in that
file). The game's Stage Editor screen opens it in a new tab at `editor/`. Work on it here without
reading the rest of the game: this file says everything the editor shares with it.

Run it: `npm start` at the repo root, then open http://localhost:8765/editor/. There's no build
step. Check changes in a browser; the game's tests (`npm test`) don't cover this page.

## What it uses from the game (read-only; don't change these for the editor's sake)

- `../src/assets.js`: `loadAssets('../assets/')` gives the tile images (`a.tiles[id]`, 64x64
  canvases), the nine stages (`a.levels.levels`), the stunt tracks (`a.levels.stunts`) and the
  collision table (`a.levels.collision[id]`: line segments `x1, y1, x2, y2, type` per tile).
- `../src/game.js`: only the constants `TILE` (64 px), `STAGE_NAMES`, `METRES_PER_TILE` (2.5).
- `../src/autotile.js`: the Path tool (`buildKit`, `drawPath`), tested in `tests/autotile.test.mjs`.

## The stage format (the contract with the game: `src/stages.js`)

```
{ name, width, height, start: [x, y], tiles: [[id, ...], ...], finish?: x, path?: [...] }
```

- `tiles`: `height` rows of `width` tile ids. 0 is sky, 1 solid dirt; any id below
  `collision.length`. Ground pieces have collision lines; columns usually end in solid dirt.
- `start`: where the truck drops in, in px (a tile is 64 px). `finish`: the x (px) of the finish
  line, optional; the stage is complete when the truck gets past it. With none, the stage goes on
  until the player quits (like a stunt track).
- `path`: the Path tool's curve points. Only the editor reads it; the game ignores it.
- The game checks every stage it reads (`validStage` in `src/stages.js`); a stage it can't read is
  left out, never an error.

## Where stages go (localStorage, shared with the game: same origin)

- `funkytruck.editorLevel`: the stage being edited (saved as you go). The **Play** button opens
  the game at `../index.html?test=custom` (`&damage=0` for no damage), which plays this one.
- `funkytruck.stages`: the game's list of stages (Stage Editor > Load Stage). **Save to Game**
  puts the stage first in the list, replacing one of the same name, each with `saved` (ms); at
  most 40 are kept. Keep this in step with `addStage` in `src/stages.js`.
- Files: **Save file** / **Open file** use the same JSON (with `path`). The game's Load Stage
  screen can load these files too.
