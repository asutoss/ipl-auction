const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { loadPlayers } = require("../server/players");
const { GameRoom } = require("../server/game");
const { CHARACTERS, characterLines, publicCharacter } = require("../public/characters");
const { POWERS, applyPower, listValidCopyPowers } = require("../server/powers");
const { applyDelta } = require("../public/state");
const { shortenPowerReason } = require("../public/power-reasons");
/** Rejoin the way a real browser does: with the team's private rejoin key. */
const keyOf = (room, name) => ({ rejoinKey: room.findByName(name).rejoinKey });

const { meta, players } = loadPlayers();

const IDS = {
  modi: "narendra-modi",
  prabhas: "prabhas",
  orry: "orry",
  dolly: "dolly-chaiwala",
  amitabh: "amitabh-bachchan",
  jay: "jay-shah",
  samay: "samay-raina",
  elvish: "elvish-yadav",
  ranveer: "ranveer-allahbadia",
  salman: "salman-khan",
  ravi: "ravi-kishan",
  rakhi: "rakhi-sawant",
  taylor: "taylor-swift",
  arnab: "arnab-goswami",
  kim: "kim-jong-un",
};

function roomWith(names, timers, opts = {}) {
  const room = new GameRoom({
    code: "PWR",
    purseLakhs: opts.purseLakhs != null ? opts.purseLakhs : 100,
    mode: opts.mode || "classical",
    timers: { lotStartMs: 15_000, bidMs: 15_000, captainMs: 90_000, soldRevealMs: 0, lastTeamFillMs: 0, playerIntroMs: 0, resultsRevealStepMs: 0, powerRevealMs: 0, formBoostRevealMs: 0, finalMatchMs: 0, autofillRevealMs: 0, ...(timers || {}) },
    allPlayers: players,
    meta,
    seed: opts.seed,
    rng: opts.rng,
  });
  names.forEach((n, i) => room.addPlayer(n, `sock-${i}`));
  room.forcedStartBid = opts.startBid != null ? opts.startBid : 2;
  return room;
}

function setChar(room, name, id) {
  const team = room.findByName(name);
  assert.ok(team, name);
  assert.ok(room.assignCharacter(team, id), `assign ${id} to ${name}`);
  return team;
}

function start(room, host = "A") {
  const res = room.startAuction(host);
  assert.equal(res.ok, true, res.error);
  assert.ok(room.auction, "expected a live lot");
  return room;
}

function givePlayer(room, teamName, player, price = 4) {
  const team = room.findByName(teamName);
  team.squad.push({ player, priceLakhs: price });
  team.spentLakhs = (Number(team.spentLakhs) || 0) + price;
  room.soldIds.add(player.id);
  room.soldLog.push({
    player,
    priceLakhs: price,
    buyerName: team.name,
    short: team.name,
    color: team.franchise && team.franchise.color,
  });
  return player;
}

function firstOfRole(role, except = new Set()) {
  return players.find((p) => p.role === role && !except.has(p.id));
}

describe("power registry", () => {
  test("every catalogue power has a unique implementation", () => {
    const ids = CHARACTERS.map((c) => c.power.id);
    assert.equal(ids.length, 15);
    assert.equal(new Set(ids).size, 15);
    for (const id of ids) {
      assert.ok(POWERS[id], `missing impl ${id}`);
      assert.equal(typeof POWERS[id].canUse, "function");
      assert.equal(typeof POWERS[id].apply, "function");
    }
    assert.equal(POWERS.bonus_points, undefined);
  });
});

describe("power confirm copy", () => {
  test("every power has the approved funny confirm description", () => {
    const EXPECTED_FUNNY = {
      "narendra-modi": "Just like the 8pm note ban in 2016, you pocket 5 points and every other team loses 5 overnight. Mitron, bas 50 din dijiye.",
      "prabhas": "Adipurush's VFX was so bad nobody could make anything out, so the next player is hidden from everyone but you.",
      "orry": "Nobody knows what Orry does, so he just copies someone else's power. Very on brand.",
      "dolly-chaiwala": "Bill Gates stopped for Dolly's chai, so the whole auction waits too, until Dolly says it's over.",
      "amitabh-bachchan": "It's KBC time. Lock it in and a coin flip either halves or doubles the price. Computer ji, toss kijiye.",
      "jay-shah": "BCCI money logic: rivals pay you 1 point for every bid they make next lot.",
      "samay-raina": "A chess streamer thinks 3 moves ahead, so you privately see the next 3 players. No guarantee you won't blunder anyway.",
      "elvish-yadav": "Elvish bhai ke aage koi bol sakta hai kya? Nobody can bid against you this lot.",
      "ranveer-allahbadia": "One question about parents and you're off every show. Pick a rival and they're banned from bidding this lot and the next.",
      "salman-khan": "Bhai has a history of hunting things that belong to someone else. Grab a rival's recent buy at the price they paid.",
      "ravi-kishan": "Zindagi jhand ba, fir bhi ghamand ba. Every team richer than you pays 5 points for its attitude.",
      "rakhi-sawant": "Her swayamvar came with conditions. Rivals pay 3 points or sit out the next lot.",
      "taylor-swift": "She swapped her ex for a football star. Swap one of your players for a rival's recent buy.",
      "arnab-goswami": "The nation wants to know! The richest other team hands you 10 points just to make the shouting stop.",
      "kim-jong-un": "The button is always on his desk. Pick a team and half its squad disappears at random.",
    };
    assert.equal(CHARACTERS.length, 15);
    assert.equal(Object.keys(EXPECTED_FUNNY).length, 15);
    for (const t of CHARACTERS) {
      assert.equal(t.power.funnyDesc, EXPECTED_FUNNY[t.id], t.id);
      assert.equal(publicCharacter(t.id).power.funnyDesc, EXPECTED_FUNNY[t.id], t.id);
    }
    const room = roomWith(["A", "B"]);
    setChar(room, "A", IDS.modi);
    setChar(room, "B", IDS.dolly);
    start(room);
    assert.equal(room.getState("A").you.power.funnyDesc, EXPECTED_FUNNY["narendra-modi"]);
    assert.equal(room.getState("B").you.power.funnyDesc, EXPECTED_FUNNY["dolly-chaiwala"]);
  });

  test("getState exposes a short one-line description on you.power", () => {
    const room = roomWith(["A", "B"]);
    setChar(room, "A", IDS.modi);
    setChar(room, "B", IDS.dolly);
    start(room);
    const you = room.getState("A").you;
    assert.equal(you.power.shortDesc, "You gain 5 points; others lose 5.");
    const dolly = room.getState("B").you;
    assert.equal(dolly.power.shortDesc, "Pause the auction until you end it.");
    assert.ok(you.power.shortDesc.trim().split(/\s+/).length <= 10);
  });

  test("usePower still works without a confirm step on the server", () => {
    const room = roomWith(["A", "B"]);
    setChar(room, "A", IDS.modi);
    setChar(room, "B", IDS.dolly);
    start(room);
    assert.equal(room.usePower("A").ok, true);
    assert.equal(room.findByName("B").purseLakhs, 95);
    assert.equal(room.findByName("A").purseLakhs, 105);
  });

  test("lotStart deltas refresh canUsePower so a confirm can open", () => {
    const room = roomWith(["A", "B"]);
    setChar(room, "A", IDS.modi);
    setChar(room, "B", IDS.dolly);
    const lobby = room.getState("A");
    assert.equal(lobby.you.canUsePower, false);
    assert.match(lobby.you.canUsePowerReason, /during the auction/i);
    start(room);
    const personalized = room.personalizeDelta({ type: "lotStart", ...room.packAuctionPublic() }, "A");
    assert.equal(personalized.youPower.canUsePower, true);
    assert.equal(personalized.lotPowerUsed, false);
    const state = JSON.parse(JSON.stringify(lobby));
    applyDelta(state, personalized);
    assert.equal(state.phase, "auction");
    assert.equal(state.you.canUsePower, true);
    assert.equal(state.lotPowerUsed, false);
    assert.equal(room.usePower("A").ok, true);
    const after = room.personalizeDelta({ type: "powerApplied", name: "A" }, "B");
    assert.equal(after.youPower.canUsePower, false);
    assert.match(after.youPower.canUsePowerReason, /already been used on this lot/i);
  });
});

