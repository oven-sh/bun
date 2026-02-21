import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/27287
test("CJS require() of failing ESM does not corrupt module for subsequent import()", async () => {
  using dir = tempDir("issue-27287", {
    "bad-esm.mjs": `throw globalThis.err;\nexport const foo = 2;\n`,
    "entry.cjs": `
'use strict';
globalThis.err = new Error('intentional error');

// First: require() the failing ESM module
try {
  require('./bad-esm.mjs');
} catch (e) {
  console.log('require_error:', e.message);
}

// Second: import() the same module - should re-throw the original error, not ReferenceError
import('./bad-esm.mjs')
  .then(() => {
    console.log('import_result: resolved');
  })
  .catch((e) => {
    console.log('import_error_type:', e.constructor.name);
    console.log('import_error_msg:', e.message);
  });
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "entry.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("require_error: intentional error");
  // The import() should re-throw the original evaluation error, NOT a ReferenceError
  // about uninitialized exports. The module threw during evaluation, so import() should
  // reject with the same error.
  expect(stdout).not.toContain("ReferenceError");
  expect(stdout).toContain("import_error_type: Error");
  expect(stdout).toContain("import_error_msg: intentional error");
  expect(exitCode).toBe(0);
});
