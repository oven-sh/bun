import { $ } from "bun";
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout, test } from "bun:test";
import { rmSync } from "fs";
import {
  bunEnv,
  bunExe,
  isWindows,
  normalizeBunSnapshot as normalizeBunSnapshot_,
  runBunInstall,
  tempDir,
  type DirectoryTree,
} from "harness";
import { join } from "path";
import { TestRegistry } from "registry";
import { pathToFileURL } from "url";

const normalizeBunSnapshot = (str: string) => {
  str = normalizeBunSnapshot_(str);
  str = str.replace(/.*Resolved, downloaded and extracted.*\n?/g, "");
  str = str.replaceAll("fstatat()", "stat()");
  return str;
};

setDefaultTimeout(1000 * 60 * 5);

describe("patch", async () => {
  const is_even_patch = /* patch */ `diff --git a/index.js b/index.js
index 832d92223a9ec491364ee10dcbe3ad495446ab80..bc652e496c165a7415880ef4520c0ab302bf0765 100644
--- a/index.js
+++ b/index.js
@@ -10,5 +10,6 @@
  var isOdd = require('is-odd');

  module.exports = function isEven(i) {
+  console.log("HI");
    return !isOdd(i);
  };
`;
  const is_even_patch2 = /* patch */ `diff --git a/index.js b/index.js
index 832d92223a9ec491364ee10dcbe3ad495446ab80..217353bf51861fe4fdba68cb98bc5f361c7730e1 100644
--- a/index.js
+++ b/index.js
@@ -5,10 +5,11 @@
  * Released under the MIT License.
  */

-'use strict';
+"use strict";

-var isOdd = require('is-odd');
+var isOdd = require("is-odd");

  module.exports = function isEven(i) {
+  console.log("lmao");
    return !isOdd(i);
  };
`;

  const is_odd_patch = /* patch */ `diff --git a/index.js b/index.js
index c8950c17b265104bcf27f8c345df1a1b13a78950..084439e9692a1e94a759d1a34a47282a1d145a30 100644
--- a/index.js
+++ b/index.js
@@ -5,16 +5,17 @@
  * Released under the MIT License.
  */

-'use strict';
+"use strict";

-var isNumber = require('is-number');
+var isNumber = require("is-number");

 module.exports = function isOdd(i) {
+  console.log("Hi from isOdd!");
   if (!isNumber(i)) {
-    throw new TypeError('is-odd expects a number.');
+    throw new TypeError("is-odd expects a number.");
   }
   if (Number(i) !== Math.floor(i)) {
-    throw new RangeError('is-odd expects an integer.');
+    throw new RangeError("is-odd expects an integer.");
   }
   return !!(~~i & 1);
 };
`;

  const is_odd_patch2 = /* patch */ `diff --git a/index.js b/index.js
index c8950c17b265104bcf27f8c345df1a1b13a78950..7ce57ab96400ab0ff4fac7e06f6e02c2a5825852 100644
--- a/index.js
+++ b/index.js
@@ -5,16 +5,17 @@
  * Released under the MIT License.
  */

-'use strict';
+"use strict";

-var isNumber = require('is-number');
+var isNumber = require("is-number");

 module.exports = function isOdd(i) {
+  console.log("lmao");
   if (!isNumber(i)) {
-    throw new TypeError('is-odd expects a number.');
+    throw new TypeError("is-odd expects a number.");
   }
   if (Number(i) !== Math.floor(i)) {
-    throw new RangeError('is-odd expects an integer.');
+    throw new RangeError("is-odd expects an integer.");
   }
   return !!(~~i & 1);
 };
`;

  const filepathEscape: (x: string) => string =
    process.platform === "win32"
      ? (s: string) => {
          const charsToEscape = new Set(["/", ":"]);
          return s
            .split("")
            .map(c => (charsToEscape.has(c) ? "_" : c))
            .join("");
        }
      : (x: string) => x;

  const versions: [version: string, patchVersion?: string][] = [["1.0.0"]];

  describe("should patch a dependency when its dependencies are not hoisted", async () => {
    // is-even depends on is-odd ^0.1.2 and we add is-odd 3.0.1, which should be hoisted
    for (const [version, patchVersion_] of versions) {
      const patchFilename = filepathEscape(`is-even@${version}.patch`);
      const patchVersion = patchVersion_ ?? version;
      test(version, async () => {
        await using filedir = tempDir("patch1", {
          "package.json": JSON.stringify({
            "name": "bun-patch-test",
            "module": "index.ts",
            "type": "module",
            "patchedDependencies": {
              [`is-even@${patchVersion}`]: `patches/${patchFilename}`,
            },
            "dependencies": {
              "is-even": version,
              "is-odd": "3.0.1",
            },
          }),
          patches: {
            [patchFilename]: is_even_patch,
          },
          "index.ts": /* ts */ `import isEven from 'is-even'; isEven(2); console.log('lol')`,
        });
        console.log("TEMP:", filedir);
        await $`${bunExe()} i`.env(bunEnv).cwd(filedir);
        const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(filedir);
        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toContain("HI\n");
      });
    }
  });

  test("should patch a non-hoisted dependency", async () => {
    await using filedir = tempDir("patch1", {
      "package.json": JSON.stringify({
        "name": "bun-patch-test",
        "module": "index.ts",
        "type": "module",
        "patchedDependencies": {
          [`is-odd@0.1.2`]: `patches/is-odd@0.1.2.patch`,
        },
        "dependencies": {
          "is-even": "1.0.0",
          "is-odd": "3.0.1",
        },
      }),
      patches: {
        "is-odd@0.1.2.patch": is_odd_patch,
      },
      "index.ts": /* ts */ `import isEven from 'is-even'; isEven(2); console.log('lol')`,
    });
    console.log("TEMP:", filedir);
    await $`${bunExe()} i`.env(bunEnv).cwd(filedir);
    const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(filedir);
    expect(stderr.toString()).toBe("");
    expect(stdout.toString()).toContain("Hi from isOdd!\n");
  });

  describe("should patch a dependency", async () => {
    for (const [version, patchVersion_] of versions) {
      const patchFilename = filepathEscape(`is-even@${version}.patch`);
      const patchVersion = patchVersion_ ?? version;
      test(version, async () => {
        await using filedir = tempDir("patch1", {
          "package.json": JSON.stringify({
            "name": "bun-patch-test",
            "module": "index.ts",
            "type": "module",
            "patchedDependencies": {
              [`is-even@${patchVersion}`]: `patches/${patchFilename}`,
            },
            "dependencies": {
              "is-even": version,
            },
          }),
          patches: {
            [patchFilename]: is_even_patch,
          },
          "index.ts": /* ts */ `import isEven from 'is-even'; isEven(2); console.log('lol')`,
        });
        console.log("TEMP:", filedir);
        await $`${bunExe()} i`.env(bunEnv).cwd(filedir);
        const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(filedir);
        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toContain("HI\n");
      });
    }
  });

  test("should patch a transitive dependency", async () => {
    const version = "0.1.2";
    const patchFilename = filepathEscape(`is-odd@${version}.patch`);
    await using filedir = tempDir("patch1", {
      "package.json": JSON.stringify({
        "name": "bun-patch-test",
        "module": "index.ts",
        "type": "module",
        "patchedDependencies": {
          [`is-odd@${version}`]: `patches/${patchFilename}`,
        },
        "dependencies": {
          "is-even": "1.0.0",
        },
      }),
      patches: {
        [patchFilename]: is_odd_patch,
      },
      "index.ts": /* ts */ `import isEven from 'is-even'; isEven(2); console.log('lol')`,
    });

    await $`${bunExe()} i`.env(bunEnv).cwd(filedir);
    const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(filedir);
    expect(stderr.toString()).toBe("");
    expect(stdout.toString()).toContain("Hi from isOdd!\n");
  });

  describe("should patch a dependency after it was already installed", async () => {
    for (const [version, patchVersion_] of versions) {
      const patchfileName = filepathEscape(`is-even@${version}.patch`);
      const patchVersion = patchVersion_ ?? version;
      test(version, async () => {
        await using filedir = tempDir("patch1", {
          "package.json": JSON.stringify({
            "name": "bun-patch-test",
            "module": "index.ts",
            "type": "module",
            "dependencies": {
              "is-even": version,
            },
          }),
          patches: {
            [patchfileName]: is_even_patch,
          },
          "index.ts": /* ts */ `import isEven from 'is-even'; isEven(2); console.log('lol')`,
        });

        console.log("File", filedir);

        await $`${bunExe()} i`.env(bunEnv).cwd(filedir);

        await $`echo ${JSON.stringify({
          "name": "bun-patch-test",
          "module": "index.ts",
          "type": "module",
          "patchedDependencies": {
            [`is-even@${patchVersion}`]: `patches/${patchfileName}`,
          },
          "dependencies": {
            "is-even": version,
          },
        })} > package.json`
          .env(bunEnv)
          .cwd(filedir);

        await $`${bunExe()} i`.env(bunEnv).cwd(filedir);

        const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(filedir);
        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toContain("HI\n");
      });
    }
  });

  it("should patch a transitive dependency after it was already installed", async () => {
    await using filedir = tempDir("patch1", {
      "package.json": JSON.stringify({
        "name": "bun-patch-test",
        "module": "index.ts",
        "type": "module",
        "dependencies": {
          "is-even": "1.0.0",
        },
      }),
      patches: {
        "is-odd@0.1.2.patch": is_odd_patch,
      },
      "index.ts": /* ts */ `import isEven from 'is-even'; isEven(2); console.log('lol')`,
    });

    console.log("File", filedir);

    await $`${bunExe()} i`.env(bunEnv).cwd(filedir);

    await $`echo ${JSON.stringify({
      "name": "bun-patch-test",
      "module": "index.ts",
      "type": "module",
      "patchedDependencies": {
        "is-odd@0.1.2": "patches/is-odd@0.1.2.patch",
      },
      "dependencies": {
        "is-even": "1.0.0",
      },
    })} > package.json`
      .env(bunEnv)
      .cwd(filedir);

    await $`${bunExe()} i`.env(bunEnv).cwd(filedir);

    const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(filedir);
    expect(stderr.toString()).toBe("");
    expect(stdout.toString()).toContain("Hi from isOdd!\n");
  });

  describe("should update a dependency when the patchfile changes", async () => {
    $.throws(true);
    for (const [version, patchVersion_] of versions) {
      const patchFilename = filepathEscape(`is-even@${version}.patch`);
      const patchVersion = patchVersion_ ?? version;
      test(version, async () => {
        await using filedir = tempDir("patch1", {
          "package.json": JSON.stringify({
            "name": "bun-patch-test",
            "module": "index.ts",
            "type": "module",
            "patchedDependencies": {
              [`is-even@${patchVersion}`]: `patches/${patchFilename}`,
            },
            "dependencies": {
              "is-even": version,
            },
          }),
          patches: {
            [patchFilename]: is_even_patch2,
          },
          "index.ts": /* ts */ `import isEven from 'is-even'; isEven(2); console.log('lol')`,
        });

        await $`${bunExe()} i`.env(bunEnv).cwd(filedir);

        await $`echo ${is_even_patch2} > patches/is-even@${version}.patch; ${bunExe()} i`.env(bunEnv).cwd(filedir);

        const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(filedir);
        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toContain("lmao\n");
      });
    }
  });

  describe("should work when patches are removed", async () => {
    for (const [version, patchVersion_] of versions) {
      const patchFilename = filepathEscape(`is-even@${version}.patch`);
      const patchVersion = patchVersion_ ?? version;
      test(version, async () => {
        await using filedir = tempDir("patch1", {
          "package.json": JSON.stringify({
            "name": "bun-patch-test",
            "module": "index.ts",
            "type": "module",
            "patchedDependencies": {
              [`is-even@${patchVersion}`]: `patches/${patchFilename}`,
            },
            "dependencies": {
              "is-even": version,
            },
          }),
          patches: {
            [patchFilename]: is_even_patch2,
          },
          "index.ts": /* ts */ `import isEven from 'is-even'; isEven(2); console.log('lol')`,
        });

        console.log("FILEDIR", filedir);

        await $`${bunExe()} i`.env(bunEnv).cwd(filedir);

        await $`echo ${JSON.stringify({
          "name": "bun-patch-test",
          "module": "index.ts",
          "type": "module",
          "patchedDependencies": {
            [`is-odd@0.1.2`]: `patches/is-odd@0.1.2.patch`,
          },
          "dependencies": {
            "is-even": version,
          },
        })} > package.json`
          .env(bunEnv)
          .cwd(filedir);

        await $`echo ${is_odd_patch} > patches/is-odd@0.1.2.patch; ${bunExe()} i`.env(bunEnv).cwd(filedir);

        const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(filedir);
        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toContain("Hi from isOdd!\n");
        expect(stdout.toString()).not.toContain("lmao\n");
      });
    }
  });

  it("should update a transitive dependency when the patchfile changes", async () => {
    $.throws(true);
    await using filedir = tempDir("patch1", {
      "package.json": JSON.stringify({
        "name": "bun-patch-test",
        "module": "index.ts",
        "type": "module",
        "patchedDependencies": {
          "is-odd@0.1.2": "patches/is-odd@0.1.2.patch",
        },
        "dependencies": {
          "is-even": "1.0.0",
        },
      }),
      patches: {
        ["is-odd@0.1.2.patch"]: is_odd_patch2,
      },
      "index.ts": /* ts */ `import isEven from 'is-even'; isEven(2); console.log('lol')`,
    });

    await $`${bunExe()} i`.env(bunEnv).cwd(filedir);

    await $`echo ${is_odd_patch2} > patches/is-odd@0.1.2.patch; ${bunExe()} i`.env(bunEnv).cwd(filedir);

    const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(filedir);
    expect(stderr.toString()).toBe("");
    expect(stdout.toString()).toContain("lmao\n");
  });

  it("should update a scoped package", async () => {
    const patchfile = /* patch */ `diff --git a/private/var/folders/wy/3969rv2x63g63jf8jwlcb2x40000gn/T/.b7f7d77b9ffdd3ee-00000000.tmp/index.js b/index.js
new file mode 100644
index 0000000000000000000000000000000000000000..6edc0598a84632c41d9c770cfbbad7d99e2ab624
--- /dev/null
+++ b/index.js
@@ -0,0 +1,4 @@
+
+module.exports = () => {
+    return 'PATCHED!'
+}
diff --git a/package.json b/package.json
index aa7c7012cda790676032d1b01d78c0b69ec06360..6048e7cb462b3f9f6ac4dc21aacf9a09397cd4be 100644
--- a/package.json
+++ b/package.json
@@ -2,7 +2,7 @@
    "name": "@zackradisic/hls-dl",
    "version": "0.0.1",
    "description": "",
-  "main": "dist/hls-dl.commonjs2.js",
+  "main": "./index.js",
    "dependencies": {
      "m3u8-parser": "^4.5.0",
      "typescript": "^4.0.5"
`;

    $.throws(true);
    await using filedir = tempDir("patch1", {
      "package.json": JSON.stringify({
        "name": "bun-patch-test",
        "module": "index.ts",
        "type": "module",
        "patchedDependencies": {
          "@zackradisic/hls-dl@0.0.1": "patches/thepatch.patch",
        },
        "dependencies": {
          "@zackradisic/hls-dl": "0.0.1",
        },
      }),
      patches: {
        ["thepatch.patch"]: patchfile,
      },
      "index.ts": /* ts */ `import hlsDl from '@zackradisic/hls-dl'; console.log(hlsDl())`,
    });

    await $`${bunExe()} i`.env(bunEnv).cwd(filedir);

    const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(filedir);
    expect(stderr.toString()).toBe("");
    expect(stdout.toString()).toContain("PATCHED!\n");
  });

  it("shouldn't infinite loop on failure to apply patch", async () => {
    const badPatch = /* patch */ `diff --git a/index.js b/node_modules/is-even/index.js
index 832d92223a9ec491364ee10dcbe3ad495446ab80..7e079a817825de4b8c3d01898490dc7e960172bb 100644
--- a/index.js
+++ b/node_modules/is-even/index.js
@@ -10,5 +10,6 @@
  var isOdd = require('is-odd');

  module.exports = function isEven(i) {
+  console.log('hi')
    return !isOdd(i);
  };
`;

    await using filedir = tempDir("patch1", {
      "package.json": JSON.stringify({
        "name": "bun-patch-test",
        "module": "index.ts",
        "type": "module",
        "dependencies": {
          "is-even": "1.0.0",
        },
      }),
      patches: {
        "is-even@1.0.0.patch": badPatch,
      },
      "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven())`,
    });
    console.log(filedir);
    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--linker=hoisted"],
        env: bunEnv,
        cwd: filedir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(exitCode).toBe(0);
      expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`"Saved lockfile"`);
      expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
        "bun install <version> (<revision>)

        + is-even@1.0.0

        5 packages installed"
      `);
    }
    {
      const pkgjsonWithPatch = {
        "name": "bun-patch-test",
        "module": "index.ts",
        "type": "module",
        "patchedDependencies": {
          "is-even@1.0.0": "patches/is-even@1.0.0.patch",
        },
        "dependencies": {
          "is-even": "1.0.0",
        },
      };

      await Bun.write(join(filedir, "package.json"), JSON.stringify(pkgjsonWithPatch));
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--linker=hoisted"],
        env: bunEnv,
        cwd: filedir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(1);
      expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
        "Resolving dependencies
        error: failed applying patch file: ENOENT: No such file or directory (stat())
        error: failed to apply patchfile (patches/is-even@1.0.0.patch)"
      `);
      expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
    }
  });

  describe("bun patch with --linker=isolated", () => {
    const patchEnv = bunEnv;

    test("should create patch for package and commit it", async () => {
      await using filedir = tempDir("patch-isolated", {
        "package.json": JSON.stringify({
          "name": "bun-patch-isolated-test",
          "module": "index.ts",
          "type": "module",
          "dependencies": {
            "is-even": "1.0.0",
          },
        }),
        "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(2));`,
      });

      // Install with isolated linker
      await $`${bunExe()} install --linker=isolated`.env(patchEnv).cwd(filedir);

      // Run bun patch command
      const { stdout: patchStdout } = await $`${bunExe()} patch is-even`.env(patchEnv).cwd(filedir);
      const patchOutput = patchStdout.toString();
      const relativePatchPath =
        patchOutput.match(/To patch .+, edit the following folder:\s*\n\s*(.+)/)?.[1]?.trim() ||
        patchOutput.match(/edit the following folder:\s*\n\s*(.+)/)?.[1]?.trim();
      expect(relativePatchPath).toBeTruthy();
      const patchPath = join(filedir, relativePatchPath!);

      // Edit the patched package
      const indexPath = join(patchPath, "index.js");
      const originalContent = await Bun.file(indexPath).text();
      const modifiedContent = originalContent.replace(
        "module.exports = function isEven(i) {",
        'module.exports = function isEven(i) {\n  console.log("PATCHED with isolated linker!");',
      );
      await Bun.write(indexPath, modifiedContent);

      // Commit the patch
      const { stderr: commitStderr } = await $`${bunExe()} patch --commit '${relativePatchPath}'`
        .env(patchEnv)
        .cwd(filedir);

      // With isolated linker, there may be some stderr output during patch commit
      // but it should not contain actual errors
      const commitStderrText = commitStderr.toString();
      expect(commitStderrText).not.toContain("error:");
      expect(commitStderrText).not.toContain("panic:");

      // Verify patch file was created
      const patchFile = join(filedir, "patches", "is-even@1.0.0.patch");
      expect(await Bun.file(patchFile).exists()).toBe(true);

      // Verify package.json was updated
      const pkgJson = await Bun.file(join(filedir, "package.json")).json();
      expect(pkgJson.patchedDependencies).toEqual({
        "is-even@1.0.0": "patches/is-even@1.0.0.patch",
      });

      // Run the code to verify patch was applied
      const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(patchEnv).cwd(filedir);
      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toContain("PATCHED with isolated linker!");
    });

    test("should patch transitive dependency with isolated linker", async () => {
      await using filedir = tempDir("patch-isolated-transitive", {
        "package.json": JSON.stringify({
          "name": "bun-patch-isolated-transitive-test",
          "module": "index.ts",
          "type": "module",
          "dependencies": {
            "is-even": "1.0.0",
          },
        }),
        "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(3));`,
      });

      // Install with isolated linker
      await $`${bunExe()} install --linker=isolated`.env(patchEnv).cwd(filedir);

      await $`${bunExe()} patch is-odd`.env(patchEnv).cwd(filedir);

      // Patch transitive dependency (is-odd)
      const { stdout: patchStdout } = await $`${bunExe()} patch is-odd@0.1.2`.env(patchEnv).cwd(filedir);
      const patchOutput = patchStdout.toString();
      const relativePatchPath =
        patchOutput.match(/To patch .+, edit the following folder:\s*\n\s*(.+)/)?.[1]?.trim() ||
        patchOutput.match(/edit the following folder:\s*\n\s*(.+)/)?.[1]?.trim();
      expect(relativePatchPath).toBeTruthy();
      const patchPath = join(filedir, relativePatchPath!);

      // Edit the patched package
      const indexPath = join(patchPath, "index.js");
      const originalContent = await Bun.file(indexPath).text();
      const modifiedContent = originalContent.replace(
        "module.exports = function isOdd(i) {",
        'module.exports = function isOdd(i) {\n  console.log("Transitive patch with isolated!");',
      );
      await Bun.write(indexPath, modifiedContent);

      // Commit the patch
      const { stderr: commitStderr } = await $`${bunExe()} patch --commit '${relativePatchPath}'`
        .env(patchEnv)
        .cwd(filedir);

      await $`${bunExe()} i --linker isolated`.env(patchEnv).cwd(filedir);

      // With isolated linker, there may be some stderr output during patch commit
      // but it should not contain actual errors
      const commitStderrText = commitStderr.toString();
      expect(commitStderrText).not.toContain("error:");
      expect(commitStderrText).not.toContain("panic:");

      // Verify patch was applied
      const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(patchEnv).cwd(filedir);
      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toContain("Transitive patch with isolated!");
    });

    test("should handle scoped packages with isolated linker", async () => {
      await using filedir = tempDir("patch-isolated-scoped", {
        "package.json": JSON.stringify({
          "name": "bun-patch-isolated-scoped-test",
          "module": "index.ts",
          "type": "module",
          "dependencies": {
            "@zackradisic/hls-dl": "0.0.1",
          },
        }),
        "index.ts": /* ts */ `import hlsDl from '@zackradisic/hls-dl'; console.log("Testing scoped package");`,
      });

      // Install with isolated linker
      await $`${bunExe()} install --linker=isolated`.env(patchEnv).cwd(filedir);

      // Patch scoped package
      const { stdout: patchStdout } = await $`${bunExe()} patch @zackradisic/hls-dl`.env(patchEnv).cwd(filedir);
      const patchOutput = patchStdout.toString();
      const relativePatchPath =
        patchOutput.match(/To patch .+, edit the following folder:\s*\n\s*(.+)/)?.[1]?.trim() ||
        patchOutput.match(/edit the following folder:\s*\n\s*(.+)/)?.[1]?.trim();
      expect(relativePatchPath).toBeTruthy();
      const patchPath = join(filedir, relativePatchPath!);

      // Create a new index.js in the patched package
      const indexPath = join(patchPath, "index.js");
      await Bun.write(indexPath, `module.exports = () => 'SCOPED PACKAGE PATCHED with isolated!';`);

      // Update package.json to point to the new index.js
      const pkgJsonPath = join(patchPath, "package.json");
      const pkgJson = await Bun.file(pkgJsonPath).json();
      pkgJson.main = "./index.js";
      await Bun.write(pkgJsonPath, JSON.stringify(pkgJson, null, 2));

      // Commit the patch
      const { stderr: commitStderr } = await $`${bunExe()} patch --commit '${relativePatchPath}'`
        .env(patchEnv)
        .cwd(filedir);

      // With isolated linker, there may be some stderr output during patch commit
      // but it should not contain actual errors
      const commitStderrText = commitStderr.toString();
      expect(commitStderrText).not.toContain("error:");
      expect(commitStderrText).not.toContain("panic:");

      // Update index.ts to actually use the patched module
      await Bun.write(
        join(filedir, "index.ts"),
        /* ts */ `import hlsDl from '@zackradisic/hls-dl'; console.log(hlsDl());`,
      );

      // Verify patch was applied
      const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(patchEnv).cwd(filedir);
      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toContain("SCOPED PACKAGE PATCHED with isolated!");
    });

    test("should work with workspaces and isolated linker", async () => {
      await using filedir = tempDir("patch-isolated-workspace", {
        "package.json": JSON.stringify({
          "name": "workspace-root",
          "workspaces": ["packages/*"],
        }),
        packages: {
          app: {
            "package.json": JSON.stringify({
              "name": "app",
              "dependencies": {
                "is-even": "1.0.0",
              },
            }),
            "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(4));`,
          },
        },
      });

      // Install with isolated linker
      await $`${bunExe()} install --linker=isolated`.env(patchEnv).cwd(filedir);

      // Patch from workspace root
      const { stdout: patchStdout } = await $`${bunExe()} patch is-even`.env(patchEnv).cwd(filedir);
      const patchOutput = patchStdout.toString();
      const relativePatchPath =
        patchOutput.match(/To patch .+, edit the following folder:\s*\n\s*(.+)/)?.[1]?.trim() ||
        patchOutput.match(/edit the following folder:\s*\n\s*(.+)/)?.[1]?.trim();
      expect(relativePatchPath).toBeTruthy();
      const patchPath = join(filedir, relativePatchPath!);

      // Edit the patched package
      const indexPath = join(patchPath, "index.js");
      const originalContent = await Bun.file(indexPath).text();
      const modifiedContent = originalContent.replace(
        "module.exports = function isEven(i) {",
        'module.exports = function isEven(i) {\n  console.log("WORKSPACE PATCH with isolated!");',
      );
      await Bun.write(indexPath, modifiedContent);

      // Commit the patch
      const { stderr: commitStderr } = await $`${bunExe()} patch --commit '${relativePatchPath}'`
        .env(patchEnv)
        .cwd(filedir);

      // With isolated linker, there may be some stderr output during patch commit
      // but it should not contain actual errors
      const commitStderrText = commitStderr.toString();
      expect(commitStderrText).not.toContain("error:");
      expect(commitStderrText).not.toContain("panic:");

      // Verify root package.json was updated
      const rootPkgJson = await Bun.file(join(filedir, "package.json")).json();
      expect(rootPkgJson.patchedDependencies).toEqual({
        "is-even@1.0.0": "patches/is-even@1.0.0.patch",
      });

      // Run from workspace package to verify patch was applied
      const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(patchEnv).cwd(join(filedir, "packages", "app"));
      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toContain("WORKSPACE PATCH with isolated!");
    });

    test("should preserve patch after reinstall with isolated linker", async () => {
      await using filedir = tempDir("patch-isolated-reinstall", {
        "package.json": JSON.stringify({
          "name": "bun-patch-isolated-reinstall-test",
          "module": "index.ts",
          "type": "module",
          "dependencies": {
            "is-even": "1.0.0",
          },
        }),
        "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(6));`,
      });

      // Install with isolated linker
      await $`${bunExe()} install --linker=isolated`.env(patchEnv).cwd(filedir);

      // Create and commit a patch
      const { stdout: patchStdout } = await $`${bunExe()} patch is-even`.env(patchEnv).cwd(filedir);
      const patchOutput = patchStdout.toString();
      const relativePatchPath =
        patchOutput.match(/To patch .+, edit the following folder:\s*\n\s*(.+)/)?.[1]?.trim() ||
        patchOutput.match(/edit the following folder:\s*\n\s*(.+)/)?.[1]?.trim();
      expect(relativePatchPath).toBeTruthy();
      const patchPath = join(filedir, relativePatchPath!);

      const indexPath = join(patchPath, "index.js");
      const originalContent = await Bun.file(indexPath).text();
      const modifiedContent = originalContent.replace(
        "module.exports = function isEven(i) {",
        'module.exports = function isEven(i) {\n  console.log("REINSTALL TEST with isolated!");',
      );
      await Bun.write(indexPath, modifiedContent);

      await $`${bunExe()} patch --commit '${relativePatchPath}'`.env(patchEnv).cwd(filedir);

      // Delete node_modules and reinstall with isolated linker
      rmSync(join(filedir, "node_modules"), { force: true, recursive: true });
      await $`${bunExe()} install --linker=isolated`.env(patchEnv).cwd(filedir);

      // Verify patch is still applied
      const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(patchEnv).cwd(filedir);
      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toContain("REINSTALL TEST with isolated!");
    });

    test("should handle multiple patches with isolated linker", async () => {
      await using filedir = tempDir("patch-isolated-multiple", {
        "package.json": JSON.stringify({
          "name": "bun-patch-isolated-multiple-test",
          "module": "index.ts",
          "type": "module",
          "dependencies": {
            "is-even": "1.0.0",
            "is-odd": "3.0.1",
          },
        }),
        "index.ts": /* ts */ `
          import isEven from 'is-even';
          import isOdd from 'is-odd';
          console.log(isEven(8));
          console.log(isOdd(9));
        `,
      });

      // Install with isolated linker
      await $`${bunExe()} install --linker=isolated`.env(patchEnv).cwd(filedir);

      // Patch first package (is-even)
      const { stdout: patchStdout1 } = await $`${bunExe()} patch is-even`.env(patchEnv).cwd(filedir);
      const patchOutput1 = patchStdout1.toString();
      const relativePatchPath1 =
        patchOutput1.match(/To patch .+, edit the following folder:\s*\n\s*(.+)/)?.[1]?.trim() ||
        patchOutput1.match(/edit the following folder:\s*\n\s*(.+)/)?.[1]?.trim();
      expect(relativePatchPath1).toBeTruthy();
      const patchPath1 = join(filedir, relativePatchPath1!);

      const indexPath1 = join(patchPath1, "index.js");
      const originalContent1 = await Bun.file(indexPath1).text();
      const modifiedContent1 = originalContent1.replace(
        "module.exports = function isEven(i) {",
        'module.exports = function isEven(i) {\n  console.log("is-even PATCHED with isolated!");',
      );
      await Bun.write(indexPath1, modifiedContent1);

      const { stderr: commitStderr1 } = await $`${bunExe()} patch --commit '${relativePatchPath1}'`
        .env(patchEnv)
        .cwd(filedir);
      // Check for errors
      const commitStderrText1 = commitStderr1.toString();
      expect(commitStderrText1).not.toContain("error:");
      expect(commitStderrText1).not.toContain("panic:");

      // Patch second package (is-odd hoisted version)
      const { stdout: patchStdout2 } = await $`${bunExe()} patch is-odd@3.0.1`.env(patchEnv).cwd(filedir);
      const patchOutput2 = patchStdout2.toString();
      const relativePatchPath2 =
        patchOutput2.match(/To patch .+, edit the following folder:\s*\n\s*(.+)/)?.[1]?.trim() ||
        patchOutput2.match(/edit the following folder:\s*\n\s*(.+)/)?.[1]?.trim();
      expect(relativePatchPath2).toBeTruthy();
      const patchPath2 = join(filedir, relativePatchPath2!);

      const indexPath2 = join(patchPath2, "index.js");
      const originalContent2 = await Bun.file(indexPath2).text();
      const modifiedContent2 = originalContent2.replace(
        "module.exports = function isOdd(value) {",
        'module.exports = function isOdd(value) {\n  console.log("is-odd PATCHED with isolated!");',
      );
      await Bun.write(indexPath2, modifiedContent2);

      const { stderr: commitStderr2 } = await $`${bunExe()} patch --commit '${relativePatchPath2}'`
        .env(patchEnv)
        .cwd(filedir);
      // Check for errors
      const commitStderrText2 = commitStderr2.toString();
      expect(commitStderrText2).not.toContain("error:");
      expect(commitStderrText2).not.toContain("panic:");

      // Verify both patches were applied
      const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(patchEnv).cwd(filedir);
      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toContain("is-even PATCHED with isolated!");
      expect(stdout.toString()).toContain("is-odd PATCHED with isolated!");

      // Verify package.json has both patches
      const pkgJson = await Bun.file(join(filedir, "package.json")).json();
      expect(pkgJson.patchedDependencies).toEqual({
        "is-even@1.0.0": "patches/is-even@1.0.0.patch",
        "is-odd@3.0.1": "patches/is-odd@3.0.1.patch",
      });
    });
  });
});

