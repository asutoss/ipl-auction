#!/usr/bin/env node
/**
 * 360px screenshot of a live Final cricket animation (SIX / bat swing).
 * Usage: node scripts/shot-final-cricket-anim.js
 */
process.env.POWER_REVEAL_MS = "0";
process.env.SOLD_REVEAL_MS = "0";
process.env.LAST_TEAM_FILL_MS = "0";
process.env.PLAYER_INTRO_MS = "0";
process.env.RESULTS_REVEAL_STEP_MS = "0";
process.env.FORM_BOOST_REVEAL_MS = "0";
process.env.FINAL_MATCH_MS = "120000";
process.env.LOT_START_MS = "180000";
process.env.BID_TIMER_MS = "180000";
process.env.CAPTAIN_TIMER_MS = "180000";
process.env.ALLOW_TEST_TIMERS = "1";
process.env.CREATE_LIMIT = "0";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { start } = require("../server/index");
const { loadPlayers } = require("../server/players");

const OUT = path.join(__dirname, "..", "screenshots", "final-cricket-anim.png");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const VIEW = { width: 360, height: 800 };
const { players } = loadPlayers();
const CHAR_IDS = ["narendra-modi", "dolly-chaiwala", "prabhas", "ravi-kishan"];
const NAMES = ["Mitron", "Dolly", "Baahubali", "Ravi"];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

async function emit(page, event, payload = {}) {
  return page.evaluate(
    (event, payload) =>
      new Promise((resolve) => {
        const sock = window.IplApp && window.IplApp.socket;
        if (!sock) return resolve({ ok: false, error: "no socket" });
        sock.emit(event, payload, (res) => resolve(res || { ok: true }));
      }),
    event,
    payload
  );
}

async function waitFor(page, fn, label, timeoutMs = 20000) {
  try {
    await page.waitForFunction(fn, { timeout: timeoutMs });
  } catch (err) {
    throw new Error(`timeout: ${label} (${err.message})`);
  }
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const { port, server, manager } = await start(0);
  const origin = `http://127.0.0.1:${port}`;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=360,800"],
  });
  try {
    const ctx = await browser.createBrowserContext();
    const pages = [];
    for (let i = 0; i < 4; i++) {
      const page = await ctx.newPage();
      await page.setViewport({ ...VIEW, deviceScaleFactor: 2 });
      await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await waitFor(page, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket");
      pages.push(page);
    }
    const host = pages[0];
    const created = await emit(host, "createRoom", {
      name: NAMES[0],
      mode: "classical",
      testTimers: {
        lotStartMs: 180000,
        bidMs: 180000,
        captainMs: 10,
        soldRevealMs: 0,
        lastTeamFillMs: 0,
        playerIntroMs: 0,
        resultsRevealStepMs: 0,
        finalMatchMs: 120000,
        formBoostRevealMs: 0,
      },
    });
    if (!created.ok) throw new Error(`create: ${created.error}`);
    const code = created.code;
    await emit(host, "selectCharacter", { characterId: CHAR_IDS[0], identityId: CHAR_IDS[0] });
    for (let i = 1; i < 4; i++) {
      const joined = await emit(pages[i], "joinRoom", { name: NAMES[i], code });
      if (!joined.ok) throw new Error(`join ${NAMES[i]}: ${joined.error}`);
      await emit(pages[i], "selectCharacter", { characterId: CHAR_IDS[i], identityId: CHAR_IDS[i] });
    }
    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "lobby" && st.franchises && st.franchises.length >= 4);
    }, "lobby ready");

    const room = manager.get(code);
    const quota = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
    for (const name of NAMES) giveSquad(room, name, quota);
    room.phase = "captains";
    room.finishCaptains();

    const r = room.resultsReveal;
    if (!r || r.stage !== "final") {
      throw new Error(`expected final stage, got ${r && r.stage}`);
    }
    const dur = r.finalDurationMs || 120000;
    r.finalElapsedMs = 0;
    r.finalStartedAt = Date.now() - Math.round(dur * 0.22);
    room.emitResultsReveal();

    await host.waitForSelector("#final-live-body", { timeout: 20000 });
    await waitFor(host, () => Boolean(window.IplFx && typeof IplFx.playCue === "function"), "fx ready");
    await sleep(400);
    await host.addStyleTag({ content: "#toast, .topbar { display: none !important; }" });
    await host.evaluate(() => {
      window.IplFx.playCue("six", { hold: true });
    });
    await sleep(450);
    const playing = await host.evaluate(() => {
      const el = document.getElementById("cricket-fx");
      return Boolean(el && !el.hidden && el.classList.contains("is-six") && el.classList.contains("is-play"));
    });
    if (!playing) throw new Error("SIX animation did not stay on screen");
    await host.screenshot({ path: OUT, fullPage: false, timeout: 20000 });
    console.log("wrote", OUT);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
