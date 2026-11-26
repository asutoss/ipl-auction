const { overallRating } = require("./players");
const { captainBonus, captainMatchesOf } = require("./captaincy");
const { ROLES, QUOTA, formatPoints, resolveMode, inningsFormat } = require("./rules");
const { hasBooster } = require("./boosters");
const { playInnings, applyResultFlip } = require("./match-sim");

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

function formatOvers(balls) {
  return ballsToOvers(balls).toFixed(1);
}

function derivedFielding(player) {
  if (!player) return 0;
  // No separate fielding ratings exist. Keepers are judged mainly on their
  // batting class (plus a little bowling), everyone else on overall class.
  if (player.role === "WK") return player.batting * 0.85 + player.bowling * 0.15;
  return overallRating(player);
}

function playerRatings(slot, isCaptain) {
  const p = slot.player;
  const boost = isCaptain ? 1 + captainBonus(captainMatchesOf(p)) : 1;
  return {
    batting: p.batting * boost,
    bowling: p.bowling * boost,
    fielding: derivedFielding(p) * boost,
  };
}

function resolveTeamMode(team, modeArg) {
  if (modeArg && typeof modeArg === "object" && modeArg.id) return resolveMode(modeArg.id);
  if (modeArg) return resolveMode(modeArg);
  return resolveMode(team && team.mode);
}

const EXPECTED_BATTERS = 7;
const EXPECTED_BOWLERS = 6;

function teamUnits(franchise, modeArg) {
  const squad = franchise.squad || [];
  const captainId = franchise.captainId;
  const mode = resolveTeamMode(franchise, modeArg);
  let batSum = 0;
  let batN = 0;
  let bowlSum = 0;
  let bowlN = 0;
  let wkSum = 0;
  let wkN = 0;
  let restFieldSum = 0;
  let restFieldN = 0;
  for (const slot of squad) {
    const isCap = slot.player.id === captainId;
    const r = playerRatings(slot, isCap);
    const role = slot.player.role;
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
    if (role === "WK") {
      wkSum += r.fielding;
      wkN += 1;
    } else {
      restFieldSum += r.fielding;
      restFieldN += 1;
    }
  }
  const batting = batSum / Math.max(batN, mode.expectedBatters);
  const bowling = bowlSum / Math.max(bowlN, mode.expectedBowlers);
  const wkExpected = Math.max(1, mode.quota.WK || 1);
  const restExpected = Math.max(1, mode.squadSize - wkExpected);
  const wk = wkSum / Math.max(wkN, wkExpected);
  const rest = restFieldSum / Math.max(restFieldN, restExpected);
  const fielding = 0.7 * wk + 0.3 * rest;
  const strength = 0.52 * batting + 0.48 * bowling;
  return { batting, bowling, fielding, strength, batN, bowlN, wkN, restFieldN, mode };
}

function teamStrength(franchise, modeArg) {
  return teamUnits(franchise, modeArg);
}

function battersOf(team) {
  return (team.squad || []).filter((s) => ["BAT", "WK", "AR"].includes(s.player.role));
}

function bowlersOf(team) {
  return (team.squad || []).filter((s) => ["AR", "BOWL"].includes(s.player.role));
}

const FORM_MIN_PCT = 95;
const FORM_MAX_PCT = 105;
/** How much of the 95–105% deviation is applied to batting/bowling. 0.5 keeps form moderate. */
const FORM_EFFECT = 0.5;

/** Shift the form centre by this many points from first (+ ) to last (− ). */
const FORM_RANK_SHIFT = 5;

function formRankShift(rank, total) {
  const r = Number(rank);
  const n = Number(total);
  if (!Number.isFinite(r) || !Number.isFinite(n) || n <= 1) return 0;
  const t = Math.max(0, Math.min(1, (r - 1) / (n - 1)));
  return FORM_RANK_SHIFT - t * (2 * FORM_RANK_SHIFT);
}

