/* IPL Auction Night client */
const socket = io({ transports: ["websocket", "polling"] });

const main = document.getElementById("main");
const topMeta = document.getElementById("top-meta");
const toastEl = document.getElementById("toast");

const STORE_KEY = "ipl-auction-session";

let state = null;
let lastError = "";
let selectedMode = "classical";
let bidDraft = null;
let reveal = null; // { startedAt, skipped }
let tickTimer = null;
let lastNomineeId = null;
let lastBidShown = null;
let soldModalTimer = null;
let soldModalKey = null;
let lastTeamFillTimer = null;
let lastTeamFillKey = null;

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
  if (state && state.powerReveal && endsAt) {
    const frozenAt = (state.powerReveal.endsAt || Date.now()) - (Number(state.powerReveal.revealMs) || 0);
    return Math.max(0, endsAt - frozenAt);
  }
  return Math.max(0, (endsAt || 0) - Date.now());
}

function isTimerFrozen() {
  return Boolean(state && (state.paused || state.powerReveal || state.powerWait || isPlayerIntroActive()));
}

function characterIdOf(obj) {
  if (!obj) return "";
  return obj.characterId || obj.identityId || obj.id || "";
}

function characterApi() {
  return window.IplCharacters || window.IplIdentities;
}

function teamMark(franchise, size = "", title = "") {
  if (!franchise) return "";
  const api = characterApi();
  const pack = { ...franchise, id: characterIdOf(franchise) };
  const imgFn = api && (api.characterImg || api.logoImg);
  const img = (imgFn && pack.id)
    ? imgFn(pack, { alt: title || pack.character || pack.name || "", className: "team-mark-img" })
    : "";
  const inner = img || esc(franchise.character || "");
  const label = title || characterTooltip(franchise) || franchise.character || "";
  return `<span class="team-mark-wrap ${esc(size)}" style="--c:${esc(franchise.color)};--c2:${esc(franchise.color2 || "")}" title="${esc(label)}">${inner}</span>`;
}

function accentColor(franchise) {
  if (!franchise) return "";
  return franchise.text || franchise.color || "";
}

function characterName(franchise) {
  return (franchise && (franchise.character || franchise.name)) || "";
}

function characterTooltip(franchise) {
  const meme = characterName(franchise);
  const real = franchise && franchise.realName;
  if (meme && real && real !== meme) return `${meme} (${real})`;
  return meme || real || "";
}

