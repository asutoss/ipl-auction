/**
 * Original funny team identities. No real IPL names, logos, or trademarks.
 * Shared by the server (metadata) and the client (inline SVG marks).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IplIdentities = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const IDENTITIES = [
    { id: "chai-chargers", name: "Chai Chargers", short: "CHAI", color: "#C45C00", color2: "#FFE8C7", ink: "#3A1F00", emoji: "🍵" },
    { id: "sleepy-sloths", name: "Sleepy Sloths", short: "SLOTH", color: "#4F6F52", color2: "#E4F0D8", ink: "#1F2E20", emoji: "🦥" },
    { id: "pani-puri-punchers", name: "Pani Puri Punchers", short: "PURI", color: "#E03E8C", color2: "#FFD6EC", ink: "#4A1030", emoji: "🥊" },
    { id: "rickshaw-rockets", name: "Rickshaw Rockets", short: "RICK", color: "#E6B800", color2: "#1F1B12", ink: "#1F1B12", emoji: "🛺" },
    { id: "samosa-smashers", name: "Samosa Smashers", short: "SAM", color: "#E86A17", color2: "#FFF0D6", ink: "#3D1C00", emoji: "🥟" },
    { id: "mango-mavericks", name: "Mango Mavericks", short: "MANGO", color: "#F5A300", color2: "#1F6B3A", ink: "#143D22", emoji: "🥭" },
    { id: "biryani-blasters", name: "Biryani Blasters", short: "BIRY", color: "#B42318", color2: "#FFD7A0", ink: "#3B0A08", emoji: "🍲" },
    { id: "jugaad-jaguars", name: "Jugaad Jaguars", short: "JUGA", color: "#0F766E", color2: "#CFFAFE", ink: "#042F2E", emoji: "🐆" },
    { id: "traffic-jammers", name: "Traffic Jammers", short: "JAM", color: "#DC2626", color2: "#FDE68A", ink: "#3B0A0A", emoji: "🚦" },
    { id: "dosa-dynamos", name: "Dosa Dynamos", short: "DOSA", color: "#8B5A2B", color2: "#FFE9C2", ink: "#2C1708", emoji: "🥞" },
    { id: "lassi-lions", name: "Lassi Lions", short: "LASSI", color: "#7C3AED", color2: "#F3E8FF", ink: "#2E1065", emoji: "🦁" },
    { id: "vada-pav-vikings", name: "Vada Pav Vikings", short: "VADA", color: "#166534", color2: "#FDE68A", ink: "#052E16", emoji: "🍔" },
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
      name: pack.name,
      short: pack.short,
      color: pack.color,
      color2: pack.color2,
      ink: pack.ink,
      emoji: pack.emoji,
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
    "chai-chargers": (p) => frame(p, `
      <ellipse cx="32" cy="40" rx="14" ry="10" fill="${esc(p.color)}" />
      <path d="M46 38c4 0 6 3 6 6s-2 6-6 6h-1" fill="none" stroke="${esc(p.color)}" stroke-width="2.5" stroke-linecap="round"/>
      <rect x="20" y="30" width="24" height="8" rx="2" fill="${esc(p.ink)}"/>
      <path d="M24 28c0-8 4-10 4-14" fill="none" stroke="${esc(p.color)}" stroke-width="2" stroke-linecap="round"/>
      <path d="M32 26c0-7 3-10 3-14" fill="none" stroke="${esc(p.color)}" stroke-width="2" stroke-linecap="round"/>
      <path d="M38 28c0-6 2-9 3-13" fill="none" stroke="${esc(p.color)}" stroke-width="2" stroke-linecap="round"/>
    `),
    "sleepy-sloths": (p) => frame(p, `
      <circle cx="32" cy="34" r="16" fill="${esc(p.color)}"/>
      <ellipse cx="32" cy="22" rx="11" ry="7" fill="${esc(p.color)}"/>
      <rect x="18" y="16" width="28" height="10" rx="5" fill="${esc(p.ink)}"/>
      <circle cx="25" cy="33" r="3.2" fill="${esc(p.color2)}"/>
      <circle cx="39" cy="33" r="3.2" fill="${esc(p.color2)}"/>
      <path d="M24 33.5h3M38 33.5h3" stroke="${esc(p.ink)}" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M28 42c2 2 6 2 8 0" fill="none" stroke="${esc(p.color2)}" stroke-width="2" stroke-linecap="round"/>
      <circle cx="46" cy="18" r="3" fill="${esc(p.color2)}"/>
    `),
    "pani-puri-punchers": (p) => frame(p, `
      <circle cx="24" cy="36" r="11" fill="${esc(p.color)}"/>
      <circle cx="24" cy="36" r="6" fill="${esc(p.color2)}"/>
      <circle cx="42" cy="28" r="9" fill="${esc(p.color)}"/>
      <circle cx="42" cy="28" r="4.5" fill="${esc(p.color2)}"/>
      <path d="M18 18l8 4-6 6" fill="none" stroke="${esc(p.ink)}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="16" cy="16" r="3" fill="${esc(p.color)}"/>
    `),
    "rickshaw-rockets": (p) => frame(p, `
      <path d="M12 40l8-16h18l10 10h6v12H12z" fill="${esc(p.color)}"/>
      <rect x="18" y="26" width="12" height="8" rx="2" fill="${esc(p.color2)}"/>
      <circle cx="22" cy="46" r="5" fill="${esc(p.ink)}" stroke="${esc(p.color2)}" stroke-width="2"/>
      <circle cx="44" cy="46" r="5" fill="${esc(p.ink)}" stroke="${esc(p.color2)}" stroke-width="2"/>
      <path d="M8 34c-4 0-6 4-6 4m8-1c-3 1-4 4-4 4" fill="none" stroke="${esc(p.color)}" stroke-width="2" stroke-linecap="round"/>
    `),
    "samosa-smashers": (p) => frame(p, `
      <path d="M12 46 L32 12 L52 46 Z" fill="${esc(p.color)}"/>
      <path d="M20 46 L32 22 L44 46 Z" fill="${esc(p.color2)}"/>
      <path d="M28 30h8M26 36h12" stroke="${esc(p.ink)}" stroke-width="1.6" stroke-linecap="round" opacity="0.45"/>
      <circle cx="48" cy="16" r="5" fill="${esc(p.color)}" opacity="0.85"/>
    `),
    "mango-mavericks": (p) => frame(p, `
      <path d="M20 34c0-14 8-22 16-22 12 0 16 12 16 22 0 12-8 20-16 20s-16-8-16-20z" fill="${esc(p.color)}"/>
      <path d="M36 12c6-8 14-6 16-2-8 2-10 8-12 12" fill="${esc(p.color2)}"/>
      <circle cx="28" cy="30" r="3" fill="${esc(p.color2)}" opacity="0.55"/>
    `),
    "biryani-blasters": (p) => frame(p, `
      <ellipse cx="32" cy="44" rx="18" ry="8" fill="${esc(p.color)}"/>
      <path d="M16 42c0-10 6-16 16-16s16 6 16 16" fill="${esc(p.color)}"/>
      <path d="M20 28c0-6 4-10 8-12M32 24c0-8 4-12 8-14M40 28c2-6 6-8 10-8" fill="none" stroke="${esc(p.color)}" stroke-width="2" stroke-linecap="round"/>
      <ellipse cx="32" cy="30" rx="12" ry="4" fill="${esc(p.color2)}"/>
      <circle cx="50" cy="16" r="3" fill="${esc(p.color2)}"/>
    `),
    "jugaad-jaguars": (p) => frame(p, `
      <circle cx="32" cy="34" r="16" fill="${esc(p.color)}"/>
      <circle cx="18" cy="20" r="6" fill="${esc(p.color)}"/>
      <circle cx="46" cy="20" r="6" fill="${esc(p.color)}"/>
      <circle cx="26" cy="32" r="3" fill="${esc(p.color2)}"/>
      <circle cx="38" cy="32" r="3" fill="${esc(p.color2)}"/>
      <path d="M28 42c2 3 6 3 8 0" fill="none" stroke="${esc(p.color2)}" stroke-width="2" stroke-linecap="round"/>
      <circle cx="50" cy="48" r="8" fill="none" stroke="${esc(p.ink)}" stroke-width="2"/>
      <circle cx="50" cy="48" r="2" fill="${esc(p.ink)}"/>
    `),
    "traffic-jammers": (p) => frame(p, `
      <rect x="24" y="10" width="16" height="36" rx="6" fill="${esc(p.ink)}"/>
      <circle cx="32" cy="20" r="4.5" fill="#ef4444"/>
      <circle cx="32" cy="30" r="4.5" fill="${esc(p.color2)}"/>
      <circle cx="32" cy="40" r="4.5" fill="#22c55e"/>
      <path d="M44 28h12M48 24v8" stroke="${esc(p.color)}" stroke-width="2.4" stroke-linecap="round"/>
    `),
    "dosa-dynamos": (p) => frame(p, `
      <ellipse cx="32" cy="36" rx="20" ry="12" fill="${esc(p.color2)}" stroke="${esc(p.color)}" stroke-width="3"/>
      <path d="M16 36c6 8 26 8 32 0" fill="${esc(p.color)}"/>
      <path d="M44 16l4 10 4-10" fill="none" stroke="${esc(p.color)}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M48 12v6" stroke="${esc(p.color)}" stroke-width="2.4" stroke-linecap="round"/>
    `),
    "lassi-lions": (p) => frame(p, `
      <circle cx="32" cy="34" r="16" fill="${esc(p.color)}"/>
      <circle cx="32" cy="36" r="10" fill="${esc(p.color2)}"/>
      <circle cx="28" cy="34" r="1.8" fill="${esc(p.ink)}"/>
      <circle cx="36" cy="34" r="1.8" fill="${esc(p.ink)}"/>
      <path d="M30 40c1 2 3 2 4 0" fill="none" stroke="${esc(p.ink)}" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M18 22l-6-6M46 22l6-6M32 14v-6M14 36h-6M50 36h6" stroke="${esc(p.color)}" stroke-width="3" stroke-linecap="round"/>
      <rect x="26" y="46" width="12" height="8" rx="2" fill="${esc(p.color2)}" stroke="${esc(p.color)}" stroke-width="1.5"/>
    `),
    "vada-pav-vikings": (p) => frame(p, `
      <ellipse cx="32" cy="40" rx="16" ry="10" fill="${esc(p.color2)}" stroke="${esc(p.color)}" stroke-width="2.5"/>
      <ellipse cx="32" cy="36" rx="12" ry="7" fill="${esc(p.color)}"/>
      <ellipse cx="32" cy="30" rx="16" ry="8" fill="${esc(p.color2)}" stroke="${esc(p.color)}" stroke-width="2.5"/>
      <path d="M20 20c0-8 6-12 6-12l6 8 6-8s6 4 6 12" fill="${esc(p.ink)}"/>
      <path d="M26 12v8M38 12v8" stroke="${esc(p.color2)}" stroke-width="2" stroke-linecap="round"/>
    `),
  };

  function logoSvg(id) {
    const pack = getIdentity(id);
    if (!pack) return "";
    const draw = DRAW[pack.id];
    return draw ? draw(pack) : frame(pack, `<text x="32" y="38" text-anchor="middle" font-size="22">${esc(pack.emoji)}</text>`);
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
