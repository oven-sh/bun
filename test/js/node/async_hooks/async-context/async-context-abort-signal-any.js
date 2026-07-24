process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();

// Neither runtime keeps the event loop alive for a pending AbortSignal.timeout().
const keepAlive = setInterval(() => {}, 50);

// AbortSignal.any([AbortSignal.timeout(ms), ...]) is the common
// "timeout-or-cancel" shape. Nothing references the inner timeout signal from
// JS afterwards, so its captured context must not depend on its JS wrapper
// (or on a direct abort listener, which it never gets) staying alive.
let combined;
asyncLocalStorage.run({ test: "AbortSignal.any" }, () => {
  combined = AbortSignal.any([AbortSignal.timeout(10)]);
});

combined.addEventListener("abort", () => {
  clearInterval(keepAlive);
  const store = asyncLocalStorage.getStore();
  if (store?.test !== "AbortSignal.any") {
    console.error("FAIL: AbortSignal.any abort listener lost the timeout's context, got", store);
    process.exit(1);
  }
  process.exit(0);
});

if (typeof Bun !== "undefined") {
  Bun.gc(true);
  Bun.gc(true);
  Bun.gc(true);
}
