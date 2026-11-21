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
      "name": "Narendra Modi",
      "image": "/logos/narendra-modi.webp",
      "color": "#FF9933",
      "color2": "#FFEDDA",
      "ink": "#38220B",
      "text": "#FF9933",
      "emotes": [],
      "power": {
        "id": "bonus_points",
        "name": "Masterstroke",
        "description": "A signature masterstroke adds 10 points to the purse.",
        "uses": 1,
        "params": {
          "points": 10
        }
      }
    },
    {
      "id": "prabhas",
      "name": "Prabhas",
      "image": "/logos/prabhas.webp",
      "color": "#A32112",
      "color2": "#EED7D4",
      "ink": "#240704",
      "text": "#BD5F54",
      "emotes": [],
      "power": {
        "id": "bonus_points",
        "name": "Salaar Surge",
        "description": "A Salaar surge pours 10 points into the purse.",
        "uses": 1,
        "params": {
          "points": 10
        }
      }
    },
    {
      "id": "orry",
      "name": "Orry",
      "image": "/logos/orry.webp",
      "color": "#8BCF17",
      "color2": "#EAF6D5",
      "ink": "#1F2E05",
      "text": "#8BCF17",
      "emotes": [],
      "power": {
        "id": "bonus_points",
        "name": "Spotlight Stash",
        "description": "The spotlight finds 10 extra points for the purse.",
        "uses": 1,
        "params": {
          "points": 10
        }
      }
    },
    {
      "id": "dolly-chaiwala",
      "name": "Dolly Chaiwala",
      "image": "/logos/dolly-chaiwala.webp",
      "color": "#6B3F14",
      "color2": "#F0E0C8",
      "ink": "#2A1608",
      "text": "#D4A574",
      "emotes": [],
      "power": {
        "id": "bonus_points",
        "name": "Cutting Chai",
        "description": "A cutting chai comes with 10 extra points.",
        "uses": 1,
        "params": {
          "points": 10
        }
      }
    },
    {
      "id": "amitabh-bachchan",
      "name": "Amitabh Bachchan",
      "image": "/logos/amitabh-bachchan.webp",
      "color": "#4A0D1C",
      "color2": "#1C0A10",
      "ink": "#F3D38A",
      "text": "#E8C547",
      "emotes": [],
      "power": {
        "id": "bonus_points",
        "name": "KBC Jackpot",
        "description": "A KBC jackpot locks in 10 bonus points.",
        "uses": 1,
        "params": {
          "points": 10
        }
      }
    },
    {
      "id": "jay-shah",
      "name": "Jay Shah",
      "image": "/logos/jay-shah.webp",
      "color": "#0E7490",
      "color2": "#D4E6EB",
      "ink": "#031A20",
      "text": "#519BAF",
      "emotes": [],
      "power": {
        "id": "bonus_points",
        "name": "Boardroom Bonus",
        "description": "A boardroom bonus credits 10 points to the purse.",
        "uses": 1,
        "params": {
          "points": 10
        }
      }
    },
    {
      "id": "samay-raina",
      "name": "Samay Raina",
      "image": "/logos/samay-raina.webp",
      "color": "#C026D3",
      "color2": "#F4D8F7",
      "ink": "#2A082E",
      "text": "#D263DF",
      "emotes": [],
      "power": {
        "id": "bonus_points",
        "name": "Checkmate Cash",
        "description": "Checkmate: 10 points appear on the board.",
        "uses": 1,
        "params": {
          "points": 10
        }
      }
    },
    {
      "id": "elvish-yadav",
      "name": "Elvish Yadav",
      "image": "/logos/elvish-yadav.webp",
      "color": "#047857",
      "color2": "#D2E7E1",
      "ink": "#011A13",
      "text": "#4A9E86",
      "emotes": [],
      "power": {
        "id": "bonus_points",
        "name": "Elvishhh Boost",
        "description": "Elvishhh! A boost drops 10 points into the purse.",
        "uses": 1,
        "params": {
          "points": 10
        }
      }
    },
    {
      "id": "puneet-superstar",
      "name": "Puneet Superstar",
      "image": "/logos/puneet-superstar.webp",
      "color": "#DB2777",
      "color2": "#F9D8E7",
      "ink": "#30091A",
      "text": "#E5639D",
      "emotes": [],
      "power": {
        "id": "bonus_points",
        "name": "Thik Hai Boost",
        "description": "Thik hai — 10 points, no discussion.",
        "uses": 1,
        "params": {
          "points": 10
        }
      }
    },
    {
      "id": "ranveer-allahbadia",
      "name": "Ranveer Allahbadia",
      "image": "/logos/ranveer-allahbadia.webp",
      "color": "#6D28D9",
      "color2": "#E5D8F8",
      "ink": "#180930",
      "text": "#9664E4",
      "emotes": [],
      "power": {
        "id": "bonus_points",
        "name": "Do Epic Cash",
        "description": "Do it epic: 10 points land in the purse.",
        "uses": 1,
        "params": {
          "points": 10
        }
      }
    },
    {
      "id": "salman-khan",
      "name": "Salman Khan",
      "image": "/logos/salman-khan.webp",
      "color": "#2C3E50",
      "color2": "#1A2530",
      "ink": "#0B1220",
      "text": "#8FA4B8",
      "emotes": [],
      "power": {
        "id": "bonus_points",
        "name": "Being Human Bonus",
        "description": "A Being Human bonus adds 10 points to the purse.",
        "uses": 1,
        "params": {
          "points": 10
        }
      }
    },
    {
      "id": "ravi-kishan",
      "name": "Ravi Kishan",
      "image": "/logos/ravi-kishan.webp",
      "color": "#E8B923",
      "color2": "#FAF2D7",
      "ink": "#292106",
      "text": "#EECC60",
      "emotes": [],
      "power": {
        "id": "bonus_points",
        "name": "Zindagi Jhand Ba",
        "description": "Zindagi jhand ba: 10 points land in the purse.",
        "uses": 1,
        "params": {
          "points": 10
        }
      }
    },
    {
      "id": "osama-bin-laden",
      "name": "Osama bin Laden",
      "image": "/logos/osama-bin-laden.webp",
      "color": "#7A6A42",
      "color2": "#E7E4DC",
      "ink": "#15130B",
      "text": "#9F9376",
      "emotes": [],
      "power": {
        "id": "bonus_points",
        "name": "Abbottabad Stash",
        "description": "An Abbottabad Stash adds 10 points to the purse.",
        "uses": 1,
        "params": {
          "points": 10
        }
      }
    },
    {
      "id": "rakhi-sawant",
      "name": "Rakhi Sawant",
      "image": "/logos/rakhi-sawant.webp",
      "color": "#FF4D8D",
      "color2": "#FFDEEA",
      "ink": "#2D0D19",
      "text": "#FF7EAC",
      "emotes": [],
      "power": {
        "id": "bonus_points",
        "name": "Drama Queen Bonus",
        "description": "A Drama Queen Bonus adds 10 points to the purse.",
        "uses": 1,
        "params": {
          "points": 10
        }
      }
    },
    {
      "id": "taylor-swift",
      "name": "Taylor Swift",
      "image": "/logos/taylor-swift.webp",
      "color": "#1D4ED8",
      "color2": "#D6DFF7",
      "ink": "#050E26",
      "text": "#5C7FE2",
      "emotes": [],
      "power": {
        "id": "bonus_points",
        "name": "Eras Tour Cash",
        "description": "Eras Tour Cash drops 10 points into the purse.",
        "uses": 1,
        "params": {
          "points": 10
        }
      }
    },
    {
      "id": "arnab-goswami",
      "name": "Arnab Goswami",
      "image": "/logos/arnab-goswami.webp",
      "color": "#DC2626",
      "color2": "#F8D7D7",
      "ink": "#270606",
      "text": "#E56262",
      "emotes": [],
      "power": {
        "id": "bonus_points",
        "name": "Nation Wants to Know",
        "description": "The nation wants to know: 10 points hit the purse.",
        "uses": 1,
        "params": {
          "points": 10
        }
      }
    },
    {
      "id": "kim-jong-un",
      "name": "Kim Jong Un",
      "image": "/logos/kim-jong-un.webp",
      "color": "#3B6B2F",
      "color2": "#DBE4D9",
      "ink": "#0A1308",
      "text": "#719469",
      "emotes": [],
      "power": {
        "id": "bonus_points",
        "name": "Supreme Leader Stash",
        "description": "A Supreme Leader Stash adds 10 points to the purse.",
        "uses": 1,
        "params": {
          "points": 10
        }
      }
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
  function normalize(pack) {
    if (!pack || !pack.id) return null;
    const name = pack.name || pack.character || "";
    const image = pack.image || "/logos/" + pack.id + ".webp";
    return {
      id: pack.id,
      name,
      character: name,
      image,
      logo: image,
      color: pack.color,
      color2: pack.color2,
      ink: pack.ink,
      text: pack.text || pack.color,
      emotes: Array.isArray(pack.emotes) ? pack.emotes : [],
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
      color: pack.color,
      color2: pack.color2,
      ink: pack.ink,
      text: pack.text || pack.color,
      image: pack.image,
      logo: pack.image,
      emotes: Array.isArray(pack.emotes) ? pack.emotes : [],
      power: pack.power == null ? null : pack.power,
    };
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
  };
});
