import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot as normalizeBunSnapshot_, tempDir } from "harness";
import { join } from "path";
import { TestRegistry } from "registry";

const normalizeBunSnapshot = (str: string) => {
  str = normalizeBunSnapshot_(str);
  str = str.replace(/.*Resolved, downloaded and extracted.*\n?/g, "");
  str = str.replaceAll("fstatat()", "stat()");
  str = str.replace(/ \(v[\d.]+ available\)/g, "");
  return str;
};

// Its `lodash` is a stand-in whose fp.js has one line.
const registry = new TestRegistry();
beforeAll(() => registry.start());
afterAll(() => registry.stop());

const installEnv = (dir: { toString(): string }) => ({
  ...bunEnv,
  NPM_CONFIG_REGISTRY: registry.registryUrl(),
  BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
});

test("patch application should handle out-of-bounds line numbers gracefully", async () => {
  await using dir = tempDir("patch-bounds-test", {
    "package.json": JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
      dependencies: {
        "lodash": "4.17.21",
      },
      patchedDependencies: {
        "lodash@4.17.21": "patches/lodash+4.17.21.patch",
      },
    }),
    "patches/lodash+4.17.21.patch": `--- a/fp.js
+++ b/fp.js
@@ -1000,3 +1000,4 @@
 module.exports = require('./fp/_baseConvert.js')(require('./lodash.js'));
 
 // This line doesn't exist but the patch says it does
+// Add this line way beyond the actual file bounds`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--linker=hoisted"],
    env: installEnv(dir),
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should fail gracefully with proper error message, not crash
  expect(exitCode).toBe(1);
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "Resolving dependencies
    error: failed applying patch file: hunk #1 does not apply to fp.js (expected at line 1000)
    error: failed to apply patchfile (patches/lodash+4.17.21.patch)"
  `);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
});

test("patch application should handle deletion beyond file bounds", async () => {
  await using dir = tempDir("patch-deletion-bounds-test", {
    "package.json": JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
      dependencies: {
        "lodash": "4.17.21",
      },
      patchedDependencies: {
        "lodash@4.17.21": "patches/lodash+4.17.21.patch",
      },
    }),
    "patches/lodash+4.17.21.patch": `--- a/fp.js
+++ b/fp.js
@@ -1,5 +1,3 @@
 module.exports = require('./fp/_baseConvert.js')(require('./lodash.js'));
-line 2
-line 3
-line 4
-line 5`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--linker=hoisted"],
    env: installEnv(dir),
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should fail gracefully, not crash
  expect(exitCode).toBe(1);
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "Resolving dependencies
    error: failed to parse patchfile: hunk_header_integrity_check_failed
    error: failed to apply patchfile (patches/lodash+4.17.21.patch)"
  `);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
});

test("patch application should work correctly with valid patches", async () => {
  await using dir = tempDir("patch-valid-test", {
    "package.json": JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
      dependencies: {
        "lodash": "4.17.21",
      },
      patchedDependencies: {
        "lodash@4.17.21": "patches/lodash+4.17.21.patch",
      },
    }),
    "patches/lodash+4.17.21.patch": `--- a/fp.js
+++ b/fp.js
@@ -1 +1,2 @@
+// Valid patch comment
 module.exports = require('./fp/_baseConvert.js')(require('./lodash.js'));`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--linker=hoisted"],
    env: installEnv(dir),
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Valid patch should succeed
  expect(exitCode).toBe(0);
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "Resolving dependencies
    Saved lockfile"
  `);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

    + lodash@4.17.21

    1 package installed"
  `);

  // Verify the patch was applied
  const patchedFile = await Bun.file(`${dir}/node_modules/lodash/fp.js`).text();
  expect(patchedFile).toBe(
    "// Valid patch comment\nmodule.exports = require('./fp/_baseConvert.js')(require('./lodash.js'));\n",
  );
});
