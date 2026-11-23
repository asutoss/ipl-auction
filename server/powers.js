/**
 * Server-side character power registry.
 * Catalogue entries in data/characters.json point at a power id; this
 * module supplies canUse() / apply() so each character has a distinct effect.
 */

const { remainingQuota, isSquadComplete, nextBidAmount, canBidFor } = require("./rules");
const { CHARACTERS } = require("../public/characters");

const POWER_REVEAL_MS = 5000;
const POWER_PICK_MS = 30000;
const RAKHI_CHOICE_MS = 15000;
const DOLLY_DISCONNECT_MS = 30000;

function characterIdOf(pack) {
  if (!pack) return null;
  return pack.characterId || pack.id || null;
}

function displayName(team) {
  if (!team) return "Unknown";
  const pack = team.franchise || {};
  return pack.character || pack.name || team.name;
}

function hiddenNomineePlaceholder() {
  return {
    id: "vfx-hidden",
    name: "VFX loading…",
    role: "???",
    overseas: false,
    batting: null,
    bowling: null,
    basePriceLakhs: null,
    hidden: true,
    vfxHidden: true,
  };
}

function isBanned(team) {
  return Boolean(team && (team.banned || (team.eliminated && team.eliminatedReason === "match_fixing")));
}

function isOut(team) {
  return Boolean(!team || team.eliminated || team.banned);
}

function liveTeams(room) {
  return (room.franchises || []).filter((f) => !isOut(f));
}

function rivals(room, team) {
  return liveTeams(room).filter((f) => f.key !== team.key);
}

function isBidBlocked(room, team, lotId) {
  if (!team) return false;
  const lot = lotId != null ? lotId : room.lotId;
  if (team.bidBlockedUntilLot != null && lot < team.bidBlockedUntilLot) return true;
  if (team.rakhiBlockLot != null && lot === team.rakhiBlockLot) return true;
  if (Array.isArray(team.bidBlockedLots) && team.bidBlockedLots.includes(lot)) return true;
  return false;
}

function credit(room, team, amount) {
  const n = Math.max(0, Math.round(Number(amount) || 0));
  if (!team || n <= 0) return 0;
  team.purseLakhs = (Number(team.purseLakhs) || 0) + n;
  return n;
}

function maybeBanBrokeIncomplete(room, team) {
  if (!room || !team) return false;
  if (isOut(team)) return false;
  if ((Number(team.purseLakhs) || 0) > 0) return false;
  if (isSquadComplete(team.squad, room.mode)) return false;
  if (typeof room.banForMatchFixing === "function") room.banForMatchFixing(team);
  return true;
}

function banBrokeIncompleteTeams(room) {
  if (!room || !Array.isArray(room.franchises)) return 0;
  let n = 0;
  for (const team of room.franchises) {
    if (maybeBanBrokeIncomplete(room, team)) n += 1;
  }
  return n;
}

function debit(room, team, amount) {
  const want = Math.max(0, Math.round(Number(amount) || 0));
  if (!team || want <= 0) return 0;
  const have = Math.max(0, Number(team.purseLakhs) || 0);
  const paid = Math.min(have, want);
  team.purseLakhs = have - paid;
  maybeBanBrokeIncomplete(room, team);
  return paid;
}

function transfer(room, from, to, amount) {
  const paid = debit(room, from, amount);
  credit(room, to, paid);
  return paid;
}

function lastSoldEntries(room, n = 10) {
  const log = (room.soldLog || []).filter((e) => e && e.player && !e.wiped);
  return log.slice(-n).reverse();
}

function playerStillOnSquad(room, playerId) {
  for (const f of room.franchises || []) {
    const slot = (f.squad || []).find((s) => s.player && s.player.id === playerId);
    if (slot) return { team: f, slot };
  }
  return null;
}

function lastSoldRivalTargets(room, actor, opts = {}) {
  const needOpenSlot = Boolean(opts.requireOpenSlot);
  const out = [];
  const seen = new Set();
  for (const entry of lastSoldEntries(room, 10)) {
    const id = entry.player.id;
    if (seen.has(id)) continue;
    const found = playerStillOnSquad(room, id);
    if (!found) continue;
    if (found.team.key === actor.key) continue;
    if (isOut(found.team)) continue;
    if (needOpenSlot) {
      const left = remainingQuota(actor.squad, room.mode);
      if ((left[entry.player.role] || 0) <= 0) continue;
    }
    seen.add(id);
    out.push({
      playerId: id,
      player: entry.player,
      priceLakhs: entry.priceLakhs,
      fromName: found.team.name,
      fromKey: found.team.key,
    });
  }
  return out;
}

