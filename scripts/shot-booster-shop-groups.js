#!/usr/bin/env node
/**
 * 360px booster shop with buyable (gold) and unbuyable (muted compact) groups.
 * Usage: node scripts/shot-booster-shop-groups.js
 */
process.env.POWER_REVEAL_MS = "0";
process.env.SOLD_REVEAL_MS = "0";
process.env.LAST_TEAM_FILL_MS = "0";
process.env.PLAYER_INTRO_MS = "0";
process.env.RESULTS_REVEAL_STEP_MS = "120000";
process.env.LOT_START_MS = "180000";
process.env.BID_TIMER_MS = "180000";
process.env.CAPTAIN_TIMER_MS = "90000";
process.env.ALLOW_TEST_TIMERS = "1";
process.env.CREATE_LIMIT = "0";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { start } = require("../server/index");
const { loadPlayers } = require("../server/players");

const OUT = path.join(__dirname, "..", "screenshots", "booster-shop-groups.png");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const VIEW = { width: 360, height: 1280 };
const { players } = loadPlayers();

function log(m) { console.log(m); try { process.stdout.write(""); } catch (e) {} }

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function giveSquad(room, name) {
  const team = room.findByName(name);
  const left = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
  for (const p of players) {
    if ((left[p.role] || 0) > 0 && !room.soldIds.has(p.id)) {
      team.squad.push({ player: p, priceLakhs: 2 });
      room.soldIds.add(p.id);
      left[p.role] -= 1;
    }
  }
  if (team.squad[0]) team.captainId = team.squad[0].player.id;
  team.purseLakhs = 15;
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
  const { port, server, manager } = await start(0);
  log("server " + port);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--headless=new"],
    timeout: 20000,
  });
  log("chrome");
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
    log("pages in");
    const created = await emit(host, "createRoom", {
      name: "Ashutosh",
      mode: "classical",
      testTimers: { captainMs: 90000, playerIntroMs: 0, soldRevealMs: 0 },
    });
    if (!created.ok) throw new Error(`create: ${created.error}`);
    await emit(host, "selectCharacter", { characterId: "narendra-modi", identityId: "narendra-modi" });
    const joined = await emit(guest, "joinRoom", { name: "Priya", code: created.code });
    if (!joined.ok) throw new Error(`join: ${joined.error}`);
    await emit(guest, "selectCharacter", { characterId: "dolly-chaiwala", identityId: "dolly-chaiwala" });
    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "lobby" && st.franchises && st.franchises.length >= 2);
    }, "lobby ready");
    log("lobby ready");

    const room = manager.get(created.code);
    if (!room) throw new Error("room missing");
    giveSquad(room, "Ashutosh");
    giveSquad(room, "Priya");
    room.beginCaptainPhase();
    await sleep(800);
    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      const buyable = document.querySelectorAll("#prep-shop .booster.is-buyable").length;
      const locked = document.querySelectorAll("#prep-shop .booster.is-unbuyable").length;
      return Boolean(st && st.phase === "captains" && buyable >= 2 && locked >= 2);
    }, "shop groups ready", 20000);
    log("shop ready");

    await host.addStyleTag({
      content: ".topbar, .prep-timer-bar, .prep-ticker, .prep-board, .prep-you, #curse-picker, #toast { display: none !important; }",
    });
    await host.evaluate(() => window.scrollTo(0, 0));
    await sleep(400);
    log("capturing");
    await host.screenshot({ path: OUT, fullPage: false, timeout: 20000 });
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
