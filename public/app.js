/* IPL Auction Night client */
const socket = io({ transports: ["websocket", "polling"] });

const main = document.getElementById("main");
const topMeta = document.getElementById("top-meta");
const toastEl = document.getElementById("toast");

const STORE_KEY = "ipl-auction-session";

let state = null;
let lastError = "";
let bidDraft = null;
let reveal = null; // { startedAt, skipped }
let tickTimer = null;

function money(lakhs) {
  const n = Number(lakhs) || 0;
  if (n >= 100) {
    const cr = n / 100;
    const text = Number.isInteger(cr) ? String(cr) : cr.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return `₹${text} Cr`;
  }
  return `₹${n} L`;
}

function saveSession(code, name) {
  sessionStorage.setItem(STORE_KEY, JSON.stringify({ code, name }));
}
function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) || "null");
  } catch {
    return null;
  }
}

function toast(msg) {
  if (!msg) return;
  toastEl.hidden = false;
  toastEl.textContent = msg;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => {
    toastEl.hidden = true;
  }, 2800);
}

function emit(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload || {}, (res) => resolve(res || { ok: true }));
  });
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function remainingMs(endsAt) {
  return Math.max(0, (endsAt || 0) - Date.now());
}

function meter(value) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return `<div class="meter" aria-hidden="true"><i style="width:${pct}%"></i></div>`;
}

function roleTag(role) {
  return `<span class="tag role-${esc(role)}">${esc(role)}</span>`;
}

function renderTop() {
  if (!state || !state.code) {
    topMeta.hidden = true;
    topMeta.innerHTML = "";
    return;
  }
  topMeta.hidden = false;
  const you = state.you;
  topMeta.innerHTML = `
    <span class="pill">Room <strong>${esc(state.code)}</strong></span>
    <span class="pill">${esc(state.phase)}</span>
    ${you ? `<span class="pill"><span style="color:${esc(you.franchise.color)}">${esc(you.franchise.short)}</span> · ${esc(you.name)}</span>` : ""}
    ${you ? `<span class="pill">Purse <strong>${money(you.purseLakhs)}</strong></span>` : ""}
  `;
}

function homeView() {
  return `
    <section class="hero">
      <div class="panel">
        <h2>Build a franchise. Win the league.</h2>
        <p class="lede">Join a room with friends, bid for an XI (4 batters, 1 keeper, 2 all-rounders, 4 bowlers), pick a captain, and watch a simulated IPL-style tournament unfold.</p>
        <div class="row">
          <div>
            <label for="name">Your name</label>
            <input id="name" maxlength="24" placeholder="e.g. Ashutosh" />
          </div>
        </div>
        <div class="actions">
          <button class="btn" id="create">Create room</button>
        </div>
        <p class="hint">2–10 franchises. Default purse ₹100 Cr. Ratings in the player pool are informal estimates.</p>
      </div>
      <div class="panel">
        <h2>Join a room</h2>
        <p class="lede">Ask the host for the 4-character room code. Rejoin later with the same name and code.</p>
        <div class="row">
          <div>
            <label for="code">Room code</label>
            <input id="code" maxlength="6" placeholder="e.g. K7MQ2P" style="text-transform:uppercase" />
          </div>
        </div>
        <div class="actions">
          <button class="btn secondary" id="join">Join room</button>
        </div>
        <p class="error" id="home-error">${esc(lastError)}</p>
      </div>
    </section>
  `;
}

