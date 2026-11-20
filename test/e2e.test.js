const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");

process.env.ALLOW_TEST_TIMERS = "1";
process.env.BID_TIMER_MS = process.env.BID_TIMER_MS || "250";
process.env.CAPTAIN_TIMER_MS = process.env.CAPTAIN_TIMER_MS || "250";

const { io: ioc } = require("socket.io-client");
const { start } = require("../server/index");
const { applyDelta } = require("../public/state");
const { SQUAD_SIZE } = require("../server/rules");

function waitState(socket, pred, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (socket.state && pred(socket.state)) {
      resolve(socket.state);
      return;
    }
    const t = setTimeout(() => {
      cleanup();
      const s = socket.state;
      reject(
        new Error(
          `timeout waiting for state: ${pred.toString()} (phase=${s?.phase}, teams=${s?.franchises?.length}, nominee=${s?.auction?.nominee?.id || "-"})`
        )
      );
    }, timeoutMs);
    function onChange() {
      try {
        if (socket.state && pred(socket.state)) {
          cleanup();
          resolve(socket.state);
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    }
    function cleanup() {
      clearTimeout(t);
      socket.off("state", onChange);
      socket.off("delta", onChange);
    }
    socket.on("state", onChange);
    socket.on("delta", onChange);
  });
}

