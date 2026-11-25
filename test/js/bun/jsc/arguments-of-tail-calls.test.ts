import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The FTL compiles each tail call to a jump. An OSR exit after the jump creates the arguments object,
// which holds the arguments of the last call. Code that -e runs is strict if it is a module.
const body = `if (n === 0) { const x = arguments; return x.length + ":" + x[0] + ":" + x[1] + ":" + x[2]; }`;
const calls = "for (let i = 0; i < 9000; i++) results.add(f(i % 2, 1, 2, 3));";
const callResults = "4:0:1:2 2:0:9:undefined";

const programs: Record<string, [source: string, output: string]> = {
  "a direct call": [`function f(n, a, b) { ${body} return f(0, 9); } ${calls}`, callResults],
  "a bound function": [`function f(n, a, b) { ${body} return g(0, 9); } const g = f.bind(null); ${calls}`, callResults],
  "a bound function with an argument": [
    `function f(n, a, b) { ${body} return g(9); } const g = f.bind(null, 0); ${calls}`,
    callResults,
  ],
  "a bound Function.prototype.call": [
    `function f(n, a, b) { ${body} return g(null, 0, 9); } const g = Function.prototype.call.bind(f); ${calls}`,
    callResults,
  ],
  "a caught exception": [
    `function f(n, a, b) {
       if (n === 0) {
         const x = arguments;
         try { if (a > 100) throw 1; return "none"; } catch { return x.length + ":" + x[0] + ":" + x[1] + ":" + x[2]; }
       }
       return f(0, a, 5);
     }
     for (let i = 0; i < 9000; i++) results.add(f(1, i > 6000 && i % 61 === 60 ? 2147483647 : 9, 2));`,
    "none 3:0:2147483647:5",
  ],
  "an index past the end": [
    `const rest = { first: 0, second: 0 };
     function f(n, a, b, i) { if (n === 0) { rest.first = arguments[i]; rest.second = arguments[1]; return 0; } return f(n - 1, a + 10, b + 10, i); }
     for (let i = 0; i < 9000; i++) f(2, 1, 2, 2);
     for (let i = 0; i < 20; i++) { f(2, 1, 2, i & 1 ? -1 : 7); results.add(rest.first + ":" + rest.second); }`,
    "undefined:21",
  ],
  "an inlined apply with another callee": [
    `function first(p, q, s) { return arguments.length + ":" + p + ":" + q + ":" + s; }
     function second(p, q, s) { return arguments.length + ":" + p + ":" + q + ":" + s; }
     function f(n, a, b, callee) { if (n === 0) return callee.apply(null, arguments) + ""; return f(n - 1, a + 10, b + 10, callee); }
     for (let i = 0; i < 9000; i++) f(2, 1, 2, first);
     results.add(f(2, 1, 2, second)).add(f(2, 5, 6, second));`,
    "4:0:21:22 4:0:25:26",
  ],
  "a spread on a path that never ran": [
    `const empty = { never: 1 };
     function f(n, a, b, c) {
       if (n === 0) { if (c) { empty.never; const copy = [...arguments]; return copy.join(); } return 0; }
       return f(n - 1, a + 10, b + 10, c);
     }
     for (let i = 0; i < 9000; i++) f(2, 1, 2, false);
     results.add(f(2, 1, 2, true)).add(f(2, 3, 4, true));`,
    "0,21,22,true 0,23,24,true",
  ],
};

for (const [name, [source, output]] of Object.entries(programs)) {
  test.concurrent(name, async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `export {}; const results = new Set(); ${source} console.log([...results].join(" "));`],
      env: {
        ...bunEnv,
        BUN_JSC_useConcurrentJIT: "0",
        BUN_JSC_thresholdForJITAfterWarmUp: "20",
        BUN_JSC_thresholdForJITSoon: "20",
        BUN_JSC_thresholdForOptimizeAfterWarmUp: "100",
        BUN_JSC_thresholdForOptimizeSoon: "100",
        BUN_JSC_thresholdForFTLOptimizeAfterWarmUp: "400",
        BUN_JSC_thresholdForFTLOptimizeSoon: "400",
      },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe(output + "\n");
    expect(exitCode).toBe(0);
  });
}
