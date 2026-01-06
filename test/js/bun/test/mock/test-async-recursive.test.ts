import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("debug: async factory with recursive import (no helper)", async () => {
  using dir = tempDir("test-async-recursive", {
    "calculator.ts": `
      export function add(a, b) {
        return a + b;
      }
      export function multiply(a, b) {
        return a * b;
      }
    `,
    "mock.test.ts": `
      import { test, expect, mock } from "bun:test";

      test("recursive import", async () => {
        console.log("[TEST] Setting up mock");

        mock.module("./calculator.ts", async () => {
          console.log("[TEST] Factory executing, importing same module");
          const original = await import("./calculator.ts");
          console.log("[TEST] Original imported:", original);
          console.log("[TEST] Original.add:", original.add);
          console.log("[TEST] Creating mock");
          return {
            ...original,
            add: () => 999,
          };
        });

        console.log("[TEST] Importing mocked module");
        const calc = await import("./calculator.ts");
        console.log("[TEST] Mocked module imported:", calc);
        console.log("[TEST] calc.add:", calc.add);
        console.log("[TEST] calc.add(2, 3) result:", calc.add(2, 3));
        console.log("[TEST] calc.multiply(2, 3) result:", calc.multiply(2, 3));

        expect(calc.add(2, 3)).toBe(999);
        expect(calc.multiply(2, 3)).toBe(6);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "mock.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  console.log("STDOUT:", stdout);
  console.log("STDERR:", stderr);
  console.log("EXIT CODE:", exitCode);

  expect(exitCode).toBe(0);
});
