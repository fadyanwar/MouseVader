// MouseVader options page.
"use strict";
const C = globalThis.MouseVaderCore;
const ext = globalThis.browser || globalThis.chrome;
const $ = id => document.getElementById(id);
let settings = C.normalizeSettings();
let savedTimer = null;

async function save(next, note = "Saved") {
  settings = C.normalizeSettings(next);
  await ext.storage.local.set({ settings });
  render();
  $("saved").textContent = note;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { $("saved").textContent = ""; }, 2000);
}

function render() {
  $("enabled").checked = settings.enabled;
  $("background").checked = settings.backgroundTabs;
  $("debug").checked = settings.debug;
  const pause = $("pause");
  const v = String(settings.pauseOnActivityMs);
  if (![...pause.options].some(o => o.value === v)) pause.add(new Option(`${settings.pauseOnActivityMs / 1000} seconds`, v));
  pause.value = v;
  for (const b of document.querySelectorAll("#speed button")) b.setAttribute("aria-pressed", String(b.dataset.speed === settings.speed));

  const list = $("sites");
  list.textContent = "";
  if (!settings.excluded.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No excluded sites. MouseVader runs everywhere it can.";
    list.append(li);
  }
  for (const p of settings.excluded) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = p;
    const rm = document.createElement("button");
    rm.type = "button"; rm.className = "secondary"; rm.textContent = "Remove";
    rm.setAttribute("aria-label", `Remove ${p}`);
    rm.addEventListener("click", () => save(Object.assign({}, settings, { excluded: settings.excluded.filter(x => x !== p) }), `Removed ${p}`));
    li.append(name, rm);
    list.append(li);
  }
}

$("enabled").addEventListener("change", e => save(Object.assign({}, settings, { enabled: e.target.checked })));
$("background").addEventListener("change", e => save(Object.assign({}, settings, { backgroundTabs: e.target.checked })));
$("debug").addEventListener("change", e => save(Object.assign({}, settings, { debug: e.target.checked })));
$("pause").addEventListener("change", e => save(Object.assign({}, settings, { pauseOnActivityMs: +e.target.value })));
$("speed").addEventListener("click", e => {
  const b = e.target.closest("button[data-speed]");
  if (b) save(Object.assign({}, settings, { speed: b.dataset.speed }));
});
$("addForm").addEventListener("submit", e => {
  e.preventDefault();
  const input = $("newSite"), err = $("addError");
  const p = C.normalizePattern(input.value);
  if (!p) { err.textContent = "That doesn't look like a site. Try example.com or *.example.com."; input.focus(); return; }
  if (settings.excluded.includes(p)) { err.textContent = `${p} is already excluded.`; return; }
  err.textContent = "";
  input.value = "";
  save(Object.assign({}, settings, { excluded: settings.excluded.concat(p) }), `Excluded ${p}`);
});
$("reset").addEventListener("click", () => save(C.DEFAULTS, "Defaults restored"));

ext.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) { settings = C.normalizeSettings(changes.settings.newValue); render(); }
});
ext.storage.local.get("settings").then(r => { settings = C.normalizeSettings(r && r.settings); render(); });
