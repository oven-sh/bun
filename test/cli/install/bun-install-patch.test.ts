import { $ } from "bun";
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout, test } from "bun:test";
import { rmSync } from "fs";
import {
  bunEnv,
  bunExe,
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

// A checkout can take package.json and bun.lock back to a commit without the
// patch in one step (a branch switch, a pulled revert, `git stash`). Neither
// file names the patch then, so only node_modules can say that the installed
// copy is patched.
describe("a patch that package.json and bun.lock lose in one step", () => {
  const registry = new VerdaccioRegistry();

  beforeAll(async () => {
    await registry.start();
  });

  afterAll(() => {
    registry.stop();
  });

  type Linker = "hoisted" | "isolated";

  const patchedLine = "module.exports.patched = true;\n";

  // Changes a published file and adds a new one.
  const noDepsPatch = `diff --git a/index.js b/index.js
index 0000000000000000000000000000000000000000..1111111111111111111111111111111111111111 100644
--- a/index.js
+++ b/index.js
@@ -5,3 +5,4 @@
     module.exports[key][dep] = require(dep);
   }
 }
+${patchedLine}diff --git a/patched.txt b/patched.txt
new file mode 100644
index 0000000000000000000000000000000000000000..3b18e512dba79e4c8300dd08aeb37f8e728b8dad
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`;

  const patchedDependencies = { "no-deps@1.0.0": "patches/no-deps@1.0.0.patch" };
  const empty = JSON.stringify({ name: "app" });
  const unpatched = JSON.stringify({ name: "app", dependencies: { "no-deps": "1.0.0" } });
  const patched = JSON.stringify({ name: "app", dependencies: { "no-deps": "1.0.0" }, patchedDependencies });

  async function bun(cwd: string, args: string[], env = bunEnv) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd,
      // CI exports BUN_INSTALL_CACHE_DIR, which overrides the per-directory cache in bunfig.toml.
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
    return stdout;
  }

  const install = (packageDir: string, ...args: string[]) => bun(packageDir, ["install", ...args]);

  const names = (dir: string, pattern: string) =>
    [...new Bun.Glob(pattern).scanSync({ cwd: dir, dot: true, onlyFiles: false })].sort();

  // What a folder of `no-deps` holds.
  async function contents(dir: string) {
    return {
      patchedIndex: (await Bun.file(join(dir, "index.js")).text()).includes(patchedLine),
      patchedTxt: await Bun.file(join(dir, "patched.txt")).exists(),
      markers: names(dir, ".bun-tag-*").length,
    };
  }

  const asPublished = { patchedIndex: false, patchedTxt: false, markers: 0 };
  const asPatched = { patchedIndex: true, patchedTxt: true, markers: 1 };

  // An installed project at the commit without the patch.
  async function project(linker: Linker, manifest = unpatched) {
    const { packageDir, packageJson } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: { "package.json": manifest },
    });
    const lockfile = join(packageDir, "bun.lock");
    // What `require("no-deps")` loads. The isolated linker links it into its store.
    const noDeps = join(packageDir, "node_modules", "no-deps");
    await install(packageDir);

    const unpatchedLockfile = await Bun.file(lockfile).text();
    // What `git checkout`, `git stash` or `git restore .` do to the tracked files.
    const checkoutUnpatched = async () => {
      await Bun.write(packageJson, manifest);
      await Bun.write(lockfile, unpatchedLockfile);
      rmSync(join(packageDir, "patches"), { recursive: true });
    };
    const checkoutPatched = async () => {
      await Bun.write(join(packageDir, "patches", "no-deps@1.0.0.patch"), noDepsPatch);
      await Bun.write(packageJson, JSON.stringify({ ...JSON.parse(manifest), patchedDependencies }));
    };
    return { packageDir, packageJson, lockfile, noDeps, checkoutUnpatched, checkoutPatched };
  }

  // The same project at the commit with the patch.
  async function patchedProject(linker: Linker) {
    const dir = await project(linker);
    expect(await contents(dir.noDeps)).toEqual(asPublished);
    await dir.checkoutPatched();
    await install(dir.packageDir);
    expect(await contents(dir.noDeps)).toEqual(asPatched);
    // An up-to-date patched package is not installed again.
    expect(await install(dir.packageDir)).toContain("(no changes)");
    expect(await contents(dir.noDeps)).toEqual(asPatched);
    return dir;
  }

  describe.each(["hoisted", "isolated"] as const)("%s linker", linker => {
    test.concurrent("the package is installed again as published", async () => {
      const { packageDir, noDeps, checkoutUnpatched } = await patchedProject(linker);

      await checkoutUnpatched();
      await install(packageDir);
      expect(await contents(noDeps)).toEqual(asPublished);

      // The reinstall removed the patched copy, so the next install has nothing to do.
      expect(await install(packageDir, "--frozen-lockfile")).toContain("(no changes)");
      expect(await contents(noDeps)).toEqual(asPublished);
    });

    test.concurrent("a patched copy that outlived its dependency is not reused", async () => {
      const { packageDir, packageJson, lockfile, noDeps, checkoutUnpatched } = await patchedProject(linker);

      // The commit without the dependency: the patched copy stays in node_modules.
      await Bun.write(packageJson, empty);
      rmSync(lockfile);
      await install(packageDir);

      await checkoutUnpatched();
      await install(packageDir, "--frozen-lockfile");
      expect(await contents(noDeps)).toEqual(asPublished);

      expect(await install(packageDir)).toContain("(no changes)");
      expect(await contents(noDeps)).toEqual(asPublished);
    });

    test.concurrent("a patch from `bun patch --commit` is taken out again", async () => {
      const { packageDir, noDeps, checkoutUnpatched } = await project(linker);

      await bun(packageDir, ["patch", "no-deps"]);
      const index = join(noDeps, "index.js");
      await Bun.write(index, (await Bun.file(index).text()) + patchedLine);
      await Bun.write(join(noDeps, "patched.txt"), "hello world\n");
      await bun(packageDir, ["patch", "--commit", "node_modules/no-deps"]);
      expect(await contents(noDeps)).toMatchObject({ patchedIndex: true, patchedTxt: true });

      await checkoutUnpatched();
      await install(packageDir);
      // `bun patch` puts a detached copy at `node_modules/no-deps`. Under the isolated
      // linker that copy stays there after `--commit`, so look at the store entry.
      const published =
        linker === "isolated"
          ? join(packageDir, "node_modules", ".bun", "no-deps@1.0.0", "node_modules", "no-deps")
          : noDeps;
      expect(await contents(published)).toEqual(asPublished);
    });

    // The hoisted linker reads `package.json` to see whether a package is up to date, and
    // the isolated linker asks whether the store entry exists. Each finds the patch there.
    test.concurrent("the patched copy names its patch where the linker looks", async () => {
      const { packageDir, noDeps } = await patchedProject(linker);

      const [cacheFolder] = names(join(packageDir, ".bun-cache"), "no-deps@1.0.0*_patch_hash=*");
      const hash = cacheFolder.slice(cacheFolder.indexOf("_patch_hash=") + "_patch_hash=".length);
      expect(Object.entries(await Bun.file(join(noDeps, "package.json")).json())).toEqual([
        ["_bunPatchHash", hash],
        ["name", "no-deps"],
        ["version", "1.0.0"],
      ]);
      if (linker === "isolated") {
        expect(names(join(packageDir, "node_modules", ".bun"), "no-deps@*")).toEqual([
          "no-deps@1.0.0",
          `no-deps@1.0.0_patch_hash=${hash}`,
        ]);
      }
    });

    test.concurrent("`bun patch --commit` keeps the patch hash out of the next patch", async () => {
      const { packageDir, noDeps } = await patchedProject(linker);

      await bun(packageDir, ["patch", "no-deps"]);
      await Bun.write(join(noDeps, "second.txt"), "second\n");
      await bun(packageDir, ["patch", "--commit", "node_modules/no-deps"]);

      const patch = await Bun.file(join(packageDir, "patches", "no-deps@1.0.0.patch")).text();
      expect(patch).toContain("second.txt");
      expect(patch).not.toContain("_bunPatchHash");
    });
  });

  test.concurrent("`bun prune` keeps the store entry of a patched package", async () => {
    const { packageDir, noDeps } = await patchedProject("isolated");

    await bun(packageDir, ["prune"]);
    expect(await contents(noDeps)).toEqual(asPatched);
  });

  test.concurrent("`bun pm licenses` finds the store entry of a patched package", async () => {
    // `no-deps` is a dependency of `one-fixed-dep`, so it is found through the store.
    const manifest = JSON.stringify({ name: "app", dependencies: { "one-fixed-dep": "1.0.0" } });
    const { packageDir, checkoutPatched } = await project("isolated", manifest);
    await checkoutPatched();
    await install(packageDir);

    const licenses: Record<string, { name: string }[]> = JSON.parse(
      await bun(packageDir, ["pm", "licenses", "--json"]),
    );
    expect(
      Object.values(licenses)
        .flat()
        .map(entry => entry.name)
        .sort(),
    ).toEqual(["no-deps", "one-fixed-dep"]);
  });

  // Earlier versions of bun put a patched package at the store path of the unpatched
  // one, with a `.bun-tag-<hash>` file in it.
  test.concurrent("a store entry that an earlier version patched in place is not reused", async () => {
    const { packageDir, noDeps, checkoutPatched, checkoutUnpatched } = await project("isolated");
    const entry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0", "node_modules", "no-deps");
    // A new file: the installed one can share its inode with the cache.
    rmSync(join(entry, "index.js"));
    await Bun.write(join(entry, "index.js"), patchedLine);
    await Bun.write(join(entry, ".bun-tag-0123456789abcdef"), "");

    await checkoutPatched();
    await install(packageDir);
    expect(await contents(noDeps)).toEqual(asPatched);

    await checkoutUnpatched();
    await install(packageDir);
    expect(await contents(noDeps)).toEqual(asPublished);
  });

  // What an earlier version of bun left in node_modules: the patched files, and no hash in package.json.
  test.concurrent("a patched copy without the patch hash is installed again", async () => {
    const { packageDir, noDeps } = await patchedProject("hoisted");
    const packageJson = join(noDeps, "package.json");
    // A new file: the installed one can share its inode with the cache.
    rmSync(packageJson);
    await Bun.write(packageJson, JSON.stringify({ name: "no-deps", version: "1.0.0" }));

    expect(await install(packageDir)).not.toContain("(no changes)");
    expect(Object.keys(await Bun.file(packageJson).json())[0]).toBe("_bunPatchHash");
    expect(await contents(noDeps)).toEqual(asPatched);
    expect(await install(packageDir)).toContain("(no changes)");
  });

  // A package that someone published from a patched copy has the key in its own package.json.
  test.concurrent("a package that is published with the patch hash key is installed once", async () => {
    using dir = tempDir("published-with-patch-hash", {
      "ships-key": {
        "package.json": `{"_bunPatchHash":"0123456789abcdef","name":"ships-key","version":"1.0.0"}`,
        "index.js": "module.exports = 1;\n",
      },
      app: { "package.json": JSON.stringify({ name: "app", dependencies: { "ships-key": "1.0.0" } }) },
    });
    await bun(join(String(dir), "ships-key"), ["pm", "pack", "--destination", String(dir)]);
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.endsWith(".tgz")) return new Response(Bun.file(join(String(dir), "ships-key-1.0.0.tgz")));
        const tarball = `http://localhost:${server.port}/ships-key/-/ships-key-1.0.0.tgz`;
        return Response.json({
          name: "ships-key",
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": { name: "ships-key", version: "1.0.0", dist: { tarball } } },
        });
      },
    });
    const app = join(String(dir), "app");
    await Bun.write(
      join(app, "bunfig.toml"),
      `[install]\nlinker = "hoisted"\nregistry = "http://localhost:${server.port}/"\n`,
    );

    await install(app);
    expect(Object.entries(await Bun.file(join(app, "node_modules", "ships-key", "package.json")).json())[0]).toEqual([
      "_bunPatchHash",
      "0123456789abcdef",
    ]);
    expect(await install(app)).toContain("(no changes)");
  });

  // The hoisted linker reads `.bun-tag` of a git dependency, not its package.json.
  test.concurrent("a git dependency is installed again as committed", async () => {
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
    using dir = tempDir("patched-git-dependency", {
      repo: {
        "package.json": JSON.stringify({ name: "git-dep", version: "1.0.0" }),
        "index.js": `module.exports = "as committed";\n`,
      },
      app: { "bunfig.toml": `[install]\nlinker = "hoisted"\n` },
    });
    const repo = join(String(dir), "repo");
    await $`git init -q && git add -A && git commit -q -m init --no-gpg-sign`.cwd(repo).env(gitEnv).quiet();

    const app = join(String(dir), "app");
    const manifest = JSON.stringify({ name: "app", dependencies: { "git-dep": `git+${pathToFileURL(repo)}` } });
    await Bun.write(join(app, "package.json"), manifest);
    await bun(app, ["install"], gitEnv);
    const lockfile = await Bun.file(join(app, "bun.lock")).text();
    const index = join(app, "node_modules", "git-dep", "index.js");
    expect(await Bun.file(index).text()).toBe(`module.exports = "as committed";\n`);

    await bun(app, ["patch", "git-dep"], gitEnv);
    await Bun.write(index, `module.exports = "patched";\n`);
    await bun(app, ["patch", "--commit", "node_modules/git-dep"], gitEnv);
    expect(await Bun.file(index).text()).toBe(`module.exports = "patched";\n`);
    expect(await bun(app, ["install"], gitEnv)).toContain("(no changes)");

    await Bun.write(join(app, "package.json"), manifest);
    await Bun.write(join(app, "bun.lock"), lockfile);
    rmSync(join(app, "patches"), { recursive: true });
    await bun(app, ["install"], gitEnv);
    expect(await Bun.file(index).text()).toBe(`module.exports = "as committed";\n`);
    expect(await bun(app, ["install"], gitEnv)).toContain("(no changes)");
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
