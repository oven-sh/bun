import { spawnSync } from "bun";
import { beforeAll, describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles, tmpdirSync } from "harness";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

describe("bun test", () => {
  test("running a non-existent absolute file path is a 1 exit code", () => {
    const spawn = Bun.spawnSync({
      cmd: [bunExe(), "test", join(import.meta.dirname, "non-existent.test.ts")],
      env: bunEnv,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(spawn.exitCode).toBe(1);
  });
  test("can provide no arguments", () => {
    const stderr = runTest({
      args: [],
      input: [
        `
          import { test, expect } from "bun:test";
          test("test #1", () => {
            expect(true).toBe(true);
          });
        `,
        `
          import { test, expect } from "bun:test";
          test.todo("test #2");
        `,
        `
          import { test, expect } from "bun:test";
          test("test #3", () => {
            expect(true).toBe(false);
          });
        `,
      ],
    });
    expect(stderr).toContain("test #1");
    expect(stderr).toContain("test #2");
    expect(stderr).toContain("test #3");
  });
  test("can provide a relative file", () => {
    const path = join("path", "to", "relative.test.ts");
    const cwd = createTest(
      `
      import { test, expect } from "bun:test";
      test("${path}", () => {
        expect(true).toBe(true);
      });
    `,
      path,
    );
    const stderr = runTest({
      cwd,
      args: [path],
    });
    expect(stderr).toContain(path);
  });
  // This fails on macOS because /private/var symlinks to /var
  test.todo("can provide an absolute file", () => {
    const path = join("path", "to", "absolute.test.ts");
    const cwd = createTest(
      `
      import { test, expect } from "bun:test";
      test("${path}", () => {
        expect(true).toBe(true);
      });
    `,
      path,
    );
    const absolutePath = resolve(cwd, path);
    const stderr = runTest({
      cwd,
      args: [absolutePath],
    });
    expect(stderr).toContain(path);
  });
  test("can provide a relative directory", () => {
    const path = join("path", "to", "relative.test.ts");
    const dir = dirname(path);
    const cwd = createTest(
      `
      import { test, expect } from "bun:test";
      test("${dir}", () => {
        expect(true).toBe(true);
      });
    `,
      path,
    );
    const stderr = runTest({
      cwd,
      args: [dir],
    });
    expect(stderr).toContain(dir);
  });
  test.todo("can provide an absolute directory", () => {
    const path = join("path", "to", "absolute.test.ts");
    const cwd = createTest(
      `
      import { test, expect } from "bun:test";
      test("${path}", () => {
        expect(true).toBe(true);
      });
    `,
      path,
    );
    const absoluteDir = resolve(cwd, dirname(path));
    const stderr = runTest({
      cwd,
      args: [absoluteDir],
    });
    expect(stderr).toContain(path);
  });

  describe("when filters are provided", () => {
    let dir: string;
    beforeAll(() => {
      const makeTest = (name: string, pass = true) => `
      import { test, expect } from "bun:test";
      test("${name}", () => {
        expect(1).toBe(${pass ? 1 : 0});
      });
      `;
      dir = tempDirWithFiles("bun-test-filtering", {
        "foo.test.js": makeTest("foo"),
        bar: {
          "bar1.spec.tsx": makeTest("bar1"),
          "bar2.spec.ts": makeTest("bar2"),
        },
      });
    });

    it("if that filter is a path to a directory, will run all tests in that directory", () => {
      const stderr = runTest({ cwd: dir, args: ["./bar"] });
      expect(stderr).toContain("2 pass");
      expect(stderr).not.toContain("foo");
    });
  });

  test("works with require", () => {
    const stderr = runTest({
      args: [],
      input: [
        `
          const { test, expect } = require("bun:test");
          test("test #1", () => {
            expect().pass();
          })
        `,
      ],
    });
    expect(stderr).toContain("test #1");
  });
  test("works with dynamic import", () => {
    const stderr = runTest({
      args: [],
      input: `
        const { test, expect } = await import("bun:test");
        test("test #1", () => {
          expect().pass();
        })
      `,
    });
    expect(stderr).toContain("test #1");
  });
  test("works with cjs require", () => {
    const cwd = createTest(
      `
        const { test, expect } = require("bun:test");
        test("test #1", () => {
          expect().pass();
        })
      `,
      "test.test.cjs",
    );
    const stderr = runTest({
      cwd,
    });
    expect(stderr).toContain("test #1");
  });
  test("works with cjs dynamic import", () => {
    const cwd = createTest(
      `
        const { test, expect } = await import("bun:test");
        test("test #1", () => {
          expect().pass();
        })
      `,
      "test.test.cjs",
    );
    const stderr = runTest({
      cwd,
    });
    expect(stderr).toContain("test #1");
  });
  test.todo("can provide a mix of files and directories");
  describe("--rerun-each", () => {
    test.todo("can rerun with a default value");
    test.todo("can rerun with a provided value");
  });
  describe("--todo", () => {
    test("should not run todo by default", () => {
      const stderr = runTest({
        input: `
          import { test, expect } from "bun:test";
          test.todo("todo", async () => {
            console.error("should not run");
          });
        `,
      });
      expect(stderr).not.toContain("should not run");
    });
    test("should run todo when enabled", () => {
      const stderr = runTest({
        args: ["--todo"],
        input: `
          import { test, expect } from "bun:test";
          test.todo("todo", async () => {
            console.error("should run");
          });
        `,
      });
      expect(stderr).toContain("should run");
    });
  });
  describe("only", () => {
    test("should run nested describe.only", () => {
      const stderr = runTest({
        args: [],
        input: `
            import { test, describe } from "bun:test";
            describe("outer", () => {
              describe.only("inner (nested)", () => {
                test("test", () => {
                  console.error("reachable");
                })
              })
              describe("inner (skipped)", () => {
                test("test", () => {
                  console.error("unreachable");
                })
              })
            })
            `,
        env: { CI: "false" },
      });
      expect(stderr).toContain("reachable");
      expect(stderr).not.toContain("unreachable");
      expect(stderr.match(/reachable/g)).toHaveLength(1);
    });
    test("should skip non-only tests", () => {
      const stderr = runTest({
        args: [],
        input: `
          import { test, describe } from "bun:test";
          test("test #1", () => {
            console.error("unreachable");
          });
          test.only("test #2", () => {
            console.error("reachable");
          });
          test("test #3", () => {
            console.error("unreachable");
          });
          test.skip("test #4", () => {
            console.error("unreachable");
          });
          test.todo("test #5");
          describe("describe #1", () => {
            test("test #6", () => {
              console.error("unreachable");
            });
            test.only("test #7", () => {
              console.error("reachable");
            });
          });
          describe.only("describe #2", () => {
            test("test #8", () => {
              console.error("unreachable");
            });
            test.skip("test #9", () => {
              console.error("unreachable");
            });
            test.only("test #10", () => {
              console.error("reachable");
            });
          });
        `,
        env: { CI: "false" },
      });
      expect(stderr).toContain("reachable");
      expect(stderr).not.toContain("unreachable");
      expect(stderr.match(/reachable/g)).toHaveLength(3);
    });
  });
  describe("--bail", () => {
    test("must provide a number bail", () => {
      const stderr = runTest({
        args: ["--bail=foo"],
      });
      expect(stderr).toContain("expects a number");
    });

    test("must provide non-negative bail", () => {
      const stderr = runTest({
        args: ["--bail=-1"],
      });
      expect(stderr).toContain("expects a number");
    });

    test("should not be 0", () => {
      const stderr = runTest({
        args: ["--bail=0"],
      });
      expect(stderr).toContain("expects a number");
    });

    test("bail should be 1 by default", () => {
      const stderr = runTest({
        args: ["--bail"],
        input: `
          import { test, expect } from "bun:test";
          test("test #1", () => {
            expect(true).toBe(false);
          });
          test("test #2", () => {
            expect(true).toBe(true);
          });
        `,
      });
      expect(stderr).toContain("Bailed out after 1 failure");
      expect(stderr).not.toContain("test #2");
    });

    test("should bail out after 3 failures", () => {
      const stderr = runTest({
        args: ["--bail=3"],
        input: `
          import { test, expect } from "bun:test";
          test("test #1", () => {
            expect(true).toBe(false);
          });
          test("test #2", () => {
            expect(true).toBe(false);
          });
          test("test #3", () => {
            expect(true).toBe(false);
          });
          test("test #4", () => {
            expect(true).toBe(true);
          });
        `,
      });
      expect(stderr).toContain("Bailed out after 3 failures");
      expect(stderr).not.toContain("test #4");
    });
  });
  describe("--timeout", () => {
    test("must provide a number timeout", () => {
      const stderr = runTest({
        args: ["--timeout", "foo"],
      });
      expect(stderr).toContain("Invalid timeout");
    });
    test("must provide non-negative timeout", () => {
      const stderr = runTest({
        args: ["--timeout", "-1"],
      });
      expect(stderr).toContain("Invalid timeout");
    });
    // TODO: https://github.com/oven-sh/bun/issues/8069
    // This test crashes, which will pass because stderr contains "timed out"
    // but the crash can also mean it hangs, which will end up failing.
    // Possibly fixed by https://github.com/oven-sh/bun/pull/8076/files
    test("timeout can be set to 30ms", () => {
      const stderr = runTest({
        args: ["--timeout", "30"],
        input: `
          import { test, expect } from "bun:test";
          import { sleep } from "bun";
          test("ok", async () => {
            await expect(sleep(1)).resolves.toBeUndefined();
          });
          test("timeout", async () => {
            await expect(sleep(64)).resolves.toBeUndefined();
          });
        `,
      });
      expect(stderr).toHaveTestTimedOutAfter(30);
    });
    test("timeout should default to 5000ms", () => {
      const time = process.platform === "linux" ? 5005 : 5500;
      const stderr = runTest({
        input: `
          import { test, expect } from "bun:test";
          import { sleep } from "bun";
          test("timeout", async () => {
            await sleep(${time});
          });
        `,
      });
      expect(stderr).toHaveTestTimedOutAfter(5000);
    }, 10000);
  });
  describe("support for Github Actions", () => {
    test("should not group logs by default", () => {
      const stderr = runTest({
        env: {
          GITHUB_ACTIONS: undefined,
        },
      });
      expect(stderr).not.toContain("::group::");
      expect(stderr).not.toContain("::endgroup::");
    });
    test("should not group logs when disabled", () => {
      const stderr = runTest({
        env: {
          GITHUB_ACTIONS: "false",
        },
      });
      expect(stderr).not.toContain("::group::");
      expect(stderr).not.toContain("::endgroup::");
    });
    test("should group logs when enabled", () => {
      const stderr = runTest({
        env: {
          GITHUB_ACTIONS: "true",
        },
      });
      expect(stderr).toContain("::group::");
      expect(stderr.match(/::group::/g)).toHaveLength(1);
      expect(stderr).toContain("::endgroup::");
      expect(stderr.match(/::endgroup::/g)).toHaveLength(1);
    });
    test("should group logs with multiple files", () => {
      const stderr = runTest({
        input: [
          `
            import { test, expect } from "bun:test";
            test("pass", () => {
              expect(true).toBe(true);
            });
          `,
          `
            import { test, expect } from "bun:test";
            test.skip("skip", () => {});
          `,
          `
            import { test, expect } from "bun:test";
            test("fail", () => {
              expect(true).toBe(false);
            });
          `,
        ],
        env: {
          GITHUB_ACTIONS: "true",
        },
      });
      expect(stderr).toContain("::group::");
      expect(stderr.match(/::group::/g)).toHaveLength(3);
      expect(stderr).toContain("::endgroup::");
      expect(stderr.match(/::endgroup::/g)).toHaveLength(3);
    });
    test("should group logs with --rerun-each", () => {
      const stderr = runTest({
        args: ["--rerun-each", "3"],
        input: [
          `
            import { test, expect } from "bun:test";
            test("pass", () => {
              expect(true).toBe(true);
            });
          `,
          `
            import { test, expect } from "bun:test";
            test("fail", () => {
              expect(true).toBe(false);
            });
          `,
        ],
        env: {
          GITHUB_ACTIONS: "true",
        },
      });
      expect(stderr).toContain("::group::");
      expect(stderr.match(/::group::/g)).toHaveLength(6);
      expect(stderr).toContain("::endgroup::");
      expect(stderr.match(/::endgroup::/g)).toHaveLength(6);
    });
    test("should not annotate errors by default", () => {
      const stderr = runTest({
        input: `
          import { test, expect } from "bun:test";
          test("fail", () => {
            expect(true).toBe(false);
          });
        `,
        env: {
          GITHUB_ACTIONS: undefined,
        },
      });
      expect(stderr).not.toContain("::error");
    });
    test("should not annotate errors with inspect() by default", () => {
      const stderr = runTest({
        input: `
          import { test } from "bun:test";
          import { inspect } from "bun";
          test("inspect", () => {
            inspect(new TypeError());
            console.error(inspect(new TypeError()));
          });
        `,
        env: {
          GITHUB_ACTIONS: undefined,
        },
      });
      expect(stderr).not.toContain("::error");
    });
    test("should not annotate errors with inspect() when enabled", () => {
      const stderr = runTest({
        input: `
          import { test } from "bun:test";
          import { inspect } from "bun";
          test("inspect", () => {
            inspect(new TypeError());
            console.error(inspect(new TypeError()));
          });
        `,
        env: {
          GITHUB_ACTIONS: "true",
        },
      });
      expect(stderr).not.toContain("::error");
    });
    test("should annotate errors in the global scope", () => {
      const stderr = runTest({
        input: `
          throw new Error();
        `,
        env: {
          GITHUB_ACTIONS: "true",
        },
      });
      expect(stderr).toMatch(/::error file=.*,line=\d+,col=\d+,title=error::/);
    });
    test.each(["test", "describe"])("should annotate errors in a %s scope", type => {
      const stderr = runTest({
        input: `
          import { ${type} } from "bun:test";
          ${type}("fail", () => {
            throw new Error();
          });
        `,
        env: {
          GITHUB_ACTIONS: "true",
        },
      });
      expect(stderr).toMatch(/::error file=.*,line=\d+,col=\d+,title=error::/);
    });
    test.each(["beforeAll", "beforeEach", "afterEach", "afterAll"])("should annotate errors in a %s callback", type => {
      const stderr = runTest({
        input: `
          import { test, ${type} } from "bun:test";
          ${type}(() => {
            throw new Error();
          });
          test("test", () => {});
        `,
        env: {
          GITHUB_ACTIONS: "true",
        },
      });
      expect(stderr).toMatch(/::error file=.*,line=\d+,col=\d+,title=error::/);
    });
    test("should annotate errors with escaped strings", () => {
      const stderr = runTest({
        input: `
          import { test, expect } from "bun:test";
          test("fail", () => {
            expect(true).toBe(false);
          });
        `,
        env: {
          FORCE_COLOR: "1",
          GITHUB_ACTIONS: "true",
        },
      });
      expect(stderr).toMatch(/::error file=.*,line=\d+,col=\d+,title=.*::/);
      expect(stderr).toMatch(/error: expect\(received\)\.toBe\(expected\)/); // stripped ansi
      expect(stderr).toMatch(/Expected: false%0AReceived: true%0A/); // escaped newlines
    });
    test("should annotate errors without a stack", () => {
      const stderr = runTest({
        input: `
          import { test, expect } from "bun:test";
          test("fail", () => {
            throw "Oops!";
          });
        `,
        env: {
          FORCE_COLOR: "1",
          GITHUB_ACTIONS: "true",
        },
      });
      expect(stderr).toMatch(/::error file=.*,line=\d+,col=\d+,title=error: Oops!::/m);
    });
    test("should annotate a test timeout", () => {
      const stderr = runTest({
        input: `
          import { test } from "bun:test";
          test("time out", async () => {
            await Bun.sleep(1000);
          }, { timeout: 1 });
        `,
        env: {
          FORCE_COLOR: "1",
          GITHUB_ACTIONS: "true",
        },
      });
      expect(stderr).toMatch(/::error title=error: Test \"time out\" timed out after \d+ms::/);
    });
  });
  describe(".each", () => {
    test("should run tests with test.each", () => {
      const numbers = [
        [1, 2, 3],
        [1, 1, 2],
        [3, 4, 7],
      ];

      const stderr = runTest({
        args: [],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(numbers)})("%i + %i = %i", (a, b, e) => {
            expect(a + b).toBe(e);
          });
        `,
      });
      numbers.forEach(numbers => {
        expect(stderr).toContain(`${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
      });
    });
    test("should allow tests run with test.each to be skipped", () => {
      const numbers = [
        [1, 2, 3],
        [1, 1, 2],
        [3, 4, 7],
      ];

      const stderr = runTest({
        args: ["-t", "$a"],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(numbers)})("%i + %i = %i", (a, b, e) => {
            expect(a + b).toBe(e);
          });
        `,
      });
      numbers.forEach(numbers => {
        expect(stderr).not.toContain(`(pass) ${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
      });
    });
    test("should allow tests run with test.each to be matched", () => {
      const numbers = [
        [1, 2, 3],
        [1, 1, 2],
        [3, 4, 7],
      ];

      const stderr = runTest({
        args: ["-t", "1 \\+"],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(numbers)})("%i + %i = %i", (a, b, e) => {
            expect(a + b).toBe(e);
          });
        `,
      });
      numbers.forEach(numbers => {
        if (numbers[0] === 1) {
          expect(stderr).toContain(`(pass) ${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
        } else {
          expect(stderr).not.toContain(`(pass) ${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
        }
      });
    });
    test("should run tests with describe.each", () => {
      const numbers = [
        [1, 2, 3],
        [1, 1, 2],
        [3, 4, 7],
      ];

      const stderr = runTest({
        args: [],
        input: `
          import { test, expect, describe } from "bun:test";

          describe.each(${JSON.stringify(numbers)})("%i + %i = %i", (a, b, e) => {\
            test("addition", () => {
              expect(a + b).toBe(e);
            });
          });
        `,
      });
      numbers.forEach(numbers => {
        expect(stderr).toContain(`${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
      });
    });
    test("check formatting for %i", () => {
      const numbers = [
        [1, 2, 3],
        [1, 1, 2],
        [3, 4, 7],
      ];

      const stderr = runTest({
        args: [],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(numbers)})("%i + %i = %i", (a, b, e) => {
            expect(a + b).toBe(e);
          });
        `,
      });
      numbers.forEach(numbers => {
        expect(stderr).toContain(`${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
      });
    });
    test("check formatting for %f", () => {
      const numbers = [
        [1.4, 2.9, 4.3],
        [1, 1, 2],
        [3.1, 4.5, 7.6],
      ];

      const stderr = runTest({
        args: [],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(numbers)})("%f + %f = %d", (a, b, e) => {
            expect(a + b).toBe(e);
          });
        `,
      });
      numbers.forEach(numbers => {
        expect(stderr).toContain(`${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
      });
    });
    test("check formatting for %d", () => {
      const numbers = [
        [1.4, 2.9, 4.3],
        [1, 1, 2],
        [3.1, 4.5, 7.6],
      ];

      const stderr = runTest({
        args: [],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(numbers)})("%f + %f = %d", (a, b, e) => {
            expect(a + b).toBe(e);
          });
        `,
      });
      numbers.forEach(numbers => {
        expect(stderr).toContain(`${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
      });
    });
    test("check formatting for %s", () => {
      const strings = ["hello", "world", "foo"];

      const stderr = runTest({
        args: [],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(strings)})("with a string: %s", (s) => {
            expect(s).toBeType("string");
          });
        `,
      });
      strings.forEach(s => {
        expect(stderr).toContain(`with a string: ${s}`);
      });
    });
    test("check formatting for %j", () => {
      const input = [
        {
          foo: "bar",
          nested: {
            again: {
              a: 2,
            },
          },
        },
      ];

      const stderr = runTest({
        args: [],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(input)})("with an object: %o", (o) => {
            expect(o).toBe(o);
          });
        `,
      });
      expect(stderr).toContain(`with an object: ${JSON.stringify(input[0])}`);
    });
    test("check formatting for %o", () => {
      const input = [
        {
          foo: "bar",
          nested: {
            again: {
              a: 2,
            },
          },
        },
      ];

      const stderr = runTest({
        args: [],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(input)})("with an object: %o", (o) => {
            expect(o).toBe(o);
          });
        `,
      });
      expect(stderr).toContain(`with an object: ${JSON.stringify(input[0])}`);
    });
    test("check formatting for %#", () => {
      const numbers = [
        [1, 2, 3],
        [1, 1, 2],
        [3, 4, 7],
      ];

      const stderr = runTest({
        args: [],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(numbers)})("test number %#: %i + %i = %i", (a, b, e) => {
            expect(a + b).toBe(e);
          });
        `,
      });
      numbers.forEach((_, idx) => {
        expect(stderr).toContain(`test number ${idx}:`);
      });
    });
    test("check formatting for %%", () => {
      const numbers = [
        [1, 2, 3],
        [1, 1, 2],
        [3, 4, 7],
      ];

      const stderr = runTest({
        args: [],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(numbers)})("test number %#: %i + %i = %i %%", (a, b, e) => {
            expect(a + b).toBe(e);
          });
        `,
      });
      expect(stderr).toContain(`%`);
    });
    test.todo("check formatting for %p", () => {});

    describe("$variable syntax", () => {
      test("should replace $variables with object properties in test names", () => {
        const cases = [
          { a: 1, b: 2, expected: 3 },
          { a: 5, b: 5, expected: 10 },
          { a: -1, b: 1, expected: 0 },
        ];

        const stderr = runTest({
          args: [],
          input: `
            import { test, expect } from "bun:test";
            
            const cases = ${JSON.stringify(cases)};
            test.each(cases)('$a + $b = $expected', ({ a, b, expected }) => {
              expect(a + b).toBe(expected);
            });
          `,
        });

        expect(stderr).toContain("(pass) 1 + 2 = 3");
        expect(stderr).toContain("(pass) 5 + 5 = 10");
        expect(stderr).toContain("(pass) -1 + 1 = 0");
        expect(stderr).toContain("3 pass");
      });

      test("should show $variable literal when property doesn't exist", () => {
        const cases = [{ a: 1 }, { a: 2 }];

        const stderr = runTest({
          args: [],
          input: `
            import { test, expect } from "bun:test";
            
            const cases = ${JSON.stringify(cases)};
            test.each(cases)('value $a with missing $nonexistent', ({ a }) => {
              expect(a).toBeDefined();
            });
          `,
        });

        expect(stderr).toContain("(pass) value 1 with missing $nonexistent");
        expect(stderr).toContain("(pass) value 2 with missing $nonexistent");
        expect(stderr).toContain("2 pass");
      });

      test("should work with describe.each", () => {
        const cases = [
          { module: "fs", method: "readFile" },
          { module: "path", method: "join" },
        ];

        const stderr = runTest({
          args: [],
          input: `
            import { test, expect, describe } from "bun:test";
            
            const cases = ${JSON.stringify(cases)};
            describe.each(cases)('$module module', ({ module, method }) => {
              test('has $method', () => {
                const mod = require(module);
                expect(mod).toHaveProperty(method);
              });
            });
          `,
        });

        expect(stderr).toContain("fs module > has $method");
        expect(stderr).toContain("path module > has $method");
        expect(stderr).toContain("2 pass");
      });

      test("should work with complex property names", () => {
        const cases = [
          { user_name: "john_doe", age: 30, is_active: true },
          { user_name: "jane_smith", age: 25, is_active: false },
        ];

        const stderr = runTest({
          args: [],
          input: `
            import { test, expect } from "bun:test";
            
            const cases = ${JSON.stringify(cases)};
            test.each(cases)('user $user_name age $age active $is_active', ({ user_name, age, is_active }) => {
              expect(user_name).toBeDefined();
              expect(age).toBeGreaterThan(0);
              expect(typeof is_active).toBe('boolean');
            });
          `,
        });

        expect(stderr).toContain("(pass) user john_doe age 30 active true");
        expect(stderr).toContain("(pass) user jane_smith age 25 active false");
        expect(stderr).toContain("2 pass");
      });

      test("should coexist with % formatting for arrays", () => {
        const numbers = [
          [1, 2, 3],
          [5, 5, 10],
        ];

        const stderr = runTest({
          args: [],
          input: `
            import { test, expect } from "bun:test";
            
            test.each(${JSON.stringify(numbers)})('%i + %i = %i', (a, b, expected) => {
              expect(a + b).toBe(expected);
            });
          `,
        });

        expect(stderr).toContain("(pass) 1 + 2 = 3");
        expect(stderr).toContain("(pass) 5 + 5 = 10");
        expect(stderr).toContain("2 pass");
      });

      test("should support nested property access", () => {
        const cases = [
          {
            user: { name: "Alice", profile: { city: "NYC" } },
            expected: "Alice from NYC",
          },
          {
            user: { name: "Bob", profile: { city: "LA" } },
            expected: "Bob from LA",
          },
        ];

        const stderr = runTest({
          args: [],
          input: `
            import { test, expect } from "bun:test";
            
            const cases = ${JSON.stringify(cases)};
            test.each(cases)('$user.name from $user.profile.city', ({ user, expected }) => {
              expect(\`\${user.name} from \${user.profile.city}\`).toBe(expected);
            });
          `,
        });

        expect(stderr).toContain("(pass) Alice from NYC");
        expect(stderr).toContain("(pass) Bob from LA");
        expect(stderr).toContain("2 pass");
      });

      test("should support array indexing with dot notation", () => {
        const cases = [
          {
            users: [{ name: "Alice" }, { name: "Bob" }],
            first: "Alice",
          },
          {
            users: [{ name: "Carol" }, { name: "Dave" }],
            first: "Carol",
          },
        ];

        const stderr = runTest({
          args: [],
          input: `
            import { test, expect } from "bun:test";
            
            const cases = ${JSON.stringify(cases)};
            test.each(cases)('first user is $users.0.name', ({ users, first }) => {
              expect(users[0].name).toBe(first);
            });
          `,
        });

        expect(stderr).toContain("(pass) first user is Alice");
        expect(stderr).toContain("(pass) first user is Carol");
        expect(stderr).toContain("2 pass");
      });

      test("handles edge cases with underscores and invalid identifiers", () => {
        const cases = [
          {
            _valid: "underscore",
            $dollar: "dollar",
            _123mix: "mix",
            "123invalid": "invalid",
            "has-dash": "dash",
            "has space": "space",
          },
        ];

        const stderr = runTest({
          args: [],
          input: `
            import { test, expect } from "bun:test";
            
            const cases = ${JSON.stringify(cases)};
            test.each(cases)('Edge: $_valid | $$dollar | $_123mix | $123invalid | $has-dash | $has space', (obj) => {
              expect(obj).toBeDefined();
            });
          `,
        });

        expect(stderr).toContain("underscore");
        expect(stderr).toContain("dollar");
        expect(stderr).toContain("mix");
        expect(stderr).toContain("$123invalid");
        expect(stderr).toContain("$hasdash");
        expect(stderr).toContain("$hasspace");
      });

      test("handles deeply nested properties with arrays", () => {
        const cases = [
          {
            data: {
              users: [
                { name: "Alice", tags: ["admin", "user"] },
                { name: "Bob", tags: ["user"] },
              ],
              count: 2,
            },
          },
        ];

        const stderr = runTest({
          args: [],
          input: `
            import { test, expect } from "bun:test";
            
            const cases = ${JSON.stringify(cases)};
            test.each(cases)('First user: $data.users.0.name with tag: $data.users.0.tags.0', (obj) => {
              expect(obj).toBeDefined();
            });
          `,
        });

        expect(stderr).toContain("First user: Alice with tag: admin");
      });

      test("handles missing properties gracefully", () => {
        const cases = [{ a: 1 }];

        const stderr = runTest({
          args: [],
          input: `
            import { test, expect } from "bun:test";
            
            const cases = ${JSON.stringify(cases)};
            test.each(cases)('$a | $missing | $a.b.c | $a', ({ a }) => {
              expect(a).toBe(1);
            });
          `,
        });

        expect(stderr).toContain("1 | $missing| $a.b.c| 1");
      });
    });
  });

  test("Prints error when no test matches", () => {
    const stderr = runTest({
      args: ["-t", "not-a-test"],
      input: `
        import { test, expect } from "bun:test";
        test("test", () => {});
      `,
      expectExitCode: 1,
    });
    expect(
      stderr
        .replace(/bun-test-(.*)\.test\.ts/, "bun-test-*.test.ts")
        .trim()
        .replace(/\[.*\ms\]/, "[xx ms]"),
    ).toMatchInlineSnapshot(`
      "bun-test-*.test.ts:

      error: regex "not-a-test" matched 0 tests. Searched 1 file (skipping 1 test) [xx ms]"
    `);
  });

  test("Does not print the regex error when a test fails", () => {
    const stderr = runTest({
      args: ["-t", "not-a-test"],
      input: `
        import { test, expect } from "bun:test";
        test("not-a-test", () => {
          expect(false).toBe(true);
        });
      `,
      expectExitCode: 1,
    });
    expect(stderr).not.toContain("error: regex");
    expect(stderr).toContain("1 fail");
  });

  test("Does not print the regex error when a test matches and a test passes", () => {
    const stderr = runTest({
      args: ["-t", "not-a-test"],
      input: `
        import { test, expect } from "bun:test";
        test("not-a-test", () => {
          expect(false).toBe(true); 
        });
        test("not-a-test", () => {
          expect(true).toBe(true);
        });
      `,
      expectExitCode: 1,
    });
    expect(stderr).not.toContain("error: regex");
    expect(stderr).toContain("1 fail");
    expect(stderr).toContain("1 pass");
  });

  test("path to a non-test.ts file will work", () => {
    const stderr = runTest({
      args: ["./index.ts"],
      input: [
        {
          filename: "index.ts",
          contents: `
            import { test, expect } from "bun:test";
            test("test #1", () => {
              expect(true).toBe(true);
            });
          `,
        },
      ],
    });
    expect(stderr).toContain("test #1");
  });

  test("path to a non-test.ts without ./ will print a helpful hint", () => {
    const stderr = runTest({
      args: ["index.ts"],
      input: [
        {
          filename: "index.ts",
          contents: `
            import { test, expect } from "bun:test";
            test("test #1", () => {
              expect(true).toBe(true);
            });
          `,
        },
      ],
    });
    expect(stderr).not.toContain("test #1");
    expect(stderr).toContain("index.ts");
  });

  test("Skipped and todo tests are filtered out when not matching -t filter", () => {
    const stderr = runTest({
      args: ["-t", "should match"],
      input: `
        import { test, describe } from "bun:test";

        describe("group 1", () => {
          test("should match filter", () => {
            console.log("this test should run");
          });

          test("should not match filter", () => {
            console.log("this test should be filtered out");
          });

          test.skip("skipped test that should not match", () => {
            console.log("this skipped test should be filtered out");
          });

          test.todo("todo test that should not match", () => {
            console.log("this todo test should be filtered out");
          });
        });

        describe("group 2", () => {
          test("another test that should match filter", () => {
            console.log("this test should run");
          });

          test.skip("another skipped test", () => {
            console.log("this skipped test should be filtered out");
          });

          test.todo("another todo test", () => {
            console.log("this todo test should be filtered out");
          });
        });
      `,
    });
    expect(
      stderr
        .replace(/bun-test-(.*)\.test\.ts/, "bun-test-*.test.ts")
        .replace(/ \[[\d.]+ms\]/g, "") // Remove all timings
        .replace(/Ran \d+ tests across \d+ files?\.\s*$/, "Ran 2 tests across 1 file.") // Normalize test counts
        .trim(),
    ).toMatchInlineSnapshot(`
      "bun-test-*.test.ts:
      (pass) group 1 > should match filter
      (pass) group 2 > another test that should match filter

       2 pass
       5 filtered out
       0 fail
      Ran 2 tests across 1 file."
    `);
  });

  test("--tsconfig-override works", () => {
    const dir = tempDirWithFiles("test-tsconfig-override", {
      "math.test.ts": `
        import { describe, test, expect } from "bun:test";
        import { add } from "@utils/math";
        
        describe("math", () => {
          test("addition", () => {
            expect(add(2, 3)).toBe(5);
          });
        });
      `,
      "src/math.ts": `
        export function add(a: number, b: number) {
          return a + b;
        }
      `,
      "tsconfig.json": `
        {
          "compilerOptions": {
            "paths": {
              "@utils/*": ["./wrong/*"]
            }
          }
        }
      `,
      "test-tsconfig.json": `
        {
          "compilerOptions": {
            "paths": {
              "@utils/*": ["./src/*"]
            }
          }
        }
      `,
    });

    // Test without --tsconfig-override (should fail)
    const failResult = spawnSync({
      cmd: [bunExe(), "test", "math.test.ts"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(failResult.exitCode).not.toBe(0);
    expect(failResult.stderr?.toString() || "").toContain("Cannot find module");

    // Test with --tsconfig-override (should succeed)
    const successResult = spawnSync({
      cmd: [bunExe(), "test", "--tsconfig-override", "test-tsconfig.json", "math.test.ts"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(successResult.exitCode).toBe(0);
    const stdout = successResult.stdout?.toString() || "";
    const stderr = successResult.stderr?.toString() || "";
    const output = stdout + stderr;
    expect(output).toContain("1 pass");
    expect(output).toContain("addition");
  });

  test("--tsconfig-override works with monorepo spec tsconfig", () => {
    const dir = tempDirWithFiles("test-tsconfig-monorepo", {
      "packages/app/src/index.ts": `
        export function getMessage() {
          return "Hello from app";
        }
      `,
      "packages/app/src/index.test.ts": `
        import { test, expect } from "bun:test";
        import { getMessage } from "@app/index";
        import { formatMessage } from "@shared/utils";
        
        test("app message", () => {
          expect(getMessage()).toBe("Hello from app");
          expect(formatMessage("test")).toBe("Formatted: test");
        });
      `,
      "packages/shared/utils.ts": `
        export function formatMessage(msg: string) {
          return "Formatted: " + msg;
        }
      `,
      "packages/app/tsconfig.json": `
        {
          "compilerOptions": {
            "paths": {
              "@app/*": ["./src/*"]
            }
          }
        }
      `,
      "packages/app/tsconfig.spec.json": `
        {
          "extends": "./tsconfig.json",
          "compilerOptions": {
            "baseUrl": "../..",
            "paths": {
              "@app/*": ["packages/app/src/*"],
              "@shared/*": ["packages/shared/*"]
            }
          }
        }
      `,
    });

    const result = spawnSync({
      cmd: [
        bunExe(),
        "test",
        "--tsconfig-override",
        "./packages/app/tsconfig.spec.json",
        "./packages/app/src/index.test.ts",
      ],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const stdout = result.stdout?.toString() || "";
    const stderr = result.stderr?.toString() || "";
    const output = stdout + stderr;
    expect(output).toContain("1 pass");
    expect(output).toContain("app message");
  });
});

function createTest(input?: string | (string | { filename: string; contents: string })[], filename?: string): string {
  const cwd = tmpdirSync();
  const inputs = Array.isArray(input) ? input : [input ?? ""];
  for (const input of inputs) {
    const contents = typeof input === "string" ? input : input.contents;
    const name = typeof input === "string" ? (filename ?? `bun-test-${Math.random()}.test.ts`) : input.filename;

    const path = join(cwd, name);
    try {
      writeFileSync(path, contents);
    } catch {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
    }
  }
  return cwd;
}

function runTest({
  input = "",
  cwd,
  args = [],
  env = {},
  expectExitCode = undefined,
}: {
  input?: string | (string | { filename: string; contents: string })[];
  cwd?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  expectExitCode?: number;
} = {}): string {
  cwd ??= createTest(input);
  try {
    const { stderr, exitCode } = spawnSync({
      cwd,
      cmd: [bunExe(), "test", ...args],
      env: { ...bunEnv, AGENT: "0", ...env },
      stderr: "pipe",
      stdout: "ignore",
    });
    if (expectExitCode !== undefined) {
      expect(exitCode).toBe(expectExitCode);
    }
    return stderr.toString();
  } finally {
    rmSync(cwd, { recursive: true });
  }
}
