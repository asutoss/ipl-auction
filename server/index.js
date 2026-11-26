const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { loadPlayers } = require("./players");
const { GameRoom, normalizeName } = require("./game");
const { RoomManager, makeRoomCode, ROOM_CODE_LENGTH } = require("./manager");
const { DEFAULT_PURSE_LAKHS, DEFAULT_PURSE_POINTS, MIN_PLAYERS, MAX_PLAYERS, getMode, DEFAULT_MODE, listModes } = require("./rules");

const PORT = Number(process.env.PORT) || 3000;
const DEFLATE_THRESHOLD = Number(process.env.DEFLATE_THRESHOLD) || 256;
const { meta, players } = loadPlayers();

const app = express();
const publicDir = path.join(__dirname, "..", "public");
const { normalizeRoomCode } = require("../public/room-link");
app.use("/logos", express.static(path.join(publicDir, "logos"), { maxAge: "7d", etag: true }));
app.use("/loader", express.static(path.join(__dirname, "..", "loader"), { index: false, maxAge: "1h", etag: true }));
app.use(express.static(publicDir, { index: false }));

function allowHealthCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

app.options("/healthz", (_req, res) => {
  allowHealthCors(res);
  res.status(204).end();
});
app.get("/healthz", (_req, res) => {
  allowHealthCors(res);
  res.type("json").send('{"ok":true}');
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true },
  perMessageDeflate: { threshold: DEFLATE_THRESHOLD },
});

const manager = new RoomManager();
const rooms = manager.rooms;

const byteStats = { emitBytes: 0, emitCount: 0, byEvent: {} };

function resetByteStats() {
  byteStats.emitBytes = 0;
  byteStats.emitCount = 0;
  byteStats.byEvent = {};
}

function countEmit(ev, args) {
  if (!ev || ev === "newListener" || ev === "removeListener") return;
  try {
    const payload = args.filter((a) => typeof a !== "function");
    const size = Buffer.byteLength(JSON.stringify([ev, ...payload]), "utf8");
    byteStats.emitBytes += size;
    byteStats.emitCount += 1;
    byteStats.byEvent[ev] = (byteStats.byEvent[ev] || 0) + 1;
  } catch (_) {
    /* ignore */
  }
}

io.on("connection", (socket) => {
  const orig = socket.emit;
  socket.emit = function hookedEmit(ev, ...args) {
    countEmit(ev, args);
    return orig.call(this, ev, ...args);
  };
});

function getRoom(code) {
  return manager.get(code);
}

function clientKeys(socket) {
  const hdr = socket.handshake.headers["x-forwarded-for"];
  const ip = (hdr ? String(hdr).split(",")[0].trim() : null) || socket.handshake.address || "unknown";
  return [ip, socket.id];
}

function pushSnapshot(room) {
  for (const [, sock] of io.of("/").sockets) {
    if (sock.data && sock.data.code === room.code && sock.data.name) {
      sock.emit("state", room.getState(sock.data.name));
    }
  }
}

function bindRoom(room) {
  room.on("snapshot", (reason) => {
    pushSnapshot(room);
    if (reason === "results") manager.onResults(room);
  });
  room.on("delta", (evt) => {
    // Emit per socket so outbound-byte accounting matches the pre-delta
    // method (payload × recipients) and stays consistent with snapshots.
    for (const [, sock] of io.of("/").sockets) {
      if (sock.data && sock.data.code === room.code) {
        sock.emit("delta", room.personalizeDelta ? room.personalizeDelta(evt, sock.data.name) : evt);
      }
    }
  });
  room.on("emote", (evt) => {
    for (const [, sock] of io.of("/").sockets) {
      if (sock.data && sock.data.code === room.code) {
        sock.emit("emote", evt);
      }
    }
  });
  room.on("quickChat", (evt) => {
    for (const [, sock] of io.of("/").sockets) {
      if (sock.data && sock.data.code === room.code) {
        sock.emit("quickChat", evt);
      }
    }
  });
  room.on("ended", (info) => {
    for (const [, sock] of io.of("/").sockets) {
      if (sock.data && sock.data.code === room.code) {
        sock.emit("gameEnded", { ok: true, ...(info || {}) });
        sock.data.code = null;
      }
    }
    manager.evict(room.code, "ended");
  });
}

function attach(socket, room, name) {
  if (socket.data.code && socket.data.code !== room.code) {
    socket.leave(socket.data.code);
  }
  socket.data.code = room.code;
  socket.data.name = name;
  socket.join(room.code);
  socket.emit("state", room.getState(name));
  manager.onPlayerConnected(room);
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    players: players.length,
    rooms: manager.count(),
    maxRooms: manager.maxRooms,
    defaultPurseLakhs: DEFAULT_PURSE_LAKHS,
    defaultPursePoints: DEFAULT_PURSE_POINTS,
    modes: listModes(),
    defaultMode: DEFAULT_MODE,
    roomCodeLength: ROOM_CODE_LENGTH,
  });
});

