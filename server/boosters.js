/** Funny, modest tournament boosters bought with leftover auction points. */

const BOOSTERS = [
  {
    id: "friendly-umpire",
    name: "Friendly Umpire",
    pricePoints: 20,
    blurb: "Close calls go your way. A small chance to turn a narrow loss into a win.",
  },
  {
    id: "home-curator",
    name: "Home Pitch Curator",
    pricePoints: 22,
    blurb: "A surface that suits your attack. Modest bowling boost every match.",
  },
  {
    id: "drs-wizard",
    name: "DRS Wizard",
    pricePoints: 18,
    blurb: "A slim chance to overturn a narrow defeat on review.",
  },
  {
    id: "dew-factor",
    name: "Dew Factor",
    pricePoints: 20,
    blurb: "Chasing under lights gets a modest batting bump.",
  },
  {
    id: "cheerleaders",
    name: "Cheerleader Squad",
    pricePoints: 15,
    blurb: "Crowd morale. Your whole team plays a touch stronger.",
  },
  {
    id: "rain-dance",
    name: "Rain Dance",
    pricePoints: 28,
    blurb: "A chance to wash a league loss out into a no-result.",
  },
  {
    id: "lucky-toss",
    name: "Lucky Toss Coin",
    pricePoints: 16,
    blurb: "You usually win the toss and pick the more favourable option.",
  },
  {
    id: "bus-breakdown",
    name: "Team Bus Breakdown",
    pricePoints: 32,
    blurb: "Sabotage: one random rival arrives late and plays below par in every match.",
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

function publicCatalog() {
  return BOOSTERS.map((b) => ({
    id: b.id,
    name: b.name,
    pricePoints: b.pricePoints,
    blurb: b.blurb,
  }));
}

module.exports = {
  BOOSTERS,
  getBooster,
  cheapestPrice,
  hasBooster,
  ownedIds,
  canAffordAny,
  publicCatalog,
};
