// Loads src/background.js in Node with a minimal fake extension API, for its pure helpers.
const noop = () => {};
const ev = { addListener: noop };
globalThis.MouseVaderCore = require("../../src/core.js");
globalThis.browser = {
  browserAction: { setBadgeText: noop, setBadgeBackgroundColor: noop },
  runtime: { onMessage: ev, onInstalled: ev },
  tabs: { onRemoved: ev },
  commands: { onCommand: ev },
  storage: { local: { get: async () => ({}), set: async () => {} } },
};
module.exports = require("../../src/background.js");
