const { captainBonus, captainMatchesOf } = require("./captaincy");
const { inningsFormat } = require("./rules");

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function formatOvers(balls) {
  const n = Math.max(0, Number(balls) || 0);
  return (Math.floor(n / 6) + (n % 6) / 10).toFixed(1);
}

function isLegal(d) {
  return !d || d.legal !== false;
}

function playerRatings(slot, isCaptain) {
  const p = slot.player;
  const boost = isCaptain ? 1 + captainBonus(captainMatchesOf(p)) : 1;
  return {
    batting: p.batting * boost,
    bowling: p.bowling * boost,
  };
}

function rated(slot, team) {
  const isCap = Boolean(team && slot.player && slot.player.id === team.captainId);
  const r = playerRatings(slot, isCap);
  return {
    playerId: slot.player.id,
    name: slot.player.name,
    role: slot.player.role,
    batting: r.batting,
    bowling: r.bowling,
  };
}

function primaryBowler(role) {
  return role === "BOWL" || role === "AR";
}

function primaryBatter(role) {
  return role === "BAT" || role === "WK" || role === "AR";
}

function pickBowlingAttack(team, format) {
  const fmt = format || inningsFormat(team && team.mode);
  const want = Math.max(1, fmt.bowlerCount || 1);
  const ranked = (team.squad || []).map((s) => {
    const r = rated(s, team);
    return { ...r, primary: primaryBowler(r.role) };
  });
  ranked.sort((a, b) => Number(b.primary) - Number(a.primary) || b.bowling - a.bowling);
  const n = Math.min(want, Math.max(1, ranked.length));
  return ranked.slice(0, n);
}

function battingOrder(team) {
  const ranked = (team.squad || []).map((s) => {
    const r = rated(s, team);
    return { ...r, primary: primaryBatter(r.role), runs: 0, balls: 0, out: false };
  });
  ranked.sort((a, b) => Number(b.primary) - Number(a.primary) || b.batting - a.batting);
  return ranked;
}

function scheduleOvers(attack, format) {
  const fmt = format;
  const overs = fmt.overs;
  const quota = fmt.oversPerBowler;
  const allowConsecutive = Boolean(fmt.allowConsecutive) || attack.length <= 1;
  const pool = attack.map((b) => ({ ...b, left: quota }));
  const seq = [];
  let prev = null;
  for (let i = 0; i < overs; i += 1) {
    let candidates = pool.filter((b) => b.left > 0 && (allowConsecutive || b.playerId !== prev));
    if (!candidates.length) candidates = pool.filter((b) => b.left > 0);
    if (!candidates.length) candidates = pool.slice();
    candidates.sort((a, b) => b.left - a.left || b.bowling - a.bowling);
    const pick = candidates[0];
    seq.push(pick);
    if (pick.left > 0) pick.left -= 1;
    prev = pick.playerId;
  }
  return seq;
}

function sampleScoring(rng, rpb) {
  const t = clamp((rpb - 1.0) / 0.8, -0.9, 1.6);
  const weights = [
    [0, Math.max(0.08, 0.38 - t * 0.12)],
    [1, Math.max(0.14, 0.39 - t * 0.05)],
    [2, Math.max(0.03, 0.08 + t * 0.02)],
    [3, 0.012],
    [4, Math.max(0.025, 0.09 + t * 0.08)],
    [6, Math.max(0.012, 0.048 + t * 0.07)],
  ];
  const sum = weights.reduce((s, x) => s + x[1], 0);
  let u = rng() * sum;
  for (const [val, w] of weights) {
    u -= w;
    if (u <= 0) return val;
  }
  return 1;
}

