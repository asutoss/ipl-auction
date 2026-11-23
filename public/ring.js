/**
 * Auction ring: equal-arc team segments around the player card,
 * drawn with a modest 3D tilt and a floating leader segment.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IplRing = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const NS = "http://www.w3.org/2000/svg";
  const CX = 200;
  const CY = 200;
  const R_INNER = 136;
  const R_OUTER = 188;
  const R_TIMER = 196;
  const R_LOGO = 170;
  const GAP = 2.2;
  const DURATION = 320;
  const LIFT = 20;
  const LIFT_UP = -8;
  const EXTRUDE_Y = 14;

  function polar(cx, cy, r, angle) {
    const a = ((angle - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  function donutPath(a0, a1, r0 = R_INNER, r1 = R_OUTER) {
    const sweep = a1 - a0;
    if (sweep < 0.4) return "";
    const large = sweep > 180 ? 1 : 0;
    const [x0, y0] = polar(CX, CY, r1, a0);
    const [x1, y1] = polar(CX, CY, r1, a1);
    const [x2, y2] = polar(CX, CY, r0, a1);
    const [x3, y3] = polar(CX, CY, r0, a0);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r1} ${r1} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)} A${r0} ${r0} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
  }

  function midAngle(a0, a1) {
    return (a0 + a1) / 2;
  }

  function layout(n, gap = GAP) {
    if (n <= 0) return [];
    const slice = 360 / n;
    const g = n === 1 ? 0 : Math.min(gap, slice / 4);
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({ a0: i * slice + g / 2, a1: (i + 1) * slice - g / 2 });
    }
    return out;
  }

  function el(name, attrs) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      node.setAttribute(k, String(v));
    }
    return node;
  }

  function keyOf(team) {
    return team.characterId || team.identityId || team.short || team.name;
  }


  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function slotsNeeded(team) {
    if (!team || team.complete) return 0;
    if (team.pending != null && Number.isFinite(Number(team.pending))) {
      return Math.max(0, Number(team.pending));
    }
    const q = team.remainingQuota;
    if (q && typeof q === "object") {
      return Object.values(q).reduce((sum, v) => sum + Math.max(0, Number(v) || 0), 0);
    }
    return null;
  }

  function reserveAfterBid(team, opts) {
    const role = opts && opts.nomineeRole;
    const q = team && team.remainingQuota;
    if (q && typeof q === "object") {
      let n = 0;
      for (const [k, v] of Object.entries(q)) {
        const left = Math.max(0, Number(v) || 0);
        n += role && k === role ? Math.max(0, left - 1) : left;
      }
      return n;
    }
    const need = slotsNeeded(team);
    if (need == null) return 0;
    return Math.max(0, need - (role ? 1 : 0));
  }

  function seatBubble(team, opts) {
    opts = opts || {};
    const purseN = Number(team && team.purseLakhs);
    const purse = Number.isFinite(purseN) ? Math.max(0, Math.round(purseN)) : null;
    const purseLabel = purse == null ? "—" : String(purse);
    const banned = Boolean(team && team.banned);
    const eliminated = Boolean(team && team.eliminated);
    const muted = banned || eliminated;
    const need = slotsNeeded(team);
    const complete = !muted && (Boolean(team && team.complete) || need === 0);
    let needLabel;
    if (banned) needLabel = "Banned";
    else if (eliminated) needLabel = "Out";
    else if (complete) needLabel = "Full";
    else if (need == null) needLabel = "";
    else needLabel = need === 1 ? "1 left" : `${need} left`;
    let tone = "ok";
    if (muted) tone = "muted";
    else if (!complete) {
      const minBid = Number(opts.minBidLakhs != null ? opts.minBidLakhs : team && team.minBidLakhs);
      if (Number.isFinite(minBid) && purse != null && purse < minBid) tone = "danger";
      else if (Number.isFinite(minBid) && purse != null && purse - minBid < reserveAfterBid(team, opts)) tone = "warn";
    }
    const text = needLabel ? `${purseLabel} · ${needLabel}` : purseLabel;
    return { purse, purseLabel, need, needLabel, complete, muted, banned, eliminated, tone, text };
  }

  function bubbleHtml(view) {
    const coin = `<svg class="ring-coin" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="#f5c518" stroke="#8a6a10" stroke-width="1.2"/><circle cx="8" cy="8" r="4.5" fill="none" stroke="#fff4b0" stroke-width="1"/><path d="M8 4.4v7.2" stroke="#8a6a10" stroke-width="1.15" stroke-linecap="round"/></svg>`;
    const need = view.complete
      ? `<span class="ring-bubble-tick" title="Squad complete">✓</span>`
      : (view.needLabel ? `<span class="ring-bubble-need">${esc(view.needLabel)}</span>` : "");
    const cls = [
      "ring-bubble",
      `is-${view.tone}`,
      view.complete ? "is-full" : "",
      view.muted ? "is-muted" : "",
    ].filter(Boolean).join(" ");
    return `<span class="${cls}" title="${esc(view.text)}">${coin}<span class="ring-bubble-pts">${esc(view.purseLabel)}</span>${need ? `<span class="ring-bubble-dot" aria-hidden="true">·</span>${need}` : ""}</span>`;
  }

  function seatsFromState(state) {
    const a = state && state.auction;
    const youName = state && state.you && state.you.name;
    const franchises = (state && state.franchises) || [];
    const snap = (a && a.lotSnapshot) || [];
    const still = (a && a.stillIn) || [];
    const stillMap = new Map(still.map((t) => [t.name, t]));
    const source = snap.length ? snap : (franchises.length ? franchises : still);
    const minBid = a && a.minBidLakhs;
    const nomineeRole = a && a.nominee && a.nominee.role;
    return source.map((row) => {
      const name = row.name;
      const live = franchises.find((f) => f.name === name) || {};
      const inLot = stillMap.get(name) || {};
      const remainingQuota = live.remainingQuota || row.remainingQuota || null;
      let pending = null;
      if (live.complete || row.complete) pending = 0;
      else if (remainingQuota) pending = Object.values(remainingQuota).reduce((s, v) => s + Math.max(0, Number(v) || 0), 0);
      else if (row.pending != null) pending = row.pending;
      else if (live.pending != null) pending = live.pending;
      const banned = Boolean(live.banned || row.banned);
      const eliminated = Boolean(live.eliminated || row.eliminated);
      const squadSize = (live.squad && live.squad.length) || row.squadSize || 0;
      const complete = Boolean(live.complete || row.complete) || (pending === 0 && squadSize > 0 && !banned && !eliminated);
      const colorSrc = live.franchise || live || row;
      return {
        name,
        short: row.short || live.short || name,
        color: row.color || colorSrc.color,
        color2: row.color2 || colorSrc.color2,
        text: row.text || colorSrc.text,
        characterId: row.characterId || row.identityId || (live.franchise && (live.franchise.id || live.franchise.characterId)) || live.characterId || live.identityId,
        identityId: row.identityId || row.characterId || live.identityId || live.characterId,
        purseLakhs: live.purseLakhs != null ? live.purseLakhs : (inLot.purseLakhs != null ? inLot.purseLakhs : row.purseLakhs),
        pending,
        remainingQuota,
        complete,
        banned,
        eliminated,
        isLeader: Boolean(inLot.isLeader) || (a && a.currentBidderName === name),
        isYou: Boolean(youName && youName === name) || Boolean(inLot.isYou) || Boolean(row.isYou),
        stillIn: stillMap.has(name),
        minBidLakhs: minBid,
        nomineeRole,
        formPct: live.formPct != null ? live.formPct : row.formPct,
      };
    });
  }


  function prefersReducedMotion() {
    try {
      return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (_) {
      return false;
    }
  }

  function syncScale(svg) {
    const w = (svg.clientWidth || (svg.getBoundingClientRect && svg.getBoundingClientRect().width) || 400);
    const u = w / 400;
    const px = `${u}px`;
    svg.style.setProperty("--u", px);
    const host = svg.parentElement;
    if (host) host.style.setProperty("--u", px);
  }

  function observeScale(svg) {
    syncScale(svg);
    if (typeof ResizeObserver !== "function") return;
    if (svg._ringScaleObs) svg._ringScaleObs.disconnect();
    const obs = new ResizeObserver(() => syncScale(svg));
    obs.observe(svg);
    svg._ringScaleObs = obs;
  }

  function mount(svg) {
    svg.setAttribute("viewBox", "0 0 400 400");
    svg.setAttribute("overflow", "visible");
    svg.innerHTML = "";
    const defs = el("defs", {});

    const sheen = el("linearGradient", {
      id: "ring-sheen", x1: "0", y1: "0", x2: "1", y2: "1",
      gradientUnits: "objectBoundingBox",
    });
    sheen.innerHTML = `
      <stop offset="0%" stop-color="#fff" stop-opacity="0"/>
      <stop offset="35%" stop-color="#fff" stop-opacity="0"/>
      <stop offset="50%" stop-color="#fff" stop-opacity="0.7"/>
      <stop offset="65%" stop-color="#fff" stop-opacity="0"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    `;
    if (!prefersReducedMotion()) {
      const anim = el("animateTransform", {
        attributeName: "gradientTransform",
        type: "translate",
        from: "-1 0",
        to: "1 0",
        dur: "1.6s",
        repeatCount: "indefinite",
      });
      sheen.appendChild(anim);
    }
    defs.appendChild(sheen);

    const bevel = el("radialGradient", {
      id: "ring-bevel",
      gradientUnits: "userSpaceOnUse",
      cx: "155", cy: "128", r: "250",
    });
    bevel.innerHTML = `
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="32%" stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="68%" stop-color="#000000" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.42"/>
    `;
    defs.appendChild(bevel);

    const rimLit = el("linearGradient", {
      id: "ring-rim-lit",
      gradientUnits: "userSpaceOnUse",
      x1: "200", y1: "4", x2: "200", y2: "396",
    });
    rimLit.innerHTML = `
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.78"/>
      <stop offset="35%" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="70%" stop-color="#000000" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.55"/>
    `;
    defs.appendChild(rimLit);

    const shadow = el("filter", {
      id: "ring-lift-shadow",
      x: "-45%", y: "-45%", width: "190%", height: "200%",
    });
    shadow.innerHTML = `
      <feOffset in="SourceAlpha" dx="1.4" dy="14" result="off"/>
      <feGaussianBlur in="off" stdDeviation="2.8" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.58 0" result="soft"/>
      <feOffset in="SourceAlpha" dx="0.8" dy="5" result="off2"/>
      <feGaussianBlur in="off2" stdDeviation="1.05" result="blur2"/>
      <feColorMatrix in="blur2" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.72 0" result="contact"/>
      <feMerge>
        <feMergeNode in="soft"/>
        <feMergeNode in="contact"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    `;
    defs.appendChild(shadow);

    const wallGrad = el("linearGradient", {
      id: "ring-wall-grad",
      gradientUnits: "userSpaceOnUse",
      x1: "200", y1: String(CY + R_INNER - 4),
      x2: "200", y2: String(CY + R_OUTER + EXTRUDE_Y + 2),
    });
    wallGrad.innerHTML = `
      <stop offset="0%" stop-color="#1c2438"/>
      <stop offset="45%" stop-color="#0c101c"/>
      <stop offset="100%" stop-color="#05070f"/>
    `;
    defs.appendChild(wallGrad);

    const thickness = el("g", { class: "ring-thickness", "aria-hidden": "true" });
    const midR = (R_INNER + R_OUTER) / 2;
    const band = R_OUTER - R_INNER + 6;
    // Stacked copies build a solid side wall a few px tall; the bottom face sits at EXTRUDE_Y.
    for (let i = 2; i < EXTRUDE_Y; i += 2) {
      thickness.appendChild(el("circle", {
        cx: CX, cy: CY + i, r: midR,
        fill: "none",
        stroke: i < EXTRUDE_Y / 2 ? "#101624" : "#080b14",
        "stroke-width": String(band),
      }));
    }
    thickness.appendChild(el("circle", {
      cx: CX, cy: CY + EXTRUDE_Y, r: midR,
      fill: "none",
      stroke: "url(#ring-wall-grad)",
      "stroke-width": String(band),
    }));
    thickness.appendChild(el("circle", {
      cx: CX, cy: CY + EXTRUDE_Y, r: midR,
      fill: "none",
      stroke: "#151c2e",
      "stroke-width": String(R_OUTER - R_INNER + 1),
    }));

    const timerTrack = el("circle", {
      cx: CX, cy: CY, r: R_TIMER, fill: "none",
      stroke: "rgba(255,255,255,0.08)", "stroke-width": 8,
    });
    const timerC = 2 * Math.PI * R_TIMER;
    const timer = el("circle", {
      cx: CX, cy: CY, r: R_TIMER, fill: "none",
      stroke: "#f5c518", "stroke-width": 8,
      "stroke-linecap": "round",
      "stroke-dasharray": String(timerC),
      "stroke-dashoffset": "0",
      transform: `rotate(-90 ${CX} ${CY})`,
      class: "ring-timer",
    });

    const segs = el("g", { class: "ring-segs" });
    const sheenPath = el("path", { class: "ring-sheen-path", fill: "url(#ring-sheen)", "pointer-events": "none" });

    const rims = el("g", { class: "ring-rims", "pointer-events": "none" });
    rims.appendChild(el("circle", {
      class: "ring-rim-outer",
      cx: CX, cy: CY, r: R_OUTER + 0.6,
      fill: "none",
      stroke: "url(#ring-rim-lit)",
      "stroke-width": "2.4",
    }));
    rims.appendChild(el("circle", {
      class: "ring-rim-inner",
      cx: CX, cy: CY, r: R_INNER - 0.4,
      fill: "none",
      stroke: "url(#ring-rim-lit)",
      "stroke-width": "2",
    }));

    const well = el("circle", {
      class: "ring-well-shadow",
      cx: CX, cy: CY, r: R_INNER - 2,
      fill: "none",
      stroke: "rgba(0,0,0,0.55)",
      "stroke-width": "7",
      "pointer-events": "none",
    });

    const hubDisc = el("circle", {
      cx: CX, cy: CY, r: R_INNER - 1.5,
      fill: "#070b14",
      class: "ring-hub-disc",
    });

    const pointer = el("g", { class: "ring-pointer", "aria-hidden": "true" });
    const tipR = R_OUTER - 2;
    const baseR = R_TIMER + 1;
    const head = el("path", {
      class: "ring-pointer-head",
      d: `M${CX} ${CY - tipR} L${CX - 12} ${CY - baseR} L${CX} ${CY - baseR + 5} L${CX + 12} ${CY - baseR} Z`,
      fill: "#ffe08a",
      stroke: "#1a1408",
      "stroke-width": "1.4",
      "stroke-linejoin": "round",
    });
    pointer.appendChild(head);

    svg.append(defs, thickness, timerTrack, timer, segs, rims, well, hubDisc, pointer);
    svg._ring = { segs, timer, timerC, items: [], pointer, sheenPath, pointerAngle: 0, pointerLift: 0, pointerUp: 0 };
    observeScale(svg);
    return svg._ring;
  }

  function ensure(svg) {
    return svg._ring || mount(svg);
  }

  function segmentTarget(stillIn) {
    const teams = stillIn || [];
    const slots = layout(teams.length);
    return teams.map((t, i) => ({
      key: keyOf(t),
      team: t,
      a0: slots[i].a0,
      a1: slots[i].a1,
      leaving: false,
    }));
  }

  function applyLift(item) {
    const on = Boolean(item.team && item.team.isLeader && !item.leaving);
    if (item.root) item.root.classList.toggle("is-leader", on);
    if (item.lift) item.lift.classList.toggle("is-leader", on);
    const mid = midAngle(item.a0, item.a1);
    const [dx, dy] = on ? polar(0, 0, LIFT, mid) : [0, 0];
    const [bx, by] = on ? polar(0, 0, LIFT * 0.18, mid) : [0, 0];
    const target = item.lift || item.root;
    if (target) {
      target.style.setProperty("--lift-x", dx.toFixed(2));
      target.style.setProperty("--lift-y", (dy + (on ? LIFT_UP : 0)).toFixed(2));
    }
    if (item.root) {
      item.root.style.setProperty("--bob-x", bx.toFixed(2));
      item.root.style.setProperty("--bob-y", by.toFixed(2));
    }
    if (item.lift) {
      if (on) item.lift.setAttribute("filter", "url(#ring-lift-shadow)");
      else item.lift.removeAttribute("filter");
    }
    if (on && item.root && item.root.parentNode) {
      item.root.parentNode.appendChild(item.root);
    }
    if (item.svg) syncPin(item.svg, item);
  }

  function setPath(item, a0, a1) {
    item.a0 = a0;
    item.a1 = a1;
    const d = donutPath(a0, a1);
    item.path.setAttribute("d", d);
    if (item.extrude) item.extrude.setAttribute("d", d);
    if (item.bevel) item.bevel.setAttribute("d", d);
    applyLift(item);
  }

  function paintLeader(item) {
    const on = Boolean(item.team && item.team.isLeader && !item.leaving);
    item.path.classList.toggle("is-leader", on);
    item.path.classList.toggle("is-dim", !on);
    if (item.extrude) item.extrude.classList.toggle("is-leader", on);
    applyLift(item);
  }

  function shortestTurn(from, to) {
    let d = to - from;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return from + d;
  }

  function applyPointerAngle(ring, ang, lift, up) {
    const L = lift || 0;
    const U = up || 0;
    ring.pointer.setAttribute("transform", `translate(0 ${U.toFixed(2)}) rotate(${ang} ${CX} ${CY}) translate(0 ${(-L).toFixed(2)})`);
    ring.pointerAngle = ang;
    ring.pointerLift = L;
    ring.pointerUp = U;
  }

  function pointToLeader(svg, animateMotion) {
    const ring = ensure(svg);
    if (!ring.pointer) return;
    const leader = (ring.items || []).find((it) => it.team && it.team.isLeader && !it.leaving);
    const mid = leader ? midAngle(leader.a0, leader.a1) : 0;
    const from = ring.pointerAngle || 0;
    const next = shortestTurn(from, mid);
    const fromLift = ring.pointerLift || 0;
    const nextLift = leader ? LIFT : 0;
    const fromUp = ring.pointerUp || 0;
    const nextUp = leader ? LIFT_UP : 0;
    if (ring._pointerAnim) {
      cancelAnimationFrame(ring._pointerAnim);
      ring._pointerAnim = null;
    }
    const paintSheen = () => {
      if (!ring.sheenPath) return;
      if (leader && leader.lift) {
        if (ring.sheenPath.parentNode !== leader.lift) leader.lift.appendChild(ring.sheenPath);
        ring.sheenPath.setAttribute("d", donutPath(leader.a0, leader.a1));
        ring.sheenPath.style.opacity = "1";
      } else {
        ring.sheenPath.setAttribute("d", "");
        ring.sheenPath.style.opacity = "0";
        if (ring.sheenPath.parentNode) ring.sheenPath.parentNode.removeChild(ring.sheenPath);
      }
    };
    ring.pointer.style.opacity = leader ? "1" : "0";
    paintSheen();
    if (animateMotion === false || (Math.abs(next - from) < 0.2 && Math.abs(nextLift - fromLift) < 0.2 && Math.abs(nextUp - fromUp) < 0.2)) {
      applyPointerAngle(ring, next, nextLift, nextUp);
      return;
    }
    const t0 = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - t0) / DURATION);
      const e = 1 - Math.pow(1 - t, 3);
      applyPointerAngle(ring, from + (next - from) * e, fromLift + (nextLift - fromLift) * e, fromUp + (nextUp - fromUp) * e);
      if (t < 1) ring._pointerAnim = requestAnimationFrame(frame);
      else ring._pointerAnim = null;
    }
    ring._pointerAnim = requestAnimationFrame(frame);
  }

  function ensureLogoLayer(svg) {
    const host = svg && svg.parentElement;
    if (!host) return null;
    let layer = host.querySelector(":scope > .ring-logo-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "ring-logo-layer";
      layer.setAttribute("aria-hidden", "true");
      host.appendChild(layer);
    }
    return layer;
  }

  function pinFaceHtml(team) {
    const color = (team && (team.color || team.text)) || "#f5c518";
    const color2 = (team && team.color2) || "#0b1220";
    const name = (team && (team.name || team.short)) || "";
    const api = (typeof IplCharacters !== "undefined" && IplCharacters) || (typeof IplIdentities !== "undefined" && IplIdentities);
    const cid = team && (team.characterId || team.identityId);
    const imgFn = api && (api.characterImg || api.logoImg);
    const img = (imgFn && cid) ? imgFn(cid, { alt: name, className: "ring-logo-img" }) : "";
    const face = img || `<span class="ring-logo-fallback">${(name || "?").slice(0, 1)}</span>`;
    return { color, color2, html: `<div class="ring-logo-bob"><div class="ring-logo-face">${face}</div></div>` };
  }

  function placeMeta(mid) {
    const m = ((Number(mid) % 360) + 360) % 360;
    if (m >= 50 && m < 130) return { side: "right", x: "-2px", y: "40px" };
    if (m >= 230 && m < 310) return { side: "left", x: "2px", y: "40px" };
    return { side: "radial", out: null };
  }

  function syncPin(svg, item) {
    if (!item || item.leaving) {
      if (item && item.pin) item.pin.classList.add("is-leaving");
      return item && item.pin;
    }
    const layer = ensureLogoLayer(svg);
    if (!layer) return null;
    const team = item.team || {};
    const mid = midAngle(item.a0, item.a1);
    const [x, y] = polar(CX, CY, R_LOGO, mid);
    let pin = item.pin;
    const teamKey = team.characterId || team.identityId || team.name || item.key;
    if (!pin || !pin.isConnected || pin._teamKey !== teamKey) {
      if (pin && pin.isConnected) pin.remove();
      pin = document.createElement("div");
      pin.className = "ring-logo-pin";
      const built = pinFaceHtml(team);
      pin.style.setProperty("--c", built.color);
      pin.style.setProperty("--c2", built.color2);
      pin.innerHTML = built.html;
      pin._teamKey = teamKey;
      layer.appendChild(pin);
      item.pin = pin;
    }
    pin.style.left = `${((x / 400) * 100).toFixed(3)}%`;
    pin.style.top = `${((y / 400) * 100).toFixed(3)}%`;
    pin.style.setProperty("--mid", `${mid}deg`);
    const place = placeMeta(mid);
    pin.classList.toggle("is-side", Boolean(place.side && place.side !== "radial"));
    pin.classList.toggle("is-side-right", place.side === "right");
    pin.classList.toggle("is-side-left", place.side === "left");
    if (place.side && place.side !== "radial") {
      pin.style.setProperty("--meta-x", place.x);
      pin.style.setProperty("--meta-y", place.y);
    } else {
      pin.style.removeProperty("--meta-x");
      pin.style.removeProperty("--meta-y");
    }
    const on = Boolean(team.isLeader);
    pin.classList.toggle("is-leader", on);
    pin.classList.toggle("is-muted", Boolean(team.banned || team.eliminated));
    pin.classList.toggle("is-out", Boolean(!team.stillIn && !team.banned && !team.eliminated && team.stillIn != null));
    pin.classList.toggle("is-you", Boolean(team.isYou));
    pin.classList.remove("is-leaving");
    let meta = pin.querySelector(".ring-seat-meta");
    if (!meta) {
      meta = document.createElement("div");
      meta.className = "ring-seat-meta";
      pin.appendChild(meta);
    }
    const view = seatBubble(team, { minBidLakhs: team.minBidLakhs, nomineeRole: team.nomineeRole });
    meta.innerHTML = `<span class="ring-seat-name">${esc(team.name || team.short || "")}</span>${bubbleHtml(view)}`;
    pin.style.setProperty("--lift-x", (item.lift && item.lift.style.getPropertyValue("--lift-x")) || "0");
    pin.style.setProperty("--lift-y", (item.lift && item.lift.style.getPropertyValue("--lift-y")) || "0");
    pin.style.setProperty("--bob-x", (item.root && item.root.style.getPropertyValue("--bob-x")) || "0");
    pin.style.setProperty("--bob-y", (item.root && item.root.style.getPropertyValue("--bob-y")) || "0");
    if (on) layer.appendChild(pin);
    return pin;
  }

  function removePin(item) {
    if (item && item.pin) {
      item.pin.remove();
      item.pin = null;
    }
  }

  function makeItem(svg, team, a0, a1) {
    const root = el("g", { class: "ring-item", "data-key": keyOf(team), "data-name": team.name || "" });
    const extrude = el("path", {
      class: "ring-seg-extrude",
      transform: `translate(0 ${EXTRUDE_Y})`,
      fill: "#070a12",
      "pointer-events": "none",
    });
    const lift = el("g", { class: "ring-item-lift" });
    const path = el("path", {
      class: "ring-seg",
      fill: team.color,
      "data-key": keyOf(team),
      "data-name": team.name || "",
    });
    const bevel = el("path", {
      class: "ring-seg-bevel",
      fill: "url(#ring-bevel)",
      "pointer-events": "none",
    });
    lift.append(path, bevel);
    root.append(extrude, lift);
    const item = { key: keyOf(team), team, root, lift, path, bevel, extrude, svg, pin: null, a0, a1, leaving: false };
    setPath(item, a0, a1);
    paintLeader(item);
    syncPin(svg, item);
    return item;
  }

  function animate(svg, fromItems, toSpec) {
    const ring = ensure(svg);
    const fromMap = new Map((fromItems || []).map((it) => [it.key, it]));
    const toMap = new Map(toSpec.map((it) => [it.key, it]));
    const nextItems = [];

    for (const spec of toSpec) {
      let item = fromMap.get(spec.key);
      if (!item) {
        item = makeItem(svg, spec.team, spec.a0, spec.a1);
        item.root.style.opacity = "0";
        ring.segs.appendChild(item.root);
        requestAnimationFrame(() => {
          item.root.style.transition = `opacity ${DURATION}ms ease`;
          item.root.style.opacity = "1";
        });
      } else {
        item.team = spec.team;
        item.leaving = false;
        item.path.classList.remove("is-leaving");
        item.root.classList.remove("is-leaving");
        paintLeader(item);
      }
      item._t0 = { a0: item.a0, a1: item.a1 };
      item._t1 = { a0: spec.a0, a1: spec.a1 };
      nextItems.push(item);
    }

    const leaving = [];
    for (const item of fromItems || []) {
      if (toMap.has(item.key)) continue;
      item.leaving = true;
      item.team = item.team ? { ...item.team, isLeader: false } : item.team;
      item.path.classList.add("is-leaving");
      item.root.classList.add("is-leaving");
      if (item.pin) item.pin.classList.add("is-leaving");
      applyLift(item);
      item._t0 = { a0: item.a0, a1: item.a1 };
      const mid = midAngle(item.a0, item.a1);
      item._t1 = { a0: mid, a1: mid };
      leaving.push(item);
    }

    const all = [...nextItems, ...leaving];
    const t0 = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - t0) / DURATION);
      const e = 1 - Math.pow(1 - t, 3);
      for (const item of all) {
        const a0 = item._t0.a0 + (item._t1.a0 - item._t0.a0) * e;
        const a1 = item._t0.a1 + (item._t1.a1 - item._t0.a1) * e;
        setPath(item, a0, a1);
        if (item.leaving) {
          item.root.style.opacity = String(1 - e);
        }
      }
      pointToLeader(svg, false);
      if (t < 1) requestAnimationFrame(frame);
      else {
        for (const item of leaving) {
          item.root.remove();
          removePin(item);
        }
        ring.items = nextItems;
        pointToLeader(svg, true);
      }
    }
    requestAnimationFrame(frame);
    ring.items = nextItems;
  }

  function update(svg, stillIn) {
    const ring = ensure(svg);
    syncScale(svg);
    const spec = segmentTarget(stillIn || []);
    const layer = ensureLogoLayer(svg);
    if (layer) layer.dataset.count = String(spec.length);
    const host = svg.parentElement;
    if (host) host.dataset.count = String(spec.length);
    const wrap = host && host.closest && host.closest(".ring-wrap");
    if (wrap) wrap.dataset.count = String(spec.length);
    if (!ring.items.length) {
      for (const s of spec) {
        const item = makeItem(svg, s.team, s.a0, s.a1);
        ring.segs.appendChild(item.root);
        ring.items.push(item);
      }
      pointToLeader(svg, false);
      return;
    }
    const sameLayout =
      ring.items.length === spec.length &&
      ring.items.every((it, i) => it.key === spec[i].key && !it.leaving);
    if (sameLayout) {
      ring.items.forEach((it, i) => {
        it.team = spec[i].team;
        paintLeader(it);
      });
      pointToLeader(svg, true);
      return;
    }
    animate(svg, ring.items, spec);
  }

  function setTimer(svg, remainingMs, totalMs, paused) {
    const ring = ensure(svg);
    const total = Math.max(1, totalMs || 15000);
    const left = Math.max(0, remainingMs || 0);
    const frac = Math.max(0, Math.min(1, left / total));
    ring.timer.setAttribute("stroke-dashoffset", String(ring.timerC * (1 - frac)));
    ring.timer.classList.toggle("low", left <= 3000 && !paused);
    ring.timer.classList.toggle("paused", Boolean(paused));
  }

  function itemMatches(item, name) {
    if (!item || !name) return false;
    const want = String(name).toLowerCase();
    const team = item.team || {};
    return [team.name, team.short, team.characterId, team.identityId, item.key]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase() === want);
  }

  function anchorFor(svg, name) {
    const ring = svg && svg._ring;
    if (!ring) return null;
    const item = (ring.items || []).find((it) => itemMatches(it, name) && !it.leaving);
    if (!item) return null;
    const mid = midAngle(item.a0, item.a1);
    const [x, y] = polar(CX, CY, R_OUTER + 6, mid);
    const node = item.lift || item.path || svg;
    const ctm = (node.getScreenCTM && node.getScreenCTM()) || (svg.getScreenCTM && svg.getScreenCTM());
    if (!ctm) return { x, y, angle: mid };
    const pt = svg.createSVGPoint();
    pt.x = x;
    pt.y = y;
    const sp = pt.matrixTransform(ctm);
    return { x: sp.x, y: sp.y, angle: mid };
  }

  /**
   * Mobile ring size from width (and orientation) only — never from viewport
   * height, so URL-bar show/hide or an innerHeight-only resize cannot change it.
   */
  function ringSizePx(width, opts) {
    const w = Number(width);
    const landscape = Boolean(opts && opts.landscape);
    if (!Number.isFinite(w) || w <= 0) return null;
    if (landscape && w <= 900) return Math.round(Math.min(200, w * 0.42, Math.max(0, w - 24)));
    if (w <= 700) {
      const cap = w <= 430 ? 220 : 260;
      const frac = w <= 430 ? 0.62 : 0.72;
      return Math.round(Math.min(cap, w * frac, Math.max(0, w - 24)));
    }
    return null;
  }

  function shouldRefreshRingSize(prev, next) {
    if (!next) return false;
    if (!prev) return true;
    return Number(prev.width) !== Number(next.width) || Boolean(prev.landscape) !== Boolean(next.landscape);
  }

  function applyRingSize(el, dims) {
    if (!el || !el.style) return null;
    const size = ringSizePx(dims && dims.width, { landscape: dims && dims.landscape });
    if (size) el.style.setProperty("--ring-size", `${size}px`);
    else el.style.removeProperty("--ring-size");
    return size;
  }

  return { mount, update, setTimer, anchorFor, seatBubble, seatsFromState, slotsNeeded, bubbleHtml, ringSizePx, shouldRefreshRingSize, applyRingSize };
});
