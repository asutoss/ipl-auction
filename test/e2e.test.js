const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");

process.env.ALLOW_TEST_TIMERS = "1";
process.env.BID_TIMER_MS = process.env.BID_TIMER_MS || "250";
process.env.CAPTAIN_TIMER_MS = process.env.CAPTAIN_TIMER_MS || "250";
process.env.PLAYER_INTRO_MS = process.env.PLAYER_INTRO_MS || "0";
process.env.RESULTS_REVEAL_STEP_MS = process.env.RESULTS_REVEAL_STEP_MS || "0";
if (process.env.CREATE_LIMIT == null) process.env.CREATE_LIMIT = "0";

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

  const stop = Date.now() + 35000;
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
      testTimers: { lotStartMs: 80, bidMs: 80, captainMs: 300, soldRevealMs: 0, lastTeamFillMs: 0, playerIntroMs: 0, resultsRevealStepMs: 0 },
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

describe("characters, pause, start bid and end game over sockets", () => {
  let ctx;
  let url;
  const sockets = [];

  test("unique characters, random start bid, single-team close, pause, and host end game", async () => {
    ctx = await start({ port: 0 });
    url = `http://127.0.0.1:${ctx.server.address().port}`;
    const ash = await connect(url, "Ashutosh");
    const priya = await connect(url, "Priya");
    const rohan = await connect(url, "Rohan");
    sockets.push(ash, priya, rohan);

    const created = await ack(ash, "createRoom", {
      name: "Ashutosh",
      testTimers: { lotStartMs: 800, bidMs: 800, captainMs: 800, soldRevealMs: 0, lastTeamFillMs: 0, playerIntroMs: 0, resultsRevealStepMs: 0 },
    });
    assert.equal(created.ok, true);
    const code = created.code;
    assert.equal((await ack(priya, "joinRoom", { code, name: "Priya" })).ok, true);
    assert.equal((await ack(rohan, "joinRoom", { code, name: "Rohan" })).ok, true);

    await waitState(ash, (s) => s.franchises && s.franchises.length === 3);
    const catalog = ash.state.characters || ash.state.identities || [];
    assert.equal(catalog.length, 15);
    assert.equal(new Set(catalog.map((t) => t.color.toLowerCase())).size, 15);
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
    assert.ok(free, "need a free character");
    const picked = await ack(priya, "selectCharacter", { characterId: free.id });
    assert.equal(picked.ok, true);
    await waitState(priya, (s) => s.you && s.you.franchise.id === free.id);
    assert.notEqual(ash.state.you.franchise.id, priya.state.you.franchise.id);

    const started = await ack(ash, "startAuction");
    assert.equal(started.ok, true);
    const lot = await waitState(ash, (s) => s.phase === "auction" && s.auction && s.auction.nominee);
    const startBid = lot.auction.startBidLakhs;
    assert.ok(Number.isInteger(startBid) && startBid >= 1 && startBid <= 5, String(startBid));
    assert.equal(lot.auction.currentBidLakhs, startBid);
    assert.ok(Array.isArray(lot.auction.lotSnapshot) && lot.auction.lotSnapshot.length === 3);
    for (const row of lot.auction.lotSnapshot) {
      assert.equal(typeof row.purseLakhs, "number");
      assert.equal(typeof row.pending, "number");
      assert.ok(row.characterId || row.identityId);
      assert.equal(row.characterId, row.identityId);
    }
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

describe("emote broadcast over sockets", () => {
  let ctx;
  const sockets = [];

  test("validates, broadcasts {teamId, emoteId}, and allows a burst of emotes", async () => {
    ctx = await start(0);
    const url = `http://127.0.0.1:${ctx.server.address().port}`;
    const ash = await connect(url, "Ashutosh");
    const priya = await connect(url, "Priya");
    sockets.push(ash, priya);
    const created = await ack(ash, "createRoom", {
      name: "Ashutosh",
      testTimers: { lotStartMs: 20000, bidMs: 20000, captainMs: 8000, soldRevealMs: 0, lastTeamFillMs: 0, playerIntroMs: 0, resultsRevealStepMs: 0 },
    });
    assert.equal(created.ok, true);
    assert.equal((await ack(priya, "joinRoom", { code: created.code, name: "Priya" })).ok, true);
    assert.equal((await ack(ash, "startAuction")).ok, true);
    await waitState(ash, (s) => s.phase === "auction" && s.auction && s.auction.nominee);
    await waitState(priya, (s) => s.phase === "auction" && s.auction);

    const unknown = await ack(ash, "emote", { emoteId: "not-real" });
    assert.equal(unknown.ok, false);
    assert.match(unknown.error || "", /unknown emote/i);

    const seen = [];
    const got = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no emote broadcast")), 3000);
      function onEmote(evt) {
        seen.push({ who: this.playerName, evt });
        if (seen.length >= 2) {
          clearTimeout(t);
          resolve(seen);
        }
      }
      ash.on("emote", onEmote);
      priya.on("emote", onEmote);
    });
    const sent = await ack(priya, "emote", { emoteId: "laugh" });
    assert.equal(sent.ok, true);
    assert.equal(sent.teamId, "priya");
    assert.equal(sent.emoteId, "laugh");
    const events = await got;
    assert.equal(events.length, 2);
    for (const row of events) {
      assert.deepEqual(row.evt, { teamId: "priya", emoteId: "laugh" });
    }
    const again = await ack(priya, "emote", { emoteId: "fire" });
    assert.equal(again.ok, true, again.error);
    assert.equal(again.emoteId, "fire");
  });

  after(async () => {
    for (const s of sockets) {
      try { s.close(); } catch {}
    }
    if (ctx?.io) ctx.io.close();
    if (ctx?.server) await new Promise((resolve) => ctx.server.close(() => resolve()));
  });
});

const { loadPlayers } = require("../server/players");
const { players: allPlayers } = loadPlayers();

describe("e2e: Kim wipe updates every client's squad", () => {
  let ctx;
  const sockets = [];

  test("victim, Kim, a spectator, and a rejoiner all drop the wiped player", async () => {
    ctx = await start(0);
    const url = `http://127.0.0.1:${ctx.port}`;
    const kim = await connect(url, "Kim");
    const victim = await connect(url, "Victim");
    const spectator = await connect(url, "Spectator");
    sockets.push(kim, victim, spectator);

    const created = await ack(kim, "createRoom", {
      name: "Kim",
      testTimers: {
        lotStartMs: 60_000,
        bidMs: 60_000,
        captainMs: 60_000,
        soldRevealMs: 0,
        lastTeamFillMs: 0,
        playerIntroMs: 0,
        resultsRevealStepMs: 0,
        powerRevealMs: 0,
      },
    });
    assert.equal(created.ok, true, created.error);
    const code = created.code;
    assert.equal((await ack(victim, "joinRoom", { code, name: "Victim" })).ok, true);
    assert.equal((await ack(spectator, "joinRoom", { code, name: "Spectator" })).ok, true);
    assert.equal((await ack(kim, "selectCharacter", { characterId: "kim-jong-un", identityId: "kim-jong-un" })).ok, true);
    assert.equal((await ack(victim, "selectCharacter", { characterId: "ravi-kishan", identityId: "ravi-kishan" })).ok, true);
    assert.equal((await ack(spectator, "selectCharacter", { characterId: "narendra-modi", identityId: "narendra-modi" })).ok, true);
    assert.equal((await ack(kim, "startAuction")).ok, true);
    await waitState(kim, (s) => s.phase === "auction" && s.auction && s.auction.nominee);
    await waitState(victim, (s) => s.phase === "auction" && s.you);

    const room = ctx.manager.get(code);
    assert.ok(room);
    const used = new Set();
    const take = (role) => {
      const p = allPlayers.find((x) => x.role === role && !used.has(x.id));
      used.add(p.id);
      return p;
    };
    const given = [take("BAT"), take("WK"), take("AR")];
    const team = room.findByName("Victim");
    for (const p of given) {
      team.squad.push({ player: p, priceLakhs: 8 });
      team.spentLakhs = (Number(team.spentLakhs) || 0) + 8;
      room.soldIds.add(p.id);
      room.soldLog.push({ player: p, priceLakhs: 8, buyerName: "Victim" });
    }
    team.spentLakhs = 24;
    room.rng.int = () => 0;
    room.bump("auction");
    await waitState(victim, (s) => (s.you?.squad || []).length === 3);

    assert.equal((await ack(kim, "usePower")).ok, true);
    await waitState(kim, (s) => Boolean(s.powerWait && s.powerWait.options && s.powerWait.options.length));
    const target = kim.state.powerWait.options.find((o) => o.name === "Victim");
    assert.ok(target && target.key);
    const picked = await ack(kim, "pickPowerTarget", { targetKey: target.key });
    assert.equal(picked.ok, true, picked.error);

    const dropped = (state) => {
      const team = state.you?.name === "Victim" ? state.you : (state.franchises || []).find((f) => f.name === "Victim");
      return (team && team.squad) || [];
    };
    await waitState(victim, (s) => dropped(s).length === 2);
    await waitState(kim, (s) => dropped(s).length === 2);
    await waitState(spectator, (s) => dropped(s).length === 2);

    const serverIds = room.findByName("Victim").squad.map((s) => s.player.id);
    const wiped = given.map((p) => p.id).filter((id) => !serverIds.includes(id));
    assert.equal(wiped.length, 1);
    for (const s of [kim, victim, spectator]) {
      const ids = dropped(s.state).map((row) => row.player.id);
      assert.deepEqual(ids, serverIds, `${s.playerName} still shows a wiped player`);
      assert.ok(!ids.includes(wiped[0]));
    }
    assert.ok(room.queue.some((p) => p.id === wiped[0]));

    victim.disconnect();
    const again = await connect(url, "Victim");
    sockets.push(again);
    const rejoined = await ack(again, "joinRoom", { code, name: "Victim" });
    assert.equal(rejoined.ok, true, rejoined.error);
    const fresh = await waitState(again, (s) => s.you?.name === "Victim" && Array.isArray(s.you.squad));
    assert.deepEqual(fresh.you.squad.map((s) => s.player.id), serverIds);
    assert.ok(!fresh.you.squad.some((s) => s.player.id === wiped[0]));
  });

  after(async () => {
    for (const s of sockets) {
      try { s.close(); } catch {}
    }
    if (ctx?.io) ctx.io.close();
    if (ctx?.server) await new Promise((resolve) => ctx.server.close(() => resolve()));
  });
});

const http = require("http");
const { parseRoomCode, roomUrl, shareMessage } = require("../public/room-link");

function httpGet(urlPath, { port, headers } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: urlPath, headers: headers || {} }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on("error", reject);
  });
}

