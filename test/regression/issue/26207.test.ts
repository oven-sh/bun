// https://github.com/oven-sh/bun/issues/26207
// bun run --filter and --workspaces should fall back to bun's node symlink
// when NODE env var points to a non-existent path

import { describe, expect, test } from "bun:test";
import { chmodSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// These cases must stay serial: every one forces the fake-node fallback and in
// debug builds `create_fake_temporary_node_executable` wipes the shared
// `bun-node-debug` temp dir before recreating it, so concurrent runs can race
// on that delete/recreate sequence.
describe("issue 26207", () => {
  test.each([
    ["--workspaces", ["--workspaces"]],
    ["--filter", ["--filter", "*"]],
  ])("bun run %s creates node symlink when NODE env points to non-existent path", async (_label, flags) => {
    await using dir = tempDir("26207-node-fallback", {
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
      }),
      "packages/a/package.json": JSON.stringify({
        name: "a",
        scripts: {
          test: "node -e \"console.log('node works')\"",
        },
      }),
    });

    // Set NODE to a non-existent path and remove system node from PATH
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", ...flags, "test"],
      env: {
        ...bunEnv,
        NODE: "/nonexistent/path/to/node",
        PATH: "/usr/bin", // PATH without node
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should succeed because bun creates a symlink to its own node
    expect(stderr).toBe("");
    expect(stdout).toContain("node works");
    expect(exitCode).toBe(0);
  });

  // Skip on Windows: shebang scripts (#!/usr/bin/env node) are Unix-specific
  test.skipIf(isWindows)("bun run --workspaces runs scripts that have #!/usr/bin/env node shebang", async () => {
    await using dir = tempDir("26207-shebang", {
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
      }),
      "packages/a/package.json": JSON.stringify({
        name: "a",
        scripts: {
          build: "./build.js",
        },
      }),
      // Create an executable script with node shebang
      "packages/a/build.js": "#!/usr/bin/env node\nconsole.log('build script ran');",
    });

    // Make the script executable
    chmodSync(`${dir}/packages/a/build.js`, 0o755);

    // Remove system node from PATH, and clear NODE/npm_node_execpath to avoid
    // interfering with bun's node symlink creation
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--workspaces", "build"],
      env: {
        ...bunEnv,
        NODE: undefined,
        npm_node_execpath: undefined,
        PATH: "/usr/bin", // PATH without node
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should succeed because bun creates a symlink to its own node
    expect(stderr).toBe("");
    expect(stdout).toContain("build script ran");
    expect(exitCode).toBe(0);
  });
});