describe("Modi — Demonetisation", () => {
  test("the user gains 5 points, every other live team loses 5, floored at 0, and a toast is logged", () => {
    const room = roomWith(["A", "B", "C"]);
    setChar(room, "A", IDS.modi);
    setChar(room, "B", IDS.ravi);
    setChar(room, "C", IDS.arnab);
    start(room);
    room.findByName("C").purseLakhs = 4;
    const b0 = room.findByName("B").purseLakhs;
    const a0 = room.findByName("A").purseLakhs;
    assert.equal(room.usePower("A").ok, true);
    assert.equal(room.findByName("A").purseLakhs, a0 + 5);
    assert.equal(room.findByName("B").purseLakhs, b0 - 5);
    assert.equal(room.findByName("C").purseLakhs, 0);
    assert.equal(room.findByName("C").banned, true);
    assert.equal(room.findByName("C").eliminatedReason, "match_fixing");
    const snap = room.getState("A");
    assert.match(snap.powerToast.message, /Demonetisation/i);
    assert.match(snap.powerToast.message, /gained 5/i);
    assert.match(snap.powerToast.message, /lost 5/i);
    assert.equal(snap.franchises.find((f) => f.name === "C").banned, true);
    assert.equal(snap.franchises.find((f) => f.name === "C").eliminatedReason, "Banned for match fixing");
  });

  test("does not ban a complete team that is taxed to 0 points", () => {
    const room = roomWith(["A", "B", "C"]);
    setChar(room, "A", IDS.modi);
    setChar(room, "B", IDS.ravi);
    setChar(room, "C", IDS.arnab);
    const take = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
    const left = { ...take };
    const c = room.findByName("C");
    for (const p of players) {
      if ((left[p.role] || 0) > 0) {
        c.squad.push({ player: p, priceLakhs: 2 });
        room.soldIds.add(p.id);
        left[p.role] -= 1;
      }
    }
    start(room);
    c.purseLakhs = 4;
    assert.equal(room.usePower("A").ok, true);
    assert.equal(c.purseLakhs, 0);
    assert.equal(Boolean(c.banned), false);
  });
});

describe("Prabhas — Adipurush VFX", () => {
  test("hides the next lot from everyone but Prabhas, and can be used after this lot's slot is taken", () => {
    const room = roomWith(["A", "B", "C"]);
    setChar(room, "A", IDS.modi);
    setChar(room, "B", IDS.prabhas);
    setChar(room, "C", IDS.ravi);
    start(room);
    assert.equal(room.usePower("A").ok, true);
    assert.equal(room.lotPowerUsed, true);
    assert.equal(room.usePower("C").ok, false);
    assert.match(room.usePower("C").error, /already been used on this lot/i);
    const vfx = room.usePower("B");
    assert.equal(vfx.ok, true, vfx.error);
    const current = room.auction.nominee.id;
    room.sellCurrent();
    assert.ok(room.auction);
    assert.notEqual(room.auction.nominee.id, current);
    assert.equal(room.auction.vfxHidden, true);
    assert.equal(room.lotPowerUsed, true);
    const seer = room.getState("B");
    const other = room.getState("A");
    assert.equal(seer.auction.nominee.id, room.auction.nominee.id);
    assert.equal(other.auction.nominee.vfxHidden, true);
    assert.equal(other.auction.nominee.name, "VFX loading…");
    assert.equal(other.auction.nominee.role, "???");
    assert.ok(!other.auction.nominee.batting);
    const reused = room.usePower("C");
    assert.equal(reused.ok, false);
  });

  test("teams who cannot see the hidden player can still bid on it (no '??? quota full')", () => {
    const room = roomWith(["A", "B", "C"]);
    setChar(room, "A", IDS.modi);
    setChar(room, "B", IDS.prabhas);
    setChar(room, "C", IDS.ravi);
    start(room);
    assert.equal(room.usePower("B").ok, true);
    room.sellCurrent();
    assert.equal(room.auction.vfxHidden, true);
    for (const name of ["A", "C"]) {
      const st = room.getState(name);
      if (st.auction.currentBidderName === name) continue;
      assert.equal(st.auction.nominee.role, "???");
      assert.equal(st.auction.youCanBid, true, `${name} server says ${st.auction.youReason}`);
      // The browser re-derives eligibility from its own state; it must agree.
      const client = JSON.parse(JSON.stringify(st));
      applyDelta(client, { type: "optOut", stillIn: st.auction.stillIn });
      assert.equal(client.auction.youCanBid, true, `${name} client says ${client.auction.youReason}`);
      assert.doesNotMatch(String(client.auction.youReason || ""), /\?\?\?/);
    }
  });
});

