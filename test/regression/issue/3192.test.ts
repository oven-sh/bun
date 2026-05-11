import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("issue #3192", () => {
  test("yarn lockfile quotes workspace:* versions correctly", async () => {
    using dir = tempDir("issue-3192", {
      "package.json": JSON.stringify({
        name: "workspace-root",
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/package-a/package.json": JSON.stringify({
        name: "package-a",
        version: "1.0.0",
        dependencies: {
          "package-b": "workspace:*",
        },
      }),
      "packages/package-b/package.json": JSON.stringify({
        name: "package-b",
        version: "1.0.0",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--yarn"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    // Read the generated yarn.lock
    const yarnLock = await Bun.file(`${dir}/yarn.lock`).text();

    // The workspace:* version should be quoted
    // Bad output: "package-b@packages/package-b", package-b@workspace:*:
    // Good output: "package-b@packages/package-b", "package-b@workspace:*":
    expect(yarnLock).toContain('"package-b@workspace:*"');
    expect(yarnLock).not.toMatch(/package-b@workspace:\*[^"]/);
  });
});
