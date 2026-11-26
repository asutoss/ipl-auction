const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { loadPlayers, overallRating } = require("../server/players");
const {
  bidIncrement,
  nextBidAmount,
  canBidFor,
  minCostToFill,
  QUOTA,
  MAX_OVERSEAS,
  isSquadComplete,
  pendingSlots,
  canAddToSquad,
  addToSquad,
  getMode,
} = require("../server/rules");
const { GameRoom } = require("../server/game");
const { simulateTournament, teamStrength, squadStrengthScore, squadStrengthBreakdown, STRENGTH_WEIGHTS, PILLAR_RAW_CAP, SCORE_SCALE, matchStrength, formMultiplier, FORM_EFFECT } = require("../server/simulate");
const { findFinalMatch, buildFinalTimeline, snapshotAtElapsed } = require("../server/final-timeline");

const { meta, players } = loadPlayers();

function roomWith(names, timers, opts = {}) {
  const mode = opts.mode || "classical";
  const { getMode } = require("../server/rules");
  const purse = opts.purseLakhs != null ? opts.purseLakhs : (opts.mode ? getMode(mode).purse : 100);
  const room = new GameRoom({
    code: "TEST",
    purseLakhs: purse,
    mode,
    timers: { lotStartMs: 15_000, bidMs: 15_000, captainMs: 90_000, soldRevealMs: 0, lastTeamFillMs: 0, playerIntroMs: 0, resultsRevealStepMs: 0, formBoostRevealMs: 0, finalMatchMs: 0, autofillRevealMs: 0, ...(timers || {}) },
    allPlayers: players,
    meta,
    seed: opts.seed,
    rng: opts.rng,
    characterOrder: opts.characterOrder,
  });
  names.forEach((n, i) => room.addPlayer(n, `sock-${i}`));
  room.forcedStartBid = 2; // keep existing tests stable; start-bid range is tested separately
  return room;
}

function takeForQuota(room, need) {
  const picked = [];
  const left = { ...need };
  for (const p of players) {
    if ((left[p.role] || 0) > 0 && !room.soldIds.has(p.id) && !(room.isRetired && room.isRetired(p.id))) {
      picked.push(p);
      room.soldIds.add(p.id);
      left[p.role] -= 1;
    }
  }
  return picked;
}

function giveSquad(room, name, need, price = 2) {
  const team = room.findByName(name);
  for (const p of takeForQuota(room, need)) {
    team.squad.push({ player: p, priceLakhs: price });
    team.purseLakhs -= price;
  }
  return team;
}

describe("player pool", () => {
  test("loads ~60-80+ current players with required fields", () => {
    assert.ok(players.length >= 230, `got ${players.length}`);
    const byRole = players.reduce((acc, p) => { acc[p.role] = (acc[p.role] || 0) + 1; return acc; }, {});
    assert.ok(byRole.BAT >= 60, `BAT ${byRole.BAT}`);
    assert.ok(byRole.WK >= 15, `WK ${byRole.WK}`);
    assert.ok(byRole.AR >= 30, `AR ${byRole.AR}`);
    assert.ok(byRole.BOWL >= 55, `BOWL ${byRole.BOWL}`);
    for (const p of players) {
      assert.ok(p.id && p.name);
      assert.ok(["BAT", "WK", "AR", "BOWL"].includes(p.role), p.name);
      assert.equal(typeof p.overseas, "boolean");
      assert.equal(p.basePriceLakhs, 1);
      assert.ok(p.batting >= 0 && p.batting <= 100);
      assert.ok(p.bowling >= 0 && p.bowling <= 100);
    }
    assert.ok(meta.ratingsNote.toLowerCase().includes("estimate"));
    const names = players.map((p) => p.name);
    for (const known of ["Virat Kohli", "Shikhar Dhawan", "Chris Gayle", "Cheteshwar Pujara", "MS Dhoni", "Kieron Pollard", "Harbhajan Singh"]) {
      assert.ok(names.includes(known), `missing known player ${known}`);
    }
    for (const obscure of ["Aaradhya Yadav", "Swastik Chhikara", "Sudip Gharami", "Uday Saharan", "Ayush Pandey"]) {
      assert.ok(!names.includes(obscure), `obscure name still present ${obscure}`);
    }
    const batRatings = players.filter((p) => p.role === "BAT" || p.role === "WK").map((p) => p.batting);
    assert.ok(Math.min(...batRatings) <= 55, "need weaker known batters");
    assert.ok(Math.max(...batRatings) >= 90, "need star batters");
  });
});

describe("captain bonus", () => {
  const {
    captainMatchesOf,
    captainBonus,
    captainBonusPct,
    formatCaptainBonus,
    CAPTAIN_BONUS_MAX,
    CAPTAIN_MATCHES_FOR_MAX,
  } = require("../server/captaincy");
  const { countFor } = require("../scripts/captain-matches");

  test("every player has an IPL captaincy-match count, 0 if they never captained", () => {
    assert.equal(players.length, 337);
    const expected = {
      "MS Dhoni": 235,
      "Rohit Sharma": 158,
      "Virat Kohli": 143,
      "Gautam Gambhir": 129,
      "Shreyas Iyer": 101,
      "KL Rahul": 64,
      "Steve Smith": 43,
      "Shubman Gill": 43,
      "Jasprit Bumrah": 1,
      "Abhishek Sharma": 0,
      "Jofra Archer": 0,
    };
    for (const p of players) {
      const n = captainMatchesOf(p);
      assert.equal(Number.isInteger(n) && n >= 0, true, p.name);
      assert.equal("captainMatches" in p, false, `loaded player should not expose captainMatches: ${p.name}`);
      if (expected[p.name] != null) assert.equal(n, expected[p.name], p.name);
      assert.equal(n, countFor(p.name), p.name);
    }
  });

  test("bonus is 0% only if they never captained, then 1–5% log-scaled, capped at Rohit Sharma's 158 matches", () => {
    assert.equal(CAPTAIN_MATCHES_FOR_MAX, 158);
    assert.equal(CAPTAIN_BONUS_MAX, 0.05);
    assert.equal(captainBonus(0), 0);
    assert.equal(captainBonus(158), 0.05);
    assert.equal(captainBonus(235), 0.05);
    assert.equal(captainBonusPct(0), 0);
    assert.equal(captainBonusPct(158), 5);
    assert.equal(captainBonusPct(235), 5);
    assert.equal(captainBonusPct(143), 4.9);
    assert.equal(captainBonusPct(43), 4);
    assert.equal(captainBonusPct(5), 2.3);
    assert.equal(captainBonus(1), 0.01);
    assert.equal(captainBonusPct(1), 1);
    let prev = -1;
    for (let n = 0; n <= 158; n++) {
      const b = captainBonus(n);
      assert.ok(b >= prev - 1e-12, `monotonic at ${n}`);
      assert.ok(b >= 0 && b <= 0.05 + 1e-12);
      prev = b;
    }
    assert.equal(formatCaptainBonus(0), "+0.0%");
    assert.equal(formatCaptainBonus(1), "+1.0%");
    assert.equal(formatCaptainBonus(43), "+4.0%");
    assert.equal(formatCaptainBonus(143), "+4.9%");
    assert.equal(formatCaptainBonus(158), "+5.0%");
    assert.equal(formatCaptainBonus(235), "+5.0%");
  });

  test("the captain's rating boost uses the curve, not a flat 5%", () => {
    const kohli = players.find((p) => p.id === "virat-kohli");
    const rookie = players.find((p) => p.id === "abhishek-sharma") || players.find((p) => captainMatchesOf(p) === 0);
    assert.ok(kohli && rookie);
    const cap = { name: "A", formPct: 100, mode: "classical", boosters: [], squad: [{ player: kohli, priceLakhs: 2 }], captainId: kohli.id };
    const noCap = { ...cap, captainId: null };
    const capS = teamStrength(cap).batting;
    const noS = teamStrength(noCap).batting;
    assert.ok(Math.abs(capS - noS * (1 + captainBonus(143))) < 1e-9, `${capS} vs ${noS}`);
    const rookieCap = { name: "B", formPct: 100, mode: "classical", boosters: [], squad: [{ player: rookie, priceLakhs: 2 }], captainId: rookie.id };
    const rookieNo = { ...rookieCap, captainId: null };
    assert.equal(teamStrength(rookieCap).batting, teamStrength(rookieNo).batting);
  });

  test("the bonus is hidden until a captain is selected, then packed for every client", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    const need = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
    for (const name of ["Ashutosh", "Priya"]) {
      const team = room.findByName(name);
      for (const p of players) {
        if ((need[p.role] || 0) > 0 && !room.soldIds.has(p.id)) {
          team.squad.push({ player: p, priceLakhs: 2 });
          room.soldIds.add(p.id);
          need[p.role] -= 1;
        }
      }
      if (name === "Priya") need.BAT = 4, need.WK = 1, need.AR = 2, need.BOWL = 4;
    }
    // Re-fill Priya properly
    room.findByName("Priya").squad = [];
    const priyaNeed = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
    const priya = room.findByName("Priya");
    for (const p of players) {
      if ((priyaNeed[p.role] || 0) > 0 && !room.soldIds.has(p.id)) {
        priya.squad.push({ player: p, priceLakhs: 2 });
        room.soldIds.add(p.id);
        priyaNeed[p.role] -= 1;
      }
    }
    function assertNoCaptainMatches(value, path) {
      if (!value || typeof value !== "object") return;
      assert.equal(Object.prototype.hasOwnProperty.call(value, "captainMatches"), false, `captainMatches leaked at ${path}`);
      if (Array.isArray(value)) {
        value.forEach((item, i) => assertNoCaptainMatches(item, `${path}[${i}]`));
        return;
      }
      for (const key of Object.keys(value)) assertNoCaptainMatches(value[key], `${path}.${key}`);
    }
    const ash = room.findByName("Ashutosh");
    const kohli = ash.squad.find((s) => s.player.id === "virat-kohli");
    assert.ok(kohli, "Ashutosh should have been dealt Virat Kohli first");
    room.beginCaptainPhase();
    const before = room.getState("ashutosh");
    assert.equal(before.you.captainId, null);
    assert.equal(before.you.captainBonusLabel, null);
    assertNoCaptainMatches(before, "before");
    for (const f of before.franchises) {
      assert.equal(f.captainBonusLabel, null);
      for (const s of f.squad) {
        assert.equal("captainBonusLabel" in (s.player || {}), false);
      }
    }
    const pick = room.selectCaptain("Ashutosh", "virat-kohli");
    assert.equal(pick.ok, true);
    const after = room.getState("priya");
    const team = after.franchises.find((f) => f.name === "Ashutosh");
    assert.equal(team.captainId, "virat-kohli");
    assert.equal(team.captainBonusLabel, "+4.9%");
    assert.equal(team.captainBonusPct, 4.9);
    assert.ok(after.prepFeed.some((e) => e.message === "Ashutosh named Virat Kohli · +4.9%"));
    assertNoCaptainMatches(after, "after");
    const stillChoosing = after.franchises.find((f) => f.name === "Priya");
    assert.equal(stillChoosing.captainBonusLabel, null);
    room.findByName("Priya").captainId = priya.squad[0].player.id;
    room.finishCaptains();
    assertNoCaptainMatches(room.getState("ashutosh"), "results");
  });
});

describe("bid increments", () => {
  test("raises are +1, +2 or +5 points from the current bid", () => {
    const { BID_STEPS, isLegalRaise } = require("../server/rules");
    assert.deepEqual(BID_STEPS, [1, 2, 5]);
    assert.equal(bidIncrement(2), 1);
    assert.equal(isLegalRaise(2, 3, true), true);
    assert.equal(isLegalRaise(2, 4, true), true);
    assert.equal(isLegalRaise(2, 7, true), true);
    assert.equal(isLegalRaise(2, 8, true), false);
    assert.equal(isLegalRaise(2, 2, true), false);
  });

  test("first bid is base price; later minimum is +1", () => {
    assert.equal(nextBidAmount(2, false), 2);
    assert.equal(nextBidAmount(2, true), 3);
    assert.equal(nextBidAmount(7, true), 8);
  });
});

describe("bid validation", () => {
  test("rejects a bid when the role quota is already full", () => {
    const kohli = players.find((p) => p.id === "virat-kohli");
    const extras = players.filter((p) => p.role === "BAT" && p.id !== kohli.id).slice(0, 4);
    const franchise = {
      purseLakhs: 100,
      squad: extras.map((p) => ({ player: p, priceLakhs: 2 })),
    };
    const result = canBidFor(franchise, kohli, 3, players.filter((p) => p.id !== kohli.id));
    assert.equal(result.ok, false);
    assert.match(result.reason, /quota/i);
  });

  test("rejects a bid that would leave too little purse to complete the XI", () => {
    const star = players.find((p) => p.id === "jasprit-bumrah");
    const franchise = { purseLakhs: 400, squad: [] };
    const result = canBidFor(franchise, star, 400, players.filter((p) => p.id !== star.id));
    assert.equal(result.ok, false);
    assert.match(result.reason, /purse/i);
  });

  test("min cost to fill a full empty XI is finite", () => {
    const cost = minCostToFill({ BAT: 4, WK: 1, AR: 2, BOWL: 4 }, MAX_OVERSEAS, players);
    assert.ok(Number.isFinite(cost));
    assert.ok(cost > 0 && cost < 10000);
  });
});

describe("auction opt-out and lock-in", () => {
  test("locks the player to the highest bidder when everyone else opts out", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    const kohli = players.find((p) => p.id === "virat-kohli");
    const next = players.find((p) => p.id === "karun-nair");
    room.queue = [kohli, next];
    room.phase = "auction";
    room.nominateNext();
    // Default bid goes to the first team in round-robin (Ashutosh).
    assert.equal(room.auction.nominee.id, "virat-kohli");
    assert.equal(room.auction.currentBidderKey, "ashutosh");
    const startBid = room.auction.startBidLakhs;
    assert.equal(room.auction.currentBidLakhs, startBid);
    assert.ok(room.stillInTeams().length >= 2);

    const out = room.optOut("Priya");
    assert.equal(out.ok, true);
    const csk = room.findByName("Ashutosh");
    assert.equal(csk.squad.length, 1);
    assert.equal(csk.squad[0].player.id, "virat-kohli");
    assert.equal(csk.squad[0].priceLakhs, startBid);
    assert.equal(csk.purseLakhs, 100 - startBid);
  });

  test("default bid means the player does not go unsold if someone can take the role", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    const player = players.find((p) => p.id === "karun-nair");
    const next = players.find((p) => p.id === "gautam-gambhir");
    room.queue = [player, next];
    room.phase = "auction";
    room.nominateNext();
    assert.equal(room.auction.currentBidderKey, "ashutosh");
    assert.equal(room.optOut("Priya").ok, true);
    assert.equal(room.lastEvent.type, "sold");
    assert.equal(room.lastEvent.player.id, player.id);
    assert.equal(room.findByName("Ashutosh").squad[0].player.id, player.id);
  });

  test("the leading bidder cannot opt out, and still-in hides opted-out teams", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"]);
    room.queue = [players.find((p) => p.id === "jos-buttler"), players.find((p) => p.id === "ms-dhoni")];
    room.phase = "auction";
    room.nominateNext();
    // Ashutosh already holds the default bid.
    const denied = room.optOut("Ashutosh");
    assert.equal(denied.ok, false);
    room.optOut("Priya");
    const names = room.stillInTeams().map((f) => f.name).sort();
    assert.deepEqual(names, ["Ashutosh", "Rohan"]);
    const state = room.getState("Priya");
    assert.ok(!state.auction.stillIn.some((t) => t.name === "Priya"));
    assert.equal(state.auction.youCanBid, false);
    assert.equal(state.auction.youCanOptOut, false);
  });

  test("only +1, +2 or +5 raises are accepted", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    room.queue = [players.find((p) => p.id === "jasprit-bumrah")];
    room.phase = "auction";
    room.nominateNext();
    const illegal = room.bid("Priya", 20);
    assert.equal(illegal.ok, false);
    const res = room.bid("Priya", room.auction.currentBidLakhs + 5);
    assert.equal(res.ok, true);
    assert.equal(room.auction.currentBidLakhs, 7);
    assert.equal(room.auction.currentBidderKey, "priya");
  });

  test("default bid skips a team whose role quota is full and goes to a team that can add the player", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"]);
    const wks = players.filter((p) => p.role === "WK");
    room.findByName("Ashutosh").squad.push({ player: wks[0], priceLakhs: 2 });
    room.findByName("Ashutosh").purseLakhs -= 2;
    room.soldIds.add(wks[0].id);
    room.queue = [wks[1], players.find((p) => p.id === "karun-nair")];
    room.phase = "auction";
    room.rrIndex = 0; // Ashutosh's slot — must skip to Priya
    room.nominateNext();
    assert.equal(room.auction.nominee.id, wks[1].id);
    assert.equal(room.auction.currentBidderKey, "priya");
    const names = room.stillInTeams().map((f) => f.name).sort();
    assert.deepEqual(names, ["Priya", "Rohan"]);
    assert.equal(room.getState("Ashutosh").auction.youCanBid, false);
    assert.match(room.getState("Ashutosh").auction.youReason, /quota is full/i);
    assert.equal(room.getState("Priya").auction.youCanBid, false);
    assert.match(room.getState("Priya").auction.youReason, /leading bid/i);
    room.optOut("Rohan");
    assert.equal(room.findByName("Priya").squad[0].player.id, wks[1].id);
    assert.equal(room.findByName("Ashutosh").squad.filter((s) => s.player.role === "WK").length, 1);
  });
});

describe("default bid, round-robin and elimination", () => {
  test("assigns the base-price default bid round-robin across teams", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"]);
    const bats = players.filter((p) => p.role === "BAT");
    room.queue = [bats[0], bats[1], bats[2]];
    room.phase = "auction";
    room.nominateNext();
    assert.equal(room.auction.currentBidderKey, "ashutosh");
    assert.equal(room.auction.currentBidLakhs, room.auction.startBidLakhs);
    assert.equal(room.getState("Ashutosh").auction.isDefaultBidLeading, true);

    room.optOut("Priya");
    room.optOut("Rohan");
    assert.equal(room.findByName("Ashutosh").squad[0].player.id, bats[0].id);

    assert.equal(room.auction.nominee.id, bats[1].id);
    assert.equal(room.auction.currentBidderKey, "priya");
    room.optOut("Ashutosh");
    room.optOut("Rohan");
    assert.equal(room.findByName("Priya").squad[0].player.id, bats[1].id);

    assert.equal(room.auction.currentBidderKey, "rohan");
    assert.equal(room.auction.nominee.id, bats[2].id);
  });

  test("default bid is not given to a team whose role quota is already full", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"]);
    const bats = players.filter((p) => !p.overseas && p.role === "BAT");
    const a = room.findByName("Ashutosh");
    for (const p of bats.slice(0, 4)) {
      a.squad.push({ player: p, priceLakhs: p.basePriceLakhs });
      a.purseLakhs -= p.basePriceLakhs;
      room.soldIds.add(p.id);
    }
    const nextBat = bats[4];
    room.queue = [nextBat, players.find((p) => p.id === "karun-nair")];
    room.phase = "auction";
    room.rrIndex = 0; // Ashutosh's turn — skip to Priya
    room.nominateNext();
    assert.equal(room.auction.nominee.id, nextBat.id);
    assert.equal(room.auction.currentBidderKey, "priya");
    room.optOut("Rohan");
    assert.equal(room.findByName("Priya").squad[0].player.id, nextBat.id);
    assert.equal(a.squad.filter((s) => s.player.role === "BAT").length, 4);
  });

  test("eliminates a team that cannot afford the default-bid base price", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"]);
    const star = players.find((p) => p.id === "virat-kohli");
    room.findByName("Ashutosh").purseLakhs = 1; // below the 2-point base
    room.queue = [star, players.find((p) => p.id === "karun-nair")];
    room.phase = "auction";
    room.nominateNext();
    const a = room.findByName("Ashutosh");
    assert.equal(a.eliminated, true);
    assert.equal(a.eliminatedReason, "insufficient purse");
    assert.equal(room.auction.currentBidderKey, "priya");
    assert.equal(room.auction.nominee.id, "virat-kohli");
    const state = room.getState("Ashutosh");
    assert.equal(state.you.eliminated, true);
    assert.match(state.you.eliminatedReason, /Eliminated - insufficient purse/);
    assert.ok(state.eliminationLog.some((e) => e.name === "Ashutosh"));
    assert.ok(!room.stillInTeams().some((f) => f.name === "Ashutosh"));
  });

  test("skips a player whose role no incomplete team still needs", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    const wks = players.filter((p) => p.role === "WK");
    room.findByName("Ashutosh").squad.push({ player: wks[0], priceLakhs: 2 });
    room.findByName("Priya").squad.push({ player: wks[1], priceLakhs: 2 });
    room.soldIds.add(wks[0].id);
    room.soldIds.add(wks[1].id);
    const leftover = wks[2];
    const bat = players.find((p) => p.id === "karun-nair");
    room.queue = [leftover, bat];
    room.phase = "auction";
    const events = [];
    room.on("delta", (e) => events.push(e));
    room.nominateNext();
    // Both teams already have their WK, so the extra keeper is skipped and a batter comes up.
    assert.equal(room.auction.nominee.id, bat.id);
    assert.ok(!room.findByName("Ashutosh").squad.some((s) => s.player.id === leftover.id));
    const skip = events.find((e) => e.type === "skipped");
    assert.ok(skip, "expected a skipped event");
    assert.equal(skip.player.id, leftover.id);
    assert.equal(skip.reason, "Skipped: no team has a spot left for a wicket-keeper.");
    assert.equal(room.getState("Ashutosh").lastEvent.reason, skip.reason);
    assert.ok(!room.unaffordableIds.has(leftover.id), "role-skipped players can come back if a slot reopens");
  });

  test("skips a player when teams still need his role but none can afford the starting bid", () => {
    const room = roomWith(["Ashutosh", "Priya"], { soldRevealMs: 0 }, { mode: "bullet" });
    // Two incomplete teams, so last-team fill does not take over.
    room.findByName("Ashutosh").purseLakhs = 1; // below the 2-point start bid
    room.findByName("Priya").purseLakhs = 1;
    const bat = players.find((p) => p.role === "BAT" && !room.soldIds.has(p.id));
    room.queue = [bat];
    room.phase = "auction";
    const events = [];
    room.on("delta", (e) => events.push(e));
    room.nominateNext();
    const skip = events.find((e) => e.type === "skipped");
    assert.ok(skip, "expected a skipped event");
    assert.equal(skip.player.id, bat.id);
    assert.equal(skip.reason, "Skipped: no team with a spot left can afford his starting bid.");
    assert.ok(room.unaffordableIds.has(bat.id));
    assert.equal(room.findByName("Ashutosh").eliminated, true);
    assert.equal(room.findByName("Priya").eliminated, true);
  });

  test("skips a player when teams have a spot but cannot bid right now", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    const wk = players.filter((p) => p.role === "WK")[0];
    room.findByName("Ashutosh").bidBlockedUntilLot = 999;
    room.findByName("Priya").bidBlockedUntilLot = 999;
    room.queue = [wk, players.find((p) => p.id === "karun-nair")];
    room.phase = "auction";
    const events = [];
    room.on("delta", (e) => events.push(e));
    room.nominateNext();
    const skip = events.find((e) => e.type === "skipped" && e.player.id === wk.id);
    assert.ok(skip, "expected a skipped event");
    assert.equal(skip.reason, "Skipped: no team with a spot left can take him right now.");
  });

  test("auction continues after one team completes its squad and ends only when every active team is complete", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"]);
    // Priya is already a full 4-1-2-4. Ashutosh needs one more batter. Rohan is also complete.
    giveSquad(room, "Priya", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    giveSquad(room, "Rohan", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    giveSquad(room, "Ashutosh", { BAT: 3, WK: 1, AR: 2, BOWL: 4 });
    const a = room.findByName("Ashutosh");
    const b = room.findByName("Priya");
    const c = room.findByName("Rohan");
    assert.equal(isSquadComplete(b.squad), true);
    assert.equal(isSquadComplete(a.squad), false);
    const nextBat = players.find((p) => p.role === "BAT" && !room.soldIds.has(p.id));
    const after = players.find((p) => p.role === "BAT" && !room.soldIds.has(p.id) && p.id !== nextBat.id);
    room.queue = [nextBat, after];
    room.phase = "auction";
    room.rrIndex = 0;
    const events = [];
    room.on("delta", (e) => events.push(e));
    room.nominateNext();
    // Complete teams are excluded, so only Ashutosh is in and the lot locks immediately.
    assert.ok(a.squad.some((s) => s.player.id === nextBat.id));
    assert.equal(isSquadComplete(a.squad), true);
    assert.ok(["captains", "simulating", "results"].includes(room.phase), room.phase);
    assert.equal(b.squad.length, 11);
    assert.equal(c.squad.length, 11);
    assert.ok(!b.squad.some((s) => s.player.id === nextBat.id));
    assert.ok(!c.squad.some((s) => s.player.id === nextBat.id));
    assert.ok(!a.squad.some((s) => s.player.id === after.id), "auction should stop once every squad is complete");
    assert.ok(
      events.some((e) => e.type === "lastTeamFill" && e.buyerName === "Ashutosh" && (e.entries || []).some((row) => row.player.id === nextBat.id))
      || events.some((e) => e.type === "sold" && e.buyerName === "Ashutosh" && e.player.id === nextBat.id)
    );
  });

  test("default bid is awarded even when a voluntary reserve check would block it", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    const star = players.find((p) => p.id === "jasprit-bumrah");
    room.findByName("Ashutosh").purseLakhs = 2; // can afford the start bid, but not a full 11-player reserve
    room.queue = [star];
    room.phase = "auction";
    room.nominateNext();
    assert.equal(room.auction.currentBidderKey, "ashutosh");
    assert.equal(room.findByName("Ashutosh").eliminated, false);
    // A voluntary overbid by Priya that leaves her unable to fill the XI is still rejected.
    const priya = room.findByName("Priya");
    priya.purseLakhs = 16; // 10 remaining slots need 10 pts; bidding +5 from 2 leaves 9
    const denied = room.bid("Priya", room.auction.currentBidLakhs + 5);
    assert.equal(denied.ok, false);
    assert.match(denied.error, /purse/i);
  });

  test("eliminated teams are left out of the simulation and listed last", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"]);
    const cheap = [...players].sort((a, b) => a.basePriceLakhs - b.basePriceLakhs);
    function fill(name, start) {
      const team = room.findByName(name);
      const need = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
      for (const p of cheap) {
        if (need[p.role] > 0 && !room.soldIds.has(p.id) && (p.country === "IND" || team.squad.filter((s) => s.player.overseas).length < 4)) {
          team.squad.push({ player: p, priceLakhs: 20 });
          room.soldIds.add(p.id);
          need[p.role] -= 1;
        }
      }
      team.captainId = team.squad[0].player.id;
    }
    fill("Priya");
    fill("Rohan");
    room.findByName("Ashutosh").eliminated = true;
    room.findByName("Ashutosh").eliminatedReason = "insufficient purse";
    room.phase = "captains";
    room.finishCaptains();
    assert.equal(room.phase, "results");
    const t = room.tournament;
    assert.equal(t.table.length, 2);
    assert.ok(!t.table.some((r) => r.name === "Ashutosh"));
    assert.equal(t.leagueMatches.length, 1);
    const last = t.positions[t.positions.length - 1];
    assert.equal(last.name, "Ashutosh");
    assert.equal(last.title, "Eliminated - insufficient purse");
    assert.equal(last.eliminated, true);
    assert.ok(t.champion.name !== "Ashutosh");
  });

  test("once outbid, the default-bid team may bid higher again", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    const star = players.find((p) => p.id === "jasprit-bumrah");
    room.queue = [star];
    room.phase = "auction";
    room.nominateNext();
    assert.equal(room.auction.currentBidderKey, "ashutosh");
    assert.equal(room.bid("Priya", room.auction.currentBidLakhs + 5).ok, true);
    assert.equal(room.auction.currentBidderKey, "priya");
    const back = room.bid("Ashutosh", room.auction.currentBidLakhs + 2);
    assert.equal(back.ok, true);
    assert.equal(room.auction.currentBidderKey, "ashutosh");
    assert.equal(room.auction.currentBidLakhs, 9);
  });
});

