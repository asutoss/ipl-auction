#!/usr/bin/env node
/**
 * Measure wall-clock duration of the live Final at the default cap.
 * Usage: node scripts/measure-final-duration.js
 */
delete process.env.FINAL_MATCH_MS;
const fs = require("fs");
const path = require("path");
const { GameRoom } = require("../server/game");
const { loadPlayers } = require("../server/players");
const { players, meta } = loadPlayers();

function giveSquad(room, name, need, price = 2) {
  const team = room.findByName(name);
  const left = { ...need };
  for (const p of players) {
    if ((left[p.role] || 0) > 0 && !room.soldIds.has(p.id)) {
      team.squad.push({ player: p, priceLakhs: price });
      room.soldIds.add(p.id);
      left[p.role] -= 1;
    }
  }
  if (team.squad[0]) team.captainId = team.squad[0].player.id;
}

const room = new GameRoom({ code: "MEAS", purseLakhs: 100, allPlayers: players, meta });
room.addPlayer("Ashutosh", "sock-0");
room.addPlayer("Priya", "sock-1");
giveSquad(room, "Ashutosh", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
giveSquad(room, "Priya", { BAT: 4, WK: 1, AR: 2, BOWL: 4 });
room.phase = "captains";
const t0 = Date.now();
room.finishCaptains();
const r = room.resultsReveal;
if (!r || r.stage !== "final") {
  console.error("expected final stage, got", r && r.stage);
  process.exit(1);
}
const planned = r.finalDurationMs;
const startedAt = r.finalStartedAt;
console.log(JSON.stringify({
  event: "started",
  plannedMs: planned,
  defaultTimerMs: room.timers.finalMatchMs,
  cappedMs: room.finalMatchDelayMs(),
  startedAt,
}, null, 2));

function done() {
  const wall = Date.now() - startedAt;
  const out = {
    plannedMs: planned,
    wallClockMs: wall,
    sinceFinishCaptainsMs: Date.now() - t0,
    stage: room.resultsReveal && room.resultsReveal.stage,
    withinCap: wall <= 60_000 + 250,
  };
  const file = path.join(__dirname, "..", "screenshots", "final-duration.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  if (out.stage !== "done" || !out.withinCap) process.exit(1);
}

const wait = Math.max(0, (r.nextAt || (startedAt + planned)) - Date.now()) + 80;
setTimeout(() => {
  if (room.resultsReveal && room.resultsReveal.stage !== "done") {
    setTimeout(() => {
      done();
      if (room.resultsReveal.stage !== "done") process.exit(1);
    }, 400);
  } else {
    done();
  }
}, wait);
