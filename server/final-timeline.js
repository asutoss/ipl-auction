/**
 * Deterministic ball-by-ball reconstruction of an already-played match.
 * The innings totals and player cards come from the tournament sim; this
 * only invents a plausible sequence of deliveries that adds up to those
 * figures, with no extra randomness, so the winner never changes.
 */

function formatOvers(balls) {
  const n = Math.max(0, Number(balls) || 0);
  const full = Math.floor(n / 6);
  const rem = n % 6;
  return `${full}.${rem}`;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function findFinalMatch(tournament) {
  if (!tournament) return null;
  const matches = (tournament.playoffs && tournament.playoffs.matches) || [];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    if (matches[i] && matches[i].label === "Final") return matches[i];
  }
  return null;
}

function distributeRuns(runs, balls, lastIsWicket) {
  const n = Math.max(0, Number(balls) || 0);
  const seq = Array(n).fill(0);
  const scoring = lastIsWicket ? n - 1 : n;
  if (scoring <= 0 || runs <= 0) return seq;
  let left = Math.max(0, Number(runs) || 0);
  for (let i = 0; i < scoring; i += 1) {
    const remBalls = scoring - i;
    // Allocation can theoretically go as high as 8 a ball; cap there so
    // official batter totals still reconstruct exactly.
    const minThis = Math.max(0, left - 8 * (remBalls - 1));
    const maxThis = Math.min(8, left);
    if (maxThis < minThis) {
      seq[i] = clamp(left, 0, 8);
      left = Math.max(0, left - seq[i]);
      continue;
    }
    const pace = left / remBalls;
    const prefer = [0, 1, 4, 6, 2, 3, 5, 7, 8].filter((v) => v >= minThis && v <= maxThis);
    let v = prefer[0] != null ? prefer[0] : minThis;
    for (const opt of prefer) {
      if (Math.abs(opt - pace) < Math.abs(v - pace)) v = opt;
    }
    seq[i] = v;
    left -= v;
  }
  if (left > 0) {
    for (let i = 0; i < scoring && left > 0; i += 1) {
      const add = Math.min(8 - seq[i], left);
      seq[i] += add;
      left -= add;
    }
  }
  return seq;
}

function scheduleBowlers(bowlers, totalBalls) {
  const left = (bowlers || []).map((b) => ({
    playerId: b.playerId,
    name: b.name,
    role: b.role,
    left: Math.max(0, Number(b.balls) || 0),
    wicketsLeft: Math.max(0, Number(b.wickets) || 0),
    runsLeft: Math.max(0, Number(b.runsConceded) || 0),
  }));
  const totalAssigned = left.reduce((s, b) => s + b.left, 0);
  const target = Math.max(0, Number(totalBalls) || 0);
  // If bowling balls don't add up (rare cap leftovers), pad/trim the heaviest bowler.
  let diff = target - totalAssigned;
  if (diff !== 0 && left.length) {
    const heavy = [...left].sort((a, b) => b.left - a.left)[0];
    heavy.left = Math.max(0, heavy.left + diff);
  }
  const spells = [];
  let remaining = target;
  let lastId = null;
  while (remaining > 0) {
    const overLen = Math.min(6, remaining);
    const pool = left.filter((b) => b.left > 0);
    if (!pool.length) break;
    const preferFull = pool.filter((b) => b.left >= overLen);
    const group = (preferFull.length ? preferFull : pool);
    const notLast = group.filter((b) => b.playerId !== lastId);
    const cands = notLast.length ? notLast : group;
    cands.sort((a, b) => b.left - a.left);
    const bowler = cands[0];
    const take = Math.min(overLen, bowler.left);
    spells.push({ playerId: bowler.playerId, name: bowler.name, balls: take });
    bowler.left -= take;
    remaining -= take;
    lastId = bowler.playerId;
  }
  return spells;
}

