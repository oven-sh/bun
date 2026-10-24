// See 30-late-completion.js.
import { test } from "node:test";

test("skips itself after the runner's timeout", async t => {
  await new Promise(resolve => setImmediate(resolve));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  t.skip("skipped late");
});
