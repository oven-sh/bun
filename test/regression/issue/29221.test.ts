// https://github.com/oven-sh/bun/issues/29221
//
// Dynamic `import()` of a module with top-level await must not resolve its
// promise before the module finishes evaluating. Repeated `import()` calls
// for the same module share one evaluation — both `.then()` handlers fire
// AFTER the module's TLA settles, matching Node.js / Deno.
//
// Bug was in JSC's ModuleLoader.js builtin (`requestImportModule` /
// `moduleEvaluation`): `entry.evaluated` was set synchronously at the start
// of async evaluation, so a second `import()` in the same tick took a fast
// path that returned the namespace without awaiting the pending TLA.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("dynamic import waits for top-level await to settle (#29221)", async () => {
  using dir = tempDir("issue-29221", {
    "entry.mjs": `
globalThis.order = [];
const a = import("./tla.mjs").then(() => globalThis.order.push("then-a"));
const b = import("./tla.mjs").then(() => globalThis.order.push("then-b"));
await Promise.all([a, b]);
console.log(JSON.stringify(globalThis.order));
`,
    "tla.mjs": `
globalThis.order.push("tla-start");
await new Promise((r) => setTimeout(r, 50));
globalThis.order.push("tla-end");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), String(dir) + "/entry.mjs"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Expected ordering: the TLA module runs to completion first (tla-start
  // then tla-end), then BOTH .then() handlers fire in import order.
  //
  // Pre-fix, Bun produced ["tla-start","then-b","then-a","tla-end"] — the
  // second import's `.then()` fired before the TLA even resumed, because
  // the JSC builtin's fast path returned the namespace without awaiting
  // the pending evaluation promise.
  expect({
    stdout: stdout.trim(),
    exitCode,
  }).toEqual({
    stdout: `["tla-start","tla-end","then-a","then-b"]`,
    exitCode: 0,
  });
});