function goHome() {
  try { sessionStorage.removeItem(STORE_KEY); } catch {}
  state = null;
  lastError = "";
  lastNomineeId = null;
  hideSoldModal(true);
  closePowerConfirm();
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
    const cid = characterIdOf(evt);
    const fr = cid ? { id: cid, characterId: cid, color, color2: evt.color2, text: textColor, character: evt.buyerName } : null;
    logo.innerHTML = (!unsold && fr) ? teamMark(fr, "lg", evt.buyerName || "") : "";
  }
  const playerEl = document.getElementById("sold-player");
  if (playerEl) playerEl.textContent = (evt.player && evt.player.name) || "";
  const line = document.getElementById("sold-line");
  if (line) {
    if (unsold) {
      line.innerHTML = "Went unsold.";
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
  if (isLastTeamFillActive()) {
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

function lastTeamFillLeftMs() {
  if (state && state.paused) return Math.max(0, state.pauseRemainingMs || 0);
  const until = state && (state.lastTeamFillUntil || (state.lastTeamFill && state.lastTeamFill.endsAt));
  return Math.max(0, (until || 0) - Date.now());
}

function isLastTeamFillActive() {
  if (!state || state.phase === "ended" || state.auction) return false;
  const fill = state.lastTeamFill;
  if (!fill || !fill.entries || !fill.entries.length) return false;
  const until = state.lastTeamFillUntil || fill.endsAt;
  if (until && until > Date.now()) return true;
  if (state.paused && until && !state.auction) return true;
  // Keep the overlay up until the server ends it, even if the clock just finished.
  if (fill && !state.paused) return Boolean(until);
  return false;
}

function hideLastTeamFill(force) {
  if (lastTeamFillTimer) {
    clearTimeout(lastTeamFillTimer);
    lastTeamFillTimer = null;
  }
  const modal = document.getElementById("last-team-fill");
  if (modal) {
    modal.hidden = true;
    modal.classList.remove("is-in");
  }
  if (force) lastTeamFillKey = null;
}

function updateLastTeamFillUi() {
  const modal = document.getElementById("last-team-fill");
  if (!modal || modal.hidden) return;
  const fill = state && state.lastTeamFill;
  const total = Number(fill && fill.revealMs) || 3000;
  const left = lastTeamFillLeftMs();
  const bar = document.getElementById("last-team-fill-progress-bar");
  if (bar) {
    const pct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
    bar.style.width = `${pct}%`;
  }
  const count = document.getElementById("last-team-fill-countdown");
  if (count) {
    if (state && state.paused) count.textContent = "Paused";
    else {
      const secs = Math.ceil(left / 1000);
      count.textContent = secs > 0 ? `Continuing in ${secs}s` : "Moving on…";
    }
  }
  const btn = document.getElementById("last-team-fill-continue");
  if (btn) btn.disabled = Boolean(state && state.paused);
}

function fillLastTeamFillModal(fill) {
  const modal = document.getElementById("last-team-fill");
  if (!modal || !fill) return null;
  const color = fill.color || "#f5c518";
  const textColor = fill.text || color;
  const card = document.getElementById("last-team-fill-card");
  if (card) {
    card.style.setProperty("--c", color);
    card.style.setProperty("--ct", textColor);
    card.style.setProperty("--c2", fill.color2 || "");
  }
  const teamName = fill.buyerName || fill.buyerShort || "The last team";
  const kicker = document.getElementById("last-team-fill-kicker");
  if (kicker) kicker.textContent = "Squad filled";
  const logo = document.getElementById("last-team-fill-logo");
  if (logo) {
    const cid = characterIdOf(fill);
    const fr = cid ? { id: cid, characterId: cid, color, color2: fill.color2, text: textColor, character: teamName } : null;
    logo.innerHTML = fr ? teamMark(fr, "lg", teamName) : "";
  }
  const title = document.getElementById("last-team-fill-team");
  if (title) title.textContent = teamName;
  const line = document.getElementById("last-team-fill-line");
  if (line) {
    const n = (fill.entries || []).length;
    line.textContent = n === 1
      ? "This player joins the squad at the starting bid."
      : "These players join the squad at the starting bid.";
  }
  const list = document.getElementById("last-team-fill-list");
  if (list) {
    list.innerHTML = (fill.entries || []).map((row) => {
      const p = row.player || {};
      const role = p.role ? `<span class="fill-meta">${esc(p.role)}</span>` : "";
      return `<li><span class="fill-name">${esc(p.name || "")}${role}</span><span class="fill-price">${money(row.priceLakhs)}</span></li>`;
    }).join("");
  }
  return modal;
}

function showLastTeamFillModal(fill) {
  if (!fill) return;
  const key = `${fill.buyerName || ""}:${(fill.entries || []).map((r) => (r.player && r.player.id) || "").join(",")}`;
  const already = lastTeamFillKey === key;
  const modal = already ? document.getElementById("last-team-fill") : fillLastTeamFillModal(fill);
  if (!modal) return;
  lastTeamFillKey = key;
  if (!already) {
    modal.hidden = false;
    modal.classList.remove("is-in");
    void modal.offsetWidth;
    modal.classList.add("is-in");
  } else {
    modal.hidden = false;
  }
  if (lastTeamFillTimer) {
    clearTimeout(lastTeamFillTimer);
    lastTeamFillTimer = null;
  }
  if (!(state && state.paused)) {
    lastTeamFillTimer = setTimeout(() => {
      lastTeamFillTimer = null;
      if (state && state.paused && isLastTeamFillActive()) return;
      // The server advances the game; keep the overlay until state says it's over.
      if (!isLastTeamFillActive()) hideLastTeamFill();
    }, Math.max(0, lastTeamFillLeftMs()));
  }
  updateLastTeamFillUi();
}

function syncLastTeamFill() {
  if (!state || state.phase === "ended" || state.phase === "captains" || state.phase === "results" || state.phase === "simulating") {
    hideLastTeamFill(true);
    return;
  }
  if (isLastTeamFillActive()) {
    showLastTeamFillModal(state.lastTeamFill);
    return;
  }
  hideLastTeamFill();
}


function yourCharacterId() {
  const you = state && state.you;
  const fr = you && you.franchise;
  return (fr && (fr.characterId || fr.id)) || (you && (you.characterId || you.identityId || you.key)) || "";
}

function yourCharacterLines() {
  const id = yourCharacterId();
  const api = window.IplCharacters;
  if (api && api.characterLines) return api.characterLines(id) || [];
  const fr = state && state.you && state.you.franchise;
  const raw = (fr && fr.lines) || [];
  return raw.map((item, i) => (
    typeof item === "string" ? { id: `${id}:${i}`, text: item } : item
  ));
}

function quickChatLines() {
  return yourCharacterLines();
}

function quickChatBarHtml() {
  const lines = quickChatLines();
  return lines.map((l) => `<button type="button" class="quick-chat-btn" data-quick-chat="${esc(l.id)}">${esc(l.text)}</button>`).join("");
}

function missingRolesLabel(missing) {
  if (!missing) return "—";
  if (Array.isArray(missing)) return missing.length ? missing.join(", ") : "full";
  const parts = Object.entries(missing).filter(([, n]) => n > 0).map(([role, n]) => `${role}×${n}`);
  return parts.length ? parts.join(", ") : "full";
}

function syncWaitModal() {
  const modal = document.getElementById("wait-modal");
  if (!modal) return;
  const wait = state && state.powerWait;
  const show = Boolean(wait && state.phase !== "ended" && !state.powerReveal);
  modal.hidden = !show;
  if (!show) return;
  const kicker = document.getElementById("wait-kicker");
  const title = document.getElementById("wait-title");
  const prompt = document.getElementById("wait-prompt");
  const body = document.getElementById("wait-body");
  const timer = document.getElementById("wait-timer");
  const bar = document.getElementById("quick-chat-bar");
  if (kicker) kicker.textContent = wait.powerName || "Power";
  if (title) {
    if (wait.kind === "chai") title.textContent = "Chai Break";
    else if (wait.kind === "rakhi_choices") title.textContent = wait.youMustChoose ? "Rakhi Ka Swayamvar" : "Waiting for answers";
    else title.textContent = wait.youAreActor ? (wait.powerName || "Pick a target") : `${wait.actorName || "A team"} is choosing`;
  }
  if (prompt) prompt.textContent = wait.prompt || "";
  if (timer) {
    if (wait.endsAt) {
      const secs = Math.ceil(Math.max(0, wait.endsAt - Date.now()) / 1000);
      timer.textContent = `${secs}s left`;
      timer.hidden = false;
    } else {
      timer.textContent = wait.kind === "chai" ? "Only Dolly can end this" : "";
      timer.hidden = !timer.textContent;
    }
  }
  if (bar) {
    bar.hidden = false;
    if (!bar.dataset.ready) {
      bar.innerHTML = `<p class="quick-chat-label">Quick chat</p><div class="quick-chat-row">${quickChatBarHtml()}</div>`;
      bar.dataset.ready = "1";
    }
  }
  if (!body) return;
  let html = "";
  if (wait.kind === "chai") {
    if (wait.youAreActor && wait.table) {
      html += `<div class="chai-table-wrap"><table class="chai-table"><thead><tr><th>Team</th><th>Pts</th><th>Squad</th><th>Missing</th></tr></thead><tbody>`;
      for (const row of wait.table) {
        const squad = (row.squad || []).map((p) => `${p.name} (${p.role})`).join(", ") || "—";
        html += `<tr class="${row.banned ? "is-banned" : ""}"><td>${esc(row.character || row.name)}${row.banned ? " · banned" : ""}</td><td>${row.purseLakhs}</td><td>${esc(squad)}</td><td>${esc(missingRolesLabel(row.missingRoles))}</td></tr>`;
      }
      html += `</tbody></table></div>`;
      html += `<button type="button" class="btn" id="chai-khatam">Chai khatam</button>`;
    } else {
      html += `<p class="lede">Wait for Dolly.</p>`;
    }
  } else if (wait.kind === "rakhi_choices") {
    if (wait.youMustChoose) {
      html += `<div class="wait-actions">
        <button type="button" class="btn" id="rakhi-pay" data-rakhi-choice="pay">Pay 3 points</button>
        <button type="button" class="btn secondary" id="rakhi-refuse" data-rakhi-choice="refuse">Refuse (sit out next lot)</button>
      </div>
      <p class="hint">Timeout = refuse.</p>`;
    } else {
      html += `<p class="lede">${wait.youChoice ? `You chose to ${wait.youChoice}.` : "Waiting for rivals."}</p>`;
    }
  } else if (wait.youAreActor && wait.options) {
    if (wait.kind === "pick_team") {
      html += `<div class="wait-options">` + wait.options.map((o) =>
        `<button type="button" class="btn secondary wait-pick" data-target-key="${esc(o.key)}">${esc(o.character || o.name)}${o.wipe ? ` · wipe ${o.wipe}` : ""}</button>`
      ).join("") + `</div>`;
    } else if (wait.kind === "pick_player") {
      html += `<div class="wait-options">` + wait.options.map((o) =>
        `<button type="button" class="btn secondary wait-pick" data-player-id="${esc(o.playerId)}">${esc(o.player && o.player.name)} · ${esc(o.player && o.player.role)} · ${o.priceLakhs} pts from ${esc(o.fromName)}</button>`
      ).join("") + `</div>`;
    } else if (wait.kind === "pick_swap") {
      html += `<p class="hint">Pick a rival</p><div class="wait-options">` + wait.options.map((o) =>
        `<button type="button" class="btn secondary wait-pick" data-player-id="${esc(o.playerId)}">${esc(o.player && o.player.name)} · ${esc(o.player && o.player.role)} from ${esc(o.fromName)}</button>`
      ).join("") + `</div>`;
      html += `<p class="hint">Pick your player</p><div class="wait-options">` + (wait.own || []).map((o) =>
        `<button type="button" class="btn secondary wait-swap" data-swap-id="${esc(o.playerId)}">${esc(o.player && o.player.name)} · ${esc(o.player && o.player.role)}</button>`
      ).join("") + `</div>`;
    }
  } else {
    html += "";
  }
  body.innerHTML = html;
}

function syncSamayPreview() {
  const box = document.getElementById("samay-preview");
  if (!box) return;
  const preview = state && state.you && state.you.samayPreview;
  const show = Boolean(preview && preview.length && state.phase === "auction");
  box.hidden = !show;
  if (!show) return;
  const list = document.getElementById("samay-list");
  if (!list) return;
  list.innerHTML = preview.map((p) => {
    if (p.hidden) return `<li class="is-vfx">${esc(p.name)}</li>`;
    return `<li><strong>${esc(p.name)}</strong> · ${esc(p.role)}${p.overseas ? " · OS" : ""} · Bat ${p.batting} · Bowl ${p.bowling}</li>`;
  }).join("");
}

function playerIntroSource() {
  if (!state) return null;
  return state.playerIntro || (state.auction && state.auction.playerIntro) || null;
}

function isPlayerIntroActive() {
  if (!state || state.phase !== "auction" || !state.auction) return false;
  const intro = playerIntroSource();
  if (!intro) return false;
  if (state.paused) return true;
  const until = state.playerIntroUntil || intro.endsAt;
  if (until && until > Date.now()) return true;
  // Keep the modal up until the server ends it.
  return Boolean(intro);
}

function playerIntroLeftMs() {
  if (state && state.paused) return Math.max(0, state.pauseRemainingMs || 0);
  const intro = playerIntroSource();
  const until = state && (state.playerIntroUntil || (intro && intro.endsAt));
  return Math.max(0, (until || 0) - Date.now());
}

function hidePlayerIntro() {
  const modal = document.getElementById("player-intro");
  if (modal) {
    modal.hidden = true;
    modal.classList.remove("is-in", "is-vfx");
  }
}

function fillPlayerIntro() {
  const modal = document.getElementById("player-intro");
  const a = state && state.auction;
  const p = a && a.nominee;
  if (!modal || !p) return null;
  const hidden = Boolean(p.vfxHidden || p.hidden);
  modal.classList.toggle("is-vfx", hidden);
  const nameEl = document.getElementById("player-intro-name");
  if (nameEl) nameEl.textContent = p.name || "";
  const kicker = document.getElementById("player-intro-kicker");
  if (kicker) kicker.textContent = hidden ? "VFX loading" : "On the block";
  const meta = document.getElementById("player-intro-meta");
  if (meta) {
    meta.innerHTML = hidden
      ? `<span class="tag vfx-tag">VFX</span><span class="tag">???</span>`
      : `${roleTag(p.role)}${p.overseas ? `<span class="tag os">Overseas</span>` : ""}`;
  }
  const stats = document.getElementById("player-intro-stats");
  if (stats) {
    stats.hidden = hidden;
    stats.innerHTML = hidden ? "" : `
      <div class="player-intro-stat"><span>Batting</span><strong>${esc(p.batting)}</strong>${meter(p.batting)}</div>
      <div class="player-intro-stat"><span>Bowling</span><strong>${esc(p.bowling)}</strong>${meter(p.bowling)}</div>
    `;
  }
  const bid = document.getElementById("player-intro-bid");
  const intro = playerIntroSource();
  const start = intro && intro.startBidLakhs != null ? intro.startBidLakhs : (a.startBidLakhs != null ? a.startBidLakhs : 1);
  if (bid) bid.textContent = `Starts at ${money(start)}`;
  return modal;
}

function updatePlayerIntroUi() {
  const modal = document.getElementById("player-intro");
  if (!modal || modal.hidden) return;
  const intro = playerIntroSource();
  const total = Number(intro && intro.revealMs) || 2000;
  const left = playerIntroLeftMs();
  const bar = document.getElementById("player-intro-progress-bar");
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, total ? (left / total) * 100 : 0))}%`;
  const count = document.getElementById("player-intro-countdown");
  if (count) {
    if (state && state.paused) count.textContent = "Paused";
    else {
      const secs = Math.ceil(left / 1000);
      count.textContent = secs > 0 ? `Bidding opens in ${secs}s` : "Opening bids…";
    }
  }
}

function syncPlayerIntro() {
  if (!state || state.phase !== "auction" || !isPlayerIntroActive()) {
    hidePlayerIntro();
    return;
  }
  const modal = fillPlayerIntro();
  if (!modal) return;
  if (modal.hidden) {
    modal.hidden = false;
    modal.classList.remove("is-in");
    void modal.offsetWidth;
    modal.classList.add("is-in");
  } else {
    modal.hidden = false;
  }
  updatePlayerIntroUi();
}

function syncOverlays() {
  const modal = document.getElementById("pause-modal");
  if (modal) {
    const chaiOrWait = Boolean(state && (state.chaiBreak || state.powerWait));
    const paused = Boolean(state && state.paused && !state.powerReveal && !chaiOrWait && state.phase && state.phase !== "ended");
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
  syncPlayerIntro();
  syncLastTeamFill();
  syncPowerModal();
  syncWaitModal();
  syncSamayPreview();
  syncPowerConfirm();
}

function meter(value) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return `<div class="meter" aria-hidden="true"><i style="width:${pct}%"></i></div>`;
}

function roleTag(role) {
  return `<span class="tag role-${esc(role)}">${esc(role)}</span>`;
}

function formPctOf(src) {
  if (!src || src.formPct == null || src.formPct === "") return null;
  const n = Number(src.formPct);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function formLabel(src, { prefix = "Form " } = {}) {
  const n = typeof src === "number" ? Math.round(src) : formPctOf(src);
  if (n == null) return "";
  const cls = n > 100 ? "is-hot" : n < 100 ? "is-cold" : "is-even";
  return `<span class="form-pct ${cls}">${prefix}${n}%</span>`;
}

const MODE_FALLBACKS = {
  classical: { id: "classical", name: "Classical", squadSize: 11, purse: 100, overs: 20, quota: { BAT: 4, WK: 1, AR: 2, BOWL: 4 }, compositionLabel: "4 BAT · 1 WK · 2 AR · 4 BOWL", purseOptions: [50, 75, 100, 120, 150], summary: "Classical · 11-player squad", blurb: "Full IPL-style auction" },
  rapid: { id: "rapid", name: "Rapid", squadSize: 5, purse: 50, overs: 10, quota: { BAT: 2, WK: 1, AR: 0, BOWL: 2 }, compositionLabel: "2 BAT · 1 WK · 2 BOWL", purseOptions: [30, 40, 50, 65, 80], summary: "Rapid · 5-player squad", blurb: "Five-player sprint" },
  bullet: { id: "bullet", name: "Bullet", squadSize: 3, purse: 30, overs: 6, quota: { BAT: 1, WK: 1, AR: 0, BOWL: 1 }, compositionLabel: "1 BAT · 1 WK · 1 BOWL", purseOptions: [20, 25, 30, 40, 50], summary: "Bullet · 3-player squad", blurb: "Three-player dash" },
};

function modeInfo() {
  const raw = state && state.mode;
  const id = (raw && raw.id) || (typeof raw === "string" ? raw : "classical");
  const base = MODE_FALLBACKS[id] || MODE_FALLBACKS.classical;
  if (raw && typeof raw === "object") return { ...base, ...raw, quota: raw.quota || base.quota, purseOptions: raw.purseOptions || base.purseOptions };
  return base;
}

function modePill() {
  const m = modeInfo();
  return `<span class="pill mode-pill">${esc(m.name)} · ${m.squadSize} players</span>`;
}

function gameModeCards() {
  return ["classical", "rapid", "bullet"].map((id) => {
    const m = MODE_FALLBACKS[id];
    const on = selectedMode === id;
    return `<button type="button" class="game-mode ${on ? "selected" : ""}" data-mode="${id}" role="radio" aria-checked="${on ? "true" : "false"}">
      <strong>${esc(m.name)}</strong>
      <span class="game-mode-size">${m.squadSize}-player squad</span>
      <small>${esc(m.compositionLabel)}</small>
    </button>`;
  }).join("");
}

function renderTop() {
  if (!state || !state.code || state.phase === "ended") {
    topMeta.hidden = true;
    topMeta.innerHTML = "";
    return;
  }
  topMeta.hidden = false;
  const you = state.you;
  const canPause = state.phase === "auction" || state.phase === "captains" || isResultsRevealPending();
  const pauseLabel = state.paused ? "Paused" : "Pause";
  const hostEnd = you && you.isHost
    ? `<button class="btn danger" id="end-game" type="button">End game</button>`
    : `<button class="btn secondary" id="leave" type="button">Leave</button>`;
  const youPill = you
    ? `<span class="pill" style="display:inline-flex;gap:8px;align-items:center">${teamMark(you.franchise, "sm", you.name)}<span style="color:${esc(accentColor(you.franchise))}">${esc(you.name)}</span></span>`
    : "";
  if (state.phase === "lobby") {
    topMeta.innerHTML = `
      ${youPill}
      <span class="top-actions">${hostEnd}</span>
    `;
    return;
  }
  topMeta.innerHTML = `
    <span class="pill">Room <strong>${esc(state.code)}</strong></span>
    ${modePill()}
    <span class="pill">${esc(state.phase)}</span>
    ${youPill}
    ${you ? `<span class="pill">Purse <strong>${money(you.purseLakhs)}</strong></span>` : ""}
    <span class="top-actions">
      ${canPause ? `<button class="btn secondary" id="pause" type="button" ${state.paused || state.powerReveal ? "disabled" : ""}>${pauseLabel}</button>` : ""}
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
        <p class="hint">Must be unique in the room. Rejoin with the same name and code.</p>
      </div>
      <section class="hero">
        <div class="panel">
          <h2>Create a room</h2>
          <div class="game-mode-block">
            <p class="game-mode-label" id="game-type-label">Game type</p>
            <div class="game-modes" role="radiogroup" aria-labelledby="game-type-label">${gameModeCards()}</div>
          </div>
          <div class="actions">
            <button class="btn" id="create">Create room</button>
          </div>
          <p class="hint">2–10 teams. Purse and squad size follow the game type.</p>
        </div>
        <div class="panel">
          <h2>Join a room</h2>
          <p class="lede">Enter the 6-character room code.</p>
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
  const api = characterApi();
  const catalog = (api && (api.CHARACTERS || api.IDENTITIES)) || state.characters || state.identities || [];
  const mine = characterIdOf(state.you && state.you.franchise);
  const ownerById = new Map();
  for (const f of state.franchises || []) {
    const id = characterIdOf(f.franchise);
    if (id) ownerById.set(id, f.name);
  }
  const getPack = api && (api.getCharacter || api.getIdentity);
  const imgFn = api && (api.characterImg || api.logoImg);
  const picker = catalog
    .map((id) => {
      const pack = id && id.id ? id : ((getPack && getPack(id)) || {});
      const selected = Boolean(mine && pack.id === mine);
      const used = ownerById.has(pack.id) && !selected;
      const label = characterName(pack);
      const tip = characterTooltip(pack);
      const owner = used ? (ownerById.get(pack.id) || "") : "";
      const aria = used && owner ? `${label}, taken by ${owner}` : tip || label;
      const img = imgFn ? imgFn(pack, { alt: tip || label, className: "team-mark-img" }) : "";
      const power = pack.power && pack.power.name ? pack.power : null;
      const powerTip = power ? `${power.name}${power.description ? ` — ${power.description}` : ""}` : "";
      const powerLine = selected && power ? `<span class="character-power" title="${esc(powerTip)}">${esc(power.name)}</span>` : "";
      const nameLine = label ? `<span class="character-label">${esc(label)}</span>` : "";
      return `<button type="button" class="character-choice logo-choice ${selected ? "selected" : ""} ${used ? "taken" : ""}" data-character="${esc(pack.id)}" data-identity="${esc(pack.id)}" style="--c:${esc(pack.color)}" ${used ? "disabled" : ""} title="${esc(tip || label)}" aria-label="${esc(aria)}">
        ${img}
        ${nameLine}
        ${powerLine}
        ${used && owner ? `<span class="character-owner">${esc(owner)}</span>` : ""}
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
          ${(() => {
            const bits = [];
            if (f.isHost) bits.push("Host");
            if (!f.connected) bits.push("offline");
            if (f.eliminated) bits.push("eliminated");
            const form = formLabel(f);
            const owner = bits.length ? `<p class="owner">${esc(bits.join(" · "))}</p>` : "";
            return `${owner}${form ? `<p class="owner">${form}</p>` : ""}`;
          })()}
        </div>
      </div>`
    )
    .join("");
  const mode = modeInfo();
  const purseOpts = [...(mode.purseOptions || [50, 75, 100, 120, 150])];
  if (state.purseLakhs && !purseOpts.includes(state.purseLakhs)) purseOpts.push(state.purseLakhs);
  purseOpts.sort((a, b) => a - b);
  const purseSelect = isHost
    ? `<div class="lobby-purse">
        <label for="purse">Purse</label>
        <select id="purse">
          ${purseOpts.map((n) => `<option value="${n}" ${state.purseLakhs === n ? "selected" : ""}>${n}</option>`).join("")}
        </select>
      </div>`
    : `<p class="lobby-purse-read">${money(state.purseLakhs)} each</p>`;
  const startHint = isHost
    ? `<p class="hint">Min ${state.minPlayers} teams to start.</p>`
    : `<p class="hint">Waiting for the host to start.</p>`;
  return `
    <section class="panel lobby">
      <div class="lobby-share">
        <p class="lobby-share-label">Share this code</p>
        <p class="room-code">${esc(state.code)}</p>
      </div>
      <div class="lobby-settings">
        <p class="lobby-mode">${esc(mode.name)} · ${esc(mode.compositionLabel)}</p>
        ${purseSelect}
      </div>
      <div class="lobby-teams">
        <p class="lobby-teams-label">Teams ${state.franchises.length} / ${state.maxPlayers}</p>
        <div class="franchise-grid">${cards}</div>
      </div>
      <div class="actions lobby-start">
        ${isHost ? `<button class="btn" id="start" ${ready ? "" : "disabled"}>Start auction</button>` : ""}
        ${startHint}
      </div>
      <p class="error">${esc(lastError)}</p>
      <div class="character-section" id="choose-character">
        <h3>Choose your co-owner</h3>
        <p class="hint">Greyed-out co-owners are taken. Unpicked ones are assigned at start.</p>
        <div class="character-picker logo-picker">${picker}</div>
      </div>
    </section>
  `;
}

function squadSlots(franchise) {
  const quota = (modeInfo().quota) || { BAT: 4, WK: 1, AR: 2, BOWL: 4 };
  const groups = ["BAT", "WK", "AR", "BOWL"]
    .map((role) => [role, quota[role] || 0])
    .filter(([, n]) => n > 0);
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
      const live = (state.franchises || []).find((f) => f.name === row.name);
      const pending = row.pending != null ? row.pending : Math.max(0, (state.squadSize || modeInfo().squadSize || 11) - (row.squadSize || 0));
      const done = Boolean(row.complete) || Boolean(live && live.complete) || pending === 0;
      const out = !row.eliminated && !done && !still.has(row.name);
      const banned = Boolean((live && live.banned) || row.banned);
      const cls = [
        "team-chip",
        banned ? "is-banned" : "",
        row.eliminated && !banned ? "is-eliminated" : "",
        done && !row.eliminated ? "is-done" : "",
        out ? "is-out" : "",
        leader && row.name === leader ? "is-leader" : "",
      ].filter(Boolean).join(" ");
      const powerUsed = Boolean((live && live.powerUsed) || row.powerUsed);
      const need = banned ? "banned" : row.eliminated ? "out" : done ? "done" : `need ${pending}`;
      const formSrc = (live && live.formPct != null) ? live : row;
      const form = formLabel(formSrc);
      const formTip = formPctOf(formSrc) != null ? ` · Form ${formPctOf(formSrc)}%` : "";
      const tip = `${row.name} · ${row.purseLakhs} pts at start of this lot · ${
        banned ? "Banned for match fixing" : row.eliminated ? "eliminated" : done ? "squad complete" : out ? "opted out of this player" : `${pending} slot${pending === 1 ? "" : "s"} left`
      }${powerUsed ? " · power used" : ""}${formTip}`;
      const fr = { id: characterIdOf(row), characterId: characterIdOf(row), color: row.color, color2: row.color2, text: row.text };
      return `<button type="button" class="${cls}" data-team-id="${esc((row.name || "").toLowerCase())}" data-team-name="${esc(row.name)}" title="${esc(tip)}" style="--c:${esc(row.color)};--c2:${esc(row.color2 || "")};--ct:${esc(row.text || row.color)}">
        ${teamMark(fr, "sm", row.name)}
        <span class="chip-name">${esc(row.name)}${banned ? `<span class="chip-banned" title="Banned for match fixing">banned</span>` : ""}${powerUsed ? `<span class="chip-power-used" title="Power used">⚡</span>` : ""}</span>
        <span class="chip-meta"><b>${row.purseLakhs}</b><small>${esc(need)}</small></span>
        ${form}
      </button>`;
    })
    .join("");
}



