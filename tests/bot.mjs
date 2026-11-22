// bot.mjs — a simulated driver for checking that courses can be driven (not a test file itself).
//
// A persistent driver: full gas, leaning to keep the nose down on climbs; when it stalls, it backs
// up for a run-up (a different distance each try) and goes again. It finishes Stages 1-4 and 6,
// so it plays like a decent player; it's how Endless's climb limit and the stunt tracks were
// checked. Usage: drive(game, { steps, progress: (g) => number, tries, stopAt: metres }).
// Returns { stuck: true, i } if it gave up.

export function drive(g, { steps = 20000, progress = (g) => g.truck.T[0], tries = 7, stopAt = Infinity } = {}) {
  let best = progress(g), since = 0, attempt = 0, phase = 'go', phaseLeft = 0;
  for (let i = 0; i < steps && g.screen === 'playing'; i++) {
    const t = g.truck;
    if (phase === 'back') {
      g.keys.up = false; g.keys.down = true;
      g.keys.left = t.bodyRot < -25; g.keys.right = t.bodyRot > 25;
      if (--phaseLeft <= 0) { phase = 'go'; since = 0; }
    } else {
      g.keys.down = false; g.keys.up = true;
      g.keys.right = t.bodyRot < -15; g.keys.left = t.bodyRot > 35;
    }
    g.step();
    if (g.canUpright) g.upright();
    if (g.metres >= stopAt) return { stuck: false };
    const p = progress(g);
    if (p > best + 1) { best = p; since = 0; attempt = 0; } else if (phase === 'go') since++;
    if (phase === 'go' && since > 280 + attempt * 60) { // 4 s without progress: back up and try again
      if (++attempt > tries) return { stuck: true, i };
      phase = 'back'; phaseLeft = 60 + attempt * 45; since = 0;
    }
  }
  return { stuck: false };
}