function rollTeamForm(rng, opts) {
  const random = typeof rng === "function"
    ? rng
    : (rng && typeof rng.random === "function" ? rng.random.bind(rng) : Math.random);
  const lo = FORM_MIN_PCT / 100;
  const span = (FORM_MAX_PCT - FORM_MIN_PCT) / 100;
  const raw = lo + (random() * span + random() * span) / 2;
  const shift = formRankShift(opts && opts.rank, opts && opts.total);
  return Math.max(FORM_MIN_PCT, Math.min(FORM_MAX_PCT, Math.round(raw * 100 + shift)));
}

function formMultiplier(team) {
  const pct = team && team.formPct;
  if (pct == null || !Number.isFinite(Number(pct))) return 1;
  return 1 + (Number(pct) / 100 - 1) * FORM_EFFECT;
}

function matchStrength(team, { chasing = false, nerfed = false, mode } = {}) {
  const s = teamStrength(team, mode);
  let batting = s.batting;
  let bowling = s.bowling;
  if (hasBooster(team, "cheerleaders")) {
    batting *= 1.04;
    bowling *= 1.04;
  }
  if (hasBooster(team, "home-curator")) bowling += 8;
  if (hasBooster(team, "dew-factor") && chasing) batting += 10;
  if (hasBooster(team, "friendly-umpire")) {
    batting *= 1.03;
    bowling *= 1.03;
  }
  if (nerfed) {
    batting = Math.max(0, batting - 8);
    bowling = Math.max(0, bowling - 8);
  }
  const form = formMultiplier(team);
  batting *= form;
  bowling *= form;
  return { batting, bowling, strength: 0.52 * batting + 0.48 * bowling, batN: s.batN, bowlN: s.bowlN, form, formPct: team && team.formPct != null ? team.formPct : null };
}

/**
 * Standings strength, rebuilt around three unit pillars.
 *
 * Batting, bowling and Fielding/WK are each 0–1000, normalised to the mode's
 * role quotas so a complete Rapid or Bullet side is not treated as a short
 * Classical XI (empty slots still count as zero). All-rounders contribute
 * their batting to the batting unit and their bowling to the bowling unit.
 * The captain's 0–5% bump applies to every pillar. Standing boosters
 * (cheerleaders, home curator, friendly umpire) apply to batting/bowling
 * where they always did; dew-factor and the bus nerf are omitted.
 *
 * Fielding/WK is 70% the keeper (derived from batting class, since there is
 * no fielding rating) and 30% the rest of the unit's overall class, each
 * divided by the mode's expected slots.
 *
 * Overall strength (before form) is 40% batting + 40% bowling + 20%
 * Fielding/WK: bat and ball decide most matches, the keeper/fielding unit is
 * the third pillar but a smaller share. The displayed score is
 * overall × form multiplier (FORM_EFFECT unchanged) × SCORE_SCALE, rounded
 * and clamped to 0–1000. Typical complete sides land roughly 500–950; the
 * top team in a typical game is usually above 700.
 */
const STRENGTH_WEIGHTS = Object.freeze({ batting: 0.4, bowling: 0.4, fielding: 0.2 });
const PILLAR_RAW_CAP = 100;
const SCORE_SCALE = 1;

function applyStandingBoosters(units, team) {
  let batting = units.batting;
  let bowling = units.bowling;
  const fielding = units.fielding;
  if (hasBooster(team, "cheerleaders")) {
    batting *= 1.04;
    bowling *= 1.04;
  }
  if (hasBooster(team, "home-curator")) bowling += 8;
  if (hasBooster(team, "friendly-umpire")) {
    batting *= 1.03;
    bowling *= 1.03;
  }
  return { batting, bowling, fielding };
}

function toPillar(raw) {
  return Math.max(0, Math.min(1000, Math.round((Number(raw) || 0) / PILLAR_RAW_CAP * 1000)));
}