function isStaleLobbyPowerGate(you) {
  return Boolean(
    state
    && state.phase === "auction"
    && you
    && you.canUsePower === false
    && you.canUsePowerReason === "Powers can only be used during the auction."
  );
}

function powerUseBlocked(you, used) {
  if (!you) return true;
  if (you.eliminated || you.banned) return true;
  if (you.canUsePower === false && !used && !isStaleLobbyPowerGate(you)) return true;
  return false;
}

function yourPower() {
  const you = state && state.you;
  if (!you) return null;
  if (you.power && you.power.name) return you.power;
  const pack = you.franchise && you.franchise.power;
  return pack && pack.name ? pack : null;
}

function shortenPowerReason(reason) {
  const api = window.IplPowerReasons;
  if (api && typeof api.shortenPowerReason === "function") return api.shortenPowerReason(reason);
  return reason || null;
}

function powerDisabledReason() {
  const you = state && state.you;
  if (!you || !state || state.phase !== "auction") return null;
  const power = yourPower();
  const used = Boolean(you.powerUsed) || (you.powerUsesLeft != null && you.powerUsesLeft <= 0) || (power && power.used);
  if (used) return "Used already";
  if (typeof isPlayerIntroActive === "function" && isPlayerIntroActive()) return "Not during intro";
  if (typeof isSoldRevealActive === "function" && isSoldRevealActive()) return "Lot sold";
  if (typeof isLastTeamFillActive === "function" && isLastTeamFillActive()) return "Squad being filled";
  if (state.paused) return "Paused";
  if (state.powerReveal) return "A power is on screen";
  if (state.powerWait) return "A power is waiting";
  if (you.banned) return "Banned";
  if (you.eliminated) return "Eliminated";
  if (isStaleLobbyPowerGate(you)) return null;
  if (you.canUsePowerHint) return you.canUsePowerHint;
  if (you.canUsePowerReason) return shortenPowerReason(you.canUsePowerReason);
  return null;
}