describe("Orry — What Do You Even Do?", () => {
  test("copies a forced valid power and reveals it, including pickers", () => {
    const room = roomWith(["A", "B", "C"], null, {
      rng: { random: () => 0, int: () => 0 },
    });
    setChar(room, "A", IDS.orry);
    setChar(room, "B", IDS.ravi);
    setChar(room, "C", IDS.arnab);
    start(room);
    const options = listValidCopyPowers(room, room.findByName("A"));
    assert.ok(options.length >= 1);
    const demon = options.find((o) => o.powerId === "demonetisation");
    assert.ok(demon, "demonetisation should be valid to copy");
    // Force the roll by stubbing rng.int used in usePower
    room.rng.int = (n) => {
      const idx = options.findIndex((o) => o.powerId === "demonetisation");
      return idx >= 0 ? idx : 0;
    };
    const a0 = room.findByName("A").purseLakhs;
    const b0 = room.findByName("B").purseLakhs;
    const used = room.usePower("A");
    assert.equal(used.ok, true, used.error);
    assert.equal(used.copiedPowerId, "demonetisation");
    assert.equal(room.findByName("A").purseLakhs, a0 + 5);
    assert.equal(room.findByName("B").purseLakhs, b0 - 5);
    assert.match(room.powerToast.message, /What Do You Even Do/i);
    assert.match(room.powerToast.message, /Demonetisation/i);
  });
});

describe("Dolly — Chai Break", () => {
  test("pauses until Dolly ends it; host cannot resume; table is private; disconnect auto-resumes", async () => {
    const room = roomWith(["A", "B"], { dollyDisconnectMs: 40 });
    setChar(room, "A", IDS.dolly);
    setChar(room, "B", IDS.ravi);
    start(room);
    const endsBefore = room.auction.endsAt;
    assert.equal(room.usePower("A").ok, true);
    assert.ok(room.chaiBreak);
    assert.equal(room.paused, true);
    assert.equal(room.powerWait.kind, "chai");
    const hostResume = room.resume("A");
    assert.equal(hostResume.ok, false);
    assert.match(hostResume.error, /Dolly/i);
    const dolly = room.getState("A");
    const other = room.getState("B");
    assert.ok(dolly.powerWait.table);
    assert.ok(dolly.you.chaiTable);
    assert.equal(dolly.powerWait.table.length, 2);
    assert.ok("purseLakhs" in dolly.powerWait.table[0]);
    assert.ok("missingRoles" in dolly.powerWait.table[0]);
    assert.equal(other.powerWait.table, undefined);
    assert.equal(other.you.chaiTable, undefined);
    const end = room.endChaiBreak("B");
    assert.equal(end.ok, false);
    assert.equal(room.endChaiBreak("A").ok, true);
    assert.equal(room.chaiBreak, null);
    assert.equal(room.paused, false);
    assert.ok(room.auction.endsAt);

    // Second game path: disconnect auto-resume. Dolly already used her power, start a fresh room.
    const room2 = roomWith(["A", "B"], { dollyDisconnectMs: 40 });
    setChar(room2, "A", IDS.dolly);
    setChar(room2, "B", IDS.ravi);
    start(room2);
    assert.equal(room2.usePower("A").ok, true);
    room2.disconnect("sock-0");
    assert.ok(room2.chaiDisconnectTimer);
    await new Promise((r) => setTimeout(r, 70));
    assert.equal(room2.chaiBreak, null);
    assert.equal(room2.paused, false);
  });

  test("reconnecting Dolly cancels the auto-resume timer", async () => {
    const room = roomWith(["A", "B"], { dollyDisconnectMs: 80 });
    setChar(room, "A", IDS.dolly);
    setChar(room, "B", IDS.ravi);
    start(room);
    assert.equal(room.usePower("A").ok, true);
    room.disconnect("sock-0");
    room.addPlayer("A", "sock-0-re", keyOf(room, "A"));
    assert.equal(room.chaiDisconnectTimer, null);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(room.chaiBreak);
    assert.equal(room.paused, true);
  });
});

describe("Amitabh — Lock Kiya Jaaye", () => {
  test("winning the flip halves the price when he wins the player", () => {
    const room = roomWith(["A", "B"], null, { rng: { random: () => 0, int: () => 0 } });
    setChar(room, "A", IDS.amitabh);
    setChar(room, "B", IDS.ravi);
    start(room);
    const price = room.auction.currentBidLakhs;
    // Make Amitabh the leader
    if (room.auction.currentBidderKey !== room.findByName("A").key) {
      assert.equal(room.bid("A", price + 1).ok, true);
    }
    const agreed = room.auction.currentBidLakhs;
    const purse = room.findByName("A").purseLakhs;
    assert.equal(room.usePower("A").ok, true);
    assert.equal(room.auction.lockFlip.result, "win");
    room.sellCurrent();
    const got = room.findByName("A").squad[0];
    assert.equal(got.priceLakhs, Math.ceil(agreed / 2));
    assert.equal(room.findByName("A").purseLakhs, purse - Math.ceil(agreed / 2));
  });

  test("losing the flip doubles whatever the winner pays", () => {
    const room = roomWith(["A", "B"], null, { rng: { random: () => 0, int: () => 1 } });
    setChar(room, "A", IDS.amitabh);
    setChar(room, "B", IDS.ravi);
    start(room);
    const min = room.auction.currentBidLakhs + 1;
    if (room.auction.currentBidderKey !== room.findByName("B").key) {
      assert.equal(room.bid("B", min).ok, true);
    }
    const agreed = room.auction.currentBidLakhs;
    const purse = room.findByName("B").purseLakhs;
    assert.equal(room.usePower("A").ok, true);
    assert.equal(room.auction.lockFlip.result, "lose");
    room.sellCurrent();
    const got = room.findByName("B").squad[0];
    assert.equal(got.priceLakhs, agreed * 2);
    assert.equal(room.findByName("B").purseLakhs, purse - agreed * 2);
  });
});

