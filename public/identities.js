/**
 * Original cartoon-character logo marks and colour themes.
 * Simple geometric caricatures only — no official artwork, trademarks, or downloads.
 * Shared by the server (metadata) and the client (inline SVG).
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
    };
  }

  function esc(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function frame(pack, inner) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" class="team-mark" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="${esc(pack.color2)}"/>
      <rect x="2" y="2" width="60" height="60" rx="14" fill="none" stroke="${esc(pack.color)}" stroke-width="2.5"/>
      ${inner}
    </svg>`;
  }

  const DRAW = {
    "mickey-mouse": (p) => frame(p, `
      <circle cx="18" cy="18" r="11" fill="${esc(p.ink)}"/>
      <circle cx="46" cy="18" r="11" fill="${esc(p.ink)}"/>
      <circle cx="32" cy="34" r="16" fill="${esc(p.ink)}"/>
      <ellipse cx="32" cy="38" rx="11" ry="9" fill="${esc(p.color2)}"/>
      <circle cx="27" cy="36" r="2.2" fill="${esc(p.ink)}"/>
      <circle cx="37" cy="36" r="2.2" fill="${esc(p.ink)}"/>
      <path d="M26 43c3 3 9 3 12 0" fill="none" stroke="${esc(p.color)}" stroke-width="2" stroke-linecap="round"/>
      <path d="M22 52h20l-3 6H25z" fill="${esc(p.color)}"/>
    `),
    "donald-duck": (p) => frame(p, `
      <ellipse cx="32" cy="36" rx="14" ry="13" fill="#F7FBFF"/>
      <path d="M18 24c0-8 6-14 14-14 6 0 10 3 12 7l-7 3c-1-3-3-5-5-5-5 0-8 3-8 8z" fill="${esc(p.color)}"/>
      <circle cx="30" cy="22" r="2.2" fill="#F7FBFF"/>
      <ellipse cx="38" cy="38" rx="10" ry="5" fill="${esc(p.color)}"/>
      <circle cx="26" cy="33" r="2" fill="${esc(p.ink)}"/>
      <circle cx="34" cy="33" r="2" fill="${esc(p.ink)}"/>
      <path d="M24 48c4 6 12 6 16 0" fill="none" stroke="${esc(p.color)}" stroke-width="3" stroke-linecap="round"/>
    `),
    "spongebob": (p) => frame(p, `
      <rect x="16" y="12" width="32" height="32" rx="4" fill="${esc(p.color)}"/>
      <circle cx="22" cy="20" r="1.6" fill="${esc(p.ink)}" opacity="0.35"/>
      <circle cx="44" cy="18" r="1.4" fill="${esc(p.ink)}" opacity="0.35"/>
      <circle cx="42" cy="36" r="1.8" fill="${esc(p.ink)}" opacity="0.35"/>
      <circle cx="20" cy="34" r="1.3" fill="${esc(p.ink)}" opacity="0.35"/>
      <circle cx="26" cy="28" r="5" fill="#fff"/>
      <circle cx="38" cy="28" r="5" fill="#fff"/>
      <circle cx="26" cy="28" r="2" fill="${esc(p.ink)}"/>
      <circle cx="38" cy="28" r="2" fill="${esc(p.ink)}"/>
      <rect x="28" y="36" width="3.2" height="5" rx="0.6" fill="#fff"/>
      <rect x="33" y="36" width="3.2" height="5" rx="0.6" fill="#fff"/>
      <rect x="18" y="44" width="28" height="8" rx="1" fill="#8B3A1A"/>
      <rect x="18" y="50" width="28" height="6" fill="#3A5FBF"/>
    `),
    "patrick": (p) => frame(p, `
      <path d="M32 10 L40 28 L56 30 L42 40 L48 56 L32 46 L16 56 L22 40 L8 30 L24 28 Z" fill="${esc(p.color)}"/>
      <circle cx="27" cy="32" r="2.4" fill="${esc(p.ink)}"/>
      <circle cx="37" cy="32" r="2.4" fill="${esc(p.ink)}"/>
      <path d="M26 40c3 4 9 4 12 0" fill="none" stroke="${esc(p.ink)}" stroke-width="2" stroke-linecap="round"/>
      <path d="M24 50h16v6H24z" fill="#7CF0A0"/>
    `),
    "tom": (p) => frame(p, `
      <ellipse cx="32" cy="36" rx="16" ry="15" fill="${esc(p.color)}"/>
      <path d="M14 30 L16 10 L28 22 Z" fill="${esc(p.color)}"/>
      <path d="M50 30 L48 10 L36 22 Z" fill="${esc(p.color)}"/>
      <path d="M18 26 L24 18 L26 24" fill="${esc(p.color2)}"/>
      <path d="M46 26 L40 18 L38 24" fill="${esc(p.color2)}"/>
      <ellipse cx="32" cy="42" rx="8" ry="6" fill="${esc(p.color2)}"/>
      <circle cx="25" cy="34" r="3" fill="#fff"/>
      <circle cx="39" cy="34" r="3" fill="#fff"/>
      <circle cx="26" cy="34" r="1.5" fill="${esc(p.ink)}"/>
      <circle cx="38" cy="34" r="1.5" fill="${esc(p.ink)}"/>
      <circle cx="32" cy="42" r="1.6" fill="#E89AA8"/>
      <path d="M18 42h-8M46 42h8M18 46h-7M46 46h7" stroke="${esc(p.ink)}" stroke-width="1.4" stroke-linecap="round"/>
    `),
    "jerry": (p) => frame(p, `
      <circle cx="16" cy="22" r="10" fill="${esc(p.color)}"/>
      <circle cx="48" cy="22" r="10" fill="${esc(p.color)}"/>
      <circle cx="16" cy="22" r="5" fill="${esc(p.color2)}"/>
      <circle cx="48" cy="22" r="5" fill="${esc(p.color2)}"/>
      <ellipse cx="32" cy="36" rx="14" ry="15" fill="${esc(p.color)}"/>
      <ellipse cx="32" cy="42" rx="7" ry="6" fill="${esc(p.color2)}"/>
      <circle cx="26" cy="34" r="2.2" fill="${esc(p.ink)}"/>
      <circle cx="38" cy="34" r="2.2" fill="${esc(p.ink)}"/>
      <path d="M32 40v6" stroke="${esc(p.ink)}" stroke-width="1.6"/>
      <path d="M28 50c2 3 6 3 8 0" fill="none" stroke="${esc(p.ink)}" stroke-width="1.6" stroke-linecap="round"/>
    `),
    "bugs-bunny": (p) => frame(p, `
      <rect x="22" y="6" width="7" height="22" rx="3.5" fill="${esc(p.color)}"/>
      <rect x="35" y="6" width="7" height="22" rx="3.5" fill="${esc(p.color)}"/>
      <rect x="23.5" y="10" width="4" height="14" rx="2" fill="${esc(p.color2)}"/>
      <rect x="36.5" y="10" width="4" height="14" rx="2" fill="${esc(p.color2)}"/>
      <ellipse cx="32" cy="38" rx="14" ry="16" fill="${esc(p.color)}"/>
      <ellipse cx="32" cy="42" rx="8" ry="8" fill="${esc(p.color2)}"/>
      <circle cx="26" cy="36" r="2" fill="${esc(p.ink)}"/>
      <circle cx="38" cy="36" r="2" fill="${esc(p.ink)}"/>
      <rect x="28" y="44" width="3.2" height="6" rx="0.6" fill="#fff"/>
      <rect x="32.8" y="44" width="3.2" height="6" rx="0.6" fill="#fff"/>
    `),
    "pikachu": (p) => frame(p, `
      <path d="M16 8 L22 30 L28 22 Z" fill="${esc(p.color)}"/>
      <path d="M48 8 L42 30 L36 22 Z" fill="${esc(p.color)}"/>
      <path d="M16 8 L22 16 L18 16 Z" fill="${esc(p.ink)}"/>
      <path d="M48 8 L42 16 L46 16 Z" fill="${esc(p.ink)}"/>
      <circle cx="32" cy="36" r="16" fill="${esc(p.color)}"/>
      <circle cx="20" cy="40" r="4" fill="${esc(p.color2 === "#FFF3C6" ? "#E03118" : "#E03118")}"/>
      <circle cx="44" cy="40" r="4" fill="#E03118"/>
      <circle cx="26" cy="33" r="2.4" fill="${esc(p.ink)}"/>
      <circle cx="38" cy="33" r="2.4" fill="${esc(p.ink)}"/>
      <path d="M32 38v6M26 48c3 4 9 4 12 0" fill="none" stroke="${esc(p.ink)}" stroke-width="1.8" stroke-linecap="round"/>
    `),
    "doraemon": (p) => frame(p, `
      <circle cx="32" cy="33" r="18" fill="${esc(p.color)}"/>
      <ellipse cx="32" cy="38" rx="13" ry="12" fill="#F7FBFF"/>
      <circle cx="27" cy="30" r="5" fill="#F7FBFF"/>
      <circle cx="37" cy="30" r="5" fill="#F7FBFF"/>
      <circle cx="28.5" cy="31" r="2" fill="${esc(p.ink)}"/>
      <circle cx="35.5" cy="31" r="2" fill="${esc(p.ink)}"/>
      <circle cx="32" cy="36" r="2.4" fill="#E03118"/>
      <path d="M32 38v7" stroke="${esc(p.ink)}" stroke-width="1.5"/>
      <path d="M24 44c4 5 12 5 16 0" fill="none" stroke="${esc(p.ink)}" stroke-width="1.6" stroke-linecap="round"/>
      <rect x="20" y="50" width="24" height="5" rx="2" fill="${esc(p.color)}"/>
      <circle cx="32" cy="56" r="3" fill="#E8A100"/>
    `),
    "shin-chan": (p) => frame(p, `
      <circle cx="32" cy="34" r="16" fill="#F3C7A3"/>
      <path d="M16 24 L20 8 L26 22 L32 6 L38 22 L44 8 L48 24" fill="${esc(p.ink)}"/>
      <circle cx="24" cy="34" r="3" fill="#fff"/>
      <circle cx="40" cy="34" r="3" fill="#fff"/>
      <circle cx="24" cy="34.5" r="1.6" fill="${esc(p.ink)}"/>
      <circle cx="40" cy="34.5" r="1.6" fill="${esc(p.ink)}"/>
      <path d="M22 44c5 6 15 6 20 0" fill="none" stroke="${esc(p.ink)}" stroke-width="2" stroke-linecap="round"/>
      <rect x="18" y="50" width="28" height="10" rx="2" fill="${esc(p.color)}"/>
    `),
    "popeye": (p) => frame(p, `
      <ellipse cx="32" cy="30" rx="14" ry="15" fill="#F3C7A3"/>
      <path d="M18 18c2-10 10-12 14-8 4-6 14-4 14 8H18z" fill="${esc(p.color)}"/>
      <rect x="16" y="18" width="32" height="5" fill="${esc(p.color)}"/>
      <circle cx="26" cy="30" r="2.4" fill="${esc(p.ink)}"/>
      <path d="M36 28c3 0 5 2 5 4" fill="none" stroke="${esc(p.ink)}" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M28 40c8 2 14-2 16-6" fill="none" stroke="${esc(p.color)}" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M14 50c0-8 6-10 10-8 6 8 2 16-6 16-4 0-4-4-4-8z" fill="${esc(p.color2)}"/>
      <circle cx="18" cy="48" r="6" fill="${esc(p.color)}"/>
    `),
    "scooby-doo": (p) => frame(p, `
      <ellipse cx="32" cy="36" rx="16" ry="14" fill="#8B5A2B"/>
      <path d="M12 22c-4 10-4 20 2 24 2-8 6-14 10-16z" fill="#6B3F1A"/>
      <path d="M52 22c4 10 4 20-2 24-2-8-6-14-10-16z" fill="#6B3F1A"/>
      <ellipse cx="32" cy="42" rx="8" ry="6" fill="${esc(p.color2)}"/>
      <circle cx="24" cy="34" r="3" fill="#fff"/>
      <circle cx="40" cy="34" r="3" fill="#fff"/>
      <circle cx="24.5" cy="34.5" r="1.5" fill="${esc(p.ink)}"/>
      <circle cx="40.5" cy="34.5" r="1.5" fill="${esc(p.ink)}"/>
      <ellipse cx="32" cy="44" rx="3.2" ry="2.2" fill="${esc(p.ink)}"/>
      <rect x="24" y="52" width="16" height="5" rx="2" fill="${esc(p.color)}"/>
      <circle cx="32" cy="54.5" r="2.2" fill="#E8A100"/>
    `),
    "homer-simpson": (p) => frame(p, `
      <path d="M20 28c0-16 6-22 12-22 8 0 14 8 14 22v16H20z" fill="#F5D76E"/>
      <circle cx="24" cy="32" r="2.2" fill="${esc(p.ink)}"/>
      <circle cx="38" cy="32" r="2.2" fill="${esc(p.ink)}"/>
      <path d="M22 32c-3 0-5 2-5 2M20 44c6 5 16 5 22 0" fill="none" stroke="${esc(p.ink)}" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M26 40c2 2 8 2 10 0" fill="#F0A0B0"/>
      <rect x="18" y="50" width="28" height="10" fill="#F7FBFF"/>
      <circle cx="50" cy="18" r="7" fill="${esc(p.color)}"/>
      <circle cx="50" cy="18" r="3" fill="${esc(p.color2)}"/>
    `),
    "shrek": (p) => frame(p, `
      <ellipse cx="32" cy="36" rx="16" ry="15" fill="${esc(p.color)}"/>
      <ellipse cx="12" cy="32" rx="6" ry="8" fill="${esc(p.color)}"/>
      <ellipse cx="52" cy="32" rx="6" ry="8" fill="${esc(p.color)}"/>
      <ellipse cx="12" cy="32" rx="3" ry="4" fill="${esc(p.color2)}"/>
      <ellipse cx="52" cy="32" rx="3" ry="4" fill="${esc(p.color2)}"/>
      <circle cx="24" cy="34" r="4" fill="#F7FBFF"/>
      <circle cx="40" cy="34" r="4" fill="#F7FBFF"/>
      <circle cx="24" cy="34" r="2" fill="${esc(p.ink)}"/>
      <circle cx="40" cy="34" r="2" fill="${esc(p.ink)}"/>
      <path d="M24 46c5 6 11 6 16 0" fill="none" stroke="${esc(p.ink)}" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M22 22c2-3 0-6-2-7M42 22c-2-3 0-6 2-7" fill="none" stroke="${esc(p.ink)}" stroke-width="1.5" stroke-linecap="round"/>
    `),
    "minion": (p) => frame(p, `
      <rect x="18" y="12" width="28" height="42" rx="14" fill="${esc(p.color2)}"/>
      <rect x="18" y="36" width="28" height="18" fill="${esc(p.color)}"/>
      <path d="M26 36h12v18H26z" fill="${esc(p.color2)}"/>
      <rect x="16" y="26" width="32" height="8" rx="2" fill="${esc(p.ink)}"/>
      <circle cx="32" cy="30" r="8" fill="#C5D0D8" stroke="${esc(p.ink)}" stroke-width="3"/>
      <circle cx="32" cy="30" r="4" fill="#F7FBFF"/>
      <circle cx="32" cy="30" r="2" fill="${esc(p.ink)}"/>
      <path d="M24 12c0-6 3-8 5-8M32 10c0-7 3-8 4-8M40 12c2-6 5-6 6-5" fill="none" stroke="${esc(p.ink)}" stroke-width="2" stroke-linecap="round"/>
    `),
    "pink-panther": (p) => frame(p, `
      <ellipse cx="32" cy="34" rx="10" ry="18" fill="${esc(p.color)}"/>
      <path d="M24 16 L28 6 L32 16 L36 6 L40 16" fill="${esc(p.color)}"/>
      <circle cx="28" cy="30" r="2" fill="${esc(p.ink)}"/>
      <circle cx="36" cy="30" r="2" fill="${esc(p.ink)}"/>
      <ellipse cx="32" cy="38" rx="4" ry="3.2" fill="#F0A0B0"/>
      <path d="M32 50c10 2 14 8 12 12M20 46c-8 4-10 12-4 14" fill="none" stroke="${esc(p.color)}" stroke-width="3" stroke-linecap="round"/>
      <path d="M26 44c3 3 9 3 12 0" fill="none" stroke="${esc(p.ink)}" stroke-width="1.6" stroke-linecap="round"/>
    `),
    "chhota-bheem": (p) => frame(p, `
      <circle cx="32" cy="32" r="16" fill="#F3C7A3"/>
      <path d="M22 18c4-10 16-10 20 0 0-8-20-8-20 0z" fill="${esc(p.ink)}"/>
      <circle cx="32" cy="12" r="4" fill="${esc(p.ink)}"/>
      <circle cx="32" cy="12" r="1.6" fill="${esc(p.color)}"/>
      <circle cx="25" cy="32" r="2.2" fill="${esc(p.ink)}"/>
      <circle cx="39" cy="32" r="2.2" fill="${esc(p.ink)}"/>
      <path d="M24 42c5 5 11 5 16 0" fill="none" stroke="${esc(p.ink)}" stroke-width="2" stroke-linecap="round"/>
      <rect x="16" y="48" width="32" height="12" rx="3" fill="${esc(p.color)}"/>
    `),
    "motu-patlu": (p) => frame(p, `
      <circle cx="22" cy="34" r="13" fill="#F3C7A3"/>
      <path d="M12 26c2-10 10-12 14-8 2-4 10-4 12 6H12z" fill="#F0C84A"/>
      <circle cx="18" cy="34" r="1.8" fill="${esc(p.ink)}"/>
      <circle cx="26" cy="34" r="1.8" fill="${esc(p.ink)}"/>
      <path d="M16 42c3 3 9 3 12 0" fill="none" stroke="${esc(p.ink)}" stroke-width="1.5" stroke-linecap="round"/>
      <ellipse cx="44" cy="36" rx="9" ry="12" fill="#F3C7A3"/>
      <path d="M36 28h16v5H36z" fill="${esc(p.color)}"/>
      <path d="M38 22h12l-2 8H40z" fill="${esc(p.color)}"/>
      <circle cx="41" cy="36" r="1.5" fill="${esc(p.ink)}"/>
      <circle cx="47" cy="36" r="1.5" fill="${esc(p.ink)}"/>
      <path d="M40 43c2 2 6 2 8 0" fill="none" stroke="${esc(p.ink)}" stroke-width="1.4" stroke-linecap="round"/>
    `),
    "johnny-bravo": (p) => frame(p, `
      <path d="M14 8c18-4 28 6 22 20 8-2 16 6 12 16H18C8 36 6 16 14 8z" fill="${esc(p.color2)}"/>
      <ellipse cx="32" cy="38" rx="12" ry="11" fill="#F3C7A3"/>
      <path d="M20 36h24v5H20z" fill="${esc(p.ink)}"/>
      <rect x="22" y="36" width="8" height="5" fill="#F7FBFF" opacity="0.35"/>
      <rect x="34" y="36" width="8" height="5" fill="#F7FBFF" opacity="0.35"/>
      <path d="M24 48c6 2 10 2 16 0" fill="none" stroke="${esc(p.ink)}" stroke-width="1.6"/>
      <rect x="26" y="52" width="12" height="8" rx="2" fill="${esc(p.color2)}"/>
    `),
    "garfield": (p) => frame(p, `
      <ellipse cx="32" cy="36" rx="18" ry="16" fill="${esc(p.color)}"/>
      <path d="M14 28 L16 12 L26 24 Z" fill="${esc(p.color)}"/>
      <path d="M50 28 L48 12 L38 24 Z" fill="${esc(p.color)}"/>
      <path d="M16 22 L22 16 L24 22" fill="#F3C7A3"/>
      <path d="M48 22 L42 16 L40 22" fill="#F3C7A3"/>
      <ellipse cx="32" cy="42" rx="8" ry="7" fill="#F3C7A3"/>
      <path d="M20 34h8M36 34h8" stroke="${esc(p.ink)}" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="32" cy="42" r="1.6" fill="#E89AA8"/>
      <path d="M24 48c5 5 11 5 16 0" fill="none" stroke="${esc(p.ink)}" stroke-width="2" stroke-linecap="round"/>
      <path d="M18 40l4 2M46 40l-4 2" stroke="${esc(p.ink)}" stroke-width="1.2" opacity="0.5"/>
    `),
  };

  function logoSvg(idOrPack) {
    const pack = typeof idOrPack === "string" ? getIdentity(idOrPack) : idOrPack;
    if (!pack) return "";
    const draw = DRAW[pack.id];
    return draw ? draw(pack) : frame(pack, "");
  }

  return {
    IDENTITIES,
    getIdentity,
    unusedIdentities,
    nextIdentity,
    publicIdentity,
    logoSvg,
  };
});
