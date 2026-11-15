import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The functions have iterated over objects with iterators of their own, so the JIT calls the iterator method.
test.concurrent.each([
  ["for-of", "let count = 0; for (const value of x) count++; return count;", "0"],
  ["for-of", "let count = 0; for (const value of x) count++; return count;", "1"],
  ["array patterns", "const [a, b] = x; return a;", "0"],
  ["array patterns", "const [a, b] = x; return a;", "1"],
  ["Object.fromEntries", "return Object.fromEntries(x);", "0"],
  ["Object.fromEntries", "return Object.fromEntries(x);", "1"],
])("%s names what is not iterable (%s), useFTLJIT=%s", async (_, body, useFTLJIT) => {
  const source = `
    class Steps {
      constructor(count) { this.count = count; }
      [Symbol.iterator]() { return this; }
      next() { return { done: this.count-- <= 0, value: ["a", 1] }; }
    }
    const values = [5, true, Symbol("s"), 1n, {}, { [Symbol.iterator]: 5 }];
    for (const value of values) {
      const f = new Function("x", ${JSON.stringify(body)});
      const messages = new Set();
      for (let i = 0; i < 4000; i++) {
        f(new Steps(2));
        try { f(value); } catch (e) { messages.add(e.name + ": " + e.message); }
      }
      console.log([...messages].join(" | "));
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
  expect(stdout.trim().split("\n")).toEqual([
    "TypeError: number is not iterable",
    "TypeError: true is not iterable",
    "TypeError: value is not iterable",
    "TypeError: value is not iterable",
    "TypeError: {} is not iterable",
    "TypeError: {} is not iterable",
  ]);
  expect(exitCode).toBe(0);
});