describe("removing a patched dependency", () => {
  // A patch that only adds a new file applies cleanly to any package contents.
  const isOddNewFilePatch = `diff --git a/bun-patch-test.txt b/bun-patch-test.txt
new file mode 100644
index 0000000000000000000000000000000000000000..2f9a147b6e5d17254f1bfce0d4e109a24a42dcab
--- /dev/null
+++ b/bun-patch-test.txt
@@ -0,0 +1 @@
+patched
`;

  test("install with an empty cache downloads the package unpatched", async () => {
    await using filedir = tempDir("patch-remove", {
      "package.json": JSON.stringify({
        name: "remove-patch-test",
        dependencies: {
          "is-odd": "3.0.1",
        },
        patchedDependencies: {
          "is-odd@3.0.1": "patches/is-odd@3.0.1.patch",
        },
      }),
      patches: {
        "is-odd@3.0.1.patch": isOddNewFilePatch,
      },
    });

    // First install: bun.lock records the patched dependency and the patch is applied.
    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: filedir,
        env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(filedir, "cache-with-patch") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    }
    expect(await Bun.file(join(filedir, "node_modules", "is-odd", "bun-patch-test.txt")).exists()).toBe(true);
    expect(await Bun.file(join(filedir, "bun.lock")).text()).toContain("patchedDependencies");

    // Remove the patch from package.json (bun.lock still references it) and
    // install again with an empty cache so the package has to be downloaded.
    await Bun.write(
      join(filedir, "package.json"),
      JSON.stringify({
        name: "remove-patch-test",
        dependencies: {
          "is-odd": "3.0.1",
        },
      }),
    );

    // This used to panic with `called Option::unwrap() on a None value` while
    // creating the download task: the patch entry had already been moved out of
    // `lockfile.patched_dependencies` into the to-remove list.
    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: filedir,
        env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(filedir, "cache-empty") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    }

    // The package is reinstalled without the patch.
    expect(await Bun.file(join(filedir, "node_modules", "is-odd", "package.json")).json()).toMatchObject({
      name: "is-odd",
      version: "3.0.1",
    });
    expect(await Bun.file(join(filedir, "node_modules", "is-odd", "bun-patch-test.txt")).exists()).toBe(false);
    expect(await Bun.file(join(filedir, "bun.lock")).text()).not.toContain("patchedDependencies");
  });
});

