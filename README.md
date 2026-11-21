# IPL Auction Night

A browser-based multiplayer game: friends join a room, choose a game type, auction a squad, pick a captain, and watch a simulated tournament.

This is a local MVP. Nothing is deployed, and no accounts are required.

## Rules

- **Room:** 2–10 players. On the start page you enter a **team name** (unique in the room) and, when creating a room, pick a **game type**: **Classical** (the current 11-player game), **Rapid** (5 players) or **Bullet** (3 players). Joiners use the room's mode; they do not pick one. Create or join with a 6-character code; rejoin later with the same team name and code. In the lobby you only choose a character — team names cannot be edited there. There are 17 characters (well-known public figures), each with a distinct colour theme, a local head-cut-out image (the lobby picker shows the picture only, with no character names), and one special power. A taken character is greyed out and shows the team that chose it. Characters are unique in the room; anything unpicked is auto-assigned when the host starts. The character image is used as the team's logo on the auction ring, team strip, sold modal, and results. Per-character emotes and powers are reserved in the catalogue for later. The team name is used everywhere (lobby, auction ring, top bar, squads, results, and the "Game paused by [team]" modal). The host can **End game** (with a confirm) to close the room and send everyone back to the start page; anyone else can **Leave**.
- **Purse:** Classical rooms start at **100** points, Rapid at **50**, Bullet at **30** (a little above a strict 5/11 or 3/11 split, so shorter auctions still have room for a bidding war and maybe a cheap leftover booster). The host can change the purse in the lobby. Starting bids are still a random 1–5, raises are +1/+2/+5, and the 1-point-per-remaining-slot reserve still applies.
- **Squad:** the auction runs until **every remaining (non-eliminated) team has a complete squad** for the room's mode — Classical 4 BAT, 1 WK, 2 AR, 4 BOWL (11); Rapid 2 BAT, 1 WK, 2 BOWL (5); Bullet 1 BAT, 1 WK, 1 BOWL (3). If one team finishes early, the auction continues for everyone else. Finished teams are marked done: they drop out of the default-bid rotation and cannot bid. The **whole squad counts** in the tournament — there is no trimming back to a smaller XI. A default bid can still push an unfinished team past a role quota or past the mode's squad size (for example a Classical side with 5 batters while they still need a keeper); that team is done only once every required role count is met.
- **Role quotas (voluntary bids only):** as above for the room's mode. You cannot *choose* to bid on a role that is already full, or bid at all once your squad is complete. Default-bid assignments can exceed those quotas if the default team is not yet complete. There is **no overseas cap**. If the prepared list runs out before every team is complete, the server appends another small batch of still-needed roles from the remaining player database. Unsold players are moved to the end of the same list. Remaining gaps are auto-filled at 1 point from that needed-role pool where the team can afford it.
- **Auction:** the server puts one player on the block at a time. The auction ring is drawn with a light 3D tilt, a lit rim and a ground shadow. The player's name, role and ratings stay on a flat card in the centre so they stay easy to read. A pointer tracks the team holding the current bid; their segment lifts off the ring with a soft shadow, and the others stay dimmed and seated. A compact strip lists every team's purse at the start of the lot and how many players they still need. Anyone can **Pause**; every client sees a full-screen "Game paused by [team]" modal, timers freeze, and the pauser or host can resume with the remaining time.
  - **Default bid:** when a player comes up, one team is automatically given the first bid at that lot's starting price, rotating round-robin in join order. Eliminated teams and teams whose squad is already complete are skipped. A team that still needs players is **never skipped** just because this player's role quota is already full — if nobody outbids, that team **always** keeps the player. There is no unsold path while a default or leading bidder exists.
  - The starting bid is a **random integer from 1 to 5**, chosen by the server when the lot starts. The default bid is placed at that amount.
  - If the chosen team cannot afford that starting bid, that team is **eliminated** immediately — out of the rest of the auction and the tournament, and listed last as "Eliminated - insufficient purse". The default bid then moves to the next team.
  - **Bid** with three large buttons that show the **exact points** you would pay (the current bid plus 1, 2 or 5 — so a 5-point bid becomes buttons for 6, 7 and 10 pts). Amounts you cannot afford, including those that would break the 1-point-per-remaining-slot reserve, are hidden. The buttons are disabled if you are not eligible (leading, opted out, squad already complete, or the game is paused). There is no custom amount box. Once outbid, the default-bid team may bid higher again. Voluntary bids must still leave **1 point per remaining role slot** to complete the squad; the automatic default bid does not apply that reserve check.
  - **Opt out** of this player (the button is always visible). That decision is final for this lot only. The default (or current leading) bidder cannot opt out while they hold the lead. When only one team remains in the race, bidding **closes immediately** and the player is sold to them.
  - The ring shows **only teams still in** — not opted out or eliminated, and automatically hidden if their *voluntary* role quota is full or they cannot afford a legal bid (the leading default bidder always stays visible). When a team opts out, their segment animates out and the remaining arcs redistribute equally.
  - The player is **locked** to the highest bidder when every other team is out, or when the timer expires with a leading bid. A new player gets **15 seconds**, and each bid also resets the timer to **15 seconds**. After each sale, everyone sees a full-screen "SOLD to [team] for N pts" celebration (with a clap animation) for **up to 5 seconds** before the next lot's timer starts. Anyone can press **Continue** to skip ahead. Unsold lots get a quieter notice with the same Continue button.
  - Anyone can send a quick **emote** from a small 😀 button: eight emoji reactions and eight short cricket/meme lines. A pick floats for about two seconds on that team's ring segment (or their strip chip if they have opted out). Emotes work while the game is paused or the sold overlay is up, are rate-limited to one per team every two seconds, and are not stored.
  - **Character power:** each character has one special power, usable **once per auction** (`uses` is configurable on the power definition). Today every power is the same effect with a flavoured name (for example Modi's *Masterstroke* or Shin-chan's *Action Kamen Boost*): add **10 points** to that team's purse. You can use it at any point during a live lot. The auction timers freeze, everyone in the room sees a full-screen modal with the character face and power name for **2 seconds**, then the +10 is applied and the timers resume with the time that was left. Eliminated teams cannot use a power (use it before you are out). A use is rejected while the game is manually paused, while another power is already on screen, or during the sold/unsold reveal (so the two full-screen moments do not stack — try again when the next player is on the block). A Power button shows your character and power name; it disables after use, and a small marker appears on teams who have used theirs.
  - **Auction list:** when the host starts, the server builds the list of players that will come up. For each role in the room's mode it randomly picks **numTeams × role slots**, plus a small buffer of **max(1, ceil(numTeams / 2))** extra players of that role, from the full player database (roles with no slots, such as all-rounders in Rapid or Bullet, are omitted). Those picks are combined and shuffled once with a Fisher–Yates shuffle (crypto-quality randomness in play; tests can inject a seed or RNG). The auction then goes through that list **in that order**. Players no incomplete team can use — every remaining team is already full in that role — are skipped automatically, not put on the block. The buffer covers the default-bid overflow case: a team that is not yet complete may be forced to keep a player whose role quota is already full, which can leave another team short of that role. If the list still runs out while a team needs a role, a further small batch of that role is appended from whoever is left in the database. The auction ends when every remaining team has a complete squad; auto-fill at 1 point is the final fallback. The auction header shows **Lot X of N** for the current position in that list.
