import { describe, expect, test } from "bun:test";

describe("Worker", () => {
  test("terminate()/ref()/unref() after the worker has exited does not crash", async () => {
    const url = URL.createObjectURL(new Blob(["/* exits immediately */"], { type: "application/javascript" }));
    try {
      const workers: Worker[] = [];
      for (let i = 0; i < 4; i++) {
        const w = new Worker(url);
        workers.push(w);
      }

      await Promise.all(
        workers.map(w => {
          const { promise, resolve } = Promise.withResolvers<void>();
          w.addEventListener("close", () => resolve(), { once: true });
          return promise;
        }),
      );

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
