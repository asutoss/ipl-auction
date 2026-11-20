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
let lastNomineeId = null;
let lastBidShown = null;
let soldModalTimer = null;
let soldModalKey = null;

function money(points) {
  const n = Number(points) || 0;
  return `${n} pt${n === 1 ? "" : "s"}`;
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
  if (state && state.paused) return Math.max(0, state.pauseRemainingMs || 0);
  return Math.max(0, (endsAt || 0) - Date.now());
}

function teamMark(franchise, size = "", title = "") {
  if (!franchise) return "";
  const img = (window.IplIdentities && franchise.id)
    ? IplIdentities.logoImg(franchise, { alt: title || franchise.character || "", className: "team-mark-img" })
    : "";
  const inner = img || esc(franchise.character || "");
  const label = title || franchise.character || "";
  return `<span class="team-mark-wrap ${esc(size)}" style="--c:${esc(franchise.color)};--c2:${esc(franchise.color2 || "")}" title="${esc(label)}">${inner}</span>`;
}

function accentColor(franchise) {
  if (!franchise) return "";
  return franchise.text || franchise.color || "";
}

function characterName(franchise) {
  return (franchise && (franchise.character || franchise.name)) || "";
}

function goHome() {
  try { sessionStorage.removeItem(STORE_KEY); } catch {}
  state = null;
  lastError = "";
  lastNomineeId = null;
  hideSoldModal(true);
  render();
}

async function confirmAction(message) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "confirm-backdrop";
    wrap.innerHTML = `<div class="confirm-card">
      <h2>Are you sure?</h2>
      <p class="lede">${esc(message)}</p>
      <div class="actions">
        <button class="btn danger" data-ok>End game</button>
        <button class="btn secondary" data-cancel>Cancel</button>
      </div>
    </div>`;
    const done = (val) => { wrap.remove(); resolve(val); };
    wrap.querySelector("[data-ok]").addEventListener("click", () => done(true));
    wrap.querySelector("[data-cancel]").addEventListener("click", () => done(false));
    wrap.addEventListener("click", (e) => { if (e.target === wrap) done(false); });
    document.body.appendChild(wrap);
  });
}

function hideSoldModal(force) {
  if (soldModalTimer) {
    clearTimeout(soldModalTimer);
    soldModalTimer = null;
  }
  const modal = document.getElementById("sold-modal");
  if (modal) {
    modal.hidden = true;
    modal.classList.remove("is-in", "is-unsold");
  }
  if (force) soldModalKey = null;
}

function soldRevealLeftMs() {
  if (state && state.paused) return Math.max(0, state.pauseRemainingMs || 0);
  const until = state && state.soldRevealUntil;
  return Math.max(0, (until || 0) - Date.now());
}

function updateSoldRevealUi() {
  const modal = document.getElementById("sold-modal");
  if (!modal || modal.hidden) return;
  const total = Number(state && state.lastEvent && state.lastEvent.revealMs) || 5000;
  const left = soldRevealLeftMs();
  const bar = document.getElementById("sold-progress-bar");
  if (bar) {
    const pct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
    bar.style.width = `${pct}%`;
  }
  const count = document.getElementById("sold-countdown");
  if (count) {
    if (state && state.paused) count.textContent = "Paused";
    else {
      const secs = Math.ceil(left / 1000);
      count.textContent = secs > 0 ? `Next lot in ${secs}s` : "Starting next lot…";
    }
  }
  const btn = document.getElementById("sold-continue");
  if (btn) btn.disabled = Boolean(state && state.paused);
}

function isSoldRevealActive() {
  if (!state || state.phase === "ended" || state.auction) return false;
  const evt = state.lastEvent;
  if (!evt || (evt.type !== "sold" && evt.type !== "unsold" && evt.type !== "skipped")) return false;
  const until = state.soldRevealUntil;
  if (until && until > Date.now()) return true;
  // Keep showing if the reveal was paused past the original deadline.
  if (state.paused && until && !state.auction) return true;
  return false;
}

function armSoldModalHide() {
  if (soldModalTimer) {
    clearTimeout(soldModalTimer);
    soldModalTimer = null;
  }
  if (state && state.paused) return;
  const ms = soldRevealLeftMs();
  const modal = document.getElementById("sold-modal");
  soldModalTimer = setTimeout(() => {
    soldModalTimer = null;
    if (state && state.paused && isSoldRevealActive()) return;
    if (modal) {
      modal.hidden = true;
      modal.classList.remove("is-in", "is-unsold");
    }
  }, Math.max(0, ms));
}