function bowlBall(rng, ctx) {
  const { batter, bowler, rpb, target, score, legal, format } = ctx;
  const ballsLeft = Math.max(0, format.balls - legal);
  const need = target != null ? target - score : null;
  const req = need != null && ballsLeft > 0 ? need / ballsLeft : rpb;
  const skill = ((batter.batting || 50) - (bowler.bowling || 50)) / 100;
  const adjRpb = Math.max(0.3, rpb + skill * 0.7);
  const chaseAgg = need != null ? clamp((req - rpb) * 0.5, -0.3, 0.85) : 0;
  const usedRpb = Math.max(0.25, adjRpb + chaseAgg);

  const pExtra = clamp(0.03 + Math.max(0, 75 - (bowler.bowling || 75)) * 0.00025, 0.02, 0.06);
  if (rng() < pExtra) {
    const extraType = rng() < 0.75 ? "wd" : "nb";
    return { legal: false, runs: 1, batterRuns: 0, wicket: false, extraType };
  }

  let pW = 0.042 - skill * 0.035 + (chaseAgg > 0.25 ? 0.02 : 0);
  if (need != null && ballsLeft <= 6 && req > 2) pW += 0.02;
  pW = clamp(pW, 0.012, 0.16);
  if (rng() < pW) {
    return { legal: true, runs: 0, batterRuns: 0, wicket: true, extraType: null };
  }
  const runs = sampleScoring(rng, usedRpb);
  return { legal: true, runs, batterRuns: runs, wicket: false, extraType: null };
}

function highlightOf(d) {
  if (d.wicket) return "W";
  if (!isLegal(d) && d.extraType === "nb") return "Nb";
  if (!isLegal(d)) return "Wd";
  if (d.runs >= 6) return "6";
  if (d.runs === 4) return "4";
  return null;
}

function makeDelivery(i, legalBefore, ev, batter, bowler) {
  const legalBallsAfter = legalBefore + (ev.legal ? 1 : 0);
  return {
    i,
    over: Math.floor(legalBefore / 6),
    ball: (legalBefore % 6) + (ev.legal ? 1 : 0),
    overs: formatOvers(legalBallsAfter),
    runs: ev.runs,
    batterRuns: ev.batterRuns,
    wicket: Boolean(ev.wicket),
    legal: ev.legal !== false,
    extraType: ev.extraType || null,
    extras: ev.legal === false ? ev.runs : 0,
    batterId: batter.playerId,
    batterName: batter.name,
    bowlerId: bowler.playerId,
    bowlerName: bowler.name,
    highlight: highlightOf(ev),
  };
}

function emptyExtras() {
  return { wides: 0, noBalls: 0, byes: 0, legByes: 0, total: 0 };
}

