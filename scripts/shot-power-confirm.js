#!/usr/bin/env node
/**
 * Desktop + mobile screenshots of the power confirm modal.
 */
process.env.POWER_REVEAL_MS = "0";
process.env.SOLD_REVEAL_MS = "0";
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
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

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

async function waitFor(page, fn, label, timeoutMs = 12000, ...args) {
  try {
    await page.waitForFunction(fn, { timeout: timeoutMs }, ...args);
  } catch (err) {
    throw new Error(`timeout: ${label} (${err.message})`);
  }
}

async function openConfirm(page) {
  await waitFor(page, () => {
    const btn = document.getElementById("use-power");
    return Boolean(btn && !btn.disabled);
  }, "enabled power button");
  const clicked = await page.evaluate(() => {
    const btn = document.getElementById("use-power");
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
    const app = window.IplApp;
    if (!app || !app.openPowerConfirm) return false;
    return Boolean(app.openPowerConfirm());
  });
  if (!clicked) throw new Error("could not open confirm");
  await waitFor(page, () => {
    const el = document.getElementById("power-confirm");
    return Boolean(el && !el.hidden);
  }, "power confirm");
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { port, server } = await start(0);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", `--window-size=${DESKTOP.width},${DESKTOP.height}`],
  });
  try {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const other = await ctx.newPage();
    await page.setViewport({ ...DESKTOP, deviceScaleFactor: 1 });
    await other.setViewport({ ...DESKTOP, deviceScaleFactor: 1 });
    for (const p of [page, other]) {
      await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await waitFor(p, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket");
    }
    const created = await emit(page, "createRoom", { name: "Mitron", mode: "rapid" });
    if (!created.ok) throw new Error(`create: ${created.error}`);
    const code = created.code;
    await emit(page, "selectCharacter", { characterId: "narendra-modi", identityId: "narendra-modi" });
    const joined = await emit(other, "joinRoom", { name: "Dolly", code });
    if (!joined.ok) throw new Error(`join: ${joined.error}`);
    await emit(other, "selectCharacter", { characterId: "dolly-chaiwala", identityId: "dolly-chaiwala" });
    const started = await emit(page, "startAuction", {});
    if (!started.ok) throw new Error(`start: ${started.error}`);
    await waitFor(page, () => window.IplApp.state && window.IplApp.state.phase === "auction" && window.IplApp.state.auction, "auction");
    await sleep(300);

    await openConfirm(page);
    await sleep(200);
    const desk = path.join(OUT, "power-confirm.png");
    await page.screenshot({ path: desk, fullPage: false });
    console.log("wrote", desk);

    await page.evaluate(() => window.IplApp.closePowerConfirm());
    await page.setViewport({ ...MOBILE, deviceScaleFactor: 2 });
    await sleep(250);
    await openConfirm(page);
    await sleep(200);
    const mob = path.join(OUT, "power-confirm-mobile.png");
    await page.screenshot({ path: mob, fullPage: false });
    console.log("wrote", mob);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
