const { ROLES, resolveMode, remainingQuota } = require("./rules");
const { shuffle, resolveRng } = require("./random");

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
  return shuffle(picked, r);
}

/**
 * Another small batch of still-needed roles, taken from whoever is left
 * in the database. Used when the original list runs out before every
 * incomplete team has the roles it still needs.
 */
function extraPlayersForNeeds({ allPlayers, mode, teams, usedIds, rng }) {
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
  return shuffle(extras, r);
}


const TOP_UP_BATCH = 10;

/**
 * Up to `size` unused players from the full database, preferring roles
 * that incomplete teams still need, then filling the rest of the batch
 * with whoever is left. Used when the auction list runs out.
 */
function nextAuctionBatch({ allPlayers, usedIds, neededRoles, rng, size = TOP_UP_BATCH } = {}) {
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
      if (picked.length >= cap) return picked;
      picked.push(p);
      used.add(p.id);
    }
  }
  return picked;
}

module.exports = {
  roleBuffer,
  rolePickCount,
  expectedAuctionComposition,
  buildAuctionList,
  extraPlayersForNeeds,
  nextAuctionBatch,
  TOP_UP_BATCH,
};
