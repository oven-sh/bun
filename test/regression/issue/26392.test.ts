import assert from "node:assert";
import { test } from "node:test";

// https://github.com/oven-sh/bun/issues/26392
// ReadableStream.prototype.pipeTo does not respond to AbortSignal when
// abort() is called asynchronously (e.g. via setTimeout). The pipe hangs
// indefinitely because the pending read promise is never resolved.

test("pipeTo responds to AbortSignal", async () => {
  const abortController = new AbortController();
  let cancelCalled = false;
  let abortCalled = false;

  const pipePromise = new ReadableStream({
    start(controller) {
      controller.enqueue("data");
    },
    cancel(reason) {
      cancelCalled = true;
      assert(reason instanceof DOMException);
      assert.strictEqual(reason.name, "AbortError");
    },
  }).pipeTo(
    new WritableStream({
      abort(reason) {
        abortCalled = true;
        assert(reason instanceof DOMException);
        assert.strictEqual(reason.name, "AbortError");
      },
    }),
    { signal: abortController.signal },
  );

  // Abort asynchronously via setTimeout — this is the actual trigger for the
  // bug. By the time the callback fires, the pipe has processed the enqueued
  // chunk and started a new pending read that blocks forever. Without the fix,
  // the pending read promise is never resolved, causing the pipe to hang.
  setTimeout(() => abortController.abort());

  await assert.rejects(pipePromise, err => {
    assert(err instanceof DOMException);
    assert.strictEqual(err.name, "AbortError");
    return true;
  });

  assert.strictEqual(cancelCalled, true);
  assert.strictEqual(abortCalled, true);
});

test("pipeTo with already aborted signal", async () => {
  const abortController = new AbortController();
  abortController.abort();

  let cancelCalled = false;
  let abortCalled = false;

  const pipePromise = new ReadableStream({
    start(controller) {
      controller.enqueue("data");
    },
    cancel() {
      cancelCalled = true;
    },
  }).pipeTo(
    new WritableStream({
      abort() {
        abortCalled = true;
      },
    }),
    { signal: abortController.signal },
  );

  await assert.rejects(pipePromise, err => {
    assert(err instanceof DOMException);
    assert.strictEqual(err.name, "AbortError");
    return true;
  });

  assert.strictEqual(cancelCalled, true);
  assert.strictEqual(abortCalled, true);
});

test("pipeTo with preventCancel respects AbortSignal", async () => {
  const abortController = new AbortController();
  let cancelCalled = false;
  let abortCalled = false;

  const pipePromise = new ReadableStream({
    start(controller) {
      controller.enqueue("data");
    },
    cancel() {
      cancelCalled = true;
    },
  }).pipeTo(
    new WritableStream({
      abort() {
        abortCalled = true;
      },
    }),
    { signal: abortController.signal, preventCancel: true },
  );

  setTimeout(() => abortController.abort());

  await assert.rejects(pipePromise, err => {
    assert(err instanceof DOMException);
    assert.strictEqual(err.name, "AbortError");
    return true;
  });

  assert.strictEqual(cancelCalled, false);
  assert.strictEqual(abortCalled, true);
});

test("pipeTo with preventAbort respects AbortSignal", async () => {
  const abortController = new AbortController();
  let cancelCalled = false;
  let abortCalled = false;

  const pipePromise = new ReadableStream({
    start(controller) {
      controller.enqueue("data");
    },
    cancel() {
      cancelCalled = true;
    },
  }).pipeTo(
    new WritableStream({
      abort() {
        abortCalled = true;
      },
    }),
    { signal: abortController.signal, preventAbort: true },
  );

  setTimeout(() => abortController.abort());

  await assert.rejects(pipePromise, err => {
    assert(err instanceof DOMException);
    assert.strictEqual(err.name, "AbortError");
    return true;
  });

  assert.strictEqual(cancelCalled, true);
  assert.strictEqual(abortCalled, false);
});
