import { write } from "bun";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { tmpdir } from "os";
import { join } from "path";

describe("workspace symlinks", () => {
  test("should follow symlinked workspace packages by default", async () => {
    using rootDir = tempDir("workspace-symlink-test", {});
    const rootPath = String(rootDir);

    // Create a real workspace package outside the main directory
    const externalWorkspaceDir = join(tmpdir(), `bun-test-external-workspace-${Date.now()}`);
    mkdirSync(externalWorkspaceDir, { recursive: true });

    try {
      // Write the external workspace package.json
      await write(
        join(externalWorkspaceDir, "package.json"),
        JSON.stringify({
          name: "backend",
          version: "1.0.0",
        }),
      );

      // Create the root package.json with workspace pattern
      await write(
        join(rootPath, "package.json"),
        JSON.stringify({
          name: "monorepo",
          version: "1.0.0",
          workspaces: ["./*"],
          dependencies: {
            backend: "workspace:*",
          },
        }),
      );

      // Create a symlink to the external workspace
      const symlinkPath = join(rootPath, "backend");

      if (isWindows) {
        // Windows requires different symlink flags
        symlinkSync(externalWorkspaceDir, symlinkPath, "junction");
      } else {
        symlinkSync(externalWorkspaceDir, symlinkPath, "dir");
      }

      // Verify symlink was created
      expect(existsSync(symlinkPath)).toBe(true);

      // Run bun install
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: rootPath,
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // The installation should succeed
      expect(stderr).not.toContain('Workspace dependency "backend" not found');
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);

      // Verify the workspace was linked
      const nodeModulesBackend = join(rootPath, "node_modules", "backend");
      expect(existsSync(nodeModulesBackend)).toBe(true);
    } finally {
      // Cleanup external workspace directory
      if (existsSync(externalWorkspaceDir)) {
        await Bun.$`rm -rf ${externalWorkspaceDir}`.quiet();
      }
    }
  });

  test("should not follow symlinked workspaces when followWorkspaceSymlinks is false", async () => {
    using rootDir = tempDir("workspace-symlink-disabled-test", {});
    const rootPath = String(rootDir);

    // Create a real workspace package outside the main directory
    const externalWorkspaceDir = join(tmpdir(), `bun-test-external-workspace-${Date.now()}`);
    mkdirSync(externalWorkspaceDir, { recursive: true });

    try {
      // Write the external workspace package.json
      await write(
        join(externalWorkspaceDir, "package.json"),
        JSON.stringify({
          name: "backend",
          version: "1.0.0",
        }),
      );

      // Create bunfig.toml to disable symlink following
      await write(
        join(rootPath, "bunfig.toml"),
        `[install]
followWorkspaceSymlinks = false
`,
      );

      // Create the root package.json with workspace pattern
      await write(
        join(rootPath, "package.json"),
        JSON.stringify({
          name: "monorepo",
          version: "1.0.0",
          workspaces: ["./*"],
          dependencies: {
            backend: "workspace:*",
          },
        }),
      );

      // Create a symlink to the external workspace
      const symlinkPath = join(rootPath, "backend");

      if (isWindows) {
        symlinkSync(externalWorkspaceDir, symlinkPath, "junction");
      } else {
        symlinkSync(externalWorkspaceDir, symlinkPath, "dir");
      }

      // Verify symlink was created
      expect(existsSync(symlinkPath)).toBe(true);

      // Run bun install - this should fail because we disabled symlink following
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: rootPath,
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // The installation should fail with the workspace not found error
      expect(stderr).toContain('Workspace dependency "backend" not found');
      expect(exitCode).not.toBe(0);
    } finally {
      // Cleanup external workspace directory
      if (existsSync(externalWorkspaceDir)) {
        await Bun.$`rm -rf ${externalWorkspaceDir}`.quiet();
      }
    }
  });
});
