import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { Worker } from "worker_threads";

describe("worker top-level await", () => {
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
  test.each([42, 5])("unsettled top-level await preserves a user-set process.exitCode %p", async code => {
    const w = new Worker(new URL(`data:text/javascript,process.exitCode=${code}; await new Promise(() => {})`));
    const exitCode = await new Promise<number>(resolve => w.on("exit", resolve));
    expect({ code, exitCode }).toEqual({ code, exitCode: code });
  });

  test("unsettled top-level await still exits 13 when process.exitCode is 0", async () => {
    const w = new Worker(new URL("data:text/javascript,process.exitCode=0; await new Promise(() => {})"));
    const exitCode = await new Promise<number>(resolve => w.on("exit", resolve));
    expect(exitCode).toBe(13);
  });

  // https://github.com/oven-sh/bun/issues/15408
  // A worker whose top-level await never settles (yielding via setImmediate)
  // must still receive parentPort messages: the worker goes online before the
  // TLA wait, so parent postMessage() schedules drains that the TLA loop's
  // tick_concurrent() picks up.
  test("parentPort receives messages while top-level await spins on setImmediate", async () => {
    const src = `
      const { parentPort } = require("node:worker_threads");
      parentPort.on("message", m => parentPort.postMessage("pong:" + m));
      while (true) await new Promise(r => setImmediate(r));
    `;
    const w = new Worker(new URL("data:text/javascript," + encodeURIComponent(src)));
    try {
      w.postMessage("ping");
      const [reply] = await once(w, "message");
      expect(reply).toBe("pong:ping");
    } finally {
      await w.terminate();
    }
  });

  // Same as above but the message is sent from the parent's 'online' handler,
  // which the worker must observe while still inside its top-level await.
  test("parentPort receives messages posted from 'online' while inside top-level await", async () => {
    const src = `
      const { parentPort } = require("node:worker_threads");
      parentPort.on("message", m => parentPort.postMessage("pong:" + m));
      await new Promise(r => setTimeout(r, 100_000).unref());
    `;
    const w = new Worker(new URL("data:text/javascript," + encodeURIComponent(src)));
    try {
      await once(w, "online");
      w.postMessage("ping");
      const [reply] = await once(w, "message");
      expect(reply).toBe("pong:ping");
    } finally {
      await w.terminate();
    }
  });

  // Node emits 'online' once the worker thread starts executing; it does not
  // wait for top-level await to settle. An unsettled TLA exits with code 13
  // (tested above); 'online' must still have fired first.
  test("worker emits 'online' even when top-level await never settles", async () => {
    const w = new Worker(new URL("data:text/javascript,await new Promise(() => {})"));
    const events: string[] = [];
    await new Promise<void>(resolve => {
      w.on("online", () => events.push("online"));
      w.on("exit", code => {
        events.push("exit:" + code);
        resolve();
      });
    });
    expect(events).toEqual(["online", "exit:13"]);
  });
});
