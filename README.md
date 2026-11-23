# IPL Auction Night

A browser-based multiplayer game: friends join a room, choose a game type, auction a squad, pick a captain, and watch a simulated tournament.

This is a local MVP. Nothing is deployed, and no accounts are required.

## Rules

- **Room:** 2–10 players. On the start page you enter a **team name** (unique in the room) and, when creating a room, pick a **game type**: **Classical** (the current 11-player game), **Rapid** (5 players) or **Bullet** (3 players). Joiners use the room's mode; they do not pick one. Create or join with a 6-character code; rejoin later with the same team name and code. In the lobby you only choose a character — team names cannot be edited there. There are 15 characters (well-known public figures), each with a meme display name (Prabhas and Orry use their own names), a distinct colour theme, a local head-cut-out image, and one unique special power. A taken character is greyed out and shows the team that chose it. Characters are unique in the room; anything unpicked is auto-assigned when the host starts. The character image is used as the team's logo on the auction ring, team strip, sold modal, and results. Per-character emotes and powers are reserved in the catalogue for later. The team name is used everywhere (lobby, auction ring, top bar, squads, results, and the "Game paused by [team]" modal). The host can **End game** (with a confirm) to close the room and send everyone back to the start page; anyone else can **Leave**.
- **Purse:** Classical rooms start at **100** points, Rapid at **50**, Bullet at **30** (a little above a strict 5/11 or 3/11 split, so shorter auctions still have room for a bidding war and maybe a cheap leftover booster). The host can change the purse in the lobby. Starting bids are still a random 1–5, raises are +1/+2/+5, and the 1-point-per-remaining-slot reserve still applies.
- **Squad:** the auction runs until **every remaining (non-eliminated) team has a complete squad** for the room's mode — Classical 4 BAT, 1 WK, 2 AR, 4 BOWL (11); Rapid 2 BAT, 1 WK, 2 BOWL (5); Bullet 1 BAT, 1 WK, 1 BOWL (3). If one team finishes early, the auction continues for everyone else. Finished teams are marked done: they drop out of the default-bid rotation and cannot bid. The **whole squad counts** in the tournament — there is no trimming back to a smaller XI. A default bid can still push an unfinished team past a role quota or past the mode's squad size (for example a Classical side with 5 batters while they still need a keeper); that team is done only once every required role count is met.
- **Role quotas (voluntary bids only):** as above for the room's mode. You cannot *choose* to bid on a role that is already full, or bid at all once your squad is complete. Default-bid assignments can exceed those quotas if the default team is not yet complete. There is **no overseas cap**. If the prepared list runs out before every team is complete, the server appends another small batch of still-needed roles from the remaining player database. A player who goes unsold, or who is removed from a squad (for example by Kim's wipe), is retired for that room and is not brought back onto the auction list. Remaining gaps are auto-filled at 1 point from the still-eligible needed-role pool where the team can afford it. If only retired or otherwise ineligible players are left, the auction closes with the squads as they are.
- **Auction:** the server puts one player on the block at a time. The auction ring is drawn with a light 3D tilt, a lit rim and a ground shadow. The player's name, role and ratings stay on a flat card in the centre so they stay easy to read. A pointer tracks the team holding the current bid; their segment lifts off the ring with a soft shadow, and the others stay dimmed and seated. A compact strip lists every team's purse at the start of the lot and how many players they still need. Anyone can **Pause**; every client sees a full-screen "Game paused by [team]" modal, timers freeze, and the pauser or host can resume with the remaining time.
  - **Default bid:** when a player comes up, one team is automatically given the first bid at that lot's starting price, rotating round-robin in join order. Eliminated teams and teams whose squad is already complete are skipped. A team that still needs players is **never skipped** just because this player's role quota is already full — if nobody outbids, that team **always** keeps the player. There is no unsold path while a default or leading bidder exists.
  - The starting bid is a **random integer from 1 to 5**, chosen by the server when the lot starts. The default bid is placed at that amount.
  - If the chosen team cannot afford that starting bid, that team is **eliminated** immediately — out of the rest of the auction and the tournament, and listed last as "Eliminated - insufficient purse". The default bid then moves to the next team.
  - **Bid** with three large buttons that show the **exact points** you would pay (the current bid plus 1, 2 or 5 — so a 5-point bid becomes buttons for 6, 7 and 10 pts). Amounts you cannot afford, including those that would break the 1-point-per-remaining-slot reserve, are hidden. The buttons are disabled if you are not eligible (leading, opted out, squad already complete, or the game is paused). There is no custom amount box. Once outbid, the default-bid team may bid higher again. Voluntary bids must still leave **1 point per remaining role slot** to complete the squad; the automatic default bid does not apply that reserve check.
  - **Opt out** of this player (the button is always visible). That decision is final for this lot only. The default (or current leading) bidder cannot opt out while they hold the lead. When only one team remains in the race, bidding **closes immediately** and the player is sold to them.
  - The ring shows **only teams still in** — not opted out or eliminated, and automatically hidden if their *voluntary* role quota is full or they cannot afford a legal bid (the leading default bidder always stays visible). When a team opts out, their segment animates out and the remaining arcs redistribute equally.
  - The player is **locked** to the highest bidder when every other team is out, or when the timer expires with a leading bid. Before bidding opens, everyone sees a **3-second** full-screen intro of the player (name, role, overseas tag, batting and bowling, and the starting bid), with no countdown on the modal. The bid timer starts only after that intro closes; bids and powers are blocked while it is on screen. If Prabhas has hidden the lot with Adipurush VFX, other teams see a masked intro and only he sees the real player. A new player then gets **25 seconds**, and each bid also resets the timer to **25 seconds**. After each sale, everyone sees a full-screen "SOLD to [team] for N pts" celebration (with a clap animation) for **up to 5 seconds** before the next lot's timer starts. Anyone can press **Continue** to skip ahead. Unsold lots get a quieter notice with the same Continue button.
  - Anyone can send a quick **emote** from a small 😀 button: eight emoji reactions, plus that player's own character lines in the phrases section. Every emote (and quick-chat line) spawns in a band along the bottom-right and floats up the right edge, Instagram/YouTube-style, with a slight random drift, size and spin, and a tiny team-coloured badge so you can tell who sent it. Spamming is allowed; the server only silently drops more than about 10 emotes a second from the same team, as an anti-abuse cap. Up to 40 floats can be on screen at once. Emotes work during pauses and power waits (they sit above those overlays, with pointer-events disabled so they never block bids), and they are not stored.
  - **Character power:** each character has one unique special power, usable **once per auction**. Only one power can be used per lot (the Power button is disabled for everyone else until the next lot). The exception is Prabhas's *Adipurush VFX*, which consumes the **next** lot's slot — he can press it even if this lot's slot is already used, as long as the next one is free. A 5-second full-screen reveal names who used what; then the effect applies, with a room-wide toast/log line. Long power names wrap or ellipsis on the Power button and show in full on the reveal modal. Timers freeze during the reveal and during any follow-up wait (target pickers, Rakhi's choice, Dolly's chai break). A use is rejected while the game is manually paused, while another power is already on screen, or during the sold/unsold reveal. Eliminated or banned teams cannot use a power.
  - **Points floor and bans:** purses cannot go below 0. A team that reaches 0 is immediately shown room-wide as **Banned for match fixing** — their chip is marked banned, and they cannot bid or use powers.
  - **Power waits and quick chat:** during Dolly's chai break, Salman/Taylor/Kim/Ranveer target picks, or Rakhi's swayamvar choice, everyone can still send emotes and that player's own character lines as quick chat (the same lines as in the emote picker). The server only accepts a line that belongs to the sender's character. Dolly's pause is unlimited and only she can end it with **Chai khatam** (the host cannot resume; if she disconnects, the auction auto-resumes after 30 seconds). Rakhi's rivals have 15 seconds to pay her 3 points or refuse; a timeout counts as a refuse and they sit out the **next** lot only.
  - **Auction list:** when the host starts, the server builds the list of players that will come up. For each role in the room's mode it randomly picks **numTeams × role slots**, plus a small buffer of **max(1, ceil(numTeams / 2))** extra players of that role, from the full player database (roles with no slots, such as all-rounders in Rapid or Bullet, are omitted). Those picks are combined and shuffled once with a Fisher–Yates shuffle (crypto-quality randomness in play; tests can inject a seed or RNG). The auction then goes through that list **in that order**. Players no incomplete team can use — every remaining team is already full in that role — are skipped automatically, not put on the block. The buffer covers the default-bid overflow case: a team that is not yet complete may be forced to keep a player whose role quota is already full, which can leave another team short of that role. If the list still runs out while a team needs a role, a further small batch of that role is appended from whoever is left in the database. The auction ends when every remaining team has a complete squad; auto-fill at 1 point is the final fallback. The auction header shows **Lot X of N** for the current position in that list.
