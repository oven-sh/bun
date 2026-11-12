import { expect, test } from "bun:test";
import { Worker } from "node:worker_threads";

test("worker.stdout and worker.stderr carry no function of their own but the _read of their Readable", async () => {
  const worker = new Worker("", { eval: true, stdout: true, stderr: true });
  try {
    for (const stream of [worker.stdout, worker.stderr]) {
      const functions = Object.getOwnPropertyNames(stream).filter(
        name => typeof (stream as unknown as Record<string, unknown>)[name] === "function",
      );
      expect(functions).toEqual(["_read"]);
    }
  } finally {
    await worker.terminate();
  }
});
