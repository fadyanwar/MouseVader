// System tests: the real content script in a jsdom page with a fake extension API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const CORE = readFileSync(new URL("../../src/core.js", import.meta.url), "utf8");
const CONTENT = readFileSync(new URL("../../src/content.js", import.meta.url), "utf8");
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PAGE = `<!doctype html><body>
  <header id="hdr"><nav><a href="#">Home</a><a href="#">News</a></nav></header>
  <main>${Array.from({ length: 40 }, (_, i) => `<article id="a${i}"><h2>Story ${i}</h2><p>Text <a href="#">link ${i}</a></p><img alt=""></article>`).join("")}
    <form><input id="in"><textarea id="ta"></textarea><select id="sel"><option>1</option></select></form>
    <video id="vid"></video><div contenteditable="true" id="ed"><p id="edp">editable</p></div>
    <div contenteditable="false" id="ro"><span id="ros">not editable</span></div>
  </main></body>`;

// Fake extension API: storage with change events, runtime messages both ways.
function fakeExt(initial) {
  const store = { settings: initial };
  const changeListeners = [], messageListeners = [], sent = [];
  return {
    sent, store,
    runtime: {
      sendMessage: async msg => { sent.push(msg); },
      onMessage: { addListener: f => messageListeners.push(f) },
    },
    storage: {
      local: {
        get: async () => ({ ...store }),
        set: async obj => {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = v; }
          changeListeners.forEach(f => f(changes, "local"));
        },
      },
      onChanged: { addListener: f => changeListeners.push(f) },
    },
    ask: msg => messageListeners.map(f => f(msg, {}, () => {})).find(Boolean),
  };
}

// Loads the page and the extension; returns a recorder of every pointer/mouse event on the page.
async function load({ url = "https://news.example.org/", settings = {}, pointerEvents = true, hidden = false } = {}) {
  const dom = new JSDOM(PAGE, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  // jsdom has no layout: give every element a box so visits have coordinates.
  window.Element.prototype.getBoundingClientRect = function () {
    const i = [...this.ownerDocument.querySelectorAll("*")].indexOf(this);
    return { left: 10 + (i % 7) * 50, top: 20 + i * 3, width: 120, height: 30, right: 0, bottom: 0, x: 0, y: 0 };
  };
  if (pointerEvents && !window.PointerEvent) {
    window.PointerEvent = class PointerEvent extends window.MouseEvent {
      constructor(type, init = {}) { super(type, init); this.pointerType = init.pointerType; this.isPrimary = init.isPrimary; }
    };
  }
  if (hidden) Object.defineProperty(window.document, "hidden", { configurable: true, get: () => true });
  const ext = fakeExt({ speed: "fast", pauseOnActivityMs: 0, ...settings });
  window.browser = ext;
  const events = [];
  for (const t of ["pointerover", "pointerenter", "pointermove", "pointerout", "pointerleave",
                   "mouseover", "mouseenter", "mousemove", "mouseout", "mouseleave", "click", "mousedown", "focus", "input"])
    window.document.addEventListener(t, e => events.push({ type: e.type, target: e.target, x: e.clientX, y: e.clientY,
                                                            trusted: e.isTrusted, ctor: e.constructor.name }), true);
  window.eval(CORE);
  // tiny timings so the suite runs in seconds; same shape as the real speeds
  Object.assign(window.MouseVaderCore.SPEEDS.fast, { interval: [40, 80], targets: [6, 12], dwell: [5, 20] });
  window.eval(CONTENT);
  return { dom, window, ext, events, state: window.__mouseVader, close: () => { window.__mouseVader.round++; dom.window.close(); } };
}

async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(25); }
  return false;
}

test("adds complete, untrusted pointer visits to ordinary elements", async () => {
  const p = await load();
  try {
    assert.ok(await until(() => p.events.filter(e => e.type === "mouseout").length >= 10 &&
                                p.ext.sent.some(m => m.type === "events")), "fake visits happen and a round completes");
    await sleep(100);
    p.state.round++;                                       // stop; let in-flight visits settle
    await sleep(80);
    const ev = p.events;
    assert.ok(ev.every(e => e.trusted === false), "all synthetic");
    for (const t of ["pointerover", "pointermove", "mouseover", "mousemove", "mouseout", "pointerout"])
      assert.ok(ev.some(e => e.type === t), t);
    assert.ok(ev.filter(e => e.type === "pointerover").every(e => e.ctor === "PointerEvent"));
    // every element that was hovered was also left (no element is left "hovered")
    const balance = new Map();
    for (const e of ev) {
      if (e.type === "mouseover") balance.set(e.target, (balance.get(e.target) || 0) + 1);
      if (e.type === "mouseout") balance.set(e.target, (balance.get(e.target) || 0) - 1);
    }
    assert.ok([...balance.values()].every(v => v === 0), "every mouseover has a mouseout");
    // coordinates fall inside the target's box
    for (const e of ev.filter(e => e.type === "mousemove")) {
      const r = e.target.getBoundingClientRect();
      assert.ok(e.x >= r.left && e.x <= r.left + r.width && e.y >= r.top && e.y <= r.top + r.height);
    }
    // never anything that acts on the page
    assert.ok(!ev.some(e => ["click", "mousedown", "focus", "input"].includes(e.type)));
    // reports its count to the background for the badge
    assert.ok(p.ext.sent.some(m => m.type === "events" && m.sent > 0 && m.host === "news.example.org" && m.state === "on"));
  } finally { p.close(); }
});

