/* global window, document, navigator */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IplShareResults = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const W = 1080;
  const PAD = 56;
  const GOLD = "#e7c56a";
  const MUTED = "rgba(232, 224, 196, 0.72)";
  const INK = "#f4efe2";

  function formText(pos) {
    const n = pos && (pos.formPct != null ? pos.formPct : pos.form);
    if (n == null || !Number.isFinite(Number(n))) return "";
    return `Current form ${Math.round(Number(n))}%`;
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function logoSrc(pos) {
    const id = pos && (pos.characterId || pos.identityId || (pos.franchise && (pos.franchise.characterId || pos.franchise.id)));
    if (!id) return "";
    return "/logos/" + id + ".webp";
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
    if (!img) return;
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
  }

  function layout(opts) {
    const positions = (opts && opts.positions) || [];
    const champ = opts && opts.champion;
    let y = PAD + 8;
    y += 86; // kicker + title
    y += 28; // mode/room line
    if (champ) y += 220;
    y += 16;
    y += positions.length * 116;
    y += 80; // footer
    return { height: Math.max(900, Math.ceil(y + PAD)) };
  }

  async function draw(opts) {
    const positions = (opts && opts.positions) || [];
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
    for (const p of positions) toLoad.push(logoSrc(p));
    const unique = [...new Set(toLoad.filter(Boolean))];
    await Promise.all(unique.map(async (src) => { imgs[src] = await loadImage(src); }));

    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#10241c");
    bg.addColorStop(1, "#07140f");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, height);

    ctx.fillStyle = "rgba(231, 197, 106, 0.12)";
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
      const cardH = 200;
      ctx.save();
      ctx.strokeStyle = "rgba(231, 197, 106, 0.55)";
      ctx.lineWidth = 3;
      ctx.fillStyle = "rgba(16, 36, 28, 0.9)";
      roundRect(ctx, PAD, y, cardW, cardH, 28);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      coverCircle(ctx, imgs[logoSrc(champ)], PAD + 88, y + cardH / 2, 54);
      ctx.fillStyle = GOLD;
      ctx.font = "600 24px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("Champion  ·  🏆", PAD + 170, y + 58);
      ctx.fillStyle = INK;
      ctx.font = "700 44px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(String(champ.name || ""), PAD + 170, y + 110);
      const bits = [];
      if (champ.squadScore != null) bits.push(champ.squadScore + "/1000 overall");
      const form = formText(champ);
      if (form) bits.push(form);
      ctx.fillStyle = MUTED;
      ctx.font = "500 26px ui-sans-serif, system-ui, sans-serif";
      if (bits.length) ctx.fillText(bits.join("   ·   "), PAD + 170, y + 154);
      y += cardH + 28;
    }

    for (const pos of positions) {
      const rowH = 104;
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.strokeStyle = "rgba(231, 197, 106, 0.2)";
      ctx.lineWidth = 1;
      roundRect(ctx, PAD, y, W - PAD * 2, rowH, 22);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = GOLD;
      ctx.font = "700 36px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(String(pos.position != null ? pos.position : ""), PAD + 28, y + 64);
      coverCircle(ctx, imgs[logoSrc(pos)], PAD + 150, y + rowH / 2, 34);
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

  return { draw, renderPng, share, layout, formText };
});
