// units.js — how speeds, heights and distances are shown: metric (km/h, m, km) or imperial (mph,
// ft, mi), an option. No DOM access. The game itself always works in pixels, steps and metres.

const MPH_PER_KMH = 0.621371;
const FT_PER_M = 3.28084;
const FT_PER_MILE = 5280;

/** A speed, from km/h: "112 km/h" or "70 mph". */
export function formatSpeed(kmh, imperial = false) {
  return imperial ? `${Math.round(kmh * MPH_PER_KMH).toLocaleString('en-US')} mph` : `${Math.round(kmh).toLocaleString('en-US')} km/h`;
}

/** A height, from metres: "350 m" then "1.2 km", or "1,150 ft" then "1.4 mi" once past a mile. */
export function formatHeight(m, imperial = false) {
  if (imperial) {
    const ft = m * FT_PER_M;
    return ft < FT_PER_MILE ? `${Math.round(ft).toLocaleString('en-US')} ft` : `${(ft / FT_PER_MILE).toFixed(ft < 10 * FT_PER_MILE ? 1 : 0)} mi`;
  }
  return m < 1000 ? `${Math.round(m).toLocaleString('en-US')} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/** A distance driven, from metres: as a height is shown. */
export const formatDistance = formatHeight;

/**
 * The speedometer's bar, quasi-logarithmic: about linear at low speeds, then squeezed, so the bar
 * moves at everyday speeds and is full at SPEEDO_FULL km/h (anything faster stays full).
 */
export const SPEEDO_FULL = 300;
export function speedoShare(kmh) {
  return Math.max(0, Math.min(1, Math.log1p(kmh / 40) / Math.log1p(SPEEDO_FULL / 40)));
}

/**
 * The speed of sound (km/h) at `metres` up, from the standard atmosphere's temperatures: 1,225 km/h
 * at sea level, 1,062 km/h through the cold 11 to 20 km, faster again in the warmer stratopause,
 * slowest at the mesopause (86 km) and held there above it.
 */
export function soundSpeedKmh(metres = 0) {
  const km = Math.max(0, metres / 1000);
  // (temperature, K, at the start of each layer, and its lapse, K per km)
  const L = [[0, 288.15, -6.5], [11, 216.65, 0], [20, 216.65, 1], [32, 228.65, 2.8], [47, 270.65, 0], [51, 270.65, -2.8], [71, 214.65, -2], [86, 184.65, 0]];
  let T = 184.65;
  for (let i = L.length - 1; i >= 0; i--) if (km >= L[i][0]) { T = L[i][1] + L[i][2] * (km - L[i][0]); break; }
  return Math.sqrt(1.4 * 287.05 * T) * 3.6;
}

/** "Mach 1.3" at `kmh` and `metres` up, or '' below Mach 1. */
export function formatMach(kmh, metres = 0) {
  const m = kmh / soundSpeedKmh(metres);
  return m >= 1 ? `Mach ${(Math.floor(m * 10) / 10).toFixed(1)}` : '';
}
