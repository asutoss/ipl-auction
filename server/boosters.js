/** Funny, modest tournament boosters bought with leftover auction points. */

const FORM_SELF_ID = "net-session";
const FORM_RIVAL_ID = "nazar";

const BOOSTERS = [
  {
    id: "friendly-umpire",
    name: "Friendly Umpire",
    pricePoints: 22,
    impact: { size: "medium", bars: 2, line: "Win chance about +13%.", score: 14.546, titleWinPp: 13 },
    blurb: "Close calls go your way. A small chance to turn a narrow loss into a win.",
  },
  {
    id: "home-curator",
    name: "Home Pitch Curator",
    pricePoints: 25,
    impact: { size: "big", bars: 3, line: "Win chance about +16%.", score: 18.154, titleWinPp: 16 },
    blurb: "A surface that suits your attack. Modest bowling boost every match.",
  },
  {
    id: "drs-wizard",
    name: "DRS Wizard",
    pricePoints: 10,
    impact: { size: "small", bars: 1, line: "Win chance about +2%.", score: 1.848, titleWinPp: 2 },
    blurb: "A slim chance to overturn a narrow defeat on review.",
  },
  {
    id: "dew-factor",
    name: "Dew Factor",
    pricePoints: 26,
    impact: { size: "big", bars: 3, line: "Win chance about +17%.", score: 19.046, titleWinPp: 17 },
    blurb: "Chasing under lights gets a modest batting bump.",
  },
  {
    id: "cheerleaders",
    name: "Cheerleader Squad",
    pricePoints: 21,
    impact: { size: "medium", bars: 2, line: "Win chance about +12%.", score: 13.532, titleWinPp: 12 },
    blurb: "Crowd morale. Your whole team plays a touch stronger.",
  },
  {
    id: "rain-dance",
    name: "Rain Dance",
    pricePoints: 11,
    impact: { size: "small", bars: 1, line: "Win chance about +3%.", score: 3.243, titleWinPp: 3 },
    blurb: "A chance to wash a league loss out into a no-result.",
  },
  {
    id: "lucky-toss",
    name: "Lucky Toss Coin",
    pricePoints: 12,
    impact: { size: "small", bars: 1, line: "Win chance about +3%.", score: 3.671, titleWinPp: 3 },
    blurb: "You usually win the toss and pick the more favourable option.",
  },
  {
    id: "bus-breakdown",
    name: "Team Bus Breakdown",
    pricePoints: 30,
    impact: { size: "big", bars: 3, line: "Win chance about +4%. Rival title chance about -16%.", score: 22.966, titleWinPp: 4 },
    blurb: "Sabotage: one random rival arrives late and plays below par in every match.",
  },
  {
    id: FORM_SELF_ID,
    name: "Net Session Masterclass",
    pricePoints: 19,
    effect: "form-self",
    impact: { size: "medium", bars: 2, line: "Win chance about +10%. Form re-rolled to 101–115% if below 100.", score: 10.915, titleWinPp: 10 },
    blurb: "A week of throwdowns in the nets. Guarantees your Current form finishes above 100%.",
  },
  {
    id: FORM_RIVAL_ID,
    name: "Nazar Lag Gayi",
    pricePoints: 20,
    effect: "form-rival",
    impact: { size: "medium", bars: 2, line: "Win chance about +2%. Rival form below 100% (title chance about -9%).", score: 12.414, titleWinPp: 2 },
    needsTarget: true,
    blurb: "A lingering stare from the stands. Pick a rival and force their Current form below 100%.",
  },
];

function getBooster(id) {
  return BOOSTERS.find((b) => b.id === id) || null;
}

function cheapestPrice(ownedIds = []) {
  const owned = new Set(ownedIds);
  const left = BOOSTERS.filter((b) => !owned.has(b.id));
  if (!left.length) return Infinity;
  return Math.min(...left.map((b) => b.pricePoints));
}

function hasBooster(team, id) {
  return (team.boosters || []).some((b) => b.id === id);
}

function ownedIds(team) {
  return (team.boosters || []).map((b) => b.id);
}

function canAffordAny(team) {
  if (!team || team.eliminated) return false;
  return (team.purseLakhs || 0) >= cheapestPrice(ownedIds(team));
}

function packImpact(b) {
  if (!b || !b.impact) return null;
  return {
    size: b.impact.size || "medium",
    bars: Number(b.impact.bars) || 2,
    line: b.impact.line || "",
    score: Number(b.impact.score) || 0,
    titleWinPp: Number.isFinite(Number(b.impact.titleWinPp)) ? Number(b.impact.titleWinPp) : null,
  };
}

