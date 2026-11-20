#!/usr/bin/env node
/**
 * Bandwidth / memory / ack-latency harness.
 * Measures application-level outbound bytes (JSON of emitted Socket.IO events),
 * the same method used for the pre-delta baseline (full personalized `state` on every update).
 *
 * Usage: CREATE_LIMIT=0 MAX_ROOMS=30 ALLOW_TEST_TIMERS=1 node scripts/measure-bandwidth.js
 */
process.env.ALLOW_TEST_TIMERS = process.env.ALLOW_TEST_TIMERS || "1";
process.env.CREATE_LIMIT = process.env.CREATE_LIMIT || "0";
process.env.MAX_ROOMS = process.env.MAX_ROOMS || "30";

const { io: ioc } = require("socket.io-client");
const { start } = require("../server/index");
const { applyDelta } = require("../public/state");

function mb(bytes) {
  return bytes / (1024 * 1024);
}

function p95(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * 0.95) - 1));
  return s[idx];
}

function rssMb() {
  return process.memoryUsage().rss / (1024 * 1024);
}

function connect(url, name) {
  const socket = ioc(url, { transports: ["websocket"], forceNew: true, reconnection: false });
  socket.playerName = name;
  socket.state = null;
  socket.acks = [];
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

function ack(socket, event, payload, acks) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ack for ${event}`)), 8000);
    socket.emit(event, payload || {}, (res) => {
      clearTimeout(t);
      const ms = Date.now() - t0;
      if (acks) acks.push(ms);
      resolve(res);
    });
  });
}

function waitState(socket, pred, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (socket.state && pred(socket.state)) return resolve(socket.state);
    const t = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout phase=${socket.state?.phase}`));
    }, timeoutMs);
    function onChange() {
      if (socket.state && pred(socket.state)) {
        cleanup();
        resolve(socket.state);
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

function needsRole(state, role) {
  const left = state.you?.remainingQuota?.[role] || 0;
  return left > 0 && !state.you?.complete;
}

function overall(p) {
  if (p.role === "AR") return (p.batting + p.bowling) / 2;
  if (p.role === "BOWL") return p.bowling * 0.9 + p.batting * 0.1;
  return p.batting * 0.9 + p.bowling * 0.1;
}

async function playAuction(sockets, acks) {
  const acted = new Map();
  function decide(state) {
    const a = state.auction;
    if (state.phase !== "auction" || !a || !state.you) return null;
    const key = `${a.nominee.id}:${state.you.name}`;
    if (acted.get(state.you.name) === key) return null;
    if (
      a.youCanBid &&
      a.hasBidder &&
      a.currentBidderName !== state.you.name &&
      needsRole(state, a.nominee.role) &&
      overall(a.nominee) >= 92 &&
      a.currentBidLakhs <= 300
    ) {
      return { key, op: "bid", amountLakhs: a.minBidLakhs };
    }
    if (a.youCanOptOut) return { key, op: "optOut" };
    return null;
  }

  const stop = Date.now() + 40000;
  while (Date.now() < stop) {
    const sample = sockets.map((s) => s.state).find((st) => st && ["captains", "results", "simulating"].includes(st.phase));
    if (sample) return sample;
    for (const s of sockets) {
      if (!s.state) continue;
      const decision = decide(s.state);
      if (!decision) continue;
      acted.set(s.playerName, decision.key);
      const res =
        decision.op === "bid"
          ? await ack(s, "bid", { amountLakhs: decision.amountLakhs }, acks)
          : await ack(s, "optOut", {}, acks);
      if (res && !res.ok) acted.delete(s.playerName);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`auction did not finish; phase=${sockets[0].state?.phase}`);
}

async function playGame(url, n, resetBytes, getBytes) {
  const names = Array.from({ length: n }, (_, i) => `P${i + 1}`);
  const sockets = [];
  const acks = [];
  if (resetBytes) resetBytes();
  const rssBefore = rssMb();

  const host = await connect(url, names[0]);
  sockets.push(host);
  const created = await ack(host, "createRoom", {
    name: names[0],
    purseCrore: 100,
    testTimers: { bidMs: 200, captainMs: 200 },
  }, acks);
  if (!created.ok) throw new Error(created.error || "create failed");
  const code = created.code;

  for (let i = 1; i < n; i++) {
    const s = await connect(url, names[i]);
    sockets.push(s);
    const joined = await ack(s, "joinRoom", { code, name: names[i] }, acks);
    if (!joined.ok) throw new Error(joined.error || "join failed");
  }
  await waitState(host, (st) => st.franchises && st.franchises.length === n);
  const started = await ack(host, "startAuction", {}, acks);
  if (!started.ok) throw new Error(started.error || "start failed");

  await playAuction(sockets, acks);

  if (sockets.some((s) => s.state?.phase === "captains")) {
    for (const s of sockets) {
      const st = s.state;
      if (st?.phase === "captains" && st.you?.squad?.length) {
        const pick = [...st.you.squad].sort((a, b) => overall(b.player) - overall(a.player))[0];
        await ack(s, "selectCaptain", { playerId: pick.player.id }, acks);
      }
    }
  }
  await Promise.race(sockets.map((s) => waitState(s, (st) => st.phase === "results" && st.tournament, 20000)));
  // On-demand match fetch (one client, as a real viewer would)
  await ack(host, "getMatches", {}, acks);

  const outbound = getBytes();
  const rssAfter = rssMb();
  for (const s of sockets) {
    try { s.close(); } catch {}
  }
  return {
    players: n,
    outboundBytes: outbound,
    outboundMb: mb(outbound),
    rssBefore,
    rssAfter,
    p95AckMs: p95(acks),
    ackSamples: acks.length,
  };
}

async function main() {
  const ctx = await start(0);
  const url = `http://127.0.0.1:${ctx.port}`;
  const baseline = { 2: 0.35, 4: 5.4, 6: 29, 8: 78, 10: 141 };
  const results = [];

  console.log(`Server on ${url}`);
  console.log("Single-room games (2/4/6/8/10 players)");
  for (const n of [2, 4, 6, 8, 10]) {
    if (global.gc) global.gc();
    const row = await playGame(url, n, ctx.resetByteStats, () => ctx.byteStats.emitBytes);
    results.push(row);
    const before = baseline[n];
    const ratio = before ? ((row.outboundMb / before) * 100).toFixed(1) : "?";
    console.log(
      `  ${n}p  outbound ${row.outboundMb.toFixed(3)} MB  (was ${before} MB, ${ratio}% of before)  RSS ${row.rssAfter.toFixed(1)} MB  p95 ack ${row.p95AckMs.toFixed(1)} ms  (n=${row.ackSamples})`
    );
  }

  if (global.gc) global.gc();
  const rssBefore10 = rssMb();
  ctx.resetByteStats();
  console.log("\n10 rooms × 10 players (concurrent)");
  const t0 = Date.now();
  const concurrent = await Promise.all(
    Array.from({ length: 10 }, () => playGame(url, 10, null, () => 0))
  );
  const elapsed = Date.now() - t0;
  const totalBytes = ctx.byteStats.emitBytes;
  const rssAfter10 = rssMb();
  const p95All = p95(concurrent.flatMap((r) => [])); // acks not combined; recompute below
  // playGame with null reset still collected per-game acks
  const allAcks = []; // not available from playGame return except p95; use mean of p95s
  const meanP95 = concurrent.reduce((s, r) => s + r.p95AckMs, 0) / concurrent.length;
  console.log(
    `  total outbound ${mb(totalBytes).toFixed(2)} MB  (${mb(totalBytes / 10).toFixed(2)} MB/room avg)  RSS ${rssAfter10.toFixed(1)} MB (Δ ${(rssAfter10 - rssBefore10).toFixed(1)} MB, ~${((rssAfter10 - rssBefore10) / 10).toFixed(1)} MB/room)  mean p95 ack ${meanP95.toFixed(1)} ms  elapsed ${elapsed} ms`
  );
  console.log(`  event mix: ${JSON.stringify(ctx.byteStats.byEvent)}`);

  for (const s of ["server", "io"]) {
    /* close below */
  }
  await new Promise((resolve) => {
    ctx.io.close();
    ctx.server.close(() => resolve());
  });

  const summary = {
    single: results.map((r) => ({
      players: r.players,
      outboundMb: Number(r.outboundMb.toFixed(3)),
      beforeMb: baseline[r.players],
      pctOfBefore: Number(((r.outboundMb / baseline[r.players]) * 100).toFixed(1)),
      rssMb: Number(r.rssAfter.toFixed(1)),
      p95AckMs: Number(r.p95AckMs.toFixed(1)),
    })),
    tenByTen: {
      totalOutboundMb: Number(mb(totalBytes).toFixed(2)),
      avgOutboundMbPerRoom: Number(mb(totalBytes / 10).toFixed(2)),
      rssMb: Number(rssAfter10.toFixed(1)),
      rssDeltaMb: Number((rssAfter10 - rssBefore10).toFixed(1)),
      approxRssMbPerRoom: Number(((rssAfter10 - rssBefore10) / 10).toFixed(1)),
      meanP95AckMs: Number(meanP95.toFixed(1)),
      elapsedMs: elapsed,
      events: ctx.byteStats.byEvent,
    },
  };
  const outPath = require("path").join(__dirname, "..", "scripts", "bandwidth-results.json");
  require("fs").writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n");
  console.log(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
