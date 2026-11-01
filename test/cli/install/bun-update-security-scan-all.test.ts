import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { startRegistry, stopRegistry } from "./simple-dummy-registry";

let registryUrl: string;

beforeAll(async () => {
  registryUrl = await startRegistry(false);
});

afterAll(() => {
  stopRegistry();
});

function bunfig({ scanner }: { scanner: boolean }) {
  let text = `[install]
cache = false
registry = "${registryUrl}/"
`;
  if (scanner) {
    text += `
[install.security]
scanner = "./scanner.js"
`;
  }
  return text;
}

async function primeInstall(dir: string) {
  await Bun.write(join(dir, "bunfig.toml"), bunfig({ scanner: false }));
  await Bun.$`${bunExe()} install`.cwd(dir).env(bunEnv).quiet();
  await Bun.write(join(dir, "bunfig.toml"), bunfig({ scanner: true }));
}

// Each test spawns two debug-build bun processes (install + update) and they run
// concurrently, so per-test wall time is higher under CPU contention even though
// total wall time drops. Matches bun-install-security-provider.test.ts.
const timeout = 30_000;

describe.concurrent("bun update security scanning", () => {
  test(
    "bun update without arguments scans all packages",
    async () => {
      await using dir = tempDir("update-scan-all", {
        "package.json": JSON.stringify({
          name: "test-app",
          dependencies: {
            "left-pad": "1.3.0",
            "is-even": "1.0.0",
          },
        }),
        "scanner.js": `
let callCount = 0;
module.exports = {
  scanner: {
    version: "1",
    scan: async function(payload) {
      callCount++;
      const packageNames = payload.packages.map(p => p.name).sort();
      console.error("SCAN_CALL_" + callCount + ":", JSON.stringify(packageNames));
      const results = [];
      for (const pkg of payload.packages) {
        if (pkg.name === "left-pad") {
          results.push({
            package: "left-pad",
            level: "warn",
            description: "Test warning in left-pad",
            url: "https://example.com/left-pad-advisory"
          });
        }
        if (pkg.name === "is-even") {
          results.push({
            package: "is-even",
            level: "warn",
            description: "Test warning in is-even",
            url: "https://example.com/is-even-advisory"
          });
        }
      }
      return results;
    }
  }
};
`,
      });

      await primeInstall(String(dir));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "update"],
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // The scanner ran once and received every package in the graph.
      expect(stderr).toContain(`SCAN_CALL_1: ["is-even","is-odd","left-pad"]`);
      expect(stderr).not.toContain("SCAN_CALL_2:");

      expect(stdout).toContain("WARNING: left-pad");
      expect(stdout).toContain("Test warning in left-pad");
      expect(stdout).toContain("WARNING: is-even");
      expect(stdout).toContain("Test warning in is-even");
      expect(stdout).toMatch(/2 advisories \(.*2 warning.*\)/);

      // Warnings require confirmation; with no TTY the update is cancelled.
      expect(stdout).toContain("Installation cancelled");
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "bun update with specific packages only scans those packages",
    async () => {
      await using dir = tempDir("update-scan-specific", {
        "package.json": JSON.stringify({
          name: "test-app",
          dependencies: {
            "left-pad": "1.3.0",
            "is-even": "1.0.0",
          },
        }),
        "scanner.js": `
module.exports = {
  scanner: {
    version: "1",
    scan: async function(payload) {
      const packageNames = payload.packages.map(p => p.name).sort();
      console.error("SCANNED_PACKAGES:", JSON.stringify(packageNames));
      const results = [];
      for (const pkg of payload.packages) {
        if (pkg.name === "left-pad") {
          results.push({
            package: "left-pad",
            level: "warn",
            description: "Test warning"
          });
        }
        if (pkg.name === "is-even") {
          results.push({
            package: "is-even",
            level: "fatal",
            description: "Should not see this"
          });
        }
      }
      return results;
    }
  }
};
`,
      });

      await primeInstall(String(dir));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "update", "left-pad"],
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Only the requested package is sent to the scanner.
      expect(stderr).toContain(`SCANNED_PACKAGES: ["left-pad"]`);
      expect(stdout).toContain("WARNING: left-pad");
      expect(stdout).toContain("Test warning");

      // is-even was not part of this update, so its fatal advisory must not surface.
      expect(stdout).not.toContain("FATAL: is-even");
      expect(stdout).not.toContain("Should not see this");

      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "bun update respects security scanner configuration",
    async () => {
      await using dir = tempDir("update-no-scanner", {
        "package.json": JSON.stringify({
          name: "test-app",
          dependencies: {
            "left-pad": "1.3.0",
          },
        }),
      });

      await Bun.write(join(String(dir), "bunfig.toml"), bunfig({ scanner: false }));
      await Bun.$`${bunExe()} install`.cwd(String(dir)).env(bunEnv).quiet();

      await using proc = Bun.spawn({
        cmd: [bunExe(), "update"],
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).not.toContain("WARNING:");
      expect(stdout).not.toContain("FATAL:");
      expect(stderr).not.toContain("Scanning");
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "bun update aborts on fatal vulnerabilities",
    async () => {
      await using dir = tempDir("update-abort-fatal", {
        "package.json": JSON.stringify({
          name: "test-app",
          dependencies: {
            "left-pad": "1.3.0",
          },
        }),
        "scanner.js": `
module.exports = {
  scanner: {
    version: "1",
    scan: async function(payload) {
      return [{
        package: "left-pad",
        level: "fatal",
        description: "Critical security vulnerability",
        url: "https://example.com/CVE-1234"
      }];
    }
  }
};
`,
      });

      await primeInstall(String(dir));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "update"],
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("FATAL: left-pad");
      expect(stdout).toContain("Critical security vulnerability");
      expect(stdout).toContain("https://example.com/CVE-1234");
      expect(stdout).toContain("Installation aborted due to fatal security advisories");
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test.todo("bun update prompts for warnings when TTY available - requires TTY for interactive prompt");

  test(
    "bun update shows dependency paths correctly",
    async () => {
      await using dir = tempDir("update-dep-paths", {
        "package.json": JSON.stringify({
          name: "my-app",
          dependencies: {
            "is-even": "1.0.0",
          },
        }),
        "scanner.js": `
module.exports = {
  scanner: {
    version: "1",
    scan: async function(payload) {
      const results = [];
      for (const pkg of payload.packages) {
        if (pkg.name === "is-odd") {
          results.push({
            package: "is-odd",
            level: "warn",
            description: "Transitive vulnerability"
          });
        }
      }
      return results;
    }
  }
};
`,
      });

      await primeInstall(String(dir));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "update"],
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("WARNING: is-odd");
      expect(stdout).toContain("Transitive vulnerability");
      expect(stdout).toContain("via my-app › is-even › is-odd");
      expect(exitCode).toBe(1);
    },
    timeout,
  );
});
