const { EventEmitter } = require("events");
const { overallRating } = require("./players");
const { simulateTournament, pickCaptainIfMissing } = require("./simulate");
const {
  ROLES,
  QUOTA,
  SQUAD_SIZE,
  DEFAULT_PURSE_LAKHS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  FRANCHISES,
  roleCounts,
  overseasCount,
  remainingQuota,
  hasMinSquad,
  isSquadComplete,
  pendingSlots,
  bidIncrement,
  nextBidAmount,
  isLegalRaise,
  canBidFor,
  availablePlayers,
  BID_STEPS,
  BASE_PRICE_POINTS,
  MIN_START_BID,
  MAX_START_BID,
} = require("./rules");
const { getBooster, canAffordAny, publicCatalog } = require("./boosters");
const { IDENTITIES, getIdentity, nextIdentity, publicIdentity } = require("../public/identities");

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function nameKey(name) {
  return normalizeName(name).toLowerCase();
}

function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function envMs(name, fallback) {
  if (process.env[name] == null || process.env[name] === "") return fallback;
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function defaultTimers() {
  return {
    lotStartMs: Number(process.env.LOT_START_MS) || 15000,
    bidMs: Number(process.env.BID_TIMER_MS) || 10000,
    captainMs: Number(process.env.CAPTAIN_TIMER_MS) || 45000,
    soldRevealMs: envMs("SOLD_REVEAL_MS", 1000),
  };
}

class GameRoom extends EventEmitter {
  constructor({ code, purseLakhs, timers, allPlayers, meta }) {
    super();
    this.code = code;
    this.purseLakhs = purseLakhs || DEFAULT_PURSE_LAKHS;
    this.timers = { ...defaultTimers(), ...(timers || {}) };
    this.allPlayers = allPlayers;
    this.meta = meta || {};
    this.phase = "lobby";
    this.franchises = []; // owner order
    this.hostKey = null;
    this.auction = null;
    this.soldIds = new Set();
    this.soldLog = [];
    this.queue = [];
    this.unsold = [];
    this.pass = 1;
    this.lotId = 0;
    this.rrIndex = 0;
    this.eliminationLog = [];
    this.timer = null;
    this.captainEndsAt = null;
    this.tournament = null;
    this.lastEvent = null;
    this.createdAt = Date.now();
    this.paused = false;
    this.pausedBy = null;
    this.pauseRemainingMs = null;
    this.pauseTimerKind = null;
    this.ended = false;
    this.forcedStartBid = null;
    this.startBidFn = null;
    this.revealUntil = null;
    this.unaffordableIds = new Set();
  }

  rollStartBid() {
    if (typeof this.startBidFn === "function") return this.startBidFn();
    if (this.forcedStartBid != null) {
      const n = Number(this.forcedStartBid);
      if (Number.isInteger(n) && n >= MIN_START_BID && n <= MAX_START_BID) return n;
    }
    return MIN_START_BID + Math.floor(Math.random() * (MAX_START_BID - MIN_START_BID + 1));
  }

  takenIdentityIds(exceptKey) {
    return new Set(
      this.franchises
        .filter((f) => f.key !== exceptKey && f.franchise && f.franchise.id)
        .map((f) => f.franchise.id)
    );
  }

  assignIdentity(team, id) {
    const pack = publicIdentity(id);
    if (!pack) return false;
    team.franchise = pack;
    return true;
  }

  autoAssignIdentities() {
    const taken = new Set();
    for (const f of this.franchises) {
      if (f.franchise && getIdentity(f.franchise.id) && !taken.has(f.franchise.id)) {
        taken.add(f.franchise.id);
        continue;
      }
      const next = nextIdentity(taken);
      if (next) {
        this.assignIdentity(f, next.id);
        taken.add(next.id);
      }
    }
  }

  requireUnpaused() {
    if (this.ended) return { ok: false, error: "This game has ended." };
    if (this.paused) return { ok: false, error: `Game is paused by ${this.pausedBy}.` };
    return { ok: true };
  }

  destroy() {
    this.clearTimer();
    this.removeAllListeners();
  }

  clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  armTimer(fn, ms) {
    this.clearTimer();
    this.timer = setTimeout(fn, ms);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  bump(reason = "update") {
    this.emit("snapshot", reason);
  }

  emitDelta(evt) {
    this.emit("delta", evt);
  }

  packStillIn() {
    return this.stillInTeams().map((f) => ({
      name: f.name,
      short: f.name,
      color: f.franchise.color,
      franchiseName: f.name,
      identityId: f.franchise.id,
      color2: f.franchise.color2 || null,
      emoji: f.franchise.emoji || null,
      purseLakhs: f.purseLakhs,
      isLeader: this.auction && f.key === this.auction.currentBidderKey,
      isYou: false,
    }));
  }

  packLotSnapshot() {
    return this.franchises.map((f) => ({
      name: f.name,
      identityId: f.franchise && f.franchise.id,
      color: f.franchise && f.franchise.color,
      color2: (f.franchise && f.franchise.color2) || null,
      text: (f.franchise && (f.franchise.text || f.franchise.color)) || null,
      purseLakhs: f.purseLakhs,
      pending: pendingSlots(f.squad),
      squadSize: (f.squad || []).length,
      complete: isSquadComplete(f.squad),
      eliminated: Boolean(f.eliminated),
    }));
  }

  packAuctionPublic() {
    if (!this.auction) return null;
    const hasBidder = Boolean(this.auction.currentBidderKey);
    const minBidLakhs = nextBidAmount(this.auction.currentBidLakhs, hasBidder);
    const incrementLakhs = bidIncrement(this.auction.currentBidLakhs);
    const leader = this.auction.currentBidderKey
      ? this.findByKey(this.auction.currentBidderKey)
      : null;
    const def = this.auction.defaultBidderKey
      ? this.findByKey(this.auction.defaultBidderKey)
      : null;
    return {
      nominee: this.auction.nominee,
      currentBidLakhs: this.auction.currentBidLakhs,
      currentBidderName: leader ? leader.name : null,
      currentBidderShort: leader ? leader.name : null,
      currentBidderColor: leader ? (leader.franchise.text || leader.franchise.color) : null,
      hasBidder,
      minBidLakhs,
      incrementLakhs,
      bidSteps: BID_STEPS,
      endsAt: this.auction.endsAt,
      stillIn: this.packStillIn(),
      pass: this.pass,
      soldCount: this.soldLog.length,
      remainingLots: this.countRemainingLots(),
      defaultBidderName: def ? def.name : null,
      defaultBidderShort: def ? def.name : null,
      isDefaultBidLeading: this.auction.currentBidderKey === this.auction.defaultBidderKey
        && this.auction.currentBidLakhs === this.auction.startBidLakhs,
      startBidLakhs: this.auction.startBidLakhs,
      timerMs: this.auction.timerMs || this.timers.lotStartMs,
      lotSnapshot: this.auction.lotSnapshot || this.packLotSnapshot(),
    };
  }

  findByKey(key) {
    return this.franchises.find((f) => f.key === key);
  }

  findBySocket(socketId) {
    return this.franchises.find((f) => f.socketId === socketId);
  }

  findByName(name) {
    return this.findByKey(nameKey(name));
  }

  get host() {
    return this.findByKey(this.hostKey) || this.franchises[0] || null;
  }

  addPlayer(rawName, socketId) {
    const name = normalizeName(rawName);
    if (!name) return { ok: false, error: "Enter a team name." };
    if (name.length > 24) return { ok: false, error: "Team name must be 24 characters or fewer." };

    const existing = this.findByName(name);
    if (existing) {
      if (existing.connected && existing.socketId && existing.socketId !== socketId) {
        return { ok: false, error: "That team name is already in this room." };
      }
      existing.socketId = socketId;
      existing.connected = true;
      if (this.phase === "lobby") this.bump("lobby");
      else {
        this.emitDelta({
          type: "presence",
          name: existing.name,
          connected: true,
          hostName: this.host ? this.host.name : null,
        });
      }
      return { ok: true, rejoined: true, name: existing.name };
    }

    if (this.phase !== "lobby") {
      return { ok: false, error: "The auction has already started. Rejoin with your original team name." };
    }
    if (this.franchises.length >= MAX_PLAYERS) {
      return { ok: false, error: "This room is full (10 franchises)." };
    }

    const pack = publicIdentity(nextIdentity(this.takenIdentityIds()));
    if (!pack) return { ok: false, error: "No team logos left to assign." };
    const franchise = {
      key: nameKey(name),
      name,
      socketId,
      connected: true,
      franchise: { ...pack },
      purseLakhs: this.purseLakhs,
      squad: [],
      captainId: null,
      boosters: [],
      eliminated: false,
      eliminatedReason: null,
      eliminatedAt: null,
    };
    this.franchises.push(franchise);
    if (!this.hostKey) this.hostKey = franchise.key;
    this.bump("lobby");
    return { ok: true, rejoined: false, name };
  }

  disconnect(socketId) {
    const f = this.findBySocket(socketId);
    if (!f) return;
    f.connected = false;
    f.socketId = null;
    if (this.phase === "lobby" && f.key === this.hostKey) {
      const next = this.franchises.find((x) => x.connected);
      if (next) this.hostKey = next.key;
    }
    if (this.phase === "lobby") this.bump("lobby");
    else {
      this.emitDelta({
        type: "presence",
        name: f.name,
        connected: false,
        hostName: this.host ? this.host.name : null,
      });
    }
  }

  setPurse(byName, pursePoints) {
    const f = this.findByName(byName);
    if (!f || f.key !== this.hostKey) return { ok: false, error: "Only the host can set the purse." };
    if (this.phase !== "lobby") return { ok: false, error: "Purse is locked once the auction starts." };
    const pts = Math.round(Number(pursePoints));
    if (!Number.isFinite(pts) || pts < 20 || pts > 200) {
      return { ok: false, error: "Purse must be between 20 and 200 points." };
    }
    this.purseLakhs = pts;
    for (const team of this.franchises) team.purseLakhs = this.purseLakhs;
    this.bump("lobby");
    return { ok: true };
  }

  selectIdentity(byName, identityId) {
    if (this.ended) return { ok: false, error: "This game has ended." };
    if (this.phase !== "lobby") return { ok: false, error: "Team logos are locked once the auction starts." };
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    const pack = publicIdentity(identityId);
    if (!pack) return { ok: false, error: "Unknown team logo." };
    const taken = this.takenIdentityIds(team.key);
    if (taken.has(pack.id)) return { ok: false, error: "That logo is already taken." };
    this.assignIdentity(team, pack.id);
    this.bump("lobby");
    return { ok: true };
  }

  leave(byName) {
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    if (this.phase === "lobby") {
      this.franchises = this.franchises.filter((f) => f.key !== team.key);
      if (this.hostKey === team.key) {
        const next = this.franchises.find((f) => f.connected) || this.franchises[0];
        this.hostKey = next ? next.key : null;
      }
      if (this.franchises.length === 0) {
        this.endGame(byName, { abandoned: true });
        return { ok: true, left: true, ended: true };
      }
      this.bump("lobby");
      return { ok: true, left: true };
    }
    this.disconnect(team.socketId);
    return { ok: true, left: true };
  }

  endGame(byName, opts = {}) {
    if (this.ended) return { ok: true, ended: true };
    const team = this.findByName(byName);
    if (!opts.abandoned) {
      if (!team || team.key !== this.hostKey) return { ok: false, error: "Only the host can end the game." };
    }
    this.ended = true;
    this.paused = false;
    this.clearTimer();
    this.phase = "ended";
    this.auction = null;
    const endedBy = team ? team.name : byName;
    this.emit("ended", { byName: endedBy, abandoned: Boolean(opts.abandoned) });
    return { ok: true, ended: true };
  }

  pause(byName) {
    const gate = this.requireUnpaused();
    if (!gate.ok && this.ended) return gate;
    if (this.paused) return { ok: false, error: `Game is already paused by ${this.pausedBy}.` };
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    if (this.phase !== "auction" && this.phase !== "captains") {
      return { ok: false, error: "Nothing to pause right now." };
    }
    if (this.phase === "auction" && this.auction) {
      this.pauseRemainingMs = Math.max(0, (this.auction.endsAt || Date.now()) - Date.now());
      this.pauseTimerKind = "lot";
    } else if (this.phase === "auction" && this.revealUntil) {
      this.pauseRemainingMs = Math.max(0, this.revealUntil - Date.now());
      this.pauseTimerKind = "reveal";
    } else if (this.phase === "captains" && this.captainEndsAt) {
      this.pauseRemainingMs = Math.max(0, this.captainEndsAt - Date.now());
      this.pauseTimerKind = "captain";
    } else {
      this.pauseRemainingMs = null;
      this.pauseTimerKind = null;
    }
    this.clearTimer();
    this.paused = true;
    this.pausedBy = team.name;
    this.emitDelta({
      type: "paused",
      byName: team.name,
      remainingMs: this.pauseRemainingMs,
      phase: this.phase,
    });
    return { ok: true };
  }

  resume(byName) {
    if (this.ended) return { ok: false, error: "This game has ended." };
    if (!this.paused) return { ok: false, error: "The game is not paused." };
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    const allowed = team.key === this.hostKey || team.name === this.pausedBy;
    if (!allowed) return { ok: false, error: "Only the pauser or the host can resume." };
    const remaining = this.pauseRemainingMs;
    const kind = this.pauseTimerKind;
    this.paused = false;
    this.pausedBy = null;
    this.pauseRemainingMs = null;
    this.pauseTimerKind = null;
    let endsAt = null;
    if (kind === "lot" && this.phase === "auction" && this.auction && remaining != null) {
      const lotId = this.lotId;
      this.auction.endsAt = Date.now() + remaining;
      endsAt = this.auction.endsAt;
      this.armTimer(() => this.onLotTimeout(lotId), remaining);
    } else if (kind === "reveal" && this.phase === "auction" && remaining != null) {
      this.revealUntil = Date.now() + remaining;
      endsAt = this.revealUntil;
      this.armTimer(() => {
        if (this.paused || this.ended) return;
        this.revealUntil = null;
        this.nominateNext();
      }, remaining);
    } else if (kind === "captain" && this.phase === "captains" && remaining != null) {
      this.captainEndsAt = Date.now() + remaining;
      endsAt = this.captainEndsAt;
      this.armTimer(() => this.finishCaptains(), remaining);
    }
    this.emitDelta({
      type: "resumed",
      endsAt,
      captainEndsAt: this.captainEndsAt,
      auctionEndsAt: this.auction ? this.auction.endsAt : null,
    });
    return { ok: true };
  }

  startAuction(byName) {
    const gate = this.requireUnpaused();
    if (!gate.ok) return gate;
    const f = this.findByName(byName);
    if (!f || f.key !== this.hostKey) return { ok: false, error: "Only the host can start the auction." };
    if (this.phase !== "lobby") return { ok: false, error: "The auction has already started." };
    if (this.franchises.length < MIN_PLAYERS) {
      return { ok: false, error: "Need at least 2 franchises to start." };
    }
    this.autoAssignIdentities();
    this.phase = "auction";
    this.queue = shuffle(this.allPlayers);
    this.unsold = [];
    this.pass = 1;
    this.soldIds = new Set();
    this.soldLog = [];
    this.rrIndex = 0;
    this.eliminationLog = [];
    this.revealUntil = null;
    this.unaffordableIds = new Set();
    this.nominateNext();
    return { ok: true };
  }

  remainingPool(excludeId) {
    return availablePlayers({
      allPlayers: this.allPlayers,
      soldIds: this.soldIds,
      excludeId,
    });
  }

  activeFranchises() {
    return this.franchises.filter((f) => !f.eliminated);
  }

  allTeamsFull() {
    const active = this.activeFranchises();
    if (active.length === 0) return true;
    return active.every((f) => isSquadComplete(f.squad));
  }

  incompleteTeams() {
    return this.activeFranchises().filter((f) => !isSquadComplete(f.squad));
  }

  neededRoles() {
    const roles = new Set();
    for (const f of this.incompleteTeams()) {
      const left = remainingQuota(f.squad);
      for (const role of ROLES) {
        if ((left[role] || 0) > 0) roles.add(role);
      }
    }
    return roles;
  }

  takeNeededFrom(list) {
    const needed = this.neededRoles();
    const out = [];
    const rest = [];
    for (const p of list) {
      if (!p || this.soldIds.has(p.id) || this.unaffordableIds.has(p.id)) continue;
      if (needed.has(p.role)) out.push(p);
      else rest.push(p);
    }
    return { out, rest };
  }

  refillQueue() {
    const needed = this.neededRoles();
    if (needed.size === 0) return false;

    const fromUnsold = this.takeNeededFrom(this.unsold);
    this.unsold = fromUnsold.rest;
    if (fromUnsold.out.length) {
      this.queue = shuffle(fromUnsold.out);
      if (this.pass < 2) this.pass = 2;
      return true;
    }

    const seen = new Set([...this.soldIds, ...this.unaffordableIds]);
    const out = [];
    for (const p of this.allPlayers) {
      if (seen.has(p.id)) continue;
      if (needed.has(p.role)) {
        seen.add(p.id);
        out.push(p);
      }
    }
    if (out.length === 0) return false;
    this.queue = shuffle(out);
    if (this.pass < 2) this.pass = 2;
    return true;
  }

  countRemainingLots() {
    const needed = this.neededRoles();
    if (needed.size === 0) return 0;
    const seen = new Set([...this.soldIds, ...this.unaffordableIds]);
    let n = 0;
    for (const p of [...this.queue, ...this.unsold, ...this.allPlayers]) {
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      if (needed.has(p.role)) n += 1;
    }
    return n;
  }

  isEligible(team, player, amountLakhs) {
    if (!team || team.eliminated) return false;
    return canBidFor(team, player, amountLakhs, this.remainingPool(player.id)).ok;
  }

  eliminate(team) {
    if (!team || team.eliminated) return;
    team.eliminated = true;
    team.eliminatedReason = "insufficient purse";
    team.eliminatedAt = Date.now();
    const entry = {
      name: team.name,
      short: team.name,
      color: team.franchise.color,
      reason: "Eliminated - insufficient purse",
    };
    this.eliminationLog.push(entry);
    this.lastEvent = { type: "eliminated", ...entry };
    this.emitDelta({ type: "eliminated", ...entry });
  }

  /**
   * Assign the automatic base-price bid in join-order round-robin.
   * Skip eliminated teams and teams whose squad is already complete (every
   * required role count is met). A team that still needs players can be the
   * default even if this player's role quota is already full, and must keep
   * the player if nobody outbids. If the chosen team cannot afford the
   * starting bid, eliminate them and continue.
   */
  pickDefaultTeam(player, startBid) {
    const cost = startBid != null ? startBid : MIN_START_BID;
    const n = this.franchises.length;
    if (n === 0) return null;
    const start = ((this.rrIndex % n) + n) % n;
    for (let i = 0; i < n; i++) {
      const idx = (start + i) % n;
      const team = this.franchises[idx];
      if (team.eliminated || isSquadComplete(team.squad)) continue;
      if (team.purseLakhs < cost) {
        this.eliminate(team);
        continue;
      }
      this.rrIndex = (idx + 1) % n;
      return team;
    }
    return null;
  }

  stillInTeams() {
    if (!this.auction) return [];
    const { nominee, currentBidLakhs, currentBidderKey, optedOut } = this.auction;
    const hasBidder = Boolean(currentBidderKey);
    const minBid = nextBidAmount(currentBidLakhs, hasBidder);
    return this.franchises.filter((f) => {
      if (f.eliminated) return false;
      if (optedOut.has(f.key)) return false;
      if (f.key === currentBidderKey) return true;
      return this.isEligible(f, nominee, minBid);
    });
  }

  maybeResolveLot() {
    if (this.phase !== "auction" || !this.auction) return false;
    const inTeams = this.stillInTeams();
    const leader = this.auction.currentBidderKey;
    if (leader) {
      const others = inTeams.filter((f) => f.key !== leader);
      if (others.length === 0) {
        this.sellCurrent();
        return true;
      }
      return false;
    }
    if (inTeams.length === 0) {
      this.unsoldCurrent();
      return true;
    }
    return false;
  }

  startLotTimer(reset = false) {
    const lotId = this.lotId;
    const ms = reset ? this.timers.bidMs : this.timers.lotStartMs;
    this.auction.timerMs = ms;
    this.auction.endsAt = Date.now() + ms;
    this.armTimer(() => this.onLotTimeout(lotId), ms);
  }

  onLotTimeout(lotId) {
    if (this.paused || this.ended) return;
    if (this.phase !== "auction" || !this.auction || this.lotId !== lotId) return;
    if (this.auction.currentBidderKey || this.auction.defaultBidderKey) this.sellCurrent();
    else this.unsoldCurrent();
  }

  nominateNext() {
    this.clearTimer();
    this.revealUntil = null;
    if (this.allTeamsFull() || this.activeFranchises().length === 0) {
      this.beginCaptainPhase();
      return;
    }

    for (;;) {
      if (this.allTeamsFull()) {
        this.beginCaptainPhase();
        return;
      }
      if (this.queue.length === 0) {
        if (!this.refillQueue()) {
          this.autoFill();
          this.beginCaptainPhase();
          return;
        }
      }
      const player = this.queue.shift();
      if (!player || this.soldIds.has(player.id) || this.unaffordableIds.has(player.id)) continue;
      if (!this.neededRoles().has(player.role)) continue;

      const startBid = this.rollStartBid();
      const defaultTeam = this.pickDefaultTeam(player, startBid);
      if (!defaultTeam) {
        this.unaffordableIds.add(player.id);
        this.lastEvent = {
          type: "skipped",
          player,
          reason: "No remaining team can afford this player.",
        };
        this.emitDelta({ type: "skipped", player, reason: this.lastEvent.reason });
        continue;
      }

      this.lotId += 1;
      this.auction = {
        nominee: player,
        startBidLakhs: startBid,
        currentBidLakhs: startBid,
        currentBidderKey: defaultTeam.key,
        defaultBidderKey: defaultTeam.key,
        optedOut: new Set(),
        endsAt: Date.now() + this.timers.lotStartMs,
        timerMs: this.timers.lotStartMs,
        lotSnapshot: this.packLotSnapshot(),
      };
      this.startLotTimer(false);
      if (!this.maybeResolveLot()) {
        this.emitDelta({ type: "lotStart", ...this.packAuctionPublic() });
      }
      return;
    }
  }

  revealDelayMs() {
    const n = Number(this.timers.soldRevealMs);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  scheduleNominateNext() {
    const ms = this.revealDelayMs();
    this.clearTimer();
    if (ms <= 0 || this.ended) {
      this.revealUntil = null;
      this.nominateNext();
      return;
    }
    this.revealUntil = Date.now() + ms;
    this.armTimer(() => {
      if (this.paused || this.ended) return;
      this.revealUntil = null;
      this.nominateNext();
    }, ms);
  }

  soldPack(winner, player, price) {
    return {
      type: "sold",
      player,
      priceLakhs: price,
      buyerName: winner.name,
      short: winner.name,
      color: winner.franchise.color,
      color2: winner.franchise.color2 || null,
      text: winner.franchise.text || winner.franchise.color,
      identityId: winner.franchise.id,
      purseLakhs: winner.purseLakhs,
      squadSize: winner.squad.length,
      complete: isSquadComplete(winner.squad),
      revealMs: this.revealDelayMs(),
      revealUntil: this.revealUntil,
    };
  }

  sellCurrent() {
    if (!this.auction) {
      this.scheduleNominateNext();
      return;
    }
    const key = this.auction.currentBidderKey || this.auction.defaultBidderKey;
    if (!key) {
      this.unsoldCurrent();
      return;
    }
    const player = this.auction.nominee;
    const winner = this.findByKey(key);
    const price = this.auction.currentBidLakhs != null ? this.auction.currentBidLakhs : this.auction.startBidLakhs;
    if (!winner) {
      this.unsoldCurrent();
      return;
    }
    winner.squad.push({ player, priceLakhs: price });
    winner.purseLakhs -= price;
    this.soldIds.add(player.id);
    const packed = this.soldPack(winner, player, price);
    // revealUntil is filled in after schedule sets it; compute now so the delta carries it
    const revealMs = this.revealDelayMs();
    packed.revealMs = revealMs;
    packed.revealUntil = revealMs > 0 ? Date.now() + revealMs : null;
    this.soldLog.push({
      player,
      priceLakhs: price,
      buyerName: winner.name,
      short: winner.name,
      color: winner.franchise.color,
      color2: packed.color2,
      text: packed.text,
      identityId: packed.identityId,
    });
    this.lastEvent = packed;
    this.auction = null;
    this.revealUntil = packed.revealUntil;
    this.emitDelta(packed);
    this.scheduleNominateNext();
  }

  unsoldCurrent() {
    if (!this.auction) {
      this.scheduleNominateNext();
      return;
    }
    // Default bid guarantee: if a default (or leading) bidder exists, lock the player there.
    if (this.auction.currentBidderKey || this.auction.defaultBidderKey) {
      this.sellCurrent();
      return;
    }
    const player = this.auction.nominee;
    if (!this.unsold.some((p) => p.id === player.id)) this.unsold.push(player);
    const revealMs = this.revealDelayMs();
    const revealUntil = revealMs > 0 ? Date.now() + revealMs : null;
    this.lastEvent = {
      type: "unsold",
      player,
      reason: "No bids — went unsold.",
      revealMs,
      revealUntil,
    };
    this.auction = null;
    this.revealUntil = revealUntil;
    this.emitDelta({ type: "unsold", player, reason: this.lastEvent.reason, revealMs, revealUntil });
    this.scheduleNominateNext();
  }

  bid(byName, amountLakhs) {
    const gate = this.requireUnpaused();
    if (!gate.ok) return gate;
    if (this.phase !== "auction" || !this.auction) {
      return { ok: false, error: "No player is on the block." };
    }
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    if (team.eliminated) return { ok: false, error: "Your franchise has been eliminated." };
    if (this.auction.optedOut.has(team.key)) {
      return { ok: false, error: "You already opted out of this player." };
    }
    if (team.key === this.auction.currentBidderKey) {
      return { ok: false, error: "You already have the leading bid." };
    }

    const hasBidder = Boolean(this.auction.currentBidderKey);
    const minBid = nextBidAmount(this.auction.currentBidLakhs, hasBidder);
    const amount = Number(amountLakhs);
    if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
      return { ok: false, error: "Bid a whole number of points." };
    }
    if (!isLegalRaise(this.auction.currentBidLakhs, amount, hasBidder)) {
      return { ok: false, error: `Bid exactly +1, +2 or +5 points (minimum ${minBid}).` };
    }
    if (amount < minBid) {
      return { ok: false, error: `Minimum bid is ${minBid} points.` };
    }

    const check = canBidFor(team, this.auction.nominee, amount, this.remainingPool(this.auction.nominee.id));
    if (!check.ok) return { ok: false, error: check.reason };

    this.auction.currentBidLakhs = amount;
    this.auction.currentBidderKey = team.key;
    this.startLotTimer(true);
    if (!this.maybeResolveLot()) {
      this.emitDelta({
        type: "bid",
        amountLakhs: amount,
        bidderName: team.name,
        bidderShort: team.name,
        bidderColor: team.franchise.color,
        endsAt: this.auction.endsAt,
        stillIn: this.packStillIn(),
        minBidLakhs: nextBidAmount(this.auction.currentBidLakhs, true),
        incrementLakhs: bidIncrement(this.auction.currentBidLakhs),
        isDefaultBidLeading: false,
        currentBidLakhs: this.auction.currentBidLakhs,
        currentBidderName: team.name,
        currentBidderShort: team.name,
        currentBidderColor: team.franchise.text || team.franchise.color,
        hasBidder: true,
      });
    }
    return { ok: true };
  }

  optOut(byName) {
    const gate = this.requireUnpaused();
    if (!gate.ok) return gate;
    if (this.phase !== "auction" || !this.auction) {
      return { ok: false, error: "No player is on the block." };
    }
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    if (team.eliminated) return { ok: false, error: "Your franchise has been eliminated." };
    if (team.key === this.auction.currentBidderKey) {
      return { ok: false, error: "You have the leading bid, so you cannot opt out." };
    }
    if (this.auction.optedOut.has(team.key)) {
      return { ok: false, error: "You already opted out of this player." };
    }
    if (!this.stillInTeams().some((f) => f.key === team.key)) {
      return { ok: false, error: "You are not in the running for this player." };
    }
    this.auction.optedOut.add(team.key);
    if (!this.maybeResolveLot()) {
      this.emitDelta({
        type: "optOut",
        name: team.name,
        short: team.name,
        color: team.franchise.color,
        stillIn: this.packStillIn(),
      });
    }
    return { ok: true };
  }

  autoFill() {
    const leftover = [];
    const seen = new Set(this.soldIds);
    for (const p of [...this.unsold, ...this.queue, ...this.allPlayers]) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      leftover.push(p);
    }
    leftover.sort((a, b) => overallRating(b) - overallRating(a));
    const fillPrice = MIN_START_BID;

    let progress = true;
    while (progress) {
      progress = false;
      const needy = this.activeFranchises().filter((f) => !isSquadComplete(f.squad));
      if (needy.length === 0) break;
      for (const team of needy) {
        const left = remainingQuota(team.squad);
        const pick = leftover.find((p) => (left[p.role] || 0) > 0 && team.purseLakhs >= fillPrice);
        if (!pick) continue;
        team.squad.push({ player: pick, priceLakhs: fillPrice });
        team.purseLakhs -= fillPrice;
        this.soldIds.add(pick.id);
        this.soldLog.push({
          player: pick,
          priceLakhs: fillPrice,
          buyerName: team.name,
          short: team.name,
          color: team.franchise.color,
          auto: true,
        });
        leftover.splice(leftover.indexOf(pick), 1);
        progress = true;
      }
    }
    this.queue = [];
    this.unsold = leftover;
    this.lastEvent = { type: "autofill", message: "Remaining gaps were filled at base price where possible." };
  }

  beginCaptainPhase() {
    this.clearTimer();
    this.phase = "captains";
    this.auction = null;
    for (const f of this.franchises) {
      if (!Array.isArray(f.boosters)) f.boosters = [];
    }
    for (const f of this.activeFranchises()) {
      if (!f.captainId) continue;
      if (!f.squad.some((s) => s.player.id === f.captainId)) f.captainId = null;
    }
    const needingCaptain = this.activeFranchises().filter((f) => !f.captainId && f.squad.length);
    const shopOpen = this.activeFranchises().some((f) => canAffordAny(f));
    if (needingCaptain.length === 0 && !shopOpen) {
      this.runSimulation();
      return;
    }
    this.captainEndsAt = Date.now() + this.timers.captainMs;
    this.armTimer(() => this.finishCaptains(), this.timers.captainMs);
    this.bump("captains");
  }

  maybeFinishPrep() {
    if (this.phase !== "captains") return;
    const needing = this.activeFranchises().filter((f) => !f.captainId && f.squad.length);
    if (needing.length) return;
    if (this.activeFranchises().some((f) => canAffordAny(f))) return;
    this.finishCaptains();
  }

  buyBooster(byName, boosterId) {
    const gate = this.requireUnpaused();
    if (!gate.ok) return gate;
    if (this.phase !== "captains") return { ok: false, error: "The booster shop is closed." };
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    if (team.eliminated) return { ok: false, error: "Your franchise has been eliminated." };
    const item = getBooster(boosterId);
    if (!item) return { ok: false, error: "Unknown booster." };
    if (!Array.isArray(team.boosters)) team.boosters = [];
    if (team.boosters.some((b) => b.id === item.id)) {
      return { ok: false, error: "You already bought that booster." };
    }
    if (team.purseLakhs < item.pricePoints) {
      return { ok: false, error: "Not enough points for that booster." };
    }
    team.purseLakhs -= item.pricePoints;
    const bought = { id: item.id, name: item.name, pricePoints: item.pricePoints };
    team.boosters.push(bought);
    this.emitDelta({
      type: "booster",
      name: team.name,
      short: team.name,
      booster: bought,
      purseLakhs: team.purseLakhs,
    });
    this.maybeFinishPrep();
    return { ok: true };
  }

  selectCaptain(byName, playerId) {
    const gate = this.requireUnpaused();
    if (!gate.ok) return gate;
    if (this.phase !== "captains") return { ok: false, error: "Captain selection is not open." };
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    if (team.eliminated) return { ok: false, error: "Your franchise has been eliminated." };
    const slot = team.squad.find((s) => s.player.id === playerId);
    if (!slot) return { ok: false, error: "That player is not in your XI." };
    team.captainId = playerId;
    this.emitDelta({
      type: "captain",
      name: team.name,
      short: team.name,
      captainId: playerId,
    });
    this.maybeFinishPrep();
    return { ok: true };
  }

  finishCaptains() {
    if (this.phase !== "captains") return;
    this.clearTimer();
    for (const f of this.activeFranchises()) {
      f.captainId = pickCaptainIfMissing(f);
    }
    this.runSimulation();
  }

  runSimulation() {
    this.phase = "simulating";
    this.captainEndsAt = null;
    const seed = (Date.now() ^ (Math.floor(Math.random() * 0xffffffff) >>> 0)) >>> 0;
    const active = this.activeFranchises();
    const result = simulateTournament(active, seed);
    const placed = new Set(result.positions.map((p) => p.name));
    for (const f of this.franchises.filter((x) => x.eliminated)) {
      if (placed.has(f.name)) continue;
      result.positions.push({
        position: result.positions.length + 1,
        name: f.name,
        short: f.name,
        color: f.franchise.color,
        color2: f.franchise.color2 || null,
        text: f.franchise.text || f.franchise.color,
        identityId: f.franchise.id,
        franchiseName: f.name,
        title: "Eliminated - insufficient purse",
        eliminated: true,
        leaguePosition: null,
        points: 0,
        nrr: 0,
      });
    }
    this.tournament = result;
    this.phase = "results";
    this.finishedAt = Date.now();
    this.bump("results");
  }

  publicFranchise(f, forKey) {
    return {
      name: f.name,
      connected: f.connected,
      isYou: f.key === forKey,
      isHost: f.key === this.hostKey,
      franchise: f.franchise,
      purseLakhs: f.purseLakhs,
      squad: f.squad.map((s) => ({
        player: s.player,
        priceLakhs: s.priceLakhs,
        isCaptain: f.captainId === s.player.id,
      })),
      roleCounts: roleCounts(f.squad),
      overseasCount: overseasCount(f.squad),
      remainingQuota: remainingQuota(f.squad),
      complete: isSquadComplete(f.squad),
      captainId: f.captainId,
      boosters: (f.boosters || []).map((b) => ({ id: b.id, name: b.name, pricePoints: b.pricePoints })),
      eliminated: Boolean(f.eliminated),
      eliminatedReason: f.eliminated ? "Eliminated - insufficient purse" : null,
    };
  }

  summarizeTournament(includeMatches) {
    const t = this.tournament;
    if (!t) return null;
    const summary = {
      seed: t.seed,
      table: t.table,
      positions: t.positions,
      awards: t.awards,
      champion: t.champion,
      playoffs: {
        format: t.playoffs.format,
        championName: t.playoffs.championName,
        runnerUpName: t.playoffs.runnerUpName,
        thirdName: t.playoffs.thirdName,
        fourthName: t.playoffs.fourthName,
        matches: includeMatches ? t.playoffs.matches : undefined,
        matchCount: (t.playoffs.matches || []).length,
      },
      leagueMatchCount: (t.leagueMatches || []).length,
      momentCount: (t.moments || []).length,
    };
    if (includeMatches) {
      summary.leagueMatches = t.leagueMatches;
      summary.moments = t.moments || [];
      summary.playerStats = t.playerStats || {};
    }
    return summary;
  }

  packTeamReports() {
    const t = this.tournament;
    if (!t) return [];
    const statsByTeam = t.playerStats || {};
    return this.franchises.map((f) => {
      const row = (t.table || []).find((r) => r.name === f.name) || null;
      const pos = (t.positions || []).find((r) => r.name === f.name) || null;
      const stats = statsByTeam[f.name] || [];
      const statMap = new Map(stats.map((s) => [s.playerId, s]));
      return {
        name: f.name,
        short: f.name,
        color: f.franchise.color,
        color2: f.franchise.color2 || null,
        text: f.franchise.text || f.franchise.color,
        identityId: f.franchise.id,
        franchiseName: f.name,
        captainId: f.captainId,
        purseLakhs: f.purseLakhs,
        boosters: (f.boosters || []).map((b) => ({ id: b.id, name: b.name, pricePoints: b.pricePoints })),
        moments: (t.moments || []).filter((m) => m.teamName === f.name),
        eliminated: Boolean(f.eliminated),
        title: pos ? pos.title : (f.eliminated ? "Eliminated - insufficient purse" : null),
        played: row ? row.played : 0,
        won: row ? row.won : 0,
        lost: row ? row.lost : 0,
        nr: row ? row.nr : 0,
        points: row ? row.points : 0,
        nrr: row ? row.nrr : 0,
        squad: f.squad.map((s) => ({
          player: s.player,
          priceLakhs: s.priceLakhs,
          isCaptain: f.captainId === s.player.id,
          stats: statMap.get(s.player.id) || null,
        })),
      };
    });
  }

  getMatches() {
    if (!this.tournament) return null;
    return {
      leagueMatches: this.tournament.leagueMatches || [],
      playoffMatches: this.tournament.playoffs.matches || [],
      moments: this.tournament.moments || [],
      playerStats: this.tournament.playerStats || {},
      teams: this.packTeamReports(),
    };
  }

  getState(forName, opts = {}) {
    const includeMatches = Boolean(opts.includeMatches);
    const you = forName ? this.findByName(forName) : null;
    const forKey = you ? you.key : null;
    const franchises = this.franchises.map((f) => this.publicFranchise(f, forKey));

    let auction = null;
    if (this.phase === "auction" && this.auction) {
      auction = this.packAuctionPublic();
      auction.stillIn = auction.stillIn.map((row) => ({ ...row, isYou: you && row.name === you.name }));
      let youCanBid = false;
      let youCanOptOut = false;
      let youReason = null;
      if (you) {
        if (this.auction.optedOut.has(you.key)) {
          youReason = "You opted out of this player.";
        } else if (you.key === this.auction.currentBidderKey) {
          youReason = "You have the leading bid.";
        } else {
          const check = canBidFor(
            you,
            this.auction.nominee,
            auction.minBidLakhs,
            this.remainingPool(this.auction.nominee.id)
          );
          youCanBid = check.ok;
          youCanOptOut = auction.stillIn.some((s) => s.isYou);
          youReason = check.ok ? null : check.reason;
        }
      }
      auction.youCanBid = youCanBid;
      auction.youCanOptOut = youCanOptOut;
      auction.youReason = youReason;
    }

    return {
      code: this.code,
      phase: this.phase,
      purseLakhs: this.purseLakhs,
      paused: Boolean(this.paused),
      pausedBy: this.pausedBy,
      pauseRemainingMs: this.paused ? this.pauseRemainingMs : null,
      soldRevealUntil: this.phase === "auction" && this.revealUntil ? this.revealUntil : null,
      identities: IDENTITIES.map((t) => publicIdentity(t.id)),
      ratingsNote: this.meta.ratingsNote || null,
      hostName: this.host ? this.host.name : null,
      you: you ? this.publicFranchise(you, forKey) : null,
      franchises,
      auction,
      lastEvent: this.lastEvent,
      soldLog: this.soldLog,
      captainEndsAt: this.captainEndsAt,
      boosterCatalog: this.phase === "captains" ? publicCatalog() : [],
      captainsPending: this.phase === "captains"
        ? this.activeFranchises().filter((f) => !f.captainId && f.squad.length).map((f) => ({
            name: f.name,
            short: f.name,
            color: f.franchise.color,
          }))
        : [],
      eliminationLog: this.eliminationLog,
      tournament: this.summarizeTournament(includeMatches),
      quotas: QUOTA,
      squadSize: SQUAD_SIZE,
      maxOverseas: null,
      maxPlayers: MAX_PLAYERS,
      minPlayers: MIN_PLAYERS,
    };
  }
}


const { makeRoomCode, ROOM_CODE_LENGTH } = require("./manager");

module.exports = { GameRoom, makeRoomCode, normalizeName, nameKey, ROOM_CODE_LENGTH };
