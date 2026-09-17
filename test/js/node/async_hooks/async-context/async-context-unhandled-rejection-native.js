process.exitCode = 1;
// Runs under node as well as bun (see AsyncLocalStorage-tracking.test.ts), so
// this stays a plain CommonJS script.
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();

// Promises that the runtime's native layer rejects from an event-loop task, not
// from JS: a fetch() to a port nothing listens on, and fs.promises.readFile of
// a missing path. Node rejects them with the resource's creation context
// installed (AsyncWrap::context_frame_), so the handler reads the store.
const expected = new Set(["fetch", "fsp.readFile"]);
const delivered = new Set();
process.on("unhandledRejection", (reason, promise) => {
  const test = promise[Symbol.for("test")];
  if (!expected.has(test) || delivered.has(test)) {
    console.error(`FAIL: unexpected or duplicate unhandledRejection: ${reason && reason.message}`);
    process.exit(1);
  }
  delivered.add(test);
  const store = asyncLocalStorage.getStore()?.test ?? null;
  if (store !== test) {
    console.error(`FAIL: observed store ${JSON.stringify(store)}, expected ${JSON.stringify(test)}`);
    process.exit(1);
  }
});

function tag(test, promise) {
  promise[Symbol.for("test")] = test;
}

asyncLocalStorage.run({ test: "fetch" }, () => {
  tag("fetch", fetch("http://127.0.0.1:1/"));
});
asyncLocalStorage.run({ test: "fsp.readFile" }, () => {
  tag("fsp.readFile", fs.promises.readFile(path.join(__dirname, "does-not-exist")));
});

const deadline = performance.now() + 30_000;
(function probe() {
  if (performance.now() > deadline) {
    console.error("FAIL: a rejection was never delivered");
    process.exit(1);
  }
  if (delivered.size < expected.size) {
    setImmediate(probe);
    return;
  }
  process.exitCode = 0;
})();
