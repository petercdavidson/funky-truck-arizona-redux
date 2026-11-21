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
- `src/render.js`: canvas drawing, plus `BUTTONS`, the clickable areas for each screen.
- `src/main.js`: startup, the fixed-step loop, input (keyboard, pointer, on-screen controls,
  gamepad), and `applyTestParams` (`?test=...` URL hooks used for screenshots).
- `src/assets.js`: image and level loading, tile preparation, font stacks.
- `index.html` / `style.css`: page shell, loading screen, touch controls.
- `src/sound-events.js` (no DOM) turns game state into sound cues; `src/audio.js` synthesises them
  with Web Audio in the chosen set. `sounds.html` previews the sets. No sound files.

## Rules that keep the game feeling right

- The simulation runs at a **fixed 70 steps per second** (the original Flash frame rate). Every
  physics constant assumes that. Never scale physics by frame time. Rendering interpolates between
  steps.
- Coordinates are the original **576×448 stage**, y pointing down, rotation clockwise in degrees
  for game state. `Renderer` scales the stage to fit the screen.
- The physics is a faithful port of the original game. Treat changes to `Truck` / `CollisionWorld`
  as gameplay changes: say so explicitly and add or adjust tests.
- Screens are `game.screen` strings: `title`, `help`, `garage`, `practiceSelect`, `playing`,
  `paused`, `gameOver`. A new screen needs an entry in `BUTTONS`, a case in `Renderer.draw`, and
  `body[data-screen]` CSS if it affects touch controls.
- Saved data goes through `game.store` (key prefix `funkytruck.` in localStorage). Validate
  anything read back. Never let storage errors break the game.
- Ship no third-party font files or other assets without a licence that allows redistribution.
  The game uses fonts already on the device.

## Working on features

- Use a branch and pull request per feature. CI runs the tests on PRs, and merging to `main`
  deploys.
- Before finishing: run `npm test`, check the change in a browser (desktop and phone sizes), and
  update README.md if controls or features change.