describe("squad completion and sold reveal", () => {
  test("a team is complete when every role quota is met, even with overflow players", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    giveSquad(room, "Ashutosh", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    const a = room.findByName("Ashutosh");
    const extraBat = players.find((p) => p.role === "BAT" && !room.soldIds.has(p.id));
    a.squad.push({ player: extraBat, priceLakhs: 2 });
    assert.equal(isSquadComplete(a.squad), true);
    assert.equal(pendingSlots(a.squad), 0);
    assert.equal(a.squad.length, 12);
  });

  test("eleven players missing a required role are not a complete squad", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    giveSquad(room, "Ashutosh", { BAT: 5, WK: 0, AR: 2, BOWL: 4 });
    const a = room.findByName("Ashutosh");
    assert.equal(a.squad.length, 11);
    assert.equal(isSquadComplete(a.squad), false);
    assert.equal(pendingSlots(a.squad), 1);
  });

  test("complete teams are skipped in the default-bid rotation while the auction continues", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"]);
    giveSquad(room, "Ashutosh", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    // Priya and Rohan still need players
    const bats = players.filter((p) => p.role === "BAT" && !room.soldIds.has(p.id));
    room.queue = [bats[0], bats[1]];
    room.phase = "auction";
    room.rrIndex = 0; // Ashutosh's slot — must skip to Priya
    room.nominateNext();
    assert.equal(room.phase, "auction");
    assert.equal(room.auction.currentBidderKey, "priya");
    assert.equal(room.auction.nominee.id, bats[0].id);
    const names = room.stillInTeams().map((f) => f.name).sort();
    assert.deepEqual(names, ["Priya", "Rohan"]);
    assert.equal(room.bid("Ashutosh", room.auction.currentBidLakhs + 1).ok, false);
    room.optOut("Rohan");
    assert.equal(room.findByName("Priya").squad[0].player.id, bats[0].id);
    assert.equal(room.findByName("Ashutosh").squad.length, 11);
    assert.equal(room.phase, "auction");
    assert.equal(room.auction.currentBidderKey, "rohan");
  });

  test("default bid skips a team whose role is full even if their squad is not complete", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    giveSquad(room, "Ashutosh", { BAT: 4, WK: 0, AR: 2, BOWL: 4 });
    const nextBat = players.find((p) => p.role === "BAT" && !room.soldIds.has(p.id));
    room.queue = [nextBat];
    room.phase = "auction";
    room.rrIndex = 0;
    room.nominateNext();
    // Priya is the only team that can take this batter, so the lot sells to her immediately.
    assert.equal(room.findByName("Priya").squad[0].player.id, nextBat.id);
    assert.equal(room.findByName("Ashutosh").squad.filter((s) => s.player.role === "BAT").length, 4);
    assert.equal(isSquadComplete(room.findByName("Ashutosh").squad), false);
  });

  test("fills leftover needed-role players from the remaining pool when the queue runs out before every team is full", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    giveSquad(room, "Priya", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    giveSquad(room, "Ashutosh", { BAT: 4, WK: 0, AR: 2, BOWL: 4 });
    const wk = players.find((p) => p.role === "WK" && !room.soldIds.has(p.id));
    // Queue is empty; the leftover keeper is only still sitting in the player database.
    room.queue = [];
    room.unsold = [];
    room.allPlayers = [...room.franchises.flatMap((f) => f.squad.map((s) => s.player)), wk];
    room.pass = 2;
    room.phase = "auction";
    room.rrIndex = 0;
    room.nominateNext();
    assert.ok(room.findByName("Ashutosh").squad.some((s) => s.player.id === wk.id));
    assert.equal(isSquadComplete(room.findByName("Ashutosh").squad), true);
    assert.ok(["captains", "simulating", "results"].includes(room.phase), room.phase);
  });

  test("sold reveal delays the next lot without skipping it", async () => {
    const room = roomWith(["Ashutosh", "Priya"], { soldRevealMs: 40 });
    const bats = players.filter((p) => p.role === "BAT");
    room.queue = [bats[0], bats[1]];
    room.phase = "auction";
    room.nominateNext();
    const firstId = room.auction.nominee.id;
    room.optOut("Priya");
    assert.equal(room.lastEvent.type, "sold");
    assert.equal(room.lastEvent.player.id, firstId);
    assert.equal(room.phase, "auction");
    assert.equal(room.auction, null);
    assert.ok(room.revealUntil && room.revealUntil > Date.now());
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(room.auction, "next lot should start after the reveal");
    assert.equal(room.auction.nominee.id, bats[1].id);
    assert.equal(room.phase, "auction");
  });

  test("Continue ends the sold reveal immediately and starts the next lot", async () => {
    const room = roomWith(["Ashutosh", "Priya"], { soldRevealMs: 400 });
    const bats = players.filter((p) => p.role === "BAT");
    room.queue = [bats[0], bats[1]];
    room.phase = "auction";
    room.nominateNext();
    const firstId = room.auction.nominee.id;
    assert.equal(room.optOut("Priya").ok || room.optOut("Ashutosh").ok, true);
    // One of the two is the leader and cannot opt out; the other sells the lot.
    if (room.auction) {
      const other = room.auction.currentBidderKey === "ashutosh" ? "Priya" : "Ashutosh";
      assert.equal(room.optOut(other).ok, true);
    }
    assert.equal(room.lastEvent.type, "sold");
    assert.equal(room.lastEvent.player.id, firstId);
    assert.equal(room.auction, null);
    assert.ok(room.revealUntil && room.revealUntil > Date.now());
    const nextBefore = room.continueReveal("Priya");
    assert.equal(nextBefore.ok, true, nextBefore.error);
    assert.equal(room.revealUntil, null);
    assert.ok(room.auction, "next lot should start as soon as someone continues");
    assert.equal(room.auction.nominee.id, bats[1].id);
    const again = room.continueReveal("Ashutosh");
    assert.equal(again.ok, true);
    assert.equal(again.already, true);
    assert.equal(room.auction.nominee.id, bats[1].id, "a second Continue must not skip the new lot");
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(room.auction.nominee.id, bats[1].id);
  });

  test("Continue is ignored while the sold reveal is paused, then works after resume", async () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"], { soldRevealMs: 250 });
    const bats = players.filter((p) => p.role === "BAT");
    room.queue = [bats[0], bats[1]];
    room.phase = "auction";
    room.nominateNext();
    const firstId = room.auction.nominee.id;
    for (const name of ["Ashutosh", "Priya", "Rohan"]) {
      if (room.auction && room.auction.currentBidderKey !== name.toLowerCase()) {
        room.optOut(name);
      }
    }
    assert.equal(room.lastEvent.type, "sold");
    assert.equal(room.lastEvent.player.id, firstId);
    assert.ok(room.revealUntil);
    assert.equal(room.pause("Priya").ok, true);
    const blocked = room.continueReveal("Ashutosh");
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /paused/i);
    assert.ok(room.revealUntil, "reveal should still be pending while paused");
    assert.equal(room.auction, null);
    await new Promise((r) => setTimeout(r, 280));
    assert.equal(room.auction, null, "paused reveal must not auto-advance");
    assert.equal(room.resume("Priya").ok, true);
    assert.ok(room.revealUntil && room.revealUntil > Date.now());
    const snap = room.getState("Ashutosh");
    assert.ok(snap.soldRevealUntil && snap.soldRevealUntil > Date.now());
    const ok = room.continueReveal("Rohan");
    assert.equal(ok.ok, true, ok.error);
    assert.equal(room.revealUntil, null);
    assert.ok(room.auction);
    assert.equal(room.auction.nominee.id, bats[1].id);
  });

  test("unsold notices use the same reveal and can be fast-tracked", () => {
    const room = roomWith(["Ashutosh", "Priya"], { soldRevealMs: 400 });
    const bats = players.filter((p) => p.role === "BAT");
    room.queue = [bats[0], bats[1]];
    room.phase = "auction";
    room.nominateNext();
    // Force an unsold path: drop the default/leading bidder so no one is left.
    room.auction.currentBidderKey = null;
    room.auction.defaultBidderKey = null;
    room.unsoldCurrent();
    assert.equal(room.lastEvent.type, "unsold");
    assert.ok(room.revealUntil && room.revealUntil > Date.now());
    assert.equal(room.auction, null);
    const res = room.continueReveal("Ashutosh");
    assert.equal(res.ok, true, res.error);
    assert.equal(room.revealUntil, null);
    assert.ok(room.auction);
    assert.equal(room.auction.nominee.id, bats[1].id);
  });
});

describe("tournament simulation", () => {
  test("3 teams play a league and a top-2 final, with awards and positions", () => {
    function fakeTeam(name, short, color, start) {
      const squad = players.slice(start, start + 11).map((p, i) => {
        const roles = ["BAT", "BAT", "BAT", "BAT", "WK", "AR", "AR", "BOWL", "BOWL", "BOWL", "BOWL"];
        const pool = players.filter((x) => x.role === roles[i]);
        return { player: pool[start + i] || pool[i], priceLakhs: 200 };
      });
      return {
        name,
        franchise: { id: short.toLowerCase(), name, short, color },
        purseLakhs: 1000,
        squad,
        captainId: null,
      };
    }
    const teams = [
      fakeTeam("A", "CSK", "#fc0", 0),
      fakeTeam("B", "MI", "#00f", 1),
      fakeTeam("C", "RCB", "#f00", 2),
    ];
    const result = simulateTournament(teams, 42);
    assert.equal(result.leagueMatches.length, 3);
    assert.equal(result.table.length, 3);
    assert.equal(result.playoffs.format, "top2-final");
    assert.equal(result.playoffs.matches.length, 1);
    assert.ok(result.champion);
    assert.equal(result.positions.length, 3);
    assert.equal(result.positions[0].title, "Champion");
    assert.ok(result.awards.bestBuy);
    assert.ok(result.awards.costliestFlop);
    for (const row of result.table) {
      assert.equal(typeof row.nrr, "number");
      assert.equal(row.played, 2);
      assert.equal(row.points, row.won * 2);
    }
  });
});

describe("lopsided squad simulation", () => {
  test("only BAT/WK/AR bat and only AR/BOWL bowl; thin units are weaker", () => {
    const bats = players.filter((p) => p.role === "BAT").slice(0, 11);
    const bowls = players.filter((p) => p.role === "BOWL").slice(0, 11);
    const mixed = [
      ...players.filter((p) => p.role === "BAT").slice(0, 4),
      ...players.filter((p) => p.role === "WK").slice(0, 1),
      ...players.filter((p) => p.role === "AR").slice(0, 2),
      ...players.filter((p) => p.role === "BOWL").slice(0, 4),
    ];
    function team(name, squad) {
      return {
        name,
        franchise: { id: name, name, short: name, color: "#000" },
        squad: squad.map((p) => ({ player: p, priceLakhs: 100 })),
        captainId: squad[0].id,
      };
    }
    const batHeavy = teamStrength(team("BAT", bats));
    const bowlHeavy = teamStrength(team("BOWL", bowls));
    const balanced = teamStrength(team("BAL", mixed));
    assert.equal(batHeavy.bowlN, 0);
    assert.equal(bowlHeavy.batN, 0);
    assert.ok(batHeavy.bowling < 15, `bat-heavy bowling ${batHeavy.bowling}`);
    assert.ok(bowlHeavy.batting < 15, `bowl-heavy batting ${bowlHeavy.batting}`);
    assert.ok(balanced.batting > batHeavy.batting || balanced.bowling > batHeavy.bowling);
    assert.ok(balanced.bowling > bowlHeavy.bowling || balanced.batting > bowlHeavy.batting);
    assert.ok(balanced.strength > batHeavy.strength);
    assert.ok(balanced.strength > bowlHeavy.strength);
    // Whole squad counts: an extra batter is not trimmed.
    const plusOne = team("BAT12", [...bats, players.filter((p) => p.role === "BAT")[11] || players.filter((p) => p.role === "WK")[0]]);
    // 11 bats already used first 11; pick a WK as 12th batting-capable player
    plusOne.squad[11] = { player: players.filter((p) => p.role === "WK")[0], priceLakhs: 100 };
    const withExtra = teamStrength(plusOne);
    assert.equal(withExtra.batN, 12);
  });
});

describe("overall rating", () => {
  test("weights bowling higher for bowlers", () => {
    const p = { role: "BOWL", batting: 20, bowling: 90 };
    assert.ok(Math.abs(overallRating(p) - 83) < 0.01);
  });
});

