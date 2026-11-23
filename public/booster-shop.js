/**
 * Per-viewer booster shop: buyable first (price desc), then unbuyable
 * (price desc). Ties break on measured impact, highest first.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IplBoosterShop = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function impactScore(item) {
    return Number(item && item.impact && item.impact.score) || 0;
  }

  function ownedIds(you) {
    return new Set(((you && you.boosters) || []).map((b) => b && b.id).filter(Boolean));
  }

  function boosterShopReason(item, you) {
    if (!item) return "";
    const have = ownedIds(you).has(item.id);
    if (have) return "Owned";
    if (you && you.eliminated) return "Eliminated";
    if (you && (Number(you.purseLakhs) || 0) < (Number(item.pricePoints) || 0)) return "Not enough points";
    if (!you) return "Not enough points";
    return "";
  }

  function isBoosterBuyable(item, you) {
    return Boolean(you && !you.eliminated && !ownedIds(you).has(item && item.id) && (Number(you.purseLakhs) || 0) >= (Number(item && item.pricePoints) || 0));
  }

  function compareBoosterShop(a, b, you) {
    const canA = isBoosterBuyable(a, you);
    const canB = isBoosterBuyable(b, you);
    if (canA !== canB) return canA ? -1 : 1;
    const priceA = Number(a && a.pricePoints) || 0;
    const priceB = Number(b && b.pricePoints) || 0;
    if (priceA !== priceB) return priceB - priceA;
    return impactScore(b) - impactScore(a);
  }

  function sortBoosterShop(list, you) {
    return (list || []).slice().sort((a, b) => compareBoosterShop(a, b, you));
  }

  return { isBoosterBuyable, boosterShopReason, compareBoosterShop, sortBoosterShop };
});