- **Captain & boosters:** once the auction ends, teams have **90 seconds** to pick a captain and (if they have leftover points) buy funny boosters from the shop. One of each booster per team, priced 10–30 points according to measured impact. Unspent points are kept but unused. The phase ends early only when every team has a captain and nobody can afford another booster. If time runs out, the server auto-picks the highest-rated captain. The captain gets a +5% rating boost. Two form boosters are the exception to the usual once-only form roll: **Net Session Masterclass** (19 points) guarantees your Current form finishes above 100% (a re-roll in 101–115 if it is not already; no extra bump if it already is), and **Nazar Lag Gayi** (20 points) lets you pick a rival and force their form below 100% (a re-roll in 85–99, or no change if it is already below). If a team has both its own guarantee and one or more curses, they cancel and the original form is kept. Those boosters are applied when the phase ends, before the tournament is simulated, and the form swings are shown in a short reveal. The captain/booster screen has a live board of every team's captain, boosters, points, Current form, and curse targets, plus a ticker of purchases. The shop lists boosters in decreasing order of measured impact, keeps the Small/Medium/Big tag, and hides the Buy button on anything you cannot buy. Team cards show only each booster's title-win chance, and curses such as Nazar Lag Gayi appear on the cursed team with the caster's name. Bought boosters have modest effects on the simulation and show up in results with any moments they triggered.
- **Tournament:** only BAT, WK and AR players bat; only AR and BOWL players bowl. Strength is averaged over a full unit for the mode (Classical 7 batting-capable / 6 bowling-capable; Rapid 3/2; Bullet 2/1), so missing players count as zero and lopsided squads suffer. Innings length scales with the mode: Classical is a 20-over game (up to 10 wickets, bowlers capped at 4 overs, expected score around 155); Rapid is 10 overs (up to 4 wickets, 5-over cap, expected score around 78); Bullet is 6 overs (up to 2 wickets, the single bowler can bowl the lot, expected score around 47). Any squad member can be captain; if time runs out the server still auto-picks the highest-rated player. Form is rolled once when a squad is completed, as the average of two rolls in 85–115%, then shifted by up to **+5 / −5** points according to completion order (first to finish slightly hotter, last slightly colder; still random, with upsets possible). Auto-fill and last-team fill only affect that form rank — they do not apply any other penalty to the simulation or the scores. Then a round-robin league and playoffs (IPL-style if there are 4+ teams, or a top-2 final if fewer) are simulated internally to decide positions. Results are revealed in a **server-synced** standings crawl from last place up to the champion, one team at a time about every 2.8 seconds (or **Skip**). Each standings row shows position, team name (with a small co-owner portrait), the performance score out of 1000, and **Current form**. The champion row is highlighted. Finish tags and W–L sit on the team sheet, which opens when a row is tapped. The score is the existing squad strength, `round(clamp(S, 0, 110) / 110 * 1000)`, where S is the squad's simulated match strength (batting and bowling averages with empty-slot penalties, captain bump, form, and standing boosters; dew-factor and the bus nerf are left out). Typical complete Classical sides land roughly 600–850. Match-by-match fixtures and the playoff bracket are not shown; tapping a team opens a sheet with the full squad and each player's simulated tournament batting and bowling. Target: under 2 minutes.