describe("nomination order and timers", () => {
  test("startAuction builds a mode-sized shuffled list, not the full database", () => {
    const { expectedAuctionComposition } = require("../server/auction-pool");
    const firsts = new Set();
    for (let i = 0; i < 12; i++) {
      const r = roomWith(["Ashutosh", "Priya"], null, { seed: 1000 + i * 17 });
      const started = r.startAuction("Ashutosh");
      assert.equal(started.ok, true);
      const expect = expectedAuctionComposition("classical", 2);
      assert.equal(r.queue.length + 1, expect.total);
      assert.equal(r.lotTotal, expect.total);
      firsts.add(r.auction.nominee.id);
    }
    assert.ok(firsts.size >= 3, `expected mixed openers, got ${[...firsts].join(", ")}`);
  });

  test("a new lot gets 25 seconds and a bid also resets the timer to 25", () => {
    const room = roomWith(["Ashutosh", "Priya"], { lotStartMs: 25_000, bidMs: 25_000, captainMs: 45_000 });
    room.queue = [players.find((p) => p.id === "virat-kohli")];
    room.phase = "auction";
    const t0 = Date.now();
    room.nominateNext();
    const openLeft = room.auction.endsAt - t0;
    assert.ok(openLeft > 24000 && openLeft <= 25100, `lot start ${openLeft}`);
    const lead = room.auction.currentBidderKey === "ashutosh" ? "Priya" : "Ashutosh";
    const t1 = Date.now();
    assert.equal(room.bid(lead, room.auction.currentBidLakhs + 1).ok, true);
    const bidLeft = room.auction.endsAt - t1;
    assert.ok(bidLeft > 24000 && bidLeft <= 25100, `bid reset ${bidLeft}`);
  });

  test("default timers are 25s for lots and bids, 90s for captains, 3s for the player intro, 2.8s for results steps, 45s for the final, 2s for auto-fill sold cards, and 5s for the sold and power reveals", () => {
    const keys = ["BID_TIMER_MS", "LOT_START_MS", "SOLD_REVEAL_MS", "CAPTAIN_TIMER_MS", "POWER_REVEAL_MS", "PLAYER_INTRO_MS", "RESULTS_REVEAL_STEP_MS", "FINAL_MATCH_MS", "AUTOFILL_REVEAL_MS"];
    const prev = {};
    for (const k of keys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    try {
      const room = new GameRoom({ code: "DEF", purseLakhs: 100, allPlayers: players, meta });
      assert.equal(room.timers.lotStartMs, 25000);
      assert.equal(room.timers.bidMs, 25000);
      assert.equal(room.timers.soldRevealMs, 5000);
      assert.equal(room.timers.captainMs, 90000);
      assert.equal(room.timers.formBoostRevealMs, 6000);
      assert.equal(room.timers.powerRevealMs, 5000);
      assert.equal(room.timers.playerIntroMs, 3000);
      assert.equal(room.timers.resultsRevealStepMs, 2800);
      assert.equal(room.timers.finalMatchMs, 45000);
      assert.equal(room.timers.autofillRevealMs, 2000);
    } finally {
      for (const k of keys) {
        if (prev[k] == null) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  });
});

describe("booster shop", () => {
  const { BOOSTERS, getBooster } = require("../server/boosters");

  function primedRoom() {
    const room = roomWith(["Ashutosh", "Priya"]);
    for (const name of ["Ashutosh", "Priya"]) {
      const team = room.findByName(name);
      const need = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
      for (const p of players) {
        if ((need[p.role] || 0) > 0 && !room.soldIds.has(p.id)) {
          team.squad.push({ player: p, priceLakhs: 2 });
          room.soldIds.add(p.id);
          need[p.role] -= 1;
        }
      }
      team.purseLakhs = 40;
    }
    return room;
  }

  test("catalog has priced funny boosters and enforces one of each", () => {
    assert.ok(BOOSTERS.length >= 6);
    for (const b of BOOSTERS) {
      assert.ok(b.pricePoints >= 10 && b.pricePoints <= 30, b.id);
      assert.ok(b.impact && b.impact.line && b.impact.size, b.id);
      assert.ok(Number(b.impact.score) > 0, b.id);
      assert.ok(Number.isFinite(Number(b.impact.titleWinPp)), b.id);
      assert.ok(b.name && b.blurb);
    }
    const { publicCatalog } = require("../server/boosters");
    const catalog = publicCatalog();
    assert.equal(catalog[0].id, "bus-breakdown");
    assert.equal(catalog[catalog.length - 1].id, "drs-wizard");
    for (let i = 1; i < catalog.length; i++) {
      assert.ok(catalog[i - 1].impact.score >= catalog[i].impact.score, `${catalog[i - 1].id} before ${catalog[i].id}`);
    }
    const bus = catalog.find((b) => b.id === "bus-breakdown");
    const nazar = catalog.find((b) => b.id === "nazar");
    assert.equal(bus.impact.rivalTitleWinPp, -16);
    assert.equal(nazar.impact.rivalTitleWinPp, -9);
    for (const b of catalog) {
      if (b.id === "bus-breakdown" || b.id === "nazar") continue;
      assert.equal(b.impact.rivalTitleWinPp, null, b.id);
    }
    const room = primedRoom();
    room.beginCaptainPhase();
    assert.equal(room.phase, "captains");
    assert.ok(room.captainEndsAt - Date.now() > 80000);
    const cheer = getBooster("cheerleaders");
    assert.equal(room.buyBooster("Ashutosh", cheer.id).ok, true);
    assert.equal(room.findByName("Ashutosh").purseLakhs, 40 - cheer.pricePoints);
    assert.equal(room.buyBooster("Ashutosh", cheer.id).ok, false);
    room.findByName("Priya").purseLakhs = 10;
    assert.equal(room.buyBooster("Priya", "bus-breakdown").ok, false);
  });

  test("the shop lists buyable boosters first by price, then unbuyable by price, and re-sorts as points change", () => {
    const { publicCatalog } = require("../server/boosters");
    const { sortBoosterShop, isBoosterBuyable } = require("../public/booster-shop");
    const catalog = publicCatalog();
    const you = { purseLakhs: 20, boosters: [], eliminated: false };
    const order = sortBoosterShop(catalog, you).map((b) => b.id);
    const buyable = order.filter((id) => isBoosterBuyable(catalog.find((b) => b.id === id), you));
    const locked = order.filter((id) => !buyable.includes(id));
    assert.deepEqual(buyable, ["nazar", "net-session", "lucky-toss", "rain-dance", "drs-wizard"]);
    assert.deepEqual(locked, ["bus-breakdown", "dew-factor", "home-curator", "friendly-umpire", "cheerleaders"]);
    assert.deepEqual(order, [...buyable, ...locked]);
    for (let i = 1; i < buyable.length; i++) {
      const a = catalog.find((b) => b.id === buyable[i - 1]);
      const b = catalog.find((b) => b.id === buyable[i]);
      assert.ok(a.pricePoints >= b.pricePoints, `${a.id} before ${b.id}`);
    }
    for (let i = 1; i < locked.length; i++) {
      const a = catalog.find((b) => b.id === locked[i - 1]);
      const b = catalog.find((b) => b.id === locked[i]);
      assert.ok(a.pricePoints >= b.pricePoints, `${a.id} before ${b.id}`);
    }

    // Same price: higher impact comes first.
    const tied = sortBoosterShop([
      { id: "low", pricePoints: 15, impact: { score: 1 } },
      { id: "high", pricePoints: 15, impact: { score: 9 } },
    ], you).map((b) => b.id);
    assert.deepEqual(tied, ["high", "low"]);

    // After spending down to 12, only the cheaper boosters stay buyable.
    const spent = { purseLakhs: 12, boosters: [{ id: "nazar" }], eliminated: false };
    const after = sortBoosterShop(catalog, spent).map((b) => b.id);
    const afterBuy = after.filter((id) => isBoosterBuyable(catalog.find((b) => b.id === id), spent));
    assert.deepEqual(afterBuy, ["lucky-toss", "rain-dance", "drs-wizard"]);
    assert.equal(after[afterBuy.length], "bus-breakdown");
    assert.ok(after.indexOf("nazar") > after.indexOf("drs-wizard"));
  });

  test("boosters appear in results and can create moments, including rain no-results", () => {
    const room = primedRoom();
    room.findByName("Ashutosh").boosters = [
      { id: "rain-dance", name: "Rain Dance", pricePoints: 11 },
      { id: "lucky-toss", name: "Lucky Toss Coin", pricePoints: 12 },
    ];
    room.findByName("Priya").boosters = [{ id: "cheerleaders", name: "Cheerleader Squad", pricePoints: 21 }];
    room.findByName("Ashutosh").captainId = room.findByName("Ashutosh").squad[0].player.id;
    room.findByName("Priya").captainId = room.findByName("Priya").squad[0].player.id;
    room.phase = "captains";
    room.finishCaptains();
    assert.equal(room.phase, "results");
    const details = room.getMatches();
    assert.ok(Array.isArray(details.teams));
    assert.equal(details.teams.length, 2);
    const ash = details.teams.find((t) => t.name === "Ashutosh");
    assert.ok(ash.squad.length >= 11);
    assert.ok(ash.squad.some((s) => s.isCaptain));
    assert.ok(ash.boosters.some((b) => b.id === "rain-dance"));
    assert.ok(ash.squad.some((s) => s.stats && (s.stats.runs > 0 || s.stats.wickets > 0)));
    assert.ok(details.moments);
    const table = room.tournament.table;
    for (const row of table) {
      assert.ok("nr" in row);
      assert.equal(row.points, row.won * 2 + (row.nr || 0));
    }
  });
});

describe("form boosters", () => {
  const { getBooster, FORM_SELF_ID, FORM_RIVAL_ID, applyFormBoosters, rollUniformPct, formatTitleChance } = require("../server/boosters");

  function primedThree() {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"]);
    for (const name of ["Ashutosh", "Priya", "Rohan"]) {
      const team = room.findByName(name);
      const need = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
      for (const p of players) {
        if ((need[p.role] || 0) > 0 && !room.soldIds.has(p.id)) {
          team.squad.push({ player: p, priceLakhs: 2 });
          room.soldIds.add(p.id);
          need[p.role] -= 1;
        }
      }
      team.purseLakhs = 80;
      team.captainId = team.squad[0].player.id;
    }
    return room;
  }

  test("Net Session Masterclass re-rolls form into 101–105, or leaves it if already above 100", () => {
    const self = getBooster(FORM_SELF_ID);
    assert.equal(self.name, "Net Session Masterclass");
    assert.equal(self.pricePoints, 19);
    const room = primedThree();
    const ash = room.findByName("Ashutosh");
    ash.formPct = 96;
    room.beginCaptainPhase();
    assert.equal(room.buyBooster("Ashutosh", FORM_SELF_ID).ok, true);
    assert.equal(ash.formPct, 96);
    room.finishCaptains();
    assert.equal(room.phase, "results");
    assert.ok(ash.formPct >= 101 && ash.formPct <= 105, `reroll ${ash.formPct}`);
    const pos = room.tournament.positions.find((p) => p.name === "Ashutosh");
    assert.equal(pos.formPct, ash.formPct);

    const room2 = primedThree();
    const ash2 = room2.findByName("Ashutosh");
    ash2.formPct = 108;
    room2.beginCaptainPhase();
    assert.equal(room2.buyBooster("Ashutosh", FORM_SELF_ID).ok, true);
    room2.finishCaptains();
    assert.equal(ash2.formPct, 108);
  });

  test("Nazar Lag Gayi needs a valid rival and forces form into 95–99, or leaves it if already below 100", () => {
    const curse = getBooster(FORM_RIVAL_ID);
    assert.equal(curse.name, "Nazar Lag Gayi");
    assert.equal(curse.pricePoints, 20);
    assert.equal(curse.needsTarget, true);
    const room = primedThree();
    const ash = room.findByName("Ashutosh");
    const priya = room.findByName("Priya");
    priya.formPct = 112;
    ash.formPct = 101;
    room.beginCaptainPhase();
    assert.equal(room.buyBooster("Ashutosh", FORM_RIVAL_ID).ok, false);
    assert.equal(room.buyBooster("Ashutosh", FORM_RIVAL_ID, "Ashutosh").ok, false);
    assert.equal(room.buyBooster("Ashutosh", FORM_RIVAL_ID, "Nobody").ok, false);
    priya.eliminated = true;
    assert.equal(room.buyBooster("Ashutosh", FORM_RIVAL_ID, "Priya").ok, false);
    priya.eliminated = false;
    const bought = room.buyBooster("Ashutosh", FORM_RIVAL_ID, "Priya");
    assert.equal(bought.ok, true);
    assert.equal(priya.formPct, 112);
    assert.equal(ash.boosters[0].targetName, "Priya");
    room.finishCaptains();
    assert.ok(priya.formPct >= 95 && priya.formPct <= 99, `curse ${priya.formPct}`);
    const pos = room.tournament.positions.find((p) => p.name === "Priya");
    assert.equal(pos.formPct, priya.formPct);

    const room2 = primedThree();
    room2.findByName("Priya").formPct = 88;
    room2.beginCaptainPhase();
    assert.equal(room2.buyBooster("Ashutosh", FORM_RIVAL_ID, "Priya").ok, true);
    room2.finishCaptains();
    assert.equal(room2.findByName("Priya").formPct, 88);
  });

  test("a team's own guarantee and any number of curses cancel out, leaving the original form", () => {
    const room = primedThree();
    const ash = room.findByName("Ashutosh");
    ash.formPct = 107;
    room.findByName("Priya").formPct = 90;
    room.findByName("Rohan").formPct = 102;
    room.beginCaptainPhase();
    assert.equal(room.buyBooster("Ashutosh", FORM_SELF_ID).ok, true);
    assert.equal(room.buyBooster("Priya", FORM_RIVAL_ID, "Ashutosh").ok, true);
    assert.equal(room.buyBooster("Rohan", FORM_RIVAL_ID, "Ashutosh").ok, true);
    room.finishCaptains();
    assert.equal(ash.formPct, 107);
    const pos = room.tournament.positions.find((p) => p.name === "Ashutosh");
    assert.equal(pos.formPct, 107);
  });

  test("several curses on one team without a guarantee count as a single re-roll below 100", () => {
    const rolls = [];
    const rng = { random() { rolls.push(1); return 0; } }; // always 95
    const room = roomWith(["Ashutosh", "Priya", "Rohan"], null, { rng });
    for (const name of ["Ashutosh", "Priya", "Rohan"]) {
      const team = room.findByName(name);
      const need = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
      for (const p of players) {
        if ((need[p.role] || 0) > 0 && !room.soldIds.has(p.id)) {
          team.squad.push({ player: p, priceLakhs: 2 });
          room.soldIds.add(p.id);
          need[p.role] -= 1;
        }
      }
      team.purseLakhs = 80;
      team.captainId = team.squad[0].player.id;
    }
    const ash = room.findByName("Ashutosh");
    ash.formPct = 110;
    room.beginCaptainPhase();
    assert.equal(room.buyBooster("Priya", FORM_RIVAL_ID, "Ashutosh").ok, true);
    assert.equal(room.buyBooster("Rohan", FORM_RIVAL_ID, "Ashutosh").ok, true);
    const before = rolls.length;
    room.finishCaptains();
    assert.equal(ash.formPct, 95);
    assert.equal(rolls.length, before + 1);
  });

  test("form boosters are applied when the phase ends, before the simulation, so buy order does not matter", () => {
    const room = primedThree();
    const ash = room.findByName("Ashutosh");
    const priya = room.findByName("Priya");
    ash.formPct = 94;
    priya.formPct = 111;
    room.beginCaptainPhase();
    assert.equal(room.buyBooster("Priya", FORM_RIVAL_ID, "Ashutosh").ok, true);
    assert.equal(ash.formPct, 94, "curse must not apply at purchase time");
    assert.equal(room.buyBooster("Ashutosh", FORM_SELF_ID).ok, true);
    assert.equal(ash.formPct, 94, "self booster must not apply at purchase time");
    assert.ok((room.prepFeed || []).some((e) => /bought Net Session Masterclass/.test(e.message)));
    assert.ok((room.prepFeed || []).some((e) => /bought Nazar Lag Gayi/.test(e.message)));
    room.finishCaptains();
    assert.equal(ash.formPct, 94, "self + curse cancel even if the curse was bought first");
    const pos = room.tournament.positions.find((p) => p.name === "Ashutosh");
    assert.equal(pos.formPct, 94);
  });

  test("a 90s form-boost reveal can be skipped after the boosters are applied", () => {
    const room = primedThree({}).constructor
      ? primedThree()
      : primedThree();
    const long = roomWith(["Ashutosh", "Priya", "Rohan"], { formBoostRevealMs: 30_000, captainMs: 90_000 });
    for (const name of ["Ashutosh", "Priya", "Rohan"]) {
      const src = room.findByName(name);
      const team = long.findByName(name);
      team.squad = src.squad.map((s) => ({ player: s.player, priceLakhs: s.priceLakhs }));
      for (const s of team.squad) long.soldIds.add(s.player.id);
      team.purseLakhs = 80;
      team.captainId = team.squad[0].player.id;
    }
    long.findByName("Ashutosh").formPct = 90;
    long.beginCaptainPhase();
    assert.equal(long.buyBooster("Ashutosh", FORM_SELF_ID).ok, true);
    long.finishCaptains();
    assert.equal(long.phase, "formBoosts");
    assert.ok(long.formBoostReveal && long.formBoostReveal.changes.length);
    assert.ok(long.findByName("Ashutosh").formPct >= 101);
    const snap = long.getState("ashutosh");
    assert.equal(snap.phase, "formBoosts");
    assert.ok(snap.formBoostReveal.changes.some((c) => /Net Session Masterclass/.test(c.message)));
    assert.equal(long.skipFormBoostReveal("Ashutosh").ok, true);
    assert.equal(long.phase, "results");
  });

  test("a landed curse reveal mentions the rival title-chance impact", () => {
    assert.equal(formatTitleChance(-9), "\u22129% title chance");
    const hit = applyFormBoosters([
      { name: "Priya", formPct: 112, boosters: [{ id: FORM_RIVAL_ID, targetName: "Ashutosh" }] },
      { name: "Ashutosh", formPct: 110, boosters: [] },
    ], { random: () => 0 });
    assert.equal(hit.length, 1);
    assert.equal(hit[0].kind, "curse");
    assert.equal(hit[0].message, "Nazar Lag Gayi from Priya: Ashutosh form 110% -> 95% (\u22129% title chance)");

    const noop = applyFormBoosters([
      { name: "Priya", formPct: 90, boosters: [{ id: FORM_RIVAL_ID, targetName: "Ashutosh" }] },
      { name: "Ashutosh", formPct: 88, boosters: [] },
    ], { random: () => 0 });
    assert.equal(noop[0].kind, "curse-noop");
    assert.equal(noop[0].message.includes("title chance"), false);

    const cancel = applyFormBoosters([
      { name: "Priya", formPct: 90, boosters: [{ id: FORM_RIVAL_ID, targetName: "Ashutosh" }] },
      { name: "Ashutosh", formPct: 107, boosters: [{ id: FORM_SELF_ID }] },
    ], { random: () => 0 });
    assert.equal(cancel[0].kind, "cancel");
    assert.equal(cancel[0].message.includes("title chance"), false);
  });

  test("rollUniformPct stays inside the requested inclusive range", () => {
    const rng = { i: 0, random() { const v = [0, 0.999, 0.5][this.i++] || 0; return v; } };
    assert.equal(rollUniformPct(rng, 101, 115), 101);
    assert.equal(rollUniformPct(rng, 101, 115), 115);
    const mid = rollUniformPct(rng, 101, 115);
    assert.ok(mid >= 101 && mid <= 115);
  });
});


describe("team characters", () => {
  test("assigns unique characters on join and rejects a taken character", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"]);
    const ids = room.franchises.map((f) => f.franchise.id);
    assert.equal(new Set(ids).size, 3);
    for (const id of ids) assert.ok(id);
    const taken = ids[0];
    const fail = room.selectIdentity("Priya", taken);
    assert.equal(fail.ok, false);
    const { unusedCharacters } = require("../public/characters");
    const free = unusedCharacters(new Set(ids))[0];
    const ok = room.selectIdentity("Priya", free.id);
    assert.equal(ok.ok, true);
    assert.equal(room.findByName("Priya").franchise.id, free.id);
    assert.notEqual(room.findByName("Ashutosh").franchise.id, room.findByName("Priya").franchise.id);
  });

  test("auto-assigns unique characters for anyone who has not picked before start", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    room.findByName("Priya").franchise = { id: "unknown" };
    room.startAuction("Ashutosh");
    const ids = room.franchises.map((f) => f.franchise.id);
    assert.equal(new Set(ids).size, 2);
    const { getCharacter } = require("../public/characters");
    for (const id of ids) assert.ok(getCharacter(id));
  });

  test("keeps characters that were picked in the lobby", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    const { unusedCharacters } = require("../public/characters");
    const free = unusedCharacters(room.franchises.map((f) => f.franchise.id))[0];
    assert.equal(room.selectCharacter("Priya", free.id).ok, true);
    const ash = room.findByName("Ashutosh").franchise.id;
    room.startAuction("Ashutosh");
    assert.equal(room.findByName("Ashutosh").franchise.id, ash);
    assert.equal(room.findByName("Priya").franchise.id, free.id);
    assert.equal(room.findByName("Priya").franchise.characterId, free.id);
  });

  test("selectIdentity remains a working alias of selectCharacter", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    const { unusedCharacters } = require("../public/characters");
    const free = unusedCharacters(room.franchises.map((f) => f.franchise.id))[0];
    assert.equal(room.selectIdentity("Priya", free.id).ok, true);
    assert.equal(room.findByName("Priya").franchise.characterId, free.id);
    const clash = room.selectCharacter("Ashutosh", free.id);
    assert.equal(clash.ok, false);
    assert.match(clash.error, /already taken/i);
  });

  test("a room shuffles its co-owner list once and every client sees that same order", () => {
    const { CHARACTERS } = require("../public/characters");
    const allIds = CHARACTERS.map((c) => c.id);
    const room = roomWith(["Ashutosh", "Priya"]);
    const fromAsh = room.getState("Ashutosh").characters.map((c) => c.id);
    const fromPriya = room.getState("Priya").characters.map((c) => c.id);
    const identities = room.getState("Ashutosh").identities.map((c) => c.id);
    assert.equal(fromAsh.length, allIds.length);
    assert.deepEqual([...fromAsh].sort(), [...allIds].sort());
    assert.deepEqual(fromAsh, fromPriya);
    assert.deepEqual(fromAsh, identities);
    assert.deepEqual(fromAsh, room.characterOrder);
    // Rejoin does not reshuffle.
    room.disconnect(room.findByName("Ashutosh").socketId);
    const rejoin = room.addPlayer("Ashutosh", "sock-rejoin");
    assert.equal(rejoin.ok, true);
    assert.equal(rejoin.rejoined, true);
    assert.deepEqual(room.getState("Ashutosh").characters.map((c) => c.id), fromAsh);
  });

  test("an injected co-owner order is kept, and different rooms get different orders in practice", () => {
    const { CHARACTERS } = require("../public/characters");
    const allIds = CHARACTERS.map((c) => c.id);
    const forced = [...allIds].reverse();
    const room = roomWith(["Ashutosh"], {}, { characterOrder: forced });
    assert.deepEqual(room.getState("Ashutosh").characters.map((c) => c.id), forced);

    const orders = new Set();
    for (let i = 0; i < 16; i++) {
      const r = roomWith(["Ashutosh"], {}, { seed: i });
      orders.add(r.getState("Ashutosh").characters.map((c) => c.id).join(","));
    }
    assert.ok(orders.size >= 8, `expected varied room orders, got ${orders.size}`);
  });

  test("default co-owner on join is the first free one in the room's order", () => {
    const { CHARACTERS } = require("../public/characters");
    const order = [...CHARACTERS.map((c) => c.id)].reverse();
    const room = roomWith(["Ashutosh", "Priya", "Rohan"], {}, { characterOrder: order });
    assert.deepEqual(room.franchises.map((f) => f.franchise.id), order.slice(0, 3));
    // Free up the first slot; the next joiner takes it, not a canonical-first id.
    assert.equal(room.selectCharacter("Ashutosh", order[5]).ok, true);
    assert.equal(room.addPlayer("Neha", "sock-neha").ok, true);
    assert.equal(room.findByName("Neha").franchise.id, order[0]);
  });

  test("auto-assign at start fills unpicked teams in the room's order", () => {
    const { CHARACTERS } = require("../public/characters");
    const order = [...CHARACTERS.map((c) => c.id)].reverse();
    const room = roomWith(["Ashutosh", "Priya", "Rohan"], {}, { characterOrder: order });
    assert.equal(room.selectCharacter("Ashutosh", order[4]).ok, true);
    room.findByName("Priya").franchise = { id: "unknown" };
    room.findByName("Rohan").franchise = { id: "unknown" };
    room.startAuction("Ashutosh");
    assert.equal(room.findByName("Ashutosh").franchise.id, order[4]);
    assert.equal(room.findByName("Priya").franchise.id, order[0]);
    assert.equal(room.findByName("Rohan").franchise.id, order[1]);
  });
});

describe("random starting bids", () => {
  test("starting bid is a server-chosen integer from 1 to 5", () => {
    const seen = new Set();
    for (let i = 0; i < 80; i++) {
      const room = roomWith(["Ashutosh", "Priya"]);
      room.forcedStartBid = null;
      room.queue = [...players];
      room.phase = "auction";
      room.nominateNext();
      const bid = room.auction.startBidLakhs;
      assert.ok(Number.isInteger(bid) && bid >= 1 && bid <= 5, String(bid));
      assert.equal(room.auction.currentBidLakhs, bid);
      seen.add(bid);
    }
    assert.ok(seen.size >= 3, `only saw ${[...seen]}`);
  });

  test("default team is eliminated only when it cannot afford the starting bid", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    room.forcedStartBid = 5;
    room.findByName("Ashutosh").purseLakhs = 4;
    room.queue = [players.find((p) => p.id === "virat-kohli")];
    room.phase = "auction";
    room.nominateNext();
    assert.equal(room.findByName("Ashutosh").eliminated, true);
    // Only Priya can afford it, so the lot closes immediately to her.
    assert.ok(room.findByName("Priya").squad.some((s) => s.player.id === "virat-kohli"));
    assert.ok(!room.findByName("Ashutosh").squad.some((s) => s.player && s.player.id === "virat-kohli"));
  });
});

describe("default bid guarantee", () => {
  test("a player is sold to the default team even if unsoldCurrent is called", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    room.startAuction("Ashutosh");
    const id = room.auction.nominee.id;
    const def = room.auction.defaultBidderKey;
    room.unsoldCurrent();
    const team = room.franchises.find((f) => f.key === def);
    assert.ok(team.squad.some((s) => s.player.id === id), "default team must receive the player");
    assert.notEqual((room.lastEvent && room.lastEvent.type) || "", "unsold");
  });

  test("timeout sells to the default bidder when nobody else bid", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    room.startAuction("Ashutosh");
    const id = room.auction.nominee.id;
    const def = room.auction.defaultBidderKey;
    room.onLotTimeout(room.lotId);
    const team = room.franchises.find((f) => f.key === def);
    assert.ok(team.squad.some((s) => s.player.id === id));
    assert.equal(room.lastEvent.type, "sold");
  });
});

describe("single-team close", () => {
  test("closes bidding as soon as only one team remains", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"]);
    room.startAuction("Ashutosh");
    const id = room.auction.nominee.id;
    const defName = room.franchises.find((f) => f.key === room.auction.defaultBidderKey).name;
    const others = ["Ashutosh", "Priya", "Rohan"].filter((n) => n !== defName);
    for (const name of others) {
      const res = room.optOut(name);
      assert.equal(res.ok, true, res.error);
    }
    const winner = room.findByName(defName);
    assert.ok(winner.squad.some((s) => s.player.id === id));
    assert.equal(room.lastEvent.type, "sold");
    assert.equal(room.lastEvent.buyerName, defName);
  });
});

describe("pause and resume", () => {
  test("freezes the lot timer and resumes with remaining time", async () => {
    const room = roomWith(["Ashutosh", "Priya"], { lotStartMs: 400, bidMs: 400, captainMs: 800 });
    room.startAuction("Ashutosh");
    const before = Math.max(0, room.auction.endsAt - Date.now());
    const pause = room.pause("Priya");
    assert.equal(pause.ok, true);
    assert.equal(room.paused, true);
    assert.equal(room.pausedBy, "Priya");
    const held = room.pauseRemainingMs;
    assert.ok(held <= before && held >= before - 80, `held=${held} before=${before}`);
    assert.equal(room.bid("Priya", room.auction.currentBidLakhs + 1).ok, false);
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(room.phase, "auction");
    assert.ok(room.auction.nominee);
    assert.equal(room.pauseRemainingMs, held);
    const denied = room.resume("Priya");
    // Priya is the pauser, should be allowed
    assert.equal(denied.ok, true, denied.error);
    assert.equal(room.paused, false);
    const left = room.auction.endsAt - Date.now();
    assert.ok(left <= held + 30, `left=${left} held=${held}`);
    assert.ok(left >= held - 80, `left=${left} held=${held}`);
  });

  test("only the pauser or the host can resume", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"]);
    room.startAuction("Ashutosh");
    assert.equal(room.pause("Priya").ok, true);
    assert.equal(room.resume("Rohan").ok, false);
    assert.equal(room.resume("Ashutosh").ok, true);
    assert.equal(room.paused, false);
  });
});