describe("Jay Shah — Broadcast Rights", () => {
  test("rival bids on the next lot pay him 1 point; Elvish mute is exempt", () => {
    const room = roomWith(["A", "B", "C"]);
    setChar(room, "A", IDS.jay);
    setChar(room, "B", IDS.ravi);
    setChar(room, "C", IDS.elvish);
    start(room);
    const jay0 = room.findByName("A").purseLakhs;
    const b0 = room.findByName("B").purseLakhs;
    assert.equal(room.usePower("A").ok, true);
    room.sellCurrent();
    assert.equal(room.auction.broadcastKey, room.findByName("A").key);
    const amount = room.auction.currentBidLakhs + 1;
    const bidder = room.auction.currentBidderKey === room.findByName("B").key ? "C" : "B";
    const before = room.findByName(bidder).purseLakhs;
    const jayBefore = room.findByName("A").purseLakhs;
    assert.equal(room.bid(bidder, amount).ok, true);
    assert.equal(room.findByName(bidder).purseLakhs, before - 1);
    assert.equal(room.findByName("A").purseLakhs, jayBefore + 1);

    // Fresh room: Elvish mute on a taxed lot does not pay Jay
    const room2 = roomWith(["A", "B", "C"]);
    setChar(room2, "A", IDS.jay);
    setChar(room2, "B", IDS.ravi);
    setChar(room2, "C", IDS.elvish);
    start(room2);
    assert.equal(room2.usePower("A").ok, true);
    room2.sellCurrent();
    const jayPurse = room2.findByName("A").purseLakhs;
    const elvishPurse = room2.findByName("C").purseLakhs;
    const bid = room2.auction.currentBidLakhs;
    assert.equal(room2.usePower("C").ok, true);
    // Mute sells immediately, then the next lot is nominated (soldRevealMs is 0).
    const sold = room2.soldLog[room2.soldLog.length - 1];
    assert.equal(sold.buyerName, "C");
    assert.equal(sold.priceLakhs, bid + 1);
    assert.equal(room2.findByName("A").purseLakhs, jayPurse);
    assert.equal(room2.findByName("C").purseLakhs, elvishPurse - (bid + 1));
  });
});

describe("Samay — Chess Blundermaster", () => {
  test("privately shows the next 3 players and masks a VFX-reserved lot as ??? (VFX)", () => {
    const room = roomWith(["A", "B"]);
    setChar(room, "A", IDS.samay);
    setChar(room, "B", IDS.prabhas);
    start(room);
    assert.equal(room.usePower("B").ok, true);
    assert.equal(room.usePower("A").ok, true);
    const seer = room.getState("A");
    const other = room.getState("B");
    assert.ok(seer.you.samayPreview);
    assert.equal(seer.you.samayPreview.length, 3);
    assert.equal(seer.you.samayPreview[0].name, "??? (VFX)");
    assert.equal(seer.you.samayPreview[0].hidden, true);
    assert.ok(seer.you.samayPreview[1].name && seer.you.samayPreview[1].name !== "??? (VFX)");
    assert.equal(other.you.samayPreview, undefined);
  });
});

describe("Elvish — Mute the Room", () => {
  test("wins at current bid + 1 and blocks a bid-blocked team from using it", () => {
    const room = roomWith(["A", "B", "C"]);
    setChar(room, "A", IDS.elvish);
    setChar(room, "B", IDS.ranveer);
    setChar(room, "C", IDS.ravi);
    start(room);
    // Block Elvish for this lot + next
    room.findByName("A").bidBlockedUntilLot = room.lotId + 2;
    const blocked = room.usePower("A");
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /blocked/i);
    room.findByName("A").bidBlockedUntilLot = null;
    const price = room.auction.currentBidLakhs;
    const purse = room.findByName("A").purseLakhs;
    assert.equal(room.usePower("A").ok, true);
    const sold = room.soldLog[room.soldLog.length - 1];
    assert.equal(sold.buyerName, "A");
    assert.equal(sold.priceLakhs, price + 1);
    assert.equal(room.findByName("A").purseLakhs, purse - (price + 1));
  });
});

describe("Ranveer — Parents Wala Sawaal", () => {
  test("picked rival cannot bid this lot or the next; timeout consumes the power with no effect", () => {
    const room = roomWith(["A", "B", "C"]);
    setChar(room, "A", IDS.ranveer);
    setChar(room, "B", IDS.ravi);
    setChar(room, "C", IDS.arnab);
    start(room);
    const lot = room.lotId;
    assert.equal(room.usePower("A").ok, true);
    assert.equal(room.powerWait.kind, "pick_team");
    const pick = room.pickPowerTarget("A", { targetKey: room.findByName("B").key });
    assert.equal(pick.ok, true, pick.error);
    assert.equal(room.findByName("B").bidBlockedUntilLot, lot + 2);
    const raise = room.auction.currentBidLakhs + 1;
    if (room.auction.currentBidderKey !== room.findByName("B").key) {
      const bid = room.bid("B", raise);
      assert.equal(bid.ok, false);
      assert.match(bid.error, /blocked/i);
    }
    room.sellCurrent();
    if (room.auction && room.auction.currentBidderKey !== room.findByName("B").key) {
      const later = room.bid("B", room.auction.currentBidLakhs + 1);
      assert.equal(later.ok, false);
    }

    const room2 = roomWith(["A", "B"]);
    setChar(room2, "A", IDS.ranveer);
    setChar(room2, "B", IDS.ravi);
    start(room2);
    assert.equal(room2.usePower("A").ok, true);
    room2.timeoutPowerWait();
    assert.equal(room2.powerWait, null);
    assert.equal(room2.findByName("A").powerUsesLeft, 0);
    assert.equal(room2.findByName("B").bidBlockedUntilLot, null);
  });
});

describe("Salman — Kala Hiran", () => {
  test("takes a recently sold rival player at the sold price and refunds the rival", () => {
    const room = roomWith(["A", "B"]);
    setChar(room, "A", IDS.salman);
    setChar(room, "B", IDS.ravi);
    start(room);
    const bat = firstOfRole("BAT");
    givePlayer(room, "B", bat, 8);
    const a0 = room.findByName("A").purseLakhs;
    const b0 = room.findByName("B").purseLakhs;
    const bSpent = room.findByName("B").spentLakhs;
    assert.equal(room.usePower("A").ok, true);
    assert.equal(room.powerWait.kind, "pick_player");
    const res = room.pickPowerTarget("A", { playerId: bat.id });
    assert.equal(res.ok, true, res.error);
    assert.ok(room.findByName("A").squad.some((s) => s.player.id === bat.id));
    assert.ok(!room.findByName("B").squad.some((s) => s.player.id === bat.id));
    assert.equal(room.findByName("A").purseLakhs, a0 - 8);
    assert.equal(room.findByName("B").purseLakhs, b0 + 8);
    assert.equal(room.findByName("B").spentLakhs, bSpent - 8);
    assert.match(room.powerToast.message, /Kala Hiran/);
  });
});

