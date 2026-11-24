#!/usr/bin/env node
/**
 * 360px screenshots of the wake-up loader showing a few different memes.
 * Usage: node scripts/shot-loader.js
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const OUT = path.join(__dirname, "..", "screenshots");
const ROOT = path.join(__dirname, "..", "loader");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const VIEW = { width: 360, height: 800 };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function startStatic() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end();
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404);
        return res.end("not found");
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(buf);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, port } = await startStatic();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=360,800"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ ...VIEW, deviceScaleFactor: 2 });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForFunction(() => Boolean(window.IplWakeLoader && document.querySelector("#ipl-wake-img")), { timeout: 10000 });
    // Pause rotation and pin three distinctive memes.
    const indexes = [0, 2, 6];
    const names = ["loader-meme-wifi.png", "loader-meme-dinner.png", "loader-meme-napping.png"];
    for (let i = 0; i < indexes.length; i++) {
      await page.evaluate((idx) => {
        const root = document.getElementById("ipl-boot-loader");
        if (!window.__iplShot) {
          // Reuse the already-mounted instance if the script stored it; otherwise remount paused.
          root.innerHTML = "";
          window.__iplShot = window.IplWakeLoader.create({
            root,
            mode: "overlay",
            assetBase: "./",
            paused: true,
            showDelayMs: 0,
            index: idx,
            note: "This can take about a minute if the server was napping. You’ll jump in automatically.",
          });
        }
        window.__iplShot.setIndex(idx);
      }, indexes[i]);
      await page.waitForFunction((idx) => {
        const img = document.querySelector("#ipl-wake-img");
        return Boolean(img && img.complete && img.naturalWidth && document.querySelector(".ipl-wake-root")?.dataset.meme === String(idx));
      }, { timeout: 8000 }, indexes[i]);
      await sleep(250);
      const file = path.join(OUT, names[i]);
      await page.screenshot({ path: file, fullPage: false, timeout: 20000 });
      console.log("wrote", file);
    }
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