function stitchPartnerships(batters, totalBalls) {
  const list = (batters || []).filter((b) => (Number(b.balls) || 0) > 0 || b.out);
  if (!list.length) return [];
  const faced = new Map(list.map((b) => [b.playerId, 0]));
  const leftOf = (b) => Math.max(0, (Number(b.balls) || 0) - (faced.get(b.playerId) || 0));
  const outList = list.filter((b) => b.out);
  const notOut = list.filter((b) => !b.out);
  const order = [...outList, ...notOut];
  let striker = order[0];
  let partner = order[1] || null;
  let nextIdx = 2;
  const seq = [];

  function emitPair(a, aBalls, b, bBalls, endWithA) {
    let ac = aBalls;
    let bc = bBalls;
    let strike = a;
    const chunk = [];
    while (ac + bc > 0) {
      if (strike === a && ac > 0) {
        chunk.push(a);
        ac -= 1;
      } else if (b && strike === b && bc > 0) {
        chunk.push(b);
        bc -= 1;
      } else if (ac > 0) {
        chunk.push(a);
        ac -= 1;
        strike = a;
      } else if (b && bc > 0) {
        chunk.push(b);
        bc -= 1;
        strike = b;
      } else break;
      strike = strike === a ? b : a;
    }
    if (endWithA && a && chunk.length && chunk[chunk.length - 1] !== a) {
      for (let i = chunk.length - 2; i >= 0; i -= 1) {
        if (chunk[i] === a) {
          const tmp = chunk[i];
          chunk[i] = chunk[chunk.length - 1];
          chunk[chunk.length - 1] = tmp;
          break;
        }
      }
    }
    for (const p of chunk) {
      seq.push(p);
      faced.set(p.playerId, (faced.get(p.playerId) || 0) + 1);
    }
  }

  for (const dismissed of outList) {
    if (leftOf(dismissed) <= 0) continue;
    if (striker !== dismissed && partner !== dismissed) {
      partner = striker;
      striker = dismissed;
    }
    if (partner === dismissed) {
      const tmp = striker;
      striker = partner;
      partner = tmp;
    }
    const aLeft = leftOf(striker);
    const pLeft = partner ? leftOf(partner) : 0;
    // Partner faces a similar number of balls, but must keep some if they
    // still have later work (they are not dismissed in this partnership).
    const partnerShare = partner && partner.out === false
      ? Math.min(pLeft, aLeft)
      : Math.min(pLeft, aLeft);
    emitPair(striker, aLeft, partner, partnerShare, true);
    if (nextIdx < order.length) {
      striker = order[nextIdx];
      nextIdx += 1;
    } else {
      striker = partner;
      partner = null;
    }
  }

  // Remaining not-out balls.
  const remainA = striker ? leftOf(striker) : 0;
  const remainB = partner ? leftOf(partner) : 0;
  if (remainA + remainB > 0) emitPair(striker, remainA, partner, remainB, false);

  // Anyone still owed balls (shouldn't happen often) is appended.
  for (const b of order) {
    while (leftOf(b) > 0) {
      seq.push(b);
      faced.set(b.playerId, (faced.get(b.playerId) || 0) + 1);
    }
  }

  if (totalBalls >= 0 && seq.length > totalBalls) return seq.slice(0, totalBalls);
  while (totalBalls >= 0 && seq.length < totalBalls) {
    const last = seq[seq.length - 1] || order[order.length - 1] || list[0];
    if (!last) break;
    seq.push(last);
  }
  return seq;
}

function runsPlanForBatters(batters) {
  const plan = new Map();
  for (const b of batters || []) {
    const balls = Math.max(0, Number(b.balls) || 0);
    const runs = Math.max(0, Number(b.runs) || 0);
    plan.set(b.playerId, distributeRuns(runs, balls, Boolean(b.out)));
  }
  return plan;
}

