/**
 * Optional synthesized sound effects (Web Audio, no audio files).
 * Pure decision logic is exported for Node tests; browser side effects are
 * guarded so a missing/blocked AudioContext never throws.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.IplSounds = factory(root);
})(typeof self !== "undefined" ? self : this, function (root) {
  const STORAGE_KEY = "ipl-sound";
  const TICK_FROM_SECS = 5;

  /**
   * Decide whether to tick now. `input`: { secs, open, frozen, lotKey }
   * `last`: previous { lotKey, secs } or null. Returns { tick, last }.
   * Ticks once per whole-second value in 5..1, only while bidding is open.
   */
  function tickDecision(input, last) {
    const { secs, open, frozen, lotKey } = input || {};
    if (!open || frozen || !Number.isFinite(secs) || secs < 1 || secs > TICK_FROM_SECS) {
      return { tick: false, last: open && !frozen && last && last.lotKey === lotKey ? last : null };
    }
    if (last && last.lotKey === lotKey && last.secs === secs) return { tick: false, last };
    return { tick: true, last: { lotKey, secs } };
  }

  function createMuteStore(storage) {
    function get() {
      try {
        return storage.getItem(STORAGE_KEY) !== "off";
      } catch {
        return true;
      }
    }
    function set(on) {
      try {
        storage.setItem(STORAGE_KEY, on ? "on" : "off");
      } catch {
        /* ignore */
      }
    }
    return { get, set };
  }

  const api = { STORAGE_KEY, TICK_FROM_SECS, tickDecision, createMuteStore };
  if (!root || typeof root.document === "undefined") return api;

  // ---- browser side ----
  let ctx = null;
  let enabled = true;
  let tickLast = null;
  function store() {
    // Accessing localStorage itself can throw (blocked site data).
    try {
      return createMuteStore(root.localStorage);
    } catch {
      return createMuteStore({
        getItem() {
          throw new Error("no storage");
        },
        setItem() {
          throw new Error("no storage");
        },
      });
    }
  }
  enabled = store().get();

  function ensureCtx() {
    try {
      if (!ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === "suspended" && typeof ctx.resume === "function") {
        const p = ctx.resume();
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
      return ctx;
    } catch {
      return null;
    }
  }

  ["pointerdown", "keydown"].forEach((ev) => {
    try {
      root.document.addEventListener(ev, ensureCtx, { capture: true, passive: true });
    } catch {
      /* ignore */
    }
  });

  // notes: [{ f: Hz, t: start offset s, d: duration s, g: peak gain, type }]
  function tone(notes) {
    if (!enabled) return;
    if (!ctx || ctx.state === "closed") return; // no user gesture yet: stay silent
    try {
      const t0 = ctx.currentTime + 0.01;
      for (const n of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = n.type || "sine";
        osc.frequency.setValueAtTime(n.f, t0 + n.t);
        const peak = Math.min(0.15, n.g || 0.1);
        gain.gain.setValueAtTime(0.0001, t0 + n.t);
        gain.gain.linearRampToValueAtTime(peak, t0 + n.t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0 + n.t);
        osc.stop(t0 + n.t + n.d + 0.02);
      }
    } catch {
      /* ignore */
    }
  }

  const SOUNDS = {
    outbid: () => tone([{ f: 440, t: 0, d: 0.14, g: 0.1, type: "triangle" }, { f: 330, t: 0.12, d: 0.22, g: 0.1, type: "triangle" }]),
    sold: () => tone([{ f: 523.25, t: 0, d: 0.16, g: 0.1 }, { f: 659.25, t: 0.1, d: 0.18, g: 0.1 }, { f: 783.99, t: 0.2, d: 0.3, g: 0.1 }]),
    soldYou: () =>
      tone([
        { f: 523.25, t: 0, d: 0.14, g: 0.11 },
        { f: 659.25, t: 0.09, d: 0.14, g: 0.11 },
        { f: 783.99, t: 0.18, d: 0.14, g: 0.11 },
        { f: 1046.5, t: 0.27, d: 0.4, g: 0.12 },
      ]),
    tick: () => tone([{ f: 880, t: 0, d: 0.06, g: 0.05 }]),
  };

  function play(name) {
    if (!enabled || !SOUNDS[name]) return;
    if (root.document.hidden) return;
    if (!ctx) return; // not unlocked by a gesture yet
    ensureCtx();
    SOUNDS[name]();
  }

  /** Called from the timer loop with the live auction state. */
  function tickCheck(input) {
    const r = tickDecision(input, tickLast);
    tickLast = r.last;
    if (r.tick) play("tick");
  }

  function labelFor(on) {
    return on ? "Sound on" : "Sound off";
  }

  function toggleHtml() {
    return `<button class="btn secondary sound-toggle" id="sound-toggle" type="button" aria-label="${labelFor(enabled)}" title="${labelFor(enabled)}" aria-pressed="${enabled ? "true" : "false"}">${enabled ? "🔊" : "🔇"}</button>`;
  }

  function setEnabled(on) {
    enabled = Boolean(on);
    store().set(enabled);
    const btn = root.document.getElementById("sound-toggle");
    if (btn) {
      btn.setAttribute("aria-label", labelFor(enabled));
      btn.setAttribute("title", labelFor(enabled));
      btn.setAttribute("aria-pressed", enabled ? "true" : "false");
      btn.textContent = enabled ? "🔊" : "🔇";
    }
  }

  root.document.addEventListener("click", (e) => {
    const t = e.target && e.target.closest && e.target.closest("#sound-toggle");
    if (!t) return;
    setEnabled(!enabled);
    if (enabled) {
      ensureCtx();
      SOUNDS.tick();
    }
  });

  return Object.assign(api, {
    play,
    tickCheck,
    toggleHtml,
    setEnabled,
    isEnabled: () => enabled,
  });
});
