import { describe, test, expect } from "bun:test";
import { tempDir, bunExe, bunEnv } from "harness";
import { join } from "path";
import { writeFileSync } from "fs";

describe("concurrent-test-glob", () => {
  test("tests matching glob pattern run concurrently", async () => {
    using dir = tempDir("concurrent-glob", {});

    // Create a shared log file to track execution order
    const logFile = join(String(dir), "execution.log");

    // Create test files that log their execution
    const testFile1 = `
import { test, expect } from "bun:test";
import { appendFileSync } from "fs";

const logFile = "${logFile.replace(/\\/g, "\\\\")}";

test.concurrent("test 1", async () => {
  appendFileSync(logFile, "test1-start\\n");
  await Bun.sleep(50);
  appendFileSync(logFile, "test1-end\\n");
  expect(1).toBe(1);
});

test.concurrent("test 2", async () => {
  appendFileSync(logFile, "test2-start\\n");
  await Bun.sleep(50);
  appendFileSync(logFile, "test2-end\\n");
  expect(2).toBe(2);
});
`;

    const testFile2 = `
import { test, expect } from "bun:test";
import { appendFileSync } from "fs";

const logFile = "${logFile.replace(/\\/g, "\\\\")}";

test.concurrent("test 3", async () => {
  appendFileSync(logFile, "test3-start\\n");
  await Bun.sleep(50);
  appendFileSync(logFile, "test3-end\\n");
  expect(3).toBe(3);
});

test.concurrent("test 4", async () => {
  appendFileSync(logFile, "test4-start\\n");
  await Bun.sleep(50);
  appendFileSync(logFile, "test4-end\\n");
  expect(4).toBe(4);
});
`;

    // Create bunfig.toml with concurrent-test-glob
    const bunfigContent = `
[test]
concurrentTestGlob = "**/concurrent-*.test.ts"
`;

    await Bun.write(join(String(dir), "bunfig.toml"), bunfigContent);
    await Bun.write(join(String(dir), "concurrent-1.test.ts"), testFile1);
    await Bun.write(join(String(dir), "concurrent-2.test.ts"), testFile2);

    // Initialize the log file
    writeFileSync(logFile, "");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout + stderr).toContain("4 pass");

    // Read the execution log to verify concurrent execution
    const log = await Bun.file(logFile).text();
    const lines = log.trim().split("\n").filter(Boolean);

    // If tests ran concurrently, we should see interleaved starts
    // Count how many "start" events occur before the first "end" event
    const firstEndIndex = lines.findIndex(line => line.includes("-end"));
    const startsBeforeFirstEnd = lines.slice(0, firstEndIndex).filter(line => line.includes("-start")).length;

    // With concurrent execution, we expect multiple starts before the first end
    // With sequential execution, we'd see start-end-start-end pattern
    expect(startsBeforeFirstEnd).toBeGreaterThan(1);
  });

  test("tests not matching glob pattern run sequentially", async () => {
    using dir = tempDir("sequential-glob", {});

    const logFile = join(String(dir), "sequential.log");

    const testFile = `
import { test, expect } from "bun:test";
import { appendFileSync } from "fs";
import { existsSync } from "fs";

const logFile = "${logFile.replace(/\\/g, "\\\\")}";

// Initialize the log file
if (!existsSync(logFile)) {
  appendFileSync(logFile, "");
}

// These tests share state and would fail if run concurrently
let sharedCounter = 0;

test("sequential test 1", async () => {
  appendFileSync(logFile, "seq1-start\\n");
  sharedCounter = 1;
  await Bun.sleep(50); // Give time for race condition if concurrent
  expect(sharedCounter).toBe(1); // Would fail if test 2 ran concurrently
  appendFileSync(logFile, "seq1-end\\n");
});

test("sequential test 2", async () => {
  appendFileSync(logFile, "seq2-start\\n");
  expect(sharedCounter).toBe(1); // Should be 1 from test 1
  sharedCounter = 2;
  await Bun.sleep(50);
  expect(sharedCounter).toBe(2);
  appendFileSync(logFile, "seq2-end\\n");
});
`;

    // Create bunfig.toml with concurrent-test-glob that doesn't match
    const bunfigContent = `
[test]
concurrentTestGlob = "**/concurrent-*.test.ts"
`;

    await Bun.write(join(String(dir), "bunfig.toml"), bunfigContent);
    await Bun.write(join(String(dir), "sequential.test.ts"), testFile);
    writeFileSync(logFile, "");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout + stderr).toContain("2 pass");

    // Verify sequential execution pattern
    const log = await Bun.file(logFile).text();
    const lines = log.trim().split("\n").filter(Boolean);

    // Sequential execution should show: seq1-start, seq1-end, seq2-start, seq2-end
    expect(lines).toEqual(["seq1-start", "seq1-end", "seq2-start", "seq2-end"]);
  });

  test("concurrent flag overrides concurrent-test-glob", async () => {
    using dir = tempDir("concurrent-override", {});

    const testFile = `
import { test, expect } from "bun:test";

test("test 1", () => {
  expect(1).toBe(1);
});
`;

    // Create bunfig.toml with concurrent-test-glob that doesn't match
    const bunfigContent = `
[test]
concurrentTestGlob = "**/concurrent-*.test.ts"
`;

    await Bun.write(join(String(dir), "bunfig.toml"), bunfigContent);
    await Bun.write(join(String(dir), "sequential.test.ts"), testFile);

    // Run with --concurrent flag
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--concurrent"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout + stderr).toContain("1 pass");
  });
});