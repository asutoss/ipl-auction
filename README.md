# IPL Auction Night

A browser-based multiplayer game: friends join a room, auction an IPL-style XI, pick a captain, and watch a simulated tournament.

This is a local MVP. Nothing is deployed, and no accounts are required.

## Rules

- **Room:** 2–10 players. On the start page you enter a **team name** (unique in the room). Create or join with a 6-character code; rejoin later with the same team name and code. In the lobby you only pick a logo — team names cannot be edited there. There are 20 logos (cartoon characters and well-known public figures), each with a distinct colour theme, served as small local head cut-outs (the lobby picker shows the picture only, with no names). Logos are unique in the room; anything unpicked is auto-assigned when the host starts. The team name is used everywhere (lobby, auction ring, top bar, squads, results, and the "Game paused by [team]" modal). The host can **End game** (with a confirm) to close the room and send everyone back to the start page; anyone else can **Leave**.
- **Purse:** 100 points each (host can change this in the lobby).
- **Squad:** the auction runs until **every remaining (non-eliminated) team has a complete squad** — 4 BAT, 1 WK, 2 AR and 4 BOWL. If one team finishes early, the auction continues for everyone else. Finished teams are marked done: they drop out of the default-bid rotation and cannot bid. The **whole squad counts** in the tournament — there is no trimming back to an XI. A default bid can still push an unfinished team past a role quota or past 11 (for example 5 batters while they still need a keeper); that team is done only once every required role count is met.
- **Role quotas (voluntary bids only):** 4 batters (BAT), 1 wicket-keeper (WK), 2 all-rounders (AR), 4 bowlers (BOWL). You cannot *choose* to bid on a role that is already full, or bid at all once your squad is complete. Default-bid assignments can exceed those quotas if the default team is not yet complete. There is **no overseas cap**. If the live queue runs out before every team is complete, the server only nominates players in roles still needed by some unfinished team and re-nominates unsold players. Remaining gaps are auto-filled at 1 point from that needed-role pool where the team can afford it.
- **Auction:** the server puts one player on the block at a time. The auction ring shows that player's name, role and ratings in the centre, with a coloured arc for every team still in. A pointer tracks the team holding the current bid; their segment is highlighted and the others are dimmed. A compact strip lists every team's purse at the start of the lot and how many players they still need. Anyone can **Pause**; every client sees a full-screen "Game paused by [team]" modal, timers freeze, and the pauser or host can resume with the remaining time.
  - **Default bid:** when a player comes up, one team is automatically given the first bid at that lot's starting price, rotating round-robin in join order. Eliminated teams and teams whose squad is already complete are skipped. A team that still needs players is **never skipped** just because this player's role quota is already full — if nobody outbids, that team **always** keeps the player. There is no unsold path while a default or leading bidder exists.
  - The starting bid is a **random integer from 1 to 5**, chosen by the server when the lot starts. The default bid is placed at that amount.
  - If the chosen team cannot afford that starting bid, that team is **eliminated** immediately — out of the rest of the auction and the tournament, and listed last as "Eliminated - insufficient purse". The default bid then moves to the next team.
  - **Bid** with the **+1**, **+2** or **+5** buttons (bid = current + n). There is no custom amount box. Once outbid, the default-bid team may bid higher again. Voluntary bids must still leave **1 point per remaining role slot** to complete the squad; the automatic default bid does not apply that reserve check.
  - **Opt out** of this player (the button is always visible). That decision is final for this lot only. The default (or current leading) bidder cannot opt out while they hold the lead. When only one team remains in the race, bidding **closes immediately** and the player is sold to them.
  - The ring shows **only teams still in** — not opted out or eliminated, and automatically hidden if their *voluntary* role quota is full or they cannot afford a legal bid (the leading default bidder always stays visible). When a team opts out, their segment animates out and the remaining arcs redistribute equally.
  - The player is **locked** to the highest bidder when every other team is out, or when the timer expires with a leading bid. A new player gets **15 seconds**, and each bid also resets the timer to **15 seconds**. After each sale, everyone sees a full-screen "SOLD to [team] for N pts" celebration (with a clap animation) for **up to 5 seconds** before the next lot's timer starts. Anyone can press **Continue** to skip ahead. Unsold lots get a quieter notice with the same Continue button.
  - Nomination order is a **full random shuffle** of the pool, so stars and weaker known names appear in mixed order, but once some teams are finished the server prefers players in roles still needed by someone.
- **Captain & boosters:** once the auction ends, teams have 45 seconds to pick a captain and (if they have leftover points) buy funny boosters from the shop. One of each booster per team, priced 15–40 points. Unspent points are kept but unused. If time runs out, the server auto-picks the highest-rated captain. The captain gets a +5% rating boost. Bought boosters have modest effects on the simulation and show up in results with any moments they triggered.
- **Tournament:** only BAT, WK and AR players bat; only AR and BOWL players bowl. Strength is averaged over a full unit (7 batting-capable, 6 bowling-capable), so missing batters or bowlers count as zero and lopsided squads suffer. Then a round-robin league and playoffs (IPL-style if there are 4+ teams, or a top-2 final if fewer). Results are computed immediately and revealed on screen in about 30–60 seconds (or skip). Target: under 2 minutes.

Player ratings in `data/players.json` are **informal estimates** for game balance, not official stats. Swap that file to use your own pool.

The bundled pool has 192 well-known current and recent IPL names (at least 60 batters, 15 keepers, 30 all-rounders and 55 bowlers), including stars and recognisable weaker or average players, enough for 10 teams to fill a 4-1-2-4 split with margin. Ratings are informal estimates and vary realistically.

The server pushes compact auction **deltas** (bid, opt-out, lot start, sale, elimination, phase changes). A full state snapshot is sent only on join/reconnect and phase transitions. Match scorecards, full squads with per-player tournament stats, and booster moments are fetched on demand (`getMatches` or `GET /api/rooms/:code/matches`) rather than pushed to every client. The results screen shows every team's logo, squad, record (W/L/NR, points, NRR, playoff finish) and those player stats. WebSocket payloads use `perMessageDeflate` compression above 256 bytes.

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
server/rules.js       Quotas, point increments, purse-reserve checks
server/boosters.js    Booster catalogue and purchase helpers
public/state.js       Shared client delta-apply helper
public/identities.js  Shared character logo themes and local image URLs
public/logos/         Cached 256px WebP head-cut-out marks (see SOURCES.md)
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
| `CAPTAIN_TIMER_MS` | `45000` | Combined captain-pick and booster-shop timeout |
| `ALLOW_TEST_TIMERS` | unset | If `1`, `createRoom` may pass short `testTimers` (used by tests) |
| `MAX_ROOMS` | `20` | Cap on concurrent live rooms |
| `FINISHED_TTL_MS` | `1800000` | Evict a finished room after this long (30 min) |
| `IDLE_TTL_MS` | `600000` | Evict a room after all players have been gone this long (10 min) |
| `CREATE_LIMIT` | `3` | Max room creates per IP/socket in the window (`0` disables) |
| `CREATE_WINDOW_MS` | `600000` | Window for the create-room rate limit |
| `DEFLATE_THRESHOLD` | `256` | Compress WebSocket messages larger than this (bytes) |
