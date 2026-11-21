// Shared helpers for the tests (not a test file itself).

/** Turn the truck upside down where it stands, lifted a little so it drops onto its roof. */
export function turnOver(t) {
  const cx = t.T[0], cy = t.T[1] - 20;
  for (let i = 0; i < 10; i += 2) {
    t.T[i] = 2 * cx - t.T[i]; t.T[i + 1] = 2 * cy - t.T[i + 1] - 40;
    t.P[i] = t.T[i]; t.P[i + 1] = t.T[i + 1];
  }
  t.probePrev = null;
  t.updateBodyRot();
}

export function memoryStore() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), map: m };
}
