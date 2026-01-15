// Regression test for https://github.com/oven-sh/bun/issues/26076
// Peer dependency warnings should be more helpful by showing:
// 1. The full dependency path from root to the package requiring the peer dependency
// 2. What version range was expected
// 3. What version was actually installed
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, VerdaccioRegistry } from "harness";
import { join } from "path";

let registry: VerdaccioRegistry;
let packageDir: string;

beforeAll(async () => {
  registry = new VerdaccioRegistry();
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe("issue #26076 - peer dependency warnings", () => {
  test("warning message shows dependency path, expected version, and actual version", async () => {
    // Create test directory with registry configured
    // The registry already has:
    // - no-deps@1.0.0 and no-deps@2.0.0
    // - peer-deps-fixed@1.0.0 which has peerDependencies: { "no-deps": "^1.0.0" }
    // Installing no-deps@2.0.0 should trigger warning because peer-deps-fixed needs ^1.0.0
    ({ packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "test-peer-deps",
          version: "1.0.0",
          dependencies: {
            "no-deps": "2.0.0",
            "peer-deps-fixed": "1.0.0",
          },
        }),
      },
    }));

    const env = {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache"),
    };

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env,
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Await stdout/stderr BEFORE exited for better error messages on failure
    const stdout = await proc.stdout.text();
    const stderr = await proc.stderr.text();
    const exitCode = await proc.exited;

    // The warning should show:
    // 1. The package with unmet peer dependency: "peer-deps-fixed"
    // 2. The unmet peer dependency with expected version: "no-deps@^1.0.0"
    // 3. The actual version found: "(found 2.0.0)"
    //
    // Full format: "warn: (root) > peer-deps-fixed has unmet peer dependency no-deps@^1.0.0 (found 2.0.0)"

    // Check for the "unmet peer dependency" message
    expect(stderr).toContain("has unmet peer dependency");

    // Check for expected vs actual version
    expect(stderr).toContain("no-deps@^1.0.0");
    expect(stderr).toContain("(found 2.0.0)");

    // Verify the full format with regex - supports dependency paths like "(root) > peer-deps-fixed"
    // Pattern matches: "warn: ... has unmet peer dependency <dep>@<version> (found <version>)"
    // Use [^\n]* to match any characters in the dependency path (including parentheses, >, spaces)
    expect(stderr).toMatch(/(?:warn:\s*)?[^\n]+ has unmet peer dependency [@\w./-]+@\S+ \(found \S+\)/);

    expect(exitCode).toBe(0);
  });
});
