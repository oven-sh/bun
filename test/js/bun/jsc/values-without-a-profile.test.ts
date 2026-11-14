import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Each program compiles a function in which one read never ran, then runs the read. The value
// joins a double: in a variable, in the result of a conditional, or in an array literal.
const programs = {
  "a property by a variable key": `
    function f(o, k, c, d) { let x = d * 0.5; if (c) x = o[k]; x * 1.5; return typeof x + " " + x; }
    const o = { p: 1 };
    for (let i = 0; i < 3000; i++) f(o, "p", false, i + 0.5);
    const read = value => f({ p: value }, "p", true, 1.5);`,
  "a property by a variable key in a template": `
    function f(o, k, c, d) { let x = d * 0.5; if (c) x = o[k]; return \`\${typeof x} \${x}\`; }
    const o = { p: 1 };
    for (let i = 0; i < 3000; i++) f(o, "p", false, i + 0.5);
    const read = value => f({ p: value }, "p", true, 1.5);`,
  "a private field": `
    class C { #p; constructor(p) { this.#p = p; } f(c, d) { let x = d * 0.5; if (c) x = this.#p; x * 1.5; return typeof x + " " + x; } }
    const o = new C(1);
    for (let i = 0; i < 3000; i++) o.f(false, i + 0.5);
    const read = value => new C(value).f(true, 1.5);`,
  "a private field in an array literal": `
    class C { #p; constructor(p) { this.#p = p; } f(c, d) { if (c) return [d * 0.5, this.#p]; } }
    const o = new C(1);
    for (let i = 0; i < 3000; i++) o.f(false, i + 0.5);
    const read = value => { const x = new C(value).f(true, 1.5)[1]; return typeof x + " " + x; };`,
  "an element of an arguments object": `
    const list = new Function("return arguments");
    function f(a, c, d) { let x = d * 0.5; if (c) x = a[0]; x * 1.5; return typeof x + " " + x; }
    const o = list(1);
    for (let i = 0; i < 3000; i++) f(o, false, i + 0.5);
    const read = value => f(list(value), true, 1.5);`,
  "a conditional": `
    function scale(o, k) { return { value: typeof o[k] === "number" ? o[k] * 10 : o[k] }; }
    for (let i = 0; i < 3000; i++) for (const k of ["a", "b", "c"]) scale({ a: i + 0.5, b: 1.25, c: i % 7 }, k);
    const read = value => { const x = scale({ a: value }, "a").value; return typeof x + " " + x; };`,
};

describe.each(["DFG", "FTL"])("%s", tier => {
  for (const [name, source] of Object.entries(programs)) {
    test.concurrent(name, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", source + `console.log([null, undefined, true, false, "text"].map(read).join());`],
        env: {
          ...bunEnv,
          BUN_JSC_useConcurrentJIT: "0",
          BUN_JSC_useFTLJIT: tier === "FTL" ? "1" : "0",
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
      expect(stdout).toBe("object null,undefined undefined,boolean true,boolean false,string text\n");
      expect(exitCode).toBe(0);
    });
  }
});
