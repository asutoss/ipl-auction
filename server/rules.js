const ROLES = ["BAT", "WK", "AR", "BOWL"];
const QUOTA = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
const SQUAD_SIZE = 11;
const MAX_OVERSEAS = 4;
const MIN_START_BID = 1;
const MAX_START_BID = 5;
const BASE_PRICE_POINTS = MIN_START_BID; // reserve uses the minimum possible starting bid
const DEFAULT_PURSE_POINTS = 100;
const BID_STEPS = [1, 2, 5];
const DEFAULT_PURSE_LAKHS = DEFAULT_PURSE_POINTS; // amounts are in points
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;

const MODES = {
  classical: {
    id: "classical",
    name: "Classical",
    blurb: "Full IPL-style auction",
    quota: { BAT: 4, WK: 1, AR: 2, BOWL: 4 },
    squadSize: 11,
    purse: 100,
    purseOptions: [50, 75, 100, 120, 150],
    overs: 20,
    expectedBatters: 7, // 4 BAT + 1 WK + 2 AR
    expectedBowlers: 6, // 2 AR + 4 BOWL
    maxOversPerBowler: 4,
  },
  rapid: {
    id: "rapid",
    name: "Rapid",
    blurb: "Five-player sprint",
    quota: { BAT: 2, WK: 1, AR: 0, BOWL: 2 },
    squadSize: 5,
    purse: 50,
    purseOptions: [30, 40, 50, 65, 80],
    overs: 10,
    expectedBatters: 3, // 2 BAT + 1 WK
    expectedBowlers: 2,
    maxOversPerBowler: 5,
  },
  bullet: {
    id: "bullet",
    name: "Bullet",
    blurb: "Three-player dash",
    quota: { BAT: 1, WK: 1, AR: 0, BOWL: 1 },
    squadSize: 3,
    purse: 30,
    purseOptions: [20, 25, 30, 40, 50],
    overs: 6,
    expectedBatters: 2, // 1 BAT + 1 WK
    expectedBowlers: 1,
    maxOversPerBowler: 6,
  },
};
const DEFAULT_MODE = "classical";

function compositionLabel(mode) {
  const m = resolveMode(mode);
  return ["BAT", "WK", "AR", "BOWL"]
    .filter((r) => (m.quota[r] || 0) > 0)
    .map((r) => `${m.quota[r]} ${r}`)
    .join(" · ");
}

function getMode(id) {
  const key = String(id || "").toLowerCase().trim();
  return MODES[key] || null;
}

function resolveModeId(mode) {
  if (typeof mode === "string" && MODES[mode]) return mode;
  if (mode && typeof mode === "object") {
    if (mode.id && MODES[mode.id]) return mode.id;
  }
  return DEFAULT_MODE;
}

function resolveMode(mode) {
  if (mode && typeof mode === "object" && mode.quota && mode.squadSize) return mode;
  return getMode(typeof mode === "string" ? mode : resolveModeId(mode)) || MODES[DEFAULT_MODE];
}

function publicMode(mode) {
  const m = resolveMode(mode);
  return {
    id: m.id,
    name: m.name,
    blurb: m.blurb,
    squadSize: m.squadSize,
    quota: { ...m.quota },
    purse: m.purse,
    purseOptions: [...m.purseOptions],
    overs: m.overs,
    compositionLabel: compositionLabel(m),
    summary: `${m.name} · ${m.squadSize}-player squad`,
  };
}

function listModes() {
  return ["classical", "rapid", "bullet"].map((id) => publicMode(id));
}

function inningsFormat(mode) {
  const m = resolveMode(mode);
  const overs = m.overs;
  const scale = overs / 20;
  return {
    id: m.id,
    overs,
    balls: overs * 6,
    maxWickets: Math.max(1, m.squadSize - 1),
    maxOversPerBowler: m.maxOversPerBowler,
    maxBallsPerBowler: m.maxOversPerBowler * 6,
    expectedBatters: m.expectedBatters,
    expectedBowlers: m.expectedBowlers,
    expectedRuns: Math.round(155 * scale),
    sd: Math.max(6, Math.round(16 * Math.sqrt(scale))),
    edgeScale: 0.85 * scale,
    minScore: Math.round(95 * scale),
    maxScore: Math.round(265 * scale),
  };
}

const { IDENTITIES } = require("../public/identities");
const FRANCHISES = IDENTITIES;

function roleCounts(squad) {
  const counts = { BAT: 0, WK: 0, AR: 0, BOWL: 0 };
  for (const slot of squad) {
    const role = slot.player.role;
    if (counts[role] != null) counts[role] += 1;
  }
  return counts;
}

function overseasCount(squad) {
  return squad.filter((s) => s.player.overseas).length;
}

