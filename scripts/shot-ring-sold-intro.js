#!/usr/bin/env node
/**
 * Screenshots for the ring-scroll fix, sold-player image, and 3s intro without a timer.
 * Usage: node scripts/shot-ring-sold-intro.js
 */
process.env.POWER_REVEAL_MS = "0";
process.env.SOLD_REVEAL_MS = "0";
process.env.LAST_TEAM_FILL_MS = "0";
process.env.PLAYER_INTRO_MS = "0";
process.env.LOT_START_MS = "180000";
process.env.BID_TIMER_MS = "180000";
process.env.ALLOW_TEST_TIMERS = "1";
process.env.CREATE_LIMIT = "0";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { start } = require("../server/index");
const { loadPlayers, clonePlayer } = require("../server/players");

const OUT = path.join(__dirname, "..", "screenshots");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const PHONE = { width: 390, height: 844 };
const KOHLI = loadPlayers().players.find((p) => p.id === "virat-kohli");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

async function shot(page, name) {
  await page.setViewport({ ...PHONE, deviceScaleFactor: 2 });
  await page.evaluate(() => window.scrollTo(0, window.__shotScrollY || 0));
  await sleep(280);
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false, timeout: 20000 });
  console.log("wrote", file);
}

async function openPage(browser, origin) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ ...PHONE, deviceScaleFactor: 2 });
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await waitFor(page, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket");
  page._ctx = ctx;
  return page;
}

async function startAuctionOn(browser, origin, testTimers) {
  const host = await openPage(browser, origin);
  const created = await emit(host, "createRoom", { name: "Mitron", mode: "classical", testTimers });
  if (!created.ok) throw new Error(`create: ${created.error}`);
  const code = created.code;
  await emit(host, "selectCharacter", { characterId: "narendra-modi", identityId: "narendra-modi" });
  const guest = await openPage(browser, origin);
  const joined = await emit(guest, "joinRoom", { name: "Dolly", code });
  if (!joined.ok) throw new Error(`join: ${joined.error}`);
  await emit(guest, "selectCharacter", { characterId: "dolly-chaiwala", identityId: "dolly-chaiwala" });
  await waitFor(host, () => {
    const st = window.IplApp && window.IplApp.state;
    return Boolean(st && st.phase === "lobby" && st.franchises && st.franchises.length >= 2);
  }, "lobby ready");
  const started = await emit(host, "startAuction", {});
  if (!started.ok) throw new Error(`start: ${started.error}`);
  return { host, guest, code };
}

function forceNominee(manager, code, player) {
  const room = manager.get(code);
  if (!room || !room.auction) throw new Error(`room ${code} is not in auction`);
  room.auction.nominee = clonePlayer(player);
  room.emitDelta({ type: "lotStart", ...room.packAuctionPublic() });
}

async function ringBox(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".ring-wrap") || document.getElementById("auction-ring");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { width: Math.round(r.width * 100) / 100, height: Math.round(r.height * 100) / 100, top: Math.round(r.top * 100) / 100 };
  });
}