describe("Ravi — Ghamand Tax", () => {
  test("every richer team pays him 5", () => {
    const room = roomWith(["A", "B", "C"]);
    setChar(room, "A", IDS.ravi);
    setChar(room, "B", IDS.modi);
    setChar(room, "C", IDS.arnab);
    start(room);
    room.findByName("A").purseLakhs = 50;
    room.findByName("B").purseLakhs = 80;
    room.findByName("C").purseLakhs = 50;
    assert.equal(room.usePower("A").ok, true);
    assert.equal(room.findByName("A").purseLakhs, 55);
    assert.equal(room.findByName("B").purseLakhs, 75);
    assert.equal(room.findByName("C").purseLakhs, 50);
  });
});

describe("Rakhi — Rakhi Ka Swayamvar", () => {
  test("payers give 3 points; timeout and refuse skip the next lot only", () => {
    const room = roomWith(["A", "B", "C"]);
    setChar(room, "A", IDS.rakhi);
    setChar(room, "B", IDS.ravi);
    setChar(room, "C", IDS.arnab);
    start(room);
    const lot = room.lotId;
    const a0 = room.findByName("A").purseLakhs;
    const b0 = room.findByName("B").purseLakhs;
    assert.equal(room.usePower("A").ok, true);
    assert.equal(room.powerWait.kind, "rakhi_choices");
    assert.equal(room.powerWait.defaultOnTimeout, "refuse");
    assert.equal(room.resolvePowerChoice("B", { choice: "pay" }).ok, true);
    // C has not answered — timeout defaults to refuse
    room.timeoutPowerWait();
    assert.equal(room.findByName("A").purseLakhs, a0 + 3);
    assert.equal(room.findByName("B").purseLakhs, b0 - 3);
    assert.equal(room.findByName("C").rakhiBlockLot, lot + 1);
    // Current lot: C can still bid if they weren't the default already handled
    assert.equal(room.findByName("C").bidBlockedUntilLot, null);
    if (room.auction && room.auction.currentBidderKey !== room.findByName("C").key) {
      const now = room.bid("C", room.auction.currentBidLakhs + 1);
      assert.equal(now.ok, true, now.error);
    }
    room.sellCurrent();
    if (room.auction && room.auction.currentBidderKey !== room.findByName("C").key) {
      const next = room.bid("C", room.auction.currentBidLakhs + 1);
      assert.equal(next.ok, false);
      assert.match(next.error, /blocked/i);
    }
  });
});

describe("Taylor — Travis Kelce Trade", () => {
  test("swaps a recently sold rival player with one of hers in the same role, no points change", () => {
    const room = roomWith(["A", "B"]);
    setChar(room, "A", IDS.taylor);
    setChar(room, "B", IDS.ravi);
    start(room);
    const used = new Set();
    const hers = firstOfRole("BAT", used);
    used.add(hers.id);
    const theirs = firstOfRole("BAT", used);
    givePlayer(room, "A", hers, 5);
    givePlayer(room, "B", theirs, 9);
    const a0 = room.findByName("A").purseLakhs;
    const b0 = room.findByName("B").purseLakhs;
    assert.equal(room.usePower("A").ok, true);
    assert.equal(room.powerWait.kind, "pick_swap");
    const res = room.pickPowerTarget("A", { playerId: theirs.id, swapPlayerId: hers.id });
    assert.equal(res.ok, true, res.error);
    assert.ok(room.findByName("A").squad.some((s) => s.player.id === theirs.id));
    assert.ok(room.findByName("B").squad.some((s) => s.player.id === hers.id));
    assert.equal(room.findByName("A").purseLakhs, a0);
    assert.equal(room.findByName("B").purseLakhs, b0);
  });
});

describe("Arnab — Kahan Hai Points?", () => {
  test("the richest other team, with a random tie-break, gives him 10", () => {
    const room = roomWith(["A", "B", "C"], null, { rng: { random: () => 0, int: () => 1 } });
    setChar(room, "A", IDS.arnab);
    setChar(room, "B", IDS.ravi);
    setChar(room, "C", IDS.modi);
    start(room);
    room.findByName("A").purseLakhs = 40;
    room.findByName("B").purseLakhs = 90;
    room.findByName("C").purseLakhs = 90;
    assert.equal(room.usePower("A").ok, true);
    // int() === 1 picks the second tied team (C)
    assert.equal(room.findByName("A").purseLakhs, 50);
    assert.equal(room.findByName("B").purseLakhs, 90);
    assert.equal(room.findByName("C").purseLakhs, 80);
    assert.match(room.powerToast.message, /C gave them 10/);
  });
});

