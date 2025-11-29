import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

// Test for issue #5228: Implement xit, xtest, xdescribe aliases for test.skip
test("xit, xtest, and xdescribe aliases should work as test.skip/describe.skip", async () => {
  const testFile = `
// Test xit alias
xit("should be skipped with xit", () => {
  throw new Error("This should not run");
});

// Test xtest alias  
xtest("should be skipped with xtest", () => {
  throw new Error("This should not run");
});

// Test xdescribe alias
xdescribe("skipped describe block", () => {
  test("nested test should be skipped", () => {
    throw new Error("This should not run");
  });
});

// Regular test to ensure normal functionality still works
test("should run normally", () => {
  expect(1 + 1).toBe(2);
});

// Regular describe to ensure normal functionality still works
describe("normal describe block", () => {
  test("nested test should run", () => {
    expect(2 + 2).toBe(4);
  });
});
`;

  const dir = tempDirWithFiles("issue-5228-test-1", {
    "test.js": testFile,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./test.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Test should pass (exit code 0) even though some tests are skipped
  expect(exitCode).toBe(0);

  // Should have no errors since skipped tests don't run
  expect(stderr).not.toContain("This should not run");
});

test("xit and xtest should behave identically to test.skip", async () => {
  const testFile = `
test.skip("regular skip", () => {
  throw new Error("Should not run");
});

xit("xit skip", () => {
  throw new Error("Should not run");
});

xtest("xtest skip", () => {
  throw new Error("Should not run"); 
});

test("passing test", () => {
  expect(true).toBe(true);
});
`;

  const dir = tempDirWithFiles("issue-5228-test-2", {
    "test.js": testFile,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./test.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);

  // No errors should occur
  expect(stderr).not.toContain("Should not run");
});

test("xdescribe should behave identically to describe.skip", async () => {
  const testFile = `
describe.skip("regular describe skip", () => {
  test("should not run", () => {
    throw new Error("Should not run");
  });
});

xdescribe("xdescribe skip", () => {
  test("should not run", () => {
    throw new Error("Should not run");
  });
  
  describe("nested describe", () => {
    test("should also not run", () => {
      throw new Error("Should not run");
    });
  });
});

describe("normal describe", () => {
  test("should run", () => {
    expect(true).toBe(true);
  });
});
`;

  const dir = tempDirWithFiles("issue-5228-test-3", {
    "test.js": testFile,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./test.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);

  // No errors should occur
  expect(stderr).not.toContain("Should not run");
});

test("aliases should be available in bun:test import", async () => {
  const testFile = `
import { test, expect, xit, xtest, xdescribe } from "bun:test";

// These should all be functions
test("aliases should be functions", () => {
  expect(typeof xit).toBe("function");
  expect(typeof xtest).toBe("function"); 
  expect(typeof xdescribe).toBe("function");
});

// They should work when imported
xit("imported xit should work", () => {
  throw new Error("Should not run");
});

xtest("imported xtest should work", () => {
  throw new Error("Should not run");
});

xdescribe("imported xdescribe should work", () => {
  test("should not run", () => {
    throw new Error("Should not run");
  });
});
`;

  const dir = tempDirWithFiles("issue-5228-test-4", {
    "test.js": testFile,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./test.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);

  // No errors should occur
  expect(stderr).not.toContain("Should not run");
});
