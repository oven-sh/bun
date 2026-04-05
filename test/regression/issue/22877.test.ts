import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/22877
// When a mocked module has a pending dynamic import() and require() is called
// synchronously on the same module before the import microtasks complete,
// JSC's internal module loading promise could be fulfilled twice, causing a
// segfault (or assertion failure in debug builds).
//
// The fix makes require() on mocked modules directly assign the mock object
// as CJS exports, avoiding the ESM pipeline entirely. This prevents the
// double-fulfill and also means the exports don't get wrapped with __esModule.

test("import() then require() on same mocked module does not crash", async () => {
  using dir = tempDir("22877", {
    "repro.test.ts": `
      import { test, expect, mock } from "bun:test";

      test("require on mocked module returns mock object directly", async () => {
        mock.module("test-mod", () => ({ value: 42, nested: { x: 1 } }));

        // Start import (queues microtasks in JSC's module pipeline)
        const importPromise = import("test-mod");

        // Synchronously require the same module - with the fix, this returns
        // the mock object directly instead of going through the ESM pipeline.
        const required = require("test-mod");
        expect(required.value).toBe(42);
        expect(required.nested.x).toBe(1);

        // With the fix, require() returns the mock object directly,
        // so __esModule should NOT be set. Without the fix, require()
        // goes through the ESM pipeline which sets __esModule = true.
        expect(required.__esModule).toBeUndefined();

        const imported = await importPromise;
        expect(imported.value).toBe(42);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "repro.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = stdout + stderr;
  expect(output).toContain("1 pass");
  expect(exitCode).toBe(0);
});