function peekNextPlayers(room, n = 3) {
  const seen = new Set(room.soldIds || []);
  const out = [];
  for (const p of room.queue || []) {
    if (!p || seen.has(p.id)) continue;
    if (room.unaffordableIds && room.unaffordableIds.has(p.id)) continue;
    out.push(p);
    seen.add(p.id);
    if (out.length >= n) break;
  }
  return out;
}

function catPowerDefs() {
  return CHARACTERS.map((c) => {
    const p = c.power || {};
    return {
      characterId: c.id,
      characterName: c.name || c.character,
      powerId: p.id,
      powerName: p.name,
      description: p.description,
      uses: p.uses,
      params: p.params,
    };
  }).filter((d) => d.powerId);
}

const POWERS = {};

function definePower(spec) {
  POWERS[spec.id] = spec;
  return spec;
}

definePower({
  id: "demonetisation",
  name: "Demonetisation",
  description: "Every other team loses 10 points.",
  canUse(room, team) {
    if (!rivals(room, team).length) return { ok: false, error: "There is no other team to demonetise." };
    return { ok: true };
  },
  apply(room, team) {
    const hits = [];
    for (const f of rivals(room, team)) {
      const paid = debit(room, f, 10);
      hits.push({ name: f.name, lost: paid, purseLakhs: f.purseLakhs, banned: isBanned(f) });
    }
    return {
      ok: true,
      effect: "demonetisation",
      message: `${displayName(team)} used Demonetisation, everyone lost 10 points`,
      hits,
    };
  },
});

definePower({
  id: "adipurush_vfx",
  name: "Adipurush VFX",
  description: "Hide the next lot from everyone but you.",
  usesNextLotSlot: true,
  canUse(room, team) {
    if (room.phase !== "auction") return { ok: false, error: "Powers can only be used during the auction." };
    if (room.pendingLotEffects && room.pendingLotEffects.powerLocked) {
      return { ok: false, error: "The next lot's power slot is already taken." };
    }
    return { ok: true };
  },
  apply(room, team) {
    room.pendingLotEffects = room.pendingLotEffects || {};
    room.pendingLotEffects.vfxSeerKey = team.key;
    room.pendingLotEffects.powerLocked = true;
    return {
      ok: true,
      effect: "adipurush_vfx",
      usesNextLotSlot: true,
      message: `${displayName(team)} used Adipurush VFX, the next player will be hidden from everyone else`,
    };
  },
});

definePower({
  id: "what_do_you_even_do",
  name: "What Do You Even Do?",
  description: "Copy a random other valid power.",
  canUse(room, team) {
    const options = listValidCopyPowers(room, team);
    if (!options.length) return { ok: false, error: "No other power is valid right now." };
    return { ok: true };
  },
  apply(room, team, params = {}) {
    const options = listValidCopyPowers(room, team);
    let pick = null;
    if (params.forcedPowerId) {
      pick = options.find((o) => o.powerId === params.forcedPowerId) || catPowerDefs().find((o) => o.powerId === params.forcedPowerId);
    }
    if (!pick) {
      if (!options.length) return { ok: false, error: "No other power is valid right now." };
      pick = options[room.rng.int(options.length)];
    }
    const impl = getPowerImpl(pick.powerId);
    const inner = impl.apply(room, team, pick.params || {});
    if (!inner.ok) return inner;
    const copiedName = pick.powerName || impl.name;
    const innerMsg = inner.message ? ` — ${inner.message}` : "";
    return {
      ...inner,
      effect: "what_do_you_even_do",
      copiedPowerId: pick.powerId,
      copiedPowerName: copiedName,
      copiedFrom: pick.characterName,
      usesNextLotSlot: Boolean(inner.usesNextLotSlot || impl.usesNextLotSlot),
      message: `${displayName(team)} used What Do You Even Do? and got ${copiedName}${innerMsg}`,
    };
  },
});

