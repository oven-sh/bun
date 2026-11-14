import { Worker, type WorkerOptions } from "node:worker_threads";

/**
 * A worker whose thread has ended by the time `new Worker()` returns, so that what it wrote and posted is delivered on
 * the way to 'exit'. This thread is held inside the constructor, where it adds its first listener to one of the
 * worker's ports, until the worker's own 'exit' handlers have run and for `hold` milliseconds more, in which the thread
 * ends. A 'message' listener that is called behind the end of the thread reads -1 from `worker.threadId`.
 */
export function workerThatEndsInsideItsConstructor(source: string, hold: number, options: WorkerOptions = {}): Worker {
  const state = new Int32Array(new SharedArrayBuffer(4));
  const { addEventListener } = EventTarget.prototype;
  EventTarget.prototype.addEventListener = function (this: EventTarget, ...args: Parameters<typeof addEventListener>) {
    if (Atomics.load(state, 0) !== 2) {
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
      { ...options, eval: true, workerData: state },
    );
  } finally {
    EventTarget.prototype.addEventListener = addEventListener;
  }
}

/**
 * What `worker.threadId` reads where the first chunk of the worker's stdout is read: the ports are attached one after
 * the other, that of stdout first. Where no chunk is read, what it reads in the 'message' listener.
 */
export function threadIdWhereItsOutputIsRead(worker: Worker): () => number {
  let atData = 0;
  let atMessage = 0;
  worker.stdout.once("data", () => void (atData = worker.threadId));
  worker.once("message", () => void (atMessage = worker.threadId));
  return () => atData || atMessage;
}

/** Calls `attempt` with longer and longer holds until it says that its listener was called behind the end of the thread. */
export async function untilBehindTheEndOfTheThread(attempt: (hold: number) => Promise<number>): Promise<void> {
  for (let hold = 16; (await attempt(hold)) !== -1; hold *= 2);
}
