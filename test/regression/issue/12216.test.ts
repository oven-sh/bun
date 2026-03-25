import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("--coverage CLI flag overrides bunfig.toml coverage = false", async () => {
  using dir = tempDir("issue-12216", {
    "bunfig.toml": `[test]\ncoverage = false`,
    "helper.ts": `export function add(a: number, b: number) { return a + b; }\nexport function sub(a: number, b: number) { return a - b; }`,
    "test.test.ts": `import { test, expect } from "bun:test";\nimport { add } from "./helper";\ntest("add", () => { expect(add(1,2)).toBe(3); });`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Coverage table is printed to stderr
  expect(stderr).toContain("% Funcs");
  expect(stderr).toContain("helper.ts");
  expect(exitCode).toBe(0);
});
