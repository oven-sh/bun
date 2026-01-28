import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { join } from "path";

test("Module._extensions should not break ASI (automatic semicolon insertion)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bun-module-extensions-asi-"));

  // Create a module without semicolons that relies on ASI
  const moduleWithoutSemi = join(dir, "module-no-semi.js");
  writeFileSync(
    moduleWithoutSemi,
    `function f() {}
module.exports = f
f.f = f`,
  );

  // Create a test file that hooks Module._extensions
  const testFile = join(dir, "test.js");
  writeFileSync(
    testFile,
    `
const Module = require("module");
const orig = Module._extensions[".js"];

// Hook Module._extensions[".js"] - commonly done by transpiler libraries
Module._extensions[".js"] = (m, f) => {
  return orig(m, f);
};

// This should work without parse errors
const result = require("./module-no-semi.js");
if (typeof result !== 'function') {
  throw new Error('Expected function but got ' + typeof result);
}
if (result.f !== result) {
  throw new Error('Expected result.f === result');
}
console.log('SUCCESS');
`,
  );

  // Run the test
  const proc = Bun.spawn({
    cmd: [bunExe(), testFile],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should not have parse errors
  expect(stderr).not.toContain("Expected '{'");
  expect(stderr).not.toContain("Unexpected end of file");
  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("SUCCESS");
});

test("Module._extensions works with modules that have semicolons", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bun-module-extensions-semi-"));

  // Create a module with semicolons
  const moduleWithSemi = join(dir, "module-with-semi.js");
  writeFileSync(
    moduleWithSemi,
    `function g() { return 42; }
module.exports = g;
g.g = g;`,
  );

  // Create a test file that hooks Module._extensions
  const testFile = join(dir, "test.js");
  writeFileSync(
    testFile,
    `
const Module = require("module");
const orig = Module._extensions[".js"];

Module._extensions[".js"] = (m, f) => {
  return orig(m, f);
};

// This should also work with semicolons
const result = require("./module-with-semi.js");
if (typeof result !== 'function') {
  throw new Error('Expected function but got ' + typeof result);
}
if (result() !== 42) {
  throw new Error('Expected result() === 42');
}
if (result.g !== result) {
  throw new Error('Expected result.g === result');
}
console.log('SUCCESS');
`,
  );

  // Run the test
  const proc = Bun.spawn({
    cmd: [bunExe(), testFile],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should work correctly
  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("SUCCESS");
});