function squadStrengthBreakdown(team, mode) {
  const units = teamUnits(team, mode);
  const boosted = applyStandingBoosters(units, team);
  const battingStrength = toPillar(boosted.batting);
  const bowlingStrength = toPillar(boosted.bowling);
  const fieldingStrength = toPillar(boosted.fielding);
  const overallStrength = Math.max(0, Math.min(1000, Math.round(
    STRENGTH_WEIGHTS.batting * battingStrength
    + STRENGTH_WEIGHTS.bowling * bowlingStrength
    + STRENGTH_WEIGHTS.fielding * fieldingStrength
  )));
  const form = formMultiplier(team);
  const score = Math.max(0, Math.min(1000, Math.round(overallStrength * form * SCORE_SCALE)));
  return {
    battingStrength,
    bowlingStrength,
    fieldingStrength,
    overallStrength,
    score,
    form,
    formPct: team && team.formPct != null ? team.formPct : null,
  };
}

function squadStrengthScore(team, mode) {
  return squadStrengthBreakdown(team, mode).score;
}

function isCloseMatch(match, format) {
  if (!match || match.noResult) return false;
  const first = match.firstInnings;
  const second = match.secondInnings;
  if (!first || !second) return false;
  const fmt = format || inningsFormat("classical");
  if (match.chased) return fmt.maxWickets - second.wickets <= Math.min(2, fmt.maxWickets);
  const closeRuns = Math.max(3, Math.round(8 * (fmt.overs / 20)));
  return first.score - second.score <= closeRuns;
}

function addMoment(ctx, team, boosterId, text, match) {
  if (!ctx || !ctx.moments) return;
  const booster = (team.boosters || []).find((b) => b.id === boosterId);
  ctx.moments.push({
    teamName: team.name,
    short: team.name,
    color: team.franchise.color,
    boosterId,
    boosterName: booster ? booster.name : boosterId,
    text,
    matchId: match ? match.id : null,
    label: match ? match.label : null,
  });
}

function decideToss(teamA, teamB, rng, ctx, label) {
  const aLucky = hasBooster(teamA, "lucky-toss");
  const bLucky = hasBooster(teamB, "lucky-toss");
  let winner;
  if (aLucky && !bLucky) winner = teamA;
  else if (bLucky && !aLucky) winner = teamB;
  else winner = rng() < 0.5 ? teamA : teamB;
  const loser = winner === teamA ? teamB : teamA;
  if ((aLucky || bLucky) && aLucky !== bLucky) {
    addMoment(ctx, winner, "lucky-toss", `Lucky Toss Coin landed for ${winner.name} vs ${loser.name}`, { id: `${label}-${teamA.name}-${teamB.name}`, label });
  }
  const wS = teamStrength(winner);
  const lS = teamStrength(loser);
  const batFirstScore = wS.batting - lS.bowling;
  const chaseScore = wS.batting + (hasBooster(winner, "dew-factor") ? 10 : 0) - lS.bowling;
  // Prefer the option with the better expected batting edge; default to batting first on a tie.
  const winnerBatsFirst = batFirstScore >= chaseScore - 2;
  return { winner, winnerBatsFirst };
}

function emptyStat(player) {
  return {
    playerId: player.id,
    name: player.name,
    role: player.role,
    runs: 0,
    balls: 0,
    innings: 0,
    notOuts: 0,
    highest: 0,
    wickets: 0,
    ballsBowled: 0,
    runsConceded: 0,
    matches: 0,
  };
}

function bumpMatchAppearances(book, team, ...cardLists) {
  if (!book || !team) return;
  const stats = book[team.name];
  if (!stats) return;
  const ids = new Set();
  for (const list of cardLists) {
    for (const c of list || []) {
      if (c && c.playerId) ids.add(c.playerId);
    }
  }
  for (const id of ids) {
    let row = stats.get(id);
    if (!row) {
      const slot = (team.squad || []).find((s) => s.player && s.player.id === id);
      if (!slot) continue;
      row = emptyStat(slot.player);
      stats.set(id, row);
    }
    row.matches = (Number(row.matches) || 0) + 1;
  }
}

function applyBattingStats(book, team, cards) {
  const stats = book[team.name];
  for (const c of cards) {
    let row = stats.get(c.playerId);
    if (!row) {
      row = { playerId: c.playerId, name: c.name, role: c.role, runs: 0, balls: 0, innings: 0, notOuts: 0, highest: 0, wickets: 0, ballsBowled: 0, runsConceded: 0, matches: 0 };
      stats.set(c.playerId, row);
    }
    row.runs += c.runs;
    row.balls += c.balls;
    row.innings += 1;
    if (!c.out) row.notOuts += 1;
    if (c.runs > row.highest) row.highest = c.runs;
  }
}

