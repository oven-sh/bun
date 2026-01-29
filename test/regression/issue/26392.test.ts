import assert from "node:assert";
import { test } from "node:test";

// https://github.com/oven-sh/bun/issues/26392
// ReadableStream.prototype.pipeTo does not respond to AbortSignal
test("pipeTo responds to AbortSignal", async () => {
  const abortController = new AbortController();
  let cancelCalled = false;
  let abortCalled = false;

  // Promise that resolves when the pipe has started (first write received)
  const { promise: pipeStartedPromise, resolve: pipeStarted } = Promise.withResolvers<void>();

  const pipePromise = new ReadableStream({
    start(controller) {
      // Keep the stream open - don't close it
      controller.enqueue("data");
    },
    cancel(reason) {
      cancelCalled = true;
      assert(reason instanceof DOMException);
      assert.strictEqual(reason.name, "AbortError");
    },
  }).pipeTo(
    new WritableStream({
      write() {
        // Signal that the pipe has started processing data
        pipeStarted();
      },
      abort(reason) {
        abortCalled = true;
        assert(reason instanceof DOMException);
        assert.strictEqual(reason.name, "AbortError");
      },
    }),
    { signal: abortController.signal },
  );

  // Wait for the pipe to actually start processing
  await pipeStartedPromise;

  // Abort the signal
  abortController.abort();

  // The promise should reject with an AbortError
  await assert.rejects(pipePromise, (err: Error) => {
    assert(err instanceof DOMException);
    assert.strictEqual(err.name, "AbortError");
    return true;
  });

  // Both cancel and abort should have been called
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

  await assert.rejects(pipePromise, (err: Error) => {
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

  // Promise that resolves when the pipe has started (first write received)
  const { promise: pipeStartedPromise, resolve: pipeStarted } = Promise.withResolvers<void>();

  const pipePromise = new ReadableStream({
    start(controller) {
      controller.enqueue("data");
    },
    cancel() {
      cancelCalled = true;
    },
  }).pipeTo(
    new WritableStream({
      write() {
        pipeStarted();
      },
      abort() {
        abortCalled = true;
      },
    }),
    { signal: abortController.signal, preventCancel: true },
  );

  await pipeStartedPromise;
  abortController.abort();

  await assert.rejects(pipePromise, (err: Error) => {
    assert(err instanceof DOMException);
    assert.strictEqual(err.name, "AbortError");
    return true;
  });

  // cancel should NOT be called because preventCancel is true
  assert.strictEqual(cancelCalled, false);
  assert.strictEqual(abortCalled, true);
});

test("pipeTo with preventAbort respects AbortSignal", async () => {
  const abortController = new AbortController();
  let cancelCalled = false;
  let abortCalled = false;

  // Promise that resolves when the pipe has started (first write received)
  const { promise: pipeStartedPromise, resolve: pipeStarted } = Promise.withResolvers<void>();

  const pipePromise = new ReadableStream({
    start(controller) {
      controller.enqueue("data");
    },
    cancel() {
      cancelCalled = true;
    },
  }).pipeTo(
    new WritableStream({
      write() {
        pipeStarted();
      },
      abort() {
        abortCalled = true;
      },
    }),
    { signal: abortController.signal, preventAbort: true },
  );

  await pipeStartedPromise;
  abortController.abort();

  await assert.rejects(pipePromise, (err: Error) => {
    assert(err instanceof DOMException);
    assert.strictEqual(err.name, "AbortError");
    return true;
  });

  assert.strictEqual(cancelCalled, true);
  // abort should NOT be called because preventAbort is true
  assert.strictEqual(abortCalled, false);
});
