import { $ } from "bun";
import { expect, test } from "bun:test";
import { bunExe, tempDirWithFiles } from "harness";

test("--full-test-name with trailing space runs all tests in describe block", async () => {
  const dir = tempDirWithFiles("trailing-space", {
    "test.test.js": `
describe("auth", () => {
  test("login test", () => {
    expect(1).toBe(1);
  });
  
  test("logout test", () => {
    expect(2).toBe(2);
  });

  describe("nested", () => {
    test("deep test", () => {
      expect(3).toBe(3);
    });
  });
});

describe("user", () => {
  test("profile test", () => {
    expect(4).toBe(4);
  });
});
    `,
  });

  // Test "auth " (with trailing space) runs all tests under auth hierarchy
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test.test.js", "--full-test-name", "auth "],
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  const output = stdout + stderr;
  expect(output).toContain("3 pass"); // All 3 tests in auth hierarchy should run
  expect(output).toContain("1 filtered out"); // The user profile test should be filtered out
});

test("--full-test-name with trailing space for nested describe block", async () => {
  const dir = tempDirWithFiles("trailing-space-nested", {
    "test.test.js": `
describe("auth", () => {
  test("login test", () => {
    expect(1).toBe(1);
  });

  describe("integration", () => {
    test("full flow test", () => {
      expect(2).toBe(2);
    });

    test("api test", () => {
      expect(3).toBe(3);
    });
  });
});

describe("user", () => {
  test("profile test", () => {
    expect(4).toBe(4);
  });
});
    `,
  });

  // Test "auth integration " runs only tests in that specific nested block
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test.test.js", "--full-test-name", "auth integration "],
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  const output = stdout + stderr;
  expect(output).toContain("2 pass"); // Only 2 tests in auth integration should run
});

test("--full-test-name with multiple trailing space filters", async () => {
  const dir = tempDirWithFiles("trailing-space-multiple", {
    "test.test.js": `
describe("auth", () => {
  test("login test", () => {
    expect(1).toBe(1);
  });
  
  describe("nested", () => {
    test("deep test", () => {
      expect(2).toBe(2);
    });
  });
});

describe("user", () => {
  test("profile test", () => {
    expect(3).toBe(3);
  });
  
  test("settings test", () => {
    expect(4).toBe(4);
  });
});

describe("admin", () => {
  test("dashboard test", () => {
    expect(5).toBe(5);
  });
});
    `,
  });

  // Test multiple trailing space filters
  await using proc = Bun.spawn({
    cmd: [
      bunExe(), 
      "test", 
      "test.test.js", 
      "--full-test-name", "auth ",
      "--full-test-name", "user "
    ],
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  const output = stdout + stderr;
  expect(output).toContain("4 pass"); // auth (2) + user (2) = 4 tests should run
});

test("--full-test-name handles test names with actual trailing spaces", async () => {
  const dir = tempDirWithFiles("trailing-space-in-name", {
    "test.test.js": `
describe("auth", () => {
  test("login test", () => {
    expect(1).toBe(1);
  });
  
  test("test with trailing space ", () => {
    expect(2).toBe(2);
  });
});
    `,
  });

  // Test exact match for a test name that actually ends with a space
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test.test.js", "--full-test-name", "auth test with trailing space "],
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  const output = stdout + stderr;
  expect(output).toContain("1 pass"); // Only the specific test should run
});

test("--full-test-name trailing space vs exact test name disambiguation", async () => {
  const dir = tempDirWithFiles("trailing-space-disambiguation", {
    "test.test.js": `
describe("auth", () => {
  test("login test", () => {
    expect(1).toBe(1);
  });
  
  test("logout test", () => {
    expect(2).toBe(2);
  });
});

describe("auth integration", () => {
  test("api test", () => {
    expect(3).toBe(3);
  });
});
    `,
  });

  // Test that "auth " (describe block) and "auth integration api test" (specific test) work correctly
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "test", "test.test.js", "--full-test-name", "auth "],
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([
    proc1.stdout.text(),
    proc1.stderr.text(),
    proc1.exited,
  ]);

  expect(exitCode1).toBe(0);
  const output1 = stdout1 + stderr1;
  expect(output1).toContain("3 pass"); // All tests that start with "auth " (includes auth integration)

  // Test specific test in auth integration
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "test", "test.test.js", "--full-test-name", "auth integration api test"],
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([
    proc2.stdout.text(),
    proc2.stderr.text(),
    proc2.exited,
  ]);

  expect(exitCode2).toBe(0);
  const output2 = stdout2 + stderr2;
  expect(output2).toContain("1 pass"); // Only the specific test
});