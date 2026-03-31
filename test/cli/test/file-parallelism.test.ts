import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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
    using cwd = tempDir("file-par", {
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

    const { stderr, exitCode } = runBunTest(String(cwd), ["--file-parallelism", "2"]);
    expect(stderr).toContain("test A1");
    expect(stderr).toContain("test A2");
    expect(stderr).toContain("test B1");
    expect(stderr).toContain("test B2");
    expect(stderr).toContain("4 pass");
    expect(stderr).toContain("2 files");
    expect(exitCode).toBe(0);
  });

  test("handles test failures correctly in parallel mode", () => {
    using cwd = tempDir("file-par-fail", {
      "pass.test.ts": `
        import { test, expect } from "bun:test";
        test("passing test", () => { expect(true).toBe(true); });
      `,
      "fail.test.ts": `
        import { test, expect } from "bun:test";
        test("failing test", () => { expect(true).toBe(false); });
      `,
    });

    const { stderr, exitCode } = runBunTest(String(cwd), ["--file-parallelism", "2"]);
    expect(stderr).toContain("passing test");
    expect(stderr).toContain("failing test");
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("sequential mode (default) still works", () => {
    using cwd = tempDir("file-par-seq", {
      "a.test.ts": `
        import { test, expect } from "bun:test";
        test("test A", () => { expect(1).toBe(1); });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        test("test B", () => { expect(2).toBe(2); });
      `,
    });

    const { stderr, exitCode } = runBunTest(String(cwd));
    expect(stderr).toContain("test A");
    expect(stderr).toContain("test B");
    expect(stderr).toContain("2 pass");
    expect(exitCode).toBe(0);
  });

  test("--file-parallelism with many files", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 6; i++) {
      files[`test_${i}.test.ts`] = `
        import { test, expect } from "bun:test";
        test("test from file ${i}", () => { expect(${i}).toBe(${i}); });
      `;
    }
    using cwd = tempDir("file-par-many", files);

    const { stderr, exitCode } = runBunTest(String(cwd), ["--file-parallelism", "3"]);
    for (let i = 0; i < 6; i++) {
      expect(stderr).toContain(`test from file ${i}`);
    }
    expect(stderr).toContain("6 pass");
    expect(stderr).toContain("6 files");
    expect(exitCode).toBe(0);
  });

  test("rejects --file-parallelism 0", () => {
    using cwd = tempDir("file-par-zero", {
      "a.test.ts": `
        import { test, expect } from "bun:test";
        test("test", () => {});
      `,
    });

    const { stderr, exitCode } = runBunTest(String(cwd), ["--file-parallelism", "0"]);
    expect(stderr).toContain("--file-parallelism must be greater than 0");
    expect(exitCode).toBe(1);
  });

  test("proves files actually overlap in parallel mode", () => {
    // Each file writes its own marker, then polls for the other file's marker.
    // If execution is sequential, the second file's marker never appears while
    // the first file is running, so the first file times out / fails.
    using cwd = tempDir("file-par-overlap", {
      "a.test.ts": `
        import { test, expect } from "bun:test";
        import { writeFileSync, existsSync } from "fs";
        import { join } from "path";

        test("a waits for b", async () => {
          const dir = process.cwd();
          writeFileSync(join(dir, "a.marker"), "a");
          // Poll for b's marker (up to 5s)
          const start = Date.now();
          while (!existsSync(join(dir, "b.marker"))) {
            if (Date.now() - start > 5000) throw new Error("timed out waiting for b.marker");
            await Bun.sleep(10);
          }
          expect(true).toBe(true);
        });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        import { writeFileSync, existsSync } from "fs";
        import { join } from "path";

        test("b waits for a", async () => {
          const dir = process.cwd();
          writeFileSync(join(dir, "b.marker"), "b");
          // Poll for a's marker (up to 5s)
          const start = Date.now();
          while (!existsSync(join(dir, "a.marker"))) {
            if (Date.now() - start > 5000) throw new Error("timed out waiting for a.marker");
            await Bun.sleep(10);
          }
          expect(true).toBe(true);
        });
      `,
    });

    const { stderr, exitCode } = runBunTest(String(cwd), ["--file-parallelism", "2"]);
    expect(stderr).toContain("2 pass");
    expect(exitCode).toBe(0);
  });

  test("rejects invalid --file-parallelism value", () => {
    using cwd = tempDir("file-par-invalid", {
      "a.test.ts": `
        import { test, expect } from "bun:test";
        test("test", () => {});
      `,
    });

    const { stderr, exitCode } = runBunTest(String(cwd), ["--file-parallelism", "abc"]);
    expect(stderr).toContain("Invalid file-parallelism");
    expect(exitCode).toBe(1);
  });
});
