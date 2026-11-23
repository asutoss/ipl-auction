#!/usr/bin/env node
/**
 * Mobile screenshots of the post-selection captain bonus on the live board
 * and the results team sheet.
 * Usage: node scripts/shot-captain-bonus.js
 */
process.env.POWER_REVEAL_MS = "0";
process.env.SOLD_REVEAL_MS = "0";
process.env.LAST_TEAM_FILL_MS = "0";
process.env.PLAYER_INTRO_MS = "0";
process.env.RESULTS_REVEAL_STEP_MS = "120000";
process.env.LOT_START_MS = "180000";
process.env.BID_TIMER_MS = "180000";
process.env.CAPTAIN_TIMER_MS = "90000";
process.env.FORM_BOOST_REVEAL_MS = "0";
process.env.ALLOW_TEST_TIMERS = "1";
process.env.CREATE_LIMIT = "0";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { start } = require("../server/index");
const { loadPlayers } = require("../server/players");

const OUT = path.join(__dirname, "..", "screenshots");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const PHONE_NARROW = { width: 360, height: 800 };
const { players } = loadPlayers();
const CHAR_IDS = ["narendra-modi", "dolly-chaiwala", "prabhas", "ravi-kishan"];
const NAMES = ["Mitron", "Dolly", "Baahubali", "Ravi"];

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
  team.captainId = null;
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

async function shot(page, name, viewport, opts = {}) {
  await page.setViewport({ ...viewport, deviceScaleFactor: 2 });
  await sleep(200);
  if (opts.hideTopbar) {
    await page.addStyleTag({ content: ".topbar { display: none !important; }" });
  }
  await page.evaluate((sel) => {
    if (sel) {
      const el = document.querySelector(sel);
      if (el) {
        el.scrollIntoView({ block: "start", inline: "nearest" });
        const top = el.getBoundingClientRect().top + (window.scrollY || document.documentElement.scrollTop || 0);
        window.scrollTo(0, Math.max(0, top - 8));
        document.documentElement.scrollTop = Math.max(0, top - 8);
        document.body.scrollTop = Math.max(0, top - 8);
        return;
      }
    }
    window.scrollTo(0, 0);
  }, opts.scroll || null);
  await sleep(400);
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false, timeout: 20000 });
  console.log("wrote", file);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { port, server, manager } = await start(0);
  const origin = `http://127.0.0.1:${port}`;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=360,800"],
  });
  try {
    const ctx = await browser.createBrowserContext();
    const pages = [];
    for (let i = 0; i < 4; i++) {
      const page = await ctx.newPage();
      await page.setViewport({ ...PHONE_NARROW, deviceScaleFactor: 2 });
      await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await waitFor(page, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket");
      pages.push(page);
    }
    const host = pages[0];
    const created = await emit(host, "createRoom", {
      name: NAMES[0],
      mode: "classical",
      testTimers: { captainMs: 90000, formBoostRevealMs: 0, playerIntroMs: 0, soldRevealMs: 0, resultsRevealStepMs: 120000 },
    });
    if (!created.ok) throw new Error(`create: ${created.error}`);
    const code = created.code;
    await emit(host, "selectCharacter", { characterId: CHAR_IDS[0], identityId: CHAR_IDS[0] });
    for (let i = 1; i < 4; i++) {
      const joined = await emit(pages[i], "joinRoom", { name: NAMES[i], code });
      if (!joined.ok) throw new Error(`join ${NAMES[i]}: ${joined.error}`);
      await emit(pages[i], "selectCharacter", { characterId: CHAR_IDS[i], identityId: CHAR_IDS[i] });
    }
    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "lobby" && st.franchises && st.franchises.length >= 4);
    }, "lobby ready");

    const room = manager.get(code);
    const quota = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
    for (const name of NAMES) giveSquad(room, name, quota);
    room.findByName("Mitron").formPct = 108;
    room.findByName("Dolly").formPct = 96;
    room.findByName("Baahubali").formPct = 115;
    room.findByName("Ravi").formPct = 88;
    const mitron = room.findByName("Mitron");
    if (!mitron.squad.some((s) => s.player.id === "virat-kohli")) {
      throw new Error("expected Mitron to be dealt Virat Kohli");
    }
    room.beginCaptainPhase();
    room.bump("captains");
    await sleep(800);
    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      const text = (document.getElementById("prep-screen") && document.getElementById("prep-screen").innerText) || "";
      return Boolean(st && st.phase === "captains" && document.getElementById("prep-screen") && /Choose your captain/.test(text) && !/Virat Kohli · \+4\.9%/.test(text));
    }, "prep board before pick");

    const picked = await emit(host, "selectCaptain", { playerId: "virat-kohli" });
    if (!picked.ok) throw new Error(`selectCaptain: ${picked.error}`);
    await waitFor(host, () => {
      const card = document.querySelector('[data-prep-team="Mitron"]');
      const text = ((card && card.innerText) || "") + ((document.getElementById("prep-screen") && document.getElementById("prep-screen").innerText) || "");
      return Boolean(card && /Virat Kohli · \+4\.9%/.test(text) && !/143 IPL matches as captain/.test(text) && !/captain bonus/.test(text));
    }, "kohli bonus revealed");

    await host.evaluate(() => {
      const card = document.querySelector('[data-prep-team="Mitron"]');
      if (card) card.click();
    });
    await waitFor(host, () => {
      const card = document.querySelector('[data-prep-team="Mitron"].is-open');
      const text = card ? card.innerText : "";
      return Boolean(card && /Virat Kohli · \+4\.9%/.test(text) && !/bat 93/.test(text) && !/captain bonus/.test(text));
    }, "mitron card expanded");
    await sleep(300);
    await shot(host, "captain-bonus-reveal.png", PHONE_NARROW, { scroll: '[data-prep-team="Mitron"]', hideTopbar: true });

    room.finishCaptains();
    room.bump("results");
    const skipped = room.skipResultsReveal("Mitron");
    if (!skipped.ok) throw new Error(`skip: ${skipped.error}`);
    room.bump("results");
    await sleep(500);
    await waitFor(host, () => {
      const list = document.getElementById("results-reveal-list");
      const cards = list ? list.querySelectorAll(".result-card").length : 0;
      return cards >= 4;
    }, "standings revealed", 20000);
    await host.evaluate(() => window.IplApp && IplApp.openResultsTeamSheet("Mitron"));
    await waitFor(host, () => {
      const modal = document.getElementById("results-team-sheet");
      const text = modal ? modal.innerText : "";
      return Boolean(modal && !modal.hidden && /Virat Kohli · \+4\.9%/.test(text) && !/captain bonus/.test(text) && !/IPL matches as captain/.test(text));
    }, "sheet shows captain bonus");
    try {
      await waitFor(host, () => {
        const img = document.querySelector("#results-team-sheet img.is-ready");
        return Boolean(img && img.naturalWidth > 20);
      }, "sheet headshot", 4000);
    } catch {
      console.warn("sheet headshot did not load in time");
    }
    await sleep(300);
    await shot(host, "captain-bonus-sheet.png", PHONE_NARROW, { hideTopbar: true });
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
