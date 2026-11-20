#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const OUT = path.join(__dirname, "..", "screenshots");
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
fs.mkdirSync(OUT, { recursive: true });

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

async function openNamed(browser, name) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.evaluate(() => sessionStorage.clear());
  await page.waitForSelector("#name");
  await page.click("#name", { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type("#name", name, { delay: 15 });
  return page;
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    protocolTimeout: 120000,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });

  try {
    const home = await browser.newPage();
    await home.setViewport({ width: 1400, height: 900 });
    await home.goto(BASE, { waitUntil: "networkidle0" });
    await home.waitForSelector("#name");
    // Leave the name field visible and empty-ish with placeholder, but type a sample so the shared field is obvious.
    await home.click("#name");
    await shot(home, "home.png");
    await home.close();

    const ash = await openNamed(browser, "Ashutosh");
    await ash.click("#create");
    await waitFor(ash, async () => (await phase(ash)) === "lobby", 15000, "lobby");
    const code = await ash.evaluate(() => IplApp.state.code);
    console.log("room", code);

    const priya = await openNamed(browser, "Priya");
    await priya.click("#code", { clickCount: 3 });
    await priya.type("#code", code, { delay: 10 });
    await priya.click("#join");
    await waitFor(ash, async () => (await ash.evaluate(() => (IplApp.state.franchises || []).length)) >= 2, 15000, "priya joined");

    await ash.click("#start");
    await waitFor(ash, async () => (await phase(ash)) === "auction" && Boolean(await ash.$(".bid-steps")), 15000, "auction ui");
    await sleep(250);
    await shot(ash, "auction.png");

    // Inside-page loops so CDP is not involved on every lot.
    await Promise.all(
      [ash, priya].map((page) =>
        page.evaluate(async () => {
          const start = Date.now();
          while (Date.now() - start < 50000) {
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

    await waitFor(ash, async () => (await phase(ash)) === "captains", 20000, "captains/shop");
    await waitFor(ash, async () => Boolean(await ash.$(".booster-grid")), 8000, "booster grid");
    await sleep(200);
    await shot(ash, "boosters.png");

    await Promise.all(
      [ash, priya].map((page) =>
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
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
