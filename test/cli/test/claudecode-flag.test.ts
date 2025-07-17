import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles, normalizeBunSnapshot } from "harness";
import { spawnSync } from "bun";

test("CLAUDECODE=0 shows normal test output", async () => {
  const dir = tempDirWithFiles("claudecode-test-normal", {
    "test1.test.js": `
      import { test, expect } from "bun:test";
      
      test("passing test", () => {
        expect(1).toBe(1);
      });
      
      test("failing test", () => {
        expect(1).toBe(2);
      });
      
      test.skip("skipped test", () => {
        expect(1).toBe(1);
      });
      
      test.todo("todo test");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test1.test.js"],
    env: { ...bunEnv, CLAUDECODE: "0" },
    cwd: dir,
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const output = stderr + stdout;
  const normalized = normalizeBunSnapshot(output, dir);

  expect(normalized).toMatchSnapshot();
});

test("CLAUDECODE=1 shows quiet test output (only failures)", async () => {
  const dir = tempDirWithFiles("claudecode-test-quiet", {
    "test2.test.js": `
      import { test, expect } from "bun:test";
      
      test("passing test", () => {
        expect(1).toBe(1);
      });
      
      test("failing test", () => {
        expect(1).toBe(2);
      });
      
      test.skip("skipped test", () => {
        expect(1).toBe(1);
      });
      
      test.todo("todo test");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test2.test.js"],
    env: { ...bunEnv, CLAUDECODE: "1" },
    cwd: dir,
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const output = stderr + stdout;
  const normalized = normalizeBunSnapshot(output, dir);

  expect(normalized).toMatchSnapshot();
});

test("CLAUDECODE=1 vs CLAUDECODE=0 comparison", async () => {
  const dir = tempDirWithFiles("claudecode-test-compare", {
    "test3.test.js": `
      import { test, expect } from "bun:test";
      
      test("passing test", () => {
        expect(1).toBe(1);
      });
      
      test("another passing test", () => {
        expect(2).toBe(2);
      });
      
      test.skip("skipped test", () => {
        expect(1).toBe(1);
      });
      
      test.todo("todo test");
    `,
  });

  // Run with CLAUDECODE=0 (normal output)
  const result1 = spawnSync({
    cmd: [bunExe(), "test", "test3.test.js"],
    env: { ...bunEnv, CLAUDECODE: "0" },
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  // Run with CLAUDECODE=1 (quiet output)
  const result2 = spawnSync({
    cmd: [bunExe(), "test", "test3.test.js"],
    env: { ...bunEnv, CLAUDECODE: "1" },
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const normalOutput = result1.stderr.toString() + result1.stdout.toString();
  const quietOutput = result2.stderr.toString() + result2.stdout.toString();


  // Normal output should contain pass/skip/todo indicators
  expect(normalOutput).toContain("(pass)"); // pass indicator
  expect(normalOutput).toContain("(skip)"); // skip indicator  
  expect(normalOutput).toContain("(todo)"); // todo indicator

  // Quiet output should NOT contain pass/skip/todo indicators (only failures)
  expect(quietOutput).not.toContain("(pass)"); // pass indicator
  expect(quietOutput).not.toContain("(skip)"); // skip indicator
  expect(quietOutput).not.toContain("(todo)"); // todo indicator

  // Both should contain the summary at the end
  expect(normalOutput).toContain("2 pass");
  expect(normalOutput).toContain("1 skip");
  expect(normalOutput).toContain("1 todo");
  
  expect(quietOutput).toContain("2 pass");
  expect(quietOutput).toContain("1 skip");
  expect(quietOutput).toContain("1 todo");
});