function buildInningsTimeline(inn, batting, bowling) {
  const totalBalls = Math.max(0, Number(inn && inn.balls) || 0);
  const score = Math.max(0, Number(inn && inn.score) || 0);
  const wickets = Math.max(0, Number(inn && inn.wickets) || 0);
  const faces = stitchPartnerships(batting, totalBalls);
  const spells = scheduleBowlers(bowling, totalBalls);
  const runPlan = runsPlanForBatters(batting);
  const batterIdx = new Map();
  const balls = [];
  let spellAt = 0;
  let spellUsed = 0;
  let runsSoFar = 0;
  let wktsSoFar = 0;

  for (let i = 0; i < totalBalls; i += 1) {
    while (spellAt < spells.length && spellUsed >= spells[spellAt].balls) {
      spellAt += 1;
      spellUsed = 0;
    }
    const spell = spells[spellAt] || spells[spells.length - 1] || { playerId: null, name: "—", balls: 1 };
    const batter = faces[i] || faces[faces.length - 1] || (batting && batting[0]) || { playerId: null, name: "—", out: false, balls: 1, runs: 0 };
    const idx = batterIdx.get(batter.playerId) || 0;
    const plan = runPlan.get(batter.playerId) || [];
    let runs = Number(plan[idx]) || 0;
    const isLastForBatter = idx + 1 >= (Number(batter.balls) || plan.length);
    let wicket = Boolean(batter.out && isLastForBatter);
    batterIdx.set(batter.playerId, idx + 1);
    spellUsed += 1;

    if (wicket && wktsSoFar >= wickets) wicket = false;

    const overNo = Math.floor(i / 6);
    const ballInOver = (i % 6) + 1;
    balls.push({
      i,
      over: overNo,
      ball: ballInOver,
      overs: formatOvers(i + 1),
      runs,
      wicket,
      batterId: batter.playerId,
      batterName: batter.name,
      bowlerId: spell.playerId,
      bowlerName: spell.name,
      highlight: wicket ? "W" : runs >= 6 ? "6" : runs === 4 ? "4" : null,
    });
    runsSoFar += runs;
    if (wicket) wktsSoFar += 1;
  }

  // If the batting cards have fewer dismissals than the innings wicket
  // total (short squads), mark extra 0-run balls as wickets so the live
  // score lands on the official n/w.
  if (wktsSoFar < wickets) {
    for (let i = balls.length - 1; i >= 0 && wktsSoFar < wickets; i -= 1) {
      if (!balls[i].wicket && balls[i].runs === 0) {
        balls[i].wicket = true;
        balls[i].highlight = "W";
        wktsSoFar += 1;
      }
    }
    for (let i = balls.length - 1; i >= 0 && wktsSoFar < wickets; i -= 1) {
      if (!balls[i].wicket) {
        balls[i].wicket = true;
        balls[i].highlight = "W";
        wktsSoFar += 1;
      }
    }
  }

  // Innings total should already match the sum of batter cards. If a face
  // was padded, nudge the last adjustable deliveries to the official score
  // without creating 7-run balls.
  runsSoFar = balls.reduce((s, b) => s + b.runs, 0);
  let diff = score - runsSoFar;
  let guard = 0;
  while (diff !== 0 && balls.length && guard++ < 1000) {
    const i = (balls.length - 1 - (guard % balls.length) + balls.length) % balls.length;
    const d = balls[i];
    if (diff > 0 && d.runs < 8) {
      d.runs += 1;
      diff -= 1;
    } else if (diff < 0 && d.runs > 0) {
      d.runs -= 1;
      diff += 1;
    } else continue;
    d.highlight = d.wicket ? "W" : d.runs >= 6 ? "6" : d.runs === 4 ? "4" : (d.runs === 0 ? null : d.highlight);
  }

  return {
    teamName: inn && inn.name,
    score,
    wickets,
    balls: totalBalls,
    overs: (inn && inn.overs) || formatOvers(totalBalls),
    batting: batting || [],
    bowling: bowling || [],
    deliveries: balls,
  };
}

function impactScore(bat, bowl) {
  const runs = Number(bat && bat.runs) || 0;
  const wkts = Number(bowl && bowl.wickets) || 0;
  const balls = Number(bat && bat.balls) || 0;
  let n = runs + wkts * 25;
  if (runs >= 50) n += 10;
  if (wkts >= 3) n += 10;
  if (balls) n += Math.min(5, Math.round(runs / Math.max(20, balls)));
  return n;
}

