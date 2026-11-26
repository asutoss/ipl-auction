/**
 * Sync test: every player's state, built only from the deltas the server sends
 * (exactly what a browser does), must match a fresh server snapshot after every
 * action — including powers, Jay's broadcast fee, Prabhas's hidden lots, bans.
 * When they drift, some players see stale bid buttons or "still in" rings while
 * others (e.g. anyone who refreshed) see the right ones.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { GameRoom } = require("../server/game");
const { loadPlayers } = require("../server/players");
const IplState = require("../public/state");
const { players, meta } = loadPlayers();

let seed = Number(process.argv[4] || 1);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const clone = (x) => JSON.parse(JSON.stringify(x));

function view(st) {
  if (!st) return null;
  const a = st.auction || null;
  const choices = IplState.bidChoices ? IplState.bidChoices(st) : null;
  return {
    phase: st.phase,
    nominee: a && a.nominee ? a.nominee.id : null,
    bid: a ? a.currentBidLakhs : null,
    leader: a ? a.currentBidderName || null : null,
    stillIn: a && a.stillIn ? a.stillIn.map((t) => t.name).sort() : null,
    youCanBid: a ? Boolean(a.youCanBid) : null,
    youCanOptOut: a ? Boolean(a.youCanOptOut) : null,
    choices: choices ? (choices.options || []).map((o) => `${o.amount}:${o.show ? 1 : 0}${o.enabled ? 1 : 0}`).join(",") + `|opt:${choices.canOptOut ? 1 : 0}` : null,
    teams: (st.franchises || []).map((f) => `${f.name}:${f.purseLakhs}:${(f.squad || []).length}:${f.eliminated ? "E" : ""}${f.banned ? "B" : ""}`).join(" "),
    you: st.you ? `${st.you.purseLakhs}:${(st.you.squad || []).length}:${JSON.stringify(st.you.remainingQuota || {})}:${st.you.eliminated ? "E" : ""}${st.you.banned ? "B" : ""}` : null,
  };
}

function diff(a, b) {
  const out = [];
  for (const k of Object.keys(b || {})) {
    if (JSON.stringify(a && a[k]) !== JSON.stringify(b[k])) out.push(`${k}: client=${JSON.stringify(a && a[k])} server=${JSON.stringify(b[k])}`);
  }
  return out;
}

const findings = new Map();
function record(kind, detail) {
  const k = kind;
  if (!findings.has(k)) findings.set(k, { count: 0, example: detail });
  findings.get(k).count++;
}

async function game(gi) {
    const names = ["A", "B", "C", "D"].slice(0, 2 + Math.floor(rnd() * 3));
  const mode = pick(["classical", "rapid", "bullet"]);
  const room = new GameRoom({
    code: "SYNC" + gi, purseLakhs: { classical: 100, rapid: 50, bullet: 30 }[mode], mode,
    timers: { lotStartMs: 40, bidMs: 40, captainMs: 200, soldRevealMs: 0, lastTeamFillMs: 0, playerIntroMs: 0, resultsRevealStepMs: 0, formBoostRevealMs: 0, finalMatchMs: 0, autofillRevealMs: 0, powerRevealMs: 0 },
    allPlayers: players, meta, seed: gi + 7,
  });
  names.forEach((n, i) => room.addPlayer(n, `s${i}`));
  const clients = {};
  const lastEvt = {};
  room.on("snapshot", () => { for (const n of names) clients[n] = clone(room.getState(n)); });
  room.on("delta", (evt) => {
    for (const n of names) {
      if (!clients[n]) continue;
      const e = clone(room.personalizeDelta ? room.personalizeDelta(evt, n) : evt);
      IplState.applyDelta(clients[n], e);
      lastEvt[n] = (lastEvt[n] || []).concat(e.type).slice(-4);
    }
  });
  for (const n of names) clients[n] = clone(room.getState(n));
  room.startAuction(names[0]);
  for (const n of names) clients[n] = clone(room.getState(n));

  const check = (label) => {
    for (const n of names) {
      const truth = view(clone(room.getState(n)));
      const mine = view(clients[n]);
      const d = diff(mine, truth).map((line) => line.startsWith("youCanBid") ? `${line} | client says "${(clients[n].auction || {}).youReason}" server says "${(room.getState(n).auction || {}).youReason}"` : line);
      for (const line of d) {
        const field = line.split(":")[0];
        record(`${field} after ${label} (recent deltas: ${(lastEvt[n] || []).join(">")})`, `${n} ${mode} ${line}`);
      }
      if (d.length) clients[n] = clone(room.getState(n)); // resync to find independent issues
    }
  };

  for (let step = 0; step < 4000 && room.phase === "auction"; step++) {
    const who = pick(names);
    const a = room.auction;
    const r = rnd();
    let label = null;
    if (room.powerWait) {
      // resolve any power wait with a random valid choice via the public state
      const actor = room.franchises.find((f) => f.key === room.powerWait.actorKey);
      const actorSt = actor ? room.getState(actor.name) : null;
      const w = actorSt && actorSt.powerWait;
      if (room.powerWait.kind === "chai") { if (rnd() < 0.3) room.endChaiBreak(actor.name); }
      else if (room.powerWait.kind === "rakhi_choices") { room.resolvePowerChoice(who, { choice: rnd() < 0.5 ? "pay" : "refuse" }); }
      else if (w && w.options && w.options.length) {
        const o = pick(w.options);
        const own = (w.swapOptions || w.ownOptions || []);
        const sw = own.length ? pick(own) : null;
        room.pickPowerTarget(actor.name, { targetKey: o.key, playerId: o.playerId, swapPlayerId: sw && sw.playerId });
      }
      label = "powerWait";
    } else if (a && r < 0.45) {
      const amt = (a.currentBidLakhs || 0) + pick([1, 2, 5]);
      const res = room.bid(who, amt); label = res.ok ? "bid" : null;
    } else if (a && r < 0.85) {
      const res = room.optOut(who); label = res.ok ? "optOut" : null;
    } else if (r < 0.92 && room.usePower) {
      const res = room.usePower(who); label = res.ok ? "usePower" : null;
    } else {
      await new Promise((res) => setTimeout(res, 50)); label = "timer";
    }
    if (label) check(label);
    if (step % 25 === 0) await new Promise((res) => setImmediate(res));
  }
  await new Promise((res) => setTimeout(res, 100));
  check("end");
  room.removeAllListeners();
  if (room.clearTimers) room.clearTimers();
}


test("every client's delta-built state matches a fresh snapshot across random games", { timeout: 120_000 }, async () => {
  seed = 3;
  for (let g = 0; g < 12; g++) await game(g);
  const lines = [...findings.entries()].map(([k, v]) => `${v.count}x ${k} e.g. ${v.example}`);
  assert.deepEqual(lines, [], lines.join("\n"));
});
