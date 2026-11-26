const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { tickDecision, createMuteStore } = require("../public/sounds");

describe("sounds", () => {
  const base = { open: true, frozen: false, lotKey: "p1" };

  test("ticks once per second only within the last 5 seconds", () => {
    let last = null;
    const played = [];
    for (const secs of [8, 6, 5, 5, 5, 4, 4, 3, 2, 2, 1, 1, 0]) {
      const r = tickDecision({ ...base, secs }, last);
      last = r.last;
      if (r.tick) played.push(secs);
    }
    assert.deepEqual(played, [5, 4, 3, 2, 1]);
  });

  test("no tick when frozen, closed or timer over", () => {
    assert.equal(tickDecision({ ...base, secs: 3, frozen: true }, null).tick, false);
    assert.equal(tickDecision({ ...base, secs: 3, open: false }, null).tick, false);
    assert.equal(tickDecision({ ...base, secs: 0 }, null).tick, false);
    assert.equal(tickDecision({ ...base, secs: NaN }, null).tick, false);
  });

  test("a new lot ticks again at the same second value", () => {
    const a = tickDecision({ ...base, secs: 5 }, null);
    assert.equal(tickDecision({ ...base, secs: 5, lotKey: "p2" }, a.last).tick, true);
  });

  test("mute store defaults to on and survives broken storage", () => {
    const mem = { v: null, getItem() { return this.v; }, setItem(k, v) { this.v = v; } };
    const s = createMuteStore(mem);
    assert.equal(s.get(), true);
    s.set(false);
    assert.equal(s.get(), false);
    const broken = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
    assert.equal(createMuteStore(broken).get(), true);
    createMuteStore(broken).set(false);
  });
});
