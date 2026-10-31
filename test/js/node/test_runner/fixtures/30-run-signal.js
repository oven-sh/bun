// The tests of run({ signal }) that Node.js passes too. node-test.test.ts runs this file with Bun and with Node.js.
const assert = require("node:assert");
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { run, test } = require("node:test");

const isBun = typeof Bun !== "undefined";
const isPosix = process.platform !== "win32";
// An empty directory, from the test that runs this file. The files of each run and their markers go there.
const dir = process.env.RUN_SIGNAL_DIR;
assert(dir, "RUN_SIGNAL_DIR is an empty directory");
const env = process.env;
// A child of the debug build takes seconds to start. A test that ends too early leaves its run behind.
const timeout = 30_000;

// Each long test of a file ends after a minute. A child that a failed run leaves behind ends then, too.
const files = {
  "quick.js": `
    require("node:test").test("quick", () => {});
  `,
  "late.js": `
    require("node:fs").writeFileSync(process.env.STARTED, "started");
    require("node:test").test("late", () => {});
  `,
  "never-sync.js": `
    require("node:test").test("never ends", { timeout: 60_000 }, () => {
      const end = Date.now() + 60_000;
      while (Date.now() < end);
    });
  `,
  "never-async.js": `
    require("node:test").test("never ends", { timeout: 60_000 }, () => new Promise(resolve => setTimeout(resolve, 60_000)));
  `,
  // SIGTERM ends this child: its "exit" listener does not run.
  "dies.js": `
    const { writeFileSync } = require("node:fs");
    const { test } = require("node:test");
    writeFileSync(process.env.PID, String(process.pid));
    process.on("exit", code => writeFileSync(process.env.EXITED, String(code)));
    test("passes", () => {});
    test("runs on", { timeout: 60_000 }, () => new Promise(resolve => setTimeout(resolve, 60_000)));
  `,
  // SIGTERM lets the one test of this child pass: the child exits with code 0.
  "trap.js": `
    const { test } = require("node:test");
    let end;
    const ended = new Promise(resolve => (end = resolve));
    process.on("SIGTERM", end);
    console.log("ready");
    test("runs until SIGTERM", { timeout: 60_000 }, async () => {
      const limit = setTimeout(end, 60_000);
      await ended;
      clearTimeout(limit);
    });
  `,
  // SIGTERM makes this child write more than a pipe holds, to each pipe. The child runs on until SIGUSR2.
  "held.js": `
    const { writeFileSync } = require("node:fs");
    const { test } = require("node:test");
    let end;
    const ended = new Promise(resolve => (end = resolve));
    process.on("SIGUSR2", end);
    process.once("SIGTERM", async () => {
      const block = Buffer.alloc(64 * 1024, "more than a pipe holds\\n");
      for (let i = 0; i < 40; i++) {
        await new Promise(resolve => process.stdout.write(block, resolve));
        await new Promise(resolve => process.stderr.write(block, resolve));
      }
      writeFileSync(process.env.WROTE, "all");
    });
    process.on("exit", code => writeFileSync(process.env.EXITED, String(code)));
    writeFileSync(process.env.PID, String(process.pid));
    console.log("ready");
    test("runs until SIGUSR2", { timeout: 60_000 }, async () => {
      const limit = setTimeout(end, 60_000);
      await ended;
      clearTimeout(limit);
    });
  `,
};
for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source);

let markers = 0;
/** The path of a file that a child writes. The path is new for each call. */
function marker(name) {
  return join(dir, `${name}-${++markers}`);
}

