import { expect, test } from "bun:test";

test("worker", done => {
  const worker = new Worker(new URL("worker-fixture.js", import.meta.url).href, {
    smol: true,
  });
  worker.postMessage("hello");
  worker.onerror = e => {
    done(e.error);
  };
  worker.onmessage = e => {
    expect(e.data).toEqual("initial message");
    worker.terminate();
    done();
  };
});