describe("Kim — Big Red Button", () => {
  test("wipes floor(half) of a squad, retires them from the auction, and refunds 1/4 of spent", () => {
    const room = roomWith(["A", "B"]);
    setChar(room, "A", IDS.kim);
    setChar(room, "B", IDS.ravi);
    start(room);
    const used = new Set();
    const p1 = firstOfRole("BAT", used); used.add(p1.id);
    const p2 = firstOfRole("WK", used); used.add(p2.id);
    const p3 = firstOfRole("AR", used); used.add(p3.id);
    givePlayer(room, "B", p1, 8);
    givePlayer(room, "B", p2, 8);
    givePlayer(room, "B", p3, 8);
    room.findByName("B").spentLakhs = 24;
    const purse = room.findByName("B").purseLakhs;
    // Deterministic wipe: always swap with index 0 when shuffling
    room.rng.int = () => 0;
    assert.equal(room.usePower("A").ok, true);
    const res = room.pickPowerTarget("A", { targetKey: room.findByName("B").key });
    assert.equal(res.ok, true, res.error);
    assert.equal(room.findByName("B").squad.length, 2);
    assert.equal(room.findByName("B").purseLakhs, purse + 6);
    const wiped = [p1, p2, p3].filter((p) => !room.findByName("B").squad.some((s) => s.player.id === p.id));
    assert.equal(wiped.length, 1);
    assert.ok(!room.queue.some((p) => p.id === wiped[0].id));
    assert.ok(room.isRetired(wiped[0].id));
    assert.ok(!room.soldIds.has(wiped[0].id));
    // A 1-player squad cannot be targeted
    const room2 = roomWith(["A", "B"]);
    setChar(room2, "A", IDS.kim);
    setChar(room2, "B", IDS.ravi);
    start(room2);
    givePlayer(room2, "B", firstOfRole("BOWL"), 4);
    const no = room2.usePower("A");
    assert.equal(no.ok, false);
    assert.match(no.error, /at least two/i);
  });

// This fragment is appended into powers.test.js then deleted.

  test("client-visible state drops wiped players for the victim, Kim, a spectator, and a rejoin", () => {
    const room = roomWith(["A", "B", "C"], { powerRevealMs: 0 });
    setChar(room, "A", IDS.kim);
    setChar(room, "B", IDS.ravi);
    setChar(room, "C", IDS.modi);
    start(room);
    const used = new Set();
    const p1 = firstOfRole("BAT", used); used.add(p1.id);
    const p2 = firstOfRole("WK", used); used.add(p2.id);
    const p3 = firstOfRole("AR", used); used.add(p3.id);
    givePlayer(room, "B", p1, 8);
    givePlayer(room, "B", p2, 8);
    givePlayer(room, "B", p3, 8);
    room.findByName("B").spentLakhs = 24;
    room.rng.int = () => 0;

    const clientA = JSON.parse(JSON.stringify(room.getState("A")));
    const clientB = JSON.parse(JSON.stringify(room.getState("B")));
    const clientC = JSON.parse(JSON.stringify(room.getState("C")));
    assert.equal(clientB.you.squad.length, 3);
    assert.equal(clientA.franchises.find((f) => f.name === "B").squad.length, 3);

    const events = [];
    room.on("delta", (evt) => events.push(JSON.parse(JSON.stringify(evt))));
    assert.equal(room.usePower("A").ok, true);
    const res = room.pickPowerTarget("A", { targetKey: room.findByName("B").key });
    assert.equal(res.ok, true, res.error);
    assert.equal(room.findByName("B").squad.length, 2);

    const ended = events.find((e) => e.type === "powerWaitEnded");
    assert.ok(ended, "expected a powerWaitEnded delta");
    assert.ok(Array.isArray(ended.teams) && ended.teams.length === 3, "delta must carry every team's squad");
    const patchB = ended.teams.find((f) => f.name === "B");
    assert.equal(patchB.squad.length, 2);
    assert.ok(Array.isArray(ended.wipedPlayerIds) && ended.wipedPlayerIds.length >= 1);

    applyDelta(clientA, room.personalizeDelta(ended, "A"));
    applyDelta(clientB, room.personalizeDelta(ended, "B"));
    applyDelta(clientC, room.personalizeDelta(ended, "C"));

    const idsOf = (state, name) => {
      const team = name === state.you?.name ? state.you : (state.franchises || []).find((f) => f.name === name);
      return (team && team.squad ? team.squad : []).map((s) => s.player.id);
    };
    const serverIds = room.findByName("B").squad.map((s) => s.player.id);
    const wipedIds = [p1, p2, p3].map((p) => p.id).filter((id) => !serverIds.includes(id));
    assert.equal(wipedIds.length, 1);
    for (const [label, st] of [["Kim", clientA], ["victim", clientB], ["spectator", clientC]]) {
      const ids = idsOf(st, "B");
      assert.deepEqual(ids, serverIds, `${label} client still shows a wiped player`);
      assert.equal(ids.length, 2, `${label} squad length`);
      assert.ok(!ids.includes(wipedIds[0]), `${label} still has ${wipedIds[0]}`);
    }
    const rejoin = room.getState("B");
    assert.deepEqual(rejoin.you.squad.map((s) => s.player.id), serverIds);
    assert.ok(!room.queue.some((p) => p.id === wipedIds[0]));
    assert.ok(room.isRetired(wipedIds[0]));
    const snap = clientB.auction && clientB.auction.lotSnapshot && clientB.auction.lotSnapshot.find((r) => r.name === "B");
    assert.ok(snap);
    assert.equal(snap.squadSize, 2);
    const need = Object.values(clientB.you.remainingQuota || {}).reduce((s, v) => s + v, 0);
    assert.ok(need >= 1, "victim should need slots again");
    assert.equal(clientB.you.complete, false);
  });
});

