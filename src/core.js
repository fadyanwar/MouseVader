// MouseVader core: pure logic shared by the content script, the popup, the options page and the tests.
// No DOM or extension APIs here, so everything can be unit tested in Node.
(function (root) {
  "use strict";

  const SPEEDS = {
    // interval between rounds (ms), targets per round, dwell per target (ms)
    slow:   { label: "Slow",   interval: [15000, 30000], targets: [3, 8],   dwell: [400, 1500] },
    normal: { label: "Normal", interval: [5000, 12000],  targets: [8, 20],  dwell: [200, 900] },
    fast:   { label: "Fast",   interval: [2000, 5000],   targets: [20, 45], dwell: [80, 400] },
  };

  const DEFAULTS = Object.freeze({
    enabled: true,
    speed: "normal",
    excluded: [],             // host patterns: "example.com" (and its subdomains), "*.example.com", "mail.example.com"
    pauseOnActivityMs: 3000,  // pause after the user's own mouse/keyboard/scroll activity
    backgroundTabs: true,     // keep adding noise while the tab is hidden
    debug: false,             // log each round to the page console
  });

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  // Accepts a host, a URL or a pattern typed by a person and returns a canonical pattern, or "" if invalid.
  function normalizePattern(input) {
    let s = String(input || "").trim().toLowerCase();
    if (!s) return "";
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");   // scheme
    s = s.replace(/[/?#].*$/, "");                  // path, query, fragment
    s = s.replace(/^[^@]*@/, "");                   // credentials
    s = s.replace(/:\d+$/, "");                     // port
    s = s.replace(/\.$/, "");
    if (s.startsWith("www.")) s = s.slice(4);
    const wild = s.startsWith("*.");
    const host = wild ? s.slice(2) : s;
    if (!/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)*[a-z0-9-]{1,63}$/.test(host)) return "";
    if (host.split(".").some(l => l.startsWith("-") || l.endsWith("-"))) return "";
    return wild ? "*." + host : host;
  }

  // "example.com" matches example.com and every subdomain; "*.example.com" matches only subdomains.
  function hostMatches(pattern, host) {
    const p = normalizePattern(pattern);
    const h = String(host || "").toLowerCase().replace(/\.$/, "");
    if (!p || !h) return false;
    if (p.startsWith("*.")) return h.endsWith(p.slice(1));
    return h === p || h.endsWith("." + p) || h === "www." + p;
  }

  function normalizeSettings(raw) {
    const s = Object.assign({}, DEFAULTS, raw || {});
    const out = {
      enabled: s.enabled !== false,
      speed: Object.prototype.hasOwnProperty.call(SPEEDS, s.speed) ? s.speed : DEFAULTS.speed,
      excluded: [],
      pauseOnActivityMs: Number.isFinite(+s.pauseOnActivityMs) ? clamp(Math.round(+s.pauseOnActivityMs), 0, 60000)
                                                                 : DEFAULTS.pauseOnActivityMs,
      backgroundTabs: s.backgroundTabs !== false,
      debug: s.debug === true,
    };
    const seen = new Set();
    for (const p of Array.isArray(s.excluded) ? s.excluded : []) {
      const n = normalizePattern(p);
      if (n && !seen.has(n)) { seen.add(n); out.excluded.push(n); }
    }
    out.excluded.sort();
    return out;
  }

  function isExcluded(settings, host) {
    return normalizeSettings(settings).excluded.some(p => hostMatches(p, host));
  }

  // Why MouseVader is or isn't running on a host: "on", "off" (switched off), "excluded" (site list).
  function stateFor(settings, host) {
    const s = normalizeSettings(settings);
    if (!s.enabled) return "off";
    if (s.excluded.some(p => hostMatches(p, host))) return "excluded";
    return "on";
  }

  // Patterns in the list that cover this host (what the popup names as the reason it's off here).
  function matchingPatterns(settings, host) {
    return normalizeSettings(settings).excluded.filter(p => hostMatches(p, host));
  }

  // exclude=true adds the host ("www." stripped) unless a pattern already covers it;
  // exclude=false removes every pattern that covers the host, so MouseVader runs there again.
  function toggleSite(settings, host, exclude) {
    const s = normalizeSettings(settings);
    const h = normalizePattern(host);
    if (!h || h.startsWith("*.")) return s;
    let excluded = s.excluded;
    if (exclude) { if (!excluded.some(p => hostMatches(p, h))) excluded = excluded.concat(h); }
    else excluded = excluded.filter(p => !hostMatches(p, h));
    return normalizeSettings(Object.assign({}, s, { excluded }));
  }

  function between(rng, [lo, hi]) { return lo + (hi - lo) * rng(); }
  function intBetween(rng, [lo, hi]) { return Math.floor(lo + (hi - lo + 1) * rng()); }

  // Delay before the next round. Big pages back off a little (the original's "more elements = longer").
  function nextInterval(speed, elementCount, rng = Math.random) {
    const sp = SPEEDS[speed] || SPEEDS.normal;
    const backoff = Math.min(10000, Math.max(0, elementCount | 0));
    return Math.round(between(rng, sp.interval) + backoff);
  }

  // Picks distinct random indices (Floyd's algorithm), at most `count` of `n`.
  function pickIndices(n, count, rng = Math.random) {
    const k = Math.min(n, Math.max(0, count | 0));
    const chosen = new Set();
    for (let j = n - k; j < n; j++) {
      const t = Math.floor(rng() * (j + 1));
      chosen.add(chosen.has(t) ? j : t);
    }
    return [...chosen];
  }

  function targetCount(speed, rng = Math.random) {
    return intBetween(rng, (SPEEDS[speed] || SPEEDS.normal).targets);
  }

  // A plausible pointer visit to one element: enter at an edge point, wander inside, leave.
  // rect: {left, top, width, height} in client coordinates. Returns [{type, x, y, at}] with `at` in ms.
  function visitPlan(rect, speed, rng = Math.random) {
    const sp = SPEEDS[speed] || SPEEDS.normal;
    const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
    const pt = () => ({ x: Math.round(rect.left + w * (0.05 + 0.9 * rng())), y: Math.round(rect.top + h * (0.05 + 0.9 * rng())) });
    const dwell = between(rng, sp.dwell);
    const moves = intBetween(rng, [2, 6]);
    const start = pt();
    const plan = [
      { type: "pointerover", ...start, at: 0 },
      { type: "pointerenter", ...start, at: 0 },
      { type: "mouseover", ...start, at: 0 },
      { type: "mouseenter", ...start, at: 0 },
    ];
    for (let m = 1; m <= moves; m++) {
      const p = pt();
      const at = Math.round((dwell * m) / (moves + 1));
      plan.push({ type: "pointermove", ...p, at }, { type: "mousemove", ...p, at });
    }
    const end = pt();
    const at = Math.round(dwell);
    plan.push(
      { type: "pointerout", ...end, at }, { type: "pointerleave", ...end, at },
      { type: "mouseout", ...end, at }, { type: "mouseleave", ...end, at },
    );
    return plan;
  }

  const api = { SPEEDS, DEFAULTS, normalizePattern, hostMatches, normalizeSettings, isExcluded, stateFor,
                matchingPatterns, toggleSite, nextInterval, pickIndices, targetCount, visitPlan };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MouseVaderCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