function powerButtonHtml() {
  const you = state && state.you;
  const power = yourPower();
  if (!you || !power || (state && state.phase !== "auction")) return "";
  const used = Boolean(you.powerUsed) || (you.powerUsesLeft != null && you.powerUsesLeft <= 0) || (power.used);
  const busy = Boolean(state.paused || state.powerReveal || state.powerWait || (typeof isSoldRevealActive === "function" && isSoldRevealActive()) || (typeof isLastTeamFillActive === "function" && isLastTeamFillActive()) || (typeof isPlayerIntroActive === "function" && isPlayerIntroActive()));
  const blocked = powerUseBlocked(you, used);
  const disabled = used || busy || blocked;
  const why = disabled ? powerDisabledReason() : null;
  const title = why || you.canUsePowerReason || power.description || power.name;
  const label = used ? `${power.name} used` : power.name;
  const whyHtml = why
    ? `<p class="power-why" id="power-why">${esc(why)}</p>`
    : `<p class="power-why" id="power-why" hidden></p>`;
  return `<button type="button" class="power-btn ${used ? "is-used" : ""}" id="use-power" ${disabled ? "disabled" : ""} title="${esc(title)}" aria-describedby="${why ? "power-why" : ""}" aria-label="${esc(used ? label : `Use power: ${power.name}. ${title}`)}">
    ${teamMark(you.franchise, "sm", you.name)}
    <span class="power-btn-copy"><small>Power${used ? " used" : " · once"}</small><strong>${esc(power.name)}</strong></span>
  </button>${whyHtml}`;
}