describe("e2e: room links, join via URL, and ended rooms", () => {
  let ctx;
  let sockets = [];
  let url;
  let port;

  async function startFresh() {
    for (const s of sockets) {
      try { s.close(); } catch {}
    }
    sockets = [];
    if (ctx?.io) ctx.io.close();
    if (ctx?.server) await new Promise((resolve) => ctx.server.close(() => resolve()));
    ctx = await start(0);
    ctx.manager.createLimit = 0;
    port = ctx.port;
    url = `http://127.0.0.1:${port}`;
  }

  test("shareable /r/CODE route, OG tags, join without typing a code, and ended/missing states", async () => {
    await startFresh();
    const origin = `http://127.0.0.1:${port}`;
    const host = await connect(url, "Host");
    sockets.push(host);
    const created = await ack(host, "createRoom", { name: "Host", mode: "classical" });
    assert.equal(created.ok, true, created.error);
    const code = created.code;
    const invite = roomUrl(origin, code);
    assert.equal(invite, `${origin}/r/${code}`);
    assert.equal(parseRoomCode(invite), code);
    assert.equal(shareMessage(invite), `Join my IPL Auction room 🏏 ${invite}`);

    const page = await httpGet(`/r/${code}`, { port, headers: { host: `127.0.0.1:${port}` } });
    assert.equal(page.status, 200);
    assert.match(page.body, /og:title/);
    assert.match(page.body, /IPL Auction Night/);
    assert.match(page.body, /og:image/);
    assert.match(page.body, new RegExp(`/og-image\\.png`));
    assert.match(page.body, new RegExp(`/r/${code}`));

    const queryPage = await httpGet(`/?room=${code}`, { port });
    assert.equal(queryPage.status, 200);
    assert.match(queryPage.body, /og:title/);

    const open = await httpGet(`/api/rooms/${code}`, { port });
    assert.equal(open.status, 200);
    const openBody = JSON.parse(open.body);
    assert.equal(openBody.status, "open");
    assert.equal(openBody.code, code);
    assert.equal(openBody.phase, "lobby");

    // Guest joins using only the code from the link (no manual code entry).
    const guest = await connect(url, "Guest");
    sockets.push(guest);
    const joined = await ack(guest, "joinRoom", { name: "Guest", code: parseRoomCode(invite) });
    assert.equal(joined.ok, true, joined.error);
    assert.equal(joined.code, code);
    const guestState = await waitState(guest, (s) => s.phase === "lobby" && s.franchises?.some((f) => f.name === "Guest"));
    assert.equal(guestState.code, code);

    const started = await ack(host, "startAuction");
    assert.equal(started.ok, true, started.error);
    await waitState(host, (s) => s.phase === "auction");

    // Mid-game, a new name is rejected with the existing server message.
    const late = await connect(url, "Late");
    sockets.push(late);
    const lateJoin = await ack(late, "joinRoom", { name: "Late", code });
    assert.equal(lateJoin.ok, false);
    assert.match(lateJoin.error, /already started/i);

    // Same-name rejoin still works while the auction is live.
    guest.disconnect();
    const guest2 = await connect(url, "Guest");
    sockets.push(guest2);
    const rejoined = await ack(guest2, "joinRoom", { name: "Guest", code });
    assert.equal(rejoined.ok, true, rejoined.error);
    assert.equal(rejoined.rejoined, true);

    const ended = await ack(host, "endGame");
    assert.equal(ended.ok, true, ended.error);

    const endedApi = await httpGet(`/api/rooms/${code}`, { port });
    assert.equal(endedApi.status, 200);
    const endedBody = JSON.parse(endedApi.body);
    assert.equal(endedBody.status, "ended");

    const endedPage = await httpGet(`/r/${code}`, { port, headers: { host: `127.0.0.1:${port}` } });
    assert.equal(endedPage.status, 200);
    assert.match(endedPage.body, new RegExp(`/r/${code}`));

    const stray = await connect(url, "Stray");
    sockets.push(stray);
    const strayJoin = await ack(stray, "joinRoom", { name: "Stray", code });
    assert.equal(strayJoin.ok, false);
    assert.match(strayJoin.error, /game is done/i);
    assert.equal(strayJoin.status, "ended");

    // The ended code is not silently recreated as a new live room.
    assert.equal(ctx.manager.lookup(code).status, "ended");
    assert.equal(ctx.manager.get(code), null);
    assert.equal(ctx.manager.isCodeTaken(code), true);

    const missing = await httpGet("/api/rooms/ZZZZZZ", { port });
    assert.equal(missing.status, 404);
    const missingBody = JSON.parse(missing.body);
    assert.equal(missingBody.status, "missing");
    assert.match(missingBody.error, /not found/i);

    const missingJoin = await ack(stray, "joinRoom", { name: "Stray", code: "ZZZZZZ" });
    assert.equal(missingJoin.ok, false);
    assert.match(missingJoin.error, /no room/i);
  });

  test("a finished results room is reported as ended on the room link, but players can still rejoin by name", async () => {
    await startFresh();
    const a = await connect(url, "Ash");
    const b = await connect(url, "Bea");
    sockets.push(a, b);
    const created = await ack(a, "createRoom", { name: "Ash", mode: "classical" });
    assert.equal(created.ok, true, created.error);
    const code = created.code;
    assert.equal((await ack(b, "joinRoom", { code, name: "Bea" })).ok, true);
    await waitState(a, (s) => s.phase === "lobby" && s.franchises.length === 2);

    const room = ctx.manager.get(code);
    room.phase = "results";
    room.finishedAt = Date.now();
    room.auction = null;
    if (!room.tournament) {
      room.tournament = { table: [], playoffs: {}, champion: null, awards: {}, positions: [] };
    }
    room.bump("results");

    const info = await httpGet(`/api/rooms/${code}`, { port });
    assert.equal(info.status, 200);
    const body = JSON.parse(info.body);
    assert.equal(body.status, "ended");
    assert.equal(body.reason, "finished");
    assert.equal(ctx.manager.get(code) != null, true, "room stays in memory during results");

    b.disconnect();
    const b2 = await connect(url, "Bea");
    sockets.push(b2);
    const again = await ack(b2, "joinRoom", { code, name: "Bea" });
    assert.equal(again.ok, true, again.error);
    const st = await waitState(b2, (s) => s.phase === "results" && s.you?.name === "Bea");
    assert.equal(st.phase, "results");

    const newbie = await connect(url, "New");
    sockets.push(newbie);
    const blocked = await ack(newbie, "joinRoom", { code, name: "New" });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /already started/i);
  });

  after(async () => {
    for (const s of sockets) {
      try { s.close(); } catch {}
    }
    if (ctx?.io) ctx.io.close();
    if (ctx?.server) await new Promise((resolve) => ctx.server.close(() => resolve()));
  });
});
