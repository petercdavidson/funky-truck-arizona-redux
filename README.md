# Funky Truck Arizona Redux

A bouncy monster-truck game for the browser: drive across nine stages of desert hills without
wrecking your truck. It works with a keyboard, a touchscreen or a gamepad, and runs as a static
site on GitHub Pages.

## Menus

The title screen has **Play**, **Change Truck**, **High Scores**, **Options** and **How to Play**.
**Play** dims the title and opens a box of the modes (below); tap one, or **Back** or anywhere
outside the box to close it (on a keyboard: ↑ / ↓ and Space or Enter; on a gamepad: stick or d-pad and A).
**High Scores** shows each mode's best (and the highest stage you've beaten in Classic) and your records and totals across all your runs: longest
airtime, top speed, most flips in one jump, longest wheelie, best and longest trick chain, distance
and time driven, runs, flips, each trick, bails and wrecks (`src/stats.js`).
Its **Reset** button asks *Are you sure?*, and its Yes counts down five seconds before it can be
pressed; it clears every best score, best time, ghost and stat.

Tap or click the truck on the title screen to knock it into the air: where you hit it decides
which way it turns over (the back wheel flips it forwards). Tap it as often as you like; up high it
goes in front of the words. There's no height limit: knock it hard enough and it flies out of
sight and falls back down.

## Modes

| Mode | What it is |
| --- | --- |
| **Classic** | The nine stages as the original game played them. Choosing it opens its screen, with your two best scores, **Start**, and two switches. **Tricks** off: the original scoring (a landed flip's degrees, paid at once while the time bonus runs, after the finish line too); the same inputs give exactly the same truck and score as the original (a test replays recorded runs to check). Tricks on: tricks scored in chains instead. **2006 Mode**: the original as it looked: 576×448, drawn at 30 frames a second and blown up to fill the window with hard pixel edges, the original camera, no speedometer or altimeter, and a wrecked truck stays in one piece and drives on (tricks are always off). Otherwise Classic has the new view and extras, and a wreck comes apart (with tricks off, the whole truck still drives on unseen for the original's 3 seconds, so a flip it lands scores just as it did). Either way: the original's invisible ceiling along the top of each stage (Stages Two, Four, Six and Nine run close enough under it to hit it on a big jump), and the original scrape, where the chassis bottoming out on a hard landing counts as damage. The camera never shows above the ceiling. Classic and Classic with tricks keep separate best scores; 2006 Mode counts as Classic. |
| **Endless** | A course generated as you drive that never ends. No damage: it's free play. **End Run** in the pause menu finishes the run and saves your best distance. |
| **Stages** | Any of the nine stages, or **All Nine** in a row, against the clock (Practice is part of it now). The clock runs from when the truck first lands on each stage to its finish line. Your best run on each track comes back as a see-through **ghost** to race, and the clock's readout shows how far ahead (green) or behind (pink) of it you are at the same point on the track. The nine stages have the original ceiling and scrape, as in Classic. Switches on its screen: **Tricks** (spotted and scored as in Classic with tricks, or not at all; either way times count), **Damage** (off: the time is shown, but isn't a record), **2006 Mode** (as in Classic, with tricks off; times count) and **Ghost**. It also has the three **stunt tracks**, where tricks always score and there's no finish line and no clock; their best trick score is kept instead (with damage on), when the run ends (a wreck, quitting or restarting): **Mega Ramp** (a 450 m accelerator at 45°, a launch ramp good for about 470 km/h and 13 s in the air, then a long run-out ending in a quarter pipe), **Kicker Run** (a bumpy downhill of small kickers that goes on for ever) and **Halfpipe** (a deep bowl with steep walls and a ledge along each top). The screen shows each best time and best trick score. The pause menu can **Restart**; finishing offers **Retry**, **Next** and **Stages**; quitting goes back to the stage list. |
| **Stage Editor** | Your own stages. **Open Editor** opens the Stage Editor in a new tab; **Save to Game** there puts the stage on **Load Stage**, which also loads stages from files. Pick one, set **Damage** and **2006 Mode** (both off unless you switch them on; 2006 Mode scores flips the original way) and **Play**. Custom stages have no ceiling. A stage with a finish line can be completed like one of the nine; one without goes on until you quit, like a stunt track. |

