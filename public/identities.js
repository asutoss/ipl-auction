/**
 * Team logo themes and local image URLs.
 * Images live in /logos/*.webp (see /logos/SOURCES.md). Shared by server and client.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IplIdentities = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const IDENTITIES = [
    { id: "mickey-mouse", character: "Mickey Mouse", color: "#DC143C", color2: "#F9D5DC", ink: "#30040D", text: "#E65673" },
    { id: "spongebob", character: "SpongeBob", color: "#F5D000", color2: "#FDF7D1", ink: "#362E00", text: "#F5D000" },
    { id: "bugs-bunny", character: "Bugs Bunny", color: "#B0B7C3", color2: "#F1F2F4", ink: "#27282B", text: "#B0B7C3" },
    { id: "pikachu", character: "Pikachu", color: "#E8A100", color2: "#FBEED1", ink: "#332300", text: "#E8A100" },
    { id: "doraemon", character: "Doraemon", color: "#2A6DFF", color2: "#D9E5FF", ink: "#091838", text: "#6696FF" },
    { id: "shin-chan", character: "Shin-chan", color: "#FF451A", color2: "#FFDED6", ink: "#380F06", text: "#FF795A" },
    { id: "shrek", character: "Shrek", color: "#4A8A1E", color2: "#DEEAD6", ink: "#101E07", text: "#8ED44A" },
    { id: "minion", character: "Minion", color: "#163A7A", color2: "#FFE45C", ink: "#0A1E5C", text: "#6B8CFF" },
    { id: "chhota-bheem", character: "Chhota Bheem", color: "#E85D00", color2: "#FBE2D1", ink: "#331400", text: "#FF8A33" },
    { id: "narendra-modi", character: "Narendra Modi", color: "#FF9933", color2: "#FFEDDA", ink: "#38220B", text: "#FF9933" },
    { id: "prabhas", character: "Prabhas", color: "#A32112", color2: "#EED7D4", ink: "#240704", text: "#BD5F54" },
    { id: "orry", character: "Orry", color: "#8BCF17", color2: "#EAF6D5", ink: "#1F2E05", text: "#8BCF17" },
    { id: "dolly-chaiwala", character: "Dolly Chaiwala", color: "#6B3F14", color2: "#F0E0C8", ink: "#2A1608", text: "#D4A574" },
    { id: "amitabh-bachchan", character: "Amitabh Bachchan", color: "#4A0D1C", color2: "#1C0A10", ink: "#F3D38A", text: "#E8C547" },
    { id: "jay-shah", character: "Jay Shah", color: "#0E7490", color2: "#D4E6EB", ink: "#031A20", text: "#519BAF" },
    { id: "samay-raina", character: "Samay Raina", color: "#C026D3", color2: "#F4D8F7", ink: "#2A082E", text: "#D263DF" },
    { id: "elvish-yadav", character: "Elvish Yadav", color: "#047857", color2: "#D2E7E1", ink: "#011A13", text: "#4A9E86" },
    { id: "puneet-superstar", character: "Puneet Superstar", color: "#DB2777", color2: "#F9D8E7", ink: "#30091A", text: "#E5639D" },
    { id: "ranveer-allahbadia", character: "Ranveer Allahbadia", color: "#6D28D9", color2: "#E5D8F8", ink: "#180930", text: "#9664E4" },
    { id: "salman-khan", character: "Salman Khan", color: "#2C3E50", color2: "#1A2530", ink: "#0B1220", text: "#8FA4B8" },
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
    return `<img src="${esc(logoUrl(pack))}" alt="${alt}" class="${cls}" width="256" height="256" decoding="async" draggable="false" />`;
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
