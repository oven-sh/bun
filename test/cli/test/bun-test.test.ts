import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { spawnSync } from "bun";
import { describe, test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";

describe("bun test", () => {
  test("can provide no arguments", () => {
    const stderr = runTest({
      args: [],
      input: [
        `
          import { test, expect } from "bun:test";
          test("test #1", () => {
            expect(true).toBe(true);
          });
        `,
        `
          import { test, expect } from "bun:test";
          test.todo("test #2");
        `,
        `
          import { test, expect } from "bun:test";
          test("test #3", () => {
            expect(true).toBe(false);
          });
        `,
      ],
    });
    expect(stderr).toContain("test #1");
    expect(stderr).toContain("test #2");
    expect(stderr).toContain("test #3");
  });
  test("can provide a relative file", () => {
    const path = join("path", "to", "relative.test.ts");
    const cwd = createTest(
      `
      import { test, expect } from "bun:test";
      test("${path}", () => {
        expect(true).toBe(true);
      });
    `,
      path,
    );
    const stderr = runTest({
      cwd,
      args: [path],
    });
    expect(stderr).toContain(path);
  });
  // This fails on macOS because /private/var symlinks to /var
  test.todo("can provide an absolute file", () => {
    const path = join("path", "to", "absolute.test.ts");
    const cwd = createTest(
      `
      import { test, expect } from "bun:test";
      test("${path}", () => {
        expect(true).toBe(true);
      });
    `,
      path,
    );
    const absolutePath = resolve(cwd, path);
    const stderr = runTest({
      cwd,
      args: [absolutePath],
    });
    expect(stderr).toContain(path);
  });
  test("can provide a relative path to a directory", () => {
    const path = join("path", "to", "relative.test.ts");
    const dir = dirname(path);
    const cwd = createTest(
      `
      import { test, expect } from "bun:test";
      test("${dir}", () => {
        expect(true).toBe(true);
      });
    `,
      path,
    );
    const stderr = runTest({
      cwd,
      args: [dir],
    });
    expect(stderr).toContain(dir);
  });
  test.todo("can provide an absolute path to a directory", () => {
    const path = join("path", "to", "absolute.test.ts");
    const cwd = createTest(
      `
      import { test, expect } from "bun:test";
      test("${path}", () => {
        expect(true).toBe(true);
      });
    `,
      path,
    );
    const absoluteDir = resolve(cwd, dirname(path));
    const stderr = runTest({
      cwd,
      args: [absoluteDir],
    });
    expect(stderr).toContain(path);
  });
  test.todo("can provide a mixture of paths");
  describe("--rerun-each", () => {
    test.todo("can rerun with a default value");
    test.todo("can rerun with a provided value");
  });
  describe("--run-todo", () => {
    test("should not run todo by default", () => {
      const stderr = runTest({
        input: `
          import { test, expect } from "bun:test";
          test.todo("todo", async () => {
            console.error("should not run");
          });
        `,
      });
      expect(stderr).not.toContain("should not run");
    });
    test("should run todo when enabled", () => {
      const stderr = runTest({
        args: ["--run-todo"],
        input: `
          import { test, expect } from "bun:test";
          test.todo("todo", async () => {
            console.error("should run");
          });
        `,
      });
      expect(stderr).toContain("should run");
    });
  });
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
  describe("support for Github Actions", () => {
    test("should not group logs by default", () => {
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
    test("should not annotate errors by default", () => {
      const stderr = runTest({
        input: `
          import { test, expect } from "bun:test";
          test("fail", () => {
            expect(true).toBe(false);
          });
        `,
        env: {
          GITHUB_ACTIONS: undefined,
        },
      });
      expect(stderr).not.toContain("::error");
    });
    test("should annotate errors when enabled", () => {
      const stderr = runTest({
        input: `
          import { test, expect } from "bun:test";
          test("fail", () => {
            throw new Error();
          });
        `,
        env: {
          GITHUB_ACTIONS: "true",
        },
      });
      expect(stderr).toMatch(/::error file=.*,line=\d+,col=\d+::error/);
    });
    test("should annotate errors with escaped strings", () => {
      const stderr = runTest({
        input: `
          import { test, expect } from "bun:test";
          test("fail", () => {
            expect(true).toBe(false);
          });
        `,
        env: {
          FORCE_COLOR: "1",
          GITHUB_ACTIONS: "true",
        },
      });
      expect(stderr).toMatch(/::error file=.*,line=\d+,col=\d+::error/);
      expect(stderr).toMatch(/error: expect\(received\)\.toBe\(expected\)/); // stripped ansi
      expect(stderr).toMatch(/0AExpected: false%0AReceived: true%0A/); // escaped newlines
    });
  });
});

function createTest(input?: string | string[], filename?: string): string {
  const cwd = mkdtempSync(join(tmpdir(), "bun-test-"));
  const inputs = Array.isArray(input) ? input : [input ?? ""];
  for (const input of inputs) {
    const path = join(cwd, filename ?? `bun-test-${Math.random()}.test.ts`);
    try {
      writeFileSync(path, input);
    } catch {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, input);
    }
  }
  return cwd;
}

function runTest({
  input = "",
  cwd,
  args = [],
  env = {},
}: {
  input?: string | string[];
  cwd?: string;
  args?: string[];
  env?: Record<string, string>;
} = {}): string {
  cwd ??= createTest(input);
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