Player ratings in `data/players.json` are **informal estimates** for game balance, not official stats. Swap that file to use your own pool.

The bundled pool has 337 current and recent IPL names (98 batters, 40 keepers, 65 all-rounders and 134 bowlers), including stars, current official squad players, and recognisable weaker or average names, enough for 10 teams to fill a 4-1-2-4 split with margin. Ratings are informal estimates and vary realistically.

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
data/characters.json  Character catalogue (id, image, colours, lines, unique power)
public/characters.js  Shared character helpers (loads the catalogue)
public/identities.js  Backward-compatible aliases for the character catalogue
public/emotes.js      Shared emoji emote catalogue (character lines live in characters.js)
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
| `POWER_REVEAL_MS` | `5000` | How long the character-power modal stays up before the effect is applied |
| `CAPTAIN_TIMER_MS` | `90000` | Combined captain-pick and booster-shop timeout |
| `FORM_BOOST_REVEAL_MS` | `6000` | Short Current form swing reveal after form boosters resolve |
| `ALLOW_TEST_TIMERS` | unset | If `1`, `createRoom` may pass short `testTimers` (used by tests) |
| `MAX_ROOMS` | `20` | Cap on concurrent live rooms |
| `FINISHED_TTL_MS` | `1800000` | Evict a finished room after this long (30 min) |
| `IDLE_TTL_MS` | `600000` | Evict a room after all players have been gone this long (10 min) |
| `CREATE_LIMIT` | `3` | Max room creates per IP/socket in the window (`0` disables) |
| `CREATE_WINDOW_MS` | `600000` | Window for the create-room rate limit |
| `DEFLATE_THRESHOLD` | `256` | Compress WebSocket messages larger than this (bytes) |
