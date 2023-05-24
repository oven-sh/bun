import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "bun";
import { describe, test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";

describe("bun test", () => {
  describe("--timeout", () => {
    test("must provide a number timeout", () => {
      const stderr = runTest({
        args: ["--timeout", "foo"],
      });
      expect(stderr).toContain("Invalid timeout");
    });
    test("must provide non-negative timeout", () => {
      const stderr = runTest({
        args: ["--timeout", "-1"],
      });
      expect(stderr).toContain("Invalid timeout");
    });
    test("timeout can be set to 1ms", () => {
      const stderr = runTest({
        args: ["--timeout", "1"],
        code: `
          import { test, expect } from "bun:test";
          import { sleep } from "bun";
          test("timeout", async () => {
            await sleep(2);
          });
        `,
      });
      expect(stderr).toContain("timed out after 1ms");
    });
    test("timeout should default to 5000ms", () => {
      const stderr = runTest({
        code: `
          import { test, expect } from "bun:test";
          import { sleep } from "bun";
          test("timeout", async () => {
            await sleep(5001);
          });
        `,
      });
      expect(stderr).toContain("timed out after 5000ms");
    });
  });
});

function runTest({ code = "", args = [] }: { code?: string; args?: string[] }): string {
  const dir = mkdtempSync(join(tmpdir(), "bun-test-"));
  const path = join(dir, `bun-test-${Date.now()}.test.ts`);
  writeFileSync(path, code);
  try {
    const { stderr } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "test", path, ...args],
      env: bunEnv,
      stderr: "pipe",
      stdout: "ignore",
    });
    return stderr.toString();
  } finally {
    rmSync(path);
  }
}