describe("patchedDependencies contents_hash", () => {
  // A patch that creates node_modules/is-odd/m.js; `hunk` is the @@ line.
  const patchHeader = (hunk: string) =>
    "diff --git a/m.js b/m.js\n" +
    "new file mode 100644\n" +
    "index 0000000..1111111\n" +
    "--- /dev/null\n" +
    "+++ b/m.js\n" +
    `${hunk}\n`;

  const mkProject = (name: string, patch: string) =>
    tempDir(`patch-hash-${name}`, {
      "package.json": JSON.stringify({
        name,
        patchedDependencies: { "is-odd@3.0.1": "patches/p.patch" },
        dependencies: { "is-odd": "3.0.1" },
      }),
      patches: { "p.patch": patch },
    });

  const install = async (cwd: string, cacheDir: string) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd,
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: cacheDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
  };

  const installedMjs = (dir: string) => Bun.file(join(dir, "node_modules", "is-odd", "m.js")).text();

  test("two distinct patches that collided under the old wyhash contents_hash do not share a cache entry", async () => {
    // https://github.com/oven-sh/bun/issues/32741
    // Under Wyhash11(seed=0) both patches hash to 0x429d7ca64c60f3d1, so
    // before this change projB reused projA's cached patched package (and
    // observed AAAAAAAA) instead of applying its own patch.
    const header = patchHeader("@@ -0,0 +1 @@");
    const patchA = header + `+module.exports="xxx07QaaaaaU18fmtAHABCDEFGHIJKLMNOPAAAAAAAAgMsUw5DUklmnopqrstuvwxyz";\n`;
    const patchB = header + `+module.exports="xxx07QaaaaaU18fmtAHABCDEFGHIJKLMNOPBBBBBBBBgMsUw5DUklmnopqrstuvwxyz";\n`;
    // Regenerating this pair at runtime would require the internal Wyhash11
    // (not exposed to JS), so the colliding pair is fixed. Both patches are
    // the same length and differ only in the 8-byte payload.
    expect(patchA.length).toBe(patchB.length);
    expect(patchA).not.toBe(patchB);

    using sharedCache = tempDir("patch-hash-cache", {});
    using projA = mkProject("proj-a", patchA);
    using projB = mkProject("proj-b", patchB);
    const cache = String(sharedCache);

    await install(String(projA), cache);
    expect(await installedMjs(String(projA))).toContain("AAAAAAAA");

    await install(String(projB), cache);
    const mB = await installedMjs(String(projB));
    expect(mB).toContain("BBBBBBBB");
    expect(mB).not.toContain("AAAAAAAA");

    // A non-colliding control patch (different size, different content) has
    // always gone to its own cache entry.
    using projC = mkProject("proj-ctl", header + `+module.exports="control payload";\n`);
    await install(String(projC), cache);
    expect(await installedMjs(String(projC))).toContain("control payload");
  });

  test("patches that differ only after the first 64 KiB get distinct cache entries", async () => {
    // The content hash used to be computed by repeatedly reading from file
    // offset 0, so any two patches with an identical leading chunk hashed the
    // same no matter what followed. Both patches here share a >64 KiB prefix
    // (a long comment line) and differ only in the final exported payload.
    const padding = "+// " + Buffer.alloc(80 * 1024, "p").toString() + "\n";
    const header = patchHeader("@@ -0,0 +1,2 @@");
    const patchA = header + padding + `+module.exports="TAIL_AAAA";\n`;
    const patchB = header + padding + `+module.exports="TAIL_BBBB";\n`;
    expect(patchA.length).toBe(patchB.length);
    expect(patchA).not.toBe(patchB);

    using sharedCache = tempDir("patch-tail-cache", {});
    using projA = mkProject("proj-a", patchA);
    using projB = mkProject("proj-b", patchB);
    const cache = String(sharedCache);

    await install(String(projA), cache);
    expect(await installedMjs(String(projA))).toContain("TAIL_AAAA");

    await install(String(projB), cache);
    const mB = await installedMjs(String(projB));
    // Compare just the tail so a failure doesn't dump the 80 KiB padding.
    expect({ hasB: mB.includes("TAIL_BBBB"), hasA: mB.includes("TAIL_AAAA") }).toEqual({ hasB: true, hasA: false });
  });
});

