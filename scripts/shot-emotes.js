#!/usr/bin/env node
/**
 * Desktop + mobile screenshots of a mid-flight emote burst.
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
const { start } = require("../server/index");

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

async function waitFor(page, fn, label, timeoutMs = 12000, ...args) {
  try {
    await page.waitForFunction(fn, { timeout: timeoutMs }, ...args);
  } catch (err) {
    throw new Error(`timeout: ${label} (${err.message})`);
  }
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
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const other = await ctx.newPage();
    await page.setViewport({ ...DESKTOP, deviceScaleFactor: 1 });
    await other.setViewport({ ...DESKTOP, deviceScaleFactor: 1 });
    for (const p of [page, other]) {
      await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await waitFor(p, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket");
    }
    const created = await emit(page, "createRoom", { name: "Dolly", mode: "rapid" });
    if (!created.ok) throw new Error(`create: ${created.error}`);
    const code = created.code;
    await emit(page, "selectCharacter", { characterId: "dolly-chaiwala", identityId: "dolly-chaiwala" });
    const joined = await emit(other, "joinRoom", { name: "Ravi", code });
    if (!joined.ok) throw new Error(`join: ${joined.error}`);
    await emit(other, "selectCharacter", { characterId: "ravi-kishan", identityId: "ravi-kishan" });
    const started = await emit(page, "startAuction", {});
    if (!started.ok) throw new Error(`start: ${started.error}`);
    await waitFor(page, () => window.IplApp.state && window.IplApp.state.phase === "auction" && window.IplApp.state.auction, "auction");
    await sleep(300);

    // Burst of mixed emoji + phrase floats from both teams, staggered so they
    // are mid-flight together. Call showEmote directly so the cap is visual,
    // not the server window.
    const burst = async (target) => {
      await target.evaluate(() => {
        const show = window.IplApp && window.IplApp.showEmote;
        if (!show) throw new Error("showEmote missing");
        const A = "dolly";
        const B = "ravi";
        const pack = [
          { teamId: A, emoteId: "laugh" },
          { teamId: B, emoteId: "fire" },
          { teamId: A, emoteId: "clap" },
          { teamId: B, text: "Chai break le lo" },
          { teamId: A, emoteId: "money" },
          { teamId: B, emoteId: "overpaid" },
          { teamId: A, emoteId: "steal" },
          { teamId: B, emoteId: "cry" },
          { teamId: A, text: "The nation wants to know" },
          { teamId: B, emoteId: "mindblown" },
          { teamId: A, emoteId: "clown" },
          { teamId: B, emoteId: "bas-kar" },
          { teamId: A, emoteId: "cool" },
          { teamId: B, text: "Elvish bhaiiii!" },
          { teamId: A, emoteId: "kya-player" },
          { teamId: B, emoteId: "paisa-barbaad" },
          { teamId: A, emoteId: "ee-sala" },
          { teamId: B, emoteId: "laugh" },
          { teamId: A, emoteId: "fire" },
          { teamId: B, emoteId: "clap" },
        ];
        pack.forEach((item, i) => {
          setTimeout(() => show(item), i * 40);
        });
      });
    };

    await burst(page);
    // Mid-flight: after roughly a third of the stream have started, but
    // before the early ones fade at the top (~2.3s+).
    await sleep(1100);
    await page.screenshot({ path: path.join(OUT, "emotes-stream.png"), fullPage: false });
    console.log("wrote", path.join(OUT, "emotes-stream.png"));

    // Mobile: fresh burst so plenty are in flight, above the bid box.
    await page.setViewport({ ...MOBILE, deviceScaleFactor: 2 });
    await sleep(200);
    await burst(page);
    await sleep(1100);
    await page.screenshot({ path: path.join(OUT, "emotes-stream-mobile.png"), fullPage: false });
    console.log("wrote", path.join(OUT, "emotes-stream-mobile.png"));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
