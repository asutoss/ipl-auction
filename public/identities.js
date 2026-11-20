/**
 * Backward-compatible aliases for the character catalogue in characters.js.
 * Prefer IplCharacters (getCharacter, characterImg, CHARACTERS) in new code.
 */
(function (root, factory) {
  const chars = (typeof require === "function" && typeof module === "object")
    ? require("./characters")
    : root.IplCharacters;
  const lib = factory(chars);
  if (typeof module === "object" && module.exports) module.exports = lib;
  else root.IplIdentities = lib;
})(typeof self !== "undefined" ? self : this, function (chars) {
  if (!chars) {
    throw new Error("characters.js must be loaded before identities.js");
  }
  return chars;
});
