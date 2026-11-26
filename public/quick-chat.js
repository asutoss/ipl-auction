/**
 * Character-line helpers and the cooldown used during power waits.
 * Lines themselves live on the character catalogue (characters.js).
 * Shared by server and client. Keep the meme tone; no free-text chat.
 */
(function (root, factory) {
  const chars = (typeof require === "function" && typeof module === "object")
    ? require("./characters")
    : root.IplCharacters;
  const lib = factory(chars);
  if (typeof module === "object" && module.exports) module.exports = lib;
  else root.IplQuickChat = lib;
})(typeof self !== "undefined" ? self : this, function (chars) {
  if (!chars) {
    throw new Error("characters.js must be loaded before quick-chat.js");
  }

  const QUICK_CHAT_COOLDOWN_MS = 1000;

  function linesFor(characterId) {
    return chars.characterLines(characterId);
  }

  function isValidQuickChatId(id, characterId) {
    return Boolean(characterId && chars.isCharacterLine(characterId, id));
  }

  function getQuickChat(id, characterId) {
    if (characterId) return chars.getCharacterLine(characterId, id);
    return chars.findLine(id);
  }

  return {
    QUICK_CHAT_COOLDOWN_MS,
    linesFor,
    isValidQuickChatId,
    getQuickChat,
  };
});
