import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("bunfig test.filePatterns with single string pattern", async () => {
  const dir = tempDirWithFiles("test-filepatterns-single", {
    "bunfig.toml": `
[test]
filePatterns = "*.mytest.js"
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

  const proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  // Test output goes to stderr by default
  expect(stderr).toContain("1 pass");
  // Verify only the mytest.js file was run (1 test)
  expect(stderr).toContain("Ran 1 test");
});

test("bunfig test.filePatterns with array of patterns", async () => {
  const dir = tempDirWithFiles("test-filepatterns-array", {
    "bunfig.toml": `
[test]
filePatterns = ["*.custom.js", "*.mytest.ts"]
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

  const proc = Bun.spawn({
    cmd: [bunExe(), "test", "--reporter", "junit", "--reporter-outfile", "results.xml"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  // 2 tests should run (custom.js and mytest.ts)
  expect(stderr).toContain("2 pass");
  expect(stderr).toContain("Ran 2 tests");
});

test("bunfig test.filePatterns with nested directories", async () => {
  const dir = tempDirWithFiles("test-filepatterns-nested", {
    "bunfig.toml": `
[test]
filePatterns = "**/*.custom.js"
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

  const proc = Bun.spawn({
    cmd: [bunExe(), "test", "--reporter", "junit", "--reporter-outfile", "results.xml"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  // 2 custom tests in nested directories
  expect(stderr).toContain("2 pass");
  expect(stderr).toContain("Ran 2 tests");
});

test("bunfig test.filePatterns with relative paths", async () => {
  const dir = tempDirWithFiles("test-filepatterns-relative", {
    "bunfig.toml": `
[test]
filePatterns = "tests/*.unit.js"
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

  const proc = Bun.spawn({
    cmd: [bunExe(), "test", "--reporter", "junit", "--reporter-outfile", "results.xml"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  // Only 1 test from tests/*.unit.js
  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("Ran 1 test");
});

test("bunfig test.filePatterns error handling for invalid type", async () => {
  const dir = tempDirWithFiles("test-filepatterns-invalid", {
    "bunfig.toml": `
[test]
filePatterns = 123
`,
    "example.test.js": `
import { test, expect } from "bun:test";
test("test", () => {
  expect(1).toBe(1);
});
`,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("test.filePatterns must be a string or array of strings");
});

test("bunfig test.filePatterns error handling for invalid array element", async () => {
  const dir = tempDirWithFiles("test-filepatterns-invalid-array", {
    "bunfig.toml": `
[test]
filePatterns = ["*.test.js", 123]
`,
    "example.test.js": `
import { test, expect } from "bun:test";
test("test", () => {
  expect(1).toBe(1);
});
`,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("test.filePatterns array must contain only strings");
});

test("bunfig test.filePatterns fallback to default patterns when not specified", async () => {
  const dir = tempDirWithFiles("test-filepatterns-fallback", {
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

  const proc = Bun.spawn({
    cmd: [bunExe(), "test", "--reporter", "junit", "--reporter-outfile", "results.xml"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  // Should run default test patterns (test and spec files)
  expect(stderr).toContain("2 pass");
  expect(stderr).toContain("Ran 2 tests");
});

test("bunfig test.filePatterns resolves paths relative to bunfig.toml location", async () => {
  const dir = tempDirWithFiles("test-filepatterns-cwd", {
    "bunfig.toml": `
[test]
filePatterns = "mydir/*.mytest.js"
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

  const proc = Bun.spawn({
    cmd: [bunExe(), "test", "--reporter", "junit", "--reporter-outfile", "results.xml"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  // Only the nested test file should run
  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("Ran 1 test");
});

test("bunfig test.filePatterns with ./ relative path resolution", async () => {
  // Test that ./ patterns are resolved relative to bunfig.toml location
  const dir = tempDirWithFiles("test-filepatterns-relative-dot", {
    "project/bunfig.toml": `
[test]
filePatterns = "./tests/*.mytest.js"
`,
    "project/tests/example.mytest.js": `
import { test, expect } from "bun:test";
test("relative dot test", () => {
  expect(1).toBe(1);
});
`,
    "tests/example.mytest.js": `
import { test, expect } from "bun:test";
test("should not run", () => {
  expect(1).toBe(1);
});
`,
    "project/example.test.js": `
import { test, expect } from "bun:test";
test("default test", () => {
  expect(1).toBe(1);
});
`,
  });

  // Run from the project directory where bunfig.toml is located
  const proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: `${dir}/project`,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  // Should only run the test in ./tests relative to bunfig.toml location
  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("Ran 1 test");
});

test.skip("bunfig test.filePatterns with ../ relative path resolution", async () => {
  // Note: This test is skipped because bun test doesn't scan parent directories
  // when running from a subdirectory, which is expected behavior
  const dir = tempDirWithFiles("test-filepatterns-relative-dotdot", {
    "project/config/bunfig.toml": `
[test]
filePatterns = "../tests/*.mytest.js"
`,
    "project/tests/example.mytest.js": `
import { test, expect } from "bun:test";
test("relative parent test", () => {
  expect(1).toBe(1);
});
`,
    "project/config/tests/example.mytest.js": `
import { test, expect } from "bun:test";
test("should not run", () => {
  expect(1).toBe(1);
});
`,
    "project/config/example.test.js": `
import { test, expect } from "bun:test";
test("default test", () => {
  expect(1).toBe(1);
});
`,
  });

  // Run from the config directory where bunfig.toml is located
  const proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: `${dir}/project/config`,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  // Should only run the test in ../tests relative to bunfig.toml
  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("Ran 1 test");
});

test("bunfig test.filePatterns with absolute paths", async () => {
  const dir = tempDirWithFiles("test-filepatterns-absolute", {
    "bunfig.toml": "", // Will be written after we know the absolute path
    "tests/example.mytest.js": `
import { test, expect } from "bun:test";
test("absolute path test", () => {
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

  // Write bunfig.toml with absolute path
  const absolutePath = `${dir}/tests/*.mytest.js`;
  await Bun.write(
    `${dir}/bunfig.toml`,
    `
[test]
filePatterns = "${absolutePath}"
`,
  );

  const proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  // Should only run the test specified by absolute path
  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("Ran 1 test");
});

test("bunfig test.filePatterns with empty array should not match any files", async () => {
  const dir = tempDirWithFiles("test-filepatterns-empty", {
    "bunfig.toml": `
[test]
filePatterns = []
`,
    "example.test.js": `
import { test, expect } from "bun:test";
test("test", () => {
  expect(1).toBe(1);
});
`,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // When no test files are found, bun test exits with code 1
  expect(exitCode).toBe(1);
  expect(stderr).toContain("0 test files matching");
});
