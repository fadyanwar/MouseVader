import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const C = createRequire(import.meta.url)("../../src/core.js");

// deterministic random source
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("normalizePattern accepts hosts, URLs and wildcards; rejects junk", () => {
  assert.equal(C.normalizePattern("Example.COM"), "example.com");
  assert.equal(C.normalizePattern("https://www.example.com/path?q=1#x"), "example.com");
  assert.equal(C.normalizePattern("http://user:pw@shop.example.co.uk:8080/a"), "shop.example.co.uk");
  assert.equal(C.normalizePattern("*.example.com"), "*.example.com");
  assert.equal(C.normalizePattern("  example.com.  "), "example.com");
  assert.equal(C.normalizePattern("localhost"), "localhost");
  for (const bad of ["", "   ", "exa mple.com", "-bad.com", "bad-.com", "*.", "http://", "a..b", "é.com"])
    assert.equal(C.normalizePattern(bad), "", bad);
});

test("hostMatches: plain pattern covers subdomains, wildcard covers only subdomains", () => {
  assert.ok(C.hostMatches("example.com", "example.com"));
  assert.ok(C.hostMatches("example.com", "www.example.com"));
  assert.ok(C.hostMatches("example.com", "mail.example.com"));
  assert.ok(!C.hostMatches("example.com", "notexample.com"));
  assert.ok(!C.hostMatches("example.com", "example.com.evil.net"));
  assert.ok(C.hostMatches("*.example.com", "a.example.com"));
  assert.ok(!C.hostMatches("*.example.com", "example.com"));
  assert.ok(C.hostMatches("mail.example.com", "mail.example.com"));
  assert.ok(!C.hostMatches("mail.example.com", "example.com"));
  assert.ok(!C.hostMatches("example.com", ""));
  assert.ok(C.hostMatches("EXAMPLE.com", "Example.Com."));
});

test("normalizeSettings fills defaults, validates and de-duplicates", () => {
  assert.deepEqual(C.normalizeSettings(undefined), { ...C.DEFAULTS, excluded: [] });
  const s = C.normalizeSettings({ enabled: "yes", speed: "warp", excluded: ["B.com", "https://b.com/x", "", "nope nope", "a.com"],
                                  pauseOnActivityMs: 999999, backgroundTabs: 0, debug: "true" });
  assert.equal(s.enabled, true);            // only an explicit false switches it off
  assert.equal(s.speed, "normal");
  assert.deepEqual(s.excluded, ["a.com", "b.com"]);
  assert.equal(s.pauseOnActivityMs, 60000);
  assert.equal(s.backgroundTabs, true);     // only explicit false
  assert.equal(s.debug, false);             // only explicit true
  assert.equal(C.normalizeSettings({ pauseOnActivityMs: -5 }).pauseOnActivityMs, 0);
  assert.equal(C.normalizeSettings({ pauseOnActivityMs: "abc" }).pauseOnActivityMs, C.DEFAULTS.pauseOnActivityMs);
  assert.equal(C.normalizeSettings({ enabled: false }).enabled, false);
  assert.ok(Object.isFrozen(C.DEFAULTS));
});

test("stateFor and matchingPatterns explain why it is off", () => {
  const s = { enabled: true, excluded: ["example.com", "*.shop.net"] };
  assert.equal(C.stateFor(s, "news.org"), "on");
  assert.equal(C.stateFor(s, "www.example.com"), "excluded");
  assert.equal(C.stateFor(s, "a.shop.net"), "excluded");
  assert.equal(C.stateFor(s, "shop.net"), "on");
  assert.equal(C.stateFor({ ...s, enabled: false }, "news.org"), "off");
  assert.equal(C.stateFor({ ...s, enabled: false }, "example.com"), "off");   // global switch wins
  assert.deepEqual(C.matchingPatterns(s, "a.shop.net"), ["*.shop.net"]);
  assert.equal(C.isExcluded(s, "x.example.com"), true);
});

test("toggleSite excludes a site once and re-enables it by removing every covering pattern", () => {
  let s = C.toggleSite({}, "www.news.org", true);
  assert.deepEqual(s.excluded, ["news.org"]);
  s = C.toggleSite(s, "news.org", true);                       // idempotent
  assert.deepEqual(s.excluded, ["news.org"]);
  s = C.toggleSite({ excluded: ["example.com"] }, "mail.example.com", true);   // already covered: no extra entry
  assert.deepEqual(s.excluded, ["example.com"]);
  s = C.toggleSite({ excluded: ["example.com", "*.example.com", "other.net"] }, "mail.example.com", false);
  assert.deepEqual(s.excluded, ["other.net"]);
  assert.equal(C.stateFor(s, "mail.example.com"), "on");
  assert.deepEqual(C.toggleSite({ excluded: ["a.com"] }, "", true).excluded, ["a.com"]);   // no host: unchanged
  assert.deepEqual(C.toggleSite({}, "*.evil.com", true).excluded, []);                     // never adds a wildcard
});