function lobbyView() {
  const isHost = state.you && state.you.isHost;
  const ready = state.franchises.length >= state.minPlayers;
  const cards = state.franchises
    .map(
      (f) => `
      <div class="franchise-card ${f.connected ? "" : "offline"}" style="--c:${esc(f.franchise.color)}">
        <p class="short">${esc(f.franchise.short)}</p>
        <p class="owner">${esc(f.franchise.name)}</p>
        <p class="owner">${esc(f.name)}${f.isHost ? " · host" : ""}${f.connected ? "" : " · offline"}${f.eliminated ? " · eliminated" : ""}</p>
      </div>`
    )
    .join("");
  return `
    <section class="panel">
      <p class="lede">Share this code</p>
      <p class="room-code">${esc(state.code)}</p>
      <p class="lede">${state.franchises.length} / ${state.maxPlayers} franchises · purse ${money(state.purseLakhs)} each. Host starts the auction when at least ${state.minPlayers} have joined.</p>
      ${
        isHost
          ? `<div class="row row-2" style="max-width:420px">
              <div>
                <label for="purse">Purse (₹ Cr)</label>
                <select id="purse">
                  ${[50, 75, 100, 120, 150]
                    .map(
                      (n) =>
                        `<option value="${n}" ${state.purseLakhs === n * 100 ? "selected" : ""}>${n}</option>`
                    )
                    .join("")}
                </select>
              </div>
            </div>`
          : ""
      }
      <div class="franchise-grid">${cards}</div>
      <div class="actions">
        ${isHost ? `<button class="btn" id="start" ${ready ? "" : "disabled"}>Start auction</button>` : `<p class="hint">Waiting for the host to start…</p>`}
      </div>
      <p class="error">${esc(lastError)}</p>
    </section>
  `;
}

function squadSlots(franchise) {
  const groups = [
    ["BAT", 4],
    ["WK", 1],
    ["AR", 2],
    ["BOWL", 4],
  ];
  const rows = [];
  for (const [role, minCount] of groups) {
    const matches = (franchise.squad || []).filter((s) => s.player.role === role);
    const count = Math.max(minCount, matches.length);
    for (let i = 0; i < count; i++) {
      const slot = matches[i];
      if (slot) {
        rows.push(`
          <div class="slot">
            <span class="r">${role}</span>
            <span>${esc(slot.player.name)}${slot.isCaptain ? ' <span class="cap">CAP</span>' : ""}</span>
            <span>${money(slot.priceLakhs)}</span>
          </div>`);
      } else {
        rows.push(`<div class="slot empty"><span class="r">${role}</span><span>Open slot</span><span>—</span></div>`);
      }
    }
  }
  return `<div class="slots">${rows.join("")}</div>`;
}

