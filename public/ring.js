/**
 * Auction ring: equal-arc team segments around the player card.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IplRing = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const NS = "http://www.w3.org/2000/svg";
  const CX = 200;
  const CY = 200;
  const R_INNER = 116;
  const R_OUTER = 184;
  const R_TIMER = 196;
  const GAP = 2.2;
  const DURATION = 320;

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

  function mount(svg) {
    svg.setAttribute("viewBox", "0 0 400 400");
    svg.innerHTML = "";
    const bg = el("circle", { cx: CX, cy: CY, r: R_TIMER + 4, fill: "rgba(7,11,22,0.85)", class: "ring-bg" });
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
      <animateTransform attributeName="gradientTransform" type="translate" from="-1 0" to="1 0" dur="1.6s" repeatCount="indefinite"/>
    `;
    defs.appendChild(sheen);
    const segs = el("g", { class: "ring-segs" });
    const sheenPath = el("path", { class: "ring-sheen-path", fill: "url(#ring-sheen)", "pointer-events": "none" });
    const marks = el("g", { class: "ring-marks" });
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
    svg.append(defs, bg, timerTrack, timer, segs, sheenPath, marks, pointer);
    svg._ring = { segs, marks, timer, timerC, items: [], pointer, sheenPath, pointerAngle: 0 };
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

  function setPath(item, a0, a1) {
    item.a0 = a0;
    item.a1 = a1;
    const d = donutPath(a0, a1);
    item.path.setAttribute("d", d);
    const mid = midAngle(a0, a1);
    const [lx, ly] = polar(CX, CY, (R_INNER + R_OUTER) / 2, mid);
    item.mark.setAttribute("transform", `translate(${lx.toFixed(1)} ${ly.toFixed(1)})`);
  }

  function paintLeader(item) {
    const on = Boolean(item.team && item.team.isLeader && !item.leaving);
    item.path.classList.toggle("is-leader", on);
    item.path.classList.toggle("is-dim", !on);
    if (item.scale) item.scale.classList.toggle("is-leader", on);
    item.mark.classList.toggle("is-leader", on);
    item.mark.classList.toggle("is-dim", !on);
  }

  function shortestTurn(from, to) {
    let d = to - from;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return from + d;
  }

  function applyPointerAngle(ring, ang) {
    ring.pointer.setAttribute("transform", `rotate(${ang} ${CX} ${CY})`);
    ring.pointerAngle = ang;
  }

  function pointToLeader(svg, animateMotion) {
    const ring = ensure(svg);
    if (!ring.pointer) return;
    const leader = (ring.items || []).find((it) => it.team && it.team.isLeader && !it.leaving);
    const mid = leader ? midAngle(leader.a0, leader.a1) : 0;
    const from = ring.pointerAngle || 0;
    const next = shortestTurn(from, mid);
    if (ring._pointerAnim) {
      cancelAnimationFrame(ring._pointerAnim);
      ring._pointerAnim = null;
    }
    const paintSheen = () => {
      if (!ring.sheenPath) return;
      if (leader) {
        ring.sheenPath.setAttribute("d", donutPath(leader.a0, leader.a1));
        ring.sheenPath.style.opacity = "1";
      } else {
        ring.sheenPath.setAttribute("d", "");
        ring.sheenPath.style.opacity = "0";
      }
    };
    ring.pointer.style.opacity = leader ? "1" : "0";
    paintSheen();
    if (animateMotion === false || Math.abs(next - from) < 0.2) {
      applyPointerAngle(ring, next);
      return;
    }
    const t0 = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - t0) / DURATION);
      const e = 1 - Math.pow(1 - t, 3);
      applyPointerAngle(ring, from + (next - from) * e);
      if (t < 1) ring._pointerAnim = requestAnimationFrame(frame);
      else ring._pointerAnim = null;
    }
    ring._pointerAnim = requestAnimationFrame(frame);
  }

  function logoNode(team) {
    const g = el("g", { class: "ring-logo" });
    const disc = el("circle", { r: 20, fill: team.color2 || "#0b1220", stroke: team.color, "stroke-width": 2 });
    g.appendChild(disc);
    const fo = el("foreignObject", { x: -15, y: -15, width: 30, height: 30 });
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
    const path = el("path", {
      class: "ring-seg",
      fill: team.color,
      "data-key": keyOf(team),
    });
    const mark = el("g", { "data-key": keyOf(team) });
    const scale = logoNode(team);
    scale.classList.add("ring-logo-scale");
    mark.appendChild(scale);
    const item = { key: keyOf(team), team, path, mark, scale, a0, a1, leaving: false };
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
        item.path.style.opacity = "0";
        ring.segs.appendChild(item.path);
        ring.marks.appendChild(item.mark);
        requestAnimationFrame(() => {
          item.path.style.transition = `opacity ${DURATION}ms ease`;
          item.path.style.opacity = "1";
        });
      } else {
        item.team = spec.team;
        item.leaving = false;
        item.path.classList.remove("is-leaving");
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
      item.path.classList.add("is-leaving");
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
          item.path.style.opacity = String(1 - e);
          item.mark.style.opacity = String(1 - e);
        }
      }
      pointToLeader(svg, false);
      if (t < 1) requestAnimationFrame(frame);
      else {
        for (const item of leaving) {
          item.path.remove();
          item.mark.remove();
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
    const spec = segmentTarget(stillIn || []);
    if (!ring.items.length) {
      for (const s of spec) {
        const item = makeItem(s.team, s.a0, s.a1);
        ring.segs.appendChild(item.path);
        ring.marks.appendChild(item.mark);
        ring.items.push(item);
      }
      pointToLeader(svg, false);
      return;
    }
    const same =
      ring.items.length === spec.length &&
      ring.items.every((it, i) => it.key === spec[i].key && Boolean(it.team.isLeader) === Boolean(spec[i].team.isLeader) && !it.leaving);
    if (same) {
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

  return { mount, update, setTimer };
});
