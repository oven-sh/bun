import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDirWithFiles } from "harness";

// Helper to create a git repo, commit, make changes, and run coverage
async function setupGitRepo(files: Record<string, string>) {
  const dir = tempDirWithFiles("cov-changes", files);

  // Initialize git repo
  let result = spawnSync(["git", "init"], {
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (result.exitCode !== 0) throw new Error("git init failed");

  // Configure git user
  result = spawnSync(["git", "config", "user.email", "test@test.com"], {
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (result.exitCode !== 0) throw new Error("git config email failed");

  result = spawnSync(["git", "config", "user.name", "Test User"], {
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (result.exitCode !== 0) throw new Error("git config name failed");

  // Explicitly set branch name to "main" for consistent behavior across environments
  result = spawnSync(["git", "branch", "-M", "main"], {
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (result.exitCode !== 0) throw new Error("git branch -M main failed");

  return dir;
}

async function gitAddCommit(dir: string, message: string) {
  let result = spawnSync(["git", "add", "-A"], {
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (result.exitCode !== 0) throw new Error("git add failed");

  result = spawnSync(["git", "commit", "-m", message], {
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (result.exitCode !== 0) throw new Error("git commit failed");
}

async function gitCheckoutBranch(dir: string, branchName: string) {
  const result = spawnSync(["git", "checkout", "-b", branchName], {
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (result.exitCode !== 0) throw new Error("git checkout -b failed");
}

test("--coverage-changes reports coverage for changed lines only", async () => {
  // Create initial files
  const dir = await setupGitRepo({
    "lib.ts": `
export function existingFunction() {
  return "existing";
}

export function anotherExisting() {
  return "another";
}
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { existingFunction, anotherExisting } from "./lib";

test("should call existing functions", () => {
  expect(existingFunction()).toBe("existing");
  expect(anotherExisting()).toBe("another");
});
`,
  });

  // Initial commit on main
  await gitAddCommit(dir, "Initial commit");

  // Create feature branch
  await gitCheckoutBranch(dir, "feature");

  // Add new function that won't be tested
  await Bun.write(
    `${dir}/lib.ts`,
    `
export function existingFunction() {
  return "existing";
}

export function anotherExisting() {
  return "another";
}

export function newUncoveredFunction() {
  // This function is new but not tested
  return "uncovered";
}

export function newCoveredFunction() {
  return "covered";
}
`,
  );

  // Update test to call one of the new functions
  await Bun.write(
    `${dir}/test.test.ts`,
    `
import { test, expect } from "bun:test";
import { existingFunction, anotherExisting, newCoveredFunction } from "./lib";

test("should call existing and new covered functions", () => {
  expect(existingFunction()).toBe("existing");
  expect(anotherExisting()).toBe("another");
  expect(newCoveredFunction()).toBe("covered");
});
`,
  );

  // Commit changes
  await gitAddCommit(dir, "Add new functions");

  // Run coverage with --coverage-changes (using = syntax for optional param)
  const result = spawnSync([bunExe(), "test", "--coverage", "--coverage-changes=main"], {
    cwd: dir,
    env: bunEnv,
    stdio: [null, null, "pipe"],
  });

  const stderr = normalizeBunSnapshot(result.stderr.toString("utf-8"), dir);

  // Should show % Chang column in coverage table
  expect(stderr).toContain("% Chang");
  expect(stderr).toContain("lib.ts");
  // Should fail due to uncovered changed lines
  expect(stderr).toContain("Coverage for changed lines");
  expect(stderr).toContain("is below threshold");
  expect(result.exitCode).toBe(1);
});

test("--coverage-changes passes when all changed lines are covered", async () => {
  // Create initial files
  const dir = await setupGitRepo({
    "lib.ts": `
export function existingFunction() {
  return "existing";
}
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { existingFunction } from "./lib";

test("should call existing function", () => {
  expect(existingFunction()).toBe("existing");
});
`,
  });

  // Initial commit on main
  await gitAddCommit(dir, "Initial commit");

  // Create feature branch
  await gitCheckoutBranch(dir, "feature");

  // Add new function that WILL be tested
  await Bun.write(
    `${dir}/lib.ts`,
    `
export function existingFunction() {
  return "existing";
}

export function newFunction() {
  return "new";
}
`,
  );

  // Update test to call the new function
  await Bun.write(
    `${dir}/test.test.ts`,
    `
import { test, expect } from "bun:test";
import { existingFunction, newFunction } from "./lib";

test("should call both functions", () => {
  expect(existingFunction()).toBe("existing");
  expect(newFunction()).toBe("new");
});
`,
  );

  // Commit changes
  await gitAddCommit(dir, "Add new function with test");

  // Run coverage with --coverage-changes (using = syntax for optional param)
  const result = spawnSync([bunExe(), "test", "--coverage", "--coverage-changes=main"], {
    cwd: dir,
    env: bunEnv,
    stdio: [null, null, "pipe"],
  });

  const stderr = normalizeBunSnapshot(result.stderr.toString("utf-8"), dir);

  // Should show % Chang column with 100% coverage
  expect(stderr).toContain("% Chang");
  expect(stderr).toContain("100.00");
  // Should NOT have the "below threshold" warning
  expect(stderr).not.toContain("is below threshold");
  expect(result.exitCode).toBe(0); // Should pass
});

test("--coverage-changes defaults to main branch", async () => {
  // Create initial files
  const dir = await setupGitRepo({
    "lib.ts": `
export function foo() {
  return "foo";
}
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { foo } from "./lib";

test("should call foo", () => {
  expect(foo()).toBe("foo");
});
`,
  });

  // Initial commit on main
  await gitAddCommit(dir, "Initial commit");

  // Create feature branch
  await gitCheckoutBranch(dir, "feature");

  // Add new covered function
  await Bun.write(
    `${dir}/lib.ts`,
    `
export function foo() {
  return "foo";
}

export function bar() {
  return "bar";
}
`,
  );

  await Bun.write(
    `${dir}/test.test.ts`,
    `
import { test, expect } from "bun:test";
import { foo, bar } from "./lib";

test("should call both", () => {
  expect(foo()).toBe("foo");
  expect(bar()).toBe("bar");
});
`,
  );

  await gitAddCommit(dir, "Add bar");

  // Run coverage with --coverage-changes without specifying branch (defaults to main)
  const result = spawnSync([bunExe(), "test", "--coverage", "--coverage-changes"], {
    cwd: dir,
    env: bunEnv,
    stdio: [null, null, "pipe"],
  });

  const stderr = normalizeBunSnapshot(result.stderr.toString("utf-8"), dir);

  // Should show % Chang column (defaults to comparing against main)
  expect(stderr).toContain("% Chang");
  expect(result.exitCode).toBe(0);
});

test("--coverage-changes shows no changes when branch is same as base", async () => {
  const dir = await setupGitRepo({
    "lib.ts": `
export function foo() {
  return "foo";
}
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { foo } from "./lib";

test("should call foo", () => {
  expect(foo()).toBe("foo");
});
`,
  });

  await gitAddCommit(dir, "Initial commit");

  // Run on main against main (no changes)
  const result = spawnSync([bunExe(), "test", "--coverage", "--coverage-changes=main"], {
    cwd: dir,
    env: bunEnv,
    stdio: [null, null, "pipe"],
  });

  const stderr = normalizeBunSnapshot(result.stderr.toString("utf-8"), dir);

  // When on main comparing to main (no changes), the % Chang column should not appear
  // because git diff returns empty
  expect(stderr).not.toContain("% Chang");
  // But regular coverage table should still be shown
  expect(stderr).toContain("% Funcs");
  expect(stderr).toContain("% Lines");
  expect(result.exitCode).toBe(0);
});

test("--coverage-changes with inline snapshot", async () => {
  // Create a simple scenario where we can verify exact output
  const dir = await setupGitRepo({
    "math.ts": `
export function add(a: number, b: number) {
  return a + b;
}
`,
    "math.test.ts": `
import { test, expect } from "bun:test";
import { add } from "./math";

test("add works", () => {
  expect(add(1, 2)).toBe(3);
});
`,
  });

  await gitAddCommit(dir, "Initial commit");
  await gitCheckoutBranch(dir, "feature");

  // Add multiply function without test
  await Bun.write(
    `${dir}/math.ts`,
    `
export function add(a: number, b: number) {
  return a + b;
}

export function multiply(a: number, b: number) {
  return a * b;
}
`,
  );

  await gitAddCommit(dir, "Add multiply");

  const result = spawnSync([bunExe(), "test", "--coverage", "--coverage-changes=main"], {
    cwd: dir,
    env: {
      ...bunEnv,
      NO_COLOR: "1",
    },
    stdio: [null, null, "pipe"],
  });

  let stderr = result.stderr.toString("utf-8");
  // Remove timing and version info for snapshot stability
  stderr = normalizeBunSnapshot(stderr, dir);

  // The output should show merged table with % Chang column
  expect(stderr).toContain("% Chang");
  expect(stderr).toContain("math.ts");
  // Should show "below threshold" warning
  expect(stderr).toContain("Coverage for changed lines");
  expect(stderr).toContain("is below threshold");
  // Exit code should be 1 because multiply is not covered
  expect(result.exitCode).toBe(1);
});

test("--coverage-changes shows AI agent prompts when AGENT=1", async () => {
  const dir = await setupGitRepo({
    "lib.ts": `
export function add(a: number, b: number) {
  return a + b;
}
`,
    "lib.test.ts": `
import { test, expect } from "bun:test";
import { add } from "./lib";

test("add works", () => {
  expect(add(1, 2)).toBe(3);
});
`,
  });

  await gitAddCommit(dir, "Initial commit");
  await gitCheckoutBranch(dir, "feature");

  // Add uncovered function
  await Bun.write(
    `${dir}/lib.ts`,
    `
export function add(a: number, b: number) {
  return a + b;
}

export function uncovered() {
  return "not tested";
}
`,
  );

  await gitAddCommit(dir, "Add uncovered function");

  // Run with AGENT=1 to trigger AI prompts
  const result = spawnSync([bunExe(), "test", "--coverage", "--coverage-changes=main"], {
    cwd: dir,
    env: {
      ...bunEnv,
      NO_COLOR: "1",
      AGENT: "1",
    },
    stdio: [null, null, "pipe"],
  });

  const stderr = normalizeBunSnapshot(result.stderr.toString("utf-8"), dir);

  // Should show AI agent XML prompts with <errors> tag
  expect(stderr).toContain("<errors>");
  expect(stderr).toContain("</errors>");
  expect(stderr).toContain("<file path=");
  expect(stderr).toContain("do not have test coverage");
  expect(result.exitCode).toBe(1);
});

test("--coverage-changes shows <function> tags for entirely uncovered new functions", async () => {
  const dir = await setupGitRepo({
    "lib.ts": `
export function existingFunc() {
  return "existing";
}
`,
    "lib.test.ts": `
import { test, expect } from "bun:test";
import { existingFunc } from "./lib";

test("existing works", () => {
  expect(existingFunc()).toBe("existing");
});
`,
  });

  await gitAddCommit(dir, "Initial commit");
  await gitCheckoutBranch(dir, "feature");

  // Add a completely new function that is never called
  await Bun.write(
    `${dir}/lib.ts`,
    `
export function existingFunc() {
  return "existing";
}

export function newUncalledFunc() {
  return "never called";
}
`,
  );

  await gitAddCommit(dir, "Add uncalled function");

  const result = spawnSync([bunExe(), "test", "--coverage", "--coverage-changes=main"], {
    cwd: dir,
    env: {
      ...bunEnv,
      NO_COLOR: "1",
      AGENT: "1",
    },
    stdio: [null, null, "pipe"],
  });

  const stderr = normalizeBunSnapshot(result.stderr.toString("utf-8"), dir);

  // Should show <function> tag for the uncalled function
  expect(stderr).toContain("<errors>");
  expect(stderr).toContain("<function path=");
  expect(stderr).toContain("is never called");
  expect(stderr).toContain("</function>");
  expect(result.exitCode).toBe(1);
});
