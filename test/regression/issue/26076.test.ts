// Regression test for https://github.com/oven-sh/bun/issues/26076
// Peer dependency warnings should be more helpful by showing:
// 1. The full dependency path from root to the package requiring the peer dependency
// 2. What version range was expected
// 3. What version was actually installed
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// This test downloads packages from npm, so we need a longer timeout
setDefaultTimeout(60000);

describe("issue #26076 - peer dependency warnings", () => {
  test("warning message shows dependency path, expected version, and actual version", async () => {
    // Create a temp directory with packages that have peer dependency conflicts
    using dir = tempDir("issue-26076", {
      "package.json": JSON.stringify({
        name: "test-peer-deps",
        version: "1.0.0",
        dependencies: {
          "react": "17.0.0",
          "@testing-library/react": "12.1.5",
        },
      }),
    });

    // Use a fresh cache directory to ensure packages are downloaded
    const cacheDir = join(String(dir), ".bun-cache");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: cacheDir,
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The warning should show:
    // 1. The dependency path: "(root) > @testing-library/react > react-dom"
    // 2. The unmet peer dependency with expected version: "react@17.0.2"
    // 3. The actual version found: "(found 17.0.0)"
    //
    // Full format: "(root) > @testing-library/react > react-dom has unmet peer dependency react@17.0.2 (found 17.0.0)"
    //
    // This is MORE helpful than pnpm's format because it shows the full path in a single line

    // Check for dependency path
    expect(stderr).toContain("@testing-library/react");
    expect(stderr).toContain("react-dom");

    // Check for the "unmet peer dependency" message
    expect(stderr).toContain("has unmet peer dependency");

    // Check for expected vs actual version
    expect(stderr).toContain("react@17.0.2");
    expect(stderr).toContain("(found 17.0.0)");

    // Verify the full format with regex
    expect(stderr).toMatch(
      /.*@testing-library\/react.*react-dom has unmet peer dependency react@[\d.]+ \(found [\d.]+\)/,
    );

    expect(exitCode).toBe(0);
  });
});
