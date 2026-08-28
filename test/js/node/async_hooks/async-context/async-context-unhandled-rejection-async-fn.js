process.exitCode = 1;
// Runs under node as well as bun (see AsyncLocalStorage-tracking.test.ts), so
// this stays a plain CommonJS script.
const { AsyncLocalStorage } = require("async_hooks");
const { readFile } = require("fs/promises");
const { tmpdir } = require("os");
const { join } = require("path");

const asyncLocalStorage = new AsyncLocalStorage();

// An async function (or generator, or .finally() callback) that fails after it
// has suspended settles its promise from a later microtask, after the frame that
// entered the store is gone. The rejection still belongs to that store, so Node
// agrees regardless of version.
const expected = {
  "await-throw": "await-throw",
  "await-native-reject": "await-native-reject",
  "escaped-async-fn": "escaped-async-fn",
  "asyncgen-await-throw": "asyncgen-await-throw",
  "asyncgen-for-await": "asyncgen-for-await",
  "finally-throw": "finally-throw",
};
const observed = {};
let remaining = Object.keys(expected).length;

const keyFor = reason => (reason && reason.code === "ENOENT" ? "await-native-reject" : reason.message);

process.on("unhandledRejection", reason => {
  const key = keyFor(reason);
  if (!(key in expected) || key in observed) {
    console.error(`FAIL: unexpected or duplicate unhandledRejection for ${JSON.stringify(key)}`);
    process.exit(1);
  }
  observed[key] = asyncLocalStorage.getStore()?.test ?? null;
  remaining--;
});

// Resumes from a macrotask, so the rejection happens in a later tick than the
// store was entered in, not merely a later microtask.
asyncLocalStorage.run({ test: "await-throw" }, async () => {
  await new Promise(resolve => setImmediate(resolve));
  throw new Error("await-throw");
});

// The rejection originates in a native promise the function awaits.
asyncLocalStorage.run({ test: "await-native-reject" }, async () => {
  await readFile(join(tmpdir(), `async-context-missing-file-${process.pid}`));
});

// The async function is defined outside any store and only called inside one.
const failsAfterAwait = async () => {
  await 0;
  throw new Error("escaped-async-fn");
};
asyncLocalStorage.run({ test: "escaped-async-fn" }, () => failsAfterAwait());

asyncLocalStorage.run({ test: "asyncgen-await-throw" }, () => {
  (async function* () {
    await 0;
    throw new Error("asyncgen-await-throw");
  })().next();
});

asyncLocalStorage.run({ test: "asyncgen-for-await" }, async () => {
  for await (const _ of (async function* () {
    await 0;
    throw new Error("asyncgen-for-await");
  })());
});

// Throwing from the callback rejects during .finally()'s first phase.
asyncLocalStorage.run({ test: "finally-throw" }, () => {
  Promise.resolve().finally(() => {
    throw new Error("finally-throw");
  });
});

const deadline = performance.now() + 30_000;
(function probe() {
  if (performance.now() > deadline) {
    console.error(`FAIL: timed out with ${remaining} rejection(s) never delivered`);
    process.exit(1);
  }
  if (remaining !== 0) {
    setImmediate(probe);
    return;
  }

  for (const key of Object.keys(expected)) {
    if (observed[key] !== expected[key]) {
      console.error(
        `FAIL: unhandledRejection for "${key}" observed store ${JSON.stringify(observed[key])}, expected ${JSON.stringify(expected[key])}`,
      );
      process.exit(1);
    }
  }
  process.exitCode = 0;
})();