function auctionView() {
  const a = state.auction;
  const you = state.you;
  if (!a) {
    return `<section class="panel"><p class="lede">Preparing the next player…</p></section>`;
  }
  const p = a.nominee;
  const secs = Math.ceil(remainingMs(a.endsAt) / 1000);
  const still = a.stillIn
    .map(
      (t) => `
      <div class="still-item ${t.isLeader ? "leader" : ""}" style="--c:${esc(t.color)}">
        <div>
          <div class="who">${esc(t.short)} ${t.isYou ? "(you)" : ""} ${t.isLeader ? "· leading" : ""}</div>
          <div class="meta">${esc(t.name)} · purse ${money(t.purseLakhs)}</div>
        </div>
      </div>`
    )
    .join("");

  const event = state.lastEvent;
  let banner = "";
  if (event && event.player && event.player.id !== p.id) {
    if (event.type === "sold") {
      banner = `<div class="sold-banner"><strong>${esc(event.short)}</strong> signed ${esc(event.player.name)} for ${money(event.priceLakhs)}.</div>`;
    } else if (event.type === "unsold" || event.type === "skipped") {
      banner = `<div class="sold-banner unsold">${esc(event.player.name)} was skipped — no team could take this role.</div>`;
    } else if (event.type === "eliminated") {
      banner = `<div class="sold-banner unsold"><strong>${esc(event.short)}</strong> ${esc(event.reason || "Eliminated - insufficient purse")}.</div>`;
    }
  }

  const min = a.minBidLakhs;
  const draft = bidDraft == null ? min : bidDraft;
  const chips = [
    ["Min " + money(min), min],
    ["+" + money(a.incrementLakhs), min + a.incrementLakhs],
    ["+₹1 Cr", min + 100],
    ["+₹2 Cr", min + 200],
  ];

  return `
    <div>${banner}</div>
    <section class="auction-layout">
      <div class="panel player-card">
        <p class="lede">On the block ${a.pass === 2 ? "· unsold list" : ""} · ${a.soldCount} sold · ${a.remainingLots} still to come</p>
        <h2>${esc(p.name)}</h2>
        <div class="tags">
          ${roleTag(p.role)}
          <span class="tag">${esc(p.country)}</span>
          ${p.overseas ? `<span class="tag os">Overseas</span>` : ""}
          <span class="tag">Base ${money(p.basePriceLakhs)}</span>
        </div>
        <div class="stats">
          <div class="stat"><span>Batting (est.)</span><b>${p.batting}</b>${meter(p.batting)}</div>
          <div class="stat"><span>Bowling (est.)</span><b>${p.bowling}</b>${meter(p.bowling)}</div>
          <div class="stat"><span>Timer</span><p class="timer ${secs <= 3 ? "low" : ""}" id="timer">${secs}</p></div>
        </div>
        <div class="bid-board">
          <div>
            <p class="label">Current bid</p>
            <p class="amount">${money(a.currentBidLakhs)}</p>
            <p class="lede" style="margin:6px 0 0">${
              a.isDefaultBidLeading
                ? `Default bid: <strong>${esc(a.currentBidderShort)}</strong> (${esc(a.currentBidderName)}) at base price. Outbid them or the player is locked here.`
                : a.hasBidder
                  ? `Leading: <strong>${esc(a.currentBidderShort)}</strong> (${esc(a.currentBidderName)})`
                  : "No bids yet"
            }</p>
          </div>
        </div>
        <div class="still-in">
          <h3>Still in for this player</h3>
          <div class="still-list">${still || `<p class="lede">No teams left in.</p>`}</div>
        </div>
        <div class="bid-box">
          <label for="bid-amount">Your bid (₹ lakh)</label>
          <input id="bid-amount" type="number" min="${min}" step="5" value="${draft}" ${a.youCanBid ? "" : "disabled"} />
          <div class="chips">
            ${chips
              .map(
                ([label, val]) =>
                  `<button class="chip" data-bid="${val}" ${a.youCanBid ? "" : "disabled"}>${esc(label)}</button>`
              )
              .join("")}
          </div>
          <div class="actions">
            <button class="btn" id="bid" ${a.youCanBid ? "" : "disabled"}>Bid ${money(draft)}</button>
            <button class="btn danger" id="optout" ${a.youCanOptOut ? "" : "disabled"}>Opt out</button>
          </div>
          ${a.youReason ? `<p class="why">${esc(a.youReason)}</p>` : ""}
          <p class="hint">A default bid at base price is assigned round-robin when a player comes up. Opting out is final for this player. The lot ends when everyone else is out or the timer hits zero. Ratings are estimates.</p>
          <p class="error">${esc(lastError)}</p>
        </div>
      </div>
      <aside class="panel side">
        <h3>${you ? esc(you.franchise.short) : "Squad"}</h3>
        ${you ? `<p class="purse">${money(you.purseLakhs)}</p><p class="lede">${you.eliminated ? "Eliminated - insufficient purse · " : ""}${you.squad.length} player${you.squad.length === 1 ? "" : "s"}${you.squad.length < 11 ? ` · need ${11 - you.squad.length} more` : you.squad.length > 11 ? " · full squad+" : " · min 11 reached"}</p>` : ""}
        ${you ? squadSlots(you) : ""}
      </aside>
    </section>
  `;
}