definePower({
  id: "chai_break",
  name: "Chai Break",
  description: "Unlimited pause that only Dolly can end.",
  canUse() {
    return { ok: true };
  },
  apply(room, team) {
    return {
      ok: true,
      effect: "chai_break",
      wait: { kind: "chai", actorKey: team.key, actorName: team.name },
      message: `${displayName(team)} used Chai Break, the auction is paused for chai`,
    };
  },
});

definePower({
  id: "lock_kiya_jaaye",
  name: "Lock Kiya Jaaye",
  description: "Coin flip on the current lot: half price or double.",
  canUse(room) {
    if (!room.auction || !room.auction.nominee) {
      return { ok: false, error: "No player is on the block." };
    }
    return { ok: true };
  },
  apply(room, team) {
    const win = room.rng.int(2) === 0;
    room.auction.lockFlip = { result: win ? "win" : "lose", byKey: team.key };
    const detail = win
      ? "won the flip — if they win the player they pay half"
      : "lost the flip — whoever wins the player pays double";
    return {
      ok: true,
      effect: "lock_kiya_jaaye",
      flip: room.auction.lockFlip.result,
      message: `${displayName(team)} used Lock Kiya Jaaye and ${detail}`,
    };
  },
});

definePower({
  id: "broadcast_rights",
  name: "Broadcast Rights",
  description: "Rivals pay you 1 point on each bid next lot.",
  canUse(room, team) {
    if (!rivals(room, team).length) return { ok: false, error: "There is no rival to tax." };
    return { ok: true };
  },
  apply(room, team) {
    room.pendingLotEffects = room.pendingLotEffects || {};
    room.pendingLotEffects.broadcastKey = team.key;
    return {
      ok: true,
      effect: "broadcast_rights",
      message: `${displayName(team)} used Broadcast Rights, rival bids on the next lot will cost +1 point paid to them`,
    };
  },
});

definePower({
  id: "chess_blundermaster",
  name: "Chess Blundermaster",
  description: "Privately see the next 3 players.",
  canUse(room) {
    const next = peekNextPlayers(room, 3);
    if (!next.length) return { ok: false, error: "There are no upcoming players to preview." };
    return { ok: true };
  },
  apply(room, team) {
    const raw = peekNextPlayers(room, 3);
    const vfxNext = Boolean(room.pendingLotEffects && room.pendingLotEffects.vfxSeerKey);
    const preview = raw.map((p, i) => {
      if (i === 0 && vfxNext) {
        return { hidden: true, name: "??? (VFX)", role: "???", id: "vfx-hidden" };
      }
      return {
        id: p.id,
        name: p.name,
        role: p.role,
        overseas: Boolean(p.overseas),
        batting: p.batting,
        bowling: p.bowling,
      };
    });
    team.samayPreview = preview;
    return {
      ok: true,
      effect: "chess_blundermaster",
      preview,
      privateTo: team.key,
      message: `${displayName(team)} used Chess Blundermaster and peeked at the next ${preview.length} players`,
    };
  },
});

definePower({
  id: "mute_the_room",
  name: "Elvish Bhai Ke Aage Koi Bol Sakta Hai Kya.. Elvish Bhaiiii",
  description: "Win the current lot at current bid + 1. Nobody can bid against you.",
  canUse(room, team) {
    if (!room.auction || !room.auction.nominee) {
      return { ok: false, error: "No player is on the block." };
    }
    if (isBidBlocked(room, team)) {
      return { ok: false, error: "You are blocked from bidding, so you cannot mute the room." };
    }
    if (isSquadComplete(team.squad, room.mode)) {
      return { ok: false, error: "Your squad is already complete." };
    }
    const price = (Number(room.auction.currentBidLakhs) || 0) + 1;
    if ((Number(team.purseLakhs) || 0) < price) {
      return { ok: false, error: `You cannot afford ${price} points.` };
    }
    return { ok: true };
  },
  apply(room, team) {
    const price = (Number(room.auction.currentBidLakhs) || 0) + 1;
    room.auction.currentBidLakhs = price;
    room.auction.currentBidderKey = team.key;
    room.auction.muteByKey = team.key;
    for (const f of room.franchises || []) {
      if (f.key !== team.key) room.auction.optedOut.add(f.key);
    }
    return {
      ok: true,
      effect: "mute_the_room",
      sellNow: true,
      priceLakhs: price,
      message: `${displayName(team)} used Mute the Room, nobody can bid against them and they win at ${price} points`,
    };
  },
});

