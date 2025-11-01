import { $ } from "bun";
import { beforeAll, describe, expect, it, setDefaultTimeout, test } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, normalizeBunSnapshot as normalizeBunSnapshot_, tempDirWithFiles } from "harness";
import { join } from "path";

const normalizeBunSnapshot = (str: string) => {
  str = normalizeBunSnapshot_(str);
  str = str.replace(/.*Resolved, downloaded and extracted.*\n?/g, "");
  str = str.replaceAll("fstatat()", "stat()");
  return str;
};

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

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
        const filedir = tempDirWithFiles("patch1", {
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
    const filedir = tempDirWithFiles("patch1", {
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
        const filedir = tempDirWithFiles("patch1", {
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
    const filedir = tempDirWithFiles("patch1", {
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
        const filedir = tempDirWithFiles("patch1", {
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
    const filedir = tempDirWithFiles("patch1", {
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
        const filedir = tempDirWithFiles("patch1", {
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
        const filedir = tempDirWithFiles("patch1", {
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
    const filedir = tempDirWithFiles("patch1", {
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
    const filedir = tempDirWithFiles("patch1", {
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

    const filedir = tempDirWithFiles("patch1", {
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
    test("should create patch for package and commit it", async () => {
      const filedir = tempDirWithFiles("patch-isolated", {
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
      await $`${bunExe()} install --linker=isolated`.env(bunEnv).cwd(filedir);

      // Run bun patch command
      const { stdout: patchStdout } = await $`${bunExe()} patch is-even`.env(bunEnv).cwd(filedir);
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
        .env(bunEnv)
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
      const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(filedir);
      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toContain("PATCHED with isolated linker!");
    });

    test("should patch transitive dependency with isolated linker", async () => {
      const filedir = tempDirWithFiles("patch-isolated-transitive", {
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
      await $`${bunExe()} install --linker=isolated`.env(bunEnv).cwd(filedir);

      await $`${bunExe()} patch is-odd`.env(bunEnv).cwd(filedir);

      // Patch transitive dependency (is-odd)
      const { stdout: patchStdout } = await $`${bunExe()} patch is-odd@0.1.2`.env(bunEnv).cwd(filedir);
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
        .env(bunEnv)
        .cwd(filedir);

      await $`${bunExe()} i --linker isolated`.env(bunEnv).cwd(filedir);

      // With isolated linker, there may be some stderr output during patch commit
      // but it should not contain actual errors
      const commitStderrText = commitStderr.toString();
      expect(commitStderrText).not.toContain("error:");
      expect(commitStderrText).not.toContain("panic:");

      // Verify patch was applied
      const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(filedir);
      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toContain("Transitive patch with isolated!");
    });

    test("should handle scoped packages with isolated linker", async () => {
      const filedir = tempDirWithFiles("patch-isolated-scoped", {
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
      await $`${bunExe()} install --linker=isolated`.env(bunEnv).cwd(filedir);

      // Patch scoped package
      const { stdout: patchStdout } = await $`${bunExe()} patch @zackradisic/hls-dl`.env(bunEnv).cwd(filedir);
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
        .env(bunEnv)
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
      const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(filedir);
      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toContain("SCOPED PACKAGE PATCHED with isolated!");
    });

    test("should work with workspaces and isolated linker", async () => {
      const filedir = tempDirWithFiles("patch-isolated-workspace", {
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
      await $`${bunExe()} install --linker=isolated`.env(bunEnv).cwd(filedir);

      // Patch from workspace root
      const { stdout: patchStdout } = await $`${bunExe()} patch is-even`.env(bunEnv).cwd(filedir);
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
        .env(bunEnv)
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
      const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(join(filedir, "packages", "app"));
      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toContain("WORKSPACE PATCH with isolated!");
    });

    test("should preserve patch after reinstall with isolated linker", async () => {
      const filedir = tempDirWithFiles("patch-isolated-reinstall", {
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
      await $`${bunExe()} install --linker=isolated`.env(bunEnv).cwd(filedir);

      // Create and commit a patch
      const { stdout: patchStdout } = await $`${bunExe()} patch is-even`.env(bunEnv).cwd(filedir);
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

      await $`${bunExe()} patch --commit '${relativePatchPath}'`.env(bunEnv).cwd(filedir);

      // Delete node_modules and reinstall with isolated linker
      rmSync(join(filedir, "node_modules"), { force: true, recursive: true });
      await $`${bunExe()} install --linker=isolated`.env(bunEnv).cwd(filedir);

      // Verify patch is still applied
      const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(filedir);
      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toContain("REINSTALL TEST with isolated!");
    });

    test("should handle multiple patches with isolated linker", async () => {
      const filedir = tempDirWithFiles("patch-isolated-multiple", {
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
      await $`${bunExe()} install --linker=isolated`.env(bunEnv).cwd(filedir);

      // Patch first package (is-even)
      const { stdout: patchStdout1 } = await $`${bunExe()} patch is-even`.env(bunEnv).cwd(filedir);
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
        .env(bunEnv)
        .cwd(filedir);
      // Check for errors
      const commitStderrText1 = commitStderr1.toString();
      expect(commitStderrText1).not.toContain("error:");
      expect(commitStderrText1).not.toContain("panic:");

      // Patch second package (is-odd hoisted version)
      const { stdout: patchStdout2 } = await $`${bunExe()} patch is-odd@3.0.1`.env(bunEnv).cwd(filedir);
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
        .env(bunEnv)
        .cwd(filedir);
      // Check for errors
      const commitStderrText2 = commitStderr2.toString();
      expect(commitStderrText2).not.toContain("error:");
      expect(commitStderrText2).not.toContain("panic:");

      // Verify both patches were applied
      const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(filedir);
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