function fillSoldModal(evt) {
  const modal = document.getElementById("sold-modal");
  if (!modal || !evt) return null;
  const unsold = evt.type === "unsold" || evt.type === "skipped";
  modal.classList.toggle("is-unsold", unsold);
  const color = evt.color || "#f5c518";
  const textColor = evt.text || color;
  const card = document.getElementById("sold-card");
  if (card) {
    card.style.setProperty("--c", color);
    card.style.setProperty("--ct", textColor);
    card.style.setProperty("--c2", evt.color2 || "");
  }
  const kicker = document.getElementById("sold-kicker");
  if (kicker) kicker.textContent = unsold ? "Unsold" : "Sold";
  const logo = document.getElementById("sold-logo");
  if (logo) {
    const fr = evt.identityId ? { id: evt.identityId, color, color2: evt.color2, text: textColor, character: evt.buyerName } : null;
    logo.innerHTML = (!unsold && fr) ? teamMark(fr, "lg", evt.buyerName || "") : "";
  }
  const playerEl = document.getElementById("sold-player");
  if (playerEl) playerEl.textContent = (evt.player && evt.player.name) || "";
  const line = document.getElementById("sold-line");
  if (line) {
    if (unsold) {
      line.innerHTML = `${esc((evt.player && evt.player.name) || "This player")} went unsold.`;
    } else {
      line.innerHTML = `SOLD to <strong>${esc(evt.buyerName || evt.short || "a team")}</strong> for ${money(evt.priceLakhs)}`;
    }
  }
  return modal;
}

function showSoldModal(evt) {
  if (!evt || !evt.player) return;
  if (evt.type !== "sold" && evt.type !== "unsold" && evt.type !== "skipped") return;
  const key = `${evt.type}:${evt.player.id}:${evt.buyerName || ""}:${evt.priceLakhs || ""}`;
  const already = soldModalKey === key;
  const modal = already ? document.getElementById("sold-modal") : fillSoldModal(evt);
  if (!modal) return;
  soldModalKey = key;
  if (!already) {
    modal.hidden = false;
    modal.classList.remove("is-in");
    void modal.offsetWidth;
    modal.classList.add("is-in");
  } else {
    modal.hidden = false;
  }
  armSoldModalHide();
  updateSoldRevealUi();
}

function syncSoldModal() {
  if (!state || state.phase === "ended") {
    hideSoldModal(true);
    return;
  }
  if (isSoldRevealActive()) {
    const evt = state.lastEvent;
    showSoldModal({ ...evt, revealUntil: state.soldRevealUntil });
    return;
  }
  hideSoldModal();
}

function syncOverlays() {
  const modal = document.getElementById("pause-modal");
  if (modal) {
    const paused = Boolean(state && state.paused && state.phase && state.phase !== "ended");
    modal.hidden = !paused;
    const msg = document.getElementById("pause-msg");
    if (msg) msg.textContent = paused ? `Game paused by ${state.pausedBy || "a team"}.` : "";
    const btn = document.getElementById("resume");
    if (btn) {
      const you = state && state.you;
      const can = you && (you.isHost || (state.pausedBy && you.name === state.pausedBy));
      btn.hidden = !paused;
      btn.disabled = !can;
    }
  }
  syncSoldModal();
}

function meter(value) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return `<div class="meter" aria-hidden="true"><i style="width:${pct}%"></i></div>`;
}

function roleTag(role) {
  return `<span class="tag role-${esc(role)}">${esc(role)}</span>`;
}

function renderTop() {
  if (!state || !state.code || state.phase === "ended") {
    topMeta.hidden = true;
    topMeta.innerHTML = "";
    return;
  }
  topMeta.hidden = false;
  const you = state.you;
  const canPause = state.phase === "auction" || state.phase === "captains";
  const pauseLabel = state.paused ? "Paused" : "Pause";
  const hostEnd = you && you.isHost
    ? `<button class="btn danger" id="end-game" type="button">End game</button>`
    : `<button class="btn secondary" id="leave" type="button">Leave</button>`;
  topMeta.innerHTML = `
    <span class="pill">Room <strong>${esc(state.code)}</strong></span>
    <span class="pill">${esc(state.phase)}</span>
    ${you ? `<span class="pill" style="display:inline-flex;gap:8px;align-items:center">${teamMark(you.franchise, "sm", you.name)}<span style="color:${esc(accentColor(you.franchise))}">${esc(you.name)}</span></span>` : ""}
    ${you ? `<span class="pill">Purse <strong>${money(you.purseLakhs)}</strong></span>` : ""}
    <span class="top-actions">
      ${canPause ? `<button class="btn secondary" id="pause" type="button" ${state.paused ? "disabled" : ""}>${pauseLabel}</button>` : ""}
      ${hostEnd}
    </span>
  `;
}

