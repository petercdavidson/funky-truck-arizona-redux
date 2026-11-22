# Funky Truck Arizona Redux (web)

Browser monster-truck game hosted on GitHub Pages: https://petercdavidson.github.io/funky-truck-utah/
Repo: petercdavidson/funky-truck-utah (public). Plain ES modules + 2D canvas. No build step, no
npm dependencies. Keep it that way unless there's a strong reason to change.

## Commands

- `npm start`: local server at http://localhost:8765 (honours `PORT`). Sends no-cache headers.
- `npm test`: game logic tests (`node --test`). CI runs these before every deploy.
- `PORT=8790 npm start` then `npm run test:phone`: headless-Chrome phone emulation (touch
  controls, portrait/landscape layout, screenshots). Run it after any change to layout or input.

## Architecture

- `src/game.js`: all game logic and state (`Game`, `Truck`, `CollisionWorld`). Must stay free of
  DOM/browser APIs so it runs under Node. Storage and randomness are injected (`opts.store`,
  `opts.random`).
- `src/endless.js`: Endless Mode's course generator (learns tile joins from `levels.json`). Also
  free of DOM APIs. The game scrolls the world left as the course moves (`Game.scrollWorld`).
- `src/tricks.js`: trick detection and chain scoring (no DOM). It reads the truck and never
  changes it; flips still come from `Truck.trackFlip`.
- `src/render.js`: canvas drawing, plus `BUTTONS`, the clickable areas for each screen.
- `src/main.js`: startup, the fixed-step loop, input (keyboard, pointer, on-screen controls,
  gamepad), and `applyTestParams` (`?test=...` URL hooks used for screenshots).
- `src/assets.js`: image and level loading, tile preparation, font stacks.
- `index.html` / `style.css`: page shell, loading screen, touch controls.
- `src/sound-events.js` (no DOM) turns game state into sound cues; `src/audio.js` synthesises them
  with Web Audio (sound is on/off, off by default). `sounds.html` plays every sound. No
  sound files.
- `src/wreck.js` (no DOM): the ragdoll wreck, a wrecked truck's loose pieces. Its body collides as
  that body's own outline, `src/wreck-shapes.js`, made from the sprites by `tools/make-wreck-shapes.mjs`
  (rerun it if the body art changes).
- `src/battle.js` (no DOM): Sandbox's cars: rival cars (`Enemy`s with `s = 1`, kind `racer`, in
  `battle.racers`) and enemy cars (`s = -1`, in `battle.enemies`), truck-on-truck collisions,
  missiles, explosions, your boost and jump. Enemies are ordinary `Truck`s simulated in a mirrored
  world (`MirrorWorld`, x -> -x) so they face left; mirror their points (x -> -x) wherever they meet
  the real world. `src/render-battle.js` draws them. Battle Mode and Rally Mode, which this was
  written for, are out of the game; they're kept, playable, on the `feat/battle-rally` branch.
- `src/sandbox.js` (no DOM): Sandbox Mode's settings (`funkytruck.sandbox`, choice indices; track 0
  is Endless, then the stages, then the stunt tracks), `applySandbox` (sets the truck's `power`,
  `gravity`, `tiltPower` and `springK`: Truck properties whose defaults are the original's;
  `startStage` puts them back for every other mode), and its cars (`setTraffic`, and `stepTraffic`,
  which loops them on Endless and the stunt tracks). A Sandbox run counts into throwaway stats
  (`game.realStats` is the saved one), so nothing in it reaches High Scores. Sandbox is opened from
  the Options screen.
- `src/trial.js` (no DOM): Time Trial's time formats, saved bests and ghosts. `Game.updateTrial` runs
  the clock (from first landing to the finish line) and records the ghost; ghosts are poses, not
  inputs, so they survive physics changes.
- `src/version.js`: the version on the title screen (the Pages deploy stamps in the commit).
- `assets/stunts.json`: Practice's stunt tracks (after the nine stages), built by
  `node tools/make-stunts.mjs` from the stages' own column shapes and joins, stored a column at a
  time (`unpackLevel` in `game.js`). Edit the designs in that script and rerun it; don't hand-edit
  the JSON. They have no finish line; one with `loop` repeats for ever (`Game.updateLoop` shifts the
  world back a repeat). The physics has no air drag, so a long or steep downhill speeds up without
  limit: check designs with the simulated driver (`tools/tune-stunts.mjs`, the stunt tests).
