// Regression test for https://github.com/oven-sh/bun/issues/26076
// Peer dependency warnings should be more helpful by showing:
// 1. The full dependency path from root to the package requiring the peer dependency
// 2. What version range was expected
// 3. What version was actually installed
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles, VerdaccioRegistry } from "harness";

describe("issue #26076 - peer dependency warnings", () => {
  test("warning message shows dependency path, expected version, and actual version", async () => {
    // Use a local registry to avoid network dependencies
    using registry = new VerdaccioRegistry();
    await registry.start();

    // Create packages that have peer dependency conflicts:
    // - peer-deps-fixed requires no-deps@^1.0.0 as a peer dependency
    // - But we install no-deps@2.0.0 which doesn't satisfy ^1.0.0

    // First, publish the packages we need to the local registry
    // no-deps@1.0.0
    const noDeps100Dir = tempDirWithFiles("no-deps-1.0.0", {
      "package.json": JSON.stringify({
        name: "no-deps",
        version: "1.0.0",
      }),
    });
    await registry.publish(noDeps100Dir, "no-deps", bunEnv);

    // no-deps@2.0.0
    const noDeps200Dir = tempDirWithFiles("no-deps-2.0.0", {
      "package.json": JSON.stringify({
        name: "no-deps",
        version: "2.0.0",
      }),
    });
    await registry.publish(noDeps200Dir, "no-deps", bunEnv);

    // peer-deps-fixed@1.0.0 - has peer dependency on no-deps@^1.0.0
    const peerDepsDir = tempDirWithFiles("peer-deps-fixed", {
      "package.json": JSON.stringify({
        name: "peer-deps-fixed",
        version: "1.0.0",
        peerDependencies: {
          "no-deps": "^1.0.0",
        },
      }),
    });
    await registry.publish(peerDepsDir, "peer-deps-fixed", bunEnv);

    // Create the test project that will trigger the warning
    // Installing no-deps@2.0.0 should trigger warning because peer-deps-fixed needs ^1.0.0
    const projectDir = tempDirWithFiles("test-project", {
      "package.json": JSON.stringify({
        name: "test-peer-deps",
        version: "1.0.0",
        dependencies: {
          "no-deps": "2.0.0",
          "peer-deps-fixed": "1.0.0",
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: registry.withTestEnv(bunEnv),
      cwd: projectDir,
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

    // Verify the full format with regex - supports scoped packages and hyphenated names
    // Pattern matches: "warn: ... <package-name> has unmet peer dependency <dep>@<version> (found <version>)"
    expect(stderr).toMatch(/(?:warn:\s*)?[@\w./-]+ has unmet peer dependency [@\w./-]+@\S+ \(found \S+\)/);

    expect(exitCode).toBe(0);
  });
});
