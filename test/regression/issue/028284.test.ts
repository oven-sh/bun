import { expect, test } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// Test for https://github.com/oven-sh/bun/issues/28284
// When a GitHub dependency appears both as a direct dependency and as a transitive
// dependency (through another GitHub package), `bun install` fails intermittently
// with "failed to resolve" due to a race condition in name_hash computation.
//
// The root cause was that `realname()` returns `package_name` for GitHub deps,
// which is only populated after tarball extraction. When processing a transitive
// dependency whose tarball was already extracted via the direct dependency path,
// `package_name` could be empty, causing the wrong name_hash and a failed lookup.
test("github dependency resolves when it appears both as direct and transitive dependency", async () => {
  // package-b depends on package-c via "github:rentalhost/bun-issue-package-c"
  // package-c is also a direct dependency here
  const dir = tempDirWithFiles("028284", {
    "package.json": JSON.stringify({
      name: "repro-28284",
      private: true,
      dependencies: {
        "@rentalhost/bun-issue-package-b": "github:rentalhost/bun-issue-package-b",
        "@rentalhost/bun-issue-package-c": "github:rentalhost/bun-issue-package-c",
      },
    }),
  });

  // Run bun install multiple times to increase the chance of hitting the race condition.
  // Before the fix, this would fail ~20-50% of the time.
  for (let i = 0; i < 5; i++) {
    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
    });

    const stderrText = stderr.toString();
    expect(stderrText).not.toContain("failed to resolve");
    expect(exitCode).toBe(0);

    // Clean up for next iteration to force fresh resolution
    rmSync(join(dir, "node_modules"), { recursive: true, force: true });
    rmSync(join(dir, "bun.lock"), { force: true });
  }
}, 120_000);
