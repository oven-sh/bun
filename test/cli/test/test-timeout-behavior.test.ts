import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, isFlaky, isLinux, isWindows, tempDir } from "harness";
import path from "path";

// Runs `source` as a test file with a default timeout of 250ms. `graceMs` is how long after its
// timeout a test may keep the event loop blocked: the default is 5000. Returns the lines that say
// how the tests and the run ended, without durations. A run that hangs is killed after 15 seconds,
// which `signalCode` shows.
async function runTestFile(
  source: string,
  { graceMs, args = [], env = {} }: { graceMs?: number; args?: string[]; env?: Record<string, string> } = {},
) {
  // The line that names the file counts where the reporter prints it late.
  const header = args.includes("--dots") ? /^a\.test\.ts:$/ : /^::/;
  using dir = tempDir("test-timeout", { "a.test.ts": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--timeout=250", ...args, "a.test.ts"],
    env: { ...bunEnv, BUN_TEST_TIMEOUT_GRACE_MS: graceMs === undefined ? undefined : String(graceMs), ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = (stdout + stderr)
    .split("\n")
    .filter(line => /^\((pass|fail)\) |^  \^ |^error: |^note: |^ran: /.test(line) || header.test(line))
    .map(line => line.replace(/ \[[\d.]+ms\]$/, ""));
  return { lines, signalCode: proc.signalCode, exitCode, files: readdirSync(String(dir)) };
}

const endedTheRun = (unwritten = "") => [
  "error: bun test cannot stop code that does not return to the event loop, so it ended the run.",
  `note: the tests and files after this one did not run, and no summary${unwritten} was written. With --parallel, only this file ends.`,
];
// The test or hook was called and did not return.
const blocks = (what: string) => `  ^ ${what} timed out after 250ms and still blocked the event loop 250ms later.`;
// It returned, and what it left behind blocks the event loop.
const leftBlocked = (what: string) =>
  `  ^ ${what} timed out after 250ms, and something still blocked the event loop 250ms later.`;
const fixture = (tests: string) =>
  `import { test, describe, beforeEach, afterAll } from "bun:test";
   const block = ms => { const end = performance.now() + ms; while (performance.now() < end) {} };
   const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
   ${tests}`;

// https://github.com/oven-sh/bun/issues/21277
test.concurrent.each([
  ["a loop in the test", `test("blocks", () => { while (true) {} });`, ["(fail) blocks", blocks("this test")]],
  [
    "a loop that allocates",
    // It lets go of all but the last few thousand objects, for a build that never ends it.
    `test("blocks", () => {
       const held = [];
       for (let i = 0; ; i++) held[i % 4096] = { payload: new Array(1024).fill(1) };
     });`,
    ["(fail) blocks", blocks("this test")],
  ],
  [
    // An exit that checks for leaks would find them.
    "a loop beside native objects",
    `test("blocks", () => {
       const held = [new Response("body"), new Blob(["blob"]), new Bun.Glob("*"), Bun.file("a.test.ts").stream()];
       while (held.length) {}
     });`,
    ["(fail) blocks", blocks("this test")],
  ],
  ["a native call", `test("blocks", () => { Bun.sleepSync(60_000); });`, ["(fail) blocks", blocks("this test")]],
  [
    "a loop in a microtask",
    `test("blocks", async () => { await Promise.resolve(); while (true) {} });`,
    ["(fail) blocks", blocks("this test")],
  ],
  [
    "a loop after a timer",
    `test("blocks", async () => { await wait(1); while (true) {} });`,
    ["(fail) blocks", leftBlocked("this test")],
  ],
  [
    // On its own it passes, long after its timeout: the timer of the test only fires in the event loop.
    "work after a timer that takes 10 seconds",
    `test("blocks", async () => { await wait(1); block(10_000); });`,
    ["(fail) blocks", leftBlocked("this test")],
  ],
  [
    "a loop in a hook",
    `describe("outer", () => {
       beforeEach(() => { while (true) {} });
       test("blocks", () => {});
     });`,
    ["(fail) outer > blocks", blocks("a hook of this test")],
  ],
  [
    "a loop in a hook of the file",
    `afterAll(() => { while (true) {} });`,
    ["(pass) after it", "(fail) (unnamed)", blocks("a hook of this test")],
  ],
  [
    "a loop in a concurrent test, after the test beside it ended",
    `test.concurrent("beside it", async () => { await wait(1); });
     test.concurrent("blocks", async () => { await wait(50); while (true) {} });`,
    ["(pass) beside it", "(fail) blocks", leftBlocked("this test")],
  ],
  [
    "a loop in one of two concurrent tests",
    `test.concurrent("beside it", async () => { await new Promise(() => {}); });
     test.concurrent("blocks", async () => { await wait(50); while (true) {} });`,
    ["(fail) (a test of this file)", "  ^ a timeout passed, and something still blocked the event loop 250ms later."],
  ],
  [
    // The promise of a test that has timed out settles while the next test runs.
    "a loop after an earlier test has timed out",
    `test("times out", async () => { await wait(400); });
     test("blocks", async () => { await wait(200); while (true) {} });`,
    ["(fail) times out", "  ^ this test timed out after 250ms.", "(fail) blocks", leftBlocked("this test")],
  ],
])("%s that does not return to the event loop ends the run after its timeout", async (_, tests, ended) => {
  const run = await runTestFile(fixture(`test("before it", () => {}); ${tests} test("after it", () => {});`), {
    graceMs: 250,
  });
  expect(run).toEqual({
    lines: ["(pass) before it", ...ended, ...endedTheRun()],
    signalCode: null,
    exitCode: 1,
    files: ["a.test.ts"],
  });
});

test.concurrent(
  "a test that blocks the event loop for less than 5 seconds after its timeout runs to its end, and the run goes on",
  async () => {
    const run = await runTestFile(
      fixture(`
        const ran = [];
        test("overruns", () => {
          try {
            block(500);
            ran.push("body");
          } finally {
            ran.push("finally");
          }
        });
        test("after it", () => console.log("ran: " + ran));`),
    );
    expect(run).toEqual({
      lines: ["ran: body,finally", "(fail) overruns", "  ^ this test timed out after 250ms.", "(pass) after it"],
      signalCode: null,
      exitCode: 1,
      files: ["a.test.ts"],
    });
  },
);

// The report of an error runs code of the test after the test has returned: here a getter that takes longer than the
// timeout and 100ms more. What the runner does between two tests has no timeout.
test.concurrent("an error that takes long to report does not end the run", async () => {
  const run = await runTestFile(
    fixture(`
        test("throws", () => {
          const error = new Error("thrown");
          let calls = 0;
          Object.defineProperty(error, "message", {
            get() {
              if (calls++ === 0) block(600);
              return "thrown";
            },
          });
          throw error;
        });
        test("after it", () => {});`),
    { graceMs: 100 },
  );
  expect(run).toEqual({
    lines: ["error: thrown", "(fail) throws", "  ^ this test timed out after 250ms.", "(pass) after it"],
    signalCode: null,
    exitCode: 1,
    files: ["a.test.ts"],
  });
});

// Each of them blocks the event loop for longer than the timeout of a test or hook before or beside it, and 100ms more.
test.concurrent.each([
  ["has no timeout", `test("blocks", () => block(600), 0);`, ["(pass) blocks"]],
  ["has a long timeout", `test("blocks", () => block(600), 10_000);`, ["(pass) blocks"]],
  [
    "has a long timeout, and blocks in a later turn",
    `test("blocks", async () => { await wait(1); block(600); }, 10_000);`,
    ["(pass) blocks"],
  ],
  [
    "has a long timeout and a done callback",
    `test("blocks", done => { setTimeout(() => { block(600); done(); }, 1); }, 10_000);`,
    ["(pass) blocks"],
  ],
  [
    "has a long timeout, beside a test that is over",
    `test.concurrent("is over", async () => { await wait(1); });
     test.concurrent("blocks", async () => { await wait(20); block(600); }, 10_000);`,
    ["(pass) is over", "(pass) blocks"],
  ],
  [
    "has a long timeout, beside a test that times out",
    `test.concurrent("times out", async () => { await new Promise(() => {}); });
     test.concurrent("blocks", async () => { await wait(20); block(600); }, 10_000);`,
    ["(pass) blocks", "(fail) times out", "  ^ this test timed out after 250ms."],
  ],
  [
    "has no timeout, and blocks in a later turn",
    `test("blocks", async () => { await wait(1); block(600); }, 0);`,
    ["(pass) blocks"],
  ],
])("a test that %s does not end the run when it blocks the event loop", async (_, tests, lines) => {
  const run = await runTestFile(
    fixture(`beforeEach(() => {}); test("before it", () => {}); ${tests} test("after it", () => {});`),
    { graceMs: 100 },
  );
  expect(run).toEqual({
    lines: ["(pass) before it", ...lines, "(pass) after it"],
    signalCode: null,
    exitCode: lines.length > 2 ? 1 : 0,
    files: ["a.test.ts"],
  });
});

// A shell pipeline, because Bun.spawn() reads a pipe as soon as there is something in it. Nothing tells the reader
// when `bun test` has filled the pipe.
describe.concurrent.skipIf(isWindows)("a reader of the output that is slow does not end the run", () => {
  // It reads nothing for 1.5 seconds: longer than the timeout of a test and the 100ms after it.
  const pausedReader = "(sleep 1.5; cat)";
  // It reads 4 KB every 30ms.
  const slowReader = `"$0" -e 'const chunk = Buffer.alloc(4096); for (let length; (length = fs.readSync(0, chunk)) > 0; Bun.sleepSync(30)) fs.writeSync(1, chunk.subarray(0, length));'`;

  async function runWithReader(reader: string, graceMs: number, source: string) {
    using dir = tempDir("test-timeout-slow-reader", { "a.test.ts": source });
    await using proc = Bun.spawn({
      cmd: ["sh", "-c", `("$0" test --timeout=250 a.test.ts; echo "exit: $?") 2>&1 | ${reader}`, bunExe()],
      env: { ...bunEnv, BUN_TEST_TIMEOUT_GRACE_MS: String(graceMs) },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
      timeout: 15_000,
      killSignal: "SIGKILL",
    });
    const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
    return stdout
      .split("\n")
      .filter(line => /^\(fail\) |^  \^ |^error: |^ \d+ (pass|fail)$|^exit: /.test(line))
      .map(line => line.replace(/ \[[\d.]+ms\]$/, ""));
  }
  const prints = (kilobytes: number) => `
    import { test } from "bun:test";
    test("prints", () => {
      const line = Buffer.alloc(999, "x").toString();
      for (let i = 0; i < ${kilobytes}; i++) console.log(line);
    });
    test("after it", () => {});`;
  const timedOutAndWentOn = ["(fail) prints", "  ^ this test timed out after 250ms.", " 1 pass", " 1 fail", "exit: 1"];

  // The runner is blocked in a write, with no test running.
  test("it stops reading while the runner prints results", async () => {
    const lines = await runWithReader(
      pausedReader,
      100,
      `import { test } from "bun:test"; for (let i = 0; i < 6000; i++) test("test number " + i, () => {});`,
    );
    expect(lines).toEqual([" 6000 pass", " 0 fail", "exit: 0"]);
  });

  // The test is blocked in one call of console.log().
  test("it stops reading while a test prints", async () => {
    expect(await runWithReader(pausedReader, 100, prints(400))).toEqual(timedOutAndWentOn);
  });

  // Each call of console.log() returns, and the 200 KB take the reader 1.5 seconds: longer than the timeout and 300ms.
  test("it reads slowly while a test prints", async () => {
    expect(await runWithReader(slowReader, 300, prints(200))).toEqual(timedOutAndWentOn);
  });
});

test.concurrent.each([
  ["--dots", ["--dots"], {}, ["a.test.ts:", "(fail) outer > blocks", blocks("this test"), ...endedTheRun()]],
  [
    "GitHub Actions",
    [],
    { GITHUB_ACTIONS: "true" },
    [
      "::group::a.test.ts:",
      '::error title=error: Test "blocks" timed out after 250ms::',
      "(fail) outer > blocks",
      blocks("this test"),
      "::endgroup::",
      ...endedTheRun(),
    ],
  ],
  [
    "--reporter=junit and --coverage",
    ["--reporter=junit", "--reporter-outfile=junit.xml", "--coverage", "--coverage-reporter=lcov"],
    {},
    ["(fail) outer > blocks", blocks("this test"), ...endedTheRun(", JUnit report or coverage report")],
  ],
  [
    // In a terminal of VS Code, Bun's extension sets this for every process.
    "an inspector that nothing listens to",
    [],
    { BUN_INSPECT_CONNECT_TO: "ws://127.0.0.1:9/nothing-listens" },
    ["(fail) outer > blocks", blocks("this test"), ...endedTheRun()],
  ],
])("with %s, the run that a blocked event loop ends says which test blocked it", async (_, args, env, lines) => {
  const run = await runTestFile(
    `import { test, describe } from "bun:test";
       describe("outer", () => {
         test("blocks", () => { while (true) {} });
       });`,
    { graceMs: 250, args, env },
  );
  // Neither a report nor a coverage directory.
  expect(run).toEqual({ lines, signalCode: null, exitCode: 1, files: ["a.test.ts"] });
});

// Drives a `bun test` that waits for an inspector: enables the debugger, and resumes it `pauseMs` after each pause.
// Nothing tells how long a test has been paused.
async function runPausedInDebugger(source: string, graceMs: number, pauseMs: number) {
  using dir = tempDir("test-timeout-debugger", { "a.test.ts": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--inspect-wait=127.0.0.1:0", "--timeout=250", "a.test.ts"],
    env: { ...bunEnv, BUN_TEST_TIMEOUT_GRACE_MS: String(graceMs) },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
    killSignal: "SIGKILL",
  });
  let stderr = "";
  const listening = Promise.withResolvers<string>();
  const readStderr = (async () => {
    for await (const chunk of proc.stderr.pipeThrough(new TextDecoderStream())) {
      stderr += chunk;
      const url = stderr.match(/ws:\/\/\S+/);
      if (url) listening.resolve(url[0]);
    }
    listening.reject(new Error("exited before it listened: " + stderr));
  })();
  const ws = new WebSocket(await listening.promise);
  let pauses = 0;
  ws.onmessage = async event => {
    if (JSON.parse(String(event.data)).method !== "Debugger.paused") return;
    pauses++;
    await Bun.sleep(pauseMs);
    ws.send(JSON.stringify({ id: 100 + pauses, method: "Debugger.resume" }));
  };
  ws.onopen = () => {
    ws.send(JSON.stringify({ id: 1, method: "Debugger.enable" }));
    ws.send(JSON.stringify({ id: 2, method: "Debugger.setBreakpointsActive", params: { active: true } }));
    ws.send(JSON.stringify({ id: 3, method: "Debugger.setPauseOnDebuggerStatements", params: { enabled: true } }));
    ws.send(JSON.stringify({ id: 4, method: "Inspector.initialized" }));
  };
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited, readStderr]);
  ws.close();
  const lines = (stdout + stderr)
    .split("\n")
    .filter(line => /^\((pass|fail)\) |^  \^ |^error: |^ran: /.test(line))
    .map(line => line.replace(/ \[[\d.]+ms\]$/, ""));
  return { lines, pauses, signalCode: proc.signalCode, exitCode };
}

// In the second one the pause ends 850ms after the timeout of the test, and the work after it takes 500ms: more than
// 1000ms together.
test.concurrent.each([
  ["for longer than its timeout", 100, 1000, ""],
  ["and that then works for less than 5 seconds", 1000, 1100, "block(500);"],
])("a test that a debugger pauses %s does not end the run", async (_, graceMs, pauseMs, work) => {
  const run = await runPausedInDebugger(
    fixture(`
        test("pauses", () => {
          debugger;
          ${work}
          console.log("ran: to the end");
        });
        test("after it", () => {});`),
    graceMs,
    pauseMs,
  );
  expect(run).toEqual({
    lines: ["ran: to the end", "(fail) pauses", "  ^ this test timed out after 250ms.", "(pass) after it"],
    pauses: 1,
    signalCode: null,
    exitCode: 1,
  });
});

// Under --watch a change of a file restarts a run that is blocked. The end of the process would end the watch.
// On Windows `bun test --watch` is a parent process that restarts the runner.
test.concurrent.skipIf(isWindows)(
  "under --watch, a test that blocks the event loop is reported, and the run does not end",
  async () => {
    using dir = tempDir("test-timeout-watch", {
      "a.test.ts": `import { test } from "bun:test"; test("overruns", () => { Bun.sleepSync(1500); });`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--watch", "--no-clear-screen", "--timeout=250"],
      env: { ...bunEnv, BUN_TEST_TIMEOUT_GRACE_MS: "100" },
      cwd: String(dir),
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    let output = "";
    for await (const chunk of proc.stderr.pipeThrough(new TextDecoderStream())) {
      output += chunk;
      if (output.includes("Ran 1 test across 1 file.")) break;
    }
    // How often the thread that watches the tests has slept: every 6.25ms while the test was late, which is 200 times.
    const sleeps = isLinux
      ? readdirSync(`/proc/${proc.pid}/task`)
          .map(thread => `/proc/${proc.pid}/task/${thread}`)
          .filter(thread => readFileSync(`${thread}/comm`, "utf8").trim() === "TestTimeout")
          .map(thread =>
            Number(/^voluntary_ctxt_switches:\s*(\d+)/m.exec(readFileSync(`${thread}/status`, "utf8"))![1]),
          )
      : [];
    const lines = output
      .split("\n")
      .filter(line => /^\((pass|fail)\) |^warn: |^  \^ |^error: |^Ran /.test(line))
      .map(line => line.replace(/ \[[\d.]+m?s\]$/, ""));
    expect(lines).toEqual([
      "warn: overruns",
      "  ^ this test timed out after 250ms and still blocked the event loop 100ms later.",
      "(fail) overruns",
      "  ^ this test timed out after 250ms.",
      "Ran 1 test across 1 file.",
    ]);
    if (isLinux) expect(sleeps.map(count => (count < 2000 ? "under 2000" : count))).toEqual(["under 2000"]);
  },
);

// While the process is stopped its clock goes on, and the timer of a test is only late, not blocked.
describe.concurrent.skipIf(isWindows)("a timeout that passes while the process is stopped does not end the run", () => {
  // Stops the run for `stopMs` when it prints "ran: stop me".
  async function runAndStop(tests: string, graceMs: number, stopMs: number) {
    using dir = tempDir("test-timeout-stopped", { "a.test.ts": fixture(tests) });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--timeout=250", "a.test.ts"],
      env: { ...bunEnv, BUN_TEST_TIMEOUT_GRACE_MS: String(graceMs) },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
      killSignal: "SIGKILL",
    });
    let stdout = "";
    const stderr = proc.stderr.text();
    for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
      if (!stdout.includes("ran: stop me") && (stdout += chunk).includes("ran: stop me")) {
        proc.kill("SIGSTOP");
        // Nothing tells how long a process has been stopped.
        await Bun.sleep(stopMs);
        proc.kill("SIGCONT");
      } else {
        stdout += chunk;
      }
    }
    const lines = (await stderr)
      .split("\n")
      .filter(line => /^\((pass|fail)\) |^  \^ |^error: /.test(line))
      .map(line => line.replace(/ \[[\d.]+ms\]$/, ""));
    return { lines, signalCode: proc.signalCode, exitCode: await proc.exited };
  }

  test("while the test waits", async () => {
    const run = await runAndStop(
      `test("waits", async () => {
         console.log("ran: stop me");
         await new Promise(() => {});
       });
       test("after it", () => {});`,
      100,
      1000,
    );
    expect(run).toEqual({
      lines: ["(fail) waits", "  ^ this test timed out after 250ms.", "(pass) after it"],
      signalCode: null,
      exitCode: 1,
    });
  });

  // The test is past its timeout when the process stops, and has 400ms of work left when the process goes on.
  test("while the test works", async () => {
    const run = await runAndStop(
      `test("works", () => {
         const cpuMs = () => { const { user, system } = process.cpuUsage(); return (user + system) / 1000; };
         const start = cpuMs();
         block(300);
         console.log("ran: stop me");
         while (cpuMs() - start < 700) {}
       });
       test("after it", () => {});`,
      1500,
      2500,
    );
    expect(run).toEqual({
      lines: ["(fail) works", "  ^ this test timed out after 250ms.", "(pass) after it"],
      signalCode: null,
      exitCode: 1,
    });
  });
});

