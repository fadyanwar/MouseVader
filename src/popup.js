// MouseVader popup: global switch, this-site switch, speed, and what the current tab is doing.
"use strict";
const C = globalThis.MouseVaderCore;
const ext = globalThis.browser || globalThis.chrome;
const $ = id => document.getElementById(id);

let settings = C.normalizeSettings();
let target = null;            // { tabId, host, sent, state } or null when the page can't run content scripts

async function loadSettings() {
  const r = await ext.storage.local.get("settings");
  settings = C.normalizeSettings(r && r.settings);
}

async function save(next) {
  settings = C.normalizeSettings(next);
  await ext.storage.local.set({ settings });
  render();
  setTimeout(refreshTarget, 300);      // the tab re-reads settings; show its new state
}

async function ask(tabId) {
  try {
    const r = await ext.tabs.sendMessage(tabId, { type: "mousevader-status" }, { frameId: 0 });
    return r && r.host !== undefined ? Object.assign({ tabId }, r) : null;
  } catch (_) { return null; }         // no content script there (browser pages, add-on store, PDF viewer…)
}

// The page the popup is about: the active tab. When this page is open in a tab of its own
// (e.g. from the options page or a test), the most recently used other tab in the window.
async function findTarget() {
  const self = ext.tabs.getCurrent ? await ext.tabs.getCurrent() : null;
  if (!self) {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    return tab ? ask(tab.id) : null;
  }
  // Same window first, then any window (the page may be open as a window of its own).
  const byRecent = (a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0);
  const here = (await ext.tabs.query({ currentWindow: true })).filter(t => t.id !== self.id).sort(byRecent);
  const elsewhere = (await ext.tabs.query({})).filter(t => t.id !== self.id && t.windowId !== self.windowId).sort(byRecent);
  for (const t of here.concat(elsewhere)) { const r = await ask(t.id); if (r) return r; }
  return null;
}

async function refreshTarget() {
  target = await findTarget();
  render();
}

function render() {
  $("enabled").checked = settings.enabled;
  for (const b of document.querySelectorAll("#speed button")) b.setAttribute("aria-pressed", String(b.dataset.speed === settings.speed));

  const stateEl = $("state"), detail = $("detail"), site = $("site");
  if (!target) {
    $("siteName").textContent = "Not available on this page";
    site.checked = false; site.disabled = true;
    stateEl.dataset.state = settings.enabled ? "" : "off";
    stateEl.textContent = settings.enabled ? "Browser pages can't be changed by add-ons" : "Off everywhere";
    detail.textContent = settings.enabled ? "MouseVader runs on ordinary web pages." : "Switch it on to add noise again.";
    return;
  }
  const host = target.host || "this page";
  const st = C.stateFor(settings, target.host);
  const by = C.matchingPatterns(settings, target.host);
  $("siteName").textContent = host;
  site.disabled = !settings.enabled || !target.host;
  site.checked = st !== "excluded";
  stateEl.dataset.state = st;
  stateEl.textContent = st === "on" ? `Adding noise on ${host}` : st === "off" ? "Off everywhere" : `Off on ${host}`;
  const n = (target.sent || 0).toLocaleString();
  detail.textContent = st === "on" ? `${n} fake events on this tab so far${target.paused ? " · paused while you use the page" : ""}`
    : st === "excluded" ? `Excluded by “${by.join("”, “")}”` : "Switch it on to add noise again.";
}

$("enabled").addEventListener("change", e => save(Object.assign({}, settings, { enabled: e.target.checked })));
$("site").addEventListener("change", e => { if (target && target.host) save(C.toggleSite(settings, target.host, !e.target.checked)); });
$("speed").addEventListener("click", e => {
  const b = e.target.closest("button[data-speed]");
  if (b) save(Object.assign({}, settings, { speed: b.dataset.speed }));
});
$("options").addEventListener("click", () => { ext.runtime.openOptionsPage(); if (!ext.tabs.getCurrent) window.close(); });

ext.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) { settings = C.normalizeSettings(changes.settings.newValue); render(); }
});

loadSettings().then(refreshTarget);
setInterval(refreshTarget, 2000);       // live event count while the popup is open
