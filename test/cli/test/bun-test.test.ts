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
        input: `
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
        input: `
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
  describe("GITHUB_ACTIONS", () => {
    test("should not group logs when unset", () => {
      const stderr = runTest({
        env: {
          GITHUB_ACTIONS: undefined,
        },
      });
      expect(stderr).not.toContain("::group::");
      expect(stderr).not.toContain("::endgroup::");
    });
    test("should not group logs when disabled", () => {
      const stderr = runTest({
        env: {
          GITHUB_ACTIONS: "false",
        },
      });
      expect(stderr).not.toContain("::group::");
      expect(stderr).not.toContain("::endgroup::");
    });
    test("should group logs when enabled", () => {
      const stderr = runTest({
        env: {
          GITHUB_ACTIONS: "true",
        },
      });
      expect(stderr).toContain("::group::");
      expect(stderr.match(/::group::/g)).toHaveLength(1);
      expect(stderr).toContain("::endgroup::");
      expect(stderr.match(/::endgroup::/g)).toHaveLength(1);
    });
    test("should group logs with multiple files", () => {
      const stderr = runTest({
        input: [
          `
            import { test, expect } from "bun:test";
            test("pass", () => {
              expect(true).toBe(true);
            });
          `,
          `
            import { test, expect } from "bun:test";
            test.skip("skip", () => {});
          `,
          `
            import { test, expect } from "bun:test";
            test("fail", () => {
              expect(true).toBe(false);
            });
          `,
        ],
        env: {
          GITHUB_ACTIONS: "true",
        },
      });
      expect(stderr).toContain("::group::");
      expect(stderr.match(/::group::/g)).toHaveLength(3);
      expect(stderr).toContain("::endgroup::");
      expect(stderr.match(/::endgroup::/g)).toHaveLength(3);
    });
    test("should group logs with --rerun-each", () => {
      const stderr = runTest({
        args: ["--rerun-each", "3"],
        input: [
          `
            import { test, expect } from "bun:test";
            test("pass", () => {
              expect(true).toBe(true);
            });
          `,
          `
            import { test, expect } from "bun:test";
            test("fail", () => {
              expect(true).toBe(false);
            });
          `,
        ],
        env: {
          GITHUB_ACTIONS: "true",
        },
      });
      expect(stderr).toContain("::group::");
      expect(stderr.match(/::group::/g)).toHaveLength(6);
      expect(stderr).toContain("::endgroup::");
      expect(stderr.match(/::endgroup::/g)).toHaveLength(6);
    });
  });
});

function runTest({
  input = "",
  args = [],
  env = {},
}: {
  input?: string | string[];
  args?: string[];
  env?: Record<string, string>;
} = {}): string {
  const cwd = mkdtempSync(join(tmpdir(), "bun-test-"));
  const inputs = Array.isArray(input) ? input : [input];
  for (const input of inputs) {
    const path = join(cwd, `bun-test-${Math.random()}.test.ts`);
    writeFileSync(path, input);
  }
  try {
    const { stderr } = spawnSync({
      cwd,
      cmd: [bunExe(), "test", ...args],
      env: { ...bunEnv, ...env },
      stderr: "pipe",
      stdout: "ignore",
    });
    return stderr.toString();
  } finally {
    rmSync(cwd, { recursive: true });
  }
}
