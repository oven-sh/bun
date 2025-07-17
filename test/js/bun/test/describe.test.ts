import { spawnSync } from "bun";
import { describe, expect, jest, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

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
