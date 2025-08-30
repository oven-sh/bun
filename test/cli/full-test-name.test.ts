import { expect, test } from "bun:test";
import { bunExe, tempDirWithFiles } from "harness";

test("--full-test-name matches single test", async () => {
  const dir = tempDirWithFiles("full-test-name", {
    "test.test.js": `
describe("auth", () => {
  test("login test", () => {
    expect(1 + 1).toBe(2);
  });
  
  test("logout test", () => {
    expect(2 + 2).toBe(4);
  });
});

test("top level test", () => {
  expect(3 + 3).toBe(6);
});
    `,
  });

  // Test single nested test
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test.test.js", "--full-test-name", "auth login test"],
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  const output = stdout + stderr;
  expect(output).toContain("1 pass");
  expect(output).toContain("2 filtered out");
});

test("--full-test-name matches top-level test", async () => {
  const dir = tempDirWithFiles("full-test-name-top", {
    "test.test.js": `
describe("auth", () => {
  test("login test", () => {
    expect(1 + 1).toBe(2);
  });
});

test("top level test", () => {
  expect(3 + 3).toBe(6);
});
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test.test.js", "--full-test-name", "top level test"],
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  const output = stdout + stderr;
  expect(output).toContain("1 pass");
  expect(output).toContain("1 filtered out");
});

test("--full-test-name supports multiple values", async () => {
  const dir = tempDirWithFiles("full-test-name-multiple", {
    "test.test.js": `
describe("auth", () => {
  test("login test", () => {
    expect(1 + 1).toBe(2);
  });
  
  test("logout test", () => {
    expect(2 + 2).toBe(4);
  });
  
  test("register test", () => {
    expect(3 + 3).toBe(6);
  });
});

describe("user", () => {
  test("profile test", () => {
    expect(4 + 4).toBe(8);
  });
});

test("top level test", () => {
  expect(5 + 5).toBe(10);
});
    `,
  });

  // Test multiple tests from different describe blocks
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "test",
      "test.test.js",
      "--full-test-name",
      "auth login test",
      "--full-test-name",
      "user profile test",
      "--full-test-name",
      "top level test",
    ],
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  const output = stdout + stderr;
  expect(output).toContain("3 pass");
  expect(output).toContain("2 filtered out");
});

test("--full-test-name and --test-name-pattern are mutually exclusive", async () => {
  const dir = tempDirWithFiles("full-test-name-exclusive", {
    "test.test.js": `
test("simple test", () => {
  expect(1).toBe(1);
});
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test.test.js", "--test-name-pattern", "simple", "--full-test-name", "simple test"],
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("--full-test-name and --test-name-pattern cannot be used together");
});

test("--full-test-name shows proper error for non-matching tests", async () => {
  const dir = tempDirWithFiles("full-test-name-no-match", {
    "test.test.js": `
test("existing test", () => {
  expect(1).toBe(1);
});
    `,
  });

  // Single non-matching test
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.js", "--full-test-name", "nonexistent test"],
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("test name matched 0 tests");
  }

  // Multiple non-matching tests
  {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "test",
        "test.test.js",
        "--full-test-name",
        "nonexistent test 1",
        "--full-test-name",
        "nonexistent test 2",
      ],
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("test names matched 0 tests");
  }
});
