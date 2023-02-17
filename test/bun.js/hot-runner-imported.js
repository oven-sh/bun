globalThis.importedCounter ??= 0;

console.log(`[${Date.now()}] [#!imported] Reloaded: ${++globalThis.importedCounter}`);