function applyBowlingStats(book, team, cards) {
  const stats = book[team.name];
  for (const c of cards) {
    let row = stats.get(c.playerId);
    if (!row) {
      row = { playerId: c.playerId, name: c.name, role: c.role, runs: 0, balls: 0, innings: 0, notOuts: 0, highest: 0, wickets: 0, ballsBowled: 0, runsConceded: 0, matches: 0 };
      stats.set(c.playerId, row);
    }
    row.wickets += c.wickets;
    row.ballsBowled += c.balls;
    row.runsConceded += c.runsConceded;
  }
}

function packBestBowling(row) {
  if (!row.ballsBowled) return null;
  return `${row.wickets}/${row.runsConceded}`;
}

function finalizePlayerStats(book, teams) {
  const out = {};
  for (const team of teams) {
    const map = book[team.name] || new Map();
    const rows = [];
    for (const slot of team.squad || []) {
      const row = map.get(slot.player.id) || emptyStat(slot.player);
      const dismissals = Math.max(0, row.innings - row.notOuts);
      rows.push({
        ...row,
        average: dismissals > 0 ? Number((row.runs / dismissals).toFixed(2)) : row.runs ? Number(row.runs.toFixed(2)) : 0,
        strikeRate: row.balls > 0 ? Number(((row.runs / row.balls) * 100).toFixed(1)) : 0,
        economy: row.ballsBowled > 0 ? Number(((row.runsConceded / row.ballsBowled) * 6).toFixed(2)) : 0,
        oversBowled: Number(formatOvers(row.ballsBowled)),
        bestBowling: packBestBowling(row),
        matches: Number(row.matches) || 0,
      });
    }
    out[team.name] = rows;
  }
  return out;
}

