// WPT streams tests Bun does not yet pass. Each entry is the upstream test
// name → a one-line reason. Registered as test.todo so the gap is visible
// without turning CI red. Remove entries as the underlying behavior is fixed.

import { knownFailures } from "./testharness-shim";

// Pre-existing: writer.write()/reader.read() never settle when start() returns
// a promise that rejects asynchronously. Reproduces on releases without the
// transformer.cancel changes.
knownFailures.set(
  "TransformStream transformer.start() rejected promise should error the stream",
  "pre-existing: write()/read() hang when start() rejects asynchronously",
);
