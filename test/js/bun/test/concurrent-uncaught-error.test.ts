import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// Runs `bun test` on `files` and returns what it reported: the result line of each test, the
// summary, the `<failure>` message of each test case in the JUnit file, and the exit code.
async function report(files: Record<string, string>, args: string[] = []) {
  using dir = tempDir("concurrent-uncaught-error", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args, "--reporter=junit", "--reporter-outfile=junit.xml"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = stderr.split("\n");
  const junit: Record<string, string | null> = {};
  const xml = await Bun.file(join(String(dir), "junit.xml")).text();
  for (const [, name, , message] of xml.matchAll(
    /<testcase name="([^"]*)"[^>]*?(\/>|>\s*<failure [^>]*?message="([^"]*)")/g,
  )) {
    junit[name] = message ?? null;
  }
  return {
    stdout: stdout.split("\n").filter(line => line !== "" && !line.startsWith("bun test ")),
    tests: lines
      .filter(line => /^\((pass|fail)\) /.test(line))
      .map(line => line.replace(/ \[[\d.]+ms\]$/, ""))
      .sort(),
    summary: lines.map(line => line.trim()).filter(line => /^\d+ (pass|fail|errors?)$/.test(line)),
    junit,
    exitCode,
  };
}

// Each of these tests causes one uncaught error from something its body started, and stays
// pending until a macrotask after the error. The error's message is the name of the test.
// "passes" is still running when the last error fires.
const kinds = [
  "setTimeout",
  "setInterval",
  "setImmediate",
  "process.nextTick",
  "queueMicrotask",
  "EventEmitter error",
  "reportError",
  "unhandled rejection",
  "unhandled rejection after await",
  "then callback throws",
];
const fixture = (how: string, register: string) => `
  import { describe, test } from "bun:test";
  import { EventEmitter } from "node:events";

  const later = (resolve: () => void) => setTimeout(resolve, 0);
  const fired: Promise<void>[] = [];

  function register(t: typeof test) {
    const owner = (kind: string, start: (fail: () => void, error: Error) => void) => {
      const name = ${JSON.stringify(how)} + ": " + kind;
      const { promise, resolve: didFire } = Promise.withResolvers<void>();
      fired.push(promise);
      t(name, async () => {
        const { promise: ended, resolve: end } = Promise.withResolvers<void>();
        start(() => {
          didFire();
          later(end);
        }, new Error(name));
        await ended;
      });
    };
    const throws = (fail: () => void, error: Error) => () => {
      fail();
      throw error;
    };
    owner("setTimeout", (fail, error) => setTimeout(throws(fail, error), 0));
    owner("setInterval", (fail, error) => {
      const interval = setInterval(() => {
        clearInterval(interval);
        throws(fail, error)();
      }, 0);
    });
    owner("setImmediate", (fail, error) => setImmediate(throws(fail, error)));
    owner("process.nextTick", (fail, error) => process.nextTick(throws(fail, error)));
    owner("queueMicrotask", (fail, error) => queueMicrotask(throws(fail, error)));
    owner("EventEmitter error", (fail, error) =>
      setTimeout(() => {
        fail();
        new EventEmitter().emit("error", error);
      }, 0),
    );
    owner("reportError", (fail, error) =>
      setTimeout(() => {
        fail();
        reportError(error);
      }, 0),
    );
    owner("unhandled rejection", (fail, error) => {
      fail();
      Promise.reject(error);
    });
    owner("unhandled rejection after await", async (fail, error) => {
      await new Promise<void>(later);
      fail();
      Promise.reject(error);
    });
    owner("then callback throws", (fail, error) => {
      Promise.resolve().then(throws(fail, error));
    });
    t(${JSON.stringify(how)} + ": passes", async () => {
      await Promise.all(fired);
      await new Promise<void>(later);
    });
  }

  ${register}
`;
// What `bun test` reports for the fixtures of `hows`: every test fails with its own error.
function expected(hows: string[]) {
  const failed = hows.flatMap(how => kinds.map(kind => `${how}: ${kind}`));
  const passed = hows.map(how => `${how}: passes`);
  return {
    stdout: [],
    tests: [...failed.map(name => `(fail) ${name}`), ...passed.map(name => `(pass) ${name}`)].sort(),
    summary: [`${passed.length} pass`, `${failed.length} fail`],
    junit: Object.fromEntries([...failed.map(name => [name, name]), ...passed.map(name => [name, null])]),
    exitCode: 1,
  };
}

test.concurrent("an uncaught error fails the concurrent test that caused it", async () => {
  const result = await report({
    // A serial test already fails. It is here so that the groups are held to the same report.
    "serial.test.ts": fixture("serial", "register(test);"),
    "test-concurrent.test.ts": fixture("test.concurrent", "register(test.concurrent);"),
    "describe-concurrent.test.ts": fixture(
      "describe.concurrent",
      `describe.concurrent("group", () => register(test));`,
    ),
    "glob.test.ts": fixture("concurrentTestGlob", "register(test);"),
    "bunfig.toml": `[test]\nconcurrentTestGlob = "**/glob.test.ts"\n`,
  });
  result.tests = result.tests.map(line => line.replace("group > ", ""));
  expect(result).toEqual(expected(["serial", "test.concurrent", "describe.concurrent", "concurrentTestGlob"]));
});

test.concurrent.each([[["--concurrent"]], [["--concurrent", "--max-concurrency", "1"]]])(
  "an uncaught error fails the test that caused it with %j",
  async args => {
    const result = await report({ "flag.test.ts": fixture("flag", "register(test);") }, args);
    expect(result).toEqual(expected(["flag"]));
  },
);