function playerOfTheMatch(match) {
  if (!match || !match.performances) return null;
  const teams = [match.firstInnings && match.firstInnings.name, match.secondInnings && match.secondInnings.name]
    .filter(Boolean);
  let best = null;
  let bestN = -1;
  for (const teamName of teams) {
    const perf = match.performances[teamName] || {};
    const ids = new Set([
      ...((perf.batting || []).map((p) => p.playerId)),
      ...((perf.bowling || []).map((p) => p.playerId)),
    ]);
    for (const id of ids) {
      const bat = (perf.batting || []).find((p) => p.playerId === id) || null;
      const bowl = (perf.bowling || []).find((p) => p.playerId === id) || null;
      const n = impactScore(bat, bowl);
      const fromWinner = match.winnerName && teamName === match.winnerName ? 0.1 : 0;
      const score = n + fromWinner;
      if (score > bestN) {
        bestN = score;
        const bits = [];
        if (bat && (bat.runs || bat.balls)) bits.push(`${bat.runs} (${bat.balls})`);
        if (bowl && bowl.balls) {
          bits.push(`${bowl.wickets}/${bowl.runsConceded} (${formatOvers(bowl.balls)})`);
        }
        best = {
          playerId: id,
          name: (bat && bat.name) || (bowl && bowl.name) || id,
          teamName,
          text: bits.join(" & ") || "—",
          runs: bat ? bat.runs : 0,
          balls: bat ? bat.balls : 0,
          wickets: bowl ? bowl.wickets : 0,
          runsConceded: bowl ? bowl.runsConceded : 0,
        };
      }
    }
  }
  return best;
}

function buildFinalTimeline(match) {
  if (!match) return null;
  const firstName = match.firstInnings && match.firstInnings.name;
  const secondName = match.secondInnings && match.secondInnings.name;
  const perf1 = (match.performances && match.performances[firstName]) || { batting: [], bowling: [] };
  const perf2 = (match.performances && match.performances[secondName]) || { batting: [], bowling: [] };
  const inn1 = buildInningsTimeline(match.firstInnings, perf1.batting, perf2.bowling);
  const inn2 = buildInningsTimeline(match.secondInnings, perf2.batting, perf1.bowling);
  return {
    id: match.id,
    label: match.label || "Final",
    toss: match.toss || "",
    teamA: match.teamA,
    teamB: match.teamB,
    colorA: match.colorA,
    colorB: match.colorB,
    firstName,
    secondName,
    winnerName: match.winnerName,
    loserName: match.loserName,
    resultText: match.resultText,
    chased: Boolean(match.chased),
    noResult: Boolean(match.noResult),
    target: match.firstInnings ? match.firstInnings.score + 1 : null,
    innings: [inn1, inn2],
    potm: playerOfTheMatch(match),
    // One unit for the toss, one for the innings break, one per ball.
    units: 1 + inn1.deliveries.length + 1 + inn2.deliveries.length,
  };
}

function tickerForOver(deliveries, upto) {
  if (!deliveries || upto < 0) return [];
  const cur = deliveries[upto];
  if (!cur) return [];
  const overNo = cur.over;
  const marks = [];
  for (let i = 0; i <= upto; i += 1) {
    const d = deliveries[i];
    if (!d || d.over !== overNo) continue;
    marks.push(d.wicket ? "W" : String(d.runs));
  }
  return marks;
}

function runningCard(list, kind, deliveries, upto, currentId, alsoId) {
  const byId = new Map();
  for (const row of list || []) {
    byId.set(row.playerId, {
      playerId: row.playerId,
      name: row.name,
      role: row.role,
      runs: 0,
      balls: 0,
      out: false,
      wickets: 0,
      runsConceded: 0,
      ballsBowled: 0,
      official: row,
    });
  }
  for (let i = 0; i <= upto; i += 1) {
    const d = deliveries[i];
    if (!d) continue;
    if (kind === "bat") {
      const r = byId.get(d.batterId);
      if (!r) continue;
      r.runs += d.runs;
      r.balls += 1;
      if (d.wicket) r.out = true;
    } else {
      const r = byId.get(d.bowlerId);
      if (!r) continue;
      r.runsConceded += d.runs;
      r.ballsBowled += 1;
      if (d.wicket) r.wickets += 1;
    }
  }
  const rows = [];
  for (const row of list || []) {
    const r = byId.get(row.playerId);
    if (!r) continue;
    if (kind === "bat" && r.balls === 0 && r.playerId !== currentId && r.playerId !== alsoId) continue;
    if (kind === "bowl" && r.ballsBowled === 0 && r.playerId !== currentId) continue;
    r.current = r.playerId === currentId;
    if (kind === "bowl") r.overs = formatOvers(r.ballsBowled);
    rows.push(r);
  }
  return rows;
}