// `patchedDependencies` is only read from the root package.json. The entries a
// dependency's own package.json declared (a `file:` folder, a tarball, a
// workspace member) used to be merged into the consumer's lockfile without a
// patch hash. If the patched package was already resolved, the installer
// panicked with `called Option::unwrap() on a None value`. Otherwise the
// install failed with "Couldn't find patch file" because the dependency's patch
// path was resolved against the consumer's root (#13531).
describe("patchedDependencies declared by a dependency", () => {
  const registry = new TestRegistry();

  beforeAll(async () => {
    await registry.start();
  });

  afterAll(() => {
    registry.stop();
  });

  // Adds a file, so it applies to any version of the package.
  const noDepsPatch = `diff --git a/patched.txt b/patched.txt
new file mode 100644
index 0000000000000000000000000000000000000000..3b18e512dba79e4c8300dd08aeb37f8e728b8dad
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`;

  // A package that patches its own `no-deps` dependency.
  const patchingDep = {
    "package.json": JSON.stringify({
      name: "patching-dep",
      version: "1.0.0",
      dependencies: { "no-deps": "1.0.0" },
      patchedDependencies: { "no-deps@1.0.0": "patches/no-deps@1.0.0.patch" },
    }),
    patches: { "no-deps@1.0.0.patch": noDepsPatch },
  };

  // A consumer that installs the same `no-deps` that `patching-dep` patches.
  const consumerPackageJson = (dependencies: Record<string, string>, rest: Record<string, unknown> = {}) =>
    JSON.stringify({ name: "consumer", dependencies: { "no-deps": "1.0.0", ...dependencies }, ...rest });

  const gitEnv = {
    ...bunEnv,
    // Set on the asan lanes, where it makes `bun install` kill its own git clones (#33982).
    BUN_FEATURE_FLAG_NO_ORPHANS: undefined,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };

  // CI exports BUN_INSTALL_CACHE_DIR, which overrides the per-directory cache
  // in bunfig.toml. The tests below run concurrently, and two cold installs of
  // the same package into one cache replace each other's cache directory.
  const install = (packageDir: string, env = bunEnv) =>
    runBunInstall({ ...env, BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache") }, packageDir);

  const lockfileHasPatches = async (packageDir: string) =>
    (await Bun.file(join(packageDir, "bun.lock")).text()).includes("patchedDependencies");

  const noDepsFile = (packageDir: string, name: string) => Bun.file(join(packageDir, "node_modules", "no-deps", name));

  async function installUnpatched(packageDir: string, env = bunEnv) {
    await install(packageDir, env);
    expect({
      noDeps: await noDepsFile(packageDir, "package.json").json(),
      patched: await noDepsFile(packageDir, "patched.txt").exists(),
      lockfileHasPatches: await lockfileHasPatches(packageDir),
    }).toEqual({
      noDeps: { name: "no-deps", version: "1.0.0" },
      patched: false,
      lockfileHasPatches: false,
    });
  }

  test.concurrent("apply when the declaring package is the install root", async () => {
    const { packageDir } = await registry.createTestDir({ files: patchingDep });
    await install(packageDir);
    expect({
      patched: await noDepsFile(packageDir, "patched.txt").text(),
      lockfileHasPatches: await lockfileHasPatches(packageDir),
    }).toEqual({ patched: "hello world\n", lockfileHasPatches: true });
  });

  describe.each(["hoisted", "isolated"] as const)("are ignored by the consumer (%s linker)", linker => {
    // A consumer with `no-deps` installed, plus `dep/` that is not a dependency yet.
    async function installedConsumer() {
      const dir = await registry.createTestDir({
        bunfigOpts: { linker },
        files: { "package.json": consumerPackageJson({}), dep: patchingDep },
      });
      await install(dir.packageDir);
      return dir;
    }

    test.concurrent("file: dependency added to an existing install", async () => {
      const { packageDir, packageJson } = await installedConsumer();

      await Bun.write(packageJson, consumerPackageJson({ "patching-dep": "file:./dep" }));
      await installUnpatched(packageDir);
    });

    // A tarball or a git checkout is extracted after `no-deps` was taken from
    // the lockfile, so the entry it used to add reached the installer without a
    // patch hash. These are the installs that panicked.
    test.concurrent("tarball dependency added to an existing install", async () => {
      const { packageDir, packageJson } = await installedConsumer();

      await using pack = Bun.spawn({
        cmd: [bunExe(), "pm", "pack", "--quiet"],
        cwd: join(packageDir, "dep"),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([pack.stdout.text(), pack.stderr.text(), pack.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "patching-dep-1.0.0.tgz\n", stderr: "", exitCode: 0 });

      await Bun.write(packageJson, consumerPackageJson({ "patching-dep": "./dep/patching-dep-1.0.0.tgz" }));
      await installUnpatched(packageDir);
    });

    test.concurrent("git dependency added to an existing install", async () => {
      const { packageDir, packageJson } = await installedConsumer();

      const repo = join(packageDir, "dep");
      await $`git init -q && git add -A && git commit -q -m init --no-gpg-sign`.cwd(repo).env(gitEnv).quiet();

      await Bun.write(packageJson, consumerPackageJson({ "patching-dep": `git+${pathToFileURL(repo)}` }));
      await installUnpatched(packageDir, gitEnv);
    });

    // https://github.com/oven-sh/bun/issues/13531
    test.concurrent("file: dependency on a fresh install", async () => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { linker },
        files: { "package.json": consumerPackageJson({ "patching-dep": "file:./dep" }), dep: patchingDep },
      });
      await installUnpatched(packageDir);
    });

    test.concurrent("workspace member", async () => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { linker },
        files: {
          "package.json": consumerPackageJson({}, { workspaces: ["packages/*"] }),
          packages: { dep: patchingDep },
        },
      });
      await installUnpatched(packageDir);
    });
  });
});

