#!/usr/bin/env node
/**
 * Desktop + mobile screenshots of the character-line emote picker
 * with a few character-line floats mid-flight.
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
const { characterLines } = require("../public/characters");

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

async function openPicker(page) {
  await page.evaluate(() => {
    const app = window.IplApp;
    if (app && app.syncEmoteDock) app.syncEmoteDock();
    const btn = document.getElementById("emote-btn");
    if (!btn) throw new Error("emote button missing");
    const pop = document.getElementById("emote-popover");
    if (pop && pop.hidden) btn.click();
    const again = document.getElementById("emote-popover");
    if (!again || again.hidden) throw new Error("picker did not open");
  });
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

    const modiLines = characterLines("narendra-modi");
    const dollyLines = characterLines("dolly-chaiwala");

    const burst = async (target) => {
      await target.evaluate((modi, dolly) => {
        const show = window.IplApp && window.IplApp.showEmote;
        if (!show) throw new Error("showEmote missing");
        const pack = [
          { teamId: "mitron", emoteId: modi[0].id, text: modi[0].text },
          { teamId: "dolly", emoteId: "laugh" },
          { teamId: "mitron", emoteId: modi[1].id, text: modi[1].text },
          { teamId: "dolly", emoteId: dolly[0].id, text: dolly[0].text },
          { teamId: "mitron", emoteId: modi[2].id, text: modi[2].text },
          { teamId: "dolly", emoteId: "fire" },
          { teamId: "mitron", emoteId: modi[3].id, text: modi[3].text },
          { teamId: "dolly", emoteId: dolly[1].id, text: dolly[1].text },
        ];
        pack.forEach((item, i) => {
          setTimeout(() => show(item), i * 70);
        });
      }, modiLines, dollyLines);
    };

    await openPicker(page);
    await burst(page);
    await sleep(900);
    await page.screenshot({ path: path.join(OUT, "quickchat-character.png"), fullPage: false });
    console.log("wrote", path.join(OUT, "quickchat-character.png"));

    await page.setViewport({ ...MOBILE, deviceScaleFactor: 2 });
    await sleep(250);
    await openPicker(page);
    await burst(page);
    await sleep(900);
    await page.screenshot({ path: path.join(OUT, "quickchat-character-mobile.png"), fullPage: false });
    console.log("wrote", path.join(OUT, "quickchat-character-mobile.png"));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
