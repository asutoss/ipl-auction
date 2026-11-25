/**
 * How the client should leave a room and what to do on boot/refresh.
 * After End game or Leave, drop the saved session and room URL so a
 * refresh stays on the start page. Mid-game refresh-resume is unchanged.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IplLeaveHome = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const STORE_KEY = "ipl-auction-session";

  function isLivePhase(phase) {
    return Boolean(phase && phase !== "ended");
  }

  function sessionMatches(session, code) {
    return Boolean(session && session.name && session.code && session.code === code);
  }

  /**
   * @param {{ stayOnHome?: boolean, urlCode?: string|null, session?: {code?: string, name?: string}|null, status?: string, phase?: string, code?: string }} opts
   * @returns {{ action: string, code?: string, name?: string }}
   */
  function bootDecision(opts) {
    const o = opts || {};
    if (o.stayOnHome) return { action: "stay-home" };
    if (isLivePhase(o.phase) && o.code) return { action: "noop" };
    const urlCode = o.urlCode || null;
    const session = o.session || null;
    const status = o.status;
    if (urlCode) {
      if (status === "open") {
        if (sessionMatches(session, urlCode)) return { action: "rejoin", code: urlCode, name: session.name };
        return { action: "join-landing", code: urlCode };
      }
      if (status === "ended") {
        // Results rooms stay joinable by name so a mid-results refresh can resume.
        // After the host ends the game the room is evicted; a failed rejoin should go home.
        if (sessionMatches(session, urlCode)) return { action: "rejoin", code: urlCode, name: session.name };
        return { action: "done-landing", code: urlCode };
      }
      if (status) return { action: "missing-landing", code: urlCode };
      return { action: "wait-status", code: urlCode };
    }
    if (session && session.code && session.name) {
      return { action: "rejoin", code: session.code, name: session.name };
    }
    return { action: "home" };
  }

  function shouldApplyRemoteState(stayOnHome, phase) {
    if (stayOnHome) return false;
    if (phase === "ended") return false;
    return true;
  }

  function clearSessionStorage(storage) {
    try {
      if (storage && storage.removeItem) storage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
  }

  function shouldClearUrl(pathname, search) {
    return String(pathname || "") !== "/" || Boolean(search);
  }

  return {
    STORE_KEY,
    isLivePhase,
    sessionMatches,
    bootDecision,
    shouldApplyRemoteState,
    clearSessionStorage,
    shouldClearUrl,
    homePath: "/",
  };
});
