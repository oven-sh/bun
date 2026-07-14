process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { readFile } = require("fs/promises");
const { tmpdir } = require("os");
const { join } = require("path");

const asyncLocalStorage = new AsyncLocalStorage();

// An async function that fails after its first `await` settles its promise from
// a resumed microtask, long after the caller's frame is gone. The rejection-time
// context is still the async function's own, so Node agrees regardless of version.
const expected = {
  "await-throw": "await-throw",
  "await-native-reject": "await-native-reject",
  "escaped-async-fn": "escaped-async-fn",
  "asyncgen-await-throw": "asyncgen-await-throw",
  "asyncgen-for-await": "asyncgen-for-await",
  "finally-throw": "finally-throw",
  "finally-returns-rejected": "finally-returns-rejected",
};
const observed = {};
let remaining = Object.keys(expected).length;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const keyFor = reason => (reason && reason.code === "ENOENT" ? "await-native-reject" : reason.message);

process.on("unhandledRejection", reason => {
  observed[keyFor(reason)] = asyncLocalStorage.getStore()?.test ?? null;
  remaining--;
});

asyncLocalStorage.run({ test: "await-throw" }, async () => {
  await sleep(5);
  throw new Error("await-throw");
});

// Same, but the rejection originates in a native promise the function awaits.
asyncLocalStorage.run({ test: "await-native-reject" }, async () => {
  await readFile(join(tmpdir(), `async-context-missing-file-${process.pid}`));
});

const failsAfterAwait = async () => {
  await sleep(1);
  throw new Error("escaped-async-fn");
};
asyncLocalStorage.run({ test: "escaped-async-fn" }, () => failsAfterAwait());

// Each AsyncGenerator* microtask installs the async context before driving the
// generator body, so a throw after an await reports its rejection with the
// generator's context.
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

// A .finally() callback that throws rejects inside PromiseFinallyReactionJob
// (phase 1), with the context installed.
asyncLocalStorage.run({ test: "finally-throw" }, () => {
  Promise.resolve().finally(() => {
    throw new Error("finally-throw");
  });
});

// A .finally() callback that *returns* a rejected thenable settles later from
// PromiseFinallyAwaitJob (phase 2), which must carry the context across.
asyncLocalStorage.run({ test: "finally-returns-rejected" }, () => {
  Promise.resolve().finally(() => Promise.reject(new Error("finally-returns-rejected")));
});

let polls = 0;
(function probe() {
  if (++polls > 10000) {
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
