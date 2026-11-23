#!/usr/bin/env node
/**
 * Bidding-screen headshot screenshots:
 *   headshot-bid.png         390x844, official image loaded
 *   headshot-placeholder.png initials/silhouette fallback
 *   headshot-slow.png        placeholders throughout on a simulated slow network
 *
 * Usage: node scripts/shot-headshots.js
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
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(360);
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false, timeout: 20000 });
  console.log("wrote", file);
}

async function openPage(browser, origin, hooks) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ ...PHONE, deviceScaleFactor: 2 });
  if (hooks && hooks.beforeGoto) await hooks.beforeGoto(page);
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await waitFor(page, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket");
  page._ctx = ctx;
  return page;
}

async function startAuctionOn(browser, origin, hooks) {
  const host = await openPage(browser, origin, hooks);
  const created = await emit(host, "createRoom", { name: "Mitron", mode: "classical" });
  if (!created.ok) throw new Error(`create: ${created.error}`);
  const code = created.code;
  await emit(host, "selectCharacter", { characterId: "narendra-modi", identityId: "narendra-modi" });
  const guest = await openPage(browser, origin, hooks);
  const joined = await emit(guest, "joinRoom", { name: "Dolly", code });
  if (!joined.ok) throw new Error(`join: ${joined.error}`);
  await emit(guest, "selectCharacter", { characterId: "dolly-chaiwala", identityId: "dolly-chaiwala" });
  await waitFor(host, () => {
    const st = window.IplApp && window.IplApp.state;
    return Boolean(st && st.phase === "lobby" && st.franchises && st.franchises.length >= 2);
  }, "lobby ready");
  const started = await emit(host, "startAuction", {});
  if (!started.ok) throw new Error(`start: ${started.error}`);
  for (const page of [host, guest]) {
    await waitFor(page, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "auction" && st.auction && st.auction.nominee && document.getElementById("auction-hub"));
    }, "auction hub");
  }
  return { host, guest, code };
}

function forceNominee(manager, code, player) {
  const room = manager.get(code);
  if (!room || !room.auction) throw new Error(`room ${code} is not in auction`);
  room.auction.nominee = clonePlayer(player);
  room.emitDelta({ type: "lotStart", ...room.packAuctionPublic() });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { port, server, manager } = await start(0);
  const origin = `http://127.0.0.1:${port}`;
  const kohliPlayer = loadPlayers().players.find((p) => p.id === "virat-kohli");
  if (!kohliPlayer || !kohliPlayer.headshot) throw new Error("Virat Kohli headshot missing from player data");
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=390,844"],
  });
  const opened = [];
  try {
    const first = await startAuctionOn(browser, origin);
    opened.push(first.host, first.guest);
    const page = first.guest;
    forceNominee(manager, first.code, kohliPlayer);
    await waitFor(
      page,
      () => {
        const st = window.IplApp && window.IplApp.state;
        const name = st && st.auction && st.auction.nominee && st.auction.nominee.name;
        const img = document.querySelector("#hub-headshot img");
        return Boolean(name === "Virat Kohli" && img && img.classList.contains("is-ready") && img.naturalWidth > 40);
      },
      "official Kohli headshot",
      15000
    );
    await shot(page, "headshot-bid.png");

    await page.evaluate(() => {
      const st = window.IplApp && window.IplApp.state;
      const p = st && st.auction && st.auction.nominee;
      const el = document.getElementById("hub-headshot");
      if (!p || !el || !window.IplHeadshot) throw new Error("no hub headshot");
      IplHeadshot.resetSession();
      IplHeadshot.mount(el, { ...p, headshot: null }, { id: "hub-headshot" });
    });
    await sleep(200);
    await shot(page, "headshot-placeholder.png");

    await first.host._ctx.close();
    await first.guest._ctx.close();
    opened.length = 0;

    const slowHooks = {
      async beforeGoto(page) {
        await page.evaluateOnNewDocument(() => {
          const conn = {
            effectiveType: "2g",
            saveData: false,
            downlink: 0.2,
            rtt: 1800,
            addEventListener() {},
            removeEventListener() {},
          };
          try {
            Object.defineProperty(navigator, "connection", { configurable: true, get: () => conn });
          } catch {
            navigator.connection = conn;
          }
        });
      },
    };
    const slow = await startAuctionOn(browser, origin, slowHooks);
    opened.push(slow.host, slow.guest);
    await waitFor(
      slow.guest,
      () => {
        const el = document.getElementById("hub-headshot");
        return Boolean(el && el.querySelector(".player-headshot-initials") && !el.querySelector("img"));
      },
      "slow-network placeholder"
    );
    await shot(slow.guest, "headshot-slow.png");
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
