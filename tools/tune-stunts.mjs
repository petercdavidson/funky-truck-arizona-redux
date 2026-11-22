// tune-stunts.mjs — tries Mega Ramp designs in the game's own physics and reports the best.
//
//   node tools/tune-stunts.mjs
//
// A simulated driver holds the gas the whole way, keeps the truck's nose down on the ground and
// level in the air, and each design is scored on top speed and on the big jump: time in the air
// and height above the lip. Then copy the winner into MEGA in tools/make-stunts.mjs.

import { Game, TILE, KMH_PER_PX_STEP, STEP_HZ } from '../src/game.js';
import { data, megaRamp, MEGA } from './make-stunts.mjs';

/** Drive a design; returns its numbers. */
export function trial(m) {
  const level = megaRamp(m);
  const g = new Game({ ...data, stunts: [level] });
  g.practiceDamage = true;
  g.startPractice(9);
  const t = g.truck, lipX = level.lipCol * TILE;
  let landCol = 0, top = 0, air = 0, flight = 0, peak = Infinity, lipY = null, launchKmh = 0, landed = false, steps = 0;
  for (; steps < 6000 && g.screen === 'playing' && !g.wreck; steps++) {
    const airborne = g.airSteps > 3;
    g.keys.up = true;
    if (airborne) { g.keys.left = t.bodyRot > 8; g.keys.right = t.bodyRot < -8; } else { g.keys.right = t.bodyRot < -15; g.keys.left = t.bodyRot > 35; }
    g.step();
    if (lipY === null) top = Math.max(top, g.speedKmh); // top speed on the way to the lip
    if (lipY === null && t.T[0] >= lipX) { lipY = t.T[1]; launchKmh = g.speedKmh; }
    if (lipY !== null && !landed) {
      if (g.airSteps > 0) { air = g.airSteps; peak = Math.min(peak, t.T[1]); } else if (air > 20) { flight = air; landed = true; landCol = Math.round(t.T[0] / TILE); }
    }
    if (landed && steps > 0 && Math.hypot(t.T[0] - t.P[0], t.T[1] - t.P[1]) < 0.5) break;
  }
  return {
    topKmh: Math.round(top), launchKmh: Math.round(launchKmh), airS: +(flight / STEP_HZ).toFixed(2),
    heightM: lipY === null ? 0 : Math.round((lipY - peak) / TILE * 2.5), wrecked: !!g.wreck || g.damage >= 1000, damage: g.damage, lip: level.lipCol, landCol, width: level.width,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = [];
  const only = process.argv[2] ? JSON.parse(process.argv[2]) : null;
  for (const drop of only?.drop ?? [100, 140, 180]) {
    for (const bottom of only?.bottom ?? [0, 4]) {
      for (const [rise, riseLen] of only?.rises ?? [[10, 7], [14, 9], [18, 12], [24, 16]]) {
        const m = { ...MEGA, drop, bottom, rise, riseLen, run: only?.run ?? 700 };
        const r = trial(m);
        results.push({ drop, bottom, rise, riseLen, ...r });
      }
    }
  }
  results.sort((a, b) => (b.airS - a.airS) || (b.topKmh - a.topKmh));
  console.table(results.slice(0, 15));
  console.log('fastest:', results.reduce((a, b) => (b.topKmh > a.topKmh ? b : a)));
}
void KMH_PER_PX_STEP;
