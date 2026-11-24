/* global window, document, location, fetch, setTimeout, clearTimeout, setInterval, clearInterval */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IplWakeLoader = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const ROTATE_MS = 4000;
  const PING_MS = 2000;
  const PING_TIMEOUT_MS = 4000;
  const SHOW_DELAY_MS = 120;
  const DEFAULT_GAME = "https://ipl-auction-45i3.onrender.com";
  const FACT_LABEL = "Did you know?";

  const FACTS = [
    { text: "Lucknow Super Giants bought Rishabh Pant for ₹27 crore at the 2025 mega auction, the highest bid in IPL auction history." },
    { text: "Punjab Kings signed Shreyas Iyer for ₹26.75 crore at the 2025 mega auction, a record that lasted only about 20 minutes before Pant went higher. The bidding war with Kolkata Knight Riders and Delhi Capitals ran to 103 bids, the longest of that auction." },
    { text: "Kolkata Knight Riders bought Mitchell Starc for ₹24.75 crore at the 2024 auction, then the most expensive buy in IPL history." },
    { text: "At the IPL 2026 mini-auction in Abu Dhabi on 16 December 2025, Kolkata Knight Riders bought Cameron Green for ₹25.20 crore, making him the most expensive overseas player ever and the third-costliest overall. Because of a mini-auction salary cap for overseas players, Green receives ₹18 crore and the rest goes to the BCCI for player welfare." },
    { text: "The first IPL auction was held in Mumbai on 20 February 2008, where Chennai Super Kings bought MS Dhoni for US$1.5 million, the highest bid of the day." },
    { text: "Shane Warne was the first player sold at that inaugural auction, going to Rajasthan Royals for his base price of US$450,000." },
    { text: "Andrew Symonds was the most expensive overseas buy of the 2008 auction, sold to Deccan Chargers for US$1.35 million." },
    { text: "Rajasthan Royals bought Vaibhav Suryavanshi for ₹1.1 crore at the 2025 mega auction, when he was 13 years and 243 days old — the youngest player ever signed at an IPL auction. Born in March 2011, he is younger than the league itself." },
    { text: "The previous youngest auction buy was Prayas Ray Barman, signed by Royal Challengers Bangalore for ₹1.5 crore at the 2019 auction, aged 16 years and 54 days." },
    { text: "The Right to Match card, which lets a team buy back a former player by matching the highest bid, was introduced at the 2014 mega auction and also used in 2018. It was dropped for 2022, then brought back in 2025 with a twist: the last bidder gets one more chance to raise after RTM is used." },
    { text: "Each franchise was given an auction purse of ₹120 crore for IPL 2025." },
    { text: "Richard Madley conducted IPL auctions from the first sale in 2008 through 2018. Hugh Edmeades took over as auctioneer from the 2019 auction." },
    { text: "Mallika Sagar became the first woman to conduct an IPL auction, taking the 2024-season mini-auction in Dubai, and later led the 2025 mega auction in Jeddah and the 2026 mini-auction in Abu Dhabi." },
    { text: "Punjab Kings bought Yuzvendra Chahal for ₹18 crore at the 2025 mega auction, making him the most expensive spinner in IPL auction history." },
    { text: "Delhi Daredevils bought Yuvraj Singh for ₹16 crore at the 2015 auction, then a record for any IPL player and the highest bid for an Indian until 2025." },
    { text: "Punjab Kings’ ₹18 crore buy of Arshdeep Singh at the 2025 mega auction was the first time an Indian had broken Yuvraj Singh’s decade-old ₹16 crore mark." },
    { text: "Chennai Super Kings paid ₹14.20 crore each for uncapped players Prashant Veer and Kartik Sharma at the 2026 auction, a joint record that broke Avesh Khan’s ₹10 crore mark from 2022. Both had a base price of just ₹30 lakh." },
    { text: "The IPL 2026 mini-auction, hosted in Abu Dhabi on 16 December 2025, saw all ten franchises spend ₹215.45 crore on 77 players, including 29 overseas cricketers." },
    { text: "Chris Gayle went unsold twice at the 2018 mega auction before Kings XI Punjab bought him for ₹2 crore in the accelerated round." },
    { text: "From IPL 2025, each playing member — including the Impact Player — receives a match fee of ₹7.5 lakh per game, the first match fee in IPL history, paid on top of the contracted amount." },
    { text: "Kolkata Knight Riders bought Venkatesh Iyer for ₹23.75 crore at the 2025 mega auction, after a bidding war with Royal Challengers Bengaluru." },
    { text: "After the 2025 mega auction, Pat Cummins (₹54.15 crore across auctions, including a ₹20.50 crore deal with Sunrisers Hyderabad in 2024) and Mitchell Starc (₹50.90 crore) were the only two players to have earned ₹50 crore or more at IPL auctions." },
  ];

  const LINES = [
    "Waking the dressing room…",
    "Third umpire is still at the tea stall…",
    "Hawkeye is calibrating. The server needed a nap.",
    "Asking the groundsman to roll the service out of sleep…",
    "This over is taking longer than Bangalore traffic.",
    "Waiting for the powerplay to end… on the free tier.",
    "DRS: umpire’s call — still loading.",
    "Front foot check on the spin-up. Hang on.",
    "Chai break is over. Almost.",
    "Putting the bails back on the server…",
  ];

  const ROOM_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function normalizeRoomCode(raw) {
    const code = String(raw || "").trim().toUpperCase();
    return ROOM_CODE_RE.test(code) ? code : null;
  }

  function parseRoom(loc) {
    let pathname = "";
    let search = "";
    if (typeof loc === "string") {
      try {
        const u = /^(https?:)?\/\//i.test(loc) || loc.startsWith("http")
          ? new URL(loc)
          : new URL(loc, "http://local.invalid");
        pathname = u.pathname;
        search = u.search;
      } catch {
        const q = loc.indexOf("?");
        pathname = q >= 0 ? loc.slice(0, q) : loc;
        search = q >= 0 ? loc.slice(q) : "";
      }
    } else if (loc && typeof loc === "object") {
      pathname = loc.pathname || "";
      search = loc.search || "";
    }
    const parts = String(pathname).split("/").filter(Boolean);
    if (parts[0] === "r" && parts[1]) {
      const code = normalizeRoomCode(parts[1]);
      if (code) return code;
    }
    const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
    return normalizeRoomCode(params.get("room") || params.get("code") || "");
  }

  function gameOriginFrom(opts) {
    if (opts && opts.gameOrigin) return String(opts.gameOrigin).replace(/\/$/, "");
    if (typeof document !== "undefined") {
      const meta = document.querySelector('meta[name="ipl-game-origin"]');
      if (meta && meta.content) return String(meta.content).replace(/\/$/, "");
    }
    return DEFAULT_GAME;
  }

  function gameHref(origin, loc) {
    const base = String(origin || DEFAULT_GAME).replace(/\/$/, "");
    const code = parseRoom(loc);
    return code ? `${base}/r/${code}` : `${base}/`;
  }

  function clampIndex(i, length) {
    const n = Math.max(1, Number(length) || 0);
    const x = Number(i);
    if (!Number.isFinite(x)) return 0;
    return ((Math.trunc(x) % n) + n) % n;
  }

  function pickFactIndex(length, rand) {
    const n = Math.max(0, Number(length) || 0);
    if (!n) return 0;
    const raw = typeof rand === "function" ? Number(rand()) : Math.random();
    const unit = Number.isFinite(raw) ? raw - Math.floor(raw) : 0;
    const r = unit < 0 ? unit + 1 : unit;
    return Math.min(n - 1, Math.floor(r * n));
  }

  function pickFact(list, rand) {
    const facts = Array.isArray(list) && list.length ? list : FACTS;
    const index = pickFactIndex(facts.length, rand);
    return { fact: facts[index], index };
  }

  function factAt(index, list) {
    const facts = Array.isArray(list) && list.length ? list : FACTS;
    const i = clampIndex(index, facts.length);
    return facts[i] || facts[0];
  }

  function resolvedFactIndex(opts, list) {
    const facts = Array.isArray(list) && list.length ? list : FACTS;
    if (opts && Number.isFinite(opts.factIndex)) return clampIndex(opts.factIndex, facts.length);
    if (opts && Number.isFinite(opts.index)) return clampIndex(opts.index, facts.length);
    return pickFactIndex(facts.length, opts && opts.rand);
  }

  function markup(opts) {
    const title = (opts && opts.title) || "IPL Auction Night";
    const kicker = (opts && opts.kicker) || "Waking the auction";
    const note = (opts && opts.note) || "This can take about a minute if the server was napping.";
    const label = (opts && opts.factLabel) || FACT_LABEL;
    const facts = (opts && opts.facts) || FACTS;
    const fact = (opts && opts.fact) || factAt(resolvedFactIndex(opts, facts), facts);
    const text = fact && fact.text ? fact.text : "";
    return `<div class="ipl-wake" role="status" aria-live="polite">
      <div class="ipl-wake-brand">
        <svg class="ipl-wake-ball" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="15" fill="#c41212"/>
          <path d="M9 3.8c5.4 4.2 5.4 20.2 0 24.4" fill="none" stroke="#f4f7ff" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M23 3.8c-5.4 4.2-5.4 20.2 0 24.4" fill="none" stroke="#f4f7ff" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <div>
          <p class="ipl-wake-kicker">${escapeHtml(kicker)}</p>
          <h1>${escapeHtml(title)}</h1>
        </div>
      </div>
      <figure class="ipl-wake-card">
        <p class="ipl-wake-fact-label">${escapeHtml(label)}</p>
        <blockquote class="ipl-wake-fact" id="ipl-wake-fact">${escapeHtml(text)}</blockquote>
      </figure>
      <div class="ipl-wake-progress" aria-hidden="true">
        <span class="ipl-wake-stumps"><i></i><i></i><i></i></span>
        <span class="ipl-wake-ball-run"></span>
      </div>
      <p class="ipl-wake-line" id="ipl-wake-line">${escapeHtml(LINES[0])}</p>
      <p class="ipl-wake-note">${escapeHtml(note)}</p>
    </div>`;
  }

  async function ping(origin) {
    const url = String(origin || "").replace(/\/$/, "") + "/healthz";
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, PING_TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: "GET", mode: "cors", cache: "no-store", signal: ctrl ? ctrl.signal : undefined });
      if (!res.ok) return false;
      const body = await res.json().catch(() => null);
      return Boolean(body && body.ok);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  function create(opts) {
    const options = opts || {};
    const root = options.root;
    if (!root) throw new Error("IplWakeLoader needs a root element.");
    const facts = Array.isArray(options.facts) && options.facts.length ? options.facts : FACTS;
    let factIndex = resolvedFactIndex(options, facts);
    let lineIndex = 0;
    let rotateTimer = null;
    let pingTimer = null;
    let showTimer = null;
    let hidden = true;
    let pinging = false;

    root.innerHTML = markup({
      ...options,
      fact: facts[factIndex],
      factLabel: options.factLabel || FACT_LABEL,
    });
    root.classList.add("ipl-wake-root");

    function paint() {
      const block = root.querySelector("#ipl-wake-fact");
      const line = root.querySelector("#ipl-wake-line");
      const fact = facts[factIndex];
      if (block && fact) block.textContent = fact.text;
      if (line) line.textContent = LINES[lineIndex % LINES.length];
      root.dataset.fact = String(factIndex);
    }

    function step() {
      lineIndex = (lineIndex + 1) % LINES.length;
      paint();
    }

    function startRotate() {
      stopRotate();
      if (options.paused) return;
      rotateTimer = setInterval(step, options.rotateMs || ROTATE_MS);
    }

    function stopRotate() {
      if (rotateTimer) {
        clearInterval(rotateTimer);
        rotateTimer = null;
      }
    }

    async function tickPing() {
      if (pinging || options.mode !== "redirect") return;
      pinging = true;
      const origin = gameOriginFrom(options);
      const ok = await ping(origin);
      pinging = false;
      if (!ok) return;
      const href = gameHref(origin, options.location || (typeof location !== "undefined" ? location : ""));
      if (options.onReady) options.onReady(href);
      else if (typeof location !== "undefined") location.replace(href);
    }

    function startPing() {
      stopPing();
      if (options.mode !== "redirect") return;
      tickPing();
      pingTimer = setInterval(tickPing, options.pingMs || PING_MS);
    }

    function stopPing() {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
    }

    function show() {
      hidden = false;
      root.hidden = false;
      root.classList.add("is-on");
      paint();
      startRotate();
      startPing();
    }

    function hide() {
      hidden = true;
      root.classList.remove("is-on");
      root.hidden = true;
      stopRotate();
      stopPing();
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
    }

    function setIndex(i) {
      factIndex = clampIndex(i, facts.length);
      paint();
    }

    paint();
    if (options.autoShow !== false) {
      const delay = options.showDelayMs != null ? options.showDelayMs : SHOW_DELAY_MS;
      if (delay <= 0) show();
      else showTimer = setTimeout(show, delay);
    }

    return {
      show,
      hide,
      setIndex,
      setFactIndex: setIndex,
      step,
      paint,
      get index() { return factIndex; },
      get factIndex() { return factIndex; },
      get hidden() { return hidden; },
      facts,
      root,
    };
  }

  return {
    ROTATE_MS,
    PING_MS,
    FACT_LABEL,
    FACTS,
    LINES,
    escapeHtml,
    normalizeRoomCode,
    parseRoom,
    gameHref,
    gameOriginFrom,
    pickFactIndex,
    pickFact,
    factAt,
    ping,
    markup,
    create,
    show(opts) { return create({ autoShow: true, showDelayMs: 0, ...(opts || {}) }); },
  };
});
