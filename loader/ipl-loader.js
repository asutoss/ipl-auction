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
    { text: "After the hammer came down on a ₹20 lakh bid for Shashank Singh at the 2024 auction, Punjab Kings tried to take the buy back, citing confusion with another player of the same name; the auctioneer would not reverse it. He later scored 354 runs at a strike-rate of 164.65 for them that season." },
    { text: "In the middle of a bidding war for Wanindu Hasaranga at the 2022 mega auction, auctioneer Hugh Edmeades collapsed on stage after a drop in blood pressure, and the sale was paused for more than an hour. Broadcaster Charu Sharma, called from lunch at home and told to “just get into a suit and come,” finished the day; Edmeades returned at the end of day two to a standing ovation." },
    { text: "At the 2010 IPL auction, not one of the 11 Pakistani players on the list — including World Twenty20 winners Shahid Afridi, Umar Gul and Sohail Tanvir — received a bid, even though franchises had earlier asked for those names to be included." },
    { text: "Chris Gayle went unsold at the 2011 auction at a base price of US$400,000, then joined Royal Challengers Bangalore mid-season as a replacement for injured Dirk Nannes. He scored 608 runs, including two centuries, in 12 matches and topped the tournament’s run-charts." },
    { text: "Phil Salt went unsold at the 2024 auction, then joined Kolkata Knight Riders as a replacement for Jason Roy and helped them win the title. A year later, Royal Challengers Bengaluru bought him for ₹11.50 crore." },
    { text: "Rajat Patidar went unsold at the 2022 mega auction, then joined Royal Challengers Bangalore as a replacement for Luvnith Sisodia. He scored an unbeaten 112 off 54 balls in the Eliminator, the first century by an uncapped player in an IPL playoff." },
    { text: "Imran Tahir, then ranked the world’s top bowler in both ODIs and T20Is, went unsold at the 2017 auction at a base price of just ₹50 lakh. Rising Pune Supergiant later signed him as a replacement, and he took 3 for 28 in their opening win." },
    { text: "Harshal Patel, who had been with Royal Challengers Bangalore on a ₹20 lakh salary in 2021, was bought by the same franchise at the 2022 mega auction for ₹10.75 crore — a 5,275% rise, or 53.75 times his previous pay." },
    { text: "Rajasthan Royals bought Prasidh Krishna for ₹10 crore in 2022, fifty times the ₹20 lakh base price Kolkata Knight Riders had paid for him in 2018." },
    { text: "Krishnappa Gowtham, bought by Chennai Super Kings for ₹9.25 crore in 2021, went to Lucknow Super Giants for ₹90 lakh at the next year’s mega auction — a 90.27% cut, the steepest of that sale." },
    { text: "Tymal Mills, bought by Royal Challengers Bangalore for ₹12 crore at the 2017 auction, returned in 2022 when Mumbai Indians signed him for ₹1.5 crore." },
    { text: "When two or more teams hit the salary cap in early IPL auctions, a secret sealed-bid tie-breaker decided the sale, and any amount above the cap went to the BCCI, not the player. Only three players were ever bought that way: Kieron Pollard and Shane Bond in 2010, and Ravindra Jadeja in 2012, when Chennai Super Kings and Deccan Chargers both bid their entire US$2 million purses." },
    { text: "The Jaipur franchise, later Rajasthan Royals, spent only US$2.925 million at the first IPL auction, below the mandatory US$3.3 million minimum, and was required to pay the difference." },
    { text: "Delhi Capitals finished the 2024 auction with ₹9.90 crore unspent, the most of any franchise, with Gujarat Titans next on ₹7.85 crore." },
    { text: "Punjab Kings released Shahrukh Khan after buying him for ₹5.25 crore in 2021, then bought him back at the 2022 mega auction for ₹9 crore after a bidding war." },
    { text: "Gujarat Titans released Alzarri Joseph, whom they had bought for ₹2.4 crore in 2022; Royal Challengers Bangalore then paid ₹11.50 crore for him at the 2024 auction." },
    { text: "At the 2026 mini-auction, Chennai Super Kings paid ₹14.20 crore each for uncapped Indians Prashant Veer and Kartik Sharma, who had a base price of ₹30 lakh — more than England all-rounder Liam Livingstone’s ₹13 crore bid at the same sale." },
    { text: "Lucknow Super Giants bought uncapped pacer Avesh Khan for ₹10 crore at the 2022 mega auction, then a record for an uncapped Indian player." },
    { text: "Jaydev Unadkat was sold at IPL auctions for a tenth time in 2022, more often than any other player. Dinesh Karthik and Nathan Coulter-Nile were next, on seven sales each." },
    { text: "IPL rules say a mid-season replacement cannot be signed for more than the injured player’s auction fee — which is why Royal Challengers Bangalore could bring in unsold Chris Gayle in 2011: Dirk Nannes had been bought for US$650,000." },
    { text: "At IPL mini-auctions, an overseas player’s salary is capped at ₹18 crore even if the winning bid is higher, with the excess going to the BCCI for player welfare. That is why Cameron Green’s ₹25.20 crore sale to Kolkata Knight Riders in December 2025 did not all reach him." },
    { text: "In the first IPL auction, if a player was expected to miss the season or play fewer than four games, only 25% of his fee counted against the franchise’s US$5 million cap, which is how several teams appeared to bid above the official limit." },
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
