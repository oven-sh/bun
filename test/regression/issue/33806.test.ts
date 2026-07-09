import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/33806
// AsyncLocalStorage.getStore() returned undefined inside promise .then()
// continuations once the calling function tiered up to the DFG JIT: the
// PerformPromiseThenOneHandler fast path stored the reaction inline without
// capturing the async context. Settled promises take the slow path, so each
// handler must attach while the promise is still pending to hit the bug.
test("AsyncLocalStorage store survives .then() continuations after JIT tier-up", async () => {
  const script = `
    const { AsyncLocalStorage } = require("node:async_hooks");
    const als = new AsyncLocalStorage();

    function thenChain() {
      let p = Promise.resolve();
      for (let i = 0; i < 3; i++) p = p.then(() => {});
      return p.then(() => als.getStore());
    }

    function catchChain() {
      const { promise, reject } = Promise.withResolvers();
      const out = promise.catch(() => als.getStore());
      reject(new Error("boom"));
      return out;
    }

    async function main() {
      let badThen = 0;
      let badCatch = 0;
      for (let i = 0; i < 400; i++) {
        const store = { v: i };
        if ((await als.run(store, thenChain)) !== store) badThen++;
        if ((await als.run(store, catchChain)) !== store) badCatch++;
      }
      console.log(JSON.stringify({ badThen, badCatch }));
    }
    main();
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    // Lowered DFG threshold keeps the loop count (and test runtime) small.
    env: { ...bunEnv, BUN_JSC_thresholdForOptimizeAfterWarmUp: "100" },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Surface stderr in the failure diff if the child crashed, without requiring
  // it to be empty on success (debug/ASAN builds may emit benign warnings).
  expect({ stdout: stdout.trim(), stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ badThen: 0, badCatch: 0 }),
    stderr: "",
    exitCode: 0,
  });
});
