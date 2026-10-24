import { spawnSync } from "bun";
import { beforeAll, describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, isWindows, tempDir, tempDirWithFiles, tmpdirSync } from "harness";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

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

  test.each([
    ["arrays and objects", "i % 2 ? [value] : { a: value }"],
    ["instances of a class", "new (class A { a = value; })()"],
    ["JSX children", `{ $$typeof: Symbol.for("react.element"), type: "div", props: { children: value } }`],
    ["JSX props", `{ $$typeof: Symbol.for("react.element"), type: "div", props: { a: value } }`],
    ["the data of events", `new MessageEvent("message", { data: value })`],
    ["asymmetric matchers", "expect.objectContaining({ a: value })"],
  ])("%s nested too deeply to print are a RangeError", (_, wrap) => {
    const stderr = runTest({
      input: `
        import { test, expect } from "bun:test";
        function thrownFor(depth) {
          let value = 1;
          for (let i = 0; i < depth; i++) value = ${wrap};
          try {
            expect(value).toMatchInlineSnapshot('"x"');
          } catch (error) {
            return error.constructor.name;
          }
        }
        test("deep", () => {
          expect([thrownFor(10), thrownFor(100_000)]).toEqual(["Error", "RangeError"]);
        });
      `,
      expectExitCode: 0,
    });
    expect(stderr).toContain("1 pass");
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

    // The failure is reported from a promise reaction, so the exit starts inside a JS frame.
    test.skipIf(!isASAN)("tears down the VM without leaks", async () => {
      using dir = tempDir("bun-test-bail-leak-check", {
        "a.test.ts": `
          import { test, expect } from "bun:test";
          test("fails", async () => {
            setTimeout(() => console.log("ran: timer"), 60_000);
            await Bun.sleep(1);
            console.log("ran: fails");
            expect(1).toBe(2);
          });
          test("unreachable", () => {
            console.log("ran: unreachable");
          });
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--bail"],
        env: {
          ...bunEnv,
          BUN_DESTRUCT_VM_ON_EXIT: "1",
          ASAN_OPTIONS: "allow_user_segv_handler=1:detect_leaks=1:abort_on_error=1",
          LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dir, "../../leaksan.supp")}`,
        },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.split("\n").filter(line => line.startsWith("ran: "))).toEqual(["ran: fails"]);
      expect(stderr).toContain("Bailed out after 1 failure");
      expect(exitCode, stderr).toBe(1);
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
    test("should annotate an error message containing non-ASCII bytes", () => {
      const stderr = runTest({
        input: `
          import { test } from "bun:test";
          test("fail", () => {
            throw "hello é world";
          });
        `,
        env: {
          FORCE_COLOR: "1",
          GITHUB_ACTIONS: "true",
        },
      });
      const annotation = stderr.split("\n").find(l => l.startsWith("::error"));
      expect(annotation).toMatch(/^::error file=.*,line=\d+,col=\d+,title=error: hello é world::%0A {6}at /);
    });
    test("should annotate an error message containing emoji and newlines", () => {
      const stderr = runTest({
        input: `
          import { test } from "bun:test";
          test("fail", () => {
            throw "before 😋 after\\nsecond 😋 line";
          });
        `,
        env: {
          FORCE_COLOR: "1",
          GITHUB_ACTIONS: "true",
        },
      });
      const annotation = stderr.split("\n").find(l => l.startsWith("::error"));
      expect(annotation).toMatch(
        /^::error file=.*,line=\d+,col=\d+,title=error: before 😋 after::second 😋 line%0A {6}at /,
      );
    });
    test("should percent-encode metacharacters in the annotation file property", () => {
      const stderr = runTest({
        input: [
          {
            filename: "odd,name%path.test.ts",
            contents: `
              import { test } from "bun:test";
              test("fail", () => {
                throw new Error("boom");
              });
            `,
          },
        ],
        env: {
          GITHUB_ACTIONS: "true",
        },
      });
      const annotation = stderr.split("\n").find(l => l.startsWith("::error"));
      expect(annotation).toMatch(
        /^::error file=(.*[\\/])?odd%2Cname%25path\.test\.ts,line=\d+,col=\d+,title=error: boom::/,
      );
    });
    test("should percent-encode metacharacters in the annotation title", () => {
      const stderr = runTest({
        input: `
          import { test } from "bun:test";
          test("fail", () => {
            const err = new Error("alpha: one, two 100%\\nbeta: three, four");
            err.name = "Odd:Name,With%Chars";
            throw err;
          });
        `,
        env: {
          FORCE_COLOR: "1",
          GITHUB_ACTIONS: "true",
        },
      });
      const annotation = stderr.split("\n").find(l => l.startsWith("::error"));
      expect(annotation).toMatch(
        /^::error file=.*,line=\d+,col=\d+,title=Odd%3AName%2CWith%25Chars: alpha%3A one%2C two 100%25::beta: three, four%0A {6}at /,
      );
    });
    test("should keep a function name containing a newline on the annotation line", () => {
      const stderr = runTest({
        input: `
          import { test } from "bun:test";
          function inner() {
            throw new Error("boom");
          }
          Object.defineProperty(inner, "name", { value: "odd\\nname" });
          test("fail", () => {
            inner();
          });
        `,
        env: {
          FORCE_COLOR: "1",
          GITHUB_ACTIONS: "true",
        },
      });
      const annotation = stderr.split("\n").find(l => l.startsWith("::error"));
      expect(annotation).toMatch(/^::error file=.*,line=\d+,col=\d+,title=error: boom::/);
      expect(annotation).toContain("%0A      at odd%0Aname (");
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
    test("should annotate an error thrown from a source whose URL is longer than a path buffer", () => {
      // Longer than a path buffer on every platform (98302 bytes on Windows).
      const padding = 100_000;
      const dataUrlModule = 'export default function fromDataUrl() { throw new Error("boom"); }//';
      const base64 = btoa(dataUrlModule + Buffer.alloc(padding, "x").toString());
      const longPath = "/" + Buffer.alloc(padding, "y").toString();
      const stderr = runTest({
        input: `
          import { test } from "bun:test";
          test("data url", async () => {
            const source = ${JSON.stringify(dataUrlModule)} + Buffer.alloc(${padding}, "x").toString();
            const m = await import("data:text/javascript;base64," + btoa(source));
            m.default();
          });
          test("long sourceURL", () => {
            const sourceURL = "/" + Buffer.alloc(${padding}, "y").toString();
            (0, eval)("(function fromLongPath() { throw new Error('boom'); })\\n//# sourceURL=" + sourceURL)();
          });
        `,
        env: {
          GITHUB_ACTIONS: "true",
        },
        expectExitCode: 1,
      });
      const annotations = stderr.split("\n").filter(line => line.startsWith("::error"));
      expect(annotations).toHaveLength(2);
      const [dataUrl, longSourceUrl] = annotations;
      expect(dataUrl).toStartWith(`::error file=data%3Atext/javascript;base64%2C${base64},line=1,col=`);
      expect(dataUrl).toContain(`%0A      at fromDataUrl (data:text/javascript;base64,${base64}:1:`);
      expect(longSourceUrl).toStartWith(`::error file=${longPath},line=1,col=`);
      expect(longSourceUrl).toContain(`%0A      at fromLongPath (${longPath}:1:`);
    });
    test("should make the annotation file relative to GITHUB_WORKSPACE only when it is a path", () => {
      const cwd = createTest([
        {
          filename: "workspace.test.ts",
          contents: `
            import { test } from "bun:test";
            test("in the test file", () => {
              throw new Error("boom");
            });
            test("in a sourceURL that is not a path", () => {
              (0, eval)("(function fromSourceUrl() { throw new Error('boom'); })\\n//# sourceURL=webpack://app/./src/x.ts")();
            });
          `,
        },
      ]);
      const stderr = runTest({
        cwd,
        env: {
          GITHUB_ACTIONS: "true",
          GITHUB_WORKSPACE: dirname(cwd),
        },
        expectExitCode: 1,
      });
      const annotations = stderr.split("\n").filter(line => line.startsWith("::error"));
      expect(annotations).toHaveLength(2);
      const [testFile, sourceUrl] = annotations;
      expect(testFile).toStartWith(`::error file=${basename(cwd)}${sep}workspace.test.ts,line=4,col=`);
      expect(sourceUrl).toStartWith("::error file=webpack%3A//app/./src/x.ts,line=1,col=");
      expect(sourceUrl).toContain("%0A      at fromSourceUrl (webpack://app/./src/x.ts:1:");
    });
    // The reporters reuse the buffer that stored the file's title while its tests ran.
    test("should print the test file's name in the group for each --rerun-each run", () => {
      const cwd = createTest([
        {
          filename: "helper.ts",
          contents: `
            import { expect } from "bun:test";
            export function failing() {
              expect(1).toBe(2);
            }
          `,
        },
        {
          filename: "rerun.test.ts",
          contents: `
            import { test } from "bun:test";
            import { failing } from "./helper";
            test("fails", failing);
          `,
        },
      ]);
      const stderr = runTest({
        cwd,
        args: ["--rerun-each", "3"],
        env: {
          GITHUB_ACTIONS: "true",
          GITHUB_WORKSPACE: undefined,
        },
        expectExitCode: 1,
      });
      expect(stderr.split("\n").filter(line => line.startsWith("::group::"))).toEqual([
        "::group::rerun.test.ts: (run #1)",
        "::group::rerun.test.ts: (run #2)",
        "::group::rerun.test.ts: (run #3)",
      ]);
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

      test("surfaces a throwing custom formatter in the interpolated value as a test error", () => {
        // The declaration throw aborts module evaluation, so each variant
        // needs its own file to be verified independently.
        const throwing = (message: string) =>
          `({ [Symbol.for("nodejs.util.inspect.custom")]() { throw new Error(${JSON.stringify(message)}); } })`;
        const stderr = runTest({
          args: [],
          expectExitCode: 1,
          input: [
            {
              filename: "test-each-path.test.ts",
              contents: `
                import { test } from "bun:test";
                test.each([{ a: { b: ${throwing("boom from test.each $path")} } }])("case $a.b", () => {});
              `,
            },
            {
              filename: "test-each-p.test.ts",
              contents: `
                import { test } from "bun:test";
                test.each([[${throwing("boom from test.each %p")}]])("case %p", () => {});
              `,
            },
            {
              filename: "describe-each-path.test.ts",
              contents: `
                import { test, describe } from "bun:test";
                describe.each([{ a: { b: ${throwing("boom from describe.each $path")} } }])("suite $a.b", () => {
                  test("inner", () => {});
                });
              `,
            },
            {
              filename: "describe-each-p.test.ts",
              contents: `
                import { test, describe } from "bun:test";
                describe.each([[${throwing("boom from describe.each %p")}]])("suite %p", () => {
                  test("inner", () => {});
                });
              `,
            },
          ],
        });

        expect(stderr).toContain("boom from test.each $path");
        expect(stderr).toContain("boom from test.each %p");
        expect(stderr).toContain("boom from describe.each $path");
        expect(stderr).toContain("boom from describe.each %p");
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
        .replace(/\[[\d.]+m?s\]/, "[xx ms]"),
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
        .replace(/ \[[\d.]+m?s\]/g, "") // Remove all timings
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
    using dir = tempDir("test-tsconfig-override", {
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
    using dir = tempDir("test-tsconfig-monorepo", {
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

  // jest and vitest never run a test file's process.on('exit') listeners; node's test harness asserts from them.
  describe.concurrent("process.on('exit') listeners", () => {
    async function runFiles(files: Record<string, string>, ...args: string[]) {
      using dir = tempDir("bun-test-exit-listener", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", ...args],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    function runFile(name: string, contents: string) {
      return runFiles({ [name]: contents }, name);
    }

    const bunTestFile = (n: number) => `
      import { test } from "bun:test";
      process.on("exit", () => {
        console.log("exit listener ${n} ran");
        process.exit(1);
      });
      test("test ${n}", () => {});
    `;
    const nodeTestFile = (n: number) => `
      import { test } from "node:test";
      process.on("exit", () => process.exit(1));
      test("test ${n}", () => {});
    `;

    test("are not run for a bun:test file", async () => {
      const { stdout, stderr, exitCode } = await runFile("exit.test.ts", bunTestFile(1));
      expect(stdout).not.toContain("exit listener");
      expect(stderr).toContain("1 pass");
      expect(exitCode).toBe(0);
    });

    test("are not run for a file that registers globals-style tests", async () => {
      const { stdout, stderr, exitCode } = await runFile(
        "globals.test.ts",
        `
          process.on("exit", () => {
            console.log("exit listener ran");
            process.exit(1);
          });
          test("a passing test", () => {});
        `,
      );
      expect(stdout).not.toContain("exit listener ran");
      expect(stderr).toContain("1 pass");
      expect(exitCode).toBe(0);
    });

    test("are not run when node:test is only imported", async () => {
      const { stdout, stderr, exitCode } = await runFile(
        "node-import-only.test.ts",
        `
          import { test } from "bun:test";
          import { mock } from "node:test";
          void mock;
          process.on("exit", () => {
            console.log("exit listener ran");
            process.exit(1);
          });
          test("a passing test", () => {});
        `,
      );
      expect(stdout).not.toContain("exit listener ran");
      expect(stderr).toContain("1 pass");
      expect(exitCode).toBe(0);
    });

    test("are not run when only a Worker uses node:test", async () => {
      const { stdout, stderr, exitCode } = await runFiles(
        {
          "worker-uses-node-test.test.ts": `
            import { test } from "bun:test";
            process.on("exit", () => {
              console.log("exit listener ran");
              process.exit(1);
            });
            test("a Worker uses node:test", async () => {
              const worker = new Worker(new URL("./worker.ts", import.meta.url));
              await new Promise((resolve, reject) => {
                worker.addEventListener("message", resolve, { once: true });
                worker.addEventListener("error", e => reject(e.error ?? new Error(e.message)), { once: true });
              });
              worker.terminate();
            });
          `,
          "worker.ts": `
            import { mock } from "node:test";
            mock.fn(() => {});
            postMessage("used");
          `,
        },
        "worker-uses-node-test.test.ts",
      );
      expect(stdout).not.toContain("exit listener ran");
      expect(stderr).toContain("1 pass");
      expect(exitCode).toBe(0);
    });

    test("still run when the file itself calls process.exit()", async () => {
      const { stdout, exitCode } = await runFile(
        "explicit-exit.test.ts",
        `
          import { test } from "bun:test";
          process.on("exit", code => console.log("exit listener ran with", code));
          test("exits", () => process.exit(3));
        `,
      );
      expect(stdout).toContain("exit listener ran with 3");
      expect(exitCode).toBe(3);
    });

    test("run once a node:test API registers a test", async () => {
      const { stdout, stderr, exitCode } = await runFile(
        "node.test.ts",
        `
          import { test } from "node:test";
          process.on("exit", code => console.log("exit listener ran with", code));
          test("a passing test", () => {});
        `,
      );
      expect(stdout).toContain("exit listener ran with 0");
      expect(stderr).toContain("1 pass");
      expect(exitCode).toBe(0);
    });

    test("can fail the run once node:test registered a test, like node's common.mustCall()", async () => {
      const { stderr, exitCode } = await runFile("node-exit-code.test.ts", nodeTestFile(1));
      expect(stderr).toContain("1 pass");
      expect(exitCode).toBe(1);
    });

    test("run when --bail stops a file that registered a node:test test", async () => {
      const { stdout, stderr, exitCode } = await runFiles(
        {
          "node-bail.test.ts": `
            import { test } from "node:test";
            import assert from "node:assert";
            process.on("exit", code => console.log("exit listener ran with", code));
            test("fails", () => assert.strictEqual(1, 2));
          `,
        },
        "--bail",
        "node-bail.test.ts",
      );
      expect(stdout).toContain("exit listener ran with 1");
      expect(stderr).toContain("Bailed out after 1 failure");
      expect(exitCode).toBe(1);
    });

    // Serial: three node:test files at once take seconds to load in a debug build.
    test.serial("cannot make a run that --bail stops exit 0", async () => {
      const run = (listener: string) =>
        runFiles(
          {
            "node-bail.test.ts": `
              import { test } from "node:test";
              import assert from "node:assert";
              process.on("exit", code => { console.log("exit listener ran with", code); ${listener}; });
              test("fails", () => assert.strictEqual(1, 2));
            `,
          },
          "--bail",
          "node-bail.test.ts",
        );
      const [stores0, exits0, stores3] = await Promise.all([
        run("process.exitCode = 0"),
        run("process.exit(0)"),
        run("process.exitCode = 3"),
      ]);
      for (const { stdout, stderr } of [stores0, exits0, stores3]) {
        expect(stdout).toContain("exit listener ran with 1");
        expect(stderr.match(/Bailed out after 1 failure/g)).toHaveLength(1);
      }
      expect({ stores0: stores0.exitCode, exits0: exits0.exitCode, stores3: stores3.exitCode }).toEqual({
        stores0: 1,
        exits0: 1,
        stores3: 3,
      });
    });

    test("run for a bun:test file under BUN_TEST_DRAIN_EVENT_LOOP, which the vendored node tests set", async () => {
      using dir = tempDir("bun-test-exit-listener", { "drain.test.ts": bunTestFile(1) });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "drain.test.ts"],
        env: { ...bunEnv, BUN_TEST_DRAIN_EVENT_LOOP: "1" },
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toContain("exit listener 1 ran");
      expect(stderr).toContain("1 pass");
      expect(exitCode).toBe(1);
    });

    test("are not run in --parallel workers for bun:test files", async () => {
      const { stdout, stderr, exitCode } = await runFiles(
        { "a.test.ts": bunTestFile(1), "b.test.ts": bunTestFile(2) },
        "--parallel=2",
        "a.test.ts",
        "b.test.ts",
      );
      // Worker output is relayed on the coordinator's stderr.
      expect(stdout + stderr).not.toContain("exit listener");
      expect(stderr).toContain("2 pass");
      expect(exitCode).toBe(0);
    });

    // --parallel implies --isolate, and a file's listeners are torn down with its global before the worker exits.
    test("--parallel workers exit cleanly after node:test files; listeners do not reach the run's exit code", async () => {
      const { stderr, exitCode } = await runFiles(
        { "a.test.ts": nodeTestFile(1), "b.test.ts": nodeTestFile(2) },
        "--parallel=2",
        "a.test.ts",
        "b.test.ts",
      );
      expect(stderr).not.toContain("worker crashed");
      expect(stderr).toContain("2 pass");
      expect(exitCode).toBe(0);
    });
  });

  // Without --parallel, every test file runs in one process, so an exit of that process ends the run.
  // If the run has failed by then, it ends the way `--bail` ends it: with the summary, the JUnit file
  // and the timings file, and never with exit code 0.
  describe.concurrent("an exit of the process in a run that has failed", () => {
    async function runIn(dir: string, args: string[], env: Record<string, string> = {}) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", ...args],
        env: { ...bunEnv, ...env },
        cwd: dir,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    async function runFiles(files: Record<string, string>, args: string[], env?: Record<string, string>) {
      using dir = tempDir("bun-test-process-exit", files);
      return await runIn(String(dir), args, env);
    }

    const imports = `import { test, expect, describe, beforeAll, beforeEach, afterEach, afterAll } from "bun:test";`;
    const fails = `test("fails", () => { expect(1).toBe(2); });`;
    const exits = `test("exits", () => { process.exit(0); });`;
    const failingFile = `${imports}\n${fails}`;
    const exitingFile = `${imports}\n${exits}`;
    const twoFiles = { "a.test.ts": failingFile, "b.test.ts": exitingFile };
    // `when` says what was on the stack. That is not always the caller of process.exit().
    const told = (when: string, code = 0) =>
      `error: The process was told to exit with code ${code}${when}.` +
      (code === 0 ? " The test run has failed, so the exit code is 1.\n" : "\n");
    const whileTest = (name: string) => ` while the test "${name}" was running`;
    const whileHookOf = (name: string) => ` while a hook of the test "${name}" was running`;
    const whileHook = " while a hook was running";
    const beforeEnd = " before the end of the test run";
    const oneFailed = " 0 pass\n 1 fail\n 1 expect() calls\nRan 1 test across 1 file.";

    // Serial: a node:test file takes over a second to load in a debug build. First: a serial test keeps the
    // concurrent tests below out of the group of the block above.
    const nodeTestFile = (body: string) => `
      import { test, after } from "node:test";
      import assert from "node:assert";
      ${body}
    `;
    const nodeFails = `test("fails", () => { assert.strictEqual(1, 2); });`;

    test.serial.each([
      ["a test", `${nodeFails}\n${exits}`, whileTest("exits")],
      ["a root after() hook", `after(() => { process.exit(0); });\n${nodeFails}`, whileHook],
    ])("process.exit(0) in %s of a node:test file", async (_, body, when) => {
      const { stderr, exitCode } = await runFiles({ "node.test.ts": nodeTestFile(body) }, ["./node.test.ts"]);
      expect(stderr).toMatch(/\(fail\) fails \[[^\]]+\]\n[^]*error: The process was told to exit/);
      expect(stderr).toContain(told(when));
      expect(stderr).toContain(" 0 pass\n 1 fail\nRan 1 test across 1 file.");
      expect(exitCode).toBe(1);
    });

    // The run has ended when its 'exit' listeners run. Their exit is as it was before.
    test.serial("an 'exit' listener that calls process.exit(0) at the normal end of a failed run", async () => {
      const listener = `process.on("exit", code => { console.log("exit listener ran with", code); process.exit(0); });`;
      const { stdout, stderr } = await runFiles({ "node.test.ts": nodeTestFile(`${listener}\n${nodeFails}`) }, [
        "./node.test.ts",
      ]);
      expect(stdout).toContain("exit listener ran with 1");
      expect(stderr).not.toContain("was told to exit");
      expect(stderr.match(/Ran 1 test across 1 file\./g)).toHaveLength(1);
    });

    test.each([
      ["process.exit(0)", 0, 1],
      ["process.exit()", 0, 1],
      ["process.reallyExit(0)", 0, 1],
      ["process.exit(3)", 3, 3],
    ])("%s prints the call site and the summary", async (call, code, expected) => {
      const { stderr, exitCode } = await runFiles(
        { "exits.test.ts": `${failingFile}\ntest("exits", () => { ${call}; });\ntest("never runs", () => {});\n` },
        ["./exits.test.ts"],
      );
      expect(stderr).toContain("(fail) fails");
      expect(stderr).toContain(told(whileTest("exits"), code));
      // The call is on line 3 of the file.
      expect(stderr).toMatch(
        /exits\.test\.ts:3:\d+\)\nnote: bun test exits when the run ends, so a test file does not need to end the process\nnote: To test code that calls process\.exit\(\), mock process\.exit\n\n 0 pass\n/,
      );
      expect(stderr).toContain(oneFailed);
      // The summary ends the output.
      expect(stderr).toMatch(/Ran 1 test across 1 file\. \[[^\]]+\]\n+$/);
      expect(exitCode).toBe(expected);
    });

    // Every file fails a test. Then the named place calls process.exit(0).
    test.each([
      ["the tail call of a test", `${fails}\ntest("exits", () => process.exit(0));`, whileTest("exits")],
      [
        "a test, after an awaited microtask",
        `${fails}\ntest("exits", async () => { await Promise.resolve(); process.exit(0); });`,
        whileTest("exits"),
      ],
      [
        "a test, after an awaited timer",
        `${fails}\ntest("exits", async () => { await new Promise(r => setTimeout(r, 1)); process.exit(0); });`,
        beforeEnd,
      ],
      [
        "expect().toThrow()",
        `${fails}\ntest("exits", () => { expect(() => process.exit(0)).toThrow(); });`,
        whileTest("exits"),
      ],
      [
        "beforeAll",
        `${fails}\ndescribe("later", () => { beforeAll(() => { process.exit(0); }); test("never runs", () => {}); });`,
        whileHook,
      ],
      [
        "beforeEach",
        `${fails}\ndescribe("later", () => { beforeEach(() => { process.exit(0); }); test("second", () => {}); });`,
        whileHookOf("second"),
      ],
      // The test has failed and still runs its hook: the run reports it first.
      ["afterEach of the test that failed", `afterEach(() => { process.exit(0); });\n${fails}`, whileHookOf("fails")],
      ["afterAll", `afterAll(() => process.exit(0));\n${fails}`, whileHook],
      // The test on the stack is not the caller: .resolves runs the timers of the test before it.
      [
        "a timer that fires while a later test waits in .resolves",
        `${fails}
test("arms a timer", () => { setTimeout(() => { process.exit(0); }, 1); });
test("waits", async () => { await expect(new Promise(resolve => setTimeout(resolve, 1000, 1))).resolves.toBe(1); });`,
        whileTest("waits"),
      ],
      [
        "a timer that fires while a later test awaits",
        `${fails}\ntest("waits", async () => { setTimeout(() => { process.exit(0); }, 1); await new Promise(() => {}); });`,
        beforeEnd,
      ],
      [
        "an 'exit' listener that exits again",
        `process.on("exit", () => { process.exit(0); });\n${fails}\n${exits}`,
        whileTest("exits"),
      ],
      [
        "a process.reallyExit wrapper that exits later",
        `const reallyExit = process.reallyExit;
process.reallyExit = code => { setTimeout(() => reallyExit.call(process, code), 1); };
${fails}\ntest("exits", async () => { process.exit(0); await new Promise(() => {}); });`,
        beforeEnd,
      ],
      // The name is quoted, so it stays on one line.
      [
        "a test whose name has a quote and a line break",
        `${fails}\ntest('says "hi"\\nsecond line', () => { process.exit(0); });`,
        whileTest(String.raw`says \"hi\"\nsecond line`),
      ],
    ])("process.exit(0) in %s", async (_, body, when) => {
      const { stderr, exitCode } = await runFiles({ "site.test.ts": `${imports}\n${body}\n` }, ["./site.test.ts"]);
      expect(stderr).toMatch(/\(fail\) fails \[[^\]]+\]\n[^]*error: The process was told to exit/);
      expect(stderr).toContain(told(when));
      expect(stderr).toContain(" 1 fail\n");
      expect(stderr).toMatch(/Ran \d tests? across 1 file\./);
      expect(exitCode).toBe(1);
    });

    test("a failure in an earlier file counts", async () => {
      const run = (later: string) =>
        runFiles({ "a.test.ts": failingFile, "b.test.ts": later }, ["./a.test.ts", "./b.test.ts"]);
      const [inTest, inDescribe, atTopLevel] = await Promise.all([
        run(exitingFile),
        run(`${imports}\ndescribe("later", () => { process.exit(0); });`),
        run(`process.exit(0);`),
      ]);
      expect(inTest.stderr).toContain(told(whileTest("exits")));
      for (const { stderr } of [inDescribe, atTopLevel]) {
        expect(stderr).toContain("\nb.test.ts:\n");
        expect(stderr).toContain(told(beforeEnd) + "      at ");
      }
      expect(atTopLevel.stderr).toMatch(/b\.test\.ts:1:\d+\n/);
      for (const { stderr } of [inTest, inDescribe]) {
        expect(stderr).toContain(" 0 pass\n 1 fail\n 1 expect() calls\nRan 1 test across 2 files.");
      }
      // The file count does not have a file that is still loading.
      expect(atTopLevel.stderr).toContain(oneFailed);
      expect([inTest.exitCode, inDescribe.exitCode, atTopLevel.exitCode]).toEqual([1, 1, 1]);
    });

    test("an error thrown between tests counts", async () => {
      const { stderr, exitCode } = await runFiles(
        {
          "a.test.ts": `${imports}\ntest("passes", () => {});\nqueueMicrotask(() => { throw new Error("thrown outside a test"); });`,
          "b.test.ts": exitingFile,
        },
        ["./a.test.ts", "./b.test.ts"],
      );
      expect(stderr).toContain("thrown outside a test");
      expect(stderr).toContain(told(whileTest("exits")));
      expect(stderr).toContain(" 0 pass\n 0 fail\n 1 error\nRan 0 tests across 2 files.");
      expect(exitCode).toBe(1);
    });

    // "a" and "b" have failed and still run their hooks when the hook of "b" exits. The exit ends the run, so --bail does not.
    test("reports every test that has failed, also past --bail, and keeps a non-zero code", async () => {
      const file = (code: number) => `${imports}
        let hooks = 0;
        test("first", () => { expect(1).toBe(2); });
        describe("in flight", () => {
          afterEach(async () => {
            if (++hooks === 1) await new Promise(() => {});
            process.exit(${code});
          });
          test.concurrent("a", () => { expect(1).toBe(2); });
          test.concurrent("b", () => { expect(1).toBe(2); });
        });
      `;
      const [zero, three] = await Promise.all([
        runFiles({ "bail.test.ts": file(0) }, ["--bail=2", "./bail.test.ts"]),
        runFiles({ "bail.test.ts": file(3) }, ["--bail=2", "./bail.test.ts"]),
      ]);
      expect(zero.stderr).toContain(told(whileHookOf("b")));
      expect(three.stderr).toContain(told(whileHookOf("b"), 3));
      for (const { stderr } of [zero, three]) {
        expect(stderr).toMatch(
          /\(fail\) first \[[^]*\(fail\) in flight > a \[[^]*\(fail\) in flight > b \[[^]*error: The process was told/,
        );
        expect(stderr).toContain(" 0 pass\n 3 fail\n 3 expect() calls\nRan 3 tests across 1 file.");
        expect(stderr).not.toContain("Bailed out");
      }
      expect({ zero: zero.exitCode, three: three.exitCode }).toEqual({ zero: 1, three: 3 });
    });

    // The failed test has two hooks left when the first of them exits.
    test("a test that failed with hooks left gets its (fail) line and its JUnit case", async () => {
      using dir = tempDir("bun-test-process-exit-hooks", {
        "hooks.test.ts": `${imports}
          afterEach(() => {});
          describe("group", () => {
            afterEach(() => { process.exit(0); });
            ${fails}
          });
        `,
      });
      const { stderr, exitCode } = await runIn(String(dir), [
        "--reporter=junit",
        "--reporter-outfile=junit.xml",
        "./hooks.test.ts",
      ]);
      expect(stderr).toMatch(/\(fail\) group > fails \[[^\]]+\]\n[^]*error: The process was told to exit/);
      expect(stderr).toContain(told(whileHookOf("fails")));
      expect(stderr).toContain(oneFailed);
      expect(await Bun.file(join(String(dir), "junit.xml")).text()).toContain(`<testcase name="fails"`);
      expect(exitCode).toBe(1);
    });

    test("a test fails for good when it has no retry left", async () => {
      const file = (exitAtAttempt: number) => `${imports}
        let attempt = 0;
        afterEach(() => { if (++attempt === ${exitAtAttempt}) process.exit(0); });
        test("fails", () => { expect(1).toBe(2); }, { retry: 2 });
      `;
      const [retryLeft, noRetryLeft] = await Promise.all([
        runFiles({ "retry.test.ts": file(1) }, ["./retry.test.ts"]),
        runFiles({ "retry.test.ts": file(3) }, ["./retry.test.ts"]),
      ]);
      // A retry could still pass, so the run has not failed. This exit is as it was before.
      expect(retryLeft.stderr).not.toContain("was told to exit");
      expect(retryLeft.stderr).not.toContain("Ran ");
      expect(noRetryLeft.stderr).toContain("(fail) fails (attempt 3)");
      expect(noRetryLeft.stderr).toContain(told(whileHookOf("fails")));
      expect(noRetryLeft.stderr).toContain(oneFailed);
      expect({ retryLeft: retryLeft.exitCode, noRetryLeft: noRetryLeft.exitCode }).toEqual({
        retryLeft: 0,
        noRetryLeft: 1,
      });
    });

    // A long run repeats its failures above the counts. The early end does too.
    test("repeats the failed tests of a long run", async () => {
      const passes = Array.from({ length: 21 }, (_, i) => `test("passes ${i}", () => {});`).join("\n");
      const { stderr, exitCode } = await runFiles({ "long.test.ts": `${failingFile}\n${passes}\n${exits}\n` }, [
        "./long.test.ts",
      ]);
      expect(stderr).toMatch(
        /\(pass\) passes 20[^\n]*\n\n1 tests failed:\n\(fail\) fails \[[^\]]+\]\n[^]*error: The process was told to exit/,
      );
      expect(stderr).toContain(" 21 pass\n 1 fail\n 1 expect() calls\nRan 22 tests across 1 file.");
      expect(exitCode).toBe(1);
    });

    test("writes the JUnit file and the timings file once", async () => {
      using dir = tempDir("bun-test-process-exit-reports", twoFiles);
      const { stderr, exitCode } = await runIn(String(dir), [
        "--reporter=junit",
        "--reporter-outfile=junit.xml",
        "--timings=timings.json",
        "--update-timings",
        "./a.test.ts",
        "./b.test.ts",
      ]);
      expect(stderr).toContain(told(whileTest("exits")));
      const xml = await Bun.file(join(String(dir), "junit.xml")).text();
      expect(xml).toContain(`<testcase name="fails"`);
      expect(xml.match(/<\/testsuites>/g)).toHaveLength(1);
      const timings = await Bun.file(join(String(dir), "timings.json")).json();
      expect(Object.keys(timings.files)).toEqual(["a.test.ts"]);
      expect(exitCode).toBe(1);
    });

    test("closes the file group of GitHub Actions before the error", async () => {
      const env = { GITHUB_ACTIONS: "true" };
      const [inFile, betweenFiles] = await Promise.all([
        runFiles(twoFiles, ["./a.test.ts", "./b.test.ts"], env),
        // --isolate closes what the first file left open when no file is running: there is no group to close.
        runFiles(
          {
            "a.test.ts": `${failingFile}
              test("leaves a connection open", async () => {
                const { promise: accepted, resolve } = Promise.withResolvers();
                const server = Bun.listen({
                  hostname: "127.0.0.1",
                  port: 0,
                  socket: { open: resolve, data() {}, close() { process.exit(0); } },
                });
                await Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data() {} } });
                await accepted;
              });
            `,
            "b.test.ts": `${imports}\ntest("never runs", () => {});`,
          },
          ["--isolate", "./a.test.ts", "./b.test.ts"],
          env,
        ),
      ]);
      expect(inFile.stderr).toMatch(/::group::b\.test\.ts:\n+::endgroup::\n+[^]*error: The process was told to exit/);
      for (const { stderr, exitCode } of [inFile, betweenFiles]) {
        expect(stderr).toContain("::error ");
        expect(stderr.match(/::endgroup::/g)).toHaveLength(stderr.match(/::group::/g)!.length);
        expect(exitCode).toBe(1);
      }
      expect(betweenFiles.stderr).toContain(told(beforeEnd));
      expect(betweenFiles.stderr).toContain(" 1 pass\n 1 fail\n 1 expect() calls\nRan 2 tests across 1 file.");
    });

    // The run ends before it writes the .snap file of b.test.ts, as a run that --bail ends.
    test("does not write the .snap file of the file that was running", async () => {
      const kept =
        "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n\nexports[`adds one and fails 1`] = `0`;\n\nexports[`never runs 1`] = `4`;\n";
      using dir = tempDir("bun-test-process-exit-snapshots", {
        "a.test.ts": `${imports}\ntest("adds two", () => { expect(1).toMatchSnapshot(); expect(2).toMatchSnapshot(); });`,
        "b.test.ts": `${imports}
          test("adds one and fails", () => { expect(3).toMatchSnapshot(); expect(1).toBe(2); });
          ${exits}
          test("never runs", () => { expect(4).toMatchSnapshot(); });
        `,
        "__snapshots__/b.test.ts.snap": kept,
      });
      const { stderr, exitCode } = await runIn(String(dir), ["-u", "./a.test.ts", "./b.test.ts"], { CI: "false" });
      expect(stderr).toContain(told(whileTest("exits")));
      expect(await Bun.file(join(String(dir), "__snapshots__", "a.test.ts.snap")).text()).toContain(
        "exports[`adds two 2`]",
      );
      expect(await Bun.file(join(String(dir), "__snapshots__", "b.test.ts.snap")).text()).toBe(kept);
      expect(exitCode).toBe(1);
    });

    test.each([
      [
        "in a later --rerun-each repetition",
        ["--rerun-each=2", "./a.test.ts"],
        {
          "a.test.ts": `${imports}
            globalThis.runs = (globalThis.runs ?? 0) + 1;
            test("fails in the first run", () => { if (globalThis.runs === 1) expect(1).toBe(2); });
            test("exits", () => { if (globalThis.runs === 2) process.exit(0); });
          `,
        },
        whileTest("exits"),
        " 2 pass\n 1 fail\n 1 expect() calls\nRan 3 tests across 1 file.",
      ],
      [
        "with --parallel=1, which runs the files in the main process",
        ["--parallel=1", "./a.test.ts", "./b.test.ts"],
        twoFiles,
        whileTest("exits"),
        " 0 pass\n 1 fail\n 1 expect() calls\nRan 1 test across 2 files.",
      ],
      // The dots of b.test.ts end with a line break, and the name of the file is printed.
      [
        "with --dots",
        ["--dots", "./a.test.ts", "./b.test.ts"],
        { "a.test.ts": failingFile, "b.test.ts": `${imports}\ntest("passes", () => {});\n${exits}` },
        whileTest("exits"),
        ".\n\nb.test.ts:\n",
      ],
      [
        "with --dots, summary",
        ["--dots", "./a.test.ts", "./b.test.ts"],
        twoFiles,
        whileTest("exits"),
        "\n\n0 pass\n1 fail\n1 expect() calls\nRan 1 test across 2 files.",
      ],
      // It ends the watcher too, as it did before.
      [
        "under --watch",
        ["--watch", "--no-clear-screen", "./a.test.ts", "./b.test.ts"],
        twoFiles,
        whileTest("exits"),
        " 0 pass\n 1 fail\n 1 expect() calls\nRan 1 test across 2 files.",
      ],
    ] as [string, string[], Record<string, string>, string, string][])(
      "process.exit(0) %s",
      async (_, args, files, when, output) => {
        const { stderr, exitCode } = await runFiles(files, args);
        expect(stderr).toContain(told(when));
        expect(stderr).toContain(output);
        expect(exitCode).toBe(1);
      },
    );

    // No file is running when --isolate closes what the first file left open. The dot ends with a line break.
    test("between two files, with --isolate and --dots", async () => {
      const { stderr, exitCode } = await runFiles(
        {
          "a.test.ts": `${failingFile}
            test("leaves a connection open", async () => {
              const { promise: accepted, resolve } = Promise.withResolvers();
              const server = Bun.listen({
                hostname: "127.0.0.1",
                port: 0,
                socket: { open: resolve, data() {}, close() { process.exit(0); } },
              });
              await Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data() {} } });
              await accepted;
            });
          `,
          "b.test.ts": `${imports}\ntest("never runs", () => {});`,
        },
        ["--isolate", "--dots", "./a.test.ts", "./b.test.ts"],
      );
      expect(stderr).toMatch(/\(fail\) fails \[[^\]]+\]\n\.\n\d+ \| /);
      expect(stderr).toContain(told(beforeEnd));
      expect(stderr).toContain("\n\n1 pass\n1 fail\n1 expect() calls\nRan 2 tests across 1 file.");
      expect(exitCode).toBe(1);
    });

    describe.skipIf(isWindows)("a SIGTERM listener that exits 0", () => {
      async function terminated(args: string[], file: string, isReady: (stdout: string, stderr: string) => boolean) {
        using dir = tempDir("bun-test-process-exit-sigterm", { "a.test.ts": file });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "test", ...args, "./a.test.ts"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        let stdout = "";
        let stderr = "";
        let isSent = false;
        const read = async (stream: ReadableStream<Uint8Array>, add: (chunk: string) => void) => {
          const decoder = new TextDecoder();
          for await (const chunk of stream) {
            add(decoder.decode(chunk, { stream: true }));
            if (!isSent && isReady(stdout, stderr)) {
              isSent = true;
              proc.kill("SIGTERM");
            }
          }
        };
        await Promise.all([
          read(proc.stdout, chunk => (stdout += chunk)),
          read(proc.stderr, chunk => (stderr += chunk)),
        ]);
        return { stderr, exitCode: await proc.exited };
      }
      const file = (first: string) => `${imports}
        process.on("SIGTERM", () => { process.exit(0); });
        test("first", () => { ${first} });
        test("waits", async () => { console.log("ready"); await new Promise(() => {}); });
      `;

      test("during the run", async () => {
        const isReady = (stdout: string) => stdout.includes("ready");
        const [failed, passed] = await Promise.all([
          terminated([], file("expect(1).toBe(2);"), isReady),
          terminated([], file(""), isReady),
        ]);
        expect(failed.stderr).toContain(told(beforeEnd));
        expect(failed.stderr).toContain(oneFailed);
        // The run has not failed. This exit is as it was before.
        expect(passed.stderr).not.toContain("was told to exit");
        expect(passed.stderr).not.toContain("Ran ");
        expect({ failed: failed.exitCode, passed: passed.exitCode }).toEqual({ failed: 1, passed: 0 });
      });

      // The run has ended. The exit of the watcher is as it was before.
      test("after the run, while --watch waits for a change", async () => {
        const { stderr } = await terminated(
          ["--watch", "--no-clear-screen"],
          `${failingFile}\nprocess.on("SIGTERM", () => { process.exit(0); });`,
          (_, stderr) => stderr.includes("Ran 1 test across 1 file."),
        );
        expect(stderr).not.toContain("was told to exit");
        expect(stderr.match(/Ran 1 test across 1 file\./g)).toHaveLength(1);
      });
    });

    // The rows below record what an exit does today when the rule above does not apply. This change does not touch them.
    // Each exit keeps its code, and prints no error and no summary.
    test.each([
      [
        "in a test, when no test has failed",
        { "a.test.ts": `${imports}\ntest("passes", () => {});\n${exits}` },
        [],
        {},
      ],
      [
        "in afterAll, when no test has failed",
        { "a.test.ts": `${imports}\nafterAll(() => { process.exit(0); });\ntest("passes", () => {});` },
        [],
        {},
      ],
      ["at the top level, when no test has failed", { "a.test.ts": `process.exit(0);` }, [], {}],
      // The run has not failed when the exit ends it. The tests and files after the exit do not run.
      [
        "before the tests that fail",
        {
          "a.test.ts": `${imports}\ntest("passes", () => {});`,
          "b.test.ts": `${exitingFile}\n${fails}`,
          "c.test.ts": failingFile,
        },
        [],
        {},
      ],
      [
        "in a preload script",
        { "preload.ts": `process.exit(0);`, "a.test.ts": failingFile },
        ["--preload=./preload.ts"],
        {},
      ],
      // The file decides the exit code, as it does under node.
      [
        "after a failure, under BUN_TEST_DRAIN_EVENT_LOOP=1",
        { "a.test.ts": `${failingFile}\n${exits}` },
        [],
        { BUN_TEST_DRAIN_EVENT_LOOP: "1" },
      ],
      // The macro runs in the VM of the bundler thread, which does not own the run.
      [
        "after a failure, in a macro of a Bun.build()",
        {
          "macro.ts": `export function leave() { process.exit(0); }`,
          "entry.ts": `import { leave } from "./macro.ts" with { type: "macro" }; leave();`,
          "a.test.ts": `${failingFile}\ntest("builds", async () => { await Bun.build({ entrypoints: [import.meta.dir + "/entry.ts"] }); });`,
        },
        [],
        {},
      ],
    ] as [string, Record<string, string>, string[], Record<string, string>][])(
      "process.exit(0) %s",
      async (_, files, args, env) => {
        const tests = Object.keys(files).filter(name => name.endsWith(".test.ts"));
        const { stderr, exitCode } = await runFiles(files, [...args, ...tests.map(name => `./${name}`)], env);
        expect(stderr).not.toContain("was told to exit");
        expect(stderr).not.toContain("Ran ");
        expect(exitCode).toBe(0);
      },
    );

    // Nothing ends the run of the rows below before its normal end, which prints the summary once.
    test.each([
      [
        "process.exit(0) in a Worker",
        `${failingFile}
          test("a Worker exits", async () => {
            const worker = new Worker(URL.createObjectURL(new Blob(["process.exit(0);"], { type: "text/javascript" })));
            const { promise, resolve } = Promise.withResolvers();
            worker.addEventListener("close", resolve, { once: true });
            await promise;
          });
        `,
        "",
      ],
      [
        "a mocked process.exit",
        `import { spyOn } from "bun:test";
          ${failingFile}
          test("mocked", () => {
            const exit = spyOn(process, "exit").mockImplementation(() => {});
            process.exit(0);
            expect(exit).toHaveBeenCalledWith(0);
            exit.mockRestore();
          });
        `,
        "",
      ],
      [
        "a process.reallyExit that returns",
        `${failingFile}
          test("process.exit() returns", () => {
            const codes = [];
            process.reallyExit = code => { codes.push(code); };
            process.exit();
            process.exit(0);
            console.log("reallyExit was called with", codes, "and process.exitCode is", process.exitCode);
          });
        `,
        "reallyExit was called with [ 0, 0 ] and process.exitCode is 0\n",
      ],
    ])("%s does not end a run that has failed", async (_, contents, printed) => {
      const { stdout, stderr, exitCode } = await runFiles({ "a.test.ts": contents }, ["./a.test.ts"]);
      expect(stdout).toContain(printed);
      expect(stderr).not.toContain("was told to exit");
      expect(stderr).toContain(" 1 pass\n 1 fail\n");
      expect(stderr.match(/Ran 2 tests across 1 file\./g)).toHaveLength(1);
      expect(exitCode).toBe(1);
    });
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

describe.concurrent("test file discovery (scanner)", () => {
  test("discovers tests in deeply nested directories and prunes dot-dirs and node_modules", async () => {
    const files: Record<string, string> = {
      "a_first.test.ts": `import { test } from "bun:test"; test("a", () => { console.log("RAN a_first"); });`,
      "b_second.test.ts": `import { test } from "bun:test"; test("b", () => { console.log("RAN b_second"); });`,
      "styles.spec.tsx": `import { test } from "bun:test"; test("spec", () => { console.log("RAN spec"); });`,
      "not-a-test.ts": `console.log("SHOULD NOT RUN plain");`,
      "nested/deep/inner.test.ts": `import { test } from "bun:test"; test("inner", () => { console.log("RAN inner"); });`,
      "nested/util.ts": `export const x = 1;`,
      ".hidden/skipped.test.ts": `import { test } from "bun:test"; test("hidden", () => { console.log("SHOULD NOT RUN hidden"); });`,
      "node_modules/pkg/skipped.test.ts": `import { test } from "bun:test"; test("nm", () => { console.log("SHOULD NOT RUN node_modules"); });`,
    };
    // Long directory chain so the scanner's directory FIFO and per-directory
    // reads are exercised many times in a single scan.
    let prefix = "chain";
    for (let i = 0; i < 32; i++) {
      prefix += `/d${i}`;
      files[`${prefix}/leaf${i}.test.ts`] = `import { test } from "bun:test"; test("leaf${i}", () => {});`;
    }
    using dir = tempDir("scanner-discovery", files);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("RAN a_first");
    expect(stdout).toContain("RAN b_second");
    expect(stdout).toContain("RAN spec");
    expect(stdout).toContain("RAN inner");
    expect(stdout).not.toContain("SHOULD NOT RUN");
    // 4 named tests + 32 chain leaves
    expect(stderr).toContain(" 36 pass");
    expect(exitCode).toBe(0);
  });

  test("scanning a relative subdirectory only runs tests under it", async () => {
    using dir = tempDir("scanner-subdir", {
      "root_only.test.ts": `import { test } from "bun:test"; test("root", () => { console.log("RAN root"); });`,
      "nested/inner.test.ts": `import { test } from "bun:test"; test("inner", () => { console.log("RAN inner"); });`,
      "nested/deeper/most.test.ts": `import { test } from "bun:test"; test("most", () => { console.log("RAN most"); });`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./nested"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("RAN inner");
    expect(stdout).toContain("RAN most");
    expect(stdout).not.toContain("RAN root");
    expect(stderr).toContain(" 2 pass");
    expect(exitCode).toBe(0);
  });

  test("scanning a relative file path that is not a directory runs that single file", async () => {
    using dir = tempDir("scanner-single-file", {
      "solo.test.ts": `import { test } from "bun:test"; test("solo", () => { console.log("RAN solo"); });`,
      "other.test.ts": `import { test } from "bun:test"; test("other", () => { console.log("RAN other"); });`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./solo.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("RAN solo");
    expect(stdout).not.toContain("RAN other");
    expect(stderr).toContain(" 1 pass");
    expect(exitCode).toBe(0);
  });

  // The scanner builds every absolute path in a PathBuffer of MAX_PATH_BYTES:
  // 4096 on Linux, 1024 on every other POSIX (src/bun_core/util.rs). On Windows
  // it is 32767*3+1 bytes, more than a command line or an NT path can hold, so
  // the overflow is unreachable there.
  const maxPathBytes = isLinux ? 4096 : 1024;
  const existsTest = `import { test } from "bun:test"; test("exists", () => {});`;

  for (const [kind, prefix, len] of [
    ["absolute", "/", 5000],
    ["absolute", "/", 100_000],
    ["relative", "./", 5000],
  ] as const) {
    test.skipIf(isWindows)(
      `${kind} path argument of ${len} bytes (longer than MAX_PATH_BYTES) reports no match instead of panicking`,
      async () => {
        using dir = tempDir("scanner-long-arg", { "exists.test.ts": existsTest });
        const longArg = prefix + Buffer.alloc(len, "a").toString() + ".test.ts";

        await using proc = Bun.spawn({
          cmd: [bunExe(), "test", longArg],
          env: bunEnv,
          cwd: String(dir),
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

        expect(stderr).toContain("had no matches");
        expect(exitCode).toBe(1);
      },
    );
  }

  test.skipIf(isWindows)(
    "a path argument longer than MAX_PATH_BYTES is skipped like a missing path when other arguments match",
    async () => {
      using dir = tempDir("scanner-long-arg-mixed", { "exists.test.ts": existsTest });
      const longArg = "/" + Buffer.alloc(5000, "a").toString() + ".test.ts";

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "./exists.test.ts", longArg],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(stderr).toContain("Ran 1 test across 1 file.");
      expect(exitCode).toBe(0);
    },
  );

  // The directory walk joins parent + entry name for every directory it
  // descends into and every candidate test file. With pathIgnorePatterns
  // configured it additionally joins each directory before queueing it, so the
  // same tree is scanned once per configuration to reach both code paths.
  for (const [config, files] of [
    ["no bunfig", {}],
    ["pathIgnorePatterns configured", { "bunfig.toml": `[test]\npathIgnorePatterns = ["unrelated/**"]\n` }],
  ] as const) {
    test.skipIf(isWindows)(
      `entries whose absolute path exceeds MAX_PATH_BYTES are skipped during the directory walk (${config})`,
      async () => {
        using dir = tempDir("scanner-deep-tree", {
          ...files,
          "shallow.test.ts": `import { test } from "bun:test"; test("shallow", () => {});`,
        });
        const root = String(dir);
        // Each level adds "/" + segment = 255 bytes. The deepest directory the
        // scanner can still open is the last one whose path is at most
        // maxPathBytes - 1 (it reserves one byte for the NUL); the directory
        // below it is skipped. A 255-byte name in the deepest directory
        // overflows too: that directory is at most 254 bytes short of the limit
        // and the name adds 256. The deepest directory gets three such entries:
        // a test file, a subdirectory, and a symlink. readdir does not report a
        // symlink's kind, so the scanner stats it first, and that stat builds
        // the path through the resolver (RealFS::kind) rather than through the
        // scanner's own joins.
        const segment = Buffer.alloc(254, "d").toString();
        const longTestFile = Buffer.alloc(247, "f").toString() + ".test.ts";
        const longTestLink = Buffer.alloc(247, "l").toString() + ".test.ts";
        const fitDepth = Math.floor((maxPathBytes - 1 - root.length) / (segment.length + 1));
        expect([longTestFile.length, longTestLink.length]).toEqual([255, 255]);
        expect(root.length + fitDepth * 255 + 256).toBeGreaterThan(maxPathBytes);

        // The over-long entries cannot be addressed by absolute path
        // (ENAMETOOLONG), so walk down the chain and create them relative to
        // the deepest directory.
        const script = ["set -e"];
        for (let level = 1; level <= fitDepth; level++) {
          script.push(`mkdir ${segment} && cd ${segment}`);
        }
        script.push(`touch ${longTestFile}`, `ln -s ${longTestFile} ${longTestLink}`, `mkdir ${segment}`);
        await using setup = Bun.spawn({
          cmd: ["bash", "-c", script.join("\n")],
          env: bunEnv,
          cwd: root,
          stderr: "pipe",
        });
        const [setupStderr, setupExitCode] = await Promise.all([setup.stderr.text(), setup.exited]);
        expect(setupStderr).toBe("");
        expect(setupExitCode).toBe(0);

        await using proc = Bun.spawn({
          cmd: [bunExe(), "test"],
          env: bunEnv,
          cwd: root,
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

        expect(stderr).toContain("shallow.test.ts:");
        expect(stderr).toContain("Ran 1 test across 1 file.");
        expect(exitCode).toBe(0);
      },
    );
  }

  // https://github.com/oven-sh/bun/issues/39852
  test.skipIf(isWindows)("does not keep a directory fd open per scanned directory", async () => {
    const N = 64;
    const files: Record<string, string> = {};
    for (let i = 0; i < N; i++) {
      files[`sub${i}/a/b/c/.gitkeep`] = "";
    }
    files["sub0/probe.test.ts"] = /* ts */ `
      import { test } from "bun:test";
      import { readdirSync } from "node:fs";
      test("probe", () => {
        console.log("OPEN_FDS=" + readdirSync(process.platform === "linux" ? "/proc/self/fd" : "/dev/fd").length);
      });
    `;
    using dir = tempDir("scanner-dir-fds", files);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "probe"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // 4N+1 directories are scanned; none of them may stay open.
    expect(Number(stdout.match(/OPEN_FDS=(\d+)/)?.[1])).toBeLessThan(N);
    expect(stderr).toContain(" 1 pass");
    expect(exitCode).toBe(0);
  });
});

test("reports a bunfig [test] root longer than the path buffer like a missing directory", async () => {
  const root = Buffer.alloc(100_000, "r").toString();
  using dir = tempDir("bunfig-root-too-long", {
    "bunfig.toml": `[test]\nroot = "${root}"\n`,
    "top.test.ts": `import { test } from "bun:test"; test("top", () => {});`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Failed to scan non-existent root directory for tests:");
  expect(stderr).toContain(root);
  expect(exitCode).toBe(1);
});

test("hooks throw in a Worker", async () => {
  using dir = tempDir("bun-test-hooks-in-worker", {
    "hooks.test.ts": `
      import { afterAll, afterEach, onTestFinished, test } from "bun:test";
      import { isMainThread, parentPort, Worker } from "node:worker_threads";
      if (isMainThread) {
        test("starts a Worker", async () => {
          const worker = new Worker(import.meta.filename);
          worker.on("message", console.log);
          await new Promise(resolve => worker.once("exit", resolve));
        });
      } else {
        for (const hook of [afterEach, afterAll, onTestFinished]) {
          try {
            hook(() => {});
          } catch (e) {
            parentPort.postMessage(e.message);
          }
        }
      }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "hooks.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain(
    "Cannot use afterEach() in a Worker.\nCannot use afterAll() in a Worker.\nCannot use onTestFinished() in a Worker.\n",
  );
  expect(stderr).toContain(" 1 pass");
  expect(exitCode).toBe(0);
});
