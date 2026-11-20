const { overallRating } = require("./players");
const { ROLES, QUOTA } = require("./rules");

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng, mean, sd) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * sd;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function ballsToOvers(balls) {
  const full = Math.floor(balls / 6);
  const rem = balls % 6;
  return full + rem / 10;
}

function playerRatings(slot, isCaptain) {
  const p = slot.player;
  const boost = isCaptain ? 1.05 : 1;
  return { batting: p.batting * boost, bowling: p.bowling * boost };
}

// Expected batting unit: 4 BAT + 1 WK + 2 AR. Bowling unit: 2 AR + 4 BOWL.
// Missing players count as 0, so lopsided squads are weaker. Extra players
// are averaged in (whole squad counts; no XI trimming).
const EXPECTED_BATTERS = 7;
const EXPECTED_BOWLERS = 6;

function teamStrength(franchise) {
  const squad = franchise.squad || [];
  const captainId = franchise.captainId;
  let batSum = 0;
  let batN = 0;
  let bowlSum = 0;
  let bowlN = 0;
  for (const slot of squad) {
    const isCap = slot.player.id === captainId;
    const r = playerRatings(slot, isCap);
    const role = slot.player.role;
    // Only BAT, WK and AR bat; only AR and BOWL bowl.
    if (role === "BAT" || role === "WK") {
      batSum += r.batting;
      batN += 1;
    } else if (role === "AR") {
      batSum += r.batting;
      batN += 1;
      bowlSum += r.bowling;
      bowlN += 1;
    } else if (role === "BOWL") {
      bowlSum += r.bowling;
      bowlN += 1;
    }
  }
  const batting = batSum / Math.max(batN, EXPECTED_BATTERS);
  const bowling = bowlSum / Math.max(bowlN, EXPECTED_BOWLERS);
  const strength = 0.52 * batting + 0.48 * bowling;
  return { batting, bowling, strength, batN, bowlN };
}

function inningsBallsAndWickets(rng, bowling, allOutLikely) {
  const wickets = clamp(Math.round(gauss(rng, 4.5 + (bowling - 75) * 0.06, 1.6)), 1, 10);
  let balls = 120;
  if (wickets === 10 || allOutLikely) {
    balls = clamp(Math.round(gauss(rng, 110, 10)), 72, 120);
  }
  return { balls, wickets };
}

function playInnings({ rng, batting, bowling, target }) {
  const expected = 155 + (batting - bowling) * 0.85;
  let mean = expected;
  if (target != null) {
    const pressure = Math.max(0, (target - 180) * 0.15);
    mean = expected - pressure;
  }
  const raw = gauss(rng, mean, 16);

  if (target == null) {
    const score = Math.round(clamp(raw, 95, 265));
    const { balls, wickets } = inningsBallsAndWickets(rng, bowling, score < 130);
    return { score, wickets, balls };
  }

  if (raw >= target) {
    const margin = raw - target;
    const early = margin > 25;
    const balls = early
      ? clamp(Math.round(gauss(rng, 100, 10)), 70, 118)
      : clamp(Math.round(gauss(rng, 114, 5)), 100, 120);
    const wickets = clamp(Math.round(gauss(rng, early ? 3 : 5, 1.5)), 0, 8);
    return { score: target, wickets, balls, chased: true };
  }

  const score = Math.round(clamp(raw, 80, target - 1));
  const allOut = score < target - 15 && rng() < 0.45;
  const { balls, wickets } = inningsBallsAndWickets(rng, bowling, allOut);
  return { score, wickets: allOut ? 10 : Math.min(wickets, 9), balls: allOut ? Math.min(balls, 119) : 120, chased: false };
}

function playMatch(teamA, teamB, rng, label) {
  const a = teamStrength(teamA);
  const b = teamStrength(teamB);
  const aBatsFirst = rng() < 0.5;
  const first = aBatsFirst ? teamA : teamB;
  const second = aBatsFirst ? teamB : teamA;
  const firstS = aBatsFirst ? a : b;
  const secondS = aBatsFirst ? b : a;

  const inn1 = playInnings({ rng, batting: firstS.batting, bowling: secondS.bowling, target: null });
  const inn2 = playInnings({
    rng,
    batting: secondS.batting,
    bowling: firstS.bowling,
    target: inn1.score + 1,
  });

  const chased = inn2.score >= inn1.score + 1;
  const winner = chased ? second : first;
  const loser = chased ? first : second;

  function card(team, inn, battingFirst) {
    return {
      name: team.name,
      franchise: team.franchise,
      score: inn.score,
      wickets: inn.wickets,
      balls: inn.balls,
      overs: ballsToOvers(inn.balls).toFixed(1),
      battingFirst,
    };
  }

  const firstCard = card(first, inn1, true);
  const secondCard = card(second, inn2, false);

  let resultText;
  if (chased) {
    const wkts = 10 - inn2.wickets;
    resultText = `${second.franchise.short} won by ${wkts} wicket${wkts === 1 ? "" : "s"}`;
  } else {
    const runs = inn1.score - inn2.score;
    resultText = `${first.franchise.short} won by ${runs} run${runs === 1 ? "" : "s"}`;
  }

  return {
    id: `${label}-${teamA.franchise.short}-${teamB.franchise.short}`,
    label,
    teamA: teamA.name,
    teamB: teamB.name,
    shortA: teamA.franchise.short,
    shortB: teamB.franchise.short,
    colorA: teamA.franchise.color,
    colorB: teamB.franchise.color,
    toss: `${first.franchise.short} elected to bat`,
    firstInnings: firstCard,
    secondInnings: secondCard,
    winnerName: winner.name,
    winnerShort: winner.franchise.short,
    loserName: loser.name,
    resultText,
  };
}

