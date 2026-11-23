// MouseVader content script: adds fake pointer activity to the page so behavioural trackers
// record noise alongside (and indistinguishable in timing from) the user's real interest.
// Written by Fady Anwar. Settings come from the popup/options page via extension storage.
(function () {
  "use strict";
  if (window.__mouseVader) return;              // injected once per document
  const C = globalThis.MouseVaderCore;
  const ext = globalThis.browser || globalThis.chrome;

  // Elements a person plausibly points at. Form fields, media and editable areas are never touched,
  // so fake hovers can't change what the user is typing or start playback.
  const CANDIDATES = "div,a,img,li,p,span,section,article,aside,figure,button,h1,h2,h3,h4,td,nav,header,footer,label";
  const SKIP = "input,textarea,select,option,video,audio,iframe,object,embed,canvas,[contenteditable]:not([contenteditable='false'])";
  const BUSY_RETRY_MS = 1500;

  const state = {
    settings: C.normalizeSettings(),
    host: location.hostname,
    timer: null,
    round: 0,                 // incremented to cancel a round in progress
    lastActivity: -Infinity,  // performance.now() of the user's last real input
    pointerEl: null,          // element under the user's real pointer
    sent: 0,                  // fake events dispatched in this document
    rounds: 0,
  };
  window.__mouseVader = state;

  const now = () => performance.now();
  const log = (...a) => { if (state.settings.debug) console.debug("[MouseVader]", ...a); };
  const siteState = () => C.stateFor(state.settings, state.host);
  const shouldRun = () => siteState() === "on" && (state.settings.backgroundTabs || !document.hidden);
  const userBusy = () => now() - state.lastActivity < state.settings.pauseOnActivityMs;

  // ---- the user's real input (isTrusted) pauses us and marks the element under the pointer
  function onRealInput(e) {
    if (!e.isTrusted) return;                   // our own events are untrusted; ignore them
    state.lastActivity = now();
    if (e.type === "mouseover" || e.type === "pointerover" || e.type === "mousemove") state.pointerEl = e.target;
    if (e.type === "mouseout" && !e.relatedTarget) state.pointerEl = null;  // pointer left the window
  }
  for (const t of ["mousemove", "mouseover", "mouseout", "pointerover", "mousedown", "keydown", "wheel", "touchstart", "scroll"])
    window.addEventListener(t, onRealInput, { capture: true, passive: true });

  // The page itself or a large container under the pointer: its children stay fair game,
  // otherwise a pointer resting on the background would stop MouseVader altogether.
  function broad(el) {
    if (el === document.body || el === document.documentElement) return true;
    const r = el.getBoundingClientRect();
    const view = Math.max(1, (window.innerWidth || 1) * (window.innerHeight || 1));
    return r.width * r.height > 0.25 * view;
  }

  // Never hover the element under the user's real pointer or its ancestors (that could close a menu
  // they opened), nor the children of a small element under the pointer (its items).
  function eligible(el) {
    if (!el.isConnected || el.closest(SKIP)) return false;
    const p = state.pointerEl;
    if (p && p.isConnected) {
      if (el === p || el.contains(p)) return false;
      if (p.contains(el) && !broad(p)) return false;
    }
    return true;
  }

  function dispatch(el, step) {
    const pointer = step.type.startsWith("pointer");
    const init = {
      bubbles: !/enter|leave/.test(step.type), cancelable: !/enter|leave/.test(step.type), composed: true,
      view: window, clientX: step.x, clientY: step.y,
      screenX: step.x + (window.screenX || 0), screenY: step.y + (window.screenY || 0) + 80,
      button: 0, buttons: 0,
    };
    let ev;
    if (pointer && typeof PointerEvent === "function")
      ev = new PointerEvent(step.type, Object.assign(init, { pointerId: 1, pointerType: "mouse", isPrimary: true }));
    else if (pointer) return false;             // no PointerEvent support: send the mouse events only
    else ev = new MouseEvent(step.type, init);
    el.dispatchEvent(ev);
    state.sent++;
    return true;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // One visit: the plan's steps at their offsets. Stops early if the round was cancelled
  // or the user started using the page.
  async function visit(el, token) {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return 0;
    const plan = C.visitPlan(r, state.settings.speed);
    let t = 0, n = 0;
    for (const step of plan) {
      if (step.at > t) { await sleep(step.at - t); t = step.at; }
      if (token !== state.round || !shouldRun() || userBusy() || !eligible(el)) {
        // leave cleanly so the page never sees a hover without its matching "out"
        if (n) for (const type of ["pointerout", "mouseout"]) dispatch(el, { type, x: step.x, y: step.y });
        return n;
      }
      if (dispatch(el, step)) n++;
    }
    return n;
  }

  async function round() {
    state.timer = null;
    const token = ++state.round;
    if (!shouldRun()) return;                   // resumed by settings or visibility changes
    if (userBusy()) return schedule(BUSY_RETRY_MS);
    const all = document.querySelectorAll(CANDIDATES);
    const picks = C.pickIndices(all.length, C.targetCount(state.settings.speed)).map(i => all[i]).filter(eligible);
    let n = 0;
    for (const el of picks) {
      if (token !== state.round) return;        // cancelled (switched off, excluded, settings changed)
      n += await visit(el, token);
      await sleep(Math.round(30 + Math.random() * 250));   // travel time to the next element
    }
    state.rounds++;
    log(`${n} fake events on ${picks.length} elements`);
    report({ type: "events", count: n });
    schedule(C.nextInterval(state.settings.speed, all.length));
  }

  function schedule(ms) {
    clearTimeout(state.timer);
    state.timer = shouldRun() ? setTimeout(round, ms) : null;
  }

  function report(msg) {
    try {
      const p = ext.runtime.sendMessage(Object.assign({ host: state.host, state: siteState(), sent: state.sent }, msg));
      if (p && p.catch) p.catch(() => {});
    } catch (_) { /* extension reloaded or unavailable */ }
  }

  function apply(raw) {
    const before = siteState();
    state.settings = C.normalizeSettings(raw);
    const after = siteState();
    state.round++;                              // cancel any round using the old settings
    if (after === "on") schedule(500 + Math.random() * 1500);
    else { clearTimeout(state.timer); state.timer = null; }
    if (before !== after) log(`now ${after} on ${state.host}`);
    report({ type: "state" });
  }

  document.addEventListener("visibilitychange", () => {
    if (shouldRun() && !state.timer) schedule(500 + Math.random() * 1500);
  });

  // The popup asks the tab what it's doing.
  ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "mousevader-status") {
      const reply = { host: state.host, state: siteState(), sent: state.sent, rounds: state.rounds,
                      paused: userBusy(), hidden: document.hidden };
      if (sendResponse) sendResponse(reply);
      return Promise.resolve(reply);
    }
    return undefined;
  });

  ext.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) apply(changes.settings.newValue);
  });
  const got = ext.storage.local.get("settings");
  (got && got.then ? got : Promise.resolve({})).then(r => apply(r && r.settings), () => apply(null));
})();