const later = `await new Promise<void>(resolve => setTimeout(resolve, 0));`;

test.concurrent("an uncaught error is unhandled when no running test of the group owns it", async () => {
  const result = await report({
    // The test that started the timer has ended.
    "ended.test.ts": `
      import { test } from "bun:test";
      const fired = Promise.withResolvers<void>();
      test.concurrent("ended before its timer threw", () => {
        setTimeout(() => {
          fired.resolve();
          throw new Error("from a test that ended");
        }, 0);
      });
      test.concurrent("ran while that timer threw", async () => {
        await fired.promise;
        ${later}
      });
    `,
    // A hook started the timer.
    "hook.test.ts": `
      import { beforeEach, describe, test } from "bun:test";
      const fired = Promise.withResolvers<void>();
      let armed = false;
      describe.concurrent("hook", () => {
        beforeEach(() => {
          if (armed) return;
          armed = true;
          setTimeout(() => {
            fired.resolve();
            throw new Error("from beforeEach");
          }, 0);
        });
        for (const name of ["first", "second"]) {
          test(name, async () => {
            await fired.promise;
            ${later}
          });
        }
      });
    `,
    // test.failing expects the error of its own callback.
    "failing.test.ts": `
      import { test } from "bun:test";
      const fired = Promise.withResolvers<void>();
      test.concurrent.failing("marked failing", async () => {
        setTimeout(() => {
          fired.resolve();
          throw new Error("from a failing test");
        }, 0);
        await fired.promise;
        ${later}
      });
      test.concurrent("sibling of the failing test", async () => {
        await fired.promise;
        ${later}
      });
    `,
    // The interval is from beforeAll, so its callback belongs to no test. It throws while the
    // event loop runs under the test that waits in a matcher.
    "resolves.test.ts": `
      import { beforeAll, expect, test } from "bun:test";
      let waiting: (() => void) | undefined;
      beforeAll(() => {
        const interval = setInterval(() => {
          if (!waiting) return;
          clearInterval(interval);
          waiting();
          throw new Error("from beforeAll");
        }, 1);
      });
      test.concurrent("waits in expect().resolves", () => {
        expect(new Promise<void>(resolve => (waiting = resolve))).resolves.toBeUndefined();
      });
      test.concurrent("sibling of resolves", async () => {
        ${later}
      });
    `,
  });
  expect(result).toEqual({
    stdout: [],
    tests: [
      "(fail) marked failing",
      "(pass) ended before its timer threw",
      "(pass) hook > first",
      "(pass) hook > second",
      "(pass) ran while that timer threw",
      "(pass) sibling of resolves",
      "(pass) sibling of the failing test",
      "(pass) waits in expect().resolves",
    ],
    summary: ["7 pass", "1 fail", "4 errors"],
    junit: {
      "ended before its timer threw": null,
      "ran while that timer threw": null,
      first: null,
      second: null,
      "marked failing": "test marked with .failing() did not throw",
      "sibling of the failing test": null,
      "waits in expect().resolves": null,
      "sibling of resolves": null,
    },
    exitCode: 1,
  });
});

test.concurrent("an uncaught error fails the attempt that caused it, and the retry runs to its own end", async () => {
  const result = await report({
    "retry.test.ts": `
      import { test } from "bun:test";
      let attempts = 0;
      test.concurrent(
        "retried",
        async () => {
          if (++attempts === 1) {
            // The promise of attempt 1 settles while attempt 2 runs.
            await new Promise<void>(resolve => {
              setTimeout(() => {
                setTimeout(resolve, 0);
                throw new Error("from attempt 1");
              }, 0);
            });
            console.log("attempt 1 settled");
            return;
          }
          for (let i = 0; i < 4; i++) ${later}
          console.log("attempt 2 ended");
        },
        { retry: 1 },
      );
      test.concurrent("sibling", async () => {
        ${later}
      });
      test("after the group", () => {
        console.log("after the group");
      });
    `,
  });
  expect(result).toEqual({
    stdout: ["attempt 1 settled", "attempt 2 ended", "after the group"],
    tests: ["(pass) after the group", "(pass) retried (attempt 2)", "(pass) sibling"],
    summary: ["3 pass", "0 fail"],
    junit: { retried: null, sibling: null, "after the group": null },
    exitCode: 0,
  });
});

test.concurrent("toThrow() does not take the uncaught error of another test for its own", async () => {
  const result = await report({
    // The timer of the first test throws while the second one waits for the promise of its function.
    "toThrow.test.ts": `
      import { expect, test } from "bun:test";
      const thrown = Promise.withResolvers<void>();
      const waited = Promise.withResolvers<void>();
      test.concurrent("its timer throws", async () => {
        setTimeout(() => {
          thrown.resolve();
          throw new Error("from the timer");
        }, 0);
        await waited.promise;
      });
      test.concurrent("waits in expect(fn).toThrow()", () => {
        expect(() =>
          thrown.promise.then(() => {
            throw new Error("from the function");
          }),
        ).toThrow("from the function");
        waited.resolve();
      });
    `,
  });
  expect(result).toEqual({
    stdout: [],
    tests: ["(fail) its timer throws", "(pass) waits in expect(fn).toThrow()"],
    summary: ["1 pass", "1 fail"],
    junit: { "its timer throws": "from the timer", "waits in expect(fn).toThrow()": null },
    exitCode: 1,
  });
});
