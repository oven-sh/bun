import value from "./hot-plugin-loader.object.graphql";

globalThis.pluginReloadCounter ??= 0;

// See hot-runner.js for why console.write is used instead of console.log.
console.write(`[${Date.now()}] [#!plugin] Reloaded: ${++globalThis.pluginReloadCounter} value=${value}\n`);
!setTimeout(() => {}, 9999999);
