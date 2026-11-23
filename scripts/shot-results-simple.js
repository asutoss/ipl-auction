#!/usr/bin/env node
/**
 * Mobile screenshots of the simplified results page and team sheet.
 * Usage: node scripts/shot-results-simple.js
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
const PHONE = { width: 390, height: 844 };
const PHONE_NARROW = { width: 360, height: 800 };
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

async function waitFor(page, fn, label, timeoutMs = 15000, ...args) {
  try {
    await page.waitForFunction(fn, { timeout: timeoutMs }, ...args);
  } catch (err) {
    throw new Error(`timeout: ${label} (${err.message})`);
  }
}

async function shot(page, name, viewport, opts = {}) {
  await page.setViewport({ ...viewport, deviceScaleFactor: 2 });
  await page.evaluate((sel) => {
    if (sel) {
      const el = document.querySelector(sel);
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY;
        window.scrollTo(0, Math.max(0, top - 8));
        return;
      }
    }
    window.scrollTo(0, 0);
  }, opts.scroll || null);
  await sleep(350);
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false, timeout: 20000 });
  console.log("wrote", file);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { port, server, manager } = await start(0);
  const origin = `http://127.0.0.1:${port}`;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=390,844"],
  });
  try {
    const ctx = await browser.createBrowserContext();
    const pages = [];
    for (let i = 0; i < 4; i++) {
      const page = await ctx.newPage();
      await page.setViewport({ ...PHONE, deviceScaleFactor: 2 });
      await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await waitFor(page, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket");
      pages.push(page);
    }
    const host = pages[0];
    const created = await emit(host, "createRoom", { name: NAMES[0], mode: "classical" });
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
    room.findByName("Mitron").formPct = 108;
    room.findByName("Dolly").formPct = 96;
    room.findByName("Baahubali").formPct = 115;
    room.findByName("Ravi").formPct = 88;
    room.phase = "captains";
    room.finishCaptains();
    const skipped = room.skipResultsReveal("Mitron");
    if (!skipped.ok) throw new Error(`skip: ${skipped.error}`);
    room.bump("results");
    await sleep(500);
    room.bump("results");

    try {
      await waitFor(host, () => {
        const list = document.getElementById("results-reveal-list");
        const cards = list ? list.querySelectorAll(".result-card").length : 0;
        const text = (document.getElementById("main") && document.getElementById("main").innerText) || "";
        return cards >= 4 && /Current form/i.test(text) && /1000/.test(text);
      }, "all standings revealed", 20000);
    } catch (err) {
      const debug = await host.evaluate(() => ({
        phase: window.IplApp && IplApp.state && IplApp.state.phase,
        cards: document.querySelectorAll(".result-card").length,
      }));
      console.error("debug", debug);
      if (!debug || debug.cards < 4) throw err;
    }
    await sleep(400);
    await shot(host, "results-simple.png", PHONE, { scroll: ".results-reveal" });

    const champName = await host.evaluate(() => {
      const card = document.querySelector(".result-card.is-champion");
      return card ? card.getAttribute("data-team-name") : null;
    });
    if (!champName) throw new Error("champion card missing");
    await host.evaluate((name) => window.IplApp && IplApp.openResultsTeamSheet(name), champName);
    await waitFor(host, () => {
      const modal = document.getElementById("results-team-sheet");
      const players = document.querySelectorAll(".sheet-player");
      return Boolean(modal && !modal.hidden && players.length >= 11);
    }, "team sheet open");
    try {
      await waitFor(host, () => {
        const img = document.querySelector("#results-team-sheet img.is-ready");
        return Boolean(img && img.naturalWidth > 20);
      }, "sheet headshot", 4000);
    } catch {
      console.warn("sheet headshot did not load in time");
    }
    await sleep(300);
    await shot(host, "results-team-sheet.png", PHONE);
    await shot(host, "results-team-sheet-360.png", PHONE_NARROW);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
