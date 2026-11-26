const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { seatBubble, bubbleHtml, placeMeta, initialChipRect, circleHitsRect, rectsOverlap, clampRect } = require("../public/ring");
const IplFx = require("../public/fx");

const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const HAS_CHROME = fs.existsSync(CHROME);

describe("compact ring chips", () => {
  test("short pill is 42p · 3 with a full title", () => {
    const view = seatBubble({ name: "Mitron", purseLakhs: 42, pending: 3 }, { minBidLakhs: 6 });
    assert.equal(view.shortText, "42p · 3");
    assert.equal(view.text, "42 pts · 3 left");
    const html = bubbleHtml(view);
    assert.match(html, /42p/);
    assert.doesNotMatch(html, />42 pts</);
    assert.match(html, /title="42 pts · 3 left"/);
  });

  test("complete squads use a tick in the compact pill", () => {
    const view = seatBubble({ name: "Dolly", purseLakhs: 42, complete: true, pending: 0 }, { minBidLakhs: 6 });
    assert.equal(view.shortNeed, "✓");
    assert.match(bubbleHtml(view), /✓/);
  });

  test("placeMeta still keeps bottom seats beside the face", () => {
    assert.equal(placeMeta(160).side, "right");
    assert.equal(placeMeta(200).side, "left");
  });

  test("initial chip rect sits outside the avatar circle", () => {
    const face = { left: 100, top: 100, right: 148, bottom: 148, width: 48, height: 48 };
    for (const mid of [0, 45, 90, 135, 180, 210, 225, 270, 315]) {
      const rect = initialChipRect(face, mid, 56, 28);
      assert.equal(
        circleHitsRect(124, 124, 24, rect, 0.5),
        false,
        `mid ${mid} overlaps avatar ${JSON.stringify(rect)}`
      );
    }
  });

  test("rect helpers detect overlap and clamp to a 360px box", () => {
    assert.equal(rectsOverlap({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 9, top: 0, right: 20, bottom: 10 }), true);
    assert.equal(rectsOverlap({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 11, top: 0, right: 20, bottom: 10 }), false);
    const clamped = clampRect({ left: -8, top: 10, right: 48, bottom: 40 }, { left: 0, top: 0, right: 360, bottom: 800 });
    assert.equal(clamped.left >= 0, true);
    assert.equal(clamped.right <= 360, true);
  });
});

describe("cricket animations", () => {
  test("classifies four, six, and wicket deliveries", () => {
    assert.equal(IplFx.classifyDelivery({ wicket: true, runs: 0 }), "wicket");
    assert.equal(IplFx.classifyDelivery({ runs: 6 }), "six");
    assert.equal(IplFx.classifyDelivery({ runs: 4 }), "four");
    assert.equal(IplFx.classifyDelivery({ runs: 1 }), null);
    assert.equal(IplFx.classifyDelivery(null), null);
  });

  test("playCue records the last trigger even without a document", () => {
    const cue = IplFx.playCue("six", { hold: true });
    assert.equal(cue.kind, "six");
    assert.equal(IplFx.lastCue.kind, "six");
    const wicket = IplFx.playCue("wicket");
    assert.equal(wicket.kind, "wicket");
  });
});

describe("first-load trim", () => {
  test("index loads one display font, defers phase scripts, and vendors confetti", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
    assert.equal(/Rajdhani/.test(html), false);
    assert.match(html, /family=Teko/);
    assert.match(html, /family=DM\+Sans/);
    assert.match(html, /display=swap/);
    assert.equal(/script src="\/final-match\.js"/.test(html), false);
    assert.equal(/script src="\/share-results\.js"/.test(html), false);
    assert.equal(/script src="\/booster-shop\.js"/.test(html), false);
    assert.match(html, /src="\/fx\.js"/);
    const vendor = path.join(__dirname, "..", "public", "vendor", "confetti.browser.min.js");
    assert.equal(fs.existsSync(vendor), true);
    const confetti = fs.readFileSync(vendor, "utf8");
    assert.match(confetti, /confetti/);
    const note = fs.readFileSync(path.join(__dirname, "..", "public", "vendor", "README.md"), "utf8");
    assert.match(note, /ISC/);
  });
});

