import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("debug: async factory with pending Promise", async () => {
  using dir = tempDir("test-async-pending", {
    "module.ts": `
      export function getValue() {
        return 42;
      }
    `,
    "mock.test.ts": `
      import { test, expect, mock } from "bun:test";

      test("async factory with delay", async () => {
        console.log("[TEST] Setting up mock");

        mock.module("./module.ts", async () => {
          console.log("[TEST] Factory executing, will wait");
          // Force Promise to be pending by using setTimeout
          await new Promise(resolve => setTimeout(resolve, 10));
          console.log("[TEST] Factory done waiting");
          return {
            getValue: () => 999
          };
        });

        console.log("[TEST] Importing module");
        const mod = await import("./module.ts");
        console.log("[TEST] Module imported:", mod);
        console.log("[TEST] getValue result:", mod.getValue());

        expect(mod.getValue()).toBe(999);
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
