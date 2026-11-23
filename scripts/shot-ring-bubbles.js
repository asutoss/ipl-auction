#!/usr/bin/env node
/**
 * Ring seat-bubble screenshots.
 * Usage: THEME_SHOT_SUFFIX=-before node scripts/shot-ring-bubbles.js
 *        node scripts/shot-ring-bubbles.js
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
const BEFORE = SUFFIX === "-before";

const CAST = [
  { name: "Mitron", characterId: "narendra-modi" },
  { name: "Dolly", characterId: "dolly-chaiwala" },
  { name: "Prabhas", characterId: "prabhas" },
  { name: "Orry", characterId: "orry" },
  { name: "Big B", characterId: "amitabh-bachchan" },
  { name: "Jay", characterId: "jay-shah" },
];

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

async function shot(page, viewport, name) {
  await page.setViewport({ ...viewport, deviceScaleFactor: 2 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(320);
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

async function joinCast(browser, origin, code, members) {
  const pages = [];
  for (const m of members) {
    const page = await openPage(browser, origin);
    const joined = await emit(page, "joinRoom", { name: m.name, code });
    if (!joined.ok) throw new Error(`join ${m.name}: ${joined.error}`);
    await emit(page, "selectCharacter", { characterId: m.characterId, identityId: m.characterId });
    pages.push(page);
  }
  return pages;
}

async function waitAuction(pages) {
  for (const page of pages) {
    await waitFor(page, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "auction" && st.auction && st.auction.nominee);
    }, "auction");
  }
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
  const opened = [];
  try {
    const host = await openPage(browser, origin);
    opened.push(host);
    const created = await emit(host, "createRoom", { name: CAST[0].name, mode: "classical" });
    if (!created.ok) throw new Error(`create: ${created.error}`);
    const code = created.code;
    await emit(host, "selectCharacter", { characterId: CAST[0].characterId, identityId: CAST[0].characterId });

    const guest = (await joinCast(browser, origin, code, [CAST[1]]))[0];
    opened.push(guest);
    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "lobby" && st.franchises && st.franchises.length >= 2);
    }, "lobby 2");

    const started = await emit(host, "startAuction", {});
    if (!started.ok) throw new Error(`start: ${started.error}`);
    await waitAuction([host, guest]);

    if (BEFORE) {
      await shot(guest, PHONE, "ring-bubbles");
    } else {
      await shot(guest, PHONE, "ring-bubbles");
      await shot(guest, SMALL, "ring-bubbles-360");
    }

    await host._ctx.close();
    await guest._ctx.close();
    opened.length = 0;

    if (!BEFORE) {
      const host2 = await openPage(browser, origin);
      opened.push(host2);
      const created2 = await emit(host2, "createRoom", { name: CAST[0].name, mode: "classical" });
      if (!created2.ok) throw new Error(`create many: ${created2.error}`);
      await emit(host2, "selectCharacter", { characterId: CAST[0].characterId, identityId: CAST[0].characterId });
      const others = await joinCast(browser, origin, created2.code, CAST.slice(1));
      opened.push(...others);
      await waitFor(host2, () => {
        const st = window.IplApp && window.IplApp.state;
        return Boolean(st && st.phase === "lobby" && st.franchises && st.franchises.length >= 6);
      }, "lobby 6");
      const started2 = await emit(host2, "startAuction", {});
      if (!started2.ok) throw new Error(`start many: ${started2.error}`);
      await waitAuction([host2, ...others]);
      await shot(host2, PHONE, "ring-bubbles-many");
    }
  } finally {
    for (const p of opened) {
      try { await p._ctx.close(); } catch (_) {}
    }
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
