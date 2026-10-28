import { expect, test } from "bun:test";
import { Worker } from "node:worker_threads";

test("the function that worker.stdout and worker.stderr carry takes no parameter", async () => {
  const worker = new Worker("", { eval: true, stdout: true, stderr: true });
  try {
    for (const stream of [worker.stdout, worker.stderr]) {
      const { endFromOwner } = stream as unknown as { endFromOwner: Function };
      expect([endFromOwner.name, endFromOwner.length]).toEqual(["", 0]);
    }
  } finally {
    await worker.terminate();
  }
});
