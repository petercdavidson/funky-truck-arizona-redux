# Funky Truck (web)

A bouncy monster-truck game for the browser: drive across nine stages of Utah hills without
wrecking your truck. It works with a keyboard, a touchscreen or a gamepad, and runs as a static
site on GitHub Pages.

## Menus

The title screen has **Play**, **Change Truck**, **High Scores**, **Options** and **How to Play**.
**Play** dims the title and opens a box of the modes (below); tap one, or **Back** or anywhere
outside the box to close it (on a keyboard: ↑ / ↓ and Space or Enter; on a gamepad: d-pad and A).
**High Scores** shows each mode's best and your records and totals across all your runs: longest
airtime, top speed, most flips in one jump, longest wheelie, best and longest trick chain, distance
and time driven, runs, stages finished, flips, each trick, bails and wrecks (`src/stats.js`).
Its **Reset** button asks *Are you sure?*, and its Yes counts down five seconds before it can be
pressed; it clears every best score, best time, ghost and stat.

Tap or click the truck on the title screen to knock it into the air: where you hit it decides
which way it turns over (the back wheel flips it forwards). Tap it as often as you like; up high it
goes in front of the words. There's no height limit: knock it hard enough and it flies out of
sight and falls back down.

## Modes

| Mode | What it is |
| --- | --- |
| **Standard** | The nine stages, with tricks, a ragdoll wreck, and no invisible ceiling. The camera follows the truck up and down anywhere, even above or below the stage. |
| **Classic** | The nine stages as the original game played: the original flip bonus, the ceiling, the original controls, and a wrecked truck stays in one piece. Only display fixes (live text, alignment) and the pause button are new. |
| **Endless** | A course generated as you drive that never ends. No damage: it's free play. **End Run** in the pause menu finishes the run and saves your best distance. |
| **Time Trial** | Any of the nine stages, or **All Nine** in a row, against the clock, by Standard's rules (a wreck doesn't finish). The clock runs from when the truck first lands on each stage to its finish line. Your best run on each track comes back as a see-through **ghost** to race, and the clock's readout shows how far ahead (green) or behind (pink) of it you are at the same point on the track. The stage list shows each best time; a **Ghost** switch there turns the ghost off. Finishing offers **Retry**, **Next** and **Stages**; quitting (from the pause menu or the finish box) goes back to the stage list. |
| **Practice** | One stage of your choice, played like Standard, or one of three **stunt tracks**, where tricks always score and there's no finish line: **Mega Ramp** (a 450 m accelerator at 45°, a launch ramp good for about 470 km/h and 13 s in the air, then a long run-out ending in a quarter pipe), **Kicker Run** (a bumpy downhill of small kickers that goes on for ever) and **Halfpipe** (a bowl: walls nearly vertical at the lips, easing to a flat floor, with a ledge along each top). Options on the stage screen switch **Damage** off and play by **Classic** rules. The pause menu can **Restart** the stage. Finishing offers **Again**, **Next** and **Stages**; quitting goes back to the stage list. |

Outside Classic, the driving view fills the window, on a phone held either way up (the
on-screen controls sit over the bottom of it). Close in, it never shows less of the world than
Classic's 576×448: a taller window shows more sky and ground, and a wider one more to each side
(the truck keeps Classic's place in the middle 576). The backdrop scales up evenly to cover it.
Classic keeps the original 576×448 view. The menus' backdrop fills the window, with the menu centred on it. In a window at least as
tall as it is wide (a phone held upright, say), every menu switches to a tall layout: one column,
with the title screen's buttons in one column, Practice's stages in a 3×3 grid, and
everything scaled up to fill the width, so the buttons are much bigger.

**Dynamic camera** (outside Classic; a switch on the Options screen turns it off): it follows the
truck exactly as the original camera does, keeping it in the same place on screen, but pulls the
frame back when the truck keeps up a good speed (mostly: full pull-back from speed comes at about
120 km/h) or has been high in the air for a while, up to 1.8 times as much of the world. It never
closes in tighter than the original view. The pull-back moves like a spring and reacts to smoothed
speed and height (height fades in over the first second in the air), so bumps and short hops don't
move it. While the truck rolls backwards, the frame also eases back a little (up to 100 units) to
show where it's going. The settings are `CAMERA` in `src/game.js`.

Outside Classic the HUD has a **speedometer** in km/h (64 px of the stage is 2.5 m). It reads the
speed of the truck's centre of mass, so it stays steady while the truck turns over in the air. It
reads 0 while the truck is being dropped in at the start of a stage, until it first lands.

The game-over box says how far the run got: the stage reached (Standard and Classic), the stage
(Practice), or the distance (Endless).

**Garage**: choose the truck's body, paint, tyres and wheels. Choosing a body puts it in its own
colour; Paint then gives it any other body's colour. Only the look changes: every body and tyre
drives exactly the same (the garage says so). **Reset Truck** goes back to the truck you start with.

Standard, Classic and Endless each keep their own best (score, score, distance), and Time Trial a
best time and ghost per track (a ghost is about 30 KB a minute of driving). A Practice run with
damage saves to Standard's or Classic's best; a damage-free one saves none.

In damage-free runs outside Classic (Endless, and Practice with damage off), a **Flip** button
appears at the top of the screen when the truck has been stuck on its roof or side for two seconds.
It hops the truck up and turns it back onto its wheels, and stays for three seconds after the
truck stops looking stuck. A flip upright isn't a trick: tricks count again a second after it lands.

Outside Classic the body touching ground underneath it (the chassis bottoming out on a hard landing
or a ramp) isn't a scrape: no damage, bail or scrape sound. Hitting the cab's roof or sides is.

**Dynamic crash cam** (outside Classic; on the Options screen): when the truck is wrecked, the
camera eases over from the driving camera (in about 1¼ s) and pulls back, up to 8 times the
usual view, to keep all the scattering pieces in frame, centred on them. A wheel that shoots off
pulls the camera out with it at once. If the pieces spread further than 8 times the view can show,
it stays centred where it would be to show them all. `CRASH_CAM` in `src/game.js`.

**One Button** (the Controls option: Standard, Pedals on a touchscreen, or One Button): one button drives on the
ground and tilts the truck back in the air. On a keyboard it's Space or the up arrow (the other
arrow keys do nothing); on a touchscreen the pedals go and holding anywhere on the screen is the
button. Classic always uses the original controls. It also helps you balance: with both wheels on
the ground and tipped more than 45° (nose down, or nose up as on a steep climb), holding the button
also presses the tilt that leans the truck back towards level, exactly as the arrow keys would. On
one wheel it doesn't, as there the arrow keys can't tilt the truck either (let go to come down from
a wheelie). `BALANCE_ANGLE` in `src/game.js`.

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
| One Button | Space or ↑ | hold anywhere | A |
| Pause | P | ⏸ button | Start |
| Flip upright (when offered) | R | Flip button | Y |
| Play again (game over) | Space, Enter or Ctrl | Play Again button | A |
| Back to menu | Esc | Menu button | |
| Sound on / off | M | Sound switch (Options screen or pause menu) | |
| Full screen | F | | |

