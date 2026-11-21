# Funky Truck (web)

A bouncy monster-truck game for the browser: drive across nine stages of Utah hills without
wrecking your truck. It works with a keyboard, a touchscreen or a gamepad, and runs as a static
site on GitHub Pages.

There's also **Endless Mode**: a course that is generated as you drive and never ends. It runs
until your truck is wrecked, and your best distance is saved.

It's plain JavaScript (ES modules) and a 2D canvas, with no build step and no npm dependencies.

## Run it locally

    npm start            # or: node tools/serve.mjs

Then open <http://localhost:8765/>. The game loads its data with `fetch`, so opening
`index.html` straight from disk won't work; it needs a web server.

## Controls

| Action | Keyboard | Touch | Gamepad |
| --- | --- | --- | --- |
| Forwards / reverse | ↑ / ↓ (or W / S) | right-hand pedals | A or RT / B or LT |
| Tilt back / forwards | ← / → (or A / D) | left-hand buttons | stick or d-pad |
| Pause | P | ⏸ button | Start |
| Play again (game over) | Space, Enter or Ctrl | Play Again button | A |
| Back to menu | Esc | Menu button | |
| Full screen | F | | |

The best score, the best Endless distance and the truck chosen in the garage are saved in the
browser (`localStorage`).

## Endless Mode

Endless courses are built from the original nine stages' own building blocks. Every column of
tiles in the stages is reduced to its shape, and the generator records every place one shape
follows another (with how far the ground steps up or down). It then strings columns together using
only those joins. Usually it matches the last two or three columns, so whole hills and ramps come
out as they were designed; now and then it matches only the last one, which is where the course
turns into something new. The ground is kept inside a fixed height band, and the joins are weighted
by the stage they came from, so a course starts like Stage One and drifts towards the later stages
the further you get. The course lives in a window of 128 columns that scrolls as you drive
(`src/endless.js`).

Score: 10 points for every new tile of ground, plus flip bonuses as usual. The HUD shows the
distance in metres.

## Publish on GitHub Pages

1. Make this folder the root of a GitHub repository and push it to the `main` branch.
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.

After that, every push to `main` runs the tests and, if they pass, publishes the site
(`.github/workflows/pages.yml`). Only the game files are published, not `tests/` or `tools/`.

## Tests

    npm test             # game logic tests (node --test), also run on GitHub before publishing
    npm run test:phone   # phone layout and touch checks in headless Chrome

`test:phone` needs Google Chrome installed and the local server running on port 8790
(`PORT=8790 npm start`). It emulates a 390×844 phone, taps PLAY, holds the on-screen pedals,
checks the truck moves, and saves screenshots. Pass a folder as the first argument to choose
where they go: `node tests/phone-check.mjs /tmp/shots`.

For screenshots of a particular state, the page accepts test parameters, for example
`?test=play&stage=5&frames=600&touch=1`, or `?test=endless&seed=3&frames=600` for Endless Mode. See `applyTestParams` in `src/main.js`. Nothing is
saved to storage while a test parameter is set.

## Code layout

| File | What it does |
| --- | --- |
| `src/game.js` | All game logic: truck physics, collisions, scoring, stages and the screen state machine. No DOM access, so tests run it under Node. |
| `src/render.js` | Draws everything on the canvas, and defines the clickable menu areas. |
| `src/endless.js` | Endless Mode's course generator. |
| `src/main.js` | Startup, the fixed 70 steps/second loop with smooth interpolated drawing, and all input. |
| `src/assets.js` | Loads the images and level data, and prepares the terrain tiles. The game uses fonts already on the device and ships no font files. |
| `index.html`, `style.css` | Page layout, loading screen and the on-screen touch controls. |
| `assets/levels.json` | The 9 stages (tile grids and start points) and per-tile collision lines. |
| `assets/sprites.json` | Each sprite frame's image and its offset from the sprite's origin. |

The game runs on the original 576×448 coordinate grid, scaled to fit the screen. All words on
screen are live text in fonts already on the device, so they stay sharp at any size. The menu
screens are drawn from the original backdrop, keycaps and boxes, with the text added on top.

## History

This started as a Flash game. It was ported to a native Mac app (Swift/SpriteKit, in
`../FunkyTruckMac`) and then to the web. The physics is the same algorithm as the original. The
JavaScript and Swift versions differ only by floating-point rounding: about 3×10⁻¹⁴ px on the
first frame. That grows slowly over a long run, as rounding differences always do in a physics
simulation like this.
