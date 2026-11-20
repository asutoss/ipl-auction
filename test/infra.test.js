const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { loadPlayers } = require("../server/players");
const { GameRoom } = require("../server/game");
const { RoomManager, makeRoomCode, ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET } = require("../server/manager");
const { applyDelta, bidChoices, canAffordAmount } = require("../public/state");

class FakeClock {
  constructor(start = 1_000_000) {
    this.t = start;
    this.timers = [];
    this.nextId = 1;
  }
  now = () => this.t;
  setTimeout = (fn, ms) => {
    const rec = { id: this.nextId++, fn, when: this.t + ms, cleared: false };
    this.timers.push(rec);
    return rec.id;
  };
  clearTimeout = (id) => {
    const rec = this.timers.find((x) => x.id === id);
    if (rec) rec.cleared = true;
  };
  advance(ms) {
    this.t += ms;
    const due = this.timers.filter((x) => !x.cleared && x.when <= this.t);
    this.timers = this.timers.filter((x) => !due.includes(x) && !x.cleared);
    for (const rec of due) rec.fn();
  }
}

function dummyRoom(code, { connected = true, phase = "lobby" } = {}) {
  return {
    code,
    phase,
    finishedAt: null,
    allDisconnectedAt: null,
    franchises: [
      { name: "A", connected },
      { name: "B", connected },
    ],
    destroyed: false,
    destroy() {
      this.destroyed = true;
    },
  };
}

describe("player pool sufficiency", () => {
  test("has enough players for 10 teams of 4/1/2/4 with margin", () => {
    const { players, meta } = loadPlayers();
    const byRole = {};
    const ids = new Set();
    for (const p of players) {
      byRole[p.role] = (byRole[p.role] || 0) + 1;
      assert.equal(ids.has(p.id), false, `duplicate id ${p.id}`);
      ids.add(p.id);
    }
    assert.ok(players.length >= 160, players.length);
    assert.ok(byRole.BAT >= 60, `BAT ${byRole.BAT}`);
    assert.ok(byRole.WK >= 15, `WK ${byRole.WK}`);
    assert.ok(byRole.AR >= 30, `AR ${byRole.AR}`);
    assert.ok(byRole.BOWL >= 55, `BOWL ${byRole.BOWL}`);
    assert.ok(String(meta.ratingsNote || "").toLowerCase().includes("estimate"));
  });
});

describe("room codes", () => {
  test("are 6 characters from the unambiguous alphabet and unique", () => {
    const existing = new Set();
    for (let i = 0; i < 2000; i++) {
      const code = makeRoomCode(existing);
      assert.equal(code.length, ROOM_CODE_LENGTH);
      assert.equal(ROOM_CODE_LENGTH, 6);
      for (const ch of code) assert.ok(ROOM_CODE_ALPHABET.includes(ch), ch);
      assert.equal(existing.has(code), false);
      existing.add(code);
    }
  });
});

describe("room cap and rate limit", () => {
  test("rejects a new room when at MAX_ROOMS capacity", () => {
    const clock = new FakeClock();
    const mgr = new RoomManager({ maxRooms: 2, clock });
    mgr.add(dummyRoom("AAAAAA"));
    mgr.add(dummyRoom("BBBBBB"));
    assert.equal(mgr.canAcceptRoom(), false);
    assert.equal(mgr.count(), 2);
    assert.match(mgr.roomCapError().error, /capacity/i);
    assert.match(mgr.roomCapError().error, /2/);
  });

  test("rate-limits room creation to 3 per 10 minutes per key", () => {
    const clock = new FakeClock();
    const mgr = new RoomManager({ createLimit: 3, createWindowMs: 10 * 60 * 1000, clock });
    assert.equal(mgr.allowCreate(["ip-1", "sock-a"]).ok, true);
    assert.equal(mgr.allowCreate(["ip-1", "sock-b"]).ok, true);
    assert.equal(mgr.allowCreate(["ip-1", "sock-c"]).ok, true);
    const fourth = mgr.allowCreate(["ip-1", "sock-d"]);
    assert.equal(fourth.ok, false);
    assert.match(fourth.error, /too quickly/i);
    // A different IP can still create, but the same IP cannot.
    clock.advance(10 * 60 * 1000);
    assert.equal(mgr.allowCreate(["ip-1", "sock-e"]).ok, true);
  });
});