function canShowPowerConfirm() {
  const you = state && state.you;
  const power = yourPower();
  if (!you || !power || !state || state.phase !== "auction") return false;
  const used = Boolean(you.powerUsed) || (you.powerUsesLeft != null && you.powerUsesLeft <= 0) || power.used;
  const busy = Boolean(state.paused || state.powerReveal || state.powerWait || (typeof isSoldRevealActive === "function" && isSoldRevealActive()) || (typeof isLastTeamFillActive === "function" && isLastTeamFillActive()) || (typeof isPlayerIntroActive === "function" && isPlayerIntroActive()));
  const blocked = powerUseBlocked(you, used);
  return !used && !busy && !blocked;
}

function isPowerConfirmOpen() {
  const modal = document.getElementById("power-confirm");
  return Boolean(modal && !modal.hidden);
}

function closePowerConfirm() {
  const modal = document.getElementById("power-confirm");
  if (modal) modal.hidden = true;
}

function openPowerConfirm() {
  if (!canShowPowerConfirm()) return false;
  const you = state.you;
  const power = yourPower();
  const modal = document.getElementById("power-confirm");
  if (!modal) return false;
  const face = document.getElementById("power-confirm-face");
  if (face) face.innerHTML = you.franchise ? teamMark(you.franchise, "lg", you.name) : "";
  const nameEl = document.getElementById("power-confirm-name");
  if (nameEl) nameEl.textContent = power.name || "Power";
  const funnyEl = document.getElementById("power-confirm-funny");
  const funny = (power.funnyDesc || "").trim();
  if (funnyEl) {
    funnyEl.textContent = funny;
    funnyEl.hidden = !funny;
  }
  const descEl = document.getElementById("power-confirm-desc");
  const rule = (power.shortDesc || (!funny && power.description) || "").trim();
  if (descEl) {
    descEl.textContent = rule;
    descEl.hidden = !rule;
  }
  modal.hidden = false;
  const useBtn = document.getElementById("power-confirm-use");
  if (useBtn) useBtn.focus();
  return true;
}

function syncPowerConfirm() {
  if (isPowerConfirmOpen() && !canShowPowerConfirm()) closePowerConfirm();
}

async function confirmAndUsePower() {
  closePowerConfirm();
  if (!canShowPowerConfirm()) return;
  lastError = "";
  const res = await emit("usePower", {});
  if (!res || !res.ok) {
    lastError = (res && res.error) || "Could not use your power.";
    toast(lastError);
    render();
  }
}

function fillPowerModal(evt) {
  const modal = document.getElementById("power-modal");
  if (!modal || !evt) return modal;
  const card = document.getElementById("power-card");
  const color = evt.color || "var(--gold)";
  if (card) card.style.setProperty("--c", color);
  const kicker = document.getElementById("power-kicker");
  if (kicker) kicker.textContent = "Power";
  const face = document.getElementById("power-face");
  if (face) {
    const fr = { id: evt.characterId, characterId: evt.characterId, color: evt.color, image: evt.image };
    face.innerHTML = teamMark(fr, "lg", evt.powerName || "");
  }
  const nameEl = document.getElementById("power-name");
  if (nameEl) nameEl.textContent = evt.powerName || "Power";
  const teamEl = document.getElementById("power-team");
  if (teamEl) teamEl.textContent = evt.message || (evt.name ? `${evt.name} used their power` : "");
  const desc = document.getElementById("power-desc");
  if (desc) desc.textContent = evt.description || "";
  return modal;
}

function hidePowerModal() {
  const modal = document.getElementById("power-modal");
  if (modal) {
    modal.hidden = true;
    modal.classList.remove("is-in");
  }
}

function showPowerModal(evt) {
  const modal = fillPowerModal(evt);
  if (!modal) return;
  modal.hidden = false;
  modal.classList.remove("is-in");
  void modal.offsetWidth;
  modal.classList.add("is-in");
}

