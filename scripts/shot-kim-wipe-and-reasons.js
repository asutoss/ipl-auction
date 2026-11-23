#!/usr/bin/env node
/**
 * Screenshots: Kim wipe fixed (victim squad) and disabled power reasons.
 * Usage: node scripts/shot-kim-wipe-and-reasons.js
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
const { loadPlayers } = require("../server/players");

const OUT = path.join(__dirname, "..", "screenshots");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const { players } = loadPlayers();

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

async function shotBoth(page, base, mobileScrollSel) {
  await page.setViewport({ ...DESKTOP, deviceScaleFactor: 1 });
  await sleep(300);
  const desk = path.join(OUT, `${base}.png`);
  await page.screenshot({ path: desk, fullPage: false, timeout: 20000 });
  console.log("wrote", desk);
  await page.setViewport({ ...MOBILE, deviceScaleFactor: 2 });
  if (mobileScrollSel) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.scrollIntoView({ block: "start" });
    }, mobileScrollSel);
  }
  await sleep(350);
  const mob = path.join(OUT, `${base}-mobile.png`);
  await page.screenshot({ path: mob, fullPage: false, timeout: 20000 });
  console.log("wrote", mob);
}

async function open(browser, port) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ ...DESKTOP, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await waitFor(page, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket");
  page._ctx = ctx;
  return page;
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
    // --- Disabled power reason: one power per lot ---
    {
      const a = await open(browser, port);
      const b = await open(browser, port);
      const created = await emit(a, "createRoom", { name: "Mitron", mode: "classical" });
      if (!created.ok) throw new Error(`create: ${created.error}`);
      const code = created.code;
      await emit(a, "selectCharacter", { characterId: "narendra-modi", identityId: "narendra-modi" });
      const joined = await emit(b, "joinRoom", { name: "Dolly", code });
      if (!joined.ok) throw new Error(`join: ${joined.error}`);
      await emit(b, "selectCharacter", { characterId: "dolly-chaiwala", identityId: "dolly-chaiwala" });
      const started = await emit(a, "startAuction", {});
      if (!started.ok) throw new Error(`start: ${started.error}`);
      await waitFor(a, () => window.IplApp.state && window.IplApp.state.phase === "auction" && window.IplApp.state.auction, "auction");
      const used = await emit(a, "usePower", {});
      if (!used.ok) throw new Error(`usePower: ${used.error}`);
      await waitFor(b, () => {
        const why = document.getElementById("power-why");
        return Boolean(why && !why.hidden && /one power per lot/i.test(why.textContent || ""));
      }, "disabled reason visible", 15000);
      await sleep(250);
      await shotBoth(b, "power-disabled-reason");
      await a._ctx.close();
      await b._ctx.close();
    }

    // --- Kim wipe: victim no longer shows the wiped player ---
    {
      const kim = await open(browser, port);
      const victim = await open(browser, port);
      const created = await emit(kim, "createRoom", { name: "Kim", mode: "classical" });
      if (!created.ok) throw new Error(`create kim: ${created.error}`);
      const code = created.code;
      await emit(kim, "selectCharacter", { characterId: "kim-jong-un", identityId: "kim-jong-un" });
      const joined = await emit(victim, "joinRoom", { name: "Ravi", code });
      if (!joined.ok) throw new Error(`join ravi: ${joined.error}`);
      await emit(victim, "selectCharacter", { characterId: "ravi-kishan", identityId: "ravi-kishan" });
      const started = await emit(kim, "startAuction", {});
      if (!started.ok) throw new Error(`start kim: ${started.error}`);
      await waitFor(kim, () => window.IplApp.state && window.IplApp.state.phase === "auction" && window.IplApp.state.auction, "kim auction");
      await waitFor(victim, () => window.IplApp.state && window.IplApp.state.you, "ravi state");

      const room = manager.get(code);
      if (!room) throw new Error("room missing");
      const used = new Set();
      const take = (role) => {
        const p = players.find((x) => x.role === role && !used.has(x.id));
        used.add(p.id);
        return p;
      };
      const given = [take("BAT"), take("WK"), take("AR")];
      const team = room.findByName("Ravi");
      for (const p of given) {
        team.squad.push({ player: p, priceLakhs: 8 });
        team.spentLakhs = (Number(team.spentLakhs) || 0) + 8;
        room.soldIds.add(p.id);
        room.soldLog.push({ player: p, priceLakhs: 8, buyerName: "Ravi" });
      }
      team.spentLakhs = 24;
      team.purseLakhs = (Number(team.purseLakhs) || 0) - 24;
      room.rng.int = () => 0;
      room.bump("auction");
      await waitFor(victim, () => (window.IplApp.state.you.squad || []).length === 3, "squad filled");

      const usedPower = await emit(kim, "usePower", {});
      if (!usedPower.ok) throw new Error(`kim power: ${usedPower.error}`);
      await waitFor(kim, () => {
        const st = window.IplApp.state;
        return Boolean(st && st.powerWait && st.powerWait.options && st.powerWait.options.length);
      }, "kim picker");
      const targetKey = await kim.evaluate(() => {
        const opt = (window.IplApp.state.powerWait.options || []).find((o) => o.name === "Ravi");
        return opt && opt.key;
      });
      const picked = await emit(kim, "pickPowerTarget", { targetKey });
      if (!picked.ok) throw new Error(`pick: ${picked.error}`);
      await waitFor(victim, () => {
        const squad = (window.IplApp.state.you && window.IplApp.state.you.squad) || [];
        const slots = document.getElementById("side-slots");
        return squad.length === 2 && Boolean(slots && slots.querySelectorAll("li, .slot, article, .squad-slot").length >= 1);
      }, "victim squad updated", 15000);
      await sleep(300);
      await shotBoth(victim, "kim-wipe-fixed", ".side");
      await kim._ctx.close();
      await victim._ctx.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