app.get("/api/rooms/:code/matches", (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ ok: false, error: "Room not found." });
  const matches = room.getMatches();
  if (!matches) return res.status(404).json({ ok: false, error: "Tournament results are not ready yet." });
  res.json({ ok: true, ...matches });
});

app.get("/api/rooms/:code", (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  if (!code) return res.status(404).json({ ok: false, status: "missing", error: "Room not found." });
  const info = manager.lookup(code);
  if (info.status === "missing") return res.status(404).json(info);
  res.json(info);
});

function requestOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim() || "https";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0].trim();
  return `${proto}://${host}`;
}

let indexHtmlCache = null;
function loadIndexHtml() {
  if (!indexHtmlCache) {
    indexHtmlCache = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  }
  return indexHtmlCache;
}

function sendIndex(req, res) {
  const origin = requestOrigin(req);
  const code = normalizeRoomCode(req.params && req.params.code) || normalizeRoomCode(req.query.room) || normalizeRoomCode(req.query.code);
  const pageUrl = code ? `${origin}/r/${code}` : `${origin}/`;
  const html = loadIndexHtml()
    .replaceAll("__OG_URL__", pageUrl)
    .replaceAll("__OG_IMAGE__", `${origin}/og-image.png`);
  res.type("html").send(html);
}

app.get("/r/:code", sendIndex);
app.get(["/", "*"], sendIndex);