function syncPowerModal() {
  const modal = document.getElementById("power-modal");
  if (!modal) return;
  const ev = state && state.powerReveal;
  if (state && state.phase === "auction" && ev) {
    showPowerModal(ev);
    return;
  }
  hidePowerModal();
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
    id: characterIdOf(row),
    characterId: characterIdOf(row),
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
      <div class="panel player-card ${p.vfxHidden ? "is-vfx" : ""}">
        <p class="lede">${esc(modeInfo().compositionLabel)} · ${a.lotId && a.lotTotal ? `Lot ${a.lotId} of ${a.lotTotal}` : a.lotId ? `Lot ${a.lotId}` : "On the block"} · starts at ${money(a.startBidLakhs != null ? a.startBidLakhs : 1)}</p>
        <div class="auction-stage">
          <div class="ring-wrap">
            <div class="ring-stage">
              <div class="ring-ground-shadow" aria-hidden="true"></div>
              <div class="ring-tilt">
                <svg id="auction-ring" role="img" aria-label="Teams still bidding"></svg>
              </div>
            </div>
            <div class="hub" id="auction-hub" style="--c:${esc(a.currentBidderColor || "var(--gold)")}">
              <div class="hub-inner">
                <p class="hub-name ${p.vfxHidden ? "is-vfx" : ""}" id="hub-name">${esc(p.name)}</p>
                <p class="hub-bid" id="hub-bid">
                  <span class="hub-bid-num" id="hub-bid-num">${bidParts(a.currentBidLakhs).n}</span>
                  <span class="hub-bid-unit" id="hub-bid-unit">${bidParts(a.currentBidLakhs).unit}</span>
                </p>
                <div class="hub-leader" id="hub-leader">${leaderLine(a)}</div>
                <div class="hub-meta ${p.vfxHidden ? "is-vfx" : ""}">
                  ${p.vfxHidden ? `<span class="tag vfx-tag">VFX</span><span class="hub-rates">Hidden</span>` : `${roleTag(p.role)}${p.overseas ? `<span class="tag os">Overseas</span>` : ""}
                  <span class="hub-rates">Bat ${p.batting} · Bowl ${p.bowling}</span>`}
                </div>
                <p class="hub-timer ${secs <= 3 && !isTimerFrozen() && a.endsAt ? "low" : ""} ${isTimerFrozen() || isPlayerIntroActive() || !a.endsAt ? "paused" : ""}" id="timer">${isPlayerIntroActive() || !a.endsAt ? "Soon" : (isTimerFrozen() ? "Paused" : secs + "s")}</p>
              </div>
            </div>
          </div>
          <div class="team-strip" id="team-strip">${teamStripHtml(a)}</div>
        </div>
        <div class="bid-box" id="bid-box">
          <div id="power-btn-wrap">${powerButtonHtml()}</div>
          <p class="bid-label">Your bid</p>
          <div class="bid-bar" id="bid-actions">${bidButtonsHtml(a)}</div>
          ${a.youReason ? `<p class="why" id="bid-why">${esc(a.youReason)}</p>` : `<p class="why" id="bid-why" hidden></p>`}
          <p class="error">${esc(lastError)}</p>
        </div>
      </div>
      <aside class="panel side">
        <h3 style="display:flex;gap:8px;align-items:center">${you ? teamMark(you.franchise, "sm", you.name) : ""}${you ? esc(you.name) : "Squad"}</h3>
        ${you ? `<p class="purse">${money(you.purseLakhs)}</p><p class="lede" id="side-lede">${you.banned ? "Banned for match fixing · " : you.eliminated ? "Eliminated - insufficient purse · " : ""}${you.squad.length} player${you.squad.length === 1 ? "" : "s"}${you.complete ? " · squad complete" : (() => { const n = Object.values(you.remainingQuota || {}).reduce((s, v) => s + v, 0); return n ? ` · need ${n} more` : ""; })()}${formPctOf(you) != null ? ` · ${formLabel(you)}` : ""}</p>` : ""}
        ${you ? `<div id="side-slots">${squadSlots(you)}</div>` : ""}
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
  const frozen = isTimerFrozen();
  IplRing.setTimer(svg, left, a.timerMs || 25000, frozen || !a.endsAt);
  const t = document.getElementById("timer");
  if (t) {
    const intro = isPlayerIntroActive();
    const secs = Math.ceil(left / 1000);
    t.textContent = intro ? "Soon" : (frozen ? "Paused" : (a.endsAt ? `${secs}s` : "Soon"));
    t.classList.toggle("low", !intro && secs <= 3 && !frozen && a.endsAt);
    t.classList.toggle("paused", frozen || intro || !a.endsAt);
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
  const powerWrap = document.getElementById("power-btn-wrap");
  if (powerWrap) powerWrap.innerHTML = powerButtonHtml();
  syncPowerConfirm();
  const purse = document.querySelector(".side .purse");
  if (purse && state.you) purse.textContent = money(state.you.purseLakhs);
  const sideSlots = document.getElementById("side-slots");
  if (sideSlots && state.you) sideSlots.innerHTML = squadSlots(state.you);
  const lede = document.getElementById("side-lede");
  if (lede && state.you) {
    const you = state.you;
    const need = you.complete ? " · squad complete" : (() => {
      const n = Object.values(you.remainingQuota || {}).reduce((s, v) => s + v, 0);
      return n ? ` · need ${n} more` : "";
    })();
    const prefix = you.banned ? "Banned for match fixing · " : you.eliminated ? "Eliminated - insufficient purse · " : "";
    const form = formPctOf(you) != null ? ` · ${formLabel(you)}` : "";
    lede.innerHTML = `${prefix}${you.squad.length} player${you.squad.length === 1 ? "" : "s"}${need}${form}`;
  }
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
        <p class="lede">+5% rating. Auto-picks if time runs out. ${left}s left. Waiting on: ${pending}.${you && formPctOf(you) != null ? ` ${formLabel(you)}.` : ""}</p>
        <div class="captain-grid">${picks}</div>
        <div style="margin-top:18px">${you ? squadSlots(you) : ""}</div>
      </div>
      <div class="panel">
        <h2>Booster shop</h2>
        <p class="lede">Buy one of each. Purse: <strong>${you ? money(you.purseLakhs) : "—"}</strong>. Owned: ${bought}.${you && formPctOf(you) != null ? ` ${formLabel(you)}.` : ""}</p>
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
          <div class="lede" style="margin:0">(${m.firstInnings.overs} ov)${formPctOf(m.firstInnings) != null ? ` · ${formLabel(m.firstInnings)}` : ""}</div>
        </div>
        <div>
          <div style="color:${esc(accentColor(m.secondInnings.franchise))}">${esc(m.secondInnings.short || m.secondInnings.name)}</div>
          <b>${m.secondInnings.score}/${m.secondInnings.wickets}</b>
          <div class="lede" style="margin:0">(${m.secondInnings.overs} ov)${formPctOf(m.secondInnings) != null ? ` · ${formLabel(m.secondInnings)}` : ""}</div>
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
        <thead><tr><th>#</th><th>Team</th><th>Form</th><th>P</th><th>W</th><th>L</th><th>NR</th><th>Pts</th><th>NRR</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) =>
                `<tr><td>${r.position}</td><td style="color:${esc(r.color)}">${esc(r.name || r.short)}</td><td>${formPctOf(r) != null ? formLabel(r, { prefix: "" }) : "—"}</td><td>${r.played}</td><td>${r.won}</td><td>${r.lost}</td><td>${r.nr || 0}</td><td>${r.points}</td><td>${r.nrr >= 0 ? "+" : ""}${Number(r.nrr).toFixed(3)}</td></tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function resultsRevealInfo() {
  return (state && state.resultsReveal) || null;
}

function isResultsRevealPending() {
  const r = resultsRevealInfo();
  if (!state || state.phase !== "results" || !r) return false;
  return !r.complete && !r.skipped && r.revealedCount < r.total;
}

function visibleTournament() {
  const t = state.tournament;
  if (!t) return { league: [], playoffs: [], showTable: false, showFinal: false, showAwards: false };
  if (isResultsRevealPending()) {
    return { league: [], playoffs: [], showTable: false, showFinal: false, showAwards: false };
  }
  const leagueAll = t.leagueMatches || [];
  const poAll = (t.playoffs && t.playoffs.matches) || [];
  return { league: leagueAll, playoffs: poAll, showTable: true, showFinal: true, showAwards: true };
}

function resultStandingsCard(pos, fresh) {
  if (!pos) return "";
  const champ = (pos.finish || pos.title) === "Champion";
  const form = formPctOf(pos) != null ? formLabel(pos) : "";
  const score = pos.squadScore != null ? String(pos.squadScore) : "—";
  const cid = characterIdOf(pos);
  const mark = teamMark({ id: cid, characterId: cid, color: pos.color, color2: pos.color2, text: pos.text }, "lg", pos.name);
  return `<article class="result-card ${champ ? "is-champion" : ""} ${fresh ? "is-fresh" : ""}" style="--c:${esc(pos.color || "")};--ct:${esc(pos.text || pos.color || "")};--c2:${esc(pos.color2 || "")}">
    <span class="result-pos">${esc(pos.position)}</span>
    ${mark}
    <div class="result-card-body">
      <h3>${esc(pos.name || pos.short || "")}</h3>
      <p class="result-finish">${esc(pos.finish || pos.title || "")}</p>
    </div>
    <div class="result-card-stats">
      ${form ? `<p class="result-form">${form}</p>` : ""}
      <p class="result-score"><strong>${esc(score)}</strong><span> / 1000</span></p>
      <p class="lede result-score-label">Squad strength</p>
    </div>
  </article>`;
}

function standingsRevealHtml(pending) {
  const t = state.tournament;
  const r = resultsRevealInfo() || { revealedCount: (t.positions || []).length, total: (t.positions || []).length, complete: true };
  const order = [...(t.positions || [])].reverse();
  const count = r.skipped || r.complete ? order.length : Math.max(0, Math.min(order.length, Number(r.revealedCount) || 0));
  const shown = order.slice(0, count);
  const cards = shown.map((pos, i) => resultStandingsCard(pos, pending && i === shown.length - 1)).join("");
  const skip = pending
    ? `<div class="results-reveal-actions"><button class="btn secondary" id="skip-reveal" type="button">Skip</button></div>`
    : "";
  const kicker = pending
    ? `Revealing ${count} of ${order.length}`
    : "Last place to champion";
  return `
    <div class="panel results-reveal">
      <div class="results-reveal-head">
        <div>
          <p class="kicker">${kicker}</p>
          <h2>${pending ? "Results" : "Final standings"}</h2>
        </div>
      </div>
      <div class="results-reveal-stage">
        <div class="results-reveal-list" id="results-reveal-list">${cards || `<p class="lede">The last teams are about to appear…</p>`}</div>
      </div>
      ${skip}
    </div>`;
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
        ${teamMark({ id: characterIdOf(team), characterId: characterIdOf(team), color: team.color, color2: team.color2, text: team.text }, "lg", team.name)}
        <div>
          <h3 style="color:${esc(team.text || team.color)}">${esc(team.name || team.short)}</h3>
          <p class="lede">${team.finish || team.title ? esc(team.finish || team.title) : ""}${team.eliminated ? ((team.finish || team.title) ? " · " : "") + "eliminated" : ""}${formPctOf(team) != null ? `${team.finish || team.title || team.eliminated ? " · " : ""}${formLabel(team)}` : ""}${team.squadScore != null ? `${team.finish || team.title || team.eliminated || formPctOf(team) != null ? " · " : ""}Squad ${team.squadScore}/1000` : ""}</p>
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
    return `<section class="panel"><h2>Simulating…</h2><p class="lede">Results incoming.</p></section>`;
  }
  const pending = isResultsRevealPending();
  if (pending) {
    return `<section class="results">${standingsRevealHtml(true)}</section>`;
  }
  const vis = visibleTournament();
  const champ = vis.showFinal && t.champion ? t.champion : null;
  const awards = vis.showAwards ? t.awards : null;
  return `
    <section class="results">
      ${standingsRevealHtml(false)}
      ${
        champ
          ? `<div class="panel champion">
              <h2>Champion</h2>
              ${teamMark({ id: characterIdOf(champ) || characterIdOf((state.franchises || []).find((f) => f.name === champ.name)?.franchise), color: champ.color, color2: champ.color2, text: champ.text }, "lg", champ.name)}
              <p class="name" style="color:${esc(champ.text || champ.color)}">${esc(champ.name || champ.short)}</p>
              <p class="lede">${champ.title ? esc(champ.title) : "Champion"}</p>
            </div>`
          : ""
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
                      `<li><span style="color:${esc(p.text || p.color)}">${p.position}. ${esc(p.name || p.short)}${formPctOf(p) != null ? ` ${formLabel(p)}` : ""}${p.squadScore != null ? ` · ${p.squadScore}/1000` : ""}</span><span>${esc(p.finish || p.title)}</span></li>`
                  )
                  .join("")}
              </ol>
            </div>`
          : ""
      }
      ${
        vis.showFinal && (t.teams || []).length
          ? `<div class="panel"><h2>Squads &amp; performance</h2>
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


function emoteCatalog() {
  return window.IplEmotes || { EMOTES: [], emojis: () => [], phrases: () => [], getEmote: () => null, isValidEmoteId: () => false, EMOTE_DURATION_MS: 3200, EMOTE_MAX_VISIBLE: 40 };
}

let emotePickerOpen = false;
const liveEmotes = [];

function closeEmotePicker() {
  emotePickerOpen = false;
  const pop = document.getElementById("emote-popover");
  const btn = document.getElementById("emote-btn");
  if (pop) pop.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function toggleEmotePicker() {
  if (emotePickerOpen) {
    closeEmotePicker();
    return;
  }
  emotePickerOpen = true;
  const pop = document.getElementById("emote-popover");
  const btn = document.getElementById("emote-btn");
  if (pop) pop.hidden = false;
  if (btn) btn.setAttribute("aria-expanded", "true");
}

function emotePickerHtml() {
  const cat = emoteCatalog();
  const emojiBtns = (cat.emojis ? cat.emojis() : []).map((e) => (
    `<button type="button" class="emote-pick-emoji" data-emote="${esc(e.id)}" title="${esc(e.glyph)}" aria-label="${esc(e.glyph)}">${e.glyph}</button>`
  )).join("");
  const phraseBtns = yourCharacterLines().map((e) => (
    `<button type="button" class="emote-pick-phrase" data-emote="${esc(e.id)}">${esc(e.text)}</button>`
  )).join("");
  return `
    <button type="button" class="emote-btn" id="emote-btn" aria-expanded="false" aria-haspopup="dialog" aria-controls="emote-popover" title="Send a reaction" aria-label="Send a reaction">😀</button>
    <div class="emote-popover" id="emote-popover" role="dialog" aria-label="Reactions" hidden>
      <div class="emote-emoji-row">${emojiBtns}</div>
      <div class="emote-phrase-list">${phraseBtns}</div>
    </div>`;
}

function ensureEmoteDock() {
  let dock = document.getElementById("emote-dock");
  if (dock) return dock;
  dock = document.createElement("div");
  dock.id = "emote-dock";
  dock.className = "emote-dock";
  dock.hidden = true;
  dock.innerHTML = emotePickerHtml();
  document.body.appendChild(dock);
  return dock;
}

function syncEmoteDock() {
  const dock = ensureEmoteDock();
  const show = Boolean(state && state.phase === "auction" && state.you);
  dock.hidden = !show;
  if (!show) {
    closeEmotePicker();
    dock.classList.remove("is-fixed");
    if (dock.parentElement !== document.body) document.body.appendChild(dock);
    return;
  }
  const linesKey = yourCharacterLines().map((l) => l.id).join("|");
  if (dock.dataset.lines !== linesKey) {
    dock.innerHTML = emotePickerHtml();
    dock.dataset.lines = linesKey;
  }
  const overlayUp = isSoldRevealActive() || isLastTeamFillActive() || isPlayerIntroActive() || Boolean(state.paused);
  const wrap = document.querySelector(".ring-wrap");
  if (wrap && !overlayUp) {
    if (dock.parentElement !== wrap) wrap.appendChild(dock);
    dock.classList.remove("is-fixed");
  } else {
    if (dock.parentElement !== document.body) document.body.appendChild(dock);
    dock.classList.add("is-fixed");
  }
  const btn = document.getElementById("emote-btn");
  if (btn) btn.disabled = false;
  const pop = document.getElementById("emote-popover");
  if (pop) pop.hidden = !emotePickerOpen;
  if (btn) btn.setAttribute("aria-expanded", emotePickerOpen ? "true" : "false");
}

function findEmoteTeam(teamId) {
  const id = String(teamId || "").toLowerCase();
  if (!id || !state) return null;
  const lists = [
    state.franchises || [],
    (state.auction && state.auction.stillIn) || [],
    (state.auction && state.auction.lotSnapshot) || [],
  ];
  for (const list of lists) {
    const hit = list.find((t) => {
      const name = (t.name || "").toLowerCase();
      const key = (t.key || t.characterId || t.identityId || "").toLowerCase();
      return name === id || key === id;
    });
    if (hit) return hit;
  }
  return null;
}

function emoteTeamStyle(teamId) {
  const team = findEmoteTeam(teamId);
  const fr = (team && (team.franchise || team)) || {};
  const color = fr.color || fr.text || "#f5c518";
  const text = fr.text || color;
  return { team, name: (team && team.name) || teamId, color, text };
}


function emoteStreamOrigin() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const narrow = vw <= 700;
  const band = narrow ? 64 : 88;
  const rightPad = narrow ? 10 : 18;
  let floor = 20 + (window.visualViewport ? 0 : 0);
  const safe = Number(getComputedStyle(document.documentElement).getPropertyValue("padding-bottom")) || 0;
  void safe;
  const bid = document.getElementById("bid-box");
  const power = document.getElementById("use-power") || document.getElementById("power-btn-wrap");
  const dock = document.getElementById("emote-dock");
  function clearAbove(el, pad) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    // Only lift the spawn band when a control overlaps the right-edge stream.
    const bandLeft = vw - (narrow ? 96 : 140);
    if (r.right > bandLeft && r.bottom > vh * 0.55) {
      floor = Math.max(floor, vh - r.top + pad);
    }
  }
  if (narrow) {
    clearAbove(bid, 12);
    clearAbove(power, 12);
  }
  if (dock && !dock.hidden) clearAbove(dock, 8);
  floor = Math.min(floor, vh * 0.45);
  const x = vw - rightPad - Math.random() * band;
  const y = vh - floor - Math.random() * 18;
  return { x: Math.max(24, x), y: Math.max(vh * 0.55, y) };
}

