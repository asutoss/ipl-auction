/**
 * Official IPL headshots for the bidding screen.
 * The client hotlinks www.iplt20.com team-assets URLs recorded on each
 * player. A role-coloured initials/silhouette placeholder is used when
 * there is no URL, the image errors, it takes longer than 1.5s, or the
 * network is slow (in which case placeholders are used for the rest of
 * the session).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IplHeadshot = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const LOAD_TIMEOUT_MS = 1500;
  const SLOW_STREAK_LIMIT = 2;
  const SLOW_TYPES = { "slow-2g": true, "2g": true, "3g": true };
  const ROLES = { BAT: true, WK: true, AR: true, BOWL: true };

  const session = {
    usePlaceholdersThroughout: false,
    slowStreak: 0,
  };

  function officialHeadshotUrl(raw) {
    if (!raw || typeof raw !== "string") return null;
    try {
      const href = String(raw).trim().replace(/&amp;/g, "&");
      const u = new URL(href);
      if (u.hostname !== "www.iplt20.com") return null;
      if (u.pathname !== "/api/team-assets") return null;
      const pathname = decodeURIComponent(u.searchParams.get("pathname") || "");
      if (!/^player\/\d+\/\d+\/\d+\.png$/i.test(pathname)) return null;
      return `https://www.iplt20.com/api/team-assets?pathname=${pathname}&brand=ipl`;
    } catch {
      return null;
    }
  }

  function isOfficialHeadshotUrl(raw) {
    return Boolean(officialHeadshotUrl(raw));
  }

  function getConnection(conn) {
    if (conn) return conn;
    if (typeof navigator !== "undefined" && navigator.connection) return navigator.connection;
    return null;
  }

  function isSlowNetwork(conn) {
    const c = getConnection(conn);
    if (!c) return false;
    const type = String(c.effectiveType || "").toLowerCase();
    return Boolean(SLOW_TYPES[type] || c.saveData);
  }

  function resetSession() {
    session.usePlaceholdersThroughout = false;
    session.slowStreak = 0;
  }

  function noteLoadTiming({ elapsed = 0, error = false, timeout = false } = {}) {
    const slow = Boolean(timeout || elapsed > LOAD_TIMEOUT_MS);
    if (slow) {
      session.slowStreak += 1;
      if (session.slowStreak >= SLOW_STREAK_LIMIT) {
        session.usePlaceholdersThroughout = true;
      }
    } else if (!error) {
      session.slowStreak = 0;
    }
    return { slow, throughout: session.usePlaceholdersThroughout, streak: session.slowStreak };
  }

  function shouldUseOfficialImage(url, opts = {}) {
    if (opts.hidden || opts.vfxHidden) return false;
    const official = officialHeadshotUrl(url);
    if (!official) return false;
    if (session.usePlaceholdersThroughout) return false;
    if (isSlowNetwork(opts.conn)) {
      session.usePlaceholdersThroughout = true;
      return false;
    }
    return true;
  }

  function roleOf(role) {
    return ROLES[role] ? role : "UNK";
  }

  function initials(name) {
    const parts = String(name || "")
      .trim()
      .split(/[\s-]+/)
      .filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    const first = parts[0][0] || "";
    const last = parts[parts.length - 1][0] || "";
    return `${first}${last}`.toUpperCase();
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function silhouetteSvg() {
    return `<svg class="player-headshot-sil" viewBox="0 0 80 80" aria-hidden="true" focusable="false">
      <circle cx="40" cy="40" r="39" fill="none" />
      <path d="M40 16c-6.4 0-11.5 5.4-11.5 12.3 0 4.8 2.7 8.9 6.6 10.9-2.3.9-4.5 2-6.3 3.5-5.4 4.3-8.6 10.7-9.3 17.3-.2 1.6.9 2.5 2.4 2.5h36.2c1.5 0 2.6-.9 2.4-2.5-.7-6.6-3.9-13-9.3-17.3-1.8-1.5-4-2.6-6.3-3.5 3.9-2 6.6-6.1 6.6-10.9C51.5 21.4 46.4 16 40 16z" />
      <path d="M29.5 20.5c2.2-2.6 6-4 10.5-4 4.6 0 8.4 1.4 10.5 4 .4 1.6-.5 3.4-2.6 4.2-1.5-1.6-4.4-2.6-7.9-2.6s-6.4 1-7.9 2.6c-2.1-.8-3-2.6-2.6-4.2z" opacity=".9" />
    </svg>`;
  }

  function markup(player, opts = {}) {
    const hidden = Boolean(player && (player.vfxHidden || player.hidden || opts.hidden));
    const role = hidden ? "UNK" : roleOf(player && player.role);
    const name = hidden ? "" : (player && player.name) || "";
    const label = hidden ? "??" : initials(name) || "?";
    const idAttr = opts.id ? ` id="${esc(opts.id)}"` : "";
    // Never put a headshot URL in the DOM for a masked (VFX) player.
    return `<div class="player-headshot role-${esc(role)}${hidden ? " is-vfx" : ""}"${idAttr} data-role="${esc(role)}" role="img" aria-label="${esc(hidden ? "Hidden player" : name || "Player")}">
      <div class="player-headshot-fallback" aria-hidden="true">${silhouetteSvg()}<span class="player-headshot-initials">${esc(label)}</span></div>
    </div>`;
  }

  function mount(el, player, opts = {}) {
    if (!el) return null;
    const hidden = Boolean(player && (player.vfxHidden || player.hidden || opts.hidden));
    const tmp = document.createElement("div");
    tmp.innerHTML = markup(player, { ...opts, hidden });
    const wrap = tmp.firstElementChild;
    if (!wrap) return el;
    el.className = wrap.className;
    if (opts.id) el.id = opts.id;
    el.setAttribute("data-role", wrap.getAttribute("data-role") || "");
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", wrap.getAttribute("aria-label") || "");
    el.innerHTML = wrap.innerHTML;

    const url = officialHeadshotUrl(player && player.headshot);
    if (!shouldUseOfficialImage(url, { ...opts, hidden, vfxHidden: hidden, conn: opts.conn })) {
      return el;
    }
    attachImage(el, url, hidden ? "" : (player && player.name) || "");
    return el;
  }

  function attachImage(wrap, url, alt) {
    if (typeof document === "undefined") return;
    const started = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    const img = document.createElement("img");
    img.decoding = "async";
    img.loading = "eager";
    img.referrerPolicy = "no-referrer";
    img.alt = alt || "";
    img.width = 96;
    img.height = 96;
    img.draggable = false;
    let settled = false;
    const timer = setTimeout(() => finish({ timeout: true }), LOAD_TIMEOUT_MS);
    function elapsed() {
      const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      return now - started;
    }
    function finish({ error = false, timeout = false } = {}) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const ms = elapsed();
      noteLoadTiming({ elapsed: ms, error, timeout });
      if (error || timeout) {
        if (img.parentNode) img.remove();
        return;
      }
      img.classList.add("is-ready");
    }
    img.addEventListener("load", () => finish({}));
    img.addEventListener("error", () => finish({ error: true }));
    wrap.appendChild(img);
    img.src = url;
    return img;
  }

  function prefetch(url, opts = {}) {
    if (!shouldUseOfficialImage(url, opts)) return false;
    if (typeof Image === "undefined") return false;
    const official = officialHeadshotUrl(url);
    const img = new Image();
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.src = official;
    return true;
  }

  return {
    LOAD_TIMEOUT_MS,
    SLOW_STREAK_LIMIT,
    session,
    officialHeadshotUrl,
    isOfficialHeadshotUrl,
    isSlowNetwork,
    resetSession,
    noteLoadTiming,
    shouldUseOfficialImage,
    initials,
    roleOf,
    markup,
    mount,
    prefetch,
  };
});