definePower({
  id: "parents_wala_sawaal",
  name: "Parents Wala Sawaal",
  description: "A picked rival cannot bid for the next 2 lots (this one and the next).",
  canUse(room, team) {
    const opts = rivals(room, team);
    if (!opts.length) return { ok: false, error: "There is no rival to question." };
    return { ok: true };
  },
  apply(room, team) {
    const options = rivals(room, team).map((f) => ({
      key: f.key,
      name: f.name,
      character: displayName(f),
    }));
    return {
      ok: true,
      effect: "parents_wala_sawaal",
      wait: {
        kind: "pick_team",
        actorKey: team.key,
        actorName: team.name,
        powerId: "parents_wala_sawaal",
        powerName: "Parents Wala Sawaal",
        endsAfterMs: POWER_PICK_MS,
        options,
        prompt: "Pick a rival to block this lot and the next.",
      },
      message: `${displayName(team)} used Parents Wala Sawaal and is picking a rival`,
    };
  },
  resolve(room, team, payload = {}) {
    const target = room.findByKey(payload.targetKey || payload.targetId);
    if (!target || target.key === team.key || isOut(target)) {
      return { ok: false, error: "Pick a live rival." };
    }
    const until = (room.lotId || 0) + 2;
    target.bidBlockedUntilLot = Math.max(target.bidBlockedUntilLot || 0, until);
    if (room.auction) {
      if (target.key !== room.auction.currentBidderKey) {
        room.auction.optedOut.add(target.key);
      }
    }
    return {
      ok: true,
      effect: "parents_wala_sawaal",
      message: `${displayName(team)} used Parents Wala Sawaal on ${target.name}, they cannot bid for 2 lots`,
    };
  },
});

definePower({
  id: "kala_hiran",
  name: "Kala Hiran",
  description: "Steal a recently sold rival player at the sold price.",
  canUse(room, team) {
    const targets = lastSoldRivalTargets(room, team, { requireOpenSlot: true });
    if (!targets.length) {
      return { ok: false, error: "No recently sold rival player fits an open role slot." };
    }
    return { ok: true };
  },
  apply(room, team) {
    const options = lastSoldRivalTargets(room, team, { requireOpenSlot: true });
    return {
      ok: true,
      effect: "kala_hiran",
      wait: {
        kind: "pick_player",
        actorKey: team.key,
        actorName: team.name,
        powerId: "kala_hiran",
        powerName: "Kala Hiran",
        endsAfterMs: POWER_PICK_MS,
        options,
        prompt: "Pick a rival player to take.",
      },
      message: `${displayName(team)} used Kala Hiran and is stalking a player`,
    };
  },
  resolve(room, team, payload = {}) {
    const options = lastSoldRivalTargets(room, team, { requireOpenSlot: true });
    const choice = options.find((o) => o.playerId === payload.playerId);
    if (!choice) return { ok: false, error: "That player is not available." };
    const price = Number(choice.priceLakhs) || 0;
    if ((Number(team.purseLakhs) || 0) < price) {
      return { ok: false, error: `You cannot afford ${price} points.` };
    }
    const found = playerStillOnSquad(room, choice.playerId);
    if (!found) return { ok: false, error: "That player is no longer on a squad." };
    const rival = found.team;
    rival.squad = rival.squad.filter((s) => s.player.id !== choice.playerId);
    team.squad.push({ player: found.slot.player, priceLakhs: price });
    const paid = debit(room, team, price);
    credit(room, rival, paid);
    if (team.spentLakhs != null) team.spentLakhs += paid;
    if (rival.spentLakhs != null) rival.spentLakhs = Math.max(0, rival.spentLakhs - paid);
    const entry = (room.soldLog || []).find((e) => e.player && e.player.id === choice.playerId && e.buyerName === rival.name);
    if (entry) {
      entry.buyerName = team.name;
      entry.short = team.name;
      entry.characterId = characterIdOf(team.franchise);
    }
    return {
      ok: true,
      effect: "kala_hiran",
      message: `${displayName(team)} used Kala Hiran and took ${found.slot.player.name} from ${rival.name} for ${paid} points`,
    };
  },
});

