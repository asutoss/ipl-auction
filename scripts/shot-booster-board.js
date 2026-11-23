#!/usr/bin/env node
/**
 * Mobile screenshots of the captain/booster board, curse picker, and form reveal.
 * Usage: node scripts/shot-booster-board.js
 */
process.env.POWER_REVEAL_MS = "0";
process.env.SOLD_REVEAL_MS = "0";
process.env.LAST_TEAM_FILL_MS = "0";
process.env.PLAYER_INTRO_MS = "0";
process.env.RESULTS_REVEAL_STEP_MS = "120000";
process.env.LOT_START_MS = "180000";
process.env.BID_TIMER_MS = "180000";
process.env.CAPTAIN_TIMER_MS = "90000";
process.env.FORM_BOOST_REVEAL_MS = "180000";
process.env.ALLOW_TEST_TIMERS = "1";
process.env.CREATE_LIMIT = "0";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { start } = require("../server/index");
const { loadPlayers } = require("../server/players");

const OUT = path.join(__dirname, "..", "screenshots");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const PHONE = { width: 390, height: 844 };
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
  team.purseLakhs = 80;
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
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=390,844"],
  });
  try {
    const ctx = await browser.createBrowserContext();
    const pages = [];
    for (let i = 0; i < 4; i++) {
      const page = await ctx.newPage();
      await page.setViewport({ ...PHONE, deviceScaleFactor: 2 });
      await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await waitFor(page, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket");
      pages.push(page);
    }
    const host = pages[0];
    const created = await emit(host, "createRoom", {
      name: NAMES[0],
      mode: "classical",
      testTimers: { captainMs: 90000, formBoostRevealMs: 180000, playerIntroMs: 0, soldRevealMs: 0, resultsRevealStepMs: 120000 },
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
    room.findByName("Baahubali").captainId = null;
    room.findByName("Mitron").formPct = 108;
    room.findByName("Dolly").formPct = 96;
    room.findByName("Baahubali").formPct = 115;
    room.findByName("Ravi").formPct = 88;
    room.beginCaptainPhase();
    room.bump("captains");
    await sleep(800);
    await waitFor(host, () => {
      const st = window.IplApp && window.IplApp.state;
      return Boolean(st && st.phase === "captains" && document.getElementById("prep-screen"));
    }, "prep board");

    const buys = [
      [pages[0], "buyBooster", { boosterId: "lucky-toss" }],
      [pages[0], "buyBooster", { boosterId: "net-session" }],
      [pages[1], "buyBooster", { boosterId: "cheerleaders" }],
      [pages[1], "buyBooster", { boosterId: "net-session" }],
      [pages[2], "buyBooster", { boosterId: "home-curator" }],
      [pages[3], "buyBooster", { boosterId: "nazar", targetName: "Baahubali" }],
    ];
    for (const [page, ev, payload] of buys) {
      const res = await emit(page, ev, payload);
      if (!res.ok) throw new Error(`buy ${payload.boosterId}: ${res.error}`);
    }
    await waitFor(host, () => {
      const text = (document.getElementById("prep-screen") && document.getElementById("prep-screen").innerText) || "";
      const chips = document.querySelectorAll(".prep-chip").length;
      return chips >= 6 && /Lucky Toss Coin/.test(text) && /\+3% title chance/.test(text) && /Nazar from Ravi · [\u2212-]9% title chance/.test(text) && /choosing/.test(text);
    }, "purchases on board");
    await sleep(1600);
    await shot(host, "booster-board-curse.png", PHONE, { scroll: '[data-prep-team="Baahubali"]', hideTopbar: true });

    await waitFor(host, () => {
      const shop = document.getElementById("prep-shop");
      const buyable = document.querySelectorAll("#prep-shop .booster.is-buyable").length;
      const locked = document.querySelectorAll("#prep-shop .booster.is-unbuyable").length;
      return Boolean(shop && buyable >= 1 && locked >= 1);
    }, "shop buyable and unbuyable groups");
    await shot(host, "booster-shop-sorted.png", PHONE, { scroll: "#prep-shop", hideTopbar: true });

    await host.evaluate(() => {
      const card = document.querySelector('[data-prep-team="Mitron"]');
      if (card) card.click();
    });
    await waitFor(host, () => {
      const card = document.querySelector('[data-prep-team="Mitron"].is-open');
      const text = card ? card.innerText : "";
      return Boolean(card && /Net Session Masterclass · \+10% title chance/.test(text) && /Lucky Toss Coin · \+3% title chance/.test(text) && !/Guarantees your Current form/.test(text) && !/Big impact|Medium impact|Small impact/i.test(text));
    }, "mitron card expanded");
    await sleep(300);
    await shot(host, "booster-board-expanded.png", PHONE, { scroll: '[data-prep-team="Mitron"]', hideTopbar: true });

    await host.evaluate(() => {
      const btn = document.querySelector('[data-buy="nazar"]');
      if (btn) {
        btn.scrollIntoView({ block: "center" });
        btn.click();
      }
    });
    await waitFor(host, () => {
      const modal = document.getElementById("curse-picker");
      const targets = document.querySelectorAll("[data-curse-target]").length;
      return Boolean(modal && targets >= 3);
    }, "curse picker");
    await sleep(300);
    await shot(host, "booster-curse-target.png", PHONE, { hideTopbar: true });

    await host.evaluate(() => {
      const cancel = document.querySelector("[data-curse-cancel]");
      if (cancel) cancel.click();
    });
    await waitFor(host, () => !document.getElementById("curse-picker"), "picker closed");

    room.finishCaptains();
    room.bump("formBoosts");
    await waitFor(host, () => {
      const el = document.getElementById("form-boost-reveal");
      const text = el ? el.innerText : "";
      return Boolean(el && /Current form swings/.test(text) && /Nazar Lag Gayi/.test(text) && /[\u2212-]9% title chance/.test(text) && /Net Session Masterclass/.test(text));
    }, "form reveal");
    await sleep(400);
    await shot(host, "booster-form-reveal.png", PHONE, { scroll: "#form-boost-reveal", hideTopbar: true });
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