function remainingQuota(squad, mode) {
  const have = roleCounts(squad);
  const left = {};
  const quota = resolveMode(mode).quota;
  for (const role of ROLES) left[role] = Math.max(0, (quota[role] || 0) - have[role]);
  return left;
}

function hasMinSquad(squad, mode) {
  return (squad || []).length >= resolveMode(mode).squadSize;
}

function slotsLeft(squad, mode) {
  return resolveMode(mode).squadSize - (squad || []).length;
}

function isSquadComplete(squad, mode) {
  const have = roleCounts(squad || []);
  const quota = resolveMode(mode).quota;
  return ROLES.every((r) => (have[r] || 0) >= (quota[r] || 0));
}

/** Remaining role slots a team still needs to complete the mode's squad. */
function pendingSlots(squad, mode) {
  const left = remainingQuota(squad || [], mode);
  return ROLES.reduce((s, r) => s + (left[r] || 0), 0);
}

/** Minimum raise is +1 point. Buttons offer +1, +2 or +5. */
function bidIncrement(_currentPoints) {
  return BID_STEPS[0];
}

/**
 * Next legal minimum bid. If nobody has bid yet, the first bid is the base price.
 * After a standing bid, the cheapest raise is +1.
 */
function nextBidAmount(currentPoints, hasBidder) {
  if (!hasBidder) return currentPoints;
  return currentPoints + BID_STEPS[0];
}

function isLegalRaise(currentPoints, amount, hasBidder) {
  if (!Number.isInteger(amount)) return false;
  if (!hasBidder) return amount === currentPoints;
  return BID_STEPS.includes(amount - currentPoints);
}

function formatPoints(points) {
  const n = Number(points) || 0;
  return `${n} pt${n === 1 ? "" : "s"}`;
}

const formatLakhs = formatPoints;

/**
 * Minimum purse needed to fill remaining role quotas from `available`.
 * Returns Infinity if the remaining pool cannot fill the quotas.
 */
function minCostToFill(needed, overseasLeft, available) {
  const need = { ...needed };
  const totalNeed = ROLES.reduce((s, r) => s + Math.max(0, need[r] || 0), 0);
  if (totalNeed === 0) return 0;

  const byRole = { BAT: [], WK: [], AR: [], BOWL: [] };
  for (const p of available) {
    if (byRole[p.role]) byRole[p.role].push(p);
  }
  for (const r of ROLES) {
    byRole[r].sort((a, b) => a.basePriceLakhs - b.basePriceLakhs);
  }

  const roleCosts = {};
  for (const role of ROLES) {
    const k = Math.max(0, need[role] || 0);
    const costs = {};
    if (k === 0) {
      costs[0] = 0;
      roleCosts[role] = costs;
      continue;
    }
    const domestic = byRole[role].filter((p) => !p.overseas);
    const overseas = byRole[role].filter((p) => p.overseas);
    for (let o = 0; o <= k; o++) {
      const d = k - o;
      if (o > overseas.length || d > domestic.length) continue;
      let cost = 0;
      for (let i = 0; i < o; i++) cost += overseas[i].basePriceLakhs;
      for (let i = 0; i < d; i++) cost += domestic[i].basePriceLakhs;
      costs[o] = cost;
    }
    roleCosts[role] = costs;
  }

  let best = Infinity;
  function rec(index, overseasUsed, cost) {
    if (cost >= best) return;
    if (index === ROLES.length) {
      if (overseasUsed <= overseasLeft) best = cost;
      return;
    }
    const role = ROLES[index];
    const costs = roleCosts[role];
    const keys = Object.keys(costs).map(Number);
    if (keys.length === 0) return;
    for (const o of keys) {
      rec(index + 1, overseasUsed + o, cost + costs[o]);
    }
  }
  rec(0, 0, 0);
  return best;
}

function minCostBestEffort(needed, overseasLeft, available) {
  const full = minCostToFill(needed, overseasLeft, available);
  if (Number.isFinite(full)) return full;

  const left = { ...needed };
  let ovLeft = overseasLeft;
  let cost = 0;
  const pool = [...available].sort((a, b) => a.basePriceLakhs - b.basePriceLakhs);
  const used = new Set();
  let added = true;
  while (added) {
    added = false;
    for (const p of pool) {
      if (used.has(p.id)) continue;
      if ((left[p.role] || 0) <= 0) continue;
      if (p.overseas && ovLeft <= 0) continue;
      used.add(p.id);
      left[p.role] -= 1;
      if (p.overseas) ovLeft -= 1;
      cost += p.basePriceLakhs;
      added = true;
      break;
    }
  }
  return cost;
}

function neededAfterPurchase(squad, player, mode) {
  const needed = remainingQuota(squad, mode);
  if ((needed[player.role] || 0) <= 0) return null;
  needed[player.role] -= 1;
  return { needed };
}

