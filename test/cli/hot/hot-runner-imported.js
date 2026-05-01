globalThis.importedCounter ??= 0;

// See hot-runner.js for explanation of console.write vs console.log
console.write(`[${Date.now()}] [#!imported] Reloaded: ${++globalThis.importedCounter}\n`);
