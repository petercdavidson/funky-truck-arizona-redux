// tile-sets.js — the tile sheet's sets, marked up by hand in tools/sheet-sets.html: tiles drawn as
// one picture, so ones next to each other on the sheet join up exactly as they sit there. `h`: the
// tile joins the one to its right (id + 1); `v`: the tile joins the one below it (id + 10). Tiles
// in different sets can still go together; the sheet alone just doesn't say so. `empty`: tiles
// with nothing worth placing in them (as well as the sheet's blank cells).
export const TILE_SETS = {
  cols: 10,
  h: [50, 52, 54, 60, 62, 64, 66, 70, 72, 74, 76, 80, 82, 84, 86, 90, 92, 94, 96, 100, 102, 104, 106, 107, 110, 111, 112, 114, 115, 116, 120, 121, 122, 124, 125, 126, 130, 131, 132, 133, 134, 140, 141, 143, 144, 150, 151, 152, 154, 160, 162, 163, 164, 168, 170, 171, 172, 174, 175, 177, 180, 181, 182, 184, 185, 187, 190, 191, 192, 194, 195, 197, 200, 201, 202, 204, 205, 207, 210, 211, 212, 214, 215, 217, 220, 221, 222, 224, 225, 227],
  v: [4, 5, 6, 24, 25, 26, 41, 43, 45, 60, 61, 62, 63, 64, 65, 66, 67, 70, 71, 72, 73, 74, 75, 76, 77, 80, 81, 82, 83, 94, 95, 96, 97, 110, 111, 112, 113, 114, 115, 116, 117, 130, 131, 132, 133, 134, 135, 150, 151, 152, 153, 154, 155, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219],
  empty: [88, 108, 168, 169],
};
