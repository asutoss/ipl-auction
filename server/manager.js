const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const DEFAULTS = {
  maxRooms: Number(process.env.MAX_ROOMS) || 20,
  finishedTtlMs: Number(process.env.FINISHED_TTL_MS) || 30 * 60 * 1000,
  idleTtlMs: Number(process.env.IDLE_TTL_MS) || 10 * 60 * 1000,
  endedTtlMs: Number(process.env.ENDED_TTL_MS) || 6 * 60 * 60 * 1000,
  createLimit: process.env.CREATE_LIMIT == null ? 3 : Number(process.env.CREATE_LIMIT),
  createWindowMs: Number(process.env.CREATE_WINDOW_MS) || 10 * 60 * 1000,
};

function makeRoomCode(existing, length = ROOM_CODE_LENGTH) {
  const has = (code) => {
    if (!existing) return false;
    if (typeof existing.has === "function") return existing.has(code);
    return Boolean(existing[code]);
  };
  for (let attempt = 0; attempt < 80; attempt++) {
    let code = "";
    for (let i = 0; i < length; i++) {
      code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    }
    if (!has(code)) return code;
  }
  let fallback = Date.now().toString(36).toUpperCase().replace(/[01I]/g, "X");
  fallback = (fallback + "XXXXXX").slice(-length);
  return has(fallback) ? `${fallback.slice(1)}Z` : fallback;
}

/**
 * Tracks live rooms, eviction, concurrency cap, and create-rate limits.
 * `clock` may be injected for tests: { now, setTimeout, clearTimeout }.
 */
class RoomManager {
  constructor(opts = {}) {
    this.rooms = opts.rooms || new Map();
    this.maxRooms = opts.maxRooms ?? DEFAULTS.maxRooms;
    this.finishedTtlMs = opts.finishedTtlMs ?? DEFAULTS.finishedTtlMs;
    this.idleTtlMs = opts.idleTtlMs ?? DEFAULTS.idleTtlMs;
    this.createLimit = opts.createLimit ?? DEFAULTS.createLimit;
    this.createWindowMs = opts.createWindowMs ?? DEFAULTS.createWindowMs;
    this.endedTtlMs = opts.endedTtlMs ?? DEFAULTS.endedTtlMs;
    const clock = opts.clock || {};
    this.now = clock.now || Date.now;
    this.setTimeout = clock.setTimeout || setTimeout;
    this.clearTimeout = clock.clearTimeout || clearTimeout;
    this.evictTimers = new Map();
    this.createLog = new Map();
    this.evicted = [];
    this.endedRooms = opts.endedRooms || new Map();
    this.endedTimers = new Map();
  }

  normalizeCode(code) {
    return code ? String(code).trim().toUpperCase() : "";
  }

  count() {
    return this.rooms.size;
  }

  get(code) {
    const key = this.normalizeCode(code);
    if (!key) return null;
    return this.rooms.get(key) || null;
  }

  isCodeTaken(code) {
    const key = this.normalizeCode(code);
    if (!key) return true;
    if (this.rooms.has(key)) return true;
    this.pruneEnded(key);
    return this.endedRooms.has(key);
  }

  pruneEnded(code) {
    const now = this.now();
    const drop = (key, rec) => {
      if (!rec) return;
      if (now - rec.at >= this.endedTtlMs) {
        this.clearEndedTimer(key);
        this.endedRooms.delete(key);
      }
    };
    if (code) {
      const key = this.normalizeCode(code);
      drop(key, this.endedRooms.get(key));
      return;
    }
    for (const [key, rec] of [...this.endedRooms]) drop(key, rec);
  }

  clearEndedTimer(code) {
    const id = this.endedTimers.get(code);
    if (id != null) {
      this.clearTimeout(id);
      this.endedTimers.delete(code);
    }
  }

  rememberEnded(code, info = {}) {
    const key = this.normalizeCode(code);
    if (!key) return null;
    const rec = {
      status: info.status || "ended",
      reason: info.reason || "ended",
      phase: info.phase || null,
      at: this.now(),
    };
    this.endedRooms.set(key, rec);
    this.clearEndedTimer(key);
    const remaining = this.endedTtlMs;
    if (remaining <= 0) return rec;
    const id = this.setTimeout(() => {
      this.endedTimers.delete(key);
      this.endedRooms.delete(key);
    }, remaining);
    if (id && typeof id.unref === "function") id.unref();
    this.endedTimers.set(key, id);
    return rec;
  }

