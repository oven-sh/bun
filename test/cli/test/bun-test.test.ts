import { spawnSync } from "bun";
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir, tmpdirSync } from "harness";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

// Every test spawns its own `bun test` in its own temp dir, so they run concurrently.
describe.concurrent("bun test", () => {
  // The default-timeout test needs 5 s of wall time. Its block comes first so that
  // it overlaps with the rest of the file.
  describe("--timeout", () => {
    test("must provide a number timeout", async () => {
      const stderr = await runTest({
        args: ["--timeout", "foo"],
        expectExitCode: 1,
      });
      expect(stderr).toContain('error: Invalid timeout: "foo"');
    });
    test("must provide non-negative timeout", async () => {
      const stderr = await runTest({
        args: ["--timeout", "-1"],
        expectExitCode: 1,
      });
      expect(stderr).toContain('error: Invalid timeout: "-1"');
    });
    // The hanging test awaits a promise that never settles, so nothing races the
    // timeout. `bun test` exits once the last test is done, so the pending
    // promise costs nothing.
    const hangingTest = `
      import { test, expect } from "bun:test";
      test("ok", () => {
        expect().pass();
      });
      test("timeout", async () => {
        await new Promise(() => {});
      });
    `;
    test("timeout can be set to 30ms", async () => {
      const stderr = await runTest({
        args: ["--timeout", "30"],
        input: hangingTest,
        expectExitCode: 1,
      });
      expect(stderr).toContain("(fail) timeout");
      expect(stderr).toContain("this test timed out after 30ms.");
    });
    test("timeout should default to 5000ms", async () => {
      const stderr = await runTest({
        input: hangingTest,
        expectExitCode: 1,
      });
      expect(stderr).toContain("(pass) ok");
      expect(stderr).toContain("(fail) timeout");
      expect(stderr).toContain("this test timed out after 5000ms.");
    }, 10000);
  });
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
  test("can provide no arguments", async () => {
    const stderr = await runTest({
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
      expectExitCode: 1,
    });
    expect(stderr).toContain("test #1");
    expect(stderr).toContain("test #2");
    expect(stderr).toContain("test #3");
  });
  test("can provide a relative file", async () => {
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
    const stderr = await runTest({
      cwd,
      args: [path],
      expectExitCode: 0,
    });
    expect(stderr).toContain(path);
  });
  // This fails on macOS because /private/var symlinks to /var
  test.todo("can provide an absolute file", async () => {
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
    const stderr = await runTest({
      cwd,
      args: [absolutePath],
      expectExitCode: 0,
    });
    expect(stderr).toContain(path);
  });
  test("can provide a relative directory", async () => {
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
    const stderr = await runTest({
      cwd,
      args: [dir],
      expectExitCode: 0,
    });
    expect(stderr).toContain(dir);
  });
  test.todo("can provide an absolute directory", async () => {
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
    const stderr = await runTest({
      cwd,
      args: [absoluteDir],
      expectExitCode: 0,
    });
    expect(stderr).toContain(path);
  });

  describe("when filters are provided", () => {
    // No beforeAll: a hook is a barrier that would wait for every test declared above it.
    it("if that filter is a path to a directory, will run all tests in that directory", async () => {
      const makeTest = (name: string) => `
      import { test, expect } from "bun:test";
      test("${name}", () => {
        expect(1).toBe(1);
      });
      `;
      const stderr = await runTest({
        input: [
          { filename: "foo.test.js", contents: makeTest("foo") },
          { filename: join("bar", "bar1.spec.tsx"), contents: makeTest("bar1") },
          { filename: join("bar", "bar2.spec.ts"), contents: makeTest("bar2") },
        ],
        args: ["./bar"],
        expectExitCode: 0,
      });
      expect(stderr).toContain("(pass) bar1");
      expect(stderr).toContain("(pass) bar2");
      expect(stderr).toContain("2 pass");
      expect(stderr).not.toContain("foo");
    });
  });

  test("works with require", async () => {
    const stderr = await runTest({
      args: [],
      input: [
        `
          const { test, expect } = require("bun:test");
          test("test #1", () => {
            expect().pass();
          })
        `,
      ],
      expectExitCode: 0,
    });
    expect(stderr).toContain("test #1");
  });
  test("works with dynamic import", async () => {
    const stderr = await runTest({
      args: [],
      input: `
        const { test, expect } = await import("bun:test");
        test("test #1", () => {
          expect().pass();
        })
      `,
      expectExitCode: 0,
    });
    expect(stderr).toContain("test #1");
  });
  test("works with cjs require", async () => {
    const cwd = createTest(
      `
        const { test, expect } = require("bun:test");
        test("test #1", () => {
          expect().pass();
        })
      `,
      "test.test.cjs",
    );
    const stderr = await runTest({
      cwd,
      expectExitCode: 0,
    });
    expect(stderr).toContain("test #1");
  });
  test("works with cjs dynamic import", async () => {
    const cwd = createTest(
      `
        const { test, expect } = await import("bun:test");
        test("test #1", () => {
          expect().pass();
        })
      `,
      "test.test.cjs",
    );
    const stderr = await runTest({
      cwd,
      expectExitCode: 0,
    });
    expect(stderr).toContain("test #1");
  });
  test.todo("can provide a mix of files and directories");
  describe("--rerun-each", () => {
    test.todo("can rerun with a default value");
    test.todo("can rerun with a provided value");
  });
  describe("--todo", () => {
    test("should not run todo by default", async () => {
      const stderr = await runTest({
        input: `
          import { test, expect } from "bun:test";
          test.todo("todo", async () => {
            console.error("should not run");
          });
        `,
        expectExitCode: 0,
      });
      expect(stderr).toContain("(todo) todo");
      expect(stderr).not.toContain("should not run");
    });
    test("should run todo when enabled", async () => {
      const stderr = await runTest({
        args: ["--todo"],
        input: `
          import { test, expect } from "bun:test";
          test.todo("todo", async () => {
            console.error("should run");
          });
        `,
        expectExitCode: 1,
      });
      expect(stderr).toContain("should run");
    });
  });
  describe("only", () => {
    test("should run nested describe.only", async () => {
      const stderr = await runTest({
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
        expectExitCode: 0,
      });
      expect(stderr).toContain("reachable");
      expect(stderr).not.toContain("unreachable");
      expect(stderr.match(/reachable/g)).toHaveLength(1);
    });
    test("should skip non-only tests", async () => {
      const stderr = await runTest({
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
        expectExitCode: 0,
      });
      expect(stderr).toContain("reachable");
      expect(stderr).not.toContain("unreachable");
      expect(stderr.match(/reachable/g)).toHaveLength(3);
    });
  });
  describe("--bail", () => {
    test("must provide a number bail", async () => {
      const stderr = await runTest({
        args: ["--bail=foo"],
        expectExitCode: 1,
      });
      expect(stderr).toContain("expects a number");
    });

    test("must provide non-negative bail", async () => {
      const stderr = await runTest({
        args: ["--bail=-1"],
        expectExitCode: 1,
      });
      expect(stderr).toContain("expects a number");
    });

    test("should not be 0", async () => {
      const stderr = await runTest({
        args: ["--bail=0"],
        expectExitCode: 1,
      });
      expect(stderr).toContain("expects a number");
    });

    test("bail should be 1 by default", async () => {
      const stderr = await runTest({
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
        expectExitCode: 1,
      });
      expect(stderr).toContain("Bailed out after 1 failure");
      expect(stderr).not.toContain("test #2");
    });

    test("should bail out after 3 failures", async () => {
      const stderr = await runTest({
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
        expectExitCode: 1,
      });
      expect(stderr).toContain("Bailed out after 3 failures");
      expect(stderr).not.toContain("test #4");
    });
  });
  describe("support for Github Actions", () => {
    test("should not group logs by default", async () => {
      const stderr = await runTest({
        env: {
          GITHUB_ACTIONS: undefined,
        },
        expectExitCode: 0,
      });
      expect(stderr).not.toContain("::group::");
      expect(stderr).not.toContain("::endgroup::");
      expect(stderr).toContain("Ran 0 tests across 1 file.");
    });
    test("should not group logs when disabled", async () => {
      const stderr = await runTest({
        env: {
          GITHUB_ACTIONS: "false",
        },
        expectExitCode: 0,
      });
      expect(stderr).not.toContain("::group::");
      expect(stderr).not.toContain("::endgroup::");
      expect(stderr).toContain("Ran 0 tests across 1 file.");
    });
    test("should group logs when enabled", async () => {
      const stderr = await runTest({
        env: {
          GITHUB_ACTIONS: "true",
        },
        expectExitCode: 0,
      });
      expect(stderr).toContain("::group::");
      expect(stderr.match(/::group::/g)).toHaveLength(1);
      expect(stderr).toContain("::endgroup::");
      expect(stderr.match(/::endgroup::/g)).toHaveLength(1);
    });
    test("should group logs with multiple files", async () => {
      const stderr = await runTest({
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
        expectExitCode: 1,
      });
      expect(stderr).toContain("::group::");
      expect(stderr.match(/::group::/g)).toHaveLength(3);
      expect(stderr).toContain("::endgroup::");
      expect(stderr.match(/::endgroup::/g)).toHaveLength(3);
    });
    test("should group logs with --rerun-each", async () => {
      const stderr = await runTest({
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
        expectExitCode: 1,
      });
      expect(stderr).toContain("::group::");
      expect(stderr.match(/::group::/g)).toHaveLength(6);
      expect(stderr).toContain("::endgroup::");
      expect(stderr.match(/::endgroup::/g)).toHaveLength(6);
    });
    test("should not annotate errors by default", async () => {
      const stderr = await runTest({
        input: `
          import { test, expect } from "bun:test";
          test("fail", () => {
            expect(true).toBe(false);
          });
        `,
        env: {
          GITHUB_ACTIONS: undefined,
        },
        expectExitCode: 1,
      });
      expect(stderr).toContain("(fail) fail");
      expect(stderr).not.toContain("::error");
    });
    test("should not annotate errors with inspect() by default", async () => {
      const stderr = await runTest({
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
        expectExitCode: 0,
      });
      expect(stderr).toContain("(pass) inspect");
      expect(stderr).not.toContain("::error");
    });
    test("should not annotate errors with inspect() when enabled", async () => {
      const stderr = await runTest({
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
        expectExitCode: 0,
      });
      expect(stderr).toContain("(pass) inspect");
      expect(stderr).not.toContain("::error");
    });
    test("should annotate errors in the global scope", async () => {
      const stderr = await runTest({
        input: `
          throw new Error();
        `,
        env: {
          GITHUB_ACTIONS: "true",
        },
        expectExitCode: 1,
      });
      expect(stderr).toMatch(/::error file=.*,line=\d+,col=\d+,title=error::/);
    });
    test.each(["test", "describe"])("should annotate errors in a %s scope", async type => {
      const stderr = await runTest({
        input: `
          import { ${type} } from "bun:test";
          ${type}("fail", () => {
            throw new Error();
          });
        `,
        env: {
          GITHUB_ACTIONS: "true",
        },
        expectExitCode: 1,
      });
      expect(stderr).toMatch(/::error file=.*,line=\d+,col=\d+,title=error::/);
    });
    test.each(["beforeAll", "beforeEach", "afterEach", "afterAll"])(
      "should annotate errors in a %s callback",
      async type => {
        const stderr = await runTest({
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
          expectExitCode: 1,
        });
        expect(stderr).toMatch(/::error file=.*,line=\d+,col=\d+,title=error::/);
      },
    );
    test("should annotate errors with escaped strings", async () => {
      const stderr = await runTest({
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
        expectExitCode: 1,
      });
      expect(stderr).toMatch(/::error file=.*,line=\d+,col=\d+,title=.*::/);
      expect(stderr).toMatch(/error: expect\(received\)\.toBe\(expected\)/); // stripped ansi
      expect(stderr).toMatch(/Expected: false%0AReceived: true%0A/); // escaped newlines
    });
    test("should annotate errors without a stack", async () => {
      const stderr = await runTest({
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
        expectExitCode: 1,
      });
      expect(stderr).toMatch(/::error file=.*,line=\d+,col=\d+,title=error: Oops!::/m);
    });
    test("should annotate an error message containing non-ASCII bytes", async () => {
      const stderr = await runTest({
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
        expectExitCode: 1,
      });
      const annotation = stderr.split("\n").find(l => l.startsWith("::error"));
      expect(annotation).toMatch(/^::error file=.*,line=\d+,col=\d+,title=error: hello é world::%0A {6}at /);
    });
    test("should annotate an error message containing emoji and newlines", async () => {
      const stderr = await runTest({
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
        expectExitCode: 1,
      });
      const annotation = stderr.split("\n").find(l => l.startsWith("::error"));
      expect(annotation).toMatch(
        /^::error file=.*,line=\d+,col=\d+,title=error: before 😋 after::second 😋 line%0A {6}at /,
      );
    });
    test("should percent-encode metacharacters in the annotation file property", async () => {
      const stderr = await runTest({
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
        expectExitCode: 1,
      });
      const annotation = stderr.split("\n").find(l => l.startsWith("::error"));
      expect(annotation).toMatch(
        /^::error file=(.*[\\/])?odd%2Cname%25path\.test\.ts,line=\d+,col=\d+,title=error: boom::/,
      );
    });
    test("should percent-encode metacharacters in the annotation title", async () => {
      const stderr = await runTest({
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
        expectExitCode: 1,
      });
      const annotation = stderr.split("\n").find(l => l.startsWith("::error"));
      expect(annotation).toMatch(
        /^::error file=.*,line=\d+,col=\d+,title=Odd%3AName%2CWith%25Chars: alpha%3A one%2C two 100%25::beta: three, four%0A {6}at /,
      );
    });
    test("should keep a function name containing a newline on the annotation line", async () => {
      const stderr = await runTest({
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
        expectExitCode: 1,
      });
      const annotation = stderr.split("\n").find(l => l.startsWith("::error"));
      expect(annotation).toMatch(/^::error file=.*,line=\d+,col=\d+,title=error: boom::/);
      expect(annotation).toContain("%0A      at odd%0Aname (");
    });
    test("should annotate a test timeout", async () => {
      const stderr = await runTest({
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
        expectExitCode: 1,
      });
      expect(stderr).toMatch(/::error title=error: Test \"time out\" timed out after \d+ms::/);
    });
    test("should annotate an error thrown from a source whose URL is longer than a path buffer", async () => {
      // Longer than a path buffer on every platform (98302 bytes on Windows).
      const padding = 100_000;
      const dataUrlModule = 'export default function fromDataUrl() { throw new Error("boom"); }//';
      const base64 = btoa(dataUrlModule + Buffer.alloc(padding, "x").toString());
      const longPath = "/" + Buffer.alloc(padding, "y").toString();
      const stderr = await runTest({
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
    test("should make the annotation file relative to GITHUB_WORKSPACE only when it is a path", async () => {
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
      const stderr = await runTest({
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
  });
  describe(".each", () => {
    test("should run tests with test.each", async () => {
      const numbers = [
        [1, 2, 3],
        [1, 1, 2],
        [3, 4, 7],
      ];

      const stderr = await runTest({
        args: [],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(numbers)})("%i + %i = %i", (a, b, e) => {
            expect(a + b).toBe(e);
          });
        `,
        expectExitCode: 0,
      });
      numbers.forEach(numbers => {
        expect(stderr).toContain(`${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
      });
    });
    test("should allow tests run with test.each to be skipped", async () => {
      const numbers = [
        [1, 2, 3],
        [1, 1, 2],
        [3, 4, 7],
      ];

      const stderr = await runTest({
        args: ["-t", "$a"],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(numbers)})("%i + %i = %i", (a, b, e) => {
            expect(a + b).toBe(e);
          });
        `,
        expectExitCode: 1,
      });
      numbers.forEach(numbers => {
        expect(stderr).not.toContain(`(pass) ${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
      });
    });
    test("should allow tests run with test.each to be matched", async () => {
      const numbers = [
        [1, 2, 3],
        [1, 1, 2],
        [3, 4, 7],
      ];

      const stderr = await runTest({
        args: ["-t", "1 \\+"],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(numbers)})("%i + %i = %i", (a, b, e) => {
            expect(a + b).toBe(e);
          });
        `,
        expectExitCode: 0,
      });
      numbers.forEach(numbers => {
        if (numbers[0] === 1) {
          expect(stderr).toContain(`(pass) ${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
        } else {
          expect(stderr).not.toContain(`(pass) ${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
        }
      });
    });
    test("should run tests with describe.each", async () => {
      const numbers = [
        [1, 2, 3],
        [1, 1, 2],
        [3, 4, 7],
      ];

      const stderr = await runTest({
        args: [],
        input: `
          import { test, expect, describe } from "bun:test";

          describe.each(${JSON.stringify(numbers)})("%i + %i = %i", (a, b, e) => {\
            test("addition", () => {
              expect(a + b).toBe(e);
            });
          });
        `,
        expectExitCode: 0,
      });
      numbers.forEach(numbers => {
        expect(stderr).toContain(`${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
      });
    });
    test("check formatting for %i", async () => {
      const numbers = [
        [1, 2, 3],
        [1, 1, 2],
        [3, 4, 7],
      ];

      const stderr = await runTest({
        args: [],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(numbers)})("%i + %i = %i", (a, b, e) => {
            expect(a + b).toBe(e);
          });
        `,
        expectExitCode: 0,
      });
      numbers.forEach(numbers => {
        expect(stderr).toContain(`${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
      });
    });
    test("check formatting for %f", async () => {
      const numbers = [
        [1.4, 2.9, 4.3],
        [1, 1, 2],
        [3.1, 4.5, 7.6],
      ];

      const stderr = await runTest({
        args: [],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(numbers)})("%f + %f = %d", (a, b, e) => {
            expect(a + b).toBeCloseTo(e);
          });
        `,
        expectExitCode: 0,
      });
      numbers.forEach(numbers => {
        expect(stderr).toContain(`${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
      });
    });
    test("check formatting for %d", async () => {
      const numbers = [
        [1.4, 2.9, 4.3],
        [1, 1, 2],
        [3.1, 4.5, 7.6],
      ];

      const stderr = await runTest({
        args: [],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(numbers)})("%f + %f = %d", (a, b, e) => {
            expect(a + b).toBeCloseTo(e);
          });
        `,
        expectExitCode: 0,
      });
      numbers.forEach(numbers => {
        expect(stderr).toContain(`${numbers[0]} + ${numbers[1]} = ${numbers[2]}`);
      });
    });
    test("check formatting for %s", async () => {
      const strings = ["hello", "world", "foo"];

      const stderr = await runTest({
        args: [],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(strings)})("with a string: %s", (s) => {
            expect(s).toBeTypeOf("string");
          });
        `,
        expectExitCode: 0,
      });
      strings.forEach(s => {
        expect(stderr).toContain(`with a string: ${s}`);
      });
    });
    test("check formatting for %j", async () => {
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

      const stderr = await runTest({
        args: [],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(input)})("with an object: %o", (o) => {
            expect(o).toBe(o);
          });
        `,
        expectExitCode: 0,
      });
      expect(stderr).toContain(`with an object: ${JSON.stringify(input[0])}`);
    });
    test("check formatting for %o", async () => {
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

      const stderr = await runTest({
        args: [],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(input)})("with an object: %o", (o) => {
            expect(o).toBe(o);
          });
        `,
        expectExitCode: 0,
      });
      expect(stderr).toContain(`with an object: ${JSON.stringify(input[0])}`);
    });
    test("check formatting for %#", async () => {
      const numbers = [
        [1, 2, 3],
        [1, 1, 2],
        [3, 4, 7],
      ];

      const stderr = await runTest({
        args: [],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(numbers)})("test number %#: %i + %i = %i", (a, b, e) => {
            expect(a + b).toBe(e);
          });
        `,
        expectExitCode: 0,
      });
      numbers.forEach((_, idx) => {
        expect(stderr).toContain(`test number ${idx}:`);
      });
    });
    test("check formatting for %%", async () => {
      const numbers = [
        [1, 2, 3],
        [1, 1, 2],
        [3, 4, 7],
      ];

      const stderr = await runTest({
        args: [],
        input: `
          import { test, expect } from "bun:test";

          test.each(${JSON.stringify(numbers)})("test number %#: %i + %i = %i %%", (a, b, e) => {
            expect(a + b).toBe(e);
          });
        `,
        expectExitCode: 0,
      });
      expect(stderr).toContain(`%`);
    });
    test.todo("check formatting for %p", () => {});

    describe("$variable syntax", () => {
      test("should replace $variables with object properties in test names", async () => {
        const cases = [
          { a: 1, b: 2, expected: 3 },
          { a: 5, b: 5, expected: 10 },
          { a: -1, b: 1, expected: 0 },
        ];

        const stderr = await runTest({
          args: [],
          input: `
            import { test, expect } from "bun:test";
            
            const cases = ${JSON.stringify(cases)};
            test.each(cases)('$a + $b = $expected', ({ a, b, expected }) => {
              expect(a + b).toBe(expected);
            });
          `,
          expectExitCode: 0,
        });

        expect(stderr).toContain("(pass) 1 + 2 = 3");
        expect(stderr).toContain("(pass) 5 + 5 = 10");
        expect(stderr).toContain("(pass) -1 + 1 = 0");
        expect(stderr).toContain("3 pass");
      });

      test("should show $variable literal when property doesn't exist", async () => {
        const cases = [{ a: 1 }, { a: 2 }];

        const stderr = await runTest({
          args: [],
          input: `
            import { test, expect } from "bun:test";
            
            const cases = ${JSON.stringify(cases)};
            test.each(cases)('value $a with missing $nonexistent', ({ a }) => {
              expect(a).toBeDefined();
            });
          `,
          expectExitCode: 0,
        });

        expect(stderr).toContain("(pass) value 1 with missing $nonexistent");
        expect(stderr).toContain("(pass) value 2 with missing $nonexistent");
        expect(stderr).toContain("2 pass");
      });

      test("should work with describe.each", async () => {
        const cases = [
          { module: "fs", method: "readFile" },
          { module: "path", method: "join" },
        ];

        const stderr = await runTest({
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
          expectExitCode: 0,
        });

        expect(stderr).toContain("fs module > has $method");
        expect(stderr).toContain("path module > has $method");
        expect(stderr).toContain("2 pass");
      });

      test("should work with complex property names", async () => {
        const cases = [
          { user_name: "john_doe", age: 30, is_active: true },
          { user_name: "jane_smith", age: 25, is_active: false },
        ];

        const stderr = await runTest({
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
          expectExitCode: 0,
        });

        expect(stderr).toContain("(pass) user john_doe age 30 active true");
        expect(stderr).toContain("(pass) user jane_smith age 25 active false");
        expect(stderr).toContain("2 pass");
      });

      test("should coexist with % formatting for arrays", async () => {
        const numbers = [
          [1, 2, 3],
          [5, 5, 10],
        ];

        const stderr = await runTest({
          args: [],
          input: `
            import { test, expect } from "bun:test";
            
            test.each(${JSON.stringify(numbers)})('%i + %i = %i', (a, b, expected) => {
              expect(a + b).toBe(expected);
            });
          `,
          expectExitCode: 0,
        });

        expect(stderr).toContain("(pass) 1 + 2 = 3");
        expect(stderr).toContain("(pass) 5 + 5 = 10");
        expect(stderr).toContain("2 pass");
      });

      test("should support nested property access", async () => {
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

        const stderr = await runTest({
          args: [],
          input: `
            import { test, expect } from "bun:test";
            
            const cases = ${JSON.stringify(cases)};
            test.each(cases)('$user.name from $user.profile.city', ({ user, expected }) => {
              expect(\`\${user.name} from \${user.profile.city}\`).toBe(expected);
            });
          `,
          expectExitCode: 0,
        });

        expect(stderr).toContain("(pass) Alice from NYC");
        expect(stderr).toContain("(pass) Bob from LA");
        expect(stderr).toContain("2 pass");
      });

      test("should support array indexing with dot notation", async () => {
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

        const stderr = await runTest({
          args: [],
          input: `
            import { test, expect } from "bun:test";
            
            const cases = ${JSON.stringify(cases)};
            test.each(cases)('first user is $users.0.name', ({ users, first }) => {
              expect(users[0].name).toBe(first);
            });
          `,
          expectExitCode: 0,
        });

        expect(stderr).toContain("(pass) first user is Alice");
        expect(stderr).toContain("(pass) first user is Carol");
        expect(stderr).toContain("2 pass");
      });

      test("handles edge cases with underscores and invalid identifiers", async () => {
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

        const stderr = await runTest({
          args: [],
          input: `
            import { test, expect } from "bun:test";
            
            const cases = ${JSON.stringify(cases)};
            test.each(cases)('Edge: $_valid | $$dollar | $_123mix | $123invalid | $has-dash | $has space', (obj) => {
              expect(obj).toBeDefined();
            });
          `,
          expectExitCode: 0,
        });

        expect(stderr).toContain("underscore");
        expect(stderr).toContain("dollar");
        expect(stderr).toContain("mix");
        expect(stderr).toContain("$123invalid");
        expect(stderr).toContain("$hasdash");
        expect(stderr).toContain("$hasspace");
      });

      test("handles deeply nested properties with arrays", async () => {
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

        const stderr = await runTest({
          args: [],
          input: `
            import { test, expect } from "bun:test";
            
            const cases = ${JSON.stringify(cases)};
            test.each(cases)('First user: $data.users.0.name with tag: $data.users.0.tags.0', (obj) => {
              expect(obj).toBeDefined();
            });
          `,
          expectExitCode: 0,
        });

        expect(stderr).toContain("First user: Alice with tag: admin");
      });

      test("surfaces a throwing custom formatter in the interpolated value as a test error", async () => {
        // The declaration throw aborts module evaluation, so each variant
        // needs its own file to be verified independently.
        const throwing = (message: string) =>
          `({ [Symbol.for("nodejs.util.inspect.custom")]() { throw new Error(${JSON.stringify(message)}); } })`;
        const stderr = await runTest({
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

      test("handles missing properties gracefully", async () => {
        const cases = [{ a: 1 }];

        const stderr = await runTest({
          args: [],
          input: `
            import { test, expect } from "bun:test";
            
            const cases = ${JSON.stringify(cases)};
            test.each(cases)('$a | $missing | $a.b.c | $a', ({ a }) => {
              expect(a).toBe(1);
            });
          `,
          expectExitCode: 0,
        });

        expect(stderr).toContain("1 | $missing| $a.b.c| 1");
      });
    });
  });

  test("Prints error when no test matches", async () => {
    const stderr = await runTest({
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

  test("Does not print the regex error when a test fails", async () => {
    const stderr = await runTest({
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

  test("Does not print the regex error when a test matches and a test passes", async () => {
    const stderr = await runTest({
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

  test("path to a non-test.ts file will work", async () => {
    const stderr = await runTest({
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
      expectExitCode: 0,
    });
    expect(stderr).toContain("test #1");
  });

  test("path to a non-test.ts without ./ will print a helpful hint", async () => {
    const stderr = await runTest({
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
      expectExitCode: 1,
    });
    expect(stderr).not.toContain("test #1");
    expect(stderr).toContain('note: To treat the "index.ts" filter as a path, run "bun test ./index.ts"');
  });

  test("Skipped and todo tests are filtered out when not matching -t filter", async () => {
    const stderr = await runTest({
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
      expectExitCode: 0,
    });
    expect(
      stderr
        .replace(/bun-test-(.*)\.test\.ts/, "bun-test-*.test.ts")
        .replace(/ \[[\d.]+ms\]/g, "") // Remove all timings
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

/** Runs `bun test` and returns its stderr. Async so that concurrent tests overlap. */
async function runTest({
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
} = {}): Promise<string> {
  cwd ??= createTest(input);
  try {
    await using proc = Bun.spawn({
      cwd,
      cmd: [bunExe(), "test", ...args],
      env: { ...bunEnv, AGENT: "0", ...env },
      stderr: "pipe",
      stdout: "ignore",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    if (expectExitCode !== undefined) {
      expect(exitCode, `bun test exited with ${exitCode}, stderr:\n${stderr}`).toBe(expectExitCode);
    }
    return stderr;
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
