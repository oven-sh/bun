import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A CommonJS module imported by an ESM graph runs its body while the graph is
// still loading, so a require() in it can hit an ESM sibling whose transpile is
// still in flight on the transpiler thread. The CJS module here is named
// reflect-metadata because the runtime transpiles that package on the main
// thread (ALWAYS_SYNC_MODULES in src/runtime/jsc_hooks.rs): its body runs in the
// microtask checkpoint right after the graph's fetches are issued, before the
// thread pool can have delivered e.mjs, so the sibling is mid-fetch on every run.
const inFlightSibling = {
  "entry.mjs": `
    import "./e.mjs";
    import "reflect-metadata";
    console.log(globalThis.order.concat("entry").join(","));
  `,
  "e.mjs": `
    (globalThis.order ??= []).push("e");
    export const e = 1;
  `,
  "node_modules/reflect-metadata/package.json": JSON.stringify({ name: "reflect-metadata", main: "index.js" }),
  "node_modules/reflect-metadata/index.js": `
    const { e } = require("../../e.mjs");
    (globalThis.order ??= []).push("polyfill:" + e);
  `,
};

test.concurrent("require() of an ESM sibling the import graph is still fetching loads it synchronously", async () => {
  using dir = tempDir("require-esm-in-flight", inFlightSibling);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "e,polyfill:1,entry\n", stderr: "", exitCode: 0 });
});

// With the transpiler thread disabled the graph's fetches settle on the spot,
// so when the require() lands the sibling's entry is still Fetching but its
// fetch promise is already settled and only the reaction that builds the module
// is still queued. That is the one state the require() path must leave alone.
test.concurrent("require() of a sibling whose fetch has settled but not been processed yet", async () => {
  using dir = tempDir("require-esm-settled-sibling", inFlightSibling);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" },
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "e,polyfill:1,entry\n", stderr: "", exitCode: 0 });
});

// An import with a type attribute gets its own registry entry, keyed by that
// type, and is transpiled with that loader. A require() of the same file is a
// plain JavaScript-typed load and must not hand its default-loader output to
// the typed entry that happens to be in flight. `a < b > (c)` is a generic call
// under the ts loader and two comparisons under the default loader for a .js
// file, so each consumer reveals which transpile it received.
test.concurrent("require() racing a typed import of the same file does not overwrite the typed import", async () => {
  using dir = tempDir("require-esm-typed-sibling", {
    "entry.mjs": `
      import { y } from "./mod.js" with { type: "ts" };
      import "reflect-metadata";
      console.log(JSON.stringify({ typedImport: y, require: globalThis.required, evaluations: globalThis.evaluations }));
    `,
    "mod.js": `
      globalThis.evaluations = (globalThis.evaluations ?? 0) + 1;
      const a = value => "called(" + value + ")";
      const b = 1;
      const c = 3;
      export const y = a < b > (c);
    `,
    "node_modules/reflect-metadata/package.json": JSON.stringify({ name: "reflect-metadata", main: "index.js" }),
    "node_modules/reflect-metadata/index.js": `
      globalThis.required = require("../../mod.js").y;
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ typedImport: "called(3)", require: false, evaluations: 2 }) + "\n",
    stderr: "",
    exitCode: 0,
  });
});
