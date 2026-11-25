// trial.js — Time Trial: the race clock's format, best times, and ghosts. No DOM access (runs
// under Node for tests).
//
// A ghost is your best run on a track, replayed as a see-through truck. It is recorded as the
// truck's pose (its five points) every GHOST_EVERY steps, not as the buttons pressed, so it still
// replays correctly if the physics is ever tweaked. Poses are rounded to whole pixels and stored
// as the change from the pose before, mostly one byte each, then base64: about 20 KB a minute.
// A ghost also keeps, for each stage, the race clock when it first reached each tile column, so
// the HUD can show how far ahead or behind it you are at the same point on the track.

import { STEP_HZ } from './game.js';

/**
 * Track numbers: 0-8 are the nine stages; TRIAL_ALL is all nine in a row (these have times and
 * ghosts: TRIAL_TRACKS of them); then the stunt tracks from TRIAL_STUNTS, which have trick scores.
 */
export const TRIAL_ALL = 9;
export const TRIAL_TRACKS = 10;
export const TRIAL_STUNTS = 10;
/** Steps between recorded ghost poses (the renderer interpolates between them). */
export const GHOST_EVERY = 2;
/** Numbers per recorded pose: the stage, then the truck's 5 points (x, y each). */
export const POSE = 11;

/** A race clock reading (in steps) as m:ss.cc. */
export function formatTime(steps) {
  const cs = Math.round(steps * 100 / STEP_HZ);
  const m = Math.floor(cs / 6000), s = Math.floor(cs / 100) % 60, c = cs % 100;
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** A gap between two clock readings, signed, in seconds: "-0.42", "+1.20". */
export function formatGap(steps) {
  const s = Math.round(Math.abs(steps) * 100 / STEP_HZ) / 100;
  return `${steps < 0 ? '-' : '+'}${s.toFixed(2)}`;
}

/** Pack whole numbers as changes from the value POSE places before: a byte each when small. */
export function encodePoses(values) {
  const bytes = [];
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - (i >= POSE ? values[i - POSE] : 0);
    if (d > -128 && d < 128) bytes.push(d & 255);
    else { bytes.push(128); bytes.push((d >> 16) & 255, (d >> 8) & 255, d & 255); } // escape, then 24 bits
  }
  let s = '';
  for (let i = 0; i < bytes.length; i += 4096) s += String.fromCharCode(...bytes.slice(i, i + 4096));
  return btoa(s);
}

export function decodePoses(text) {
  const s = atob(text), out = [];
  for (let i = 0; i < s.length;) {
    let d = s.charCodeAt(i++);
    if (d === 128) {
      if (i + 3 > s.length) throw new Error('bad ghost');
      d = (s.charCodeAt(i) << 16) | (s.charCodeAt(i + 1) << 8) | s.charCodeAt(i + 2);
      if (d & 0x800000) d -= 0x1000000;
      i += 3;
    } else if (d > 127) d -= 256;
    out.push(d + (out.length >= POSE ? out[out.length - POSE] : 0));
  }
  if (out.length % POSE) throw new Error('bad ghost');
  return out;
}

/** The best times, as saved: { track: steps }, keeping only sensible entries. */
export function validBests(v) {
  const out = {};
  if (v && typeof v === 'object') {
    for (let t = 0; t < TRIAL_TRACKS; t++) {
      const n = v[t];
      if (Number.isInteger(n) && n > 0 && n < 1e8) out[t] = n;
    }
  }
  return out;
}

/** The stunt tracks' best trick scores, as saved: { track: points }. */
export function validStuntBests(v) {
  const out = {};
  if (v && typeof v === 'object') {
    for (const [k, n] of Object.entries(v)) {
      const t = Number(k);
      if (Number.isInteger(t) && t >= TRIAL_STUNTS && t < TRIAL_STUNTS + 20 && Number.isInteger(n) && n > 0 && n < 1e10) out[t] = n;
    }
  }
  return out;
}

/** A saved ghost, checked and unpacked, or null. */
export function loadGhost(v, track) {
  try {
    if (!v || typeof v !== 'object' || v.v !== 1 || v.track !== track || !Number.isInteger(v.time)) return null;
    const poses = decodePoses(v.poses);
    const marks = {};
    for (const [stage, list] of Object.entries(v.marks || {})) {
      if (!Array.isArray(list) || !list.every((n) => n === null || Number.isInteger(n))) return null;
      marks[stage] = list;
    }
    return { track, time: v.time, poses, marks };
  } catch {
    return null;
  }
}

/** A ghost ready to save. */
export function saveGhost(track, time, poses, marks) {
  return { v: 1, track, time, poses: encodePoses(poses), marks };
}

/**
 * The ghost's pose at run step `step` (interpolated), as the truck's 10 coordinates, or null if
 * the ghost isn't on `stage` then (or has finished).
 */
export function ghostPose(ghost, step, stage) {
  const f = step / GHOST_EVERY, i = Math.floor(f), t = f - i, P = ghost.poses;
  if ((i + 1) * POSE >= P.length) return null;
  const a = i * POSE, b = a + POSE;
  if (P[a] !== stage || P[b] !== stage) return null;
  const out = new Array(10);
  for (let k = 0; k < 10; k++) out[k] = P[a + 1 + k] + (P[b + 1 + k] - P[a + 1 + k]) * t;
  return out;
}
