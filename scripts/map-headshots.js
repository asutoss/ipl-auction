#!/usr/bin/env node
/**
 * Offline mapper: attach official IPL headshot URLs to data/players.json.
 *
 * Source: public iplt20.com pages and the same-origin BFF listing the website
 * uses for team squads (https://www.iplt20.com/api/bff/cms/teams/{slug}?tab=squad).
 * Player profile HTML (https://www.iplt20.com/players/{gid}/{slug}) supplies
 * og:image for names that are not on a current squad.
 *
 * Images are NOT downloaded or rehosted. Only official
 * https://www.iplt20.com/api/team-assets?pathname=player/{seasonId}/{teamId}/{imageId}.png&brand=ipl
 * URLs are written onto a `headshot` field.
 *
 * Politeness: disk cache under scripts/.cache/iplt20/, one request at a time,
 * 700ms gap, no retries on 4xx, few listing requests, profile fetches only
 * for auction players still unmatched after the 10 squad listings.
 *
 * Usage: node scripts/map-headshots.js
 *        node scripts/map-headshots.js --offline   # cache only, no HTTP
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PLAYERS_PATH = path.join(ROOT, "data", "players.json");
const CACHE = path.join(__dirname, ".cache", "iplt20");
const UA =
  "Mozilla/5.0 (compatible; ipl-auction-headshot-mapper/1.0; +https://www.iplt20.com/)";
const GAP_MS = 700;
const OFFLINE = process.argv.includes("--offline");

const TEAM_SLUGS = [
  "chennai-super-kings",
  "delhi-capitals",
  "gujarat-titans",
  "kolkata-knight-riders",
  "lucknow-super-giants",
  "mumbai-indians",
  "punjab-kings",
  "rajasthan-royals",
  "royal-challengers-bengaluru",
  "sunrisers-hyderabad",
];

const NICKS = new Map([
  ["matt", "matthew"],
  ["matthew", "matt"],
  ["mitch", "mitchell"],
  ["mitchell", "mitch"],
  ["mike", "michael"],
  ["michael", "mike"],
  ["chris", "christopher"],
  ["christopher", "chris"],
  ["jonny", "jonathan"],
  ["johnny", "jonathan"],
  ["jonathan", "jonny"],
  ["steve", "stephen"],
  ["stephen", "steve"],
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cachePath(...parts) {
  return path.join(CACHE, ...parts);
}

function ensureCache() {
  fs.mkdirSync(path.join(CACHE, "squads"), { recursive: true });
  fs.mkdirSync(path.join(CACHE, "profiles"), { recursive: true });
}

async function fetchText(url, dest, { json = false } = {}) {
  if (dest && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    const raw = fs.readFileSync(dest, "utf8");
    return json ? JSON.parse(raw) : raw;
  }
  if (OFFLINE) {
    throw new Error(`offline cache miss: ${url}`);
  }
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: json ? "application/json" : "text/html,application/xml;q=0.9,*/*;q=0.8" },
    redirect: "follow",
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} for ${url}`);
    err.status = res.status;
    throw err;
  }
  if (dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
  }
  await sleep(GAP_MS);
  return json ? JSON.parse(text) : text;
}

function fold(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function tokens(s) {
  return fold(s)
    .split("-")
    .filter((t) => t && !/^\d+$/.test(t));
}

function vowelFold(t) {
  return t.replace(/[aeiou]+/g, "a");
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length];
}

function tokenClose(a, b) {
  if (a === b) return true;
  if (NICKS.get(a) === b) return true;
  if (a.length <= 2 && b.startsWith(a)) return true;
  if (b.length <= 2 && a.startsWith(b)) return true;
  if (a.length >= 5 && b.length >= 5 && vowelFold(a) === vowelFold(b)) return true;
  if (a.length >= 5 && b.length >= 5 && levenshtein(a, b) <= 1) return true;
  return false;
}

function tokensMatch(ours, official) {
  if (!ours.length || !official.length) return false;
  let i = 0;
  let j = 0;
  while (i < ours.length && j < official.length) {
    if (tokenClose(ours[i], official[j])) {
      i += 1;
      j += 1;
      continue;
    }
    const initials = ours[i];
    if (initials.length >= 2 && initials.length <= 3) {
      const n = initials.length;
      const slice = official.slice(j, j + n);
      if (
        slice.length === n &&
        slice.every((tok, k) => tok[0] === initials[k])
      ) {
        i += 1;
        j += n;
        continue;
      }
    }
    // Skip an official middle name / extra token.
    if (j < official.length - 1) {
      j += 1;
      continue;
    }
    return false;
  }
  return i === ours.length;
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function officialHeadshotUrl(raw) {
  if (!raw) return null;
  let href = decodeEntities(String(raw).trim());
  try {
    href = href.replace(/\\u0026/g, "&");
    const u = new URL(href);
    if (u.hostname !== "www.iplt20.com") return null;
    if (u.pathname !== "/api/team-assets") return null;
    const pathname = decodeURIComponent(u.searchParams.get("pathname") || "");
    if (!/^player\/\d+\/\d+\/\d+\.png$/i.test(pathname)) return null;
    return `https://www.iplt20.com/api/team-assets?pathname=${pathname}&brand=ipl`;
  } catch {
    return null;
  }
}

