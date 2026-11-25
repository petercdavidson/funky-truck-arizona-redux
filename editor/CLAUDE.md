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
- `../src/autotile.js`: the Path tool (`buildKit`, `drawPath`; `lookPath` for the look pass done later;
  `closed: true` for a loop, the Shape tool's), tested in `tests/autotile.test.mjs`.
  A path rebuilds its columns from its curve down, and clears the old ground above the curve only
  up to the first sky, so an overhang above a gap is left alone. A path that goes back on itself or
  up a wall is laid by `drawPathFree` (pieces turned any way, ground on the right-hand side of the
  way the path runs). `sidesOf` says which side of each tile is ground (the editor fills dirt in
  with it, `compose`); `lookAround` is the look pass around given cells (Smooth path edges).
- `../src/tile-forms.js`: tiles turned and flipped (walls, ceilings, overhangs) and the mirrors:
  ids `base + 256 * form`, `mirrorId` / `flipUpId` / `turnId` for one tile, `flipTiles` /
  `flipTilesUp` / `turnTiles` for an area, `formCollision`, `tileLabel` (e.g. `2→`, `24↓`). The
  editor only makes turned tiles (upside down is the mirror tile turned half round); only the
  kickers (41 to 55, no mirror tile) get flipped art. Tested in `tests/tile-forms.test.mjs`.
- `../src/assets.js`: `tileImage(a, id)` draws a turned tile (and keeps it in `a.tiles`).
- `../src/tile-art.js`: each tile's edge pixels (made by `tools/make-tile-art.mjs`), passed to
  `buildKit` so the Path tool picks tiles whose art joins up.

## How the page works

- Made for a desktop browser (mouse or trackpad and keyboard); it stacks up on a narrow screen.
  On a touch screen one finger acts as the mouse (touch events turned into mouse events on
  `#scroller`) and two fingers drag the view and pinch to zoom.
- The view is two canvases the size of the view (`#tiles`, `#over`) under a transparent scrolling
  div (`#scroller` with `#spacer` the size of the level at the zoom). Only the tiles in view are
  drawn, redrawn on scroll; drawing uses world px × `Z`, shifted by the scroll (`toView`). Mouse
  events go to `#scroller`.
- Zoom: pinch (Ctrl+wheel in Chrome/Firefox, `gesture*` events in Safari), Ctrl/⌘+scroll,
  `+`/`-`/`0`, zooming at the pointer. `#mini` along the bottom is the whole level.
- Tools (`tool`): `paint` (B), `select` (S), `path` (G), `shape` (Q), `start` (T), `finish` (F); each
  has a panel (`.tp`). Picking a tile in the tiles switches to Paint.
- The level is in layers (`compose` makes `L.tiles`, the stage, from them): `L.base` (a loaded
  stage's or file's tiles; paths draw over it), each path's tiles (`g.delta`, `[cell, tile, ...]`,
  cell = y * width + x, laid over the base and the paths before it: `below(i)`), `L.paint` (painted,
  pasted, moved; NONE none, SKY erased: over the paths), then dirt filled in by the surfaces in each
  column (between ground facing up and ground facing down, to the top or bottom; never over painted
  sky). Two surfaces in a column that disagree (ground under one but sky over the next, or the other
  way) are problems (`bad`), marked in red. `src` says where each cell's tile came from (shown in
  the status bar). A file or a save from before the layers opens with all its tiles as the base.
- Tiles: `sel` is the chosen tile id (any form). The palette shows the sheet in `palForm`
  (upright, upside down, turned either way); H / V / R change the chosen tile or the selection.
  `img(id)` and `lines(id)` give any tile's image and collision lines.
- Path points are in the order the path runs (not sorted): a click adds one on the curve where
  it's near it, else at the nearer end (`insertAt`). Brown ticks show the ground side;
  Swap ground side reverses the points. While a point is dragged the look pass waits for the drop.
- Paths: `L.paths = [{ id, pts, closed?, delta, chain }]` (`chain`: the cells of its ground
  pieces), `L.ap` the one being edited (-1 none; right-click away from the points or Esc finishes
  it). `layPath` lays a path's ground (a shorter search while dragging, `quick`); the look pass
  waits till things are still (`idleWork`, which also lays again paths over columns that changed:
  `stale`). Points have handles (`ix, iy, ox, oy`) unless `auto`; `broken` points (Alt-dragged
  handles) move their handles separately until Alt-clicked. `closed` paths (shapes, `shapePts`) run
  all the way round, their ground on the right-hand side (clockwise: ground inside). Painting,
  moving, clearing or dropping tiles over a path's ground pieces runs `cutPaths(cells)`, which cuts
  the curve where it runs through those cells (exactly, with de Casteljau) into separate paths,
  sharing out its tiles; covering only its dirt doesn't. Saved as `paths` ({ pts, closed, delta,
  chain }); older files' lists of points and single `path` still open.
- Select: `box` is the selected area. Moving, Alt-drag copying, nudging, pasting and Duplicate
  make a floating area, `flt = { tiles, x, y, paint }`: the painted layer is `paint` with
  `flt.tiles` stamped on (its sky shows through), so it can be moved again without wiping what it
  passed over; `dropFloat()` lets go (clicking outside, Enter, Esc, another tool, saving). Pasted and
  duplicated areas follow the pointer (`follow`) until a click puts them down; Esc takes them away.
  Clearing (`clearCells`) empties the base and paint there and paints sky over what's left.
- View settings (zoom, grid, collision, path, problems, numbers) are kept in `funkytruck.editorView`.

## The stage format (the contract with the game: `src/stages.js`)

```
{ name, width, height, start: [x, y], tiles: [[id, ...], ...], finish?: x, path?: [...] }
```

- `tiles`: `height` rows of `width` tile ids. 0 is sky, 1 solid dirt; any id below
  `collision.length`. Ground pieces have collision lines; columns usually end in solid dirt.
- `start`: where the truck drops in, in px (a tile is 64 px). `finish`: the x (px) of the finish
  line, optional; the stage is complete when the truck gets past it. With none, the stage goes on
  until the player quits (like a stunt track).
- `tiles` may hold turned tiles (`src/tile-forms.js`: `base + 256 * form`); the game reads and
  plays them (custom stages only).
- `paths`: the Path tool's curves (lists of points; older files have one `path`). Only the editor
  reads them; the game ignores them.
- The game checks every stage it reads (`validStage` in `src/stages.js`); a stage it can't read is
  left out, never an error.

## Where stages go (localStorage, shared with the game: same origin)

- `funkytruck.editorLevel`: the stage being edited (saved as you go). The **Play** button opens
  the game at `../index.html?test=custom` (`&damage=0` for no damage), which plays this one.
- `funkytruck.stages`: the game's list of stages (Stage Editor > Load Stage). **Save to Game**
  puts the stage first in the list, replacing one of the same name (after asking), each with `saved` (ms); at
  most 40 are kept. Keep this in step with `addStage` in `src/stages.js`.
- Files: **Save file** / **Open file** use the same JSON, plus `layers` ({ base, paint: [cell,
  tile, ...] }) and `paths`. The game's Load Stage
  screen can load these files too.
