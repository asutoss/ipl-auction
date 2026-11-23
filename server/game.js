const { EventEmitter } = require("events");
const { overallRating, officialHeadshotUrl } = require("./players");
const { simulateTournament, pickCaptainIfMissing, rollTeamForm, squadStrengthScore } = require("./simulate");
const { shortenPowerReason } = require("../public/power-reasons");
const {
  ROLES,
  MIN_PLAYERS,
  MAX_PLAYERS,
  FRANCHISES,
  roleCounts,
  overseasCount,
  remainingQuota,
  isSquadComplete,
  pendingSlots,
  resolveMode,
  publicMode,
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
const {
  CHARACTERS,
  getCharacter,
  nextCharacter,
  publicCharacter,
  getCharacterLine,
  findLine,
} = require("../public/characters");

function characterIdOf(pack) {
  if (!pack) return null;
  return pack.characterId || pack.id || null;
}

const { isValidEmoteId, EMOTE_RATE_MAX, EMOTE_RATE_WINDOW_MS } = require("../public/emotes");
const { resolveRng, shuffle } = require("./random");
const {
  POWER_REVEAL_MS,
  POWER_PICK_MS,
  RAKHI_CHOICE_MS,
  DOLLY_DISCONNECT_MS,
  publicPower,
  applyPower,
  canUsePower,
  resolvePower,
  getPowerImpl,
  listValidCopyPowers,
  usesNextLotSlot,
  hiddenNomineePlaceholder,
  displayName,
  isBanned,
  isOut,
  isBidBlocked,
  credit,
  debit,
  maybeBanBrokeIncomplete,
  banBrokeIncompleteTeams,
  transfer,
  peekNextPlayers,
} = require("./powers");
const { QUICK_CHAT_COOLDOWN_MS } = require("../public/quick-chat");
const { buildAuctionList, nextAuctionBatch, TOP_UP_BATCH } = require("./auction-pool");

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function nameKey(name) {
  return normalizeName(name).toLowerCase();
}

function envMs(name, fallback) {
  if (process.env[name] == null || process.env[name] === "") return fallback;
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function defaultTimers() {
  return {
    lotStartMs: Number(process.env.LOT_START_MS) || 25000,
    bidMs: Number(process.env.BID_TIMER_MS) || 25000,
    captainMs: Number(process.env.CAPTAIN_TIMER_MS) || 45000,
    soldRevealMs: envMs("SOLD_REVEAL_MS", 5000),
    powerRevealMs: envMs("POWER_REVEAL_MS", POWER_REVEAL_MS),
    lastTeamFillMs: envMs("LAST_TEAM_FILL_MS", 3000),
    playerIntroMs: envMs("PLAYER_INTRO_MS", 2000),
    resultsRevealStepMs: envMs("RESULTS_REVEAL_STEP_MS", 2800),
  };
}

class GameRoom extends EventEmitter {
  constructor({ code, purseLakhs, timers, allPlayers, meta, mode, rng, seed }) {
    super();
    this.code = code;
    this.mode = resolveMode(mode);
    this.modeId = this.mode.id;
    this.purseLakhs = purseLakhs != null && Number.isFinite(Number(purseLakhs))
      ? Math.round(Number(purseLakhs))
      : this.mode.purse;
    this.timers = { ...defaultTimers(), ...(timers || {}) };
    this.allPlayers = allPlayers;
    this.meta = meta || {};
    this.rng = resolveRng(rng !== undefined ? rng : seed);
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
    this.lotTotal = 0;
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
    this.powerReveal = null;
    this.powerFreeze = null;
    this.powerWait = null;
    this.pendingLotEffects = {};
    this.lotPowerUsed = false;
    this.powerLog = [];
    this.powerToast = null;
    this.chaiBreak = null;
    this.chaiDisconnectTimer = null;
    this.lastTeamFill = null;
    this.playerIntro = null;
    this.resultsReveal = null;
  }

  rollStartBid() {
    if (typeof this.startBidFn === "function") return this.startBidFn();
    if (this.forcedStartBid != null) {
      const n = Number(this.forcedStartBid);
      if (Number.isInteger(n) && n >= MIN_START_BID && n <= MAX_START_BID) return n;
    }
    return MIN_START_BID + Math.floor(Math.random() * (MAX_START_BID - MIN_START_BID + 1));
  }

  takenCharacterIds(exceptKey) {
    return new Set(
      this.franchises
        .filter((f) => f.key !== exceptKey && f.franchise && characterIdOf(f.franchise))
        .map((f) => characterIdOf(f.franchise))
    );
  }

  takenIdentityIds(exceptKey) {
    return this.takenCharacterIds(exceptKey);
  }

  assignCharacter(team, id) {
    const pack = publicCharacter(id);
    if (!pack) return false;
    team.franchise = pack;
    this.armTeamPower(team);
    return true;
  }

  armTeamPower(team) {
    if (!team) return;
    const def = publicPower(team.franchise && team.franchise.power);
    team.powerUsesTotal = def ? def.uses : 0;
    team.powerUsesLeft = def ? def.uses : 0;
    team.powerUsedCount = 0;
  }

  packTeamPower(team) {
    const def = publicPower(team && team.franchise && team.franchise.power);
    if (!def) {
      return { id: null, name: null, description: null, shortDesc: null, funnyDesc: null, uses: 0, usesLeft: 0, used: false };
    }
    const usesLeft = team.powerUsesLeft != null ? team.powerUsesLeft : def.uses;
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      shortDesc: def.shortDesc || "",
      funnyDesc: def.funnyDesc || "",
      uses: def.uses,
      usesLeft,
      used: usesLeft <= 0 || (team.powerUsedCount || 0) > 0,
      usesNextLotSlot: Boolean(def.usesNextLotSlot),
    };
  }

  assignIdentity(team, id) {
    return this.assignCharacter(team, id);
  }

  autoAssignCharacters() {
    const taken = new Set();
    for (const f of this.franchises) {
      const id = characterIdOf(f.franchise);
      if (id && getCharacter(id) && !taken.has(id)) {
        taken.add(id);
        continue;
      }
      const next = nextCharacter(taken);
      if (next) {
        this.assignCharacter(f, next.id);
        taken.add(next.id);
      }
    }
  }

  autoAssignIdentities() {
    return this.autoAssignCharacters();
  }

  requireUnpaused() {
    if (this.ended) return { ok: false, error: "This game has ended." };
    if (this.powerReveal) return { ok: false, error: "A power is being revealed." };
    if (this.powerWait) return { ok: false, error: "A power is waiting for a choice." };
    if (this.paused) return { ok: false, error: `Game is paused by ${this.pausedBy}.` };
    return { ok: true };
  }

  destroy() {
    this.clearTimer();
    this.clearChaiDisconnectTimer();
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

  socketIsLive(socketId) {
    if (!socketId) return false;
    if (typeof this.isSocketLive === "function") return Boolean(this.isSocketLive(socketId));
    return true;
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
      characterId: characterIdOf(f.franchise),
      identityId: characterIdOf(f.franchise),
      color2: f.franchise.color2 || null,
      emoji: f.franchise.emoji || null,
      purseLakhs: f.purseLakhs,
      isLeader: this.auction && f.key === this.auction.currentBidderKey,
      isYou: false,
      formPct: f.formPct != null ? f.formPct : null,
    }));
  }

  packLotSnapshot() {
    return this.franchises.map((f) => ({
      name: f.name,
      characterId: characterIdOf(f.franchise),
      identityId: characterIdOf(f.franchise),
      color: f.franchise && f.franchise.color,
      color2: (f.franchise && f.franchise.color2) || null,
      text: (f.franchise && (f.franchise.text || f.franchise.color)) || null,
      purseLakhs: f.purseLakhs,
      pending: pendingSlots(f.squad, this.mode),
      squadSize: (f.squad || []).length,
      complete: isSquadComplete(f.squad, this.mode),
      eliminated: Boolean(f.eliminated),
      banned: Boolean(f.banned) || (f.eliminated && f.eliminatedReason === "match_fixing"),
      powerUsed: Boolean(f.powerUsedCount) || (f.powerUsesLeft != null && f.powerUsesLeft <= 0),
      formPct: f.formPct != null ? f.formPct : null,
    }));
  }

  packTeamDelta(f) {
    if (!f) return null;
    return {
      name: f.name,
      purseLakhs: f.purseLakhs,
      squad: (f.squad || []).map((s) => ({
        player: s.player,
        priceLakhs: s.priceLakhs,
        isCaptain: f.captainId === (s.player && s.player.id),
      })),
      roleCounts: roleCounts(f.squad),
      overseasCount: overseasCount(f.squad),
      remainingQuota: remainingQuota(f.squad, this.mode),
      complete: isSquadComplete(f.squad, this.mode),
      captainId: f.captainId || null,
      formPct: f.formPct != null ? f.formPct : null,
      eliminated: Boolean(f.eliminated),
      banned: Boolean(f.banned) || (f.eliminated && f.eliminatedReason === "match_fixing"),
    };
  }

  packPowerAftermath() {
    return {
      teams: this.franchises.map((f) => this.packTeamDelta(f)),
      lotSnapshot: this.auction ? this.packLotSnapshot() : null,
      wipedPlayerIds: (this.soldLog || []).filter((e) => e.wiped && e.player).map((e) => e.player.id),
    };
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
      lotId: this.lotId,
      lotTotal: this.lotTotal,
      soldCount: this.soldLog.length,
      remainingLots: this.countRemainingLots(),
      defaultBidderName: def ? def.name : null,
      defaultBidderShort: def ? def.name : null,
      isDefaultBidLeading: this.auction.currentBidderKey === this.auction.defaultBidderKey
        && this.auction.currentBidLakhs === this.auction.startBidLakhs,
      startBidLakhs: this.auction.startBidLakhs,
      timerMs: this.auction.timerMs || this.timers.lotStartMs,
      lotSnapshot: this.auction.lotSnapshot || this.packLotSnapshot(),
      vfxHidden: Boolean(this.auction.vfxHidden),
      vfxSeerKey: this.auction.vfxSeerKey || null,
      broadcastActive: Boolean(this.auction.broadcastKey),
      muteByKey: this.auction.muteByKey || null,
      lockFlip: this.auction.lockFlip || null,
      playerIntro: this.packPlayerIntro(),
      nextHeadshot: officialHeadshotUrl(this.queue && this.queue[0] && this.queue[0].headshot),
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
      const claimedByOther = existing.socketId && existing.socketId !== socketId;
      if (claimedByOther && existing.connected && this.socketIsLive(existing.socketId)) {
        return { ok: false, error: "That team name is already in this room." };
      }
      existing.socketId = socketId;
      existing.connected = true;
      if (this.chaiBreak && this.chaiBreak.actorKey === existing.key) {
        this.clearChaiDisconnectTimer();
      }
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

    const pack = publicCharacter(nextCharacter(this.takenCharacterIds()));
    if (!pack) return { ok: false, error: "No co-owners left to assign." };
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
      banned: false,
      formPct: null,
      spentLakhs: 0,
      bidBlockedUntilLot: null,
      rakhiBlockLot: null,
      samayPreview: null,
    };
    this.armTeamPower(franchise);
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
    if (this.chaiBreak && this.chaiBreak.actorKey === f.key) {
      this.armChaiDisconnect();
    }
    if (f.key === this.hostKey) {
      const next = this.franchises.find((x) => x.connected && x.key !== f.key);
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

  selectCharacter(byName, characterId) {
    if (this.ended) return { ok: false, error: "This game has ended." };
    if (this.phase !== "lobby") return { ok: false, error: "Characters are locked once the auction starts." };
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    const pack = publicCharacter(characterId);
    if (!pack) return { ok: false, error: "Unknown co-owner." };
    const taken = this.takenCharacterIds(team.key);
    if (taken.has(pack.id)) return { ok: false, error: "That co-owner is already taken." };
    this.assignCharacter(team, pack.id);
    this.bump("lobby");
    return { ok: true };
  }

  selectIdentity(byName, identityId) {
    return this.selectCharacter(byName, identityId);
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
    this.powerReveal = null;
    this.powerFreeze = null;
    this.powerWait = null;
    this.chaiBreak = null;
    this.clearTimer();
    this.clearChaiDisconnectTimer();
    this.phase = "ended";
    this.auction = null;
    const endedBy = team ? team.name : byName;
    this.emit("ended", { byName: endedBy, abandoned: Boolean(opts.abandoned) });
    return { ok: true, ended: true };
  }

  pause(byName) {
    const gate = this.requireUnpaused();
    if (!gate.ok) {
      if (this.paused && !this.ended) {
        return { ok: false, error: `Game is already paused by ${this.pausedBy}.` };
      }
      return gate;
    }
    if (this.paused) return { ok: false, error: `Game is already paused by ${this.pausedBy}.` };
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    const revealOpen = this.phase === "results" && this.resultsReveal && !this.resultsReveal.skipped
      && this.resultsReveal.revealedCount < this.resultsReveal.total;
    if (this.phase !== "auction" && this.phase !== "captains" && !revealOpen) {
      return { ok: false, error: "Nothing to pause right now." };
    }
    if (this.phase === "auction" && this.playerIntro && this.playerIntro.endsAt) {
      this.pauseRemainingMs = Math.max(0, this.playerIntro.endsAt - Date.now());
      this.pauseTimerKind = "playerIntro";
    } else if (this.phase === "auction" && this.auction && this.auction.endsAt && !this.playerIntro) {
      this.pauseRemainingMs = Math.max(0, (this.auction.endsAt || Date.now()) - Date.now());
      this.pauseTimerKind = "lot";
    } else if (this.phase === "results" && revealOpen) {
      this.pauseRemainingMs = Math.max(0, (this.resultsReveal.nextAt || Date.now()) - Date.now());
      this.pauseTimerKind = "resultsReveal";
    } else if (this.phase === "auction" && this.lastTeamFill && this.lastTeamFill.endsAt) {
      this.pauseRemainingMs = Math.max(0, this.lastTeamFill.endsAt - Date.now());
      this.pauseTimerKind = "lastTeamFill";
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
    if (this.chaiBreak || this.pauseTimerKind === "chai") {
      return { ok: false, error: "Only Dolly can end the chai break." };
    }
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
    } else if (kind === "playerIntro" && this.phase === "auction" && this.playerIntro && remaining != null) {
      this.playerIntro.endsAt = Date.now() + remaining;
      endsAt = this.playerIntro.endsAt;
      this.armTimer(() => this.finishPlayerIntro(), remaining);
    } else if (kind === "resultsReveal" && this.phase === "results" && this.resultsReveal && remaining != null) {
      this.resultsReveal.nextAt = Date.now() + remaining;
      endsAt = this.resultsReveal.nextAt;
      this.armTimer(() => this.tickResultsReveal(), remaining);
    } else if (kind === "lastTeamFill" && this.phase === "auction" && this.lastTeamFill && remaining != null) {
      this.lastTeamFill.endsAt = Date.now() + remaining;
      endsAt = this.lastTeamFill.endsAt;
      this.armTimer(() => this.finishLastTeamFill(), remaining);
    } else if (kind === "reveal" && this.phase === "auction" && remaining != null) {
      this.revealUntil = Date.now() + remaining;
      endsAt = this.revealUntil;
      this.armTimer(() => this.finishReveal(), remaining);
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
      soldRevealUntil: this.phase === "auction" && this.revealUntil ? this.revealUntil : null,
      lastTeamFillUntil: this.phase === "auction" && this.lastTeamFill && this.lastTeamFill.endsAt ? this.lastTeamFill.endsAt : null,
      playerIntroUntil: this.phase === "auction" && this.playerIntro && this.playerIntro.endsAt ? this.playerIntro.endsAt : null,
      resultsReveal: this.packResultsReveal(),
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
    this.autoAssignCharacters();
    for (const f of this.franchises) this.armTeamPower(f);
    this.powerReveal = null;
    this.powerFreeze = null;
    this.powerWait = null;
    this.pendingLotEffects = {};
    this.lotPowerUsed = false;
    this.powerLog = [];
    this.powerToast = null;
    this.chaiBreak = null;
    this.clearChaiDisconnectTimer();
    this.phase = "auction";
    this.queue = buildAuctionList(this.allPlayers, this.mode, this.franchises.length, this.rng);
    this.lotTotal = this.queue.length;
    this.lotId = 0;
    this.unsold = [];
    this.pass = 1;
    this.soldIds = new Set();
    this.soldLog = [];
    this.rrIndex = 0;
    this.eliminationLog = [];
    this.revealUntil = null;
    this.unaffordableIds = new Set();
    for (const team of this.franchises) {
      team.spentLakhs = 0;
      team.banned = false;
      team.bidBlockedUntilLot = null;
      team.rakhiBlockLot = null;
      team.samayPreview = null;
    }
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
    return active.every((f) => isSquadComplete(f.squad, this.mode));
  }

  incompleteTeams() {
    return this.activeFranchises().filter((f) => !isSquadComplete(f.squad, this.mode));
  }

  neededRoles() {
    const roles = new Set();
    for (const f of this.incompleteTeams()) {
      const left = remainingQuota(f.squad, this.mode);
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

  queueIds() {
    return new Set((this.queue || []).map((p) => p && p.id).filter(Boolean));
  }

  usedPlayerIdSet() {
    return new Set([
      ...this.soldIds,
      ...this.unaffordableIds,
      ...this.queueIds(),
      ...(this.unsold || []).map((p) => p && p.id).filter(Boolean),
    ]);
  }

  appendTopUpBatch() {
    const needed = this.neededRoles();
    if (needed.size === 0) return false;
    const batch = nextAuctionBatch({
      allPlayers: this.allPlayers,
      usedIds: this.usedPlayerIdSet(),
      neededRoles: needed,
      rng: this.rng,
      size: TOP_UP_BATCH,
    });
    if (!batch.length) return false;
    this.queue.push(...batch);
    this.lotTotal += batch.length;
    const message = `${batch.length} more player${batch.length === 1 ? " has" : "s have"} been added to the auction.`;
    this.lastEvent = { type: "poolTopUp", count: batch.length, message };
    this.emitDelta({ type: "poolTopUp", count: batch.length, message });
    return true;
  }

  appendNeededPlayers() {
    return this.appendTopUpBatch();
  }

  closeAuctionForEmptyPool() {
    const before = this.franchises.reduce((n, team) => n + ((team.squad || []).length), 0);
    this.autoFill();
    const added = this.franchises.reduce((n, team) => n + ((team.squad || []).length), 0) - before;
    const message = added > 0
      ? "No more players are left in the pool. Remaining gaps were filled at the starting bid where possible."
      : "No more players are left in the pool. The auction will close with the squads as they are.";
    this.lastEvent = { type: "poolExhausted", added, message };
    this.emitDelta({ type: "poolExhausted", added, message });
    this.beginCaptainPhase();
  }

  refillQueue() {
    const needed = this.neededRoles();
    if (needed.size === 0) return false;

    const fromUnsold = this.takeNeededFrom(this.unsold);
    this.unsold = fromUnsold.rest;
    if (fromUnsold.out.length) {
      const inQueue = this.queueIds();
      const add = fromUnsold.out.filter((p) => p && !inQueue.has(p.id));
      if (add.length) {
        this.queue.push(...add);
        return true;
      }
    }

    return this.appendNeededPlayers();
  }

  countRemainingLots() {
    const needed = this.neededRoles();
    if (needed.size === 0) return 0;
    const seen = new Set([...this.soldIds, ...this.unaffordableIds]);
    let n = 0;
    // Only the live auction list (queue + any unsold not yet re-queued).
    // Players still sitting unused in the full DB are not "still to come"
    // until appendNeededPlayers pulls them in.
    for (const p of [...this.queue, ...this.unsold]) {
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      if (needed.has(p.role)) n += 1;
    }
    return n;
  }

  isEligible(team, player, amountLakhs) {
    if (!team || team.eliminated || team.banned) return false;
    if (isBidBlocked(this, team)) return false;
    return canBidFor(team, player, amountLakhs, this.remainingPool(player.id), { mode: this.mode }).ok;
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
      if (team.eliminated || team.banned || isSquadComplete(team.squad, this.mode)) continue;
      if (isBidBlocked(this, team)) continue;
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
      if (f.eliminated || f.banned) return false;
      if (optedOut.has(f.key)) return false;
      if (f.key === currentBidderKey) return true;
      if (isBidBlocked(this, f)) return false;
      return this.isEligible(f, nominee, minBid);
    });
  }

  lotWouldResolveNow() {
    if (this.phase !== "auction" || !this.auction) return false;
    const inTeams = this.stillInTeams();
    const leader = this.auction.currentBidderKey;
    if (leader) return inTeams.filter((f) => f.key !== leader).length === 0;
    return inTeams.length === 0;
  }

  maybeResolveLot() {
    if (this.playerIntro) return false;
    if (!this.lotWouldResolveNow()) return false;
    if (this.auction.currentBidderKey) this.sellCurrent();
    else this.unsoldCurrent();
    return true;
  }

  startLotTimer(reset = false) {
    const lotId = this.lotId;
    const ms = reset ? this.timers.bidMs : this.timers.lotStartMs;
    this.auction.timerMs = ms;
    this.auction.endsAt = Date.now() + ms;
    this.armTimer(() => this.onLotTimeout(lotId), ms);
  }

  onLotTimeout(lotId) {
    if (this.paused || this.ended || this.powerReveal || this.powerWait || this.playerIntro) return;
    if (this.phase !== "auction" || !this.auction || this.lotId !== lotId) return;
    if (this.auction.currentBidderKey || this.auction.defaultBidderKey) this.sellCurrent();
    else this.unsoldCurrent();
  }

  lastTeamFillDelayMs() {
    const n = Number(this.timers && this.timers.lastTeamFillMs);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  packLastTeamFill() {
    const fill = this.lastTeamFill;
    if (!fill) return null;
    return {
      buyerName: fill.buyerName,
      buyerShort: fill.buyerShort,
      characterId: fill.characterId,
      color: fill.color,
      color2: fill.color2,
      text: fill.text,
      entries: fill.entries,
      endsAt: fill.endsAt,
      revealMs: fill.revealMs,
      purseLakhs: fill.purseLakhs,
    };
  }

  assignRemainingToLastTeam() {
    const team = this.incompleteTeams()[0];
    if (!team) return { team: null, entries: [] };
    const entries = [];
    for (;;) {
      if (isOut(team) || isSquadComplete(team.squad, this.mode)) break;
      if (this.queue.length === 0) {
        if (!this.refillQueue()) break;
      }
      const player = this.queue.shift();
      if (!player || this.soldIds.has(player.id) || this.unaffordableIds.has(player.id)) continue;
      if (!this.neededRoles().has(player.role)) continue;
      const startBid = this.rollStartBid();
      const defaultTeam = this.pickDefaultTeam(player, startBid);
      if (!defaultTeam || defaultTeam.key !== team.key) {
        if (!defaultTeam) this.unaffordableIds.add(player.id);
        if (isOut(team)) break;
        continue;
      }
      team.squad.push({ player, priceLakhs: startBid });
      const paid = debit(this, team, startBid);
      team.spentLakhs = (team.spentLakhs || 0) + paid;
      this.soldIds.add(player.id);
      this.soldLog.push({
        player,
        priceLakhs: startBid,
        buyerName: team.name,
        short: team.name,
        color: team.franchise && team.franchise.color,
        auto: true,
        lastTeamFill: true,
      });
      entries.push({
        player,
        priceLakhs: startBid,
        paid,
        buyerName: team.name,
      });
    }
    this.maybeRevealForm(team);
    return { team, entries };
  }

  beginLastTeamFill(team, entries) {
    this.auction = null;
    const ms = this.lastTeamFillDelayMs();
    this.lastTeamFill = {
      buyerName: team.name,
      buyerShort: team.name,
      characterId: characterIdOf(team.franchise),
      color: team.franchise && team.franchise.color,
      color2: team.franchise && team.franchise.color2,
      text: team.franchise && (team.franchise.text || team.franchise.color),
      entries,
      endsAt: ms > 0 ? Date.now() + ms : Date.now(),
      revealMs: ms,
      purseLakhs: team.purseLakhs,
    };
    const packed = this.packLastTeamFill();
    const message = `${team.name} is being filled with the remaining players.`;
    this.lastEvent = { type: "lastTeamFill", ...packed, message };
    this.emitDelta({ type: "lastTeamFill", ...packed, message });
    if (ms <= 0 || this.ended) {
      this.finishLastTeamFill();
      return;
    }
    this.clearTimer();
    this.armTimer(() => this.finishLastTeamFill(), ms);
  }

  finishLastTeamFill() {
    if (this.paused || this.ended) return;
    if (this.phase !== "auction" || !this.lastTeamFill) return;
    this.clearTimer();
    this.lastTeamFill = null;
    this.emitDelta({ type: "lastTeamFillEnded" });
    this.nominateNext();
  }

  tryLastTeamFill() {
    if (this.ended || this.phase !== "auction") return false;
    if (this.lastTeamFill) return true;
    if (this.incompleteTeams().length !== 1) return false;
    const { team, entries } = this.assignRemainingToLastTeam();
    if (!team || !entries.length) return false;
    this.beginLastTeamFill(team, entries);
    return true;
  }

  nominateNext() {
    this.clearTimer();
    this.revealUntil = null;
    banBrokeIncompleteTeams(this);
    this.revealForms();
    if (this.lastTeamFill) return;
    if (this.allTeamsFull() || this.activeFranchises().length === 0) {
      this.beginCaptainPhase();
      return;
    }
    if (this.tryLastTeamFill()) return;

    for (;;) {
      if (this.allTeamsFull()) {
        this.beginCaptainPhase();
        return;
      }
      if (this.queue.length === 0) {
        if (!this.refillQueue()) {
          this.closeAuctionForEmptyPool();
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
      this.applyPendingLotEffects();
      const introMs = this.playerIntroDelayMs();
      if (introMs > 0 && !this.lotWouldResolveNow()) {
        this.beginPlayerIntro(introMs);
        this.emitDelta({ type: "lotStart", ...this.packAuctionPublic() });
      } else {
        this.startLotTimer(false);
        if (!this.maybeResolveLot()) {
          this.emitDelta({ type: "lotStart", ...this.packAuctionPublic() });
        }
      }
      return;
    }
  }

  playerIntroDelayMs() {
    const n = Number(this.timers && this.timers.playerIntroMs);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  beginPlayerIntro(ms) {
    const duration = Math.max(0, Number(ms) || 0);
    this.playerIntro = {
      endsAt: Date.now() + duration,
      revealMs: duration,
      startBidLakhs: this.auction ? this.auction.startBidLakhs : null,
    };
    if (this.auction) {
      this.auction.endsAt = null;
      this.auction.timerMs = this.timers.lotStartMs;
    }
    this.clearTimer();
    this.armTimer(() => this.finishPlayerIntro(), duration);
  }

  packPlayerIntro() {
    const intro = this.playerIntro;
    if (!intro || !this.auction) return null;
    return {
      endsAt: intro.endsAt,
      revealMs: intro.revealMs,
      startBidLakhs: intro.startBidLakhs != null ? intro.startBidLakhs : this.auction.startBidLakhs,
    };
  }

  finishPlayerIntro() {
    if (this.paused || this.ended) return;
    if (this.phase !== "auction" || !this.auction || !this.playerIntro) return;
    this.playerIntro = null;
    this.startLotTimer(false);
    if (!this.maybeResolveLot()) {
      this.emitDelta({
        type: "playerIntroEnded",
        endsAt: this.auction.endsAt,
        auctionEndsAt: this.auction.endsAt,
        timerMs: this.auction.timerMs,
        ...this.packAuctionPublic(),
      });
    }
  }

  resultsRevealDelayMs() {
    const n = Number(this.timers && this.timers.resultsRevealStepMs);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  finishLabel(pos, playoffs) {
    if (!pos) return "";
    if (pos.eliminated || /eliminated|banned|match fixing/i.test(String(pos.title || ""))) {
      return pos.title || "Eliminated";
    }
    if (pos.title === "Champion") return "Champion";
    if (pos.title === "Runner-up") return "Runner-up";
    const format = playoffs && playoffs.format;
    if (format === "ipl-playoffs") {
      if (playoffs.thirdName && pos.name === playoffs.thirdName) return "Lost Qualifier 2";
      if (playoffs.fourthName && pos.name === playoffs.fourthName) return "Lost Eliminator";
    }
    if (/in league/i.test(String(pos.title || ""))) return "Out in league";
    return pos.title || "";
  }

  packResultsReveal() {
    const r = this.resultsReveal;
    if (!r) return null;
    return {
      startedAt: r.startedAt,
      stepMs: r.stepMs,
      total: r.total,
      revealedCount: r.revealedCount,
      skipped: Boolean(r.skipped),
      complete: Boolean(r.skipped || r.revealedCount >= r.total),
      nextAt: r.nextAt || null,
    };
  }

  startResultsReveal() {
    const positions = (this.tournament && this.tournament.positions) || [];
    const step = this.resultsRevealDelayMs();
    const first = step <= 0 ? positions.length : (positions.length ? 1 : 0);
    this.resultsReveal = {
      startedAt: Date.now(),
      stepMs: step,
      total: positions.length,
      revealedCount: first,
      skipped: step <= 0,
      nextAt: step > 0 && first < positions.length ? Date.now() + step : null,
    };
    this.bump("results");
    if (step > 0 && first < positions.length) {
      this.clearTimer();
      this.armTimer(() => this.tickResultsReveal(), step);
    }
  }

  tickResultsReveal() {
    if (this.paused || this.ended) return;
    const r = this.resultsReveal;
    if (!r || r.skipped || r.revealedCount >= r.total) return;
    r.revealedCount += 1;
    const complete = r.revealedCount >= r.total;
    r.nextAt = complete ? null : Date.now() + r.stepMs;
    this.emitDelta({
      type: "resultsReveal",
      revealedCount: r.revealedCount,
      total: r.total,
      complete,
      skipped: false,
      nextAt: r.nextAt,
    });
    if (!complete) this.armTimer(() => this.tickResultsReveal(), r.stepMs);
  }

  skipResultsReveal(byName) {
    if (this.ended) return { ok: false, error: "This game has ended." };
    if (this.phase !== "results" || !this.resultsReveal) return { ok: true, already: true };
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    if (this.paused) return { ok: false, error: `Game is paused by ${this.pausedBy}.` };
    const r = this.resultsReveal;
    r.skipped = true;
    r.revealedCount = r.total;
    r.nextAt = null;
    this.clearTimer();
    this.emitDelta({
      type: "resultsReveal",
      revealedCount: r.revealedCount,
      total: r.total,
      complete: true,
      skipped: true,
      nextAt: null,
    });
    return { ok: true };
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
    this.armTimer(() => this.finishReveal(), ms);
  }

  finishReveal() {
    if (this.paused || this.ended) return;
    if (this.phase !== "auction") return;
    if (this.auction || !this.revealUntil) return;
    this.clearTimer();
    this.revealUntil = null;
    this.nominateNext();
  }

  continueReveal(byName) {
    const gate = this.requireUnpaused();
    if (!gate.ok) return gate;
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    if (this.phase === "auction" && this.lastTeamFill && !this.auction) {
      this.finishLastTeamFill();
      return { ok: true };
    }
    if (this.phase !== "auction" || this.auction || !this.revealUntil) {
      return { ok: true, already: true };
    }
    this.clearTimer();
    this.revealUntil = null;
    this.emitDelta({ type: "revealContinued", byName: team.name, soldRevealUntil: null });
    this.nominateNext();
    return { ok: true };
  }

  maybeRevealForm(team) {
    if (!team) return false;
    if (team.formPct != null) return false;
    if (!isSquadComplete(team.squad, this.mode)) return false;
    const rng = this.rng && typeof this.rng.random === "function" ? this.rng : this.rng;
    team.formPct = rollTeamForm(rng);
    const message = `${team.name}'s squad is in ${team.formPct}% form`;
    const evt = {
      type: "teamForm",
      name: team.name,
      short: team.name,
      formPct: team.formPct,
      color: team.franchise && team.franchise.color,
      color2: team.franchise && team.franchise.color2,
      text: team.franchise && (team.franchise.text || team.franchise.color),
      characterId: characterIdOf(team.franchise),
      message,
    };
    this.lastEvent = evt;
    this.emitDelta(evt);
    return true;
  }

  revealForms() {
    let n = 0;
    for (const team of this.franchises || []) {
      if (this.maybeRevealForm(team)) n += 1;
    }
    return n;
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
      characterId: characterIdOf(winner.franchise),
      identityId: characterIdOf(winner.franchise),
      purseLakhs: winner.purseLakhs,
      squadSize: winner.squad.length,
      complete: isSquadComplete(winner.squad, this.mode),
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
    let price = this.auction.currentBidLakhs != null ? this.auction.currentBidLakhs : this.auction.startBidLakhs;
    if (!winner) {
      this.unsoldCurrent();
      return;
    }
    const flip = this.auction.lockFlip;
    if (flip && flip.result === "win" && winner.key === flip.byKey) {
      price = Math.ceil(Number(price) / 2);
    } else if (flip && flip.result === "lose") {
      price = Number(price) * 2;
    }
    winner.squad.push({ player, priceLakhs: price });
    const paid = debit(this, winner, price);
    winner.spentLakhs = (Number(winner.spentLakhs) || 0) + paid;
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
      characterId: packed.characterId,
      identityId: packed.identityId,
    });
    this.lastEvent = packed;
    this.playerIntro = null;
    this.auction = null;
    this.revealUntil = packed.revealUntil;
    this.emitDelta(packed);
    this.maybeRevealForm(winner);
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
    if (!this.queue.some((p) => p.id === player.id)) this.queue.push(player);
    const revealMs = this.revealDelayMs();
    const revealUntil = revealMs > 0 ? Date.now() + revealMs : null;
    this.playerIntro = null;
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
    if (this.playerIntro) {
      return { ok: false, error: "Wait for the player to be introduced." };
    }
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    if (team.eliminated || team.banned) {
      return { ok: false, error: team.banned ? "You are banned for match fixing." : "Your franchise has been eliminated." };
    }
    if (isBidBlocked(this, team)) {
      return { ok: false, error: "You are blocked from bidding on this lot." };
    }
    if (this.auction.muteByKey && team.key !== this.auction.muteByKey) {
      return { ok: false, error: "Elvish has muted the room." };
    }
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

    const check = canBidFor(team, this.auction.nominee, amount, this.remainingPool(this.auction.nominee.id), { mode: this.mode });
    if (!check.ok) return { ok: false, error: check.reason };

    const taxHost = this.auction.broadcastKey ? this.findByKey(this.auction.broadcastKey) : null;
    const jayTax = Boolean(taxHost && !isOut(taxHost) && team.key !== taxHost.key);
    if (jayTax && (Number(team.purseLakhs) || 0) < amount + 1) {
      return { ok: false, error: `You need ${amount + 1} points to cover the broadcast fee.` };
    }

    this.auction.currentBidLakhs = amount;
    this.auction.currentBidderKey = team.key;
    if (jayTax) {
      const paid = transfer(this, team, taxHost, 1);
      this.auction.lastBroadcastTax = { from: team.name, to: taxHost.name, paid };
      if (this._needLotResolve) {
        this._needLotResolve = false;
        if (this.maybeResolveLot()) return { ok: true };
      }
    }
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
    if (this.playerIntro) {
      return { ok: false, error: "Wait for the player to be introduced." };
    }
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    if (team.eliminated || team.banned) {
      return { ok: false, error: team.banned ? "You are banned for match fixing." : "Your franchise has been eliminated." };
    }
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
      const needy = this.activeFranchises().filter((f) => !isSquadComplete(f.squad, this.mode));
      if (needy.length === 0) break;
      for (const team of needy) {
        const left = remainingQuota(team.squad, this.mode);
        const pick = leftover.find((p) => (left[p.role] || 0) > 0 && team.purseLakhs >= fillPrice);
        if (!pick) continue;
        team.squad.push({ player: pick, priceLakhs: fillPrice });
        const paid = debit(this, team, fillPrice);
        team.spentLakhs = (Number(team.spentLakhs) || 0) + paid;
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
    this.revealForms();
    this.lastEvent = { type: "autofill", message: "Remaining gaps were filled at base price where possible." };
  }

  beginCaptainPhase() {
    this.clearTimer();
    this.phase = "captains";
    this.auction = null;
    this.lastTeamFill = null;
    this.revealUntil = null;
    this.revealForms();
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
    const result = simulateTournament(active, seed, { mode: this.mode });
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
        characterId: characterIdOf(f.franchise),
        identityId: characterIdOf(f.franchise),
        franchiseName: f.name,
        title: "Eliminated - insufficient purse",
        eliminated: true,
        leaguePosition: null,
        points: 0,
        nrr: 0,
      });
    }
    this.tournament = result;
    this.decorateResultPositions();
    this.phase = "results";
    this.finishedAt = Date.now();
    this.startResultsReveal();
  }

  decorateResultPositions() {
    const t = this.tournament;
    if (!t || !Array.isArray(t.positions)) return;
    const playoffs = t.playoffs || {};
    for (const pos of t.positions) {
      const team = this.franchises.find((f) => f.name === pos.name);
      pos.formPct = team && team.formPct != null ? team.formPct : (pos.formPct != null ? pos.formPct : null);
      pos.squadScore = team ? squadStrengthScore(team) : (pos.squadScore != null ? pos.squadScore : 0);
      pos.finish = this.finishLabel(pos, playoffs);
      if (team && team.franchise) {
        pos.characterId = pos.characterId || characterIdOf(team.franchise);
        pos.identityId = pos.identityId || pos.characterId;
        pos.color2 = pos.color2 || team.franchise.color2 || null;
        pos.image = team.franchise.image || team.franchise.logo || null;
      }
    }
  }

  publicFranchise(f, forKey) {
    const power = this.packTeamPower(f);
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
      remainingQuota: remainingQuota(f.squad, this.mode),
      complete: isSquadComplete(f.squad, this.mode),
      captainId: f.captainId,
      boosters: (f.boosters || []).map((b) => ({ id: b.id, name: b.name, pricePoints: b.pricePoints })),
      eliminated: Boolean(f.eliminated),
      banned: Boolean(f.banned) || (f.eliminated && f.eliminatedReason === "match_fixing"),
      eliminatedReason: f.banned || (f.eliminated && f.eliminatedReason === "match_fixing")
        ? "Banned for match fixing"
        : (f.eliminated ? "Eliminated - insufficient purse" : null),
      bidBlocked: isBidBlocked(this, f),
      power,
      powerUsesLeft: power.usesLeft,
      powerUsed: power.used,
      formPct: f.formPct != null ? f.formPct : null,
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
        characterId: characterIdOf(f.franchise),
        identityId: characterIdOf(f.franchise),
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
        formPct: f.formPct != null ? f.formPct : (row && row.formPct != null ? row.formPct : null),
        squadScore: pos && pos.squadScore != null ? pos.squadScore : squadStrengthScore(f),
        finish: pos ? (pos.finish || this.finishLabel(pos, t.playoffs || {})) : (f.eliminated ? "Eliminated" : null),
        squad: f.squad.map((s) => ({
          player: s.player,
          priceLakhs: s.priceLakhs,
          isCaptain: f.captainId === s.player.id,
          stats: statMap.get(s.player.id) || null,
        })),
      };
    });
  }


  packPowerReveal() {
    const r = this.powerReveal;
    if (!r) return null;
    return {
      teamId: r.teamId,
      name: r.name,
      characterId: r.characterId,
      powerId: r.powerId,
      powerName: r.powerName,
      description: r.description,
      color: r.color,
      image: r.image,
      endsAt: r.endsAt,
      revealMs: r.revealMs,
      message: r.message || null,
      copiedPowerId: r.copiedPowerId || null,
      copiedPowerName: r.copiedPowerName || null,
      copiedFrom: r.copiedFrom || null,
    };
  }

  captureAuctionTimer() {
    if (this.phase === "auction" && this.auction) {
      return { kind: "lot", remainingMs: Math.max(0, (this.auction.endsAt || Date.now()) - Date.now()) };
    }
    if (this.phase === "auction" && this.revealUntil) {
      return { kind: "reveal", remainingMs: Math.max(0, this.revealUntil - Date.now()) };
    }
    if (this.phase === "captains" && this.captainEndsAt) {
      return { kind: "captain", remainingMs: Math.max(0, this.captainEndsAt - Date.now()) };
    }
    return { kind: null, remainingMs: null };
  }

  freezeForPower() {
    this.powerFreeze = this.captureAuctionTimer();
    this.clearTimer();
  }

  thawPowerFreeze() {
    const frozen = this.powerFreeze;
    this.powerFreeze = null;
    if (!frozen || frozen.remainingMs == null) return null;
    const remaining = frozen.remainingMs;
    const kind = frozen.kind;
    let endsAt = null;
    if (kind === "lot" && this.phase === "auction" && this.auction) {
      const lotId = this.lotId;
      this.auction.endsAt = Date.now() + remaining;
      endsAt = this.auction.endsAt;
      this.armTimer(() => this.onLotTimeout(lotId), remaining);
    } else if (kind === "reveal" && this.phase === "auction") {
      this.revealUntil = Date.now() + remaining;
      endsAt = this.revealUntil;
      this.armTimer(() => this.finishReveal(), remaining);
    } else if (kind === "captain" && this.phase === "captains") {
      this.captainEndsAt = Date.now() + remaining;
      endsAt = this.captainEndsAt;
      this.armTimer(() => this.finishCaptains(), remaining);
    }
    return endsAt;
  }

  clearChaiDisconnectTimer() {
    if (this.chaiDisconnectTimer) {
      clearTimeout(this.chaiDisconnectTimer);
      this.chaiDisconnectTimer = null;
    }
  }

  armChaiDisconnect() {
    this.clearChaiDisconnectTimer();
    const ms = Number(this.timers.dollyDisconnectMs) || DOLLY_DISCONNECT_MS;
    this.chaiDisconnectTimer = setTimeout(() => {
      this.chaiDisconnectTimer = null;
      if (this.ended || !this.chaiBreak) return;
      this.endChaiBreak(null, { auto: true });
    }, ms);
    if (typeof this.chaiDisconnectTimer.unref === "function") this.chaiDisconnectTimer.unref();
    this.emitDelta({
      type: "chaiDisconnectArmed",
      endsAt: Date.now() + ms,
      message: "Dolly disconnected. Chai break will end in 30 seconds.",
    });
  }

  applyPendingLotEffects() {
    const pending = this.pendingLotEffects || {};
    this.lotPowerUsed = Boolean(pending.powerLocked);
    if (this.auction) {
      this.auction.vfxSeerKey = pending.vfxSeerKey || null;
      this.auction.vfxHidden = Boolean(pending.vfxSeerKey);
      this.auction.broadcastKey = pending.broadcastKey || null;
    }
    this.pendingLotEffects = {};
  }

  returnPlayerToPool(player) {
    if (!player) return;
    if (this.soldIds && this.soldIds.delete) this.soldIds.delete(player.id);
    if (this.unaffordableIds && this.unaffordableIds.delete) this.unaffordableIds.delete(player.id);
    this.queue = this.queue || [];
    if (!this.queue.some((p) => p.id === player.id)) this.queue.unshift(player);
    for (const entry of this.soldLog || []) {
      if (entry.player && entry.player.id === player.id) entry.wiped = true;
    }
    this.lotTotal = (this.lotTotal || 0) + 1;
  }

  banForMatchFixing(team) {
    if (!team || team.banned) return;
    team.banned = true;
    team.eliminated = true;
    team.eliminatedReason = "match_fixing";
    team.eliminatedAt = Date.now();
    team.purseLakhs = 0;
    const entry = {
      name: team.name,
      short: team.name,
      color: team.franchise && team.franchise.color,
      reason: "Banned for match fixing",
      banned: true,
    };
    this.eliminationLog.push(entry);
    this.lastEvent = { type: "banned", ...entry };
    this.emitDelta({ type: "banned", ...entry });
    if (this.auction) {
      this.auction.optedOut.add(team.key);
      if (this.auction.currentBidderKey === team.key) {
        this.auction.currentBidderKey = null;
        if (this.auction.defaultBidderKey === team.key) this.auction.defaultBidderKey = null;
        this._needLotResolve = true;
      }
    }
  }

  maybeResolveAfterPower() {
    if (!this._needLotResolve) return;
    this._needLotResolve = false;
    if (this.auction) this.maybeResolveLot();
  }

  appendPowerLog(message, extra = {}) {
    const entry = { message, at: Date.now(), ...extra };
    this.powerLog = this.powerLog || [];
    this.powerLog.push(entry);
    if (this.powerLog.length > 40) this.powerLog = this.powerLog.slice(-40);
    this.powerToast = entry;
    return entry;
  }

  packPowerWait(forKey) {
    const w = this.powerWait;
    if (!w) return null;
    const isActor = forKey && w.actorKey === forKey;
    const isChooser = w.kind === "rakhi_choices" && forKey && forKey !== w.actorKey;
    const youChoice = w.choices && forKey ? w.choices[forKey] : null;
    const packed = {
      kind: w.kind,
      actorKey: w.actorKey,
      actorName: w.actorName,
      powerId: w.powerId || null,
      powerName: w.powerName || null,
      prompt: w.prompt || null,
      endsAt: w.endsAt || null,
      endsAfterMs: w.endsAfterMs || null,
      defaultOnTimeout: w.defaultOnTimeout || null,
      youAreActor: Boolean(isActor),
      youMustChoose: Boolean(isChooser && !youChoice && this.findByKey(forKey) && !isOut(this.findByKey(forKey))),
      youChoice: youChoice || null,
    };
    if (isActor && w.options) packed.options = w.options;
    if (isActor && w.own) packed.own = w.own;
    if (w.kind === "chai") {
      packed.prompt = packed.prompt || "Only Dolly can end this break.";
      if (isActor) packed.table = this.packChaiTable();
    }
    return packed;
  }

  packChaiTable() {
    return this.franchises.map((f) => {
      const pending = pendingSlots(f.squad, this.mode);
      return {
        name: f.name,
        character: displayName(f),
        color: f.franchise && f.franchise.color,
        purseLakhs: f.purseLakhs,
        banned: Boolean(f.banned),
        complete: isSquadComplete(f.squad, this.mode),
        squad: (f.squad || []).map((s) => ({
          name: s.player.name,
          role: s.player.role,
          priceLakhs: s.priceLakhs,
        })),
        filledRoles: (f.squad || []).map((s) => s.player.role),
        missingRoles: remainingQuota(f.squad, this.mode),
        pendingSlots: pending,
      };
    });
  }

  canTeamUsePower(team) {
    if (this.ended) return { ok: false, error: "This game has ended." };
    if (!team) return { ok: false, error: "You are not in this room." };
    if (this.phase !== "auction") return { ok: false, error: "Powers can only be used during the auction." };
    if (this.powerReveal) return { ok: false, error: "A power is already being revealed." };
    if (this.powerWait) return { ok: false, error: "A power is waiting for a choice." };
    if (this.paused) return { ok: false, error: `Game is paused by ${this.pausedBy}.` };
    if (this.lastTeamFill) return { ok: false, error: "The last team's remaining players are being revealed." };
    if (this.playerIntro) return { ok: false, error: "Wait for the player to be introduced." };
    if (this.revealUntil && !this.auction) return { ok: false, error: "Wait until the next player is on the block." };
    if (team.eliminated || team.banned) {
      return { ok: false, error: team.banned ? "Banned teams cannot use a power." : "Eliminated teams cannot use a power." };
    }
    const def = publicPower(team.franchise && team.franchise.power);
    if (!def) return { ok: false, error: "This character has no power." };
    const left = team.powerUsesLeft != null ? team.powerUsesLeft : def.uses;
    if (left <= 0) return { ok: false, error: "You have already used your power." };
    if (def.id === "what_do_you_even_do") {
      const options = listValidCopyPowers(this, team);
      if (!options.length) return { ok: false, error: "No other power is valid right now." };
      return { ok: true, def };
    }
    const gate = canUsePower(this, team, def);
    if (!gate.ok) return gate;
    const usesNext = usesNextLotSlot(def.id);
    if (usesNext) {
      if (this.pendingLotEffects && this.pendingLotEffects.powerLocked) {
        return { ok: false, error: "The next lot's power slot is already taken." };
      }
    } else if (this.lotPowerUsed) {
      return { ok: false, error: "A power has already been used on this lot." };
    }
    return { ok: true, def };
  }

  maskNomineeFor(viewer) {
    if (!this.auction || !this.auction.vfxHidden) return this.auction ? this.auction.nominee : null;
    if (viewer && viewer.key === this.auction.vfxSeerKey) return this.auction.nominee;
    return hiddenNomineePlaceholder();
  }

  personalizeDelta(evt, forName) {
    if (!evt || typeof evt !== "object") return evt;
    const copy = JSON.parse(JSON.stringify(evt));
    const you = forName ? this.findByName(forName) : null;
    if ((copy.type === "lotStart" || copy.nominee) && this.auction && this.auction.vfxHidden && copy.nominee) {
      if (!you || you.key !== this.auction.vfxSeerKey) {
        copy.nominee = hiddenNomineePlaceholder();
      }
    }
    if (copy.auction && this.auction && this.auction.vfxHidden) {
      if (!you || you.key !== this.auction.vfxSeerKey) {
        copy.auction.nominee = hiddenNomineePlaceholder();
      }
    }
    if (copy.type === "powerApplied" && you && you.samayPreview) {
      copy.preview = you.samayPreview;
    }
    if (this.powerWait && (copy.type === "powerWait" || copy.type === "powerApplied" || copy.type === "powerChoice")) {
      const packed = this.packPowerWait(you && you.key);
      if (copy.type === "powerWait") Object.assign(copy, packed);
      copy.powerWait = packed;
    }
    if (you) {
      const packed = this.decorateYou(this.publicFranchise(you, you.key), you);
      copy.youPower = {
        canUsePower: Boolean(packed.canUsePower),
        canUsePowerReason: packed.canUsePowerReason || null,
        canUsePowerHint: packed.canUsePowerHint || (packed.canUsePower ? null : shortenPowerReason(packed.canUsePowerReason)),
        powerUsed: Boolean(packed.powerUsed),
        powerUsesLeft: packed.powerUsesLeft,
      };
    }
    copy.lotPowerUsed = Boolean(this.lotPowerUsed);
    return copy;
  }

  startPowerWait(wait, team) {
    const ms = Math.max(0, Number(wait.endsAfterMs) || POWER_PICK_MS);
    this.powerWait = {
      ...wait,
      choices: {},
      startedAt: Date.now(),
      endsAt: wait.kind === "chai" ? null : Date.now() + ms,
      endsAfterMs: wait.kind === "chai" ? null : ms,
    };
    if (wait.kind === "chai") {
      this.chaiBreak = { actorKey: team.key, actorName: team.name, startedAt: Date.now() };
      this.paused = true;
      this.pausedBy = team.name;
      this.pauseTimerKind = "chai";
      this.pauseRemainingMs = this.powerFreeze ? this.powerFreeze.remainingMs : null;
    } else {
      this.armTimer(() => this.timeoutPowerWait(), ms);
    }
    this.emitDelta({
      type: "powerWait",
      ...this.packPowerWait(null),
      message: wait.kind === "chai" ? `${team.name} called a chai break` : `${team.name} is choosing a target`,
    });
  }

  timeoutPowerWait() {
    if (this.ended || !this.powerWait) return;
    const wait = this.powerWait;
    const team = this.findByKey(wait.actorKey);
    if (wait.kind === "rakhi_choices") {
      const choices = { ...(wait.choices || {}) };
      this.finishPowerWait(team, wait, { choices, timedOut: true });
      return;
    }
    // Pickers: power already consumed; timeout = no effect.
    this.clearPowerWait({ timedOut: true });
    const endsAt = this.thawPowerFreeze();
    const message = `${wait.actorName || "A team"} ran out of time, so ${wait.powerName || "the power"} had no effect`;
    this.appendPowerLog(message, { powerId: wait.powerId, timedOut: true });
    this.emitDelta({
      type: "powerWaitEnded",
      timedOut: true,
      message,
      endsAt,
      auctionEndsAt: this.auction ? this.auction.endsAt : null,
      soldRevealUntil: this.phase === "auction" && this.revealUntil ? this.revealUntil : null,
      captainEndsAt: this.captainEndsAt,
      toast: this.powerToast,
    });
    this.maybeResolveAfterPower();
  }

  finishPowerWait(team, wait, payload = {}) {
    if (!wait) return { ok: false, error: "Nothing to resolve." };
    const implId = wait.powerId;
    const applied = resolvePower(this, team, implId, payload);
    if (!applied.ok) return applied;
    this.clearPowerWait({ timedOut: Boolean(payload.timedOut) });
    const endsAt = this.thawPowerFreeze();
    const message = applied.message || `${displayName(team)} resolved ${wait.powerName}`;
    this.appendPowerLog(message, { powerId: implId, name: team && team.name });
    this.refreshLotSnapshot();
    this.emitDelta({
      type: "powerWaitEnded",
      timedOut: Boolean(payload.timedOut),
      message,
      effect: applied.effect,
      endsAt,
      auctionEndsAt: this.auction ? this.auction.endsAt : null,
      soldRevealUntil: this.phase === "auction" && this.revealUntil ? this.revealUntil : null,
      captainEndsAt: this.captainEndsAt,
      toast: this.powerToast,
      ...this.packPowerAftermath(),
    });
    this.maybeResolveAfterPower();
    return { ok: true };
  }

  clearPowerWait() {
    this.clearTimer();
    this.powerWait = null;
  }

  refreshLotSnapshot() {
    if (this.auction) this.auction.lotSnapshot = this.packLotSnapshot();
  }

  pickPowerTarget(byName, payload = {}) {
    if (this.ended) return { ok: false, error: "This game has ended." };
    if (!this.powerWait) return { ok: false, error: "No power is waiting for a pick." };
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    if (team.key !== this.powerWait.actorKey) {
      return { ok: false, error: "Only the power user can pick a target." };
    }
    if (this.powerWait.kind === "chai" || this.powerWait.kind === "rakhi_choices") {
      return { ok: false, error: "This power does not use a target pick." };
    }
    return this.finishPowerWait(team, this.powerWait, payload);
  }

  resolvePowerChoice(byName, payload = {}) {
    if (this.ended) return { ok: false, error: "This game has ended." };
    if (!this.powerWait || this.powerWait.kind !== "rakhi_choices") {
      return { ok: false, error: "No swayamvar choice is pending." };
    }
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    if (team.key === this.powerWait.actorKey) {
      return { ok: false, error: "You already threw the invitation." };
    }
    if (isOut(team)) return { ok: false, error: "You cannot answer." };
    const choice = payload.choice === "pay" ? "pay" : "refuse";
    this.powerWait.choices = this.powerWait.choices || {};
    if (this.powerWait.choices[team.key]) {
      return { ok: false, error: "You already chose." };
    }
    this.powerWait.choices[team.key] = choice;
    const expected = (this.franchises || []).filter((f) => f.key !== this.powerWait.actorKey && !isOut(f));
    const allIn = expected.every((f) => this.powerWait.choices[f.key]);
    this.emitDelta({
      type: "powerChoice",
      name: team.name,
      choice,
      remaining: expected.filter((f) => !this.powerWait.choices[f.key]).map((f) => f.name),
    });
    if (allIn) {
      const actor = this.findByKey(this.powerWait.actorKey);
      return this.finishPowerWait(actor, this.powerWait, { choices: this.powerWait.choices });
    }
    return { ok: true };
  }

  endChaiBreak(byName, opts = {}) {
    if (!this.chaiBreak && !(this.powerWait && this.powerWait.kind === "chai")) {
      return { ok: false, error: "There is no chai break." };
    }
    const actorKey = (this.chaiBreak && this.chaiBreak.actorKey) || (this.powerWait && this.powerWait.actorKey);
    if (!opts.auto) {
      const team = this.findByName(byName);
      if (!team || team.key !== actorKey) {
        return { ok: false, error: "Only Dolly can end the chai break." };
      }
    }
    this.clearChaiDisconnectTimer();
    this.chaiBreak = null;
    this.paused = false;
    this.pausedBy = null;
    this.pauseRemainingMs = null;
    this.pauseTimerKind = null;
    this.powerWait = null;
    const endsAt = this.thawPowerFreeze();
    const message = opts.auto
      ? "Chai break ended after Dolly disconnected"
      : "Chai khatam — the auction is back on";
    this.appendPowerLog(message, { powerId: "chai_break", auto: Boolean(opts.auto) });
    this.emitDelta({
      type: "chaiEnded",
      auto: Boolean(opts.auto),
      message,
      endsAt,
      auctionEndsAt: this.auction ? this.auction.endsAt : null,
      soldRevealUntil: this.phase === "auction" && this.revealUntil ? this.revealUntil : null,
      captainEndsAt: this.captainEndsAt,
      toast: this.powerToast,
    });
    return { ok: true };
  }

  quickChat(byName, lineId) {
    if (this.ended) return { ok: false, error: "This game has ended." };
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    if (this.phase !== "auction") return { ok: false, error: "Quick chat is available during the auction." };
    if (!this.powerWait && !this.chaiBreak && !this.paused && !this.powerReveal) {
      return { ok: false, error: "Quick chat is only open during a power wait." };
    }
    const charId = characterIdOf(team.franchise);
    const line = getCharacterLine(charId, lineId);
    if (!line) {
      const other = findLine(lineId);
      return { ok: false, error: other ? "That line is not yours." : "Unknown line." };
    }
    const now = Date.now();
    if (team.lastQuickChatAt && now - team.lastQuickChatAt < QUICK_CHAT_COOLDOWN_MS) {
      return { ok: false, error: "Wait a moment before sending another line." };
    }
    team.lastQuickChatAt = now;
    const payload = { teamId: team.key, name: team.name, lineId, text: line.text };
    this.emit("quickChat", payload);
    return { ok: true, ...payload };
  }

  /**
   * Use the team's character power once. Auction phase only. One power per
   * lot, except Prabhas's Adipurush VFX (and Orry copying it) which consume
   * the next lot's slot and may be used even if this lot's slot is taken.
   */
  usePower(byName, payload = {}) {
    if (this.ended) return { ok: false, error: "This game has ended." };
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    const gate = this.canTeamUsePower(team);
    if (!gate.ok) return gate;
    const def = gate.def;
    let plannedId = def.id;
    let copied = null;
    let applyParams = { ...(def.params || {}) };
    if (def.id === "what_do_you_even_do") {
      const options = listValidCopyPowers(this, team);
      if (!options.length) return { ok: false, error: "No other power is valid right now." };
      copied = options[this.rng.int(options.length)];
      plannedId = copied.powerId;
      applyParams.forcedPowerId = copied.powerId;
    }
    const usesNext = usesNextLotSlot(plannedId);
    if (usesNext) {
      if (this.pendingLotEffects && this.pendingLotEffects.powerLocked) {
        return { ok: false, error: "The next lot's power slot is already taken." };
      }
    } else if (this.lotPowerUsed) {
      return { ok: false, error: "A power has already been used on this lot." };
    }

    const left = team.powerUsesLeft != null ? team.powerUsesLeft : def.uses;
    team.powerUsesLeft = left - 1;
    team.powerUsedCount = (team.powerUsedCount || 0) + 1;
    if (usesNext) {
      this.pendingLotEffects = this.pendingLotEffects || {};
      this.pendingLotEffects.powerLocked = true;
    } else {
      this.lotPowerUsed = true;
    }

    const revealMs = Math.max(0, Number(this.timers.powerRevealMs) || 0);
    const copiedName = copied ? (copied.powerName || plannedId) : null;
    const description = copied
      ? `${def.description} Copied ${copiedName}.`
      : def.description;
    const payloadReveal = {
      teamKey: team.key,
      teamId: team.key,
      name: team.name,
      characterId: characterIdOf(team.franchise),
      powerId: def.id,
      powerName: copiedName ? `${def.name} → ${copiedName}` : def.name,
      description,
      params: applyParams,
      color: team.franchise && (team.franchise.color || null),
      image: team.franchise && (team.franchise.image || team.franchise.logo || null),
      revealMs,
      endsAt: Date.now() + revealMs,
      applied: false,
      copiedPowerId: copied ? copied.powerId : null,
      copiedPowerName: copiedName,
      copiedFrom: copied ? copied.characterName : null,
      message: copied
        ? `${displayName(team)} used What Do You Even Do? and got ${copiedName}`
        : `${displayName(team)} used ${def.name}`,
    };
    this.freezeForPower();
    this.powerReveal = payloadReveal;
    this.lastEvent = { type: "powerReveal", ...this.packPowerReveal() };
    this.emitDelta({
      type: "powerReveal",
      ...this.packPowerReveal(),
      powerUsesLeft: team.powerUsesLeft,
      powerUsed: true,
    });
    if (revealMs <= 0) {
      this.finishPowerReveal();
    } else {
      this.armTimer(() => this.finishPowerReveal(), revealMs);
    }
    return { ok: true, copiedPowerId: payloadReveal.copiedPowerId };
  }

  finishPowerReveal() {
    if (this.ended) return;
    const reveal = this.powerReveal;
    if (!reveal || reveal.applied) return;
    reveal.applied = true;
    const team = this.findByKey(reveal.teamKey);
    let applied = { ok: false };
    if (team) {
      applied = applyPower(this, team, {
        id: reveal.powerId,
        name: reveal.powerName,
        description: reveal.description,
        params: reveal.params,
        uses: 1,
      });
      this.revealForms();
      this.refreshLotSnapshot();
    }
    this.powerReveal = null;
    const message = (applied && applied.message) || reveal.message || `${reveal.name} used ${reveal.powerName}`;
    this.appendPowerLog(message, {
      name: reveal.name,
      powerId: reveal.powerId,
      copiedPowerId: reveal.copiedPowerId,
      effect: applied && applied.effect,
    });
    const wait = applied && applied.ok && applied.wait;
    const sellNow = applied && applied.ok && applied.sellNow;
    let endsAt = null;
    if (wait) {
      this.startPowerWait(wait, team);
    } else {
      endsAt = this.thawPowerFreeze();
    }
    const packed = {
      type: "powerApplied",
      teamId: reveal.teamId,
      name: reveal.name,
      characterId: reveal.characterId,
      powerId: reveal.powerId,
      powerName: reveal.powerName,
      description: reveal.description,
      copiedPowerId: reveal.copiedPowerId,
      copiedPowerName: reveal.copiedPowerName,
      message,
      toast: this.powerToast,
      preview: undefined,
      effect: applied && applied.effect,
      purseLakhs: team ? team.purseLakhs : null,
      powerUsesLeft: team ? team.powerUsesLeft : 0,
      powerUsed: true,
      waiting: Boolean(wait),
      endsAt,
      auctionEndsAt: this.auction ? this.auction.endsAt : null,
      soldRevealUntil: this.phase === "auction" && this.revealUntil ? this.revealUntil : null,
      captainEndsAt: this.captainEndsAt,
      ...this.packPowerAftermath(),
    };
    this.lastEvent = packed;
    this.emitDelta(packed);
    if (sellNow && this.auction) {
      this.sellCurrent();
    } else {
      this.maybeResolveAfterPower();
    }
  }

  emote(byName, emoteId) {
    if (this.ended) return { ok: false, error: "This game has ended." };
    const team = this.findByName(byName);
    if (!team) return { ok: false, error: "You are not in this room." };
    if (this.phase !== "auction") return { ok: false, error: "Emotes are available during the auction." };
    const id = typeof emoteId === "string" ? emoteId : "";
    let lineText = null;
    if (isValidEmoteId(id)) {
      // Shared emoji — anyone can send it.
    } else {
      const charId = characterIdOf(team.franchise);
      const line = getCharacterLine(charId, id);
      if (!line) {
        const other = findLine(id);
        return { ok: false, error: other ? "That line is not yours." : "Unknown emote." };
      }
      lineText = line.text;
    }
    const now = Date.now();
    const windowMs = Number(EMOTE_RATE_WINDOW_MS) || 1000;
    const max = Number(EMOTE_RATE_MAX) || 10;
    const recent = (team.emoteTimes || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      team.emoteTimes = recent;
      // Silent drop — spam is allowed up to the cap; excess is not broadcast.
      return { ok: false, dropped: true };
    }
    recent.push(now);
    team.emoteTimes = recent;
    team.lastEmoteAt = now;
    const payload = { teamId: team.key, emoteId: id };
    if (lineText) payload.text = lineText;
    this.emit("emote", payload);
    return { ok: true, ...payload };
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


  decorateYou(pack, you) {
    if (!pack || !you) return pack;
    const gate = this.canTeamUsePower(you);
    pack.canUsePower = Boolean(gate.ok);
    pack.canUsePowerReason = gate.ok ? null : gate.error;
    pack.canUsePowerHint = gate.ok ? null : shortenPowerReason(gate.error);
    if (you.samayPreview) pack.samayPreview = you.samayPreview;
    if (this.powerWait && this.powerWait.kind === "chai" && this.powerWait.actorKey === you.key) {
      pack.chaiTable = this.packChaiTable();
    }
    return pack;
  }

  getState(forName, opts = {}) {
    const includeMatches = Boolean(opts.includeMatches);
    const you = forName ? this.findByName(forName) : null;
    const forKey = you ? you.key : null;
    const franchises = this.franchises.map((f) => this.publicFranchise(f, forKey));

    let auction = null;
    if (this.phase === "auction" && this.auction) {
      auction = this.packAuctionPublic();
      auction.nominee = this.maskNomineeFor(you);
      auction.stillIn = auction.stillIn.map((row) => ({ ...row, isYou: you && row.name === you.name }));
      let youCanBid = false;
      let youCanOptOut = false;
      let youReason = null;
      if (you && this.powerReveal) {
        youReason = "A power is being revealed.";
      } else if (you && this.powerWait) {
        youReason = "A power is waiting for a choice.";
      } else if (you && this.playerIntro) {
        youReason = "Wait for the player to be introduced.";
      } else if (you && you.banned) {
        youReason = "You are banned for match fixing.";
      } else if (you && isBidBlocked(this, you)) {
        youReason = "You are blocked from bidding on this lot.";
      } else if (you) {
        if (this.auction.optedOut.has(you.key)) {
          youReason = "You opted out of this player.";
        } else if (you.key === this.auction.currentBidderKey) {
          youReason = "You have the leading bid.";
        } else {
          const check = canBidFor(
            you,
            this.auction.nominee,
            auction.minBidLakhs,
            this.remainingPool(this.auction.nominee.id),
            { mode: this.mode }
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
      powerReveal: this.packPowerReveal(),
      powerWait: this.packPowerWait(forKey),
      powerLog: this.powerLog || [],
      powerToast: this.powerToast,
      lotPowerUsed: Boolean(this.lotPowerUsed),
      chaiBreak: Boolean(this.chaiBreak),
      soldRevealUntil: this.phase === "auction" && this.revealUntil ? this.revealUntil : null,
      lastTeamFill: this.phase === "auction" ? this.packLastTeamFill() : null,
      lastTeamFillUntil: this.phase === "auction" && this.lastTeamFill && this.lastTeamFill.endsAt ? this.lastTeamFill.endsAt : null,
      playerIntro: this.phase === "auction" ? this.packPlayerIntro() : null,
      playerIntroUntil: this.phase === "auction" && this.playerIntro && this.playerIntro.endsAt ? this.playerIntro.endsAt : null,
      resultsReveal: this.phase === "results" ? this.packResultsReveal() : null,
      characters: CHARACTERS.map((t) => publicCharacter(t.id)),
      identities: CHARACTERS.map((t) => publicCharacter(t.id)),
      ratingsNote: this.meta.ratingsNote || null,
      hostName: this.host ? this.host.name : null,
      you: you ? this.decorateYou(this.publicFranchise(you, forKey), you) : null,
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
      mode: publicMode(this.mode),
      quotas: this.mode.quota,
      squadSize: this.mode.squadSize,
      maxOverseas: null,
      maxPlayers: MAX_PLAYERS,
      minPlayers: MIN_PLAYERS,
    };
  }
}


const { makeRoomCode, ROOM_CODE_LENGTH } = require("./manager");

module.exports = { GameRoom, makeRoomCode, normalizeName, nameKey, ROOM_CODE_LENGTH, shuffle };
