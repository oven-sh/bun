import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Coverage for oven-sh/WebKit#649. DFG and FTL inlined the host call thunk into
// the caller's own machine code for a direct call to a host function, a tail
// call included. A tail call destroys the caller's frame, so while the host
// function runs nothing on the stack refers to the caller's CodeBlock and the
// conservative stack scan cannot keep its code alive. A collection inside the
// host function then freed the code that the host call returns into.
//
// `hot()` tail-calls `Bun.inspect`, which runs the inspect hook. The first read
// of `Bun.gc` inside the hook materializes a lazy property on the `Bun` object.
// That structure transition jettisons `hot`, the collection frees its code, and
// the JIT churn reuses the memory. `Bun.inspect` then returns into it.
//
// The child runs with BUN_JSC_zeroExecutableMemoryOnFree, which fills freed JIT
// code with zeroes. Without it the outcome depends on whether a dead stack slot
// still holds the caller's CodeBlock pointer, which varies by build.
test("a collection inside an inspect hook keeps the code of a hot Bun.inspect caller", async () => {
  using dir = tempDir("gc-inside-inspect-hook", {
    "hot-inspect-fixture.js": String.raw`
        "use strict";
        const util = require("util");
        let armed = false;
        function deep(n) { if (n <= 0) return 0; const a = deep(n - 1); return a + 1; }
        function churn() {
          for (let k = 0; k < 10; k++) {
            const f = new Function("a", "let s = 0; for (let i = 0; i < a; i++) s += i ^ " + k + "; return s;");
            for (let j = 0; j < 3; j++) f(200);
          }
        }
        const obj = {
          [util.inspect.custom]() {
            if (armed) {
              deep(150);     // overwrite the dead stack below the host call frame
              Bun.gc(true);  // jettison hot() and free its code
              churn();       // let new JIT code reuse that memory
            }
            return "x";
          },
        };
        function hot(v) { return Bun.inspect(v); }
        for (let i = 0; i < 200; i++) hot(obj);
        armed = true;
        console.log("result", hot(obj));
      `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "hot-inspect-fixture.js"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      // Reach the DFG and the FTL in a few hundred calls, on this thread.
      BUN_JSC_thresholdForJITAfterWarmUp: "1",
      BUN_JSC_thresholdForOptimizeAfterWarmUp: "20",
      BUN_JSC_thresholdForFTLOptimizeAfterWarmUp: "100",
      BUN_JSC_useConcurrentJIT: "false",
      BUN_JSC_zeroExecutableMemoryOnFree: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("result x\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
}, 60_000);