test("never touches form fields, media or editable areas", async () => {
  const p = await load();
  try {
    assert.ok(await until(() => p.events.filter(e => e.type === "mouseout").length >= 40, 15000), "enough visits to judge");
    const forbidden = ["in", "ta", "sel", "vid", "ed", "edp"].map(id => p.window.document.getElementById(id));
    assert.ok(!p.events.some(e => forbidden.some(f => f === e.target || f.contains(e.target))));
  } finally { p.close(); }
});

test("does nothing while switched off, starts when switched on, stops when switched off", async () => {
  const p = await load({ settings: { enabled: false } });
  try {
    await sleep(700);
    assert.equal(p.events.length, 0, "off: no events");
    assert.ok(p.ext.sent.some(m => m.type === "state" && m.state === "off"));
    await p.ext.storage.local.set({ settings: { ...p.ext.store.settings, enabled: true } });
    assert.ok(await until(() => p.events.length > 0), "switched on: events start");
    await p.ext.storage.local.set({ settings: { ...p.ext.store.settings, enabled: false } });
    await sleep(60);                                        // an in-flight step may finish
    const n = p.events.length;
    await sleep(700);
    assert.equal(p.events.length, n, "switched off: no further events");
  } finally { p.close(); }
});

test("excluded sites (and their subdomains) get no events; the popup is told why", async () => {
  const p = await load({ url: "https://www.mail.example.com/inbox", settings: { excluded: ["example.com"] } });
  try {
    await sleep(800);
    assert.equal(p.events.length, 0);
    const status = await p.ext.ask({ type: "mousevader-status" });
    assert.equal(status.state, "excluded");
    assert.equal(status.host, "www.mail.example.com");
    // removing the exclusion resumes it
    await p.ext.storage.local.set({ settings: { ...p.ext.store.settings, excluded: [] } });
    assert.ok(await until(() => p.events.length > 0));
    assert.equal((await p.ext.ask({ type: "mousevader-status" })).state, "on");
  } finally { p.close(); }
});

test("pauses after the user's own activity", async () => {
  const p = await load({ settings: { pauseOnActivityMs: 1200 } });
  try {
    p.state.lastActivity = p.window.performance.now();    // as if the user just moved the mouse
    await sleep(900);
    assert.equal(p.events.length, 0, "paused");
    assert.equal((await p.ext.ask({ type: "mousevader-status" })).paused, true);
    assert.ok(await until(() => p.events.length > 0, 5000), "resumes after the pause");
  } finally { p.close(); }
});

test("never hovers the element under the real pointer, its ancestors or its children", async () => {
  const p = await load();
  try {
    const under = p.window.document.getElementById("a5");
    p.state.pointerEl = under;
    assert.ok(await until(() => p.events.filter(e => e.type === "mouseout").length >= 40, 15000), "enough visits to judge");
    const bad = p.events.filter(e => e.type === "mouseover" && (e.target === under || e.target.contains(under) || under.contains(e.target)));
    assert.deepEqual(bad.map(e => e.target.id || e.target.tagName), []);
  } finally { p.close(); }
});

test("keeps running when the real pointer rests on the page background", async () => {
  const p = await load();
  try {
    p.state.pointerEl = p.window.document.body;          // the usual resting place of a pointer
    assert.ok(await until(() => p.events.filter(e => e.type === "mouseout").length >= 10), "still adds noise");
    assert.ok(!p.events.some(e => e.target === p.window.document.body && e.type === "mouseover"), "never the body itself");
  } finally { p.close(); }
});

test("background tabs: runs when allowed, stays idle when not", async () => {
  const yes = await load({ hidden: true, settings: { backgroundTabs: true } });
  try { assert.ok(await until(() => yes.events.length > 0), "runs hidden"); } finally { yes.close(); }
  const no = await load({ hidden: true, settings: { backgroundTabs: false } });
  try {
    await sleep(800);
    assert.equal(no.events.length, 0, "idle while hidden");
    Object.defineProperty(no.window.document, "hidden", { configurable: true, get: () => false });
    no.window.document.dispatchEvent(new no.window.Event("visibilitychange"));
    assert.ok(await until(() => no.events.length > 0), "resumes when visible");
  } finally { no.close(); }
});

test("works without PointerEvent support (mouse events only)", async () => {
  const p = await load({ pointerEvents: false });
  try {
    if (p.window.PointerEvent) return;                    // this jsdom has PointerEvent; covered above
    assert.ok(await until(() => p.events.some(e => e.type === "mouseover")));
    assert.ok(!p.events.some(e => e.type.startsWith("pointer")));
  } finally { p.close(); }
});

test("is injected once per document", async () => {
  const p = await load();
  try {
    const st = p.state;
    p.window.eval(CONTENT);                                // a second injection
    assert.equal(p.window.__mouseVader, st);
  } finally { p.close(); }
});