describe("end game and leave", () => {
  test("host ends the game and non-host cannot", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    const fail = room.endGame("Priya");
    assert.equal(fail.ok, false);
    const ok = room.endGame("Ashutosh");
    assert.equal(ok.ok, true);
    assert.equal(room.phase, "ended");
    assert.equal(room.ended, true);
  });

  test("leave in the lobby removes the player", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    const res = room.leave("Priya");
    assert.equal(res.ok, true);
    assert.equal(room.franchises.length, 1);
    assert.equal(room.franchises[0].name, "Ashutosh");
  });
});


describe("team names and character catalog", () => {
  test("catalog has 15 characters with unique colours, images, meme names, placeholder emotes, and a unique power", () => {
    const fs = require("fs");
    const path = require("path");
    const { CHARACTERS, IDENTITIES, imageUrl, logoUrl, characterImg, logoImg, publicCharacter } = require("../public/characters");
    const catalogPath = path.join(__dirname, "../data/characters.json");
    const fromFile = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    assert.equal(CHARACTERS.length, 15);
    assert.equal(IDENTITIES.length, 15);
    assert.equal(fromFile.length, 15);
    assert.deepEqual(CHARACTERS.map((t) => t.id), fromFile.map((t) => t.id));
    const ids = CHARACTERS.map((t) => t.id);
    const characters = CHARACTERS.map((t) => t.character);
    const colors = CHARACTERS.map((t) => t.color.toLowerCase());
    assert.equal(new Set(ids).size, 15);
    assert.equal(new Set(characters).size, 15);
    assert.equal(new Set(colors).size, 15);
    const logoDir = path.join(__dirname, "../public/logos");
    let total = 0;
    for (const t of CHARACTERS) {
      assert.ok(t.character && t.character.length > 1, t.id);
      assert.equal(t.name, t.character);
      assert.ok(t.realName && t.realName.length > 1, t.id);
      if (t.id !== "prabhas" && t.id !== "orry") assert.notEqual(t.realName, t.name, t.id);
      else assert.equal(t.name, t.id === "prabhas" ? "Prabhas" : "Orry");
      const fileRow = fromFile.find((row) => row.id === t.id);
      assert.equal(t.realName, fileRow.realName);
      assert.match(t.color, /^#[0-9A-Fa-f]{6}$/);
      assert.match(t.color2, /^#[0-9A-Fa-f]{6}$/);
      assert.match(t.text, /^#[0-9A-Fa-f]{6}$/);
      assert.equal(t.image, `/logos/${t.id}.webp`);
      assert.equal(t.logo, t.image);
      assert.ok(Array.isArray(t.emotes) && t.emotes.length === 0, t.id);
      assert.ok(Array.isArray(fileRow.lines) && fileRow.lines.length >= 1, t.id);
      assert.ok(fileRow.lines.every((s) => typeof s === "string" && s.length > 0), t.id);
      assert.deepEqual(t.lines.map((l) => l.text), fileRow.lines, t.id);
      const pub = publicCharacter(t.id);
      assert.deepEqual(pub.lines, t.lines);
      const lineIds = t.lines.map((l) => l.id);
      assert.equal(new Set(lineIds).size, lineIds.length, t.id);
      for (const line of t.lines) {
        assert.ok(line.id && line.id.startsWith(t.id + ":"), line.id);
        assert.equal(typeof line.text, "string");
      }
      assert.ok(t.power && t.power.id && t.power.id !== "bonus_points", t.id);
      assert.ok(t.power.name && t.power.name.length > 1, t.id);
      assert.ok(t.power.description && t.power.description.length > 8, t.id);
      assert.ok(t.power.shortDesc && t.power.shortDesc.length > 4, t.id);
      assert.ok(t.power.shortDesc.trim().split(/\s+/).length <= 10, `${t.id} shortDesc too long: ${t.power.shortDesc}`);
      assert.ok(t.power.funnyDesc && t.power.funnyDesc.length > 20, t.id);
      assert.equal(t.power.uses, 1);
      const filePower = fromFile.find((row) => row.id === t.id).power;
      assert.deepEqual(t.power, filePower);
      assert.equal(imageUrl(t.id), `/logos/${t.id}.webp`);
      assert.equal(logoUrl(t.id), imageUrl(t.id));
      const img = characterImg(t.id);
      assert.equal(logoImg(t.id), img);
      assert.match(img, /<img /);
      assert.match(img, new RegExp(`alt="${t.character}"`));
      const file = path.join(logoDir, `${t.id}.webp`);
      assert.ok(fs.existsSync(file), file);
      total += fs.statSync(file).size;
      assert.doesNotMatch(t.character, /chargers|sloths|punchers|rockets|smashers|mavericks|blasters|jaguars|jammers|dynamos|lions|vikings/i);
    }
    assert.ok(total < 600 * 1024, `character image payload ${total} bytes`);
    const realNames = CHARACTERS.map((t) => t.realName);
    assert.equal(new Set(realNames).size, 15);
    const powerNames = CHARACTERS.map((t) => t.power.name);
    assert.equal(new Set(powerNames).size, 15);
    const powerIds = CHARACTERS.map((t) => t.power.id);
    assert.equal(new Set(powerIds).size, 15);
    const EXPECTED_LINES = {
      "narendra-modi": ["Mitron!", "Bhaiyon aur behno", "Jhola uthake chal padenge", "Is sajjan ko kya taklif hai?"],
      "prabhas": ["Bahubali!", "Devasena!", "Seesfire!", "All excited, fingers crossed..."],
      "orry": ["I'm just a liver"],
      "dolly-chaiwala": ["Ek cutting!", "Chai peelo"],
      "amitabh-bachchan": ["Lock kiya jaaye?", "Rishte mein toh hum tumhare baap lagte hain", "Computer ji…", "Devi aur sajjano", "Aaaaag"],
      "jay-shah": ["Script pehle se likhi hai", "Crowd silent kar diya", "19 Nov 2023 yaad hai?", "Yaar ki gail chale"],
      "samay-raina": ["Blunder!", "Ye episode delete karo", "This too shall pass"],
      "elvish-yadav": ["Elvish bhaiiii!", "Systumm hang kar diya", "Kaatenge kaatenge"],
      "ranveer-allahbadia": ["Hello dosto", "Would you rather...", "Maut ke baare mein socha hai?"],
      "salman-khan": ["Ehsaan mat karna", "Mai aa jau kya apni pe?", "Hiran kidhar hai?", "Footpath pe mil"],
      "ravi-kishan": ["Zindagi jhand ba, fir bhi ghamand ba", "Jai Mahakal", "Money follows my brother", "Naam ya daam? Naam."],
      "rakhi-sawant": ["Mera dimaag kharab hai!", "Main media bulaungi"],
      "taylor-swift": ["Shake it off", "Look what you made me do", "We are never ever getting back together"],
      "arnab-goswami": ["Nation wants to know!", "Mujhe drugs do!", "Aap chup rahiye"],
      "kim-jong-un": ["Big red button", "Nuclear button is always on my desk"],
    };
    for (const t of CHARACTERS) {
      assert.ok(EXPECTED_LINES[t.id], t.id);
      assert.deepEqual(t.lines.map((l) => l.text), EXPECTED_LINES[t.id], t.id);
    }
    const EXPECTED_SHORT = {
      "narendra-modi": "Every other team loses 10 points.",
      "prabhas": "Only you can see the next player.",
      "orry": "Copy a random valid power right now.",
      "dolly-chaiwala": "Pause the auction until you end it.",
      "amitabh-bachchan": "A coin flip halves or doubles the price.",
      "jay-shah": "Rivals pay you 1 point per bid next lot.",
      "samay-raina": "Privately see the next 3 players.",
      "elvish-yadav": "Nobody can bid against you this lot.",
      "ranveer-allahbadia": "A rival cannot bid this lot or the next.",
      "salman-khan": "Buy a recently sold rival at their price.",
      "ravi-kishan": "Richer teams each pay you 5 points.",
      "rakhi-sawant": "Rivals pay 3 points or skip the next lot.",
      "taylor-swift": "Swap a recently sold rival with one of yours.",
      "arnab-goswami": "The richest other team gives you 10 points.",
      "kim-jong-un": "Wipe half a chosen team's squad at random.",
    };
    for (const t of CHARACTERS) {
      assert.equal(t.power.shortDesc, EXPECTED_SHORT[t.id], t.id);
      assert.equal(publicCharacter(t.id).power.shortDesc, EXPECTED_SHORT[t.id], t.id);
    }
    const src = fs.readFileSync(path.join(__dirname, "../public/characters.js"), "utf8");
    const embeddedMatch = src.match(/const embedded = (\[[\s\S]*?\n  \];)/);
    assert.ok(embeddedMatch, "embedded catalogue missing");
    const embedded = Function(`"use strict"; return ${embeddedMatch[1].replace(/;\s*$/, "")}`)();
    assert.deepEqual(embedded, fromFile);
    // Colours should be visually spread (ignore near-neutrals).
    function hexRgb(hex) {
      const n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function dist(a, b) {
      const [ar, ag, ab] = hexRgb(a);
      const [br, bg, bb] = hexRgb(b);
      return Math.hypot(ar - br, ag - bg, ab - bb);
    }
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        assert.ok(dist(colors[i], colors[j]) >= 28, `${CHARACTERS[i].character} vs ${CHARACTERS[j].character} too close`);
      }
    }
  });

  test("rejects a second team that reuses a connected team name", () => {
    const room = roomWith(["Night Owls"]);
    const fail = room.addPlayer("night owls", "sock-other");
    assert.equal(fail.ok, false);
    assert.match(fail.error, /team name/i);
    assert.equal(room.franchises.length, 1);
  });

  test("rejoins by the same team name after a disconnect", () => {
    const room = roomWith(["Night Owls", "Red Caps"]);
    const team = room.findByName("Night Owls");
    const logo = team.franchise.id;
    room.disconnect(team.socketId);
    assert.equal(team.connected, false);
    const again = room.addPlayer("night owls", "sock-rejoin");
    assert.equal(again.ok, true);
    assert.equal(again.rejoined, true);
    assert.equal(again.name, "Night Owls");
    assert.equal(room.findByName("Night Owls").connected, true);
    assert.equal(room.findByName("Night Owls").franchise.id, logo);
    assert.equal(room.franchises.length, 2);
  });

  test("rejoins mid-auction, mid-captains, or results with the same franchise and full state", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    room.startAuction("Ashutosh");
    const purse = room.findByName("Priya").purseLakhs;
    const sock = room.findByName("Priya").socketId;
    room.disconnect(sock);
    const again = room.addPlayer("Priya", "priya-auction");
    assert.equal(again.ok, true);
    assert.equal(again.rejoined, true);
    const midAuction = room.getState("Priya");
    assert.equal(midAuction.phase, "auction");
    assert.ok(midAuction.auction && midAuction.auction.nominee);
    assert.equal(midAuction.you.name, "Priya");
    assert.equal(midAuction.you.purseLakhs, purse);

    room.phase = "captains";
    room.auction = null;
    room.findByName("Priya").captainId = room.findByName("Priya").squad[0] ? room.findByName("Priya").squad[0].player.id : null;
    room.disconnect(room.findByName("Priya").socketId);
    assert.equal(room.addPlayer("Priya", "priya-captains").rejoined, true);
    const midCaptains = room.getState("Priya");
    assert.equal(midCaptains.phase, "captains");
    assert.equal(midCaptains.you.name, "Priya");

    room.phase = "results";
    room.disconnect(room.findByName("Priya").socketId);
    assert.equal(room.addPlayer("Priya", "priya-results").rejoined, true);
    const midResults = room.getState("Priya");
    assert.equal(midResults.phase, "results");
    assert.equal(midResults.you.purseLakhs, purse);
  });

  test("hands host to the next connected team on a mid-auction disconnect and does not restore it on rejoin", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"]);
    assert.equal(room.host.name, "Ashutosh");
    room.startAuction("Ashutosh");
    room.disconnect(room.findByName("Ashutosh").socketId);
    assert.equal(room.host.name, "Priya");
    assert.equal(room.addPlayer("Ashutosh", "ash-back").ok, true);
    assert.equal(room.host.name, "Priya", "returning host should not steal the role back");
    assert.equal(room.getState("Ashutosh").hostName, "Priya");
  });

  test("replaces a stale socket of the same name instead of rejecting the rejoin", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    const priya = room.findByName("Priya");
    priya.connected = true;
    priya.socketId = "stale-socket";
    room.isSocketLive = (id) => id !== "stale-socket";
    const again = room.addPlayer("Priya", "fresh-socket");
    assert.equal(again.ok, true);
    assert.equal(again.rejoined, true);
    assert.equal(room.findByName("Priya").socketId, "fresh-socket");
    assert.equal(room.findByName("Priya").connected, true);
  });
});


describe("lot snapshot strip", () => {
  test("lotStart snapshot freezes purse and pending slots for the lot", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    room.startAuction("Ashutosh");
    const start = room.auction.lotSnapshot;
    assert.ok(Array.isArray(start) && start.length === 2);
    const ash = start.find((r) => r.name === "Ashutosh");
    const priya = start.find((r) => r.name === "Priya");
    assert.equal(ash.purseLakhs, 100);
    assert.equal(priya.purseLakhs, 100);
    assert.equal(ash.pending, 11);
    const publicSnap = room.getState("Ashutosh").auction.lotSnapshot;
    assert.equal(publicSnap.length, 2);

    const def = room.franchises.find((f) => f.key === room.auction.defaultBidderKey).name;
    const other = def === "Ashutosh" ? "Priya" : "Ashutosh";
    const amount = room.auction.currentBidLakhs + 1;
    assert.equal(room.bid(other, amount).ok, true);
    // A bid must not rewrite the start-of-lot purse snapshot.
    const after = room.auction.lotSnapshot;
    assert.equal(after.find((r) => r.name === "Ashutosh").purseLakhs, 100);
    assert.equal(after.find((r) => r.name === "Priya").purseLakhs, 100);
    assert.equal(room.findByName(other).purseLakhs, 100, "purse only changes when the lot sells");
    assert.equal(room.getState("Ashutosh").auction.lotSnapshot[0].purseLakhs, 100);
  });

  test("pending count reflects squad size at the start of the lot, not after a sale", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    const leftover = players.find((p) => p.role === "BAT");
    room.findByName("Priya").squad.push({ player: leftover, priceLakhs: 2 });
    room.soldIds.add(leftover.id);
    room.queue = players.filter((p) => p.id !== leftover.id).slice(0, 3);
    room.phase = "auction";
    room.nominateNext();
    const row = room.auction.lotSnapshot.find((r) => r.name === "Priya");
    assert.equal(row.pending, 10);
    assert.equal(row.squadSize, 1);
  });
});