// The child inherits stdout, so stdout only ends when the child has ended too.
test.concurrent.skipIf(isWindows)(
  "a run that a blocked event loop ends takes the child processes of its tests with it",
  async () => {
    const run = await runTestFile(
      `import { test } from "bun:test";
       test("blocks", () => {
         Bun.spawn({ cmd: [process.execPath, "-e", "setTimeout(() => {}, 30_000)"], stdio: ["ignore", "inherit", "inherit"] });
         while (true) {}
       });`,
      { graceMs: 250 },
    );
    expect(run).toEqual({
      lines: ["(fail) blocks", blocks("this test"), ...endedTheRun()],
      signalCode: null,
      exitCode: 1,
      files: ["a.test.ts"],
    });
  },
);

if (isFlaky && isLinux) {
  test.todo("processes get killed");
} else {
  test.concurrent.each([true, false])(`processes get killed (sync: %p)`, async sync => {
    const { exited, stdout, stderr } = Bun.spawn({
      cmd: [
        bunExe(),
        "test",
        path.join(import.meta.dir, sync ? "process-kill-fixture-sync.ts" : "process-kill-fixture.ts"),
      ],
      stdout: "pipe",
      stderr: "pipe",
      stdin: "inherit",
      env: bunEnv,
    });
    const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    // merge outputs so that this test still works if we change which things are printed to stdout
    // and which to stderr
    const combined = out + err;
    // exit code should indicate failed tests, not abort or anything
    expect(exitCode).toBe(1);
    expect(combined).not.toContain("This should not be printed!");
    expect(combined).toContain("killed 1 dangling process");
    // we should not expose the termination exception
    expect(combined).not.toContain("Unhandled error between tests");
    expect(combined).not.toContain("JavaScript execution terminated");
    // both tests should have run with the expected result
    expect(combined).toContain("(fail) test timeout kills dangling processes");
    expect(combined).toContain("(pass) slow test after test timeout");
  });
}
