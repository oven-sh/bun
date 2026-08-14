import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test.concurrent("only-failures flag should show only failures", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/only-failures.fixture.ts", "--only-failures"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect({
    exitCode,
    stdout: normalizeBunSnapshot(stdout),
    stderr: normalizeBunSnapshot(stderr),
  }).toMatchInlineSnapshot(`
    {
      "exitCode": 1,
      "stderr": 
    "test/js/bun/test/only-failures.fixture.ts:
     7 | test("passing test 2", () => {
     8 |   expect(2 + 2).toBe(4);
     9 | });
    10 | 
    11 | test("failing test", () => {
    12 |   expect(1 + 1).toBe(3);
                         ^
    error: expect(received).toBe(expected)

    Expected: 3
    Received: 2
        at <anonymous> (file:NN:NN)
    (fail) failing test
    21 | });
    22 | 
    23 | test.todo("todo test");
    24 | 
    25 | test("another failing test", () => {
    26 |   throw new Error("This test fails");
                                            ^
    error: This test fails
        at <anonymous> (file:NN:NN)
    (fail) another failing test

     3 pass
     1 skip
     1 todo
     2 fail
     4 expect() calls
    Ran 7 tests across 1 file."
    ,
      "stdout": "bun test <version> (<revision>)",
    }
  `);
});

test.concurrent("only-failures flag should work with multiple files", async () => {
  const result = await Bun.spawn({
    cmd: [
      bunExe(),
      "test",
      import.meta.dir + "/printing/dots/dots1.fixture.ts",
      import.meta.dir + "/only-failures.fixture.ts",
      "--only-failures",
    ],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect(exitCode).toBe(1);
  expect(normalizeBunSnapshot(stderr)).toContain("(fail) failing test");
  expect(normalizeBunSnapshot(stderr)).toContain("(fail) another failing test");
  expect(normalizeBunSnapshot(stderr)).not.toContain("(pass)");
});

test.concurrent("only-failures should work via bunfig.toml", async () => {
  using dir = tempDir("bunfig-only-failures", {
    "bunfig.toml": `
[test]
onlyFailures = true
`,
    "my.test.ts": `
import { test, expect } from "bun:test";

test("passing test", () => {
  expect(1 + 1).toBe(2);
});

test("failing test", () => {
  expect(1 + 1).toBe(3);
});

test("another passing test", () => {
  expect(true).toBe(true);
});
`,
  });

  const result = await Bun.spawn({
    cmd: [bunExe(), "test"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
    cwd: String(dir),
  });

  const exitCode = await result.exited;
  const stderr = await result.stderr.text();

  expect(exitCode).toBe(1);
  // Should only show the failing test
  expect(normalizeBunSnapshot(stderr, dir)).toContain("(fail) failing test");
  // Should not show passing tests
  expect(normalizeBunSnapshot(stderr, dir)).not.toContain("(pass)");
});