function emptyRow(team) {
  return {
    name: team.name,
    franchise: team.franchise,
    played: 0,
    won: 0,
    lost: 0,
    points: 0,
    runsFor: 0,
    ballsFaced: 0,
    runsAgainst: 0,
    ballsBowled: 0,
    nrr: 0,
  };
}

function applyMatchToTable(tableByName, match) {
  const first = match.firstInnings;
  const second = match.secondInnings;
  const a = tableByName[first.name];
  const b = tableByName[second.name];
  a.played += 1;
  b.played += 1;
  a.runsFor += first.score;
  a.ballsFaced += first.balls;
  a.runsAgainst += second.score;
  a.ballsBowled += second.balls;
  b.runsFor += second.score;
  b.ballsFaced += second.balls;
  b.runsAgainst += first.score;
  b.ballsBowled += first.balls;
  const winnerRow = tableByName[match.winnerName];
  const loserRow = tableByName[match.loserName];
  winnerRow.won += 1;
  winnerRow.points += 2;
  loserRow.lost += 1;
}

function computeNrr(row) {
  const overFaced = row.ballsFaced / 6;
  const overBowled = row.ballsBowled / 6;
  if (overFaced <= 0 || overBowled <= 0) return 0;
  row.nrr = row.runsFor / overFaced - row.runsAgainst / overBowled;
  return row.nrr;
}

function sortTable(rows) {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.nrr !== a.nrr) return b.nrr - a.nrr;
    return b.runsFor - a.runsFor;
  });
}

function snapshotTable(rows) {
  return sortTable(rows).map((r, i) => ({
    position: i + 1,
    name: r.name,
    short: r.franchise.short,
    color: r.franchise.color,
    franchiseName: r.franchise.name,
    played: r.played,
    won: r.won,
    lost: r.lost,
    points: r.points,
    nrr: Number(r.nrr.toFixed(3)),
  }));
}

function findTeam(teams, name) {
  return teams.find((t) => t.name === name);
}

function leagueFixtures(teams) {
  const fixtures = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      fixtures.push([teams[i], teams[j]]);
    }
  }
  return fixtures;
}

function pickCaptainIfMissing(team) {
  if (team.captainId && team.squad.some((s) => s.player.id === team.captainId)) {
    return team.captainId;
  }
  let best = null;
  let bestScore = -1;
  for (const slot of team.squad) {
    const score = overallRating(slot.player);
    if (score > bestScore) {
      bestScore = score;
      best = slot.player.id;
    }
  }
  return best;
}

function awards(teams) {
  const bought = [];
  for (const t of teams) {
    for (const slot of t.squad) {
      const overall = overallRating(slot.player);
      const price = slot.priceLakhs || slot.player.basePriceLakhs || 20;
      bought.push({
        player: slot.player,
        overall,
        priceLakhs: price,
        teamName: t.name,
        short: t.franchise.short,
        color: t.franchise.color,
        value: overall / Math.max(price / 100, 0.2),
        flop: price / Math.max(overall, 1),
      });
    }
  }
  if (bought.length === 0) {
    return { bestBuy: null, costliestFlop: null };
  }

  const bestBuy = [...bought].sort((a, b) => b.value - a.value)[0];
  const expensive = bought.filter((b) => b.priceLakhs >= 500);
  const pool = expensive.length ? expensive : [...bought].sort((a, b) => b.priceLakhs - a.priceLakhs).slice(0, Math.max(3, Math.ceil(bought.length / 3)));
  const below = pool.filter((b) => b.overall < 80);
  const flopPool = below.length ? below : pool;
  const costliestFlop = [...flopPool].sort((a, b) => b.flop - a.flop || b.priceLakhs - a.priceLakhs)[0];

  function pack(entry, reason) {
    if (!entry) return null;
    return {
      playerId: entry.player.id,
      playerName: entry.player.name,
      role: entry.player.role,
      overall: Number(entry.overall.toFixed(1)),
      priceLakhs: entry.priceLakhs,
      teamName: entry.teamName,
      short: entry.short,
      color: entry.color,
      reason,
    };
  }

  return {
    bestBuy: pack(
      bestBuy,
      `Rating ${bestBuy.overall.toFixed(0)} for ₹${(bestBuy.priceLakhs / 100).toFixed(2)} Cr`
    ),
    costliestFlop: pack(
      costliestFlop,
      `Paid ₹${(costliestFlop.priceLakhs / 100).toFixed(2)} Cr for a ${costliestFlop.overall.toFixed(0)} rating`
    ),
  };
}