definePower({
  id: "ghamand_tax",
  name: "Ghamand Tax",
  description: "Richer teams pay you 5 points.",
  canUse(room, team) {
    const mine = Number(team.purseLakhs) || 0;
    if (!rivals(room, team).some((f) => (Number(f.purseLakhs) || 0) > mine)) {
      return { ok: false, error: "No team has more points than you." };
    }
    return { ok: true };
  },
  apply(room, team) {
    const mine = Number(team.purseLakhs) || 0;
    const hits = [];
    let total = 0;
    for (const f of rivals(room, team)) {
      if ((Number(f.purseLakhs) || 0) > mine) {
        const paid = transfer(room, f, team, 5);
        total += paid;
        hits.push({ name: f.name, paid, banned: isBanned(f) });
      }
    }
    return {
      ok: true,
      effect: "ghamand_tax",
      total,
      hits,
      message: `${displayName(team)} used Ghamand Tax, richer teams paid them ${total} points`,
    };
  },
});

definePower({
  id: "rakhi_ka_swayamvar",
  name: "Rakhi Ka Swayamvar",
  description: "Rivals pay 3 or sit out the next lot. Timeout defaults to refuse.",
  canUse(room, team) {
    if (!rivals(room, team).length) return { ok: false, error: "There is no rival to invite." };
    return { ok: true };
  },
  apply(room, team) {
    const options = rivals(room, team).map((f) => ({
      key: f.key,
      name: f.name,
      character: displayName(f),
    }));
    return {
      ok: true,
      effect: "rakhi_ka_swayamvar",
      wait: {
        kind: "rakhi_choices",
        actorKey: team.key,
        actorName: team.name,
        powerId: "rakhi_ka_swayamvar",
        powerName: "Rakhi Ka Swayamvar",
        endsAfterMs: RAKHI_CHOICE_MS,
        options,
        defaultOnTimeout: "refuse",
        prompt: "Pay 3 points, or refuse and sit out the next lot.",
      },
      message: `${displayName(team)} used Rakhi Ka Swayamvar, rivals must pay 3 points or refuse`,
    };
  },
  resolve(room, team, payload = {}) {
    const choosers = payload.choices || {};
    const paidNames = [];
    const refusedNames = [];
    for (const f of rivals(room, team)) {
      const choice = choosers[f.key] || "refuse";
      if (choice === "pay") {
        const paid = transfer(room, f, team, 3);
        paidNames.push(f.name);
      } else {
        // Timeout and explicit refuse both default to sitting out the NEXT lot only.
        f.rakhiBlockLot = (room.lotId || 0) + 1;
        refusedNames.push(f.name);
      }
    }
    const bits = [];
    if (paidNames.length) bits.push(`${paidNames.join(", ")} paid 3 points`);
    if (refusedNames.length) bits.push(`${refusedNames.join(", ")} refused and will miss the next lot`);
    return {
      ok: true,
      effect: "rakhi_ka_swayamvar",
      message: `${displayName(team)} used Rakhi Ka Swayamvar, ${bits.join("; ") || "no one answered"}`,
    };
  },
});

