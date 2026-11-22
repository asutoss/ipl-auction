/**
 * Character catalogue and helpers. Shared by server and client.
 * Source of truth: data/characters.json. Node loads that file; the browser
 * uses the embedded copy below (tests check the two stay in sync).
 *
 * Each character has id, name, image, colour theme, and placeholders for
 * future per-character emotes (array) and a power (each character has one). The image
 * is used as the team's logo on the ring, strip, sold modal, and results.
 */
(function (root, factory) {
  const embedded = [
    {
      "id": "narendra-modi",
      "name": "Mitron",
      "realName": "Narendra Modi",
      "image": "/logos/narendra-modi.webp",
      "color": "#FF9933",
      "color2": "#FFEDDA",
      "ink": "#38220B",
      "text": "#FF9933",
      "emotes": [],
      "power": {
        "id": "demonetisation",
        "name": "Demonetisation",
        "description": "Every other team loses 10 points. A team that reaches 0 is banned for match fixing.",
        "uses": 1,
        "params": {}
      },
      "lines": [
        "Mitron!",
        "Bhaiyon aur behno",
        "Jhola uthake chal padenge",
        "Aap chronology samajhiye"
      ]
    },
    {
      "id": "prabhas",
      "name": "Prabhas",
      "realName": "Prabhas",
      "image": "/logos/prabhas.webp",
      "color": "#A32112",
      "color2": "#EED7D4",
      "ink": "#240704",
      "text": "#BD5F54",
      "emotes": [],
      "power": {
        "id": "adipurush_vfx",
        "name": "Adipurush VFX",
        "description": "The next auctioned player is visible only to you. Everyone else sees a glitched VFX loading card and bids blind.",
        "uses": 1,
        "params": {}
      },
      "lines": [
        "Bahubali!",
        "Devasena!",
        "Seesfire!",
        "All excited, fingers crossed..."
      ]
    },
    {
      "id": "orry",
      "name": "Orry",
      "realName": "Orry",
      "image": "/logos/orry.webp",
      "color": "#8BCF17",
      "color2": "#EAF6D5",
      "ink": "#1F2E05",
      "text": "#8BCF17",
      "emotes": [],
      "power": {
        "id": "what_do_you_even_do",
        "name": "What Do You Even Do?",
        "description": "Use a random other character's power, chosen only from powers that are valid right now. If that power needs a target, you pick it.",
        "uses": 1,
        "params": {}
      },
      "lines": [
        "I'm just a liver"
      ]
    },
    {
      "id": "dolly-chaiwala",
      "name": "Bill Gates Ka Chaiwala",
      "realName": "Dolly Chaiwala",
      "image": "/logos/dolly-chaiwala.webp",
      "color": "#6B3F14",
      "color2": "#F0E0C8",
      "ink": "#2A1608",
      "text": "#D4A574",
      "emotes": [],
      "power": {
        "id": "chai_break",
        "name": "Chai Break",
        "description": "Unlimited pause. Only you can end it with Chai khatam. While it lasts you can read every team's squad and remaining points.",
        "uses": 1,
        "params": {}
      },
      "lines": [
        "Ek cutting!",
        "Chai peelo"
      ]
    },
    {
      "id": "amitabh-bachchan",
      "name": "Big B",
      "realName": "Amitabh Bachchan",
      "image": "/logos/amitabh-bachchan.webp",
      "color": "#4A0D1C",
      "color2": "#1C0A10",
      "ink": "#F3D38A",
      "text": "#E8C547",
      "emotes": [],
      "power": {
        "id": "lock_kiya_jaaye",
        "name": "Lock Kiya Jaaye",
        "description": "A 50-50 coin flip on the current lot. Win the flip: if you win the player, you pay half. Lose the flip: whoever wins pays double.",
        "uses": 1,
        "params": {}
      },
      "lines": [
        "Lock kiya jaaye?",
        "Rishte mein toh hum tumhare baap lagte hain",
        "Computer ji…",
        "Devi aur sajjano",
        "Aaaaag"
      ]
    },
    {
      "id": "jay-shah",
      "name": "Script Writer",
      "realName": "Jay Shah",
      "image": "/logos/jay-shah.webp",
      "color": "#0E7490",
      "color2": "#D4E6EB",
      "ink": "#031A20",
      "text": "#519BAF",
      "emotes": [],
      "power": {
        "id": "broadcast_rights",
        "name": "Broadcast Rights",
        "description": "On the next lot, each bid by a rival costs them 1 extra point, paid to you.",
        "uses": 1,
        "params": {}
      },
      "lines": [
        "Script pehle se likhi hai",
        "Crowd silent kar diya",
        "19 Nov 2023 yaad hai?",
        "Yaar ki gail chale"
      ]
    },
    {
      "id": "samay-raina",
      "name": "Latent King",
      "realName": "Samay Raina",
      "image": "/logos/samay-raina.webp",
      "color": "#C026D3",
      "color2": "#F4D8F7",
      "ink": "#2A082E",
      "text": "#D263DF",
      "emotes": [],
      "power": {
        "id": "chess_blundermaster",
        "name": "Chess Blundermaster",
        "description": "Privately see the next 3 players in auction order. A VFX-hidden player shows as ??? (VFX).",
        "uses": 1,
        "params": {}
      },
      "lines": [
        "Blunder!",
        "Ye episode delete karo",
        "This too shall pass"
      ]
    },
    {
      "id": "elvish-yadav",
      "name": "Systumm",
      "realName": "Elvish Yadav",
      "image": "/logos/elvish-yadav.webp",
      "color": "#047857",
      "color2": "#D2E7E1",
      "ink": "#011A13",
      "text": "#4A9E86",
      "emotes": [],
      "power": {
        "id": "mute_the_room",
        "name": "Elvish Bhai Ke Aage Koi Bol Sakta Hai Kya.. Elvish Bhaiiii",
        "description": "Mute the room: nobody can bid against you on this lot. You win at the current bid plus 1. Exempt from Broadcast Rights fees.",
        "uses": 1,
        "params": {}
      },
      "lines": [
        "Elvish bhaiiii!",
        "Systumm hang kar diya",
        "Kaatenge kaatenge"
      ]
    },
    {
      "id": "ranveer-allahbadia",
      "name": "BeerBiceps",
      "realName": "Ranveer Allahbadia",
      "image": "/logos/ranveer-allahbadia.webp",
      "color": "#6D28D9",
      "color2": "#E5D8F8",
      "ink": "#180930",
      "text": "#9664E4",
      "emotes": [],
      "power": {
        "id": "parents_wala_sawaal",
        "name": "Parents Wala Sawaal",
        "description": "Pick a rival who cannot bid for this lot and the next one.",
        "uses": 1,
        "params": {}
      },
      "lines": [
        "Hello dosto",
        "Would you rather...",
        "Maut ke baare mein socha hai?"
      ]
    },
    {
      "id": "salman-khan",
      "name": "Bhai",
      "realName": "Salman Khan",
      "image": "/logos/salman-khan.webp",
      "color": "#2C3E50",
      "color2": "#1A2530",
      "ink": "#0B1220",
      "text": "#8FA4B8",
      "emotes": [],
      "power": {
        "id": "kala_hiran",
        "name": "Kala Hiran",
        "description": "Pause and pick one of the last 10 sold rival players still on a squad, into a role you have open. You pay the sold price; the rival is refunded. 30 seconds; the power is used even if you time out.",
        "uses": 1,
        "params": {}
      },
      "lines": [
        "Ehsaan mat karna",
        "Dil mein aata hoon"
      ]
    },
    {
      "id": "ravi-kishan",
      "name": "Zindagi Jhand Ba",
      "realName": "Ravi Kishan",
      "image": "/logos/ravi-kishan.webp",
      "color": "#E8B923",
      "color2": "#FAF2D7",
      "ink": "#292106",
      "text": "#EECC60",
      "emotes": [],
      "power": {
        "id": "ghamand_tax",
        "name": "Ghamand Tax",
        "description": "Every team with more points than you pays you 5 points.",
        "uses": 1,
        "params": {}
      },
      "lines": [
        "Zindagi jhand ba, fir bhi ghamand ba",
        "Jai Mahakal"
      ]
    },
    {
      "id": "rakhi-sawant",
      "name": "Drama Queen",
      "realName": "Rakhi Sawant",
      "image": "/logos/rakhi-sawant.webp",
      "color": "#FF4D8D",
      "color2": "#FFDEEA",
      "ink": "#2D0D19",
      "text": "#FF7EAC",
      "emotes": [],
      "power": {
        "id": "rakhi_ka_swayamvar",
        "name": "Rakhi Ka Swayamvar",
        "description": "Each rival may pay you 3 points or refuse. Refusers cannot bid on the next lot. On timeout they refuse.",
        "uses": 1,
        "params": {}
      },
      "lines": [
        "Mera dimaag kharab hai!",
        "Main media bulaungi"
      ]
    },
    {
      "id": "taylor-swift",
      "name": "Tay Tay",
      "realName": "Taylor Swift",
      "image": "/logos/taylor-swift.webp",
      "color": "#1D4ED8",
      "color2": "#D6DFF7",
      "ink": "#050E26",
      "text": "#5C7FE2",
      "emotes": [],
      "power": {
        "id": "travis_kelce_trade",
        "name": "Travis Kelce Trade",
        "description": "Pause, pick one of the last 10 sold rival players still on a squad, then swap with one of your own same-role players. No points change. 30 seconds; the power is used even if you time out.",
        "uses": 1,
        "params": {}
      },
      "lines": [
        "Shake it off",
        "Look what you made me do",
        "We are never ever getting back together"
      ]
    },
    {
      "id": "arnab-goswami",
      "name": "Nation Wants to Know",
      "realName": "Arnab Goswami",
      "image": "/logos/arnab-goswami.webp",
      "color": "#DC2626",
      "color2": "#F8D7D7",
      "ink": "#270606",
      "text": "#E56262",
      "emotes": [],
      "power": {
        "id": "kahan_hai_points",
        "name": "Kahan Hai Points?",
        "description": "The richest other team (random tie-break) gives you 10 points.",
        "uses": 1,
        "params": {}
      },
      "lines": [
        "Nation wants to know!",
        "Mujhe drugs do!",
        "Aap chup rahiye"
      ]
    },
    {
      "id": "kim-jong-un",
      "name": "Rocket Man",
      "realName": "Kim Jong Un",
      "image": "/logos/kim-jong-un.webp",
      "color": "#3B6B2F",
      "color2": "#DBE4D9",
      "ink": "#0A1308",
      "text": "#719469",
      "emotes": [],
      "power": {
        "id": "big_red_button",
        "name": "Big Red Button",
        "description": "Choose a team. Half of its squad (rounded down) is wiped at random and returns to the pool. That team is refunded a quarter of the points it has spent so far.",
        "uses": 1,
        "params": {}
      },
      "lines": [
        "Big red button",
        "Nuclear button is always on my desk"
      ]
    }
  ];
  function loadCatalog() {
    if (typeof require === "function" && typeof module === "object") {
      try {
        return require("../data/characters.json");
      } catch (err) {
        return embedded;
      }
    }
    return embedded;
  }
  const lib = factory(loadCatalog());
  if (typeof module === "object" && module.exports) module.exports = lib;
  else root.IplCharacters = lib;
})(typeof self !== "undefined" ? self : this, function (rawList) {
  function slugLine(text) {
    return String(text)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/['’`]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "line";
  }

  function normalizeLines(characterId, raw) {
    const list = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const text = typeof item === "string" ? item : String((item && item.text) || "");
      if (!text) continue;
      let id = item && typeof item === "object" && item.id
        ? String(item.id)
        : characterId + ":" + slugLine(text);
      const base = id;
      let n = 2;
      while (seen.has(id)) id = base + "-" + n++;
      seen.add(id);
      out.push({ id, text });
    }
    return out;
  }

  function normalize(pack) {
    if (!pack || !pack.id) return null;
    const name = pack.name || pack.character || "";
    const image = pack.image || "/logos/" + pack.id + ".webp";
    const realName = pack.realName || pack.fullName || "";
    return {
      id: pack.id,
      name,
      character: name,
      realName,
      image,
      logo: image,
      color: pack.color,
      color2: pack.color2,
      ink: pack.ink,
      text: pack.text || pack.color,
      emotes: Array.isArray(pack.emotes) ? pack.emotes : [],
      lines: normalizeLines(pack.id, pack.lines),
      power: pack.power == null ? null : pack.power,
    };
  }

  const CHARACTERS = (rawList || []).map(normalize).filter(Boolean);
  const IDENTITIES = CHARACTERS;
  const byId = Object.fromEntries(CHARACTERS.map((t) => [t.id, t]));

  function getCharacter(id) {
    return byId[id] || null;
  }

  function unusedCharacters(takenIds) {
    const taken = takenIds instanceof Set ? takenIds : new Set(takenIds || []);
    return CHARACTERS.filter((t) => !taken.has(t.id));
  }

  function nextCharacter(takenIds) {
    return unusedCharacters(takenIds)[0] || null;
  }

  function publicCharacter(idOrPack) {
    const pack = typeof idOrPack === "string" ? getCharacter(idOrPack) : normalize(idOrPack);
    if (!pack) return null;
    return {
      id: pack.id,
      characterId: pack.id,
      character: pack.character,
      name: pack.name,
      realName: pack.realName || "",
      color: pack.color,
      color2: pack.color2,
      ink: pack.ink,
      text: pack.text || pack.color,
      image: pack.image,
      logo: pack.image,
      emotes: Array.isArray(pack.emotes) ? pack.emotes : [],
      lines: Array.isArray(pack.lines) ? pack.lines : [],
      power: pack.power == null ? null : pack.power,
    };
  }

  function characterLines(idOrPack) {
    if (!idOrPack) return [];
    if (typeof idOrPack === "string") {
      const pack = getCharacter(idOrPack);
      return (pack && pack.lines) || [];
    }
    if (Array.isArray(idOrPack.lines) && idOrPack.lines.length && typeof idOrPack.lines[0] === "object") {
      return idOrPack.lines;
    }
    const id = idOrPack.characterId || idOrPack.id;
    if (id && byId[id]) return byId[id].lines || [];
    return normalizeLines(id, idOrPack.lines);
  }

  function getCharacterLine(characterId, lineId) {
    if (!lineId) return null;
    return characterLines(characterId).find((l) => l.id === lineId) || null;
  }

  function isCharacterLine(characterId, lineId) {
    return Boolean(getCharacterLine(characterId, lineId));
  }

  function findLine(lineId) {
    if (!lineId) return null;
    for (const pack of CHARACTERS) {
      const hit = (pack.lines || []).find((l) => l.id === lineId);
      if (hit) return { ...hit, characterId: pack.id };
    }
    return null;
  }

  function esc(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function imageUrl(idOrPack) {
    const pack = typeof idOrPack === "string" ? getCharacter(idOrPack) : normalize(idOrPack);
    return (pack && pack.image) || "";
  }

  function characterImg(idOrPack, attrs) {
    const pack = typeof idOrPack === "string" ? getCharacter(idOrPack) : normalize(idOrPack);
    if (!pack) return "";
    const opt = attrs || {};
    const alt = esc(opt.alt != null ? opt.alt : pack.character || pack.name || "");
    const cls = esc(opt.className || "team-mark-img");
    return `<img src="${esc(imageUrl(pack))}" alt="${alt}" class="${cls}" width="256" height="256" decoding="async" draggable="false" />`;
  }

  return {
    CHARACTERS,
    IDENTITIES,
    getCharacter,
    getIdentity: getCharacter,
    unusedCharacters,
    unusedIdentities: unusedCharacters,
    nextCharacter,
    nextIdentity: nextCharacter,
    publicCharacter,
    publicIdentity: publicCharacter,
    imageUrl,
    logoUrl: imageUrl,
    characterImg,
    logoImg: characterImg,
    slugLine,
    normalizeLines,
    characterLines,
    getCharacterLine,
    isCharacterLine,
    findLine,
  };
});
