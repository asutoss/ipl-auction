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
} = require("../server/rules");
const { GameRoom } = require("../server/game");
const { simulateTournament, teamStrength } = require("../server/simulate");

const { meta, players } = loadPlayers();

function roomWith(names, timers, opts = {}) {
  const mode = opts.mode || "classical";
  const { getMode } = require("../server/rules");
  const purse = opts.purseLakhs != null ? opts.purseLakhs : (opts.mode ? getMode(mode).purse : 100);
  const room = new GameRoom({
    code: "TEST",
    purseLakhs: purse,
    mode,
    timers: { lotStartMs: 15_000, bidMs: 15_000, captainMs: 45_000, soldRevealMs: 0, ...(timers || {}) },
    allPlayers: players,
    meta,
    seed: opts.seed,
    rng: opts.rng,
  });
  names.forEach((n, i) => room.addPlayer(n, `sock-${i}`));
  room.forcedStartBid = 2; // keep existing tests stable; start-bid range is tested separately
  return room;
}

function takeForQuota(room, need) {
  const picked = [];
  const left = { ...need };
  for (const p of players) {
    if ((left[p.role] || 0) > 0 && !room.soldIds.has(p.id)) {
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
    assert.ok(players.length >= 160, `got ${players.length}`);
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

  test("default bid still goes to a team whose role quota is full; others may bid, that team cannot bid again while leading", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"]);
    const wks = players.filter((p) => p.role === "WK");
    room.findByName("Ashutosh").squad.push({ player: wks[0], priceLakhs: 2 });
    room.findByName("Ashutosh").purseLakhs -= 2;
    room.soldIds.add(wks[0].id);
    room.queue = [wks[1], players.find((p) => p.id === "karun-nair")];
    room.phase = "auction";
    room.nominateNext();
    // Default bid never skips a full quota — Ashutosh gets it.
    assert.equal(room.auction.currentBidderKey, "ashutosh");
    assert.equal(room.auction.nominee.id, wks[1].id);
    const names = room.stillInTeams().map((f) => f.name).sort();
    assert.deepEqual(names, ["Ashutosh", "Priya", "Rohan"]);
    const state = room.getState("Ashutosh");
    assert.equal(state.auction.youCanBid, false);
    assert.match(state.auction.youReason, /leading bid/i);
    // Voluntary bid from Priya is allowed (her WK quota is open).
    assert.equal(room.getState("Priya").auction.youCanBid, true);
    room.optOut("Priya");
    room.optOut("Rohan");
    const squad = room.findByName("Ashutosh").squad;
    assert.equal(squad.length, 2);
    assert.equal(squad.filter((s) => s.player.role === "WK").length, 2);
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

  test("default bid is given even when that team's role quota is already full", () => {
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
    room.rrIndex = 0; // Ashutosh's turn
    room.nominateNext();
    assert.equal(room.auction.nominee.id, nextBat.id);
    assert.equal(room.auction.currentBidderKey, "ashutosh");
    room.optOut("Priya");
    room.optOut("Rohan");
    assert.equal(a.squad.filter((s) => s.player.role === "BAT").length, 5);
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
    room.nominateNext();
    // Both teams already have their WK, so the extra keeper is skipped and a batter comes up.
    assert.equal(room.auction.nominee.id, bat.id);
    assert.ok(!room.findByName("Ashutosh").squad.some((s) => s.player.id === leftover.id));
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
    assert.ok(events.some((e) => e.type === "sold" && e.buyerName === "Ashutosh" && e.player.id === nextBat.id));
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

  test("default bid still lands on a team whose role is full if their squad is not complete", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    giveSquad(room, "Ashutosh", { BAT: 4, WK: 0, AR: 2, BOWL: 4 });
    const nextBat = players.find((p) => p.role === "BAT" && !room.soldIds.has(p.id));
    room.queue = [nextBat];
    room.phase = "auction";
    room.rrIndex = 0;
    room.nominateNext();
    // Priya still needs BAT, so this batter is nominated; Ashutosh is default even with 4 BAT.
    assert.equal(room.auction.nominee.id, nextBat.id);
    assert.equal(room.auction.currentBidderKey, "ashutosh");
    assert.equal(room.optOut("Priya").ok, true);
    assert.equal(room.findByName("Ashutosh").squad.filter((s) => s.player.role === "BAT").length, 5);
    assert.equal(isSquadComplete(room.findByName("Ashutosh").squad), false);
    assert.equal(room.phase, "auction");
  });

  test("re-nominates leftover needed-role players when the queue runs out before every team is full", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    giveSquad(room, "Priya", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
    giveSquad(room, "Ashutosh", { BAT: 4, WK: 0, AR: 2, BOWL: 4 });
    const wk = players.find((p) => p.role === "WK" && !room.soldIds.has(p.id));
    // Queue is empty; the leftover keeper is only in unsold / the pool.
    room.queue = [];
    room.unsold = [wk];
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

  test("a new lot gets 15 seconds and a bid also resets the timer to 15", () => {
    const room = roomWith(["Ashutosh", "Priya"], { lotStartMs: 15_000, bidMs: 15_000, captainMs: 45_000 });
    room.queue = [players.find((p) => p.id === "virat-kohli")];
    room.phase = "auction";
    const t0 = Date.now();
    room.nominateNext();
    const openLeft = room.auction.endsAt - t0;
    assert.ok(openLeft > 14000 && openLeft <= 15100, `lot start ${openLeft}`);
    const lead = room.auction.currentBidderKey === "ashutosh" ? "Priya" : "Ashutosh";
    const t1 = Date.now();
    assert.equal(room.bid(lead, room.auction.currentBidLakhs + 1).ok, true);
    const bidLeft = room.auction.endsAt - t1;
    assert.ok(bidLeft > 14000 && bidLeft <= 15100, `bid reset ${bidLeft}`);
  });

  test("default timers are 15s for lots and bids, and 5s for the sold reveal", () => {
    const keys = ["BID_TIMER_MS", "LOT_START_MS", "SOLD_REVEAL_MS", "CAPTAIN_TIMER_MS", "POWER_REVEAL_MS"];
    const prev = {};
    for (const k of keys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    try {
      const room = new GameRoom({ code: "DEF", purseLakhs: 100, allPlayers: players, meta });
      assert.equal(room.timers.lotStartMs, 15000);
      assert.equal(room.timers.bidMs, 15000);
      assert.equal(room.timers.soldRevealMs, 5000);
      assert.equal(room.timers.captainMs, 45000);
      assert.equal(room.timers.powerRevealMs, 2000);
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
      assert.ok(b.pricePoints >= 15 && b.pricePoints <= 40, b.id);
      assert.ok(b.name && b.blurb);
    }
    const room = primedRoom();
    room.beginCaptainPhase();
    assert.equal(room.phase, "captains");
    assert.ok(room.captainEndsAt - Date.now() > 40000);
    const cheer = getBooster("cheerleaders");
    assert.equal(room.buyBooster("Ashutosh", cheer.id).ok, true);
    assert.equal(room.findByName("Ashutosh").purseLakhs, 40 - cheer.pricePoints);
    assert.equal(room.buyBooster("Ashutosh", cheer.id).ok, false);
    room.findByName("Priya").purseLakhs = 10;
    assert.equal(room.buyBooster("Priya", "bus-breakdown").ok, false);
  });

  test("boosters appear in results and can create moments, including rain no-results", () => {
    const room = primedRoom();
    room.findByName("Ashutosh").boosters = [
      { id: "rain-dance", name: "Rain Dance", pricePoints: 28 },
      { id: "lucky-toss", name: "Lucky Toss Coin", pricePoints: 16 },
    ];
    room.findByName("Priya").boosters = [{ id: "cheerleaders", name: "Cheerleader Squad", pricePoints: 15 }];
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
  test("catalog has 20 characters with unique colours, images, meme names, placeholder emotes, and a power", () => {
    const fs = require("fs");
    const path = require("path");
    const { CHARACTERS, IDENTITIES, imageUrl, logoUrl, characterImg, logoImg } = require("../public/characters");
    const catalogPath = path.join(__dirname, "../data/characters.json");
    const fromFile = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    assert.equal(CHARACTERS.length, 20);
    assert.equal(IDENTITIES.length, 20);
    assert.equal(fromFile.length, 20);
    assert.deepEqual(CHARACTERS.map((t) => t.id), fromFile.map((t) => t.id));
    const ids = CHARACTERS.map((t) => t.id);
    const characters = CHARACTERS.map((t) => t.character);
    const colors = CHARACTERS.map((t) => t.color.toLowerCase());
    assert.equal(new Set(ids).size, 20);
    assert.equal(new Set(characters).size, 20);
    assert.equal(new Set(colors).size, 20);
    const logoDir = path.join(__dirname, "../public/logos");
    let total = 0;
    for (const t of CHARACTERS) {
      assert.ok(t.character && t.character.length > 1, t.id);
      assert.equal(t.name, t.character);
      assert.ok(t.realName && t.realName.length > 1, t.id);
      assert.notEqual(t.realName, t.name, t.id);
      const fileRow = fromFile.find((row) => row.id === t.id);
      assert.equal(t.realName, fileRow.realName);
      assert.match(t.color, /^#[0-9A-Fa-f]{6}$/);
      assert.match(t.color2, /^#[0-9A-Fa-f]{6}$/);
      assert.match(t.text, /^#[0-9A-Fa-f]{6}$/);
      assert.equal(t.image, `/logos/${t.id}.webp`);
      assert.equal(t.logo, t.image);
      assert.ok(Array.isArray(t.emotes) && t.emotes.length === 0, t.id);
      assert.ok(t.power && t.power.id === "bonus_points", t.id);
      assert.ok(t.power.name && t.power.name.length > 1, t.id);
      assert.ok(t.power.description && /10/.test(t.power.description), t.id);
      assert.equal(t.power.uses, 1);
      assert.equal(t.power.params.points, 10);
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
    assert.equal(new Set(realNames).size, 20);
    const powerNames = CHARACTERS.map((t) => t.power.name);
    assert.equal(new Set(powerNames).size, 20);
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
});

describe("character powers", () => {
  const { publicPower, applyPower, POWERS } = require("../server/powers");

  test("bonus_points applies +10 to the purse", () => {
    const team = { purseLakhs: 50 };
    const result = applyPower({}, team, { id: "bonus_points", params: { points: 10 }, uses: 1, name: "Test" });
    assert.equal(result.ok, true);
    assert.equal(result.points, 10);
    assert.equal(team.purseLakhs, 60);
    assert.ok(POWERS.bonus_points);
    const def = publicPower({ id: "bonus_points", name: "Masterstroke", description: "Adds 10.", uses: 1, params: { points: 10 } });
    assert.equal(def.uses, 1);
    assert.equal(def.params.points, 10);
  });

  test("usePower adds 10 once, then rejects a second use", () => {
    const room = roomWith(["Ashutosh", "Priya"], { powerRevealMs: 0, soldRevealMs: 0 });
    assert.equal(room.startAuction("Ashutosh").ok, true);
    const priya = room.findByName("Priya");
    const startPurse = priya.purseLakhs;
    const first = room.usePower("Priya");
    assert.equal(first.ok, true, first.error);
    assert.equal(priya.purseLakhs, startPurse + 10);
    assert.equal(priya.powerUsesLeft, 0);
    assert.equal(room.powerReveal, null);
    const snap = room.getState("Priya");
    assert.equal(snap.you.purseLakhs, startPurse + 10);
    assert.equal(snap.you.powerUsed, true);
    assert.equal(snap.you.power.uses, 1);
    assert.ok(snap.you.power.name);
    const second = room.usePower("Priya");
    assert.equal(second.ok, false);
    assert.match(second.error, /already used/i);
    assert.equal(priya.purseLakhs, startPurse + 10);
  });

  test("usePower freezes the lot timer and resumes with the remaining time after the reveal", async () => {
    const room = roomWith(["Ashutosh", "Priya"], { lotStartMs: 400, bidMs: 400, powerRevealMs: 80, soldRevealMs: 0 });
    assert.equal(room.startAuction("Ashutosh").ok, true);
    const before = Math.max(0, room.auction.endsAt - Date.now());
    const events = [];
    room.on("delta", (e) => events.push(e.type));
    const used = room.usePower("Ashutosh");
    assert.equal(used.ok, true, used.error);
    assert.ok(room.powerReveal);
    assert.equal(room.paused, false);
    const held = room.powerFreeze && room.powerFreeze.remainingMs;
    assert.ok(held <= before && held >= before - 80, `held=${held} before=${before}`);
    assert.equal(room.bid("Priya", room.auction.currentBidLakhs + 1).ok, false);
    assert.equal(room.pause("Priya").ok, false);
    const purseDuring = room.findByName("Ashutosh").purseLakhs;
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(room.powerReveal, "reveal should still be in progress");
    assert.equal(room.findByName("Ashutosh").purseLakhs, purseDuring);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(room.powerReveal, null);
    assert.equal(room.findByName("Ashutosh").purseLakhs, purseDuring + 10);
    const left = room.auction.endsAt - Date.now();
    assert.ok(left <= held + 40, `left=${left} held=${held}`);
    assert.ok(left >= held - 90, `left=${left} held=${held}`);
    assert.ok(events.includes("powerReveal"));
    assert.ok(events.includes("powerApplied"));
  });

  test("usePower is rejected when invalid", () => {
    const room = roomWith(["Ashutosh", "Priya"], { powerRevealMs: 200, soldRevealMs: 400 });
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

    // During a sold reveal there is no live lot.
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