describe("360px ring layout and in-place auction patch", { skip: !HAS_CHROME }, () => {
  test("chips never overlap avatars, each other, the hub, or the 360px viewport (4 and 6 teams), and patchAuction updates in place", async (t) => {
    process.env.ALLOW_TEST_TIMERS = "1";
    process.env.CREATE_LIMIT = "0";
    process.env.POWER_REVEAL_MS = "0";
    process.env.SOLD_REVEAL_MS = "0";
    process.env.LAST_TEAM_FILL_MS = "0";
    process.env.PLAYER_INTRO_MS = "0";
    const puppeteer = require("puppeteer-core");
    const { start } = require("../server/index");
    const { loadPlayers } = require("../server/players");
    const { players } = loadPlayers();
    const VIEW = { width: 360, height: 800 };
    const TEST_TIMERS = {
      lotStartMs: 180000,
      bidMs: 180000,
      captainMs: 180000,
      soldRevealMs: 0,
      lastTeamFillMs: 0,
      playerIntroMs: 0,
      resultsRevealStepMs: 0,
      formBoostRevealMs: 0,
      finalMatchMs: 0,
      autofillRevealMs: 0,
      powerRevealMs: 0,
    };
    const CHAR_IDS = ["narendra-modi", "dolly-chaiwala", "prabhas", "ravi-kishan", "kim-jong-un", "samay-raina"];
    const LONG_NAMES = [
      "Royal Challengers Bengal",
      "Super Kings Express",
      "Mumbai Mavericks XI",
      "Sunrisers Hyderabad",
      "Chennai Super Knights",
      "Lucknow Giants United",
    ];

    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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

    async function waitFor(page, fn, label, timeoutMs = 20000, ...args) {
      try {
        await page.waitForFunction(fn, { timeout: timeoutMs }, ...args);
      } catch (err) {
        throw new Error(`timeout: ${label} (${err.message})`);
      }
    }

    const { port, server, manager } = await start(0);
    const origin = `http://127.0.0.1:${port}`;
    const browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: "new",
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=360,800"],
    });

    async function runRing(count, opts = {}) {
      const names = (opts.names || ["Mitron", "Dolly", "Baahubali", "Ravi", "Kim", "Samay"]).slice(0, count);
      const forceWk = Boolean(opts.forceWk);
      const checkTap = opts.checkTap != null ? Boolean(opts.checkTap) : count === 6;
      const purses = [42, 88, 15, 61, 27, 100];
      const give = [3, 1, 2, 2, 3, 0];
      const ctx = await browser.createBrowserContext();
      const pages = [];
      try {
        for (let i = 0; i < count; i++) {
          const page = await ctx.newPage();
          await page.setViewport({ ...VIEW, deviceScaleFactor: 1 });
          await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
          await waitFor(page, () => Boolean(window.IplApp && window.IplApp.socket && window.IplApp.socket.connected), "socket " + i);
          pages.push(page);
        }
        const host = pages[0];
        const created = await emit(host, "createRoom", { name: names[0], mode: "classical", testTimers: TEST_TIMERS });
        assert.equal(created.ok, true, created.error);
        const code = created.code;
        await emit(host, "selectCharacter", { characterId: CHAR_IDS[0], identityId: CHAR_IDS[0] });
        for (let i = 1; i < count; i++) {
          const joined = await emit(pages[i], "joinRoom", { name: names[i], code });
          assert.equal(joined.ok, true, `${names[i]}: ${joined.error}`);
          await emit(pages[i], "selectCharacter", { characterId: CHAR_IDS[i], identityId: CHAR_IDS[i] });
        }
        await waitFor(host, (n) => {
          const st = window.IplApp && window.IplApp.state;
          return Boolean(st && st.phase === "lobby" && st.franchises && st.franchises.length >= n);
        }, "lobby " + count, 20000, count);
        const started = await emit(host, "startAuction", {});
        assert.equal(started.ok, true, started.error);
        const room = manager.get(code);
        if (room.playerIntro) room.finishPlayerIntro();
        const nomineeId = room.auction && room.auction.nominee && room.auction.nominee.id;
        let pi = 0;
        names.forEach((name, idx) => {
          const team = room.findByName(name);
          if (!team) throw new Error("missing team " + name);
          team.purseLakhs = purses[idx];
          const n = give[idx];
          let given = 0;
          while (given < n && pi < players.length) {
            const p = players[pi++];
            if (!p || p.id === nomineeId || room.soldIds.has(p.id)) continue;
            team.squad.push({ player: p, priceLakhs: 2 });
            room.soldIds.add(p.id);
            given += 1;
          }
        });
        if (forceWk) {
          const current = room.auction && room.auction.nominee;
          if (!current || current.role !== "WK") {
            const wk = players.find((p) => p.role === "WK" && (!current || p.id !== current.id) && !room.soldIds.has(p.id));
            if (!wk) throw new Error("no WK available to put on the block");
            if (current) room.queue.unshift(current);
            room.queue = (room.queue || []).filter((p) => p.id !== wk.id);
            room.auction.nominee = wk;
          }
        }
        room.bump("auction");
        const seatDeadline = Date.now() + 40000;
        let foundSeats = [];
        while (Date.now() < seatDeadline) {
          const snap = await host.evaluate(() => {
            const st = window.IplApp && IplApp.state;
            if (!st || !st.auction) return { names: [], leaving: 0 };
            return {
              names: [...document.querySelectorAll(".ring-logo-pin:not(.is-leaving) .ring-seat-name")].map((el) => el.textContent.trim()),
              leaving: document.querySelectorAll(".ring-logo-pin.is-leaving").length,
            };
          });
          foundSeats = snap.names;
          if (snap.leaving === 0 && foundSeats.length === names.length && names.every((name) => foundSeats.includes(name))) break;
          await sleep(150);
        }
        if (!(foundSeats.length === names.length && names.every((name) => foundSeats.includes(name)))) {
          throw new Error(`timeout: ${count} named seats dump=${JSON.stringify(foundSeats)}`);
        }
        const report = await host.evaluate(() => {
          const svg = document.getElementById("auction-ring");
          if (svg && window.IplRing && IplRing.layoutSeatChips) IplRing.layoutSeatChips(svg);
          const measure = window.IplRing && IplRing.measureRingCollisions
            ? IplRing.measureRingCollisions(svg)
            : { ok: false, overlaps: [{ type: "missing-api" }], clipped: [] };
          const allPins = document.querySelectorAll(".ring-logo-pin").length;
          const leaving = document.querySelectorAll(".ring-logo-pin.is-leaving").length;
          const franchiseCount = window.IplApp && IplApp.state && IplApp.state.franchises ? IplApp.state.franchises.length : 0;
          const pills = [...document.querySelectorAll(".ring-logo-pin:not(.is-leaving)")].map((pin) => {
            const nameEl = pin.querySelector(".ring-seat-name");
            const box = nameEl ? nameEl.getBoundingClientRect() : null;
            return {
              name: (nameEl && nameEl.textContent || "").trim(),
              pts: ((pin.querySelector(".ring-bubble-pts") || {}).textContent || "").trim(),
              need: ((pin.querySelector(".ring-bubble-need") || {}).textContent || "").trim(),
              title: (pin.querySelector(".ring-bubble") || {}).getAttribute("title") || "",
              overflowX: nameEl ? Math.max(0, nameEl.scrollWidth - nameEl.clientWidth) : 0,
              overflowY: nameEl ? Math.max(0, nameEl.scrollHeight - nameEl.clientHeight) : 0,
              nameBox: box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null,
            };
          });
          const dock = document.querySelector(".emote-dock");
          const dockBox = dock ? dock.getBoundingClientRect() : null;
          const chips = [...document.querySelectorAll(".ring-seat-meta")].map((el) => el.getBoundingClientRect());
          const dockHits = dockBox
            ? chips.some((c) => !(c.right < dockBox.left || c.left > dockBox.right || c.bottom < dockBox.top || c.top > dockBox.bottom))
            : false;
          const live = document.querySelector(".live-bid");
          const liveH = live ? live.getBoundingClientRect().height : 0;
          let patch = null;
          const bid = document.querySelector(".bid-primary");
          const slot = document.querySelector("#side-slots .slot");
          const power = document.getElementById("use-power");
          if (bid) bid.dataset.probe = "1";
          if (slot) slot.dataset.probe = "1";
          if (power) power.dataset.probe = "1";
          if (window.IplApp && IplApp.patchAuction) {
            IplApp.patchAuction();
            patch = {
              ...IplApp.lastAuctionPatch,
              bidSame: Boolean(document.querySelector(".bid-primary") && document.querySelector(".bid-primary").dataset.probe === "1"),
              slotSame: !slot || (document.querySelector("#side-slots .slot") && document.querySelector("#side-slots .slot").dataset.probe === "1"),
              powerSame: !power || (document.getElementById("use-power") && document.getElementById("use-power").dataset.probe === "1"),
            };
          }
          function isShown(el) {
            if (!el) return false;
            const s = getComputedStyle(el);
            if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
            const r = el.getBoundingClientRect();
            return r.width > 8 && r.height > 8;
          }
          const hub = document.getElementById("auction-hub");
          const shot = document.getElementById("hub-headshot") || (hub && hub.querySelector(".player-headshot"));
          const rating = document.getElementById("hub-rating");
          const rates = hub && hub.querySelector(".hub-rates");
          const shownValues = [...(hub ? hub.querySelectorAll(".hub-stat-value") : [])]
            .filter(isShown)
            .map((el) => el.textContent.trim());
          const shownLabels = [...(hub ? hub.querySelectorAll(".hub-stat-label") : [])]
            .filter(isShown)
            .map((el) => el.textContent.trim());
          const visibleHubText = hub
            ? [...hub.querySelectorAll("*")]
              .filter(isShown)
              .map((el) => el.childNodes.length ? [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("") : "")
              .join(" ")
              .replace(/\s+/g, " ")
              .trim()
            : "";
          const hubInfo = {
            isRating: Boolean(hub && hub.classList.contains("is-rating")),
            shotShown: isShown(shot),
            shotH: shot ? Math.round(shot.getBoundingClientRect().height) : 0,
            ratingShown: isShown(rating),
            ratesShown: isShown(rates),
            shownLabels,
            shownValues,
            visibleHubText,
          };
          return { measure, pills, allPins, leaving, franchiseCount, dockHits, dockBox, liveH, patch, hubInfo, contain: document.querySelector(".ring-wrap") ? getComputedStyle(document.querySelector(".ring-wrap")).contain : "" };
        });
        if (report.pills.length !== count) {
          throw new Error(`${count}-team pin count mismatch pills=${JSON.stringify(report.pills)} all=${report.allPins} leaving=${report.leaving} franchises=${report.franchiseCount}`);
        }
        if (!report.measure.ok) {
          throw new Error(`${count}-team ring overlap: ${JSON.stringify(report.measure)}`);
        }
        for (const p of report.pills) {
          assert.match(p.pts, /\d+p/, `${p.name} missing compact purse: ${JSON.stringify(p)}`);
          assert.ok(p.need, `${p.name} missing slots: ${JSON.stringify(p)}`);
          assert.match(p.title, /pts/, `${p.name} missing full title`);
          assert.ok(names.includes(p.name), `chip name ${JSON.stringify(p.name)} is not a full team name`);
          assert.ok(p.overflowX <= 1, `team name clipped horizontally: ${JSON.stringify(p)}`);
          assert.ok(p.overflowY <= 1, `team name clipped vertically: ${JSON.stringify(p)}`);
          if (p.nameBox) {
            assert.ok(p.nameBox.left >= -0.5 && p.nameBox.right <= 360.5, `team name off the 360px screen: ${JSON.stringify(p)}`);
          }
        }
        const hub = report.hubInfo || {};
        assert.equal(hub.shotShown, true, `${count}-team hub headshot hidden: ${JSON.stringify(hub)}`);
        assert.ok(hub.shotH >= 36, `${count}-team hub headshot too small: ${JSON.stringify(hub)}`);
        assert.equal(hub.isRating, false, "hub ratings should be closed by default");
        assert.equal(hub.ratingShown, false, "bat/bowl panel visible before tap");
        assert.equal(hub.ratesShown, false, "inline Bat/Bowl line still visible");
        assert.equal(hub.shownValues.length, 0, "bat/bowl values visible by default: " + JSON.stringify(hub));
        assert.equal(/\bBat\s+\d|\bBowl\s+\d/i.test(hub.visibleHubText), false, "bat/bowl ratings in default hub: " + hub.visibleHubText);
        if (count === 6) {
          assert.equal(report.dockHits, false, "emote dock overlaps a ring chip");
          assert.ok(report.liveH > 0 && report.liveH <= 120, `live-bid card still tall: ${report.liveH}`);
        }
        if (checkTap) {
          const playerName = await host.evaluate(() => ((document.getElementById("hub-name") || {}).textContent || "").trim());
          await host.evaluate(() => {
            const hubEl = document.getElementById("auction-hub");
            if (hubEl) hubEl.click();
          });
          const tapped = await host.evaluate(() => {
            function isShown(el) {
              if (!el) return false;
              const s = getComputedStyle(el);
              if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
              const r = el.getBoundingClientRect();
              return r.width > 8 && r.height > 8;
            }
            const hubEl = document.getElementById("auction-hub");
            const shot = document.getElementById("hub-headshot") || (hubEl && hubEl.querySelector(".player-headshot"));
            const rating = document.getElementById("hub-rating");
            const name = document.getElementById("hub-name");
            const identity = document.getElementById("hub-identity");
            const badge = hubEl && hubEl.querySelector(".marquee-badge");
            const meta = hubEl && hubEl.querySelector(".hub-meta");
            const visibleHubText = hubEl
              ? [...hubEl.querySelectorAll("*")]
                .filter(isShown)
                .map((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(""))
                .join(" ")
                .replace(/\s+/g, " ")
                .trim()
              : "";
            return {
              isRating: Boolean(hubEl && hubEl.classList.contains("is-rating")),
              isWk: Boolean(hubEl && hubEl.classList.contains("is-wk")),
              shotShown: isShown(shot),
              nameShown: isShown(name),
              identityShown: isShown(identity),
              badgeShown: isShown(badge),
              metaShown: isShown(meta),
              ratingShown: isShown(rating),
              labels: [...(rating ? rating.querySelectorAll(".hub-stat-label") : [])].map((el) => el.textContent.trim()),
              values: [...(rating ? rating.querySelectorAll(".hub-stat-value") : [])].map((el) => el.textContent.trim()),
              visibleHubText,
            };
          });
          assert.equal(tapped.isRating, true, "tap did not open ratings: " + JSON.stringify(tapped));
          assert.equal(tapped.ratingShown, true, "ratings panel hidden after tap");
          assert.equal(tapped.shotShown, false, "headshot still visible in ratings view: " + JSON.stringify(tapped));
          assert.equal(tapped.nameShown, false, "player name still visible in ratings view");
          assert.equal(tapped.identityShown, false, "identity block still visible in ratings view");
          assert.equal(tapped.badgeShown, false, "marquee badge still visible in ratings view");
          assert.equal(tapped.metaShown, false, "role/meta still visible in ratings view");
          if (forceWk || tapped.isWk) {
            assert.equal(tapped.labels.join(" "), "Bat Bowl Field");
            assert.equal(tapped.values.length, 3);
          } else {
            assert.equal(tapped.labels.join(" "), "Bat Bowl");
            assert.equal(tapped.values.length, 2);
          }
          assert.ok(tapped.values.every((v) => v && v !== "—"), "missing rating values: " + JSON.stringify(tapped.values));
          if (playerName) {
            assert.equal(tapped.visibleHubText.includes(playerName), false, "player name leaked into ratings view: " + tapped.visibleHubText);
          }
          await host.evaluate(() => {
            const hubEl = document.getElementById("auction-hub");
            if (hubEl) hubEl.click();
          });
          const restored = await host.evaluate(() => {
            function isShown(el) {
              if (!el) return false;
              const s = getComputedStyle(el);
              if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
              const r = el.getBoundingClientRect();
              return r.width > 8 && r.height > 8;
            }
            const hubEl = document.getElementById("auction-hub");
            const shot = document.getElementById("hub-headshot") || (hubEl && hubEl.querySelector(".player-headshot"));
            const rating = document.getElementById("hub-rating");
            const name = document.getElementById("hub-name");
            return {
              isRating: Boolean(hubEl && hubEl.classList.contains("is-rating")),
              shotShown: isShown(shot),
              nameShown: isShown(name),
              ratingShown: isShown(rating),
              name: (name && name.textContent || "").trim(),
            };
          });
          assert.equal(restored.isRating, false, "second tap did not restore the default hub");
          assert.equal(restored.shotShown, true, "headshot missing after second tap: " + JSON.stringify(restored));
          assert.equal(restored.nameShown, true, "player name missing after second tap");
          assert.equal(restored.ratingShown, false, "ratings still visible after second tap");
        }
        assert.ok(report.patch, "patchAuction was not exported");
        assert.equal(report.patch.bidRebuilt, false, "bid buttons rebuilt");
        assert.equal(report.patch.bidSame, true, "bid button node was replaced");
        assert.equal(report.patch.slotSame, true, "side slot node was replaced");
        assert.equal(report.patch.slotsRebuilt, false, "side slots rebuilt");
        if (report.patch.powerSame === false && report.patch.powerRebuilt) {
          throw new Error("power button rebuilt on same lot");
        }
        assert.match(String(report.contain), /layout/);
        return report;
      } finally {
        await ctx.close();
      }
    }

    try {
      await runRing(4);
      await runRing(6, { forceWk: true, checkTap: true });
      await runRing(4, { names: LONG_NAMES, checkTap: false });
      await runRing(6, { names: LONG_NAMES, forceWk: true, checkTap: true });
    } finally {
      await browser.close();
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
