// node-test.test.ts runs this file, 30-late-failure.js and 30-late-skip.js in
// one `bun test --timeout 100` process. Each test blocks the thread for longer
// than that timeout after it has resumed from the event loop, so no timer can
// fire before it completes. The late test of each file comes first: a test
// that starts while the runner handles a timeout can be judged before its body
// resumes.
import { test } from "node:test";

const block = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

test("completes after the runner's timeout", async () => {
  await new Promise(resolve => setImmediate(resolve));
  block(200);
});

test("an Infinity timeout is never exceeded", { timeout: Infinity }, async () => {
  await new Promise(resolve => setImmediate(resolve));
  block(200);
});
