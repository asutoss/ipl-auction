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
  bidIncrement,
  nextBidAmount,
  canBidFor,
  availablePlayers,
} = require("./rules");

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

function defaultTimers() {
  return {
    bidMs: Number(process.env.BID_TIMER_MS) || 10000,
    captainMs: Number(process.env.CAPTAIN_TIMER_MS) || 30000,
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

  bump() {
    this.emit("update");
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
    if (!name) return { ok: false, error: "Enter a display name." };
    if (name.length > 24) return { ok: false, error: "Name must be 24 characters or fewer." };

    const existing = this.findByName(name);
    if (existing) {
      if (existing.connected && existing.socketId && existing.socketId !== socketId) {
        return { ok: false, error: "That name is already in this room." };
      }
      existing.socketId = socketId;
      existing.connected = true;
      this.bump();
      return { ok: true, rejoined: true, name: existing.name };
    }

    if (this.phase !== "lobby") {
      return { ok: false, error: "The auction has already started. Rejoin with your original name." };
    }
    if (this.franchises.length >= MAX_PLAYERS) {
      return { ok: false, error: "This room is full (10 franchises)." };
    }

    const taken = new Set(this.franchises.map((f) => f.franchise.id));
    const pack = FRANCHISES.find((fr) => !taken.has(fr.id));
    const franchise = {
      key: nameKey(name),
      name,
      socketId,
      connected: true,
      franchise: { ...pack },
      purseLakhs: this.purseLakhs,
      squad: [],
      captainId: null,
      eliminated: false,
      eliminatedReason: null,
      eliminatedAt: null,
    };
    this.franchises.push(franchise);
    if (!this.hostKey) this.hostKey = franchise.key;
    this.bump();
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
    this.bump();
  }

  setPurse(byName, purseCrore) {
    const f = this.findByName(byName);
    if (!f || f.key !== this.hostKey) return { ok: false, error: "Only the host can set the purse." };
    if (this.phase !== "lobby") return { ok: false, error: "Purse is locked once the auction starts." };
    const cr = Number(purseCrore);
    if (!Number.isFinite(cr) || cr < 20 || cr > 200) {
      return { ok: false, error: "Purse must be between ₹20 Cr and ₹200 Cr." };
    }
    this.purseLakhs = Math.round(cr * 100);
    for (const team of this.franchises) team.purseLakhs = this.purseLakhs;
    this.bump();
    return { ok: true };
  }

  startAuction(byName) {
    const f = this.findByName(byName);
    if (!f || f.key !== this.hostKey) return { ok: false, error: "Only the host can start the auction." };
    if (this.phase !== "lobby") return { ok: false, error: "The auction has already started." };
    if (this.franchises.length < MIN_PLAYERS) {
      return { ok: false, error: "Need at least 2 franchises to start." };
    }
    this.phase = "auction";
    const byBase = {};
    for (const p of this.allPlayers) {
      (byBase[p.basePriceLakhs] ||= []).push(p);
    }
    const bases = Object.keys(byBase)
      .map(Number)
      .sort((a, b) => b - a);
    this.queue = [];
    for (const b of bases) this.queue.push(...shuffle(byBase[b]));
    this.unsold = [];
    this.pass = 1;
    this.soldIds = new Set();
    this.soldLog = [];
    this.rrIndex = 0;
    this.eliminationLog = [];
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
    return active.every((f) => hasMinSquad(f.squad));
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
      short: team.franchise.short,
      color: team.franchise.color,
      reason: "Eliminated - insufficient purse",
    };
    this.eliminationLog.push(entry);
    this.lastEvent = { type: "eliminated", ...entry };
  }

  /**
   * Assign the automatic base-price bid in join-order round-robin.
   * Skip only eliminated teams. Quota-full or already-11+ teams still get the default bid.
   * If the chosen team cannot afford the base price, eliminate them and continue.
   */
  pickDefaultTeam(player) {
    const n = this.franchises.length;
    if (n === 0) return null;
    const start = ((this.rrIndex % n) + n) % n;
    for (let i = 0; i < n; i++) {
      const idx = (start + i) % n;
      const team = this.franchises[idx];
      if (team.eliminated) continue;
      if (team.purseLakhs < player.basePriceLakhs) {
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

  startLotTimer() {
    const lotId = this.lotId;
    this.auction.endsAt = Date.now() + this.timers.bidMs;
    this.armTimer(() => this.onLotTimeout(lotId), this.timers.bidMs);
  }

  onLotTimeout(lotId) {
    if (this.phase !== "auction" || !this.auction || this.lotId !== lotId) return;
    if (this.auction.currentBidderKey) this.sellCurrent();
    else this.unsoldCurrent();
  }

  nominateNext() {
    this.clearTimer();
    if (this.allTeamsFull()) {
      this.beginCaptainPhase();
      return;
    }

    while (this.queue.length === 0) {
      if (this.pass === 1 && this.unsold.length > 0) {
        this.queue = this.unsold;
        this.unsold = [];
        this.pass = 2;
      } else {
        this.autoFill();
        this.beginCaptainPhase();
        return;
      }
    }

    const player = this.queue.shift();
    if (this.soldIds.has(player.id)) {
      this.nominateNext();
      return;
    }

    const defaultTeam = this.pickDefaultTeam(player);
    if (!defaultTeam) {
      this.lastEvent = {
        type: "skipped",
        player,
        reason: "No remaining team can afford this player.",
      };
      this.nominateNext();
      return;
    }

    this.lotId += 1;
    this.auction = {
      nominee: player,
      currentBidLakhs: player.basePriceLakhs,
      currentBidderKey: defaultTeam.key,
      defaultBidderKey: defaultTeam.key,
      optedOut: new Set(),
      endsAt: Date.now() + this.timers.bidMs,
    };
    this.startLotTimer();
    if (!this.maybeResolveLot()) this.bump();
  }

  sellCurrent() {
    if (!this.auction || !this.auction.currentBidderKey) {
      this.unsoldCurrent();
      return;
    }
    const player = this.auction.nominee;
    const winner = this.findByKey(this.auction.currentBidderKey);
    const price = this.auction.currentBidLakhs;
    if (!winner) {
      this.unsoldCurrent();
      return;
    }
    winner.squad.push({ player, priceLakhs: price });
    winner.purseLakhs -= price;
    this.soldIds.add(player.id);
    this.soldLog.push({
      player,
      priceLakhs: price,
      buyerName: winner.name,
      short: winner.franchise.short,
      color: winner.franchise.color,
    });
    this.lastEvent = {
      type: "sold",
      player,
      priceLakhs: price,
      buyerName: winner.name,
      short: winner.franchise.short,
      color: winner.franchise.color,
    };
    this.auction = null;
    this.nominateNext();
  }

  unsoldCurrent() {
    if (!this.auction) {
      this.nominateNext();
      return;
    }
    const player = this.auction.nominee;
    if (!this.unsold.some((p) => p.id === player.id)) this.unsold.push(player);
    this.lastEvent = { type: "unsold", player, reason: "No bids — went unsold." };
    this.auction = null;
    this.nominateNext();
  }

  bid(byName, amountLakhs) {
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
      return { ok: false, error: "Bid an amount in whole lakhs." };
    }
    if (amount % 5 !== 0) {
      return { ok: false, error: "Bids must be in ₹5 lakh steps." };
    }
    if (amount < minBid) {
      return { ok: false, error: `Minimum bid is ${minBid} lakh.` };
    }

    const check = canBidFor(team, this.auction.nominee, amount, this.remainingPool(this.auction.nominee.id));
    if (!check.ok) return { ok: false, error: check.reason };

    this.auction.currentBidLakhs = amount;
    this.auction.currentBidderKey = team.key;
    this.startLotTimer();
    if (!this.maybeResolveLot()) this.bump();
    return { ok: true };
  }

  optOut(byName) {
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
    if (!this.maybeResolveLot()) this.bump();
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
    leftover.sort((a, b) => a.basePriceLakhs - b.basePriceLakhs || overallRating(b) - overallRating(a));

    let progress = true;
    while (progress) {
      progress = false;
      const needy = this.activeFranchises().filter((f) => !hasMinSquad(f.squad));
      if (needy.length === 0) break;
      for (const team of needy) {
        const pick = leftover.find((p) => team.purseLakhs >= p.basePriceLakhs);
        if (!pick) continue;
        team.squad.push({ player: pick, priceLakhs: pick.basePriceLakhs });
        team.purseLakhs -= pick.basePriceLakhs;
        this.soldIds.add(pick.id);
        this.soldLog.push({
          player: pick,
          priceLakhs: pick.basePriceLakhs,
          buyerName: team.name,
          short: team.franchise.short,
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
    for (const f of this.activeFranchises()) {
      if (!f.captainId) continue;
      if (!f.squad.some((s) => s.player.id === f.captainId)) f.captainId = null;
    }
    const needingCaptain = this.activeFranchises().filter((f) => !f.captainId && f.squad.length);
    if (needingCaptain.length === 0) {
      this.runSimulation();
      return;
    }
    this.captainEndsAt = Date.now() + this.timers.captainMs;
    this.armTimer(() => this.finishCaptains(), this.timers.captainMs);
    this.bump();
  }

  selectCaptain(byName, playerId) {
    if (this.phase !== "captains") return { ok: false, error: "Captain selection is not open." };
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    if (team.eliminated) return { ok: false, error: "Your franchise has been eliminated." };
    const slot = team.squad.find((s) => s.player.id === playerId);
    if (!slot) return { ok: false, error: "That player is not in your XI." };
    team.captainId = playerId;
    const still = this.activeFranchises().filter((f) => !f.captainId && f.squad.length);
    if (still.length === 0) {
      this.finishCaptains();
    } else {
      this.bump();
    }
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
    this.bump();
    const seed = (Date.now() ^ (Math.floor(Math.random() * 0xffffffff) >>> 0)) >>> 0;
    const active = this.activeFranchises();
    const result = simulateTournament(active, seed);
    const placed = new Set(result.positions.map((p) => p.name));
    for (const f of this.franchises.filter((x) => x.eliminated)) {
      if (placed.has(f.name)) continue;
      result.positions.push({
        position: result.positions.length + 1,
        name: f.name,
        short: f.franchise.short,
        color: f.franchise.color,
        franchiseName: f.franchise.name,
        title: "Eliminated - insufficient purse",
        eliminated: true,
        leaguePosition: null,
        points: 0,
        nrr: 0,
      });
    }
    this.tournament = result;
    this.phase = "results";
    this.bump();
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
      complete: hasMinSquad(f.squad),
      captainId: f.captainId,
      eliminated: Boolean(f.eliminated),
      eliminatedReason: f.eliminated ? "Eliminated - insufficient purse" : null,
    };
  }

  getState(forName) {
    const you = forName ? this.findByName(forName) : null;
    const forKey = you ? you.key : null;
    const franchises = this.franchises.map((f) => this.publicFranchise(f, forKey));

    let auction = null;
    if (this.phase === "auction" && this.auction) {
      const hasBidder = Boolean(this.auction.currentBidderKey);
      const minBidLakhs = nextBidAmount(this.auction.currentBidLakhs, hasBidder);
      const incrementLakhs = bidIncrement(this.auction.currentBidLakhs);
      const leader = this.auction.currentBidderKey
        ? this.findByKey(this.auction.currentBidderKey)
        : null;
      const stillIn = this.stillInTeams().map((f) => ({
        name: f.name,
        short: f.franchise.short,
        color: f.franchise.color,
        franchiseName: f.franchise.name,
        purseLakhs: f.purseLakhs,
        isLeader: f.key === this.auction.currentBidderKey,
        isYou: f.key === forKey,
      }));
      let youCanBid = false;
      let youCanOptOut = false;
      let youReason = null;
      if (you) {
        if (this.auction.optedOut.has(you.key)) {
          youReason = "You opted out of this player.";
        } else if (you.key === this.auction.currentBidderKey) {
          youReason = "You have the leading bid.";
          youCanBid = false;
          youCanOptOut = false;
        } else {
          const check = canBidFor(you, this.auction.nominee, minBidLakhs, this.remainingPool(this.auction.nominee.id));
          youCanBid = check.ok;
          youCanOptOut = stillIn.some((s) => s.isYou);
          youReason = check.ok ? null : check.reason;
        }
      }
      auction = {
        nominee: this.auction.nominee,
        currentBidLakhs: this.auction.currentBidLakhs,
        currentBidderName: leader ? leader.name : null,
        currentBidderShort: leader ? leader.franchise.short : null,
        currentBidderColor: leader ? leader.franchise.color : null,
        hasBidder,
        minBidLakhs,
        incrementLakhs,
        endsAt: this.auction.endsAt,
        stillIn,
        youCanBid,
        youCanOptOut,
        youReason,
        pass: this.pass,
        soldCount: this.soldLog.length,
        remainingLots: this.queue.length + (this.pass === 1 ? this.unsold.length : 0),
        defaultBidderName: this.findByKey(this.auction.defaultBidderKey)?.name || null,
        defaultBidderShort: this.findByKey(this.auction.defaultBidderKey)?.franchise.short || null,
        isDefaultBidLeading: this.auction.currentBidderKey === this.auction.defaultBidderKey
          && this.auction.currentBidLakhs === this.auction.nominee.basePriceLakhs,
      };
    }

    return {
      code: this.code,
      phase: this.phase,
      purseLakhs: this.purseLakhs,
      ratingsNote: this.meta.ratingsNote || null,
      hostName: this.host ? this.host.name : null,
      you: you ? this.publicFranchise(you, forKey) : null,
      franchises,
      auction,
      lastEvent: this.lastEvent,
      soldLog: this.soldLog,
      captainEndsAt: this.captainEndsAt,
      captainsPending: this.phase === "captains"
        ? this.activeFranchises().filter((f) => !f.captainId && f.squad.length).map((f) => ({
            name: f.name,
            short: f.franchise.short,
            color: f.franchise.color,
          }))
        : [],
      eliminationLog: this.eliminationLog,
      tournament: this.tournament,
      quotas: QUOTA,
      squadSize: SQUAD_SIZE,
      maxOverseas: null,
      maxPlayers: MAX_PLAYERS,
      minPlayers: MIN_PLAYERS,
    };
  }
}

function makeRoomCode(existing) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = "";
    for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!existing.has(code)) return code;
  }
  return `X${Date.now().toString(36).slice(-3).toUpperCase()}`;
}

module.exports = { GameRoom, makeRoomCode, normalizeName, nameKey };
