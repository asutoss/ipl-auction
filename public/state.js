(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IplState = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const DEFAULT_QUOTA = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };

  function decorateAuctionYou(state) {
    const a = state.auction;
    const you = state.you;
    if (!a) return;
    a.stillIn = (a.stillIn || []).map((t) => ({ ...t, isYou: Boolean(you && t.name === you.name) }));
    if (!you) return;
    const mine = a.stillIn.find((t) => t.isYou);
    if (a.currentBidderName === you.name) {
      a.youCanBid = false;
      a.youCanOptOut = false;
      a.youReason = "You have the leading bid.";
    } else if (!mine) {
      a.youCanBid = false;
      a.youCanOptOut = false;
      if (!a.youReason || a.youReason === "You have the leading bid.") {
        a.youReason = "You are not in the running for this player.";
      }
    } else {
      a.youCanBid = true;
      a.youCanOptOut = true;
      a.youReason = null;
    }
  }

  function recomputeTeam(team, quotas, squadSize) {
    if (!team) return team;
    const q = quotas || DEFAULT_QUOTA;
    const have = { BAT: 0, WK: 0, AR: 0, BOWL: 0 };
    let overseas = 0;
    for (const s of team.squad || []) {
      if (have[s.player.role] != null) have[s.player.role] += 1;
      if (s.player.overseas) overseas += 1;
      s.isCaptain = team.captainId && s.player.id === team.captainId;
    }
    team.roleCounts = have;
    team.overseasCount = overseas;
    team.remainingQuota = {};
    for (const k of Object.keys(q)) team.remainingQuota[k] = Math.max(0, q[k] - (have[k] || 0));
    const need = Object.keys(q).reduce((s, k) => s + Math.max(0, q[k] - (have[k] || 0)), 0);
    team.complete = need === 0;
    return team;
  }

  function findTeam(state, name) {
    return (state.franchises || []).find((f) => f.name === name) || null;
  }

  function syncYou(state) {
    if (!state.you) return;
    const live = findTeam(state, state.you.name);
    if (live) state.you = { ...live, isYou: true };
  }

  const BID_STEPS = [1, 2, 5];
  const ROLE_ORDER = ["BAT", "WK", "AR", "BOWL"];

  function canVoluntaryBid(you, auction) {
    if (!you || !auction) return false;
    if (you.eliminated || you.complete) return false;
    const role = auction.nominee && auction.nominee.role;
    if (role && you.remainingQuota && (you.remainingQuota[role] || 0) <= 0) return false;
    return true;
  }

  function canAffordAmount(you, auction, amount) {
    if (!canVoluntaryBid(you, auction)) return false;
    const bid = Number(amount);
    if (!Number.isFinite(bid) || bid > you.purseLakhs) return false;
    const needed = { BAT: 0, WK: 0, AR: 0, BOWL: 0, ...(you.remainingQuota || {}) };
    const role = auction.nominee && auction.nominee.role;
    if (role && Object.prototype.hasOwnProperty.call(needed, role)) {
      needed[role] = Math.max(0, (needed[role] || 0) - 1);
    }
    const reserve = ROLE_ORDER.reduce((sum, r) => sum + Math.max(0, needed[r] || 0), 0);
    return you.purseLakhs - bid >= reserve;
  }

  function bidChoices(state) {
    const a = state && state.auction;
    const you = state && state.you;
    const paused = Boolean(state && (state.paused || state.powerReveal));
    const steps = (a && a.bidSteps && a.bidSteps.length) ? a.bidSteps : BID_STEPS;
    const current = a ? Number(a.currentBidLakhs) || 0 : 0;
    const canBid = Boolean(a && you && a.youCanBid && canVoluntaryBid(you, a));
    const options = steps.map((step) => {
      const amount = current + step;
      const affordable = canBid && canAffordAmount(you, a, amount);
      return {
        step,
        amount,
        label: `${amount} pt${amount === 1 ? "" : "s"}`,
        affordable,
        show: affordable,
        enabled: affordable && !paused,
      };
    });
    return {
      current,
      options,
      canBid,
      canOptOut: Boolean(a && a.youCanOptOut && !paused),
      youReason: (a && a.youReason) || null,
      paused,
    };
  }

  function applyDelta(state, evt) {
    if (!state || !evt) return state;
    const quotas = state.quotas || DEFAULT_QUOTA;
    const squadSize = state.squadSize || 11;
    switch (evt.type) {
      case "bid": {
        if (!state.auction) state.auction = {};
        state.auction.currentBidLakhs = evt.currentBidLakhs != null ? evt.currentBidLakhs : evt.amountLakhs;
        state.auction.currentBidderName = evt.currentBidderName || evt.bidderName;
        state.auction.currentBidderShort = evt.currentBidderShort || evt.bidderShort;
        state.auction.currentBidderColor = evt.currentBidderColor || evt.bidderColor;
        state.auction.hasBidder = true;
        state.auction.endsAt = evt.endsAt;
        state.auction.stillIn = evt.stillIn || state.auction.stillIn;
        if (evt.minBidLakhs != null) state.auction.minBidLakhs = evt.minBidLakhs;
        if (evt.incrementLakhs != null) state.auction.incrementLakhs = evt.incrementLakhs;
        state.auction.isDefaultBidLeading = Boolean(evt.isDefaultBidLeading);
        decorateAuctionYou(state);
        break;
      }
      case "optOut": {
        if (state.auction) {
          state.auction.stillIn = evt.stillIn || state.auction.stillIn;
          decorateAuctionYou(state);
        }
        break;
      }
      case "lotStart": {
        state.phase = "auction";
        const next = { ...evt };
        delete next.type;
        state.auction = next;
        state.soldRevealUntil = null;
        decorateAuctionYou(state);
        break;
      }
      case "sold": {
        const team = findTeam(state, evt.buyerName);
        if (team) {
          team.purseLakhs = evt.purseLakhs;
          team.squad = team.squad || [];
          team.squad.push({ player: evt.player, priceLakhs: evt.priceLakhs, isCaptain: false });
          recomputeTeam(team, quotas, squadSize);
        }
        syncYou(state);
        state.lastEvent = evt;
        state.auction = null;
        state.soldRevealUntil = evt.revealUntil || null;
        state.soldLog = state.soldLog || [];
        state.soldLog.push(evt);
        break;
      }
      case "unsold":
      case "skipped":
        state.lastEvent = evt;
        state.auction = null;
        if (evt.revealUntil) state.soldRevealUntil = evt.revealUntil;
        break;
      case "eliminated": {
        const team = findTeam(state, evt.name);
        if (team) {
          team.eliminated = true;
          team.eliminatedReason = evt.reason;
        }
        if (state.you && state.you.name === evt.name) {
          state.you.eliminated = true;
          state.you.eliminatedReason = evt.reason;
        }
        state.eliminationLog = state.eliminationLog || [];
        state.eliminationLog.push(evt);
        state.lastEvent = evt;
        break;
      }
      case "captain": {
        const team = findTeam(state, evt.name);
        if (team) {
          team.captainId = evt.captainId;
          recomputeTeam(team, quotas, squadSize);
        }
        syncYou(state);
        state.captainsPending = (state.captainsPending || []).filter((p) => p.name !== evt.name);
        break;
      }
      case "presence": {
        const team = findTeam(state, evt.name);
        if (team) team.connected = evt.connected;
        if (evt.hostName) state.hostName = evt.hostName;
        syncYou(state);
        break;
      }
      case "booster": {
        const team = findTeam(state, evt.name);
        if (team) {
          if (evt.purseLakhs != null) team.purseLakhs = evt.purseLakhs;
          team.boosters = team.boosters || [];
          if (evt.booster && !team.boosters.some((b) => b.id === evt.booster.id)) {
            team.boosters.push(evt.booster);
          }
        }
        syncYou(state);
        break;
      }
      case "paused": {
        state.paused = true;
        state.pausedBy = evt.byName;
        state.pauseRemainingMs = evt.remainingMs;
        break;
      }
      case "revealContinued": {
        state.soldRevealUntil = null;
        break;
      }
      case "resumed": {
        state.paused = false;
        state.pausedBy = null;
        state.pauseRemainingMs = null;
        if (state.auction && (evt.auctionEndsAt || evt.endsAt)) {
          state.auction.endsAt = evt.auctionEndsAt || evt.endsAt;
        }
        if (evt.captainEndsAt) state.captainEndsAt = evt.captainEndsAt;
        if (Object.prototype.hasOwnProperty.call(evt, "soldRevealUntil")) {
          state.soldRevealUntil = evt.soldRevealUntil || null;
        } else if (!state.auction && evt.endsAt) {
          state.soldRevealUntil = evt.endsAt;
        }
        break;
      }
      case "powerReveal": {
        state.powerReveal = {
          teamId: evt.teamId,
          name: evt.name,
          characterId: evt.characterId,
          powerId: evt.powerId,
          powerName: evt.powerName,
          description: evt.description,
          color: evt.color,
          image: evt.image,
          endsAt: evt.endsAt,
          revealMs: evt.revealMs,
          message: evt.message || null,
          copiedPowerName: evt.copiedPowerName || null,
        };
        const revealTeam = findTeam(state, evt.name) || findTeam(state, evt.teamId);
        if (revealTeam) {
          if (evt.powerUsesLeft != null) revealTeam.powerUsesLeft = evt.powerUsesLeft;
          revealTeam.powerUsed = true;
          if (revealTeam.power) {
            revealTeam.power.usesLeft = revealTeam.powerUsesLeft;
            revealTeam.power.used = true;
          }
        }
        syncYou(state);
        break;
      }
      case "powerApplied": {
        state.powerReveal = null;
        const appliedTeam = findTeam(state, evt.name) || findTeam(state, evt.teamId);
        if (appliedTeam) {
          if (evt.purseLakhs != null) appliedTeam.purseLakhs = evt.purseLakhs;
          if (evt.powerUsesLeft != null) appliedTeam.powerUsesLeft = evt.powerUsesLeft;
          appliedTeam.powerUsed = Boolean(evt.powerUsed) || appliedTeam.powerUsesLeft === 0;
          if (appliedTeam.power) {
            appliedTeam.power.usesLeft = appliedTeam.powerUsesLeft;
            appliedTeam.power.used = appliedTeam.powerUsed;
          }
        }
        if (state.auction && state.auction.lotSnapshot && appliedTeam) {
          const row = state.auction.lotSnapshot.find((r) => r.name === appliedTeam.name);
          if (row) {
            if (evt.purseLakhs != null) row.purseLakhs = evt.purseLakhs;
            row.powerUsed = true;
          }
        }
        if (state.auction && (evt.auctionEndsAt || evt.endsAt)) {
          state.auction.endsAt = evt.auctionEndsAt || evt.endsAt;
        }
        if (evt.captainEndsAt) state.captainEndsAt = evt.captainEndsAt;
        if (Object.prototype.hasOwnProperty.call(evt, "soldRevealUntil")) {
          state.soldRevealUntil = evt.soldRevealUntil || null;
        }
        if (evt.preview && state.you) state.you.samayPreview = evt.preview;
        if (evt.toast) state.powerToast = evt.toast;
        if (evt.message) {
          state.powerLog = state.powerLog || [];
          state.powerLog.push({ message: evt.message, at: Date.now() });
        }
        if (evt.waiting) {
          /* full powerWait arrives on the following powerWait / state snapshot */
        }
        syncYou(state);
        break;
      }
      case "powerWait": {
        state.powerReveal = null;
        state.powerWait = evt;
        if (evt.kind === "chai") {
          state.paused = true;
          state.pausedBy = evt.actorName;
          state.chaiBreak = true;
        }
        break;
      }
      case "powerChoice": {
        if (state.powerWait) {
          state.powerWait.youChoice = state.you && evt.name === state.you.name ? evt.choice : state.powerWait.youChoice;
        }
        break;
      }
      case "powerWaitEnded":
      case "chaiEnded": {
        state.powerWait = null;
        state.chaiBreak = false;
        if (evt.type === "chaiEnded") {
          state.paused = false;
          state.pausedBy = null;
          state.pauseRemainingMs = null;
        }
        if (evt.toast) state.powerToast = evt.toast;
        if (state.auction && (evt.auctionEndsAt || evt.endsAt)) {
          state.auction.endsAt = evt.auctionEndsAt || evt.endsAt;
        }
        if (evt.captainEndsAt) state.captainEndsAt = evt.captainEndsAt;
        if (Object.prototype.hasOwnProperty.call(evt, "soldRevealUntil")) {
          state.soldRevealUntil = evt.soldRevealUntil || null;
        }
        break;
      }
      case "banned": {
        const bannedTeam = findTeam(state, evt.name);
        if (bannedTeam) {
          bannedTeam.banned = true;
          bannedTeam.eliminated = true;
          bannedTeam.eliminatedReason = "Banned for match fixing";
          bannedTeam.purseLakhs = 0;
        }
        if (state.auction && state.auction.lotSnapshot) {
          const row = state.auction.lotSnapshot.find((r) => r.name === evt.name);
          if (row) {
            row.banned = true;
            row.eliminated = true;
            row.purseLakhs = 0;
          }
        }
        break;
      }
      default:
        break;
    }
    if (Object.prototype.hasOwnProperty.call(evt, "lotPowerUsed")) {
      state.lotPowerUsed = Boolean(evt.lotPowerUsed);
    }
    if (evt.youPower && state.you) {
      state.you.canUsePower = Boolean(evt.youPower.canUsePower);
      state.you.canUsePowerReason = evt.youPower.canUsePowerReason || null;
      if (evt.youPower.powerUsesLeft != null) state.you.powerUsesLeft = evt.youPower.powerUsesLeft;
      if (evt.youPower.powerUsed != null) state.you.powerUsed = Boolean(evt.youPower.powerUsed);
    }
    return state;
  }

  return { applyDelta, decorateAuctionYou, recomputeTeam, canAffordAmount, canVoluntaryBid, bidChoices };
});
