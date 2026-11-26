const { ROLES, resolveMode, remainingQuota } = require("./rules");
const { shuffle, resolveRng } = require("./random");

const MARQUEE_WINDOW = 10;

function isMarquee(player) {
  return Boolean(player && player.marquee);
}

function minMarqueesForLength(n) {
  return Math.ceil(Math.max(0, Number(n) || 0) / MARQUEE_WINDOW);
}

function unusedMarquees(allPlayers, usedIds) {
  const used = usedIds instanceof Set ? usedIds : new Set(usedIds || []);
  return (allPlayers || []).filter((p) => p && p.id && isMarquee(p) && !used.has(p.id));
}

function lastMarqueeIndex(list) {
  const arr = list || [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (isMarquee(arr[i])) return i;
  }
  return -1;
}

function suffixMarqueeNeed(pickedLen, prefix) {
  const pre = prefix || [];
  const last = lastMarqueeIndex(pre);
  const tail = last < 0 ? pre.length : pre.length - 1 - last;
  const run = pickedLen + Math.min(Math.max(0, tail), MARQUEE_WINDOW - 1);
  return minMarqueesForLength(run);
}

/** Make sure a list holds enough marquees for a max-gap of 9, swapping like-for-like roles first. */
function injectMarquees(picked, allPlayers, opts = {}) {
  const list = (picked || []).slice();
  const need = Math.max(minMarqueesForLength(list.length), suffixMarqueeNeed(list.length, opts.prefix || []));
  if (need <= 0) return list;
  // Include sold / queued / presented ids so top-ups never reintroduce a used player.
  const used = usedPlayerIds([opts.usedIds, list, opts.prefix]);
  const spare = unusedMarquees(allPlayers, used);
  const takeSpare = (pred) => {
    const i = spare.findIndex(pred);
    if (i < 0) return null;
    return spare.splice(i, 1)[0];
  };
  const count = () => list.filter(isMarquee).length;
  for (let i = 0; i < list.length && spare.length && count() < need; i++) {
    if (isMarquee(list[i])) continue;
    const swap = takeSpare((p) => p.role === list[i].role);
    if (swap) {
      used.delete(list[i].id);
      list[i] = swap;
      used.add(swap.id);
    }
  }
  // Same-role swaps only, so mode composition (and no-AR Rapid/Bullet lists) stay intact.
  return list;
}

/**
 * Rearrange a future list so no 10 consecutive non-marquees appear in
 * (prefix + list). Already-presented prefix players are not moved.
 */
function ensureMarqueeSpacing(list, rng, opts = {}) {
  const windowSize = Math.max(1, Number(opts.windowSize) || MARQUEE_WINDOW);
  const prefix = Array.isArray(opts.prefix) ? opts.prefix : [];
  const source = list || [];
  const marquees = [];
  const rest = [];
  for (const p of source) {
    if (isMarquee(p)) marquees.push(p);
    else rest.push(p);
  }
  if (!marquees.length) return source.slice();
  const out = [];
  let mi = 0;
  let ni = 0;
  let last = lastMarqueeIndex(prefix);
  const suffixLen = source.length;
  const prefixLen = prefix.length;
  for (let i = 0; i < suffixLen; i++) {
    const comb = prefixLen + i;
    const leftoverM = marquees.length - mi;
    const leftoverN = rest.length - ni;
    const remainingAfter = suffixLen - i - 1;
    const must = leftoverM > 0 && (comb - last >= windowSize || leftoverM > remainingAfter);
    if (must) {
      out.push(marquees[mi++]);
      last = comb;
    } else if (leftoverN > 0) {
      out.push(rest[ni++]);
    } else {
      out.push(marquees[mi++]);
      last = comb;
    }
  }
  return out;
}

function maxNonMarqueeRun(list) {
  let run = 0;
  let max = 0;
  for (const p of list || []) {
    if (isMarquee(p)) run = 0;
    else {
      run += 1;
      if (run > max) max = run;
    }
  }
  return max;
}

function windowsHaveMarquee(list, windowSize = MARQUEE_WINDOW) {
  const arr = list || [];
  for (let i = 0; i < arr.length; i += windowSize) {
    const end = Math.min(i + windowSize, arr.length);
    if (end - i < windowSize) break;
    if (!arr.slice(i, end).some(isMarquee)) return false;
  }
  return maxNonMarqueeRun(arr) < windowSize;
}



/**
 * Extra players picked per role so the list still covers unsolds and
 * teams that still need that role. Half a set, at least one, is enough
 * without padding the auction much.
 */
function roleBuffer(numTeams) {
  const n = Math.max(0, Math.floor(Number(numTeams) || 0));
  if (n <= 0) return 0;
  return Math.max(1, Math.ceil(n / 2));
}

function rolePickCount(roleSlots, numTeams) {
  const slots = Math.max(0, Math.floor(Number(roleSlots) || 0));
  if (slots <= 0) return 0;
  return numTeams * slots + roleBuffer(numTeams);
}

