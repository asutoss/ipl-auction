const crypto = require("crypto");

function hashSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0;
  const s = String(seed ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 — a tiny, deterministic 32-bit PRNG. */
function mulberry32(seed) {
  let a = hashSeed(seed);
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cryptoUnit() {
  return crypto.randomBytes(4).readUInt32BE(0) / 4294967296;
}

function intFromUnit(unitFn, maxExclusive) {
  const n = Math.floor(Number(maxExclusive));
  if (!Number.isFinite(n) || n <= 1) return 0;
  // Rejection sampling so modulo bias does not creep in.
  const limit = Math.floor(2 ** 32 / n) * n;
  let x;
  do {
    x = Math.floor(unitFn() * 2 ** 32);
  } while (x >= limit);
  return x % n;
}

function makeIntFn(random) {
  return (maxExclusive) => intFromUnit(random, maxExclusive);
}

/**
 * Normalise an injectable RNG.
 * Accepts a seed (number or string), a () => [0,1) function, or an
 * object with random()/int(n). Default is crypto.randomInt / crypto bytes.
 */
function resolveRng(rng) {
  if (rng && typeof rng === "object" && (typeof rng.random === "function" || typeof rng.int === "function")) {
    const random = typeof rng.random === "function" ? rng.random.bind(rng) : Math.random;
    const int = typeof rng.int === "function" ? (n) => rng.int(n) : makeIntFn(random);
    return { random, int };
  }
  if (typeof rng === "function") {
    return { random: rng, int: makeIntFn(rng) };
  }
  if (rng != null && rng !== false) {
    const random = mulberry32(rng);
    return { random, int: makeIntFn(random) };
  }
  return {
    random: cryptoUnit,
    int: (n) => {
      const max = Math.floor(Number(n));
      if (!Number.isFinite(max) || max <= 1) return 0;
      if (typeof crypto.randomInt === "function") return crypto.randomInt(max);
      return intFromUnit(cryptoUnit, max);
    },
  };
}

/**
 * Fisher–Yates shuffle. Does not mutate the input.
 * `rng` may be a seed, a unit random function, or a resolveRng() object.
 */
function shuffle(arr, rng) {
  const a = [...(arr || [])];
  const r = resolveRng(rng);
  for (let i = a.length - 1; i > 0; i--) {
    const j = r.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { hashSeed, mulberry32, resolveRng, shuffle };
