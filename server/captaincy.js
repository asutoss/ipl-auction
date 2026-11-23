/** IPL captaincy-match bonus: 0–5%, revealed after a captain is picked. */

// Log curve reaches the 5% ceiling at Rohit Sharma's IPL games as captain
// (158, through 2023). MS Dhoni (235, through 2025) and anyone else at or
// above that mark are capped at 5%.
const CAPTAIN_BONUS_MAX = 0.05;
const CAPTAIN_MATCHES_FOR_MAX = 158;

const matchesById = new Map();

function registerCaptainMatches(id, count) {
  if (!id) return;
  const n = Math.max(0, Math.floor(Number(count) || 0));
  matchesById.set(id, n);
}

function captainMatchesOf(player) {
  if (player && player.captainMatches != null && Number.isFinite(Number(player.captainMatches))) {
    return Math.max(0, Math.floor(Number(player.captainMatches)));
  }
  if (player && player.id && matchesById.has(player.id)) return matchesById.get(player.id);
  return 0;
}

function captainBonus(matches) {
  const n = Math.max(0, Math.floor(Number(matches) || 0));
  if (n <= 0) return 0;
  if (n >= CAPTAIN_MATCHES_FOR_MAX) return CAPTAIN_BONUS_MAX;
  return CAPTAIN_BONUS_MAX * Math.log(1 + n) / Math.log(1 + CAPTAIN_MATCHES_FOR_MAX);
}

function captainBonusPct(matches) {
  return Math.round(captainBonus(matches) * 1000) / 10;
}

function formatCaptainBonus(matches) {
  const n = Math.max(0, Math.floor(Number(matches) || 0));
  return `+${captainBonusPct(n).toFixed(1)}%`;
}

function packCaptainBonus(player) {
  const matches = captainMatchesOf(player);
  return {
    captainBonus: captainBonus(matches),
    captainBonusPct: captainBonusPct(matches),
    captainBonusLabel: formatCaptainBonus(matches),
  };
}

function captainBonusFields(team) {
  if (!team || !team.captainId) {
    return {
      captainBonus: null,
      captainBonusPct: null,
      captainBonusLabel: null,
    };
  }
  const slot = (team.squad || []).find((s) => s.player && s.player.id === team.captainId);
  if (!slot) {
    return {
      captainBonus: null,
      captainBonusPct: null,
      captainBonusLabel: null,
    };
  }
  return packCaptainBonus(slot.player);
}

module.exports = {
  CAPTAIN_BONUS_MAX,
  CAPTAIN_MATCHES_FOR_MAX,
  registerCaptainMatches,
  captainMatchesOf,
  captainBonus,
  captainBonusPct,
  formatCaptainBonus,
  packCaptainBonus,
  captainBonusFields,
};