describe("eviction", () => {
  test("evicts any room 10 minutes after all players disconnect, and clears it", () => {
    const clock = new FakeClock();
    const mgr = new RoomManager({ idleTtlMs: 10 * 60 * 1000, finishedTtlMs: 30 * 60 * 1000, clock });
    const room = dummyRoom("IDLE01", { connected: false, phase: "auction" });
    mgr.add(room);
    mgr.onAllDisconnected(room);
    clock.advance(9 * 60 * 1000);
    assert.equal(mgr.get("IDLE01") != null, true);
    clock.advance(60 * 1000);
    assert.equal(mgr.get("IDLE01"), null);
    assert.equal(room.destroyed, true);
  });

  test("cancels idle eviction when a player reconnects", () => {
    const clock = new FakeClock();
    const mgr = new RoomManager({ idleTtlMs: 10 * 60 * 1000, clock });
    const room = dummyRoom("BACK01", { connected: false, phase: "auction" });
    mgr.add(room);
    mgr.onAllDisconnected(room);
    clock.advance(5 * 60 * 1000);
    room.franchises[0].connected = true;
    mgr.onPlayerConnected(room);
    clock.advance(15 * 60 * 1000);
    assert.equal(mgr.get("BACK01") != null, true);
    assert.equal(room.destroyed, false);
  });

  test("evicts a finished room 30 minutes after results if someone stays connected", () => {
    const clock = new FakeClock();
    const mgr = new RoomManager({ idleTtlMs: 10 * 60 * 1000, finishedTtlMs: 30 * 60 * 1000, clock });
    const room = dummyRoom("DONE01", { connected: true, phase: "results" });
    mgr.add(room);
    room.phase = "results";
    mgr.onResults(room);
    clock.advance(29 * 60 * 1000);
    assert.equal(mgr.get("DONE01") != null, true);
    clock.advance(60 * 1000);
    assert.equal(mgr.get("DONE01"), null);
    assert.equal(room.destroyed, true);
  });

  test("evicts a finished room 10 minutes after everyone disconnects (idle wins)", () => {
    const clock = new FakeClock();
    const mgr = new RoomManager({ idleTtlMs: 10 * 60 * 1000, finishedTtlMs: 30 * 60 * 1000, clock });
    const room = dummyRoom("DONE02", { connected: true, phase: "results" });
    mgr.add(room);
    mgr.onResults(room);
    room.franchises.forEach((f) => (f.connected = false));
    mgr.onAllDisconnected(room);
    clock.advance(10 * 60 * 1000);
    assert.equal(mgr.get("DONE02"), null);
    assert.equal(room.destroyed, true);
  });
});