function playMatch(teamA, teamB, rng, label, ctx = {}) {
  const victims = ctx.busVictims || {};
  const aNerf = Boolean(victims[teamA.name]);
  const bNerf = Boolean(victims[teamB.name]);
  const toss = decideToss(teamA, teamB, rng, ctx, label);
  const first = toss.winnerBatsFirst ? toss.winner : toss.winner === teamA ? teamB : teamA;
  const second = first === teamA ? teamB : teamA;
  const firstS = matchStrength(first, { chasing: false, nerfed: first === teamA ? aNerf : bNerf });
  const secondS = matchStrength(second, { chasing: true, nerfed: second === teamA ? aNerf : bNerf });

  if (aNerf) {
    const saboteur = (ctx.busSaboteurs || {})[teamA.name];
    if (saboteur && !ctx._busNoted) ctx._busNoted = new Set();
    const key = `${saboteur}-${teamA.name}-${label}`;
    if (saboteur && ctx._busNoted && !ctx._busNoted.has(key)) {
      ctx._busNoted.add(key);
      const t = ctx.teamsByName ? ctx.teamsByName[saboteur] : null;
      if (t) addMoment(ctx, t, "bus-breakdown", `Team Bus Breakdown delayed ${teamA.name} vs ${teamB.name}`, { id: `${label}-${teamA.name}-${teamB.name}`, label });
    }
  }
  if (bNerf) {
    const saboteur = (ctx.busSaboteurs || {})[teamB.name];
    if (saboteur && !ctx._busNoted) ctx._busNoted = new Set();
    const key = `${saboteur}-${teamB.name}-${label}`;
    if (saboteur && ctx._busNoted && !ctx._busNoted.has(key)) {
      ctx._busNoted.add(key);
      const t = ctx.teamsByName ? ctx.teamsByName[saboteur] : null;
      if (t) addMoment(ctx, t, "bus-breakdown", `Team Bus Breakdown delayed ${teamB.name} vs ${teamA.name}`, { id: `${label}-${teamA.name}-${teamB.name}`, label });
    }
  }

  const format = (ctx && ctx.format) || inningsFormat((teamA && teamA.mode) || (ctx && ctx.mode) || Math.max((teamA.squad || []).length, (teamB.squad || []).length) || 11);
  const inn1 = playInnings({
    rng,
    battingTeam: first,
    bowlingTeam: second,
    batting: firstS.batting,
    bowling: secondS.bowling,
    target: null,
    format,
  });
  const inn2 = playInnings({
    rng,
    battingTeam: second,
    bowlingTeam: first,
    batting: secondS.batting,
    bowling: firstS.bowling,
    target: inn1.score + 1,
    format,
  });

  let chased = Boolean(inn2.chased) || inn2.score >= inn1.score + 1;
  let winner = chased ? second : first;
  let loser = chased ? first : second;

  const provisionalId = `${label}-${teamA.name}-${teamB.name}`;
  const closeRuns = Math.max(3, Math.round(8 * (format.overs / 20)));
  const close = chased ? format.maxWickets - inn2.wickets <= Math.min(2, format.maxWickets) : inn1.score - inn2.score <= closeRuns;

  function tryFlip(boosterId, chance, text) {
    if (!hasBooster(loser, boosterId)) return false;
    if (rng() >= chance) return false;
    addMoment(ctx, loser, boosterId, text, { id: provisionalId, label });
    const prevWinner = winner;
    winner = loser;
    loser = prevWinner;
    chased = winner === second;
    applyResultFlip(inn2, inn1, chased);
    chased = Boolean(inn2.chased) || (chased && inn2.score >= inn1.score + 1);
    if (chased) {
      winner = second;
      loser = first;
    } else {
      winner = first;
      loser = second;
    }
    return true;
  }

  if (close) {
    tryFlip(
      "friendly-umpire",
      0.35,
      `Friendly Umpire turned the match vs ${winner.name}`
    );
  }
  const stillClose = chased ? format.maxWickets - inn2.wickets <= Math.min(2, format.maxWickets) : inn1.score - inn2.score <= closeRuns;
  if (stillClose && winner !== loser) {
    tryFlip(
      "drs-wizard",
      0.15,
      `DRS Wizard overturned a narrow loss vs ${winner.name}`
    );
  }

  let noResult = false;
  if (label === "League" && hasBooster(loser, "rain-dance") && rng() < 0.22) {
    noResult = true;
    addMoment(ctx, loser, "rain-dance", `Rain Dance washed out a loss vs ${winner.name}`, { id: provisionalId, label });
  }

  function card(team, inn, battingFirst) {
    return {
      name: team.name,
      short: team.name,
      franchise: team.franchise,
      score: inn.score,
      wickets: inn.wickets,
      balls: inn.balls,
      overs: formatOvers(inn.balls),
      battingFirst,
      formPct: team.formPct != null ? team.formPct : null,
      extras: inn.extras || { wides: 0, noBalls: 0, byes: 0, legByes: 0, total: 0 },
      deliveries: inn.deliveries || [],
    };
  }

  const firstCard = card(first, inn1, true);
  const secondCard = card(second, inn2, false);

  let resultText;
  if (noResult) {
    resultText = "No result — rain stopped play";
  } else if (chased) {
    const wkts = format.maxWickets - inn2.wickets;
    resultText = `${second.name} won by ${wkts} wicket${wkts === 1 ? "" : "s"}`;
  } else {
    const runs = inn1.score - inn2.score;
    resultText = `${first.name} won by ${runs} run${runs === 1 ? "" : "s"}`;
  }

  const match = {
    id: provisionalId,
    label,
    teamA: teamA.name,
    teamB: teamB.name,
    shortA: teamA.name,
    shortB: teamB.name,
    colorA: teamA.franchise.color,
    colorB: teamB.franchise.color,
    toss: `${toss.winner.name} elected to ${toss.winnerBatsFirst ? "bat" : "bowl"}`,
    firstInnings: firstCard,
    secondInnings: secondCard,
    winnerName: noResult ? null : winner.name,
    winnerShort: noResult ? null : winner.name,
    loserName: noResult ? null : loser.name,
    resultText,
    noResult,
    chased: noResult ? false : chased,
    formPctA: teamA.formPct != null ? teamA.formPct : null,
    formPctB: teamB.formPct != null ? teamB.formPct : null,
  };

  const batting1 = inn1.batting || [];
  const batting2 = inn2.batting || [];
  const bowling1 = inn1.bowling || [];
  const bowling2 = inn2.bowling || [];
  match.performances = {
    [first.name]: { batting: batting1, bowling: bowling2 },
    [second.name]: { batting: batting2, bowling: bowling1 },
  };

  if (!noResult && ctx.statBook) {
    applyBattingStats(ctx.statBook, first, batting1);
    applyBattingStats(ctx.statBook, second, batting2);
    applyBowlingStats(ctx.statBook, second, bowling1);
    applyBowlingStats(ctx.statBook, first, bowling2);
    bumpMatchAppearances(ctx.statBook, first, batting1, bowling2);
    bumpMatchAppearances(ctx.statBook, second, batting2, bowling1);
  }

  return match;
}

