import "./hot-runner-imported";

globalThis.counter ??= 0;

console.log(`[${Date.now()}] [#!root] Reloaded: ${++globalThis.counter}`);
!setTimeout(() => {}, 9999999);
