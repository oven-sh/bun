import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";

describe("issue #25855 - shell .env() PATH should affect command resolution", () => {
  test("command resolution uses PATH from .env()", async () => {
    // Create a temp directory with a test executable
    using dir = tempDir("bun-path-test", {});
    const binDir = `${dir}/bin`;
    await $`mkdir -p ${binDir}`.quiet();

    // Create a simple test script
    const testBinary = `${binDir}/mytest25855`;
    await Bun.write(testBinary, '#!/bin/bash\necho "hello from mytest25855"');
    await $`chmod +x ${testBinary}`.quiet();

    // Create enhanced PATH with our bin directory prepended
    const enhancedPath = `${binDir}:${process.env.PATH}`;

    // Test: Direct command execution should find the binary via enhanced PATH
    const execResult = await $`mytest25855`.env({ ...bunEnv, PATH: enhancedPath }).quiet();
    expect(execResult.stdout.toString().trim()).toBe("hello from mytest25855");
    expect(execResult.exitCode).toBe(0);
  });

  test("which builtin and command execution use same PATH", async () => {
    // Create a temp directory with a test executable
    using dir = tempDir("bun-path-test", {});
    const binDir = `${dir}/bin`;
    await $`mkdir -p ${binDir}`.quiet();

    // Create a simple test script
    const testBinary = `${binDir}/whichtest25855`;
    await Bun.write(testBinary, '#!/bin/bash\necho "found me"');
    await $`chmod +x ${testBinary}`.quiet();

    // Create enhanced PATH
    const enhancedPath = `${binDir}:${process.env.PATH}`;
    const envWithPath = { ...bunEnv, PATH: enhancedPath };

    // Both which and direct execution should work with the same PATH
    const whichResult = await $`which whichtest25855`.env(envWithPath).quiet();
    expect(whichResult.stdout.toString().trim()).toBe(testBinary);

    const execResult = await $`whichtest25855`.env(envWithPath).quiet();
    expect(execResult.stdout.toString().trim()).toBe("found me");
  });

  test("command not in custom PATH still fails appropriately", async () => {
    // Use a PATH that doesn't include standard directories
    using dir = tempDir("bun-path-test", {});
    const emptyPath = String(dir);

    // Note: ls, cat, echo, etc. are shell builtins in bun, so they'll work without PATH.
    // We use 'node' as an example of a real external command that won't be a builtin.
    const result = await $`node --version`
      .env({ ...bunEnv, PATH: emptyPath })
      .nothrow()
      .quiet();
    expect(result.exitCode).not.toBe(0);
  });
});
