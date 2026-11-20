const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { loadPlayers } = require("./players");
const { GameRoom, makeRoomCode, normalizeName } = require("./game");
const { DEFAULT_PURSE_LAKHS, MIN_PLAYERS, MAX_PLAYERS } = require("./rules");

const PORT = Number(process.env.PORT) || 3000;
const { meta, players } = loadPlayers();

const app = express();
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, players: players.length, defaultPurseLakhs: DEFAULT_PURSE_LAKHS });
});
app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

const rooms = new Map();

function getRoom(code) {
  if (!code) return null;
  return rooms.get(String(code).trim().toUpperCase()) || null;
}

function pushState(room) {
  const chan = io.to(room.code);
  for (const [, sock] of io.of("/").sockets) {
    if (sock.data && sock.data.code === room.code && sock.data.name) {
      sock.emit("state", room.getState(sock.data.name));
    }
  }
  // Spectators / not-yet-named still get a generic snapshot if they joined the socket room.
  chan.emit("room:meta", { code: room.code, phase: room.phase, count: room.franchises.length });
}

function bindRoom(room) {
  room.on("update", () => pushState(room));
}

function attach(socket, room, name) {
  if (socket.data.code && socket.data.code !== room.code) {
    socket.leave(socket.data.code);
  }
  socket.data.code = room.code;
  socket.data.name = name;
  socket.join(room.code);
  socket.emit("state", room.getState(name));
}

io.on("connection", (socket) => {
  socket.data = { code: null, name: null };

  socket.on("createRoom", (payload = {}, cb) => {
    const name = normalizeName(payload.name);
    if (!name) return cb && cb({ ok: false, error: "Enter a display name." });
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
    rooms.set(code, room);
    bindRoom(room);
    const result = room.addPlayer(name, socket.id);
    if (!result.ok) {
      room.destroy();
      rooms.delete(code);
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

  socket.on("disconnect", () => {
    const room = getRoom(socket.data.code);
    if (!room) return;
    room.disconnect(socket.id);
    if (room.phase === "lobby" && room.franchises.every((f) => !f.connected)) {
      setTimeout(() => {
        if (room.phase === "lobby" && room.franchises.every((f) => !f.connected)) {
          room.destroy();
          rooms.delete(room.code);
        }
      }, 60_000);
    }
  });
});

function start(port = PORT) {
  return new Promise((resolve) => {
    server.listen(port, "0.0.0.0", () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      console.log(`IPL Auction listening on http://localhost:${actual}`);
      resolve({ server, io, rooms, port: actual });
    });
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { start, app, server, io, rooms, players, MIN_PLAYERS, MAX_PLAYERS };