- **Captain & boosters:** once the auction ends, teams have 45 seconds to pick a captain and (if they have leftover points) buy funny boosters from the shop. One of each booster per team, priced 15–40 points. Unspent points are kept but unused. If time runs out, the server auto-picks the highest-rated captain. The captain gets a +5% rating boost. Bought boosters have modest effects on the simulation and show up in results with any moments they triggered.
- **Tournament:** only BAT, WK and AR players bat; only AR and BOWL players bowl. Strength is averaged over a full unit for the mode (Classical 7 batting-capable / 6 bowling-capable; Rapid 3/2; Bullet 2/1), so missing players count as zero and lopsided squads suffer. Innings length scales with the mode: Classical is a 20-over game (up to 10 wickets, bowlers capped at 4 overs, expected score around 155); Rapid is 10 overs (up to 4 wickets, 5-over cap, expected score around 78); Bullet is 6 overs (up to 2 wickets, the single bowler can bowl the lot, expected score around 47). Any squad member can be captain; if time runs out the server still auto-picks the highest-rated player. Then a round-robin league and playoffs (IPL-style if there are 4+ teams, or a top-2 final if fewer). Results are computed immediately and revealed on screen in about 30–60 seconds (or skip). Target: under 2 minutes.

Player ratings in `data/players.json` are **informal estimates** for game balance, not official stats. Swap that file to use your own pool.