Outside 2006 Mode, the driving view fills the window, on a phone held either way up (the
on-screen controls sit over the bottom of it). Close in, it never shows less of the world than
the original's 576×448: a taller window shows more sky and ground, and a wider one more to each side
(the truck keeps the original's place in the middle 576). The backdrop scales up evenly to cover it.
The camera follows the truck up and down anywhere, even below the stage, and above it where there's
no ceiling. 2006 Mode keeps the original 576×448 view. The menus' backdrop fills the window, with the menu centred on it. In a window at least as
tall as it is wide (a phone held upright, say), every menu switches to a tall layout: one column,
with the title screen's buttons in one column, the Stages screen's stages in a 3×3 grid, and
everything scaled up to fill the width, so the buttons are much bigger.

**Dynamic camera** (outside 2006 Mode; a switch on the Options screen turns it off): it follows the
truck exactly as the original camera does, keeping it in the same place on screen, but pulls the
frame back when the truck keeps up a good speed (mostly: full pull-back from speed comes at about
120 km/h) or has been high in the air for a while, up to 1.8 times as much of the world. It never
closes in tighter than the original view. The pull-back moves like a spring and reacts to smoothed
speed and height (height fades in over the first second in the air), so bumps and short hops don't
move it. While the truck rolls backwards, the frame also eases back a little (up to 100 units) to
show where it's going. At very high speeds (beyond about 120 km/h) it also moves with the truck, so
the truck never outruns it. The settings are `CAMERA` in `src/game.js`.

Outside 2006 Mode the HUD has a **speedometer** in km/h, or mph with the **Units** option (64 px of
the stage is 2.5 m). Its bar is quasi-logarithmic: it moves at everyday speeds and is full at
300 km/h. It reads the speed of the truck's centre of mass, so it stays steady while the truck
turns over in the air, and reads 0 while the truck is being dropped in at the start of a stage,
until it first lands (in Sandbox, or first boosts). Nothing goes faster than 9999 km/h, where the speedometer stops (only Sandbox gets near; past 999 km/h there's a little air drag, though ×8 boost straight up still gets there).

When the truck is so high that the ground below it is out of sight, an **altitude** reading
(▼ metres or feet to the ground) comes up under the speedometer (and stays while paused). Outside 2006 Mode,
higher still (measured from where the stage starts) the sky darkens into space at real heights (deep blue by 20 km, black with stars by 100 km;
clouds stop at 18 km), the truck darkens with it, and way up (from about 45 km) the moon rises into view; from 5 km
it steers more and more like a plane in the air, fully by 10 km (tilting turns it just as down low, but let go
and it slows to a stop as fast as it got going and holds its heading; never in Classic, under its ceiling);
and the engine fades out from 1 km to nothing at 20 km, leaving only the rocket. Past the speed of sound the **Mach** number shows under the speed (the speed
of sound at that height, from the standard atmosphere). A cab scraping the ground where it does no damage
(on its roof in Sandbox, say) is heard only as long as scraping would take to wreck it in Classic, then fades. Outside 2006 Mode the backdrop moves
a little too: sideways as you travel, and down as you climb, so the mountains sink away below a
truck flying high. Dirt flies from a cab scraping along the ground, and from a wrecked truck's
loose wheels and body.

On a phone held upright the HUD is drawn bigger, and the stage's name, trick names and milestones
come up lower down, nearer the truck.

The game-over box says how far the run got: the stage reached (Classic), the stage
(Stages), or the distance (Endless).

**Garage**: choose the truck's body, paint, tyres and wheels. Choosing a body puts it in its own
colour; Paint then gives it any other body's colour. Only the look changes: every body and tyre
drives exactly the same (the garage says so). **Reset Truck** goes back to the truck you start with.

Classic, Classic with tricks and Endless each keep their own best (score, score, distance), and Stages a
best time and ghost per track (a ghost is about 30 KB a minute of driving), and a best trick score
per stunt track.

In damage-free runs outside 2006 Mode (Endless, Sandbox, and Stages with damage off), a **Recover** button
appears at the top of the screen when the truck has been stuck on its roof or side for two seconds
(never with the truck more than 50 m above the ground).
It hops the truck up and turns it back onto its wheels, and stays for three seconds after the
truck stops looking stuck. A recovery isn't a trick: tricks count again a second after it lands.

Except on the nine stages in Classic and Stages (which keep the original scrape), the body
touching ground underneath it (the chassis bottoming out on a hard landing or a ramp) isn't a
scrape: no damage or scrape sound. Hitting the cab's roof or sides is. Bottoming out never bails a
trick chain.

**Dynamic crash cam** (outside 2006 Mode; on the Options screen): when the truck is wrecked, the
camera eases over from the driving camera (in about 1¼ s) and pulls back, up to 8 times the
usual view, to keep all the scattering pieces in frame, centred on them. A wheel that shoots off
pulls the camera out with it at once. If the pieces spread further than 8 times the view can show,
it stays centred where it would be to show them all. `CRASH_CAM` in `src/game.js`.

**One Button** (the Controls option: Standard, Pedals on a touchscreen, or One Button): one button drives on the
ground and tilts the truck back in the air. On a keyboard it's Space or the up arrow (the other
arrow keys do nothing); on a touchscreen the pedals go and holding anywhere on the screen is the
button. It works in every mode, 2006 Mode included (it does nothing the arrow keys can't). It also helps you balance: with both wheels on
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
| Forwards / reverse | ↑ / ↓ (or W / S) | right-hand pedals (slide between them) | A or RT / B or LT |
| Tilt back / forwards | ← / → (or A / D) | left-hand buttons (slide between them) | stick or d-pad |
| One Button | Space or ↑ | hold anywhere | A |
| Pause | P (and Esc in Classic and a timed run in Stages) | ⏸ button | Start |
| Recover (when offered) | R | Recover button | Y |
| Play again (game over) | Space, Enter or Ctrl | Play Again button | A |
| Menus: move / choose / back | arrow keys / Enter or Space / Esc, or the mouse | tap | stick or d-pad / A / B (each new menu starts with its first button picked) |
| Back to menu | Esc | Menu button | |
| Sound on / off | | Sound switch (Options screen or pause menu) | |
| Full screen | F | | |
| Sandbox: fire a missile | X | fire button (right) | X |
| Sandbox: jump | Z | jump button (left) | LB, or Y |
| Sandbox: boost (hold) | C or Shift (not with ⌘ or Ctrl, so screenshots don't boost) | boost button (right) | RB |

**Options** (on the title screen) lists each option with what it does, and a button beside it that changes it: sound, the controls (Standard / Pedals or
One Button), the dynamic camera, the dynamic crash cam, **Units** (metric, or imperial: mph, and
heights in feet, then miles past a mile), and **Show Frame Rate** (frames per second
in the bottom left corner). **Controller Mappings** (on the Options screen, under Controls, when a gamepad is connected) sets which gamepad button does what while driving: tap an action, then press the button (the menus always use A and B). Options for one mode stay on that
mode's screen (Classic's Tricks and 2006 Mode checkboxes, one or the other; the Stages screen's Tricks, Damage, 2006 Mode and Ghost). The speaker button in the top
right corner of the title screen switches the sound on and off too.

The game's
version is in the title screen's bottom-right corner; on the live site it's followed by the
commit it was built from.

The pause screen names the run (mode and stage, or distance in Endless) and has an **Options**
button with the options that apply to the run (2006 Mode has no camera or units switches).

The best scores, the High Scores screen's stats, the options and the truck chosen in the garage (with each body's paint) are saved in the browser
(`localStorage`).

Battle Mode and Rally Mode are out of the game for now; they are kept, playable, on the
`feat/battle-rally` branch.

## Sandbox Mode

Sandbox is in the **Play** menu's list of modes. Its screen sets things up, and **Tweaks** in the pause menu
changes them during a run (they take effect at once); the pause menu's **Sandbox Menu** goes back to this screen and **Quit to Menu** to the title. They're saved. Each has − and + buttons, and
tapping the value in between lists every choice to pick from. Anything changed from normal shows in
gold:

| Setting | Choices |
| --- | --- |
| Track | **Endless** (the default), the nine stages, the three stunt tracks and any stages saved into the game from the Stage Editor (before a run only) |
| Drive Power | ×½, ×1, ×1.5, ×2, ×3, ×5 |
| Gravity | None, Moon, Low, Earth, High, Jupiter |
| Air Spin | how hard the tilt keys turn the truck: ×½, ×1, ×2, ×4 |
| Suspension | Floppy, Normal, Stiff, Rigid |
| Boost Power | ×1 to ×8 |
| Jump Power | ×½ to ×5 |
| Air Jumps | jump again in mid-air |
| Rival Cars | 0 to 8 trucks going your way, to race (they can't be wrecked) |
| Enemy Cars | 0 to 8 trucks coming at you, to dodge or take out with missiles, rams and stomps |
| Birds | None, A Few, Lots, Flocks: they fly across the sky, over the hills; knock them out of it, or shoot them down (missiles home in on them; a hit one squawks, once for a missile however many it gets; a wrecked truck's loose wheels and body knock them down too). They never slow you down |
| Tumbleweeds | None, A Few, Lots, Loads: a little smaller than a tyre, sitting on the ground, rolling down slopes and coming to rest in piles; light and airy: hit one and it's pushed along (with a rustle), land on one and it squirts out and up, and a blast throws it a long way; in the air they float down and soon stop spinning; a missile that meets one blows up on it (missiles never aim for them) |
| Clouds | On or Off: layers of them fixed in the sky (more the higher you go), flat, soft-edged shapes, the farthest moving at 1/1000 of the world's speed and the nearest at 1/10, fainter the farther off, so you can tell which way you're flying |
| Slow Motion | Off, Half, Quarter |
| Hitboxes | show what the physics sees: the ground's collision lines (orange where they scrape the cab), the wheels and the cab's roof probe (all that touches the ground), the circles trucks bump each other with (when there are other cars), and a wreck's pieces. The wheels and probe are really points (the dots) kept off the dashed line, the ground pushed out by 21.5 px; on smooth ground that's the same as a 21.5 px circle, but at a corner the original game joins the pushed-out lines short, so a wheel settles into a V and cuts into a peak a little |

Boost, jumps and missiles never run out, and there's no damage. On a stage, the enemy cars are
spread out along it, and the finish line still ends the run, with your time (the clock runs from
the first landing, or the first boost if that comes sooner). On Endless's course and the stunt tracks there's no finish,
and the cars loop: one that's been out of sight for two seconds comes back just out of view.
Cars never appear or vanish in view: new rival cars come in just out of view to your right, and
cars taken away in Tweaks go once they're out of sight. Holding the boost roars like a rocket.
Nothing done in Sandbox counts towards High Scores except its own section: birds whacked, tumbleweeds tumbled, top speed, highest climb and most flips in one jump. Slow motion runs fewer steps a second, not
slower ones, so the physics is exactly the same, only slower. `SANDBOX_ROWS` in `src/sandbox.js`.

## Endless Mode

Endless courses are built from the original nine stages' own building blocks. Every column of
tiles in the stages is reduced to its shape, and the generator records every place one shape
follows another (with how far the ground steps up or down). It then strings columns together using
only those joins. Usually it matches the last two or three columns, so whole hills and ramps come
out as they were designed; now and then it matches only the last one, which is where the course
turns into something new. The ground is kept inside a fixed height band, and the joins are weighted
by the stage they came from, so a course starts like Stage One and drifts towards the later stages
the further you get. The course lives in a window of 128 columns that scrolls as you drive
(`src/endless.js`). It goes on for ever to the left too, behind the start: that way is built from
the same joins read right to left. Ground that scrolls off either side is remembered (up to about
50 km of it), so turning back finds the course as you left it.

The course never climbs more than 5 tiles within 4 columns, and the generator looks ahead so it
never wanders into a valley that can only be left by a steeper wall: every hill can be driven up.

Score: 10 points for every new tile of ground, either way, plus tricks as usual. The HUD shows the
distance covered in metres (ahead of the start and behind it, added up). **Milestones** are celebrated as you pass them, in gold with a burst of
confetti in the trucks' paint colours and a fanfare: 100, 250, 500, 750 and 1,000 m, then every 500 m; 5,000, 10,000, 25,000,
50,000, 100,000, 250,000, 500,000 and 1,000,000 points; and beating your best distance.

## Sound

All sound is synthesised live with the Web Audio API, apart from one recorded clip: a bird hit by
the truck (`assets/audio/bird-hit.wav`, a little higher or lower each time). Sound is
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

Tricks score in Classic with tricks on, Endless, Sandbox and Stages (unless switched off there; never in 2006 Mode). Tricks done close together make a chain. The chain pays out about 1½ s after its last trick, worth
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
`?test=play&stage=5&frames=600&touch=1` or `?test=garage&look=3,1,2,0` (body, tyre, wheel, paint) (add `&retro=1` for 2006 Mode or `&damage=0`; `?test=classic&stage=3&tricks=0&retro=1` for Classic), or `?test=endless&seed=3&frames=600` for Endless Mode. See `applyTestParams` in `src/main.js`. Nothing is
saved to storage while a test parameter is set.

## Code layout

| File | What it does |
| --- | --- |
| `src/game.js` | All game logic: truck physics, collisions, scoring, stages and the screen state machine. No DOM access, so tests run it under Node. |
| `src/render.js` | Draws everything on the canvas, and defines the clickable menu areas. |
| `src/endless.js` | Endless Mode's course generator. |
| `editor/` | The **Stage Editor** (its own page, made for a desktop browser; see `editor/CLAUDE.md`): the game's Stage Editor screen opens it in a new tab, or serve the repo and open `/editor/`. Tools down the left (**Paint**, **Select**, **Path** (**G**), **Shape** (**Q**), **Start**, **Finish**; press **?** for the keys). Paint tiles from the tile sheet, mirrored (**H**), upside down (**V**) or turned (**R**) for walls, ceilings and overhangs (the sheet can be shown each way round); select an area to move, copy, paste, duplicate, flip either way or turn; start from any stage or stunt track; show the collision lines and each tile's number (on the stage and in the tile sheet); shift the whole level; shape the ground with the **Path** tool (curves with draggable points and handles, corners included, running any way round: up walls, back over themselves for overhangs, along ceilings; it picks the tiles that follow the curve, turned where needed, and the fill so the dirt's edge carries on from tile to tile; a path's tiles go with it when it's moved or deleted, and tiles put down by hand sit over it, breaking it only where they cover its ground pieces); draw circles, squares and diamonds of ground, or holes that shape, with **Shape** (click one to move it, resize it by its box or delete it); the dirt fills itself in straight out from the ground side of each surface (down from floors, up from ceilings, sideways from walls), paths join by dropping one's end on another's (or on its own start, for a loop), and places where it can't be worked out are marked in red (**Problems**); **Smooth path edges** fixes the art around ground placed by hand; set an optional **Finish line**; pinch or Ctrl+scroll to zoom, and the strip along the bottom shows the whole level. **Play** it in the game, **Save to Game** (it's then on the Load Stage screen), and save and open stages as JSON files. |
| `src/tile-forms.js` | Tiles turned and flipped for custom stages (walls, ceilings, overhangs): their ids, collision lines and the sheet's mirror pairs. Drawn from the sheet's own tiles, turned. |
| `src/stages.js` | Custom stages: the format the editor and the game share, and checking stages read back. |
| `tools/make-icons.mjs` | Draws the site and app icons (`assets/icon-*.png`, `assets/favicon-32.png`) from the game's own truck, sky and ground tiles: serve the repo, then `node tools/make-icons.mjs`. |
| `tools/map.html` | Draws whole tracks as maps, to scale, with the start, the finish (or a looping track's repeats), distance marks and the path a simulated driver takes: serve the repo and open `/tools/map.html` (the stunt tracks) or `/tools/map.html?stages=0,1,2`. |
| `tools/make-stunts.mjs` | Builds the stunt tracks into `assets/stunts.json` (stored a column at a time) from the stages' column shapes: `node tools/make-stunts.mjs`. |
| `tools/tune-stunts.mjs` | Tries Mega Ramp designs in the game's physics with a simulated driver and ranks them by air time and speed. |
| `src/audio.js`, `src/sound-events.js` | Synthesised sound, and the watcher that turns game events into sound cues. |
| `sounds.html` | A page for hearing every sound. |
| `src/trial.js` | Stages: time formats, saved best times, and ghosts (recorded as the truck's pose every other step, packed small). No DOM. |
| `src/wreck.js` | The ragdoll wreck: a wrecked truck's pieces (outside 2006 Mode). The wheels come off and bounce like rubber, and hit each other and the body (each body's own outline, `src/wreck-shapes.js`). They leave their wheel arches without being flung (upside down, they hop out), and never sink back in; their spin counts, gripping the ground, the body and each other. The body rises out of any ground its cab scraped into, and grips the ground by its weight. Once everything has settled the wreck goes still until something knocks it. The suspension hangs from the body like legs. |
| `tools/wreck-lab.html` | The Wreck Lab: real crashes, found by bots driving the nine stages (`node tools/make-wreck-crashes.mjs`), replayed two at a time with all six bodies, then wrecked live. `node tools/wreck-lab-sim.mjs` tallies how the wheels end up. |
| `tools/make-tile-art.mjs` | Samples the pixels along each tile's edges into `src/tile-art.js`, for the Path tool's look pass: serve the repo, then `node tools/make-tile-art.mjs`. |
| `tools/make-wreck-shapes.mjs` | Traces each body sprite's outline into `src/wreck-shapes.js`: serve the repo, then `node tools/make-wreck-shapes.mjs`. |
| `src/battle.js` | Sandbox's rival and enemy cars, collisions between trucks, missiles and explosions, your boost and jump. |
| `src/render-battle.js` | Drawing Sandbox's cars, missiles and explosions, and its HUD. |
| `src/sandbox.js` | Sandbox Mode's settings, putting them into the game, and its cars (placing and looping them). |
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