function homeView() {
  return `
    <section class="home">
      <div class="panel name-bar">
        <label for="name">Team name</label>
        <input id="name" maxlength="24" placeholder="e.g. Night Owls" />
        <p class="hint">This team name is used everywhere in the game and must be unique in the room. Rejoin later with the same team name and room code.</p>
      </div>
      <section class="hero">
        <div class="panel">
          <h2>Build a franchise. Win the league.</h2>
          <p class="lede">Join a room with friends, bid for an XI (4 batters, 1 keeper, 2 all-rounders, 4 bowlers), pick a captain, and watch a simulated IPL-style tournament unfold.</p>
          <div class="actions">
            <button class="btn" id="create">Create room</button>
          </div>
          <p class="hint">2–10 franchises. Each team starts with 100 points. Ratings in the player pool are informal estimates.</p>
        </div>
        <div class="panel">
          <h2>Join a room</h2>
          <p class="lede">Ask the host for the 6-character room code, then join with the team name above.</p>
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
    </section>
  `;
}

function lobbyView() {
  const isHost = state.you && state.you.isHost;
  const ready = state.franchises.length >= state.minPlayers;
  const catalog = (window.IplIdentities && IplIdentities.IDENTITIES) || state.identities || [];
  const mine = state.you && state.you.franchise && state.you.franchise.id;
  const taken = new Set((state.franchises || []).map((f) => f.franchise && f.franchise.id).filter(Boolean));
  const picker = catalog
    .map((id) => {
      const pack = id.id ? id : (IplIdentities.getIdentity(id) || {});
      const selected = mine && pack.id === mine;
      const used = taken.has(pack.id) && !selected;
      const label = characterName(pack);
      return `<button type="button" class="logo-choice ${selected ? "selected" : ""} ${used ? "taken" : ""}" data-identity="${esc(pack.id)}" style="--c:${esc(pack.color)}" ${used ? "disabled" : ""} aria-label="${esc(label)}" title="${esc(label)}">
        ${IplIdentities.logoImg(pack, { alt: label, className: "team-mark-img" })}
      </button>`;
    })
    .join("");
  const cards = state.franchises
    .map(
      (f) => `
      <div class="franchise-card ${f.connected ? "" : "offline"}" style="--c:${esc(f.franchise.color)}">
        ${teamMark(f.franchise, "lg", f.name)}
        <div>
          <p class="short" style="color:${esc(accentColor(f.franchise))}">${esc(f.name)}</p>
          <p class="owner">${f.isHost ? "Host" : "Team"}${f.connected ? "" : " · offline"}${f.eliminated ? " · eliminated" : ""}</p>
        </div>
      </div>`
    )
    .join("");
  return `
    <section class="panel">
      <p class="lede">Share this code</p>
      <p class="room-code">${esc(state.code)}</p>
      <p class="lede">${state.franchises.length} / ${state.maxPlayers} teams · purse ${money(state.purseLakhs)} each. Pick a unique character logo before the host starts. Team names were set on the start page and cannot be edited here. Unpicked logos are auto-assigned. Need at least ${state.minPlayers} to start.</p>
      <h3>Choose a logo</h3>
      <div class="logo-picker">${picker}</div>
      ${
        isHost
          ? `<div class="row row-2" style="max-width:420px">
              <div>
                <label for="purse">Purse (points)</label>
                <select id="purse">
                  ${[50, 75, 100, 120, 150]
                    .map(
                      (n) =>
                        `<option value="${n}" ${state.purseLakhs === n ? "selected" : ""}>${n}</option>`
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


function teamStripHtml(a) {
  const snap = (a && a.lotSnapshot) || [];
  if (!snap.length) return "";
  const still = new Set(((a && a.stillIn) || []).map((t) => t.name));
  const leader = a.currentBidderName;
  return snap
    .map((row) => {
      const pending = row.pending != null ? row.pending : Math.max(0, 11 - (row.squadSize || 0));
      const done = Boolean(row.complete) || pending === 0;
      const out = !row.eliminated && !done && !still.has(row.name);
      const cls = [
        "team-chip",
        row.eliminated ? "is-eliminated" : "",
        done && !row.eliminated ? "is-done" : "",
        out ? "is-out" : "",
        leader && row.name === leader ? "is-leader" : "",
      ].filter(Boolean).join(" ");
      const need = row.eliminated ? "out" : done ? "done" : `need ${pending}`;
      const tip = `${row.name} · ${row.purseLakhs} pts at start of this lot · ${
        row.eliminated ? "eliminated" : done ? "squad complete" : out ? "opted out of this player" : `${pending} slot${pending === 1 ? "" : "s"} left`
      }`;
      const fr = { id: row.identityId, color: row.color, color2: row.color2, text: row.text };
      return `<button type="button" class="${cls}" title="${esc(tip)}" style="--c:${esc(row.color)};--c2:${esc(row.color2 || "")};--ct:${esc(row.text || row.color)}">
        ${teamMark(fr, "sm", row.name)}
        <span class="chip-name">${esc(row.name)}</span>
        <span class="chip-meta"><b>${row.purseLakhs}</b><small>${esc(need)}</small></span>
      </button>`;
    })
    .join("");
}

function leaderFranchise(a) {
  if (!a) return null;
  const name = a.currentBidderName || a.currentBidderShort;
  if (!name) return null;
  const row = (a.stillIn || []).find((t) => t.name === name || t.isLeader)
    || (a.lotSnapshot || []).find((t) => t.name === name)
    || (state.franchises || []).find((f) => f.name === name);
  if (!row) {
    return { color: a.currentBidderColor, text: a.currentBidderColor, character: name };
  }
  if (row.franchise) return { ...row.franchise, character: name };
  return {
    id: row.identityId,
    color: row.color || a.currentBidderColor,
    color2: row.color2,
    text: row.text || row.color || a.currentBidderColor,
    character: name,
  };
}

function leaderLine(a) {
  if (!a) return "";
  const name = a.currentBidderName || a.currentBidderShort;
  if (!name && !a.hasBidder) {
    return `<span class="hub-leader-label">Waiting for a bid</span>`;
  }
  const label = a.isDefaultBidLeading ? "Default" : "Highest";
  const fr = leaderFranchise(a);
  const color = (fr && (fr.text || fr.color)) || a.currentBidderColor || "var(--gold)";
  return `<span class="hub-leader-label">${esc(label)}</span>${fr ? teamMark(fr, "sm", name) : ""}<strong style="color:${esc(color)}">${esc(name || "")}</strong>`;
}

function bidParts(points) {
  const n = Number(points) || 0;
  return { n, unit: n === 1 ? "pt" : "pts" };
}

function fitHubName() {
  const el = document.getElementById("hub-name");
  if (!el) return;
  el.style.fontSize = "";
  let size = parseFloat(getComputedStyle(el).fontSize);
  if (!Number.isFinite(size) || size <= 0) return;
  const min = 16;
  // Only shrink when a word is wider than the name box. Height is handled in CSS
  // so the 2-line name stays a hero size and is not clipped by the circle.
  for (let i = 0; i < 20 && size > min; i++) {
    if (el.scrollWidth <= el.clientWidth + 1) break;
    size -= 0.5;
    el.style.fontSize = `${size}px`;
  }
}

function bidButtonsHtml(a) {
  const choices = (window.IplState && IplState.bidChoices(state)) || { options: [], canOptOut: false };
  const raises = choices.options
    .filter((o) => o.show)
    .map((o) => {
      return `<button class="btn bid-amt" data-step="${o.step}" aria-label="Bid ${o.amount} points" ${o.enabled ? "" : "disabled"}>
        <span class="bid-amt-num">${o.amount}</span>
        <span class="bid-amt-unit">pt${o.amount === 1 ? "" : "s"}</span>
      </button>`;
    })
    .join("");
  const opt = `<button class="btn bid-optout" id="optout" ${choices.canOptOut ? "" : "disabled"}>Opt out</button>`;
  const raisesWrap = raises ? `<div class="bid-raises">${raises}</div>` : "";
  return `${raisesWrap}${opt}`;
}

function auctionView() {
  const a = state.auction;
  const you = state.you;
  if (!a) {
    return `<section class="panel"><p class="lede">Preparing the next player…</p></section>`;
  }
  const p = a.nominee;
  const secs = Math.ceil(remainingMs(a.endsAt) / 1000);
  const event = state.lastEvent;
  let banner = "";
  if (event && event.player && event.player.id !== p.id) {
    if (event.type === "sold") {
      banner = `<div class="sold-banner"><strong style="color:${esc(event.color || "")}">${esc(event.buyerName || event.short)}</strong> signed ${esc(event.player.name)} for ${money(event.priceLakhs)}.</div>`;
    } else if (event.type === "unsold" || event.type === "skipped") {
      banner = `<div class="sold-banner unsold">${esc(event.player.name)} was skipped — no team could take this player.</div>`;
    } else if (event.type === "eliminated") {
      banner = `<div class="sold-banner unsold"><strong>${esc(event.buyerName || event.short || event.name)}</strong> ${esc(event.reason || "Eliminated - insufficient purse")}.</div>`;
    }
  }

  return `
    <div>${banner}</div>
    <section class="auction-layout">
      <div class="panel player-card">
        <p class="lede">On the block ${a.pass === 2 ? "· unsold list" : ""} · ${a.soldCount} sold · ${a.remainingLots} still to come · starts at ${money(a.startBidLakhs != null ? a.startBidLakhs : 1)}</p>
        <div class="auction-stage">
          <div class="ring-wrap">
            <svg id="auction-ring" role="img" aria-label="Teams still bidding"></svg>
            <div class="hub" id="auction-hub" style="--c:${esc(a.currentBidderColor || "var(--gold)")}">
              <div class="hub-inner">
                <p class="hub-name" id="hub-name">${esc(p.name)}</p>
                <p class="hub-bid" id="hub-bid">
                  <span class="hub-bid-num" id="hub-bid-num">${bidParts(a.currentBidLakhs).n}</span>
                  <span class="hub-bid-unit" id="hub-bid-unit">${bidParts(a.currentBidLakhs).unit}</span>
                </p>
                <div class="hub-leader" id="hub-leader">${leaderLine(a)}</div>
                <div class="hub-meta">
                  ${roleTag(p.role)}${p.overseas ? `<span class="tag os">Overseas</span>` : ""}
                  <span class="hub-rates">Bat ${p.batting} · Bowl ${p.bowling}</span>
                </div>
                <p class="hub-timer ${secs <= 3 ? "low" : ""}" id="timer">${state.paused ? "Paused" : secs + "s"}</p>
              </div>
            </div>
          </div>
          <div class="team-strip" id="team-strip">${teamStripHtml(a)}</div>
        </div>
        <div class="bid-box" id="bid-box">
          <p class="bid-label">Your bid</p>
          <div class="bid-bar" id="bid-actions">${bidButtonsHtml(a)}</div>
          ${a.youReason ? `<p class="why" id="bid-why">${esc(a.youReason)}</p>` : `<p class="why" id="bid-why" hidden></p>`}
          <p class="hint">Buttons show the exact points you would pay — current bid plus 1, 2 or 5. Amounts you cannot afford are hidden. When only one team is left, the player is locked immediately. New lots get 15 seconds; each bid also resets the timer to 15.</p>
          <p class="error">${esc(lastError)}</p>
        </div>
      </div>
      <aside class="panel side">
        <h3 style="display:flex;gap:8px;align-items:center">${you ? teamMark(you.franchise, "sm", you.name) : ""}${you ? esc(you.name) : "Squad"}</h3>
        ${you ? `<p class="purse">${money(you.purseLakhs)}</p><p class="lede">${you.eliminated ? "Eliminated - insufficient purse · " : ""}${you.squad.length} player${you.squad.length === 1 ? "" : "s"}${you.complete ? " · squad complete" : (() => { const n = Object.values(you.remainingQuota || {}).reduce((s, v) => s + v, 0); return n ? ` · need ${n} more` : ""; })()}</p>` : ""}
        ${you ? squadSlots(you) : ""}
      </aside>
    </section>
  `;
}

function mountAuctionRing() {
  const svg = document.getElementById("auction-ring");
  if (!svg || !state || !state.auction || !window.IplRing) return;
  IplRing.mount(svg);
  IplRing.update(svg, state.auction.stillIn || []);
  updateAuctionTimer();
  lastNomineeId = state.auction.nominee && state.auction.nominee.id;
  lastBidShown = state.auction.currentBidLakhs;
  requestAnimationFrame(fitHubName);
}

function updateAuctionTimer() {
  const a = state && state.auction;
  const svg = document.getElementById("auction-ring");
  if (!a || !svg || !window.IplRing) return;
  const left = remainingMs(a.endsAt);
  IplRing.setTimer(svg, left, a.timerMs || 15000, Boolean(state.paused));
  const t = document.getElementById("timer");
  if (t) {
    const secs = Math.ceil(left / 1000);
    t.textContent = state.paused ? "Paused" : `${secs}s`;
    t.classList.toggle("low", secs <= 3 && !state.paused);
    t.classList.toggle("paused", Boolean(state.paused));
  }
}

function setHubBid(points) {
  const parts = bidParts(points);
  const num = document.getElementById("hub-bid-num");
  const unit = document.getElementById("hub-bid-unit");
  if (num) num.textContent = String(parts.n);
  if (unit) unit.textContent = parts.unit;
}

function animateBid(from, to) {
  const wrap = document.getElementById("hub-bid");
  const num = document.getElementById("hub-bid-num");
  if (!num) {
    setHubBid(to);
    return;
  }
  const start = Number(from) || 0;
  const end = Number(to) || 0;
  const t0 = performance.now();
  const dur = 280;
  if (wrap) {
    wrap.classList.remove("pop");
    void wrap.offsetWidth;
    wrap.classList.add("pop");
  }
  function frame(now) {
    const t = Math.min(1, (now - t0) / dur);
    const val = Math.round(start + (end - start) * t);
    setHubBid(val);
    if (t < 1) requestAnimationFrame(frame);
    else setHubBid(end);
  }
  requestAnimationFrame(frame);
}

function patchAuction() {
  const a = state && state.auction;
  if (!a) return;
  const svg = document.getElementById("auction-ring");
  if (svg && window.IplRing) IplRing.update(svg, a.stillIn || []);
  const leader = document.getElementById("hub-leader");
  if (leader) leader.innerHTML = leaderLine(a);
  const hub = document.getElementById("auction-hub");
  if (hub) hub.style.setProperty("--c", a.currentBidderColor || "var(--gold)");
  if (lastBidShown != null && lastBidShown !== a.currentBidLakhs) animateBid(lastBidShown, a.currentBidLakhs);
  else setHubBid(a.currentBidLakhs);
  lastBidShown = a.currentBidLakhs;
  const actions = document.getElementById("bid-actions");
  if (actions) actions.innerHTML = bidButtonsHtml(a);
  const why = document.getElementById("bid-why");
  if (why) {
    why.hidden = !a.youReason;
    why.textContent = a.youReason || "";
  }
  const err = document.querySelector(".bid-box .error");
  if (err) err.textContent = lastError || "";
  const strip = document.getElementById("team-strip");
  if (strip) strip.innerHTML = teamStripHtml(a);
  updateAuctionTimer();
}

function captainView() {
  const you = state.you;
  const left = Math.ceil(remainingMs(state.captainEndsAt) / 1000);
  const pending = (state.captainsPending || []).map((p) => esc(p.name || p.short)).join(", ") || "none";
  const catalog = state.boosterCatalog || [];
  const owned = new Set((you?.boosters || []).map((b) => b.id));
  const picks = (you?.squad || [])
    .map(
      (s) => `
      <button class="pick ${you.captainId === s.player.id ? "selected" : ""}" data-captain="${esc(s.player.id)}">
        <strong>${esc(s.player.name)}</strong>
        <div class="lede" style="margin:4px 0 0">${s.player.role} · bat ${s.player.batting} · bowl ${s.player.bowling}</div>
      </button>`
    )
    .join("");
  const shop = catalog
    .map((b) => {
      const have = owned.has(b.id);
      const can = you && !you.eliminated && !have && you.purseLakhs >= b.pricePoints;
      return `
        <div class="booster ${have ? "owned" : ""}">
          <div>
            <strong>${esc(b.name)}</strong>
            <span class="tag">${money(b.pricePoints)}</span>
            ${have ? `<span class="tag">Bought</span>` : ""}
          </div>
          <p class="lede">${esc(b.blurb)}</p>
          <button class="btn secondary" data-buy="${esc(b.id)}" ${can ? "" : "disabled"}>${have ? "Owned" : "Buy"}</button>
        </div>`;
    })
    .join("");
  const bought = (you?.boosters || []).map((b) => esc(b.name)).join(", ") || "none yet";
  return `
    <section class="prep-layout">
      <div class="panel">
        <h2>Choose your captain</h2>
        <p class="lede">The captain gets a +5% rating boost. Auto-picks the highest-rated player if time runs out (${left}s). Waiting on: ${pending}.</p>
        <div class="captain-grid">${picks}</div>
        <div style="margin-top:18px">${you ? squadSlots(you) : ""}</div>
      </div>
      <div class="panel">
        <h2>Booster shop</h2>
        <p class="lede">Spend leftover points on one of each. Effects are modest — squad strength still matters most. Timer is shared with captain pick (${left}s). Your purse: <strong>${you ? money(you.purseLakhs) : "—"}</strong>. Owned: ${bought}.</p>
        <div class="booster-grid">${shop || `<p class="lede">No boosters available.</p>`}</div>
        <p class="error">${esc(lastError)}</p>
      </div>
    </section>
  `;
}

function matchCard(m) {
  return `
    <article class="match">
      <p class="lbl">${esc(m.label)}</p>
      <div class="scoreline">
        <div>
          <div style="color:${esc(accentColor(m.firstInnings.franchise))}">${esc(m.firstInnings.short || m.firstInnings.name)}</div>
          <b>${m.firstInnings.score}/${m.firstInnings.wickets}</b>
          <div class="lede" style="margin:0">(${m.firstInnings.overs} ov)</div>
        </div>
        <div>
          <div style="color:${esc(accentColor(m.secondInnings.franchise))}">${esc(m.secondInnings.short || m.secondInnings.name)}</div>
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
        <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>L</th><th>NR</th><th>Pts</th><th>NRR</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) =>
                `<tr><td>${r.position}</td><td style="color:${esc(r.color)}">${esc(r.name || r.short)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.lost}</td><td>${r.nr || 0}</td><td>${r.points}</td><td>${r.nrr >= 0 ? "+" : ""}${Number(r.nrr).toFixed(3)}</td></tr>`
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

function nrrText(nrr) {
  const n = Number(nrr) || 0;
  return `${n >= 0 ? "+" : ""}${n.toFixed(3)}`;
}

function teamReportCard(team) {
  if (!team) return "";
  const moments = (team.moments || []).map((m) => `<li>${esc(m.text)}</li>`).join("");
  const boosters = (team.boosters || []).map((b) => `<span class="tag">${esc(b.name)} · ${money(b.pricePoints)}</span>`).join("") || `<span class="lede">No boosters</span>`;
  const rows = (team.squad || [])
    .map((s) => {
      const st = s.stats || {};
      const bowl = st.ballsBowled ? `${st.wickets} wkts, ${st.oversBowled} ov, econ ${st.economy}` : "—";
      const bat = st.innings ? `${st.runs} runs (${st.innings} inn${st.notOuts ? `, ${st.notOuts} n.o.` : ""}${st.highest ? `, HS ${st.highest}` : ""})` : "—";
      return `<tr>
        <td>${s.isCaptain ? '<span class="cap">CAP</span> ' : ""}${esc(s.player.name)}</td>
        <td>${roleTag(s.player.role)}</td>
        <td>${money(s.priceLakhs)}</td>
        <td>${esc(bat)}</td>
        <td>${esc(bowl)}</td>
      </tr>`;
    })
    .join("");
  return `
    <article class="team-report" style="--c:${esc(team.color)}">
      <header>
        ${teamMark({ id: team.identityId, color: team.color, color2: team.color2, text: team.text }, "lg", team.name)}
        <div>
          <h3 style="color:${esc(team.text || team.color)}">${esc(team.name || team.short)}</h3>
          <p class="lede">${team.title ? esc(team.title) : ""}${team.eliminated ? (team.title ? " · " : "") + "eliminated" : ""}</p>
        </div>
        <p class="record">${team.won || 0}W–${team.lost || 0}L–${team.nr || 0}NR · ${team.points || 0} pts · NRR ${nrrText(team.nrr)}</p>
      </header>
      <div class="tags">${boosters}</div>
      ${moments ? `<ul class="moments">${moments}</ul>` : ""}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Player</th><th>Role</th><th>Price</th><th>Batting</th><th>Bowling</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </article>`;
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
              ${teamMark({ id: champ.identityId || (state.franchises || []).find((f) => f.name === champ.name)?.franchise?.id, color: champ.color, color2: champ.color2, text: champ.text }, "lg", champ.name)}
              <p class="name" style="color:${esc(champ.text || champ.color)}">${esc(champ.name || champ.short)}</p>
              <p class="lede">${champ.title ? esc(champ.title) : "Champion"}</p>
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
                      `<li><span style="color:${esc(p.text || p.color)}">${p.position}. ${esc(p.name || p.short)}</span><span>${esc(p.title)}</span></li>`
                  )
                  .join("")}
              </ol>
            </div>`
          : ""
      }
      ${
        vis.showFinal && (t.teams || []).length
          ? `<div class="panel"><h2>Squads &amp; performance</h2>
              <p class="lede">Every franchise's full squad, boosters, league record and per-player tournament stats.</p>
              <div class="team-reports">${t.teams.map(teamReportCard).join("")}</div>
            </div>`
          : ""
      }
      ${
        awards
          ? `<div class="awards">
              <div class="award"><h3>Best buy</h3><p><strong>${esc(awards.bestBuy?.playerName || "—")}</strong> (${esc(awards.bestBuy?.teamName || awards.bestBuy?.short || "")})</p><p class="lede">${esc(awards.bestBuy?.reason || "")}</p></div>
              <div class="award"><h3>Costliest flop</h3><p><strong>${esc(awards.costliestFlop?.playerName || "—")}</strong> (${esc(awards.costliestFlop?.teamName || awards.costliestFlop?.short || "")})</p><p class="lede">${esc(awards.costliestFlop?.reason || "")}</p></div>
            </div>`
          : ""
      }
    </section>
  `;
}


async function emitOrToast(event, payload, fallback) {
  lastError = "";
  const res = await emit(event, payload || {});
  if (!res || !res.ok) {
    lastError = (res && res.error) || fallback || "That did not work.";
    toast(lastError);
    if (state && state.phase === "auction" && main.querySelector("#auction-ring")) patchAuction();
    else if (state) render();
  }
  return res;
}

function wireGlobal() {
  if (wireGlobal.done) return;
  wireGlobal.done = true;
  document.addEventListener("click", async (e) => {
    const ident = e.target.closest("[data-identity]");
    if (ident) {
      await emitOrToast("selectIdentity", { identityId: ident.getAttribute("data-identity") }, "Could not pick that logo.");
      return;
    }
    if (e.target.closest("#pause")) {
      await emitOrToast("pause", {}, "Could not pause.");
      return;
    }
    if (e.target.closest("#resume")) {
      await emitOrToast("resume", {}, "Could not resume.");
      return;
    }
    if (e.target.closest("#sold-continue")) {
      await emitOrToast("continueReveal", {}, "Could not continue.");
      return;
    }
    if (e.target.closest("#end-game")) {
      const ok = await confirmAction("This ends the game for everyone and returns you to the start page. The room will be closed.");
      if (!ok) return;
      const res = await emit("endGame");
      if (!res.ok) toast(res.error || "Could not end the game.");
      else goHome();
      return;
    }
    if (e.target.closest("#leave")) {
      const res = await emit("leaveRoom");
      if (!res.ok) toast(res.error || "Could not leave.");
      goHome();
      return;
    }
    const stepBtn = e.target.closest("[data-step]");
    if (stepBtn && state && state.phase === "auction") {
      const step = Number(stepBtn.getAttribute("data-step"));
      const current = state.auction && state.auction.currentBidLakhs;
      await emitOrToast("bid", { amountLakhs: current + step }, "Bid rejected.");
      return;
    }
    if (e.target.closest("#optout") && state && state.phase === "auction") {
      await emitOrToast("optOut", {}, "Could not opt out.");
    }
  });
}

function render() {
  const auctionLive = Boolean(state && state.phase === "auction" && state.auction);
  document.documentElement.classList.toggle("is-auction", auctionLive);
  syncOverlays();
  renderTop();
  if (!state || !state.phase || !state.code || state.phase === "ended") {
    lastNomineeId = null;
    lastBidShown = null;
    main.innerHTML = homeView();
    wireHome();
    return;
  }
  if (
    state.phase === "auction" &&
    state.auction &&
    state.auction.nominee &&
    lastNomineeId === state.auction.nominee.id &&
    main.querySelector("#auction-ring")
  ) {
    patchAuction();
    return;
  }
  if (state.phase === "lobby") main.innerHTML = lobbyView();
  else if (state.phase === "auction") main.innerHTML = auctionView();
  else if (state.phase === "captains") main.innerHTML = captainView();
  else if (state.phase === "simulating" || state.phase === "results") main.innerHTML = resultsView();
  else main.innerHTML = homeView();
  wireCurrent();
  if (state.phase === "auction") mountAuctionRing();
}

function wireHome() {
  const nameEl = document.getElementById("name");
  const codeEl = document.getElementById("code");
  const session = loadSession();
  if (nameEl && session?.name && !nameEl.value) nameEl.value = session.name;
  if (codeEl && session?.code && !codeEl.value) codeEl.value = session.code;
  document.getElementById("create")?.addEventListener("click", async () => {
    lastError = "";
    const name = (nameEl?.value || "").trim();
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
    const name = (nameEl?.value || "").trim();
    const code = (codeEl?.value || "").trim();
    const res = await emit("joinRoom", { name, code });
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
      await emit("setPurse", { pursePoints: Number(e.target.value) });
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
  // Auction bid / opt-out / pause / leave are handled by wireGlobal.
  if (state.phase === "captains") {
    document.querySelectorAll("[data-captain]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await emit("selectCaptain", { playerId: btn.getAttribute("data-captain") });
      });
    });
    document.querySelectorAll("[data-buy]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        lastError = "";
        const res = await emit("buyBooster", { boosterId: btn.getAttribute("data-buy") });
        if (!res.ok) {
          lastError = res.error || "Could not buy that booster.";
          render();
        }
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
    if (state.phase === "auction" && !state.auction) {
      updateSoldRevealUi();
    }
    if (state.phase === "auction" && state.auction) {
      updateAuctionTimer();
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
      state.tournament.moments = res.moments || [];
      state.tournament.playerStats = res.playerStats || {};
      state.tournament.teams = res.teams || [];
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

socket.on("gameEnded", (info) => {
  toast(info && info.abandoned ? "The room was closed." : "The host ended the game.");
  goHome();
});

socket.on("connect_error", () => toast("Connection issue — retrying…"));

wireGlobal();
startTicks();
window.addEventListener("resize", () => {
  if (state && state.phase === "auction") fitHubName();
});
render();


window.IplApp = { get state() { return state; }, emit, socket };
