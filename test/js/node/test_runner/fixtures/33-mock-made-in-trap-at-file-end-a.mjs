// node-test.test.ts runs this file, then 33-mock-made-in-trap-at-file-end-b.mjs
// and -c.mjs, in one `bun test` process. This file leaves a mock on a Proxy
// target whose defineProperty trap makes a mock on each write. The end of a file
// takes off the mocks that the file made. A mock that the trap makes during
// that step is a mock of the next file, so the step ends.
import assert from "node:assert";
import { mock, test } from "node:test";
import { proxied, state } from "./33-mock-made-in-trap-at-file-end-shared.mjs";

test("leaves a mock on a Proxy target that makes a mock on each write", () => {
  mock.method(proxied, "run", () => "mocked");
  assert.strictEqual(proxied.run(), "mocked");
  state.armed = true;
});
