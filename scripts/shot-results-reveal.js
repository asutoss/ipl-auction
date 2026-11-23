#!/usr/bin/env node
/**
 * Desktop + mobile screenshots of the phased results reveal (mid and complete).
 * Usage: node scripts/shot-results-reveal.js
 */
process.env.POWER_REVEAL_MS = "0";
process.env.SOLD_REVEAL_MS = "0";
process.env.LAST_TEAM_FILL_MS = "0";
process.env.PLAYER_INTRO_MS = "0";
process.env.RESULTS_REVEAL_STEP_MS = "120000";
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

const OUT = path.join(__dirname, "..", "screenshots");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const { players } = loadPlayers();

const CHAR_IDS = ["narendra-modi", "dolly-chaiwala", "prabhas", "ravi-kishan"];

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

async function waitFor(page, fn, label, timeoutMs = 15000, ...args) {
  try {
    await page.waitForFunction(fn, { timeout: timeoutMs }, ...args);
  } catch (err) {
    throw new Error(`timeout: ${label} (${err.message})`);
  }
}

async function shotBoth(page, base, opts = {}) {
  await page.setViewport({ ...DESKTOP, deviceScaleFactor: 1 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(350);
  const desk = path.join(OUT, `${base}.png`);
  await page.screenshot({ path: desk, fullPage: false, timeout: 20000 });
  console.log("wrote", desk);
  await page.setViewport({ ...MOBILE, deviceScaleFactor: 2 });
  await page.evaluate((sel) => {
    window.scrollTo(0, 0);
    if (!sel) return;
    const el = document.querySelector(sel);
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 8));
    }
  }, opts.mobileScroll || null);
  await sleep(400);
  const mob = path.join(OUT, `${base}-mobile.png`);
  await page.screenshot({ path: mob, fullPage: false, timeout: 20000 });
  console.log("wrote", mob);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { port, server, manager } = await start(0);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", `--window-size=${DESKTOP.width},${DESKTOP.height}`],
  });
  try {
    const ctx = await browser.createBrowserContext();
    const pages = [];
    const names = ["Mitron", "Dolly", "Baahubali", "Ravi"];
    for (let i = 0; i < 4; i++) {
      const page = await ctx.newPage();
      await page.setViewport({ ...DESKTOP, deviceScaleFactor: 1 });
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await waitFor(page, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket");
      pages.push(page);
    }
    const host = pages[0];
    const created = await emit(host, "createRoom", { name: names[0], mode: "classical" });
    if (!created.ok) throw new Error(`create: ${created.error}`);
    const code = created.code;
    await emit(host, "selectCharacter", { characterId: CHAR_IDS[0], identityId: CHAR_IDS[0] });
    for (let i = 1; i < 4; i++) {
      const joined = await emit(pages[i], "joinRoom", { name: names[i], code });
      if (!joined.ok) throw new Error(`join ${names[i]}: ${joined.error}`);
      await emit(pages[i], "selectCharacter", { characterId: CHAR_IDS[i], identityId: CHAR_IDS[i] });
    }
    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "lobby" && st.franchises && st.franchises.length >= 4);
    }, "lobby ready");

    const room = manager.get(code);
    if (!room) throw new Error("room missing");
    const quota = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
    for (const name of names) giveSquad(room, name, quota);
    room.findByName("Mitron").formPct = 108;
    room.findByName("Dolly").formPct = 96;
    room.findByName("Baahubali").formPct = 115;
    room.findByName("Ravi").formPct = 88;
    room.phase = "captains";
    room.finishCaptains();

    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      const list = document.getElementById("results-reveal-list");
      const cards = list ? list.querySelectorAll(".result-card").length : 0;
      return Boolean(st && st.phase === "results" && cards >= 1);
    }, "first standing card", 15000);

    // Mid-reveal: last two places, champion still hidden.
    if (room.resultsReveal && room.resultsReveal.revealedCount < 2) {
      room.tickResultsReveal();
    }
    room.bump("results");
    await waitFor(host, () => {
      const list = document.getElementById("results-reveal-list");
      const cards = list ? list.querySelectorAll(".result-card").length : 0;
      const skip = document.getElementById("skip-reveal");
      return cards >= 2 && cards < 4 && Boolean(skip);
    }, "mid reveal", 15000);
    await sleep(400);
    await shotBoth(host, "results-reveal", { mobileScroll: ".results-reveal" });

    room.skipResultsReveal("Mitron");
    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      const list = document.getElementById("results-reveal-list");
      const cards = list ? list.querySelectorAll(".result-card").length : 0;
      const champ = list && list.querySelector(".result-card.is-champion");
      return Boolean(st && st.resultsReveal && st.resultsReveal.complete && cards >= 4 && champ);
    }, "complete reveal", 15000);
    await sleep(400);
    await shotBoth(host, "results-reveal-complete", { mobileScroll: ".results-reveal" });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
