// node-test.test.ts runs this file and 31-mock-again-before-restore-all-b.mjs
// with --rerun-each=2, in one `bun test` process. Each run is a new file for
// node:test.
//
// Every test gets a default mock, one test mocks the method again, and
// afterEach() restores all. mock.restoreAll() goes oldest first, in Node.js
// too, so after that test the default mock is on the method again. Node.js
// runs each file in a new process, so there the next file gets the real
// method. These files pass with `node --test` too.
import assert from "node:assert";
import { afterEach, beforeEach, mock, test } from "node:test";
import { service } from "./31-mock-again-before-restore-all-shared.mjs";

beforeEach(() => {
  mock.method(service, "run", () => "default mock");
});
afterEach(() => mock.restoreAll());

// The call of beforeEach() above is this file's first call of node:test, and
// that call ends the mocks of the run before.
const runAtStart = service.run();

test("the file starts with the real method", () => {
  assert.strictEqual(runAtStart, "real");
  assert.strictEqual(service.run(), "default mock");
});

test("a test mocks the method again", () => {
  mock.method(service, "run", () => "mocked again");
  assert.strictEqual(service.run(), "mocked again");
});
