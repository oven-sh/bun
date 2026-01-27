import { expect, test } from "bun:test";

// Test for https://github.com/oven-sh/bun/issues/26377
// controller.desiredSize should return null (not throw) when stream is detached

test("controller.desiredSize does not throw after stream cleanup", async () => {
  // This test exercises the scenario where the internal
  // controlledReadableStream property becomes null during stream cleanup

  let capturedController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let desiredSizeAfterPipe: number | null | undefined;
  let didThrow = false;

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      capturedController = controller;
      controller.enqueue(new Uint8Array(100));
    },
    pull(_controller) {
      // Keep the stream open but don't enqueue more
      return new Promise(() => {}); // Never resolves - stream stays in pulling state
    },
  });

  const writable = new WritableStream<Uint8Array>({
    write() {
      // After first write, abort the stream to trigger cleanup
      return Promise.reject(new Error("Simulated abort"));
    },
  });

  try {
    await readable.pipeTo(writable);
  } catch {
    // Expected to fail due to simulated abort
  }

  // Now try to access desiredSize on the captured controller
  // After pipeTo cleanup, this should NOT throw - it should return a value
  if (capturedController) {
    try {
      desiredSizeAfterPipe = capturedController.desiredSize;
    } catch {
      didThrow = true;
    }
  }

  // The key assertion: accessing desiredSize should NOT throw
  expect(didThrow).toBe(false);
  // desiredSize should be null (errored) or 0 (closed), not undefined
  expect(desiredSizeAfterPipe).toBeOneOf([null, 0]);
});

test("controller.desiredSize returns correct values based on stream state", () => {
  // Test normal desiredSize behavior (not the edge case, but ensures the fix doesn't break normal use)
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
    },
  });

  // Before close, desiredSize should be the highWaterMark (default 1)
  expect(controller!.desiredSize).toBe(1);

  // Close the stream
  controller!.close();

  // After close, desiredSize should be 0
  expect(controller!.desiredSize).toBe(0);
});

test("controller.desiredSize returns null when stream is errored", () => {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
    },
  });

  // Error the stream
  controller!.error(new Error("Test error"));

  // After error, desiredSize should be null
  expect(controller!.desiredSize).toBe(null);
});