describe("global power rules", () => {
  test("one power per lot, points floor at 0, banned teams cannot bid or use powers", () => {
    const room = roomWith(["A", "B", "C"]);
    setChar(room, "A", IDS.modi);
    setChar(room, "B", IDS.ravi);
    setChar(room, "C", IDS.arnab);
    start(room);
    assert.equal(room.usePower("A").ok, true);
    assert.equal(room.usePower("B").ok, false);
    room.findByName("B").purseLakhs = 5;
    room.findByName("A").powerUsesLeft = 1;
    room.findByName("A").powerUsedCount = 0;
    room.lotPowerUsed = false;
    // Demonetisation again would require a reset; use Arnab on B after giving B 0 via debit path
    room.lotPowerUsed = false;
    room.findByName("C").purseLakhs = 40;
    room.findByName("A").purseLakhs = 100;
    room.findByName("B").purseLakhs = 3;
    assert.equal(room.usePower("C").ok, true); // Kahan Hai Points from the richest other (A)
    // B still alive. Force a tax that zeros B.
    room.lotPowerUsed = false;
    room.findByName("B").powerUsesLeft = 1;
    room.findByName("B").powerUsedCount = 0;
    room.findByName("B").purseLakhs = 4;
    room.findByName("C").purseLakhs = 1;
    room.findByName("A").purseLakhs = 80;
    const tax = room.usePower("B"); // Ghamand Tax: A pays 5, C does not
    assert.equal(tax.ok, true, tax.error);
    room.findByName("C").purseLakhs = 0;
    room.banForMatchFixing(room.findByName("C"));
    const snap = room.getState("A");
    const row = snap.franchises.find((f) => f.name === "C");
    assert.equal(row.banned, true);
    assert.equal(row.eliminatedReason, "Banned for match fixing");
    const bid = room.bid("C", (room.auction ? room.auction.currentBidLakhs : 2) + 1);
    if (room.auction) {
      assert.equal(bid.ok, false);
      assert.match(bid.error, /banned/i);
    }
    room.lotPowerUsed = false;
    room.findByName("C").powerUsesLeft = 1;
    room.findByName("C").powerUsedCount = 0;
    const pow = room.usePower("C");
    assert.equal(pow.ok, false);
    assert.match(pow.error, /banned/i);
  });

  test("quick chat works during a wait and is rate-limited", () => {
    const room = roomWith(["A", "B"]);
    setChar(room, "A", IDS.dolly);
    setChar(room, "B", IDS.ravi);
    start(room);
    const raviLines = characterLines(IDS.ravi);
    const dollyLines = characterLines(IDS.dolly);
    assert.equal(room.quickChat("B", raviLines[0].id).ok, false);
    assert.equal(room.usePower("A").ok, true);
    const evts = [];
    room.on("quickChat", (e) => evts.push(e));
    const ok = room.quickChat("B", raviLines[0].id);
    assert.equal(ok.ok, true, ok.error);
    assert.equal(ok.text, "Zindagi jhand ba, fir bhi ghamand ba");
    assert.equal(evts.length, 1);
    const again = room.quickChat("B", raviLines[1].id);
    assert.equal(again.ok, false);
    assert.match(again.error, /Wait a moment/i);
    const stolen = room.quickChat("A", raviLines[0].id);
    assert.equal(stolen.ok, false);
    assert.match(stolen.error, /not yours/i);
    const own = room.quickChat("A", dollyLines[0].id);
    assert.equal(own.ok, true, own.error);
    assert.equal(own.text, "Ek cutting!");
  });

  test("existing rejection rules still hold during chai and sold reveal", () => {
    const room = roomWith(["A", "B"], { powerRevealMs: 0, soldRevealMs: 400 });
    setChar(room, "A", IDS.dolly);
    setChar(room, "B", IDS.ravi);
    start(room);
    assert.equal(room.usePower("A").ok, true);
    assert.equal(room.bid("B", room.auction.currentBidLakhs + 1).ok, false);
    assert.equal(room.pause("B").ok, false);
    assert.equal(room.usePower("B").ok, false);
  });
});

describe("disabled power reasons", () => {
  test("shortenPowerReason maps server errors to short lines", () => {
    const cases = [
      ["You have already used your power.", "Used already"],
      ["A power has already been used on this lot.", "One power per lot, already used"],
      ["Wait for the player to be introduced.", "Not during intro"],
      ["Game is paused by Priya.", "Paused"],
      ["Wait until the next player is on the block.", "Lot sold"],
      ["You cannot afford 12 points.", "Can't afford"],
      ["Banned teams cannot use a power.", "Banned"],
      ["Your squad is already complete.", "Squad full"],
      ["The next lot's power slot is already taken.", "Wait for the next lot"],
      ["Powers can only be used during the auction.", "Only during auction"],
      ["No team has at least two players to wipe.", "No valid target"],
      ["There is no rival to tax.", "No valid target"],
      ["Hidden lot (VFX)", "Hidden lot (VFX)"],
    ];
    for (const [raw, short] of cases) {
      assert.equal(shortenPowerReason(raw), short, raw);
    }
  });

  test("getState and deltas expose a short canUsePowerHint", () => {
    const room = roomWith(["A", "B"], { powerRevealMs: 0 });
    setChar(room, "A", IDS.modi);
    setChar(room, "B", IDS.ravi);
    const lobby = room.getState("A");
    assert.equal(lobby.you.canUsePower, false);
    assert.equal(lobby.you.canUsePowerHint, "Only during auction");
    start(room);
    assert.equal(room.usePower("A").ok, true);
    const other = room.getState("B");
    assert.equal(other.you.canUsePower, false);
    assert.equal(other.you.canUsePowerHint, "One power per lot, already used");
    const events = [];
    room.on("delta", (evt) => events.push(evt));
    const lead = room.auction.currentBidderKey === "a" ? "B" : "A";
    if (lead === "B") {
      const bid = room.bid("B", room.auction.currentBidLakhs + 1);
      assert.equal(bid.ok, true, bid.error);
      const last = events[events.length - 1];
      const personalized = room.personalizeDelta(last, "B");
      assert.equal(personalized.youPower.canUsePower, false);
      assert.equal(personalized.youPower.canUsePowerHint, "One power per lot, already used");
    }
  });
});

describe("retired players are not re-nominated after powers", () => {
  test("a Kim-wiped player is never re-nominated", () => {
    const room = roomWith(["A", "B"], { powerRevealMs: 0 });
    setChar(room, "A", IDS.kim);
    setChar(room, "B", IDS.ravi);
    start(room);
    const used = new Set((room.queue || []).map((p) => p && p.id));
    if (room.auction && room.auction.nominee) used.add(room.auction.nominee.id);
    const p1 = firstOfRole("BAT", used); used.add(p1.id);
    const p2 = firstOfRole("WK", used); used.add(p2.id);
    givePlayer(room, "B", p1, 8);
    givePlayer(room, "B", p2, 8);
    room.findByName("B").spentLakhs = 16;
    room.rng.int = () => 0;
    assert.equal(room.usePower("A").ok, true);
    const res = room.pickPowerTarget("A", { targetKey: room.findByName("B").key });
    assert.equal(res.ok, true, res.error);
    const kept = room.findByName("B").squad.map((s) => s.player.id);
    const wipedId = [p1, p2].map((p) => p.id).find((id) => !kept.includes(id));
    assert.ok(wipedId);
    assert.ok(room.isRetired(wipedId));
    assert.ok(!room.queue.some((p) => p.id === wipedId));
    // Drain the current lot and a few more; the wiped player must not come up.
    for (let i = 0; i < 8 && room.phase === "auction"; i++) {
      if (room.auction && room.auction.nominee) {
        assert.notEqual(room.auction.nominee.id, wipedId);
        const leader = room.auction.currentBidderKey;
        const other = room.franchises.find((f) => f.key !== leader);
        if (other) room.optOut(other.name);
        else break;
      } else break;
    }
    assert.ok(room.isRetired(wipedId));
    assert.ok(!room.queue.some((p) => p.id === wipedId));
  });

  test("a swapped-out player stays with the other team and is never re-nominated", () => {
    const room = roomWith(["A", "B"], { powerRevealMs: 0 });
    setChar(room, "A", IDS.taylor);
    setChar(room, "B", IDS.ravi);
    start(room);
    const used = new Set();
    if (room.auction && room.auction.nominee) used.add(room.auction.nominee.id);
    const mine = firstOfRole("BAT", used); used.add(mine.id);
    const theirs = firstOfRole("BAT", used); used.add(theirs.id);
    givePlayer(room, "A", mine, 6);
    givePlayer(room, "B", theirs, 7);
    room.queue = (room.queue || []).filter((p) => p && p.id !== mine.id && p.id !== theirs.id);
    assert.equal(room.usePower("A").ok, true);
    const res = room.pickPowerTarget("A", { playerId: theirs.id, swapPlayerId: mine.id });
    assert.equal(res.ok, true, res.error);
    const teamA = room.findByName("A").squad.map((s) => s.player.id);
    const teamB = room.findByName("B").squad.map((s) => s.player.id);
    assert.ok(teamA.includes(theirs.id));
    assert.ok(teamB.includes(mine.id));
    assert.ok(!teamA.includes(mine.id));
    assert.ok(!room.isRetired(mine.id) && !room.isRetired(theirs.id), "swapped players stay sold, not retired");
    assert.ok(!room.queue.some((p) => p.id === mine.id || p.id === theirs.id));
    room.queue = room.queue.filter((p) => p && p.id !== mine.id && p.id !== theirs.id);
    room.appendTopUpBatch();
    assert.ok(!room.queue.some((p) => p.id === mine.id || p.id === theirs.id));
    if (room.auction && room.auction.nominee) {
      assert.notEqual(room.auction.nominee.id, mine.id);
      assert.notEqual(room.auction.nominee.id, theirs.id);
    }
  });
});


