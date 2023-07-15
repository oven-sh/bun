import { expect, test } from "bun:test";

test("worker", () => {
  const worker = new Worker("worker.js");
  worker.postMessage("hello");
  worker.onmessage = e => {
    expect(e.data).toBe("world");
  };
  worker.ref();
  worker.unref();
});