describe("game modes", () => {
  const { MODES, getMode, publicMode, listModes, isSquadComplete, pendingSlots } = require("../server/rules");

  function fakeSquad(roles) {
    return roles.map((role, i) => ({
      player: { id: "p" + i, name: role + i, role, batting: 70, bowling: 70 },
      priceLakhs: 2,
    }));
  }

  function simTeam(name, roles, offset) {
    const need = {};
    const skipped = {};
    for (const role of roles) {
      need[role] = (need[role] || 0) + 1;
      skipped[role] = 0;
    }
    const squad = [];
    for (const p of players) {
      if (!need[p.role]) continue;
      if (skipped[p.role] < (offset || 0)) {
        skipped[p.role] += 1;
        continue;
      }
      const have = squad.filter((s) => s.player.role === p.role).length;
      if (have >= need[p.role]) continue;
      squad.push({ player: p, priceLakhs: 4 });
    }
    return {
      name,
      franchise: { id: name, name, short: name, color: "#123" },
      squad,
      captainId: squad[0].player.id,
    };
  }

  test("classical, rapid, and bullet have the expected composition and purse", () => {
    assert.equal(listModes().length, 3);
    assert.equal(MODES.classical.squadSize, 11);
    assert.deepEqual(MODES.classical.quota, { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    assert.equal(MODES.classical.purse, 100);
    assert.deepEqual(MODES.rapid.quota, { BAT: 2, WK: 1, AR: 0, BOWL: 2 });
    assert.equal(MODES.rapid.squadSize, 5);
    assert.equal(MODES.rapid.purse, 50);
    assert.deepEqual(MODES.bullet.quota, { BAT: 1, WK: 1, AR: 0, BOWL: 1 });
    assert.equal(MODES.bullet.squadSize, 3);
    assert.equal(MODES.bullet.purse, 30);
    assert.equal(getMode("Rapid").id, "rapid");
    assert.equal(publicMode("bullet").compositionLabel, "1 BAT · 1 WK · 1 BOWL");
    assert.equal(isSquadComplete(fakeSquad(["BAT", "BAT", "WK", "BOWL", "BOWL"]), "rapid"), true);
    assert.equal(isSquadComplete(fakeSquad(["BAT", "WK", "BOWL", "BOWL"]), "rapid"), false);
    assert.equal(pendingSlots(fakeSquad(["BAT", "WK"]), "bullet"), 1);
    assert.equal(isSquadComplete(fakeSquad(["BAT", "WK", "BOWL"]), "bullet"), true);
    assert.equal(isSquadComplete(fakeSquad(["BAT", "WK", "BOWL"]), "classical"), false);
    const rapidRoom = roomWith(["Ashutosh", "Priya"], null, { mode: "rapid" });
    assert.equal(rapidRoom.mode.id, "rapid");
    assert.equal(rapidRoom.purseLakhs, 50);
    const snap = rapidRoom.getState("Ashutosh");
    assert.equal(snap.mode.id, "rapid");
    assert.equal(snap.squadSize, 5);
    assert.deepEqual(snap.quotas, { BAT: 2, WK: 1, AR: 0, BOWL: 2 });
  });

  test("rapid auction ends only when every active team has a complete 5-player squad", () => {
    const room = roomWith(["Ashutosh", "Priya"], { soldRevealMs: 0 }, { mode: "rapid" });
    giveSquad(room, "Priya", { BAT: 2, WK: 1, BOWL: 2 });
    giveSquad(room, "Ashutosh", { BAT: 2, WK: 0, BOWL: 2 });
    assert.equal(isSquadComplete(room.findByName("Priya").squad, "rapid"), true);
    assert.equal(isSquadComplete(room.findByName("Ashutosh").squad, "rapid"), false);
    const wk = players.find((p) => p.role === "WK" && !room.soldIds.has(p.id));
    room.queue = [wk];
    room.phase = "auction";
    room.rrIndex = 0;
    room.nominateNext();
    assert.ok(room.findByName("Ashutosh").squad.some((s) => s.player.id === wk.id));
    assert.equal(isSquadComplete(room.findByName("Ashutosh").squad, "rapid"), true);
    assert.ok(["captains", "simulating", "results"].includes(room.phase), room.phase);
  });

  test("bullet auction ends only when every active team has a complete 3-player squad", () => {
    const room = roomWith(["Ashutosh", "Priya"], { soldRevealMs: 0 }, { mode: "bullet" });
    assert.equal(room.purseLakhs, 30);
    giveSquad(room, "Priya", { BAT: 1, WK: 1, BOWL: 1 });
    giveSquad(room, "Ashutosh", { BAT: 1, WK: 0, BOWL: 1 });
    assert.equal(isSquadComplete(room.findByName("Priya").squad, "bullet"), true);
    const wk = players.find((p) => p.role === "WK" && !room.soldIds.has(p.id));
    room.queue = [wk];
    room.phase = "auction";
    room.rrIndex = 0;
    room.nominateNext();
    assert.ok(room.findByName("Ashutosh").squad.some((s) => s.player.id === wk.id));
    assert.equal(isSquadComplete(room.findByName("Ashutosh").squad, "bullet"), true);
    assert.equal(room.findByName("Ashutosh").squad.length, 3);
    assert.ok(["captains", "simulating", "results"].includes(room.phase), room.phase);
  });

  test("simulation runs for rapid 5-player sides", () => {
    const roles = ["BAT", "BAT", "WK", "BOWL", "BOWL"];
    const teams = [simTeam("A", roles, 0), simTeam("B", roles, 2), simTeam("C", roles, 4)];
    teams.forEach((t) => assert.equal(t.squad.length, 5, t.name));
    const result = simulateTournament(teams, 21, { mode: "rapid" });
    assert.ok(result.champion);
    assert.equal(result.leagueMatches.length, 3);
    assert.equal(result.positions.length, 3);
    for (const m of result.leagueMatches) {
      if (m.noResult) continue;
      assert.ok(m.firstInnings.balls <= 60, m.firstInnings.balls);
      assert.ok(m.secondInnings.balls <= 60);
      assert.ok(m.firstInnings.wickets <= 4);
      assert.ok(m.secondInnings.wickets <= 4);
    }
  });

  test("simulation runs for bullet 3-player sides", () => {
    const roles = ["BAT", "WK", "BOWL"];
    const teams = [simTeam("A", roles, 0), simTeam("B", roles, 2), simTeam("C", roles, 4)];
    teams.forEach((t) => assert.equal(t.squad.length, 3, t.name));
    const result = simulateTournament(teams, 8, { mode: "bullet" });
    assert.ok(result.champion);
    assert.equal(result.leagueMatches.length, 3);
    for (const m of result.leagueMatches) {
      if (m.noResult) continue;
      assert.ok(m.firstInnings.balls <= 36, m.firstInnings.balls);
      assert.ok(m.secondInnings.balls <= 36);
      assert.ok(m.firstInnings.wickets <= 2);
      assert.ok(m.secondInnings.wickets <= 2);
    }
  });
});

describe("auction list", () => {
  const {
    roleBuffer,
    expectedAuctionComposition,
    buildAuctionList,
  } = require("../server/auction-pool");
  const { shuffle, mulberry32 } = require("../server/random");

  function listIds(list) {
    return list.map((p) => p.id);
  }

  function roleCounts(list) {
    const counts = { BAT: 0, WK: 0, AR: 0, BOWL: 0 };
    for (const p of list) counts[p.role] = (counts[p.role] || 0) + 1;
    return counts;
  }

  function drainAuction(room, maxLots = 800) {
    let i = 0;
    while (room.phase === "auction" && i++ < maxLots) {
      if (room.playerIntro) room.finishPlayerIntro();
      if (!room.auction) {
        if (room.revealUntil) room.finishReveal();
        else break;
        continue;
      }
      const lot = room.lotId;
      const leader = room.auction.currentBidderKey;
      for (const f of room.franchises) {
        if (room.lotId !== lot || !room.auction) break;
        if (f.key !== leader) room.optOut(f.name);
      }
    }
    return i;
  }

  test("pool size and composition match numTeams x role slots plus the buffer, for each mode", () => {
    const cases = [
      ["classical", 2],
      ["classical", 3],
      ["classical", 10],
      ["rapid", 2],
      ["rapid", 4],
      ["rapid", 10],
      ["bullet", 2],
      ["bullet", 3],
      ["bullet", 10],
    ];
    for (const [mode, n] of cases) {
      const expect = expectedAuctionComposition(mode, n);
      assert.equal(roleBuffer(n), Math.max(1, Math.ceil(n / 2)));
      const list = buildAuctionList(players, mode, n, 42);
      assert.equal(list.length, expect.total, `${mode} x ${n} length`);
      assert.deepEqual(roleCounts(list), expect.counts, `${mode} x ${n} roles`);
      assert.equal(new Set(listIds(list)).size, list.length, `${mode} x ${n} unique`);
      if (mode === "rapid" || mode === "bullet") {
        assert.equal(expect.counts.AR, 0);
        assert.equal(roleCounts(list).AR, 0);
      }
    }
  });

  test("the combined list is a deterministic shuffle of the per-role picks when seeded", () => {
    const a = listIds(buildAuctionList(players, "classical", 4, 7));
    const b = listIds(buildAuctionList(players, "classical", 4, 7));
    const c = listIds(buildAuctionList(players, "classical", 4, 8));
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
    // Same players as seed 7, but a different permutation would use a different seed.
    assert.equal(new Set(a).size, a.length);
    // A shuffle, not a role-grouped concatenation: the first stretch is mixed.
    const firstRoles = buildAuctionList(players, "classical", 4, 7)
      .slice(0, 8)
      .map((p) => p.role);
    assert.ok(new Set(firstRoles).size >= 2, `grouped roles: ${firstRoles.join(",")}`);
  });

  test("different seeds produce different orders, and Fisher-Yates preserves membership", () => {
    const orders = new Set();
    for (let seed = 1; seed <= 8; seed++) {
      orders.add(listIds(buildAuctionList(players, "rapid", 5, seed)).join(","));
    }
    assert.ok(orders.size >= 7, `only ${orders.size} distinct shuffles`);

    const src = players.slice(0, 20).map((p) => p.id);
    const rng = mulberry32(99);
    const once = shuffle(src, rng);
    assert.deepEqual([...once].sort(), [...src].sort());
    assert.notDeepEqual(once, src);
    // The same seed starts from the same stream.
    assert.deepEqual(shuffle(src, 99), shuffle(src, 99));
  });

  test("startAuction nominates strictly in the shuffled list order", () => {
    const room = roomWith(["Ashutosh", "Priya"], { soldRevealMs: 0 }, { mode: "bullet", seed: 2026 });
    const started = room.startAuction("Ashutosh");
    assert.equal(started.ok, true);
    const expect = expectedAuctionComposition("bullet", 2);
    const seen = [room.auction.nominee.id, ...room.queue.map((p) => p.id)];
    assert.equal(seen.length, expect.total);
    assert.deepEqual(roleCounts([room.auction.nominee, ...room.queue]), expect.counts);
    const planned = [room.auction.nominee, ...room.queue];
    assert.deepEqual(
      [room.auction.nominee.id, ...room.queue.map((p) => p.id)],
      require("../server/auction-pool").buildAuctionList(players, "bullet", 2, 2026).map((p) => p.id)
    );
    // Walk lots in list order. Players no remaining team can use are skipped, not reordered.
    let idx = 0;
    let steps = 0;
    while (room.auction && steps < 4) {
      const id = room.auction.nominee.id;
      while (idx < planned.length && planned[idx].id !== id) idx += 1;
      assert.ok(idx < planned.length, `nominee ${id} was not next in the shuffled list`);
      assert.equal(id, planned[idx].id);
      const lot = room.lotId;
      const leader = room.auction.currentBidderKey;
      for (const f of room.franchises) {
        if (room.lotId !== lot || !room.auction) break;
        if (f.key !== leader) room.optOut(f.name);
      }
      idx += 1;
      steps += 1;
    }
    assert.ok(steps >= 2, `expected to walk at least two lots, got ${steps}`);
  });

  test("auction still completes with all squads full in classical, rapid, and bullet", () => {
    for (const mode of ["classical", "rapid", "bullet"]) {
      const room = roomWith(["Ashutosh", "Priya", "Rohan"], { soldRevealMs: 0 }, { mode, seed: 11 });
      assert.equal(room.startAuction("Ashutosh").ok, true);
      const lots = drainAuction(room);
      assert.ok(lots < 800, `${mode} did not finish in time`);
      assert.ok(["captains", "simulating", "results"].includes(room.phase), `${mode} phase ${room.phase}`);
      for (const name of ["Ashutosh", "Priya", "Rohan"]) {
        const team = room.findByName(name);
        assert.equal(team.eliminated, false, `${mode} ${name} eliminated`);
        assert.equal(isSquadComplete(team.squad, mode), true, `${mode} ${name} incomplete`);
      }
    }
  });
  test("no team exceeds squad size in the default-only bullet game that used to overflow to 5 or 6 of 3", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"], { soldRevealMs: 0 }, { mode: "bullet", seed: 1 });
    assert.equal(room.startAuction("Ashutosh").ok, true);
    const lots = drainAuction(room);
    assert.ok(lots < 800, "auction did not finish");
    assert.ok(["captains", "simulating", "results"].includes(room.phase), room.phase);
    const cap = getMode("bullet").squadSize;
    const sizes = {};
    for (const f of room.franchises) {
      sizes[f.name] = f.squad.map((s) => s.player.role).join(",");
      assert.ok(f.squad.length <= cap, `${f.name} has ${f.squad.length} of ${cap}: ${sizes[f.name]}`);
      assert.equal(isSquadComplete(f.squad, "bullet"), true, `${f.name} incomplete: ${sizes[f.name]}`);
    }
  });

  test("sellCurrent does not push a player onto a squad that is already full", () => {
    const room = roomWith(["Ashutosh", "Priya"], { soldRevealMs: 0 }, { mode: "bullet" });
    giveSquad(room, "Ashutosh", { BAT: 1, WK: 1, AR: 0, BOWL: 1 });
    const extra = players.find((p) => p.role === "BAT" && !room.soldIds.has(p.id));
    room.phase = "auction";
    room.lotId = 1;
    room.auction = {
      nominee: extra,
      startBidLakhs: 2,
      currentBidLakhs: 2,
      currentBidderKey: "ashutosh",
      defaultBidderKey: "ashutosh",
      optedOut: new Set(["priya"]),
      endsAt: Date.now() + 15_000,
      timerMs: 15_000,
    };
    room.sellCurrent();
    assert.equal(room.findByName("Ashutosh").squad.length, 3);
    assert.ok(!room.findByName("Ashutosh").squad.some((s) => s.player.id === extra.id));
    assert.ok(room.soldIds.has(extra.id) === false);
  });

  test("random default-only and mixed-bid auctions never exceed the mode squad size", () => {
    const modes = ["bullet", "rapid", "classical"];
    const teamCounts = [2, 3, 4, 6];
    let games = 0;
    for (const mode of modes) {
      const cap = getMode(mode).squadSize;
      for (const n of teamCounts) {
        // More seeds on the smaller modes, where overflow used to appear first.
        const seeds = mode === "classical" ? [1, 7, 42] : [1, 2, 3, 7, 11, 42, 99, 2026];
        for (const seed of seeds) {
          const names = Array.from({ length: n }, (_, i) => `Team${i + 1}`);
          const room = roomWith(names, { soldRevealMs: 0 }, { mode, seed });
          assert.equal(room.startAuction(names[0]).ok, true);
          let i = 0;
          let raiseEvery = seed % 4; // 0 = default-only; else a volunteer raise on some lots
          while (room.phase === "auction" && i++ < 800) {
            if (room.playerIntro) room.finishPlayerIntro();
            if (!room.auction) {
              if (room.revealUntil) room.finishReveal();
              else break;
              continue;
            }
            const lot = room.lotId;
            const leader = room.auction.currentBidderKey;
            const bidder = room.franchises.find((f) => f.key !== leader && room.stillInTeams().some((t) => t.key === f.key));
            if (raiseEvery && bidder && i % raiseEvery === 0 && room.auction) {
              const bid = room.bid(bidder.name);
              if (bid && bid.ok && room.lotId === lot && room.auction) {
                // others (except new leader) opt out
                for (const f of room.franchises) {
                  if (room.lotId !== lot || !room.auction) break;
                  if (f.key !== room.auction.currentBidderKey) room.optOut(f.name);
                }
                continue;
              }
            }
            for (const f of room.franchises) {
              if (room.lotId !== lot || !room.auction) break;
              if (f.key !== leader) room.optOut(f.name);
            }
          }
          games += 1;
          assert.ok(i < 800, `${mode} x ${n} seed ${seed} did not finish`);
          assert.ok(["captains", "simulating", "results"].includes(room.phase), `${mode} x ${n} seed ${seed} phase ${room.phase}`);
          for (const f of room.franchises) {
            const roles = f.squad.map((s) => s.player.role).join(",");
            assert.ok(
              f.squad.length <= cap,
              `${mode} x ${n} seed ${seed}: ${f.name} has ${f.squad.length} of ${cap} (${roles})`
            );
          }
        }
      }
    }
    assert.ok(games >= 40, `expected many fuzz games, got ${games}`);
  });

});

describe("character powers", () => {
  test("usePower can only be used once, then rejects a second use", () => {
    const room = roomWith(["Ashutosh", "Priya"], { powerRevealMs: 0, soldRevealMs: 0 });
    room.assignCharacter(room.findByName("Ashutosh"), "narendra-modi");
    room.assignCharacter(room.findByName("Priya"), "ravi-kishan");
    assert.equal(room.startAuction("Ashutosh").ok, true);
    const first = room.usePower("Ashutosh");
    assert.equal(first.ok, true, first.error);
    assert.equal(room.findByName("Ashutosh").powerUsesLeft, 0);
    assert.equal(room.powerReveal, null);
    const snap = room.getState("Ashutosh");
    assert.equal(snap.you.powerUsed, true);
    assert.equal(snap.you.power.uses, 1);
    assert.ok(snap.you.power.name);
    const second = room.usePower("Ashutosh");
    assert.equal(second.ok, false);
    assert.match(second.error, /already used/i);
  });

  test("usePower freezes the lot timer and resumes with the remaining time after the reveal", async () => {
    const room = roomWith(["Ashutosh", "Priya"], { lotStartMs: 400, bidMs: 400, powerRevealMs: 80, soldRevealMs: 0 });
    room.assignCharacter(room.findByName("Ashutosh"), "narendra-modi");
    room.assignCharacter(room.findByName("Priya"), "ravi-kishan");
    assert.equal(room.startAuction("Ashutosh").ok, true);
    const before = Math.max(0, room.auction.endsAt - Date.now());
    const events = [];
    room.on("delta", (e) => events.push(e.type));
    const priyaPurse = room.findByName("Priya").purseLakhs;
    const used = room.usePower("Ashutosh");
    assert.equal(used.ok, true, used.error);
    assert.ok(room.powerReveal);
    assert.equal(room.paused, false);
    const held = room.powerFreeze && room.powerFreeze.remainingMs;
    assert.ok(held <= before && held >= before - 80, `held=${held} before=${before}`);
    assert.equal(room.bid("Priya", room.auction.currentBidLakhs + 1).ok, false);
    assert.equal(room.pause("Priya").ok, false);
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(room.powerReveal, "reveal should still be in progress");
    assert.equal(room.findByName("Priya").purseLakhs, priyaPurse, "effect applies after the reveal");
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(room.powerReveal, null);
    assert.equal(room.findByName("Priya").purseLakhs, Math.max(0, priyaPurse - 10));
    const left = room.auction.endsAt - Date.now();
    assert.ok(left <= held + 40, `left=${left} held=${held}`);
    assert.ok(left >= held - 90, `left=${left} held=${held}`);
    assert.ok(events.includes("powerReveal"));
    assert.ok(events.includes("powerApplied"));
  });

  test("usePower is rejected when invalid", () => {
    const room = roomWith(["Ashutosh", "Priya"], { powerRevealMs: 200, soldRevealMs: 400 });
    room.assignCharacter(room.findByName("Ashutosh"), "narendra-modi");
    room.assignCharacter(room.findByName("Priya"), "ravi-kishan");
    const lobby = room.usePower("Ashutosh");
    assert.equal(lobby.ok, false);
    assert.match(lobby.error, /during the auction/i);

    assert.equal(room.startAuction("Ashutosh").ok, true);
    assert.equal(room.usePower("Nobody").ok, false);

    room.findByName("Priya").eliminated = true;
    const dead = room.usePower("Priya");
    assert.equal(dead.ok, false);
    assert.match(dead.error, /eliminated/i);
    room.findByName("Priya").eliminated = false;

    assert.equal(room.pause("Ashutosh").ok, true);
    const paused = room.usePower("Priya");
    assert.equal(paused.ok, false);
    assert.match(paused.error, /paused/i);
    assert.equal(room.resume("Ashutosh").ok, true);

    const player = room.auction.nominee;
    room.auction = null;
    room.revealUntil = Date.now() + 400;
    const duringSold = room.usePower("Ashutosh");
    assert.equal(duringSold.ok, false);
    assert.match(duringSold.error, /next player/i);
    room.revealUntil = null;
    room.auction = {
      nominee: player,
      startBidLakhs: 2,
      currentBidLakhs: 2,
      currentBidderKey: "ashutosh",
      defaultBidderKey: "ashutosh",
      optedOut: new Set(),
      endsAt: Date.now() + 15000,
      timerMs: 15000,
      lotSnapshot: room.packLotSnapshot(),
    };

    assert.equal(room.usePower("Ashutosh").ok, true);
    const overlapping = room.usePower("Priya");
    assert.equal(overlapping.ok, false);
    assert.match(overlapping.error, /already being revealed/i);
  });
});


describe("match-fixing ban rule", () => {
  test("does not ban a team that spends its last points to complete the squad", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    giveSquad(room, "Ashutosh", { BAT: 3, WK: 1, AR: 2, BOWL: 4 });
    giveSquad(room, "Priya", { BAT: 3, WK: 1, AR: 2, BOWL: 4 });
    room.findByName("Ashutosh").purseLakhs = 2;
    const nextBat = players.find((p) => p.role === "BAT" && !room.soldIds.has(p.id));
    room.queue = [nextBat];
    room.phase = "auction";
    room.nominateNext();
    assert.equal(room.optOut("Priya").ok, true);
    const a = room.findByName("Ashutosh");
    assert.ok(a.squad.some((s) => s.player.id === nextBat.id));
    assert.equal(isSquadComplete(a.squad), true);
    assert.equal(a.purseLakhs, 0);
    assert.equal(Boolean(a.banned), false);
    assert.notEqual(a.eliminatedReason, "match_fixing");
  });

  test("bans a team that hits 0 points with an open squad slot", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    room.findByName("Ashutosh").purseLakhs = 2;
    const bat = players.find((p) => p.role === "BAT");
    room.queue = [bat];
    room.phase = "auction";
    room.nominateNext();
    assert.equal(room.optOut("Priya").ok, true);
    const a = room.findByName("Ashutosh");
    assert.ok(a.squad.some((s) => s.player.id === bat.id));
    assert.equal(a.purseLakhs, 0);
    assert.equal(isSquadComplete(a.squad), false);
    assert.equal(a.banned, true);
    assert.equal(a.eliminatedReason, "match_fixing");
  });

  test("bans a team already at 0 points with open slots", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    room.findByName("Ashutosh").purseLakhs = 0;
    const bat = players.find((p) => p.role === "BAT");
    room.queue = [bat];
    room.phase = "auction";
    const events = [];
    room.on("delta", (e) => events.push(e));
    room.nominateNext();
    const a = room.findByName("Ashutosh");
    assert.equal(a.banned, true);
    assert.equal(a.eliminatedReason, "match_fixing");
    assert.ok(events.some((e) => e.type === "banned" && e.name === "Ashutosh"));
    assert.ok(!a.squad.some((s) => s.player.id === bat.id));
  });

  test("does not ban a complete squad sitting at 0 points, and does not unban later", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    giveSquad(room, "Ashutosh", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    room.findByName("Ashutosh").purseLakhs = 0;
    room.phase = "auction";
    room.nominateNext();
    const a = room.findByName("Ashutosh");
    assert.equal(Boolean(a.banned), false);
    a.squad = a.squad.slice(0, 5);
    a.purseLakhs = 0;
    a.banned = true;
    a.eliminated = true;
    a.eliminatedReason = "match_fixing";
    // Completing after the ban must not clear it.
    giveSquad(room, "Ashutosh", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    const { banBrokeIncompleteTeams } = require("../server/powers");
    banBrokeIncompleteTeams(room);
    assert.equal(room.findByName("Ashutosh").banned, true);
  });
});

