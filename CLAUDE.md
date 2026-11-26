# Funky Truck Arizona Redux (web)

Browser monster-truck game hosted on GitHub Pages: https://petercdavidson.github.io/funky-truck-arizona-redux/
Repo: petercdavidson/funky-truck-arizona-redux (public). Plain ES modules + 2D canvas. No build step, no
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
  free of DOM APIs. The game scrolls the world left as the course moves (`Game.scrollWorld`), or
  right when you drive back past the start: the course goes on for ever both ways (`back` joins,
  the left `Walker`), and columns scrolled off either side are kept.
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
  (rerun it if the body art changes). The loose wheels hit the same outline and roll along it.
- Wreck Lab (`tools/wreck-lab.html`, served from the repo): real crashes, two at a time, each with
  all six bodies: the driving before (up to 5 s, as set) replayed, then wrecked live by
  `src/wreck.js` for as long as set, then the next two. Hitboxes and slow motion. The crashes (`tools/wreck-crashes.json`) are found by bots driving the nine stages in
  Practice with damage on: `node tools/make-wreck-crashes.mjs [per stage]` (rerun it if the truck's
  physics or the stages change; wreck changes don't need it). `tools/wreck-lab-sim.mjs` (no DOM)
  runs them and tallies the outcomes headless: `node tools/wreck-lab-sim.mjs`. Work on wreck physics
  there rather than in the game. `tests/wreck.test.mjs` runs the crashes.
- `src/battle.js` (no DOM): Sandbox's cars: rival cars (`Enemy`s with `s = 1`, kind `racer`, in
  `battle.racers`) and enemy cars (`s = -1`, in `battle.enemies`), truck-on-truck collisions,
  missiles, explosions, your boost and jump. Enemies are ordinary `Truck`s simulated in a mirrored
  world (`MirrorWorld`, x -> -x) so they face left; mirror their points (x -> -x) wherever they meet
  the real world. `src/render-battle.js` draws them. Battle Mode and Rally Mode, which this was
  written for, are out of the game; they're kept, playable, on the `feat/battle-rally` branch.
- `src/critters.js` (no DOM): Sandbox's birds and tumbleweeds (`game.critters`, own physics and own
  random numbers; they read the truck and never change it) and its clouds (`cloudsNear`: a hash of
  the sky, fixed in cloud space, the world less `game.shiftTotal`). Counts are Sandbox settings.
- `src/sandbox.js` (no DOM): Sandbox Mode's settings (`funkytruck.sandbox`, choice indices; track 0
  is Endless, then the stages, then the stunt tracks), `applySandbox` (sets the truck's `power`,
  `gravity`, `tiltPower` and `springK`: Truck properties whose defaults are the original's;
  `startStage` puts them back for every other mode), and its cars (`setTraffic`, and `stepTraffic`,
  which loops them on Endless and the stunt tracks). A Sandbox run counts into throwaway stats
  (`game.realStats` is the saved one), so nothing in it reaches High Scores. Sandbox is in the mode
  picker (`MODES`).
- `src/trial.js` (no DOM): Time Trial's time formats, saved bests and ghosts. `Game.updateTrial` runs
  the clock (from first landing to the finish line) and records the ghost; ghosts are poses, not
  inputs, so they survive physics changes.
- `src/pad.js` (no DOM): the gamepad's buttons for each driving action (`game.padMap`, saved as
  `funkytruck.padMap`), set on the Controller screen (`padMap`, from Options); `pollGamepads` in
  main.js reads them. Menus always use the stick / d-pad, A and B.
- `src/version.js`: the version on the title screen (the Pages deploy stamps in the commit).
- `assets/stunts.json`: the stunt tracks (after the nine stages; in Time Trial as tracks TRIAL_STUNTS on), built by
  `node tools/make-stunts.mjs` from the stages' own column shapes and joins, stored a column at a
  time (`unpackLevel` in `game.js`). Edit the designs in that script and rerun it; don't hand-edit
  the JSON. They have no finish line; one with `loop` repeats for ever (`Game.updateLoop` shifts the
  world back a repeat). The physics has no air drag, so a long or steep downhill speeds up without
  limit: check designs with the simulated driver (`tools/tune-stunts.mjs`, the stunt tests).