function cardsFromDeliveries(deliveries, batters, bowlers) {
  const batMap = new Map();
  for (const b of batters || []) {
    batMap.set(b.playerId, {
      playerId: b.playerId,
      name: b.name,
      role: b.role,
      runs: 0,
      balls: 0,
      out: false,
    });
  }
  const bowlMap = new Map();
  for (const b of bowlers || []) {
    bowlMap.set(b.playerId, {
      playerId: b.playerId,
      name: b.name,
      role: b.role,
      balls: 0,
      wickets: 0,
      runsConceded: 0,
    });
  }
  const extras = emptyExtras();
  let score = 0;
  let wickets = 0;
  let legal = 0;
  for (const d of deliveries || []) {
    score += d.runs;
    if (d.wicket) wickets += 1;
    if (isLegal(d)) legal += 1;
    if (d.extraType === "wd") {
      extras.wides += d.extras || d.runs || 0;
      extras.total += d.extras || d.runs || 0;
    } else if (d.extraType === "nb") {
      extras.noBalls += d.extras || d.runs || 0;
      extras.total += d.extras || d.runs || 0;
    } else if (!isLegal(d)) {
      extras.total += d.extras || d.runs || 0;
    }
    const bat = batMap.get(d.batterId);
    if (bat) {
      bat.runs += d.batterRuns != null ? d.batterRuns : (isLegal(d) && !d.extraType ? d.runs : 0);
      if (isLegal(d)) bat.balls += 1;
      if (d.wicket) bat.out = true;
    } else if (d.batterId) {
      const row = {
        playerId: d.batterId,
        name: d.batterName,
        role: null,
        runs: d.batterRuns || 0,
        balls: isLegal(d) ? 1 : 0,
        out: Boolean(d.wicket),
      };
      batMap.set(d.batterId, row);
    }
    const bowl = bowlMap.get(d.bowlerId);
    if (bowl) {
      bowl.runsConceded += d.runs;
      if (isLegal(d)) bowl.balls += 1;
      if (d.wicket) bowl.wickets += 1;
    } else if (d.bowlerId) {
      bowlMap.set(d.bowlerId, {
        playerId: d.bowlerId,
        name: d.bowlerName,
        role: null,
        balls: isLegal(d) ? 1 : 0,
        wickets: d.wicket ? 1 : 0,
        runsConceded: d.runs,
      });
    }
  }
  const batting = [];
  const seenBat = new Set();
  for (const b of batters || []) {
    const row = batMap.get(b.playerId);
    if (!row) continue;
    if (row.balls === 0 && !row.out) continue;
    batting.push(row);
    seenBat.add(b.playerId);
  }
  for (const row of batMap.values()) {
    if (!seenBat.has(row.playerId) && (row.balls || row.out)) batting.push(row);
  }
  const bowling = [];
  const seenBowl = new Set();
  for (const b of bowlers || []) {
    const row = bowlMap.get(b.playerId);
    if (!row || (row.balls === 0 && row.runsConceded === 0 && row.wickets === 0)) continue;
    bowling.push(row);
    seenBowl.add(b.playerId);
  }
  for (const row of bowlMap.values()) {
    if (!seenBowl.has(row.playerId) && (row.balls || row.runsConceded || row.wickets)) bowling.push(row);
  }
  return {
    score,
    wickets,
    balls: legal,
    overs: formatOvers(legal),
    extras,
    batting,
    bowling,
  };
}

function recountInnings(inn, batters, bowlers) {
  const tallied = cardsFromDeliveries(inn.deliveries || [], batters || inn._batters || inn.batting, bowlers || inn._bowlers || inn.bowling);
  inn.score = tallied.score;
  inn.wickets = tallied.wickets;
  inn.balls = tallied.balls;
  inn.overs = tallied.overs;
  inn.extras = tallied.extras;
  inn.batting = tallied.batting;
  inn.bowling = tallied.bowling;
  return inn;
}

function playInnings({ rng, battingTeam, bowlingTeam, batting, bowling, target, format }) {
  const fmt = format || inningsFormat((battingTeam && battingTeam.mode) || (bowlingTeam && bowlingTeam.mode));
  const order = battingOrder(battingTeam);
  const attack = pickBowlingAttack(bowlingTeam, fmt);
  const oversPlan = scheduleOvers(attack, fmt);
  const expected = fmt.expectedRuns + ((Number(batting) || 0) - (Number(bowling) || 0)) * fmt.edgeScale;
  const rpb = expected / Math.max(1, fmt.balls);

  const deliveries = [];
  let legal = 0;
  let score = 0;
  let wickets = 0;
  let striker = 0;
  let nonStriker = order.length > 1 ? 1 : -1;
  let nextBat = 2;

  function ended() {
    if (wickets >= fmt.maxWickets) return true;
    if (legal >= fmt.balls) return true;
    if (target != null && score >= target) return true;
    return false;
  }

  function swap() {
    if (nonStriker < 0) return;
    const tmp = striker;
    striker = nonStriker;
    nonStriker = tmp;
  }

  for (let overNo = 0; overNo < oversPlan.length && !ended(); overNo += 1) {
    const bowler = oversPlan[overNo];
    let inOver = 0;
    while (inOver < 6 && !ended()) {
      const batter = order[striker];
      if (!batter) break;
      const ev = bowlBall(rng, { batter, bowler, rpb, target, score, legal, format: fmt });
      const d = makeDelivery(deliveries.length, legal, ev, batter, bowler);
      deliveries.push(d);
      score += ev.runs;
      if (ev.legal) {
        legal += 1;
        inOver += 1;
        batter.balls += 1;
        batter.runs += ev.batterRuns;
        if (ev.wicket) {
          wickets += 1;
          batter.out = true;
          if (wickets < fmt.maxWickets && nextBat < order.length) {
            striker = nextBat;
            nextBat += 1;
          }
        } else if (ev.batterRuns % 2 === 1) {
          swap();
        }
      }
    }
    if (!ended()) swap();
  }

  const tallied = cardsFromDeliveries(deliveries, order, attack);
  return {
    score: tallied.score,
    wickets: tallied.wickets,
    balls: tallied.balls,
    overs: tallied.overs,
    extras: tallied.extras,
    deliveries,
    batting: tallied.batting,
    bowling: tallied.bowling,
    chased: target != null && tallied.score >= target,
    _batters: order,
    _bowlers: attack,
  };
}

