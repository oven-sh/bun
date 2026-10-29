import { test, mock } from "node:test";
import assert from "node:assert";

// Persist a target across --rerun-each iterations (built-in module state,
// including this global, survives; only the entry file is re-evaluated).
globalThis.__rerunTarget ??= { greet: () => "real" };
const target = globalThis.__rerunTarget;

// The file-boundary reset must run before a module-scope mock.method()
// snapshots the original. Under --rerun-each Bun.main is unchanged, so the
// runner, which resets before it loads the file again, is what tells
// iterations 2+ apart.
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
