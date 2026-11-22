// render.js — draws the game onto a 2D canvas.
//
// All drawing uses the original 576x448 stage coordinates (y down, clockwise rotation), scaled to
// the canvas. Tiles are drawn in device pixels with snapped edges so they never show seams.

import { TILE, STAGE_W, STAGE_H, STEP_HZ, MILESTONE_SHOW, RESET_WAIT } from './game.js';
import { HUD_FONT, TITLE_FONT, BODY_PAINTS } from './assets.js';
import { TRICK } from './tricks.js';
import { VERSION, BUILD } from './version.js';
import { Wreck } from './wreck.js';
import { TRIAL_ALL, formatTime, formatGap } from './trial.js';
import { battleBack, battleFront, battleHud, rallyHud } from './render-battle.js';
import { ordinal } from './rally.js';
import { SANDBOX_ROWS } from './sandbox.js';

const DEG = Math.PI / 180;
const FILL_SCREENS = new Set(['playing', 'paused', 'pauseOptions', 'sandboxTweaks', 'gameOver']);
const MENU_SCREENS = new Set(['title', 'modes', 'stats', 'options', 'help', 'garage', 'practiceSelect', 'trialSelect', 'sandbox']);
const AHEAD = '#8ff0a4', BEHIND = '#ffb0a0'; // Time Trial gaps: ahead of / behind your best
const FILL_TILE = 1;   // solid dirt
const BUTTON_FILL = 'rgba(107, 74, 64, 0.92)';
const SPEEDO_MAX = 160;  // km/h at which the speedometer's bar is full
const BOX_FILL = 'rgba(140,97,79,0.96)', BOX_EDGE = 'rgba(255,255,255,0.6)'; // the game-over box and the mode picker
const MILESTONE_GOLD = '#ffe27a';

// ---------------------------------------------------------------------------------------------
// Clickable areas per screen. `label` buttons are drawn by us; the rest are hotspots over the
// original art. `show(game)` hides a button when it returns false. Actions are handled in main.js.
//
// Each screen has two layouts. BUTTONS is the usual one, on the original 576x448 stage, with the
// options as small on/off switches down the right-hand side. TALL_BUTTONS is for windows at least
// as tall as they are wide (a phone held upright): a narrower page, TALL_W across and TALL_H[screen]
// down, that is scaled up to fill the width, with everything in one column.

const r = (x, y, w, h) => ({ x, y, w, h });
const onOff = (v) => (v ? 'On' : 'Off');
const option = (y, label, action) => ({ rect: r(428, y, 132, 20), label, action, small: true });

/** The controls in use, by the names the player sees. */
const controlsName = (g, r) => (g.oneButton ? 'One Button' : r?.touchMode ? 'Pedals' : 'Standard');
/** What the controls in use do. */
function controlsAbout(g, r) {
  if (g.oneButton) return r?.touchMode ? 'Hold anywhere on the screen to drive, and to tilt back in the air' : 'Space (or the up arrow) drives, and tilts back in the air';
  return r?.touchMode ? 'Pedals on the right drive and reverse; the left buttons tilt' : 'The arrow keys drive and tilt';
}
const notClassic = (g) => !g.rules.classic;

/**
 * The Options screen: [label, action, what it does, applies(game)]. The pause menu's Options
 * shows only those that apply to the run (the controls and cameras aren't Classic's).
 */
const OPTIONS = [
  [(g) => `♪ Sound: ${onOff(g.soundOn)}`, 'sound', () => 'Engine, landings, tricks and crashes (M on a keyboard)'],
  [(g, r) => `Controls: ${controlsName(g, r)}`, 'oneButton', controlsAbout, notClassic],
  [(g) => `Dynamic Camera: ${onOff(g.dynamicCamera)}`, 'dynamicCamera', () => 'Pulls back to show more when you go fast or fly high', notClassic],
  [(g) => `Dynamic Crash Cam: ${onOff(g.crashCam)}`, 'crashCam', () => 'Pulls back to keep every piece of a wrecked truck in view', notClassic],
  [(g) => `Show Frame Rate: ${onOff(g.showFps)}`, 'showFps', () => 'Frames per second, in the bottom left corner'],
];
const optionRow = (i, tall) => (tall ? r(50, 92 + 90 * i, 260, 40) : r(178, 70 + 62 * i, 220, 26));
const optionAbout = (action) => OPTIONS.find((o) => o[1] === action)?.[2];

/** The pause menu's Options: the options that apply, by Classic rules or not, then Back. */
function pauseOptionButtons(tall, extra = {}) {
  return [true, false].flatMap((classic) => {
    const when = (g) => !!g.rules?.classic === classic;
    const list = OPTIONS.filter((o) => !o[3] || o[3]({ rules: { classic } }));
    return [
      ...list.map(([label, action], i) => ({ rect: optionRow(i, tall), label, action, show: when, ...extra })),
      { rect: tall ? r(80, 560, 200, 38) : r(229, 400, 120, 25), label: 'Back', action: 'pauseBack', show: when, ...extra },
    ];
  });
}

/** High Scores: Reset and Menu, or while a reset is being confirmed, Yes (once it may) and No. */
function statsButtons(tall, extra = {}) {
  const asking = (g) => !!g.resetConfirm, idle = (g) => !g.resetConfirm;
  const left = (g) => Math.ceil(Math.max(0, RESET_WAIT - (g.resetConfirm?.steps ?? 0)) / STEP_HZ);
  return [
    { rect: tall ? r(30, 700, 145, 38) : r(160, 412, 120, 25), label: 'Reset', action: 'resetAsk', show: idle, ...extra },
    { rect: tall ? r(185, 700, 145, 38) : r(296, 412, 120, 25), label: 'Menu', action: 'menu', show: idle, ...extra },
    { rect: tall ? r(50, 404, 125, 44) : r(168, 254, 115, 28), label: (g) => (g.resetReady ? 'Yes, Reset' : `Yes (${left(g)})`), action: 'resetYes',
      show: asking, disabled: (g) => !g.resetReady, ...extra },
    { rect: tall ? r(185, 404, 125, 44) : r(293, 254, 115, 28), label: 'No', action: 'resetNo', show: asking, ...extra },
  ];
}
/** The title's drop shadow colour. */
const TITLE_SHADOW = '#7d5545';
/** The title screen's sound switch, a speaker in the top right corner. */
const SOUND_BUTTON = { wide: r(538, 8, 30, 26), tall: r(320, 6, 34, 30) };
/** The title screen's buttons. Play opens the mode picker (the 'modes' screen) over it. */
const MENU = [['Play', 'play'], ['Change Truck', 'garage'], ['High Scores', 'stats'], ['Options', 'options'], ['How to Play', 'help']];
/** The game modes, in the mode picker: [label, action, what it is]. */
export const MODES = [
  ['Standard', 'standard', 'The nine stages, with tricks and all the new extras'],
  ['Classic', 'classic', 'The original game, exactly as it was'],
  ['Endless', 'endless', 'A course that goes on for ever: how far can you get?'],
  ['Time Trial', 'trial', 'Race the clock, and your best run\'s ghost'],
  ['Practice', 'practice', 'Any one stage, and the stunt tracks'],
  ['Sandbox', 'sandbox', 'Turn the physics up (or down) and go wild'],
];
const modeRow = (i, tall) => (tall ? r(40, 96 + 66 * i, 280, 38) : r(112, 100 + 30 * i, 120, 25));
/** Where the mode picker's Back button goes, under the last mode (the box ends below it). */
const modesBack = (tall) => (tall ? r(80, 96 + 66 * MODES.length + 20, 200, 36) : r(228, 100 + 30 * MODES.length + 14, 120, 24));
const PRACTICE_OPTIONS = [
  [(g) => `Damage: ${onOff(g.practiceDamage)}`, 'practiceDamage'],
  [(g) => `Classic: ${onOff(g.practiceClassic)}`, 'practiceClassic'],
];
const LOOK_PARTS = ['body', 'paint', 'tyre', 'hub'];
/** Where Time Trial's stage cards go: a 3x3 grid on the usual page, and on the tall page. */
const trialCard = (i) => ({ x: 112 + 100 * (i % 3), y: 68 + 68 * Math.floor(i / 3) });
const tallTrialCard = (i) => ({ x: 20 + 110 * (i % 3), y: 76 + 92 * Math.floor(i / 3) });
/** Practice's stunt-track buttons (after the nine stages), labelled with the tracks' names. */
const STUNTS = 3;
const stuntButtons = (place, extra = {}) => Array.from({ length: STUNTS }, (_, i) => ({
  rect: place(i), label: (g) => g.stageName(9 + i), action: `stage${9 + i}`, show: (g) => (g.stunts?.length ?? 0) > i, ...extra,
}));
/** The garage's note that the truck's look is only a look. */
const COSMETIC = 'Looks only: every truck drives exactly the same';

/**
 * The pause menu's buttons, placed by `place(i)`. Each kind of run gets its own column: Endless
 * can end the run, and Practice and Time Trial can restart. Options opens the options that apply.
 */
