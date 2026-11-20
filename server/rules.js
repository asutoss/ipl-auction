const ROLES = ["BAT", "WK", "AR", "BOWL"];
const QUOTA = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
const SQUAD_SIZE = 11;
const MAX_OVERSEAS = 4;
const BASE_PRICE_POINTS = 2;
const DEFAULT_PURSE_POINTS = 100;
const BID_STEPS = [1, 2, 5];
const DEFAULT_PURSE_LAKHS = DEFAULT_PURSE_POINTS; // amounts are in points
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;

const FRANCHISES = [
  { id: "csk", name: "Chennai Super Kings", short: "CSK", color: "#F9CD05" },
  { id: "mi", name: "Mumbai Indians", short: "MI", color: "#045093" },
  { id: "rcb", name: "Royal Challengers Bengaluru", short: "RCB", color: "#DA1818" },
  { id: "kkr", name: "Kolkata Knight Riders", short: "KKR", color: "#3B0A75" },
  { id: "dc", name: "Delhi Capitals", short: "DC", color: "#2563EB" },
  { id: "rr", name: "Rajasthan Royals", short: "RR", color: "#EA1A8E" },
  { id: "pbks", name: "Punjab Kings", short: "PBKS", color: "#ED1B24" },
  { id: "srh", name: "Sunrisers Hyderabad", short: "SRH", color: "#F7A821" },
  { id: "gt", name: "Gujarat Titans", short: "GT", color: "#1C3A5A" },
  { id: "lsg", name: "Lucknow Super Giants", short: "LSG", color: "#1BA39C" },
];

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

function remainingQuota(squad) {
  const have = roleCounts(squad);
  const left = {};
  for (const role of ROLES) left[role] = Math.max(0, QUOTA[role] - have[role]);
  return left;
}

function hasMinSquad(squad) {
  return (squad || []).length >= SQUAD_SIZE;
}

function slotsLeft(squad) {
  return SQUAD_SIZE - squad.length;
}

function isSquadComplete(squad) {
  if (squad.length !== SQUAD_SIZE) return false;
  const have = roleCounts(squad);
  return ROLES.every((r) => have[r] === QUOTA[r]);
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

function neededAfterPurchase(squad, player) {
  const needed = remainingQuota(squad);
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

function reserveToReachSize(squadSizeAfterPurchase) {
  const slotsAfter = Math.max(0, SQUAD_SIZE - squadSizeAfterPurchase);
  return slotsAfter * BASE_PRICE_POINTS;
}

function canTakeRole(squad, player) {
  if (!player) return false;
  return Boolean(neededAfterPurchase(squad, player));
}

/**
 * Whether a franchise can legally bid `amountLakhs` (points) for `player`.
 * Voluntary bids must leave 2 points per remaining slot to reach 11.
 * The automatic default bid only checks role quota and purse >= bid.
 */
function canBidFor(franchise, player, amountLakhs, available, opts = {}) {
  if (!player) return { ok: false, reason: "No player on the block." };
  if (franchise.eliminated) {
    return { ok: false, reason: "Your franchise has been eliminated." };
  }
  const after = neededAfterPurchase(franchise.squad, player);
  if (!after) {
    return { ok: false, reason: `Your ${player.role} quota is full.` };
  }
  if (amountLakhs > franchise.purseLakhs) {
    return { ok: false, reason: "Not enough points for this bid." };
  }
  const requireReserve = opts.requireReserve !== false;
  if (requireReserve) {
    const reserve = reserveToReachSize((franchise.squad || []).length + 1);
    if (franchise.purseLakhs - amountLakhs < reserve) {
      return {
        ok: false,
        reason: "Bid would leave too little purse to reach 11 players (2 points per remaining slot).",
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
  BASE_PRICE_POINTS,
  DEFAULT_PURSE_POINTS,
  DEFAULT_PURSE_LAKHS,
  BID_STEPS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  FRANCHISES,
  roleCounts,
  overseasCount,
  remainingQuota,
  hasMinSquad,
  slotsLeft,
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
  canBidFor,
  availablePlayers,
};
