import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { Worker } from "worker_threads";
import { endChildren, spawn } from "../../../cli/children";

// A worker whose entry module's top-level await never settles drains its event
// loop with the module evaluation promise still pending. Node exits such a
// worker with code 13 rather than hanging forever.
test("worker with an unsettled top-level await exits with code 13", async () => {
  const w = new Worker(new URL("data:text/javascript,await new Promise(() => {})"));
  const exitCode = await new Promise<number>(resolve => w.on("exit", resolve));
  expect(exitCode).toBe(13);
});

test("worker with a settled top-level await exits with code 0", async () => {
  const w = new Worker(new URL("data:text/javascript,await Promise.resolve()"));
  const exitCode = await new Promise<number>(resolve => w.on("exit", resolve));
  expect(exitCode).toBe(0);
});

// A top-level await that resolves and then schedules more work must not be
// mistaken for an unsettled await: the loop is still alive, so the worker runs
// to a normal exit.
test("worker that stays busy after top-level await exits with code 0", async () => {
  const w = new Worker(
    new URL("data:text/javascript,await Promise.resolve(); await new Promise(r => setTimeout(r, 20));"),
  );
  const exitCode = await new Promise<number>(resolve => w.on("exit", resolve));
  expect(exitCode).toBe(0);
});

// A top-level await that rejects surfaces as a worker 'error', not the
// unsettled-await code.
test("worker with a rejected top-level await emits error", async () => {
  const w = new Worker(new URL("data:text/javascript,await Promise.reject(new Error('boom'))"));
  const error = await new Promise<Error>(resolve => w.on("error", resolve));
  expect(error.message).toBe("boom");
});

// Node only assigns 13 when nothing else set an exit code
// (node_hooks.cc: `if (exit_code == ExitCode::kNoFailure)`).
test("unsettled top-level await preserves a user-set process.exitCode", async () => {
  for (const code of [42, 5]) {
    const w = new Worker(new URL(`data:text/javascript,process.exitCode=${code}; await new Promise(() => {})`));
    const exitCode = await new Promise<number>(resolve => w.on("exit", resolve));
    expect({ code, exitCode }).toEqual({ code, exitCode: code });
  }
});

test("unsettled top-level await still exits 13 when process.exitCode is 0", async () => {
  const w = new Worker(new URL("data:text/javascript,process.exitCode=0; await new Promise(() => {})"));
  const exitCode = await new Promise<number>(resolve => w.on("exit", resolve));
  expect(exitCode).toBe(13);
});

// process.exit() from a 'beforeExit' listener ends the worker with its code: nothing is unsettled
// about an exit that the program asked for.
test("process.exit() in a 'beforeExit' listener wins over the unsettled top-level await", async () => {
  const w = new Worker(
    new URL("data:text/javascript,process.on('beforeExit', () => process.exit(0)); await new Promise(() => {})"),
  );
  const exitCode = await new Promise<number>(resolve => w.on("exit", resolve));
  expect(exitCode).toBe(0);
});

// The loader marks the entry's promise handled, so only the worker reports a rejection that comes this late.
test("a top-level await that a 'beforeExit' listener rejects is the worker's error", async () => {
  const w = new Worker(
    new URL(
      "data:text/javascript,let reject; process.once('beforeExit', () => reject(new Error('late'))); await new Promise((_, r) => { reject = r; })",
    ),
  );
  const error = await new Promise<Error>(resolve => w.on("error", resolve));
  expect(error.message).toBe("late");
});

// A build without the fix polls for ever in the child of the preload case. Its test times out, and this ends the child with the file.
afterAll(endChildren);

async function run(files: Record<string, string>) {
  using dir = tempDir("worker-unsettled-tla", files);
  await using proc = spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr: stderr.replace(/file:\/\/\S*\//g, "file://<dir>/"), exitCode, signalCode: proc.signalCode };
}

const main = (options = "") => `import { Worker } from "node:worker_threads";
const worker = new Worker("./worker.mjs"${options});
worker.on("error", error => console.log("error:", error.message.replace(/file:\\/\\/\\S*\\//g, "file://<dir>/")));
worker.on("exit", code => console.log("exit", code));
`;

// In a child, to read what the worker writes to stderr.
test.concurrent("an unsettled top-level await names the stalled await in a warning, like the main thread", async () => {
  const stalled = "await new Promise(() => {});";
  expect(await run({ "main.mjs": main(), "worker.mjs": `console.log("worker runs");\n${stalled}\n` })).toEqual({
    stdout: "worker runs\nexit 13\n",
    stderr: `Warning: Detected unsettled top-level await at file://<dir>/worker.mjs:2\n${stalled}\n^\n\n`,
    exitCode: 0,
    signalCode: null,
  });
});

// The worker used to poll for ever here, until terminate(). The preload fails like one that throws: its error is the worker's error.
test.concurrent("a preload that cannot finish is the worker's error", async () => {
  const stalled = "await new Promise(() => {});";
  expect(
    await run({
      "main.mjs": main(`, { preload: ["./preload.mjs"] }`),
      "preload.mjs": `${stalled}\n`,
      "worker.mjs": `console.log("worker runs");\n`,
    }),
  ).toEqual({
    stdout: `error: Detected unsettled top-level await at file://<dir>/preload.mjs:1\n${stalled}\n^\nexit 1\n`,
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

// The exit is asked for in the turn in which the wait for the preload finds nothing left: it is an exit, not a preload that cannot finish.
test.concurrent("process.exit() beside a preload's top-level await is the worker's exit code", async () => {
  expect(
    await run({
      "main.mjs": main(`, { preload: ["./preload.mjs"] }`),
      "preload.mjs": `queueMicrotask(() => process.exit(3));\nawait new Promise(() => {});\n`,
      "worker.mjs": `console.log("worker runs");\n`,
    }),
  ).toEqual({ stdout: "exit 3\n", stderr: "", exitCode: 0, signalCode: null });
});
