// assets.js — loads the level data and the vector art, and holds the font stacks.
//
// All the art is vector (assets/vector.json, traced from the original bitmaps by
// tools/vectorize.mjs), so it stays sharp at any screen size.

// Fonts already installed on the player's device, so the game ships no font files.
export const HUD_FONT = '"Arial Rounded MT Bold", "Varela Round", "Nunito", "Avenir Next", system-ui, sans-serif';
export const TITLE_FONT = '"Avenir Next", Avenir, "Nunito", "Segoe UI", system-ui, sans-serif';

export async function loadAssets(base = 'assets/', onProgress = () => {}) {
  let done = 0;
  const get = (f) => fetch(base + f).then((r) => {
    if (!r.ok) throw new Error(`Could not load ${f}`);
    return r.json();
  }).then((j) => { onProgress(++done / 2); return j; });
  const [levels, art] = await Promise.all([get('levels.json'), get('vector.json')]);
  return { levels, art };
}
