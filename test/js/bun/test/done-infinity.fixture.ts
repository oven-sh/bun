import { expect, test } from "bun:test";

test("asynchronously failing test with a done callback does not hang", async done => {
  await Bun.sleep(42);
  throw new Error("Test failed successfully");
});

test("asynchronously failing test after a done callback is called does not hang", async done => {
  await Bun.sleep(42);
  done();
  throw new Error("Test failed successfully");
});

test("synchronously failing test with an async done callback does not hang", async done => {
  throw new Error("Test failed successfully");
});

test("done() with an unhandled exception ends the test", done => {
  expect(true).toBe(true);
  setTimeout(() => {
    throw new Error("Test failed successfully");
  });
});

test("exception inside setImmediate does not hang", done => {
  setImmediate(() => {
    throw new Error("Test failed successfully");
  });
});

test("exception inside queueMicrotask does not hang", done => {
  queueMicrotask(() => {
    throw new Error("Test failed successfully");
  });
});

test("exception inside process.nextTick does not hang", done => {
  process.nextTick(() => {
    throw new Error("Test failed successfully");
  });
});
