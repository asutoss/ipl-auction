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
    team.complete = (team.squad || []).length >= (squadSize || 11);
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
        state.soldLog = state.soldLog || [];
        state.soldLog.push(evt);
        break;
      }
      case "unsold":
      case "skipped":
        state.lastEvent = evt;
        state.auction = null;
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
      default:
        break;
    }
    return state;
  }

  return { applyDelta, decorateAuctionYou, recomputeTeam };
});