- `editor/` (`editor/index.html`): the Stage Editor, its own page, opened in a new tab from the game's
  Stage Editor screen. It has its own `editor/CLAUDE.md`, so work on the editor can start there
  without reading the game. It shares only the stage format and storage keys (`src/stages.js`:
  `funkytruck.editorLevel` for its Play button, `index.html?test=custom`; `funkytruck.stages` for
  Save to Game) and reads tiles and levels through `src/assets.js`. Levels are JSON:
  { name, width, height, start, tiles, finish? }, plus `path` (the Path tool's curve points) when
  there is one; the game ignores it. The Pages deploy copies `editor/` (`.github/workflows/pages.yml`).
- `src/tile-forms.js` (no DOM): tiles turned and flipped, for the editor's walls, ceilings and
  overhangs: id `base + 256 * form` (form 0 is the sheet tile, so the stages' ids are unchanged),
  their collision lines (`formCollision`, `formTable`) and the mirror pairs. No new art: a turned
  tile is a sheet tile turned (`tileImage` in `assets.js`). Only custom stages use them:
  `Game.tileTable` is the collision table with their entries in custom mode and the table as is
  everywhere else. The physics is unchanged: `CollisionWorld` was already one-sided lines, so a
  ceiling or a wall is just lines facing down or sideways.
- `src/stages.js` (no DOM): custom stages: `validStage`, the saved list (`game.stages`), and
  `Game.startCustom` (`mode: 'custom'`) plays one; `finish` (px) is its finish line, and with none
  it's played like a stunt track (`isStunt`).
- `src/autotile.js` (no DOM): the editor's Path tool. Every tile with collision is a piece of
  floor running from one edge point to another; a sketched line becomes the chain of pieces that
  follows it best (a shortest-path search preferring joins the stages use), with the fill below
  chosen as the stages do, then a look pass that swaps fill tiles (and pieces of the same shape) so
  the art joins up at tile edges, scored from `src/tile-art.js` (each tile's edge pixels, made by
  `tools/make-tile-art.mjs`; rerun it if the tile art changes). Also `MIRROR_PAIRS` / `mirrorOf` /
  `flipTiles`: which tiles are each other's left-right mirror (41 to 55, the kickers, have none).
  Tested in `tests/autotile.test.mjs`.
- `tools/map.html`: draws whole tracks as maps (serve the repo, open `/tools/map.html?stages=9,10,11`).
- `tests/bot.mjs`: a simulated driver (backs up for run-ups when it stalls) for checking that
  generated courses can be driven. Endless never climbs more than `MAX_RISE` tiles within
  `RISE_SPAN` columns (`src/endless.js`); keep it that way so there are no unclimbable walls.

## Modes and rules

- The mode called Standard in the game is `mode: 'campaign'` with `RULES.play` in the code.
- `src/stats.js` (no DOM): the High Scores screen's records and totals, counted through
  `TrickTracker`'s `onTrick` / `onBank` hooks and saved as `funkytruck.stats`.
- Esc easter egg (`Game.selfWreck`): outside Classic rules and Time Trial, Esc wrecks the truck
  with no game over; Esc again leaves. Not in the README on purpose.
- "Classic" means the original gameplay, before the added features. A run's rules are
  `game.rules = { classic, damage }`. Play, Endless, Time Trial and Practice share the new features; Classic
  has none of them (no tricks, ragdoll, one-button controls or flip-upright, and it keeps the
  ceiling and the original flip bonus). Display fixes and quality-of-life touches are fine in Classic.
- New features go in every mode except Classic unless the user says otherwise. General options go
  on the Options screen (`OPTIONS` in `render.js`); an option for one mode goes in the small on/off
  switches at the side of that mode's screen (`option()`).
- Quitting a Practice or Time Trial run goes back to its stage list (`Game.quitScreen`).

## Rules that keep the game feeling right

- The simulation runs at a **fixed 70 steps per second** (the original Flash frame rate). Every
  physics constant assumes that. Never scale physics by frame time. Rendering interpolates between
  steps.
- Coordinates are the original **576×448 stage**, y pointing down, rotation clockwise in degrees
  for game state. `Renderer` scales the stage to fit the screen.
- The physics is a faithful port of the original game. Treat changes to `Truck` / `CollisionWorld`
  as gameplay changes: say so explicitly and add or adjust tests.
- Screens are `game.screen` strings: `title`, `modes` (the mode picker over the title), `stats`, `pauseOptions`, `options`, `help`, `garage`, `practiceSelect`, `trialSelect`, `sandbox`, `stageEditor`, `stageLoad`, `sandboxTweaks`, `playing`,
  `paused`, `gameOver`. A new screen needs an entry in `BUTTONS`, a case in `Renderer.draw`, and
  `body[data-screen]` CSS if it affects touch controls.
- Saved data goes through `game.store` (key prefix `funkytruck.` in localStorage). Validate
  anything read back. Never let storage errors break the game.
- Ship no third-party font files or other assets without a licence that allows redistribution.
  The game uses fonts already on the device.

## Working on features

- Use a branch and pull request per feature. CI runs the tests on PRs, and merging to `main`
  deploys.
- When sharing a preview of `dev`, give the commit-pinned githack link
  (`https://raw.githack.com/petercdavidson/funky-truck-utah/<short-sha>/index.html`): the branch
  link is cached for a while after a push.
- Bump `VERSION` in `src/version.js` and `version` in `package.json` (a test checks they match)
  with every push, so the version on the title screen tells you which build you have.
- Before finishing: run `npm test`, check the change in a browser (desktop and phone sizes), and
  update README.md if controls or features change.
