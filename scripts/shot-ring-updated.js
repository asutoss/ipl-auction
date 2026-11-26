#!/usr/bin/env node
/**
 * 360px check of the auction ring: team name, purse left, open slots,
 * and a bat/bowl-only hub rating (no overall rating).
 * Usage: node scripts/shot-ring-updated.js
 */
process.env.POWER_REVEAL_MS = "0";
process.env.SOLD_REVEAL_MS = "0";
process.env.LAST_TEAM_FILL_MS = "0";
process.env.PLAYER_INTRO_MS = "0";
process.env.FORM_BOOST_REVEAL_MS = "0";
process.env.RESULTS_REVEAL_STEP_MS = "0";
process.env.FINAL_MATCH_MS = "0";
process.env.AUTOFILL_REVEAL_MS = "0";
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

const OUT = path.join(__dirname, "..", "screenshots", "ring-updated-mobile.png");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const VIEW = { width: 360, height: 800 };
const NAMES = ["Mitron", "Dolly", "Baahubali", "Ravi", "Kim", "Samay"];
const CHAR_IDS = ["narendra-modi", "dolly-chaiwala", "prabhas", "ravi-kishan", "kim-jong-un", "samay-raina"];
const PURSES = [42, 88, 15, 61, 27, 100];
const GIVE = [3, 1, 6, 2, 4, 0];
const TEST_TIMERS = {
  lotStartMs: 180000,
  bidMs: 180000,
  captainMs: 180000,
  soldRevealMs: 0,
  lastTeamFillMs: 0,
  playerIntroMs: 0,
  resultsRevealStepMs: 0,
  formBoostRevealMs: 0,
  finalMatchMs: 0,
  autofillRevealMs: 0,
  powerRevealMs: 0,
};
const { players } = loadPlayers();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function emit(page, event, payload = {}) {
  return Promise.race([
    page.evaluate(
      (event, payload) =>
        new Promise((resolve) => {
          const sock = window.IplApp && window.IplApp.socket;
          if (!sock) return resolve({ ok: false, error: "no socket" });
          sock.emit(event, payload, (res) => resolve(res || { ok: true }));
        }),
      event,
      payload
    ),
    sleep(8000).then(() => ({ ok: false, error: `timeout emitting ${event}` })),
  ]);
}

async function waitFor(page, fn, label, timeoutMs = 15000) {
  try {
    await page.waitForFunction(fn, { timeout: timeoutMs });
  } catch (err) {
    throw new Error(`timeout: ${label} (${err.message})`);
  }
}

function ensureMarqueeNominee(room) {
  const isM = (p) => p && p.marquee;
  if (room.auction && isM(room.auction.nominee)) return room.auction.nominee;
  const fromQ = (room.queue || []).find(isM);
  if (fromQ) {
    room.queue = room.queue.filter((p) => p.id !== fromQ.id);
    if (room.auction && room.auction.nominee) room.queue.unshift(room.auction.nominee);
    room.auction.nominee = fromQ;
  }
  return room.auction && room.auction.nominee;
}

