const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");

process.env.ALLOW_TEST_TIMERS = "1";
process.env.BID_TIMER_MS = process.env.BID_TIMER_MS || "250";
process.env.CAPTAIN_TIMER_MS = process.env.CAPTAIN_TIMER_MS || "250";

const { io: ioc } = require("socket.io-client");
const { start } = require("../server/index");
const { SQUAD_SIZE } = require("../server/rules");

function waitState(socket, pred, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (socket.state && pred(socket.state)) {
      resolve(socket.state);
      return;
    }
    const t = setTimeout(() => {
      socket.off("state", onState);
      const s = socket.state;
      reject(
        new Error(
          `timeout waiting for state: ${pred.toString()} (phase=${s?.phase}, teams=${s?.franchises?.length}, nominee=${s?.auction?.nominee?.id || "-"})`
        )
      );
    }, timeoutMs);
    function onState(state) {
      try {
        if (pred(state)) {
          clearTimeout(t);
          socket.off("state", onState);
          resolve(state);
        }
      } catch (err) {
        clearTimeout(t);
        socket.off("state", onState);
        reject(err);
      }
    }
    socket.on("state", onState);
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
      purseCrore: 100,
      testTimers: { bidMs: 200, captainMs: 300 },
    });
    assert.equal(created.ok, true);
    assert.match(created.code, /^[A-Z0-9]{4}$/);
    const code = created.code;

    const priya = await connect(url, "Priya");
    const rohan = await connect(url, "Rohan");
    sockets.push(priya, rohan);
    assert.equal((await ack(priya, "joinRoom", { code, name: "Priya" })).ok, true);
    assert.equal((await ack(rohan, "joinRoom", { code, name: "Rohan" })).ok, true);

    const lobby = await waitState(ash, (s) => s.phase === "lobby" && s.franchises.length === 3);
    assert.equal(lobby.franchises.length, 3);
    assert.equal(lobby.purseLakhs, 10000);

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
    assert.equal(t.leagueMatches.length, 3);
    assert.equal(t.table.length, 3);
    assert.equal(t.playoffs.format, "top2-final");
    assert.equal(t.playoffs.matches.length, 1);
    assert.ok(t.champion);
    assert.ok(t.awards.bestBuy?.playerName);
    assert.ok(t.awards.costliestFlop?.playerName);
    assert.equal(t.positions.length, 3);
    assert.equal(t.positions[0].name, t.champion.name);
    for (const m of [...t.leagueMatches, ...t.playoffs.matches]) {
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
