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

  test("bunfig - empty array is a no-op", () => {
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
    });

    const result = Bun.spawnSync([bunExe(), "test"], {
      cwd: dir,
      env: bunEnv,
      stdio: [null, null, "pipe"],
    });

    const stderr = result.stderr.toString("utf-8");
    expect(stderr).toContain("test.test.ts");
    expect(stderr).toContain("1 pass");
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
});
