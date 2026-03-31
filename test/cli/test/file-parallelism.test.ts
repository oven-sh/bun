import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function createTestDir(files: Record<string, string>): string {
  const dir = join(tmpdir(), `bun-test-file-parallelism-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

function runBunTest(cwd: string, args: string[] = []): { stderr: string; exitCode: number } {
  const result = spawnSync({
    cwd,
    cmd: [bunExe(), "test", ...args],
    env: { ...bunEnv, AGENT: "0" },
    stderr: "pipe",
    stdout: "ignore",
  });
  return {
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
}

describe("--file-parallelism", () => {
  test("runs test files in parallel with --file-parallelism 2", () => {
    const cwd = createTestDir({
      "a.test.ts": `
        import { test, expect } from "bun:test";
        test("test A1", () => { expect(1 + 1).toBe(2); });
        test("test A2", () => { expect(2 + 2).toBe(4); });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        test("test B1", () => { expect(3 + 3).toBe(6); });
        test("test B2", () => { expect(4 + 4).toBe(8); });
      `,
    });

    try {
      const { stderr, exitCode } = runBunTest(cwd, ["--file-parallelism", "2"]);
      expect(stderr).toContain("test A1");
      expect(stderr).toContain("test A2");
      expect(stderr).toContain("test B1");
      expect(stderr).toContain("test B2");
      expect(stderr).toContain("4 pass");
      expect(stderr).toContain("2 files");
      expect(exitCode).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("handles test failures correctly in parallel mode", () => {
    const cwd = createTestDir({
      "pass.test.ts": `
        import { test, expect } from "bun:test";
        test("passing test", () => { expect(true).toBe(true); });
      `,
      "fail.test.ts": `
        import { test, expect } from "bun:test";
        test("failing test", () => { expect(true).toBe(false); });
      `,
    });

    try {
      const { stderr, exitCode } = runBunTest(cwd, ["--file-parallelism", "2"]);
      expect(stderr).toContain("passing test");
      expect(stderr).toContain("failing test");
      expect(stderr).toContain("1 pass");
      expect(stderr).toContain("1 fail");
      expect(exitCode).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("sequential mode (default) still works", () => {
    const cwd = createTestDir({
      "a.test.ts": `
        import { test, expect } from "bun:test";
        test("test A", () => { expect(1).toBe(1); });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        test("test B", () => { expect(2).toBe(2); });
      `,
    });

    try {
      const { stderr, exitCode } = runBunTest(cwd);
      expect(stderr).toContain("test A");
      expect(stderr).toContain("test B");
      expect(stderr).toContain("2 pass");
      expect(exitCode).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("--file-parallelism with many files", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 6; i++) {
      files[`test_${i}.test.ts`] = `
        import { test, expect } from "bun:test";
        test("test from file ${i}", () => { expect(${i}).toBe(${i}); });
      `;
    }
    const cwd = createTestDir(files);

    try {
      const { stderr, exitCode } = runBunTest(cwd, ["--file-parallelism", "3"]);
      for (let i = 0; i < 6; i++) {
        expect(stderr).toContain(`test from file ${i}`);
      }
      expect(stderr).toContain("6 pass");
      expect(stderr).toContain("6 files");
      expect(exitCode).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("rejects --file-parallelism 0", () => {
    const cwd = createTestDir({
      "a.test.ts": `
        import { test, expect } from "bun:test";
        test("test", () => {});
      `,
    });

    try {
      const { stderr, exitCode } = runBunTest(cwd, ["--file-parallelism", "0"]);
      expect(stderr).toContain("--file-parallelism must be greater than 0");
      expect(exitCode).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("rejects invalid --file-parallelism value", () => {
    const cwd = createTestDir({
      "a.test.ts": `
        import { test, expect } from "bun:test";
        test("test", () => {});
      `,
    });

    try {
      const { stderr, exitCode } = runBunTest(cwd, ["--file-parallelism", "abc"]);
      expect(stderr).toContain("Invalid file-parallelism");
      expect(exitCode).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});
