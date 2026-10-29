process.exitCode = 1;
const assert = require("assert");
const { AsyncLocalStorage } = require("async_hooks");

// The top-level code of a module that import() loads runs in the store of the import(). Each module of
// ./dynamic-import notes the store in which it runs.
const asyncLocalStorage = new AsyncLocalStorage();
const seen = {};
globalThis.see = label => {
  seen[label] = asyncLocalStorage.getStore()?.test;
};
const load = name => import("./dynamic-import/" + name + ".mjs");

(async () => {
  // A module, its static dependency, and an import() that its top-level code calls.
  await asyncLocalStorage.run({ test: "graph" }, () => load("graph"));
  await globalThis.nested;
  // A module with a top-level await, and the module that waits for it.
  await asyncLocalStorage.run({ test: "awaits" }, () => load("waits"));
  // Two import() calls in flight, each in a store of its own.
  await Promise.all([
    asyncLocalStorage.run({ test: "left" }, () => load("left")),
    asyncLocalStorage.run({ test: "right" }, () => load("right")),
  ]);
  // A module that throws, and the caller afterwards.
  const error = await asyncLocalStorage.run({ test: "throws" }, () =>
    load("throws").then(
      () => undefined,
      error => error,
    ),
  );
  assert.strictEqual(error?.message, "thrown by the module");
  see("after the import() that rejects");
  // An import() in no store, after the others.
  await load("without-store");

  assert.deepStrictEqual(seen, {
    "graph dependency": "graph",
    "graph": "graph",
    "nested": "graph",
    "awaits before its await": "awaits",
    "awaits behind its await": "awaits",
    "waits": "awaits",
    "left": "left",
    "right": "right",
    "throws": "throws",
    "after the import() that rejects": undefined,
    "without-store dependency": undefined,
    "without-store": undefined,
  });
  process.exit(0);
})().catch(error => {
  console.error("FAIL: a module that import() loads lost the context");
  console.error(error);
  process.exit(1);
});
