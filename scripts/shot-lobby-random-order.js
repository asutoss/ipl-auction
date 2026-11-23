#!/usr/bin/env node
/**
 * 360px lobby screenshot of the per-room shuffled co-owner list.
 * Usage: node scripts/shot-lobby-random-order.js
 */
process.env.CREATE_LIMIT = "0";
process.env.ALLOW_TEST_TIMERS = "1";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { start } = require("../server/index");

const OUT = path.join(__dirname, "..", "screenshots", "lobby-random-order.png");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const VIEW = { width: 360, height: 800 };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function emit(page, event, payload = {}) {
  return page.evaluate(
    (event, payload) =>
      new Promise((resolve) => {
        const sock = window.IplApp && window.IplApp.socket;
        if (!sock) return resolve({ ok: false, error: "no socket" });
        const t = setTimeout(() => resolve({ ok: false, error: "emit timeout" }), 10000);
        sock.emit(event, payload, (res) => {
          clearTimeout(t);
          resolve(res || { ok: true });
        });
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

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const { port, server } = await start(0);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--headless=new"],
    timeout: 20000,
  });
  try {
    const host = await browser.newPage();
    const guest = await browser.newPage();
    await host.setViewport({ ...VIEW, deviceScaleFactor: 2 });
    await guest.setViewport({ ...VIEW, deviceScaleFactor: 2 });
    const origin = `http://127.0.0.1:${port}/`;
    for (const p of [host, guest]) {
      await p.goto(origin, { waitUntil: "domcontentloaded", timeout: 20000 });
      await waitFor(p, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket");
    }
    const created = await emit(host, "createRoom", { name: "Ashutosh", mode: "bullet" });
    if (!created.ok) throw new Error(`create: ${created.error}`);
    const code = created.code;
    await emit(host, "selectCharacter", { characterId: "narendra-modi", identityId: "narendra-modi" });
    const joined = await emit(guest, "joinRoom", { name: "Priya", code });
    if (!joined.ok) throw new Error(`join: ${joined.error}`);
    await emit(guest, "selectCharacter", { characterId: "dolly-chaiwala", identityId: "dolly-chaiwala" });
    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      const picker = document.querySelector(".character-picker");
      const buttons = picker ? picker.querySelectorAll(".character-choice") : [];
      return Boolean(st && st.phase === "lobby" && st.franchises && st.franchises.length >= 2 && buttons.length >= 15);
    }, "lobby picker ready");
    await host.evaluate(() => {
      const el = document.getElementById("choose-character");
      if (el) el.scrollIntoView({ block: "start" });
    });
    await sleep(400);
    await host.screenshot({ path: OUT, fullPage: true, timeout: 20000 });
    console.log("wrote", OUT);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