- `editor/` (`editor/index.html`): the Stage Editor, its own page, opened in a new tab from the game's
  Stage Editor screen (its path search runs in `editor/path-worker.js`, a module worker). It has its own `editor/CLAUDE.md`, so work on the editor can start there
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
  Paths may also run any way round (`drawPathFree`: up walls, back over themselves for overhangs,
  along ceilings) with turned pieces; the ground is on the right-hand side of the way a path runs.
  `fillGround` / `paintFill` fill ground in between ground facing up and down (`sidesOf`: which
  edges of a tile are ground). `closed: true` lays a loop (the editor's Shape tool, `drawLoop`); `fillRuns` fills ground straight out from each surface's ground side (up/down from tiles whose collision spans left to right, sideways from ones spanning top to bottom: `spansOf`; through dirt and art), then any stretch of sky that ground closes in on every side;
  `look: false` leaves the look pass for later (`lookPath`). The look pass (`lookAround`, `solveLook`) works from the tile sheet, not the stages: tiles side by side in a set on the sheet join perfectly (`sheetJoin`, costed 0 by `join`; the sets are marked up by hand in `tools/sheet-sets.html` and kept in `src/tile-sets.js`), each piece's partner is the art joined to it on the sheet on its ground side (`partners`), placed the same way round; inside corners (ground facing a cell from two sides) take general-purpose art (`generic`: no piece's partner) or the art that best meets the pieces there, and a partner only when it fits both pieces or, at a cost, joins the sheet on another side too. The sheet is 10 tiles wide. Rules by hand come first (`artChoices`): `tools/match-review.html` marks the art for a situation (what's beside a cell, `situation`, the same turned any way) good, bad or better, kept in the browser (`funkytruck.tileRules`, which the editor uses at once) and saved into `src/tile-rules.js`. Tested in `tests/autotile.test.mjs`.
- `tools/map.html`: draws whole tracks as maps (serve the repo, open `/tools/map.html?stages=9,10,11`).
- `tests/bot.mjs`: a simulated driver (backs up for run-ups when it stalls) for checking that
  generated courses can be driven. Endless never climbs more than `MAX_RISE` tiles within
  `RISE_SPAN` columns (`src/endless.js`); keep it that way so there are no unclimbable walls.

## Modes and rules

- Classic is `mode: 'campaign'` (`startCampaign({ tricks, retro })`, rules from `classicRules`):
  the nine stages, with its own screen (`classicSelect`) holding its Tricks and 2006 Mode switches
  (`classicTricks`, `classicRetro`). Standard was merged into it in 1.24.7: its best became Classic
  with tricks' (`bestPlay`); Classic's is `bestScore`.
- A run's rules are `game.rules` (see `RULES` in `game.js`): `damage`, `ceiling` (the original's
  invisible ceiling: the nine stages in Classic and Time Trial; the camera stops at it),
  `scrapeAll` (the original scrape: the chassis bottoming out is damage; never a trick bail),
  `flipBonus` (the original scoring, and side walls count as ground: Classic with tricks off, and
  2006 Mode), `tricks` (false: none watched for), `retro` (2006 Mode: 576x448 drawn at 30 fps and
  scaled up with hard pixels, `Renderer.drawRetro`; the original camera; no speedometer, altimeter,
  dynamic or crash cam, ragdoll or Esc wreck).
- **Classic with tricks off must play exactly as the original**: identical inputs, identical truck
  and score. `tests/classic-parity.test.mjs` replays runs recorded before the merge
  (`tests/fixtures/classic-runs.json`); it must keep passing. Classic's ragdoll wreck keeps the
  original's 210 steps before game over, and the whole truck drives on unseen behind it
  (`hiddenTruck`) so its flips still score. Anything new in Classic must leave that test alone
  (display, camera and options are fine; physics and scoring aren't).
- `src/stats.js` (no DOM): the High Scores screen's records and totals, counted through
  `TrickTracker`'s `onTrick` / `onBank` hooks and saved as `funkytruck.stats`.
- Esc easter egg (`Game.selfWreck`): outside 2006 Mode, Esc wrecks the truck with no game over;
  Esc again leaves. In Classic and Time Trial a truck wrecked that way can't finish the stage
  (`selfWreckFinishes`). Not in the README on purpose.
- New features go in every mode (in Classic as display and options only, see above, and not in
  2006 Mode) unless the user says otherwise. General options go
  on the Options screen (`OPTIONS` in `render.js`); an option for one mode goes in the small on/off
  switches at the side of that mode's screen (`option()`).
- Practice was merged into Time Trial (`mode: 'trial'`, `startTrial`): its screen (`trialSelect`) has the
  stages, All Nine, the stunt tracks and the Tricks / Damage / 2006 Mode / Ghost switches. Its
  stages have Classic's ceiling and scrape (`trackRules`). A time only counts with damage on
  (`timeCounts`); stunt tracks keep a best trick score
  (`stuntBests`). `mode: 'practice'` (`startPractice`) is still there, with no menu of its own: the
  tests and `?test=play` use it for a plain one-stage run.
- Quitting a Time Trial run goes back to its stage list, and Classic to its screen (`Game.quitScreen`).

## Rules that keep the game feeling right

- The simulation runs at a **fixed 70 steps per second** (the original Flash frame rate). Every
  physics constant assumes that. Never scale physics by frame time. Rendering interpolates between
  steps (except in 2006 Mode, which draws the latest step 30 times a second).
- Coordinates are the original **576×448 stage**, y pointing down, rotation clockwise in degrees
  for game state. `Renderer` scales the stage to fit the screen.
- The physics is a faithful port of the original game. Treat changes to `Truck` / `CollisionWorld`
  as gameplay changes: say so explicitly and add or adjust tests.
- Screens are `game.screen` strings: `title`, `modes` (the mode picker over the title), `classicSelect`, `stats`, `pauseOptions`, `options`, `padMap`, `help`, `garage`, `practiceSelect`, `trialSelect`, `sandbox`, `stageEditor`, `stageLoad`, `sandboxTweaks`, `playing`,
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
  (`https://raw.githack.com/petercdavidson/funky-truck-arizona-redux/<short-sha>/index.html`): the branch
  link is cached for a while after a push.
- Bump `VERSION` in `src/version.js` and `version` in `package.json` (a test checks they match)
  with every push, so the version on the title screen tells you which build you have.
- Before finishing: run `npm test`, check the change in a browser (desktop and phone sizes), and
  update README.md if controls or features change.
