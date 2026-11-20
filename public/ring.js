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
    return team.identityId || team.short || team.name;
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
    svg.style.setProperty("--u", `${u}px`);
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
  }

  function setPath(item, a0, a1) {
    item.a0 = a0;
    item.a1 = a1;
    const d = donutPath(a0, a1);
    item.path.setAttribute("d", d);
    if (item.extrude) item.extrude.setAttribute("d", d);
    if (item.bevel) item.bevel.setAttribute("d", d);
    const mid = midAngle(a0, a1);
    const [lx, ly] = polar(CX, CY, R_LOGO, mid);
    item.mark.setAttribute("transform", `translate(${lx.toFixed(1)} ${ly.toFixed(1)})`);
    applyLift(item);
  }

  function paintLeader(item) {
    const on = Boolean(item.team && item.team.isLeader && !item.leaving);
    item.path.classList.toggle("is-leader", on);
    item.path.classList.toggle("is-dim", !on);
    if (item.scale) item.scale.classList.toggle("is-leader", on);
    item.mark.classList.toggle("is-leader", on);
    item.mark.classList.toggle("is-dim", !on);
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

  function logoNode(team) {
    const g = el("g", { class: "ring-logo" });
    const disc = el("circle", { r: 16, fill: team.color2 || "#0b1220", stroke: team.color, "stroke-width": 1.8 });
    g.appendChild(disc);
    const fo = el("foreignObject", { x: -13, y: -13, width: 26, height: 26 });
    const wrap = document.createElement("div");
    wrap.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    wrap.className = "ring-logo-inner";
    const img = (typeof IplIdentities !== "undefined" && team.identityId)
      ? IplIdentities.logoImg(team.identityId, { alt: "", className: "ring-logo-img" })
      : "";
    wrap.innerHTML = img || `<span class="ring-emoji">${team.short || ""}</span>`;
    fo.appendChild(wrap);
    g.appendChild(fo);
    return g;
  }

  function makeItem(team, a0, a1) {
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
    const mark = el("g", { "data-key": keyOf(team), "data-name": team.name || "" });
    const scale = logoNode(team);
    scale.classList.add("ring-logo-scale");
    mark.appendChild(scale);
    lift.append(path, bevel, mark);
    root.append(extrude, lift);
    const item = { key: keyOf(team), team, root, lift, path, bevel, extrude, mark, scale, a0, a1, leaving: false };
    setPath(item, a0, a1);
    paintLeader(item);
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
        item = makeItem(spec.team, spec.a0, spec.a1);
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
    if (!ring.items.length) {
      for (const s of spec) {
        const item = makeItem(s.team, s.a0, s.a1);
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
    return [team.name, team.short, team.identityId, item.key]
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

  return { mount, update, setTimer, anchorFor };
});
