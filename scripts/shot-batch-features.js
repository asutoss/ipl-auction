#!/usr/bin/env node
/**
 * 360px screenshots and checks for the rules modal, marquee + hub rating,
 * emote picker clamp, and participating-only auction ring.
 * Usage: node scripts/shot-batch-features.js
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

const DIR = path.join(__dirname, "..", "screenshots");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const VIEW = { width: 360, height: 800 };
const NAMES = ["Mitron", "Dolly", "Baahubali", "Ravi"];
const CHAR_IDS = ["narendra-modi", "dolly-chaiwala", "prabhas", "ravi-kishan"];
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

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const { port, server, manager } = await start(0);
  const origin = `http://127.0.0.1:${port}`;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=360,800"],
  });
  const written = [];
  try {
    const hostCtx = await browser.createBrowserContext();
    const guestCtx = await browser.createBrowserContext();
    const host = await hostCtx.newPage();
    await host.setViewport({ ...VIEW, deviceScaleFactor: 2 });
    await host.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await waitFor(host, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "home socket");

    const homeRules = await host.evaluate(() => {
      const btn = document.getElementById("open-rules");
      const r = btn && btn.getBoundingClientRect();
      return {
        hasBtn: Boolean(btn),
        text: btn && btn.textContent.trim(),
        top: r && r.top,
        right: r && r.right,
        height: r && r.height,
        overflows: r ? r.right > 360 + 1 || r.left < -1 : true,
      };
    });
    if (!homeRules.hasBtn || homeRules.text !== "Rules") throw new Error("home Rules button missing: " + JSON.stringify(homeRules));
    if (homeRules.overflows) throw new Error("home Rules button overflows 360px: " + JSON.stringify(homeRules));

    await host.evaluate(() => document.getElementById("open-rules").click());
    await waitFor(host, () => {
      const m = document.getElementById("rules-modal");
      return Boolean(m && !m.hidden);
    }, "home rules modal");
    await sleep(200);
    const rulesPath = path.join(DIR, "rules-modal-mobile.png");
    await host.screenshot({ path: rulesPath, fullPage: false, timeout: 20000 });
    written.push(rulesPath);
    console.log("wrote", rulesPath);

    await host.evaluate(() => document.getElementById("close-rules").click());
    await waitFor(host, () => {
      const m = document.getElementById("rules-modal");
      return Boolean(m && m.hidden);
    }, "rules closed");

    const pages = [host];
    for (let i = 1; i < 4; i++) {
      const page = await guestCtx.newPage();
      await page.setViewport({ ...VIEW, deviceScaleFactor: 2 });
      await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await waitFor(page, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket " + i);
      pages.push(page);
    }

    const created = await emit(host, "createRoom", { name: NAMES[0], mode: "classical", testTimers: TEST_TIMERS });
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

    const inGameRules = await host.evaluate(() => Boolean(document.getElementById("open-rules")));
    if (!inGameRules) throw new Error("Rules button missing on the lobby/playing screen");

    const started = await emit(host, "startAuction", {});
    if (!started.ok) throw new Error(`start: ${started.error}`);
    const room = manager.get(code);
    if (room.playerIntro) room.finishPlayerIntro();
    const nominee = ensureMarqueeNominee(room);
    if (!nominee || !nominee.marquee) throw new Error("could not put a marquee on the block");
    const dolly = room.findByName("Dolly");
    if (dolly) room.optOut("Dolly");
    const hostTeam = room.findByName("Mitron");
    if (hostTeam) hostTeam.purseLakhs = 5;
    room.bump("auction");

    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      const a = st && st.auction;
      const hub = document.getElementById("auction-hub");
      return Boolean(a && a.nominee && hub && document.querySelector(".is-marquee, .marquee-badge"));
    }, "auction with marquee hub", 20000);
    await sleep(400);

    const topOverlap = await host.evaluate(() => {
      const box = (id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { id, left: r.left, right: r.right, top: r.top, bottom: r.bottom, text: el.textContent.trim() };
      };
      const a = box("open-rules");
      const b = box("pause");
      const c = box("end-game");
      const clear = (x, y) => !x || !y || x.right <= y.left + 0.5 || y.right <= x.left + 0.5 || x.bottom <= y.top + 0.5 || y.bottom <= x.top + 0.5;
      const brand = document.querySelector(".topbar h1");
      const br = brand ? brand.getBoundingClientRect() : null;
      const title = br ? { left: br.left, right: br.right, top: br.top, bottom: br.bottom, text: brand.textContent.trim() } : null;
      return { a, b, c, title, ok: clear(a, b) && clear(a, c) && clear(b, c) && clear(a, title), parent: document.getElementById("open-rules") && document.getElementById("open-rules").parentElement.className };
    });
    console.log("top bar", topOverlap);
    if (!topOverlap.ok) throw new Error("top bar controls overlap at 360px: " + JSON.stringify(topOverlap));

    const ringInfo = await host.evaluate(() => {
      const items = [...document.querySelectorAll(".ring-item")].filter((el) => !el.classList.contains("is-leaving"));
      const names = items.map((el) => el.getAttribute("data-name"));
      const seats = window.IplRing && window.IplRing.seatsFromState
        ? window.IplRing.seatsFromState(window.IplApp.state).map((s) => s.name)
        : names;
      const spec = window.IplRing && window.IplRing.segmentTarget
        ? window.IplRing.segmentTarget(window.IplRing.seatsFromState(window.IplApp.state))
        : [];
      const widths = spec.map((s) => s.a1 - s.a0);
      return { names, seats, widths, count: seats.length };
    });
    if (ringInfo.seats.includes("Dolly")) throw new Error("opted-out Dolly still has a ring slice: " + JSON.stringify(ringInfo));
    if (ringInfo.count !== 3) throw new Error("expected 3 participating slices, got " + JSON.stringify(ringInfo));
    if (ringInfo.widths.length === 3) {
      const max = Math.max(...ringInfo.widths);
      const min = Math.min(...ringInfo.widths);
      if (max - min > 0.5) throw new Error("slices are not equal: " + JSON.stringify(ringInfo.widths));
    }
    console.log("ring participants", ringInfo);

    await host.evaluate(() => {
      const hub = document.getElementById("auction-hub");
      if (hub) hub.click();
    });
    await waitFor(host, () => {
      const hub = document.getElementById("auction-hub");
      const rating = document.getElementById("hub-rating");
      return Boolean(hub && hub.classList.contains("is-rating") && rating);
    }, "hub rating open");
    await sleep(200);

    const ratingInfo = await host.evaluate(() => {
      const badge = document.querySelector(".marquee-badge");
      const value = document.querySelector(".hub-rating-value");
      const banner = document.getElementById("low-budget-banner");
      const rules = document.getElementById("open-rules");
      return {
        badge: badge && badge.textContent.trim(),
        rating: value && value.textContent.trim(),
        banner: Boolean(banner),
        bannerText: banner && banner.textContent.trim(),
        rulesVisible: Boolean(rules),
      };
    });
    if (ratingInfo.badge !== "Marquee") throw new Error("missing Marquee badge: " + JSON.stringify(ratingInfo));
    if (!ratingInfo.rating || ratingInfo.rating === "—") throw new Error("rating not shown: " + JSON.stringify(ratingInfo));
    if (!ratingInfo.banner) throw new Error("low-budget banner missing at purse 5");
    if (!ratingInfo.rulesVisible) throw new Error("Rules button missing during auction");
    console.log("rating", ratingInfo);

    const marqueePath = path.join(DIR, "marquee-and-rating.png");
    await host.screenshot({ path: marqueePath, fullPage: false, timeout: 20000 });
    written.push(marqueePath);
    console.log("wrote", marqueePath);

    await host.evaluate(() => {
      const btn = document.getElementById("emote-btn");
      if (btn) btn.click();
    });
    await waitFor(host, () => {
      const pop = document.getElementById("emote-popover");
      const dock = document.getElementById("emote-dock");
      return Boolean(pop && !pop.hidden && dock && dock.parentElement === document.body);
    }, "emote popover open");
    await sleep(200);
    const emoteInfo = await host.evaluate(() => {
      const pop = document.getElementById("emote-popover");
      const dock = document.getElementById("emote-dock");
      const r = pop.getBoundingClientRect();
      const vh = window.innerHeight;
      return {
        parentIsBody: dock.parentElement === document.body,
        fixed: getComputedStyle(dock).position === "fixed",
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        vh,
        ok: r.left >= -0.5 && r.top >= -0.5 && r.right <= 360 + 0.5 && r.bottom <= vh + 0.5,
      };
    });
    if (!emoteInfo.ok || !emoteInfo.parentIsBody || !emoteInfo.fixed) {
      throw new Error("emote popover not fully inside 360px viewport: " + JSON.stringify(emoteInfo));
    }
    console.log("emote popover", emoteInfo);
    const chatPath = path.join(DIR, "chat-picker-mobile.png");
    await host.screenshot({ path: chatPath, fullPage: false, timeout: 20000 });
    written.push(chatPath);
    console.log("wrote", chatPath);

    await host.evaluate(() => {
      const pop = document.getElementById("emote-popover");
      if (pop && !pop.hidden) document.getElementById("emote-btn") && document.getElementById("emote-btn").click();
    });
    const mitron = room.findByName("Mitron");
    const ravi = room.findByName("Ravi");
    if (mitron) mitron.purseLakhs = 1;
    if (ravi && room.auction) {
      room.auction.currentBidderKey = ravi.key;
      room.auction.currentBidLakhs = 2;
      room.auction.hasBidder = true;
    }
    room.bump("auction");
    await sleep(300);
    const bidClicked = await host.evaluate(() => {
      const target = document.querySelector(".bid-amt") || document.querySelector("[data-bid-blocked]");
      if (!target) return { found: false };
      target.click();
      const modal = document.getElementById("action-reason");
      return {
        found: true,
        disabled: target.disabled,
        aria: target.getAttribute("aria-disabled"),
        reasonOpen: Boolean(modal && !modal.hidden),
        body: (document.getElementById("action-reason-body") || {}).textContent || "",
      };
    });
    console.log("blocked bid", bidClicked);
    if (!bidClicked.found || bidClicked.disabled || bidClicked.aria !== "true" || !bidClicked.reasonOpen) {
      throw new Error("blocked bid dialog failed: " + JSON.stringify(bidClicked));
    }
    if (!/not enough balance|not enough points|squad full/i.test(bidClicked.body)) {
      throw new Error("unexpected bid reason: " + bidClicked.body);
    }

    console.log("ok", written);
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
