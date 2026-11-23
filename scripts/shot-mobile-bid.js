#!/usr/bin/env node
/**
 * Mobile bid-state and UI screenshots.
 * Usage: THEME_SHOT_SUFFIX=-before node scripts/shot-mobile-bid.js
 *        node scripts/shot-mobile-bid.js
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

const OUT = path.join(__dirname, "..", "screenshots");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const PHONE = { width: 390, height: 844 };
const SMALL = { width: 360, height: 740 };
const SUFFIX = process.env.THEME_SHOT_SUFFIX || "";

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

async function auctionState(page) {
  return page.evaluate(() => {
    const st = window.IplApp && window.IplApp.state;
    const a = st && st.auction;
    const you = st && st.you;
    if (!a) return null;
    return {
      you: you && you.name,
      leader: a.currentBidderName || a.currentBidderShort || null,
      isDefault: Boolean(a.isDefaultBidLeading),
      current: a.currentBidLakhs,
      minBid: a.minBidLakhs,
      youCanBid: Boolean(a.youCanBid),
    };
  });
}

async function shot(page, viewport, name) {
  await page.setViewport({ ...viewport, deviceScaleFactor: 2 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(280);
  const file = path.join(OUT, `${name}${SUFFIX}.png`);
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

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { port, server } = await start(0);
  const origin = `http://127.0.0.1:${port}`;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=390,844"],
  });
  try {
    const host = await openPage(browser, origin);
    const guest = await openPage(browser, origin);
    const created = await emit(host, "createRoom", { name: "Mitron", mode: "classical" });
    if (!created.ok) throw new Error(`create: ${created.error}`);
    const code = created.code;
    await emit(host, "selectCharacter", { characterId: "narendra-modi", identityId: "narendra-modi" });
    const joined = await emit(guest, "joinRoom", { name: "Dolly", code });
    if (!joined.ok) throw new Error(`join: ${joined.error}`);
    await emit(guest, "selectCharacter", { characterId: "dolly-chaiwala", identityId: "dolly-chaiwala" });
    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "lobby" && st.franchises && st.franchises.length >= 2);
    }, "lobby");
    await shot(host, PHONE, "mobile-ui-lobby");
    await shot(host, SMALL, "mobile-ui-lobby-360");

    const started = await emit(host, "startAuction", {});
    if (!started.ok) throw new Error(`start: ${started.error}`);
    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "auction" && st.auction && st.auction.nominee);
    }, "auction");
    await waitFor(guest, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "auction" && st.auction && st.auction.nominee);
    }, "guest auction");

    const hs = await auctionState(host);
    const gs = await auctionState(guest);
    console.log("start states", hs, gs);
    const follower = hs && hs.you === hs.leader ? guest : host;
    const leaderPage = follower === guest ? host : guest;
    await shot(follower, PHONE, "mobile-bid-none");
    await shot(follower, SMALL, "mobile-bid-none-360");
    await shot(leaderPage, PHONE, "mobile-ui-auction");

    const followState = await auctionState(follower);
    const amount = followState.minBid || (followState.current + 1);
    const bidRes = await emit(follower, "bid", { amountLakhs: amount });
    if (!bidRes.ok) throw new Error(`bid: ${bidRes.error}`);
    await waitFor(follower, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.auction && st.auction.currentBidderName === st.you.name && !st.auction.isDefaultBidLeading);
    }, "follower leads");
    await waitFor(leaderPage, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.auction && st.auction.currentBidderName && st.auction.currentBidderName !== st.you.name && !st.auction.isDefaultBidLeading);
    }, "original leader outbid");
    await sleep(200);
    await shot(follower, PHONE, "mobile-bid-leading");
    await shot(leaderPage, PHONE, "mobile-bid-outbid");
    await shot(leaderPage, SMALL, "mobile-bid-outbid-360");

    await host._ctx.close();
    await guest._ctx.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