describe("delta events and lite results", () => {
  test("bid and opt-out emit compact deltas, not full snapshots, and sales include purse updates", () => {
    const { players, meta } = loadPlayers();
    const room = new GameRoom({
      code: "DELTA1",
      purseLakhs: 100,
      timers: { lotStartMs: 15_000, bidMs: 60_000, captainMs: 60_000 },
      allPlayers: players,
      meta,
    });
    room.addPlayer("Ashutosh", "s1");
    room.addPlayer("Priya", "s2");
    const events = [];
    room.on("snapshot", (reason) => events.push({ kind: "snapshot", reason }));
    room.on("delta", (evt) => events.push({ kind: "delta", type: evt.type, evt }));

    const bats = players.filter((p) => p.role === "BAT");
    room.queue = [bats[0], bats[1], bats[2]];
    room.phase = "auction";
    room.nominateNext();

    const start = events.filter((e) => e.kind === "delta" && e.type === "lotStart");
    assert.ok(start.length >= 1, "lot start delta");
    assert.ok(start[0].evt.nominee);
    assert.ok(start[0].evt.defaultBidderName || start[0].evt.currentBidderName);
    assert.ok(Array.isArray(start[0].evt.stillIn));
    assert.equal(start[0].evt.soldLog, undefined);

    const snapshotsBefore = events.filter((e) => e.kind === "snapshot").length;
    const lead = room.auction.currentBidderKey === "ashutosh" ? "Priya" : "Ashutosh";
    const bidAmt = start[0].evt.minBidLakhs;
    const bidRes = room.bid(lead, bidAmt);
    assert.equal(bidRes.ok, true);
    const bidEvt = events.filter((e) => e.type === "bid").pop();
    assert.ok(bidEvt, "bid delta");
    assert.equal(bidEvt.evt.amountLakhs || bidEvt.evt.currentBidLakhs, bidAmt);
    assert.ok(bidEvt.evt.endsAt);
    assert.ok(!events.some((e) => e.kind === "snapshot" && events.indexOf(e) > events.indexOf(bidEvt) - 5 && e.kind === "snapshot" && e !== events[0]));
    assert.equal(events.filter((e) => e.kind === "snapshot").length, snapshotsBefore);

    const other = lead === "Priya" ? "Priya" : "Ashutosh";
    // The leader cannot opt out; the remaining still-in team can.
    const opener = room.auction.currentBidderKey === "ashutosh" ? "Priya" : "Ashutosh";
    // Already used lead as the bidder. Opt out is the same person if only two and one is leading? 
    // After Priya bids, Ashutosh (if he was default) can opt out? If Priya bid, Ashutosh can opt out which sells to Priya.
    const follower = room.auction.currentBidderKey === "ashutosh" ? "Priya" : "Ashutosh";
    const out = room.optOut(follower);
    assert.equal(out.ok, true);
    const sale = events.filter((e) => e.type === "sold").pop();
    assert.ok(sale, "sale delta");
    assert.ok(sale.evt.player);
    assert.ok(sale.evt.buyerName);
    assert.equal(typeof sale.evt.priceLakhs, "number");
    assert.equal(typeof sale.evt.purseLakhs, "number");
    assert.equal(events.filter((e) => e.kind === "snapshot").length, snapshotsBefore);

    const lite = room.getState("Ashutosh");
    // Mid-auction lite state may include soldLog (snapshot shape) but sale deltas do not.
    assert.equal(sale.evt.soldLog, undefined);
    assert.equal(sale.evt.franchises, undefined);
    assert.equal(sale.evt.tournament, undefined);
  });

  test("results snapshot omits match details; getMatches returns them on demand", () => {
    const { players, meta } = loadPlayers();
    const room = new GameRoom({
      code: "RES001",
      purseLakhs: 100,
      timers: { lotStartMs: 50, bidMs: 50, captainMs: 50 },
      allPlayers: players,
      meta,
    });
    room.addPlayer("Ashutosh", "s1");
    room.addPlayer("Priya", "s2");
    // Build two complete-enough squads and simulate.
    const cheap = [...players];
    for (const [name, start] of [["Ashutosh", 0], ["Priya", 40]]) {
      const team = room.findByName(name);
      for (let i = 0; i < 11; i++) {
        const p = cheap[start + i];
        team.squad.push({ player: p, priceLakhs: 20 });
        room.soldIds.add(p.id);
      }
      team.captainId = team.squad[0].player.id;
    }
    const snaps = [];
    room.on("snapshot", (reason) => snaps.push(reason));
    room.phase = "captains";
    room.finishCaptains();
    assert.ok(snaps.includes("results"));
    const lite = room.getState("Ashutosh");
    assert.equal(lite.phase, "results");
    assert.ok(lite.tournament.table);
    assert.ok(lite.tournament.positions);
    assert.ok(lite.tournament.awards);
    assert.equal(lite.tournament.leagueMatches, undefined);
    assert.equal(lite.tournament.playoffs.matches, undefined);
    const matches = room.getMatches();
    assert.ok(matches.leagueMatches.length >= 1);
    assert.ok(Array.isArray(matches.playoffMatches));
    assert.ok(Array.isArray(matches.teams));
    assert.ok(matches.teams[0].squad.length >= 11);
    assert.ok(matches.teams[0].squad[0].stats);
    assert.ok(Array.isArray(matches.moments));

    // Client applies nothing from lite; fetching fills matches.
    const merged = { ...lite, tournament: { ...lite.tournament, leagueMatches: matches.leagueMatches, playoffs: { ...lite.tournament.playoffs, matches: matches.playoffMatches } } };
    assert.ok(merged.tournament.leagueMatches[0].resultText);
  });

  test("applyDelta keeps client auction and squad in sync", () => {
    const state = {
      phase: "auction",
      you: { name: "Ashutosh", purseLakhs: 100, squad: [], roleCounts: { BAT: 0, WK: 0, AR: 0, BOWL: 0 }, remainingQuota: { BAT: 4, WK: 1, AR: 2, BOWL: 4 } },
      franchises: [
        { name: "Ashutosh", purseLakhs: 100, squad: [], franchise: { short: "CSK", color: "#fc0" } },
        { name: "Priya", purseLakhs: 100, squad: [], franchise: { short: "MI", color: "#00f" } },
      ],
      quotas: { BAT: 4, WK: 1, AR: 2, BOWL: 4 },
      squadSize: 11,
      soldLog: [],
    };
    const player = { id: "virat-kohli", name: "Virat Kohli", role: "BAT", overseas: false, batting: 93, bowling: 12 };
    applyDelta(state, {
      type: "lotStart",
      nominee: player,
      currentBidLakhs: 200,
      currentBidderName: "Ashutosh",
      currentBidderShort: "CSK",
      hasBidder: true,
      minBidLakhs: 220,
      incrementLakhs: 20,
      stillIn: [
        { name: "Ashutosh", short: "CSK", isLeader: true },
        { name: "Priya", short: "MI", isLeader: false },
      ],
      endsAt: Date.now() + 10000,
    });
    assert.equal(state.auction.nominee.id, "virat-kohli");
    assert.equal(state.auction.youCanBid, false);
    applyDelta(state, {
      type: "sold",
      player,
      buyerName: "Ashutosh",
      short: "CSK",
      priceLakhs: 200,
      purseLakhs: 9800,
    });
    assert.equal(state.you.squad.length, 1);
    assert.equal(state.you.purseLakhs, 9800);
    assert.equal(state.you.roleCounts.BAT, 1);
    assert.equal(state.auction, null);
  });
});

