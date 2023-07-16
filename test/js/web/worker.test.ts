import { expect, test } from "bun:test";

test("worker", done => {
  const worker = new Worker(new URL("worker-fixture.js", import.meta.url).href, {
    bun: {
      mini: true,
    },
  });
  worker.postMessage("hello");
  worker.onerror = e => {
    console.log(e);
    worker.terminate();
  };
  worker.ref();
  worker.onmessage = e => {
    console.log(e.data);
    worker.unref();
    done();
  };
});
