import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";
import type { Readable } from "node:stream";
import {
  threadIdWhereItsOutputIsRead,
  untilBehindTheEndOfTheThread,
  workerThatEndsInsideItsConstructor,
} from "./worker-that-ends-inside-its-constructor";

const patience = isDebug || isASAN ? 60_000 : 10_000;

function textOf(stream: Readable): Promise<string> {
  return new Promise(resolve => {
    let text = "";
    stream.on("data", chunk => void (text += chunk));
    stream.on("end", () => resolve(text));
  });
}

describe("node:worker_threads: the worker writes to its stdout and stderr and calls process.exit()", () => {
  const source = `
    process.stdout.write("out 1\\n");
    process.stderr.write("err 1\\n");
    process.stdout.write("out 2\\n");
    process.stderr.write("err 2\\n");
    parentPort.postMessage("posted");
    process.exit(3);`;

  test(
    "worker.stdout and worker.stderr hold all of it, and end, where the thread has ended before `new Worker()` returns",
    async () => {
      await untilBehindTheEndOfTheThread(async hold => {
        const worker = workerThatEndsInsideItsConstructor(source, hold, { stdout: true, stderr: true });
        const threadId = threadIdWhereItsOutputIsRead(worker);
        const [stdout, stderr, code] = await Promise.all([
          textOf(worker.stdout),
          textOf(worker.stderr),
          new Promise(resolve => worker.on("exit", resolve)),
        ]);
        expect({ stdout, stderr, code }).toEqual({ stdout: "out 1\nout 2\n", stderr: "err 1\nerr 2\n", code: 3 });
        return threadId();
      });
    },
    patience,
  );

  test(
    "terminate() in a 'data' listener that is called behind the end of the thread resolves with the exit code",
    async () => {
      await untilBehindTheEndOfTheThread(async hold => {
        const worker = workerThatEndsInsideItsConstructor(source, hold, { stdout: true });
        const threadId = threadIdWhereItsOutputIsRead(worker);
        const code = await new Promise(resolve => {
          worker.stdout.once("data", () => void worker.terminate().then(resolve));
        });
        expect(code).toBe(3);
        return threadId();
      });
    },
    patience,
  );

  test(
    "the process prints all of it where the streams are not asked for",
    async () => {
      using dir = tempDir("what-a-worker-wrote", {
        "main.ts": `
          import {
            threadIdWhereItsOutputIsRead,
            untilBehindTheEndOfTheThread,
            workerThatEndsInsideItsConstructor,
          } from ${JSON.stringify(join(import.meta.dir, "worker-that-ends-inside-its-constructor.ts"))};
          let attempts = 0;
          await untilBehindTheEndOfTheThread(async hold => {
            attempts++;
            const worker = workerThatEndsInsideItsConstructor(${JSON.stringify(source)}, hold);
            const threadId = threadIdWhereItsOutputIsRead(worker);
            await new Promise(resolve => worker.on("exit", resolve));
            return threadId();
          });
          console.log("attempts " + attempts);`,
      });
      await using child = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "main.ts")],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
      const attempts = Number(/attempts (\d+)/.exec(stdout)?.[1]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: "out 1\nout 2\n".repeat(attempts) + `attempts ${attempts}\n`,
        stderr: "err 1\nerr 2\n".repeat(attempts),
        exitCode: 0,
      });
    },
    patience,
  );
});
