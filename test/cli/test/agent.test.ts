import { expect, test } from "bun:test";
import { bunExe, tempDirWithFiles } from "harness";

test("--agent flag: only prints errors and summary", async () => {
  const dir = tempDirWithFiles("agent-test-1", {
    "pass.test.js": `
      import { test, expect } from "bun:test";
      
      test("passing test", () => {
        expect(1 + 1).toBe(2);
      });
    `,
    "fail.test.js": `
      import { test, expect } from "bun:test";
      
      test("failing test", () => {
        expect(1 + 1).toBe(3);
      });
    `,
    "skip.test.js": `
      import { test, expect } from "bun:test";
      
      test.skip("skipped test", () => {
        expect(1 + 1).toBe(2);
      });
    `,
    "todo.test.js": `
      import { test, expect } from "bun:test";
      
      test.todo("todo test", () => {
        expect(1 + 1).toBe(2);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--agent"],
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Should exit with code 1 because tests failed
  expect(exitCode).toBe(1);

  // Should not contain ANSI color codes
  expect(stderr).not.toContain("\u001b[");
  expect(stdout).not.toContain("\u001b[");

  // Should contain failure output
  expect(stderr).toContain("failing test");
  expect(stderr).toContain("Expected:");
  expect(stderr).toContain("Received:");

  // Should NOT contain pass/skip/todo individual test output
  expect(stderr).not.toContain("passing test");
  expect(stderr).not.toContain("skipped test");
  expect(stderr).not.toContain("todo test");

  // Should contain summary with counts
  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("1 skip");
  expect(stderr).toContain("1 todo");
  expect(stderr).toContain("1 fail");

  // Should contain total test count
  expect(stderr).toContain("Ran 4 test");
});

test("--agent flag: exits with code 1 when no tests are run", async () => {
  const dir = tempDirWithFiles("agent-test-2", {
    "not-a-test.js": `console.log("not a test");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--agent"],
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Should exit with code 1 when no tests are found
  expect(exitCode).toBe(1);

  // Should not contain ANSI color codes
  expect(stderr).not.toContain("\u001b[");
  expect(stdout).not.toContain("\u001b[");
});

test("--agent flag: with only passing tests", async () => {
  const dir = tempDirWithFiles("agent-test-3", {
    "pass1.test.js": `
      import { test, expect } from "bun:test";
      
      test("passing test 1", () => {
        expect(1 + 1).toBe(2);
      });
    `,
    "pass2.test.js": `
      import { test, expect } from "bun:test";
      
      test("passing test 2", () => {
        expect(2 + 2).toBe(4);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--agent"],
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Should exit with code 0 when all tests pass
  expect(exitCode).toBe(0);

  // Should not contain ANSI color codes
  expect(stderr).not.toContain("\u001b[");
  expect(stdout).not.toContain("\u001b[");

  // Should NOT contain individual test pass output
  expect(stderr).not.toContain("passing test 1");
  expect(stderr).not.toContain("passing test 2");

  // Should contain summary with counts
  expect(stderr).toContain("2 pass");
  expect(stderr).toContain("0 fail");

  // Should contain total test count
  expect(stderr).toContain("Ran 2 test");
});

test("--agent flag: with test filters", async () => {
  const dir = tempDirWithFiles("agent-test-4", {
    "test1.test.js": `
      import { test, expect } from "bun:test";
      
      test("matching test", () => {
        expect(1 + 1).toBe(2);
      });
      
      test("other test", () => {
        expect(2 + 2).toBe(4);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--agent", "-t", "matching"],
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Should exit with code 0 when filtered tests pass
  expect(exitCode).toBe(0);

  // Should not contain ANSI color codes
  expect(stderr).not.toContain("\u001b[");
  expect(stdout).not.toContain("\u001b[");

  // Should contain summary with counts (only 1 test should run)
  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("0 fail");

  // Should contain total test count
  expect(stderr).toContain("Ran 1 test");
});

test("--agent flag: with many failures (tests immediate output)", async () => {
  const dir = tempDirWithFiles("agent-test-5", {
    "fail1.test.js": `
      import { test, expect } from "bun:test";
      
      test("fail 1", () => {
        expect(1).toBe(2);
      });
    `,
    "fail2.test.js": `
      import { test, expect } from "bun:test";
      
      test("fail 2", () => {
        expect(2).toBe(3);
      });
    `,
    "fail3.test.js": `
      import { test, expect } from "bun:test";
      
      test("fail 3", () => {
        expect(3).toBe(4);
      });
    `,
    // Add many passing tests to trigger the repeat buffer logic
    ...Array.from({ length: 25 }, (_, i) => ({
      [`pass${i}.test.js`]: `
        import { test, expect } from "bun:test";
        
        test("pass ${i}", () => {
          expect(${i}).toBe(${i});
        });
      `,
    })).reduce((acc, obj) => ({ ...acc, ...obj }), {}),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--agent"],
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Should exit with code 1 because tests failed
  expect(exitCode).toBe(1);

  // Should not contain ANSI color codes
  expect(stderr).not.toContain("\u001b[");
  expect(stdout).not.toContain("\u001b[");

  // Should contain failure output (printed immediately)
  expect(stderr).toContain("fail 1");
  expect(stderr).toContain("fail 2");
  expect(stderr).toContain("fail 3");

  // Should NOT contain repeat buffer headers (since agent mode disables them)
  expect(stderr).not.toContain("tests failed:");

  // Should contain summary with counts
  expect(stderr).toContain("25 pass");
  expect(stderr).toContain("3 fail");

  // Should contain total test count
  expect(stderr).toContain("Ran 28 test");
});

test("normal mode vs agent mode comparison", async () => {
  const dir = tempDirWithFiles("agent-test-6", {
    "test.test.js": `
      import { test, expect } from "bun:test";
      
      test("passing test", () => {
        expect(1 + 1).toBe(2);
      });
      
      test("failing test", () => {
        expect(1 + 1).toBe(3);
      });
      
      test.skip("skipped test", () => {
        expect(1 + 1).toBe(2);
      });
    `,
  });

  // Run in normal mode
  await using normalProc = Bun.spawn({
    cmd: [bunExe(), "test"],
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [normalStdout, normalStderr, normalExitCode] = await Promise.all([
    new Response(normalProc.stdout).text(),
    new Response(normalProc.stderr).text(),
    normalProc.exited,
  ]);

  // Run in agent mode
  await using agentProc = Bun.spawn({
    cmd: [bunExe(), "test", "--agent"],
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [agentStdout, agentStderr, agentExitCode] = await Promise.all([
    new Response(agentProc.stdout).text(),
    new Response(agentProc.stderr).text(),
    agentProc.exited,
  ]);

  // Both should exit with the same code
  expect(normalExitCode).toBe(agentExitCode);
  expect(normalExitCode).toBe(1); // Because tests failed

  // Agent mode should not contain ANSI color codes (even if normal mode might not have them in CI)
  expect(agentStderr).not.toContain("\u001b[");

  // Normal mode should show individual test results, agent mode should not
  expect(normalStderr).toContain("(pass) passing test");
  expect(normalStderr).toContain("(skip) skipped test");
  expect(agentStderr).not.toContain("(pass) passing test");
  expect(agentStderr).not.toContain("(skip) skipped test");

  // Both should contain failure output
  expect(normalStderr).toContain("failing test");
  expect(agentStderr).toContain("failing test");

  // Both should contain summary counts
  expect(normalStderr).toContain("1 pass");
  expect(normalStderr).toContain("1 fail");
  expect(normalStderr).toContain("1 skip");
  expect(agentStderr).toContain("1 pass");
  expect(agentStderr).toContain("1 fail");
  expect(agentStderr).toContain("1 skip");
});
