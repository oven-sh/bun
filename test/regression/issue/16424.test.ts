import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/16424
// Worker should continue running after an error is handled by self.onerror / preventDefault()

test("worker continues running when error event calls preventDefault()", async () => {
  const worker = new Worker(new URL("./16424-worker-prevent-default.ts", import.meta.url).href);

  try {
    const messages: string[] = [];
    const done = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for worker messages")), 5000);
      worker.onmessage = e => {
        messages.push(e.data);
        if (e.data === "after-error") {
          clearTimeout(timeout);
          resolve();
        }
      };
      worker.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Error propagated to parent (should have been handled inside worker)"));
      };
    });

    await done;
    expect(messages).toContain("before-error");
    expect(messages).toContain("after-error");
  } finally {
    worker.terminate();
  }
});

test("worker terminates when error event is NOT handled", async () => {
  const worker = new Worker(new URL("./16424-worker-no-handler.ts", import.meta.url).href);

  const closed = await new Promise<boolean>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out")), 5000);
    worker.addEventListener("error", () => {
      // Error propagated to parent — expected
    });
    worker.addEventListener("close", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });

  expect(closed).toBe(true);
});
