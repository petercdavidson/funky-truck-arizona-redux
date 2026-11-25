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