function expectedAuctionComposition(mode, numTeams) {
  const m = resolveMode(mode);
  const n = Math.max(0, Math.floor(Number(numTeams) || 0));
  const counts = {};
  let total = 0;
  for (const role of ROLES) {
    const c = rolePickCount(m.quota[role] || 0, n);
    counts[role] = c;
    total += c;
  }
  return { counts, total };
}

function usedPlayerIds(lists) {
  const used = new Set();
  for (const list of lists) {
    if (!list) continue;
    if (list instanceof Set) {
      for (const id of list) used.add(id);
      continue;
    }
    for (const p of list) {
      if (p == null) continue;
      if (typeof p === "string" || typeof p === "number") used.add(p);
      else if (p.id) used.add(p.id);
    }
  }
  return used;
}

/**
 * Randomly pick `numTeams × roleSlots + buffer` players per role from the
 * full database, then shuffle the combined list once. Roles with no slots
 * in this mode (e.g. AR in Rapid/Bullet) are omitted. If a role has fewer
 * players than requested, every available player of that role is taken.
 */
function buildAuctionList(allPlayers, mode, numTeams, rng) {
  const r = resolveRng(rng);
  const m = resolveMode(mode);
  const n = Math.max(0, Math.floor(Number(numTeams) || 0));
  const byRole = Object.fromEntries(ROLES.map((role) => [role, []]));
  for (const p of allPlayers || []) {
    if (p && p.role && byRole[p.role]) byRole[p.role].push(p);
  }
  const picked = [];
  const used = new Set();
  for (const role of ROLES) {
    const need = rolePickCount(m.quota[role] || 0, n);
    if (need <= 0) continue;
    const pool = shuffle(byRole[role], r).filter((p) => p && !used.has(p.id));
    const take = pool.slice(0, need);
    for (const p of take) used.add(p.id);
    picked.push(...take);
  }
  const withMarquees = injectMarquees(picked, allPlayers);
  return ensureMarqueeSpacing(shuffle(withMarquees, r), r);
}

/**
 * Another small batch of still-needed roles, taken from whoever is left
 * in the database. Used when the original list runs out before every
 * incomplete team has the roles it still needs.
 */
function extraPlayersForNeeds({ allPlayers, mode, teams, usedIds, rng, prefix }) {
  const r = resolveRng(rng);
  const m = resolveMode(mode);
  const needy = (teams || []).filter(Boolean);
  if (!needy.length) return [];
  const used = usedPlayerIds([usedIds]);
  const byRole = Object.fromEntries(ROLES.map((role) => [role, []]));
  for (const p of allPlayers || []) {
    if (p && p.role && byRole[p.role] && !used.has(p.id)) byRole[p.role].push(p);
  }
  const extras = [];
  for (const role of ROLES) {
    const slotsLeft = needy.reduce((sum, team) => {
      const left = remainingQuota(team.squad || [], m);
      return sum + (left[role] || 0);
    }, 0);
    if (slotsLeft <= 0) continue;
    const takeN = slotsLeft + roleBuffer(needy.length);
    const pool = shuffle(byRole[role], r);
    const take = pool.slice(0, takeN);
    for (const p of take) used.add(p.id);
    extras.push(...take);
  }
  const withMarquees = injectMarquees(extras, allPlayers, { prefix: prefix || [], usedIds: used });
  return ensureMarqueeSpacing(shuffle(withMarquees, r), r, { prefix: prefix || [] });
}


const TOP_UP_BATCH = 10;

/**
 * Up to `size` unused players from the full database, preferring roles
 * that incomplete teams still need, then filling the rest of the batch
 * with whoever is left. Used when the auction list runs out.
 */
function nextAuctionBatch({ allPlayers, usedIds, neededRoles, rng, size = TOP_UP_BATCH, prefix } = {}) {
  const r = resolveRng(rng);
  const cap = Math.max(1, Math.floor(Number(size) || TOP_UP_BATCH));
  const used = usedPlayerIds([usedIds]);
  const unused = (allPlayers || []).filter((p) => p && p.id && !used.has(p.id));
  if (!unused.length) return [];
  const needed = neededRoles instanceof Set ? neededRoles : new Set(neededRoles || []);
  const preferred = [];
  const rest = [];
  for (const p of unused) {
    if (needed.size && needed.has(p.role)) preferred.push(p);
    else rest.push(p);
  }
  const picked = [];
  for (const list of [preferred, rest]) {
    const shuffled = shuffle(list, r);
    for (const p of shuffled) {
      if (picked.length >= cap) break;
      picked.push(p);
      used.add(p.id);
    }
    if (picked.length >= cap) break;
  }
  const withMarquees = injectMarquees(picked, allPlayers, { prefix: prefix || [], usedIds: used });
  return ensureMarqueeSpacing(withMarquees, r, { prefix: prefix || [] });
}

module.exports = {
  roleBuffer,
  rolePickCount,
  expectedAuctionComposition,
  buildAuctionList,
  extraPlayersForNeeds,
  nextAuctionBatch,
  TOP_UP_BATCH,
  MARQUEE_WINDOW,
  isMarquee,
  minMarqueesForLength,
  injectMarquees,
  ensureMarqueeSpacing,
  maxNonMarqueeRun,
  windowsHaveMarquee,
};
