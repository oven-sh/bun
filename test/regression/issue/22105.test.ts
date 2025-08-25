import { $ } from "bun";
import { describe, test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles, normalizeBunSnapshot } from "harness";

describe("issue #22105: crash when patching GitHub dependency with commit hash", () => {
  test("should not crash when patching a GitHub dependency with commit hash", async () => {
    const tempdir = tempDirWithFiles("issue-22105", {
      "package.json": JSON.stringify({
        name: "issue-22105-test",
        version: "1.0.0",
        dependencies: {
          "true-myth": "github:true-myth/true-myth#a96949b"
        }
      }),
    });

    // Install the GitHub dependency
    await $`${bunExe()} install`.env(bunEnv).cwd(tempdir);
    
    // Run bun patch on the GitHub dependency - this was crashing before the fix
    const patchResult = await $`${bunExe()} patch ./node_modules/true-myth`.env(bunEnv).cwd(tempdir);
    expect(normalizeBunSnapshot(patchResult.stderr.toString())).toMatchInlineSnapshot(`""`);
    expect(normalizeBunSnapshot(patchResult.stdout.toString())).toMatchInlineSnapshot(`
      "bun patch <version> (<revision>)

      Checked 1 install across 2 packages (no changes)

      To patch true-myth, edit the following folder:

        ./node_modules/true-myth

      Once you're done with your changes, run:

        bun patch --commit './node_modules/true-myth'"
    `);
  });
});