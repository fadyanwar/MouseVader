// MouseVader background: toolbar badge (fake events on this tab, or OFF) and the keyboard shortcut.
"use strict";
const C = globalThis.MouseVaderCore;
const ext = globalThis.browser || globalThis.chrome;
const action = ext.browserAction || ext.action;

const tabs = new Map();   // tabId -> { sent, state }

function badgeText(info) {
  if (!info) return "";
  if (info.state !== "on") return "off";
  const n = info.sent || 0;
  return n < 1000 ? String(n || "") : n < 10000 ? (n / 1000).toFixed(1) + "k" : Math.floor(n / 1000) + "k";
}

function paint(tabId) {
  const info = tabs.get(tabId);
  try {
    action.setBadgeText({ tabId, text: badgeText(info) });
    action.setBadgeBackgroundColor({ tabId, color: info && info.state !== "on" ? "#6b7280" : "#b91c1c" });
  } catch (_) { /* tab closed */ }
}

ext.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !sender.tab || sender.frameId) return undefined;
  if (msg.type === "events" || msg.type === "state") {
    tabs.set(sender.tab.id, { sent: msg.sent | 0, state: msg.state });
    paint(sender.tab.id);
  }
  return undefined;
});
ext.tabs.onRemoved.addListener(id => tabs.delete(id));

async function getSettings() {
  const r = await ext.storage.local.get("settings");
  return C.normalizeSettings(r && r.settings);
}

if (ext.commands) ext.commands.onCommand.addListener(async cmd => {
  if (cmd !== "toggle-mousevader") return;
  const s = await getSettings();
  await ext.storage.local.set({ settings: Object.assign(s, { enabled: !s.enabled }) });
});

ext.runtime.onInstalled.addListener(async () => {
  const r = await ext.storage.local.get("settings");
  await ext.storage.local.set({ settings: C.normalizeSettings(r && r.settings) });
});

if (typeof module === "object" && module.exports) module.exports = { badgeText };
