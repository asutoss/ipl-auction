#!/usr/bin/env node
/**
 * 360px screenshots of the wake-up loader showing two different auction facts.
 * Usage: node scripts/shot-loader.js
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");
const loader = require("../loader/ipl-loader");

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
    if (urlPath === "/shot") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700;1,9..40,400&family=Teko:wght@500;600;700&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="./ipl-loader.css"/>
</head>
<body>
<div id="ipl-boot-loader"></div>
<script src="./ipl-loader.js"></script>
</body></html>`);
    }
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

function longestFactIndex() {
  let best = 0;
  let len = -1;
  loader.FACTS.forEach((f, i) => {
    if (f.text.length > len) {
      len = f.text.length;
      best = i;
    }
  });
  return best;
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
    await page.goto(`http://127.0.0.1:${port}/shot`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForFunction(() => Boolean(window.IplWakeLoader && document.getElementById("ipl-boot-loader")), { timeout: 10000 });

    async function overflowAt(width) {
      await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });
      await sleep(80);
      return page.evaluate((w) => {
        const root = document.querySelector(".ipl-wake-root") || document.documentElement;
        const doc = document.documentElement;
        const body = document.body;
        const card = document.querySelector(".ipl-wake-card");
        const fact = document.querySelector("#ipl-wake-fact");
        const note = document.querySelector(".ipl-wake-note");
        const meas = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10, width: Math.round(r.width * 10) / 10 };
        };
        return {
          width: w,
          docScroll: doc.scrollWidth,
          docClient: doc.clientWidth,
          bodyScroll: body.scrollWidth,
          rootScroll: root.scrollWidth,
          rootClient: root.clientWidth,
          card: meas(card),
          fact: meas(fact),
          note: meas(note),
          overflow: Math.max(doc.scrollWidth, body.scrollWidth, root.scrollWidth) > w + 1,
        };
      }, width);
    }

    async function pinFact(idx) {
      const info = await page.evaluate(async (index) => {
        const root = document.getElementById("ipl-boot-loader");
        if (!window.__iplShot) {
          root.innerHTML = "";
          window.__iplShot = window.IplWakeLoader.create({
            root,
            mode: "overlay",
            paused: true,
            showDelayMs: 0,
            factIndex: index,
            note: "This can take about a minute if the server was napping. You’ll jump in automatically.",
          });
        }
        window.__iplShot.setIndex(index);
        if (document.fonts && document.fonts.ready) {
          try { await document.fonts.ready; } catch (e) {}
        }
        const el = document.querySelector("#ipl-wake-fact");
        return {
          fact: el && el.textContent,
          ds: document.querySelector(".ipl-wake-root") && document.querySelector(".ipl-wake-root").dataset.fact,
          index,
        };
      }, idx);
      if (!info || info.ds !== String(idx) || !info.fact) {
        throw new Error("failed to pin fact " + idx + ": " + JSON.stringify(info));
      }
      await sleep(250);
    }

    const shots = [
      { index: 0, name: "loader-fact-shashank.png" },
      { index: 3, name: "loader-fact-gayle.png" },
    ];
    for (const shot of shots) {
      await pinFact(shot.index);
      await page.setViewport({ ...VIEW, deviceScaleFactor: 2 });
      const file = path.join(OUT, shot.name);
      await page.screenshot({ path: file, fullPage: false, timeout: 20000 });
      console.log("wrote", file, "fact", shot.index);
    }

    await pinFact(longestFactIndex());
    for (const w of [320, 360, 412]) {
      const info = await overflowAt(w);
      console.log("overflow-check", JSON.stringify(info));
      if (info.overflow || (info.card && info.card.right > w + 1) || (info.note && info.note.right > w + 1) || (info.fact && info.fact.right > w + 1) || (info.card && info.card.left < -1)) {
        throw new Error("horizontal overflow at " + w + "px: " + JSON.stringify(info));
      }
    }
    await page.setViewport({ ...VIEW, deviceScaleFactor: 2 });
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