definePower({
  id: "travis_kelce_trade",
  name: "Travis Kelce Trade",
  description: "Swap a recently sold rival player with one of yours in the same role.",
  canUse(room, team) {
    const targets = lastSoldRivalTargets(room, team);
    const rolesIHave = new Set((team.squad || []).map((s) => s.player.role));
    const options = targets.filter((t) => rolesIHave.has(t.player.role));
    if (!options.length) {
      return { ok: false, error: "No recently sold rival player matches a role you already have." };
    }
    return { ok: true };
  },
  apply(room, team) {
    const rolesIHave = new Set((team.squad || []).map((s) => s.player.role));
    const options = lastSoldRivalTargets(room, team).filter((t) => rolesIHave.has(t.player.role));
    const own = (team.squad || []).map((s) => ({
      playerId: s.player.id,
      player: s.player,
      priceLakhs: s.priceLakhs,
    }));
    return {
      ok: true,
      effect: "travis_kelce_trade",
      wait: {
        kind: "pick_swap",
        actorKey: team.key,
        actorName: team.name,
        powerId: "travis_kelce_trade",
        powerName: "Travis Kelce Trade",
        endsAfterMs: POWER_PICK_MS,
        options,
        own,
        prompt: "Pick a rival, then your player in the same role.",
      },
      message: `${displayName(team)} used Travis Kelce Trade and is arranging a swap`,
    };
  },
  resolve(room, team, payload = {}) {
    const rolesIHave = new Set((team.squad || []).map((s) => s.player.role));
    const options = lastSoldRivalTargets(room, team).filter((t) => rolesIHave.has(t.player.role));
    const choice = options.find((o) => o.playerId === payload.playerId);
    if (!choice) return { ok: false, error: "That rival player is not available." };
    const mine = (team.squad || []).find((s) => s.player.id === payload.swapPlayerId);
    if (!mine) return { ok: false, error: "Pick one of your own players." };
    if (mine.player.role !== choice.player.role) {
      return { ok: false, error: "The swap must be the same role." };
    }
    const found = playerStillOnSquad(room, choice.playerId);
    if (!found) return { ok: false, error: "That player is no longer on a squad." };
    const rival = found.team;
    const theirSlot = found.slot;
    const myIdx = team.squad.indexOf(mine);
    const theirIdx = rival.squad.indexOf(theirSlot);
    team.squad[myIdx] = { player: theirSlot.player, priceLakhs: theirSlot.priceLakhs };
    rival.squad[theirIdx] = { player: mine.player, priceLakhs: mine.priceLakhs };
    return {
      ok: true,
      effect: "travis_kelce_trade",
      message: `${displayName(team)} used Travis Kelce Trade and swapped ${mine.player.name} for ${theirSlot.player.name} with ${rival.name}`,
    };
  },
});

definePower({
  id: "kahan_hai_points",
  name: "Kahan Hai Points?",
  description: "The richest other team gives you 10 points.",
  canUse(room, team) {
    if (!rivals(room, team).length) return { ok: false, error: "There is no other team to ask." };
    return { ok: true };
  },
  apply(room, team) {
    const others = rivals(room, team);
    if (!others.length) return { ok: false, error: "There is no other team to ask." };
    let max = Math.max(...others.map((f) => Number(f.purseLakhs) || 0));
    const tied = others.filter((f) => (Number(f.purseLakhs) || 0) === max);
    const donor = tied[room.rng.int(tied.length)];
    const paid = transfer(room, donor, team, 10);
    return {
      ok: true,
      effect: "kahan_hai_points",
      donorName: donor.name,
      paid,
      message: `${displayName(team)} used Kahan Hai Points?, ${donor.name} gave them ${paid} points`,
    };
  },
});

