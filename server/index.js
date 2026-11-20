const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { loadPlayers } = require("./players");
const { GameRoom, normalizeName } = require("./game");
const { RoomManager, makeRoomCode, ROOM_CODE_LENGTH } = require("./manager");
const { DEFAULT_PURSE_LAKHS, MIN_PLAYERS, MAX_PLAYERS } = require("./rules");

const PORT = Number(process.env.PORT) || 3000;
const DEFLATE_THRESHOLD = Number(process.env.DEFLATE_THRESHOLD) || 256;
const { meta, players } = loadPlayers();

const app = express();
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

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
        sock.emit("delta", evt);
      }
    }
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

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

io.on("connection", (socket) => {
  socket.data = { code: null, name: null };

  socket.on("createRoom", (payload = {}, cb) => {
    const name = normalizeName(payload.name);
    if (!name) return cb && cb({ ok: false, error: "Enter a display name." });
    const limited = manager.allowCreate(clientKeys(socket));
    if (!limited.ok) return cb && cb(limited);
    if (!manager.canAcceptRoom()) return cb && cb(manager.roomCapError());

    const code = makeRoomCode(rooms);
    const purseCrore = payload.purseCrore != null ? Number(payload.purseCrore) : 100;
    const purseLakhs = Number.isFinite(purseCrore) ? Math.round(purseCrore * 100) : DEFAULT_PURSE_LAKHS;
    const timers = {};
    if (process.env.ALLOW_TEST_TIMERS === "1" && payload.testTimers) {
      if (payload.testTimers.bidMs) timers.bidMs = Number(payload.testTimers.bidMs);
      if (payload.testTimers.captainMs) timers.captainMs = Number(payload.testTimers.captainMs);
    }
    const room = new GameRoom({
      code,
      purseLakhs,
      timers,
      allPlayers: players,
      meta,
    });
    manager.add(room);
    bindRoom(room);
    const result = room.addPlayer(name, socket.id);
    if (!result.ok) {
      manager.evict(code, "create-failed");
      return cb && cb(result);
    }
    attach(socket, room, result.name);
    cb && cb({ ok: true, code, name: result.name });
  });

  socket.on("joinRoom", (payload = {}, cb) => {
    const name = normalizeName(payload.name);
    const code = String(payload.code || "").trim().toUpperCase();
    if (!name) return cb && cb({ ok: false, error: "Enter a display name." });
    const room = getRoom(code);
    if (!room) return cb && cb({ ok: false, error: "No room with that code." });
    const result = room.addPlayer(name, socket.id);
    if (!result.ok) return cb && cb(result);
    attach(socket, room, result.name);
    cb && cb({ ok: true, code: room.code, name: result.name, rejoined: result.rejoined });
  });

  socket.on("setPurse", (payload = {}, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const result = room.setPurse(socket.data.name, payload.purseCrore);
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

  socket.on("getMatches", (_payload, cb) => {
    const room = getRoom(socket.data.code);
    if (!room) return cb && cb({ ok: false, error: "Join a room first." });
    const matches = room.getMatches();
    if (!matches) return cb && cb({ ok: false, error: "Tournament results are not ready yet." });
    cb && cb({ ok: true, ...matches });
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
