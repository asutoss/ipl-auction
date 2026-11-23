#!/usr/bin/env node
/**
 * 360px screenshots of the live final, expanded scorecard, and champion hero.
 * Usage: node scripts/shot-final-match.js
 */
process.env.POWER_REVEAL_MS = "0";
process.env.SOLD_REVEAL_MS = "0";
process.env.LAST_TEAM_FILL_MS = "0";
process.env.PLAYER_INTRO_MS = "0";
process.env.RESULTS_REVEAL_STEP_MS = "0";
process.env.FINAL_MATCH_MS = "120000";
process.env.LOT_START_MS = "180000";
process.env.BID_TIMER_MS = "180000";
process.env.CAPTAIN_TIMER_MS = "180000";
process.env.ALLOW_TEST_TIMERS = "1";
process.env.CREATE_LIMIT = "0";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { start } = require("../server/index");
const { loadPlayers } = require("../server/players");

const OUT = path.join(__dirname, "..", "screenshots");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const VIEW = { width: 360, height: 800 };
const TALL = { width: 360, height: 960 };
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
  if (team.squad[0]) team.captainId = team.squad[0].player.id;
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
  await page.addStyleTag({ content: "#toast { display: none !important; }" });
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
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=360,960"],
  });
  try {
    const ctx = await browser.createBrowserContext();
    const pages = [];
    for (let i = 0; i < 4; i++) {
      const page = await ctx.newPage();
      await page.setViewport({ ...VIEW, deviceScaleFactor: 2 });
      await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await waitFor(page, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket");
      pages.push(page);
    }
    const host = pages[0];
    const created = await emit(host, "createRoom", {
      name: NAMES[0],
      mode: "classical",
      testTimers: {
        lotStartMs: 180000,
        bidMs: 180000,
        captainMs: 10,
        soldRevealMs: 0,
        lastTeamFillMs: 0,
        playerIntroMs: 0,
        resultsRevealStepMs: 0,
        finalMatchMs: 120000,
        formBoostRevealMs: 0,
      },
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
    room.phase = "captains";
    room.finishCaptains();

    const r = room.resultsReveal;
    if (!r || r.stage !== "final") {
      throw new Error(`expected final stage, got ${r && r.stage}`);
    }
    const dur = r.finalDurationMs || 120000;
    r.finalElapsedMs = 0;
    r.finalStartedAt = Date.now() - Math.round(dur * 0.22);
    room.emitResultsReveal();

    await host.waitForSelector("#final-live-body", { timeout: 20000 });
    await sleep(600);

    await shot(host, "final-live.png", VIEW, { scroll: ".final-panel", hideTopbar: true });

    await host.evaluate(() => {
      const btn = document.getElementById("final-scorecard-toggle");
      if (btn) btn.click();
    });
    await waitFor(host, () => {
      const card = document.getElementById("final-scorecard");
      return Boolean(card && !card.hidden && card.querySelector("table"));
    }, "scorecard open");
    await sleep(300);
    await shot(host, "final-scorecard.png", TALL, { scroll: ".final-panel", hideTopbar: true });

    const skipped = room.skipResultsReveal("Mitron");
    if (!skipped.ok) throw new Error(`skip: ${skipped.error}`);
    room.bump("results");
    await waitFor(host, () => Boolean(document.querySelector(".champion-hero")), "champion hero", 15000);
    await sleep(400);
    await shot(host, "final-champion.png", VIEW, { scroll: ".champion-hero", hideTopbar: true });
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
