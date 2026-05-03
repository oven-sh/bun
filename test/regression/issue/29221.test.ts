// https://github.com/oven-sh/bun/issues/29221
// Also covers https://github.com/oven-sh/bun/issues/20489
// and         https://github.com/oven-sh/bun/issues/22367
//
// Dynamic `import()` of a module with top-level await must not resolve its
// promise before the module finishes evaluating. Repeated `import()` calls
// for the same module share one evaluation — every `.then()` handler fires
// AFTER the module's TLA settles, matching Node.js / Deno.
//
// Bug was in JSC's ModuleLoader.js builtin (`requestImportModule` /
// `moduleEvaluation`): `entry.evaluated` was set synchronously at the start
// of async evaluation, so a second `import()` in the same tick took a fast
// path that returned the namespace without awaiting the pending TLA. The
// visible symptoms were (a) `.then()` handlers firing in reversed order
// (#29221) and (b) concurrent importers observing uninitialized bindings
// ("Cannot access 'x' before initialization" — #20489, #22367).

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.concurrent("dynamic import waits for top-level await to settle (#29221)", async () => {
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
    cmd: [bunExe(), "entry.mjs"],
    cwd: String(dir),
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
  expect(stdout.trim()).toBe(`["tla-start","tla-end","then-a","then-b"]`);
  expect(exitCode).toBe(0);
});

test.concurrent(
  "concurrent dynamic imports of a TLA module all see initialized bindings (#20489, #22367)",
  async () => {
    // Mirrors the reproduction from #20489: five concurrent `import()` calls
    // for the same TLA module. Pre-fix, imports 2..5 took the fast path,
    // resolved early, and saw the module's named exports still in the TDZ
    // ("Cannot access 'x' before initialization"). After the fix, every
    // import waits for the same in-flight evaluation and observes fully
    // initialized bindings.
    using dir = tempDir("issue-29221-concurrent", {
      "entry.mjs": `
const results = [];
async function load(i) {
  const mod = await import("./tla-exports.mjs");
  // Touching both exports would throw TDZ pre-fix. Read them eagerly.
  results.push([i, mod.arr.length, typeof mod.fn]);
}
await Promise.all([load(1), load(2), load(3), load(4), load(5)]);
// Sort by import index so the assertion doesn't depend on resolution order.
results.sort((a, b) => a[0] - b[0]);
console.log(JSON.stringify(results));
`,
      "tla-exports.mjs": `
// Yield across a microtask boundary so all five imports start before
// this module's bindings are initialized.
await new Promise((r) => setTimeout(r, 20));
export const arr = [1, 2, 3];
export function fn() { return "ok"; }
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe(
      `[[1,3,"function"],[2,3,"function"],[3,3,"function"],[4,3,"function"],[5,3,"function"]]`,
    );
    // Failure mode for #20489/#22367 is a TDZ error on the child; assert
    // explicitly that no uninitialized-binding error reached stderr in
    // addition to the exitCode check below.
    expect(stderr).not.toContain("before initialization");
    expect(exitCode).toBe(0);
  },
);
