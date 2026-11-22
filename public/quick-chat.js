/**
 * Pre-written funny dialogue lines for power waits (Dolly pause, pickers, Rakhi choice).
 * Shared by server and client. Keep the meme tone; no free-text chat.
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === "object" && module.exports) module.exports = lib;
  else root.IplQuickChat = lib;
})(typeof self !== "undefined" ? self : this, function () {
  const QUICK_CHAT_COOLDOWN_MS = 2000;

  const QUICK_CHAT_LINES = [
    { id: "thik_hai", text: "Thik hai, thik hai" },
    { id: "elvish_bhai", text: "Elvish bhaiiii!" },
    { id: "nation_wants", text: "The nation wants to know" },
    { id: "lock_kiya", text: "Lock kiya jaaye?" },
    { id: "cutting_aur", text: "Ek cutting aur" },
    { id: "just_a_liver", text: "I'm just a liver" },
    { id: "jhand_ba", text: "Zindagi jhand ba" },
    { id: "script_likhi", text: "Script pehle se likhi hai" },
    { id: "parents_sawaal", text: "Parents wala sawaal aa gaya" },
    { id: "vfx_loading", text: "VFX loading…" },
    { id: "match_fixing", text: "Banned for match fixing already?" },
    { id: "chai_break", text: "Chai break le lo" },
    { id: "red_button", text: "Big red button mat dabaana" },
    { id: "kahan_points", text: "Kahan hai points?" },
    { id: "hahaha", text: "Ha ha ha" },
  ];

  const byId = Object.fromEntries(QUICK_CHAT_LINES.map((l) => [l.id, l]));

  function isValidQuickChatId(id) {
    return Boolean(id && byId[id]);
  }

  function getQuickChat(id) {
    return byId[id] || null;
  }

  return {
    QUICK_CHAT_COOLDOWN_MS,
    QUICK_CHAT_LINES,
    isValidQuickChatId,
    getQuickChat,
  };
});