**Options** (on the title screen) has the switches for sound, the controls (Standard / Pedals or
One Button), the dynamic camera, the dynamic crash cam, and **Show Frame Rate** (frames per second
in the bottom left corner). Options for one mode stay on that mode's screen (Practice's Damage and
Classic, Time Trial's Ghost).

The game's
version is in the title screen's bottom-right corner; on the live site it's followed by the
commit it was built from.

The pause screen names the run (mode and stage, or distance in Endless) and has an **Options**
button with the options that apply to the run (Classic has no controls or camera switches).

The best scores, the High Scores screen's stats, the options and the truck chosen in the garage (with each body's paint) are saved in the browser
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

The course never climbs more than 5 tiles within 4 columns, and the generator looks ahead so it
never wanders into a valley that can only be left by a steeper wall: every hill can be driven up.

Score: 10 points for every new tile of ground, plus tricks as usual. The HUD shows the
distance in metres. **Milestones** are celebrated as you pass them, in gold with a burst of
confetti in the trucks' paint colours and a fanfare: 100, 250, 500, 750 and 1,000 m, then every 500 m; 5,000, 10,000, 25,000,
50,000, 100,000, 250,000, 500,000 and 1,000,000 points; and beating your best distance.

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
| Backflip / Frontflip | Turn over in the air and land (Double, Triple… for more turns). Each turn is counted out over the truck as it's completed (+1, +2…), before the landing names the whole flip | the degrees turned, as in the original |
| Big Air / Huge Air | 1 s / 2 s with no wheel on the ground; named with the airtime, e.g. *Big Air (1.7s)* | 3 per 1/70 s past half a second |
| Wheelie / Nose Wheelie | Drive along on the back / front wheel for ¾ s or more | 2 per 1/70 s |
| Clean | Land a jump on both wheels at once without scraping the cab | half the jump's points |

Tricks score in Standard, Endless and Practice (not Classic). Tricks done close together make a chain. The chain pays out about 1½ s after its last trick, worth
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
| `tools/editor.html` | A level editor for trying tile combinations (not part of the game): serve the repo and open `/tools/editor.html`. Paint tiles from the tile sheet, start from any stage or stunt track, see which tiles sit next to each one in the stages, show the collision lines and each tile's number, copy and stamp areas, shift the whole level by any number of tiles, shape the ground with the **Path** tool (a curve with draggable points and handles, kept on screen to compare with the ground; it picks the tiles that follow the curve and the fill below them, learned from the stages), and **Play** the level in the game (`index.html?test=custom`). Save and open levels as JSON files. |
| `tools/map.html` | Draws whole tracks as maps, to scale, with the start, the finish (or a looping track's repeats), distance marks and the path a simulated driver takes: serve the repo and open `/tools/map.html` (the stunt tracks) or `/tools/map.html?stages=0,1,2`. |
| `tools/make-stunts.mjs` | Builds Practice's stunt tracks into `assets/stunts.json` (stored a column at a time) from the stages' column shapes: `node tools/make-stunts.mjs`. |
| `tools/tune-stunts.mjs` | Tries Mega Ramp designs in the game's physics with a simulated driver and ranks them by air time and speed. |
| `src/audio.js`, `src/sound-events.js` | Synthesised sound, and the watcher that turns game events into sound cues. |
| `sounds.html` | A page for hearing every sound. |
| `src/trial.js` | Time Trial: time formats, saved best times, and ghosts (recorded as the truck's pose every other step, packed small). No DOM. |
| `src/wreck.js` | The ragdoll wreck: a wrecked truck's loose pieces (outside Classic). |
| `src/tricks.js` | Spots tricks (flips, airtime, wheelies, clean landings) and scores them in chains. |
| `src/stats.js` | The High Scores screen's records and totals: counting, and checking what's read back from storage. |
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
