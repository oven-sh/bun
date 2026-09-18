import { test, mock } from "node:test";
import assert from "node:assert";

// Persist a target across --rerun-each iterations (built-in module state,
// including this global, survives; only the entry file is re-evaluated).
globalThis.__rerunTarget ??= { greet: () => "real" };
const target = globalThis.__rerunTarget;

// Module-scope mock.method() must run the file-boundary reset before
// snapshotting the original. Under --rerun-each Bun.main is unchanged, so a
// generation-counter comparison is what makes the reset fire on iterations 2+.
mock.method(target, "greet", () => "mocked");

test("module-scope mock.method captured the real original across reruns", () => {
  assert.strictEqual(target.greet(), "mocked");
  mock.restoreAll();
  // Without the reset, iteration 2 would have snapshotted iteration 1's mock
  // as the "original" and restoreAll() would restore to "mocked".
  assert.strictEqual(target.greet(), "real");
  // Re-install so the tracker still holds a mock for the next iteration's
  // reset to restore.
  mock.method(target, "greet", () => "mocked");
});
