#!/usr/bin/env node
/**
 * IPL matches-as-captain counts for data/players.json.
 *
 * Source (accessed 2026-11-23):
 *   https://en.wikipedia.org/wiki/List_of_Indian_Premier_League_captains
 *   The captains table lists all 75 players who have captained at least one
 *   IPL match, organised by matches as captain, through the 2026 season
 *   (19 seasons, 2008–2026). Wikipedia cites ESPNcricinfo "Most matches as
 *   captain for Indian Premier League" as the underlying record.
 *
 * Cross-check:
 *   https://en.wikipedia.org/wiki/List_of_Indian_Premier_League_records_and_statistics
 *   "Most matches played as captain" agrees on the top five (Dhoni 235,
 *   Rohit 158, Kohli 143, Gambhir 129, Iyer 101) and also cites Cricinfo.
 *
 * Notes / uncertainties:
 *   - The Wikipedia article lead still says Dhoni has 229 matches and 134
 *     wins; the captains table and the records page both list 235 matches
 *     and 136 wins (Last: 2025). This script uses the table figure, 235.
 *   - The Cricinfo citation on the captains page is dated 11 July 2024,
 *     but the table itself has been updated through IPL 2026 (Shreyas Iyer,
 *     Rishabh Pant, Hardik Pandya, and others have Last = 2026). The 2026
 *     season had finished by the time this was compiled (November 2026).
 *     A late-season mismatch of a match or two is possible if Wikipedia
 *     lagged official scorecards, but the season was several months closed.
 *   - Name aliases: "K. L. Rahul" → "KL Rahul", "Steven Smith" → "Steve Smith".
 *   - Anyone in the 337-player pool who is not on the 75-captain list is 0
 *     (never captained an IPL match). Champions League T20 and similar
 *     tournaments are excluded, per the Wikipedia notes.
 *
 * Usage: node scripts/captain-matches.js
 * Writes captainMatches onto every player in data/players.json and prints a
 * short summary. Safe to re-run.
 */
const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "data", "players.json");

// Wikipedia "List of Indian Premier League captains" table, matches column.
const WIKI_COUNTS = {
  "MS Dhoni": 235,
  "Rohit Sharma": 158,
  "Virat Kohli": 143,
  "Gautam Gambhir": 129,
  "Shreyas Iyer": 101,
  "David Warner": 83,
  "Adam Gilchrist": 74,
  "Rishabh Pant": 71,
  "Hardik Pandya": 70,
  "Sanju Samson": 67,
  "K. L. Rahul": 64,
  "Shane Warne": 55,
  "Virender Sehwag": 53,
  "Ajinkya Rahane": 52,
  "Sachin Tendulkar": 51,
  "Rahul Dravid": 48,
  "Kumar Sangakkara": 47,
  "Kane Williamson": 46,
  "Faf du Plessis": 44,
  "Dinesh Karthik": 43,
  "Shubman Gill": 43,
  "Steven Smith": 43,
  "Yuvraj Singh": 43,
  "Saurav Ganguly": 42,
  "Pat Cummins": 38,
  "Suresh Raina": 34,
  "Ruturaj Gaikwad": 33,
  "George Bailey": 30,
  "Mahela Jayawardene": 30,
  "Rajat Patidar": 28,
  "Ravichandran Ashwin": 28,
  "Axar Patel": 27,
  "Shikhar Dhawan": 27,
  "Anil Kumble": 26,
  "Eoin Morgan": 24,
  "Shane Watson": 24,
  "Zaheer Khan": 23,
  "Daniel Vettori": 22,
  "Riyan Parag": 22,
  "Harbhajan Singh": 20,
  "Kevin Pietersen": 17,
  "JP Duminy": 16,
  "Mayank Agarwal": 14,
  "Glenn Maxwell": 14,
  "Nitish Rana": 14,
  "Brendon McCullum": 14,
  "Aiden Markram": 13,
  "Cameron White": 12,
  "David Hussey": 12,
  "Sam Curran": 11,
  "Aaron Finch": 10,
  "Murali Vijay": 8,
  "Bhuvneshwar Kumar": 8,
  "Ravindra Jadeja": 8,
  "Ishan Kishan": 7,
  "Kieron Pollard": 6,
  "Krunal Pandya": 6,
  "David Miller": 6,
  "V. V. S. Laxman": 6,
  "Ricky Ponting": 6,
  "Suryakumar Yadav": 5,
  "Angelo Mathews": 5,
  "Shaun Pollock": 4,
  "Jitesh Sharma": 4,
  "Darren Sammy": 4,
  "Karun Nair": 3,
  "Rashid Khan": 3,
  "James Hopes": 3,
  "Yashasvi Jaiswal": 2,
  "Jasprit Bumrah": 1,
  "Nicholas Pooran": 1,
  "Ross Taylor": 1,
  "Dwayne Bravo": 1,
  "Manish Pandey": 1,
  "Parthiv Patel": 1,
};