function captainView() {
  const you = state.you;
  const left = Math.ceil(remainingMs(state.captainEndsAt) / 1000);
  const pending = state.captainsPending.map((p) => esc(p.short)).join(", ") || "none";
  const picks = (you?.squad || [])
    .map(
      (s) => `
      <button class="pick ${you.captainId === s.player.id ? "selected" : ""}" data-captain="${esc(s.player.id)}">
        <strong>${esc(s.player.name)}</strong>
        <div class="lede" style="margin:4px 0 0">${s.player.role} · bat ${s.player.batting} · bowl ${s.player.bowling}</div>
      </button>`
    )
    .join("");
  return `
    <section class="panel">
      <h2>Choose your captain</h2>
      <p class="lede">The captain gets a +5% rating boost. Auto-picks the highest-rated player if time runs out (${left}s). Waiting on: ${pending}.</p>
      <div class="captain-grid">${picks}</div>
      <div style="margin-top:18px">${you ? squadSlots(you) : ""}</div>
    </section>
  `;
}

function matchCard(m) {
  return `
    <article class="match">
      <p class="lbl">${esc(m.label)}</p>
      <div class="scoreline">
        <div>
          <div style="color:${esc(m.firstInnings.franchise.color)}">${esc(m.firstInnings.franchise.short)}</div>
          <b>${m.firstInnings.score}/${m.firstInnings.wickets}</b>
          <div class="lede" style="margin:0">(${m.firstInnings.overs} ov)</div>
        </div>
        <div>
          <div style="color:${esc(m.secondInnings.franchise.color)}">${esc(m.secondInnings.franchise.short)}</div>
          <b>${m.secondInnings.score}/${m.secondInnings.wickets}</b>
          <div class="lede" style="margin:0">(${m.secondInnings.overs} ov)</div>
        </div>
      </div>
      <p class="lede" style="margin:8px 0 0">${esc(m.resultText)}</p>
    </article>
  `;
}

