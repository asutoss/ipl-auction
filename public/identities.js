/**
 * Cartoon character logo themes and local image URLs.
 * Images live in /logos/*.webp (see /logos/SOURCES.md). Shared by server and client.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IplIdentities = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const IDENTITIES = [
    { id: "mickey-mouse", character: "Mickey Mouse", color: "#DC143C", color2: "#FFE6EA", ink: "#2A070A", text: "#FF6B7A" },
    { id: "donald-duck", character: "Donald Duck", color: "#3A9FDB", color2: "#E5F5FF", ink: "#083049", text: "#7EC8F0" },
    { id: "spongebob", character: "SpongeBob", color: "#F5D000", color2: "#FFF6BF", ink: "#3D2E00", text: "#F5D000" },
    { id: "patrick", character: "Patrick", color: "#FF6B8B", color2: "#FFE4EB", ink: "#4A1020", text: "#FF8FA6" },
    { id: "tom", character: "Tom", color: "#5D7A8A", color2: "#E3EDF2", ink: "#1C2A32", text: "#9CB8C6" },
    { id: "jerry", character: "Jerry", color: "#A15A2C", color2: "#F3E0C9", ink: "#2E1608", text: "#D4925A" },
    { id: "bugs-bunny", character: "Bugs Bunny", color: "#B0B7C3", color2: "#F3F5F8", ink: "#2A2E36", text: "#C5CAD3" },
    { id: "pikachu", character: "Pikachu", color: "#E8A100", color2: "#FFF3C6", ink: "#3A2A00", text: "#F0B429" },
    { id: "doraemon", character: "Doraemon", color: "#2A6DFF", color2: "#D9E6FF", ink: "#0A2060", text: "#7AA3FF" },
    { id: "shin-chan", character: "Shin-chan", color: "#FF451A", color2: "#FFD8CE", ink: "#3A0C08", text: "#FF6A52" },
    { id: "popeye", character: "Popeye", color: "#163A5F", color2: "#D5E5F4", ink: "#071422", text: "#8FB3D4" },
    { id: "scooby-doo", character: "Scooby-Doo", color: "#0F8A7A", color2: "#D4F0EB", ink: "#04302B", text: "#3DD1BE" },
    { id: "homer-simpson", character: "Homer Simpson", color: "#B8860B", color2: "#FFF0C4", ink: "#3A2A00", text: "#E0B13A" },
    { id: "shrek", character: "Shrek", color: "#4A8A1E", color2: "#E3F4C8", ink: "#1A3008", text: "#8ED44A" },
    { id: "minion", character: "Minion", color: "#1D4ED8", color2: "#FFE45C", ink: "#0A1E5C", text: "#6B8CFF" },
    { id: "pink-panther", character: "Pink Panther", color: "#C4006E", color2: "#FFD6EC", ink: "#3A0020", text: "#FF5AA8" },
    { id: "chhota-bheem", character: "Chhota Bheem", color: "#F06A00", color2: "#FFE3C4", ink: "#3A1A00", text: "#FF8A33" },
    { id: "motu-patlu", character: "Motu Patlu", color: "#6D28D9", color2: "#EDE4FF", ink: "#2A0A5C", text: "#A78BFA" },
    { id: "johnny-bravo", character: "Johnny Bravo", color: "#141414", color2: "#1C1810", ink: "#E8C547", text: "#E8C547" },
    { id: "garfield", character: "Garfield", color: "#C45C12", color2: "#FFE6C8", ink: "#3A1A08", text: "#E08A3A" },
  ];

  const byId = Object.fromEntries(IDENTITIES.map((t) => [t.id, t]));

  function getIdentity(id) {
    return byId[id] || null;
  }

  function unusedIdentities(takenIds) {
    const taken = takenIds instanceof Set ? takenIds : new Set(takenIds || []);
    return IDENTITIES.filter((t) => !taken.has(t.id));
  }

  function nextIdentity(takenIds) {
    return unusedIdentities(takenIds)[0] || null;
  }

  function publicIdentity(idOrPack) {
    const pack = typeof idOrPack === "string" ? getIdentity(idOrPack) : idOrPack;
    if (!pack) return null;
    return {
      id: pack.id,
      character: pack.character,
      color: pack.color,
      color2: pack.color2,
      ink: pack.ink,
      text: pack.text || pack.color,
      logo: "/logos/" + pack.id + ".webp",
    };
  }


  function esc(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function logoUrl(idOrPack) {
    const pack = typeof idOrPack === "string" ? getIdentity(idOrPack) : idOrPack;
    if (!pack || !pack.id) return "";
    return "/logos/" + pack.id + ".webp";
  }

  function logoImg(idOrPack, attrs) {
    const pack = typeof idOrPack === "string" ? getIdentity(idOrPack) : idOrPack;
    if (!pack) return "";
    const opt = attrs || {};
    const alt = esc(opt.alt != null ? opt.alt : pack.character || "");
    const cls = esc(opt.className || "team-mark-img");
    return `<img src="${esc(logoUrl(pack))}" alt="${alt}" class="${cls}" width="160" height="160" decoding="async" draggable="false" />`;
  }

  return {
    IDENTITIES,
    getIdentity,
    unusedIdentities,
    nextIdentity,
    publicIdentity,
    logoUrl,
    logoImg,
  };
});
