import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

describe("bun test", () => {
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
  describe("--only", () => {
    test("should run nested describe.only when enabled", () => {
      const stderr = runTest({
        args: ["--only"],
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
      });
      expect(stderr).toContain("reachable");
      expect(stderr).not.toContain("unreachable");
      expect(stderr.match(/reachable/g)).toHaveLength(1);
    });
    test("should skip non-only tests when enabled", () => {
      const stderr = runTest({
        args: ["--only"],
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
              console.error("reachable");
            });
            test.skip("test #9", () => {
              console.error("unreachable");
            });
            test.only("test #10", () => {
              console.error("reachable");
            });
          });
        `,
      });
      expect(stderr).toContain("reachable");
      expect(stderr).not.toContain("unreachable");
      expect(stderr.match(/reachable/g)).toHaveLength(4);
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
      expect(stderr).toMatch(/::error title=error: Oops!::/);
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
        expect(stderr).not.toContain(`${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
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
          expect(stderr).toContain(`${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
        } else {
          expect(stderr).not.toContain(`${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
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
}: {
  input?: string | (string | { filename: string; contents: string })[];
  cwd?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
} = {}): string {
  cwd ??= createTest(input);
  try {
    const { stderr } = spawnSync({
      cwd,
      cmd: [bunExe(), "test", ...args],
      env: { ...bunEnv, ...env },
      stderr: "pipe",
      stdout: "ignore",
    });
    return stderr.toString();
  } finally {
    rmSync(cwd, { recursive: true });
  }
}
