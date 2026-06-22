// WPT streams tests Bun does not yet pass. Each entry is the upstream test
// name → a one-line reason. Registered as test.todo so the gap is visible
// without turning CI red. Remove entries as the underlying behavior is fixed.

import { knownFailures } from "./testharness-shim";

// Web IDL "a promise resolved with x" is `new Promise(r => r(x))` (always a
// fresh promise; one extra microtask when x is a thenable), not
// `Promise.resolve(x)` (returns x when x is already a Promise). Bun's
// writableStreamDefaultControllerStart uses Promise.$resolve(startAlgorithm()),
// so when startAlgorithm() returns a promise the [[started]] reaction is
// queued one microtask earlier than the spec ref-impl. The test below depends
// on the cancel-fulfill reaction observing the writable mid-"erroring" rather
// than already "errored".
knownFailures.set(
  "readable.cancel() and a parallel writable.close() should reject if a transformer.cancel() calls controller.error()",
  "Promise.$resolve short-circuit in writableStreamDefaultControllerStart shifts [[started]] one microtask early",
);

// Pre-existing: writer.write()/reader.read() never settle when start() returns
// a promise that rejects asynchronously. Reproduces on releases without the
// transformer.cancel changes.
knownFailures.set(
  "TransformStream transformer.start() rejected promise should error the stream",
  "pre-existing: write()/read() hang when start() rejects asynchronously",
);

// Pre-existing: with abort queued before [[started]] and readable.cancel()
// racing it, the source-cancel reaction runs first and resolves the shared
// finishPromise; the writable's pendingAbortRequest then surfaces as a
// rejection of writer.abort() instead of fulfilling it. Same Promise.$resolve
// vs Web IDL "a promise resolved with" hop-count root cause as above.
knownFailures.set(
  "abort should set the close reason for the writable when it happens before cancel during start, and cancel should reject",
  "abort()/cancel() race during start: hop-count divergence vs spec ref-impl",
);
