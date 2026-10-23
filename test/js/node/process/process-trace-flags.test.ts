import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Node prints the stacks of --trace-exit and --trace-env-js-stack from native code. Nothing a script does to
// `Error` changes what they print, or makes the traced process.exit() or process.env operation fail.

async function run(flags: string[], script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...flags, "-e", script],
    env: { ...bunEnv, TRACE_ENV_TEST: "value" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// The lines of a trace without what differs from run to run: the pid, and where each frame is.
// A frame is `at name`, `at async name` or `at new name`. A frame with no function name is the top level of the
// script and is left out.
function traceLines(trace: string): string[] {
  const lines: string[] = [];
  for (const line of trace.split(/\r?\n/)) {
    if (line.startsWith("    at ")) {
      const named = line.match(/^    at ((?:async |new )?\S+) \(/);
      if (named) lines.push(`at ${named[1]}`);
    } else if (line !== "") {
      lines.push(line.replace(/^\(node:\d+/, "(node:<pid>"));
    }
  }
  return lines;
}

// What --trace-env --trace-env-js-stack printed for the first operation with this message.
function envTraceLines(stderr: string, message: string): string[] {
  const trace = stderr.split("[--trace-env] ").find(trace => trace.startsWith(`${message}\n`));
  return trace === undefined ? [] : traceLines(trace);
}

const errorStates = {
  "Error.prepareStackTrace returns the call sites": `Error.prepareStackTrace = (error, callSites) => { console.log("Error.prepareStackTrace ran"); return callSites; };`,
  "Error.prepareStackTrace returns a string": `Error.prepareStackTrace = () => { console.log("Error.prepareStackTrace ran"); return "from Error.prepareStackTrace"; };`,
  "Error.prepareStackTrace throws": `Error.prepareStackTrace = () => { console.log("Error.prepareStackTrace ran"); throw new RangeError("from Error.prepareStackTrace"); };`,
  "Error.stackTraceLimit is 0": `Error.stackTraceLimit = 0;`,
  "Error.stackTraceLimit is an accessor": `Object.defineProperty(Error, "stackTraceLimit", { get() { console.log("Error.stackTraceLimit was read"); return 10; }, set() { console.log("Error.stackTraceLimit was written"); } });`,
  "Error is frozen": `Object.freeze(Error);`,
  "globalThis.Error is replaced": `globalThis.Error = function () {};`,
};

describe.concurrent("--trace-exit", () => {
  test.each([
    "Error.prepareStackTrace returns the call sites",
    "Error.prepareStackTrace returns a string",
    "Error.prepareStackTrace throws",
    "Error.stackTraceLimit is 0",
    "globalThis.Error is replaced",
  ] as const)("exits and prints the frames when %s", async state => {
    const { stdout, stderr, exitCode } = await run(
      ["--trace-exit"],
      `${errorStates[state]}
      function inner() {
        process.exit(3);
      }
      function outer() {
        inner();
      }
      outer();`,
    );
    expect({ stdout, trace: traceLines(stderr), exitCode }).toEqual({
      stdout: "",
      trace: ["(node:<pid>) WARNING: Exited the environment with code 3", "at exit", "at inner", "at outer"],
      exitCode: 3,
    });
  });

  test.each([
    { limit: "--stack-trace-limit=5", frames: 5 },
    { limit: "no --stack-trace-limit", frames: 10 },
  ])("prints $frames frames with $limit, whatever Error.stackTraceLimit is", async ({ limit, frames }) => {
    const { stderr, exitCode } = await run(
      limit.startsWith("--") ? ["--trace-exit", limit] : ["--trace-exit"],
      `Error.stackTraceLimit = 50;
      function recurse(depth) {
        if (depth === 0) process.exit(0);
        recurse(depth - 1);
      }
      recurse(20);`,
    );
    expect({ trace: traceLines(stderr), exitCode }).toEqual({
      trace: [
        "(node:<pid>) WARNING: Exited the environment with code 0",
        "at exit",
        ...new Array(frames - 1).fill("at recurse"),
      ],
      exitCode: 0,
    });
  });

  test("prints the frames of an await chain, inside the limit", async () => {
    const { stderr, exitCode } = await run(
      ["--trace-exit", "--stack-trace-limit=3"],
      `async function a() {
        await 1;
        process.exit(0);
      }
      async function b() {
        await a();
      }
      async function c() {
        await b();
      }
      async function d() {
        await c();
      }
      d();`,
    );
    expect({ trace: traceLines(stderr), exitCode }).toEqual({
      trace: ["(node:<pid>) WARNING: Exited the environment with code 0", "at exit", "at a", "at async b"],
      exitCode: 0,
    });
  });

  test("exits and prints no frames with --stack-trace-limit=0", async () => {
    const { stderr, exitCode } = await run(["--trace-exit", "--stack-trace-limit=0"], `process.exit(0);`);
    expect({ trace: traceLines(stderr), exitCode }).toEqual({
      trace: ["(node:<pid>) WARNING: Exited the environment with code 0"],
      exitCode: 0,
    });
  });

  test("prints after the 'exit' listeners, with the exit code they leave", async () => {
    const { stderr, exitCode } = await run(
      ["--trace-exit"],
      `process.on("exit", () => {
        console.error("exit listener");
        process.exitCode = 7;
      });
      process.exit(0);`,
    );
    expect({ trace: traceLines(stderr), exitCode }).toEqual({
      trace: ["exit listener", "(node:<pid>) WARNING: Exited the environment with code 7", "at exit"],
      exitCode: 7,
    });
  });

  test("prints once when process.exit() is called at the stack limit", async () => {
    const { stderr, exitCode } = await run(
      ["--trace-exit"],
      `function recurse() {
        try {
          recurse();
        } catch {
          process.exit(7);
        }
      }
      recurse();`,
    );
    expect({ trace: traceLines(stderr), exitCode }).toEqual({
      trace: [
        "(node:<pid>) WARNING: Exited the environment with code 7",
        "at exit",
        ...new Array(9).fill("at recurse"),
      ],
      exitCode: 7,
    });
  });

  test("prints once when an 'exit' listener calls process.exit()", async () => {
    const { stderr, exitCode } = await run(
      ["--trace-exit"],
      `function onExit() {
        process.exit(9);
      }
      process.on("exit", onExit);
      process.exit(0);`,
    );
    expect({ trace: traceLines(stderr), exitCode }).toEqual({
      trace: ["(node:<pid>) WARNING: Exited the environment with code 9", "at exit", "at onExit", "at exit"],
      exitCode: 9,
    });
  });

  test("prints for process.reallyExit()", async () => {
    const { stderr, exitCode } = await run(
      ["--trace-exit"],
      `function direct() {
        process.reallyExit(3);
      }
      direct();`,
    );
    expect({ trace: traceLines(stderr), exitCode }).toEqual({
      trace: ["(node:<pid>) WARNING: Exited the environment with code 3", "at direct"],
      exitCode: 3,
    });
  });

  test("prints the exit code that process.reallyExit() gets", async () => {
    const { stderr, exitCode } = await run(["--trace-exit"], `process.exitCode = 257; process.reallyExit(256);`);
    expect({ trace: traceLines(stderr), exitCode }).toEqual({
      trace: ["(node:<pid>) WARNING: Exited the environment with code 256"],
      exitCode: 0,
    });
  });

  test("names a built-in module as Node does", async () => {
    const { stderr, exitCode } = await run(
      ["--trace-exit"],
      `Error.prepareStackTrace = (error, callSites) => callSites;
      const { inspect } = require("node:util");
      inspect({
        [inspect.custom]() {
          process.exit(0);
        },
      });`,
    );
    expect(stderr).toMatch(/^    at \S+ \(node:internal\/util\/inspect:\d+:\d+\)$/m);
    expect(stderr).not.toContain("(internal:");
    expect(exitCode).toBe(0);
  });

  test("does not print when a script replaced process.reallyExit()", async () => {
    const { stdout, stderr, exitCode } = await run(
      ["--trace-exit"],
      `process.reallyExit = code => console.log("reallyExit", code);
      process.exit(2);
      console.log("after");`,
    );
    expect({ stdout, trace: traceLines(stderr), exitCode }).toEqual({
      stdout: "reallyExit 2\nafter\n",
      trace: [],
      exitCode: 2,
    });
  });

  test("does not print for an exit code that process.exit() rejects", async () => {
    const { stdout, stderr, exitCode } = await run(
      ["--trace-exit"],
      `try {
        process.exit("abc");
      } catch (error) {
        console.log(error.code);
      }`,
    );
    expect({ stdout, trace: traceLines(stderr), exitCode }).toEqual({
      stdout: "ERR_INVALID_ARG_TYPE\n",
      trace: [],
      exitCode: 0,
    });
  });
});

describe.concurrent("--trace-env-js-stack", () => {
  test.each(Object.keys(errorStates) as (keyof typeof errorStates)[])(
    "reads the variable and prints the frames when %s",
    async state => {
      const { stdout, stderr, exitCode } = await run(
        ["--trace-env-js-stack"],
        `${errorStates[state]}
        function inner() {
          return process.env.TRACE_ENV_TEST;
        }
        function outer() {
          console.log(inner());
        }
        outer();`,
      );
      const trace = traceLines(stderr);
      expect({ stdout, trace: trace.slice(trace.indexOf("at inner")), exitCode }).toEqual({
        stdout: "value\n",
        trace: ["at inner", "at outer"],
        exitCode: 0,
      });
    },
  );

  test("prints ten frames, whatever --stack-trace-limit is and also below an await chain", async () => {
    const { stderr, exitCode } = await run(
      ["--trace-env", "--trace-env-js-stack", "--stack-trace-limit=50"],
      `function recurse(depth) {
        if (depth === 0) return void process.env.TRACE_ENV_TEST;
        recurse(depth - 1);
      }
      async function a() {
        await 1;
        recurse(20);
      }
      async function b() {
        await a();
      }
      async function c() {
        await b();
      }
      c();`,
    );
    expect({ trace: envTraceLines(stderr, 'get "TRACE_ENV_TEST"'), exitCode }).toEqual({
      trace: ['get "TRACE_ENV_TEST"', ...new Array(10).fill("at recurse")],
      exitCode: 0,
    });
  });

  test("prints the frames of each kind of operation", async () => {
    const { stdout, stderr, exitCode } = await run(
      ["--trace-env", "--trace-env-js-stack"],
      `Error.prepareStackTrace = (error, callSites) => callSites;
      function operations() {
        process.env.TRACE_ENV_TEST = "set";
        const read = process.env.TRACE_ENV_TEST;
        const has = "TRACE_ENV_TEST" in process.env;
        const keys = Object.keys(process.env).includes("TRACE_ENV_TEST");
        const deleted = delete process.env.TRACE_ENV_TEST;
        console.log(JSON.stringify({ read, has, keys, deleted }));
      }
      operations();`,
    );
    const messages = [
      'set "TRACE_ENV_TEST"',
      'get "TRACE_ENV_TEST"',
      'query "TRACE_ENV_TEST"',
      "enumerate environment variables",
      'delete "TRACE_ENV_TEST"',
    ];
    expect({ stdout, traces: messages.map(message => envTraceLines(stderr, message)), exitCode }).toEqual({
      stdout: `{"read":"set","has":true,"keys":true,"deleted":true}\n`,
      traces: [
        ['set "TRACE_ENV_TEST"', "at operations"],
        ['get "TRACE_ENV_TEST"', "at operations"],
        ['query "TRACE_ENV_TEST"', "at operations"],
        ["enumerate environment variables", "at keys", "at operations"],
        ['delete "TRACE_ENV_TEST"', "at operations"],
      ],
      exitCode: 0,
    });
  });
});

// Not in a concurrent group: a worker of a debug build takes seconds to start beside twenty other processes.
test("--trace-exit prints once, with the thread id, for a worker whose 'exit' listener calls process.exit()", async () => {
  const { stdout, stderr, exitCode } = await run(
    ["--trace-exit"],
    `const { Worker } = require("node:worker_threads");
    const worker = new Worker(
      "function onExit() { process.exit(9); } process.on('exit', onExit); process.exit(5);",
      { eval: true },
    );
    const threadId = worker.threadId;
    worker.on("exit", code => console.log("thread", threadId, "exited with", code));`,
  );
  expect({ stdout, trace: traceLines(stderr), exitCode }).toEqual({
    stdout: "thread 1 exited with 9\n",
    trace: ["(node:<pid>, thread:1) WARNING: Exited the environment with code 9", "at exit", "at onExit", "at exit"],
    exitCode: 0,
  });
});
