# Funky Truck (web)

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
- `src/wreck.js` (no DOM): the ragdoll wreck, a wrecked truck's loose pieces.
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
- `tools/editor.html`: a local level editor for the user to try tile combinations. Its level is
  kept in localStorage (`funkytruck.editorLevel`), and `index.html?test=custom` plays it as a
  Practice track with no finish. Levels the user sends from it are JSON: { name, width, height,
  start, tiles }, plus `path` (the Path tool's curve points) when there is one; the game ignores it.
- `src/autotile.js` (no DOM): the editor's Path tool. Every tile with collision is a piece of
  floor running from one edge point to another; a sketched line becomes the chain of pieces that
  follows it best (a shortest-path search preferring joins the stages use), with the fill below
  chosen as the stages do. Tested in `tests/autotile.test.mjs`.
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
- Screens are `game.screen` strings: `title`, `modes` (the mode picker over the title), `stats`, `options`, `help`, `garage`, `practiceSelect`, `trialSelect`, `playing`,
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
