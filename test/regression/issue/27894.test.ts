import { $ } from "bun";
import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

const is_even_patch = /* patch */ `diff --git a/index.js b/index.js
index 832d92223a9ec491364ee10dcbe3ad495446ab80..bc652e496c165a7415880ef4520c0ab302bf0765 100644
--- a/index.js
+++ b/index.js
@@ -10,5 +10,6 @@
 var isOdd = require('is-odd');

 module.exports = function isEven(i) {
+  console.log("PATCHED");
   return !isOdd(i);
 };
`;

test("workspace install succeeds when nested workspace member has patchedDependencies", async () => {
  // Regression test for #27894: when a workspace member package has its own
  // patchedDependencies, bun install from the workspace root should not fail
  // with "Couldn't find patch file: 'patches/...'"
  //
  // The root does NOT have patchedDependencies - only the nested member does.
  // Bun should ignore the member's patchedDependencies field (only the install
  // root's patchedDependencies should be honored).
  const filedir = tempDirWithFiles("patch-workspace-nested", {
    "package.json": JSON.stringify({
      name: "workspace-root",
      workspaces: ["packages/*"],
    }),
    packages: {
      lib: {
        "package.json": JSON.stringify({
          name: "lib",
          dependencies: {
            "is-even": "1.0.0",
          },
          // This patchedDependencies only works when lib is the install root.
          // When installing from the workspace root, this should be ignored.
          patchedDependencies: {
            "is-even@1.0.0": "patches/is-even@1.0.0.patch",
          },
        }),
        patches: {
          "is-even@1.0.0.patch": is_even_patch,
        },
        "index.ts": `import isEven from 'is-even'; console.log(isEven(4));`,
      },
      app: {
        "package.json": JSON.stringify({
          name: "app",
          dependencies: {
            lib: "workspace:*",
          },
        }),
      },
    },
  });

  // This should not fail with "Couldn't find patch file"
  const installResult = await $`${bunExe()} install`.env(bunEnv).cwd(filedir).throws(false);
  expect(installResult.stderr.toString()).not.toContain("Couldn't find patch file");
  expect(installResult.exitCode).toBe(0);

  // Verify the nested member's patch was NOT applied (since only root
  // patchedDependencies should be honored, and the root has none)
  const runResult = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(`${filedir}/packages/lib`).throws(false);
  expect(runResult.stdout.toString()).not.toContain("PATCHED");
  expect(runResult.exitCode).toBe(0);
});
