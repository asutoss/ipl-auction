#!/usr/bin/env node
/**
 * Play a game through to results, press End game, and capture the start page
 * at 360px. Also checks that a refresh stays on the start page.
 * Usage: node scripts/shot-end-game-home.js
 */
process.env.POWER_REVEAL_MS = "0";
process.env.SOLD_REVEAL_MS = "0";
process.env.LAST_TEAM_FILL_MS = "0";
process.env.PLAYER_INTRO_MS = "0";
process.env.FORM_BOOST_REVEAL_MS = "0";
process.env.RESULTS_REVEAL_STEP_MS = "0";
process.env.FINAL_MATCH_MS = "0";
process.env.AUTOFILL_REVEAL_MS = "0";
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

const OUT = path.join(__dirname, "..", "screenshots", "end-game-home.png");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const VIEW = { width: 360, height: 800 };
const { players } = loadPlayers();
const NAMES = ["Mitron", "Dolly", "Baahubali", "Ravi"];
const CHAR_IDS = ["narendra-modi", "dolly-chaiwala", "prabhas", "ravi-kishan"];

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
  return Promise.race([
    page.evaluate(
      (event, payload) =>
        new Promise((resolve) => {
          const sock = window.IplApp && window.IplApp.socket;
          if (!sock) return resolve({ ok: false, error: "no socket" });
          sock.emit(event, payload, (res) => resolve(res || { ok: true }));
        }),
      event,
      payload
    ),
    sleep(8000).then(() => ({ ok: false, error: `timeout emitting ${event}` })),
  ]);
}

async function waitFor(page, fn, label, timeoutMs = 15000) {
  try {
    await page.waitForFunction(fn, { timeout: timeoutMs });
  } catch (err) {
    throw new Error(`timeout: ${label} (${err.message})`);
  }
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const { port, server, manager } = await start(0);
  const origin = `http://127.0.0.1:${port}`;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=360,800"],
  });
  try {
    const hostCtx = await browser.createBrowserContext();
    const guestCtx = await browser.createBrowserContext();
    const pages = [];
    for (let i = 0; i < 4; i++) {
      const page = await (i === 0 ? hostCtx : guestCtx).newPage();
      await page.setViewport({ ...VIEW, deviceScaleFactor: 2 });
      await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await waitFor(page, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket " + i);
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
        formBoostRevealMs: 0,
        finalMatchMs: 0,
        autofillRevealMs: 0,
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

    const urlInGame = await host.evaluate(() => `${location.pathname}${location.search}`);
    if (urlInGame !== `/r/${code}`) throw new Error("expected room URL during the game, got " + urlInGame);

    const room = manager.get(code);
    const quota = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
    for (const name of NAMES) giveSquad(room, name, quota);
    room.phase = "captains";
    room.finishCaptains();
    room.skipResultsReveal("Mitron");
    room.bump("results");

    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "results" && document.getElementById("end-game"));
    }, "results with End game", 15000);
    await sleep(300);

    await host.evaluate(() => {
      const btn = document.getElementById("end-game");
      if (btn) btn.click();
    });
    await waitFor(host, () => Boolean(document.querySelector(".confirm-backdrop [data-ok]")), "confirm End game");
    await host.evaluate(() => {
      const ok = document.querySelector(".confirm-backdrop [data-ok]");
      if (ok) ok.click();
    });

    await waitFor(host, () => {
      const home = document.querySelector("section.home #create");
      const joinLink = document.getElementById("join-link");
      const done = document.getElementById("game-done");
      const path = `${location.pathname}${location.search}`;
      const session = (() => { try { return sessionStorage.getItem("ipl-auction-session"); } catch { return "err"; } })();
      return Boolean(home && !joinLink && !done && path === "/" && !session && window.IplApp && window.IplApp.stayOnHome && !window.IplApp.state);
    }, "start page after End game", 10000);
    await sleep(250);

    await host.setViewport({ ...VIEW, deviceScaleFactor: 2 });
    await host.screenshot({ path: OUT, fullPage: false, timeout: 20000 });
    console.log("wrote", OUT);

    await host.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
    await waitFor(host, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket after refresh");
    await sleep(400);
    const afterRefresh = await host.evaluate(() => ({
      path: `${location.pathname}${location.search}`,
      hasHome: Boolean(document.querySelector("section.home #create")),
      joinLink: Boolean(document.getElementById("join-link")),
      gameDone: Boolean(document.getElementById("game-done")),
      session: (() => { try { return sessionStorage.getItem("ipl-auction-session"); } catch { return "err"; } })(),
      statePhase: window.IplApp && window.IplApp.state && window.IplApp.state.phase,
    }));
    if (!afterRefresh.hasHome || afterRefresh.joinLink || afterRefresh.gameDone || afterRefresh.path !== "/" || afterRefresh.session || afterRefresh.statePhase) {
      throw new Error("refresh did not stay on the start page: " + JSON.stringify(afterRefresh));
    }
    console.log("refresh stayed on start page", afterRefresh);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