/** Cheapest cost to buy `count` more players from `available` (any role). */
function minCostToReachSize(available, count) {
  const n = Math.max(0, count);
  if (n === 0) return 0;
  const sorted = [...available].sort((a, b) => a.basePriceLakhs - b.basePriceLakhs);
  if (sorted.length < n) return Infinity;
  return sorted.slice(0, n).reduce((s, p) => s + p.basePriceLakhs, 0);
}

function reserveToReachSize(squadSizeAfterPurchase, mode) {
  const slotsAfter = Math.max(0, resolveMode(mode).squadSize - squadSizeAfterPurchase);
  return slotsAfter * BASE_PRICE_POINTS;
}

function canTakeRole(squad, player, mode) {
  if (!player) return false;
  return Boolean(neededAfterPurchase(squad, player, mode));
}

function isSquadFull(squad, mode) {
  return (squad || []).length >= resolveMode(mode).squadSize;
}

/**
 * Whether `player` can be added to `squad` without exceeding the mode's
 * squad size or a role quota. This is the single choke point for every
 * path that grows a squad.
 */
function canAddToSquad(squad, player, mode) {
  if (!player) return { ok: false, reason: "No player on the block." };
  if (isSquadFull(squad, mode)) {
    return { ok: false, reason: "Your squad is already full." };
  }
  if (!canTakeRole(squad, player, mode)) {
    return { ok: false, reason: `Your ${player.role} quota is full.` };
  }
  return { ok: true };
}

function addToSquad(team, player, priceLakhs, mode) {
  if (!team) return { ok: false, reason: "You are not in this room." };
  const check = canAddToSquad(team.squad, player, mode);
  if (!check.ok) return check;
  if (!Array.isArray(team.squad)) team.squad = [];
  team.squad.push({ player, priceLakhs });
  return { ok: true };
}

/**
 * Whether a franchise can legally bid `amountLakhs` (points) for `player`.
 * Voluntary bids must leave 1 point per remaining role slot to complete the squad.
 * The automatic default bid checks that the team can add this player
 * (free squad slot and open role quota) and purse >= bid.
 */
function canBidFor(franchise, player, amountLakhs, available, opts = {}) {
  const mode = opts.mode || franchise.mode;
  if (!player) return { ok: false, reason: "No player on the block." };
  if (franchise.eliminated) {
    return { ok: false, reason: "Your franchise has been eliminated." };
  }
  if (isSquadComplete(franchise.squad, mode)) {
    return { ok: false, reason: "Your squad is already complete." };
  }
  const add = canAddToSquad(franchise.squad, player, mode);
  if (!add.ok) return add;
  const after = neededAfterPurchase(franchise.squad, player, mode);
  if (!after) {
    return { ok: false, reason: `Your ${player.role} quota is full.` };
  }
  if (amountLakhs > franchise.purseLakhs) {
    return { ok: false, reason: "Not enough points for this bid." };
  }
  const requireReserve = opts.requireReserve !== false;
  if (requireReserve) {
    const reserve = ROLES.reduce((s, r) => s + (after.needed[r] || 0), 0) * BASE_PRICE_POINTS;
    if (franchise.purseLakhs - amountLakhs < reserve) {
      return {
        ok: false,
        reason: "Bid would leave too little purse to complete your squad (1 point per remaining slot).",
      };
    }
  }
  return { ok: true, reason: null };
}

function availablePlayers({ allPlayers, soldIds, excludeId }) {
  const sold = soldIds instanceof Set ? soldIds : new Set(soldIds || []);
  return allPlayers.filter((p) => p.id !== excludeId && !sold.has(p.id));
}

module.exports = {
  ROLES,
  QUOTA,
  SQUAD_SIZE,
  MAX_OVERSEAS,
  MIN_START_BID,
  MAX_START_BID,
  BASE_PRICE_POINTS,
  DEFAULT_PURSE_POINTS,
  DEFAULT_PURSE_LAKHS,
  BID_STEPS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  MODES,
  DEFAULT_MODE,
  getMode,
  resolveMode,
  resolveModeId,
  publicMode,
  listModes,
  compositionLabel,
  inningsFormat,
  FRANCHISES,
  roleCounts,
  overseasCount,
  remainingQuota,
  hasMinSquad,
  slotsLeft,
  pendingSlots,
  isSquadComplete,
  bidIncrement,
  nextBidAmount,
  isLegalRaise,
  formatPoints,
  formatLakhs,
  minCostToFill,
  minCostBestEffort,
  neededAfterPurchase,
  minCostToReachSize,
  reserveToReachSize,
  canTakeRole,
  isSquadFull,
  canAddToSquad,
  addToSquad,
  canBidFor,
  availablePlayers,
};