describe("last-team fill reveal", () => {
  test("assigns remaining players one at a time with a sold card, then moves on", async () => {
    const room = roomWith(["Ashutosh", "Priya"], { autofillRevealMs: 40, soldRevealMs: 0 });
    giveSquad(room, "Priya", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    giveSquad(room, "Ashutosh", { BAT: 3, WK: 0, AR: 2, BOWL: 4 });
    const bat = players.find((p) => p.role === "BAT" && !room.soldIds.has(p.id));
    const wk = players.find((p) => p.role === "WK" && !room.soldIds.has(p.id));
    room.queue = [bat, wk];
    room.phase = "auction";
    const events = [];
    room.on("delta", (e) => events.push(e));
    room.nominateNext();
    assert.equal(room.phase, "auction");
    const firstSold = events.filter((e) => e.type === "sold");
    assert.equal(firstSold.length, 1);
    assert.equal(firstSold[0].auto, true);
    assert.equal(firstSold[0].buyerName, "Ashutosh");
    assert.equal(firstSold[0].player.id, bat.id);
    const a = room.findByName("Ashutosh");
    assert.ok(a.squad.some((s) => s.player.id === bat.id));
    assert.equal(a.squad.some((s) => s.player.id === wk.id), false);
    const snap = room.getState("Priya");
    assert.equal(snap.lastEvent.type, "sold");
    assert.equal(snap.lastEvent.player.id, bat.id);
    assert.ok(snap.soldRevealUntil > Date.now());
    await new Promise((r) => setTimeout(r, 50));
    const sold = events.filter((e) => e.type === "sold");
    assert.equal(sold.length, 2);
    assert.equal(sold[1].player.id, wk.id);
    assert.ok(a.squad.some((s) => s.player.id === wk.id));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(room.autoFillFollowup, null);
    assert.ok(["captains", "simulating", "results"].includes(room.phase), room.phase);
  });

  test("Continue skips the current auto-fill sold card and shows the next", () => {
    const room = roomWith(["Ashutosh", "Priya"], { autofillRevealMs: 4000, soldRevealMs: 0 });
    giveSquad(room, "Priya", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    giveSquad(room, "Ashutosh", { BAT: 3, WK: 1, AR: 2, BOWL: 4 });
    const bat = players.find((p) => p.role === "BAT" && !room.soldIds.has(p.id));
    room.queue = [bat];
    room.phase = "auction";
    room.nominateNext();
    assert.equal(room.lastEvent && room.lastEvent.type, "sold");
    assert.equal(room.lastEvent.player.id, bat.id);
    assert.equal(room.continueReveal("Ashutosh").ok, true);
    assert.ok(["captains", "simulating", "results"].includes(room.phase), room.phase);
  });
});

describe("auto-fill sold sequence", () => {
  test("end-of-auction auto-fill shows each player on the sold card, and 0ms finishes immediately", () => {
    const room = roomWith(["Ashutosh", "Priya"], { autofillRevealMs: 0, soldRevealMs: 0 });
    giveSquad(room, "Ashutosh", { BAT: 4, WK: 0, AR: 2, BOWL: 4 });
    giveSquad(room, "Priya", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    const wk = players.find((p) => p.role === "WK" && !room.soldIds.has(p.id));
    room.allPlayers = [...room.franchises.flatMap((f) => f.squad.map((s) => s.player)), wk];
    room.queue = [];
    room.unsold = [wk];
    room.phase = "auction";
    const events = [];
    room.on("delta", (e) => events.push(e));
    room.closeAuctionForEmptyPool();
    assert.ok(events.some((e) => e.type === "poolExhausted" && e.added >= 1));
    assert.ok(events.some((e) => e.type === "sold" && e.auto && e.player.id === wk.id));
    assert.ok(room.findByName("Ashutosh").squad.some((s) => s.player.id === wk.id));
    assert.ok(["captains", "simulating", "results"].includes(room.phase), room.phase);
    assert.equal(isSquadComplete(room.findByName("Ashutosh").squad), true);
  });

  test("auto-fill reveal is one player at a time and a refresh resumes the current sold card", async () => {
    const room = roomWith(["Ashutosh", "Priya"], { autofillRevealMs: 50, soldRevealMs: 0, captainMs: 10 });
    giveSquad(room, "Ashutosh", { BAT: 3, WK: 1, AR: 2, BOWL: 4 });
    giveSquad(room, "Priya", { BAT: 3, WK: 1, AR: 2, BOWL: 4 });
    const bats = players.filter((p) => p.role === "BAT" && !room.soldIds.has(p.id)).slice(0, 2);
    assert.equal(bats.length, 2);
    room.allPlayers = [...room.franchises.flatMap((f) => f.squad.map((s) => s.player)), ...bats];
    room.queue = [];
    room.unsold = bats.slice();
    room.phase = "auction";
    const events = [];
    room.on("delta", (e) => events.push(e));
    room.closeAuctionForEmptyPool();
    const sold = events.filter((e) => e.type === "sold");
    assert.equal(sold.length, 1, "only the first auto-fill sale is visible");
    const firstId = sold[0].player.id;
    const mid = room.getState("Priya");
    assert.equal(mid.phase, "auction");
    assert.equal(mid.lastEvent.type, "sold");
    assert.equal(mid.lastEvent.auto, true);
    assert.equal(mid.lastEvent.player.id, firstId);
    assert.ok(mid.soldRevealUntil > Date.now(), "refresh keeps the sold card deadline");
    const firstTeam = room.franchises.find((f) => f.squad.some((s) => s.player.id === firstId));
    assert.ok(firstTeam);
    const other = bats.find((p) => p.id !== firstId);
    assert.equal(room.findByName(firstTeam.name === "Ashutosh" ? "Priya" : "Ashutosh").squad.some((s) => s.player.id === other.id), false);
    await new Promise((r) => setTimeout(r, 60));
    const sold2 = events.filter((e) => e.type === "sold");
    assert.equal(sold2.length, 2);
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(["captains", "simulating", "results"].includes(room.phase), room.phase);
    assert.equal(isSquadComplete(room.findByName("Ashutosh").squad), true);
    assert.equal(isSquadComplete(room.findByName("Priya").squad), true);
  });

  test("results and captains wait until the last auto-filled sold card has been shown", async () => {
    const room = roomWith(["Ashutosh", "Priya"], { autofillRevealMs: 80, soldRevealMs: 0, captainMs: 10 });
    giveSquad(room, "Ashutosh", { BAT: 4, WK: 0, AR: 2, BOWL: 4 });
    giveSquad(room, "Priya", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    const wk = players.find((p) => p.role === "WK" && !room.soldIds.has(p.id));
    room.allPlayers = [...room.franchises.flatMap((f) => f.squad.map((s) => s.player)), wk];
    room.queue = [];
    room.unsold = [];
    room.phase = "auction";
    room.nominateNext();
    assert.equal(room.phase, "auction");
    assert.equal(room.lastEvent.type, "sold");
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(room.phase, "auction");
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(["captains", "simulating", "results"].includes(room.phase), room.phase);
  });
});

describe("marquee auction spacing", () => {
  const {
    buildAuctionList,
    windowsHaveMarquee,
    maxNonMarqueeRun,
    minMarqueesForLength,
    MARQUEE_WINDOW,
    isMarquee,
  } = require("../server/auction-pool");

  test("the pool has a curated set of real IPL superstars marked marquee", () => {
    const marked = players.filter((p) => p.marquee);
    assert.ok(marked.length >= 30, `only ${marked.length} marquees`);
    for (const name of ["Virat Kohli", "MS Dhoni", "Jasprit Bumrah", "Rohit Sharma", "Rashid Khan"]) {
      const row = players.find((p) => p.name === name);
      assert.ok(row && row.marquee, name);
    }
  });

  test("every random auction list has a marquee in each block of 10 and no 10-gap", () => {
    assert.equal(MARQUEE_WINDOW, 10);
    let checked = 0;
    for (let seed = 1; seed <= 120; seed++) {
      for (const [mode, n] of [["classical", 4], ["classical", 8], ["rapid", 5], ["bullet", 2], ["bullet", 8]]) {
        const list = buildAuctionList(players, mode, n, seed);
        checked += 1;
        assert.ok(list.filter(isMarquee).length >= minMarqueesForLength(list.length), `${mode} x ${n} seed ${seed} short of marquees`);
        assert.equal(windowsHaveMarquee(list), true, `${mode} x ${n} seed ${seed} missing a decade marquee`);
        assert.ok(maxNonMarqueeRun(list) < 10, `${mode} x ${n} seed ${seed} run ${maxNonMarqueeRun(list)}`);
        for (let i = 0; i + 10 <= list.length; i += 10) {
          assert.ok(list.slice(i, i + 10).some(isMarquee), `block ${i}-${i + 9} on ${mode} ${n} seed ${seed}`);
        }
      }
    }
    assert.ok(checked >= 100);
  });
});

describe("auction pool top-up", () => {
  test("fetches unused players in batches of 10 when the queue runs out", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    giveSquad(room, "Ashutosh", { BAT: 4, WK: 0, AR: 2, BOWL: 4 });
    giveSquad(room, "Priya", { BAT: 4, WK: 0, AR: 2, BOWL: 4 });
    const extras = players.filter((p) => p.role === "WK" && !room.soldIds.has(p.id));
    assert.ok(extras.length >= 12, `need leftover keepers, got ${extras.length}`);
    const already = room.franchises.flatMap((f) => f.squad.map((s) => s.player));
    room.allPlayers = [...already, ...extras.slice(0, 15)];
    room.queue = [];
    room.unsold = [];
    room.phase = "auction";
    const events = [];
    room.on("delta", (e) => events.push(e));
    room.nominateNext();
    const top = events.find((e) => e.type === "poolTopUp");
    assert.ok(top, "expected a room-wide top-up message");
    assert.equal(top.count, 10);
    assert.match(top.message, /10 more player/i);
    assert.ok(room.auction, "should auction the new batch, not auto-fill");
    assert.equal(room.auction.nominee.role, "WK");
    assert.equal(room.queue.length, 9);
  });

  test("auto-fills and announces when no unused players remain", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    giveSquad(room, "Ashutosh", { BAT: 4, WK: 0, AR: 2, BOWL: 4 });
    giveSquad(room, "Priya", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    room.allPlayers = room.franchises.flatMap((f) => f.squad.map((s) => s.player));
    room.queue = [];
    room.unsold = [];
    room.phase = "auction";
    const events = [];
    room.on("delta", (e) => events.push(e));
    room.nominateNext();
    const ev = events.find((e) => e.type === "poolExhausted");
    assert.ok(ev, "expected a room-wide empty-pool message");
    assert.match(ev.message, /no more players/i);
    assert.ok(["captains", "simulating", "results"].includes(room.phase), room.phase);
  });

  test("a top-up batch never reintroduces sold or already-queued players, even to place a marquee", () => {
    const { nextAuctionBatch, injectMarquees } = require("../server/auction-pool");
    const sold = players.filter((p) => p.marquee).slice(0, 20);
    assert.ok(sold.length >= 15, "need sold marquees to tempt a reuse");
    const usedIds = new Set(sold.map((p) => p.id));
    const batch = nextAuctionBatch({
      allPlayers: players,
      usedIds,
      neededRoles: new Set(["BAT", "WK", "AR", "BOWL"]),
      rng: 7,
      size: 10,
      prefix: sold,
    });
    assert.equal(batch.length, 10);
    for (const p of batch) assert.ok(!usedIds.has(p.id), `batch reused ${p.name}`);
    const filler = players.filter((p) => !p.marquee && !usedIds.has(p.id)).slice(0, 10);
    const injected = injectMarquees(filler, players, { usedIds, prefix: sold });
    for (const p of injected) assert.ok(!usedIds.has(p.id), `inject reused ${p.name}`);
  });

  test("nextAuctionBatch prefers needed roles and caps at 10", () => {
    const { nextAuctionBatch } = require("../server/auction-pool");
    const bats = players.filter((p) => p.role === "BAT").slice(0, 8);
    const bowls = players.filter((p) => p.role === "BOWL").slice(0, 8);
    const used = new Set();
    const batch = nextAuctionBatch({
      allPlayers: [...bats, ...bowls],
      usedIds: used,
      neededRoles: new Set(["BAT"]),
      rng: 1,
      size: 10,
    });
    assert.equal(batch.length, 10);
    assert.equal(batch.filter((p) => p.role === "BAT").length, 8);
    assert.equal(batch.filter((p) => p.role === "BOWL").length, 2);
  });
});


describe("team form", () => {
  test("rolls form once when a squad becomes complete and does not re-roll later", () => {
    const room = roomWith(["Ashutosh", "Priya"], {}, { seed: 11 });
    giveSquad(room, "Ashutosh", { BAT: 3, WK: 1, AR: 2, BOWL: 4 });
    giveSquad(room, "Priya", { BAT: 3, WK: 1, AR: 2, BOWL: 4 });
    assert.equal(room.findByName("Ashutosh").formPct, null);
    const nextBat = players.find((p) => p.role === "BAT" && !room.soldIds.has(p.id));
    room.queue = [nextBat];
    room.phase = "auction";
    const events = [];
    room.on("delta", (e) => events.push(e));
    room.nominateNext();
    assert.equal(room.optOut("Priya").ok, true);
    const a = room.findByName("Ashutosh");
    assert.equal(isSquadComplete(a.squad), true);
    assert.equal(typeof a.formPct, "number");
    assert.ok(a.formPct >= 85 && a.formPct <= 115, a.formPct);
    const formEvt = events.find((e) => e.type === "teamForm" && e.name === "Ashutosh");
    assert.ok(formEvt, "expected a room-wide form reveal");
    assert.equal(formEvt.formPct, a.formPct);
    assert.match(formEvt.message, /Ashutosh's current form is \d+%/);
    const snap = room.getState("Priya");
    assert.equal(snap.franchises.find((f) => f.name === "Ashutosh").formPct, a.formPct);
    const kept = a.formPct;
    a.squad = a.squad.slice(0, 6);
    assert.equal(isSquadComplete(a.squad), false);
    assert.equal(room.maybeRevealForm(a), false);
    assert.equal(a.formPct, kept);
    giveSquad(room, "Ashutosh", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    assert.equal(isSquadComplete(a.squad), true);
    assert.equal(room.maybeRevealForm(a), false);
    assert.equal(a.formPct, kept);
  });

  test("assigns form after a last-team fill or auto-fill completes a squad", () => {
    const room = roomWith(["Ashutosh", "Priya"], { lastTeamFillMs: 0 }, { seed: 21 });
    giveSquad(room, "Priya", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    giveSquad(room, "Ashutosh", { BAT: 3, WK: 1, AR: 2, BOWL: 4 });
    const bat = players.find((p) => p.role === "BAT" && !room.soldIds.has(p.id));
    room.queue = [bat];
    room.phase = "auction";
    room.nominateNext();
    const a = room.findByName("Ashutosh");
    assert.equal(isSquadComplete(a.squad), true);
    assert.ok(a.formPct >= 85 && a.formPct <= 115, a.formPct);
    assert.equal(room.findByName("Priya").formPct >= 85, true);

    const room2 = roomWith(["Ashutosh", "Priya"], {}, { seed: 22 });
    giveSquad(room2, "Priya", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    giveSquad(room2, "Ashutosh", { BAT: 3, WK: 1, AR: 2, BOWL: 4 });
    const leftover = players.find((p) => p.role === "BAT" && !room2.soldIds.has(p.id));
    room2.queue = [];
    room2.unsold = [];
    room2.allPlayers = [...room2.franchises.flatMap((f) => f.squad.map((s) => s.player)), leftover];
    room2.phase = "auction";
    room2.autoFill();
    const filled = room2.findByName("Ashutosh");
    assert.equal(isSquadComplete(filled.squad), true);
    assert.ok(filled.formPct >= 95 && filled.formPct <= 105, filled.formPct);
  });

  test("form rolls are in 95–105 and mildly centre-weighted", () => {
    const { rollTeamForm } = require("../server/simulate");
    const { mulberry32 } = require("../server/random");
    const rng = mulberry32(2026);
    const n = 4000;
    const counts = { mid: 0, tail: 0 };
    let sum = 0;
    let min = 200;
    let max = 0;
    const { FORM_MIN_PCT, FORM_MAX_PCT } = require("../server/simulate");
    assert.equal(FORM_MIN_PCT, 95);
    assert.equal(FORM_MAX_PCT, 105);
    for (let i = 0; i < n; i++) {
      const v = rollTeamForm(rng);
      assert.ok(v >= 95 && v <= 105, v);
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
      if (v >= 98 && v <= 102) counts.mid += 1;
      if (v <= 96 || v >= 104) counts.tail += 1;
    }
    const mean = sum / n;
    assert.ok(mean > 98 && mean < 102, `mean ${mean}`);
    assert.ok(counts.mid > counts.tail, `mid ${counts.mid} vs tail ${counts.tail}`);
    assert.ok(min <= 97 && max >= 103, `range ${min}-${max}`);
  });

  test("form swings equal-rating results moderately and is included on match data", () => {
    const { playMatch } = require("../server/simulate");
    const { mulberry32 } = require("../server/random");
    const mixed = [
      ...players.filter((p) => p.role === "BAT").slice(0, 4),
      ...players.filter((p) => p.role === "WK").slice(0, 1),
      ...players.filter((p) => p.role === "AR").slice(0, 2),
      ...players.filter((p) => p.role === "BOWL").slice(0, 4),
    ];
    function team(name, formPct) {
      return {
        name,
        formPct,
        franchise: { name, color: "#fc0" },
        squad: mixed.map((p) => ({ player: p, priceLakhs: 5 })),
        captainId: mixed[0].id,
        mode: "classical",
        boosters: [],
      };
    }
    const a = team("Hot", 115);
    const b = team("Cold", 85);
    const rng = mulberry32(7);
    const sample = playMatch(a, b, rng, "League");
    assert.equal(sample.formPctA, 115);
    assert.equal(sample.formPctB, 85);
    assert.equal(sample.firstInnings.formPct === 115 || sample.firstInnings.formPct === 85, true);
    let hot = 0;
    const n = 200;
    const run = mulberry32(8);
    for (let i = 0; i < n; i++) {
      const m = playMatch(a, b, run, "League");
      if (m.winnerName === "Hot") hot += 1;
    }
    assert.ok(hot > n * 0.6 && hot < n * 0.95, `hot won ${hot}/${n}`);
  });

  test("applyDelta records a revealed form on the franchise", () => {
    const { applyDelta } = require("../public/state");
    const state = {
      phase: "auction",
      franchises: [{ name: "Mitron", squad: [], formPct: null }],
      you: { name: "Mitron", squad: [], formPct: null },
    };
    applyDelta(state, { type: "teamForm", name: "Mitron", formPct: 108, message: "Mitron's current form is 108%" });
    assert.equal(state.franchises[0].formPct, 108);
    assert.equal(state.you.formPct, 108);
  });
});


describe("player intro", () => {
  test("skips the intro when playerIntroMs is 0 and starts the bid timer immediately", () => {
    const room = roomWith(["Ashutosh", "Priya"], { playerIntroMs: 0 });
    room.queue = [players.find((p) => p.id === "virat-kohli")];
    room.phase = "auction";
    const t0 = Date.now();
    room.nominateNext();
    assert.equal(room.playerIntro, null);
    assert.ok(room.auction.endsAt && room.auction.endsAt - t0 > 14000);
  });

  test("holds the bid timer, blocks bids and powers, then starts bidding when the intro ends", () => {
    const room = roomWith(["Ashutosh", "Priya"], { playerIntroMs: 2000, powerRevealMs: 0 });
    room.assignCharacter(room.findByName("Ashutosh"), "narendra-modi");
    room.queue = [players.find((p) => p.id === "virat-kohli")];
    room.phase = "auction";
    room.nominateNext();
    assert.ok(room.playerIntro);
    assert.equal(room.auction.endsAt, null);
    const snap = room.getState("Priya");
    assert.ok(snap.playerIntro);
    assert.equal(snap.auction.nominee.name, "Virat Kohli");
    assert.match(snap.auction.youReason || "", /introduced/i);
    const lead = room.auction.currentBidderKey === "ashutosh" ? "Priya" : "Ashutosh";
    const blocked = room.bid(lead, room.auction.currentBidLakhs + 1);
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /introduced/i);
    assert.equal(room.optOut(lead).ok, false);
    const power = room.usePower("Ashutosh");
    assert.equal(power.ok, false);
    assert.match(power.error, /introduced/i);
    room.finishPlayerIntro();
    assert.equal(room.playerIntro, null);
    assert.ok(room.auction.endsAt && room.auction.endsAt > Date.now());
    assert.equal(room.bid(lead, room.auction.currentBidLakhs + 1).ok, true);
  });

  test("pause freezes the intro clock and resume continues it", async () => {
    const room = roomWith(["Ashutosh", "Priya"], { playerIntroMs: 400 });
    room.queue = [players.find((p) => p.id === "virat-kohli")];
    room.phase = "auction";
    room.nominateNext();
    assert.ok(room.playerIntro && room.playerIntro.endsAt);
    assert.equal(room.pause("Priya").ok, true);
    assert.equal(room.pauseTimerKind, "playerIntro");
    const left = room.pauseRemainingMs;
    await new Promise((r) => setTimeout(r, 280));
    assert.ok(room.playerIntro, "intro must stay up while paused");
    assert.equal(room.auction.endsAt, null);
    assert.equal(room.resume("Priya").ok, true);
    assert.ok(room.playerIntro.endsAt - Date.now() > left - 80);
    assert.ok(room.playerIntro.endsAt - Date.now() <= left + 50);
  });

  test("Prabhas VFX masks the intro player for everyone except the owner", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"], { playerIntroMs: 2000, powerRevealMs: 0, soldRevealMs: 0 });
    room.assignCharacter(room.findByName("Ashutosh"), "narendra-modi");
    room.assignCharacter(room.findByName("Priya"), "prabhas");
    room.assignCharacter(room.findByName("Rohan"), "ravi-kishan");
    room.queue = players.filter((p) => p.role === "BAT").slice(0, 4);
    room.phase = "auction";
    room.nominateNext();
    if (room.playerIntro) room.finishPlayerIntro();
    assert.equal(room.usePower("Priya").ok, true);
    room.sellCurrent();
    assert.ok(room.playerIntro, "the next lot should open with an intro");
    assert.equal(room.auction.vfxHidden, true);
    const seer = room.getState("Priya");
    const other = room.getState("Ashutosh");
    assert.equal(seer.auction.nominee.id, room.auction.nominee.id);
    assert.equal(seer.auction.nominee.vfxHidden, undefined);
    assert.equal(other.auction.nominee.vfxHidden, true);
    assert.equal(other.auction.nominee.name, "VFX loading…");
    assert.equal(other.playerIntro && other.auction.nominee.role, "???");
  });
});

describe("phased results reveal", () => {
  function fillFour(room) {
    for (const team of room.franchises) {
      const need = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
      for (const p of players) {
        if ((need[p.role] || 0) > 0 && !room.soldIds.has(p.id)) {
          team.squad.push({ player: p, priceLakhs: 2 });
          room.soldIds.add(p.id);
          need[p.role] -= 1;
        }
      }
      team.captainId = team.squad[0].player.id;
    }
  }

  test("squad strength score is 0–1000 and follows the overall × form formula", () => {
    const empty = { name: "Empty", franchise: { color: "#000" }, squad: [], mode: "classical", boosters: [] };
    assert.equal(squadStrengthScore(empty), 0);
    const need = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
    const mixed = [];
    for (const p of players) {
      if ((need[p.role] || 0) > 0) {
        mixed.push(p);
        need[p.role] -= 1;
      }
    }
    const typical = {
      name: "Typical",
      formPct: 100,
      franchise: { color: "#fc0" },
      squad: mixed.map((p) => ({ player: p, priceLakhs: 5 })),
      captainId: mixed[0].id,
      mode: "classical",
      boosters: [],
    };
    const score = squadStrengthScore(typical);
    const b = squadStrengthBreakdown(typical);
    assert.equal(score, b.score);
    const overall = Math.round(
      STRENGTH_WEIGHTS.batting * b.battingStrength
      + STRENGTH_WEIGHTS.bowling * b.bowlingStrength
      + STRENGTH_WEIGHTS.fielding * b.fieldingStrength
    );
    assert.equal(b.overallStrength, Math.max(0, Math.min(1000, overall)));
    assert.equal(score, Math.max(0, Math.min(1000, Math.round(b.overallStrength * formMultiplier(typical) * SCORE_SCALE))));
    assert.ok(score >= 500 && score <= 950, `typical score ${score}`);
    const halfNeed = { BAT: 2, WK: 1, AR: 0, BOWL: 2 };
    const half = [];
    for (const p of players) {
      if ((halfNeed[p.role] || 0) > 0) {
        half.push(p);
        halfNeed[p.role] -= 1;
      }
    }
    const weak = {
      name: "Weak",
      formPct: 85,
      franchise: { color: "#333" },
      squad: half.map((p) => ({ player: p, priceLakhs: 2 })),
      mode: "classical",
      boosters: [],
    };
    const weakScore = squadStrengthScore(weak);
    assert.ok(weakScore > 0 && weakScore < score, `weak ${weakScore} vs typical ${score}`);
  });

  test("reveals last place first, includes finish and score, and skip is server-synced", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan", "Neha"], { resultsRevealStepMs: 5000, captainMs: 10 });
    fillFour(room);
    room.phase = "captains";
    room.finishCaptains();
    assert.equal(room.phase, "results");
    const r = room.packResultsReveal();
    assert.ok(r);
    assert.equal(r.total, 4);
    assert.equal(r.revealedCount, 1);
    assert.equal(r.complete, false);
    const positions = room.tournament.positions;
    assert.equal(positions.length, 4);
    const firstShown = positions[positions.length - 1];
    assert.ok(firstShown.squadScore >= 0 && firstShown.squadScore <= 1000);
    assert.ok(firstShown.finish);
    const snap = room.getState("Priya");
    assert.equal(snap.resultsReveal.revealedCount, 1);
    assert.equal(snap.resultsReveal.complete, false);
    assert.equal(snap.tournament.positions[3].name, firstShown.name);
    for (const pos of snap.tournament.positions) {
      assert.ok(pos.finish);
      assert.equal(typeof pos.squadScore, "number");
    }
    const champ = positions[0];
    assert.equal(champ.finish, "Champion");
    const titles = new Set(positions.map((p) => p.finish));
    assert.ok(titles.has("Runner-up"));
    assert.ok(titles.has("Lost Eliminator") || titles.has("4th"));
    const skipped = room.skipResultsReveal("Rohan");
    assert.equal(skipped.ok, true, skipped.error);
    assert.equal(room.resultsReveal.skipped, true);
    assert.equal(room.resultsReveal.revealedCount, 4);
    assert.equal(room.packResultsReveal().complete, true);
    const after = room.getState("Ashutosh");
    assert.equal(after.resultsReveal.complete, true);
    assert.equal(after.resultsReveal.revealedCount, 4);
  });

  test("ticks add one team at a time and pause freezes the next reveal", async () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan", "Neha"], { resultsRevealStepMs: 80, captainMs: 10 });
    fillFour(room);
    room.phase = "captains";
    room.finishCaptains();
    assert.equal(room.resultsReveal.revealedCount, 1);
    room.pause("Priya");
    assert.equal(room.pauseTimerKind, "resultsReveal");
    await new Promise((r) => setTimeout(r, 160));
    assert.equal(room.resultsReveal.revealedCount, 1, "paused reveal must not advance");
    assert.equal(room.resume("Priya").ok, true);
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(room.resultsReveal.revealedCount >= 3, `expected further reveals, got ${room.resultsReveal.revealedCount}`);
  });
});

describe("bidding-screen headshots", () => {
  const { hiddenNomineePlaceholder } = require("../server/powers");

  test("Prabhas VFX withholds the official headshot URL from everyone except the owner", () => {
    const room = roomWith(["Ashutosh", "Priya"], { playerIntroMs: 0, powerRevealMs: 0, soldRevealMs: 0 });
    room.assignCharacter(room.findByName("Ashutosh"), "narendra-modi");
    room.assignCharacter(room.findByName("Priya"), "prabhas");
    const kohli = players.find((p) => p.id === "virat-kohli");
    const next = players.find((p) => p.id === "rohit-sharma") || players.find((p) => p.headshot && p.id !== (kohli && kohli.id));
    assert.ok(kohli && kohli.headshot, "need Kohli headshot in the pool");
    assert.ok(next && next.headshot, "need a second mapped player");
    room.queue = [kohli, next];
    room.phase = "auction";
    room.nominateNext();
    if (room.playerIntro) room.finishPlayerIntro();
    const used = room.usePower("Priya");
    assert.equal(used.ok, true, used.error);
    room.sellCurrent();
    if (room.playerIntro) room.finishPlayerIntro();
    assert.equal(room.auction.vfxHidden, true);
    assert.equal(room.auction.nominee.id, next.id);
    const seer = room.getState("Priya");
    const other = room.getState("Ashutosh");
    assert.equal(seer.auction.nominee.headshot, next.headshot);
    assert.equal(other.auction.nominee.vfxHidden, true);
    assert.equal(other.auction.nominee.headshot, undefined);
    assert.equal("headshot" in other.auction.nominee, false);
    const packed = JSON.stringify(other.auction.nominee);
    assert.equal(packed.includes("team-assets"), false);
    assert.equal(packed.includes("headshot"), false);
    const hidden = hiddenNomineePlaceholder();
    assert.equal("headshot" in hidden, false);
  });
});

describe("retired players stay out of the auction", () => {
  function neverNominated(room, id) {
    assert.ok(!room.queue.some((p) => p && p.id === id), "still in the queue");
    assert.ok(!(room.auction && room.auction.nominee && room.auction.nominee.id === id), "currently nominated");
  }

  test("an unsold player is never re-nominated or pulled into a refill", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    const bats = players.filter((p) => p.role === "BAT" && !room.soldIds.has(p.id));
    const unsold = bats[0];
    const next = bats[1];
    room.queue = [unsold, next];
    room.phase = "auction";
    room.nominateNext();
    assert.equal(room.auction.nominee.id, unsold.id);
    room.auction.currentBidderKey = null;
    room.auction.defaultBidderKey = null;
    room.unsoldCurrent();
    assert.equal(room.lastEvent.type, "unsold");
    assert.ok(room.isRetired(unsold.id));
    neverNominated(room, unsold.id);
    assert.ok(room.auction);
    assert.equal(room.auction.nominee.id, next.id);

    // Refill must also skip them, even if they are the only leftover of a needed role.
    room.queue = [];
    room.unsold = [unsold];
    room.allPlayers = [unsold];
    giveSquad(room, "Ashutosh", { BAT: 3, WK: 1, AR: 2, BOWL: 4 });
    giveSquad(room, "Priya", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    const added = room.appendTopUpBatch();
    assert.equal(added, false);
    const fromUnsold = room.takeNeededFrom(room.unsold);
    assert.equal(fromUnsold.out.length, 0);
    room.autoFill();
    assert.ok(!room.findByName("Ashutosh").squad.some((s) => s.player.id === unsold.id));
    assert.ok(room.isRetired(unsold.id));
  });

  test("a Kim-wiped player is never re-nominated or pulled into a refill", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    // Mark sold, then wipe via returnPlayerToPool.
    const bat = players.find((p) => p.role === "BAT" && !room.soldIds.has(p.id));
    const other = players.find((p) => p.role === "BAT" && p.id !== bat.id && !room.soldIds.has(p.id));
    const ash = room.findByName("Ashutosh");
    ash.squad.push({ player: bat, priceLakhs: 8 });
    room.soldIds.add(bat.id);
    room.soldLog.push({ player: bat, priceLakhs: 8, buyerName: ash.name, short: ash.name });
    room.queue = [other];
    room.phase = "auction";
    room.returnPlayerToPool(bat);
    ash.squad = ash.squad.filter((s) => s.player.id !== bat.id);
    assert.ok(room.isRetired(bat.id));
    neverNominated(room, bat.id);
    const log = (room.soldLog || []).find((e) => e.player && e.player.id === bat.id);
    assert.equal(log && log.wiped, true);

    room.allPlayers = [bat, other];
    const used = room.usedPlayerIdSet();
    assert.ok(used.has(bat.id));
    const added = room.appendTopUpBatch();
    neverNominated(room, bat.id);
    room.autoFill();
    assert.ok(!room.franchises.some((f) => (f.squad || []).some((s) => s.player.id === bat.id)));
    void added;
  });

  test("autoFill skips retired players and closes with the squads as they are if nobody eligible remains", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    giveSquad(room, "Priya", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    giveSquad(room, "Ashutosh", { BAT: 4, WK: 0, AR: 2, BOWL: 4 });
    const wk = players.find((p) => p.role === "WK" && !room.soldIds.has(p.id));
    room.retirePlayer(wk);
    room.queue = [];
    room.unsold = [wk];
    room.allPlayers = [...room.franchises.flatMap((f) => f.squad.map((s) => s.player)), wk];
    room.phase = "auction";
    const before = room.findByName("Ashutosh").squad.length;
    room.closeAuctionForEmptyPool();
    const ash = room.findByName("Ashutosh");
    assert.equal(ash.squad.length, before);
    assert.ok(!ash.squad.some((s) => s.player.id === wk.id));
    assert.ok(["captains", "simulating", "results"].includes(room.phase), room.phase);
    assert.ok(room.lastEvent);
    // Existing fallback: either the poolExhausted notice or captains already started after it.
    const msg = (room.lastEvent && room.lastEvent.message) || "";
    if (room.lastEvent.type === "poolExhausted") {
      assert.equal(room.lastEvent.added, 0);
      assert.match(msg, /squads as they are/i);
    }
  });
});

describe("form bias by completion order", () => {
  const { rollTeamForm, formRankShift, FORM_RANK_SHIFT, mulberry32 } = require("../server/simulate");

  test("shifts the form centre linearly from +5 for first to -5 for last, clamped to 95–105", () => {
    assert.equal(FORM_RANK_SHIFT, 5);
    assert.equal(formRankShift(1, 1), 0);
    assert.equal(formRankShift(1, 4), 5);
    assert.equal(formRankShift(4, 4), -5);
    assert.equal(formRankShift(2, 3), 0);
    assert.ok(Math.abs(formRankShift(2, 4) - (5 - 10 / 3)) < 1e-9);
    const rng = mulberry32(99);
    for (let i = 0; i < 200; i++) {
      const v = rollTeamForm(rng, { rank: 1, total: 8 });
      assert.ok(v >= 95 && v <= 105, v);
    }
  });

  test("Monte Carlo: first finishers out-form last finishers on average", () => {
    const rng = mulberry32(2026);
    const n = 8000;
    const sums = [0, 0, 0, 0];
    let firstBeatsLast = 0;
    let lastBeatsFirst = 0;
    let ties = 0;
    for (let i = 0; i < n; i++) {
      const forms = [1, 2, 3, 4].map((rank) => rollTeamForm(rng, { rank, total: 4 }));
      forms.forEach((v, k) => { sums[k] += v; });
      if (forms[0] > forms[3]) firstBeatsLast += 1;
      else if (forms[3] > forms[0]) lastBeatsFirst += 1;
      else ties += 1;
    }
    const means = sums.map((s) => s / n);
    const pFirst = firstBeatsLast / n;
    const pUpset = lastBeatsFirst / n;
    console.log("form bias MC", { means, pFirst, pUpset, ties: ties / n });
    assert.ok(means[0] > means[1] && means[1] > means[2] && means[2] > means[3], means);
    assert.ok(means[0] > 102 && means[0] < 108, `first mean ${means[0]}`);
    assert.ok(means[3] > 94 && means[3] < 100, `last mean ${means[3]}`);
    assert.ok(pFirst > 0.7, `P(first > last) ${pFirst}`);
    // ±5 rank shift now spans the whole 95–105 band, so last cannot roll strictly hotter than first.
    assert.ok(pUpset === 0, `P(last > first) ${pUpset}`);
  });

  test("completion rank is assigned when form is rolled, and auto-fill or last-team fill finish last", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"]);
    giveSquad(room, "Ashutosh", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    assert.equal(room.maybeRevealForm(room.findByName("Ashutosh")), true);
    assert.equal(room.findByName("Ashutosh").formFinishRank, 1);
    giveSquad(room, "Priya", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    assert.equal(room.maybeRevealForm(room.findByName("Priya")), true);
    assert.equal(room.findByName("Priya").formFinishRank, 2);
    giveSquad(room, "Rohan", { BAT: 3, WK: 1, AR: 2, BOWL: 4 });
    room.queue = [];
    room.unsold = [];
    const leftover = players.find((p) => p.role === "BAT" && !room.soldIds.has(p.id));
    room.allPlayers = [...room.franchises.flatMap((f) => f.squad.map((s) => s.player)), leftover];
    room.autoFill();
    const rohan = room.findByName("Rohan");
    assert.equal(isSquadComplete(rohan.squad), true);
    assert.equal(rohan.formFinishRank, 3);
    assert.equal(room.formFinishCount, 3);
  });
});

describe("auto-fill does not change results except through form", () => {
  test("auto-fill and last-team fill have no direct effect on strength, positions, or player stats", () => {
    const fs = require("fs");
    const path = require("path");
    const simSrc = fs.readFileSync(path.join(__dirname, "../server/simulate.js"), "utf8");
    assert.doesNotMatch(simSrc, /autoFill|lastTeamFill|\.auto\b/);

    const need = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
    const picked = [];
    const used = new Set();
    for (const p of players) {
      if ((need[p.role] || 0) > 0) {
        picked.push(p);
        used.add(p.id);
        need[p.role] -= 1;
      }
    }
    function team(name, extra = {}) {
      return {
        name,
        formPct: 100,
        franchise: { color: "#fc0", text: "#000" },
        squad: picked.map((p) => ({ player: p, priceLakhs: 5 })),
        captainId: picked[0].id,
        mode: "classical",
        boosters: [],
        ...extra,
      };
    }
    const voluntary = team("Voluntary");
    const autoFilled = team("Auto", { autoFilled: true, lastTeamFill: true });
    assert.deepEqual(matchStrength(voluntary), matchStrength(autoFilled));
    assert.equal(squadStrengthScore(voluntary), squadStrengthScore(autoFilled));

    const { playMatch, mulberry32 } = require("../server/simulate");
    const rngA = mulberry32(77);
    const rngB = mulberry32(77);
    const rival = team("Rival", { name: "Rival", formPct: 100 });
    const mVol = playMatch(voluntary, { ...rival, name: "Rival" }, rngA, "League");
    const mAuto = playMatch(autoFilled, team("Rival"), rngB, "League");
    assert.equal(mVol.firstInnings.score, mAuto.firstInnings.score);
    assert.equal(mVol.secondInnings.score, mAuto.secondInnings.score);
    assert.equal(mVol.winnerName === "Voluntary" ? "Auto" : mVol.winnerName, mAuto.winnerName === "Auto" ? "Auto" : mAuto.winnerName);

    const tVol = simulateTournament([voluntary, team("Other", { name: "Other", formPct: 100 })], 42);
    const tAuto = simulateTournament([autoFilled, team("Other", { name: "Other", formPct: 100 })], 42);
    assert.equal(tVol.positions[0].title, tAuto.positions[0].title);
    const volScore = tVol.positions.find((p) => p.name === "Voluntary").formPct;
    const autoScore = tAuto.positions.find((p) => p.name === "Auto").formPct;
    assert.equal(volScore, 100);
    assert.equal(autoScore, 100);
    assert.equal(
      tVol.positions.find((p) => p.name === "Voluntary").points,
      tAuto.positions.find((p) => p.name === "Auto").points
    );

    // Room path: after auto-fill, forcing the same form yields the same strength as a voluntary twin.
    const roomA = roomWith(["Ashutosh", "Priya"], {}, { seed: 11 });
    giveSquad(roomA, "Ashutosh", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    giveSquad(roomA, "Priya", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    roomA.findByName("Ashutosh").formPct = 100;
    roomA.findByName("Priya").formPct = 100;
    const roomB = roomWith(["Ashutosh", "Priya"], {}, { seed: 11 });
    giveSquad(roomB, "Ashutosh", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    giveSquad(roomB, "Priya", { BAT: 3, WK: 1, AR: 2, BOWL: 4 });
    roomB.queue = [];
    roomB.unsold = [];
    const leftover = players.find((p) => p.role === "BAT" && !roomB.soldIds.has(p.id) && !roomA.soldIds.has(p.id));
    // Use Priya's missing role from the same pool shape: copy Ashutosh/Priya voluntary leftover isn't needed;
    // just auto-fill whoever remains. Then overwrite form.
    roomB.allPlayers = [...roomB.franchises.flatMap((f) => f.squad.map((s) => s.player)), leftover];
    roomB.autoFill();
    assert.equal(isSquadComplete(roomB.findByName("Priya").squad), true);
    roomB.findByName("Ashutosh").formPct = 100;
    roomB.findByName("Priya").formPct = 100;
    // Strength of the voluntarily completed team is unaffected by the other team being auto-filled.
    assert.equal(
      squadStrengthScore(roomA.findByName("Ashutosh")),
      squadStrengthScore(roomB.findByName("Ashutosh"))
    );
  });
});

describe("simulated player stats and results payload", () => {
  test("per-player batting and bowling totals match the innings and tournament team totals", () => {
    const { playMatch, mulberry32 } = require("../server/simulate");
    function makeTeam(name, start) {
      const need = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
      const squad = [];
      let i = start;
      while (squad.length < 11 && i < players.length) {
        const p = players[i++];
        if ((need[p.role] || 0) > 0) {
          squad.push({ player: p, priceLakhs: 4 });
          need[p.role] -= 1;
        }
      }
      return {
        name,
        formPct: 100,
        franchise: { color: "#fc0", text: "#000" },
        squad,
        captainId: squad[0].player.id,
        mode: "classical",
        boosters: [],
      };
    }
    const a = makeTeam("A", 0);
    const b = makeTeam("B", 40);
    const match = playMatch(a, b, mulberry32(123), "League");
    assert.ok(match.performances);
    for (const inn of [match.firstInnings, match.secondInnings]) {
      const side = match.performances[inn.name];
      const runSum = (side.batting || []).reduce((s, r) => s + r.runs, 0);
      const extras = (inn.extras && inn.extras.total) || 0;
      const wktBat = (side.batting || []).filter((r) => r.out).length;
      assert.equal(runSum + extras, inn.score, `${inn.name} runs ${runSum}+${extras} vs ${inn.score}`);
      assert.equal(wktBat, inn.wickets, `${inn.name} wickets ${wktBat} vs ${inn.wickets}`);
    }
    const bowlFirst = match.performances[match.secondInnings.name].bowling || [];
    const bowlSecond = match.performances[match.firstInnings.name].bowling || [];
    const w1 = bowlFirst.reduce((s, r) => s + r.wickets, 0);
    const w2 = bowlSecond.reduce((s, r) => s + r.wickets, 0);
    assert.equal(w1, match.firstInnings.wickets, `bowl wkts ${w1} vs ${match.firstInnings.wickets}`);
    assert.equal(w2, match.secondInnings.wickets, `bowl wkts ${w2} vs ${match.secondInnings.wickets}`);

    const t = simulateTournament([a, b, makeTeam("C", 80)], 2026);
    const matches = [...(t.leagueMatches || []), ...((t.playoffs && t.playoffs.matches) || [])];
    for (const team of [a, b, makeTeam("C", 80)]) {
      const name = team.name === "C" ? "C" : team.name;
      let runsFor = 0;
      let extrasFor = 0;
      let wicketsTaken = 0;
      for (const m of matches) {
        if (m.noResult) continue;
        if (m.firstInnings.name === name) {
          runsFor += m.firstInnings.score;
          extrasFor += (m.firstInnings.extras && m.firstInnings.extras.total) || 0;
          wicketsTaken += m.secondInnings.wickets;
        } else if (m.secondInnings.name === name) {
          runsFor += m.secondInnings.score;
          extrasFor += (m.secondInnings.extras && m.secondInnings.extras.total) || 0;
          wicketsTaken += m.firstInnings.wickets;
        }
      }
      const stats = (t.playerStats && t.playerStats[name]) || [];
      const statRuns = stats.reduce((s, r) => s + (r.runs || 0), 0);
      const statWkts = stats.reduce((s, r) => s + (r.wickets || 0), 0);
      assert.equal(statRuns + extrasFor, runsFor, `${name} tournament runs ${statRuns}+${extrasFor} vs ${runsFor}`);
      assert.equal(statWkts, wicketsTaken, `${name} tournament wickets ${statWkts} vs ${wicketsTaken}`);
    }
  });

  test("results snapshot has standings fields and team sheets, but omits match scorecards", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"], { captainMs: 10, resultsRevealStepMs: 0 }, { seed: 5 });
    for (const name of ["Ashutosh", "Priya", "Rohan"]) {
      giveSquad(room, name, { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
      room.findByName(name).captainId = room.findByName(name).squad[0].player.id;
      room.findByName(name).formPct = name === "Ashutosh" ? 108 : name === "Priya" ? 100 : 92;
    }
    room.phase = "captains";
    room.finishCaptains();
    assert.equal(room.phase, "results");
    const lite = room.getState("Ashutosh");
    assert.equal(lite.tournament.leagueMatches, undefined);
    assert.equal(lite.tournament.playoffs.matches, undefined);
    assert.ok(Array.isArray(lite.tournament.positions));
    assert.ok(Array.isArray(lite.tournament.teams));
    assert.equal(lite.tournament.teams.length, 3);
    for (const pos of lite.tournament.positions) {
      assert.equal(typeof pos.position, "number");
      assert.ok(pos.name);
      assert.equal(typeof pos.squadScore, "number");
      assert.ok(pos.squadScore >= 0 && pos.squadScore <= 1000);
      assert.ok(pos.finish);
      assert.equal(typeof pos.formPct, "number");
      assert.ok("won" in pos && "lost" in pos);
      assert.ok(pos.coOwner);
    }
    for (const team of lite.tournament.teams) {
      assert.ok(team.squad.length >= 11);
      assert.ok(team.topPerformerId);
      assert.ok(team.squad.some((s) => s.isTopPerformer && s.player.id === team.topPerformerId));
      assert.ok(team.squad.some((s) => s.isCaptain));
      for (const s of team.squad) {
        assert.ok(s.stats);
        assert.equal(typeof s.stats.runs, "number");
        assert.equal(typeof s.stats.strikeRate, "number");
        assert.equal(typeof s.stats.highest, "number");
        assert.equal(typeof s.stats.wickets, "number");
        assert.equal(typeof s.stats.economy, "number");
        assert.equal(typeof s.stats.matches, "number");
        assert.ok("priceLakhs" in s);
      }
    }
  });
});


describe("three-pillar overall strength", () => {
  function stubPlayer(id, role, batting, bowling, extra = {}) {
    return { id, name: id, role, batting, bowling, overseas: false, captainMatches: 0, ...extra };
  }

  function completeSquad(modeId, rating = 70) {
    const mode = getMode(modeId);
    const squad = [];
    let n = 0;
    for (const role of ["BAT", "WK", "AR", "BOWL"]) {
      const count = mode.quota[role] || 0;
      for (let i = 0; i < count; i += 1) {
        n += 1;
        squad.push({ player: stubPlayer(`${modeId}-${role}-${i}`, role, rating, rating), priceLakhs: 2 });
      }
    }
    return {
      name: `${modeId}-side`,
      formPct: 100,
      franchise: { color: "#fc0" },
      squad,
      captainId: squad[0].player.id,
      mode: modeId,
      boosters: [],
      size: n,
    };
  }

  test("a complete even-rated side scores 700 in every mode at form 100", () => {
    for (const mode of ["classical", "rapid", "bullet"]) {
      const team = completeSquad(mode, 70);
      const b = squadStrengthBreakdown(team);
      assert.equal(b.battingStrength, 700, `${mode} bat`);
      assert.equal(b.bowlingStrength, 700, `${mode} bowl`);
      assert.equal(b.fieldingStrength, 700, `${mode} field`);
      assert.equal(b.overallStrength, 700, `${mode} overall`);
      assert.equal(b.score, 700, `${mode} score`);
    }
  });

  test("Rapid and Bullet complete sides are not crushed into the 200–300 band", () => {
    for (const mode of ["rapid", "bullet"]) {
      const team = completeSquad(mode, 70);
      const asClassical = squadStrengthScore({ ...team, mode: undefined });
      const correct = squadStrengthScore(team);
      assert.ok(asClassical >= 200 && asClassical <= 350, `${mode} mis-scored as Classical ${asClassical}`);
      assert.ok(correct >= 650 && correct <= 800, `${mode} correct ${correct}`);
      assert.ok(correct - asClassical >= 300, `${mode} gap ${correct} vs ${asClassical}`);
    }
  });

  test("a Rapid room stamps mode on the franchise so standings use Rapid quotas", () => {
    const room = roomWith(["Ashutosh", "Priya"], { captainMs: 10 }, { mode: "rapid" });
    assert.equal(room.findByName("Ashutosh").mode, "rapid");
    giveSquad(room, "Ashutosh", { BAT: 2, WK: 1, AR: 0, BOWL: 2 });
    giveSquad(room, "Priya", { BAT: 2, WK: 1, AR: 0, BOWL: 2 });
    room.findByName("Ashutosh").formPct = 100;
    room.findByName("Priya").formPct = 100;
    room.findByName("Ashutosh").captainId = room.findByName("Ashutosh").squad[0].player.id;
    room.findByName("Priya").captainId = room.findByName("Priya").squad[0].player.id;
    room.phase = "captains";
    room.finishCaptains();
    const scores = room.tournament.positions.map((p) => p.squadScore);
    for (const pos of room.tournament.positions) {
      assert.ok(pos.squadScore >= 500 && pos.squadScore <= 950, `${pos.name} ${pos.squadScore}`);
      assert.ok(pos.squadScore > 350, `${pos.name} still looks like the old Rapid bug: ${pos.squadScore}`);
      assert.equal(typeof pos.battingStrength, "number");
      assert.equal(typeof pos.bowlingStrength, "number");
      assert.equal(typeof pos.fieldingStrength, "number");
      assert.equal(typeof pos.overallStrength, "number");
    }
    const snap = room.getState("Ashutosh");
    const packed = snap.tournament.teams.find((t) => t.name === "Ashutosh");
    assert.equal(packed.squadScore, room.tournament.positions.find((p) => p.name === "Ashutosh").squadScore);
    assert.ok(packed.battingStrength >= 0 && packed.battingStrength <= 1000);
    assert.ok(Math.max(...scores) > 700);
  });

  test("all-rounders contribute batting and bowling, and incomplete units are penalised", () => {
    const ars = [
      stubPlayer("ar-1", "AR", 90, 60),
      stubPlayer("ar-2", "AR", 90, 60),
    ];
    const bats = [0, 1, 2, 3].map((i) => stubPlayer(`bat-${i}`, "BAT", 80, 20));
    const wk = stubPlayer("wk-1", "WK", 80, 20);
    const bowls = [0, 1, 2, 3].map((i) => stubPlayer(`bowl-${i}`, "BOWL", 20, 70));
    const full = {
      name: "Full",
      formPct: 100,
      franchise: { color: "#fc0" },
      squad: [...bats, wk, ...ars, ...bowls].map((p) => ({ player: p, priceLakhs: 2 })),
      captainId: bats[0].id,
      mode: "classical",
      boosters: [],
    };
    const noArBowl = {
      ...full,
      name: "NoAR",
      squad: [...bats, wk, ...bowls].map((p) => ({ player: p, priceLakhs: 2 })),
    };
    const withAr = squadStrengthBreakdown(full);
    const withoutAr = squadStrengthBreakdown(noArBowl);
    assert.ok(withAr.bowlingStrength > withoutAr.bowlingStrength, `${withAr.bowlingStrength} vs ${withoutAr.bowlingStrength}`);
    assert.ok(withAr.battingStrength > withoutAr.battingStrength, `${withAr.battingStrength} vs ${withoutAr.battingStrength}`);
    assert.equal(withAr.battingStrength, Math.round((4 * 80 + 80 + 2 * 90) / 7 / PILLAR_RAW_CAP * 1000));
    assert.equal(withAr.bowlingStrength, Math.round((2 * 60 + 4 * 70) / 6 / PILLAR_RAW_CAP * 1000));
  });

  test("form, captain bonus and standing boosters still change the score, auto-fill does not", () => {
    const base = completeSquad("rapid", 70);
    const hot = { ...base, formPct: 115 };
    const cold = { ...base, formPct: 85 };
    assert.equal(formMultiplier(hot), 1 + (1.15 - 1) * FORM_EFFECT);
    assert.equal(squadStrengthScore(hot), Math.round(700 * formMultiplier(hot) * SCORE_SCALE));
    assert.equal(squadStrengthScore(cold), Math.round(700 * formMultiplier(cold) * SCORE_SCALE));
    assert.ok(squadStrengthScore(hot) > squadStrengthScore(base));
    assert.ok(squadStrengthScore(cold) < squadStrengthScore(base));

    const captained = completeSquad("rapid", 70);
    captained.squad[0].player.captainMatches = 158;
    assert.ok(squadStrengthScore(captained) > squadStrengthScore(base));

    const cheer = { ...base, boosters: [{ id: "cheerleaders" }] };
    const curator = { ...base, boosters: [{ id: "home-curator" }] };
    const cheerB = squadStrengthBreakdown(cheer);
    const curatorB = squadStrengthBreakdown(curator);
    const baseB = squadStrengthBreakdown(base);
    assert.ok(cheerB.battingStrength > baseB.battingStrength);
    assert.ok(cheerB.bowlingStrength > baseB.bowlingStrength);
    assert.equal(cheerB.fieldingStrength, baseB.fieldingStrength);
    assert.ok(curatorB.bowlingStrength > baseB.bowlingStrength);
    assert.equal(curatorB.battingStrength, baseB.battingStrength);

    const auto = { ...base, autoFilled: true, lastTeamFill: true };
    assert.equal(squadStrengthScore(auto), squadStrengthScore(base));
  });

  test("nothing exceeds 1000 even with a loaded star side", () => {
    const team = completeSquad("classical", 99);
    team.formPct = 115;
    team.squad[0].player.captainMatches = 235;
    team.boosters = [{ id: "cheerleaders" }, { id: "home-curator" }, { id: "friendly-umpire" }];
    const b = squadStrengthBreakdown(team);
    assert.ok(b.battingStrength <= 1000);
    assert.ok(b.bowlingStrength <= 1000);
    assert.ok(b.fieldingStrength <= 1000);
    assert.ok(b.overallStrength <= 1000);
    assert.ok(b.score <= 1000);
    assert.ok(b.score >= 900, `loaded side should be near the cap, got ${b.score}`);
  });

  test("Monte Carlo: typical auctions have top team above 700 and no score above 1000", async () => {
    const NAMES = ["Ashutosh", "Priya", "Rohan", "Neha", "Vikram", "Meera", "Kabir", "Ananya"];
    function drainAuction(room, maxLots = 800) {
      let i = 0;
      while (room.phase === "auction" && i++ < maxLots) {
        if (room.playerIntro) room.finishPlayerIntro();
        if (!room.auction) {
          if (room.revealUntil) room.finishReveal();
          else break;
          continue;
        }
        const lot = room.lotId;
        const leader = room.auction.currentBidderKey;
        for (const f of room.franchises) {
          if (room.lotId !== lot || !room.auction) break;
          if (f.key !== leader) room.optOut(f.name);
        }
      }
      return i;
    }
    const tops = [];
    const bottoms = [];
    let games = 0;
    // Keep this sample modest and yield between games so a parallel e2e
    // suite in the same process can still service sockets.
    for (const mode of ["bullet", "rapid", "classical"]) {
      for (let n = 2; n <= 8; n += 1) {
        for (const seed of [11, 29]) {
          const names = NAMES.slice(0, n);
          const room = roomWith(names, { captainMs: 10 }, { mode, seed: seed * 1000 + n * 17 + mode.length });
          assert.equal(room.startAuction(names[0]).ok, true);
          drainAuction(room);
          if (room.phase === "captains") room.finishCaptains();
          assert.equal(room.phase, "results", `${mode} x ${n} seed ${seed} phase ${room.phase}`);
          const scores = room.tournament.positions.map((p) => p.squadScore);
          assert.equal(scores.length, n);
          for (const score of scores) {
            assert.ok(score >= 0 && score <= 1000, `${mode} x ${n} score ${score}`);
          }
          tops.push(Math.max(...scores));
          bottoms.push(Math.min(...scores));
          games += 1;
          await new Promise((r) => setImmediate(r));
        }
      }
    }
    const pTop = tops.filter((s) => s > 700).length / tops.length;
    assert.equal(games, 3 * 7 * 2);
    assert.ok(pTop >= 0.9, `P(top>700)=${pTop} over ${games} games; tops ${Math.min(...tops)}–${Math.max(...tops)}`);
    assert.ok(Math.max(...tops) <= 1000);
    assert.ok(Math.min(...bottoms) >= 400, `unexpectedly weak bottom ${Math.min(...bottoms)}`);
    assert.ok(Math.max(...tops) >= 750);
  });
});


describe("final match reveal", () => {
  function fill(room, quota) {
    for (const team of room.franchises) {
      const need = { ...quota };
      for (const p of players) {
        if ((need[p.role] || 0) > 0 && !room.soldIds.has(p.id)) {
          team.squad.push({ player: p, priceLakhs: 2 });
          room.soldIds.add(p.id);
          need[p.role] -= 1;
        }
      }
      team.captainId = team.squad[0].player.id;
    }
  }

  test("the streamed final is the tournament final and its winner is the champion", () => {
    for (const seed of [3, 11, 29]) {
      const room = roomWith(["Ashutosh", "Priya", "Rohan", "Neha"], { captainMs: 10, resultsRevealStepMs: 0, finalMatchMs: 0 }, { seed });
      fill(room, { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
      room.phase = "captains";
      room.finishCaptains();
      const champ = room.tournament.positions.find((p) => p.finish === "Champion");
      const match = findFinalMatch(room.tournament);
      assert.ok(match, `seed ${seed} missing final`);
      assert.equal(match.winnerName, champ.name, `seed ${seed}`);
      const packed = room.packResultsReveal();
      assert.equal(packed.complete, true);
      assert.equal(packed.stage, "done");
      assert.equal(packed.final.winnerName, champ.name);
      assert.equal(packed.final.resultText, match.resultText);
      assert.ok(packed.final.potm && packed.final.potm.name);
      const tl = buildFinalTimeline(match);
      assert.equal(tl.winnerName, champ.name);
      const again = buildFinalTimeline(match);
      assert.deepEqual(again, tl);
    }
  });

  test("same seed produces the same final timeline", () => {
    function side(name, start) {
      const need = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
      const squad = [];
      let skipped = 0;
      for (const p of players) {
        if ((need[p.role] || 0) > 0) {
          if (skipped < start) { skipped += 1; continue; }
          squad.push({ player: p, priceLakhs: 2 });
          need[p.role] -= 1;
        }
      }
      return {
        name,
        franchise: { color: "#fc0", text: "#000" },
        squad,
        captainId: squad[0].player.id,
        mode: "classical",
        boosters: [],
        formPct: 100,
      };
    }
    function play(seed) {
      const t = simulateTournament([side("Ashutosh", 0), side("Priya", 11), side("Rohan", 22), side("Neha", 33)], seed);
      return buildFinalTimeline(findFinalMatch(t));
    }
    const a = play(44);
    const b = play(44);
    assert.ok(a && a.winnerName);
    assert.deepEqual(b, a);
    const c = play(45);
    assert.ok(c);
  });

  test("reveals only positions below the top 2, then plays the final, and skip jumps to the end", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan", "Neha"], { resultsRevealStepMs: 5000, finalMatchMs: 8000, captainMs: 10 });
    fill(room, { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    room.phase = "captains";
    room.finishCaptains();
    const packed = room.packResultsReveal();
    assert.equal(packed.stage, "standings");
    assert.equal(packed.revealedCount, 1);
    assert.equal(packed.holdCount, 2);
    assert.equal(packed.complete, false);
    assert.ok(packed.final && packed.final.winnerName);
    const firstShown = room.tournament.positions[room.tournament.positions.length - 1];
    assert.equal(firstShown.position, 4);
    room.tickResultsReveal();
    assert.equal(room.resultsReveal.revealedCount, 2);
    assert.equal(room.resultsReveal.stage, "final");
    assert.equal(room.packResultsReveal().complete, false);
    const mid = room.getState("Priya");
    assert.equal(mid.resultsReveal.stage, "final");
    assert.ok(mid.resultsReveal.final.deliveries || mid.resultsReveal.final.innings);
    assert.ok(mid.resultsReveal.final.innings[0].deliveries.length >= 1);
    const skipped = room.skipResultsReveal("Rohan");
    assert.equal(skipped.ok, true, skipped.error);
    const after = room.packResultsReveal();
    assert.equal(after.skipped, true);
    assert.equal(after.complete, true);
    assert.equal(after.stage, "done");
    assert.equal(after.revealedCount, 4);
    assert.equal(after.final.winnerName, room.tournament.positions[0].name);
    assert.equal(after.final.elapsedMs, after.final.durationMs);
  });

  test("FINAL_MATCH_MS of 0 skips the live stream after the lower standings", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"], { resultsRevealStepMs: 40, finalMatchMs: 0, captainMs: 10 });
    fill(room, { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    room.phase = "captains";
    room.finishCaptains();
    assert.equal(room.resultsReveal.stage, "standings");
    assert.equal(room.resultsReveal.revealedCount, 1);
    room.tickResultsReveal();
    const packed = room.packResultsReveal();
    assert.equal(packed.stage, "done");
    assert.equal(packed.complete, true);
    assert.equal(packed.final.winnerName, findFinalMatch(room.tournament).winnerName);
  });

  test("pause freezes the final clock and a late snapshot resumes at the same point", async () => {
    const room = roomWith(["Ashutosh", "Priya"], { resultsRevealStepMs: 0, finalMatchMs: 2000, captainMs: 10 });
    fill(room, { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    room.phase = "captains";
    room.finishCaptains();
    assert.equal(room.resultsReveal.stage, "final", room.resultsReveal.stage);
    await new Promise((r) => setTimeout(r, 80));
    const before = room.packResultsReveal().final.elapsedMs;
    assert.ok(before >= 40, `elapsed before pause ${before}`);
    room.pause("Priya");
    const frozen = room.packResultsReveal().final.elapsedMs;
    await new Promise((r) => setTimeout(r, 80));
    const still = room.packResultsReveal().final.elapsedMs;
    assert.ok(Math.abs(still - frozen) <= 15, `clock moved while paused ${frozen} -> ${still}`);
    assert.equal(room.packResultsReveal().final.paused, true);
    const mid = room.getState("Ashutosh");
    assert.equal(mid.resultsReveal.stage, "final");
    const snap = snapshotAtElapsed(mid.resultsReveal.final, mid.resultsReveal.final.elapsedMs, mid.resultsReveal.final.durationMs);
    assert.ok(snap);
    assert.equal(room.resume("Priya").ok, true);
    await new Promise((r) => setTimeout(r, 40));
    const after = room.packResultsReveal().final.elapsedMs;
    assert.ok(after >= frozen, `did not resume ${frozen} -> ${after}`);
  });


  test("the live final is paced at 45s by default, never more than 60s, and ends when that clock runs out", async () => {
    const { GameRoom } = require("../server/game");
    const def = new GameRoom({ code: "AB12", hostName: "Ashutosh" });
    assert.equal(def.timers.finalMatchMs, 45000);
    assert.equal(def.finalMatchDelayMs(), 45000);
    const capped = roomWith(["Ashutosh", "Priya"], { finalMatchMs: 90_000, resultsRevealStepMs: 0, captainMs: 10 });
    fill(capped, { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    capped.phase = "captains";
    capped.finishCaptains();
    assert.equal(capped.finalMatchDelayMs(), 60000);
    assert.equal(capped.resultsReveal.finalDurationMs, 60000);

    const room = roomWith(["Ashutosh", "Priya"], { resultsRevealStepMs: 0, finalMatchMs: 250, captainMs: 10 });
    fill(room, { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    room.phase = "captains";
    room.finishCaptains();
    assert.equal(room.resultsReveal.stage, "final");
    assert.equal(room.resultsReveal.finalDurationMs, 250);
    const start = room.resultsReveal.finalStartedAt;
    assert.ok(room.resultsReveal.nextAt - start <= 250 + 20);
    await new Promise((r) => setTimeout(r, 320));
    assert.equal(room.resultsReveal.stage, "done");
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 450, `final ran ${elapsed}ms, longer than the 250ms cap`);
  });

  test("a mid-chase snapshot keeps the first-innings total, the target, and the required runs", () => {
    const room = roomWith(["Ashutosh", "Priya"], { resultsRevealStepMs: 0, finalMatchMs: 10_000, captainMs: 10 });
    fill(room, { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    room.phase = "captains";
    room.finishCaptains();
    const packed = room.packResultsReveal();
    const timeline = packed.final;
    const units = timeline.units;
    const inn1Balls = (timeline.innings[0].deliveries || []).length;
    const inn2Balls = (timeline.innings[1].deliveries || []).length;
    const midUnit = 1 + inn1Balls + 1 + Math.max(1, Math.floor(inn2Balls / 2));
    const snap = snapshotAtElapsed(timeline, (midUnit / units) * packed.final.durationMs, packed.final.durationMs);
    assert.equal(snap.phase, "live");
    assert.equal(snap.inningsIndex, 1);
    assert.ok(snap.firstInnings && snap.firstInnings.score != null);
    assert.ok(snap.target != null);
    assert.ok(snap.need != null);
    assert.equal(snap.firstInnings.complete, true);
    const end = snapshotAtElapsed(timeline, packed.final.durationMs, packed.final.durationMs);
    assert.equal(end.phase, "over");
    assert.ok(end.firstInnings && end.firstInnings.score != null);
    assert.ok(end.score != null);
  });

  test("team-sheet stats already include the final and do not change when it is shown", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan", "Neha"], { captainMs: 10, resultsRevealStepMs: 5000, finalMatchMs: 5000 });
    fill(room, { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    room.phase = "captains";
    room.finishCaptains();
    const before = room.getState("Ashutosh");
    const champName = before.tournament.positions[0].name;
    const beforeTeam = before.tournament.teams.find((t) => t.name === champName);
    const beforeRuns = (beforeTeam.squad || []).reduce((s, x) => s + ((x.stats && x.stats.runs) || 0), 0);
    const beforeMatches = (beforeTeam.squad || []).reduce((s, x) => s + ((x.stats && x.stats.matches) || 0), 0);
    room.skipResultsReveal("Ashutosh");
    const after = room.getState("Ashutosh");
    const afterTeam = after.tournament.teams.find((t) => t.name === champName);
    const afterRuns = (afterTeam.squad || []).reduce((s, x) => s + ((x.stats && x.stats.runs) || 0), 0);
    const afterMatches = (afterTeam.squad || []).reduce((s, x) => s + ((x.stats && x.stats.matches) || 0), 0);
    assert.equal(afterRuns, beforeRuns);
    assert.equal(afterMatches, beforeMatches);
    assert.ok(beforeMatches > 0);
  });
});

describe("ball-by-ball match consistency", () => {
  const { inningsFormat, matchFormatForSquadSize, publicMode } = require("../server/rules");
  const { playMatch, mulberry32 } = require("../server/simulate");

  function fillSide(name, roles, offset, mode, formPct = 100) {
    const used = new Set();
    const squad = [];
    for (const role of roles) {
      const list = players.filter((p) => p.role === role);
      let i = offset;
      while (list.length && used.has(list[i % list.length].id)) i += 1;
      const p = list[i % list.length];
      used.add(p.id);
      squad.push({ player: p, priceLakhs: 2 });
    }
    return {
      name,
      franchise: { color: "#fc0", text: "#000" },
      squad,
      captainId: squad[0].player.id,
      mode,
      boosters: [],
      formPct,
    };
  }

  function assertInningsConsistent(inn, batting, bowling, format, label) {
    assert.ok(inn, label);
    const batRuns = (batting || []).reduce((s, b) => s + (b.runs || 0), 0);
    const extras = (inn.extras && inn.extras.total) || 0;
    const bowlWkts = (bowling || []).reduce((s, b) => s + (b.wickets || 0), 0);
    const bowlBalls = (bowling || []).reduce((s, b) => s + (b.balls || 0), 0);
    const legal = (inn.deliveries || []).filter((d) => d.legal !== false).length;
    assert.equal(batRuns + extras, inn.score, `${label} batter runs + extras`);
    assert.equal(bowlWkts, inn.wickets, `${label} bowler wickets`);
    assert.equal(bowlBalls, inn.balls, `${label} bowler balls`);
    assert.equal(legal, inn.balls, `${label} legal deliveries`);
    assert.ok(inn.balls <= format.balls, `${label} balls ${inn.balls}`);
    assert.ok(inn.wickets <= format.maxWickets, `${label} wickets ${inn.wickets}`);
    assert.ok((bowling || []).length <= format.bowlerCount, `${label} too many bowlers`);
    for (const b of bowling || []) {
      assert.ok(b.balls <= format.maxBallsPerBowler, `${label} ${b.name} bowled ${b.balls}`);
    }
    let prev = null;
    let lastOver = -1;
    for (const d of inn.deliveries || []) {
      if (d.legal === false) continue;
      if (d.over !== lastOver) {
        if (!format.allowConsecutive && prev && d.bowlerId === prev) {
          assert.fail(`${label} consecutive overs by ${d.bowlerName}`);
        }
        prev = d.bowlerId;
        lastOver = d.over;
      }
    }
    if (inn.balls === format.balls) {
      assert.equal((bowling || []).length, format.bowlerCount, `${label} attack size`);
      for (const b of bowling || []) {
        assert.equal(b.balls, format.maxBallsPerBowler, `${label} ${b.name} quota`);
      }
    }
  }

  function assertMatchConsistent(match, format, label) {
    if (match.noResult) return;
    const p1 = match.performances[match.firstInnings.name];
    const p2 = match.performances[match.secondInnings.name];
    assertInningsConsistent(match.firstInnings, p1.batting, p2.bowling, format, `${label} 1st`);
    assertInningsConsistent(match.secondInnings, p2.batting, p1.bowling, format, `${label} 2nd`);
    if (match.chased) {
      assert.ok(match.secondInnings.score >= match.firstInnings.score + 1, `${label} chase score`);
    } else {
      assert.ok(match.secondInnings.score < match.firstInnings.score + 1, `${label} defend score`);
    }
  }

  test("match format is keyed on squad size, not the mode label", () => {
    const bullet = inningsFormat("bullet");
    const rapid = inningsFormat("rapid");
    const classical = inningsFormat("classical");
    assert.equal(bullet.overs, 2);
    assert.equal(bullet.bowlerCount, 1);
    assert.equal(bullet.oversPerBowler, 2);
    assert.equal(bullet.allowConsecutive, true);
    assert.equal(bullet.maxWickets, 2);
    assert.equal(rapid.overs, 10);
    assert.equal(rapid.bowlerCount, 2);
    assert.equal(rapid.oversPerBowler, 5);
    assert.equal(rapid.allowConsecutive, false);
    assert.equal(rapid.maxWickets, 4);
    assert.equal(classical.overs, 20);
    assert.equal(classical.bowlerCount, 5);
    assert.equal(classical.oversPerBowler, 4);
    assert.equal(classical.allowConsecutive, false);
    assert.equal(classical.maxWickets, 10);
    assert.equal(matchFormatForSquadSize(3).overs, bullet.overs);
    assert.equal(matchFormatForSquadSize(5).bowlerCount, 2);
    assert.equal(matchFormatForSquadSize(11).overs, 20);
    assert.equal(matchFormatForSquadSize(4).overs, 8);
    assert.equal(matchFormatForSquadSize(4).bowlerCount, 2);
    assert.equal(matchFormatForSquadSize(2).overs, 2);
    assert.equal(matchFormatForSquadSize(2).allowConsecutive, true);
    assert.equal(matchFormatForSquadSize(6).overs, 12);
    assert.equal(matchFormatForSquadSize(8).overs, 16);
    assert.equal(publicMode("bullet").overs, 2);
  });

  const CASES = [
    ["bullet", 3, ["BAT", "WK", "BOWL"]],
    ["rapid", 5, ["BAT", "BAT", "WK", "BOWL", "BOWL"]],
    ["classical", 11, ["BAT", "BAT", "BAT", "BAT", "WK", "AR", "AR", "BOWL", "BOWL", "BOWL", "BOWL"]],
  ];

  for (const [mode, size, roles] of CASES) {
    test(`${size}-player (${mode}) league, playoffs and Final stay consistent with the simulated balls`, async () => {
      const format = inningsFormat(mode);
      const seeds = [3, 11, 21, 44, 77, 101, 202, 404, 512, 777, 1009, 2026];
      let matches = 0;
      for (const seed of seeds) {
        await new Promise((r) => setImmediate(r));
        const teams = [0, 3, 6, 9].map((off, i) => fillSide(["Ashutosh", "Priya", "Rohan", "Neha"][i], roles, off + seed, mode));
        for (const t of teams) assert.equal(t.squad.length, size, t.name);
        const result = simulateTournament(teams, seed, { mode });
        const all = [...(result.leagueMatches || []), ...((result.playoffs && result.playoffs.matches) || [])];
        assert.ok(all.length >= 6, `seed ${seed} fixtures`);
        for (const m of all) {
          assertMatchConsistent(m, format, `${mode} seed ${seed} ${m.label} ${m.id}`);
          matches += 1;
        }
        const finale = findFinalMatch(result);
        assert.ok(finale, `seed ${seed} final`);
        assert.equal(finale.winnerName, result.champion && result.champion.name, `seed ${seed} champion`);
        const tl = buildFinalTimeline(finale);
        assert.equal(tl.winnerName, finale.winnerName);
        assert.equal(tl.innings[0].deliveries.length, finale.firstInnings.deliveries.length);
        assert.equal(tl.innings[1].deliveries.length, finale.secondInnings.deliveries.length);
        assert.deepEqual(
          tl.innings[0].deliveries.map((d) => [d.runs, d.wicket, d.batterId, d.bowlerId, d.legal]),
          finale.firstInnings.deliveries.map((d) => [d.runs, d.wicket, d.batterId, d.bowlerId, d.legal !== false])
        );
        const end = snapshotAtElapsed(tl, tl.units, 0);
        assert.equal(end.score, finale.secondInnings.score);
        assert.equal(end.wickets, finale.secondInnings.wickets);
        const firstTeam = result.playerStats[finale.firstInnings.name] || [];
        // Stats include the whole tournament, not just the final; just check they exist.
        assert.ok(firstTeam.some((row) => row.runs > 0 || row.wickets > 0 || row.ballsBowled > 0));
      }
      assert.ok(matches >= seeds.length * 7, `only ${matches} matches checked`);
    });
  }

  test("the same seed still yields a deterministic ball-by-ball final", () => {
    const roles = ["BAT", "WK", "BOWL"];
    function play(seed) {
      const teams = [0, 2, 4, 6].map((off, i) => fillSide(["A", "B", "C", "D"][i], roles, off, "bullet"));
      return simulateTournament(teams, seed, { mode: "bullet" });
    }
    const a = play(88);
    const b = play(88);
    assert.deepEqual(findFinalMatch(b).firstInnings.deliveries, findFinalMatch(a).firstInnings.deliveries);
    assert.equal(b.champion.name, a.champion.name);
  });
});

describe("share results card", () => {
  const share = require("../public/share-results");

  test("formats current form and reserves room for the champion and standings", () => {
    assert.match(share.formText({ formPct: 104 }), /Current form 104%/);
    const sized = share.layout({
      positions: [
        { name: "Ashutosh", position: 1, title: "Champion" },
        { name: "Priya", position: 2 },
        { name: "Rohan", position: 3 },
      ],
      champion: { name: "Ashutosh" },
    });
    assert.ok(sized.height >= 900);
    assert.deepEqual(sized.listed.map((p) => p.position), [2, 3]);
  });

  test("omits the champion from the standings list and keeps the remaining positions", () => {
    const listed = share.listPositions({
      champion: { name: "Ashutosh", position: 1 },
      positions: [
        { name: "Ashutosh", position: 1, title: "Champion" },
        { name: "Priya", position: 2 },
        { name: "Rohan", position: 3 },
        { name: "Neha", position: 4 },
      ],
    });
    assert.deepEqual(listed.map((p) => p.name), ["Priya", "Rohan", "Neha"]);
    assert.deepEqual(listed.map((p) => p.position), [2, 3, 4]);
    assert.equal(listed.some((p) => p.position === 1), false);
  });
});