const ALIASES = {
  "kl rahul": "K. L. Rahul",
  "k l rahul": "K. L. Rahul",
  "k.l. rahul": "K. L. Rahul",
  "steve smith": "Steven Smith",
  "steven smith": "Steven Smith",
};

function norm(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const byNorm = new Map();
for (const [name, count] of Object.entries(WIKI_COUNTS)) {
  byNorm.set(norm(name), { name, count });
}
for (const [alias, target] of Object.entries(ALIASES)) {
  const row = byNorm.get(norm(target));
  if (row) byNorm.set(norm(alias), row);
}

function countFor(name) {
  const row = byNorm.get(norm(name));
  return row ? row.count : 0;
}

function apply() {
  const raw = JSON.parse(fs.readFileSync(DATA, "utf8"));
  const players = raw.players || [];
  let captained = 0;
  const applied = [];
  for (const p of players) {
    const n = countFor(p.name);
    p.captainMatches = n;
    if (n > 0) {
      captained += 1;
      applied.push({ id: p.id, name: p.name, captainMatches: n });
    }
  }
  raw.meta = raw.meta || {};
  raw.meta.captainMatches = "IPL official matches as captain through the 2026 season. 0 if the player never captained. See scripts/captain-matches.js for sources and notes.";
  raw.meta.updated = "2026-11";
  fs.writeFileSync(DATA, `${JSON.stringify(raw, null, 2)}\n`);
  applied.sort((a, b) => b.captainMatches - a.captainMatches || a.name.localeCompare(b.name));
  return { total: players.length, captained, zero: players.length - captained, applied };
}

if (require.main === module) {
  const { total, captained, zero, applied } = apply();
  console.log(`Updated ${total} players: ${captained} with IPL captaincy matches, ${zero} at 0.`);
  for (const row of applied) {
    console.log(`  ${row.captainMatches.toString().padStart(3)}  ${row.name}`);
  }
  const wikiInPool = Object.keys(WIKI_COUNTS).filter((name) => countFor(name) && applied.some((r) => r.captainMatches === WIKI_COUNTS[name] && norm(r.name) === norm(name) || ALIASES[norm(r.name)] === name));
  const missingFromPool = Object.keys(WIKI_COUNTS).filter((name) => !applied.some((r) => r.captainMatches === WIKI_COUNTS[name] && (norm(r.name) === norm(name) || ALIASES[norm(r.name)] === name)));
  // Simpler: names in the wiki list with no pool player of that (aliased) name.
  const poolNames = new Set((JSON.parse(fs.readFileSync(DATA, "utf8")).players || []).map((p) => norm(p.name)));
  const notInPool = Object.keys(WIKI_COUNTS).filter((name) => {
    if (poolNames.has(norm(name))) return false;
    for (const [alias, target] of Object.entries(ALIASES)) {
      if (target === name && poolNames.has(norm(alias))) return false;
    }
    return true;
  });
  console.log(`Wikipedia captains not in this pool (${notInPool.length}): ${notInPool.join(", ")}`);
}

module.exports = { WIKI_COUNTS, ALIASES, countFor, apply, norm };