function simulateTournament(franchises, seed) {
  const teams = franchises.map((f) => ({
    ...f,
    captainId: pickCaptainIfMissing(f),
  }));
  const rng = mulberry32(seed >>> 0);
  const tableByName = {};
  for (const t of teams) tableByName[t.name] = emptyRow(t);

  const leagueMatches = [];
  for (const [a, b] of leagueFixtures(teams)) {
    const match = playMatch(a, b, rng, "League");
    applyMatchToTable(tableByName, match);
    leagueMatches.push(match);
  }
  for (const row of Object.values(tableByName)) computeNrr(row);
  const table = snapshotTable(Object.values(tableByName));

  const playoffs = { matches: [], format: null };
  const n = teams.length;
  const ranked = table.map((row) => findTeam(teams, row.name));

  if (n === 0) {
    playoffs.format = "none";
  } else if (n === 1) {
    playoffs.format = "sole-team";
    playoffs.championName = ranked[0].name;
  } else if (n === 2) {
    playoffs.format = "final";
    const final = playMatch(ranked[0], ranked[1], rng, "Final");
    playoffs.matches.push(final);
    playoffs.championName = final.winnerName;
    playoffs.runnerUpName = final.loserName;
  } else if (n === 3) {
    playoffs.format = "top2-final";
    const final = playMatch(ranked[0], ranked[1], rng, "Final");
    playoffs.matches.push(final);
    playoffs.championName = final.winnerName;
    playoffs.runnerUpName = final.loserName;
    playoffs.thirdName = ranked[2].name;
  } else {
    playoffs.format = "ipl-playoffs";
    const q1 = playMatch(ranked[0], ranked[1], rng, "Qualifier 1");
    const elim = playMatch(ranked[2], ranked[3], rng, "Eliminator");
    const q1Winner = findTeam(teams, q1.winnerName);
    const q1Loser = findTeam(teams, q1.loserName);
    const elimWinner = findTeam(teams, elim.winnerName);
    const elimLoserName = elim.loserName;
    const q2 = playMatch(q1Loser, elimWinner, rng, "Qualifier 2");
    const q2Winner = findTeam(teams, q2.winnerName);
    const final = playMatch(q1Winner, q2Winner, rng, "Final");
    playoffs.matches.push(q1, elim, q2, final);
    playoffs.championName = final.winnerName;
    playoffs.runnerUpName = final.loserName;
    playoffs.thirdName = q2.loserName;
    playoffs.fourthName = elimLoserName;
  }

  const placed = new Set();
  const positions = [];
  function pushPos(name, title) {
    if (!name || placed.has(name)) return;
    placed.add(name);
    const team = findTeam(teams, name);
    const row = table.find((r) => r.name === name);
    positions.push({
      position: positions.length + 1,
      name,
      short: team.franchise.short,
      color: team.franchise.color,
      franchiseName: team.franchise.name,
      title,
      leaguePosition: row ? row.position : null,
      points: row ? row.points : 0,
      nrr: row ? row.nrr : 0,
    });
  }

  pushPos(playoffs.championName, "Champion");
  pushPos(playoffs.runnerUpName, "Runner-up");
  if (playoffs.thirdName) pushPos(playoffs.thirdName, "3rd");
  if (playoffs.fourthName) pushPos(playoffs.fourthName, "4th");
  for (const row of table) {
    pushPos(row.name, `${row.position}${suffix(row.position)} in league`);
  }

  const championTeam = findTeam(teams, playoffs.championName);

  return {
    seed,
    table,
    leagueMatches,
    playoffs,
    positions,
    awards: awards(teams),
    champion: championTeam
      ? {
          name: championTeam.name,
          short: championTeam.franchise.short,
          color: championTeam.franchise.color,
          franchiseName: championTeam.franchise.name,
          captainId: championTeam.captainId,
        }
      : null,
  };
}

function suffix(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

module.exports = {
  mulberry32,
  teamStrength,
  playMatch,
  simulateTournament,
  pickCaptainIfMissing,
  overallForAwards: awards,
  QUOTA,
  ROLES,
};
