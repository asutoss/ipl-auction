/* global window */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IplFinal = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function formatOvers(balls) {
    const n = Math.max(0, Number(balls) || 0);
    return `${Math.floor(n / 6)}.${n % 6}`;
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function tickerForOver(deliveries, upto) {
    if (!deliveries || upto < 0) return [];
    const cur = deliveries[upto];
    if (!cur) return [];
    const marks = [];
    for (let i = 0; i <= upto; i += 1) {
      const d = deliveries[i];
      if (!d || d.over !== cur.over) continue;
      marks.push(d.wicket ? "W" : String(d.runs >= 6 ? 6 : d.runs));
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
    const inn1End = tossEnd + (inn1.deliveries || []).length;
    const breakEnd = inn1End + 1;
    const inn2End = breakEnd + (inn2.deliveries || []).length;

    let phase = "toss";
    let innIdx = 0;
    let ballIdx = -1;
    if (u >= inn2End) {
      phase = "over";
      innIdx = 1;
      ballIdx = (inn2.deliveries || []).length - 1;
    } else if (u >= breakEnd) {
      phase = "live";
      innIdx = 1;
      ballIdx = u - breakEnd;
    } else if (u >= inn1End) {
      phase = "break";
      innIdx = 0;
      ballIdx = (inn1.deliveries || []).length - 1;
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
    }

    const cur = shown >= 0 ? deliveries[shown] : null;
    const battingTeam = currentInn.teamName;
    let striker = null;
    let nonStriker = null;
    if (cur) {
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
      }
      : null;

    const legalBalls = shown + 1;
    const crr = legalBalls > 0 ? (runs / legalBalls) * 6 : 0;
    const target = innIdx === 1 ? (timeline.target != null ? timeline.target : inn1.score + 1) : null;
    const need = target != null ? target - runs : null;
    const ballsLeft = innIdx === 1 ? Math.max(0, (inn2.balls || 0) - legalBalls) : null;
    const req = need != null && ballsLeft > 0 ? (need / ballsLeft) * 6 : (need != null && need <= 0 ? 0 : null);

    return {
      phase,
      inningsIndex: innIdx,
      ballIndex: shown,
      done: phase === "over",
      toss: timeline.toss,
      battingTeam,
      bowlingTeam: innIdx === 0 ? timeline.secondName : timeline.firstName,
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
      otherInnings: innIdx === 1 || phase === "over"
        ? { teamName: inn1.teamName, score: inn1.score, wickets: inn1.wickets, overs: inn1.overs, batting: inn1.batting, bowling: inn1.bowling }
        : (innIdx === 0 && (phase === "break")
          ? { teamName: inn1.teamName, score: inn1.score, wickets: inn1.wickets, overs: inn1.overs, batting: inn1.batting, bowling: inn1.bowling }
          : null),
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

  function elapsedOf(fin, stage, now) {
    if (!fin) return 0;
    const dur = Number(fin.durationMs) || 0;
    if (stage === "done" || !dur) return dur;
    if (fin.paused) return Math.min(dur, Number(fin.elapsedMs) || 0);
    const origin = fin.serverNow || fin.startedAt;
    const base = Number(fin.elapsedMs) || 0;
    if (!origin) return Math.min(dur, base);
    return Math.min(dur, Math.max(0, base + Math.max(0, (now || Date.now()) - origin)));
  }

  return { formatOvers, snapshotAtUnit, snapshotAtElapsed, elapsedOf };
});
