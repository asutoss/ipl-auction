const fs = require("fs");
const path = require("path");
const { BASE_PRICE_POINTS } = require("./rules");

const DATA_PATH = path.join(__dirname, "..", "data", "players.json");

function loadPlayers() {
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const players = (raw.players || []).map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    overseas: Boolean(p.overseas),
    country: p.country || (p.overseas ? "OS" : "IND"),
    basePriceLakhs: BASE_PRICE_POINTS,
    batting: Number(p.batting),
    bowling: Number(p.bowling),
  }));
  return { meta: raw.meta || {}, players };
}

function overallRating(player) {
  if (!player) return 0;
  switch (player.role) {
    case "BAT":
      return player.batting * 0.9 + player.bowling * 0.1;
    case "WK":
      return player.batting * 0.9 + player.bowling * 0.1;
    case "AR":
      return player.batting * 0.5 + player.bowling * 0.5;
    case "BOWL":
      return player.bowling * 0.9 + player.batting * 0.1;
    default:
      return (player.batting + player.bowling) / 2;
  }
}

function clonePlayer(p) {
  return { ...p };
}

module.exports = { loadPlayers, overallRating, clonePlayer, DATA_PATH };