function emptyRow(team) {
  return {
    name: team.name,
    franchise: team.franchise,
    played: 0,
    won: 0,
    lost: 0,
    nr: 0,
    points: 0,
    runsFor: 0,
    ballsFaced: 0,
    runsAgainst: 0,
    ballsBowled: 0,
    nrr: 0,
    formPct: team.formPct != null ? team.formPct : null,
  };
}

function applyMatchToTable(tableByName, match) {
  const first = match.firstInnings;
  const second = match.secondInnings;
  const a = tableByName[first.name];
  const b = tableByName[second.name];
  a.played += 1;
  b.played += 1;
  if (match.noResult) {
    a.nr += 1;
    b.nr += 1;
    a.points += 1;
    b.points += 1;
    return;
  }
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
    short: r.name,
    color: r.franchise.color,
    text: r.franchise.text || r.franchise.color,
    franchiseName: r.name,
    played: r.played,
    won: r.won,
    lost: r.lost,
    nr: r.nr || 0,
    points: r.points,
    nrr: Number(r.nrr.toFixed(3)),
    formPct: r.formPct != null ? r.formPct : null,
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
      const price = slot.priceLakhs || slot.player.basePriceLakhs || 2;
      bought.push({
        player: slot.player,
        overall,
        priceLakhs: price,
        teamName: t.name,
        short: t.name,
        color: t.franchise.color,
        value: overall / Math.max(price, 1),
        flop: price / Math.max(overall, 1),
      });
    }
  }
  if (bought.length === 0) {
    return { bestBuy: null, costliestFlop: null };
  }

  const bestBuy = [...bought].sort((a, b) => b.value - a.value)[0];
  const expensive = bought.filter((b) => b.priceLakhs >= 12);
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
      `Rating ${bestBuy.overall.toFixed(0)} for ${formatPoints(bestBuy.priceLakhs)}`
    ),
    costliestFlop: pack(
      costliestFlop,
      `Paid ${formatPoints(costliestFlop.priceLakhs)} for a ${costliestFlop.overall.toFixed(0)} rating`
    ),
  };
}

function assignBusVictims(teams, rng) {
  const victims = {}; // victimName -> true
  const saboteurs = {}; // victimName -> saboteurName (last writer if several)
  for (const t of teams) {
    if (!hasBooster(t, "bus-breakdown")) continue;
    const rivals = teams.filter((x) => x.name !== t.name);
    if (!rivals.length) continue;
    const victim = rivals[Math.floor(rng() * rivals.length)];
    victims[victim.name] = true;
    saboteurs[victim.name] = t.name;
  }
  return { victims, saboteurs };
}

