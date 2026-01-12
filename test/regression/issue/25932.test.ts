import { $ } from "bun";
import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

describe("issue#25932", () => {
  // Patch that adds a console.log to is-even (a visible difference)
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

  test("frozen-lockfile should unapply removed patches", async () => {
    // Create temp directory with the patched setup
    using dir = tempDir("issue-25932", {});
    const cwd = String(dir);

    // Initial package.json with patch
    const packageJsonWithPatch = {
      main: "index.js",
      dependencies: {
        "is-even": "^1.0.0",
      },
      patchedDependencies: {
        "is-even@1.0.0": "patches/is-even@1.0.0.patch",
      },
    };

    // package.json without patch
    const packageJsonWithoutPatch = {
      main: "index.js",
      dependencies: {
        "is-even": "^1.0.0",
      },
    };

    // Set up initial state with patch
    await Bun.write(join(cwd, "package.json"), JSON.stringify(packageJsonWithPatch, null, 2));
    await Bun.write(join(cwd, "patches/is-even@1.0.0.patch"), is_even_patch);
    await Bun.write(join(cwd, "index.js"), `const isEven = require('is-even'); console.log(isEven(5));`);

    // Install with patch
    await $`${bunExe()} install`.env(bunEnv).cwd(cwd);

    // Verify the patch is applied (should output "PATCHED")
    {
      const result = await $`${bunExe()} run index.js`.env(bunEnv).cwd(cwd).quiet();
      expect(result.stdout.toString()).toContain("PATCHED");
    }

    // Save the lockfile without patchedDependencies
    // This simulates what happens when user switches branches in git
    const lockContent = await Bun.file(join(cwd, "bun.lock")).text();
    const lockWithoutPatch = lockContent.replace(/,?\n\s*"patchedDependencies":\s*\{[^}]*\}/g, "");
    await Bun.write(join(cwd, "bun.lock"), lockWithoutPatch);

    // Also update package.json to remove the patch
    await Bun.write(join(cwd, "package.json"), JSON.stringify(packageJsonWithoutPatch, null, 2));

    // Run install with --frozen-lockfile (simulates `bun i --frozen-lockfile` after git checkout)
    await $`${bunExe()} install --frozen-lockfile`.env(bunEnv).cwd(cwd);

    // Verify the patch is no longer applied (should NOT output "PATCHED")
    {
      const result = await $`${bunExe()} run index.js`.env(bunEnv).cwd(cwd).quiet();
      expect(result.stdout.toString()).not.toContain("PATCHED");
    }
  });

  test("should also work when switching back to patched version", async () => {
    // Create temp directory
    using dir = tempDir("issue-25932-back", {});
    const cwd = String(dir);

    // Start without a patch
    const packageJsonWithoutPatch = {
      main: "index.js",
      dependencies: {
        "is-even": "^1.0.0",
      },
    };

    const packageJsonWithPatch = {
      main: "index.js",
      dependencies: {
        "is-even": "^1.0.0",
      },
      patchedDependencies: {
        "is-even@1.0.0": "patches/is-even@1.0.0.patch",
      },
    };

    // Set up initial state without patch
    await Bun.write(join(cwd, "package.json"), JSON.stringify(packageJsonWithoutPatch, null, 2));
    await Bun.write(join(cwd, "patches/is-even@1.0.0.patch"), is_even_patch);
    await Bun.write(join(cwd, "index.js"), `const isEven = require('is-even'); console.log(isEven(5));`);

    // Install without patch
    await $`${bunExe()} install`.env(bunEnv).cwd(cwd);

    // Verify the patch is NOT applied (should NOT output "PATCHED")
    {
      const result = await $`${bunExe()} run index.js`.env(bunEnv).cwd(cwd).quiet();
      expect(result.stdout.toString()).not.toContain("PATCHED");
    }

    // Save the current lockfile
    const lockWithoutPatch = await Bun.file(join(cwd, "bun.lock")).text();

    // Now add the patch
    await Bun.write(join(cwd, "package.json"), JSON.stringify(packageJsonWithPatch, null, 2));
    await $`${bunExe()} install`.env(bunEnv).cwd(cwd);

    // Verify the patch IS applied (should output "PATCHED")
    {
      const result = await $`${bunExe()} run index.js`.env(bunEnv).cwd(cwd).quiet();
      expect(result.stdout.toString()).toContain("PATCHED");
    }

    // Now simulate switching back to version without patch (like git checkout)
    await Bun.write(join(cwd, "package.json"), JSON.stringify(packageJsonWithoutPatch, null, 2));
    await Bun.write(join(cwd, "bun.lock"), lockWithoutPatch);

    // Run install with --frozen-lockfile
    await $`${bunExe()} install --frozen-lockfile`.env(bunEnv).cwd(cwd);

    // Verify the patch is no longer applied (should NOT output "PATCHED")
    {
      const result = await $`${bunExe()} run index.js`.env(bunEnv).cwd(cwd).quiet();
      expect(result.stdout.toString()).not.toContain("PATCHED");
    }
  });
});
