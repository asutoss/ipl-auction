#!/usr/bin/env node
/**
 * Monte Carlo measurement of each booster's effect on title-win chance
 * and average finishing position, versus the same tournaments with no
 * booster. Typical complete Classical squads, 4–8 teams.
 *
 * Usage:
 *   node scripts/booster-impact.js
 *   node scripts/booster-impact.js --trials=2000 --quick
 *
 * Writes scripts/booster-impact.json (and prints a table).
 */
const fs = require("fs");
const path = require("path");
const { loadPlayers } = require("../server/players");
const { simulateTournament, rollTeamForm, mulberry32, pickCaptainIfMissing } = require("../server/simulate");
const { BOOSTERS, FORM_SELF_ID, FORM_RIVAL_ID, applyFormBoosters, getBooster } = require("../server/boosters");
const { QUOTA } = require("../server/rules");

const OUT = path.join(__dirname, "booster-impact.json");
const BUYER = "Buyer";
const RIVAL = "Rival";
const SIZES = [4, 5, 6, 7, 8];
const DEFAULT_TRIALS = 2000;
const ROOT_SEED = 20261123;

function argNum(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const n = Number(hit.slice(name.length + 3));
  return Number.isFinite(n) ? n : fallback;
}

const QUICK = process.argv.includes("--quick");
const TRIALS = argNum("trials", QUICK ? 250 : DEFAULT_TRIALS);
const SIZES_USED = QUICK ? [4, 6, 8] : SIZES;

const { players } = loadPlayers();

function mix(a, b) {
  return (Math.imul(a ^ b, 0x9e3779b9) ^ (a >>> 16)) >>> 0;
}

function rngOf(seed) {
  return mulberry32(seed >>> 0);
}

