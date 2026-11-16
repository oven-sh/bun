import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import {
  untilBehindTheEndOfTheThread,
  workerThatEndsInsideItsConstructor,
} from "./worker-that-ends-inside-its-constructor";

const many = isDebug || isASAN ? 48 : 320;
const atOnce = 16;
const patience = isDebug || isASAN ? 60_000 : 10_000;

async function inRounds(count: number, one: () => Promise<unknown>) {
  const answers: unknown[] = [];
  for (let done = 0; done < count; done += atOnce) {
    answers.push(...(await Promise.all(Array.from({ length: Math.min(atOnce, count - done) }, one))));
  }
  return answers;
}

describe("node:worker_threads: the worker posts one message and ends by itself", () => {
  test("terminate() in the 'message' listener resolves, for each of many workers", async () => {
    const answers = await inRounds(
      many,
      () =>
        new Promise(resolve => {
          const worker = new Worker(`require("node:worker_threads").parentPort.postMessage("answer")`, { eval: true });
          worker.once("message", answer => void worker.terminate().then(code => resolve(answer + " " + typeof code)));
        }),
    );
    expect(answers).toEqual(Array(many).fill("answer number"));
  }, 120_000);

  test(
    "terminate() in a 'message' listener that is called behind the end of the thread resolves with the exit code",
    async () => {
      await untilBehindTheEndOfTheThread(async hold => {
        const worker = workerThatEndsInsideItsConstructor(
          `parentPort.postMessage("first"); parentPort.postMessage("second");`,
          hold,
        );
        const events: string[] = [];
        worker.on("exit", code => void events.push("exit " + code));
        const { threadId, code } = await new Promise<{ threadId: number; code: number }>(resolve => {
          worker.on("message", message => {
            events.push(message);
            if (message !== "first") return;
            const threadId = worker.threadId;
            void worker.terminate().then(code => resolve({ threadId, code }));
          });
        });
        expect(code).toBe(0);
        expect(events).toEqual(["first", "second", "exit 0"]);
        expect(await worker.terminate()).toBeUndefined();
        return threadId;
      });
    },
    patience,
  );

  test(
    "a second terminate() there returns the promise of the first",
    async () => {
      await untilBehindTheEndOfTheThread(async hold => {
        const worker = workerThatEndsInsideItsConstructor(`parentPort.postMessage("first");`, hold);
        const { threadId, codes, same } = await new Promise<{ threadId: number; codes: number[]; same: boolean }>(
          resolve => {
            worker.once("message", () => {
              const threadId = worker.threadId;
              const first = worker.terminate();
              const second = worker.terminate();
              void Promise.all([first, second]).then(codes => resolve({ threadId, codes, same: first === second }));
            });
          },
        );
        expect({ codes, same }).toEqual({ codes: [0, 0], same: true });
        return threadId;
      });
    },
    patience,
  );

  test(
    "the callback of terminate(callback) there is called with the exit code, and none is kept once the worker has exited",
    async () => {
      await untilBehindTheEndOfTheThread(async hold => {
        const worker = workerThatEndsInsideItsConstructor(`parentPort.postMessage("first");`, hold);
        const { threadId, called, code } = await new Promise<{ threadId: number; called: unknown[][]; code: number }>(
          resolve => {
            worker.once("message", () => {
              const threadId = worker.threadId;
              const called: unknown[][] = [];
              void worker
                .terminate((...args) => void called.push(args))
                .then(code => resolve({ threadId, called, code }));
            });
          },
        );
        expect({ called, code }).toEqual({ called: [[null, 0]], code: 0 });
        expect(await worker.terminate(() => expect.unreachable())).toBeUndefined();
        expect(worker.listenerCount("exit")).toBe(0);
        return threadId;
      });
    },
    patience,
  );

  test(
    "'exit' follows a 'message' listener that throws there, and terminate() resolves afterwards",
    async () => {
      await using child = Bun.spawn({
        cmd: [bunExe(), join(import.meta.dir, "a-message-listener-throws-behind-the-end-of-the-thread-fixture.ts")],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: "exit: 0\nmessage: first\nterminate: undefined\nuncaught: thrown by the listener\n",
        stderr: "",
        exitCode: 0,
      });
    },
    patience,
  );
});

describe("Worker: the worker posts one message and ends by itself", () => {
  const source = URL.createObjectURL(new Blob([`postMessage("answer");`], { type: "application/javascript" }));

  test("terminate() in the 'message' listener is followed by one 'close' event, for each of many workers", async () => {
    const answers = await inRounds(
      many,
      () =>
        new Promise(resolve => {
          const worker = new globalThis.Worker(source);
          let closed = 0;
          worker.addEventListener("close", () => {
            closed++;
            // Another 'close' would come in a task of its own.
            setImmediate(() => resolve(closed));
          });
          worker.addEventListener("message", () => worker.terminate());
        }),
    );
    expect(answers).toEqual(Array(many).fill(1));
  }, 120_000);

  test(
    "a 'close' listener added beside terminate() in the 'message' listener is called",
    async () => {
      const answers = await inRounds(
        atOnce,
        () =>
          new Promise(resolve => {
            const worker = new globalThis.Worker(source);
            worker.addEventListener("message", event => {
              worker.terminate();
              worker.addEventListener("close", () => resolve(event.data));
            });
          }),
      );
      expect(answers).toEqual(Array(atOnce).fill("answer"));
    },
    patience,
  );
});