function simulateTournament(franchises, seed, opts = {}) {
  const mode = resolveMode((opts && opts.mode) || (franchises[0] && franchises[0].mode));
  const format = inningsFormat(mode);
  const teams = franchises.map((f) => ({
    ...f,
    mode: mode.id,
    captainId: pickCaptainIfMissing(f),
    boosters: Array.isArray(f.boosters) ? f.boosters : [],
  }));
  const rng = mulberry32(seed >>> 0);
  const tableByName = {};
  const statBook = {};
  const teamsByName = {};
  for (const t of teams) {
    tableByName[t.name] = emptyRow(t);
    statBook[t.name] = new Map();
    teamsByName[t.name] = t;
  }

  const bus = assignBusVictims(teams, rng);
  const ctx = {
    moments: [],
    busVictims: bus.victims,
    busSaboteurs: bus.saboteurs,
    statBook,
    teamsByName,
    _busNoted: new Set(),
    mode,
    format,
  };

  const leagueMatches = [];
  for (const [a, b] of leagueFixtures(teams)) {
    const match = playMatch(a, b, rng, "League", ctx);
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
    const final = playMatch(ranked[0], ranked[1], rng, "Final", ctx);
    playoffs.matches.push(final);
    playoffs.championName = final.winnerName || ranked[0].name;
    playoffs.runnerUpName = final.loserName || ranked[1].name;
  } else if (n === 3) {
    playoffs.format = "top2-final";
    const final = playMatch(ranked[0], ranked[1], rng, "Final", ctx);
    playoffs.matches.push(final);
    playoffs.championName = final.winnerName || ranked[0].name;
    playoffs.runnerUpName = final.loserName || ranked[1].name;
    playoffs.thirdName = ranked[2].name;
  } else {
    playoffs.format = "ipl-playoffs";
    const q1 = playMatch(ranked[0], ranked[1], rng, "Qualifier 1", ctx);
    const elim = playMatch(ranked[2], ranked[3], rng, "Eliminator", ctx);
    const q1Winner = findTeam(teams, q1.winnerName) || ranked[0];
    const q1Loser = findTeam(teams, q1.loserName) || ranked[1];
    const elimWinner = findTeam(teams, elim.winnerName) || ranked[2];
    const elimLoserName = elim.loserName || ranked[3].name;
    const q2 = playMatch(q1Loser, elimWinner, rng, "Qualifier 2", ctx);
    const q2Winner = findTeam(teams, q2.winnerName) || q1Loser;
    const final = playMatch(q1Winner, q2Winner, rng, "Final", ctx);
    playoffs.matches.push(q1, elim, q2, final);
    playoffs.championName = final.winnerName || q1Winner.name;
    playoffs.runnerUpName = final.loserName || q2Winner.name;
    playoffs.thirdName = q2.loserName || elimWinner.name;
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
      short: team.name,
      color: team.franchise.color,
      text: team.franchise.text || team.franchise.color,
      characterId: team.franchise && (team.franchise.characterId || team.franchise.id),
      identityId: team.franchise && (team.franchise.characterId || team.franchise.id),
      franchiseName: team.name,
      title,
      leaguePosition: row ? row.position : null,
      points: row ? row.points : 0,
      nrr: row ? row.nrr : 0,
      won: row ? row.won : 0,
      lost: row ? row.lost : 0,
      nr: row ? row.nr : 0,
      formPct: team.formPct != null ? team.formPct : (row && row.formPct != null ? row.formPct : null),
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
  const playerStats = finalizePlayerStats(statBook, teams);

  return {
    seed,
    table,
    leagueMatches,
    playoffs,
    positions,
    awards: awards(teams),
    moments: ctx.moments,
    playerStats,
    champion: championTeam
      ? {
          name: championTeam.name,
          franchiseName: championTeam.name,
          short: championTeam.name,
          color: championTeam.franchise.color,
          text: championTeam.franchise.text || championTeam.franchise.color,
          characterId: championTeam.franchise && (championTeam.franchise.characterId || championTeam.franchise.id),
          identityId: championTeam.franchise && (championTeam.franchise.characterId || championTeam.franchise.id),
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
  inningsFormat,
  playInnings,
  rollTeamForm,
  formMultiplier,
  FORM_MIN_PCT,
  FORM_MAX_PCT,
  FORM_EFFECT,
  FORM_RANK_SHIFT,
  formRankShift,
  matchStrength,
  squadStrengthBreakdown,
  squadStrengthScore,
  derivedFielding,
  STRENGTH_WEIGHTS,
  PILLAR_RAW_CAP,
  SCORE_SCALE,
  QUOTA,
  ROLES,
};
