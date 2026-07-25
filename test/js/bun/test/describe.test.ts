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

describe("beforeAll/afterAll are pruned when a describe has no non-skipped tests", () => {
  // jest-circus only runs a describe's beforeAll/afterAll when the block contains at least
  // one test whose mode is not "skip". test.todo counts (hooks run); test.skip does not.
  test("all-skipped, nested-all-skipped, and empty describes don't run hooks", () => {
    const test_dir = tempDirWithFiles("describe-skip-hooks", {
      "hooks.test.js": `
        import { describe, test, beforeAll, afterAll } from "bun:test";
        const L = [];
        afterAll(() => console.log("HOOKLOG " + JSON.stringify(L)));

        describe("all-skipped", () => {
          beforeAll(() => void L.push("bA-allskip"));
          afterAll(() => void L.push("aA-allskip"));
          test.skip("a1", () => {});
          test.skip("a2", () => {});
        });

        describe("outer", () => {
          beforeAll(() => void L.push("bA-outer"));
          afterAll(() => void L.push("aA-outer"));
          describe("inner-allskip", () => {
            beforeAll(() => void L.push("bA-inner"));
            afterAll(() => void L.push("aA-inner"));
            test.skip("i1", () => {});
          });
        });

        describe("empty", () => {
          beforeAll(() => void L.push("bA-empty"));
          afterAll(() => void L.push("aA-empty"));
        });

        describe("all-todo", () => {
          beforeAll(() => void L.push("bA-alltodo"));
          afterAll(() => void L.push("aA-alltodo"));
          test.todo("t1");
        });

        describe("mixed", () => {
          beforeAll(() => void L.push("bA-mixed"));
          afterAll(() => void L.push("aA-mixed"));
          test.skip("s", () => {});
          test("n", () => void L.push("BODY-mixed"));
        });

        test("keep", () => void L.push("BODY-keep"));
      `,
    });

    const { stdout, stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "test", "hooks.test.js"],
      cwd: test_dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const out = stdout.toString();
    const err = stderr.toString();
    const hookLine = out.split("\n").find(l => l.startsWith("HOOKLOG "));
    expect(hookLine).toBeDefined();
    const log = JSON.parse(hookLine!.slice("HOOKLOG ".length));

    // jest 30 output for the same fixture:
    expect(log).toEqual(["bA-alltodo", "aA-alltodo", "bA-mixed", "BODY-mixed", "aA-mixed", "BODY-keep"]);

    // skipped tests are still reported
    expect(err).toInclude("all-skipped > a1");
    expect(err).toInclude("outer > inner-allskip > i1");
    expect(exitCode).toBe(0);
  });

  test("describe.skip, test.failing-only, and skip+todo mix keep jest parity", () => {
    const test_dir = tempDirWithFiles("describe-skip-hooks-parity", {
      "parity.test.js": `
        import { describe, test, beforeAll, afterAll } from "bun:test";
        const L = [];
        afterAll(() => console.log("HOOKLOG " + JSON.stringify(L)));

        describe.skip("dskip", () => {
          beforeAll(() => void L.push("bA-dskip"));
          afterAll(() => void L.push("aA-dskip"));
          test("t", () => {});
        });

        describe("all-failing", () => {
          beforeAll(() => void L.push("bA-allfailing"));
          afterAll(() => void L.push("aA-allfailing"));
          test.failing("f", () => { throw new Error("expected") });
        });

        describe("skip-plus-todo", () => {
          beforeAll(() => void L.push("bA-skipPlusTodo"));
          afterAll(() => void L.push("aA-skipPlusTodo"));
          test.skip("s", () => {});
          test.todo("t");
        });

        test("keep", () => void L.push("BODY-keep"));
      `,
    });

    const { stdout, exitCode } = spawnSync({
      cmd: [bunExe(), "test", "parity.test.js"],
      cwd: test_dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const out = stdout.toString();
    const hookLine = out.split("\n").find(l => l.startsWith("HOOKLOG "));
    expect(hookLine).toBeDefined();
    const log = JSON.parse(hookLine!.slice("HOOKLOG ".length));

    expect(log).toEqual(["bA-allfailing", "aA-allfailing", "bA-skipPlusTodo", "aA-skipPlusTodo", "BODY-keep"]);
    expect(exitCode).toBe(0);
  });
});