function snapshotAtUnit(timeline, unit) {
  if (!timeline) return null;
  const innings = timeline.innings || [];
  const inn1 = innings[0] || { deliveries: [], batting: [], bowling: [], score: 0, wickets: 0, balls: 0 };
  const inn2 = innings[1] || { deliveries: [], batting: [], bowling: [], score: 0, wickets: 0, balls: 0 };
  const u = Math.max(0, Number(unit) || 0);
  const tossEnd = 1;
  const inn1End = tossEnd + inn1.deliveries.length;
  const breakEnd = inn1End + 1;
  const inn2End = breakEnd + inn2.deliveries.length;

  let phase = "toss";
  let innIdx = 0;
  let ballIdx = -1;
  if (u >= inn2End) {
    phase = "over";
    innIdx = 1;
    ballIdx = inn2.deliveries.length - 1;
  } else if (u >= breakEnd) {
    phase = "live";
    innIdx = 1;
    ballIdx = u - breakEnd;
  } else if (u >= inn1End) {
    phase = "break";
    innIdx = 0;
    ballIdx = inn1.deliveries.length - 1;
  } else if (u >= tossEnd) {
    phase = "live";
    innIdx = 0;
    ballIdx = u - tossEnd;
  }

  const currentInn = innIdx === 0 ? inn1 : inn2;
  const deliveries = currentInn.deliveries || [];
  const shown = ballIdx >= 0 ? ballIdx : -1;
  let runs = 0;
  let wkts = 0;
  const batRuns = new Map();
  const batBalls = new Map();
  const bowlRuns = new Map();
  const bowlBalls = new Map();
  const bowlWkts = new Map();
  const bowlSet = new Set();
  for (let i = 0; i <= shown; i += 1) {
    const d = deliveries[i];
    if (!d) continue;
    runs += d.runs;
    if (d.wicket) wkts += 1;
    batRuns.set(d.batterId, (batRuns.get(d.batterId) || 0) + d.runs);
    batBalls.set(d.batterId, (batBalls.get(d.batterId) || 0) + 1);
    bowlRuns.set(d.bowlerId, (bowlRuns.get(d.bowlerId) || 0) + d.runs);
    bowlBalls.set(d.bowlerId, (bowlBalls.get(d.bowlerId) || 0) + 1);
    if (d.wicket) bowlWkts.set(d.bowlerId, (bowlWkts.get(d.bowlerId) || 0) + 1);
    bowlSet.add(d.bowlerId);
  }

  const cur = shown >= 0 ? deliveries[shown] : null;
  const battingTeam = currentInn.teamName;
  const bowlingTeam = innIdx === 0 ? timeline.secondName : timeline.firstName;
  let striker = null;
  let nonStriker = null;
  if (cur) {
    // Walk back to find the two at the crease: last two unique batters
    // who have not been dismissed after their last ball.
    const dismissed = new Set();
    const lastSeen = [];
    for (let i = 0; i <= shown; i += 1) {
      const d = deliveries[i];
      if (!d) continue;
      if (!lastSeen.includes(d.batterId)) lastSeen.push(d.batterId);
      if (d.wicket) dismissed.add(d.batterId);
    }
    const crease = [];
    for (let i = lastSeen.length - 1; i >= 0 && crease.length < 2; i -= 1) {
      if (!dismissed.has(lastSeen[i])) crease.push(lastSeen[i]);
    }
    if (crease.length < 2) {
      const used = new Set(lastSeen);
      const nxt = (currentInn.batting || []).find((p) => p && p.playerId && !used.has(p.playerId));
      if (nxt) crease.push(nxt.playerId);
    }
    const fmtBat = (id) => ({
      playerId: id,
      name: ((currentInn.batting || []).find((p) => p.playerId === id) || {}).name || cur.batterName,
      runs: batRuns.get(id) || 0,
      balls: batBalls.get(id) || 0,
    });
    striker = crease[0] ? fmtBat(crease[0]) : null;
    nonStriker = crease[1] ? fmtBat(crease[1]) : null;
    if (striker && cur.batterId !== striker.playerId && nonStriker && cur.batterId === nonStriker.playerId) {
      const tmp = striker;
      striker = nonStriker;
      nonStriker = tmp;
    } else if (striker && cur.batterId !== striker.playerId) {
      striker = fmtBat(cur.batterId);
    }
  }

  const bowler = cur
    ? {
      playerId: cur.bowlerId,
      name: cur.bowlerName,
      runs: bowlRuns.get(cur.bowlerId) || 0,
      balls: bowlBalls.get(cur.bowlerId) || 0,
      wickets: bowlWkts.get(cur.bowlerId) || 0,
      overs: formatOvers(bowlBalls.get(cur.bowlerId) || 0),
      maidens: 0,
    }
    : null;

  const legalBalls = shown + 1;
  const crr = legalBalls > 0 ? (runs / legalBalls) * 6 : 0;
  const target = innIdx === 1 ? (timeline.target != null ? timeline.target : inn1.score + 1) : null;
  const need = target != null ? target - runs : null;
  const ballsLeft = innIdx === 1 ? Math.max(0, inn2.balls - legalBalls) : null;
  const req = need != null && ballsLeft > 0 ? (need / ballsLeft) * 6 : (need != null && need <= 0 ? 0 : null);

  return {
    phase,
    inningsIndex: innIdx,
    ballIndex: shown,
    unit: u,
    done: phase === "over",
    toss: timeline.toss,
    battingTeam,
    bowlingTeam,
    score: Math.max(0, runs),
    wickets: wkts,
    balls: Math.max(0, legalBalls),
    overs: formatOvers(Math.max(0, legalBalls)),
    crr: Number(crr.toFixed(2)),
    target,
    need,
    req: req == null ? null : Number(req.toFixed(2)),
    firstInnings: {
      teamName: inn1.teamName,
      score: phase === "toss" ? null : (innIdx === 0 && phase === "live" ? runs : inn1.score),
      wickets: phase === "toss" ? null : (innIdx === 0 && phase === "live" ? wkts : inn1.wickets),
      overs: phase === "toss" ? null : (innIdx === 0 && phase === "live" ? formatOvers(Math.max(0, legalBalls)) : inn1.overs),
      complete: innIdx === 1 || phase === "break" || phase === "over",
    },
    striker,
    nonStriker,
    bowler,
    ticker: tickerForOver(deliveries, shown),
    lastBall: cur,
    battingCard: runningCard(currentInn.batting, "bat", deliveries, shown, cur && cur.batterId, nonStriker && nonStriker.playerId),
    bowlingCard: runningCard(currentInn.bowling, "bowl", deliveries, shown, cur && cur.bowlerId),
    officialBatting: currentInn.batting,
    officialBowling: currentInn.bowling,
    otherInnings: innIdx === 1
      ? { teamName: inn1.teamName, score: inn1.score, wickets: inn1.wickets, overs: inn1.overs, batting: inn1.batting, bowling: inn1.bowling }
      : null,
    resultText: phase === "over" ? timeline.resultText : null,
    winnerName: phase === "over" ? timeline.winnerName : null,
    potm: timeline.potm,
  };
}

function snapshotAtElapsed(timeline, elapsedMs, durationMs) {
  if (!timeline) return null;
  const dur = Math.max(0, Number(durationMs) || 0);
  const units = Math.max(1, Number(timeline.units) || 1);
  if (dur <= 0) return snapshotAtUnit(timeline, units);
  const elapsed = clamp(Number(elapsedMs) || 0, 0, dur);
  const unit = elapsed >= dur ? units : Math.floor((elapsed / dur) * units);
  return snapshotAtUnit(timeline, unit);
}

module.exports = {
  findFinalMatch,
  buildFinalTimeline,
  snapshotAtUnit,
  snapshotAtElapsed,
  playerOfTheMatch,
  formatOvers,
  distributeRuns,
};