function catalogByImpact(list) {
  return (list || []).slice().sort((a, b) => {
    const as = Number(a && a.impact && a.impact.score) || 0;
    const bs = Number(b && b.impact && b.impact.score) || 0;
    return bs - as;
  });
}

function publicCatalog() {
  return catalogByImpact(BOOSTERS.map((b) => ({
    id: b.id,
    name: b.name,
    pricePoints: b.pricePoints,
    blurb: b.blurb,
    needsTarget: Boolean(b.needsTarget),
    effect: b.effect || null,
    impact: packImpact(b),
  })));
}

function packBooster(b) {
  if (!b) return null;
  const item = getBooster(b.id);
  return {
    id: b.id,
    name: b.name,
    pricePoints: b.pricePoints,
    targetName: b.targetName || null,
    targetShort: b.targetName || null,
    impact: packImpact(item || b),
  };
}

function rngRandom(rng) {
  if (typeof rng === "function") return rng;
  if (rng && typeof rng.random === "function") return rng.random.bind(rng);
  return Math.random;
}

function rollUniformPct(rng, lo, hi) {
  const random = rngRandom(rng);
  const min = Math.min(lo, hi);
  const max = Math.max(lo, hi);
  return min + Math.floor(random() * (max - min + 1));
}

function applyFormBoosters(teams, rng) {
  const list = Array.isArray(teams) ? teams : [];
  const byName = new Map(list.map((t) => [t.name, t]));
  const original = new Map(list.map((t) => [t.name, t.formPct != null ? t.formPct : null]));
  const curses = new Map();
  for (const team of list) {
    const bought = (team.boosters || []).find((b) => b.id === FORM_RIVAL_ID);
    if (!bought || !bought.targetName) continue;
    const target = byName.get(bought.targetName);
    if (!target || target.eliminated) continue;
    if (!curses.has(target.name)) curses.set(target.name, []);
    curses.get(target.name).push(team);
  }
  const selfOwners = list.filter((t) => !t.eliminated && hasBooster(t, FORM_SELF_ID));
  const names = new Set([...selfOwners.map((t) => t.name), ...curses.keys()]);
  const events = [];
  const selfName = (getBooster(FORM_SELF_ID) || {}).name || "Net Session Masterclass";
  const curseName = (getBooster(FORM_RIVAL_ID) || {}).name || "Nazar Lag Gayi";

  function casterLabel(casters) {
    return casters.map((c) => c.name).join(" & ");
  }

  for (const name of names) {
    const team = byName.get(name);
    if (!team) continue;
    const from = original.get(name);
    const hasSelf = hasBooster(team, FORM_SELF_ID);
    const casters = curses.get(name) || [];
    if (hasSelf && casters.length) {
      events.push({
        kind: "cancel",
        teamName: name,
        from,
        to: from,
        casters: casters.map((c) => c.name),
        boosterName: curseName,
        message: `${curseName} from ${casterLabel(casters)} and ${selfName} on ${name} cancel out — form stays ${from}%`,
      });
      continue;
    }
    if (hasSelf) {
      if (from != null && Number(from) > 100) {
        events.push({
          kind: "self-noop",
          teamName: name,
          from,
          to: from,
          boosterName: selfName,
          message: `${selfName}: ${name} form already ${from}%`,
        });
      } else {
        const to = rollUniformPct(rng, 101, 115);
        team.formPct = to;
        events.push({
          kind: "self",
          teamName: name,
          from,
          to,
          boosterName: selfName,
          message: `${selfName}: ${name} form ${from}% -> ${to}%`,
        });
      }
      continue;
    }
    if (casters.length) {
      if (from != null && Number(from) < 100) {
        events.push({
          kind: "curse-noop",
          teamName: name,
          from,
          to: from,
          casters: casters.map((c) => c.name),
          boosterName: curseName,
          message: `${curseName} from ${casterLabel(casters)}: ${name} form already ${from}%`,
        });
      } else {
        const to = rollUniformPct(rng, 85, 99);
        team.formPct = to;
        events.push({
          kind: "curse",
          teamName: name,
          from,
          to,
          casters: casters.map((c) => c.name),
          boosterName: curseName,
          message: `${curseName} from ${casterLabel(casters)}: ${name} form ${from}% -> ${to}%`,
        });
      }
    }
  }
  return events;
}

module.exports = {
  BOOSTERS,
  FORM_SELF_ID,
  FORM_RIVAL_ID,
  getBooster,
  cheapestPrice,
  hasBooster,
  ownedIds,
  canAffordAny,
  publicCatalog,
  packBooster,
  packImpact,
  catalogByImpact,
  rollUniformPct,
  applyFormBoosters,
};
