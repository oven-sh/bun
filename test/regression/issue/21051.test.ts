import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("issue #21051 - bun install crash with workspace project containing bin entries", () => {
  it("should install workspace project with bin dependencies without crashing", async () => {
    using dir = tempDir("issue-21051", {
      "package.json": JSON.stringify({
        name: "test-workspace",
        workspaces: ["packages/*"],
        dependencies: {
          semver: "7.7.2",
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("Saved lockfile");
    expect(stdout).toContain("semver");
    expect(exitCode).toBe(0);
  });
});
