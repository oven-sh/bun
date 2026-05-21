import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("pathIgnorePatterns", () => {
  test("bunfig - single pattern string", () => {
    const dir = tempDirWithFiles("path-ignore", {
      "bunfig.toml": `
[test]
pathIgnorePatterns = "ignore-me.test.ts"
`,
      "include-me.test.ts": `
import { test, expect } from "bun:test";
test("included test", () => {
  expect(1).toBe(1);
});
`,
      "ignore-me.test.ts": `
import { test, expect } from "bun:test";
test("ignored test", () => {
  expect(1).toBe(1);
});
`,
    });

    const result = Bun.spawnSync([bunExe(), "test"], {
      cwd: dir,
      env: bunEnv,
      stdio: [null, null, "pipe"],
    });

    const stderr = result.stderr.toString("utf-8");
    expect(stderr).toContain("include-me.test.ts");
    expect(stderr).not.toContain("ignore-me.test.ts");
    expect(stderr).toContain("1 pass");
    expect(result.exitCode).toBe(0);
  });

  test("bunfig - array of patterns", () => {
    const dir = tempDirWithFiles("path-ignore", {
      "bunfig.toml": `
[test]
pathIgnorePatterns = ["helpers/**", "*.setup.test.ts"]
`,
      "main.test.ts": `
import { test, expect } from "bun:test";
test("main test", () => {
  expect(1).toBe(1);
});
`,
      "helpers/util.test.ts": `
import { test, expect } from "bun:test";
test("helper test", () => {
  expect(1).toBe(1);
});
`,
      "db.setup.test.ts": `
import { test, expect } from "bun:test";
test("setup test", () => {
  expect(1).toBe(1);
});
`,
    });

    const result = Bun.spawnSync([bunExe(), "test"], {
      cwd: dir,
      env: bunEnv,
      stdio: [null, null, "pipe"],
    });

    const stderr = result.stderr.toString("utf-8");
    expect(stderr).toContain("main.test.ts");
    expect(stderr).not.toContain("helpers");
    expect(stderr).not.toContain("db.setup.test.ts");
    expect(stderr).toContain("1 pass");
    expect(result.exitCode).toBe(0);
  });

  test("bunfig - glob pattern with **", () => {
    const dir = tempDirWithFiles("path-ignore", {
      "bunfig.toml": `
[test]
pathIgnorePatterns = "**/integration/**"
`,
      "unit/math.test.ts": `
import { test, expect } from "bun:test";
test("unit test", () => {
  expect(1 + 1).toBe(2);
});
`,
      "integration/api.test.ts": `
import { test, expect } from "bun:test";
test("integration test", () => {
  expect(true).toBe(true);
});
`,
    });

    const result = Bun.spawnSync([bunExe(), "test"], {
      cwd: dir,
      env: bunEnv,
      stdio: [null, null, "pipe"],
    });

    const stderr = result.stderr.toString("utf-8");
    expect(stderr).toContain("math.test.ts");
    expect(stderr).not.toContain("integration");
    expect(stderr).toContain("1 pass");
    expect(result.exitCode).toBe(0);
  });

  test("CLI flag - single pattern", () => {
    const dir = tempDirWithFiles("path-ignore", {
      "keep.test.ts": `
import { test, expect } from "bun:test";
test("kept test", () => {
  expect(1).toBe(1);
});
`,
      "skip.test.ts": `
import { test, expect } from "bun:test";
test("skipped test", () => {
  expect(1).toBe(1);
});
`,
    });

    const result = Bun.spawnSync([bunExe(), "test", "--path-ignore-patterns", "skip.test.ts"], {
      cwd: dir,
      env: bunEnv,
      stdio: [null, null, "pipe"],
    });

    const stderr = result.stderr.toString("utf-8");
    expect(stderr).toContain("keep.test.ts");
    expect(stderr).not.toContain("skip.test.ts");
    expect(stderr).toContain("1 pass");
    expect(result.exitCode).toBe(0);
  });

  test("CLI flag - multiple patterns", () => {
    const dir = tempDirWithFiles("path-ignore", {
      "app.test.ts": `
import { test, expect } from "bun:test";
test("app test", () => {
  expect(1).toBe(1);
});
`,
      "e2e/login.test.ts": `
import { test, expect } from "bun:test";
test("e2e test", () => {
  expect(1).toBe(1);
});
`,
      "fixtures/data.test.ts": `
import { test, expect } from "bun:test";
test("fixture test", () => {
  expect(1).toBe(1);
});
`,
    });

    const result = Bun.spawnSync(
      [bunExe(), "test", "--path-ignore-patterns", "e2e/**", "--path-ignore-patterns", "fixtures/**"],
      {
        cwd: dir,
        env: bunEnv,
        stdio: [null, null, "pipe"],
      },
    );

    const stderr = result.stderr.toString("utf-8");
    expect(stderr).toContain("app.test.ts");
    expect(stderr).not.toContain("e2e");
    expect(stderr).not.toContain("fixtures");
    expect(stderr).toContain("1 pass");
    expect(result.exitCode).toBe(0);
  });

  test("bunfig - invalid config type", () => {
    const dir = tempDirWithFiles("path-ignore", {
      "bunfig.toml": `
[test]
pathIgnorePatterns = 123
`,
      "test.test.ts": `
import { test, expect } from "bun:test";
test("should pass", () => {
  expect(true).toBe(true);
});
`,
    });

    const result = Bun.spawnSync([bunExe(), "test"], {
      cwd: dir,
      env: bunEnv,
      stdio: [null, null, "pipe"],
    });

    const stderr = result.stderr.toString("utf-8");
    expect(stderr).toContain("pathIgnorePatterns must be a string or array of strings");
    expect(result.exitCode).toBe(1);
  });

  test("bunfig - invalid array item", () => {
    const dir = tempDirWithFiles("path-ignore", {
      "bunfig.toml": `
[test]
pathIgnorePatterns = ["valid-pattern", 123]
`,
      "test.test.ts": `
import { test, expect } from "bun:test";
test("should pass", () => {
  expect(true).toBe(true);
});
`,
    });

    const result = Bun.spawnSync([bunExe(), "test"], {
      cwd: dir,
      env: bunEnv,
      stdio: [null, null, "pipe"],
    });

    const stderr = result.stderr.toString("utf-8");
    expect(stderr).toContain("pathIgnorePatterns array must contain only strings");
    expect(result.exitCode).toBe(1);
  });

  test("bunfig - empty array opts out of built-in defaults", () => {
    // An explicit empty array in bunfig is how users opt out of the
    // default `**/dist/**` / `**/build/**` patterns. Place a test inside
    // `build/` and confirm it still runs.
    const dir = tempDirWithFiles("path-ignore", {
      "bunfig.toml": `
[test]
pathIgnorePatterns = []
`,
      "test.test.ts": `
import { test, expect } from "bun:test";
test("should pass", () => {
  expect(true).toBe(true);
});
`,
      "build/built.test.ts": `
import { test, expect } from "bun:test";
test("should also pass", () => {
  expect(true).toBe(true);
});
`,
    });

    const result = Bun.spawnSync([bunExe(), "test"], {
      cwd: dir,
      env: bunEnv,
      stdio: [null, null, "pipe"],
    });

    const stderr = result.stderr.toString("utf-8");
    expect(stderr).toContain("test.test.ts");
    expect(stderr).toContain("built.test.ts");
    expect(stderr).toContain("2 pass");
    expect(result.exitCode).toBe(0);
  });

  test("CLI flag overrides bunfig", () => {
    const dir = tempDirWithFiles("path-ignore", {
      "bunfig.toml": `
[test]
pathIgnorePatterns = "a.test.ts"
`,
      "a.test.ts": `
import { test, expect } from "bun:test";
test("a test", () => {
  expect(1).toBe(1);
});
`,
      "b.test.ts": `
import { test, expect } from "bun:test";
test("b test", () => {
  expect(1).toBe(1);
});
`,
    });

    // CLI flag should override bunfig: ignore b.test.ts instead of a.test.ts
    const result = Bun.spawnSync([bunExe(), "test", "--path-ignore-patterns", "b.test.ts"], {
      cwd: dir,
      env: bunEnv,
      stdio: [null, null, "pipe"],
    });

    const stderr = result.stderr.toString("utf-8");
    // CLI patterns override bunfig patterns, so a.test.ts should be included
    // and b.test.ts should be ignored
    expect(stderr).toContain("a.test.ts");
    expect(stderr).not.toContain("b.test.ts");
    expect(stderr).toContain("1 pass");
    expect(result.exitCode).toBe(0);
  });

  test("bare directory name pattern prunes entire subtree", () => {
    const dir = tempDirWithFiles("path-ignore", {
      "root.test.ts": `
import { test, expect } from "bun:test";
test("root test", () => {
  expect(1).toBe(1);
});
`,
      "ignored/deep.test.ts": `
import { test, expect } from "bun:test";
test("deep ignored test", () => {
  expect(1).toBe(1);
});
`,
      "ignored/nested/deeper.test.ts": `
import { test, expect } from "bun:test";
test("deeper ignored test", () => {
  expect(1).toBe(1);
});
`,
    });

    // A bare directory name (no "/**") should prune the directory at scan time,
    // preventing any tests inside it from running.
    const result = Bun.spawnSync([bunExe(), "test", "--path-ignore-patterns", "ignored"], {
      cwd: dir,
      env: bunEnv,
      stdio: [null, null, "pipe"],
    });

    const stderr = result.stderr.toString("utf-8");
    expect(stderr).toContain("root.test.ts");
    expect(stderr).not.toContain("deep.test.ts");
    expect(stderr).not.toContain("deeper.test.ts");
    expect(stderr).toContain("1 pass");
    expect(result.exitCode).toBe(0);
  });

  describe("default patterns", () => {
    // Without any configuration, `bun test` should skip conventional
    // output directories so `tsc`/bundler artifacts don't duplicate the
    // tests found in `src/`. See issue #30282.
    test.each([
      ["build", "build/src/duplicate.test.ts"],
      ["dist", "dist/duplicate.test.ts"],
      ["build nested", "packages/sub/build/src/duplicate.test.ts"],
      ["dist nested", "packages/sub/dist/duplicate.test.ts"],
    ])("skips %s by default", (_label, duplicatePath) => {
      const dir = tempDirWithFiles("path-ignore-default", {
        "src/only.test.ts": `
import { test, expect } from "bun:test";
test("original test", () => {
  expect(1).toBe(1);
});
`,
        [duplicatePath]: `
import { test, expect } from "bun:test";
test("duplicate test", () => {
  expect(1).toBe(1);
});
`,
      });

      const result = Bun.spawnSync([bunExe(), "test"], {
        cwd: dir,
        env: bunEnv,
        stdio: [null, null, "pipe"],
      });

      const stderr = result.stderr.toString("utf-8");
      expect(stderr).toContain("only.test.ts");
      expect(stderr).not.toContain("duplicate.test.ts");
      expect(stderr).toContain("1 pass");
      expect(result.exitCode).toBe(0);
    });

    test("user-configured pathIgnorePatterns replaces the defaults", () => {
      // When the user opts into a custom list, they take responsibility
      // for the entire list — the defaults no longer apply, matching
      // Vitest's replace semantics.
      const dir = tempDirWithFiles("path-ignore-override", {
        "bunfig.toml": `
[test]
pathIgnorePatterns = ["fixtures/**"]
`,
        "src/only.test.ts": `
import { test, expect } from "bun:test";
test("original test", () => {
  expect(1).toBe(1);
});
`,
        "build/kept.test.ts": `
import { test, expect } from "bun:test";
test("kept test", () => {
  expect(1).toBe(1);
});
`,
        "fixtures/skipped.test.ts": `
import { test, expect } from "bun:test";
test("should be ignored", () => {
  expect(1).toBe(1);
});
`,
      });

      const result = Bun.spawnSync([bunExe(), "test"], {
        cwd: dir,
        env: bunEnv,
        stdio: [null, null, "pipe"],
      });

      const stderr = result.stderr.toString("utf-8");
      expect(stderr).toContain("only.test.ts");
      expect(stderr).toContain("kept.test.ts");
      expect(stderr).not.toContain("skipped.test.ts");
      expect(stderr).toContain("2 pass");
      expect(result.exitCode).toBe(0);
    });

    test("explicit file path bypasses the defaults", () => {
      // If the user names a file directly on the CLI, they clearly want
      // to run it — even if it sits under `build/`. The built-in defaults
      // must not silently filter it out.
      const dir = tempDirWithFiles("path-ignore-explicit-file", {
        "build/explicit.test.ts": `
import { test, expect } from "bun:test";
test("explicit test", () => {
  expect(1).toBe(1);
});
`,
      });

      const result = Bun.spawnSync([bunExe(), "test", "./build/explicit.test.ts"], {
        cwd: dir,
        env: bunEnv,
        stdio: [null, null, "pipe"],
      });

      const stderr = result.stderr.toString("utf-8");
      expect(stderr).toContain("explicit.test.ts");
      expect(stderr).toContain("1 pass");
      expect(result.exitCode).toBe(0);
    });

    test("explicit directory path bypasses the defaults", () => {
      const dir = tempDirWithFiles("path-ignore-explicit-dir", {
        "build/nested/explicit.test.ts": `
import { test, expect } from "bun:test";
test("explicit test", () => {
  expect(1).toBe(1);
});
`,
      });

      const result = Bun.spawnSync([bunExe(), "test", "./build"], {
        cwd: dir,
        env: bunEnv,
        stdio: [null, null, "pipe"],
      });

      const stderr = result.stderr.toString("utf-8");
      expect(stderr).toContain("explicit.test.ts");
      expect(stderr).toContain("1 pass");
      expect(result.exitCode).toBe(0);
    });

    test("explicit path still honors user-configured pathIgnorePatterns", () => {
      // The bypass only skips built-in defaults — a user who writes their
      // own pattern meant it. Use a directory name that has no overlap
      // with the defaults so a buggy implementation can't pass this just
      // because the defaults happened to match the same path.
      const dir = tempDirWithFiles("path-ignore-explicit-honors-user", {
        "bunfig.toml": `
[test]
pathIgnorePatterns = ["**/user-ignored/**"]
`,
        "user-ignored/explicit.test.ts": `
import { test, expect } from "bun:test";
test("explicit test", () => {
  expect(1).toBe(1);
});
`,
      });

      const result = Bun.spawnSync([bunExe(), "test", "./user-ignored/explicit.test.ts"], {
        cwd: dir,
        env: bunEnv,
        stdio: [null, null, "pipe"],
      });

      const stderr = result.stderr.toString("utf-8");
      expect(stderr).not.toContain("explicit test");
      expect(stderr).not.toContain("1 pass");
      expect(result.exitCode).not.toBe(0);
    });

    test("explicit dir still prunes nested default-ignored directories", () => {
      // Narrowing behavior: `bun test ./packages/foo` drops only the default
      // patterns that match the scan root itself (none, in this case) — the
      // other defaults keep pruning nested `dist/`/`build/`, so a duplicate
      // `packages/foo/dist/foo.test.ts` is NOT discovered alongside the
      // original in `packages/foo/src/`.
      const dir = tempDirWithFiles("path-ignore-narrow-nested", {
        "packages/foo/src/foo.test.ts": `
import { test, expect } from "bun:test";
test("original test", () => {
  expect(1).toBe(1);
});
`,
        "packages/foo/dist/foo.test.ts": `
import { test, expect } from "bun:test";
test("duplicate test", () => {
  expect(1).toBe(1);
});
`,
      });

      const result = Bun.spawnSync([bunExe(), "test", "./packages/foo"], {
        cwd: dir,
        env: bunEnv,
        stdio: [null, null, "pipe"],
      });

      const stderr = result.stderr.toString("utf-8");
      expect(stderr).toContain("original test");
      expect(stderr).not.toContain("duplicate test");
      expect(stderr).toContain("1 pass");
      expect(result.exitCode).toBe(0);
    });
  });
});
