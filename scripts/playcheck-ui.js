#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");
const { start } = require("../server/index");

const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
const OUT = path.join(__dirname, "..", "screenshots");
fs.mkdirSync(OUT, { recursive: true });

process.env.LOT_START_MS = process.env.LOT_START_MS || "60000";
process.env.BID_TIMER_MS = process.env.BID_TIMER_MS || "60000";
process.env.CAPTAIN_TIMER_MS = process.env.CAPTAIN_TIMER_MS || "30000";
process.env.SOLD_REVEAL_MS = process.env.SOLD_REVEAL_MS || "1200";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(page, fn, timeout = 20000, label = "condition") {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await fn()) return;
    } catch (_) {}
    await sleep(40);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function shot(page, name) {
  const dest = path.join(OUT, name);
  await page.screenshot({ path: dest, fullPage: true });
  console.log("wrote", dest);
  return dest;
}

async function phase(page) {
  return page.evaluate(() => (window.IplApp && IplApp.state && IplApp.state.phase) || null);
}

async function openNamed(browser, name, base) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.evaluate(() => sessionStorage.clear());
  await page.waitForSelector("#name");
  await page.click("#name", { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type("#name", name, { delay: 10 });
  return page;
}

async function main() {
  const port = Number(process.env.PORT || 0);
  const ctx = await start({ port });
  const addr = ctx.server.address();
  const base = `http://127.0.0.1:${addr.port}`;
  console.log("playcheck server", base);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    protocolTimeout: 120000,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });

  try {
    const home = await browser.newPage();
    await home.setViewport({ width: 1400, height: 900 });
    await home.goto(base, { waitUntil: "networkidle0" });
    await home.waitForSelector("#name");
    await home.click("#name");
    await shot(home, "home.png");
    await home.close();

    const ash = await openNamed(browser, "Ashutosh", base);
    await ash.click("#create");
    await waitFor(ash, async () => (await phase(ash)) === "lobby", 15000, "lobby");
    const code = await ash.evaluate(() => IplApp.state.code);
    console.log("room", code);

    const others = [];
    for (const name of ["Priya", "Rohan", "Meera"]) {
      const page = await openNamed(browser, name, base);
      await page.click("#code", { clickCount: 3 });
      await page.type("#code", code, { delay: 8 });
      await page.click("#join");
      others.push(page);
    }
    await waitFor(ash, async () => (await ash.evaluate(() => (IplApp.state.franchises || []).length)) >= 4, 15000, "all joined");

    // Pick a couple of distinct logos so the lobby picker looks used.
    await priyaPick(others[0]);
    await waitFor(ash, async () => Boolean(await ash.$(".logo-picker")), 8000, "logo picker");
    await sleep(300);
    await shot(ash, "lobby-logos.png");
    await shot(ash, "lobby.png");
    await ash.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await sleep(200);
    await shot(ash, "lobby-logos-mobile.png");
    await ash.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });

    await ash.click("#start");
    await waitFor(ash, async () => (await phase(ash)) === "auction" && Boolean(await ash.$("#auction-ring")), 15000, "auction ring");
    await waitFor(ash, async () => {
      const n = await ash.evaluate(() => (IplApp.state.auction && IplApp.state.auction.stillIn && IplApp.state.auction.stillIn.length) || 0);
      return n >= 3;
    }, 8000, "several teams still in");
    await sleep(400);
    await shot(ash, "auction-ring.png");
    await shot(ash, "auction.png");

    const defaultName = await ash.evaluate(() => IplApp.state.auction.currentBidderName);
    const pages = [ash, ...others];
    const names = await Promise.all(pages.map((p) => p.evaluate(() => IplApp.state.you && IplApp.state.you.name)));
    let opted = 0;
    for (let i = 0; i < pages.length; i++) {
      if (names[i] === defaultName) continue;
      if (opted >= 2) break;
      await pages[i].evaluate(async () => {
        if (IplApp.state && IplApp.state.auction && IplApp.state.auction.youCanOptOut) {
          await IplApp.emit("optOut");
        }
      });
      opted += 1;
    }
    await waitFor(ash, async () => {
      const n = await ash.evaluate(() => (IplApp.state.auction && IplApp.state.auction.stillIn && IplApp.state.auction.stillIn.length) || 0);
      return n >= 2 && n <= 3;
    }, 8000, "ring after opt-outs");
    await sleep(450);
    await shot(ash, "auction-ring-optouts.png");

    // Force a sale so the SOLD modal can be captured.
    await Promise.all(
      pages.map((page) =>
        page.evaluate(async () => {
          if (IplApp.state && IplApp.state.auction && IplApp.state.auction.youCanOptOut) {
            await IplApp.emit("optOut");
          }
        })
      )
    );
    await waitFor(ash, async () => {
      return ash.evaluate(() => {
        const m = document.getElementById("sold-modal");
        return Boolean(m && !m.hidden);
      });
    }, 8000, "sold modal");
    await sleep(180);
    await shot(ash, "sold-modal.png");
    await waitFor(ash, async () => {
      return ash.evaluate(() => {
        const m = document.getElementById("sold-modal");
        return Boolean(IplApp.state && IplApp.state.phase === "auction" && IplApp.state.auction && (!m || m.hidden));
      });
    }, 8000, "next lot after sold reveal");

    await ash.click("#pause");
    await waitFor(ash, async () => {
      return ash.evaluate(() => {
        const m = document.getElementById("pause-modal");
        return Boolean(m && !m.hidden);
      });
    }, 8000, "pause modal");
    await sleep(200);
    await shot(ash, "pause-modal.png");

    await ash.evaluate(async () => { await IplApp.emit("resume"); });
    await waitFor(ash, async () => ash.evaluate(() => !IplApp.state.paused), 8000, "resumed");

    await Promise.all(
      pages.map((page) =>
        page.evaluate(async () => {
          const start = Date.now();
          while (Date.now() - start < 90000) {
            const st = IplApp.state;
            if (!st) {
              await new Promise((r) => setTimeout(r, 20));
              continue;
            }
            if (st.phase !== "auction") return;
            if (st.auction && st.auction.youCanOptOut) {
              await IplApp.emit("optOut");
            }
            await new Promise((r) => setTimeout(r, 8));
          }
        })
      )
    );

    await waitFor(ash, async () => (await phase(ash)) === "captains", 90000, "captains/shop");
    await waitFor(ash, async () => Boolean(await ash.$(".booster-grid")), 8000, "booster grid");
    await sleep(200);
    await shot(ash, "boosters.png");

    await Promise.all(
      pages.map((page) =>
        page.evaluate(async () => {
          const st = IplApp.state;
          if (!st || st.phase !== "captains") return;
          if (st.you && st.you.squad && st.you.squad.length && !st.you.captainId) {
            await IplApp.emit("selectCaptain", { playerId: st.you.squad[0].player.id });
          }
          const catalog = st.boosterCatalog || [];
          for (const b of [...catalog].sort((a, c) => a.pricePoints - c.pricePoints)) {
            const you = IplApp.state.you;
            if (!you || you.purseLakhs < b.pricePoints) continue;
            if ((you.boosters || []).some((x) => x.id === b.id)) continue;
            await IplApp.emit("buyBooster", { boosterId: b.id });
          }
        })
      )
    );

    await waitFor(ash, async () => (await phase(ash)) === "results", 70000, "results");
    await waitFor(ash, async () => Boolean(await ash.$(".team-report")), 20000, "team reports");
    const skip = await ash.$("#skip-reveal");
    if (skip) {
      try { await skip.click(); } catch (_) {}
      await sleep(400);
    }
    await sleep(400);
    await shot(ash, "results.png");
    console.log("play-check complete");
  } finally {
    await browser.close();
    if (ctx?.io) ctx.io.close();
    if (ctx?.server) await new Promise((resolve) => ctx.server.close(() => resolve()));
  }
}

async function priyaPick(page) {
  try {
    await page.waitForSelector(".logo-choice:not(.taken):not(.selected)", { timeout: 8000 });
    const handle = await page.$(".logo-choice:not(.taken):not(.selected)");
    if (handle) await handle.click();
  } catch (_) {}
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
