import { Worker } from "node:worker_threads";

/**
 * A worker whose thread has ended by the time `new Worker()` returns, so that what it posted is delivered on the way
 * to 'exit'. This thread is held inside the constructor, where it adds its first listener to the native Worker,
 * until the worker's own 'exit' handlers have run and for `hold` milliseconds more, in which the thread ends.
 * A 'message' listener that is called behind the end of the thread reads -1 from `worker.threadId`.
 */
export function workerThatEndsInsideItsConstructor(source: string, hold: number): Worker {
  const state = new Int32Array(new SharedArrayBuffer(4));
  const { addEventListener } = EventTarget.prototype;
  EventTarget.prototype.addEventListener = function (this: EventTarget, ...args: Parameters<typeof addEventListener>) {
    if (this instanceof globalThis.Worker && Atomics.load(state, 0) !== 2) {
      Atomics.wait(state, 0, 0, 20_000);
      Atomics.wait(state, 0, 1, hold);
      Atomics.store(state, 0, 2);
    }
    return addEventListener.apply(this, args);
  };
  try {
    return new Worker(
      `const { parentPort, workerData } = require("node:worker_threads");
      process.on("exit", () => {
        Atomics.store(workerData, 0, 1);
        Atomics.notify(workerData, 0);
      });
      ${source}`,
      { eval: true, workerData: state },
    );
  } finally {
    EventTarget.prototype.addEventListener = addEventListener;
  }
}

/** Calls `attempt` with longer and longer holds until it says that its listener was called behind the end of the thread. */
export async function untilBehindTheEndOfTheThread(attempt: (hold: number) => Promise<number>): Promise<void> {
  for (let hold = 16; (await attempt(hold)) !== -1; hold *= 2);
}
