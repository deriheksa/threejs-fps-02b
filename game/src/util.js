// CINDERFALL — small shared helpers: a seeded generator and a few numeric clamps.
// The capture modes (?shot=...&seed=N) must play out identically every run, so all
// randomness in the game flows from one mulberry32 stream seeded from the URL.
export function makeSeeded(seed) {
  let word = (seed | 0) || 1;
  return function next() {
    word = (word + 0x6d2b79f5) | 0;
    let mixed = Math.imul(word ^ (word >>> 15), 1 | word);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Format a countdown in seconds as m:ss for the round timer.
export function clockText(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
