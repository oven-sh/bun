import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/13531
// When a package (pkgB) depends on a local path dependency (pkgA) that has `patchedDependencies`,
// `bun install` would fail because it looked for patch files relative to the root project (pkgB)
// instead of the dependency that declared them (pkgA).
describe("#13531 - patchedDependencies in folder dependency", () => {
  test("bun install resolves patch paths relative to the folder dependency", async () => {
    // Create a folder structure with:
    // - pkgA: has a patchedDependency with a patch file in patches/
    // - pkgB: depends on pkgA via "../pkgA"
    using dir = tempDir("issue-13531", {
      "pkgA/package.json": JSON.stringify({
        name: "pkgA",
        version: "1.0.0",
        patchedDependencies: {
          "is-number@7.0.0": "patches/is-number@7.0.0.patch",
        },
        dependencies: {
          "is-number": "7.0.0",
        },
      }),
      // Patch that adds 'use strict'; to the beginning of the file
      "pkgA/patches/is-number@7.0.0.patch": `diff --git a/index.js b/index.js
index 27f4794..0000000 100644
--- a/index.js
+++ b/index.js
@@ -1,3 +1,4 @@
+'use strict';
 module.exports = function(num) {
   if (typeof num === 'number') {
     return num - num === 0;
`,
      "pkgB/package.json": JSON.stringify({
        name: "pkgB",
        version: "1.0.0",
        dependencies: {
          pkgA: "../pkgA",
        },
      }),
    });

    const pkgADir = `${dir}/pkgA`;
    const pkgBDir = `${dir}/pkgB`;

    // First, install pkgA (this should work even without the fix)
    await using pkgAInstall = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: pkgADir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [, pkgAStderr, pkgAExitCode] = await Promise.all([
      pkgAInstall.stdout.text(),
      pkgAInstall.stderr.text(),
      pkgAInstall.exited,
    ]);

    expect(pkgAStderr).not.toContain("Couldn't find patch file");
    expect(pkgAExitCode).toBe(0);

    // Now install pkgB - this is where the bug was triggered
    // Before the fix, bun would look for the patch file at:
    //   pkgB/patches/is-number@7.0.0.patch
    // instead of:
    //   pkgA/patches/is-number@7.0.0.patch
    await using pkgBInstall = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: pkgBDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [, pkgBStderr, pkgBExitCode] = await Promise.all([
      pkgBInstall.stdout.text(),
      pkgBInstall.stderr.text(),
      pkgBInstall.exited,
    ]);

    // The main assertion - install should succeed without patch file not found errors
    expect(pkgBStderr).not.toContain("Couldn't find patch file");
    expect(pkgBExitCode).toBe(0);

    // Verify the patch was actually applied by checking for the unique 'use strict';
    // marker that our patch adds at the beginning of the file.
    // The original is-number package does NOT start with 'use strict';
    const isNumberPath = `${pkgBDir}/node_modules/is-number/index.js`;
    const isNumberContent = await Bun.file(isNumberPath).text();
    // The patch adds 'use strict'; as the first line - this is unique to our patch
    expect(isNumberContent.startsWith("'use strict';")).toBe(true);
  });
});
