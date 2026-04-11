import { describe, expect, test } from "bun:test";

describe("Worker", () => {
  test("terminate()/ref()/unref() after the worker has exited does not crash", async () => {
    const url = URL.createObjectURL(new Blob(["/* exits immediately */"], { type: "application/javascript" }));
    try {
      const workers: Worker[] = [];
      const exited: Promise<void>[] = [];
      for (let i = 0; i < 4; i++) {
        const { promise, resolve } = Promise.withResolvers<void>();
        const w = new Worker(url);
        w.addEventListener("close", () => resolve(), { once: true });
        workers.push(w);
        exited.push(promise);
      }

      await Promise.all(exited);

      Bun.gc(true);

      for (const w of workers) {
        w.terminate();
        w.ref();
        w.unref();
        w.terminate();
      }
    } finally {
      URL.revokeObjectURL(url);
    }

    expect(true).toBe(true);
  });
});
