# Funky Truck (web)

A bouncy monster-truck game for the browser: drive across nine stages of Utah hills without
wrecking your truck. It works with a keyboard, a touchscreen or a gamepad, and runs as a static
site on GitHub Pages.

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

The best score and the truck chosen in the garage are saved in the browser (`localStorage`).

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
`?test=play&stage=5&frames=600&touch=1`. See `applyTestParams` in `src/main.js`. Nothing is
saved to storage while a test parameter is set.

## Code layout

| File | What it does |
| --- | --- |
| `src/game.js` | All game logic: truck physics, collisions, scoring, stages and the screen state machine. No DOM access, so tests run it under Node. |
| `src/render.js` | Draws everything on the canvas, and defines the clickable menu areas. |
| `src/main.js` | Startup, the fixed 70 steps/second loop with smooth interpolated drawing, and all input. |
| `src/assets.js` | Loads the level data and the vector art. The game uses fonts already on the device and ships no font files. |
| `src/vector.js` | Draws vector art (paths with flat or gradient fills) on the canvas. |
| `index.html`, `style.css` | Page layout, loading screen and the on-screen touch controls. |
| `assets/levels.json` | The 9 stages (tile grids and start points) and per-tile collision lines. |
| `assets/vector.json` | All the game's art as vector paths: truck parts, dirt, terrain tiles, sky and menu backdrop. Generated, don't edit by hand. |
| `assets/icon.svg` | The app icon as a vector (the PNG icons are kept for platforms that need them). |
| `art/raster/`, `art/sprites.json` | The original bitmap art and sprite offsets that the vector art was traced from. Not published. |
| `tools/vectorize.mjs` | Re-traces `art/raster/` into `assets/vector.json` and `assets/icon.svg` (needs Chrome and the local server, like `test:phone`). `tools/vectorize/compare.html` shows each original next to its vector version. |

The game runs on the original 576×448 coordinate grid, scaled to fit the screen. All the art is
vector, so it stays sharp at any screen size or zoom. Terrain tiles are rendered once per screen
size and then reused, so drawing stays cheap.

## Vector art

The original bitmaps live in `art/raster/`. `tools/vectorize.mjs` traces them into vector paths:
each image is split into a few colour regions, each region's outline is traced to sub-pixel
accuracy and smoothed into curves, and each region gets the linear or radial gradient that best
fits its pixels, so the soft shading survives. The sky, the sun and the menu backdrop are rebuilt
from gradients sampled from the originals. Menu screens and HUD labels are drawn with code and text.

    PORT=8790 npm start &
    node tools/vectorize.mjs     # rewrites assets/vector.json and assets/icon.svg

Open <http://localhost:8790/tools/vectorize/compare.html> to compare them with the originals.

## History

This started as a Flash game. It was ported to a native Mac app (Swift/SpriteKit, in
`../FunkyTruckMac`) and then to the web. The physics is the same algorithm as the original. The
JavaScript and Swift versions differ only by floating-point rounding: about 3×10⁻¹⁴ px on the
first frame. That grows slowly over a long run, as rounding differences always do in a physics
simulation like this.
