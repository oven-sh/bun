import { spawnSync } from "bun";
import { describe, expect, jest, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir, tempDirWithFiles } from "harness";

describe("blocks should handle a number, string, anonymous class, named class, or function for the first arg", () => {
  const numberMock = jest.fn();
  const stringMock = jest.fn();
  const anonymousClassMock = jest.fn();
  const namedClassMock = jest.fn();
  const functionMock = jest.fn();

  describe(1, () => {
    test("Should also pass", () => {
      numberMock();
    });
  });

  describe("string arg", () => {
    test("Should also pass", () => {
      stringMock();
    });
  });

  const MyClass = class {};

  describe(MyClass, () => {
    test("Should also pass", () => {
      anonymousClassMock();
    });
  });

  const MyRectangle = class Rectangle {};

  describe(MyRectangle, () => {
    test("Should also pass", () => {
      namedClassMock();
    });
  });

  function add(a: number, b: number) {
    return a + b;
  }

  describe(add, () => {
    test("should pass", () => {
      functionMock();
    });
  });

  test("All mocks should be called", () => {
    expect(numberMock).toBeCalled();
    expect(stringMock).toBeCalled();
    expect(anonymousClassMock).toBeCalled();
    expect(namedClassMock).toBeCalled();
    expect(functionMock).toBeCalled();
  });
});

describe("describe blocks should handle a class or function for the first value and a named function for the second", () => {
  const MyClass = class {};
  const mock = jest.fn();
  describe(MyClass, function myFunc() {
    test("should pass", () => {
      mock();
      expect(mock).toHaveBeenCalled();
    });
  });
});

describe("a named function should work for the second arg", () => {
  const huh = jest.fn();

  test("should work", function test() {
    huh();
    expect(huh).toHaveBeenCalled(); // Move the expectation inside the test function
  });
});

describe("shows first arg name correctly in test output", () => {
  test("describe block shows function name correctly in test output", async () => {
    const test_dir = tempDirWithFiles(".", {
      "describe-test.test.js": `
      import { describe, test, expect } from "bun:test";

      function add(a, b) {
        return a + b;
      }

      describe(add, () => {
        test("should pass", () => {
          expect(true).toBe(true);
        });
      });
      `,
    });

    const { stdout, stderr } = spawnSync({
      cmd: [bunExe(), "test", "describe-test.test.js"],
      cwd: test_dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const fullOutput = stdout.toString() + stderr.toString();

    expect(fullOutput).toInclude("add > should pass");
    expect(fullOutput).not.toInclude("[object Object] > should pass");
  });
  test("describe block shows named class correctly in test output", async () => {
    const test_dir = tempDirWithFiles(".", {
      "describe-test.test.js": `
      import { describe, test, expect } from "bun:test";

      const MyClass = class Rectangle {};

      describe(MyClass, () => {
        test("should pass", () => {
          expect(true).toBe(true);
        });
      });
      `,
    });
    const { stdout, stderr } = spawnSync({
      cmd: [bunExe(), "test", "describe-test.test.js"],
      cwd: test_dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const fullOutput = stdout.toString() + stderr.toString();

    expect(fullOutput).toInclude("Rectangle > should pass");
    expect(fullOutput).not.toInclude("[object Object] > should pass");
    expect(fullOutput).not.toInclude("MyClass > should pass");
  });

  test("describe block shows anonymous class correctly in test output", async () => {
    const test_dir = tempDirWithFiles(".", {
      "describe-test.test.js": `
      import { describe, test, expect } from "bun:test";

      const MyClass = class {};

      describe(MyClass, () => {
        test("should pass", () => {
          expect(true).toBe(true);
        });
      });
      `,
    });
    const { stdout, stderr } = spawnSync({
      cmd: [bunExe(), "test", "describe-test.test.js"],
      cwd: test_dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const fullOutput = stdout.toString() + stderr.toString();

    expect(fullOutput).toInclude("MyClass > should pass");
    expect(fullOutput).not.toInclude("[object Object] > should pass");
  });
});

describe("passing arrow function as args", () => {
  test("passes if sole argument", () => {
    const test_dir = tempDirWithFiles(".", {
      "describe-test.test.js": `
      import { describe, test, expect } from "bun:test";

      describe(() => {
        test("should pass", () => {
          expect(true).toBe(true);
        });
      });
      `,
    });
    const { stdout, stderr } = spawnSync({
      cmd: [bunExe(), "test", "describe-test.test.js"],
      cwd: test_dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const fullOutput = stdout.toString() + stderr.toString();

    expect(fullOutput).toInclude("should pass");
    expect(fullOutput).toInclude("1 pass");
    expect(fullOutput).toInclude("0 fail");
  });
  test("throws an error if two arguments", () => {
    const test_dir = tempDirWithFiles(".", {
      "describe-test.test.js": `
      import { describe, test, expect } from "bun:test";



      describe(() => {}, () => {
        test("should NOT pass", () => {
          expect(true).toBe(true);
        });
      });
      `,
    });
    const { stdout, stderr } = spawnSync({
      cmd: [bunExe(), "test", "describe-test.test.js"],
      cwd: test_dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const fullOutput = stdout.toString() + stderr.toString();

    expect(fullOutput).toInclude(
      "error: describe() expects first argument to be a named class, named function, number, or string",
    );
    expect(fullOutput).toInclude("0 pass");
    expect(fullOutput).toInclude("1 fail");
  });
});

// Regression test for #8768
test("issue #8768: describe.todo() doesn't fail when todo test passes", async () => {
  using dir = tempDir("issue-08768", {
    "describe-todo.test.js": `
import { describe, test, expect } from "bun:test";

describe.todo("E", () => {
    test("E", () => { expect("hello").toBe("hello") })
});
    `.trim(),
    "test-todo.test.js": `
import { test, expect } from "bun:test";

test.todo("E", () => { expect("hello").toBe("hello") });
    `.trim(),
  });

  // Run describe.todo() with --todo flag
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "test", "--todo", "describe-todo.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

  // Run test.todo() with --todo flag for comparison
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "test", "--todo", "test-todo.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

  // test.todo() correctly fails when the test passes (expected behavior)
  expect(exitCode2).not.toBe(0);
  const output2 = stdout2 + stderr2;
  expect(output2).toContain("todo");
  expect(output2).toMatch(/this test is marked as todo but passes/i);
  expect(exitCode1).toBe(1);

  const output1 = stdout1 + stderr1;
  expect(output1).toContain("todo");
  expect(output1).toMatch(/this test is marked as todo but passes/i);
});

// Regression test for #19875
test("issue #19875: describe.only with nested describe.todo", async () => {
  using dir = tempDir("issue-19875", {
    "19875.test.ts": `
import { describe, it, expect } from "bun:test";

describe.only("only", () => {
  describe.todo("todo", () => {
    it("fail", () => {
      expect(2).toBe(3);
    });
  });
});
    `.trim(),
  });

  const result = Bun.spawn({
    cmd: [bunExe(), "test", "19875.test.ts"],
    stdout: "pipe",
    stderr: "pipe",
    cwd: String(dir),
    env: { ...bunEnv, CI: "false" }, // tests '.only()'
  });
  const exitCode = await result.exited;
  const stderr = await result.stderr.text();

  expect(exitCode).toBe(0);
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "19875.test.ts:
    (todo) only > todo > fail

     0 pass
     1 todo
     0 fail
    Ran 1 test across 1 file."
  `);
});