function pauseButtons(place) {
  const kinds = [
    ['endless', (g) => g.mode === 'endless'],
    ['classic', (g) => g.mode === 'campaign' && g.rules.classic],
    ['play', (g) => g.mode === 'campaign' && !g.rules.classic],
    ['practiceClassic', (g) => g.mode === 'practice' && g.rules.classic],
    ['practice', (g) => g.mode === 'practice' && !g.rules.classic],
    ['trial', (g) => g.mode === 'trial'],
    ['battle', (g) => g.mode === 'battle'],
    ['rally', (g) => g.mode === 'rally'],
    ['sandbox', (g) => g.mode === 'sandbox'],
  ];
  return kinds.flatMap(([kind, when]) => [
    { label: 'Resume', action: 'resume' },
    kind === 'endless' && { label: 'End Run', action: 'endRun' },
    // Practice and Time Trial can start the run again (the stunt tracks have no end)
    (kind.startsWith('practice') || ['trial', 'battle', 'rally', 'sandbox'].includes(kind)) && { label: 'Restart', action: 'again' },
    // Sandbox's settings, during the run
    kind === 'sandbox' && { label: 'Tweaks', action: 'tweaks' },
    // Quitting Practice or Time Trial goes back to its list of stages
    { label: (g) => (g.quitScreen === 'title' ? 'Quit to Menu' : 'Quit to Stages'), action: 'menu' },
    { label: 'Options', action: 'pauseOptions' },
  ].filter(Boolean).map((b, i) => ({ ...b, rect: place(i), show: when })));
}

/**
 * The game-over buttons. Practice and Time Trial get a grid (placed by `grid(i)`): the same stage
 * again and the next stage (if there is one), then their list of stages across both columns.
 * Other runs get Play Again and Menu in a column (placed by `column(i)`).
 */
function gameOverButtons(column, grid) {
  const practice = (g) => g.mode === 'practice', trial = (g) => g.mode === 'trial' || g.mode === 'rally';
  const gridded = (g) => practice(g) || trial(g), other = (g) => !gridded(g);
  return [
    { label: 'Play Again', action: 'again', rect: column(0), show: other },
    { label: 'Menu', action: 'menu', rect: column(1), show: other },
    { label: (g) => (trial(g) ? 'Retry' : 'Again'), action: 'again', rect: grid(0), show: gridded },
    { label: 'Next', action: 'nextStage', rect: grid(1), show: (g) => (practice(g) && g.hasNextPractice) || (g.mode === 'trial' && g.hasNextTrial) || g.hasNextRally },
    // back to the list of stages, across the width of both columns
    { label: 'Stages', action: 'menu', rect: { ...grid(2), w: grid(3).x + grid(3).w - grid(2).x }, show: gridded },
  ];
}

/** Sandbox's settings (all of them before a run, those that can change during one in Tweaks). */
const sandboxRows = (tweaks) => SANDBOX_ROWS.filter((row) => !tweaks || row.live !== false);
/** Where setting row i goes: its label on the left, then a - button, the value and a + button. */
const sbRow = (i, tall) => (tall ? { x: 20, y: 70 + 44 * i, w: 320, h: 34, lw: 136, bw: 38 }
  : { x: i < 6 ? 28 : 302, y: 72 + 40 * (i % 6), w: 246, h: 28, lw: 104, bw: 26 });
function sandboxButtons(tall, tweaks, extra = {}) {
  const rows = sandboxRows(tweaks);
  const steppers = rows.flatMap((row, i) => {
    const R = sbRow(i, tall);
    return [
      { rect: r(R.x + R.lw, R.y, R.bw, R.h), label: '−', action: `sb:${row.key}:-1`, ...extra },
      { rect: r(R.x + R.w - R.bw, R.y, R.bw, R.h), label: '+', action: `sb:${row.key}:1`, ...extra },
    ];
  });
  const y = tall ? 70 + 44 * rows.length + 14 : 330;
  const big = tall ? T_BIG : {};
  const bottom = tweaks
    ? [{ rect: tall ? r(30, y, 145, 40) : r(170, y, 110, 26), label: 'Reset', action: 'sbReset', ...big },
      { rect: tall ? r(185, y, 145, 40) : r(296, y, 110, 26), label: 'Back', action: 'tweaksBack', ...big }]
    : [{ rect: tall ? r(20, y, 100, 40) : r(124, y + 2, 100, 26), label: 'Reset', action: 'sbReset', ...big },
      { rect: tall ? r(130, y, 100, 40) : r(238, y - 2, 100, 34), label: 'Go!', action: 'sbGo', ...(tall ? T_BIG : { size: 15 }) },
      { rect: tall ? r(240, y, 100, 40) : r(352, y + 2, 100, 26), label: 'Menu', action: 'menu', ...big }];
  return [...steppers, ...bottom];
}

export const BUTTONS = {
  title: [...MENU.map(([label, action], i) => ({ rect: r(223, 248 + 29 * i, 130, 25), label, action })), { rect: SOUND_BUTTON.wide, action: 'sound' }],
  modes: [
    ...MODES.map(([label, action], i) => ({ rect: modeRow(i, false), label, action })),
    { rect: modesBack(false), label: 'Back', action: 'back' },
  ],
  stats: statsButtons(false),
  options: [
    ...OPTIONS.map(([label, action], i) => ({ rect: optionRow(i, false), label, action })),
    { rect: r(229, 400, 120, 25), label: 'Menu', action: 'menu' },
  ],
  pauseOptions: pauseOptionButtons(false),
  help: [{ rect: r(229, 386, 120, 25), label: 'Menu', action: 'menu' }],
  garage: [
    { rect: r(160, 413, 120, 25), label: 'Reset Truck', action: 'lookReset' },
    { rect: r(296, 413, 120, 25), label: 'Menu', action: 'menu' },
    ...LOOK_PARTS.flatMap((part, i) => [
      { rect: r(200, 226 + 34 * i, 32, 32), action: `${part}-1` },
      { rect: r(344, 226 + 34 * i, 32, 32), action: `${part}+1` },
    ]),
  ],
  practiceSelect: [
    ...Array.from({ length: 9 }, (_, i) => ({ rect: r(136 + 34 * i, 228.05, 32, 32), action: `stage${i}` })),
    ...stuntButtons((i) => r(154 + 92 * i, 290, 84, 25)),
    { rect: r(229, 413, 120, 25), label: 'Menu', action: 'menu' },
    ...PRACTICE_OPTIONS.map(([label, action], i) => option(290 + 24 * i, label, action)),
  ],
  trialSelect: [
    ...Array.from({ length: 9 }, (_, i) => ({ rect: r(trialCard(i).x, trialCard(i).y, 92, 58), action: `trial${i}` })),
    { rect: r(112, 274, 292, 40), action: `trial${TRIAL_ALL}` },
    { rect: r(198, 336, 120, 25), label: 'Menu', action: 'menu' },
    option(120, (g) => `Ghost: ${onOff(g.ghostOn)}`, 'ghostOn'),
  ],
  sandbox: sandboxButtons(false, false),
  sandboxTweaks: sandboxButtons(false, true),
  gameOver: gameOverButtons((i) => r(229, 250 + 31 * i, 120, 25), (i) => r(165 + 126 * (i % 2), 250 + 31 * Math.floor(i / 2), 120, 25)),
  paused: pauseButtons((i) => r(213, 250 + 31 * i, 150, 25)),
  playing: [],
};

export const TALL_W = 360;
export const TALL_H = { title: 680, modes: 680, stats: 760, options: 620, pauseOptions: 620, help: 560, garage: 580, practiceSelect: 540, trialSelect: 540, sandbox: 680, sandboxTweaks: 640, paused: 460, gameOver: 330 };
/** The tall layouts are used once the view is at least this tall (in stage units, 576 across). */
export const TALL_FROM = 576;
const T_BIG = { size: 15 }, T_SMALL = { small: true, size: 12.5 };
const tallStage = (i) => ({ x: 64 + 80 * (i % 3), y: 80 + 80 * Math.floor(i / 3) });

export const TALL_BUTTONS = {
  title: [...MENU.map(([label, action], i) => ({ rect: r(60, 262 + 54 * i, 240, 42), label, action, ...T_BIG })), { rect: SOUND_BUTTON.tall, action: 'sound' }],
  modes: [
    ...MODES.map(([label, action], i) => ({ rect: modeRow(i, true), label, action, ...T_BIG })),
    { rect: modesBack(true), label: 'Back', action: 'back', ...T_BIG },
  ],
  stats: statsButtons(true, T_BIG),
  options: [
    ...OPTIONS.map(([label, action], i) => ({ rect: optionRow(i, true), label, action, ...T_BIG })),
    { rect: r(80, 560, 200, 38), label: 'Menu', action: 'menu', ...T_BIG },
  ],
  pauseOptions: pauseOptionButtons(true, T_BIG),
  help: [{ rect: r(80, 500, 200, 38), label: 'Menu', action: 'menu', ...T_BIG }],
  garage: [
    { rect: r(30, 532, 145, 38), label: 'Reset Truck', action: 'lookReset', ...T_BIG },
    { rect: r(185, 532, 145, 38), label: 'Menu', action: 'menu', ...T_BIG },
    ...LOOK_PARTS.flatMap((part, i) => [
      { rect: r(30, 268 + 56 * i, 48, 48), action: `${part}-1` },
      { rect: r(282, 268 + 56 * i, 48, 48), action: `${part}+1` },
    ]),
  ],
  practiceSelect: [
    ...Array.from({ length: 9 }, (_, i) => ({ rect: r(tallStage(i).x, tallStage(i).y, 72, 72), action: `stage${i}` })),
    ...stuntButtons((i) => r(9 + 116 * i, 344, 110, 36), { size: 13 }),
    ...PRACTICE_OPTIONS.map(([label, action], i) => ({ rect: r(95, 404 + 35 * i, 170, 28), label, action, ...T_SMALL })),
    { rect: r(80, 490, 200, 38), label: 'Menu', action: 'menu', ...T_BIG },
  ],
  trialSelect: [
    ...Array.from({ length: 9 }, (_, i) => ({ rect: r(tallTrialCard(i).x, tallTrialCard(i).y, 100, 80), action: `trial${i}` })),
    { rect: r(20, 360, 320, 52), action: `trial${TRIAL_ALL}` },
    { rect: r(95, 428, 170, 28), label: (g) => `Ghost: ${onOff(g.ghostOn)}`, action: 'ghostOn', ...T_SMALL },
    { rect: r(80, 476, 200, 38), label: 'Menu', action: 'menu', ...T_BIG },
  ],
  sandbox: sandboxButtons(true, false),
  sandboxTweaks: sandboxButtons(true, true),
  gameOver: gameOverButtons((i) => ({ ...r(60, 200 + 50 * i, 240, 40), ...T_BIG }),
    (i) => ({ ...r(60 + 125 * (i % 2), 200 + 50 * Math.floor(i / 2), 115, 40), ...T_BIG })),
  paused: pauseButtons((i) => ({ ...r(60, 160 + 48 * i, 240, 40), ...T_BIG })),
  playing: [],
};
// pauseButtons and gameOverButtons put the extra fields in the rect for the tall layout; move
// them onto the button.
for (const b of [...TALL_BUTTONS.paused, ...TALL_BUTTONS.gameOver]) { const { x, y, w, h, ...rest } = b.rect; Object.assign(b, rest); b.rect = { x, y, w, h }; }