describe("bid button amounts", () => {
  function stateFor(overrides = {}) {
    return {
      paused: Boolean(overrides.paused),
      you: {
        name: "Priya",
        purseLakhs: 100,
        squad: [],
        complete: false,
        eliminated: false,
        remainingQuota: { BAT: 4, WK: 1, AR: 2, BOWL: 4 },
        ...(overrides.you || {}),
      },
      auction: overrides.auction === null ? null : {
        nominee: { id: "virat-kohli", name: "Virat Kohli", role: "BAT" },
        currentBidLakhs: 5,
        bidSteps: [1, 2, 5],
        youCanBid: true,
        youCanOptOut: true,
        youReason: null,
        ...(overrides.auction || {}),
      },
    };
  }

  test("labels are the absolute bid amounts, not +1/+2/+5", () => {
    const choices = bidChoices(stateFor());
    assert.deepEqual(choices.options.map((o) => o.amount), [6, 7, 10]);
    assert.deepEqual(choices.options.map((o) => o.label), ["6 pts", "7 pts", "10 pts"]);
    assert.equal(choices.options.every((o) => o.show && o.enabled), true);
    assert.equal(choices.canOptOut, true);
  });

  test("hides amounts that would break the 1-point reserve, and updates when the bid rises", () => {
    const state = stateFor({ you: { purseLakhs: 17 } });
    // After buying a BAT, 10 role slots remain, so reserve is 10. 17-6 and 17-7 leave enough; 17-10 does not.
    assert.equal(canAffordAmount(state.you, state.auction, 6), true);
    assert.equal(canAffordAmount(state.you, state.auction, 7), true);
    assert.equal(canAffordAmount(state.you, state.auction, 10), false);
    let choices = bidChoices(state);
    assert.deepEqual(choices.options.filter((o) => o.show).map((o) => o.amount), [6, 7]);

    state.auction.currentBidLakhs = 8;
    choices = bidChoices(state);
    assert.deepEqual(choices.options.map((o) => o.amount), [9, 10, 13]);
    assert.deepEqual(choices.options.filter((o) => o.show).map((o) => o.amount), []);
  });

  test("hides bid amounts when the team cannot bid, and disables them while paused", () => {
    const leading = bidChoices(stateFor({
      auction: { currentBidLakhs: 5, youCanBid: false, youCanOptOut: false, youReason: "You have the leading bid." },
    }));
    assert.equal(leading.options.every((o) => o.show === false), true);
    assert.equal(leading.canOptOut, false);

    const done = bidChoices(stateFor({
      you: { complete: true, remainingQuota: { BAT: 0, WK: 0, AR: 0, BOWL: 0 } },
    }));
    assert.equal(done.options.every((o) => o.show === false), true);

    const paused = bidChoices(stateFor({ paused: true }));
    assert.equal(paused.options.every((o) => o.show && !o.enabled), true);
    assert.equal(paused.canOptOut, false);
  });
});
