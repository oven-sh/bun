import { spawnSync } from "bun";
import { afterEach, beforeAll, beforeEach, describe, expect, jest, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux, tempDir } from "harness";

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
    await using test_dir = tempDir(".", {
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
    await using test_dir = tempDir(".", {
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
    await using test_dir = tempDir(".", {
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
    using test_dir = tempDir(".", {
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
    using test_dir = tempDir(".", {
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

describe("a proxy of a function is a callback", () => {
  const ran: string[] = [];
  const proxy = (name: string) => new Proxy(() => void ran.push(name), {});
  describe("describe", new Proxy(() => test("test", proxy("test")), {}));
  describe("hooks", () => {
    beforeAll(proxy("beforeAll"));
    beforeEach(proxy("beforeEach"));
    afterEach(proxy("afterEach"));
    test("test with a timeout", proxy("test with a timeout"), 5000);
  });
  test("each ran", () => {
    expect(ran).toEqual(["test", "beforeAll", "beforeEach", "test with a timeout", "afterEach"]);
  });
  let error: Error | undefined;
  try {
    // @ts-expect-error
    test("a proxy where the options go", proxy("options"), () => {});
  } catch (thrown) {
    error = thrown as Error;
  }
  test("and not options", () => {
    expect(error?.message).toBe("test() expects options to be a number or object, not a function");
  });
});

test("deeply nested describe() doesn't overflow the native stack", async () => {
  // describe() callbacks run from a queue, so the JS stack limit doesn't stop the nesting.
  using test_dir = tempDir(".", {
    "describe-deep.test.js": `
      import { describe, test, expect } from "bun:test";

      let depth = 10000;
      function nest() {
        if (depth-- <= 0) {
          test("leaf", () => {
            expect(1).toBe(1);
          });
          return;
        }
        describe("d" + depth, nest);
      }
      nest();
    `,
  });
  const cmd = [bunExe(), "test", "./describe-deep.test.js"];
  await using proc = Bun.spawn({
    // Linux sizes the main thread's stack from `ulimit -s`.
    cmd: isLinux ? ["sh", "-c", `ulimit -s 1024 && exec "$@"`, "sh", ...cmd] : cmd,
    cwd: String(test_dir),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toInclude(" > d2 > d1 > d0 > leaf");
  expect(stderr).toInclude("\n 1 pass");
  expect(stderr).toInclude("\n 0 fail");
  expect(exitCode).toBe(0);
});

// A hook or a test of "vitest" can get Vitest's Suite of the describe() that it is in.
describe.concurrent("the Suite of a describe()", () => {
  async function runTests(files: Record<string, string>, stack?: "1 MB") {
    using test_dir = tempDir("describe-suite", files);
    const cmd = [bunExe(), "test"];
    await using proc = Bun.spawn({
      // Linux sizes the main thread's stack from `ulimit -s`.
      cmd: stack && isLinux ? ["sh", "-c", `ulimit -s 1024 && exec "$@"`, "sh", ...cmd] : cmd,
      cwd: String(test_dir),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { log: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), stderr, exitCode };
  }

  test("has the Suite of the describe() around it as its suite", async () => {
    const { log, stderr, exitCode } = await runTests({
      "a.test.js": `
        import { afterAll, describe, test } from "vitest";

        describe("a", () => {
          let a;
          afterAll(({}, suite) => console.log("afterAll of a:", suite === a, "suite" in suite, suite.file.file === suite.file));
          describe("b", () => {
            describe("c", () => {
              test("in c", ({ task }) => {
                a = task.suite.suite.suite;
                console.log(task.suite.name, task.suite.suite.name, a.name, task.file === a.file);
              });
            });
            test("in b", ({ task }) => console.log(task.suite.name, task.suite.suite === a));
          });
        });
      `,
    });
    expect(stderr).toInclude("\n 2 pass");
    expect({ log, exitCode }).toEqual({
      log: ["c b a true", "b true", "afterAll of a: true false true"],
      exitCode: 0,
    });
  });

  test("has the names of the file and of each describe() around it in its full names", async () => {
    const { log, stderr, exitCode } = await runTests({
      "dir/a.test.js": `
        import { beforeAll, describe, test } from "vitest";

        // The test, then each Suite around it: [name, fullTestName, fullName]
        function show({ task }) {
          for (let each = task; each; each = each.suite) console.log(JSON.stringify([each.name, each.fullTestName, each.fullName]));
        }
        test(show);
        describe("outer", () => {
          describe(() => {
            describe("é > 名", () => { test("named", show); });
          });
          describe("", () => {
            describe("", () => { test("", show); });
          });
        });
        describe(() => { test(show); });
        describe("", () => { test("in a describe() named the empty string", show); });
        describe("original", () => {
          beforeAll(({}, suite) => { suite.name = suite.fullTestName = suite.fullName = "assigned"; });
          describe("inner", () => { test("test", show); });
        });
        describe("after process.chdir()", () => {
          test("test", context => { process.chdir("dir"); show(context); });
        });
      `,
    });
    expect(stderr).toInclude("\n 7 pass");
    expect({ log, exitCode }).toEqual({
      log: [
        `["","","dir/a.test.js"]`,

        `["named","outer > é > 名 > named","dir/a.test.js > outer > é > 名 > named"]`,
        `["é > 名","outer > é > 名","dir/a.test.js > outer > é > 名"]`,
        `["","outer","dir/a.test.js > outer"]`,
        `["outer","outer","dir/a.test.js > outer"]`,

        `["","outer >  >  > ","dir/a.test.js > outer >  >  > "]`,
        `["","outer >  > ","dir/a.test.js > outer >  > "]`,
        `["","outer > ","dir/a.test.js > outer > "]`,
        `["outer","outer","dir/a.test.js > outer"]`,

        `["","","dir/a.test.js"]`,
        `["","","dir/a.test.js"]`,

        `["in a describe() named the empty string"," > in a describe() named the empty string","dir/a.test.js >  > in a describe() named the empty string"]`,
        `["","","dir/a.test.js > "]`,

        `["test","original > inner > test","dir/a.test.js > original > inner > test"]`,
        `["inner","original > inner","dir/a.test.js > original > inner"]`,
        `["assigned","assigned","assigned"]`,

        `["test","after process.chdir() > test","dir/a.test.js > after process.chdir() > test"]`,
        `["after process.chdir()","after process.chdir()","dir/a.test.js > after process.chdir()"]`,
      ],
      exitCode: 0,
    });
  });

  test("doesn't copy the names of the describe()s around it", async () => {
    const { log, stderr, exitCode } = await runTests({
      "a.test.js": `
        import { afterAll, describe, test } from "vitest";
        import { heapSize } from "bun:jsc";

        const tasks = [];
        let depth = 400;
        function nest() {
          if (depth-- <= 0) {
            for (let i = 0; i < 8; i++) test("test " + i, ({ task }) => void tasks.push(task));
            afterAll(({}, suite) => {
              let suites = 0;
              for (let outer = suite; outer; outer = outer.suite) suites++;
              Bun.gc(true);
              // Two full names of up to 400 names of 512 bytes in each of the 400 Suites would be 80 MB.
              const megabytes = heapSize() / 1024 / 1024;
              console.log(suites, tasks.length, megabytes < 8 ? "under 8 MB" : megabytes);
            });
            return;
          }
          describe(Buffer.alloc(512, "n").toString() + depth, nest);
        }
        nest();
      `,
    });
    expect(stderr).toInclude("\n 8 pass");
    expect({ log, exitCode }).toEqual({ log: ["400 8 under 8 MB"], exitCode: 0 });
  });

  // A Suite is built when a test or hook first needs it, with the Suite of each describe() around it that has none yet.
  describe("of a deeply nested describe() doesn't overflow the native stack", () => {
    // A debug build needs about 2 seconds for 10,000 levels. Its native frames are larger, so 2,000 overflowed 1 MB too.
    const levels = isDebug ? 2000 : 10000;

    test.each([
      { from: "vitest", title: "a test reads task", leaf: `test("leaf", ({ task }) => count(task.suite));` },
      { from: "vitest", title: "beforeAll", leaf: `beforeAll(({}, suite) => count(suite)); test("leaf", () => {});` },
      { from: "vitest", title: "afterAll", leaf: `afterAll(({}, suite) => count(suite)); test("leaf", () => {});` },
      {
        from: "vitest",
        title: "TestRunner.getCurrentTest()",
        leaf: `test("leaf", () => count(TestRunner.getCurrentTest().suite));`,
      },
      {
        from: "vitest",
        title: "a test.extend() fixture reads task",
        leaf: `
          const it = test.extend({ innermost: async ({ task }, use) => { await use(task.suite); } });
          it("leaf", ({ innermost }) => count(innermost));
        `,
      },
      {
        from: "bun:test",
        title: "aroundAll",
        leaf: `aroundAll(async (runSuite, {}, suite) => { count(suite); await runSuite(); }); test("leaf", () => {});`,
      },
      {
        from: "bun:test",
        title: "aroundEach at the top of the file",
        top: `aroundEach(async (runTest, context, suite) => { count(suite); await runTest(); });`,
        leaf: `test("leaf", () => {});`,
      },
      {
        from: "bun:test",
        title: "test.for reads task",
        leaf: `test.for([1])("leaf %i", (row, { task }) => count(task.suite));`,
      },
    ])('$title, from "$from"', async ({ from, leaf, top = "" }) => {
      const { log, stderr, exitCode } = await runTests(
        {
          "describe-deep.test.js": `
            import * as runner from "${from}";
            const { afterAll, aroundAll, aroundEach, beforeAll, describe, test, TestRunner } = runner;

            // Prints how many Suites there are from the innermost to the outermost.
            function count(suite) {
              let suites = 0;
              for (let outer = suite; outer; outer = outer.suite) suites++;
              console.log(suites);
            }
            ${top}
            let depth = ${levels};
            function nest() {
              if (depth-- <= 0) {
                ${leaf}
                return;
              }
              describe(nest);
            }
            nest();
          `,
        },
        "1 MB",
      );
      expect(stderr).toInclude("\n 1 pass");
      expect(stderr).toInclude("\n 0 fail");
      expect({ log, exitCode }).toEqual({ log: [String(levels)], exitCode: 0 });
    });

    test("and has its full names", async () => {
      const { log, stderr, exitCode } = await runTests(
        {
          "describe-deep.test.js": `
            import { describe, expect, test } from "vitest";

            const names = [];
            let depth = ${levels};
            function nest() {
              if (depth-- <= 0) {
                test("leaf", ({ task }) => {
                  expect(task.suite.fullTestName).toBe(names.join(" > "));
                  expect(task.suite.fullName).toBe([task.file.name, ...names].join(" > "));
                  expect(task.fullTestName).toBe([...names, "leaf"].join(" > "));
                  expect(task.fullName).toBe([task.file.name, ...names, "leaf"].join(" > "));
                  console.log(names.length);
                });
                return;
              }
              names.push("d" + depth);
              describe("d" + depth, nest);
            }
            nest();
          `,
        },
        "1 MB",
      );
      expect(stderr).toInclude("\n 1 pass");
      expect(stderr).toInclude("\n 0 fail");
      expect({ log, exitCode }).toEqual({ log: [String(levels)], exitCode: 0 });
    });
  });
});
