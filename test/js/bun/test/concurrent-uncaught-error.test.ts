import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// Runs `bun test` on `files` and returns what it reported: the result line of each test, the
// summary, the `<failure>` message of each test case in the JUnit file (with the element's name
// in front when a retry passed), the messages of the errors that the JUnit file gives to no
// test, and the exit code.
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
  const unhandled: string[] = [];
  const xml = await Bun.file(join(String(dir), "junit.xml")).text();
  for (const [, name, , kind, message] of xml.matchAll(
    /<testcase name="([^"]*)"[^>]*?(\/>|>\s*<(failure|flakyFailure) [^>]*?message="([^"]*)")/g,
  )) {
    if (name === "(unhandled error)") unhandled.push(message);
    else junit[name] = kind === undefined ? null : kind === "failure" ? message : `${kind}: ${message}`;
  }
  return {
    stdout: stdout.split("\n").filter(line => line !== "" && !line.startsWith("bun test ")),
    tests: lines
      .filter(line => /^\((pass|fail)\) /.test(line))
      .map(line => line.replace(/ \[[\d.]+ms\]$/, ""))
      .sort(),
    summary: lines.map(line => line.trim()).filter(line => /^\d+ (pass|fail|errors?)$/.test(line)),
    junit,
    unhandled: unhandled.sort(),
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
    unhandled: [],
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

test.concurrent("an uncaught error is unhandled when no running test of the group caused it", async () => {
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
    // The timer is from the afterEach hook of a test that has ended.
    "after-each.test.ts": `
      import { afterEach, describe, test } from "bun:test";
      const fired = Promise.withResolvers<void>();
      describe.concurrent("afterEach", () => {
        describe("with the hook", () => {
          afterEach(() => {
            setTimeout(() => {
              fired.resolve();
              throw new Error("from afterEach");
            }, 0);
          });
          test("ended before the timer of its hook threw", () => {});
        });
        test("ran while that timer threw", async () => {
          await fired.promise;
          ${later}
        });
      });
    `,
    // The interval is from beforeAll, which no test of the group called.
    "before-all.test.ts": `
      import { beforeAll, describe, test } from "bun:test";
      const fired = Promise.withResolvers<void>();
      describe.concurrent("beforeAll", () => {
        beforeAll(() => {
          const interval = setInterval(() => {
            clearInterval(interval);
            fired.resolve();
            throw new Error("from beforeAll");
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
  });
  expect(result).toEqual({
    stdout: [],
    tests: [
      "(fail) marked failing",
      "(pass) afterEach > ran while that timer threw",
      "(pass) afterEach > with the hook > ended before the timer of its hook threw",
      "(pass) beforeAll > first",
      "(pass) beforeAll > second",
      "(pass) ended before its timer threw",
      "(pass) ran while that timer threw",
      "(pass) sibling of the failing test",
    ],
    summary: ["7 pass", "1 fail", "4 errors"],
    junit: {
      "ended before its timer threw": null,
      "ran while that timer threw": null,
      "ended before the timer of its hook threw": null,
      first: null,
      second: null,
      "marked failing": "test marked with .failing() did not throw",
      "sibling of the failing test": null,
    },
    unhandled: ["from a failing test", "from a test that ended", "from afterEach", "from beforeAll"],
    exitCode: 1,
  });
});

// Bun calls these listeners outside the async context of the test that added them.
test.concurrent("an uncaught error from a listener that has no async context of a test is unhandled", async () => {
  const result = await report({
    "listeners.test.ts": `
      import { test } from "bun:test";
      import { MessageChannel } from "node:worker_threads";
      test.concurrent("its AbortSignal.timeout listener throws", async () => {
        const fired = Promise.withResolvers<void>();
        AbortSignal.timeout(1).addEventListener("abort", () => {
          fired.resolve();
          throw new Error("from an abort listener");
        });
        await fired.promise;
        ${later}
      });
      test.concurrent("its MessagePort listener throws", async () => {
        const fired = Promise.withResolvers<void>();
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = () => {
          port1.close();
          fired.resolve();
          throw new Error("from a message listener");
        };
        port2.postMessage(1);
        await fired.promise;
        ${later}
      });
      test.concurrent("its Bun.serve handler throws", async () => {
        const fired = Promise.withResolvers<void>();
        using server = Bun.serve({
          port: 0,
          fetch() {
            fired.resolve();
            throw new Error("from a request handler");
          },
        });
        await fetch(server.url).then(response => response.text());
        await fired.promise;
        ${later}
      });
    `,
  });
  expect(result).toEqual({
    stdout: [],
    tests: [
      "(pass) its AbortSignal.timeout listener throws",
      "(pass) its Bun.serve handler throws",
      "(pass) its MessagePort listener throws",
    ],
    summary: ["3 pass", "0 fail", "3 errors"],
    junit: {
      "its AbortSignal.timeout listener throws": null,
      "its MessagePort listener throws": null,
      "its Bun.serve handler throws": null,
    },
    unhandled: ["from a message listener", "from a request handler", "from an abort listener"],
    exitCode: 1,
  });
});

test.concurrent("an uncaught error from what a beforeEach hook started fails the test of that hook", async () => {
  const fixture = (name: string, describe: string) => `
    import { beforeEach, describe, test } from "bun:test";
    const fired = Promise.withResolvers<void>();
    let armed = false;
    ${describe}(${JSON.stringify(name)}, () => {
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
  `;
  const result = await report({
    // A serial test already fails. It is here so that the group is held to the same report.
    "serial.test.ts": fixture("serial", "describe"),
    "concurrent.test.ts": fixture("concurrent", "describe.concurrent"),
  });
  expect(result).toEqual({
    stdout: [],
    tests: [
      "(fail) concurrent > first",
      "(fail) serial > first",
      "(pass) concurrent > second",
      "(pass) serial > second",
    ],
    summary: ["2 pass", "2 fail"],
    junit: { first: "from beforeEach", second: null },
    unhandled: [],
    exitCode: 1,
  });
});

test.concurrent("each test that leaves a rejected promise in the same tick fails with its own error", async () => {
  const result = await report({
    "same-tick.test.ts": `
      import { test } from "bun:test";
      const rejects = async (name: string) => {
        await null;
        throw new Error(name);
      };
      const started = Promise.withResolvers<void>();
      const names = ["first", "second", "third", "fourth"];
      for (const name of names) {
        test.concurrent(name, async () => {
          // Every test goes on in the same microtask drain, after the last one started.
          if (name === names.at(-1)) started.resolve();
          await started.promise;
          rejects(name);
          ${later}
        });
      }
      test.concurrent("passes", async () => {
        await started.promise;
        ${later}
      });
    `,
  });
  expect(result).toEqual({
    stdout: [],
    tests: ["(fail) first", "(fail) fourth", "(fail) second", "(fail) third", "(pass) passes"],
    summary: ["1 pass", "4 fail"],
    junit: { first: "first", second: "second", third: "third", fourth: "fourth", passes: null },
    unhandled: [],
    exitCode: 1,
  });
});

test.concurrent("an uncaught error fails the attempt that caused it, and the tests after the group run", async () => {
  const result = await report({
    "retry.test.ts": `
      import { onTestFinished, test } from "bun:test";
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
        onTestFinished(() => {
          console.log("after the group finished");
        });
      });
    `,
  });
  expect(result).toEqual({
    stdout: ["attempt 1 settled", "attempt 2 ended", "after the group finished"],
    tests: ["(pass) after the group", "(pass) retried (attempt 2)", "(pass) sibling"],
    summary: ["3 pass", "0 fail"],
    junit: { retried: "flakyFailure: from attempt 1", sibling: null, "after the group": null },
    unhandled: [],
    exitCode: 0,
  });
});