describe("squad-changing powers stay in sync on every client", () => {
  function idsOf(state, name) {
    const team = name === state.you?.name ? state.you : (state.franchises || []).find((f) => f.name === name);
    return (team && team.squad ? team.squad : []).map((s) => s.player.id);
  }

  function clientsAndEvents(room, names) {
    const clients = {};
    for (const name of names) clients[name] = JSON.parse(JSON.stringify(room.getState(name)));
    const events = [];
    room.on("delta", (evt) => events.push(JSON.parse(JSON.stringify(evt))));
    return { clients, events };
  }

  function playDeltas(room, clients, events, from) {
    const slice = events.slice(from);
    for (const name of Object.keys(clients)) {
      for (const evt of slice) applyDelta(clients[name], room.personalizeDelta(evt, name));
    }
  }

  test("Kala Hiran removes the stolen player from the source squad on every client", () => {
    const room = roomWith(["A", "B", "C"], { powerRevealMs: 0 });
    setChar(room, "A", IDS.salman);
    setChar(room, "B", IDS.ravi);
    setChar(room, "C", IDS.modi);
    start(room);
    const bat = firstOfRole("BAT");
    givePlayer(room, "B", bat, 8);
    room.findByName("B").captainId = bat.id;
    const { clients, events } = clientsAndEvents(room, ["A", "B", "C"]);
    const startLen = events.length;
    assert.equal(room.usePower("A").ok, true);
    const opts = room.powerWait.options;
    assert.equal(opts[0].fromName, "B");
    assert.equal(opts[0].fromTeamName, "B");
    const res = room.pickPowerTarget("A", { playerId: bat.id });
    assert.equal(res.ok, true, res.error);
    playDeltas(room, clients, events, startLen);
    const ended = events.find((e) => e.type === "powerWaitEnded");
    assert.ok(ended && ended.soldLogUpdates, "aftermath should include sold-log updates");
    for (const [label, st] of [["thief", clients.A], ["victim", clients.B], ["spectator", clients.C]]) {
      assert.ok(idsOf(st, "A").includes(bat.id), `${label} missing the stolen player`);
      assert.ok(!idsOf(st, "B").includes(bat.id), `${label} still shows the stolen player on B`);
    }
    assert.equal(room.findByName("B").captainId, null);
    assert.equal(clients.B.franchises.find((f) => f.name === "B").captainId, null);
    const log = (clients.B.soldLog || []).find((e) => e.player && e.player.id === bat.id);
    if (log) assert.equal(log.buyerName, "A");
  });

  test("Travis Kelce Trade moves both players and does not leave a leftover on either client", () => {
    const room = roomWith(["A", "B"], { powerRevealMs: 0 });
    setChar(room, "A", IDS.taylor);
    setChar(room, "B", IDS.ravi);
    start(room);
    const used = new Set();
    const hers = firstOfRole("BAT", used); used.add(hers.id);
    const theirs = firstOfRole("BAT", used);
    givePlayer(room, "A", hers, 5);
    givePlayer(room, "B", theirs, 9);
    const { clients, events } = clientsAndEvents(room, ["A", "B"]);
    const startLen = events.length;
    assert.equal(room.usePower("A").ok, true);
    const res = room.pickPowerTarget("A", { playerId: theirs.id, swapPlayerId: hers.id });
    assert.equal(res.ok, true, res.error);
    playDeltas(room, clients, events, startLen);
    for (const [label, st] of [["A", clients.A], ["B", clients.B]]) {
      assert.ok(idsOf(st, "A").includes(theirs.id), `${label} A missing theirs`);
      assert.ok(idsOf(st, "B").includes(hers.id), `${label} B missing hers`);
      assert.ok(!idsOf(st, "A").includes(hers.id), `${label} A still has hers`);
      assert.ok(!idsOf(st, "B").includes(theirs.id), `${label} B still has theirs`);
    }
  });

  test("power team pickers list the team's actual name, not the co-owner", () => {
    const room = roomWith(["CSK", "MI"], { powerRevealMs: 0 });
    setChar(room, "CSK", IDS.kim);
    setChar(room, "MI", IDS.ravi);
    start(room, "CSK");
    givePlayer(room, "MI", firstOfRole("BAT"), 4);
    givePlayer(room, "MI", firstOfRole("WK"), 4);
    assert.equal(room.usePower("CSK").ok, true);
    const opts = room.powerWait.options;
    assert.ok(opts.length);
    assert.equal(opts[0].name, "MI");
    assert.equal(opts[0].teamName, "MI");
    assert.ok(opts[0].character && opts[0].character !== "MI", opts[0].character);
  });
});
