/**
 * Shared auction emote catalogue. Server validates ids; the client
 * renders the picker and the floating reactions from the same list.
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
    { id: "overpaid", kind: "phrase", text: "Overpaid! 💸" },
    { id: "steal", kind: "phrase", text: "Steal deal 🤑" },
    { id: "bhai-kya", kind: "phrase", text: "Bhai kya kar raha hai?" },
    { id: "paisa-barbaad", kind: "phrase", text: "Paisa barbaad" },
    { id: "ee-sala", kind: "phrase", text: "Ee sala cup namde" },
    { id: "kya-player", kind: "phrase", text: "Kya player hai!" },
    { id: "chahiye-tha", kind: "phrase", text: "Mujhe toh ye chahiye tha 😭" },
    { id: "bas-kar", kind: "phrase", text: "Bas kar bhai" },
  ];

  const EMOTE_COOLDOWN_MS = 2000;
  const EMOTE_DURATION_MS = 2000;
  const EMOTE_MAX_VISIBLE = 4;

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
    EMOTE_COOLDOWN_MS,
    EMOTE_DURATION_MS,
    EMOTE_MAX_VISIBLE,
    getEmote,
    isValidEmoteId,
    emojis,
    phrases,
  };
});
