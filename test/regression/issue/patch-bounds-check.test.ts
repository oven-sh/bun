import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("patch application should handle out-of-bounds line numbers gracefully", async () => {
  const dir = tempDirWithFiles("patch-bounds-test", {
    "package.json": JSON.stringify({
      name: "test-pkg", 
      version: "1.0.0",
      dependencies: {
        "lodash": "4.17.21"
      },
      patchedDependencies: {
        "lodash@4.17.21": "patches/lodash+4.17.21.patch"
      }
    }),
    "patches/lodash+4.17.21.patch": `--- a/index.js
+++ b/index.js
@@ -1000,3 +1000,4 @@
 module.exports = require('./lodash');
 
 // This line doesn't exist but the patch says it does
+// Add this line way beyond the actual file bounds`
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(), 
    proc.exited,
  ]);

  // Should fail gracefully with proper error message, not crash
  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("failed applying patch file");
  
  // Should not crash with panic or segfault
  expect(stderr).not.toContain("panic:");
  expect(stderr).not.toContain("Segmentation fault");
  expect(stderr).not.toContain("Trace/breakpoint trap");
});

test("patch application should handle deletion beyond file bounds", async () => {
  const dir = tempDirWithFiles("patch-deletion-bounds-test", {
    "package.json": JSON.stringify({
      name: "test-pkg",
      version: "1.0.0", 
      dependencies: {
        "lodash": "4.17.21"
      },
      patchedDependencies: {
        "lodash@4.17.21": "patches/lodash+4.17.21.patch"
      }
    }),
    "patches/lodash+4.17.21.patch": `--- a/index.js
+++ b/index.js
@@ -1,5 +1,3 @@
 module.exports = require('./lodash');
-line 2
-line 3
-line 4
-line 5`
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should fail gracefully, not crash
  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("failed applying patch file");
  expect(stderr).not.toContain("panic:");
  expect(stderr).not.toContain("Segmentation fault");
});

test("patch application should work correctly with valid patches", async () => {
  const dir = tempDirWithFiles("patch-valid-test", {
    "package.json": JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
      dependencies: {
        "lodash": "4.17.21"
      },
      patchedDependencies: {
        "lodash@4.17.21": "patches/lodash+4.17.21.patch"
      }
    }),
    "patches/lodash+4.17.21.patch": `--- a/index.js
+++ b/index.js
@@ -1 +1,2 @@
+// Valid patch comment
 module.exports = require('./lodash');`
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Valid patch should succeed
  expect(exitCode).toBe(0);
  expect(stderr).not.toContain("failed applying patch file");

  // Verify the patch was applied
  const patchedFile = await Bun.file(`${dir}/node_modules/lodash/index.js`).text();
  expect(patchedFile).toContain("// Valid patch comment");
  expect(patchedFile).toContain("module.exports = require('./lodash');");
});