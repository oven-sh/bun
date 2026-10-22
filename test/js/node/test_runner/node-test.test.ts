import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, nodeExe, tempDir } from "harness";
import { join, sep } from "node:path";

describe("node:test", () => {
  // These three drive the largest fixtures (01-harness has 32 node:test cases);
  // a debug+ASAN `bun test` child takes several seconds to start, so give them
  // headroom and let them spawn in parallel instead of serially.
  test.concurrent(
    "should run basic tests",
    async () => {
      const { exitCode, stderr } = await runTests(["01-harness.js"]);
      expect({ exitCode, stderr }).toMatchObject({
        exitCode: 0,
        stderr: expect.stringContaining("0 fail"),
      });
    },
    30_000,
  );

  test.concurrent(
    "should run hooks in the right order",
    async () => {
      const { exitCode, stderr } = await runTests(["02-hooks.js"]);
      expect({ exitCode, stderr }).toMatchObject({
        exitCode: 0,
        stderr: expect.stringContaining("0 fail"),
      });
    },
    30_000,
  );

  test("should run tests with different variations", async () => {
    const { exitCode, stderr } = await runTests(["03-test-variations.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run async tests", async () => {
    const { exitCode, stderr } = await runTests(["04-async-tests.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test.concurrent(
    "should run all tests from multiple files",
    async () => {
      const { exitCode, stderr } = await runTests(["01-harness.js", "02-hooks.js"]);
      expect({ exitCode, stderr }).toMatchObject({
        exitCode: 0,
        // 32 from 01-harness + 3 from 02-hooks
        stderr: expect.stringContaining("35 pass"),
      });
    },
    30_000,
  );

  test("should run test() and describe() called inside another test() as subtests", async () => {
    const { exitCode, stderr } = await runTests(["05-test-in-test.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run before hooks created on a running test once and validate hook options", async () => {
    const { exitCode, stderr } = await runTests(["06-hook-semantics.js"]);
    expect(stderr).toContain("4 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should fail tests whose hooks, bodies, or inline suite callbacks fail", async () => {
    const { exitCode, stdout, stderr } = await runTests(["07-failing-hooks.js"]);
    // The subtest after the failing before hook must not run its body (Node).
    expect(stdout).toContain("SUB_BODY_RAN=false");
    expect(stderr).toContain("0 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("10 fail"),
    });
  });

  test("should support done callbacks in tests and hooks", async () => {
    const { exitCode, stderr } = await runTests(["10-done-callbacks.js"]);
    expect(stderr).toContain("2 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should count runtime t.todo()/t.skip() as todo/skip and keep runner timers real under mock timers", async () => {
    const { exitCode, stderr } = await runTests(["12-runtime-todo-and-mock-timers.js"]);
    expect(stderr).toContain("3 pass");
    expect(stderr).toContain("1 skip");
    expect(stderr).toContain("1 todo");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should count runtime t.todo()/t.skip() as todo/skip under --concurrent too", async () => {
    // markCurrentResult's microtask-drain fallback could not name a sequence
    // inside a concurrent group, so the skip/todo mark was dropped and both
    // tests were reported as pass.
    const { exitCode, stderr } = await runTests(["12-runtime-todo-and-mock-timers.js"], {}, ["--concurrent"]);
    expect(stderr).toContain("3 pass");
    expect(stderr).toContain("1 skip");
    expect(stderr).toContain("1 todo");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run todo bodies under --todo instead of registering an empty function", async () => {
    const { exitCode, stderr } = await runTests(["13-todo-bodies.js"], {}, ["--todo"]);
    expect(stderr).toContain("2 todo");
    expect(stderr).toContain("1 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should forward Infinity and finite timeouts so they override the runner default", async () => {
    const { exitCode, stderr } = await runTests(["11-timeout-overrides.js"], {}, ["--timeout", "100"]);
    expect(stderr).toContain("2 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should not leak file-level beforeEach hooks across files in one process", async () => {
    const { exitCode, stderr } = await runTests(["14-root-hooks-a.js", "14-root-hooks-b.js"]);
    expect(stderr).toContain("4 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should treat only as a no-op instead of using bun:test's CI-banned only()", async () => {
    // bun:test's only() only throws when CI is set; pin the precondition.
    const { exitCode, stderr } = await runTests(["08-only-no-op.js"], { CI: "1" });
    expect(stderr).toContain("4 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should serialize inline suites and await async describe callbacks like node", async () => {
    const { exitCode, stderr } = await runTests(["09-inline-suites.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should expose the body outcome to afterEach and workerId to the context", async () => {
    const { exitCode, stderr } = await runTests(["15-outcome-in-hooks.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should capture plan at first t.assert access and resolve subtests started after their parent finished", async () => {
    const { exitCode, stderr } = await runTests(["16-plan-and-late-subtest.js"]);
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("1 todo");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should bound plan({wait:true}) by the test's own timeout instead of hanging", async () => {
    const { exitCode, stderr } = await runTests(["16b-plan-wait-timeout.js"]);
    expect(stderr).toContain("test timed out after 100ms");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should fail the parent when a t.test() that fulfills plan({wait}) throws", async () => {
    const { exitCode, stderr } = await runTests(["24-plan-wait-late-subtest.js"]);
    // The error message from makeTestFailure — must not be satisfied by the
    // fixture's own source lines echoed in the failure context.
    expect(stderr).toContain("error: 1 subtest failed");
    expect(stderr).toContain("boom");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should treat a failing expectFailure test as a pass", async () => {
    const { exitCode, stderr } = await runTests(["25-expect-failure.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should fail an expectFailure test that passes", async () => {
    const { exitCode, stderr } = await runTests(["27-expect-failure-but-passes.js"]);
    expect(stderr).toContain("test was expected to fail but passed");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should fail an expectFailure test whose error does not match the validator", async () => {
    const { exitCode, stderr } = await runTests(["29-expect-failure-mismatch.js"]);
    expect(stderr).toContain("the error did not match the expected validation");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should inherit expectFailure into subtests", async () => {
    // Matches node v26.3.0: the subtest inherits the expectation and passes, so
    // the parent is the one that fails for not failing.
    const { exitCode, stderr } = await runTests(["28-expect-failure-inherited.js"]);
    expect(stderr).toContain("test was expected to fail but passed");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should not run a skipped suite's callback", async () => {
    const { exitCode, stdout, stderr } = await runTests(["26-skipped-suite-body.js"]);
    expect(stdout).not.toContain("[suite body ran: skip-only]");
    // { skip: true, todo: true } is a skip in Node, so this body is skipped too.
    expect(stdout).not.toContain("[suite body ran: both-flags]");
    // A todo suite's callback does run.
    expect(stdout).toContain("[suite body ran: pending-only]");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should reset the module-level mock tracker between --rerun-each iterations", async () => {
    // ESM entry: --rerun-each currently only re-evaluates ESM entry files.
    const { exitCode, stderr } = await runTests(["17-rerun-mock-reset.mjs"], {}, ["--rerun-each=3"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should keep node's zero-delay mock interval semantics", async () => {
    const { exitCode, stderr } = await runTests(["18-mock-timers-interval-zero.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should apply the plan option before beforeEach so a hook cannot snapshot a null plan", async () => {
    const { exitCode, stderr } = await runTests(["19-plan-option-order.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should enforce a hook-level signal and install t.assert.ok separately", async () => {
    const { exitCode, stderr } = await runTests(["20-hook-signal-and-assert-ok.js"]);
    expect(stderr).toContain("2 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should let a registered ok assertion override the built-in one", async () => {
    const { exitCode, stderr } = await runTests(["21-register-ok.js"]);
    expect(stderr).toContain("2 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should gate a nested inline subtest on every ancestor suite's before hooks", async () => {
    const { exitCode, stderr } = await runTests(["22-nested-suite-before.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should resolve the promise of a test that a name pattern filters out", async () => {
    const { exitCode, stderr } = await runTests(["23-filtered-test-promise.js"], {}, ["-t", "should resolve"]);
    expect(stderr).not.toContain("timed out");
    expect(stderr).toContain("1 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });
});

async function runTests(filenames: string[], env: Record<string, string> = {}, args: string[] = []) {
  const testPaths = filenames.map(filename => join(import.meta.dirname, "fixtures", filename));
  const {
    exited,
    stdout: stdoutStream,
    stderr: stderrStream,
  } = spawn({
    cmd: [bunExe(), "test", ...args, ...testPaths],
    env: { ...bunEnv, ...env },
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    exited,
    new Response(stdoutStream).text(),
    new Response(stderrStream).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("node:test mock", () => {
  const { mock } = require("node:test");

  test("mock.getter accepts the (object, methodName, options) overload", () => {
    const obj = {
      get prop() {
        return "original";
      },
    };
    // Passing an options object in the implementation slot must not clobber
    // the getter flag.
    const getter = mock.getter(obj, "prop", {});
    expect(obj.prop).toBe("original");
    expect(getter.mock.callCount()).toBe(1);
    mock.restoreAll();
  });

  test("mock.setter accepts the (object, methodName, options) overload", () => {
    let stored = "";
    const obj = {
      set prop(v: string) {
        stored = v;
      },
    };
    const setter = mock.setter(obj, "prop", {});
    obj.prop = "x";
    expect(stored).toBe("x");
    expect(setter.mock.callCount()).toBe(1);
    mock.restoreAll();
  });

  test("mock.getter rejects getter: false", () => {
    const obj = {
      get prop() {
        return 1;
      },
    };
    expect(() => mock.getter(obj, "prop", { getter: false })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  test("mock.method rejects getter and setter together", () => {
    const obj = {
      get prop() {
        return 1;
      },
      set prop(_v) {},
    };
    expect(() => mock.method(obj, "prop", { getter: true, setter: true })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  test("mock.fn options.times reverts to the original after N calls", () => {
    const original = () => "original";
    const impl = () => "mocked";
    const fn = mock.fn(original, impl, { times: 2 });
    expect(fn()).toBe("mocked");
    expect(fn()).toBe("mocked");
    expect(fn()).toBe("original");
    expect(fn.mock.callCount()).toBe(3);
    mock.restoreAll();
  });

  test("mock.method options.times restores the method after N calls", () => {
    const obj = {
      value: 5,
      addOne() {
        return this.value + 1;
      },
    };
    mock.method(obj, "addOne", () => 100, { times: 1 });
    expect(obj.addOne()).toBe(100);
    expect(obj.addOne()).toBe(6);
    mock.restoreAll();
  });

  test("mock.fn options.times is validated", () => {
    expect(() => mock.fn(() => {}, { times: 0 })).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
    expect(() => mock.fn(() => {}, { times: 1.5 })).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
  });

  test("mock.restoreAll makes bare mock.fn mocks call their original again", () => {
    const fn = mock.fn(
      () => "original",
      () => "mocked",
    );
    expect(fn()).toBe("mocked");
    mock.restoreAll();
    expect(fn()).toBe("original");
  });
});

describe("node:test mock tracker semantics", () => {
  const { mock } = require("node:test");

  test("restoreAll keeps mocks associated; reset disassociates", () => {
    // mirrors observed node behavior exactly
    const f = mock.fn(
      () => "orig",
      () => "mocked",
    );
    expect(f()).toBe("mocked");
    mock.restoreAll();
    expect(f()).toBe("orig");
    // still tracked after restoreAll: reset() reverts a re-installed
    // implementation again
    f.mock.mockImplementation(() => "again");
    expect(f()).toBe("again");
    mock.reset();
    expect(f()).toBe("orig");
    // after reset() the context is disassociated: restoreAll no longer
    // touches it
    f.mock.mockImplementation(() => "post-reset");
    mock.restoreAll();
    expect(f()).toBe("post-reset");
    mock.reset();
  });

  test("queued once-implementations survive restoreAll like node", () => {
    const g = mock.fn(
      () => "g-orig",
      () => "g-mocked",
    );
    g.mock.mockImplementationOnce(() => "g-once", 1);
    mock.restoreAll();
    expect([g(), g(), g()]).toEqual(["g-orig", "g-once", "g-orig"]);
    mock.reset();
  });

  test("mock.method validates a non-object options argument", () => {
    const obj = {
      foo() {},
    };
    expect(() => mock.method(obj, "foo", () => {}, 5)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });
});

test("the call record is pushed after the implementation runs, like node", () => {
  const { mock } = require("node:test");
  let inside = -1;
  const f = mock.fn(function () {
    inside = f.mock.callCount();
    return 1;
  });
  f();
  expect(inside).toBe(0);
  expect(f.mock.callCount()).toBe(1);
  mock.reset();
});

test("mock.property/mock.method survive a polluted Object.prototype", async () => {
  // The defineProperty descriptors must carry __proto__:null so an inherited
  // `value` on Object.prototype does not turn the accessor descriptor into a
  // TypeError (nodejs/node lib/internal/test_runner/mock/mock.js does this).
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        Object.prototype.value = 1;
        const { mock } = require("node:test");
        const obj = { x: 1, get p() { return 5; } };
        mock.property(obj, "x");
        mock.getter(obj, "p");
        console.log("ok");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toMatchObject({ stdout: "ok", exitCode: 0 });
});

// run() starts one `bun test` process for each file. Node.js documents that such a process
// inherits the options of the process that called run() ("Child process option inheritance").
//
// Each test here starts a bun process that starts more bun processes. On a debug+ASAN build
// one of them takes several seconds to start, so the tests have more than the 5 seconds a
// test has by default, as the first tests of this file do.
describe("run() starts each file with the runtime flags of its caller", () => {
  const fixture = {
    // The file run() is given. It prints what its process was started with and what that allows.
    "probe.test.mjs": `
      import { test } from "node:test";
      import net from "node:net";
      import tls from "node:tls";
      test("probe", () => {
        let dlopen = "tried";
        try {
          process.dlopen({ exports: {} }, "/nonexistent/addon.node");
        } catch (error) {
          if (error.code === "ERR_DLOPEN_DISABLED") dlopen = "refused";
        }
        let codeFromString = "allowed";
        try {
          new Function("return 1")();
        } catch (error) {
          codeFromString = error.name;
        }
        console.log(
          "PROBE " +
            JSON.stringify({
              execArgv: process.execArgv,
              dlopen,
              codeFromString,
              tlsMin: tls.DEFAULT_MIN_VERSION,
              autoSelectFamily: net.getDefaultAutoSelectFamily(),
              dotenv: process.env.FROM_DOTENV ?? null,
              envFile: process.env.FROM_ENV_FILE ?? null,
              preloaded: globalThis.PRELOADED ?? null,
              defined: typeof RUN_FLAG === "undefined" ? null : RUN_FLAG,
              title: process.title,
            }),
        );
      });
    `,
    // run() of a file: what the file printed, and how the run went.
    "probe.mjs": `
      import { run } from "node:test";
      import { fileURLToPath } from "node:url";
      export async function probe(options = {}) {
        const result = { probes: [], stdout: [], fail: 0 };
        const files = [fileURLToPath(new URL("./probe.test.mjs", import.meta.url))];
        for await (const { type, data } of run({ files, ...options })) {
          if (type === "test:stdout" && data.message.startsWith("PROBE ")) {
            result.probes.push(JSON.parse(data.message.slice("PROBE ".length)));
          } else if (type === "test:stdout") {
            result.stdout.push(data.message.trim());
          } else if (type === "test:fail") {
            result.fail++;
          }
        }
        return result;
      }
    `,
    "pre.mjs": `globalThis.PRELOADED = true;`,
    ".env": `FROM_DOTENV=1\n`,
    "other.env": `FROM_ENV_FILE=1\n`,
    "other.bunfig.toml": `[console]\ndepth = 8\n`,
    "tsconfig.json": `{}`,
    "elsewhere/deep/empty.txt": ``,
    // If an argument in front of `test` did not start with "-", the child would run this script.
    "package.json": JSON.stringify({ name: "run-flags", scripts: { test: "echo the package.json script ran" } }),
  };
  const runner = `
    import net from "node:net";
    import { probe } from "./probe.mjs";
    const caller = { autoSelectFamily: net.getDefaultAutoSelectFamily() };
    console.log("RESULT " + JSON.stringify({ caller, ...(await probe()) }));
  `;
  // The same as a script for -e, for stdin and for the REPL.
  const script = `const { probe } = await import("./probe.mjs"); console.log("RESULT " + JSON.stringify(await probe()));`;

  const { BUN_OPTIONS: _, NODE_TEST_CONTEXT: __, ...env } = bunEnv;

  // Runs `cmd` in a copy of the fixture and returns the value its "RESULT " line carries, and
  // the exit code.
  async function result(
    files: Record<string, string>,
    cmd: string[],
    given: {
      env?: Record<string, string>;
      stdin?: string;
      directory?: string;
      spelling?: (directory: string) => string;
    } = {},
  ) {
    using dir = tempDir(given.directory ?? "node-test-run-flags", { ...fixture, ...files });
    await using proc = spawn({
      cmd,
      cwd: given.spelling ? given.spelling(String(dir)) : String(dir),
      env: { ...env, ...given.env },
      stdin: given.stdin === undefined ? "ignore" : new Blob([given.stdin]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The coordinator of `bun test --parallel` prints what its workers print on stderr.
    const line = `${stdout}\n${stderr}`.split("\n").find(line => line.startsWith("RESULT "));
    if (line === undefined)
      throw new Error(`no RESULT line\nexit code: ${exitCode}\nstdout: ${stdout}\nstderr: ${stderr}`);
    return { ...JSON.parse(line.slice("RESULT ".length)), exitCode };
  }

  // What a child process that was given no flag reports.
  const unflagged = { execArgv: [], dlopen: "tried", codeFromString: "allowed", dotenv: "1", preloaded: null };

  test.concurrent.each([
    ["bun <flags> <file>", []],
    ["bun run <flags> <file>", ["run"]],
  ])(
    "%s: the child is under the flags, and the execArgv option comes after them",
    async (_, door) => {
      const flags = [
        "--disallow-code-generation-from-strings=strict",
        "--no-addons",
        "--tls-min-v1.3",
        "--no-env-file",
      ];
      const { inherited, overridden, print, exitCode } = await result(
        {
          "runner.mjs": `
            import { probe } from "./probe.mjs";
            const [inherited, overridden, print] = await Promise.all([
              probe(),
              probe({ execArgv: ["--title=from-run"] }),
              // Node.js's own test of the option: the child evaluates the script and runs no file.
              probe({ execArgv: ["-p", '"Printed"'] }),
            ]);
            console.log("RESULT " + JSON.stringify({ inherited, overridden, print }));
          `,
        },
        // `--preload` has its value as an argument of its own: the child is given one argument.
        // What follows the file is the program's, not a flag of the process.
        [
          bunExe(),
          ...door,
          ...flags,
          "--preload",
          "./pre.mjs",
          "--title=from-the-command-line",
          "runner.mjs",
          "--smol",
        ],
      );
      const held = {
        execArgv: [...flags, "--preload=./pre.mjs", "--title=from-the-command-line"],
        dlopen: "refused",
        codeFromString: "EvalError",
        tlsMin: "TLSv1.3",
        dotenv: null,
        preloaded: true,
        title: "from-the-command-line",
      };
      expect(inherited).toMatchObject({ probes: [held], fail: 0 });
      expect(overridden).toMatchObject({
        probes: [{ ...held, execArgv: [...held.execArgv, "--title=from-run"], title: "from-run" }],
        fail: 0,
      });
      expect(print).toEqual({ probes: [], stdout: ["Printed"], fail: 0 });
      expect(exitCode).toBe(0);
    },
    60_000,
  );

  test.skipIf(!nodeExe()).concurrent(
    "--disallow-code-generation-from-strings, --no-addons, --tls-min-v1.3, --no-network-family-autoselection, --import and --title: the child is under them as the child of Node.js is",
    async () => {
      const flags = [
        "--disallow-code-generation-from-strings",
        "--no-addons",
        "--tls-min-v1.3",
        "--no-network-family-autoselection",
        "--import=./pre.mjs",
        "--title=run-flags",
      ];
      const under = async (exe: string) => {
        const { probes, fail, exitCode } = await result({ "runner.mjs": runner }, [exe, ...flags, "runner.mjs"]);
        const effects = probes.map(({ dlopen, codeFromString, tlsMin, autoSelectFamily, preloaded, title }) => {
          return { dlopen, codeFromString, tlsMin, autoSelectFamily, preloaded, title };
        });
        return { effects, fail, exitCode };
      };
      const [bun, node] = await Promise.all([under(bunExe()), under(nodeExe()!)]);
      expect(bun).toEqual({
        effects: [
          {
            dlopen: "refused",
            codeFromString: "EvalError",
            tlsMin: "TLSv1.3",
            autoSelectFamily: false,
            preloaded: true,
            title: "run-flags",
          },
        ],
        fail: 0,
        exitCode: 0,
      });
      expect(bun).toEqual(node);
    },
    60_000,
  );

  test.concurrent(
    "the child is given the flags in the order its caller was given them",
    async () => {
      // Of this pair the last one counts, and no flag table of Bun has them: node:net reads
      // them from process.execArgv.
      const on = "--network-family-autoselection";
      const off = "--no-network-family-autoselection";
      const [last, first, twice] = await Promise.all([
        result({ "runner.mjs": runner }, [bunExe(), off, on, "runner.mjs"]),
        result({ "runner.mjs": runner }, [bunExe(), on, off, "runner.mjs"]),
        // A flag with one value: the caller runs under the last one, and so does the child.
        result({ "runner.mjs": runner }, [bunExe(), "--title=first", "--smol", "--title=second", "runner.mjs"]),
      ]);
      expect(last).toMatchObject({
        caller: { autoSelectFamily: true },
        probes: [{ execArgv: [off, on], autoSelectFamily: true }],
        fail: 0,
        exitCode: 0,
      });
      expect(first).toMatchObject({
        caller: { autoSelectFamily: false },
        probes: [{ execArgv: [on, off], autoSelectFamily: false }],
        fail: 0,
        exitCode: 0,
      });
      expect(twice).toMatchObject({
        probes: [{ execArgv: ["--title=first", "--smol", "--title=second"], title: "second" }],
        fail: 0,
        exitCode: 0,
      });
    },
    60_000,
  );

  test.concurrent(
    "--use-bundled-ca in the execArgv option replaces --use-system-ca of the caller",
    async () => {
      // Bun takes one of the CA store flags, and ends with an error for two.
      const { probes, fail, exitCode } = await result(
        {
          "runner.mjs": `
            import { probe } from "./probe.mjs";
            console.log("RESULT " + JSON.stringify(await probe({ execArgv: ["--use-bundled-ca"] })));
          `,
        },
        [bunExe(), "--use-system-ca", "--smol", "runner.mjs"],
      );
      expect({ probes, fail, exitCode }).toMatchObject({
        probes: [{ execArgv: ["--smol", "--use-bundled-ca"] }],
        fail: 0,
        exitCode: 0,
      });
    },
    60_000,
  );

  test.concurrent(
    "a child that is given every flag it can be given runs its file",
    async () => {
      // Every flag `bun run` and `bun test` share, but the ones that stay with the caller, the
      // ones that connect somewhere, the ones that exclude another one in the list, and the
      // profiles that take seconds to write in a debug build. The last four are flags that no
      // table of Bun has.
      const flags = `
        --env-file=./other.env --no-env-file --config=./other.bunfig.toml --main-fields=module
        --main-fields=main --preserve-symlinks --preserve-symlinks-main --extension-order=.ts
        --extension-order=.mjs --extension-order=.js --extension-order=.json
        --tsconfig-override=./tsconfig.json --define=RUN_FLAG:1 --drop=debugger --feature=RUN_FLAG
        --loader=.run-flag:text --no-macros --jsx-factory=h --jsx-fragment=Fragment
        --jsx-import-source=react --jsx-runtime=classic --jsx-side-effects --ignore-dce-annotations
        --watch-kill-signal=SIGTERM --no-clear-screen --smol --interactive --preload=./pre.mjs
        --require=./pre.mjs --import=./pre.mjs --cpu-prof --cpu-prof-name=run-flags.cpuprofile
        --cpu-prof-dir=./profiles --cpu-prof-interval=1000 --no-install --install=fallback -i
        --prefer-offline --origin=http://localhost --conditions=development
        --experimental-http2-fetch --experimental-http3-fetch --max-http-header-size=9999
        --insecure-http-parser --dns-result-order=ipv4first --experimental-stream-iter --expose-gc
        --no-deprecation --throw-deprecation --no-warnings --trace-warnings --trace-deprecation
        --pending-deprecation --redirect-warnings=./warnings.txt --disable-warning=DEP0001
        --title=every-flag --zero-fill-buffers --use-bundled-ca --tls-min-v1.2 --tls-max-v1.3
        --no-addons --no-ffi-cc --disallow-code-generation-from-strings
        --unhandled-rejections=strict --console-depth=4 --user-agent=every-flag/1
        --trace-events-enabled --trace-event-categories=node --trace-event-file-pattern=trace.log
        --trace-env --trace-env-js-stack --trace-env-native-stack --trace-exit --expose-internals
        --stack-trace-limit=20 --network-family-autoselection --no-network-family-autoselection
        --network-family-autoselection-attempt-timeout=500 --tls-keylog=./keys.log
      `;
      const { probes, fail, exitCode } = await result({ "runner.mjs": runner }, [
        bunExe(),
        ...flags.trim().split(/\s+/),
        "runner.mjs",
      ]);
      expect({ probes, fail, exitCode }).toMatchObject({
        probes: [{ execArgv: flags.trim().split(/\s+/), preloaded: true, defined: 1, title: "every-flag" }],
        fail: 0,
        exitCode: 0,
      });
    },
    60_000,
  );

  test.concurrent(
    "the flags that say what the caller itself does stay with it",
    async () => {
      const { probes, fail, exitCode } = await result(
        {
          // The caller never ends by itself under --hot, and a child that was given --watch
          // would not end either: the run is stopped once the file has printed.
          "runner.mjs": `
            import { run } from "node:test";
            import { fileURLToPath } from "node:url";
            const stop = new AbortController();
            const result = { probes: [], fail: 0 };
            const files = [fileURLToPath(new URL("./probe.test.mjs", import.meta.url))];
            for await (const { type, data } of run({ files, signal: stop.signal })) {
              if (type === "test:stdout" && data.message.startsWith("PROBE ")) {
                result.probes.push(JSON.parse(data.message.slice("PROBE ".length)));
                stop.abort();
                break;
              }
              if (type === "test:fail") result.fail++;
            }
            console.log("RESULT " + JSON.stringify(result));
            process.exit(0);
          `,
        },
        // --smol is not such a flag: the child is given it.
        [
          bunExe(),
          "--hot",
          "--watch",
          "--if-present",
          "--inspect=127.0.0.1:0",
          "--port=0",
          "--smol",
          "--check",
          "--cwd=.",
          "runner.mjs",
        ],
      );
      expect({ probes, fail, exitCode }).toMatchObject({
        probes: [{ ...unflagged, execArgv: ["--smol"] }],
        fail: 0,
        exitCode: 0,
      });
    },
    60_000,
  );

  test.concurrent(
    "what is not a flag of the caller does not become a flag of the child",
    async () => {
      // The script of -e, the flags that only `bun test` has, and the arguments of the program.
      // --smol is a flag of the caller: the child is given it.
      const testOnly = ["--only", "--shard=2/2", "--timeout=5"];
      const [evaluated, fromStdin] = await Promise.all([
        result({}, [
          bunExe(),
          ...testOnly,
          "--cron-title=t",
          "--smol",
          "--cron-period=p",
          "-e",
          script,
          "--",
          "--no-addons",
        ]),
        result({}, [bunExe(), "--smol", "-", "-l", "verbose", "--no-addons"], { stdin: script }),
      ]);
      const held = { probes: [{ ...unflagged, execArgv: ["--smol"] }], fail: 0, exitCode: 0 };
      expect(evaluated).toMatchObject(held);
      expect(fromStdin).toMatchObject(held);
    },
    60_000,
  );

  test.concurrent(
    "bun repl <flags>: the REPL hands its flags on as `bun run` does",
    async () => {
      const cmd = [bunExe(), "repl", "--title=from-the-repl", "--preload=./pre.mjs", "-e", script];
      expect(await result({}, cmd)).toMatchObject({
        probes: [
          {
            ...unflagged,
            execArgv: ["--title=from-the-repl", "--preload=./pre.mjs"],
            preloaded: true,
            title: "from-the-repl",
          },
        ],
        fail: 0,
        exitCode: 0,
      });
    },
    60_000,
  );

  test.concurrent(
    "bun <flags> test <flags> <file>: each flag is on the side of `test` where the caller has it",
    async () => {
      const files = {
        "outer.test.mjs": `
          import { test } from "bun:test";
          import { probe } from "./probe.mjs";
          test("run() in a test", async () => {
            const [ofFile, ofScript] = await Promise.all([
              probe(),
              // The child evaluates this and runs no file.
              probe({ execArgv: ["-p", "JSON.stringify(process.execArgv.filter(it => it.startsWith('--'))) + ' ' + globalThis.PRELOADED"] }),
            ]);
            console.log("RESULT " + JSON.stringify({ ofFile, ofScript }));
          }, 60_000);
        `,
        "setup.mjs": `
          import { beforeAll } from "bun:test";
          beforeAll(() => {
            globalThis.PRELOADED = "by bun test";
          });
        `,
        "ci.toml": `[test]\npreload = ["./setup.mjs"]\n`,
      };
      const [flags, config] = await Promise.all([
        result(files, [bunExe(), "--smol", "test", "--preload", "./setup.mjs", "./outer.test.mjs"]),
        result(files, [bunExe(), "test", "--config=./ci.toml", "./outer.test.mjs"]),
      ]);
      // What is after `test` is in force in the child, and is not in its process.execArgv,
      // which fork() hands on: a helper that was given this preload would fail, because
      // bun:test is only for a test run.
      const held = { preloaded: "by bun test" };
      expect(flags.ofFile).toMatchObject({ probes: [{ ...held, execArgv: ["--smol"] }], fail: 0 });
      expect(config.ofFile).toMatchObject({ probes: [{ ...held, execArgv: [] }], fail: 0 });
      // A child that evaluates a script is not a test run. It is given what is in front of
      // `test`, and not what is after it: this preload is for a test run.
      expect(flags.ofScript).toEqual({ probes: [], stdout: [`["--smol"] undefined`], fail: 0 });
      expect(config.ofScript).toEqual({ probes: [], stdout: [`[] undefined`], fail: 0 });
      expect({ flags: flags.exitCode, config: config.exitCode }).toEqual({ flags: 0, config: 0 });
    },
    60_000,
  );

  test.concurrent(
    "bun test <flags> <file>: the execArgv option has the last word, and a script of the option is not under the flags",
    async () => {
      const { ofFile, ofScript, exitCode } = await result(
        {
          "outer.test.mjs": `
            import { test } from "bun:test";
            import { probe } from "./probe.mjs";
            test("run() in a test", async () => {
              const [ofFile, ofScript] = await Promise.all([
                probe({ execArgv: ["--title=from-run", "--define=RUN_FLAG:2"] }),
                // The child evaluates this and runs no file.
                probe({ execArgv: ["-p", "typeof RUN_FLAG + ' ' + globalThis.PRELOADED"] }),
              ]);
              console.log("RESULT " + JSON.stringify({ ofFile, ofScript }));
            }, 60_000);
          `,
        },
        [
          bunExe(),
          "test",
          "--preload=./pre.mjs",
          "--title=from-the-command-line",
          "--define=RUN_FLAG:1",
          "./outer.test.mjs",
        ],
      );
      expect(ofFile).toMatchObject({
        probes: [
          { execArgv: ["--title=from-run", "--define=RUN_FLAG:2"], title: "from-run", defined: 2, preloaded: true },
        ],
        fail: 0,
      });
      // These flags follow `test`, so they are for a test run. To the script they are arguments.
      expect(ofScript).toEqual({ probes: [], stdout: ["undefined undefined"], fail: 0 });
      expect(exitCode).toBe(0);
    },
    60_000,
  );

  test.concurrent(
    "--disallow-code-generation-from-strings=strict after `test`: a script of the execArgv option is under it too",
    async () => {
      // Only `=strict` refuses node:vm, and the flag in front of `test` does not say `strict`.
      const flag = "--disallow-code-generation-from-strings";
      const vm = `(() => { try { return require("node:vm").runInNewContext("1 + 1"); } catch (error) { return error.name; } })()`;
      const { ofScript, exitCode } = await result(
        {
          "outer.test.mjs": `
            import { test } from "bun:test";
            import { probe } from "./probe.mjs";
            test("run() in a test", async () => {
              const ofScript = await probe({ execArgv: ["-p", ${JSON.stringify(vm)}] });
              console.log("RESULT " + JSON.stringify({ ofScript }));
            }, 60_000);
          `,
        },
        [bunExe(), flag, "test", `${flag}=strict`, "./outer.test.mjs"],
      );
      expect(ofScript).toEqual({ probes: [], stdout: ["EvalError"], fail: 0 });
      expect(exitCode).toBe(0);
    },
    60_000,
  );

  test.concurrent(
    "bun test --parallel: a child is given what its caller runs with, not a command line that a coordinator wrote",
    async () => {
      const files = {
        "in-worker.test.mjs": `
          import { test } from "bun:test";
          import { probe } from "./probe.mjs";
          test("run() in a worker", async () => {
            console.log("RESULT " + JSON.stringify(await probe({ cwd: import.meta.dirname + "/elsewhere" })));
          }, 60_000);
        `,
        "another.test.mjs": `
          import { test } from "bun:test";
          test("a second file, so that there are workers", () => {});
        `,
        // The coordinator writes this preload on the command line of each worker.
        "bunfig.toml": `[test]\npreload = ["./pre.mjs"]\n`,
      };
      const flags = ["--parallel=2", "--no-addons", "--disallow-code-generation-from-strings", "--define=RUN_FLAG:1"];
      // With one file the same command starts no worker.
      const [workers, alone] = await Promise.all([
        result(files, [bunExe(), "test", ...flags, "./in-worker.test.mjs", "./another.test.mjs"]),
        result(files, [bunExe(), "test", ...flags, "./in-worker.test.mjs"]),
      ]);
      const held = {
        probes: [
          {
            execArgv: ["--no-addons", "--disallow-code-generation-from-strings"],
            dlopen: "refused",
            codeFromString: "EvalError",
            preloaded: null,
            defined: null,
          },
        ],
        fail: 0,
        exitCode: 0,
      };
      expect(workers).toMatchObject(held);
      expect(alone).toMatchObject(held);
    },
    60_000,
  );

  // What the caller reads from its directory, for a child of run({ cwd }).
  const elsewhere = {
    "runner.mjs": `
      import { symlinkSync } from "node:fs";
      import { probe } from "./probe.mjs";
      // The caller has the values of the env file in its environment. These children do not.
      const { FROM_ENV_FILE, ...env } = process.env;
      const directories = ["", "/elsewhere"];
      // The directory above the target of the link: "elsewhere".
      if (process.platform !== "win32") {
        symlinkSync(import.meta.dirname + "/elsewhere/deep", import.meta.dirname + "/link");
        directories.push("/link/..");
      }
      const children = await Promise.all(directories.map(it => probe({ env, cwd: import.meta.dirname + it })));
      console.log("RESULT " + JSON.stringify({ cwd: process.cwd(), children }));
    `,
  };

  test.concurrent(
    "a child that starts in another directory reads the files that the caller read",
    async () => {
      const { cwd, children, exitCode } = await result(elsewhere, [
        bunExe(),
        "--env-file=./other.env",
        "--config=./other.bunfig.toml",
        "--tsconfig-override=./tsconfig.json",
        "--preload",
        "./pre.mjs",
        "--import=file://./pre.mjs",
        "runner.mjs",
      ]);
      // A process that is given an env file does not read the ".env" of its directory.
      const read = { envFile: "1", dotenv: null, preloaded: true };
      const typed = [
        "--env-file=./other.env",
        "--config=./other.bunfig.toml",
        "--tsconfig-override=./tsconfig.json",
        "--preload=./pre.mjs",
        "--import=file://./pre.mjs",
      ];
      const resolved = [
        `--env-file=${cwd}${sep}./other.env`,
        `--config=${join(cwd, "other.bunfig.toml")}`,
        `--tsconfig-override=${join(cwd, "tsconfig.json")}`,
        `--preload=${join(cwd, "pre.mjs")}`,
        `--import=${join(cwd, "pre.mjs")}`,
      ];
      const [here, ...others] = children;
      expect(here).toMatchObject({ probes: [{ ...read, execArgv: typed }], fail: 0 });
      for (const other of others) {
        expect(other).toMatchObject({ probes: [{ ...read, execArgv: resolved }], fail: 0 });
      }
      expect({ others: others.length, exitCode }).toEqual({ others: isWindows ? 1 : 2, exitCode: 0 });
    },
    60_000,
  );

  // Windows keeps the spelling of the directory that a process is started in. The child starts
  // in that same directory, so it is given the values as they were typed.
  test.skipIf(!isWindows).concurrent(
    "a caller that was started in its directory under another spelling hands the values on as typed",
    async () => {
      const typed = ["--env-file=./other.env", "--preload=./pre.mjs"];
      const { children, exitCode } = await result(elsewhere, [bunExe(), ...typed, "runner.mjs"], {
        spelling: directory => directory.toUpperCase(),
      });
      expect(children[0]).toMatchObject({ probes: [{ execArgv: typed, envFile: "1", preloaded: true }], fail: 0 });
      expect(exitCode).toBe(0);
    },
    60_000,
  );

  // The env loader splits its value at each comma, so the path of this directory cannot be
  // written for the child.
  test.concurrent(
    "--env-file: a caller in a directory with a comma hands the value on as it was typed",
    async () => {
      const { children } = await result(elsewhere, [bunExe(), "--env-file=./other.env", "runner.mjs"], {
        directory: "node-test-run,flags",
      });
      for (const child of children) {
        expect(child).toMatchObject({ probes: [{ execArgv: ["--env-file=./other.env"] }], fail: 0 });
      }
    },
    60_000,
  );

  test.todo("--env-file: a child reads the file of a caller in a directory with a comma", async () => {
    const { children } = await result(elsewhere, [bunExe(), "--env-file=./other.env", "runner.mjs"], {
      directory: "node-test-run,flags",
    });
    expect(children.map(child => child.probes[0]?.envFile)).toEqual(children.map(() => "1"));
  });

  test.concurrent(
    "BUN_OPTIONS: its flags reach a child whose env option does not have it, and the last value of a flag counts",
    async () => {
      const { probes, fail, exitCode } = await result(
        {
          "runner.mjs": `
            import { probe } from "./probe.mjs";
            const { BUN_OPTIONS, ...env } = process.env;
            console.log("RESULT " + JSON.stringify(await probe({ env })));
          `,
        },
        [bunExe(), "--title=from-the-command-line", "--disallow-code-generation-from-strings=strict", "runner.mjs"],
        { env: { BUN_OPTIONS: "--no-addons --title=from-BUN_OPTIONS --disallow-code-generation-from-strings" } },
      );
      expect({ probes, fail, exitCode }).toMatchObject({
        probes: [
          {
            execArgv: [
              "--no-addons",
              "--title=from-BUN_OPTIONS",
              "--disallow-code-generation-from-strings",
              "--title=from-the-command-line",
              "--disallow-code-generation-from-strings=strict",
            ],
            dlopen: "refused",
            title: "from-the-command-line",
          },
        ],
        fail: 0,
        exitCode: 0,
      });
    },
    60_000,
  );

  const inWorker = {
    "main.mjs": `
      import { Worker } from "node:worker_threads";
      const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
        execArgv: ["--no-addons", "--no-ffi-cc", "--tls-min-v1.3"],
      });
      worker.on("message", message => console.log("RESULT " + JSON.stringify(message)));
    `,
    "worker.mjs": `
      import { parentPort } from "node:worker_threads";
      import { probe } from "./probe.mjs";
      parentPort.postMessage(await probe());
    `,
  };

  test.concurrent(
    "a Worker: of its own execArgv, the child is given --no-addons and --no-ffi-cc",
    async () => {
      const { probes, fail, exitCode } = await result(inWorker, [bunExe(), "--smol", "main.mjs"]);
      // The child is not given --tls-min-v1.3: only JavaScript reads it, from the process.execArgv
      // of the Worker.
      expect({ probes, fail, exitCode }).toMatchObject({
        probes: [{ execArgv: ["--smol", "--no-addons", "--no-ffi-cc"], dlopen: "refused", tlsMin: "TLSv1.2" }],
        fail: 0,
        exitCode: 0,
      });
    },
    60_000,
  );

  test.todo("a Worker: the child is given all of its own execArgv, as the child of Node.js is", async () => {
    const { probes } = await result(inWorker, [bunExe(), "--smol", "main.mjs"]);
    expect(probes).toMatchObject([{ tlsMin: "TLSv1.3" }]);
  });

  // Not run on Windows: there the `node` of `bun --bun` is a hard link, so process.execPath
  // names `node.exe`, and the child that run() starts from it is `node.exe test <file>`.
  test.skipIf(isWindows).concurrent(
    "started as node: a flag that means something else to Node.js stays with the caller",
    async () => {
      const { probes, fail, exitCode } = await result({ "runner.mjs": runner }, [
        bunExe(),
        "--bun",
        "node",
        // To Node.js, --loader names a module, and -i is --interactive. To Bun, --loader maps a
        // file extension, which "./pre.mjs" is not, and -i installs packages.
        "--loader",
        "./pre.mjs",
        "-i",
        "--title=as-node",
        "runner.mjs",
      ]);
      expect({ probes, fail, exitCode }).toMatchObject({
        probes: [{ ...unflagged, execArgv: ["--title=as-node"], title: "as-node" }],
        fail: 0,
        exitCode: 0,
      });
    },
    60_000,
  );

  // Not run on a debug build: a compiled executable is a copy of the build, which is over 1 GB.
  test.skipIf(isDebug).concurrent(
    "a compiled executable: its arguments are its program's, and the child is given none of them",
    async () => {
      using dir = tempDir("node-test-run-compiled", {
        ...fixture,
        // The child of run() is this executable again, with NODE_TEST_CONTEXT in its environment.
        "entry.mjs": `
          import { run } from "node:test";
          if (process.env.NODE_TEST_CONTEXT) {
            console.log("PROBE " + JSON.stringify({ execArgv: process.execArgv, argv: process.argv.slice(2) }));
          } else {
            const probes = [];
            for await (const { type, data } of run({ files: [process.argv.at(-1)] })) {
              if (type === "test:stdout" && data.message.startsWith("PROBE ")) {
                probes.push(JSON.parse(data.message.slice("PROBE ".length)));
              }
            }
            console.log("RESULT " + JSON.stringify(probes));
          }
        `,
      });
      const app = join(String(dir), isWindows ? "app.exe" : "app");
      await using build = spawn({
        cmd: [bunExe(), "build", "--compile", "--compile-exec-argv=--no-addons", "./entry.mjs", "--outfile", app],
        cwd: String(dir),
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const built = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      expect({ stdout: built[0], stderr: built[1], exitCode: built[2] }).toMatchObject({ exitCode: 0 });

      const file = join(String(dir), "probe.test.mjs");
      await using proc = spawn({
        cmd: [app, "--smol", "--define=RUN_FLAG:1", file],
        cwd: String(dir),
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr, exitCode }).toMatchObject({
        stdout: "RESULT " + JSON.stringify([{ execArgv: ["--no-addons"], argv: ["test", file] }]),
        exitCode: 0,
      });
    },
    60_000,
  );
});
