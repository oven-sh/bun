import { $, ShellOutput } from "bun";
import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

const expectNoError = (o: ShellOutput) => expect(o.stderr.toString()).not.toContain("error");

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

describe("bun patch with isolated linker", async () => {
  test("should patch a package installed with --linker=isolated", async () => {
    const tempdir = tempDirWithFiles("patch-isolated", {
      "package.json": JSON.stringify({
        "name": "bun-patch-isolated-test",
        "module": "index.ts",
        "type": "module",
        "dependencies": {
          "is-even": "1.0.0",
        },
      }),
      "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(420))`,
    });

    console.log("TEMPDIR", tempdir);

    // Install with isolated linker
    const { stderr: installStderr } = await $`${bunExe()} i --linker=isolated`.env(bunEnv).cwd(tempdir);
    expect(installStderr.toString()).not.toContain("error");

    // Try to patch the package
    const { stderr: patchStderr, stdout: patchStdout } = await $`${bunExe()} patch is-even@1.0.0`
      .env(bunEnv)
      .cwd(tempdir)
      .throws(false);

    console.log("Patch stdout:", patchStdout.toString());
    console.log("Patch stderr:", patchStderr.toString());

    // Should not fail with errors about bad_file_mode or FileNotFound
    expect(patchStderr.toString()).not.toContain("bad_file_mode");
    expect(patchStderr.toString()).not.toContain("FileNotFound");
    expect(patchStderr.toString()).not.toContain("error overwriting folder in node_modules");
    expect(patchStderr.toString()).not.toContain("failed to parse patchfile");

    // Should indicate success
    expect(patchStdout.toString()).toContain("To patch is-even, edit the following folder:");
    expect(patchStdout.toString()).toContain("node_modules");

    // Now make a change and commit the patch
    const dummyCode = /* ts */ `
    module.exports = function isEven() {
      return 420;
    }
    `;

    await $`echo ${dummyCode} > node_modules/is-even/index.js`.env(bunEnv).cwd(tempdir);

    const { stderr: commitStderr } = await $`${bunExe()} patch --commit node_modules/is-even`
      .env(bunEnv)
      .cwd(tempdir)
      .throws(false);

    console.log("Commit stderr:", commitStderr.toString());
    expect(commitStderr.toString()).not.toContain("error");

    // Test that the patch was applied
    const { stdout } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(tempdir);
    expect(stdout.toString()).toBe("420\n");
  });

  test("should patch a package by path when installed with --linker=isolated", async () => {
    const tempdir = tempDirWithFiles("patch-isolated-path", {
      "package.json": JSON.stringify({
        "name": "bun-patch-isolated-path-test",
        "module": "index.ts",
        "type": "module",
        "dependencies": {
          "is-even": "1.0.0",
        },
      }),
      "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(420))`,
    });

    console.log("TEMPDIR", tempdir);

    // Install with isolated linker
    const { stderr: installStderr } = await $`${bunExe()} i --linker=isolated`.env(bunEnv).cwd(tempdir);
    expect(installStderr.toString()).not.toContain("error");

    // Try to patch the package by path
    const { stderr: patchStderr, stdout: patchStdout } = await $`${bunExe()} patch node_modules/is-even`
      .env(bunEnv)
      .cwd(tempdir)
      .throws(false);

    console.log("Patch stdout:", patchStdout.toString());
    console.log("Patch stderr:", patchStderr.toString());

    // Should not fail with errors about bad_file_mode or FileNotFound
    expect(patchStderr.toString()).not.toContain("bad_file_mode");
    expect(patchStderr.toString()).not.toContain("FileNotFound");
    expect(patchStderr.toString()).not.toContain("error overwriting folder in node_modules");
    expect(patchStderr.toString()).not.toContain("failed to parse patchfile");

    // Should indicate success
    expect(patchStdout.toString()).toContain("To patch is-even, edit the following folder:");
    expect(patchStdout.toString()).toContain("node_modules/is-even");

    // Now make a change and commit the patch
    const dummyCode = /* ts */ `
    module.exports = function isEven() {
      return 421;
    }
    `;

    await $`echo ${dummyCode} > node_modules/is-even/index.js`.env(bunEnv).cwd(tempdir);

    const { stderr: commitStderr } = await $`${bunExe()} patch --commit node_modules/is-even`
      .env(bunEnv)
      .cwd(tempdir)
      .throws(false);

    console.log("Commit stderr:", commitStderr.toString());
    expect(commitStderr.toString()).not.toContain("error");

    // Test that the patch was applied
    const { stdout } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(tempdir);
    expect(stdout.toString()).toBe("421\n");
  });
});
