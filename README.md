# Funky Truck (web)

A bouncy monster-truck game for the browser: drive across nine stages of Utah hills without
wrecking your truck. It works with a keyboard, a touchscreen or a gamepad, and runs as a static
site on GitHub Pages.

## Modes

| Mode | What it is |
| --- | --- |
| **Play** | The nine stages, with tricks, a ragdoll wreck, and no invisible ceiling. The camera follows the truck up and down anywhere, even above or below the stage. |
| **Classic** | The nine stages as the original game played: the original flip bonus, the ceiling, the original controls, and a wrecked truck stays in one piece. Only display fixes (live text, alignment) and the pause button are new. |
| **Endless** | A course generated as you drive that never ends. No damage: it's free play. **End Run** in the pause menu finishes the run and saves your best distance. |
| **Practice** | One stage of your choice, played like Play. Options on the stage screen switch **Damage** off and play by **Classic** rules. |

Outside Classic, the driving view fills the window, on a phone held either way up (the
on-screen controls sit over the bottom of it). Close in, it shows the same width of the
world (the original 576 units), so everyone sees the same distance ahead; a taller window shows
more sky and ground, a wider one less. The backdrop scales up evenly to cover it. Classic keeps
the original 576×448 view. The menus' backdrop fills the window, with the menu centred on it. In a window at least as
tall as it is wide (a phone held upright, say), every menu switches to a tall layout: one column,
with the title screen's options under the game modes, Practice's stages in a 3×3 grid, and
everything scaled up to fill the width, so the buttons are much bigger.

**Dynamic camera** (outside Classic; a switch on the title screen turns it off): the camera pulls
back when the truck keeps up a good speed or has been high in the air for a while, up to 1.8 times
as much of the world. High up it also aims a little below the truck (by up to a fifth of the view), so you can see where you'll land. It
reacts only to smoothed speed and height (height counts after half a second in the air), eases
in and out slowly, ignores small changes, and is limited in how quickly it can speed up or slow
down, so bumps and short hops don't move it. Classic keeps the original fixed camera. The
settings are `CAMERA` in `src/game.js`.

**Garage**: choose the truck's body, paint, tyres and wheels. Any body can wear any body's
colour; each body starts in its own and remembers the paint you give it. Only the look changes:
every body and tyre drives exactly the same.

Play, Classic and Endless each keep their own best (score, score, distance). A Practice run with
damage saves to Play's or Classic's best; a damage-free one saves none.

In damage-free runs outside Classic (Endless, and Practice with damage off), a **Flip** button
appears at the top of the screen when the truck has been stuck on its roof or side for two seconds.
It hops the truck up and turns it back onto its wheels.

**One-button controls** (an option on the title screen) use a single button: Space on a keyboard,
or holding anywhere on a touchscreen. On the ground it drives; in the air it tilts the truck back.
Classic always uses the original controls.

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
| One-button controls | Space | hold anywhere | A |
| Pause | P | ⏸ button | Start |
| Flip upright (when offered) | R | Flip button | Y |
| Play again (game over) | Space, Enter or Ctrl | Play Again button | A |
| Back to menu | Esc | Menu button | |
| Sound on / off | M | Sound switch (title screen or pause menu) | |
| Full screen | F | | |

**How to Play** is the small button under the controls hint on the title screen. The game's
version is in the title screen's bottom-right corner; on the live site it's followed by the
commit it was built from.

The pause screen names the run (mode and stage, or distance in Endless) and has switches for
sound and, outside Classic, the controls (Standard or One Button).

The best scores, the options and the truck chosen in the garage (with each body's paint) are saved in the browser
(`localStorage`).

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

Score: 10 points for every new tile of ground, plus tricks as usual. The HUD shows the
distance in metres.

## Sound

All sound is synthesised live with the Web Audio API, so the game ships no sound files. Sound is
off until you switch it on. There's a soft engine hum with a quiet hiss of tyres on the ground,
thumps for landings, and bells for tricks, which ring as each trick is done. Scraping the cab
is a run of hard hits, each at a slightly different pitch.

The page `sounds.html` (at `/sounds.html` on the site) plays every sound.

The game logic knows nothing about sound: `src/sound-events.js` watches the game after every step
and turns what happened (a landing, a trick, a finished stage) into cues, and `src/audio.js`
plays them.

## Tricks

| Trick | How | Points |
| --- | --- | --- |
| Backflip / Frontflip | Turn over in the air and land (Double, Triple… for more turns) | the degrees turned, as in the original |
| Big Air / Huge Air | 1 s / 2 s with no wheel on the ground | 3 per 1/70 s past half a second |
| Wheelie / Nose Wheelie | Drive along on the back / front wheel for ¾ s or more | 2 per 1/70 s |
| Clean | Land a jump on both wheels at once without scraping the cab | half the jump's points |

Tricks score in Play, Endless and Practice (not Classic). Tricks done close together make a chain. The chain pays out about 1½ s after its last trick, worth
its points times the number of tricks in it (up to ×5). While a chain is open, its running total and
multiplier show under the score. Scraping the cab is a **bail**: the chain pays out at once, without
the multiplier, and a grey *bail* note appears under the trick names. A chain still open at the finish line is paid out there. Each trick name stays on
screen long enough to read; one that comes too soon waits its turn. The trick tracker
(`src/tricks.js`) only watches the truck; the physics is unchanged.

## Publish on GitHub Pages

1. Make this folder the root of a GitHub repository and push it to the `main` branch.
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.

After that, every push to `main` runs the tests and, if they pass, publishes the site
(`.github/workflows/pages.yml`). Only the game files (and `sounds.html`) are published, not
`tests/` or `tools/`.

## Tests

    npm test             # game logic tests (node --test), also run on GitHub before publishing
    npm run test:phone   # phone layout and touch checks in headless Chrome

`test:phone` needs Google Chrome installed and the local server running on port 8790
(`PORT=8790 npm start`). It emulates a 390×844 phone, taps PLAY, holds the on-screen pedals,
checks the truck moves, and saves screenshots. Pass a folder as the first argument to choose
where they go: `node tests/phone-check.mjs /tmp/shots`.

For screenshots of a particular state, the page accepts test parameters, for example
`?test=play&stage=5&frames=600&touch=1` or `?test=garage&look=3,1,2,0` (body, tyre, wheel, paint) (add `&classic=1` or `&damage=0` for those Practice options), or `?test=endless&seed=3&frames=600` for Endless Mode. See `applyTestParams` in `src/main.js`. Nothing is
saved to storage while a test parameter is set.

## Code layout

| File | What it does |
| --- | --- |
| `src/game.js` | All game logic: truck physics, collisions, scoring, stages and the screen state machine. No DOM access, so tests run it under Node. |
| `src/render.js` | Draws everything on the canvas, and defines the clickable menu areas. |
| `src/endless.js` | Endless Mode's course generator. |
| `src/audio.js`, `src/sound-events.js` | Synthesised sound, and the watcher that turns game events into sound cues. |
| `sounds.html` | A page for hearing every sound. |
| `src/wreck.js` | The ragdoll wreck: a wrecked truck's loose pieces (outside Classic). |
| `src/tricks.js` | Spots tricks (flips, airtime, wheelies, clean landings) and scores them in chains. |
| `src/version.js` | The version shown on the title screen (keep it in step with `package.json`). |
| `src/main.js` | Startup, the fixed 70 steps/second loop with smooth interpolated drawing, and all input. |
| `src/assets.js` | Loads the images and level data, prepares the terrain tiles, and repaints each body in every body's colour (leaving the window glass alone). The game uses fonts already on the device and ships no font files. |
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
