process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const asyncLocalStorage = new AsyncLocalStorage();

// Note: crypto.randomUUID is synchronous in Node.js
// Testing if async wrapper maintains context
asyncLocalStorage.run({ test: "crypto.randomUUID" }, () => {
  setImmediate(() => {
    const uuid = crypto.randomUUID();
    if (asyncLocalStorage.getStore()?.test !== "crypto.randomUUID") {
      console.error("FAIL: crypto.randomUUID async wrapper lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
