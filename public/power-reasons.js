/**
 * Map server canUsePower errors (and a few local busy flags) to a short
 * line shown under the Power button when it is disabled.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IplPowerReasons = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const RULES = [
    { re: /already used your power/i, short: "Used already" },
    { re: /already been used on this lot/i, short: "One power per lot, already used" },
    { re: /introduced/i, short: "Not during intro" },
    { re: /paused/i, short: "Paused" },
    { re: /next player is on the block|sold reveal|wait until the next player/i, short: "Lot sold" },
    { re: /cannot afford|can't afford/i, short: "Can't afford" },
    { re: /banned/i, short: "Banned" },
    { re: /eliminated/i, short: "Eliminated" },
    { re: /squad is already complete/i, short: "Squad full" },
    { re: /vfx|hidden lot/i, short: "Hidden lot (VFX)" },
    { re: /next lot's power slot/i, short: "Wait for the next lot" },
    { re: /only be used during the auction/i, short: "Only during auction" },
    { re: /last team's remaining players|squad fill/i, short: "Squad being filled" },
    { re: /already being revealed|is being revealed|is on screen/i, short: "A power is on screen" },
    { re: /waiting for a choice/i, short: "A power is waiting" },
    { re: /game has ended|game over/i, short: "Game over" },
    { re: /no player is on the block/i, short: "No player on the block" },
    { re: /no other power is valid|no recently sold|no team has|no rival|no other team|no upcoming|not available|too small to wipe|at least two/i, short: "No valid target" },
    { re: /blocked from bidding/i, short: "Can't bid this lot" },
    { re: /no valid target/i, short: "No valid target" },
  ];

  function shortenPowerReason(reason) {
    const text = String(reason || "").trim();
    if (!text) return null;
    for (const rule of RULES) {
      if (rule.re.test(text)) return rule.short;
    }
    return text;
  }

  return { shortenPowerReason, POWER_REASON_RULES: RULES };
});