function addRunsToDelivery(d, add) {
  if (!add) return 0;
  const room = Math.max(0, 6 - (d.batterRuns || 0));
  const use = Math.min(room, add);
  if (!use) return 0;
  d.batterRuns = (d.batterRuns || 0) + use;
  d.runs = (d.runs || 0) + use;
  d.highlight = highlightOf(d);
  return use;
}

function forceReach(inn, target) {
  let score = (inn.deliveries || []).reduce((s, d) => s + d.runs, 0);
  if (score >= target) return recountInnings(inn);
  const balls = inn.deliveries || [];
  for (let i = balls.length - 1; i >= 0 && score < target; i -= 1) {
    const d = balls[i];
    if (!isLegal(d) || d.wicket) continue;
    score += addRunsToDelivery(d, target - score);
  }
  for (let i = balls.length - 1; i >= 0 && score < target; i -= 1) {
    const d = balls[i];
    if (!d.wicket) continue;
    d.wicket = false;
    d.highlight = highlightOf(d);
    score += addRunsToDelivery(d, target - score);
  }
  if (score < target && balls.length) {
    const d = balls[balls.length - 1];
    const need = target - score;
    d.runs += need;
    d.batterRuns = (d.batterRuns || 0) + need;
    d.wicket = false;
    d.highlight = highlightOf(d);
  }
  return recountInnings(inn);
}

function forceShort(inn, target) {
  const cap = Math.max(0, target - 1);
  let score = (inn.deliveries || []).reduce((s, d) => s + d.runs, 0);
  const balls = inn.deliveries || [];
  for (let i = balls.length - 1; i >= 0 && score > cap; i -= 1) {
    const d = balls[i];
    const bat = d.batterRuns || 0;
    if (bat <= 0) continue;
    const cut = Math.min(bat, score - cap);
    d.batterRuns = bat - cut;
    d.runs = Math.max(0, (d.runs || 0) - cut);
    d.highlight = highlightOf(d);
    score -= cut;
  }
  for (let i = balls.length - 1; i >= 0 && score > cap; i -= 1) {
    const d = balls[i];
    if (!d.extras && isLegal(d)) continue;
    const cut = Math.min(d.runs || 0, score - cap);
    if (!cut) continue;
    d.runs -= cut;
    d.extras = Math.max(0, (d.extras || 0) - cut);
    d.highlight = highlightOf(d);
    score -= cut;
  }
  return recountInnings(inn);
}

function applyResultFlip(inn2, inn1, wantChase) {
  const target = (inn1.score || 0) + 1;
  if (wantChase) forceReach(inn2, target);
  else forceShort(inn2, target);
  inn2.chased = wantChase && inn2.score >= target;
  return inn2;
}

module.exports = {
  formatOvers,
  isLegal,
  pickBowlingAttack,
  battingOrder,
  scheduleOvers,
  playInnings,
  cardsFromDeliveries,
  recountInnings,
  applyResultFlip,
  forceReach,
  forceShort,
};