function pruneLiveEmotes() {
  const cat = emoteCatalog();
  const max = cat.EMOTE_MAX_VISIBLE || 40;
  while (liveEmotes.length > max) {
    const old = liveEmotes.shift();
    if (old && old.el) old.el.remove();
    if (old && old.timer) clearTimeout(old.timer);
  }
}

function dismissEmote(rec) {
  if (!rec) return;
  if (rec.timer) {
    clearTimeout(rec.timer);
    rec.timer = null;
  }
  if (rec.el) rec.el.remove();
  const i = liveEmotes.indexOf(rec);
  if (i >= 0) liveEmotes.splice(i, 1);
}

function resolveEmote(payload) {
  const cat = emoteCatalog();
  const id = payload && payload.emoteId;
  const listed = cat.getEmote && cat.getEmote(id);
  if (listed) return listed;
  const chars = window.IplCharacters;
  const line = (chars && chars.findLine && id) ? chars.findLine(id) : null;
  const text = (line && line.text) || (payload && (payload.text || payload.phrase)) || "";
  if (text) return { kind: "phrase", text };
  return null;
}

function showEmote(payload) {
  const emote = resolveEmote(payload);
  if (!emote) return;
  let layer = document.getElementById("emote-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "emote-layer";
    layer.className = "emote-layer";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
  } else if (layer.parentElement !== document.body) {
    document.body.appendChild(layer);
  }
  const info = emoteTeamStyle(payload.teamId);
  const at = emoteStreamOrigin();
  const el = document.createElement("div");
  const isPhrase = emote.kind === "phrase";
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.className = `emote-float ${isPhrase ? "is-phrase" : "is-emoji"}${reduced ? " is-reduced" : ""}`;
  el.style.setProperty("--c", info.color);
  el.style.setProperty("--ct", info.text);
  el.style.left = "auto";
  el.style.right = `${Math.max(8, Math.round(window.innerWidth - at.x))}px`;
  el.style.top = `${Math.round(at.y)}px`;
  const scale = isPhrase ? (0.9 + Math.random() * 0.16) : (0.82 + Math.random() * 0.45);
  const rot0 = (Math.random() * 24 - 12).toFixed(1);
  const rot1 = (Math.random() * 28 - 14).toFixed(1);
  const rot2 = (Math.random() * 36 - 18).toFixed(1);
  const dur = reduced ? 0.85 : (2.3 + Math.random() * 1.3);
  const travel = reduced ? 18 : Math.round(at.y - (16 + Math.random() * 56));
  // Bias sideways drift inward (negative X) so long pills stay on screen.
  const wobble = reduced ? 0 : -Math.round(6 + Math.random() * (isPhrase ? 28 : 36));
  const drift = reduced ? 0 : wobble - Math.round(Math.random() * 18);
  el.style.setProperty("--scale", scale.toFixed(3));
  el.style.setProperty("--rot0", `${rot0}deg`);
  el.style.setProperty("--rot1", `${rot1}deg`);
  el.style.setProperty("--rot2", `${rot2}deg`);
  el.style.setProperty("--dx1", `${wobble}px`);
  el.style.setProperty("--dx2", `${drift}px`);
  el.style.setProperty("--dy", `${-Math.max(48, travel)}px`);
  el.style.setProperty("--dur", `${dur.toFixed(2)}s`);
  const fr = (info.team && (info.team.franchise || info.team)) || null;
  const mark = fr ? teamMark({ ...fr, id: characterIdOf(fr) || characterIdOf(info.team) || "" }, "xs", info.name || "") : "";
  const badge = mark || `<span class="emote-dot" title="${esc(info.name || "")}"></span>`;
  const body = isPhrase ? esc(emote.text) : esc(emote.glyph);
  el.innerHTML = `<span class="emote-badge">${badge}</span><span class="emote-body">${body}</span>`;
  layer.appendChild(el);
  const rec = { el, timer: null };
  liveEmotes.push(rec);
  pruneLiveEmotes();
  const life = Math.round(dur * 1000) + 80;
  rec.timer = setTimeout(() => dismissEmote(rec), life);
  el.addEventListener("animationend", () => dismissEmote(rec), { once: true });
  el.addEventListener("animationcancel", () => dismissEmote(rec), { once: true });
}

