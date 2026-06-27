process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();

// The internal timer behind AbortSignal.timeout() does not keep the event
// loop alive, in Node or in Bun.
const keepAlive = setInterval(() => {}, 50);

asyncLocalStorage.run({ test: "AbortSignal.timeout" }, () => {
  AbortSignal.timeout(1).addEventListener("abort", () => {
    clearInterval(keepAlive);
    if (asyncLocalStorage.getStore()?.test !== "AbortSignal.timeout") {
      console.error("FAIL: AbortSignal.timeout abort listener lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