function textOf(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function pidOf(path) {
  return Number(textOf(path));
}

function isRunning(pid) {
  // process.kill(0) and process.kill(-1) signal more than one process.
  assert(pid > 0, `a child wrote its pid: ${pid}`);
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The timeout of the test is the deadline. */
async function until(condition) {
  while (!condition()) await new Promise(resolve => setTimeout(resolve, 10));
}

/** Aborts when the child of a "trap.js" or a "held.js" has its signal listeners. */
function abortWhenReady(stream, controller, reason) {
  stream.on("test:stdout", ({ message }) => {
    if (message.includes("ready")) controller.abort(reason);
  });
}

/** The verdict of the run and each failed test. `isReason` says that the error is `reason` itself. */
function outcomeOf(stream, reason) {
  const failed = [];
  let summary;
  stream.on("test:fail", data => {
    const error = data.details.error;
    failed.push({ name: data.name, failureType: error?.failureType, isReason: error === reason });
  });
  stream.on("test:summary", data => {
    if (data.file === undefined) summary = data;
  });
  return new Promise((resolve, reject) => {
    stream.on("error", reject);
    stream.on("end", () => {
      const { tests, passed, failed: failures, cancelled } = summary?.counts ?? {};
      resolve({ success: summary?.success, counts: { tests, passed, failed: failures, cancelled }, failed });
    });
    stream.resume();
  });
}

// The case of Node.js, test/parallel/test-runner-run.mjs: "should accept a signal".
test("fails each of two files that never end when a timeout signal aborts", { timeout }, async () => {
  const signal = AbortSignal.timeout(50);
  const stream = run({ files: ["never-sync.js", "never-async.js"], cwd: dir, env, signal });
  const errors = [];
  let passed = 0;
  stream.on("test:fail", data => errors.push(data.details.error));
  stream.on("test:pass", () => passed++);

  assert.deepStrictEqual(
    { ...(await outcomeOf(stream)), passed, errorsAreTheReason: errors.map(error => error === signal.reason) },
    {
      success: false,
      counts: { tests: 2, passed: 0, failed: 0, cancelled: 2 },
      failed: ["never-sync.js", "never-async.js"].map(name => ({ name, failureType: "testAborted", isReason: false })),
      passed: 0,
      errorsAreTheReason: [true, true],
    },
  );
});

test("cancels a file whose child handles SIGTERM and exits with code 0", { skip: !isPosix, timeout }, async () => {
  const controller = new AbortController();
  const reason = new Error("stop");
  const stream = run({ files: ["trap.js"], cwd: dir, env, signal: controller.signal });
  abortWhenReady(stream, controller, reason);

  assert.deepStrictEqual(await outcomeOf(stream, reason), {
    success: false,
    counts: { tests: 1, passed: 0, failed: 0, cancelled: 1 },
    failed: [{ name: "trap.js", failureType: "testAborted", isReason: true }],
  });
});

test("cancels the last file, after a file that passed", { skip: !isPosix, timeout }, async () => {
  const controller = new AbortController();
  const reason = new Error("stop");
  const stream = run({ files: ["quick.js", "trap.js"], cwd: dir, env, signal: controller.signal });
  abortWhenReady(stream, controller, reason);

  assert.deepStrictEqual(await outcomeOf(stream, reason), {
    success: false,
    counts: { tests: 2, passed: 1, failed: 0, cancelled: 1 },
    failed: [{ name: "trap.js", failureType: "testAborted", isReason: true }],
  });
});

test("ends the child of the running file, and starts no later file", { timeout }, async () => {
  const pid = marker("pid");
  const exited = marker("exited");
  const started = marker("started");
  const controller = new AbortController();
  const reason = new Error("stop");
  // A listener of the caller's program cannot hide the abort from the runner.
  controller.signal.addEventListener("abort", event => event.stopImmediatePropagation());
  const stream = run({
    files: ["dies.js", "late.js"],
    cwd: dir,
    env: { ...env, PID: pid, EXITED: exited, STARTED: started },
    signal: controller.signal,
  });
  stream.on("test:pass", data => {
    if (data.name === "passes") controller.abort(reason);
  });

  const outcome = await outcomeOf(stream, reason);
  const child = pidOf(pid);
  await until(() => !isRunning(child));
  assert.deepStrictEqual(
    { ...outcome, childExitedByItself: existsSync(exited), laterFileStarted: existsSync(started) },
    {
      success: false,
      counts: { tests: 3, passed: 1, failed: 0, cancelled: 2 },
      failed: ["dies.js", "late.js"].map(name => ({ name, failureType: "testAborted", isReason: true })),
      childExitedByItself: false,
      laterFileStarted: false,
    },
  );
});

for (const when of ["before run()", "in setup()", "in a test:enqueue listener", "in a test:dequeue listener"]) {
  test(`cancels a file and starts no child when the signal aborts ${when}`, async () => {
    const started = marker("started");
    const controller = new AbortController();
    const reason = new Error("stop");
    const abort = () => controller.abort(reason);
    if (when === "before run()") abort();
    const stream = run({
      files: ["late.js"],
      cwd: dir,
      env: { ...env, STARTED: started },
      signal: controller.signal,
      setup: when === "in setup()" ? abort : undefined,
    });
    if (when === "in a test:enqueue listener") stream.once("test:enqueue", abort);
    if (when === "in a test:dequeue listener") stream.once("test:dequeue", abort);

    assert.deepStrictEqual(
      { ...(await outcomeOf(stream, reason)), fileStarted: existsSync(started) },
      {
        success: false,
        counts: { tests: 1, passed: 0, failed: 0, cancelled: 1 },
        failed: [{ name: "late.js", failureType: "testAborted", isReason: true }],
        fileStarted: false,
      },
    );
  });
}

test("fails the file with an AbortError when the reason of the abort is null", async () => {
  const stream = run({
    files: ["late.js"],
    cwd: dir,
    env: { ...env, STARTED: marker("started") },
    signal: AbortSignal.abort(null),
  });
  let error;
  stream.on("test:fail", data => (error = data.details.error));
  await outcomeOf(stream);

  assert.deepStrictEqual(
    {
      name: error.name,
      code: error.code,
      message: error.message,
      failureType: error.failureType,
      hasCause: "cause" in error,
    },
    {
      name: "AbortError",
      code: "ABORT_ERR",
      message: "The test was aborted",
      failureType: "testAborted",
      hasCause: false,
    },
  );
});

test(
  "ends the stream at the abort, and reads the pipes of a child that runs on",
  { skip: !isPosix, timeout },
  async () => {
    const pid = marker("pid");
    const wrote = marker("wrote");
    const exited = marker("exited");
    const controller = new AbortController();
    const stream = run({
      files: ["held.js"],
      cwd: dir,
      env: { ...env, PID: pid, WROTE: wrote, EXITED: exited },
      signal: controller.signal,
    });
    let ended = false;
    let endedAtAbort;
    let childRunsAtEnd;
    stream.on("test:stdout", ({ message }) => {
      if (!message.includes("ready")) return;
      controller.abort();
      // The run ends in the promise jobs of the abort: no event of a child is necessary.
      setImmediate(() => (endedAtAbort = ended));
    });
    stream.on("test:summary", data => {
      if (data.file !== undefined) return;
      ended = true;
      childRunsAtEnd = isRunning(pidOf(pid));
    });
    const outcome = outcomeOf(stream);
    const childIsGone = () => pidOf(pid) > 0 && !isRunning(pidOf(pid));

    // The child blocks here if the runner does not read both pipes to their end.
    await until(() => textOf(wrote) !== "" || childIsGone());
    const childWrote = textOf(wrote);
    if (!childIsGone()) process.kill(pidOf(pid), "SIGUSR2");
    await until(() => textOf(exited) !== "" || childIsGone());
    assert.deepStrictEqual(
      { endedAtAbort, childRunsAtEnd, childWrote, childExitCode: textOf(exited), success: (await outcome).success },
      { endedAtAbort: true, childRunsAtEnd: true, childWrote: "all", childExitCode: "0", success: false },
    );
  },
);

test("keeps the verdict of a run whose signal aborts after the last file ended", { timeout }, async () => {
  const controller = new AbortController();
  const stream = run({ files: ["quick.js"], cwd: dir, env, signal: controller.signal });
  stream.on("test:plan", data => {
    if (data.file === undefined) controller.abort();
  });

  assert.deepStrictEqual(await outcomeOf(stream), {
    success: true,
    counts: { tests: 1, passed: 1, failed: 0, cancelled: 0 },
    failed: [],
  });
});

test(
  "cancels a file when a listener aborts at the summary of that file",
  { timeout, todo: isBun && "Bun makes the summary of a file after the child of the file exited" },
  async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    const stream = run({ files: ["quick.js"], cwd: dir, env, signal: controller.signal });
    stream.on("test:summary", data => {
      if (data.file !== undefined) controller.abort(reason);
    });

    assert.deepStrictEqual(await outcomeOf(stream, reason), {
      success: false,
      counts: { tests: 2, passed: 1, failed: 0, cancelled: 1 },
      failed: [{ name: "quick.js", failureType: "testAborted", isReason: true }],
    });
  },
);
