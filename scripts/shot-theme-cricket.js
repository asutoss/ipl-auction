#!/usr/bin/env node
/**
 * Lobby, auction, sold, and results screenshots for the cricket theme.
 * Usage: THEME_SHOT_SUFFIX=-before node scripts/shot-theme-cricket.js
 *        node scripts/shot-theme-cricket.js
 */
process.env.POWER_REVEAL_MS = "0";
process.env.SOLD_REVEAL_MS = process.env.SOLD_REVEAL_MS || "120000";
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
const SUFFIX = process.env.THEME_SHOT_SUFFIX || "";
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
  const name = `${base}${SUFFIX}`;
  await page.setViewport({ ...DESKTOP, deviceScaleFactor: 1 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(opts.deskDelay || 300);
  const desk = path.join(OUT, `${name}.png`);
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
  await sleep(opts.mobDelay || 350);
  const mob = path.join(OUT, `${name}-mobile.png`);
  await page.screenshot({ path: mob, fullPage: false, timeout: 20000 });
  console.log("wrote", mob);
}

async function openPage(browser, origin) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ ...DESKTOP, deviceScaleFactor: 1 });
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await waitFor(page, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket");
  page._ctx = ctx;
  return page;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { port, server, manager } = await start(0);
  const origin = `http://127.0.0.1:${port}`;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", `--window-size=${DESKTOP.width},${DESKTOP.height}`],
  });
  try {
    const host = await openPage(browser, origin);
    const guest = await openPage(browser, origin);
    const created = await emit(host, "createRoom", { name: "Mitron", mode: "classical" });
    if (!created.ok) throw new Error(`create: ${created.error}`);
    const code = created.code;
    await emit(host, "selectCharacter", { characterId: CHAR_IDS[0], identityId: CHAR_IDS[0] });
    const joined = await emit(guest, "joinRoom", { name: "Dolly", code });
    if (!joined.ok) throw new Error(`join: ${joined.error}`);
    await emit(guest, "selectCharacter", { characterId: CHAR_IDS[1], identityId: CHAR_IDS[1] });
    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "lobby" && st.franchises && st.franchises.length >= 2 && document.querySelector(".room-code"));
    }, "lobby");
    await sleep(250);
    await shotBoth(host, "theme-lobby");

    const started = await emit(host, "startAuction", {});
    if (!started.ok) throw new Error(`start: ${started.error}`);
    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "auction" && st.auction && st.auction.nominee && document.getElementById("auction-hub"));
    }, "auction hub");
    await sleep(300);
    await shotBoth(host, "theme-auction");

    const opted = await emit(guest, "optOut", {});
    if (!opted.ok) throw new Error(`optOut: ${opted.error}`);
    await waitFor(host, () => {
      const modal = document.getElementById("sold-modal");
      return Boolean(modal && !modal.hidden && modal.classList.contains("is-in"));
    }, "sold modal");
    await sleep(420);
    await shotBoth(host, "theme-sold");

    const extra = [];
    const extraNames = ["Baahubali", "Ravi"];
    for (let i = 0; i < extraNames.length; i++) {
      const page = await openPage(browser, origin);
      extra.push(page);
      const res = await emit(page, "joinRoom", { name: extraNames[i], code });
      // Auction already started — they may not be able to join as new names.
      // We'll inject teams via the server instead for results.
      page._join = res;
    }

    const room = manager.get(code);
    if (!room) throw new Error("room missing");
    // Reset to a completed-squad results reveal for the theme shot.
    const names = ["Mitron", "Dolly", "Baahubali", "Ravi"];
    // If extra players couldn't join mid-auction, add them on the server in lobby-like fashion is invalid.
    // Instead, build a fresh room for results.
    await host._ctx.close();
    await guest._ctx.close();
    for (const p of extra) await p._ctx.close();

    const host2 = await openPage(browser, origin);
    const pages = [host2];
    const created2 = await emit(host2, "createRoom", { name: names[0], mode: "classical" });
    if (!created2.ok) throw new Error(`create2: ${created2.error}`);
    const code2 = created2.code;
    await emit(host2, "selectCharacter", { characterId: CHAR_IDS[0], identityId: CHAR_IDS[0] });
    for (let i = 1; i < 4; i++) {
      const page = await openPage(browser, origin);
      pages.push(page);
      const ok = await emit(page, "joinRoom", { name: names[i], code: code2 });
      if (!ok.ok) throw new Error(`join ${names[i]}: ${ok.error}`);
      await emit(page, "selectCharacter", { characterId: CHAR_IDS[i], identityId: CHAR_IDS[i] });
    }
    await waitFor(host2, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "lobby" && st.franchises && st.franchises.length >= 4);
    }, "results lobby");
    const room2 = manager.get(code2);
    const quota = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
    for (const name of names) giveSquad(room2, name, quota);
    room2.findByName("Mitron").formPct = 108;
    room2.findByName("Dolly").formPct = 96;
    room2.findByName("Baahubali").formPct = 115;
    room2.findByName("Ravi").formPct = 88;
    room2.phase = "captains";
    room2.finishCaptains();
    await waitFor(host2, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "results");
    }, "results phase", 15000);
    const skip = await emit(host2, "skipResultsReveal", {});
    if (skip && skip.ok === false) {
      // already complete is fine
    }
    await waitFor(host2, () => {
      const list = document.getElementById("results-reveal-list");
      const champ = list && list.querySelector(".result-card.is-champion");
      const cards = list ? list.querySelectorAll(".result-card").length : 0;
      return Boolean(champ && cards >= 4);
    }, "champion card", 15000);
    await sleep(500);
    await shotBoth(host2, "theme-results", { mobileScroll: ".results-reveal" });

    for (const p of pages) await p._ctx.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
