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

  const MEMES = [
    { src: "memes/wifi-19th.svg", caption: "19th over, and the Wi-Fi has gone for a duck.", alt: "A fan yells at a smoking router while the match on TV is stuck on 18.5 overs." },
    { src: "memes/chai-timeout.svg", caption: "Strategic timeout is just chai with extra branding.", alt: "A kettle wearing cricket pads next to a helmet-shaped chai mug." },
    { src: "memes/mom-dinner.svg", caption: "Dinner can wait. The last over of the auction cannot.", alt: "Mom calls for dinner while a fan holds up an auction paddle." },
    { src: "memes/purse-two.svg", caption: "Purse left: 2 points. Still need a keeper, two bowlers, and a miracle.", alt: "A checklist of unsold squad gaps beside a purse of two points." },
    { src: "memes/default-bid.svg", caption: "Looked away for one second. The default bid did not.", alt: "A shocked fan sees a mystery player sold to them at base price." },
    { src: "memes/third-umpire-tea.svg", caption: "Third umpire is at the tea stall. Soft signal: samosa.", alt: "An empty third-umpire chair while the official is at a chai stall." },
    { src: "memes/server-napping.svg", caption: "The server is taking a well-earned nap at long off.", alt: "A sleeping computer in a cricket cap on the boundary at long off." },
    { src: "memes/no-ball-spinup.svg", caption: "No ball! Replay the spin-up.", alt: "An umpire signals no-ball as a cricket ball with a power button flies by." },
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

  function assetUrl(file, base) {
    const root = String(base || "").replace(/\/?$/, "/");
    return root + String(file).replace(/^\//, "");
  }

  function memeList(base) {
    return MEMES.map((m) => ({ ...m, src: assetUrl(m.src, base) }));
  }

  function markup(opts) {
    const base = (opts && opts.assetBase) || "";
    const title = (opts && opts.title) || "IPL Auction Night";
    const kicker = (opts && opts.kicker) || "Waking the auction";
    const note = (opts && opts.note) || "This can take about a minute if the server was napping.";
    const memes = memeList(base);
    const first = memes[0];
    return `<div class="ipl-wake" role="status" aria-live="polite">
      <div class="ipl-wake-brand">
        <svg class="ipl-wake-ball" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="15" fill="#c41212"/>
          <path d="M9 3.8c5.4 4.2 5.4 20.2 0 24.4" fill="none" stroke="#f4f7ff" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M23 3.8c-5.4 4.2-5.4 20.2 0 24.4" fill="none" stroke="#f4f7ff" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <div>
          <p class="ipl-wake-kicker">${kicker}</p>
          <h1>${title}</h1>
        </div>
      </div>
      <figure class="ipl-wake-card">
        <div class="ipl-wake-frame">
          <img id="ipl-wake-img" src="${first.src}" alt="${first.alt}">
        </div>
        <figcaption id="ipl-wake-caption">${first.caption}</figcaption>
      </figure>
      <div class="ipl-wake-progress" aria-hidden="true">
        <span class="ipl-wake-stumps"><i></i><i></i><i></i></span>
        <span class="ipl-wake-ball-run"></span>
      </div>
      <p class="ipl-wake-line" id="ipl-wake-line">${LINES[0]}</p>
      <p class="ipl-wake-note">${note}</p>
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
    const assetBase = options.assetBase != null ? options.assetBase : "";
    const memes = memeList(assetBase);
    let index = Number.isFinite(options.index) ? ((options.index % memes.length) + memes.length) % memes.length : 0;
    let lineIndex = 0;
    let rotateTimer = null;
    let pingTimer = null;
    let showTimer = null;
    let hidden = true;
    let pinging = false;

    root.innerHTML = markup({
      ...options,
      assetBase,
    });
    root.classList.add("ipl-wake-root");

    function paint() {
      const img = root.querySelector("#ipl-wake-img");
      const cap = root.querySelector("#ipl-wake-caption");
      const line = root.querySelector("#ipl-wake-line");
      const meme = memes[index];
      if (img && meme) {
        img.src = meme.src;
        img.alt = meme.alt;
      }
      if (cap && meme) cap.textContent = meme.caption;
      if (line) line.textContent = LINES[lineIndex % LINES.length];
      root.dataset.meme = String(index);
    }

    function step() {
      index = (index + 1) % memes.length;
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
      index = ((Number(i) || 0) % memes.length + memes.length) % memes.length;
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
      step,
      paint,
      get index() { return index; },
      get hidden() { return hidden; },
      memes,
      root,
    };
  }

  return {
    ROTATE_MS,
    PING_MS,
    MEMES,
    LINES,
    normalizeRoomCode,
    parseRoom,
    gameHref,
    gameOriginFrom,
    ping,
    markup,
    create,
    show(opts) { return create({ autoShow: true, showDelayMs: 0, ...(opts || {}) }); },
  };
});