function seedSquads(room) {
  let i = 0;
  NAMES.forEach((name, idx) => {
    const team = room.findByName(name);
    team.purseLakhs = PURSES[idx];
    const n = GIVE[idx];
    for (let k = 0; k < n; k++) {
      const p = players[i++];
      if (!p) break;
      team.squad.push({ player: p, priceLakhs: 2 });
      room.soldIds.add(p.id);
    }
  });
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
    const hostCtx = await browser.createBrowserContext();
    const guestCtx = await browser.createBrowserContext();
    const pages = [];
    for (let i = 0; i < NAMES.length; i++) {
      const page = await (i === 0 ? hostCtx : guestCtx).newPage();
      await page.setViewport({ ...VIEW, deviceScaleFactor: 2 });
      await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await waitFor(page, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket " + i);
      pages.push(page);
    }
    const host = pages[0];
    const created = await emit(host, "createRoom", { name: NAMES[0], mode: "classical", testTimers: TEST_TIMERS });
    if (!created.ok) throw new Error(`create: ${created.error}`);
    const code = created.code;
    await emit(host, "selectCharacter", { characterId: CHAR_IDS[0], identityId: CHAR_IDS[0] });
    for (let i = 1; i < NAMES.length; i++) {
      const joined = await emit(pages[i], "joinRoom", { name: NAMES[i], code });
      if (!joined.ok) throw new Error(`join ${NAMES[i]}: ${joined.error}`);
      await emit(pages[i], "selectCharacter", { characterId: CHAR_IDS[i], identityId: CHAR_IDS[i] });
    }
    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "lobby" && st.franchises && st.franchises.length >= 6);
    }, "lobby ready");

    const started = await emit(host, "startAuction", {});
    if (!started.ok) throw new Error(`start: ${started.error}`);
    const room = manager.get(code);
    if (room.playerIntro) room.finishPlayerIntro();
    ensureMarqueeNominee(room);
    seedSquads(room);
    room.bump("auction");
    await sleep(400);

    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      const names = [...document.querySelectorAll(".ring-logo-pin:not(.is-leaving) .ring-seat-name")].map((el) => el.textContent.trim());
      return Boolean(st && st.auction && st.auction.nominee && names.length === 6 && names.includes("Baahubali") && names.includes("Kim"));
    }, "six named ring seats", 20000);
    await sleep(250);

    await host.evaluate(() => {
      const hub = document.getElementById("auction-hub");
      if (hub) hub.click();
    });
    await waitFor(host, () => {
      const hub = document.getElementById("auction-hub");
      const rating = document.getElementById("hub-rating");
      return Boolean(hub && hub.classList.contains("is-rating") && rating);
    }, "hub bat/bowl open");
    await sleep(200);

    const info = await host.evaluate(() => {
      const hub = document.getElementById("hub-rating");
      const labels = [...(hub ? hub.querySelectorAll(".hub-stat-label") : [])].map((el) => el.textContent.trim());
      const values = [...(hub ? hub.querySelectorAll(".hub-stat-value") : [])].map((el) => el.textContent.trim());
      const overall = hub && /overall|rating/i.test(hub.textContent) && !/bat|bowl/i.test(hub.textContent);
      const pins = [...document.querySelectorAll(".ring-logo-pin:not(.is-leaving)")].map((pin) => {
        const name = (pin.querySelector(".ring-seat-name") || {}).textContent || "";
        const pts = (pin.querySelector(".ring-bubble-pts") || {}).textContent || "";
        const need = (pin.querySelector(".ring-bubble-need") || {}).textContent || "";
        const nameBox = (pin.querySelector(".ring-seat-name") || pin).getBoundingClientRect();
        const bubble = pin.querySelector(".ring-bubble");
        const box = bubble ? bubble.getBoundingClientRect() : nameBox;
        const union = {
          left: Math.min(nameBox.left, box.left),
          right: Math.max(nameBox.right, box.right),
          top: Math.min(nameBox.top, box.top),
          bottom: Math.max(nameBox.bottom, box.bottom),
        };
        return { name: name.trim(), pts: pts.trim(), need: need.trim(), ...union };
      });
      const vh = window.innerHeight;
      const clipped = pins.filter((p) => p.left < -1 || p.top < -1 || p.right > 361 || p.bottom > vh + 1);
      return { labels, values, hubText: hub ? hub.textContent.replace(/\s+/g, " ").trim() : "", overall, pins, clipped, count: pins.length };
    });

    if (info.count !== 6) throw new Error("expected 6 ring seats: " + JSON.stringify(info.pins));
    if (info.labels.join(" ") !== "Bat Bowl") throw new Error("hub should show only Bat and Bowl: " + info.hubText);
    if (info.values.some((v) => !v || v === "—") || info.values.length !== 2) {
      throw new Error("missing bat/bowl values: " + JSON.stringify(info.values));
    }
    if (/overall/i.test(info.hubText)) throw new Error("overall rating leaked into hub: " + info.hubText);
    const missing = info.pins.filter((p) => !p.name || !/pts/.test(p.pts) || !p.need);
    if (missing.length) throw new Error("ring pin missing name/purse/slots: " + JSON.stringify(missing));
    if (info.clipped.length) throw new Error("ring labels clipped at 360px: " + JSON.stringify(info.clipped));
    console.log("ring", info);

    await host.screenshot({ path: OUT, fullPage: false, timeout: 20000 });
    console.log("wrote", OUT);
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