/** The buttons a screen shows in the usual or the tall layout. */
export function buttonsFor(screen, tall = false) {
  return ((tall ? TALL_BUTTONS : BUTTONS)[screen]) || [];
}

/** Which run this is, for the pause screen: "Play  ·  Stage Three", "Endless  ·  420 m", ... */
export function runName(game) {
  if (game.mode === 'endless') return `Endless  ·  ${game.metres} m`;
  if (game.mode === 'battle') return `Battle  ·  Wave ${Math.max(1, game.battle.wave)}  ·  ${game.metres} m`;
  if (game.mode === 'rally') return `Rally  ·  ${game.race.championship ? `Championship  ·  ${game.stageName(game.level)}` : game.stageName(game.level)}`;
  if (game.mode === 'sandbox') return `Sandbox  ·  ${game.stageName(game.level)}`;
  if (game.mode === 'trial') return `Time Trial  ·  ${trialName(game, game.track)}`;
  const stage = game.stageName(game.level);
  if (game.mode === 'campaign') return `${game.rules.classic ? 'Classic' : 'Standard'}  ·  ${stage}`;
  const rules = [game.rules.classic && 'Classic rules', !game.rules.damage && 'no damage'].filter(Boolean);
  return `Practice  ·  ${stage}${rules.length ? `  (${rules.join(', ')})` : ''}`;
}

/**
 * For the game-over box: where the run got to. A wreck in Play or Classic says how far through the
 * nine stages it got; Practice names its stage. Endless already shows its distance.
 */
export function reachedLine(game) {
  if (game.mode === 'endless') return '';
  if (game.mode === 'rally') return game.race.championship ? 'Championship  ·  All Nine' : game.stageName(game.level);
  if (game.mode === 'battle') { const b = game.battle; return `Wave ${Math.max(1, b.wave)}  ·  ${b.takedowns} takedown${b.takedowns === 1 ? '' : 's'}`; }
  const stage = game.stageName(game.level);
  const n = game.data.levels.length;
  const allNine = game.mode === 'campaign' || (game.mode === 'trial' && game.track === TRIAL_ALL);
  if (allNine) return game.wrecked ? `Got to stage ${game.level + 1} of ${n}` : `All ${n} stages`;
  return stage;
}

/** The game-over title for a rally. */
function rallyTitle(race) {
  const r = race.result;
  if (!r) return 'Race Over';
  if (race.championship) return r.place === 1 ? 'Champion!' : `${ordinal(r.place)} Overall`;
  if (r.dnf) return 'Race Over';
  return r.place === 1 ? 'You Won!' : `${ordinal(r.place)} Place`;
}

/** The game-over lines for a rally: the time (or points), and your best. */
function rallyLines(game) {
  const r = game.race.result;
  if (!r) return ['', ''];
  const best = r.record ? (r.best ? 'A new best!' : '') : `Best: ${ordinal(r.best)}`;
  if (game.race.championship) return [`${r.points} points`, best];
  return [r.dnf ? 'Did not finish' : `Time: ${formatTime(r.time)}`, best];
}

/** A Time Trial track's name: a stage's, or All Nine. */
export function trialName(game, track) { return track === TRIAL_ALL ? 'All Nine' : game.stageName(track); }

/** The button at (x, y) in menu coordinates (see Renderer.toMenu), or null. */
export function hitButton(screen, x, y, game, tall = false) {
  return buttonsFor(screen, tall).find((b) => (!b.show || b.show(game))
    && x >= b.rect.x && x < b.rect.x + b.rect.w && y >= b.rect.y && y < b.rect.y + b.rect.h) || null;
}

/** The High Scores screen: [heading] or [label, value] rows, in two columns. */
export function statsColumns(game) {
  const S = game.stats, n = (v) => Math.round(v).toLocaleString('en-US');
  const secs = (steps) => `${(steps / STEP_HZ).toFixed(1)} s`;
  const none = '—', or = (v, f) => (v > 0 ? f(v) : none);
  const dist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
  const mins = Math.floor(S.driveSteps / STEP_HZ / 60);
  const time = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
  const T = S.tricks;
  return [[
    ['Best Scores'],
    ['Standard', or(game.bestPlay, n)],
    ['Classic', or(game.best, n)],
    ['Endless', or(game.bestEndless, (v) => `${n(v)} m`)],
    ['Time Trial (All Nine)', game.trialBests[TRIAL_ALL] ? formatTime(game.trialBests[TRIAL_ALL]) : none],
    ['Records'],
    ['Longest airtime', or(S.maxAir, secs)],
    ['Top speed', or(S.topSpeed, (v) => `${n(v)} km/h`)],
    ['Most flips in one jump', or(S.mostFlips, n)],
    ['Longest wheelie', or(S.longestWheelie, secs)],
    ['Best trick chain', or(S.bestChain, (v) => `${n(v)} pts`)],
    ['Longest trick chain', or(S.longestChain, (v) => `${n(v)} tricks`)],
  ], [
    ['Totals'],
    ['Distance driven', dist(S.distance)],
    ['Time driving', time],
    ['Runs', n(S.runs)],
    ['Stages finished', n(S.stages)],
    ['Flips', n(S.backflips + S.frontflips)],
    ['Backflips', n(S.backflips)],
    ['Frontflips', n(S.frontflips)],
    ['Big Airs', n(T['Big Air'])],
    ['Huge Airs', n(T['Huge Air'])],
    ['Wheelies', n(T.Wheelie)],
    ['Nose Wheelies', n(T['Nose Wheelie'])],
    ['Clean landings', n(T.Clean)],
    ['Bails', n(S.bails)],
    ['Wrecks', n(S.wrecks)],
    // the Esc easter egg: only listed once it's been found
    ...(S.selfWrecks > 0 ? [['Wrecked on purpose', n(S.selfWrecks)]] : []),
  ]];
}

/** Where the title screen's truck is drawn: its resting point (288, 170) goes to (x, y), scaled by k. */
export const TITLE_TRUCK = { wide: { x: STAGE_W / 2, y: 218, k: 1 }, tall: { x: TALL_W / 2, y: 212, k: 1.15 } };

// ---------------------------------------------------------------------------------------------