definePower({
  id: "big_red_button",
  name: "Big Red Button",
  description: "Wipe floor(half) of a team's squad and refund 1/4 of their lifetime spend.",
  canUse(room, team) {
    const opts = liveTeams(room).filter((f) => (f.squad || []).length >= 2);
    if (!opts.length) return { ok: false, error: "No team has at least two players to wipe." };
    return { ok: true };
  },
  apply(room, team) {
    const options = liveTeams(room)
      .filter((f) => (f.squad || []).length >= 2)
      .map((f) => ({
        key: f.key,
        name: f.name,
        character: displayName(f),
        squadSize: (f.squad || []).length,
        wipe: Math.floor((f.squad || []).length / 2),
      }));
    return {
      ok: true,
      effect: "big_red_button",
      wait: {
        kind: "pick_team",
        actorKey: team.key,
        actorName: team.name,
        powerId: "big_red_button",
        powerName: "Big Red Button",
        endsAfterMs: POWER_PICK_MS,
        options,
        prompt: "Pick a team to wipe.",
      },
      message: `${displayName(team)} used Big Red Button and is choosing a target`,
    };
  },
  resolve(room, team, payload = {}) {
    const target = room.findByKey(payload.targetKey || payload.targetId);
    if (!target || isOut(target)) return { ok: false, error: "Pick a live team." };
    const squad = [...(target.squad || [])];
    const wipeN = Math.floor(squad.length / 2);
    if (wipeN <= 0) return { ok: false, error: "That squad is too small to wipe." };
    const shuffled = [...squad];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = room.rng.int(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const wiped = shuffled.slice(0, wipeN);
    const wipeIds = new Set(wiped.map((s) => s.player.id));
    target.squad = (target.squad || []).filter((s) => !wipeIds.has(s.player.id));
    if (target.captainId && wipeIds.has(target.captainId)) target.captainId = null;
    const names = [];
    for (const slot of wiped) {
      names.push(slot.player.name);
      if (typeof room.returnPlayerToPool === "function") {
        room.returnPlayerToPool(slot.player);
      } else {
        if (room.soldIds && room.soldIds.delete) room.soldIds.delete(slot.player.id);
        room.queue = room.queue || [];
        room.queue.unshift(slot.player);
      }
    }
    const spent = Math.max(0, Number(target.spentLakhs) || 0);
    const refund = Math.floor(spent / 4);
    credit(room, target, refund);
    return {
      ok: true,
      effect: "big_red_button",
      wiped: names,
      refund,
      message: `${displayName(team)} used Big Red Button on ${target.name}, wiped ${names.join(", ") || "nobody"} and refunded ${refund} points`,
    };
  },
});

function publicPower(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.id || raw.powerId;
  if (!id) return null;
  const impl = POWERS[id];
  if (!impl) return null;
  const usesRaw = Number(raw.uses);
  const uses = Number.isFinite(usesRaw) ? Math.max(0, Math.round(usesRaw)) : 1;
  const params = raw.params && typeof raw.params === "object" ? { ...raw.params } : {};
  return {
    id: impl.id,
    name: String(raw.name || impl.name || impl.id),
    description: String(raw.description || impl.description || ""),
    shortDesc: String(raw.shortDesc || impl.shortDesc || ""),
    funnyDesc: String(raw.funnyDesc || impl.funnyDesc || ""),
    uses,
    params,
    usesNextLotSlot: Boolean(impl.usesNextLotSlot),
  };
}

function getPowerImpl(id) {
  return (id && POWERS[id]) || null;
}

function canUsePower(room, team, power) {
  if (!team) return { ok: false, error: "No team." };
  const def = publicPower(power) || publicPower(team.franchise && team.franchise.power);
  if (!def) return { ok: false, error: "This character has no power." };
  const impl = getPowerImpl(def.id);
  if (!impl) return { ok: false, error: "Unknown power." };
  if (typeof impl.canUse === "function") return impl.canUse(room, team, def.params || {});
  return { ok: true };
}

function applyPower(room, team, power) {
  if (!team) return { ok: false, error: "No team." };
  const def = publicPower(power) || publicPower(team.franchise && team.franchise.power);
  if (!def) return { ok: false, error: "This character has no power." };
  const impl = getPowerImpl(def.id);
  if (!impl || typeof impl.apply !== "function") {
    return { ok: false, error: "Unknown power." };
  }
  return impl.apply(room, team, def.params || {});
}

function resolvePower(room, team, powerId, payload) {
  const impl = getPowerImpl(powerId);
  if (!impl || typeof impl.resolve !== "function") {
    return { ok: false, error: "This power does not need a follow-up." };
  }
  return impl.resolve(room, team, payload || {});
}

function slotOpen(room, powerId) {
  if (usesNextLotSlot(powerId)) {
    return !(room.pendingLotEffects && room.pendingLotEffects.powerLocked);
  }
  return !room.lotPowerUsed;
}

function listValidCopyPowers(room, team) {
  const myId = (team.franchise && (team.franchise.power && team.franchise.power.id)) || "what_do_you_even_do";
  const out = [];
  for (const def of catPowerDefs()) {
    if (!def.powerId || def.powerId === myId || def.powerId === "what_do_you_even_do") continue;
    if (!slotOpen(room, def.powerId)) continue;
    const gate = canUsePower(room, team, def);
    if (gate.ok) out.push(def);
  }
  return out;
}

function usesNextLotSlot(powerId) {
  const impl = getPowerImpl(powerId);
  return Boolean(impl && impl.usesNextLotSlot);
}

module.exports = {
  POWER_REVEAL_MS,
  POWER_PICK_MS,
  RAKHI_CHOICE_MS,
  DOLLY_DISCONNECT_MS,
  POWERS,
  publicPower,
  getPowerImpl,
  applyPower,
  canUsePower,
  resolvePower,
  listValidCopyPowers,
  usesNextLotSlot,
  slotOpen,
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
  lastSoldRivalTargets,
  peekNextPlayers,
  liveTeams,
  rivals,
  characterIdOf,
};
