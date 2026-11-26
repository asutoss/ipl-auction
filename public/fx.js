/**
 * Lightweight cricket / celebration FX.
 * canvas-confetti is loaded on demand from /vendor/confetti.browser.min.js (ISC).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IplFx = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CONFETTI_SRC = "/vendor/confetti.browser.min.js";
  let hideTimer = 0;
  let lastCue = null;
  let confettiPromise = null;

  function prefersReducedMotion() {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function classifyDelivery(d) {
    if (!d) return null;
    if (d.wicket) return "wicket";
    const runs = Number(d.runs);
    if (runs >= 6) return "six";
    if (runs === 4) return "four";
    return null;
  }

  function loadScript(src) {
    if (typeof document === "undefined") return Promise.reject(new Error("no document"));
    const existing = document.querySelector(`script[data-fx-src="${src}"]`);
    if (existing && (window.confetti || existing.getAttribute("data-loaded") === "1")) {
      return Promise.resolve(window.confetti);
    }
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.setAttribute("data-fx-src", src);
      s.onload = () => {
        s.setAttribute("data-loaded", "1");
        resolve(window.confetti);
      };
      s.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
  }

  function ensureConfetti() {
    if (typeof window !== "undefined" && window.confetti) return Promise.resolve(window.confetti);
    if (confettiPromise) return confettiPromise;
    confettiPromise = loadScript(CONFETTI_SRC).catch((err) => {
      confettiPromise = null;
      throw err;
    });
    return confettiPromise;
  }

  function burst(opts) {
    if (prefersReducedMotion()) return Promise.resolve(false);
    const options = opts || {};
    return ensureConfetti()
      .then((fn) => {
        if (typeof fn !== "function") return false;
        fn({
          particleCount: options.particleCount || 70,
          spread: options.spread || 70,
          startVelocity: options.startVelocity || 38,
          scalar: options.scalar || 0.85,
          ticks: options.ticks || 180,
          origin: options.origin || { x: 0.5, y: 0.38 },
          colors: options.colors || ["#f5c518", "#ffffff", "#3ee0a0"],
          disableForReducedMotion: true,
          zIndex: 240,
        });
        return true;
      })
      .catch(() => false);
  }

  function celebrateSold(info) {
    const rec = info || {};
    if (prefersReducedMotion()) return Promise.resolve(false);
    const color = rec.color || "#f5c518";
    const high = Boolean(rec.marquee) || Number(rec.priceLakhs) >= 12;
    return burst({
      particleCount: high ? 110 : 64,
      spread: high ? 86 : 68,
      startVelocity: high ? 44 : 34,
      origin: { x: 0.5, y: 0.32 },
      colors: [color, "#f5c518", "#fff8dc", "#ffffff"],
    });
  }

  function celebrateChampion(info) {
    const rec = info || {};
    if (prefersReducedMotion()) return Promise.resolve(false);
    const colors = (rec.colors && rec.colors.length ? rec.colors : ["#f5c518", "#ffd56a", "#ffffff", "#3ee0a0"]).filter(Boolean);
    return burst({
      particleCount: 140,
      spread: 100,
      startVelocity: 48,
      scalar: 1,
      origin: { x: 0.5, y: 0.28 },
      colors,
    }).then(() =>
      burst({
        particleCount: 70,
        spread: 70,
        startVelocity: 32,
        origin: { x: 0.5, y: 0.55 },
        colors,
      })
    );
  }

  const STAGE = `
    <div class="cricket-fx-stage">
      <div class="cricket-fx-scene cricket-fx-shot" aria-hidden="true">
        <svg class="cricket-fx-svg" viewBox="0 0 180 130" focusable="false">
          <g class="fx-bat">
            <rect x="26" y="68" width="8" height="52" rx="2.5" fill="#6b4420"/>
            <rect x="24.5" y="98" width="11" height="18" rx="2" fill="#1f1a16"/>
            <path d="M18 4h24c5.5 0 10 5 10 12v52c0 9-8 14-22 14S8 77 8 68V16c0-7 4.5-12 10-12z" fill="#e8d19a" stroke="#8a6230" stroke-width="1.4"/>
            <path d="M22 16h16" stroke="#c4a36a" stroke-width="2" stroke-linecap="round"/>
            <path d="M20 28h20" stroke="#d4b57a" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>
          </g>
          <circle class="fx-ball" cx="78" cy="74" r="8" fill="#c81e1e" stroke="#7a1010" stroke-width="1"/>
          <path class="fx-seam" d="M74 68c4 4 8 8 8 12" fill="none" stroke="#fff" stroke-width="1.1"/>
        </svg>
        <p class="cricket-fx-stamp is-four">FOUR!</p>
        <p class="cricket-fx-stamp is-six">SIX!</p>
      </div>
      <div class="cricket-fx-scene cricket-fx-wicket-scene" aria-hidden="true">
        <svg class="cricket-fx-svg" viewBox="0 0 180 130" focusable="false">
          <g class="fx-stumps">
            <rect class="fx-stump s1" x="66" y="42" width="8" height="68" rx="2" fill="#e8d19a"/>
            <rect class="fx-stump s2" x="86" y="38" width="8" height="72" rx="2" fill="#f0e0b8"/>
            <rect class="fx-stump s3" x="106" y="42" width="8" height="68" rx="2" fill="#e8d19a"/>
          </g>
          <rect class="fx-bail b1" x="67" y="36" width="24" height="5" rx="1.5" fill="#f4e2b0"/>
          <rect class="fx-bail b2" x="89" y="36" width="24" height="5" rx="1.5" fill="#f4e2b0"/>
        </svg>
        <p class="cricket-fx-stamp is-wicket">WICKET!</p>
        <p class="cricket-fx-stamp is-out">OUT!</p>
      </div>
    </div>`;

  function ensureStage() {
    if (typeof document === "undefined") return null;
    let el = document.getElementById("cricket-fx");
    if (!el) {
      el = document.createElement("div");
      el.id = "cricket-fx";
      el.setAttribute("aria-hidden", "true");
      document.body.appendChild(el);
    }
    if (!el.querySelector(".cricket-fx-stage")) el.innerHTML = STAGE;
    return el;
  }

  function playCue(kind, opts) {
    const type = kind === "out" ? "wicket" : kind;
    lastCue = { kind: type, at: Date.now() };
    if (typeof document === "undefined") return lastCue;
    const el = ensureStage();
    if (!el) return lastCue;
    el.className = "cricket-fx";
    if (type) el.classList.add("is-" + type);
    if (prefersReducedMotion()) el.classList.add("is-reduced");
    el.hidden = false;
    el.classList.remove("is-play");
    void el.offsetWidth;
    el.classList.add("is-play");
    if (type === "six") burst({ particleCount: 90, spread: 80, origin: { x: 0.5, y: 0.36 }, colors: ["#f5c518", "#fff", "#3ee0a0"] });
    if (hideTimer) clearTimeout(hideTimer);
    if (!(opts && opts.hold)) {
      hideTimer = setTimeout(() => hideCue(), prefersReducedMotion() ? 900 : 1100);
    }
    return lastCue;
  }

  function hideCue() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = 0;
    }
    if (typeof document === "undefined") return;
    const el = document.getElementById("cricket-fx");
    if (!el) return;
    el.hidden = true;
    el.classList.remove("is-play", "is-four", "is-six", "is-wicket", "is-reduced");
  }

  return {
    prefersReducedMotion,
    classifyDelivery,
    ensureConfetti,
    burst,
    celebrateSold,
    celebrateChampion,
    playCue,
    hideCue,
    get lastCue() { return lastCue; },
  };
});
