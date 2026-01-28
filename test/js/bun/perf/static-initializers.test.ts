import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isMacOSVersionAtLeast } from "harness";

/**
 * This test prevents startup performance regressions by ensuring that Bun has
 * only the expected number of static initializers from its own executable.
 *
 * Static initializers are functions that run automatically when a program starts, before main() is called.
 * They're used to initialize global variables and static class members, but come with performance costs:
 *
 * 1. They always execute at startup, even if the initialized values are never used
 * 2. They can't be optimized away by the compiler
 * 3. They add to the binary size
 * 4. They increase startup time
 * 5. They can introduce complex initialization order dependencies
 *
 * On macOS, we can use DYLD_PRINT_INITIALIZERS to detect static initializers.
 * This test verifies that Bun has only the expected number of static initializers.
 *
 * Adding more static initializers would degrade Bun's startup performance.
 */
describe("static initializers", () => {
  // Only macOS has DYLD_PRINT_INITIALIZERS
  // macOS 13 has a bug in dyld that crashes if you use DYLD_PRINT_INITIALIZERS
  it.skipIf(!isMacOSVersionAtLeast(14.0))("should have the expected number of static initializers", () => {
    const env = {
      ...bunEnv,
      DYLD_PRINT_INITIALIZERS: "1",
    } as const;

    const result = Bun.spawnSync({
      cmd: [bunExe(), "--version"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();

    // Check it didn't crash (and if it did, print the errors)
    try {
      expect(result.signalCode).toBeUndefined();
      expect(result.exitCode).toBe(0);
    } catch (e) {
      console.log(stderr);
      throw e;
    }

    // Verify the version was printed correctly
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/);

    // Combine stdout and stderr since DYLD_PRINT_INITIALIZERS output goes to stderr
    const output = stderr + stdout;

    // Get all lines that contain initializers from the bun executable
    const bunInitializers = output
      .split("\n")
      .map(a => a.trim())
      .filter(line => line.includes("running initializer") && line.includes(bunExe()));

    // On both architectures, we have one initializer "__GLOBAL__sub_I_static.c".
    // On arm64, mimalloc v3 adds one more static initializer (total: 2).
    // On x86_64, we also have:
    // - one from ___cpu_indicator_init due to our CPU feature detection
    // - one from mimalloc v3
    // (total: 3)
    expect(
      bunInitializers.length,
      `Do not add static initializers to Bun. Static initializers are called when Bun starts up, regardless of whether you use the variables or not. This makes Bun slower.`,
    ).toBe(process.arch === "arm64" ? 2 : 3);
  });
});
