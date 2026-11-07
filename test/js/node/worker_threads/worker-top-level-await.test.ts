import { expect, test } from "bun:test";
import { Worker } from "worker_threads";

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
