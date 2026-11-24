#!/usr/bin/env node
/**
 * 360px shots for t158u: auto-fill sold card, results + Share button,
 * generated share image, and Final mid-chase with both scores.
 * Usage: node scripts/shot-t158.js
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
const TALL = { width: 360, height: 960 };
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

async function hideChrome(page) {
  await page.addStyleTag({ content: "#toast, .topbar, #emote-btn, .emote-dock, #emote-popover { display: none !important; }" });
}

async function shot(page, name, viewport, opts = {}) {
  await page.setViewport({ ...viewport, deviceScaleFactor: 2 });
  await hideChrome(page);
  await sleep(200);
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
  return file;
}

async function openPage(browser, origin) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ ...VIEW, deviceScaleFactor: 2 });
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await waitFor(page, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket");
  return { ctx, page };
}

const TIMERS = {
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
};

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
    // --- 1. Auto-fill sold card (Rapid last-team fill) ---
    {
      const { ctx, page } = await openPage(browser, origin);
      const otherPage = await ctx.newPage();
      await otherPage.setViewport({ ...VIEW, deviceScaleFactor: 2 });
      await otherPage.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await waitFor(otherPage, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket");

      const created = await emit(page, "createRoom", {
        name: "Mitron",
        mode: "rapid",
        testTimers: { ...TIMERS, autofillRevealMs: 60000 },
      });
      if (!created.ok) throw new Error(`create autofill: ${created.error}`);
      const code = created.code;
      await emit(page, "selectCharacter", { characterId: "narendra-modi", identityId: "narendra-modi" });
      const joined = await emit(otherPage, "joinRoom", { name: "Dolly", code });
      if (!joined.ok) throw new Error(`join: ${joined.error}`);
      await emit(otherPage, "selectCharacter", { characterId: "dolly-chaiwala", identityId: "dolly-chaiwala" });
      await waitFor(page, () => {
        const st = window.IplApp && window.IplApp.state;
        return Boolean(st && st.phase === "lobby" && st.franchises && st.franchises.length >= 2);
      }, "lobby ready");
      const started = await emit(page, "startAuction", {});
      if (!started.ok) throw new Error(`start: ${started.error}`);
      await waitFor(page, () => {
        const st = window.IplApp && window.IplApp.state;
        return Boolean(st && st.phase === "auction");
      }, "auction started");

      const room = manager.get(code);
      room.clearTimer();
      room.auction = null;
      room.playerIntro = null;
      room.soldIds = new Set();
      room.soldLog = [];
      room.unsold = [];
      room.retiredIds = room.retiredIds || new Set();
      for (const f of room.franchises) {
        f.squad = [];
        f.spentLakhs = 0;
        f.purseLakhs = room.mode.purse;
        f.formPct = null;
        f.captainId = null;
      }
      room.timers.autofillRevealMs = 60000;
      giveSquad(room, "Dolly", { BAT: 2, WK: 1, BOWL: 2 });
      giveSquad(room, "Mitron", { BAT: 2 });
      const wk = players.find((p) => p.role === "WK" && !room.soldIds.has(p.id));
      const bowls = players.filter((p) => p.role === "BOWL" && !room.soldIds.has(p.id)).slice(0, 2);
      if (!wk || bowls.length < 2) throw new Error("not enough leftover players");
      room.queue = [wk, ...bowls];
      room.unsold = [];
      room.phase = "auction";
      room.bump("auction");
      room.nominateNext();
      await page.waitForSelector("#sold-modal", { timeout: 15000 });
      await waitFor(page, () => {
        const modal = document.getElementById("sold-modal");
        const st = window.IplApp && window.IplApp.state;
        const visible = modal && modal.hidden === false && (modal.classList.contains("is-in") || modal.getAttribute("hidden") == null);
        return Boolean(visible && st && st.lastEvent && st.lastEvent.type === "sold" && st.lastEvent.auto);
      }, "auto-fill sold card", 15000);
      await sleep(400);
      await shot(page, "autofill-sold.png", VIEW);
      await ctx.close();
    }

    // --- 2+3. Results page with Share button, plus generated share PNG ---
    {
      const NAMES = ["Mitron", "Dolly", "Baahubali", "Ravi"];
      const CHAR_IDS = ["narendra-modi", "dolly-chaiwala", "prabhas", "ravi-kishan"];
      const { ctx, page } = await openPage(browser, origin);
      const extras = [];
      for (let i = 0; i < 3; i++) {
        const p = await ctx.newPage();
        await p.setViewport({ ...VIEW, deviceScaleFactor: 2 });
        await p.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
        await waitFor(p, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket");
        extras.push(p);
      }
      const created = await emit(page, "createRoom", {
        name: NAMES[0],
        mode: "classical",
        testTimers: { ...TIMERS, finalMatchMs: 0, resultsRevealStepMs: 0 },
      });
      if (!created.ok) throw new Error(`create results: ${created.error}`);
      const code = created.code;
      await emit(page, "selectCharacter", { characterId: CHAR_IDS[0], identityId: CHAR_IDS[0] });
      for (let i = 0; i < 3; i++) {
        const joined = await emit(extras[i], "joinRoom", { name: NAMES[i + 1], code });
        if (!joined.ok) throw new Error(`join ${NAMES[i + 1]}: ${joined.error}`);
        await emit(extras[i], "selectCharacter", { characterId: CHAR_IDS[i + 1], identityId: CHAR_IDS[i + 1] });
      }
      await waitFor(page, () => {
        const st = window.IplApp && window.IplApp.state;
        return Boolean(st && st.phase === "lobby" && st.franchises && st.franchises.length >= 4);
      }, "results lobby");

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

      await waitFor(page, () => Boolean(document.getElementById("share-results") && document.querySelector(".champion-hero")), "share button", 15000);
      await sleep(400);
      await shot(page, "results-share-button.png", TALL, { scroll: ".results" });

      const dataUrl = await page.evaluate(async () => {
        const payload = window.shareResultsPayload
          ? shareResultsPayload()
          : (function () {
              const t = (window.IplApp.state && window.IplApp.state.tournament) || {};
              return {
                positions: t.positions || [],
                champion: (t.positions || [])[0],
                modeName: window.IplApp.state.mode && window.IplApp.state.mode.summary,
                roomCode: window.IplApp.state.code,
                siteUrl: location.origin,
              };
            })();
        payload.siteUrl = "https://ipl-auction-45i3.onrender.com";
        const canvas = await IplShareResults.draw(payload);
        return canvas.toDataURL("image/png");
      });
      const buf = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
      const shareFile = path.join(OUT, "results-share.png");
      fs.writeFileSync(shareFile, buf);
      console.log("wrote", shareFile, buf.length, "bytes");

      await page.setContent(
        `<!doctype html><html><body style="margin:0;background:#07140f;display:flex;justify-content:center;">
          <img src="${dataUrl}" alt="Share results" style="width:360px;height:auto;display:block;">
        </body></html>`,
        { waitUntil: "load" }
      );
      await page.setViewport({ width: 360, height: 800, deviceScaleFactor: 2 });
      await sleep(200);
      const imgH = await page.evaluate(() => {
        const img = document.querySelector("img");
        return Math.max(1, Math.ceil((img && img.getBoundingClientRect().height) || 1) + 2);
      });
      await page.setViewport({ width: 360, height: Math.min(Math.max(imgH, 1), 1400), deviceScaleFactor: 2 });
      await sleep(200);
      const shareShot = path.join(OUT, "results-share-360.png");
      await page.screenshot({ path: shareShot, fullPage: true, timeout: 20000 });
      console.log("wrote", shareShot);
      await ctx.close();
    }

    // --- 4. Final mid-chase with both scores ---
    {
      const NAMES = ["Mitron", "Dolly", "Baahubali", "Ravi"];
      const CHAR_IDS = ["narendra-modi", "dolly-chaiwala", "prabhas", "ravi-kishan"];
      const { ctx, page } = await openPage(browser, origin);
      const extras = [];
      for (let i = 0; i < 3; i++) {
        const p = await ctx.newPage();
        await p.setViewport({ ...VIEW, deviceScaleFactor: 2 });
        await p.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
        await waitFor(p, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket");
        extras.push(p);
      }
      const created = await emit(page, "createRoom", {
        name: NAMES[0],
        mode: "classical",
        testTimers: { ...TIMERS, finalMatchMs: 60000, resultsRevealStepMs: 0 },
      });
      if (!created.ok) throw new Error(`create final: ${created.error}`);
      const code = created.code;
      await emit(page, "selectCharacter", { characterId: CHAR_IDS[0], identityId: CHAR_IDS[0] });
      for (let i = 0; i < 3; i++) {
        const joined = await emit(extras[i], "joinRoom", { name: NAMES[i + 1], code });
        if (!joined.ok) throw new Error(`join ${NAMES[i + 1]}: ${joined.error}`);
        await emit(extras[i], "selectCharacter", { characterId: CHAR_IDS[i + 1], identityId: CHAR_IDS[i + 1] });
      }
      await waitFor(page, () => {
        const st = window.IplApp && window.IplApp.state;
        return Boolean(st && st.phase === "lobby" && st.franchises && st.franchises.length >= 4);
      }, "final lobby");

      const room = manager.get(code);
      const quota = { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
      for (const name of NAMES) giveSquad(room, name, quota);
      room.phase = "captains";
      room.finishCaptains();
      const r = room.resultsReveal;
      if (!r || r.stage !== "final") throw new Error(`expected final, got ${r && r.stage}`);
      const packed = room.packResultsReveal();
      const tl = packed.final;
      const inn1 = ((tl.innings[0] && tl.innings[0].deliveries) || []).length;
      const inn2 = ((tl.innings[1] && tl.innings[1].deliveries) || []).length;
      const midUnit = 1 + inn1 + 1 + Math.max(1, Math.floor(inn2 / 2));
      const elapsed = Math.floor((midUnit / Math.max(1, tl.units)) * r.finalDurationMs);
      r.finalElapsedMs = 0;
      r.finalStartedAt = Date.now() - elapsed;
      r.nextAt = r.finalStartedAt + r.finalDurationMs;
      room.clearTimer();
      room.armTimer(() => room.tickResultsReveal(), Math.max(200, r.nextAt - Date.now()));
      room.emitResultsReveal();

      await page.waitForSelector("#final-live-body", { timeout: 20000 });
      await waitFor(page, () => {
        const board = document.querySelector(".final-scoreboard.is-chase");
        return Boolean(board && board.querySelectorAll(".final-score-col").length >= 2);
      }, "chase scoreboard", 15000);
      await sleep(500);
      await shot(page, "final-chase-scores.png", VIEW, { scroll: ".final-panel", hideTopbar: true });
      await ctx.close();
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