async function sendEmote(id) {
  if (!state || state.phase !== "auction" || !id) return;
  const res = await emit("emote", { emoteId: id });
  if (res && res.dropped) return;
  if (res && res.ok) {
    // The broadcast also arrives on this socket; don't double-show here.
    return;
  }
  if (res && res.error) toast(res.error);
}

function wireGlobal() {
  if (wireGlobal.done) return;
  wireGlobal.done = true;
  document.addEventListener("click", async (e) => {
    const emotePick = e.target.closest("[data-emote]");
    if (emotePick) {
      e.preventDefault();
      sendEmote(emotePick.getAttribute("data-emote"));
      return;
    }
    if (e.target.closest("#emote-btn")) {
      e.preventDefault();
      toggleEmotePicker();
      return;
    }
    if (emotePickerOpen && !e.target.closest("#emote-dock")) {
      closeEmotePicker();
    }
    const ident = e.target.closest("[data-character], [data-identity]");
    if (ident) {
      const characterId = ident.getAttribute("data-character") || ident.getAttribute("data-identity");
      await emitOrToast("selectCharacter", { characterId, identityId: characterId }, "Could not pick that co-owner.");
      return;
    }
    const quick = e.target.closest("[data-quick-chat]");
    if (quick) {
      e.preventDefault();
      const res = await emit("quickChat", { lineId: quick.getAttribute("data-quick-chat") });
      if (!res || !res.ok) toast((res && res.error) || "Could not send that line.");
      return;
    }
    if (e.target.closest("#chai-khatam")) {
      e.preventDefault();
      await emitOrToast("endChaiBreak", {}, "Could not end the chai break.");
      return;
    }
    const rakhi = e.target.closest("[data-rakhi-choice]");
    if (rakhi) {
      e.preventDefault();
      await emitOrToast("resolvePowerChoice", { choice: rakhi.getAttribute("data-rakhi-choice") }, "Could not send your choice.");
      return;
    }
    const pick = e.target.closest("[data-target-key], [data-player-id], [data-swap-id]");
    if (pick && (pick.hasAttribute("data-target-key") || pick.hasAttribute("data-player-id") || pick.hasAttribute("data-swap-id"))) {
      e.preventDefault();
      if (pick.hasAttribute("data-swap-id")) {
        window._swapOwnId = pick.getAttribute("data-swap-id");
        document.querySelectorAll("[data-swap-id]").forEach((b) => b.classList.toggle("is-picked", b === pick));
        if (window._swapRivalId) {
          const res = await emit("pickPowerTarget", { playerId: window._swapRivalId, swapPlayerId: window._swapOwnId });
          if (!res || !res.ok) toast((res && res.error) || "Could not swap.");
          window._swapOwnId = window._swapRivalId = null;
        }
        return;
      }
      if (pick.hasAttribute("data-player-id") && state.powerWait && state.powerWait.kind === "pick_swap") {
        window._swapRivalId = pick.getAttribute("data-player-id");
        document.querySelectorAll("[data-player-id]").forEach((b) => b.classList.toggle("is-picked", b === pick));
        if (window._swapOwnId) {
          const res = await emit("pickPowerTarget", { playerId: window._swapRivalId, swapPlayerId: window._swapOwnId });
          if (!res || !res.ok) toast((res && res.error) || "Could not swap.");
          window._swapOwnId = window._swapRivalId = null;
        }
        return;
      }
      const payload = {};
      if (pick.hasAttribute("data-target-key")) payload.targetKey = pick.getAttribute("data-target-key");
      if (pick.hasAttribute("data-player-id")) payload.playerId = pick.getAttribute("data-player-id");
      const res = await emit("pickPowerTarget", payload);
      if (!res || !res.ok) toast((res && res.error) || "Could not pick that target.");
      return;
    }
    if (e.target.closest("#use-power")) {
      openPowerConfirm();
      return;
    }
    if (e.target.closest("#power-confirm-use")) {
      await confirmAndUsePower();
      return;
    }
    if (e.target.closest("#power-confirm-cancel")) {
      closePowerConfirm();
      return;
    }
    if (e.target.id === "power-confirm") {
      closePowerConfirm();
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
    if (e.target.closest("#sold-continue") || e.target.closest("#last-team-fill-continue")) {
      await emitOrToast("continueReveal", {}, "Could not continue.");
      return;
    }
    if (e.target.closest("#end-game")) {
      const ok = await confirmAction("This ends the game for everyone.");
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
    syncEmoteDock();
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
    syncEmoteDock();
    return;
  }
  if (state.phase === "lobby") main.innerHTML = lobbyView();
  else if (state.phase === "auction") main.innerHTML = auctionView();
  else if (state.phase === "captains") main.innerHTML = captainView();
  else if (state.phase === "simulating" || state.phase === "results") main.innerHTML = resultsView();
  else main.innerHTML = homeView();
  wireCurrent();
  if (state.phase === "auction") mountAuctionRing();
  syncEmoteDock();
}

function wireHome() {
  const nameEl = document.getElementById("name");
  const codeEl = document.getElementById("code");
  const session = loadSession();
  if (nameEl && session?.name && !nameEl.value) nameEl.value = session.name;
  if (codeEl && session?.code && !codeEl.value) codeEl.value = session.code;
  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedMode = btn.getAttribute("data-mode") || "classical";
      document.querySelectorAll("[data-mode]").forEach((b) => {
        const on = b.getAttribute("data-mode") === selectedMode;
        b.classList.toggle("selected", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
    });
  });
  document.getElementById("create")?.addEventListener("click", async () => {
    lastError = "";
    const name = (nameEl?.value || "").trim();
    const res = await emit("createRoom", { name, mode: selectedMode });
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
  document.getElementById("skip-reveal")?.addEventListener("click", async () => {
    const res = await emit("skipResultsReveal");
    if (res && res.ok && state && state.resultsReveal) {
      state.resultsReveal.skipped = true;
      state.resultsReveal.complete = true;
      state.resultsReveal.revealedCount = state.resultsReveal.total;
      loadMatches();
      render();
    }
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
      if (isPlayerIntroActive()) updatePlayerIntroUi();
    } else if (state.phase === "captains" || state.phase === "results" || state.phase === "simulating") {
      if (isPlayerIntroActive()) {
        updatePlayerIntroUi();
      } else if (state.phase === "captains") {
        render();
      }
    }
    if (state.powerWait && state.powerWait.endsAt) {
      const timer = document.getElementById("wait-timer");
      if (timer) {
        const secs = Math.ceil(Math.max(0, state.powerWait.endsAt - Date.now()) / 1000);
        timer.textContent = `${secs}s left`;
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
  if (state?.phase === "results" && prevPhase !== "results" && !isResultsRevealPending()) {
    loadMatches();
  }
  if (state?.you && state?.code) saveSession(state.code, state.you.name);
  render();
});

socket.on("delta", (evt) => {
  if (!state) return;
  const prevNominee = state.auction?.nominee?.id;
  const prevPhase = state.phase;
  if (evt && evt.message && (evt.type === "powerApplied" || evt.type === "powerWaitEnded" || evt.type === "chaiEnded" || evt.type === "banned" || evt.type === "chaiDisconnectArmed" || evt.type === "poolTopUp" || evt.type === "poolExhausted" || evt.type === "teamForm")) {
    toast(evt.message);
  }
  IplState.applyDelta(state, evt);
  if (state.auction?.nominee?.id !== prevNominee) {
    bidDraft = state.auction?.minBidLakhs ?? null;
    lastError = "";
  }
  if (state.phase === "results" && (prevPhase !== "results" || (evt && evt.type === "resultsReveal" && evt.complete)) && !isResultsRevealPending()) {
    loadMatches();
  }
  render();
});

socket.on("gameEnded", (info) => {
  toast(info && info.abandoned ? "The room was closed." : "The host ended the game.");
  goHome();
});

socket.on("emote", (evt) => {
  if (!evt || !evt.emoteId) return;
  showEmote(evt);
});

socket.on("quickChat", (evt) => {
  if (!evt || !evt.text) return;
  showEmote({ teamId: evt.teamId, emoteId: null, text: evt.text, phrase: evt.text });
});

socket.on("connect_error", () => toast("Connection issue — retrying…"));

wireGlobal();
startTicks();
window.addEventListener("resize", () => {
  if (state && state.phase === "auction") fitHubName();
});
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (isPowerConfirmOpen()) {
    closePowerConfirm();
    e.preventDefault();
    return;
  }
  if (emotePickerOpen) closeEmotePicker();
});
render();


window.IplApp = { get state() { return state; }, emit, socket, showEmote, syncEmoteDock, openPowerConfirm, closePowerConfirm, canShowPowerConfirm };
