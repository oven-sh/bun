import { $ } from "bun";
import { bunExe, bunEnv as env, toBeValidBin, toHaveBins, toBeWorkspaceLink, tempDirWithFiles, bunEnv } from "harness";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, describe, test, setDefaultTimeout } from "bun:test";

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

  const versions: [version: string, patchVersion?: string][] = [
    ["1.0.0"],
    ["github:i-voted-for-trump/is-even", "github:i-voted-for-trump/is-even#585f800"],
    [
      "git@github.com:i-voted-for-trump/is-even.git",
      "git+ssh://git@github.com:i-voted-for-trump/is-even.git#585f8002bb16f7bec723a47349b67df451f1b25d",
    ],
  ];

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

    await $`${bunExe()} i`.env(bunEnv).cwd(filedir);

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

    await $`echo ${JSON.stringify(pkgjsonWithPatch)} > package.json`.cwd(filedir).env(bunEnv);
    await $`${bunExe()} i`.env(bunEnv).cwd(filedir);
  });
});