io.on("connection", (socket) => {
  socket.data = { code: null, name: null };

  socket.on("createRoom", (payload = {}, cb) => {
    const name = normalizeName(payload.name);
    if (!name) return cb && cb({ ok: false, error: "Enter a team name." });
    const limited = manager.allowCreate(clientKeys(socket));
    if (!limited.ok) return cb && cb(limited);
    if (!manager.canAcceptRoom()) return cb && cb(manager.roomCapError());

    const code = makeRoomCode({ has: (c) => manager.isCodeTaken(c) });
    const modeId = payload.mode != null && payload.mode !== "" ? payload.mode : DEFAULT_MODE;
    const mode = getMode(modeId);
    if (!mode) return cb && cb({ ok: false, error: "Unknown game type. Choose Classical, Rapid, or Bullet." });
    const rawPurse = payload.pursePoints != null ? payload.pursePoints : payload.purseCrore;
    const purseLakhs = Number.isFinite(Number(rawPurse)) ? Math.round(Number(rawPurse)) : mode.purse;
    const timers = {};
    if (process.env.ALLOW_TEST_TIMERS === "1" && payload.testTimers) {
      if (payload.testTimers.lotStartMs) timers.lotStartMs = Number(payload.testTimers.lotStartMs);
      if (payload.testTimers.bidMs) timers.bidMs = Number(payload.testTimers.bidMs);
      if (payload.testTimers.captainMs) timers.captainMs = Number(payload.testTimers.captainMs);
      if (payload.testTimers.soldRevealMs != null && Number.isFinite(Number(payload.testTimers.soldRevealMs))) {
        timers.soldRevealMs = Math.max(0, Number(payload.testTimers.soldRevealMs));
      }
      if (payload.testTimers.powerRevealMs != null && Number.isFinite(Number(payload.testTimers.powerRevealMs))) {
        timers.powerRevealMs = Math.max(0, Number(payload.testTimers.powerRevealMs));
      }
      if (payload.testTimers.lastTeamFillMs != null && Number.isFinite(Number(payload.testTimers.lastTeamFillMs))) {
        timers.lastTeamFillMs = Math.max(0, Number(payload.testTimers.lastTeamFillMs));
      }
      if (payload.testTimers.playerIntroMs != null && Number.isFinite(Number(payload.testTimers.playerIntroMs))) {
        timers.playerIntroMs = Math.max(0, Number(payload.testTimers.playerIntroMs));
      }
      if (payload.testTimers.resultsRevealStepMs != null && Number.isFinite(Number(payload.testTimers.resultsRevealStepMs))) {
        timers.resultsRevealStepMs = Math.max(0, Number(payload.testTimers.resultsRevealStepMs));
      }
      if (payload.testTimers.formBoostRevealMs != null && Number.isFinite(Number(payload.testTimers.formBoostRevealMs))) {
        timers.formBoostRevealMs = Math.max(0, Number(payload.testTimers.formBoostRevealMs));
      }
      if (payload.testTimers.finalMatchMs != null && Number.isFinite(Number(payload.testTimers.finalMatchMs))) {
        timers.finalMatchMs = Math.max(0, Number(payload.testTimers.finalMatchMs));
      }
      if (payload.testTimers.autofillRevealMs != null && Number.isFinite(Number(payload.testTimers.autofillRevealMs))) {
        timers.autofillRevealMs = Math.max(0, Number(payload.testTimers.autofillRevealMs));
      }
    }
    const room = new GameRoom({
      code,
      purseLakhs,
      timers,
      allPlayers: players,
      meta,
      mode: mode.id,
    });
    room.isSocketLive = (id) => {
      const sock = io.sockets.sockets.get(id);
      return Boolean(sock && sock.connected);
    };
    manager.add(room);
    bindRoom(room);
    const result = room.addPlayer(name, socket.id);
    if (!result.ok) {
      manager.evict(code, "create-failed");
      return cb && cb(result);
    }
    attach(socket, room, result.name);
    cb && cb({ ok: true, code, name: result.name, rejoinKey: result.rejoinKey });
  });

  socket.on("joinRoom", (payload = {}, cb) => {
    const name = normalizeName(payload.name);
    const code = String(payload.code || "").trim().toUpperCase();
    if (!name) return cb && cb({ ok: false, error: "Enter a team name." });
    const room = getRoom(code);
    if (!room) {
      const info = manager.lookup(code);
      if (info.status === "ended") {
        return cb && cb({ ok: false, error: "This game is done.", status: "ended" });
      }
      return cb && cb({ ok: false, error: "No room with that code.", status: "missing" });
    }
    const rejoinKey = typeof payload.rejoinKey === "string" ? payload.rejoinKey.slice(0, 64) : null;
    const result = room.addPlayer(name, socket.id, { rejoinKey });
    if (!result.ok) return cb && cb(result);
    attach(socket, room, result.name);
    cb && cb({ ok: true, code: room.code, name: result.name, rejoined: result.rejoined, rejoinKey: result.rejoinKey });
  });

  socket.on("setBidTimer", (payload = {}, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    cb && cb(room.setBidTimer(socket.data.name, payload.seconds));
  });

  socket.on("setPurse", (payload = {}, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.setPurse(socket.data.name, payload.pursePoints != null ? payload.pursePoints : payload.purseCrore);
    cb && cb(result);
  });

  socket.on("startAuction", (_payload, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.startAuction(socket.data.name);
    cb && cb(result);
  });

  socket.on("bid", (payload = {}, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.bid(socket.data.name, payload.amountLakhs);
    cb && cb(result);
  });

  socket.on("optOut", (_payload, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.optOut(socket.data.name);
    cb && cb(result);
  });

  socket.on("selectCaptain", (payload = {}, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.selectCaptain(socket.data.name, payload.playerId);
    cb && cb(result);
  });

  socket.on("buyBooster", (payload = {}, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.buyBooster(socket.data.name, payload.boosterId, payload.targetName);
    cb && cb(result);
  });

  socket.on("skipFormBoostReveal", (_payload, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.skipFormBoostReveal(socket.data.name);
    cb && cb(result);
  });

  socket.on("getMatches", (_payload, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const matches = room.getMatches();
    if (!matches) return cb && cb({ ok: false, error: "Tournament results are not ready yet." });
    cb && cb({ ok: true, ...matches });
  });


  function pickCharacter(payload = {}, cb) {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const id = (payload && (payload.characterId || payload.identityId)) || null;
    const result = room.selectCharacter(socket.data.name, id);
    cb && cb(result);
  }
  socket.on("selectCharacter", pickCharacter);
  socket.on("selectIdentity", pickCharacter);

  socket.on("pause", (_payload, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.pause(socket.data.name);
    cb && cb(result);
  });

  socket.on("resume", (_payload, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.resume(socket.data.name);
    cb && cb(result);
  });

  socket.on("continueReveal", (_payload, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.continueReveal(socket.data.name);
    cb && cb(result);
  });

  socket.on("skipResultsReveal", (_payload, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.skipResultsReveal(socket.data.name);
    cb && cb(result);
  });

  socket.on("usePower", (payload = {}, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.usePower(socket.data.name, payload);
    cb && cb(result);
  });

  socket.on("pickPowerTarget", (payload = {}, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.pickPowerTarget(socket.data.name, payload);
    cb && cb(result);
  });

  socket.on("resolvePowerChoice", (payload = {}, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.resolvePowerChoice(socket.data.name, payload);
    cb && cb(result);
  });

  socket.on("endChaiBreak", (_payload, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.endChaiBreak(socket.data.name);
    cb && cb(result);
  });

  socket.on("quickChat", (payload = {}, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.quickChat(socket.data.name, payload.lineId);
    cb && cb(result);
  });

  socket.on("emote", (payload = {}, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.emote(socket.data.name, payload.emoteId);
    cb && cb(result);
  });

  socket.on("endGame", (_payload, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.endGame(socket.data.name);
    cb && cb(result);
  });

  socket.on("leaveRoom", (_payload, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.leave(socket.data.name);
    socket.leave(room.code);
    socket.data.code = null;
    cb && cb(result);
  });

  socket.on("disconnect", () => {
    const room = getRoom(socket.data.code);
    if (!room) return;
    room.disconnect(socket.id);
    if (room.franchises.every((f) => !f.connected)) {
      manager.onAllDisconnected(room);
    }
  });
});

function start(port = PORT) {
  return new Promise((resolve) => {
    server.listen(port, "0.0.0.0", () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      console.log(`IPL Auction listening on http://localhost:${actual}`);
      resolve({
        server,
        io,
        rooms,
        manager,
        port: actual,
        byteStats,
        resetByteStats,
      });
    });
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  start,
  app,
  server,
  io,
  rooms,
  manager,
  players,
  byteStats,
  resetByteStats,
  MIN_PLAYERS,
  MAX_PLAYERS,
  ROOM_CODE_LENGTH,
};