function ack(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ack for ${event}`)), 5000);
    socket.emit(event, payload || {}, (res) => {
      clearTimeout(t);
      resolve(res);
    });
  });
}

function connect(url, name) {
  const socket = ioc(url, { transports: ["websocket"], forceNew: true, reconnection: false });
  socket.playerName = name;
  socket.state = null;
  socket.on("state", (s) => {
    socket.state = s;
  });
  socket.on("delta", (evt) => {
    if (!socket.state) return;
    applyDelta(socket.state, evt);
  });
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function needsRole(state, role) {
  const left = state.you?.remainingQuota?.[role] || 0;
  return left > 0 && !state.you?.complete;
}

function overall(p) {
  if (p.role === "AR") return (p.batting + p.bowling) / 2;
  if (p.role === "BOWL") return p.bowling * 0.9 + p.batting * 0.1;
  return p.batting * 0.9 + p.bowling * 0.1;
}

async function playAuction(sockets) {
  const acted = new Map(); // name -> last nominee id + action

  function decide(state) {
    const a = state.auction;
    if (state.phase !== "auction" || !a || !state.you) return null;
    const key = `${a.nominee.id}:${state.you.name}`;
    if (acted.get(state.you.name) === key) return null;
    if (a.youCanBid && !a.hasBidder && needsRole(state, a.nominee.role)) {
      return { key, op: "bid", amountLakhs: a.minBidLakhs };
    }
    if (
      a.youCanBid &&
      a.hasBidder &&
      a.currentBidderName !== state.you.name &&
      needsRole(state, a.nominee.role) &&
      overall(a.nominee) >= 90 &&
      a.currentBidLakhs <= 400
    ) {
      return { key, op: "bid", amountLakhs: a.minBidLakhs };
    }
    if (a.youCanOptOut) {
      return { key, op: "optOut" };
    }
    return null;
  }

  const stop = Date.now() + 25000;
  while (Date.now() < stop) {
    const sample = sockets.map((s) => s.state).find((st) => st && ["captains", "results", "simulating"].includes(st.phase));
    if (sample) return sample;
    for (const s of sockets) {
      if (!s.state) continue;
      const decision = decide(s.state);
      if (!decision) continue;
      acted.set(s.playerName, decision.key);
      if (decision.op === "bid") {
        const res = await ack(s, "bid", { amountLakhs: decision.amountLakhs });
        if (res && !res.ok) acted.delete(s.playerName);
      } else {
        const res = await ack(s, "optOut");
        if (res && !res.ok) acted.delete(s.playerName);
      }
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`auction did not finish; phase=${sockets[0].state?.phase}`);
}

describe("e2e: 3 clients through a full game", () => {
  let ctx;
  const sockets = [];

  test("create, join, auction with bids and opt-outs, captains, results, rejoin", async () => {
    ctx = await start(0);
    const url = `http://127.0.0.1:${ctx.port}`;

    const ash = await connect(url, "Ashutosh");
    sockets.push(ash);
    const created = await ack(ash, "createRoom", {
      name: "Ashutosh",
      pursePoints: 100,
      testTimers: { lotStartMs: 80, bidMs: 80, captainMs: 300 },
    });
    assert.equal(created.ok, true);
    assert.match(created.code, /^[A-Z0-9]{6}$/);
    const code = created.code;

    const priya = await connect(url, "Priya");
    const rohan = await connect(url, "Rohan");
    sockets.push(priya, rohan);
    assert.equal((await ack(priya, "joinRoom", { code, name: "Priya" })).ok, true);
    assert.equal((await ack(rohan, "joinRoom", { code, name: "Rohan" })).ok, true);

    const lobby = await waitState(ash, (s) => s.phase === "lobby" && s.franchises.length === 3);
    assert.equal(lobby.franchises.length, 3);
    assert.equal(lobby.purseLakhs, 100);

    const started = await ack(ash, "startAuction");
    assert.equal(started.ok, true);
    await waitState(ash, (s) => s.phase === "auction" && s.auction && s.auction.nominee);
    assert.ok(ash.state.auction.stillIn.length >= 1);
    // Ineligible / opted-out teams must not appear on the still-in list.
    const stillNames = ash.state.auction.stillIn.map((t) => t.name);
    assert.equal(new Set(stillNames).size, stillNames.length);

    await playAuction(sockets);

    const afterAuction = sockets.map((s) => s.state);
    const phase = afterAuction[0].phase;
    assert.ok(["captains", "simulating", "results"].includes(phase), `unexpected phase ${phase}`);

    if (phase === "captains" || priya.state?.phase === "captains") {
      for (const s of sockets) {
        const st = s.state;
        if (st?.phase === "captains" && st.you?.squad?.length) {
          const pick =
            [...st.you.squad].sort((a, b) => overall(b.player) - overall(a.player))[0] || st.you.squad[0];
          await ack(s, "selectCaptain", { playerId: pick.player.id });
        }
      }
    }

    const results = await Promise.race(
      sockets.map((s) => waitState(s, (st) => st.phase === "results" && st.tournament, 15000))
    );
    assert.equal(results.phase, "results");

    for (const f of results.franchises) {
      if (f.eliminated) continue;
      assert.ok(f.squad.length >= SQUAD_SIZE, `${f.name} squad size ${f.squad.length}`);
      assert.ok(f.captainId, `${f.name} needs a captain`);
    }

    const t = results.tournament;
    assert.equal(t.leagueMatches, undefined);
    assert.equal(t.playoffs.matches, undefined);
    assert.equal(t.table.length, 3);
    assert.equal(t.playoffs.format, "top2-final");
    assert.ok(t.champion);
    assert.ok(t.awards.bestBuy?.playerName);
    assert.ok(t.awards.costliestFlop?.playerName);
    assert.equal(t.positions.length, 3);
    assert.equal(t.positions[0].name, t.champion.name);

    const details = await ack(ash, "getMatches");
    assert.equal(details.ok, true);
    assert.equal(details.leagueMatches.length, 3);
    assert.equal(details.playoffMatches.length, 1);
    assert.ok(details.teams.length >= 3);
    for (const team of details.teams) {
      if (team.eliminated) continue;
      assert.ok(team.squad.length >= SQUAD_SIZE);
      assert.ok(team.squad.some((slot) => slot.isCaptain));
      assert.ok(team.squad.some((slot) => slot.stats && (slot.stats.runs > 0 || slot.stats.wickets > 0 || slot.stats.innings > 0)));
    }
    for (const m of [...details.leagueMatches, ...details.playoffMatches]) {
      assert.ok(m.firstInnings.score >= 80);
      assert.ok(m.resultText);
    }

    // Rejoin by name + room code after a disconnect.
    const purseBefore = priya.state.you.purseLakhs;
    const squadBefore = priya.state.you.squad.map((s) => s.player.id);
    priya.disconnect();
    const priya2 = await connect(url, "Priya");
    sockets.push(priya2);
    const rejoined = await ack(priya2, "joinRoom", { code, name: "Priya" });
    assert.equal(rejoined.ok, true);
    assert.equal(rejoined.rejoined, true);
    const again = await waitState(priya2, (s) => s.phase === "results" && s.you?.name === "Priya");
    assert.equal(again.you.purseLakhs, purseBefore);
    assert.deepEqual(
      again.you.squad.map((s) => s.player.id),
      squadBefore
    );
    assert.equal(again.you.connected, true);
  });

  after(async () => {
    for (const s of sockets) {
      try {
        s.close();
      } catch {}
    }
    if (ctx?.io) ctx.io.close();
    if (ctx?.server) {
      await new Promise((resolve) => ctx.server.close(() => resolve()));
    }
  });
});

