import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("bunfig test.glob with single string pattern", async () => {
  const dir = tempDirWithFiles("test-glob-single", {
    "bunfig.toml": `
[test]
glob = "*.mytest.js"
`,
    "example.mytest.js": `
import { test, expect } from "bun:test";
test("custom glob test", () => {
  expect(1).toBe(1);
});
`,
    "example.test.js": `
import { test, expect } from "bun:test";
test("default pattern test", () => {
  expect(1).toBe(1);
});
`,
    "example.spec.js": `
import { test, expect } from "bun:test";
test("spec test", () => {
  expect(1).toBe(1);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--reporter", "junit", "--reporter-outfile", "results.xml"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("custom glob test");
  expect(stdout).not.toContain("default pattern test");
  expect(stdout).not.toContain("spec test");
});

test("bunfig test.glob with array of patterns", async () => {
  const dir = tempDirWithFiles("test-glob-array", {
    "bunfig.toml": `
[test]
glob = ["*.custom.js", "*.mytest.ts"]
`,
    "example.custom.js": `
import { test, expect } from "bun:test";
test("custom js test", () => {
  expect(1).toBe(1);
});
`,
    "example.mytest.ts": `
import { test, expect } from "bun:test";
test("custom ts test", () => {
  expect(1).toBe(1);
});
`,
    "example.test.js": `
import { test, expect } from "bun:test";
test("default pattern test", () => {
  expect(1).toBe(1);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--reporter", "junit", "--reporter-outfile", "results.xml"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("custom js test");
  expect(stdout).toContain("custom ts test");
  expect(stdout).not.toContain("default pattern test");
});

test("bunfig test.glob with nested directories", async () => {
  const dir = tempDirWithFiles("test-glob-nested", {
    "bunfig.toml": `
[test]
glob = "**/*.custom.js"
`,
    "src/example.custom.js": `
import { test, expect } from "bun:test";
test("nested custom test", () => {
  expect(1).toBe(1);
});
`,
    "lib/utils/helper.custom.js": `
import { test, expect } from "bun:test";
test("deeply nested custom test", () => {
  expect(1).toBe(1);
});
`,
    "example.test.js": `
import { test, expect } from "bun:test";
test("root test", () => {
  expect(1).toBe(1);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--reporter", "junit", "--reporter-outfile", "results.xml"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("nested custom test");
  expect(stdout).toContain("deeply nested custom test");
  expect(stdout).not.toContain("root test");
});

test("bunfig test.glob with relative paths", async () => {
  const dir = tempDirWithFiles("test-glob-relative", {
    "bunfig.toml": `
[test]
glob = "tests/*.unit.js"
`,
    "tests/example.unit.js": `
import { test, expect } from "bun:test";
test("unit test", () => {
  expect(1).toBe(1);
});
`,
    "tests/example.integration.js": `
import { test, expect } from "bun:test";
test("integration test", () => {
  expect(1).toBe(1);
});
`,
    "example.test.js": `
import { test, expect } from "bun:test";
test("default test", () => {
  expect(1).toBe(1);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--reporter", "junit", "--reporter-outfile", "results.xml"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("unit test");
  expect(stdout).not.toContain("integration test");
  expect(stdout).not.toContain("default test");
});

test("bunfig test.glob error handling for invalid type", async () => {
  const dir = tempDirWithFiles("test-glob-invalid", {
    "bunfig.toml": `
[test]
glob = 123
`,
    "example.test.js": `
import { test, expect } from "bun:test";
test("test", () => {
  expect(1).toBe(1);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("test.glob must be a string or array of strings");
});

test("bunfig test.glob error handling for invalid array element", async () => {
  const dir = tempDirWithFiles("test-glob-invalid-array", {
    "bunfig.toml": `
[test]
glob = ["*.test.js", 123]
`,
    "example.test.js": `
import { test, expect } from "bun:test";
test("test", () => {
  expect(1).toBe(1);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("test.glob array must contain only strings");
});

test("bunfig test.glob fallback to default patterns when not specified", async () => {
  const dir = tempDirWithFiles("test-glob-fallback", {
    "bunfig.toml": `
[test]
# No glob specified
`,
    "example.test.js": `
import { test, expect } from "bun:test";
test("default test pattern", () => {
  expect(1).toBe(1);
});
`,
    "example.spec.ts": `
import { test, expect } from "bun:test";
test("default spec pattern", () => {
  expect(1).toBe(1);
});
`,
    "example.custom.js": `
import { test, expect } from "bun:test";
test("non-matching pattern", () => {
  expect(1).toBe(1);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--reporter", "junit", "--reporter-outfile", "results.xml"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("default test pattern");
  expect(stdout).toContain("default spec pattern");
  expect(stdout).not.toContain("non-matching pattern");
});

test("bunfig test.glob resolves paths relative to bunfig.toml location", async () => {
  const dir = tempDirWithFiles("test-glob-cwd", {
    "bunfig.toml": `
[test]
glob = "mydir/*.mytest.js"
`,
    "mydir/example.mytest.js": `
import { test, expect } from "bun:test";
test("relative path test", () => {
  expect(1).toBe(1);
});
`,
    "example.test.js": `
import { test, expect } from "bun:test";
test("root test", () => {
  expect(1).toBe(1);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--reporter", "junit", "--reporter-outfile", "results.xml"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("relative path test");
  expect(stdout).not.toContain("root test");
});

test("bunfig test.glob with empty array should not match any files", async () => {
  const dir = tempDirWithFiles("test-glob-empty", {
    "bunfig.toml": `
[test]
glob = []
`,
    "example.test.js": `
import { test, expect } from "bun:test";
test("test", () => {
  expect(1).toBe(1);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // When no test files are found, bun test should exit with code 0 but find 0 tests
  expect(stdout).toContain("0 pass");
});