function extractHeadshotFromHtml(html) {
  const og = html.match(/property="og:image"\s+content="([^"]+)"/i)
    || html.match(/content="([^"]+)"\s+property="og:image"/i)
    || html.match(/name="twitter:image"\s+content="([^"]+)"/i);
  if (og) {
    const url = officialHeadshotUrl(og[1]);
    if (url) return url;
  }
  const asset = html.match(/https:\/\/www\.iplt20\.com\/api\/team-assets\?pathname=player[^"'<\s]+/i);
  if (asset) return officialHeadshotUrl(asset[0]);
  return null;
}

function parseSitemapProfiles(xml) {
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const out = [];
  const seen = new Set();
  for (const loc of locs) {
    const m = loc.match(/\/players\/([0-9a-f-]{36})\/([^/?#]+)/i);
    if (!m) continue;
    const gid = m[1];
    const slug = m[2];
    const key = `${gid}/${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ gid, slug, name: slug, loc: loc.split(/[?#]/)[0] });
  }
  return out;
}

function officialRecord(entry, source) {
  const slug = entry.slug || "";
  const name = entry.name || slug;
  return {
    slug,
    name,
    gid: entry.playerGid || entry.gid || null,
    loc: entry.loc || (entry.playerGid && slug ? `https://www.iplt20.com/players/${entry.playerGid}/${slug}` : null),
    imageUrl: officialHeadshotUrl(entry.imageUrl),
    source,
    tokens: tokens(`${name} ${slug}`),
    nameTokens: tokens(name),
    slugTokens: tokens(slug),
  };
}

function uniqueMatch(player, official) {
  const id = fold(player.id);
  const nameFold = fold(player.name);
  const ours = tokens(player.name);
  const slugOurs = tokens(player.id);

  const exact = official.filter((o) => o.slug === player.id || fold(o.name) === nameFold || o.slug === id);
  if (exact.length === 1) return { rec: exact[0], how: exact[0].slug === player.id ? "slug" : "name" };
  if (exact.length > 1) return { rec: null, how: "ambiguous-exact", cands: exact };

  const soft = official.filter((o) => {
    const against = o.nameTokens.length ? o.nameTokens : o.slugTokens;
    return tokensMatch(ours, against) || tokensMatch(slugOurs, o.slugTokens);
  });
  if (soft.length === 1) return { rec: soft[0], how: "alias" };
  if (soft.length > 1) return { rec: null, how: "ambiguous-alias", cands: soft };
  return { rec: null, how: "unmatched" };
}

async function loadOfficials() {
  ensureCache();
  const sitemapXml = await fetchText(
    "https://www.iplt20.com/sitemaps/players-0.xml",
    cachePath("players-0.xml")
  );
  const profiles = parseSitemapProfiles(sitemapXml).map((p) => officialRecord(p, "sitemap"));

  const squadPlayers = [];
  for (const slug of TEAM_SLUGS) {
    const data = await fetchText(
      `https://www.iplt20.com/api/bff/cms/teams/${slug}?tab=squad`,
      cachePath("squads", `${slug}.json`),
      { json: true }
    );
    const players = (((data || {}).data || {}).squad || {}).players || [];
    for (const p of players) {
      squadPlayers.push(officialRecord({ ...p }, `squad:${slug}`));
    }
  }

  // Squad records first so they win on exact slug/name (they already have imageUrl).
  const official = [];
  const seen = new Set();
  for (const rec of [...squadPlayers, ...profiles]) {
    const key = rec.gid || rec.slug;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    official.push(rec);
  }
  return { official, squadCount: squadPlayers.length, profileCount: profiles.length };
}

async function headshotFor(rec) {
  if (rec.imageUrl) return rec.imageUrl;
  if (!rec.gid || !rec.slug) return null;
  const dest = cachePath("profiles", `${rec.gid}-${rec.slug}.html`);
  try {
    const html = await fetchText(
      rec.loc || `https://www.iplt20.com/players/${rec.gid}/${rec.slug}`,
      dest
    );
    return extractHeadshotFromHtml(html);
  } catch (err) {
    if (err && err.status === 404) return null;
    throw err;
  }
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(PLAYERS_PATH, "utf8"));
  const players = raw.players || [];
  const { official, squadCount, profileCount } = await loadOfficials();
  console.log(`Official index: ${squadCount} current-squad rows, ${profileCount} sitemap profiles, ${official.length} unique.`);

  const matches = [];
  const unmatched = [];
  const ambiguous = [];

  for (const p of players) {
    const hit = uniqueMatch(p, official);
    if (hit.rec) matches.push({ player: p, rec: hit.rec, how: hit.how });
    else if (hit.how && hit.how.startsWith("ambiguous")) {
      ambiguous.push({ player: p, how: hit.how, cands: (hit.cands || []).map((c) => c.slug) });
      unmatched.push(p);
    } else {
      unmatched.push(p);
    }
  }

  let withUrl = 0;
  let profileFetches = 0;
  for (const m of matches) {
    const before = m.rec.imageUrl;
    const url = await headshotFor(m.rec);
    if (!before && m.rec.loc) profileFetches += 1;
    if (url) {
      m.player.headshot = url;
      withUrl += 1;
    } else {
      delete m.player.headshot;
      unmatched.push(m.player);
    }
  }
  for (const p of unmatched) delete p.headshot;

  const mapped = players.filter((p) => p.headshot).length;
  const rate = `${mapped}/${players.length} (${((mapped / players.length) * 100).toFixed(1)}%)`;

  raw.meta = raw.meta || {};
  raw.meta.headshots =
    "Official IPL headshot URLs from www.iplt20.com (team-assets), matched offline by name/slug. See scripts/map-headshots.js. The client hotlinks these; images are not rehosted.";

  fs.writeFileSync(PLAYERS_PATH, `${JSON.stringify(raw, null, 2)}\n`);

  const report = {
    matched: mapped,
    total: players.length,
    rate,
    byHow: matches.reduce((acc, m) => {
      acc[m.how] = (acc[m.how] || 0) + 1;
      return acc;
    }, {}),
    profileFetches,
    unmatched: unmatched.map((p) => ({ id: p.id, name: p.name })),
    ambiguous: ambiguous.map((a) => ({ id: a.player.id, name: a.player.name, how: a.how, cands: a.cands })),
  };
  fs.writeFileSync(cachePath("map-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Match rate: ${rate}`);
  console.log(`How: ${JSON.stringify(report.byHow)}`);
  console.log(`Unmatched (${unmatched.length}): ${unmatched.map((p) => p.name).join(", ") || "none"}`);
  if (ambiguous.length) console.log(`Ambiguous: ${JSON.stringify(report.ambiguous)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
