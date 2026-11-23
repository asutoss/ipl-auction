#!/usr/bin/env node
/**
 * Screenshots: lobby share buttons, join-via-link form, and the game-done page.
 * Usage: node scripts/shot-share-links.js
 */
process.env.CREATE_LIMIT = "0";
process.env.ALLOW_TEST_TIMERS = "1";
process.env.PLAYER_INTRO_MS = "0";

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

async function waitFor(page, fn, label, timeoutMs = 15000, ...args) {
  try {
    await page.waitForFunction(fn, { timeout: timeoutMs }, ...args);
  } catch (err) {
    throw new Error(`timeout: ${label} (${err.message})`);
  }
}

async function shotBoth(page, base) {
  await page.setViewport({ ...DESKTOP, deviceScaleFactor: 1 });
  await sleep(280);
  const desk = path.join(OUT, `${base}.png`);
  await page.screenshot({ path: desk, fullPage: false, timeout: 20000 });
  console.log("wrote", desk);
  await page.setViewport({ ...MOBILE, deviceScaleFactor: 2 });
  await sleep(320);
  const mob = path.join(OUT, `${base}-mobile.png`);
  await page.screenshot({ path: mob, fullPage: false, timeout: 20000 });
  console.log("wrote", mob);
}

async function open(browser, origin, dest = "/") {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ ...DESKTOP, deviceScaleFactor: 1 });
  await page.goto(`${origin}${dest}`, { waitUntil: "domcontentloaded", timeout: 20000 });
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
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", `--window-size=${DESKTOP.width},${DESKTOP.height}`],
  });
  try {
    const host = await open(browser, origin, "/");
    const created = await emit(host, "createRoom", { name: "Mitron", mode: "classical" });
    if (!created.ok) throw new Error(`create: ${created.error}`);
    const code = created.code;
    await emit(host, "selectCharacter", { characterId: "narendra-modi", identityId: "narendra-modi" });
    await waitFor(host, () => {
      const codeEl = document.querySelector(".room-code");
      const wa = document.getElementById("share-whatsapp");
      const copy = document.getElementById("copy-link");
      return Boolean(codeEl && wa && copy && (codeEl.textContent || "").trim().length === 6);
    }, "lobby share");
    await sleep(200);
    await shotBoth(host, "share-lobby");

    const guest = await open(browser, origin, `/r/${code}`);
    await waitFor(guest, () => {
      const form = document.getElementById("join-link");
      const name = document.getElementById("name");
      const join = document.getElementById("join");
      const codeField = document.getElementById("code");
      return Boolean(form && name && join && !codeField && /join this room/i.test(form.textContent || ""));
    }, "join-link form");
    await sleep(200);
    await shotBoth(guest, "join-link");

    const ended = await emit(host, "endGame");
    if (!ended.ok) throw new Error(`endGame: ${ended.error}`);
    await guest.goto(`${origin}/r/${code}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await waitFor(guest, () => {
      const done = document.getElementById("game-done");
      const home = document.getElementById("go-home");
      return Boolean(done && home && /this game is done/i.test(done.textContent || ""));
    }, "game-done page");
    await sleep(200);
    await shotBoth(guest, "game-done");

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
