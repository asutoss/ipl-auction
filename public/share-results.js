/* global window, document, navigator, Image, location */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IplShareResults = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const W = 1080;
  const PAD = 56;
  const GOLD = "#f5c518";
  const GOLD_SOFT = "#fff3b0";
  const MUTED = "rgba(232, 224, 196, 0.72)";
  const INK = "#f4efe2";
  const CONFETTI = [
    { left: 0.08, delay: 0, w: 6 },
    { left: 0.18, delay: 0.3, w: 5 },
    { left: 0.28, delay: 0.7, w: 6 },
    { left: 0.38, delay: 0.15, w: 6 },
    { left: 0.48, delay: 0.9, w: 6 },
    { left: 0.58, delay: 0.45, w: 6 },
    { left: 0.68, delay: 1.1, w: 6 },
    { left: 0.76, delay: 0.2, w: 6 },
    { left: 0.84, delay: 0.65, w: 6 },
    { left: 0.12, delay: 1.3, w: 6 },
    { left: 0.62, delay: 1.5, w: 6 },
    { left: 0.90, delay: 0.85, w: 6 },
  ];

  function formText(pos) {
    const n = pos && (pos.formPct != null ? pos.formPct : pos.form);
    if (n == null || !Number.isFinite(Number(n))) return "";
    return `Current form ${Math.round(Number(n))}%`;
  }

  function isChampion(pos, champ) {
    if (!pos) return false;
    if ((pos.finish || pos.title) === "Champion") return true;
    if (pos.position === 1) return true;
    if (champ && pos.name && champ.name && pos.name === champ.name) return true;
    return false;
  }

  function listPositions(opts) {
    const positions = (opts && opts.positions) || [];
    const champ = opts && opts.champion;
    return positions.filter((p) => !isChampion(p, champ));
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        resolve(ok && img.naturalWidth ? img : null);
      };
      const afterLoad = () => {
        if (typeof img.decode === "function") {
          img.decode().then(() => finish(true)).catch(() => finish(Boolean(img.naturalWidth)));
        } else {
          finish(Boolean(img.naturalWidth));
        }
      };
      img.onload = afterLoad;
      img.onerror = () => finish(false);
      const abs = /^https?:\/\//i.test(src);
      const sameOrigin = typeof location !== "undefined" && abs && src.indexOf(location.origin) === 0;
      if (abs && !sameOrigin) img.crossOrigin = "anonymous";
      img.src = src;
      if (img.complete) {
        if (img.naturalWidth) afterLoad();
        else if (img.src) finish(false);
      }
      setTimeout(() => finish(false), 4000);
    });
  }

  function logoSrc(pos) {
    const id = pos && (pos.characterId || pos.identityId || (pos.franchise && (pos.franchise.characterId || pos.franchise.id)));
    if (!id) return "";
    return "/logos/" + id + ".webp";
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function coverCircle(ctx, img, cx, cy, r) {
    if (!img) return false;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    const size = r * 2;
    const scale = Math.max(size / img.width, size / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.restore();
    return true;
  }

  function drawMark(ctx, img, cx, cy, r, name) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(245, 197, 24, 0.18)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#10241c";
    ctx.fill();
    ctx.restore();
    if (!coverCircle(ctx, img, cx, cy, r)) {
      ctx.fillStyle = GOLD;
      ctx.font = "700 " + Math.round(r * 0.7) + "px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials(name), cx, cy + 2);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  function confettiOpacity(t) {
    if (t <= 0) return 0;
    if (t < 0.12) return 0.9 * (t / 0.12);
    return 0.9 * (1 - (t - 0.12) / 0.88);
  }

  function drawConfetti(ctx, x, y, w, h) {
    // Freeze the page animation mid-fall so pieces sit around the portrait.
    const dur = 2.2;
    const phase = 0.55;
    const travel = h * 0.92;
    const scale = Math.max(2, w / 360);
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, 32);
    ctx.clip();
    CONFETTI.forEach((p, i) => {
      const t = ((phase + p.delay) % dur) / dur;
      const px = x + p.left * w;
      const py = y - 12 * scale + travel * t;
      const rot = (220 * t * Math.PI) / 180;
      const pw = (p.w || 6) * scale;
      const ph = 10 * scale;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      ctx.globalAlpha = Math.max(0, confettiOpacity(t));
      ctx.fillStyle = i % 2 === 0 ? GOLD : GOLD_SOFT;
      ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
      ctx.restore();
    });
    ctx.restore();
  }

  function championHeight(champ) {
    if (!champ) return 0;
    let h = 56 + 70 + 220 + 70; // kicker, trophy, portrait, name
    if (champ.captainName) h += 40;
    h += 56; // overall + form
    if (champ.resultText) h += 44;
    if (champ.potm && champ.potm.name) h += 40;
    return h + 36;
  }

  function layout(opts) {
    const listed = listPositions(opts);
    const champ = opts && opts.champion;
    let y = PAD + 8;
    y += 86;
    y += 28;
    if (champ) y += championHeight(champ) + 28;
    y += 12;
    y += listed.length * 116;
    y += 80;
    return { height: Math.max(900, Math.ceil(y + PAD)), listed };
  }

  async function draw(opts) {
    const listed = listPositions(opts);
    const champ = opts && opts.champion;
    const { height } = layout(opts);
    const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
    if (!canvas) throw new Error("Canvas is not available.");
    canvas.width = W;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const imgs = {};
    const toLoad = [];
    if (champ) toLoad.push(logoSrc(champ));
    for (const p of listed) toLoad.push(logoSrc(p));
    const unique = [...new Set(toLoad.filter(Boolean))];
    await Promise.all(unique.map(async (src) => { imgs[src] = await loadImage(src); }));

    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#10241c");
    bg.addColorStop(1, "#07140f");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, height);

    ctx.fillStyle = "rgba(245, 197, 24, 0.12)";
    ctx.beginPath();
    ctx.arc(W - 80, 80, 200, 0, Math.PI * 2);
    ctx.fill();

    let y = PAD;
    ctx.fillStyle = GOLD;
    ctx.font = "600 28px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("IPL AUCTION", PAD, y + 28);
    y += 44;
    ctx.fillStyle = INK;
    ctx.font = "700 64px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("Final standings", PAD, y + 56);
    y += 86;
    const modeLine = [opts && opts.modeName, opts && opts.roomCode ? "Room " + opts.roomCode : ""]
      .filter(Boolean)
      .join("  ·  ");
    ctx.fillStyle = MUTED;
    ctx.font = "500 28px ui-sans-serif, system-ui, sans-serif";
    if (modeLine) ctx.fillText(modeLine, PAD, y + 8);
    y += 40;

    if (champ) {
      const cardW = W - PAD * 2;
      const cardH = championHeight(champ);
      const cx = PAD + cardW / 2;
      ctx.save();
      ctx.shadowColor = "rgba(245, 197, 24, 0.28)";
      ctx.shadowBlur = 36;
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 4;
      ctx.fillStyle = "rgba(16, 36, 28, 0.94)";
      roundRect(ctx, PAD, y, cardW, cardH, 32);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.restore();
      drawConfetti(ctx, PAD, y, cardW, cardH);

      let cy = y + 48;
      ctx.fillStyle = GOLD;
      ctx.font = "700 26px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.letterSpacing = "4px";
      ctx.fillText("CHAMPION", cx, cy);
      ctx.letterSpacing = "0px";
      cy += 58;
      ctx.font = "64px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("🏆", cx, cy);
      cy += 130;
      drawMark(ctx, imgs[logoSrc(champ)], cx, cy, 100, champ.name);
      cy += 130;
      ctx.fillStyle = INK;
      ctx.font = "700 56px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(String(champ.name || ""), cx, cy);
      cy += 20;
      if (champ.captainName) {
        cy += 36;
        ctx.fillStyle = MUTED;
        ctx.font = "500 28px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText("Captain " + champ.captainName, cx, cy);
      }
      cy += 50;
      const scoreBits = [];
      if (champ.squadScore != null) {
        scoreBits.push({ kind: "score", text: String(champ.squadScore), rest: "/1000  Overall" });
      }
      const form = formText(champ);
      if (form) scoreBits.push({ kind: "form", text: form });
      if (scoreBits.length) {
        const parts = scoreBits.map((b) => (b.kind === "score" ? b.text + b.rest : b.text));
        ctx.fillStyle = MUTED;
        ctx.font = "500 28px ui-sans-serif, system-ui, sans-serif";
        const joined = parts.join("    ");
        // Draw the overall number in gold like the results hero.
        if (champ.squadScore != null) {
          const prefix = String(champ.squadScore);
          const rest = "/1000  Overall" + (form ? "    " + form : "");
          const preW = ctx.measureText(prefix).width;
          const restW = (() => {
            ctx.font = "500 28px ui-sans-serif, system-ui, sans-serif";
            return ctx.measureText(rest).width;
          })();
          ctx.font = "700 32px ui-sans-serif, system-ui, sans-serif";
          const goldW = ctx.measureText(prefix).width;
          const total = goldW + restW;
          let x = cx - total / 2;
          ctx.fillStyle = GOLD;
          ctx.textAlign = "left";
          ctx.fillText(prefix, x, cy);
          x += goldW;
          ctx.fillStyle = MUTED;
          ctx.font = "500 28px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText(rest, x, cy);
          ctx.textAlign = "center";
        } else {
          ctx.fillText(joined, cx, cy);
        }
      }
      if (champ.resultText) {
        cy += 44;
        ctx.fillStyle = GOLD;
        ctx.font = "700 30px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(String(champ.resultText), cx, cy);
      }
      if (champ.potm && champ.potm.name) {
        cy += 40;
        ctx.fillStyle = MUTED;
        ctx.font = "500 26px ui-sans-serif, system-ui, sans-serif";
        const potmLine = "Player of the match  " + champ.potm.name + (champ.potm.text ? "  ·  " + champ.potm.text : "");
        ctx.fillText(potmLine, cx, cy);
      }
      ctx.textAlign = "start";
      y += cardH + 28;
    }

    for (const pos of listed) {
      const rowH = 104;
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.strokeStyle = "rgba(245, 197, 24, 0.22)";
      ctx.lineWidth = 1;
      roundRect(ctx, PAD, y, W - PAD * 2, rowH, 22);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = GOLD;
      ctx.font = "700 36px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(String(pos.position != null ? pos.position : ""), PAD + 28, y + 64);
      drawMark(ctx, imgs[logoSrc(pos)], PAD + 150, y + rowH / 2, 34, pos.name);
      ctx.fillStyle = INK;
      ctx.font = "700 34px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(String(pos.name || ""), PAD + 206, y + 48);
      const meta = [];
      if (pos.squadScore != null) meta.push(pos.squadScore + "/1000 overall");
      const form = formText(pos);
      if (form) meta.push(form);
      ctx.fillStyle = MUTED;
      ctx.font = "500 24px ui-sans-serif, system-ui, sans-serif";
      if (meta.length) ctx.fillText(meta.join("   ·   "), PAD + 206, y + 82);
      y += rowH + 12;
    }

    const url = (opts && opts.siteUrl) || "";
    ctx.fillStyle = MUTED;
    ctx.font = "500 24px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(url || "IPL Auction", PAD, height - PAD);
    return canvas;
  }

  async function renderPng(opts) {
    const canvas = await draw(opts);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not make the image."))), "image/png");
    });
  }

  async function share(opts) {
    const blob = await renderPng(opts);
    const file = new File([blob], "ipl-auction-results.png", { type: "image/png" });
    const title = "IPL Auction results";
    const text = [opts && opts.modeName, opts && opts.roomCode ? "Room " + opts.roomCode : "", opts && opts.siteUrl]
      .filter(Boolean)
      .join(" · ");
    if (typeof navigator !== "undefined" && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title, text });
      return { ok: true, method: "share", blob, file };
    }
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
    return { ok: true, method: "download", blob, file };
  }

  return { draw, renderPng, share, layout, formText, listPositions, isChampion, loadImage, logoSrc };
});
