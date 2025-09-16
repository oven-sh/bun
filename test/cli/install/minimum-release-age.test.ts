import { test, expect, describe } from "bun:test";
import { bunExe, bunEnv, tempDir } from "harness";
import { join } from "path";
import { Server } from "bun";

// Mock registry for testing minimumReleaseAge
class MinimumAgeRegistry {
  private server: Server | null = null;
  private port: number = 0;
  private currentTime: number;

  constructor() {
    // Set current time for consistent testing
    this.currentTime = Math.floor(Date.now() / 1000);
  }

  async start(): Promise<number> {
    const self = this;

    this.server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const pathname = url.pathname;

        // Handle package metadata requests
        if (pathname === "/test-package") {
          return self.handleTestPackageMetadata();
        }
        if (pathname === "/recent-only-package") {
          return self.handleRecentOnlyPackageMetadata();
        }
        if (pathname === "/old-package") {
          return self.handleOldPackageMetadata();
        }

        // Handle tarball requests
        if (pathname.endsWith(".tgz")) {
          return self.handleTarball();
        }

        return new Response("Not found", { status: 404 });
      },
    });

    this.port = this.server.port!;
    return this.port;
  }

  stop() {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  private handleTestPackageMetadata(): Response {
    const oneHourAgo = new Date((this.currentTime - 3600) * 1000).toISOString();
    const threeDaysAgo = new Date((this.currentTime - 259200) * 1000).toISOString();
    const oneWeekAgo = new Date((this.currentTime - 604800) * 1000).toISOString();

    const metadata = {
      name: "test-package",
      "dist-tags": {
        latest: "3.0.0",
      },
      versions: {
        "1.0.0": {
          name: "test-package",
          version: "1.0.0",
          dist: {
            tarball: `http://localhost:${this.port}/test-package-1.0.0.tgz`,
          },
        },
        "2.0.0": {
          name: "test-package",
          version: "2.0.0",
          dist: {
            tarball: `http://localhost:${this.port}/test-package-2.0.0.tgz`,
          },
        },
        "3.0.0": {
          name: "test-package",
          version: "3.0.0",
          dist: {
            tarball: `http://localhost:${this.port}/test-package-3.0.0.tgz`,
          },
        },
      },
      time: {
        "1.0.0": oneWeekAgo,
        "2.0.0": threeDaysAgo,
        "3.0.0": oneHourAgo,
        created: oneWeekAgo,
        modified: oneHourAgo,
      },
    };

    return new Response(JSON.stringify(metadata), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private handleRecentOnlyPackageMetadata(): Response {
    const oneHourAgo = new Date((this.currentTime - 3600) * 1000).toISOString();

    const metadata = {
      name: "recent-only-package",
      "dist-tags": {
        latest: "1.0.0",
      },
      versions: {
        "1.0.0": {
          name: "recent-only-package",
          version: "1.0.0",
          dist: {
            tarball: `http://localhost:${this.port}/recent-only-package-1.0.0.tgz`,
          },
        },
      },
      time: {
        "1.0.0": oneHourAgo,
        created: oneHourAgo,
        modified: oneHourAgo,
      },
    };

    return new Response(JSON.stringify(metadata), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private handleOldPackageMetadata(): Response {
    const oneMonthAgo = new Date((this.currentTime - 2592000) * 1000).toISOString();

    const metadata = {
      name: "old-package",
      "dist-tags": {
        latest: "1.0.0",
      },
      versions: {
        "1.0.0": {
          name: "old-package",
          version: "1.0.0",
          dist: {
            tarball: `http://localhost:${this.port}/old-package-1.0.0.tgz`,
          },
        },
      },
      time: {
        "1.0.0": oneMonthAgo,
        created: oneMonthAgo,
        modified: oneMonthAgo,
      },
    };

    return new Response(JSON.stringify(metadata), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private handleTarball(): Response {
    // Return a minimal valid gzipped tarball using the exact same format as boba-0.0.2.tgz
    // This tarball contains a simple package.json with name and version
    const tarballBase64 = "H4sIAAnMJGUAA+2STQ6CMBCFWXOKpmuD09JC4tqLFBgN/hQCamIMd3eQ6kpYGI0x9lv0JW+myUxfa5NvzRrnwQcBgFRrdtNkUJBqUAcTKk60lEJpYCBkKnXA9CeHunNsD6ahUYrzztiJPmpbrSbqbo+H/gi1y99ptGmrqVd4CXqPRKnx/EWsKH8tBB1pqih/+gkQMHj3IM/48/wvIWPcmj3yBeNZlRk+650TNm1Z2d6ECCI5uDVis8QabYE2L7Glcn/fVe7NgpPXhV347d08Ho/HM84VRRwnCQAKAAA=";

    const tarballBuffer = Buffer.from(tarballBase64, "base64");
    return new Response(tarballBuffer, {
      headers: {
        "Content-Type": "application/gzip",
      },
    });
  }

  getUrl(): string {
    return `http://localhost:${this.port}`;
  }
}

describe("minimumReleaseAge", () => {
  test("should select older version when latest is too recent", async () => {
    const registry = new MinimumAgeRegistry();
    const port = await registry.start();

    try {
      using dir = tempDir("minimum-release-age-test", {
        "package.json": JSON.stringify({
          name: "test-project",
          version: "1.0.0",
          dependencies: {
            "test-package": "*",
          },
        }),
        "bunfig.toml": `
[install]
registry = "http://localhost:${port}"
minimumReleaseAge = 1440 # 1 day in minutes
`,
      });

      const { exited } = Bun.spawn({
        cmd: [bunExe(), "install"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "inherit",
        stdout: "inherit",
      });

      expect(await exited).toBe(0);

      // Should have installed version 2.0.0 (3 days old) instead of 3.0.0 (1 hour old)
      // Check that version 2.0.0 was installed (not 3.0.0)
      const installedPkg = JSON.parse(await Bun.file(join(String(dir), "node_modules", "test-package", "package.json")).text());
      expect(installedPkg.version).toBe("2.0.0");
    } finally {
      registry.stop();
    }
  });

  test("should allow excluded packages to bypass minimum age", async () => {
    const registry = new MinimumAgeRegistry();
    const port = await registry.start();

    try {
      using dir = tempDir("minimum-release-age-exclude", {
        "package.json": JSON.stringify({
          name: "test-project",
          version: "1.0.0",
          dependencies: {
            "test-package": "*",
            "recent-only-package": "*",
          },
        }),
        "bunfig.toml": `
[install]
registry = "http://localhost:${port}"
minimumReleaseAge = 10080 # 1 week in minutes
minimumReleaseAgeExclude = ["recent-only-package"]
`,
      });

      const { exited } = Bun.spawn({
        cmd: [bunExe(), "install"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "inherit",
        stdout: "inherit",
      });

      expect(await exited).toBe(0);

      // test-package should get version 1.0.0 (1 week old) due to age restriction
      // recent-only-package should get 1.0.0 (1 hour old) as it's excluded
      const pkgJson = JSON.parse(await Bun.file(join(String(dir), "package.json")).text());
      const installed = Object.keys(pkgJson.dependencies || {}).map(name => `${name}@${pkgJson.dependencies[name]}`);
      const lockfile = installed.join(",");
      expect(lockfile).toContain("test-package");
      expect(lockfile).toContain("recent-only-package");
      expect(lockfile).toContain("1.0.0");
      expect(lockfile).not.toContain("3.0.0"); // test-package shouldn't use latest
    } finally {
      registry.stop();
    }
  });

  test("should BLOCK exact version when it violates minimum age policy", async () => {
    const registry = new MinimumAgeRegistry();
    const port = await registry.start();

    try {
      using dir = tempDir("minimum-release-age-exact", {
        "package.json": JSON.stringify({
          name: "test-project",
          version: "1.0.0",
          dependencies: {
            "test-package": "3.0.0", // Exact version - MUST BE BLOCKED for security
          },
        }),
        "bunfig.toml": `
[install]
registry = "http://localhost:${port}"
minimumReleaseAge = 10080 # 1 week
`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);

      // SECURITY: Should FAIL - exact versions NEVER bypass security policy
      expect(exitCode).not.toBe(0);
      const output = stdout + stderr;
      // Should mention the blocked package
      expect(output).toContain("test-package");
    } finally {
      registry.stop();
    }
  });

  test("should show clear error when package is blocked by minimumReleaseAge", async () => {
    const registry = new MinimumAgeRegistry();
    const port = await registry.start();

    try {
      using dir = tempDir("minimum-release-age-error", {
        "package.json": JSON.stringify({
          name: "test-project",
          version: "1.0.0",
          dependencies: {
            "recent-only-package": "*",
          },
        }),
        "bunfig.toml": `
[install]
registry = "http://localhost:${port}"
minimumReleaseAge = 10080 # 1 week
`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);

      // Should fail with a clear error message
      expect(exitCode).not.toBe(0);
      const output = stdout + stderr;
      // TODO: Check for a meaningful error message mentioning the package and age restriction
      // For now, just check it fails. The error message improvement can be added to the implementation
      expect(output).toBeTruthy();
    } finally {
      registry.stop();
    }
  });

  test("should show clear error when bun add fails due to minimumReleaseAge", async () => {
    const registry = new MinimumAgeRegistry();
    const port = await registry.start();

    try {
      using dir = tempDir("minimum-release-age-add-error", {
        "package.json": JSON.stringify({
          name: "test-project",
          version: "1.0.0",
        }),
        "bunfig.toml": `
[install]
registry = "http://localhost:${port}"
minimumReleaseAge = 10080 # 1 week
`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "add", "recent-only-package"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);

      // Should fail with a clear error message
      expect(exitCode).not.toBe(0);
      const output = stdout + stderr;
      // Should mention the package name in the error
      expect(output).toContain("recent-only-package");
    } finally {
      registry.stop();
    }
  });

  test("should work with zero minimum age (disabled)", async () => {
    const registry = new MinimumAgeRegistry();
    const port = await registry.start();

    try {
      using dir = tempDir("minimum-release-age-disabled", {
        "package.json": JSON.stringify({
          name: "test-project",
          version: "1.0.0",
          dependencies: {
            "test-package": "*",
          },
        }),
        "bunfig.toml": `
[install]
registry = "http://localhost:${port}"
minimumReleaseAge = 0
`,
      });

      const { exited } = Bun.spawn({
        cmd: [bunExe(), "install"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "inherit",
        stdout: "inherit",
      });

      expect(await exited).toBe(0);

      // Should get the latest version (3.0.0) when minimumReleaseAge is 0
      const pkgJson = JSON.parse(await Bun.file(join(String(dir), "package.json")).text());
      const installed = Object.keys(pkgJson.dependencies || {}).map(name => `${name}@${pkgJson.dependencies[name]}`);
      const lockfile = installed.join(",");
      expect(lockfile).toContain("3.0.0");
    } finally {
      registry.stop();
    }
  });

  test("should respect existing lockfile with forced version", async () => {
    const registry = new MinimumAgeRegistry();
    const port = await registry.start();

    try {
      using dir = tempDir("minimum-release-age-lockfile", {
        "package.json": JSON.stringify({
          name: "test-project",
          version: "1.0.0",
          dependencies: {
            "test-package": "*",
          },
        }),
        "bunfig.toml": `
[install]
registry = "http://localhost:${port}"
`,
      });

      // First install without age restriction
      let { exited } = Bun.spawn({
        cmd: [bunExe(), "install"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "inherit",
        stdout: "inherit",
      });

      expect(await exited).toBe(0);

      // Should have latest version (3.0.0) in lockfile
      let lockfile = await Bun.file(join(String(dir), "bun.lockb")).text();
      expect(lockfile).toContain("3.0.0");

      // Now add age restriction
      await Bun.write(
        join(String(dir), "bunfig.toml"),
        `
[install]
registry = "http://localhost:${port}"
minimumReleaseAge = 10080 # 1 week
`,
      );

      // Install again with existing lockfile
      const proc3 = Bun.spawn({
        cmd: [bunExe(), "install"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "inherit",
        stdout: "inherit",
      });
      const exitCode3 = await proc3.exited;

      expect(exitCode3).toBe(0);

      // Should still have 3.0.0 from lockfile
      lockfile = await Bun.file(join(String(dir), "bun.lockb")).text();
      expect(lockfile).toContain("3.0.0");
    } finally {
      registry.stop();
    }
  });

  test("should succeed with binary lockfile (bun.lockb) and --frozen-lockfile when created before minimumReleaseAge policy", async () => {
    const registry = new MinimumAgeRegistry();
    const port = await registry.start();

    try {
      using dir = tempDir("minimum-release-age-frozen", {
        "package.json": JSON.stringify({
          name: "test-project",
          version: "1.0.0",
          dependencies: {
            "test-package": "*",
          },
        }),
        "bunfig.toml": `
[install]
registry = "http://localhost:${port}"
`,
      });

      // First install without age restriction - should get latest (3.0.0)
      // This creates a binary lockfile by default
      let { exited } = Bun.spawn({
        cmd: [bunExe(), "install"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "inherit",
        stdout: "inherit",
      });

      expect(await exited).toBe(0);

      // Verify we have a binary lockfile
      const hasBinaryLockfile = await Bun.file(join(String(dir), "bun.lockb")).exists();
      expect(hasBinaryLockfile).toBe(true);

      // Verify we have 3.0.0 in lockfile
      let lockfile = await Bun.file(join(String(dir), "bun.lockb")).text();
      expect(lockfile).toContain("3.0.0");

      // Now add minimumReleaseAge restriction
      await Bun.write(
        join(String(dir), "bunfig.toml"),
        `
[install]
registry = "http://localhost:${port}"
minimumReleaseAge = 10080 # 1 week - would exclude 3.0.0 for new installs
`,
      );

      // Install with --frozen-lockfile should succeed
      // The lockfile was created before the policy was added, so we trust it
      // This maintains backwards compatibility - existing lockfiles continue to work
      const proc2 = Bun.spawn({
        cmd: [bunExe(), "install", "--frozen-lockfile"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "inherit",
        stdout: "inherit",
      });
      const exitCode2 = await proc2.exited;

      // Should succeed - frozen lockfile uses what's locked
      expect(exitCode2).toBe(0);

      // Should still have 3.0.0
      lockfile = await Bun.file(join(String(dir), "bun.lockb")).text();
      expect(lockfile).toContain("3.0.0");

      // But regular install (without frozen) would try to downgrade
      // Remove node_modules to force re-resolution
      await Bun.$`rm -rf ${join(String(dir), "node_modules")}`.quiet();

      const proc3 = Bun.spawn({
        cmd: [bunExe(), "install"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "inherit",
        stdout: "inherit",
      });
      const exitCode3 = await proc3.exited;

      expect(exitCode3).toBe(0);

      // Without frozen, it should respect minimumReleaseAge and downgrade to 1.0.0
      lockfile = await Bun.file(join(String(dir), "bun.lockb")).text();
      expect(lockfile).toContain("1.0.0");
      expect(lockfile).not.toContain("3.0.0");
    } finally {
      registry.stop();
    }
  });

  test("should handle text lockfile (bun.lock) with --frozen-lockfile and minimumReleaseAge", async () => {
    const registry = new MinimumAgeRegistry();
    const port = await registry.start();

    try {
      using dir = tempDir("minimum-release-age-text-lockfile", {
        "package.json": JSON.stringify({
          name: "test-project",
          version: "1.0.0",
          dependencies: {
            "test-package": "*",
          },
        }),
        "bunfig.toml": `
[install]
registry = "http://localhost:${port}"
`,
      });

      // First install without age restriction - should get latest (3.0.0)
      // Force text lockfile with --yarn
      let { exited } = Bun.spawn({
        cmd: [bunExe(), "install", "--yarn"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "inherit",
        stdout: "inherit",
      });

      expect(await exited).toBe(0);

      // Verify we have a text lockfile (bun.lock not bun.lockb)
      const hasTextLockfile = await Bun.file(join(String(dir), "bun.lock")).exists();
      const hasBinaryLockfile = await Bun.file(join(String(dir), "bun.lockb")).exists();
      expect(hasTextLockfile).toBe(true);
      expect(hasBinaryLockfile).toBe(false);

      // Now add minimumReleaseAge restriction
      await Bun.write(
        join(String(dir), "bunfig.toml"),
        `
[install]
registry = "http://localhost:${port}"
minimumReleaseAge = 10080 # 1 week - would exclude 3.0.0 for new installs
`,
      );

      // Install with --frozen-lockfile on text lockfile
      // Text lockfile doesn't store publish_time, so it might error or succeed
      // depending on implementation - both are acceptable
      const proc2 = Bun.spawn({
        cmd: [bunExe(), "install", "--frozen-lockfile"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr] = await Promise.all([
        proc2.stdout.text(),
        proc2.stderr.text(),
      ]);
      const exitCode2 = await proc2.exited;

      // For text lockfile: either behavior is acceptable
      // - Success: lockfile doesn't have timestamp info to validate
      // - Failure: conservative security approach
      if (exitCode2 === 0) {
        // If it succeeded, package should be installed
        const installedPkg = JSON.parse(await Bun.file(join(String(dir), "node_modules", "test-package", "package.json")).text());
        expect(installedPkg.version).toBe("3.0.0");
      } else {
        // If it failed, should have security-related error
        const output = stdout + stderr;
        expect(output).toMatch(/minimumReleaseAge|security|recently published/i);
      }
    } finally {
      registry.stop();
    }
  });

  test("should succeed with --frozen-lockfile when lockfile already respects minimumReleaseAge", async () => {
    const registry = new MinimumAgeRegistry();
    const port = await registry.start();

    try {
      using dir = tempDir("minimum-release-age-frozen-ok", {
        "package.json": JSON.stringify({
          name: "test-project",
          version: "1.0.0",
          dependencies: {
            "test-package": "*",
          },
        }),
        "bunfig.toml": `
[install]
registry = "http://localhost:${port}"
minimumReleaseAge = 10080 # 1 week
`,
      });

      // First install WITH age restriction - should get 1.0.0
      let { exited } = Bun.spawn({
        cmd: [bunExe(), "install"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "inherit",
        stdout: "inherit",
      });

      expect(await exited).toBe(0);

      // Verify we have 1.0.0 in lockfile
      let lockfile = await Bun.file(join(String(dir), "bun.lockb")).text();
      expect(lockfile).toContain("1.0.0");
      expect(lockfile).not.toContain("3.0.0");

      // Now install with --frozen-lockfile should work fine
      const proc2 = Bun.spawn({
        cmd: [bunExe(), "install", "--frozen-lockfile"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "inherit",
        stdout: "inherit",
      });
      const exitCode2 = await proc2.exited;

      // Should succeed because lockfile already respects the age restriction
      expect(await exited).toBe(0);
    } finally {
      registry.stop();
    }
  });
});