/**
 * Shared auction emoji catalogue. Phrase lines live on each character
 * in characters.js. Server validates ids; the client renders the picker
 * and the floating reactions from the same list.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IplEmotes = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const EMOTES = [
    { id: "laugh", kind: "emoji", glyph: "😂" },
    { id: "fire", kind: "emoji", glyph: "🔥" },
    { id: "cry", kind: "emoji", glyph: "😭" },
    { id: "clown", kind: "emoji", glyph: "🤡" },
    { id: "clap", kind: "emoji", glyph: "👏" },
    { id: "money", kind: "emoji", glyph: "💸" },
    { id: "mindblown", kind: "emoji", glyph: "🤯" },
    { id: "cool", kind: "emoji", glyph: "😎" },
  ];

  // Shared burst cap for emotes and pre-written lines (server-enforced).
  const EMOTE_RATE_MAX = 6;
  const EMOTE_RATE_WINDOW_MS = 10000;
  const EMOTE_DURATION_MS = 3200;
  const EMOTE_MAX_VISIBLE = 40;

  const EMOTE_IDS = new Set(EMOTES.map((e) => e.id));

  function getEmote(id) {
    return EMOTES.find((e) => e.id === id) || null;
  }

  function isValidEmoteId(id) {
    return typeof id === "string" && EMOTE_IDS.has(id);
  }

  function emojis() {
    return EMOTES.filter((e) => e.kind === "emoji");
  }

  function phrases() {
    return EMOTES.filter((e) => e.kind === "phrase");
  }

  return {
    EMOTES,
    EMOTE_IDS,
    EMOTE_RATE_MAX,
    EMOTE_RATE_WINDOW_MS,
    EMOTE_DURATION_MS,
    EMOTE_MAX_VISIBLE,
    getEmote,
    isValidEmoteId,
    emojis,
    phrases,
  };
});
