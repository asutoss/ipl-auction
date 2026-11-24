#!/usr/bin/env node
/**
 * Regenerate the Share results PNG and a 360px view of it.
 * Usage: node scripts/shot-share-results.js
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

const OUT = path.join(__dirname, "..", "screenshots");
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

async function waitFor(page, fn, label, timeoutMs = 15000) {
  try {
    await page.waitForFunction(fn, { timeout: timeoutMs });
  } catch (err) {
    throw new Error(`timeout: ${label} (${err.message})`);
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { port, server, manager } = await start(0);
  const origin = `http://127.0.0.1:${port}`;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=360,800"],
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

    const room = manager.get(code);
    const quota = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
    for (const name of NAMES) giveSquad(room, name, quota);
    room.findByName("Mitron").formPct = 108;
    room.findByName("Dolly").formPct = 96;
    room.findByName("Baahubali").formPct = 115;
    room.findByName("Ravi").formPct = 88;
    room.phase = "captains";
    room.finishCaptains();
    room.skipResultsReveal("Mitron");
    room.bump("results");

    await waitFor(host, () => Boolean(document.getElementById("share-results") && document.querySelector(".champion-hero")), "results ready", 15000);
    await sleep(400);

    const dataUrl = await host.evaluate(async () => {
      const payload = shareResultsPayload();
      payload.siteUrl = "https://ipl-auction-45i3.onrender.com";
      const canvas = await IplShareResults.draw(payload);
      return {
        dataUrl: canvas.toDataURL("image/png"),
        width: canvas.width,
        height: canvas.height,
        listed: (payload.positions || []).map((p) => p.position),
        champ: payload.champion && payload.champion.name,
      };
    });
    if (!dataUrl.listed || dataUrl.listed.includes(1)) {
      throw new Error("share payload still lists position 1: " + JSON.stringify(dataUrl.listed));
    }
    const buf = Buffer.from(dataUrl.dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
    const shareFile = path.join(OUT, "results-share.png");
    fs.writeFileSync(shareFile, buf);
    console.log("wrote", shareFile, buf.length, "bytes", dataUrl.width + "x" + dataUrl.height, "listed", dataUrl.listed, "champ", dataUrl.champ);

    const img = require("child_process");
    // Also write a tight 360 CSS-pixel (2x) view via the page, then resize if needed.
    await host.setContent(
      `<!doctype html><html><body style="margin:0;background:#07140f;">
        <img src="${dataUrl.dataUrl}" alt="Share results" style="width:360px;height:auto;display:block;">
      </body></html>`,
      { waitUntil: "load" }
    );
    const imgH = await host.evaluate(() => {
      const el = document.querySelector("img");
      return Math.max(1, Math.ceil((el && el.getBoundingClientRect().height) || 1) + 2);
    });
    await host.setViewport({ width: 360, height: Math.min(imgH, 1600), deviceScaleFactor: 2 });
    await sleep(200);
    const shareShot = path.join(OUT, "results-share-360.png");
    await host.screenshot({ path: shareShot, fullPage: true, timeout: 20000 });
    console.log("wrote", shareShot);
    void img;
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
