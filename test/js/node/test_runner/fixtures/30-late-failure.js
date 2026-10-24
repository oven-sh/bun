// See 30-late-completion.js.
import { test } from "node:test";

test("fails after the runner's timeout", async () => {
  await new Promise(resolve => setImmediate(resolve));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  throw new Error("own error");
});
