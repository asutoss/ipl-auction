#!/usr/bin/env node
/**
 * 360px shots: default hub with long team names, and ratings-only tap view.
 * Usage: node scripts/shot-hub-long-names.js
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

const OUT_DIR = path.join(__dirname, "..", "screenshots");
const OUT_DEFAULT = path.join(OUT_DIR, "hub-default-long-names.png");
const OUT_TAPPED = path.join(OUT_DIR, "hub-tapped-ratings-only.png");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const VIEW = { width: 360, height: 800 };
const NAMES = [
  "Royal Challengers Bengal",
  "Super Kings Express",
  "Mumbai Mavericks XI",
  "Sunrisers Hyderabad",
  "Chennai Super Knights",
  "Lucknow Giants United",
];
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
  const nomineeId = room.auction && room.auction.nominee && room.auction.nominee.id;
  let i = 0;
  NAMES.forEach((name, idx) => {
    const team = room.findByName(name);
    team.purseLakhs = PURSES[idx];
    const n = GIVE[idx];
    let given = 0;
    while (given < n && i < players.length) {
      const p = players[i++];
      if (!p || p.id === nomineeId || room.soldIds.has(p.id)) continue;
      team.squad.push({ player: p, priceLakhs: 2 });
      room.soldIds.add(p.id);
      given += 1;
    }
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
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
    seedSquads(room);
    const current = room.auction && room.auction.nominee;
    if (!current || current.role !== "WK") {
      const wk = players.find((p) => p.role === "WK" && (!current || p.id !== current.id) && !room.soldIds.has(p.id));
      if (!wk) throw new Error("no WK available");
      if (current) room.queue.unshift(current);
      room.queue = (room.queue || []).filter((p) => p.id !== wk.id);
      room.auction.nominee = wk;
    }
    room.bump("auction");
    await sleep(400);

    const seatDeadline = Date.now() + 40000;
    let settled = false;
    while (Date.now() < seatDeadline) {
      const snap = await host.evaluate(() => {
        const st = window.IplApp && IplApp.state;
        if (!st || !st.auction) return { names: [], leaving: 0 };
        return {
          names: [...document.querySelectorAll(".ring-logo-pin:not(.is-leaving) .ring-seat-name")].map((el) => el.textContent.trim()),
          leaving: document.querySelectorAll(".ring-logo-pin.is-leaving").length,
        };
      });
      if (snap.leaving === 0 && snap.names.length === 6 && NAMES.every((n) => snap.names.includes(n))) {
        settled = true;
        break;
      }
      await sleep(150);
    }
    if (!settled) throw new Error("timeout: six named ring seats");
    await host.evaluate(() => {
      const svg = document.getElementById("auction-ring");
      if (svg && window.IplRing && IplRing.layoutSeatChips) IplRing.layoutSeatChips(svg);
    });
    await sleep(250);

    const info = await host.evaluate(() => {
      const svg = document.getElementById("auction-ring");
      if (svg && window.IplRing && IplRing.layoutSeatChips) IplRing.layoutSeatChips(svg);
      const measure = window.IplRing && IplRing.measureRingCollisions
        ? IplRing.measureRingCollisions(svg)
        : { ok: false, overlaps: [{ type: "missing-api" }], clipped: [] };
      const pins = [...document.querySelectorAll(".ring-logo-pin:not(.is-leaving)")].map((pin) => {
        const name = (pin.querySelector(".ring-seat-name") || {}).textContent || "";
        const pts = (pin.querySelector(".ring-bubble-pts") || {}).textContent || "";
        const need = (pin.querySelector(".ring-bubble-need") || {}).textContent || "";
        const title = (pin.querySelector(".ring-bubble") || {}).getAttribute("title") || "";
        return { name: name.trim(), pts: pts.trim(), need: need.trim(), title };
      });
      const dock = document.querySelector(".emote-dock");
      const dockBox = dock ? dock.getBoundingClientRect() : null;
      const live = document.querySelector(".live-bid");
      const liveH = live ? Math.round(live.getBoundingClientRect().height) : 0;
      return { measure, pins, count: pins.length, dockBox, liveH };
    });

    if (info.count !== 6) throw new Error("expected 6 ring seats: " + JSON.stringify(info.pins));
    if (!info.measure.ok) throw new Error("ring chip overlap at 360px: " + JSON.stringify(info.measure));
    const missing = info.pins.filter((p) => !p.name || !/\d+p/.test(p.pts) || !p.need);
    if (missing.length) throw new Error("ring pin missing compact purse/slots: " + JSON.stringify(missing));

    try {
      await waitFor(host, () => {
        const shot = document.getElementById("hub-headshot");
        const img = shot && shot.querySelector("img.is-ready");
        return Boolean(img && img.naturalWidth > 8);
      }, "official hub headshot ready", 8000);
    } catch (_) {
      // Fallback initials still count if the official image is slow or missing.
    }
    await sleep(120);

    const hubDefault = await host.evaluate(() => {
      function isShown(el) {
        if (!el) return false;
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 8 && r.height > 8;
      }
      const hub = document.getElementById("auction-hub");
      const shot = document.getElementById("hub-headshot") || (hub && hub.querySelector(".player-headshot"));
      const rating = document.getElementById("hub-rating");
      return {
        isRating: Boolean(hub && hub.classList.contains("is-rating")),
        shotShown: isShown(shot),
        ratingShown: isShown(rating),
      };
    });
    if (!hubDefault.shotShown) throw new Error("default hub is missing the player picture: " + JSON.stringify(hubDefault));
    if (hubDefault.isRating || hubDefault.ratingShown) throw new Error("default hub already shows bat/bowl: " + JSON.stringify(hubDefault));
    const missingNames = NAMES.filter((n) => !info.pins.some((p) => p.name === n));
    if (missingNames.length) throw new Error("long names not fully shown: " + JSON.stringify({ missingNames, pins: info.pins }));
    console.log("ring", info, hubDefault);

    await host.addStyleTag({ content: "#toast { display: none !important; }" });
    await host.screenshot({ path: OUT_DEFAULT, fullPage: false, timeout: 20000 });
    console.log("wrote", OUT_DEFAULT);

    await host.evaluate(() => {
      const hub = document.getElementById("auction-hub");
      if (hub) hub.click();
    });
    await waitFor(host, () => {
      const hub = document.getElementById("auction-hub");
      const rating = document.getElementById("hub-rating");
      const shot = document.getElementById("hub-headshot") || (hub && hub.querySelector(".player-headshot"));
      const name = document.getElementById("hub-name");
      const shown = (el) => {
        if (!el) return false;
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 8 && r.height > 8;
      };
      return Boolean(hub && hub.classList.contains("is-rating") && shown(rating) && !shown(shot) && !shown(name));
    }, "hub ratings only, no photo or name");
    await sleep(200);
    await host.screenshot({ path: OUT_TAPPED, fullPage: false, timeout: 20000 });
    console.log("wrote", OUT_TAPPED);

  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