  /**
   * Public room-link status. Live lobby/auction rooms are "open".
   * Finished or host-ended rooms (and a memory of evicted ones) are "ended".
   * Unknown or expired-before-start codes are "missing".
   */
  lookup(code) {
    const key = this.normalizeCode(code);
    if (!key) return { ok: false, status: "missing", error: "Room not found." };
    const room = this.get(key);
    if (room) {
      const finished = Boolean(room.ended || room.phase === "ended" || room.phase === "results");
      if (finished) {
        return {
          ok: true,
          status: "ended",
          code: room.code,
          phase: room.phase,
          reason: room.phase === "results" ? "finished" : "ended",
        };
      }
      return { ok: true, status: "open", code: room.code, phase: room.phase || "lobby" };
    }
    this.pruneEnded(key);
    const rec = this.endedRooms.get(key);
    if (rec) {
      if (rec.status === "ended") {
        return { ok: true, status: "ended", code: key, reason: rec.reason, phase: rec.phase };
      }
      return { ok: false, status: "missing", code: key, reason: rec.reason, error: "Room not found." };
    }
    return { ok: false, status: "missing", error: "Room not found." };
  }

  canAcceptRoom() {
    return this.rooms.size < this.maxRooms;
  }

  roomCapError() {
    return {
      ok: false,
      error: `This server is at capacity (${this.maxRooms} live rooms). Please try again in a few minutes.`,
    };
  }

  /**
   * Rate-limit room creation. `keys` are typically [ip, socketId].
   * A limit of 0 disables the check. Returns { ok } or a friendly error.
   */
  allowCreate(keys) {
    if (!this.createLimit || this.createLimit <= 0) return { ok: true };
    const now = this.now();
    const list = Array.isArray(keys) ? keys.filter(Boolean) : [keys];
    for (const key of list) {
      const prior = (this.createLog.get(key) || []).filter((t) => now - t < this.createWindowMs);
      if (prior.length >= this.createLimit) {
        return {
          ok: false,
          error: "You're creating rooms too quickly. Please wait a few minutes and try again.",
        };
      }
    }
    for (const key of list) {
      const prior = (this.createLog.get(key) || []).filter((t) => now - t < this.createWindowMs);
      prior.push(now);
      this.createLog.set(key, prior);
    }
    return { ok: true };
  }

  add(room) {
    this.rooms.set(room.code, room);
    room.managerMeta = { addedAt: this.now() };
  }

  clearEvictTimer(code) {
    const id = this.evictTimers.get(code);
    if (id != null) {
      this.clearTimeout(id);
      this.evictTimers.delete(code);
    }
  }

  _schedule(code, ms, reason) {
    this.clearEvictTimer(code);
    const id = this.setTimeout(() => {
      this.evictTimers.delete(code);
      this.evict(code, reason);
    }, ms);
    if (id && typeof id.unref === "function") id.unref();
    this.evictTimers.set(code, id);
  }

  onAllDisconnected(room) {
    if (!room) return;
    room.allDisconnectedAt = this.now();
    this._schedule(room.code, this.idleTtlMs, "idle");
  }

  onPlayerConnected(room) {
    if (!room) return;
    room.allDisconnectedAt = null;
    if (room.phase === "results" && room.finishedAt) {
      const remaining = this.finishedTtlMs - (this.now() - room.finishedAt);
      if (remaining <= 0) this.evict(room.code, "finished");
      else this._schedule(room.code, remaining, "finished");
    } else {
      this.clearEvictTimer(room.code);
    }
  }

  onResults(room) {
    if (!room) return;
    if (!room.finishedAt) room.finishedAt = this.now();
    const remaining = this.finishedTtlMs - (this.now() - room.finishedAt);
    // If everyone is already gone, the idle (10 min) timer may already be running
    // and should win if it's sooner.
    if (room.allDisconnectedAt && this.idleTtlMs <= remaining) return;
    if (remaining <= 0) this.evict(room.code, "finished");
    else this._schedule(room.code, remaining, "finished");
  }

  evict(code, reason = "evict") {
    const room = this.get(code);
    if (!room) return false;
    this.clearEvictTimer(room.code);
    try {
      room.destroy();
    } catch (_) {
      /* ignore */
    }
    if (reason !== "create-failed") {
      const started = Boolean(room.phase && room.phase !== "lobby");
      const asEnded = Boolean(
        reason === "ended" ||
        reason === "finished" ||
        room.ended ||
        room.phase === "ended" ||
        room.phase === "results" ||
        started
      );
      this.rememberEnded(room.code, {
        status: asEnded ? "ended" : "missing",
        reason,
        phase: room.phase,
      });
    }
    this.rooms.delete(room.code);
    this.evicted.push({ code: room.code, reason, at: this.now() });
    return true;
  }
}

module.exports = {
  RoomManager,
  makeRoomCode,
  ROOM_CODE_LENGTH,
  ROOM_CODE_ALPHABET,
  DEFAULTS,
};
