#!/usr/bin/env node
/**
 * Desktop + mobile screenshots of team form on auction cards.
 * Usage: node scripts/shot-team-form.js
 */
process.env.POWER_REVEAL_MS = "0";
process.env.SOLD_REVEAL_MS = "0";
process.env.LAST_TEAM_FILL_MS = "0";
process.env.LOT_START_MS = "180000";
process.env.BID_TIMER_MS = "180000";
process.env.ALLOW_TEST_TIMERS = "1";
process.env.CREATE_LIMIT = "0";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { start } = require("../server/index");
const { loadPlayers } = require("../server/players");

const OUT = path.join(__dirname, "..", "screenshots");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const { players } = loadPlayers();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function giveSquad(room, name, need, price = 2) {
  const team = room.findByName(name);
  const left = { ...need };
  for (const p of players) {
    if ((left[p.role] || 0) > 0 && !room.soldIds.has(p.id)) {
      team.squad.push({ player: p, priceLakhs: price });
      room.soldIds.add(p.id);
      left[p.role] -= 1;
    }
  }
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

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { port, server, manager } = await start(0);
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
    await waitFor(page, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "lobby" && st.franchises && st.franchises.length >= 2);
    }, "lobby ready");

    const started = await emit(page, "startAuction", {});
    if (!started.ok) throw new Error(`start: ${started.error}`);
    await waitFor(page, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "auction" && st.auction);
    }, "auction started");

    const room = manager.get(code);
    if (!room) throw new Error("room missing");
    giveSquad(room, "Mitron", { BAT: 2, WK: 1, BOWL: 2 });
    giveSquad(room, "Dolly", { BAT: 1 });
    room.findByName("Mitron").formPct = 108;
    room.findByName("Dolly").formPct = null;
    room.bump("auction");

    await waitFor(page, () => {
      const strip = document.getElementById("team-strip");
      const lede = document.getElementById("side-lede");
      const html = `${strip ? strip.innerHTML : ""} ${lede ? lede.innerHTML : ""}`;
      return html.includes("Form 108%") && html.includes("is-hot");
    }, "form visible", 15000);
    await sleep(200);
    await sleep(400);

    const desk = path.join(OUT, "team-form.png");
    await page.screenshot({ path: desk, fullPage: false, timeout: 20000 });
    console.log("wrote", desk);

    await page.setViewport({ ...MOBILE, deviceScaleFactor: 2 });
    await sleep(400);
    const mob = path.join(OUT, "team-form-mobile.png");
    await page.screenshot({ path: mob, fullPage: false, timeout: 20000 });
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
