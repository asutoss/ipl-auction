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

function roomWith(names, timers) {
  const room = new GameRoom({
    code: "TEST",
    purseLakhs: 100,
    timers: { lotStartMs: 15_000, bidMs: 15_000, captainMs: 45_000, soldRevealMs: 0, ...(timers || {}) },
    allPlayers: players,
    meta,
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
  test("startAuction shuffles the full pool instead of grouping by base or rating", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    const top = [...players].sort((a, b) => overallRating(b) - overallRating(a)).slice(0, 8).map((p) => p.id);
    const firsts = new Set();
    for (let i = 0; i < 12; i++) {
      const r = roomWith(["Ashutosh", "Priya"]);
      const started = r.startAuction("Ashutosh");
      assert.equal(started.ok, true);
      assert.equal(r.queue.length + 1, players.length); // nominee already taken from queue
      firsts.add(r.auction.nominee.id);
    }
    assert.ok(firsts.size >= 3, `expected mixed openers, got ${[...firsts].join(", ")}`);
    // Across runs it should not always be a top-rated star.
    assert.ok([...firsts].some((id) => !top.includes(id)) || firsts.size >= 6);
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
    const keys = ["BID_TIMER_MS", "LOT_START_MS", "SOLD_REVEAL_MS", "CAPTAIN_TIMER_MS"];
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


describe("team identities", () => {
  test("assigns unique logos on join and rejects a taken logo", () => {
    const room = roomWith(["Ashutosh", "Priya", "Rohan"]);
    const ids = room.franchises.map((f) => f.franchise.id);
    assert.equal(new Set(ids).size, 3);
    for (const id of ids) assert.ok(id);
    const taken = ids[0];
    const fail = room.selectIdentity("Priya", taken);
    assert.equal(fail.ok, false);
    const { unusedIdentities } = require("../public/identities");
    const free = unusedIdentities(new Set(ids))[0];
    const ok = room.selectIdentity("Priya", free.id);
    assert.equal(ok.ok, true);
    assert.equal(room.findByName("Priya").franchise.id, free.id);
    assert.notEqual(room.findByName("Ashutosh").franchise.id, room.findByName("Priya").franchise.id);
  });

  test("auto-assigns unique logos for anyone who has not picked before start", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    room.findByName("Priya").franchise = { id: "unknown" };
    room.startAuction("Ashutosh");
    const ids = room.franchises.map((f) => f.franchise.id);
    assert.equal(new Set(ids).size, 2);
    const { getIdentity } = require("../public/identities");
    for (const id of ids) assert.ok(getIdentity(id));
  });

  test("keeps logos that were picked in the lobby", () => {
    const room = roomWith(["Ashutosh", "Priya"]);
    const { unusedIdentities } = require("../public/identities");
    const free = unusedIdentities(room.franchises.map((f) => f.franchise.id))[0];
    assert.equal(room.selectIdentity("Priya", free.id).ok, true);
    const ash = room.findByName("Ashutosh").franchise.id;
    room.startAuction("Ashutosh");
    assert.equal(room.findByName("Ashutosh").franchise.id, ash);
    assert.equal(room.findByName("Priya").franchise.id, free.id);
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


describe("team names and logo catalog", () => {
  test("catalog has 20 logos with unique colours and no food-theme team names", () => {
    const fs = require("fs");
    const path = require("path");
    const { IDENTITIES, logoUrl, logoImg } = require("../public/identities");
    assert.equal(IDENTITIES.length, 20);
    const ids = IDENTITIES.map((t) => t.id);
    const characters = IDENTITIES.map((t) => t.character);
    const colors = IDENTITIES.map((t) => t.color.toLowerCase());
    assert.equal(new Set(ids).size, 20);
    assert.equal(new Set(characters).size, 20);
    assert.equal(new Set(colors).size, 20);
    const logoDir = path.join(__dirname, "../public/logos");
    let total = 0;
    for (const t of IDENTITIES) {
      assert.ok(t.character && t.character.length > 1, t.id);
      assert.match(t.color, /^#[0-9A-Fa-f]{6}$/);
      assert.match(t.color2, /^#[0-9A-Fa-f]{6}$/);
      assert.match(t.text, /^#[0-9A-Fa-f]{6}$/);
      assert.equal(logoUrl(t.id), `/logos/${t.id}.webp`);
      const img = logoImg(t.id);
      assert.match(img, /<img /);
      assert.match(img, new RegExp(`alt="${t.character}"`));
      const file = path.join(logoDir, `${t.id}.webp`);
      assert.ok(fs.existsSync(file), file);
      total += fs.statSync(file).size;
      assert.doesNotMatch(t.character, /chargers|sloths|punchers|rockets|smashers|mavericks|blasters|jaguars|jammers|dynamos|lions|vikings/i);
    }
    assert.ok(total < 600 * 1024, `logo payload ${total} bytes`);
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
        assert.ok(dist(colors[i], colors[j]) >= 28, `${IDENTITIES[i].character} vs ${IDENTITIES[j].character} too close`);
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