The bundled pool has 192 well-known current and recent IPL names (at least 60 batters, 15 keepers, 30 all-rounders and 55 bowlers), including stars and recognisable weaker or average players, enough for 10 teams to fill a 4-1-2-4 split with margin. Ratings are informal estimates and vary realistically.

The server pushes compact auction **deltas** (bid, opt-out, lot start, sale, elimination, phase changes). A full state snapshot is sent only on join/reconnect and phase transitions. Match scorecards, full squads with per-player tournament stats, and booster moments are fetched on demand (`getMatches` or `GET /api/rooms/:code/matches`) rather than pushed to every client. The results screen shows every team's character, squad, record (W/L/NR, points, NRR, playoff finish) and those player stats. WebSocket payloads use `perMessageDeflate` compression above 256 bytes.

Finished rooms are evicted 30 minutes after results. Any room where every player has been disconnected for 10 minutes is evicted too. Live rooms are capped (default 20). Room creation is rate-limited to 3 per 10 minutes per IP/socket.

## How to run


You need Node.js 18 or newer.

```bash
cd ipl-auction
npm install
npm start
```

Then open **http://localhost:3000** in a browser. Default port is `3000`, or set `PORT`.

To run the automated tests (including a 3-client end-to-end game):

```bash
npm test
```

## Project layout

```
data/players.json     Player pool (roles, overseas flag, base price, estimated ratings)
server/index.js       HTTP + Socket.IO server (serves public/)
server/game.js        Room state machine, auction, opt-out, reconnect
server/manager.js     Room cap, rate limit, eviction
server/rules.js       Game modes (Classical/Rapid/Bullet), quotas, point increments, purse-reserve checks
server/powers.js      Character power registry (apply functions, keyed by power id)
server/random.js      Fisher–Yates shuffle, crypto RNG, injectable seeded RNG for tests
server/auction-pool.js  Build the per-role auction list at start (size, buffer, extras)
server/boosters.js    Booster catalogue and purchase helpers
public/state.js       Shared client delta-apply helper
data/characters.json  Character catalogue (id, image, colours, future emotes/power)
public/characters.js  Shared character helpers (loads the catalogue)
public/identities.js  Backward-compatible aliases for the character catalogue
public/emotes.js      Shared emoji and phrase emote catalogue
public/logos/         Cached 256px WebP head-cut-outs used as character images (see SOURCES.md)
public/ring.js        Auction ring (SVG segments + timer)
server/simulate.js    League + playoffs + awards
server/players.js     Load the player pool
public/               Simple HTML/CSS/JS client
test/                 Logic tests + Socket.IO e2e
```

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `LOT_START_MS` | `15000` | Timer when a new player comes up |
| `BID_TIMER_MS` | `15000` | Timer reset after each bid |
| `SOLD_REVEAL_MS` | `5000` | How long the sold/unsold overlay stays up before the next lot (can be skipped with Continue) |
| `POWER_REVEAL_MS` | `2000` | How long the character-power modal stays up before the effect is applied |
| `CAPTAIN_TIMER_MS` | `45000` | Combined captain-pick and booster-shop timeout |
| `ALLOW_TEST_TIMERS` | unset | If `1`, `createRoom` may pass short `testTimers` (used by tests) |
| `MAX_ROOMS` | `20` | Cap on concurrent live rooms |
| `FINISHED_TTL_MS` | `1800000` | Evict a finished room after this long (30 min) |
| `IDLE_TTL_MS` | `600000` | Evict a room after all players have been gone this long (10 min) |
| `CREATE_LIMIT` | `3` | Max room creates per IP/socket in the window (`0` disables) |
| `CREATE_WINDOW_MS` | `600000` | Window for the create-room rate limit |
| `DEFLATE_THRESHOLD` | `256` | Compress WebSocket messages larger than this (bytes) |