test("nextInterval follows the speed and backs off on big pages, capped", () => {
  const r0 = () => 0, r1 = () => 0.999999;
  for (const [name, sp] of Object.entries(C.SPEEDS)) {
    assert.equal(C.nextInterval(name, 0, r0), sp.interval[0]);
    assert.ok(C.nextInterval(name, 0, r1) <= sp.interval[1]);
  }
  assert.equal(C.nextInterval("normal", 3000, r0), C.SPEEDS.normal.interval[0] + 3000);
  assert.equal(C.nextInterval("normal", 10 ** 7, r0), C.SPEEDS.normal.interval[0] + 10000);
  assert.equal(C.nextInterval("bogus", 0, r0), C.SPEEDS.normal.interval[0]);
  assert.ok(C.nextInterval("slow", 0, r0) > C.nextInterval("fast", 0, r1));
});

test("pickIndices returns distinct in-range indices, never more than asked or available", () => {
  const rng = seeded(7);
  for (const [n, k] of [[0, 5], [3, 10], [100, 20], [100000, 45], [1, 1]]) {
    const idx = C.pickIndices(n, k, rng);
    assert.equal(idx.length, Math.min(n, k));
    assert.equal(new Set(idx).size, idx.length);
    assert.ok(idx.every(i => Number.isInteger(i) && i >= 0 && i < n));
  }
  // every element can be chosen (the original loop never chose element 0)
  const seen = new Set();
  const r = seeded(3);
  for (let i = 0; i < 400; i++) C.pickIndices(10, 1, r).forEach(x => seen.add(x));
  assert.equal(seen.size, 10);
});

test("targetCount stays within the speed's range", () => {
  const rng = seeded(11);
  for (const [name, sp] of Object.entries(C.SPEEDS))
    for (let i = 0; i < 200; i++) {
      const n = C.targetCount(name, rng);
      assert.ok(n >= sp.targets[0] && n <= sp.targets[1], `${name} ${n}`);
    }
});

test("visitPlan: a complete visit inside the element, in time order, ending with out/leave", () => {
  const rect = { left: 100, top: 50, width: 200, height: 40 };
  const rng = seeded(5);
  for (const speed of Object.keys(C.SPEEDS)) {
    const plan = C.visitPlan(rect, speed, rng);
    const types = plan.map(p => p.type);
    assert.deepEqual(types.slice(0, 4), ["pointerover", "pointerenter", "mouseover", "mouseenter"]);
    assert.deepEqual(types.slice(-4), ["pointerout", "pointerleave", "mouseout", "mouseleave"]);
    assert.ok(types.filter(t => t === "mousemove").length >= 2);
    for (let i = 1; i < plan.length; i++) assert.ok(plan[i].at >= plan[i - 1].at, "time order");
    for (const p of plan) {
      assert.ok(p.x >= rect.left && p.x <= rect.left + rect.width, `x ${p.x}`);
      assert.ok(p.y >= rect.top && p.y <= rect.top + rect.height, `y ${p.y}`);
    }
    const dwell = plan.at(-1).at;
    assert.ok(dwell >= C.SPEEDS[speed].dwell[0] - 1 && dwell <= C.SPEEDS[speed].dwell[1] + 1);
    // every "over" has its matching "out"
    assert.equal(types.filter(t => t.endsWith("over")).length, types.filter(t => t.endsWith("out")).length);
  }
  // zero-size rect still produces finite coordinates
  const p0 = C.visitPlan({ left: 0, top: 0, width: 0, height: 0 }, "normal", rng);
  assert.ok(p0.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test("badgeText abbreviates counts and shows off", async () => {
  const { badgeText } = createRequire(import.meta.url)("./_background-shim.cjs");
  assert.equal(badgeText(null), "");
  assert.equal(badgeText({ state: "off", sent: 50 }), "off");
  assert.equal(badgeText({ state: "excluded", sent: 50 }), "off");
  assert.equal(badgeText({ state: "on", sent: 0 }), "");
  assert.equal(badgeText({ state: "on", sent: 999 }), "999");
  assert.equal(badgeText({ state: "on", sent: 1234 }), "1.2k");
  assert.equal(badgeText({ state: "on", sent: 54321 }), "54k");
});
