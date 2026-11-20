# IPL Auction Night

A browser-based multiplayer game: friends join a room, auction an IPL-style XI, pick a captain, and watch a simulated tournament.

This is a local MVP. Nothing is deployed, and no accounts are required.

## Rules

- **Room:** 2–10 players. Create or join with a 4-character code. Rejoin later with the same name and code.
- **Purse:** ₹100 crore each (host can change this in the lobby).
- **Squad:** the auction runs until every remaining franchise has **at least 11** players, or the pool is exhausted (then leftover teams under 11 are auto-filled at base price if they can afford it). The **whole squad counts** in the tournament — there is no trimming back to an XI. Default bids can push a team past 11 or past a role quota (for example 6 bowlers and 2 batters).
- **Role quotas (voluntary bids only):** 4 batters (BAT), 1 wicket-keeper (WK), 2 all-rounders (AR), 4 bowlers (BOWL). You cannot *choose* to bid on a role that is already full. Default-bid assignments can exceed those quotas. There is **no overseas cap**.
- **Auction:** the server puts one player on the block at a time. Everyone sees that player's estimated batting/bowling ratings and the current bid.
  - **Default bid:** when a player comes up, one franchise is automatically given the first bid at base price, rotating round-robin in join order. The default team is **never skipped** for a full quota or an already-complete squad — only eliminated teams are skipped. If nobody outbids, the player is locked to that team in his own role.
  - If the chosen team cannot afford the base price, that franchise is **eliminated** immediately — out of the rest of the auction and the tournament, and listed last as "Eliminated - insufficient purse". The default bid then moves to the next team.
  - **Bid** any amount at or above the minimum (₹20 lakh steps under ₹2 crore, then ₹25 lakh). You can jump above the minimum. Once outbid, the default-bid team may bid higher again. Voluntary bids must still leave enough purse to reach 11 players at base prices; the automatic default bid does not apply that reserve check.
  - **Opt out** of this player. That decision is final for this lot only. The default (or current leading) bidder cannot opt out while they hold the lead.
  - The main auction list shows **only teams still in** — not opted out or eliminated, and automatically hidden if their *voluntary* role quota is full or they cannot afford a legal bid (the leading default bidder always stays visible).
  - The player is **locked** to the highest bidder when every other team is out, or when the 10-second timer expires with a leading bid. They go onto that franchise's squad immediately, then the next player comes up.
- **Captain:** once the auction ends, pick a captain from your whole squad (or the server auto-picks the highest-rated player on timeout). The captain gets a +5% rating boost.
- **Tournament:** only BAT, WK and AR players bat; only AR and BOWL players bowl. Strength is averaged over a full unit (7 batting-capable, 6 bowling-capable), so missing batters or bowlers count as zero and lopsided squads suffer. Then a round-robin league and playoffs (IPL-style if there are 4+ teams, or a top-2 final if fewer). Results are computed immediately and revealed on screen in about 30–60 seconds (or skip). Target: under 2 minutes.

Player ratings in `data/players.json` are **informal estimates** for game balance, not official stats. Swap that file to use your own pool.

The bundled pool has 82 current IPL names, which comfortably gets about 7 franchises to 11+ players. 8–10 rooms may exhaust the pool; teams still under 11 are auto-filled at base price when possible.

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
server/rules.js       Quotas, increments, purse-reserve checks
server/simulate.js    League + playoffs + awards
server/players.js     Load the player pool
public/               Simple HTML/CSS/JS client
test/                 Logic tests + Socket.IO e2e
```

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `BID_TIMER_MS` | `10000` | Seconds are 10s unless you change this |
| `CAPTAIN_TIMER_MS` | `30000` | Captain-pick timeout |
| `ALLOW_TEST_TIMERS` | unset | If `1`, `createRoom` may pass short `testTimers` (used by the e2e test) |