describe("identities, pause, start bid and end game over sockets", () => {
  let ctx;
  let url;
  const sockets = [];

  test("unique logos, random start bid, single-team close, pause, and host end game", async () => {
    ctx = await start({ port: 0 });
    url = `http://127.0.0.1:${ctx.server.address().port}`;
    const ash = await connect(url, "Ashutosh");
    const priya = await connect(url, "Priya");
    const rohan = await connect(url, "Rohan");
    sockets.push(ash, priya, rohan);

    const created = await ack(ash, "createRoom", {
      name: "Ashutosh",
      testTimers: { lotStartMs: 800, bidMs: 800, captainMs: 800 },
    });
    assert.equal(created.ok, true);
    const code = created.code;
    assert.equal((await ack(priya, "joinRoom", { code, name: "Priya" })).ok, true);
    assert.equal((await ack(rohan, "joinRoom", { code, name: "Rohan" })).ok, true);

    await waitState(ash, (s) => s.franchises && s.franchises.length === 3);
    const catalog = ash.state.identities || [];
    assert.equal(catalog.length, 20);
    assert.equal(new Set(catalog.map((t) => t.color.toLowerCase())).size, 20);
    assert.ok(catalog.every((t) => t.character && t.id));

    const clash = await connect(url, "Clone");
    sockets.push(clash);
    const takenName = await ack(clash, "joinRoom", { code, name: "Priya" });
    assert.equal(takenName.ok, false);
    assert.match(takenName.error || "", /team name/i);

    const ids = ash.state.franchises.map((f) => f.franchise.id);
    assert.equal(new Set(ids).size, 3);
    const taken = ash.state.you.franchise.id;
    const fail = await ack(priya, "selectIdentity", { identityId: taken });
    assert.equal(fail.ok, false);
    const free = catalog.find((t) => !ids.includes(t.id));
    assert.ok(free, "need a free logo");
    const picked = await ack(priya, "selectIdentity", { identityId: free.id });
    assert.equal(picked.ok, true);
    await waitState(priya, (s) => s.you && s.you.franchise.id === free.id);
    assert.notEqual(ash.state.you.franchise.id, priya.state.you.franchise.id);

    const started = await ack(ash, "startAuction");
    assert.equal(started.ok, true);
    const lot = await waitState(ash, (s) => s.phase === "auction" && s.auction && s.auction.nominee);
    const startBid = lot.auction.startBidLakhs;
    assert.ok(Number.isInteger(startBid) && startBid >= 1 && startBid <= 5, String(startBid));
    assert.equal(lot.auction.currentBidLakhs, startBid);
    const nomineeId = lot.auction.nominee.id;
    const defaultName = lot.auction.currentBidderName;

    const paused = await ack(priya, "pause");
    assert.equal(paused.ok, true);
    await waitState(ash, (s) => s.paused === true && s.pausedBy === "Priya");
    assert.equal(ash.state.pausedBy, "Priya");
    const bidWhilePaused = await ack(rohan, "bid", { amountLakhs: startBid + 1 });
    assert.equal(bidWhilePaused.ok, false);
    const rohanResume = await ack(rohan, "resume");
    assert.equal(rohanResume.ok, false);
    const resumed = await ack(priya, "resume");
    assert.equal(resumed.ok, true);
    await waitState(ash, (s) => s.paused === false);

    const others = [ash, priya, rohan].filter((s) => s.playerName !== defaultName);
    for (const s of others) {
      const res = await ack(s, "optOut");
      assert.equal(res.ok, true, res && res.error);
    }
    const sold = await waitState(ash, (s) => s.lastEvent && s.lastEvent.type === "sold" && s.lastEvent.player && s.lastEvent.player.id === nomineeId);
    assert.equal(sold.lastEvent.buyerName, defaultName);

    const ended = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no gameEnded")), 5000);
      priya.once("gameEnded", (info) => {
        clearTimeout(t);
        resolve(info);
      });
    });
    const hostEnd = await ack(ash, "endGame");
    assert.equal(hostEnd.ok, true);
    const info = await ended;
    assert.equal(info.ok, true);
  });

  after(async () => {
    for (const s of sockets) {
      try { s.close(); } catch {}
    }
    if (ctx?.io) ctx.io.close();
    if (ctx?.server) await new Promise((resolve) => ctx.server.close(() => resolve()));
  });
});
