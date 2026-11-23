/**
 * Room invite URLs and WhatsApp share text.
 * Path form: /r/ABC123  (also accepts ?room=ABC123)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IplRoomLink = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const ROOM_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
  const SHARE_TEXT_PREFIX = "Join my IPL Auction room 🏏";

  function normalizeRoomCode(raw) {
    const code = String(raw || "").trim().toUpperCase();
    return ROOM_CODE_RE.test(code) ? code : null;
  }

  function roomPath(code) {
    const c = normalizeRoomCode(code);
    return c ? `/r/${c}` : "/";
  }

  function roomUrl(origin, code) {
    const base = String(origin || "").replace(/\/$/, "");
    const c = normalizeRoomCode(code);
    if (!base || !c) return "";
    return `${base}/r/${c}`;
  }

  function parseRoomCode(loc) {
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
    const query = String(search || "");
    const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
    return normalizeRoomCode(params.get("room") || params.get("code") || "");
  }

  function shareMessage(link) {
    return `${SHARE_TEXT_PREFIX} ${link}`;
  }

  function whatsAppShareUrl(link) {
    return `https://wa.me/?text=${encodeURIComponent(shareMessage(link))}`;
  }

  return {
    ROOM_CODE_ALPHABET,
    SHARE_TEXT_PREFIX,
    normalizeRoomCode,
    roomPath,
    roomUrl,
    parseRoomCode,
    shareMessage,
    whatsAppShareUrl,
  };
});
