import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent.each(["0", "1"])(
  "replace and replaceAll name the method that refuses null, useFTLJIT=%s",
  async useFTLJIT => {
    const source = `
    function replace(x, pattern) { return String.prototype.replace.call(x, pattern, "q"); }
    function replaceAll(x, pattern) { return String.prototype.replaceAll.call(x, pattern, "q"); }
    for (const f of [replace, replaceAll]) {
      for (const pattern of ["a", /a/g]) {
        const g = new Function("f", "return " + f)(f);
        for (const value of [null, undefined]) {
          const messages = new Set();
          for (let i = 0; i < 6000; i++) {
            g("abc", pattern);
            if (i % 4 === 0) try { g(value, pattern); } catch (e) { messages.add(e.name + ": " + e.message); }
          }
          console.log([...messages].join(" | "));
        }
      }
    }`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: {
        ...bunEnv,
        BUN_JSC_useConcurrentJIT: "0",
        BUN_JSC_useFTLJIT: useFTLJIT,
        BUN_JSC_thresholdForFTLOptimizeAfterWarmUp: "1000",
      },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const replace = "TypeError: String.prototype.replace requires that |this| not be null or undefined";
    const replaceAll = "TypeError: String.prototype.replaceAll requires |this| not to be null nor undefined";
    expect(stdout.trim().split("\n")).toEqual([...Array(4).fill(replace), ...Array(4).fill(replaceAll)]);
    expect(exitCode).toBe(0);
  },
);
