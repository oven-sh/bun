import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isMacOS } from "harness";

/**
 * This test prevents startup performance regressions by ensuring that Bun has
 * exactly one static initializer from its own executable.
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
 * This test verifies that Bun has exactly one static initializer from its own executable.
 *
 * Adding more static initializers would degrade Bun's startup performance.
 */
describe("static initializers", () => {
  // Only macOS has DYLD_PRINT_INITIALIZERS
  it.skipIf(!isMacOS || process.arch !== "arm64")("should only have one static initializer from bun itself", () => {
    const env = {
      ...bunEnv,
      DYLD_PRINT_INITIALIZERS: "1",
    } as const;

    const result = Bun.spawnSync({
      cmd: [bunExe(), "--version"],
      env,
    });

    expect(result.exitCode).toBe(0);

    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();

    // Combine stdout and stderr since DYLD_PRINT_INITIALIZERS output goes to stderr
    const output = stderr + stdout;

    // Get all lines that contain initializers from the bun executable
    const bunInitializers = output
      .split("\n")
      .map(a => a.trim())
      .filter(line => line.includes("running initializer") && line.includes(bunExe()));

    // We expect exactly one initializer from the bun executable itself
    expect(
      bunInitializers.length,
      `Do not add static initializers to Bun. Static initializers are called when Bun starts up, regardless of whether you use the variables or not. This makes Bun slower.`,
    ).toBe(1);

    // Verify the version was printed correctly
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/);
  });
});