function tableHtml(rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>L</th><th>Pts</th><th>NRR</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) =>
                `<tr><td>${r.position}</td><td style="color:${esc(r.color)}">${esc(r.short)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.lost}</td><td>${r.points}</td><td>${r.nrr >= 0 ? "+" : ""}${r.nrr.toFixed(3)}</td></tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function visibleTournament() {
  const t = state.tournament;
  if (!t) return { league: [], playoffs: [], showTable: false, showFinal: false, showAwards: false };
  const leagueAll = t.leagueMatches || [];
  const poAll = (t.playoffs && t.playoffs.matches) || [];
  if (!t.leagueMatches) {
    return { league: [], playoffs: [], showTable: true, showFinal: true, showAwards: true };
  }
  if (!reveal || reveal.skipped) {
    return { league: leagueAll, playoffs: poAll, showTable: true, showFinal: true, showAwards: true };
  }
  const elapsed = Date.now() - reveal.startedAt;
  const leagueN = t.leagueMatches.length;
  const poN = t.playoffs.matches.length;
  const leagueWindow = Math.min(45000, Math.max(8000, leagueN * 1800));
  const poWindow = Math.min(15000, Math.max(4000, poN * 2500));
  const nLeague = Math.min(leagueN, Math.floor((elapsed / leagueWindow) * leagueN) + 1);
  const afterLeague = elapsed - leagueWindow;
  const nPo = afterLeague < 0 ? 0 : Math.min(poN, Math.floor((afterLeague / poWindow) * poN) + 1);
  return {
    league: t.leagueMatches.slice(0, nLeague),
    playoffs: t.playoffs.matches.slice(0, nPo),
    showTable: nLeague >= leagueN,
    showFinal: nPo >= poN,
    showAwards: nPo >= poN && afterLeague > poWindow,
  };
}

function resultsView() {
  const t = state.tournament;
  if (!t) {
    return `<section class="panel"><h2>Simulating the tournament…</h2><p class="lede">Results will appear within two minutes.</p></section>`;
  }
  const vis = visibleTournament();
  const champ = vis.showFinal && t.champion ? t.champion : null;
  const awards = vis.showAwards ? t.awards : null;
  return `
    <section class="results">
      ${
        champ
          ? `<div class="panel champion">
              <h2>Champion</h2>
              <p class="name" style="color:${esc(champ.color)}">${esc(champ.short)}</p>
              <p class="lede">${esc(champ.franchiseName)} · owned by ${esc(champ.name)}</p>
            </div>`
          : `<div class="panel"><h2>Tournament underway</h2><p class="lede">Match results are coming in…</p><div class="actions"><button class="btn secondary" id="skip-reveal">Skip to results</button></div></div>`
      }
      <div class="panel">
        <h2>League matches</h2>
        ${vis.league.map(matchCard).join("") || `<p class="lede">Opening fixtures…</p>`}
      </div>
      ${vis.showTable ? `<div class="panel"><h2>Points table</h2>${tableHtml(t.table)}</div>` : ""}
      ${
        vis.playoffs.length
          ? `<div class="panel"><h2>Playoffs</h2>${vis.playoffs.map(matchCard).join("")}</div>`
          : ""
      }
      ${
        vis.showFinal
          ? `<div class="panel"><h2>Final positions</h2>
              <ol class="positions">
                ${t.positions
                  .map(
                    (p) =>
                      `<li><span style="color:${esc(p.color)}">${p.position}. ${esc(p.short)}</span><span>${esc(p.title)}</span></li>`
                  )
                  .join("")}
              </ol>
            </div>`
          : ""
      }
      ${
        awards
          ? `<div class="awards">
              <div class="award"><h3>Best buy</h3><p><strong>${esc(awards.bestBuy?.playerName || "—")}</strong> (${esc(awards.bestBuy?.short || "")})</p><p class="lede">${esc(awards.bestBuy?.reason || "")}</p></div>
              <div class="award"><h3>Costliest flop</h3><p><strong>${esc(awards.costliestFlop?.playerName || "—")}</strong> (${esc(awards.costliestFlop?.short || "")})</p><p class="lede">${esc(awards.costliestFlop?.reason || "")}</p></div>
            </div>`
          : ""
      }
    </section>
  `;
}

function render() {
  renderTop();
  if (!state || !state.phase || !state.code) {
    main.innerHTML = homeView();
    wireHome();
    return;
  }
  if (state.phase === "lobby") main.innerHTML = lobbyView();
  else if (state.phase === "auction") main.innerHTML = auctionView();
  else if (state.phase === "captains") main.innerHTML = captainView();
  else if (state.phase === "simulating" || state.phase === "results") main.innerHTML = resultsView();
  else main.innerHTML = homeView();
  wireCurrent();
}

function wireHome() {
  const nameEl = document.getElementById("name");
  const codeEl = document.getElementById("code");
  const session = loadSession();
  if (nameEl && session?.name && !nameEl.value) nameEl.value = session.name;
  if (codeEl && session?.code && !codeEl.value) codeEl.value = session.code;
  document.getElementById("create")?.addEventListener("click", async () => {
    lastError = "";
    const name = nameEl.value.trim();
    const res = await emit("createRoom", { name });
    if (!res.ok) {
      lastError = res.error || "Could not create room.";
      render();
      return;
    }
    saveSession(res.code, res.name);
  });
  document.getElementById("join")?.addEventListener("click", async () => {
    lastError = "";
    const name = (nameEl?.value || document.getElementById("name")?.value || "").trim() || loadSession()?.name;
    const nameBox = nameEl || Object.assign(document.createElement("input"), { value: loadSession()?.name || "" });
    const n = (document.getElementById("name") || nameBox).value.trim();
    const code = codeEl.value.trim();
    if (!document.getElementById("name")) {
      /* join panel may be used with shared name field */
    }
    const res = await emit("joinRoom", { name: n, code });
    if (!res.ok) {
      lastError = res.error || "Could not join room.";
      render();
      return;
    }
    saveSession(res.code, res.name);
  });
}

function wireCurrent() {
  if (!state) return;
  if (state.phase === "lobby") {
    document.getElementById("purse")?.addEventListener("change", async (e) => {
      await emit("setPurse", { purseCrore: Number(e.target.value) });
    });
    document.getElementById("start")?.addEventListener("click", async () => {
      lastError = "";
      const res = await emit("startAuction");
      if (!res.ok) {
        lastError = res.error || "Could not start.";
        render();
      }
    });
  }
  if (state.phase === "auction") {
    const input = document.getElementById("bid-amount");
    const bidBtn = document.getElementById("bid");
    const syncLabel = () => {
      if (!input || !bidBtn || !state.auction) return;
      bidDraft = Number(input.value);
      bidBtn.textContent = `Bid ${money(bidDraft || state.auction.minBidLakhs)}`;
    };
    input?.addEventListener("input", syncLabel);
    document.querySelectorAll(".chip[data-bid]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!input) return;
        input.value = btn.getAttribute("data-bid");
        syncLabel();
      });
    });
    bidBtn?.addEventListener("click", async () => {
      lastError = "";
      const amountLakhs = Number(input.value);
      const res = await emit("bid", { amountLakhs });
      if (!res.ok) {
        lastError = res.error || "Bid rejected.";
        render();
      }
    });
    document.getElementById("optout")?.addEventListener("click", async () => {
      lastError = "";
      const res = await emit("optOut");
      if (!res.ok) {
        lastError = res.error || "Could not opt out.";
        render();
      }
    });
  }
  if (state.phase === "captains") {
    document.querySelectorAll("[data-captain]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await emit("selectCaptain", { playerId: btn.getAttribute("data-captain") });
      });
    });
  }
  document.getElementById("skip-reveal")?.addEventListener("click", () => {
    if (reveal) reveal.skipped = true;
    render();
  });
}

function startTicks() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    if (!state) return;
    if (state.phase === "auction" && state.auction) {
      const el = document.getElementById("timer");
      if (el) {
        const secs = Math.ceil(remainingMs(state.auction.endsAt) / 1000);
        el.textContent = String(secs);
        el.classList.toggle("low", secs <= 3);
      }
    } else if (state.phase === "captains" || state.phase === "results" || state.phase === "simulating") {
      if (state.phase === "results" && reveal && !reveal.skipped && !visibleTournament().showAwards) {
        render();
      } else if (state.phase === "captains") {
        render();
      }
    }
  }, 250);
}

socket.on("connect", async () => {
  const session = loadSession();
  if (session?.code && session?.name && (!state || !state.code)) {
    const res = await emit("joinRoom", session);
    if (!res.ok) {
      /* stay on home */
    }
  }
});

let matchesLoading = false;

function loadMatches() {
  if (!state || state.phase !== "results" || !state.tournament) return;
  if (state.tournament.leagueMatches || matchesLoading) return;
  matchesLoading = true;
  emit("getMatches").then((res) => {
    matchesLoading = false;
    if (res && res.ok && state && state.tournament) {
      state.tournament.leagueMatches = res.leagueMatches || [];
      if (!state.tournament.playoffs) state.tournament.playoffs = {};
      state.tournament.playoffs.matches = res.playoffMatches || [];
      if (!reveal) reveal = { startedAt: Date.now(), skipped: false };
      else reveal.startedAt = Date.now();
      render();
    }
  });
}

socket.on("state", (next) => {
  const prevPhase = state?.phase;
  const prevNominee = state?.auction?.nominee?.id;
  state = next;
  if (state?.auction?.nominee?.id !== prevNominee) {
    bidDraft = state?.auction?.minBidLakhs ?? null;
    lastError = "";
  }
  if (state?.phase === "results" && prevPhase !== "results") {
    reveal = { startedAt: Date.now(), skipped: false };
    loadMatches();
  }
  if (state?.you && state?.code) saveSession(state.code, state.you.name);
  render();
});

socket.on("delta", (evt) => {
  if (!state) return;
  const prevNominee = state.auction?.nominee?.id;
  const prevPhase = state.phase;
  IplState.applyDelta(state, evt);
  if (state.auction?.nominee?.id !== prevNominee) {
    bidDraft = state.auction?.minBidLakhs ?? null;
    lastError = "";
  }
  if (state.phase === "results" && prevPhase !== "results") loadMatches();
  render();
});

socket.on("connect_error", () => toast("Connection issue — retrying…"));

startTicks();
render();
