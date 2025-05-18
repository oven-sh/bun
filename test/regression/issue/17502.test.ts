import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { tempDirWithFiles } from "harness";

test("--coverage-reporter automatically enables --coverage", () => {
  const dir = tempDirWithFiles("cov-reporter-auto-enables", {
    "demo.test.ts": `
    export function sum(a, b) {
      return a + b;
    }

    test("sum", () => {
      expect(sum(1, 2)).toBe(3);
    });
    `,
  });

  // Only specify --coverage-reporter without --coverage
  const result = Bun.spawnSync([bunExe(), "test", "--coverage-reporter", "text", "./demo.test.ts"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  // If coverage is enabled, we should see coverage output
  expect(result.stderr.toString("utf-8")).toContain("File");
  expect(result.stderr.toString("utf-8")).toContain("% Funcs");
  expect(result.stderr.toString("utf-8")).toContain("% Lines");
  expect(result.exitCode).toBe(0);
  expect(result.signalCode).toBeUndefined();
});
