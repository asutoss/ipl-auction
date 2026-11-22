#!/usr/bin/env node
/**
 * Take desktop + mobile screenshots of the unique-power UIs into screenshots/.
 * Starts a local server with long lot timers and a 0ms power reveal so wait
 * overlays are on screen immediately.
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
const { start, manager } = require("../server/index");

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

async function waitFor(page, fn, label, timeoutMs = 8000, ...args) {
  try {
    await page.waitForFunction(fn, { timeout: timeoutMs }, ...args);
  } catch (err) {
    throw new Error(`timeout: ${label} (${err.message})`);
  }
}

async function openPage(browser, size) {
  const page = await browser.newPage();
  await page.setViewport({ ...size, deviceScaleFactor: size.width < 500 ? 2 : 1 });
  return page;
}

async function gotoHome(page, port) {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await waitFor(page, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket connected", 15000);
}

async function setSize(page, size) {
  await page.setViewport({ ...size, deviceScaleFactor: size.width < 500 ? 2 : 1 });
  await sleep(150);
}

async function createRoom(page, name, mode = "rapid") {
  const res = await emit(page, "createRoom", { name, mode, purseLakhs: 100 });
  if (!res || !res.ok) throw new Error(`createRoom failed: ${res && res.error}`);
  await waitFor(page, () => !!(window.IplApp.state && window.IplApp.state.code), "room code");
  return page.evaluate(() => window.IplApp.state.code);
}

async function joinRoom(page, name, code) {
  const res = await emit(page, "joinRoom", { name, code });
  if (!res || !res.ok) throw new Error(`joinRoom ${name} failed: ${JSON.stringify(res)}`);
  await waitFor(page, (n) => window.IplApp.state && window.IplApp.state.you && window.IplApp.state.you.name === n, `joined ${name}`, 15000, name);
}

async function pickChar(page, id) {
  const res = await emit(page, "selectCharacter", { characterId: id, identityId: id });
  if (!res || !res.ok) throw new Error(`selectCharacter ${id}: ${res && res.error}`);
}

async function startAuction(page) {
  const res = await emit(page, "startAuction", {});
  if (!res || !res.ok) throw new Error(`startAuction: ${res && res.error}`);
  await waitFor(page, () => window.IplApp.state && window.IplApp.state.phase === "auction" && window.IplApp.state.auction, "auction started");
}

function roomBy(code) {
  return manager.get(code);
}

async function shot(page, file) {
  const dest = path.join(OUT, file);
  await sleep(200);
  await page.screenshot({ path: dest, fullPage: false });
  console.log("wrote", dest);
}

async function pair(browser, port) {
  const ctx = await browser.createBrowserContext();
  const deskA = await ctx.newPage();
  const deskB = await ctx.newPage();
  await deskA.setViewport({ ...DESKTOP, deviceScaleFactor: 1 });
  await deskB.setViewport({ ...DESKTOP, deviceScaleFactor: 1 });
  await gotoHome(deskA, port);
  await gotoHome(deskB, port);
  return { ctx, deskA, deskB };
}

async function closeAll(pages) {
  try { if (pages.ctx) await pages.ctx.close(); } catch (_) {}
}

async function setupTwo(pages, port, { aName, bName, aChar, bChar }) {
  const code = await createRoom(pages.deskA, aName);
  await pickChar(pages.deskA, aChar);
  await joinRoom(pages.deskB, bName, code);
  await pickChar(pages.deskB, bChar);
  await startAuction(pages.deskA);
  return code;
}

async function shotBoth(page, desktopName, mobileName) {
  await setSize(page, DESKTOP);
  await shot(page, desktopName);
  await setSize(page, MOBILE);
  await shot(page, mobileName);
  await setSize(page, DESKTOP);
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
    // Dolly chai table + quick chat for the other team
    {
      const pages = await pair(browser, port);
      const code = await setupTwo(pages, port, {
        aName: "Dolly",
        bName: "Ravi",
        aChar: "dolly-chaiwala",
        bChar: "ravi-kishan",
      });
      const res = await emit(pages.deskA, "usePower", {});
      if (!res.ok) throw new Error(`dolly power: ${res.error}`);
      await waitFor(pages.deskA, () => !!(window.IplApp.state && window.IplApp.state.powerWait && window.IplApp.state.powerWait.kind === "chai"), "chai wait");
      await waitFor(pages.deskB, () => document.querySelector("#wait-modal") && !document.querySelector("#wait-modal").hidden, "wait modal B");
      await shotBoth(pages.deskA, "power-dolly-table.png", "power-dolly-table-mobile.png");
      await pages.deskB.evaluate(() => {
        const btn = document.querySelector("[data-quick-chat='chai_break']");
        if (btn) btn.click();
      });
      await sleep(300);
      await shotBoth(pages.deskB, "power-chai-wait-quickchat.png", "power-chai-wait-quickchat-mobile.png");
      await closeAll(pages);
    }

    // Prabhas hidden card
    {
      const pages = await pair(browser, port);
      const code = await setupTwo(pages, port, {
        aName: "Prabhas",
        bName: "Ravi",
        aChar: "prabhas",
        bChar: "ravi-kishan",
      });
      const res = await emit(pages.deskA, "usePower", {});
      if (!res.ok) throw new Error(`vfx power: ${res.error}`);
      const room = roomBy(code);
      room.sellCurrent();
      await waitFor(pages.deskB, () => !!(window.IplApp.state && window.IplApp.state.auction && window.IplApp.state.auction.nominee && window.IplApp.state.auction.nominee.vfxHidden), "hidden nominee on B");
      await waitFor(pages.deskA, () => !!(window.IplApp.state && window.IplApp.state.auction && window.IplApp.state.auction.nominee && !window.IplApp.state.auction.nominee.vfxHidden), "real nominee on A");
      await shotBoth(pages.deskB, "power-prabhas-hidden.png", "power-prabhas-hidden-mobile.png");
      await shot(pages.deskA, "power-prabhas-seer.png");
      await closeAll(pages);
    }

    // Samay preview (with VFX reserved so first is ??? (VFX))
    {
      const pages = await pair(browser, port);
      const code = await setupTwo(pages, port, {
        aName: "Samay",
        bName: "Prabhas",
        aChar: "samay-raina",
        bChar: "prabhas",
      });
      const vfx = await emit(pages.deskB, "usePower", {});
      if (!vfx.ok) throw new Error(`vfx for samay: ${vfx.error}`);
      const peek = await emit(pages.deskA, "usePower", {});
      if (!peek.ok) throw new Error(`samay power: ${peek.error}`);
      const room = roomBy(code);
      console.log("server preview", room.findByName("Samay") && room.findByName("Samay").samayPreview);
      room.bump("shot");
      await sleep(800);
      const client = await pages.deskA.evaluate(() => {
        const s = window.IplApp.state;
        const box = document.querySelector("#samay-preview");
        return {
          preview: s && s.you && s.you.samayPreview,
          you: s && s.you && s.you.name,
          hidden: box ? box.hidden : "missing",
        };
      });
      console.log("client samay", JSON.stringify(client));
      if (!client.preview) throw new Error(`no client preview: ${JSON.stringify(client)}`);
      if (client.hidden) throw new Error(`samay panel hidden: ${JSON.stringify(client)}`);
      await shotBoth(pages.deskA, "power-samay-preview.png", "power-samay-preview-mobile.png");
      await closeAll(pages);
    }

    // Banned for match fixing
    {
      const pages = await pair(browser, port);
      const code = await createRoom(pages.deskA, "Modi");
      await pickChar(pages.deskA, "narendra-modi");
      await joinRoom(pages.deskB, "Ravi", code);
      await pickChar(pages.deskB, "ravi-kishan");
      const pageC = await pages.ctx.newPage();
      await pageC.setViewport({ ...DESKTOP, deviceScaleFactor: 1 });
      await gotoHome(pageC, port);
      await joinRoom(pageC, "Arnab", code);
      await pickChar(pageC, "arnab-goswami");
      await startAuction(pages.deskA);
      const room = roomBy(code);
      room.findByName("Arnab").purseLakhs = 6;
      const res = await emit(pages.deskA, "usePower", {});
      if (!res.ok) throw new Error(`modi power: ${res.error}`);
      await waitFor(pageC, () => !!(window.IplApp.state && window.IplApp.state.you && window.IplApp.state.you.banned), "arnab banned");
      await sleep(250);
      await shotBoth(pageC, "power-banned.png", "power-banned-mobile.png");
      await closeAll(pages);
    }

    // Salman picker
    {
      const pages = await pair(browser, port);
      const code = await setupTwo(pages, port, {
        aName: "Salman",
        bName: "Ravi",
        aChar: "salman-khan",
        bChar: "ravi-kishan",
      });
      const room = roomBy(code);
      const bat = room.allPlayers.find((p) => p.role === "BAT" && !room.soldIds.has(p.id));
      const ravi = room.findByName("Ravi");
      ravi.squad.push({ player: bat, priceLakhs: 8 });
      ravi.spentLakhs = 8;
      room.soldIds.add(bat.id);
      room.soldLog.push({ player: bat, priceLakhs: 8, buyerName: "Ravi", short: "Ravi" });
      const res = await emit(pages.deskA, "usePower", {});
      if (!res.ok) throw new Error(`salman power: ${res.error}`);
      await waitFor(pages.deskA, () => !!(window.IplApp.state && window.IplApp.state.powerWait && window.IplApp.state.powerWait.kind === "pick_player"), "kala hiran picker");
      await shotBoth(pages.deskA, "power-picker-salman.png", "power-picker-salman-mobile.png");
      await closeAll(pages);
    }

    // Kim picker
    {
      const pages = await pair(browser, port);
      const code = await setupTwo(pages, port, {
        aName: "Kim",
        bName: "Ravi",
        aChar: "kim-jong-un",
        bChar: "ravi-kishan",
      });
      const room = roomBy(code);
      const ravi = room.findByName("Ravi");
      const used = new Set();
      for (const role of ["BAT", "WK", "AR"]) {
        const p = room.allPlayers.find((x) => x.role === role && !used.has(x.id) && !room.soldIds.has(x.id));
        used.add(p.id);
        ravi.squad.push({ player: p, priceLakhs: 6 });
        room.soldIds.add(p.id);
        room.soldLog.push({ player: p, priceLakhs: 6, buyerName: "Ravi", short: "Ravi" });
      }
      ravi.spentLakhs = 18;
      const res = await emit(pages.deskA, "usePower", {});
      if (!res.ok) throw new Error(`kim power: ${res.error}`);
      await waitFor(pages.deskA, () => !!(window.IplApp.state && window.IplApp.state.powerWait && window.IplApp.state.powerWait.kind === "pick_team"), "kim picker");
      await shotBoth(pages.deskA, "power-picker-kim.png", "power-picker-kim-mobile.png");
      await closeAll(pages);
    }

    // Rakhi choice for a rival + Taylor swap picker
    {
      const pages = await pair(browser, port);
      const code = await setupTwo(pages, port, {
        aName: "Rakhi",
        bName: "Ravi",
        aChar: "rakhi-sawant",
        bChar: "ravi-kishan",
      });
      const res = await emit(pages.deskA, "usePower", {});
      if (!res.ok) throw new Error(`rakhi power: ${res.error}`);
      roomBy(code).bump("shot");
      await sleep(400);
      await waitFor(pages.deskB, () => !!(window.IplApp.state && window.IplApp.state.powerWait && window.IplApp.state.powerWait.youMustChoose), "rakhi choice", 15000);
      await shotBoth(pages.deskB, "power-rakhi-choice.png", "power-rakhi-choice-mobile.png");
      await closeAll(pages);
    }

    {
      const pages = await pair(browser, port);
      const code = await setupTwo(pages, port, {
        aName: "Taylor",
        bName: "Ravi",
        aChar: "taylor-swift",
        bChar: "ravi-kishan",
      });
      const room = roomBy(code);
      const used = new Set();
      const hers = room.allPlayers.find((p) => p.role === "BAT" && !used.has(p.id));
      used.add(hers.id);
      const theirs = room.allPlayers.find((p) => p.role === "BAT" && !used.has(p.id));
      const taylor = room.findByName("Taylor");
      const ravi = room.findByName("Ravi");
      taylor.squad.push({ player: hers, priceLakhs: 5 });
      ravi.squad.push({ player: theirs, priceLakhs: 9 });
      room.soldIds.add(hers.id);
      room.soldIds.add(theirs.id);
      room.soldLog.push({ player: theirs, priceLakhs: 9, buyerName: "Ravi", short: "Ravi" });
      const res = await emit(pages.deskA, "usePower", {});
      if (!res.ok) throw new Error(`taylor power: ${res.error}`);
      await waitFor(pages.deskA, () => !!(window.IplApp.state && window.IplApp.state.powerWait && window.IplApp.state.powerWait.kind === "pick_swap"), "taylor picker");
      await shotBoth(pages.deskA, "power-picker-taylor.png", "power-picker-taylor-mobile.png");
      await closeAll(pages);
    }

    console.log("all screenshots done");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