// The hash of every patch file in `patchedDependencies` is taken before bun
// resolves anything, so a file that cannot be hashed stops the install. For a
// missing file bun used to print `bun patch <patch file>` as the way out. That
// command ran the same install and printed the same message.
describe("a patchedDependencies entry whose patch file cannot be hashed", () => {
  const registry = new TestRegistry();

  beforeAll(async () => {
    await registry.start();
  });

  afterAll(() => {
    registry.stop();
  });

  // Adds a file, so it applies to any version of the package.
  const addFilePatch = `diff --git a/patched.txt b/patched.txt
new file mode 100644
index 0000000000000000000000000000000000000000..3b18e512dba79e4c8300dd08aeb37f8e728b8dad
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`;

  const patchPath = "patches/no-deps@1.0.0.patch";
  const appPackageJson = (patchedDependencies?: Record<string, string>) =>
    JSON.stringify({ name: "app", dependencies: { "no-deps": "1.0.0" }, patchedDependencies });
  const patchedApp = appPackageJson({ "no-deps@1.0.0": patchPath });

  const missing = `error: Couldn't find patch file: "<dir>/${patchPath}"`;
  const entryNote = (key: string | undefined) =>
    `note: "${key}" in "patchedDependencies" of "<dir>/package.json" points at this file`;
  const orRemoveEntry = "or remove that entry (the patch is then not applied)";
  const missingReport = [missing, entryNote("no-deps@1.0.0"), `note: add the file at that path, ${orRemoveEntry}`].join(
    "\n",
  );

  const project = async (files: DirectoryTree | string) => (await registry.createTestDir({ files })).packageDir;
  const patchedFile = (root: string) => Bun.file(join(root, "node_modules", "no-deps", "patched.txt"));

  // Runs bun in `cwd`. `report` is the `error:` and `note:` lines it prints, with the project root as <dir>.
  async function run(root: string, cwd: string, args: string[], env: Record<string, string> = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env: {
        ...bunEnv,
        // A workspace member does not read the bunfig.toml of the root.
        BUN_CONFIG_REGISTRY: registry.url,
        BUN_INSTALL_CACHE_DIR: join(root, ".bun-cache"),
        // yarn also reads the rc file of the home folder
        HOME: root,
        USERPROFILE: root,
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The hint that led back to the same message.
    expect(stderr).not.toContain("To create a new patch file");
    const report = normalizeBunSnapshot_(stderr, root)
      .replaceAll("fstatat()", "stat()")
      .split("\n")
      .filter(line => /^(error|note):/.test(line))
      .join("\n");
    return { stdout, stderr, report, exitCode };
  }

  async function fails(root: string, cwd: string, args: string[], env?: Record<string, string>) {
    const { report, exitCode } = await run(root, cwd, args, env);
    return { report, exitCode };
  }

  async function installs(root: string, cwd = root) {
    expect(await fails(root, cwd, ["install"])).toEqual({ report: "", exitCode: 0 });
  }

  test.concurrent("a missing file: the report names the entry, and both remedies work", async () => {
    const root = await project({ "package.json": patchedApp });

    for (const command of [["install"], ["add", "a-dep@1.0.1"], ["update"]]) {
      expect({ command, ...(await fails(root, root, command)) }).toEqual({
        command,
        report: missingReport,
        exitCode: 1,
      });
    }
    expect(await Bun.file(join(root, "package.json")).text()).toBe(patchedApp);

    // The progress line ends before the report starts.
    expect(await fails(root, root, ["install"], { BUN_INSTALL_PROGRESS: "1" })).toEqual({
      report: missingReport,
      exitCode: 1,
    });

    const silent = await run(root, root, ["install", "--silent"]);
    expect({ stdout: silent.stdout, stderr: silent.stderr, exitCode: silent.exitCode }).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 1,
    });

    // "add the file at that path"
    await Bun.write(join(root, patchPath), addFilePatch);
    await installs(root);
    expect(await patchedFile(root).text()).toBe("hello world\n");

    // The same state with a lockfile and an installed package.
    rmSync(join(root, "patches"), { recursive: true });
    expect(await fails(root, root, ["install", "--frozen-lockfile"])).toEqual({
      report: missingReport,
      exitCode: 1,
    });

    // "or remove that entry (the patch is then not applied)"
    await Bun.write(join(root, "package.json"), appPackageJson());
    await installs(root);
    expect({
      noDeps: await Bun.file(join(root, "node_modules", "no-deps", "package.json")).json(),
      patched: await patchedFile(root).exists(),
      lockfileHasPatches: (await Bun.file(join(root, "bun.lock")).text()).includes("patchedDependencies"),
    }).toEqual({ noDeps: { name: "no-deps", version: "1.0.0" }, patched: false, lockfileHasPatches: false });
  });

  describe.each([
    {
      state: "a file that is empty",
      files: { "package.json": patchedApp, patches: { "no-deps@1.0.0.patch": "" } },
      report: [
        `error: patch file is empty: "<dir>/${patchPath}"`,
        entryNote("no-deps@1.0.0"),
        `note: restore the file, ${orRemoveEntry}`,
      ].join("\n"),
      posixOnly: false,
    },
    // The hash of every entry is taken, also when no dependency matches the entry.
    {
      state: "a missing file of an entry that no dependency matches",
      files: {
        "package.json": JSON.stringify({ name: "app", patchedDependencies: { "no-deps@1.0.0": patchPath } }),
      },
      report: missingReport,
      posixOnly: false,
    },
    // The file can be intact after an I/O error, so these two get the errno and no remedy.
    {
      state: "a directory in place of the file",
      files: { "package.json": patchedApp, patches: { "no-deps@1.0.0.patch": { "file.txt": "" } } },
      report: [
        `error: failed to read patch file: EISDIR: <dir>/${patchPath}: Is a directory (pread())`,
        entryNote("no-deps@1.0.0"),
      ].join("\n"),
      posixOnly: true,
    },
    {
      state: "a regular file in place of the directory of the file",
      files: { "package.json": patchedApp, patches: "not a directory" },
      report: [
        `error: failed to read patch file: ENOTDIR: <dir>/${patchPath}: Not a directory (stat())`,
        entryNote("no-deps@1.0.0"),
      ].join("\n"),
      posixOnly: true,
    },
  ])("$state", ({ files, report, posixOnly }) => {
    test.skipIf(posixOnly && isWindows).concurrent("bun install says why and names the entry", async () => {
      const root = await project(files);

      expect(await fails(root, root, ["install"])).toEqual({ report, exitCode: 1 });
    });
  });

  test.concurrent("from a workspace member, the paths are those of the workspace root", async () => {
    const rootPackageJson = (patchedDependencies?: Record<string, string>) =>
      JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"], patchedDependencies });
    const root = await project({
      "package.json": rootPackageJson({ "no-deps@1.0.0": patchPath }),
      packages: {
        member: {
          "package.json": JSON.stringify({ name: "member", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } }),
        },
      },
    });
    const member = join(root, "packages", "member");

    expect(await fails(root, member, ["install"])).toEqual({ report: missingReport, exitCode: 1 });

    await Bun.write(join(root, "package.json"), rootPackageJson());
    await installs(root, member);
  });

  test.concurrent("two entries that share one patch file are told apart by their keys", async () => {
    const shared = "patches/shared.patch";
    const manifest = {
      name: "app",
      dependencies: { "no-deps": "1.0.0", "a-dep": "1.0.1" },
      patchedDependencies: { "no-deps@1.0.0": shared, "a-dep@1.0.1": shared } as Record<string, string>,
    };
    const root = await project({ "package.json": JSON.stringify(manifest) });

    const named: (string | undefined)[] = [];
    for (const _ of Object.keys(manifest.patchedDependencies)) {
      const { report, exitCode } = await fails(root, root, ["install"]);
      const key = report.match(/^note: "([^"]+)" in "patchedDependencies"/m)?.[1];
      expect({ report, exitCode }).toEqual({
        report: [
          `error: Couldn't find patch file: "<dir>/${shared}"`,
          entryNote(key),
          `note: add the file at that path, ${orRemoveEntry}`,
        ].join("\n"),
        exitCode: 1,
      });
      named.push(key);

      delete manifest.patchedDependencies[key!];
      await Bun.write(join(root, "package.json"), JSON.stringify(manifest));
    }
    expect(named.sort()).toEqual(["a-dep@1.0.1", "no-deps@1.0.0"]);

    await installs(root);
  });

  // A yarn.lock migration adds the entries of yarn.lock to package.json in memory
  // and writes the file only with bun.lock. The report names an entry only when
  // the user can find it in the file.
  test.concurrent("an entry that is not in package.json on disk gets no entry note", async () => {
    const fixture = join(import.meta.dir, "migration", "yarn-berry", "patch");
    const patch = join(".yarn", "patches", "no-deps-npm-1.0.1-aa11bb22cc.patch");
    const root = await project(fixture);
    expect((await Bun.file(join(root, "package.json")).json()).patchedDependencies).toEqual({
      "no-deps@1.0.0": ".yarn/patches/no-deps-npm-1.0.0-d5a9b7e1c2.patch",
    });
    rmSync(join(root, patch));

    expect(await fails(root, root, ["install"])).toEqual({
      report: `error: Couldn't find patch file: "<dir>/.yarn/patches/no-deps-npm-1.0.1-aa11bb22cc.patch"`,
      exitCode: 1,
    });

    await Bun.write(join(root, patch), Bun.file(join(fixture, patch)));
    await installs(root);
  });
});
