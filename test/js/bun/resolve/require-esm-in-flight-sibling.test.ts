import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A CommonJS module imported by an ESM graph runs its body while the graph is
// still loading, so a require() in it can hit an ESM sibling whose transpile is
// still in flight on the transpiler thread. The CJS module here is named
// reflect-metadata because the runtime transpiles that package on the main
// thread (ALWAYS_SYNC_MODULES in src/runtime/jsc_hooks.rs): its body runs in the
// microtask checkpoint right after the graph's fetches are issued, before the
// thread pool can have delivered e.mjs, so the sibling is mid-fetch on every run.
test("require() of an ESM sibling the import graph is still fetching loads it synchronously", async () => {
  using dir = tempDir("require-esm-in-flight", {
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
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "e,polyfill:1,entry\n", stderr: "", exitCode: 0 });
});