function sameSize(a, b, label) {
  if (!a || !b) throw new Error(`${label}: missing box ${JSON.stringify({ a, b })}`);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`${label}: ring changed ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  if (!KOHLI || !KOHLI.headshot) throw new Error("Virat Kohli headshot missing");
  const { port, server, manager } = await start(0);
  const origin = `http://127.0.0.1:${port}`;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=390,844"],
  });
  const opened = [];
  try {
    const ring = await startAuctionOn(browser, origin, { playerIntroMs: 0, lotStartMs: 180000, bidMs: 180000 });
    opened.push(ring.host, ring.guest);
    const page = ring.guest;
    await waitFor(page, () => Boolean(document.querySelector(".ring-wrap") && document.getElementById("auction-hub")), "auction ring");
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);
    const top = await ringBox(page);
    await shot(page, "ring-scroll-top.png");

    await page.evaluate(() => {
      const extra = document.createElement("div");
      extra.id = "shot-scroll-spacer";
      extra.style.height = "1200px";
      document.body.appendChild(extra);
      window.scrollTo(0, 420);
      window.__shotScrollY = 420;
    });
    await sleep(300);
    const down = await ringBox(page);
    sameSize(top, down, "after scroll");
    await shot(page, "ring-scroll-down.png");
    await page.evaluate(() => {
      window.__shotScrollY = 0;
      window.scrollTo(0, 0);
      const spacer = document.getElementById("shot-scroll-spacer");
      if (spacer) spacer.remove();
    });

    await page.setViewport({ width: 390, height: 620, deviceScaleFactor: 2 });
    await sleep(300);
    const short = await ringBox(page);
    sameSize(top, short, "after innerHeight shrink");
    await page.evaluate(() => {
      if (window.IplApp && IplApp.syncRingSize) IplApp.syncRingSize();
    });
    const shortAfterSync = await ringBox(page);
    sameSize(top, shortAfterSync, "after innerHeight shrink + syncRingSize");
    await page.setViewport({ ...PHONE, deviceScaleFactor: 2 });
    console.log("ring size stable:", JSON.stringify({ top, down, short, shortAfterSync }));

    await ring.host._ctx.close();
    await ring.guest._ctx.close();
    opened.length = 0;

    const sold = await startAuctionOn(browser, origin, {
      playerIntroMs: 0,
      lotStartMs: 180000,
      bidMs: 180000,
      soldRevealMs: 120000,
    });
    opened.push(sold.host, sold.guest);
    forceNominee(manager, sold.code, KOHLI);
    await waitFor(sold.guest, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.auction && st.auction.nominee && st.auction.nominee.name === "Virat Kohli");
    }, "kohli on the block");
    const room = manager.get(sold.code);
    room.sellCurrent();
    await waitFor(sold.guest, () => {
      const modal = document.getElementById("sold-modal");
      const img = document.querySelector("#sold-shot img.is-ready");
      const name = document.getElementById("sold-player");
      return Boolean(modal && !modal.hidden && name && name.textContent === "Virat Kohli" && img && img.naturalWidth > 40);
    }, "sold modal with player image", 15000);
    const ownerPortrait = await sold.guest.evaluate(() => Boolean(document.querySelector("#sold-shot .team-mark-wrap, #sold-logo .team-mark-img")));
    if (ownerPortrait) throw new Error("sold modal still shows the owner's portrait");
    await shot(sold.guest, "sold-player-image.png");
    await sold.host._ctx.close();
    await sold.guest._ctx.close();
    opened.length = 0;

    const intro = await startAuctionOn(browser, origin, {
      playerIntroMs: 120000,
      lotStartMs: 180000,
      bidMs: 180000,
    });
    opened.push(intro.host, intro.guest);
    forceNominee(manager, intro.code, KOHLI);
    await waitFor(intro.guest, () => {
      const modal = document.getElementById("player-intro");
      const name = document.getElementById("player-intro-name");
      return Boolean(modal && !modal.hidden && name && name.textContent === "Virat Kohli");
    }, "player intro visible");
    try {
      await waitFor(intro.guest, () => {
        const img = document.querySelector("#player-intro-shot img.is-ready");
        return Boolean(img && img.naturalWidth > 40);
      }, "player intro headshot", 4000);
    } catch {
      console.warn("intro headshot did not load in time; capturing the modal anyway");
    }
    const introTimer = await intro.guest.evaluate(() => {
      const count = document.getElementById("player-intro-countdown");
      const bar = document.getElementById("player-intro-progress-bar");
      const text = (modalText) => modalText;
      const modal = document.getElementById("player-intro");
      const body = modal ? modal.innerText : "";
      return {
        hasCountdownEl: Boolean(count),
        hasProgressEl: Boolean(bar),
        mentionsOpens: /bidding opens/i.test(body),
        mentionsSeconds: /\d+\s*s/.test(body) && /bid/i.test(body),
      };
    });
    if (introTimer.hasCountdownEl || introTimer.hasProgressEl || introTimer.mentionsOpens) {
      throw new Error(`intro still shows a timer: ${JSON.stringify(introTimer)}`);
    }
    await shot(intro.guest, "intro-no-timer.png");
  } finally {
    for (const page of opened) {
      try { await page._ctx.close(); } catch { /* ignore */ }
    }
    await browser.close();
    await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
