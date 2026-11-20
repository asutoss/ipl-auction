/**
 * Server-side character power registry.
 * Catalogue entries in data/characters.json point at a power id; this
 * module supplies the apply() implementation so new effects can be added
 * without touching the auction state machine.
 */

const POWER_REVEAL_MS = 2000;

const POWERS = {
  bonus_points: {
    id: "bonus_points",
    name: "Bonus points",
    description: "Add points to the team's purse.",
    apply(room, team, params = {}) {
      const raw = Number(params.points);
      const points = Number.isFinite(raw) ? Math.round(raw) : 10;
      team.purseLakhs = (Number(team.purseLakhs) || 0) + points;
      return { ok: true, effect: "bonus_points", points, purseLakhs: team.purseLakhs };
    },
  },
};

function publicPower(raw) {
  if (!raw || typeof raw !== "object" || !raw.id) return null;
  const impl = POWERS[raw.id];
  if (!impl) return null;
  const usesRaw = Number(raw.uses);
  const uses = Number.isFinite(usesRaw) ? Math.max(0, Math.round(usesRaw)) : 1;
  const params = raw.params && typeof raw.params === "object" ? { ...raw.params } : {};
  return {
    id: impl.id,
    name: String(raw.name || impl.name || impl.id),
    description: String(raw.description || impl.description || ""),
    uses,
    params,
  };
}

function getPowerImpl(id) {
  return (id && POWERS[id]) || null;
}

function applyPower(room, team, power) {
  if (!team) return { ok: false, error: "No team." };
  const def = publicPower(power) || publicPower(team.franchise && team.franchise.power);
  if (!def) return { ok: false, error: "This character has no power." };
  const impl = getPowerImpl(def.id);
  if (!impl || typeof impl.apply !== "function") {
    return { ok: false, error: "Unknown power." };
  }
  return impl.apply(room, team, def.params || {});
}

module.exports = {
  POWER_REVEAL_MS,
  POWERS,
  publicPower,
  getPowerImpl,
  applyPower,
};
