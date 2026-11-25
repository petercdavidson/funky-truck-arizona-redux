// tile-rules.js — the Stage Editor's look pass, overruled by hand: the art for a situation (what's
// next to a cell up, right, down and left), marked in tools/match-review.html. Keys and tiles are
// in the situation's own way round (`situation` in src/autotile.js turns every situation to the one
// that sorts first), so a rule holds for the same situation turned any way. `good`: the tile that
// goes there; `bad`: tiles that never do.
export const TILE_RULES = {};