function shuffle(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function teamNames(n) {
  const names = [BUYER, RIVAL];
  for (let i = 3; i <= n; i++) names.push(`Team ${i}`);
  return names.slice(0, n);
}

function dealSquads(n, seed) {
  const rng = rngOf(seed);
  const names = teamNames(n);
  const teams = names.map((name, i) => ({
    name,
    franchise: { id: `t${i}`, color: "#c9a227", text: "#f5c518" },
    squad: [],
    boosters: [],
    formPct: null,
    captainId: null,
    mode: "classical",
  }));
  const quota = QUOTA || { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
  for (const role of Object.keys(quota)) {
    const pool = shuffle(players.filter((p) => p.role === role), rng);
    const need = quota[role];
    let idx = 0;
    for (let slot = 0; slot < need; slot++) {
      for (let t = 0; t < n; t++) {
        const player = pool[idx++];
        if (!player) throw new Error(`not enough ${role} players for ${n} teams`);
        teams[t].squad.push({ player, priceLakhs: 2 });
      }
    }
  }
  for (const team of teams) {
    team.captainId = pickCaptainIfMissing(team);
  }
  const ranks = shuffle(names.map((_, i) => i + 1), rng);
  for (let i = 0; i < n; i++) {
    teams[i].formPct = rollTeamForm(rng, { rank: ranks[i], total: n });
  }
  return teams;
}

function cloneTeams(teams) {
  return teams.map((t) => ({
    ...t,
    boosters: (t.boosters || []).map((b) => ({ ...b })),
    squad: t.squad,
  }));
}

function giveBooster(teams, booster, targetName, formSeed) {
  const copy = cloneTeams(teams);
  const buyer = copy.find((t) => t.name === BUYER);
  const packed = {
    id: booster.id,
    name: booster.name,
    pricePoints: booster.pricePoints,
    targetName: targetName || null,
  };
  buyer.boosters = [packed];
  if (booster.id === FORM_SELF_ID || booster.id === FORM_RIVAL_ID) {
    applyFormBoosters(copy, rngOf(mix(formSeed || ROOT_SEED, 0xf047)));
  }
  return copy;
}

function posOf(result, name) {
  const row = (result.positions || []).find((p) => p.name === name);
  return row ? row.position : null;
}

function isChamp(result, name) {
  return Boolean(result.champion && result.champion.name === name);
}

function predictBusVictim(teams, seed) {
  const rng = rngOf(seed);
  const buyer = teams.find((t) => (t.boosters || []).some((b) => b.id === "bus-breakdown"));
  if (!buyer) return null;
  const rivals = teams.filter((x) => x.name !== buyer.name);
  if (!rivals.length) return null;
  return rivals[Math.floor(rng() * rivals.length)].name;
}

function emptyAcc() {
  return {
    n: 0,
    buyerWins0: 0,
    buyerWins1: 0,
    buyerPos0: 0,
    buyerPos1: 0,
    rivalWins0: 0,
    rivalWins1: 0,
    rivalPos0: 0,
    rivalPos1: 0,
    hasRival: false,
  };
}

function addTrial(acc, base, treat, { rivalName } = {}) {
  acc.n += 1;
  if (isChamp(base, BUYER)) acc.buyerWins0 += 1;
  if (isChamp(treat, BUYER)) acc.buyerWins1 += 1;
  acc.buyerPos0 += posOf(base, BUYER);
  acc.buyerPos1 += posOf(treat, BUYER);
  if (rivalName) {
    acc.hasRival = true;
    if (isChamp(base, rivalName)) acc.rivalWins0 += 1;
    if (isChamp(treat, rivalName)) acc.rivalWins1 += 1;
    acc.rivalPos0 += posOf(base, rivalName);
    acc.rivalPos1 += posOf(treat, rivalName);
  }
}

function summarize(acc) {
  const n = acc.n || 1;
  const win0 = acc.buyerWins0 / n;
  const win1 = acc.buyerWins1 / n;
  const pos0 = acc.buyerPos0 / n;
  const pos1 = acc.buyerPos1 / n;
  const out = {
    trials: acc.n,
    buyerWin0: win0,
    buyerWin1: win1,
    buyerWinDelta: win1 - win0,
    buyerPos0: pos0,
    buyerPos1: pos1,
    buyerPosDelta: pos1 - pos0,
  };
  if (acc.hasRival) {
    const rWin0 = acc.rivalWins0 / n;
    const rWin1 = acc.rivalWins1 / n;
    const rPos0 = acc.rivalPos0 / n;
    const rPos1 = acc.rivalPos1 / n;
    out.rivalWin0 = rWin0;
    out.rivalWin1 = rWin1;
    out.rivalWinDelta = rWin1 - rWin0;
    out.rivalPos0 = rPos0;
    out.rivalPos1 = rPos1;
    out.rivalPosDelta = rPos1 - rPos0;
  }
  return out;
}

function pct(delta, digits = 1) {
  const n = Number(delta) * 100;
  const rounded = Number(n.toFixed(digits));
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(digits)}`;
}

function place(delta, digits = 2) {
  const n = Number(delta);
  const rounded = Number(n.toFixed(digits));
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(digits)}`;
}

function run() {
  const started = Date.now();
  const acc = new Map(BOOSTERS.map((b) => [b.id, emptyAcc()]));
  let sims = 0;
  for (const nTeams of SIZES_USED) {
    for (let trial = 0; trial < TRIALS; trial++) {
      const buildSeed = mix(mix(ROOT_SEED, nTeams), trial * 0x85ebca6b);
      const teams = dealSquads(nTeams, buildSeed);
      const simSeed = mix(buildSeed, 0x27d4eb2d);
      const baseline = simulateTournament(cloneTeams(teams), simSeed, { mode: "classical" });
      sims += 1;
      for (const booster of BOOSTERS) {
        const target = booster.needsTarget ? RIVAL : null;
        const treatedTeams = giveBooster(teams, booster, target, buildSeed);
        const treated = simulateTournament(treatedTeams, simSeed, { mode: "classical" });
        sims += 1;
        let rivalName = null;
        if (booster.id === "bus-breakdown") {
          rivalName = predictBusVictim(treatedTeams, simSeed);
        } else if (booster.id === FORM_RIVAL_ID) {
          rivalName = RIVAL;
        }
        addTrial(acc.get(booster.id), baseline, treated, { rivalName });
      }
    }
    process.stderr.write(`finished ${nTeams} teams × ${TRIALS} trials\n`);
  }

  const results = BOOSTERS.map((b) => {
    const stats = summarize(acc.get(b.id));
    return {
      id: b.id,
      name: b.name,
      oldPrice: b.pricePoints,
      ...stats,
    };
  });

  // Impact score in title-percentage-point equivalents.
  // 1 finishing place ≈ 2 pp of title chance. Sabotage boosters also count
  // harm to the targeted rival, since that is most of their real impact.
  for (const row of results) {
    const buyer = Math.abs(row.buyerWinDelta) * 100 + Math.abs(row.buyerPosDelta) * 2;
    const rival = row.rivalWinDelta != null
      ? Math.abs(row.rivalWinDelta) * 100 + Math.abs(row.rivalPosDelta) * 2
      : 0;
    row.score = buyer + rival;
  }
  const scores = results.map((r) => r.score);
  const minS = Math.min(...scores);
  const maxS = Math.max(...scores);
  for (const row of results) {
    const t = maxS === minS ? 0.5 : (row.score - minS) / (maxS - minS);
    row.newPrice = Math.round(10 + t * 20);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    rootSeed: ROOT_SEED,
    trialsPerSize: TRIALS,
    sizes: SIZES_USED,
    simulations: sims,
    elapsedMs: Date.now() - started,
    note: "Paired tournaments: typical complete Classical XIs, form rolled by shuffled completion rank. Buyer gets exactly one booster; everyone else has none. Title-win and finishing-position deltas are versus the same squads and seed with no booster. Bus Breakdown's rival is the randomly chosen victim in that tournament; Nazar Lag Gayi's rival is a fixed opponent.",
    results,
  };

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");

  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  console.log(`Booster impact (${TRIALS} trials × ${SIZES_USED.join("/")} teams, ${sims} sims, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  console.log(
    pad("Booster", 26) +
      padL("Win Δ", 10) +
      padL("Finish Δ", 10) +
      padL("Rival win Δ", 13) +
      padL("Rival fin Δ", 13) +
      padL("Score", 8) +
      padL("Old", 6) +
      padL("New", 6)
  );
  for (const row of results.slice().sort((a, b) => b.score - a.score)) {
    console.log(
      pad(row.name, 26) +
        padL(`${pct(row.buyerWinDelta)} pp`, 10) +
        padL(place(row.buyerPosDelta), 10) +
        padL(row.rivalWinDelta != null ? `${pct(row.rivalWinDelta)} pp` : "—", 13) +
        padL(row.rivalPosDelta != null ? place(row.rivalPosDelta) : "—", 13) +
        padL(row.score.toFixed(2), 8) +
        padL(row.oldPrice, 6) +
        padL(row.newPrice, 6)
    );
  }
  console.log(`wrote ${OUT}`);
}

run();