export class Renderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.a = assets;
    this.scale = 1;      // device pixels per stage unit
    this.offX = 0; this.offY = 0;
    this.hover = null;
    this.touchMode = false;
    this.confetti = [];      // Endless milestones' confetti: { x, y, vx, vy, rot, spin, color, life }
    this.confettiFor = 0;    // the milestone it was thrown for
    this.lastDraw = 0;
  }

  /** A point in menu coordinates, in the title truck's own coordinates (as Truck.T has them). */
  toTitleTruck(x, y) {
    const p = this.tall ? TITLE_TRUCK.tall : TITLE_TRUCK.wide;
    return [(x - p.x) / p.k + STAGE_W / 2, (y - p.y) / p.k + 170];
  }

  resize(cssW, cssH, dpr) {
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.cssPerDevice = 1 / dpr;
    this.layout(null);
  }

  /**
   * Work out how the view fits the canvas. Driving in Classic shows the original 576x448 stage,
   * letterboxed. Everything else fills the window: it never shows less than Classic's 576x448,
   * and shows more one way to match the window's shape (more sky and ground in a tall window,
   * more to each side in a wide one). Menus are drawn on a page centred in that view: the original
   * 576x448 stage, or in a view at least as tall as it is wide, the screen's tall layout (TALL_W
   * across), scaled up to fill the width. Sets game.viewW and viewH so the camera knows.
   */
  layout(game) {
    const W = this.canvas.width, H = this.canvas.height;
    const screen = game ? game.screen : 'title';
    const letterbox = !!game && game.rules.classic && FILL_SCREENS.has(screen);
    const fill = Math.min(W / STAGE_W, H / STAGE_H);
    this.scale = fill;
    if (!letterbox) {
      this.viewW = W / fill;
      this.viewH = H / fill;
      this.offX = 0; this.offY = 0;
    } else {
      this.viewW = STAGE_W;
      this.viewH = STAGE_H;
      this.offX = Math.round((W - STAGE_W * this.scale) / 2);
      this.offY = Math.round((H - STAGE_H * this.scale) / 2);
    }
    this.tall = this.viewH >= TALL_FROM && screen in TALL_H;
    this.page = this.tall ? { w: TALL_W, h: TALL_H[screen] } : { w: STAGE_W, h: STAGE_H };
    // The page is as big as fits.
    this.menuK = Math.min(this.viewW / this.page.w, this.viewH / this.page.h);
    // The camera always knows the filled view's size (Classic uses 576x448 regardless), so a
    // stage started from a menu begins with its camera in the right place.
    // (A canvas with no size, while the window is hidden or resizing, would make them NaN, and the
    // camera would never recover.)
    if (game && W > 0 && H > 0) { game.viewW = W / fill; game.viewH = H / fill; }
  }

  /** Convert a point in canvas CSS pixels to menu (page) coordinates. */
  toMenu(cssX, cssY) {
    const dx = cssX / this.cssPerDevice, dy = cssY / this.cssPerDevice;
    const x = (dx - this.offX) / this.scale, y = (dy - this.offY) / this.scale;
    const k = this.menuK, P = this.page;
    return [(x - this.viewW / 2) / k + P.w / 2, (y - this.viewH / 2) / k + P.h / 2];
  }

  /** The inverse of toMenu: a point in menu coordinates to canvas CSS pixels. */
  fromMenu(x, y) {
    const k = this.menuK, P = this.page;
    const sx = (x - P.w / 2) * k + this.viewW / 2, sy = (y - P.h / 2) * k + this.viewH / 2;
    return [(sx * this.scale + this.offX) * this.cssPerDevice, (sy * this.scale + this.offY) * this.cssPerDevice];
  }

  /** Where the button for `action` on the current screen is, in canvas CSS pixels (for tests). */
  buttonCentre(screen, action, game) {
    const b = buttonsFor(screen, this.tall).find((x) => x.action === action && (!x.show || x.show(game)));
    return b ? this.fromMenu(b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2) : null;
  }

  /** Switch to menu coordinates: the page, centred (and scaled to fit) in the view. */
  menuTransform() {
    const ctx = this.ctx, k = this.menuK, P = this.page;
    ctx.translate(this.viewW / 2, this.viewH / 2);
    ctx.scale(k, k);
    ctx.translate(-P.w / 2, -P.h / 2);
  }

  stageTransform() {
    this.ctx.setTransform(this.scale, 0, 0, this.scale, this.offX, this.offY);
  }

  // ---- drawing helpers (stage space)

  /** Draw a sprite frame the way Flash places a bitmap in a symbol: top-left at (tx, ty). */
  frame(key, i, f = this.a.sprites[key][i]) {
    const ctx = this.ctx;
    if (f.sx !== 1 || f.sy !== 1) {
      ctx.save();
      ctx.scale(f.sx, f.sy);
      ctx.drawImage(f.img, f.tx / f.sx, f.ty / f.sy);
      ctx.restore();
    } else {
      ctx.drawImage(f.img, f.tx, f.ty);
    }
  }

  text(str, x, y, { size = 13, font = TITLE_FONT, weight = '800', color = '#fff', align = 'center', shadow = null, baseline = 'top' } = {}) {
    const ctx = this.ctx;
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    if (shadow) {
      ctx.fillStyle = shadow;
      ctx.fillText(str, x + size * 0.05, y + size * 0.05);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  roundRect(x, y, w, h, rad, fill, stroke = null, lineWidth = 2) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rad);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
  }

  /** Like text(), but shrinks the font until the line is no wider than maxW. */
  fitText(str, x, y, maxW, opts = {}) {
    const ctx = this.ctx, o = { size: 13, font: TITLE_FONT, weight: '800', ...opts };
    ctx.font = `${o.weight} ${o.size}px ${o.font}`;
    const w = ctx.measureText(str).width;
    this.text(str, x, y, w > maxW ? { ...o, size: o.size * maxW / w } : o);
  }

  /**
   * A line of text centred on (cx, cy) both ways, by the ink of its letters (not the font's line
   * box, whose space above and below differs between fonts), shrunk to fit maxW.
   */
  centredLabel(str, cx, cy, maxW, { size = 13, font = TITLE_FONT, weight = '800', color = '#fff' } = {}) {
    const ctx = this.ctx;
    ctx.font = `${weight} ${size}px ${font}`;
    const w = ctx.measureText(str).width;
    if (w > maxW) { size *= maxW / w; ctx.font = `${weight} ${size}px ${font}`; }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(str);
    ctx.fillStyle = color;
    ctx.fillText(str, cx, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  }

  /** Centred text wrapped to lines no wider than maxW; returns the y below the last line. */
  wrapText(str, x, y, maxW, opts = {}, lineH = (opts.size || 13) * 1.3) {
    const ctx = this.ctx, o = { size: 13, font: TITLE_FONT, weight: '800', ...opts };
    ctx.font = `${o.weight} ${o.size}px ${o.font}`;
    // Break at the "  ·  " separators where there are any, otherwise between words.
    const parts = str.includes('  ·  ') ? str.split('  ·  ') : str.split(' ');
    const join = str.includes('  ·  ') ? '  ·  ' : ' ';
    let line = '';
    for (const p of parts) {
      const next = line ? line + join + p : p;
      if (line && ctx.measureText(next).width > maxW) { this.text(line, x, y, o); y += lineH; line = p; } else line = next;
    }
    if (line) { this.text(line, x, y, o); y += lineH; }
    return y;
  }

  image(name) { this.ctx.drawImage(this.a.images[name], 0, 0); }

  /** Copy part of an image (stage pixels) to the same place, or to a new rect. */
  piece(name, sx, sy, sw, sh, dx = sx, dy = sy, dw = sw, dh = sh) {
    this.ctx.drawImage(this.a.images[name], sx, sy, sw, sh, dx, dy, dw, dh);
  }

  /**
   * A box from the original art, stretched to (x, y, w, h) without its contents: the left and
   * right ends are copied as they are, and a plain slice just inside the left end fills the middle.
   */
  box(name, sx, sy, sw, sh, x, y, w, h, end = 8) {
    this.piece(name, sx, sy, end, sh, x, y, end, h);
    this.piece(name, sx + end - 2, sy, 2, sh, x + end, y, w - 2 * end, h);
    this.piece(name, sx + sw - end, sy, end, sh, x + w - end, y, end, h);
  }

  buttons(screen, game) {
    for (const b of buttonsFor(screen, this.tall)) {
      if (b.show && !b.show(game)) continue;
      const { x, y, w, h } = b.rect;
      const off = b.disabled?.(game);
      if (off) { this.ctx.save(); this.ctx.globalAlpha = 0.5; }
      if (b.label) {
        const label = typeof b.label === 'function' ? b.label(game, this) : b.label;
        const size = b.size || (b.small ? 10 : 11.5);
        this.roundRect(x, y, w, h, this.tall ? 6 : 4, b.small ? 'rgba(107, 74, 64, 0.7)' : BUTTON_FILL);
        this.centredLabel(label.toUpperCase(), x + w / 2, y + h / 2, w - 8, { size, weight: '800' });
      }
      if (off) this.ctx.restore();
      else if (this.hover === b) this.roundRect(x, y, w, h, this.tall ? 6 : 4, 'rgba(255,255,255,0.16)');
    }
  }

  // ---- truck (s46B2 / V5195)

  truck(T, rearRot, frontRot, look) {
    const ctx = this.ctx;
    // J5735, k6835 (darker frame), then H3535, i4635: bars from the centre to each point.
    const bars = [[6, 1], [8, 1], [2, 0], [4, 0]];
    for (const [p, fr] of bars) {
      const dx = T[p] - T[0], dy = T[p + 1] - T[1];
      ctx.save();
      ctx.translate(T[0], T[1]);
      ctx.rotate(Math.atan2(dy, dx));
      const s = Math.sqrt(dx * dx + dy * dy) / 64;
      ctx.scale(s, s);
      // _inner is placed with a = -1 at (68, -8)
      ctx.translate(68, -8);
      ctx.scale(-1, 1);
      this.frame('bar', fr);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(T[6], T[7]);
    ctx.rotate(Math.atan2(T[9] - T[7], T[8] - T[6]));
    ctx.scale(0.7, 0.7);
    this.body(look);
    ctx.restore();
    for (const [p, rot] of [[2, rearRot], [4, frontRot]]) {
      ctx.save();
      ctx.translate(T[p], T[p + 1]);
      ctx.rotate(rot * DEG);
      ctx.scale(45 / 72, 45 / 72);
      this.frame('tyre', look.tyre);
      this.frame('hub', look.hub);
      ctx.restore();
    }
  }

  /** The truck's body in its paint. */
  body(look) {
    this.frame('body', look.body, this.a.paints[look.body][look.paint]);
  }

  /** A suspension bar from point (ax, ay) to (bx, by), drawn as in truck(). */
  bar(ax, ay, bx, by, fr) {
    const ctx = this.ctx;
    const dx = bx - ax, dy = by - ay;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(dy, dx));
    const s = Math.sqrt(dx * dx + dy * dy) / 64;
    ctx.scale(s, s);
    ctx.translate(68, -8);
    ctx.scale(-1, 1);
    this.frame('bar', fr);
    ctx.restore();
  }

  /** A wrecked truck's loose pieces. W holds the (interpolated) points of game.wreck. */
  wreck(wreck, W, look) {
    const ctx = this.ctx;
    for (const b of wreck.bars) this.bar(W[b.a * 2], W[b.a * 2 + 1], W[b.b * 2], W[b.b * 2 + 1], b.frame);
    const pose = Wreck.bodyPose(W, wreck.body);
    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.ang);
    ctx.scale(0.7, 0.7);
    this.body(look);
    ctx.restore();
    for (const w of wreck.wheels) {
      ctx.save();
      ctx.translate(W[w.p * 2], W[w.p * 2 + 1]);
      ctx.rotate(w.rot * DEG);
      ctx.scale(45 / 72, 45 / 72);
      this.frame('tyre', look.tyre);
      this.frame('hub', look.hub);
      ctx.restore();
    }
  }

  // ---- world

  /** `zoom` is the dynamic camera's pull-back: the view shows `zoom` times as much of the world. */
  tiles(level, camX, camY, zoom = 1) {
    // Draw in device pixels with edges snapped to whole pixels so adjacent tiles meet exactly.
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.offX, this.offY, Math.round(this.viewW * this.scale), Math.round(this.viewH * this.scale));
    ctx.clip();
    const s = this.scale / zoom;
    const tx0 = Math.floor(camX / TILE), ty0 = Math.floor(camY / TILE);
    const edgeX = (gx) => Math.round((gx * TILE - camX) * s) + this.offX;
    const edgeY = (gy) => Math.round((gy * TILE - camY) * s) + this.offY;
    const rows = Math.ceil(this.viewH * zoom / TILE) + 1;
    const cols = Math.ceil(this.viewW * zoom / TILE) + 1;
    for (let c = 0; c < cols; c++) {
      const gx = tx0 + c;
      if (gx < 0 || gx >= level.width) continue;
      const x0 = edgeX(gx), x1 = edgeX(gx + 1);
      // The stages only have ground tiles as deep as the original 448-high view could see. A
      // taller view can look further down, so below a column's last tile, if that tile is solid
      // dirt, keep drawing dirt.
      let last = level.height - 1;
      while (last >= 0 && level.tiles[last][gx] === 0) last--;
      const fillFrom = last >= 0 && level.tiles[last][gx] === FILL_TILE ? last + 1 : Infinity;
      for (let r = 0; r < rows; r++) {
        const gy = ty0 + r;
        if (gy < 0) continue;
        const id = gy >= fillFrom ? FILL_TILE : gy < level.height ? level.tiles[gy][gx] : 0;
        if (id === 0) continue; // tile 0 is empty sky
        const y0 = edgeY(gy), y1 = edgeY(gy + 1);
        ctx.drawImage(this.a.tiles[id], x0, y0, x1 - x0, y1 - y0);
      }
    }
    ctx.restore();
    this.stageTransform();
  }

  /**
   * The backdrop, scaled up evenly to cover a taller or wider view, and centred. Scaling the photo
   * over the whole window with high-quality smoothing every frame was the heaviest thing the game
   * drew (it halved the frame rate on a big Retina screen), so it is scaled once, into a canvas
   * the size of the screen, and that is copied unscaled each frame.
   */
  backdrop() {
    const c = this.canvas, key = `${c.width}x${c.height}:${this.scale}:${this.offX},${this.offY}:${this.viewW}x${this.viewH}`;
    if (this.bgKey !== key) {
      this.bgKey = key;
      this.bgCache ||= document.createElement('canvas');
      const b = this.bgCache;
      b.width = c.width; b.height = c.height;
      const bctx = b.getContext('2d');
      bctx.imageSmoothingEnabled = true;
      bctx.imageSmoothingQuality = 'high';
      bctx.setTransform(this.scale, 0, 0, this.scale, this.offX, this.offY);
      const bg = this.a.images['bg.jpg'], k = Math.max(1, this.viewH / STAGE_H, this.viewW / STAGE_W);
      bctx.drawImage(bg, (this.viewW - STAGE_W * k) / 2, (this.viewH - STAGE_H * k) / 2, STAGE_W * k, STAGE_H * k);
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bgCache, 0, 0);
    ctx.restore();
  }

  world(game, v) {
    const ctx = this.ctx;
    this.backdrop();
    const zoom = game.rules.classic ? 1 : v.zoom || 1;
    this.tiles(game.levelData, v.camX, v.camY, zoom);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.viewW, this.viewH);
    ctx.clip();
    ctx.scale(1 / zoom, 1 / zoom);
    ctx.translate(-v.camX, -v.camY);
    for (const d of game.dirt) {
      if (d.life === 0) continue;
      const f = this.a.sprites.dirt[d.frame];
      ctx.globalAlpha = d.alpha;
      ctx.drawImage(f.img, d.x + f.tx * d.scale, d.y + f.ty * d.scale, f.img.width * d.scale, f.img.height * d.scale);
    }
    ctx.globalAlpha = 1;
    if (v.G) {
      // Time Trial's ghost: your best run, see-through, its wheels turning as it goes.
      const rot = v.G[2] / game.truck.wheelRadius * 180 / Math.PI;
      ctx.save();
      ctx.globalAlpha = 0.38;
      this.truck(v.G, rot, rot, game.look);
      ctx.restore();
    }
    if (game.battle) battleBack(this, game, v);
    if (game.wreck && v.W) this.wreck(game.wreck, v.W, game.look);
    else this.truck(v.T, v.rr, v.fr, game.look);
    if (game.battle) battleFront(this, game, v);
    ctx.restore();
    if (!game.rules.classic && !game.wreck) this.flipCount(game, v, zoom);
    this.hud(game);
  }

  /** A flip's turns counted out in the air (+1, +2...), popping up over the truck. */
  flipCount(game, v, zoom) {
    const pop = game.tricks.flipPop;
    if (!pop || game.screen !== 'playing') return;
    const ctx = this.ctx, T = v.T;
    const x = (T[0] + T[2] + T[4] + T[6] + T[8]) / 5, y = (T[1] + T[3] + T[5] + T[7] + T[9]) / 5;
    const age = TRICK.popFor - pop.timer;
    const sx = (x - v.camX) / zoom, sy = (y - v.camY) / zoom - 62 / zoom - age * 0.5;
    const k = 1 + 0.6 * Math.max(0, 1 - age / 8) ** 2;
    ctx.save();
    ctx.globalAlpha = Math.min(1, pop.timer / 15);
    ctx.translate(sx, sy);
    ctx.scale(k, k);
    this.text(`+${pop.turns}`, 0, -12, { size: 24, font: HUD_FONT, weight: '900' });
    ctx.restore();
  }

  /** Endless milestones: the news in big gold letters, popping in, with a burst of confetti. */
  milestone(game) {
    const m = game.milestone, ctx = this.ctx;
    const now = performance.now(), dt = Math.min(0.05, (now - (this.lastDraw || now)) / 1000);
    this.lastDraw = now;
    if (this.confettiRun !== game.teleportCount) { this.confettiRun = game.teleportCount; this.confetti = []; } // a new run
    if (m && m.n !== this.confettiFor && game.screen === 'playing') {
      this.confettiFor = m.n;
      const colors = BODY_PAINTS; // the trucks' own paints
      // (Battle's waves come in without confetti)
      for (let i = 0; i < (m.confetti === false ? 0 : 70); i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, sp = 120 + Math.random() * 260;
        this.confetti.push({ x: this.viewW / 2 + (Math.random() - 0.5) * 60, y: 168, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          rot: Math.random() * 6, spin: (Math.random() - 0.5) * 14, color: colors[i % colors.length], life: 1.6 + Math.random() * 0.8 });
      }
    }
    if (this.confetti.length && game.screen === 'playing') {
      for (const c of this.confetti) { c.vy += 420 * dt; c.vx *= 1 - 1.2 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.spin * dt; c.life -= dt; }
      this.confetti = this.confetti.filter((c) => c.life > 0 && c.y < this.viewH + 20);
    }
    for (const c of this.confetti) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, c.life * 2);
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.color;
      ctx.fillRect(-3.5, -2, 7, 4);
      ctx.restore();
    }
    if (!m || game.screen !== 'playing') return;
    const age = MILESTONE_SHOW - m.timer;
    const k = 1 + 0.5 * Math.max(0, 1 - age / 10) ** 2;
    ctx.save();
    ctx.globalAlpha = Math.min(1, m.timer / 25, age / 4 + 0.2);
    ctx.translate(this.viewW / 2, 160);
    ctx.scale(k, k);
    this.text(m.text, 0, -16, { size: 30, font: HUD_FONT, weight: '900', color: MILESTONE_GOLD });
    ctx.restore();
  }

  /** A HUD meter in the original damage bar's style: a label, a bar filled to `share`, and optionally a reading just right of the bar. */
  meter(name, share, y, reading = '') {
    const ctx = this.ctx;
    // The label's left edge lines up with the bar's.
    // Placed by their baselines, not the tops of their lines: where a line's top is above the
    // letters differs between fonts (on iPhones the label dropped onto the bar).
    const label = { size: 15, font: HUD_FONT, weight: '800', align: 'left', baseline: 'alphabetic' };
    ctx.font = `${label.weight} ${label.size}px ${label.font}`;
    ctx.textAlign = 'left'; // the measurement below depends on it
    this.text(name, 13.1 + ctx.measureText(name).actualBoundingBoxLeft, y + 13, label);
    if (reading) this.text(reading, 99.5, y + 27.5, { size: 12.85, font: HUD_FONT, weight: '800', align: 'left', baseline: 'alphabetic', color: 'rgba(255,255,255,0.9)' });
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(13.1, y + 17.5, 80, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(13.1, y + 17.5, 80 * Math.max(0, Math.min(1, share)), 10);
    // the end bars either side, as the original's damage bar had
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(13.1 - 3.2, y + 17.5, 1.7, 10);
    ctx.fillRect(13.1 + 80 + 1.5, y + 17.5, 1.7, 10);
  }

  hud(game) { // Symbol 305 / X3323
    // The right-hand readouts keep to the view's right edge, however wide it is.
    const R = this.viewW - 10;
    let y = 7.5;
    if (game.rules.damage) { this.meter('damage', game.damage / 1000, y); y += 34; }
    // Outside Classic: the speedometer, in km/h (the bar is full at SPEEDO_MAX).
    if (!game.rules.classic) this.meter('speed', game.speedKmh / SPEEDO_MAX, y, `${Math.round(game.speedKmh)} km/h`);
    if (game.battle?.opts.weapons) battleHud(this, game, y + 34);
    const hud = { size: 12.85, font: HUD_FONT, weight: '800', align: 'right' };
    if (game.mode === 'trial') { this.trialHud(game, R, hud); return; }
    if (game.mode === 'rally') { rallyHud(this, game); this.trickNames(game); return; }
    this.text('score', R + 0.5, 9, { size: 12.5, font: HUD_FONT, weight: '800', align: 'right' });
    this.text(String(game.score), R, 22, hud);
    if (game.onCourse) this.text(`${game.metres} m`, R, 34, { ...hud, color: 'rgba(255,255,255,0.9)' });
    else if (game.mode !== 'sandbox') this.text(`+${game.bonus}`, R, 34, { ...hud, color: 'rgba(255,255,255,0.9)' });
    const chain = game.tricks.chain;
    if (game.rules.classic) {
      if (game.flipBonusTimer > 0) this.text(`+${game.flipBonus}`, R, 46, { ...hud, color: 'rgba(255,255,255,0.9)' });
    } else if (chain.length && game.screen !== 'gameOver') {
      const m = game.tricks.multiplier;
      this.text(`+${game.tricks.chainPoints}${m > 1 ? `  x${m}` : ''}`, R, 46, { ...hud, color: 'rgba(255,255,255,0.6)' });
    } else if (game.flipBonusTimer > 0) this.text(`+${game.flipBonus}`, R, 46, { ...hud, color: 'rgba(255,255,255,0.9)' });
    if (!game.rules.classic) this.trickNames(game);
    if (game.onCourse) this.milestone(game);
    if (game.tickerTimer > 0 && game.screen !== 'gameOver') {
      this.text(game.ticker, this.viewW / 2, 82, { size: 15, font: HUD_FONT, weight: '800' });
    }
  }

  /** Time Trial's HUD at the top right: the race clock, the gap to the ghost, and the best time. */
  trialHud(game, R, hud) {
    this.text('time', R + 0.5, 9, { ...hud, size: 12.5 });
    this.text(formatTime(game.clock), R, 22, { ...hud, size: 20 });
    if (game.split !== null && game.ghost && game.screen === 'playing') {
      this.text(formatGap(game.split), R, 45, { ...hud, size: 14, color: game.split <= 0 ? AHEAD : BEHIND });
    }
    const best = game.trialBests[game.track];
    if (best) this.text(`best ${formatTime(best)}`, R, 62, { ...hud, size: 11, color: 'rgba(255,255,255,0.85)' });
    this.trickNames(game);
    if (game.tickerTimer > 0 && game.screen !== 'gameOver') this.text(game.ticker, this.viewW / 2, 82, { size: 15, font: HUD_FONT, weight: '800' });
  }

  /** The name of the trick just done, popping in under the ticker and fading out. */
  trickNames(game) {
    const show = game.tricks.show, bail = game.tricks.bail;
    if (game.screen === 'gameOver') return;
    const ctx = this.ctx;
    if (bail) {
      // A bail ends the chain: a muted note under the trick names, not another trick.
      const age = TRICK.showFor - bail.timer;
      ctx.save();
      ctx.globalAlpha = 0.75 * Math.min(1, bail.timer / 20, age / 6);
      this.text('bail', this.viewW / 2, 126, { size: 14, font: HUD_FONT, weight: 'italic 700', color: '#e4e4e4' });
      ctx.restore();
    }
    if (!show) return;
    const age = TRICK.showFor - show.timer;
    const pop = 1 + 0.3 * Math.max(0, 1 - age / 7) ** 2;
    ctx.save();
    ctx.globalAlpha = Math.min(1, show.timer / 20, age / 3 + 0.3);
    ctx.translate(this.viewW / 2, 112);
    ctx.scale(pop, pop);
    this.text(show.names.join('  +  '), 0, -9, { size: 17, font: HUD_FONT, weight: '800' });
    ctx.restore();
  }

  // ---- screens
  //
  // Menu screens draw in page coordinates (see layout): the 576x448 stage, or in the tall layout
  // a page TALL_W across. `this.tall` says which. The menu screens were bitmaps with their text
  // baked in; they are now drawn from the plain backdrop plus the original art's keycaps and
  // boxes, with the words as live text.

  /** The garage truck, with its resting point (288, 170) moved to (x, y) and scaled by k. */
  showTruck(game, v, x, y, k = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.translate(-STAGE_W / 2, -170);
    this.truck(v.gT, v.grr, v.gfr, game.look);
    ctx.restore();
  }

  /** The title screen. Its truck is drawn last, so knocked up high it goes in front of the words. */
  title(game, v) {
    const shadow = TITLE_SHADOW;
    const version = `v${VERSION}${BUILD === 'dev' ? '' : `  ·  ${BUILD}`}`;
    const small = { size: 12, weight: '700', color: 'rgba(255,255,255,0.8)', align: 'right', shadow: 'rgba(38,38,38,0.5)' };
    const P = this.tall ? TITLE_TRUCK.tall : TITLE_TRUCK.wide;
    const big = { weight: '900', color: '#f5f5f5', shadow };
    // Redux!, tilted, in the paint of the truck you've chosen
    const redux = (x, y, size) => {
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-14 * Math.PI / 180);
      this.text('Redux!', 0, 0, { size, weight: '900', color: BODY_PAINTS[(game.look?.paint ?? 0) * 2] || BODY_PAINTS[0], shadow });
      ctx.restore();
    };
    if (this.tall) {
      const cx = TALL_W / 2;
      this.fitText('funky truck', cx, 40, 340, { size: 54, ...big });
      this.text('ARIZONA', 336, 98, { size: 34, ...big, align: 'right' });
      redux(306, 140, 26);
      this.buttons('title', game);
      this.soundIcon(SOUND_BUTTON.tall, game.soundOn);
      this.text(version, TALL_W - 8, 656, { ...small, size: 14 });
    } else {
      this.text('funky truck', STAGE_W / 2, 18, { size: 62, ...big });
      this.text('ARIZONA', 486, 88, { size: 38, ...big, align: 'right' });
      redux(476, 130, 28);
      this.buttons('title', game);
      this.soundIcon(SOUND_BUTTON.wide, game.soundOn);
      this.text(version, STAGE_W - 8, 430, small);
    }
    this.showTruck(game, v, P.x, P.y, P.k);
  }

  /** A speaker in the box `rect`: with sound waves when the sound is on, crossed out when it's off. */
  soundIcon(rect, on) {
    const ctx = this.ctx, k = rect.h / 26, x = rect.x + rect.w / 2 - 11 * k, y = rect.y + rect.h / 2;
    for (const [dx, colour] of [[1.5 * k, TITLE_SHADOW], [0, '#f5f5f5']]) {
      ctx.save();
      ctx.translate(x + dx, y + dx);
      ctx.scale(k, k);
      ctx.fillStyle = colour; ctx.strokeStyle = colour;
      ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -4); ctx.lineTo(5, -4); ctx.lineTo(11, -9.5); ctx.lineTo(11, 9.5); ctx.lineTo(5, 4); ctx.lineTo(0, 4);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      if (on) {
        ctx.arc(12, 0, 5, -Math.PI / 3.2, Math.PI / 3.2);
        ctx.moveTo(12 + 9.5 * Math.cos(Math.PI / 3), -9.5 * Math.sin(Math.PI / 3));
        ctx.arc(12, 0, 9.5, -Math.PI / 3, Math.PI / 3);
      } else {
        ctx.moveTo(15, -5); ctx.lineTo(23, 5);
        ctx.moveTo(23, -5); ctx.lineTo(15, 5);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  /** The mode picker: the title screen, dimmed, with a box of the modes over it. */
  modes(game, v) {
    this.title(game, v);
    this.overlayDim(0.5);
    const tall = this.tall, cx = (tall ? TALL_W : STAGE_W) / 2;
    const about = { weight: '600', color: 'rgba(255,255,255,0.85)' };
    if (tall) {
      const b = modesBack(true);
      this.roundRect(16, 36, TALL_W - 32, b.y + b.h + 16 - 36, 12, BOX_FILL, BOX_EDGE);
      this.text('Choose a Mode', cx, 50, { size: 26, weight: '900' });
    } else {
      const b = modesBack(false);
      this.roundRect(96, 60, 384, b.y + b.h + 12 - 60, 10, BOX_FILL, BOX_EDGE);
      this.text('Choose a Mode', cx, 70, { size: 20, weight: '900' });
    }
    MODES.forEach(([, , text], i) => {
      const b = modeRow(i, tall);
      if (tall) this.fitText(text, cx, b.y + b.h + 7, 290, { ...about, size: 13 });
      else this.fitText(text, b.x + b.w + 12, b.y + b.h / 2 - 6.5, 220, { ...about, size: 11.5, align: 'left' });
    });
    this.buttons('modes', game);
  }

  /** High Scores and stats: two columns on the usual page, one on the tall page. */
  stats(game) {
    const tall = this.tall, cx = (tall ? TALL_W : STAGE_W) / 2;
    const cols = statsColumns(game);
    const head = { weight: '800', align: 'left', color: MILESTONE_GOLD, shadow: 'rgba(38,38,38,0.5)' };
    const label = { weight: '600', align: 'left', color: 'rgba(255,255,255,0.9)' };
    const value = { weight: '800', align: 'right' };
    const column = (rows, x0, x1, y, rowH, size) => {
      for (const [name, val] of rows) {
        if (val === undefined) { if (y > 70) y += rowH * 0.35; this.text(name, x0, y, { ...head, size: size + 1.5 }); y += rowH * 1.1; continue; }
        this.text(name, x0, y, { ...label, size });
        this.text(val, x1, y, { ...value, size });
        y += rowH;
      }
      return y;
    };
    if (tall) {
      this.text('High Scores', cx, 18, { size: 26, weight: '900' });
      const y = column(cols[0], 30, 330, 62, 21, 14);
      column(cols[1], 30, 330, y, 21, 14);
    } else {
      this.text('High Scores', cx, 12, { size: 22, weight: '900' });
      column(cols[0], 34, 262, 50, 19.5, 12.5);
      column(cols[1], 314, 542, 50, 19.5, 12.5);
    }
    if (game.resetConfirm) {
      // Are you sure? (Yes waits five seconds.)
      this.overlayDim(0.45);
      const note = { weight: '600', color: 'rgba(255,255,255,0.9)' };
      if (tall) {
        this.roundRect(30, 250, 300, 220, 12, BOX_FILL, BOX_EDGE);
        this.text('Are you sure?', cx, 272, { size: 26, weight: '900' });
        this.wrapText('This clears every best score, best time, ghost and stat. It can\'t be undone.', cx, 316, 260, { ...note, size: 14 }, 19);
      } else {
        this.roundRect(148, 140, 280, 160, 10, BOX_FILL, BOX_EDGE);
        this.text('Are you sure?', cx, 154, { size: 22, weight: '900' });
        this.wrapText('This clears every best score, best time, ghost and stat. It can\'t be undone.', cx, 192, 250, { ...note, size: 12 }, 16);
      }
    }
    this.buttons('stats', game);
  }

  /** How to Play: only the control scheme that's chosen (the arrow keys, or One Button). */
  help(game) {
    const tricks = 'Chain tricks together for a multiplier.';
    if (game.oneButton) {
      const hold = this.touchMode ? 'Hold anywhere on the screen' : 'Hold Space or the up arrow';
      const lines = [`${hold} to drive, and to tilt back in the air.`, 'Your truck is four-wheel drive.', tricks];
      const tall = this.tall, cx = (tall ? TALL_W : STAGE_W) / 2, w = tall ? 320 : 480;
      this.text('One Button', cx, tall ? 40 : 40, { size: tall ? 28 : 24, weight: '900' });
      let y = this.wrapText('Press P to Pause', cx, tall ? 100 : 92, w, { size: 16, weight: '600' }) + 22;
      for (const line of lines) y = this.wrapText(line, cx, y, w, { size: tall ? 16 : 15, weight: '600' }, tall ? 21 : 19) + 14;
      this.buttons('help', game);
      return;
    }
    const keys = ['Forwards', 'Reverse', 'Tilt Back', 'Tilt Forwards'];
    const lines = ['Your truck is four-wheel drive.',
      'To climb steep hills, tilt forwards so that your front wheel stays on the ground.',
      tricks];
    if (this.tall) {
      const k = 1.25, x0 = 72, y0 = 36;
      this.piece('screen_help.png', 205, 45, 62, 145, x0, y0, 62 * k, 145 * k); // the four arrow keycaps
      keys.forEach((name, i) => this.text(name, x0 + 64 * k + 6, y0 + (20 + i * 29.7) * k, { size: 17, weight: '600', align: 'left' }));
      let y = this.wrapText('Press P to Pause', TALL_W / 2, 250, 320, { size: 16, weight: '600' });
      y += 18;
      for (const line of lines) y = this.wrapText(line, TALL_W / 2, y, 320, { size: 16, weight: '600' }, 21) + 14;
      this.buttons('help', game);
      return;
    }
    this.piece('screen_help.png', 205, 45, 62, 145); // the four arrow keycaps
    keys.forEach((name, i) => this.text(name, 269, 65 + i * 29.7, { size: 14, weight: '600', align: 'left' }));
    const line = { size: 14, weight: '600' };
    this.text('Press P to Pause', STAGE_W / 2, 202, line);
    let y = 250;
    for (const l of lines) y = this.wrapText(l, STAGE_W / 2, y, 540, { ...line, size: 13.5 }, 17) + 10;
    this.buttons('help', game);
  }

  garage(game, v) {
    const names = ['Body', 'Paint', 'Tyres', 'Wheels'];
    if (this.tall) {
      this.box('screen_garage.png', 10, 10, 556, 25, 10, 10, TALL_W - 20, 32, 12); // title bar
      this.text('Your Truck', TALL_W / 2, 17, { size: 17, weight: '700' });
      this.showTruck(game, v, TALL_W / 2, 200, 1.45);
      names.forEach((name, i) => {
        const y = 268 + 56 * i;
        // The arrow buttons, from the original art's first row (it only had three rows).
        this.piece('screen_garage.png', 200, 226, 32, 32, 30, y, 48, 48);
        this.piece('screen_garage.png', 344, 226, 32, 32, 282, y, 48, 48);
        this.text(name, TALL_W / 2, y + 14, { size: 19, weight: '700' });
      });
      this.text(COSMETIC, TALL_W / 2, 498, { size: 13, weight: '600', color: 'rgba(255,255,255,0.78)' });
      this.buttons('garage', game);
      return;
    }
    this.box('screen_garage.png', 10, 10, 556, 25, 10, 10, 556, 25, 12); // title bar
    this.text('Your Truck', STAGE_W / 2, 15.5, { size: 14, weight: '700' });
    this.showTruck(game, v, STAGE_W / 2, 170);
    names.forEach((name, i) => {
      const y = 226 + i * 34;
      // The arrow buttons, from the original art's first row (it only had three rows).
      this.piece('screen_garage.png', 200, 226, 32, 32, 200, y);
      this.piece('screen_garage.png', 344, 226, 32, 32, 344, y);
      this.text(name, STAGE_W / 2, y + 8, { size: 14, weight: '700' });
    });
    this.text(COSMETIC, STAGE_W / 2, 378, { size: 12, weight: '600', color: 'rgba(255,255,255,0.78)' });
    this.buttons('garage', game);
  }

  practiceSelect(game) {
    if (this.tall) {
      this.text('Choose a Stage', TALL_W / 2, 38, { size: 19, weight: '700' });
      for (let i = 0; i < 9; i++) {
        const { x, y } = tallStage(i);
        this.box('screen_practice.png', 136, 228, 32, 32, x, y, 72, 72, 10);
        this.text(String(i + 1), x + 36, y + 22, { size: 28, weight: '700' });
      }
      if (game.stunts.length) this.text('Stunt Tracks', TALL_W / 2, 318, { size: 17, weight: '700' });
      this.buttons('practiceSelect', game);
      return;
    }
    this.text('Choose a Stage', STAGE_W / 2, 164, { size: 14, weight: '700' });
    for (let i = 0; i < 9; i++) {
      const x = 136 + 34 * i;
      this.box('screen_practice.png', 136, 228, 32, 32, x, 228, 32, 32);
      this.text(String(i + 1), x + 16, 234.5, { size: 17, weight: '700' });
    }
    if (game.stunts.length) this.text('Stunt Tracks', 288, 272, { size: 13, weight: '700' });
    this.buttons('practiceSelect', game);
  }

  /** The Options screen: each option as a button, with a line on what it does. */
  options(game, screen = 'options') {
    const tall = this.tall, cx = (tall ? TALL_W : STAGE_W) / 2;
    this.text('Options', cx, tall ? 28 : 18, { size: tall ? 26 : 22, weight: '800', shadow: screen === 'options' ? null : 'rgba(38,38,38,0.7)' });
    for (const b of buttonsFor(screen, tall)) {
      const about = optionAbout(b.action);
      if (!about || (b.show && !b.show(game))) continue;
      const { y, h } = b.rect;
      this.fitText(about(game, this), cx, y + h + (tall ? 8 : 5), tall ? 330 : 400, { size: tall ? 13 : 11, weight: '600', color: 'rgba(255,255,255,0.85)' });
    }
    this.buttons(screen, game);
  }

  /** The pause menu's Options, over the dimmed game. */
  pauseOptions(game) {
    this.overlayDim(0.55);
    this.options(game, 'pauseOptions');
  }

  /** Time Trial's stage list: a card per stage with its best time, then all nine in a row. */
  trialSelect(game) {
    const tall = this.tall, cx = (tall ? TALL_W : STAGE_W) / 2;
    const best = (t) => (game.trialBests[t] ? formatTime(game.trialBests[t]) : '—');
    const card = (x, y, w, h, big, small, bigSize, smallSize) => {
      this.roundRect(x, y, w, h, tall ? 8 : 6, BUTTON_FILL);
      this.text(big, x + w / 2, y + h * 0.16, { size: bigSize, weight: '800' });
      this.text(small, x + w / 2, y + h * 0.62, { size: smallSize, weight: '700', color: small === '—' ? 'rgba(255,255,255,0.6)' : '#fff' });
    };
    if (tall) {
      this.text('Time Trial', cx, 18, { size: 22, weight: '800' });
      this.text('Race the clock, and your best run\'s ghost', cx, 48, { size: 13, weight: '600', color: 'rgba(255,255,255,0.8)' });
      for (let i = 0; i < 9; i++) { const { x, y } = tallTrialCard(i); card(x, y, 100, 80, String(i + 1), best(i), 26, 14); }
      card(20, 360, 320, 52, 'All Nine', best(TRIAL_ALL), 17, 14);
    } else {
      this.text('Time Trial', 258, 16, { size: 20, weight: '800' });
      this.text('Race the clock, and your best run\'s ghost', 258, 42, { size: 12, weight: '600', color: 'rgba(255,255,255,0.8)' });
      for (let i = 0; i < 9; i++) { const { x, y } = trialCard(i); card(x, y, 92, 58, String(i + 1), best(i), 19, 12); }
      card(112, 274, 292, 40, 'All Nine', best(TRIAL_ALL), 14, 11);
    }
    this.buttons('trialSelect', game);
  }

  /** Sandbox's settings: before a run (with the track and Go!), or during one (Tweaks). */
  sandboxScreen(game, screen) {
    const tall = this.tall, cx = (tall ? TALL_W : STAGE_W) / 2, tweaks = screen === 'sandboxTweaks';
    const shadow = tweaks ? 'rgba(38,38,38,0.7)' : null;
    this.text(tweaks ? 'Tweaks' : 'Sandbox', cx, tall ? 16 : 12, { size: tall ? 26 : 22, weight: '900', shadow });
    const sub = tweaks ? 'Changes take effect at once' : 'Set things up, then go wild. Tweaks in the pause menu changes them as you play.';
    this.fitText(sub, cx, tall ? 48 : 42, tall ? 330 : 540, { size: tall ? 13 : 11.5, weight: '600', color: 'rgba(255,255,255,0.85)', shadow });
    sandboxRows(tweaks).forEach((row, i) => {
      const R = sbRow(i, tall);
      const label = { size: tall ? 15 : 12, weight: '700', align: 'left', baseline: 'middle', shadow };
      this.fitText(row.name, R.x, R.y + R.h / 2 + 1, R.lw - 8, label);
      const vx = R.x + R.lw + R.bw + 3, vw = R.w - R.lw - 2 * R.bw - 6;
      this.roundRect(vx, R.y, vw, R.h, 4, 'rgba(0,0,0,0.22)');
      const v = row.key === 'track' ? game.stageName(game.sandbox.track) : row.choices[game.sandbox[row.key]][1];
      const changed = row.key !== 'track' && game.sandbox[row.key] !== row.dflt;
      this.centredLabel(v, vx + vw / 2, R.y + R.h / 2, vw - 6, { size: tall ? 15 : 12, weight: '800', color: changed ? MILESTONE_GOLD : '#fff' });
    });
    this.buttons(screen, game);
  }

  overlayDim(alpha) {
    this.ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    this.ctx.save();
    this.stageTransform();
    this.ctx.fillRect(0, 0, this.viewW, this.viewH);
    this.ctx.restore();
  }

  gameOver(game) {
    this.overlayDim(0.45);
    let title = game.wrecked ? 'Truck Wrecked' : (game.finished && game.mode === 'campaign' ? 'Well Driven!' : 'Game Over');
    if (game.mode === 'endless') title = 'Nice Run!';
    else if (game.mode === 'battle') title = 'Battle Over';
    else if (game.mode === 'rally') title = rallyTitle(game.race);
    else if (game.mode === 'practice' && !game.wrecked) title = 'Practice Complete';
    let lines = game.mode === 'endless'
      ? [`${game.metres} m  ·  ${game.lastScore}`, `Best: ${game.bestEndless} m`]
      : game.mode === 'battle' ? [`Score: ${game.lastScore}  ·  ${game.metres} m`, `Best: ${game.bestBattle}`]
      : game.mode === 'rally' ? rallyLines(game)
      : [`Score: ${game.lastScore}`, game.rules.damage ? `Best: ${game.bestForRules}` : ''];
    let gapColor = null;
    if (game.mode === 'trial') {
      const r = game.trialResult, best = game.trialBests[game.track];
      if (!r) lines = ['Did not finish', best ? `Best: ${formatTime(best)}` : ''];
      else {
        title = r.record ? 'New Record!' : 'Finished';
        const gap = r.best === null ? 'Your first time on the board'
          : r.time < r.best ? `${formatGap(r.best - r.time).slice(1)} s faster than your best`
            : r.time === r.best ? 'Equals your best' : `${formatGap(r.time - r.best).slice(1)} s behind your best`;
        gapColor = r.best === null || r.time === r.best ? null : r.time < r.best ? AHEAD : BEHIND;
        lines = [`Time: ${formatTime(r.time)}`, gap];
      }
    }
    const where = reachedLine(game);
    const whereStyle = { weight: '700', color: 'rgba(255,255,255,0.85)' };
    const hint = this.touchMode ? '' : 'or press Space / Ctrl';
    const hintStyle = { size: 11, weight: '600', color: 'rgba(255,255,255,0.78)' };
    if (this.tall) {
      const cx = TALL_W / 2;
      this.roundRect(20, 10, TALL_W - 40, 310, 12, BOX_FILL, BOX_EDGE);
      this.fitText(title, cx, 28, 290, { size: 36, weight: '900' });
      if (where) this.fitText(where, cx, 80, 290, { ...whereStyle, size: 17 });
      lines.forEach((l, i) => l && this.fitText(l, cx, 112 + 30 * i, 290, { size: i && gapColor ? 17 : 20, weight: '600', color: i && gapColor ? gapColor : '#fff' }));
      this.buttons('gameOver', game);
      if (hint) this.text(hint, cx, 298, { ...hintStyle, size: 12 });
      return;
    }
    this.roundRect(158, 112, 260, 232, 10, BOX_FILL, BOX_EDGE);
    this.text(title, STAGE_W / 2, 124, { size: 30, weight: '900' });
    if (where) this.fitText(where, STAGE_W / 2, 164, 240, { ...whereStyle, size: 14 });
    lines.forEach((l, i) => l && this.fitText(l, STAGE_W / 2, 188 + 24 * i, 240, { size: i && gapColor ? 14 : 17, weight: '600', color: i && gapColor ? gapColor : '#fff' }));
    this.buttons('gameOver', game);
    if (hint) this.text(hint, STAGE_W / 2, 316, hintStyle);
  }

  paused(game) {
    this.overlayDim(0.3);
    const name = { weight: '700', color: 'rgba(255,255,255,0.9)', shadow: 'rgba(38,38,38,0.7)' };
    const big = { weight: '900', shadow: 'rgba(38,38,38,0.85)' };
    const hint = this.touchMode ? '' : 'Press P to resume play';
    if (this.tall) {
      const cx = TALL_W / 2;
      this.fitText(runName(game), cx, 24, 340, { ...name, size: 18 });
      this.text('Paused', cx, 52, { ...big, size: 46 });
      if (hint) this.text(hint, cx, 118, { size: 15, weight: '600' });
      this.buttons('paused', game);
      return;
    }
    this.text(runName(game), STAGE_W / 2, 132, { ...name, size: 15 });
    this.text('Paused', STAGE_W / 2, 158, { ...big, size: 36 });
    if (hint) this.text(hint, STAGE_W / 2, 210, { size: 14, weight: '600' });
    this.buttons('paused', game);
  }

  /** Draw a full frame. `v` holds interpolated positions. */
  draw(game, v) {
    const ctx = this.ctx;
    this.layout(game);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // The menus' backdrop (a plain gradient) fills the whole window, with the page on top.
    if (MENU_SCREENS.has(game.screen)) ctx.drawImage(this.a.images['screen_plain.png'], 0, 0, this.canvas.width, this.canvas.height);
    this.stageTransform();
    ctx.save();
    // Always restore, so a mistake in one screen's drawing can't leave the canvas's state (its
    // text alignment, transform, clip) wrong for every frame after.
    try {
      ctx.beginPath();
      ctx.rect(0, 0, this.viewW, this.viewH);
      ctx.clip();
      if (!MENU_SCREENS.has(game.screen)) this.world(game, v);
      if (game.screen !== 'playing') this.menuTransform();
      switch (game.screen) {
        case 'title': this.title(game, v); break;
        case 'modes': this.modes(game, v); break;
        case 'stats': this.stats(game); break;
        case 'help': this.help(game); break;
        case 'options': this.options(game); break;
        case 'garage': this.garage(game, v); break;
        case 'practiceSelect': this.practiceSelect(game); break;
        case 'trialSelect': this.trialSelect(game); break;
        case 'sandbox': this.sandboxScreen(game, 'sandbox'); break;
        case 'sandboxTweaks': this.overlayDim(0.55); this.sandboxScreen(game, 'sandboxTweaks'); break;
        case 'paused': this.paused(game); break;
        case 'pauseOptions': this.pauseOptions(game); break;
        case 'gameOver': this.gameOver(game); break;
      }
    } finally {
      ctx.restore();
    }
  }
}
