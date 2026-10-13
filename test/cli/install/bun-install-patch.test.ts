import { $ } from "bun";
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import {
  bunEnv,
  bunExe,
  type DirectoryTree,
  isWindows,
  normalizeBunSnapshot as normalizeBunSnapshot_,
  runBunInstall,
  tempDir,
  VerdaccioRegistry,
} from "harness";
import { join } from "path";
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
  const registry = new VerdaccioRegistry();

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

// https://github.com/oven-sh/bun/issues/33520
// The patch task writes `.bun-tag-<hash>` into the patched cache folder as its
// last step. A folder without that marker is not a finished patch: a cache that
// was saved or restored halfway, or a write that was cut off.
describe("a patched cache folder without its .bun-tag marker", () => {
  const registry = new VerdaccioRegistry();

  beforeAll(async () => {
    await registry.start();
  });

  afterAll(() => {
    registry.stop();
  });

  // Adds a file, so a patched folder is one that has `patched.txt`.
  const addFilePatch = `diff --git a/patched.txt b/patched.txt
new file mode 100644
index 0000000000000000000000000000000000000000..3b18e512dba79e4c8300dd08aeb37f8e728b8dad
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`;

  const project = (pkg: string): DirectoryTree => ({
    "package.json": JSON.stringify({
      name: "patched-cache-folder",
      dependencies: { [pkg]: "1.0.0" },
      patchedDependencies: { [`${pkg}@1.0.0`]: "patches/add-a-file.patch" },
    }),
    patches: { "add-a-file.patch": addFilePatch },
  });

  async function install(packageDir: string, ...flags: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", ...flags],
      cwd: packageDir,
      // CI exports BUN_INSTALL_CACHE_DIR, which overrides the cache in bunfig.toml.
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
  }

  // A project with the patch installed, and the patched cache folder of `pkg`.
  // A scoped package has its cache folder below a folder for the scope.
  async function installedProject(linker: "hoisted" | "isolated", pkg = "no-deps", files = project(pkg)) {
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker }, files });
    await install(packageDir);
    const [scope, name] = pkg.startsWith("@") ? pkg.split("/") : ["", pkg];
    const parent = join(packageDir, ".bun-cache", scope);
    const folders = readdirSync(parent).filter(entry => entry.startsWith(`${name}@`) && entry.includes("_patch_hash="));
    expect(folders).toHaveLength(1);
    return { packageDir, cacheFolder: join(parent, folders[0]) };
  }

  const markers = (cacheFolder: string) => readdirSync(cacheFolder).filter(name => name.startsWith(".bun-tag-"));

  // The folder as a cache that was restored halfway holds it: no marker, and the files of the package before the patch.
  function removeMarkerAndPatch(cacheFolder: string) {
    for (const marker of markers(cacheFolder)) rmSync(join(cacheFolder, marker));
    rmSync(join(cacheFolder, "patched.txt"));
  }

  const unpatchedFolderOf = (cacheFolder: string) => cacheFolder.slice(0, cacheFolder.indexOf("_patch_hash="));

  const installedText = (packageDir: string, pkg = "no-deps") =>
    Bun.file(join(packageDir, "node_modules", pkg, "patched.txt"))
      .text()
      .catch(() => "not patched");

  const removeNodeModules = (packageDir: string) =>
    rmSync(join(packageDir, "node_modules"), { recursive: true, force: true });

  const patchedWithMarker = { installed: "hello world\n", markers: 1 };
  const state = async (packageDir: string, cacheFolder: string, pkg = "no-deps") => ({
    installed: await installedText(packageDir, pkg),
    markers: markers(cacheFolder).length,
  });

  describe.each([
    ["hoisted linker", "hoisted", []],
    ["hoisted linker, --force", "hoisted", ["--force"]],
    ["isolated linker", "isolated", []],
    ["isolated linker, --force", "isolated", ["--force"]],
  ] as const)("is patched again (%s)", (_, linker, flags) => {
    test.concurrent.each(["unpatched", "patched"] as const)("its files are %s", async content => {
      const { packageDir, cacheFolder } = await installedProject(linker);
      expect(await state(packageDir, cacheFolder)).toEqual(patchedWithMarker);

      for (const marker of markers(cacheFolder)) rmSync(join(cacheFolder, marker));
      if (content === "unpatched") rmSync(join(cacheFolder, "patched.txt"));
      removeNodeModules(packageDir);

      await install(packageDir, ...flags);
      expect(await state(packageDir, cacheFolder)).toEqual(patchedWithMarker);
    });
  });

  describe.each(["hoisted", "isolated"] as const)("%s linker", linker => {
    test.concurrent("a folder with its marker is used as it is", async () => {
      const { packageDir, cacheFolder } = await installedProject(linker);
      // A second run of the patch would write "hello world" again.
      removeNodeModules(packageDir);
      rmSync(join(cacheFolder, "patched.txt"));
      writeFileSync(join(cacheFolder, "patched.txt"), "the folder from the cache\n");

      await install(packageDir);
      expect(await installedText(packageDir)).toBe("the folder from the cache\n");
    });

    // With no lockfile, the resolve phase is the first to ask for the patched folder. The folder
    // that the patch task copies from is gone too, so the tarball has to be downloaded again.
    test.concurrent("is patched again when bun.lock and the unpatched cache folder are gone", async () => {
      const { packageDir, cacheFolder } = await installedProject(linker);
      removeMarkerAndPatch(cacheFolder);
      rmSync(unpatchedFolderOf(cacheFolder), { recursive: true });
      rmSync(join(packageDir, "bun.lock"));
      removeNodeModules(packageDir);

      await install(packageDir);
      expect(await state(packageDir, cacheFolder)).toEqual(patchedWithMarker);
    });

    test.concurrent("is patched again when only the unpatched cache folder is gone", async () => {
      const { packageDir, cacheFolder } = await installedProject(linker);
      removeMarkerAndPatch(cacheFolder);
      rmSync(unpatchedFolderOf(cacheFolder), { recursive: true });
      removeNodeModules(packageDir);

      await install(packageDir);
      expect(await state(packageDir, cacheFolder)).toEqual(patchedWithMarker);
    });

    test.concurrent("--force does not replace a good node_modules with it", async () => {
      const { packageDir, cacheFolder } = await installedProject(linker);
      removeMarkerAndPatch(cacheFolder);

      await install(packageDir, "--force");
      expect(await state(packageDir, cacheFolder)).toEqual(patchedWithMarker);
    });

    test.concurrent("an empty folder with the patched name is patched again", async () => {
      const { packageDir, cacheFolder } = await installedProject(linker);
      rmSync(cacheFolder, { recursive: true });
      mkdirSync(cacheFolder);
      removeNodeModules(packageDir);

      await install(packageDir);
      expect(await state(packageDir, cacheFolder)).toEqual(patchedWithMarker);
    });

    test.concurrent("a scoped package is patched again", async () => {
      const pkg = "@types/no-deps";
      const { packageDir, cacheFolder } = await installedProject(linker, pkg);
      expect(await state(packageDir, cacheFolder, pkg)).toEqual(patchedWithMarker);
      removeMarkerAndPatch(cacheFolder);
      removeNodeModules(packageDir);

      await install(packageDir);
      expect(await state(packageDir, cacheFolder, pkg)).toEqual(patchedWithMarker);
    });
  });

  // The root takes `no-deps@2.0.0`, so each workspace keeps a `no-deps@1.0.0` of its own.
  // Each of those trees asks for the one patched cache folder.
  // Not on Windows: there the patch tasks of the trees race at the rename into the cache,
  // and the first install of this fixture, on an empty cache, already ends with ENOTEMPTY.
  test.skipIf(isWindows)("every tree of a hoisted install gets the patched package", async () => {
    const workspaces = ["a", "b", "c", "d"];
    const { packageDir, cacheFolder } = await installedProject("hoisted", "no-deps", {
      "package.json": JSON.stringify({
        name: "patched-in-several-trees",
        workspaces: ["packages/*"],
        dependencies: { "no-deps": "2.0.0" },
        patchedDependencies: { "no-deps@1.0.0": "patches/add-a-file.patch" },
      }),
      patches: { "add-a-file.patch": addFilePatch },
      packages: Object.fromEntries(
        workspaces.map(name => [
          name,
          { "package.json": JSON.stringify({ name, version: "1.0.0", dependencies: { "no-deps": "1.0.0" } }) },
        ]),
      ),
    });
    const installedInTrees = () =>
      Promise.all(workspaces.map(name => installedText(join(packageDir, "packages", name))));
    expect(await installedInTrees()).toEqual(workspaces.map(() => "hello world\n"));

    removeMarkerAndPatch(cacheFolder);
    removeNodeModules(packageDir);
    for (const name of workspaces) removeNodeModules(join(packageDir, "packages", name));

    await install(packageDir);
    expect({ installed: await installedInTrees(), markers: markers(cacheFolder).length }).toEqual({
      installed: workspaces.map(() => "hello world\n"),
      markers: 1,
    });
  });

  // A workspace package has no cache folder, so nothing can write a marker for it.
  test("a workspace package that matches a patch key is still linked", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "patch-key-for-a-workspace",
          workspaces: ["packages/*"],
          patchedDependencies: { "pkg@1.0.0": "patches/add-a-file.patch" },
        }),
        packages: { pkg: { "package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }) } },
        patches: { "add-a-file.patch": addFilePatch },
      },
    });
    await install(packageDir);
    expect(await Bun.file(join(packageDir, "node_modules", "pkg", "package.json")).json()).toEqual({
      name: "pkg",
      version: "1.0.0",
    });
  });
});
