import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "node:path";

describe("bun update security scanning", () => {
  test("bun update without arguments scans all packages", async () => {
    const dir = tempDirWithFiles("update-scan-all", {
      "package.json": JSON.stringify({
        name: "test-app",
        dependencies: {
          "lodash": "^4.0.0",
          "express": "^4.0.0",
        },
      }),
      "bunfig.toml": `
[install.security]
scanner = "./scanner.js"
`,
      "scanner.js": `
let callCount = 0;
module.exports = {
  scanner: {
    version: "1",
    scan: async function(payload) {
      callCount++;
      
      // Log what packages we're scanning
      const packageNames = payload.packages.map(p => p.name).sort();
      console.error("SCAN_CALL_" + callCount + ":", JSON.stringify(packageNames));
      
      const results = [];
      for (const pkg of payload.packages) {
        if (pkg.name === "lodash") {
          results.push({
            package: "lodash",
            level: "warn",
            description: "Test warning in lodash",
            url: "https://example.com/lodash-advisory"
          });
        }
        if (pkg.name === "express") {
          results.push({
            package: "express",
            level: "warn",
            description: "Test warning in express",
            url: "https://example.com/express-advisory"
          });
        }
      }
      return results;
    }
  }
};
`,
    });

    // First install to create lockfile (temporarily disable scanner)
    const bunfigPath = join(dir, "bunfig.toml");
    const bunfigContent = await Bun.file(bunfigPath).text();
    await Bun.write(bunfigPath, ""); // Remove scanner config
    await Bun.$`${bunExe()} install`.cwd(dir).env(bunEnv).quiet();
    await Bun.write(bunfigPath, bunfigContent); // Restore scanner config

    // Now run update without arguments - should scan ALL packages
    const updateProc = Bun.spawn({
      cmd: [bunExe(), "update"],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      updateProc.stdout.text(),
      updateProc.stderr.text(),
      updateProc.exited,
    ]);

    // Should have scanned packages
    expect(stderr).toContain("SCAN_CALL_");

    // Should show vulnerabilities
    expect(stdout).toContain("WARNING: lodash");
    expect(stdout).toContain("WARNING: express");

    // Should exit with code 1 due to warnings requiring confirmation (no TTY)
    expect(exitCode).toBe(1);

    // Should show the summary
    expect(stdout).toMatch(/2 advisories \(.*2 warning.*\)/);
  });

  test("bun update with specific packages only scans those packages", async () => {
    const dir = tempDirWithFiles("update-scan-specific", {
      "package.json": JSON.stringify({
        name: "test-app",
        dependencies: {
          "lodash": "4.17.20",
          "express": "4.17.0",
          "axios": "0.21.0",
        },
      }),
      "scanner.js": `
module.exports = {
  scanner: {
    version: "1",
    scan: async function(payload) {
      // Log which packages are being scanned
      const packageNames = payload.packages.map(p => p.name);
      console.error("SCANNED_PACKAGES:", JSON.stringify(packageNames));
      
      const results = [];
      for (const pkg of payload.packages) {
        if (pkg.name === "lodash") {
          results.push({
            package: "lodash",
            level: "warn",
            description: "Test warning"
          });
        }
        if (pkg.name === "express") {
          results.push({
            package: "express",
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

    await Bun.$`${bunExe()} install`.cwd(dir).env(bunEnv).quiet();

    await Bun.write(
      join(dir, "bunfig.toml"),
      `
[install.security]
scanner = "./scanner.js"
`,
    );

    // Update only lodash - should only scan lodash and its dependencies
    const updateProc = Bun.spawn({
      cmd: [bunExe(), "update", "lodash"],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      updateProc.stdout.text(),
      updateProc.stderr.text(),
      updateProc.exited,
    ]);

    // Should have scanned packages
    expect(stderr).toContain("SCANNED_PACKAGES:");

    // Should show warning for lodash
    expect(stdout).toMatch(/WARN(ING)?.*lodash/);

    // Should NOT show fatal for express (wasn't updated)
    expect(stdout).not.toContain("FATAL: express");

    // Should exit with 1 for warnings (user needs to confirm)
    expect(exitCode).toBe(1);
  });

  test("bun update respects security scanner configuration", async () => {
    const dir = tempDirWithFiles("update-no-scanner", {
      "package.json": JSON.stringify({
        name: "test-app",
        dependencies: {
          "lodash": "^4.0.0",
        },
      }),
      // No bunfig.toml with scanner configuration
    });

    await Bun.$`${bunExe()} install`.cwd(dir).env(bunEnv).quiet();

    // Run update - should succeed without scanning
    const updateProc = Bun.spawn({
      cmd: [bunExe(), "update"],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      updateProc.stdout.text(),
      updateProc.stderr.text(),
      updateProc.exited,
    ]);

    // Should succeed
    expect(exitCode).toBe(0);

    // Should not have any security warnings
    expect(stdout).not.toContain("WARNING:");
    expect(stdout).not.toContain("FATAL:");
  });

  test("bun update aborts on fatal vulnerabilities", async () => {
    const dir = tempDirWithFiles("update-abort-fatal", {
      "package.json": JSON.stringify({
        name: "test-app",
        dependencies: {
          "lodash": "^4.0.0",
        },
      }),
      "scanner.js": `
module.exports = {
  scanner: {
    version: "1",
    scan: async function(payload) {
      return [{
        package: "lodash",
        level: "fatal",
        description: "Critical security vulnerability",
        url: "https://example.com/CVE-1234"
      }];
    }
  }
};
`,
    });

    await Bun.$`${bunExe()} install`.cwd(dir).env(bunEnv).quiet();

    await Bun.write(
      join(dir, "bunfig.toml"),
      `
[install.security]
scanner = "./scanner.js"
`,
    );

    const updateProc = Bun.spawn({
      cmd: [bunExe(), "update"],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      updateProc.stdout.text(),
      updateProc.stderr.text(),
      updateProc.exited,
    ]);

    // Should show the fatal vulnerability
    expect(stdout).toContain("FATAL: lodash");
    expect(stdout).toContain("Critical security vulnerability");

    // Should abort installation
    expect(stdout).toContain("Installation aborted due to fatal security advisories");

    // Should exit with error code
    expect(exitCode).toBe(1);
  });

  test.todo("bun update prompts for warnings when TTY available - requires TTY for interactive prompt", async () => {
    const dir = tempDirWithFiles("update-prompt-warnings", {
      "package.json": JSON.stringify({
        name: "test-app",
        dependencies: {
          "lodash": "^4.0.0",
        },
      }),
      "bunfig.toml": `
[install.security]  
scanner = "./scanner.js"
`,
      "scanner.js": `
module.exports = {
  scanner: {
    version: "1",
    scan: async function(payload) {
      return [{
        package: "lodash",
        level: "warn",
        description: "Minor security issue"
      }];
    }
  }
};
`,
    });

    await Bun.$`${bunExe()} install`.cwd(dir).env(bunEnv).quiet();

    // Run update with stdin to simulate TTY
    const updateProc = Bun.spawn({
      cmd: [bunExe(), "update"],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env: { ...bunEnv, FORCE_COLOR: "1" }, // Force color to simulate TTY
    });

    // Send 'y' to continue
    updateProc.stdin.write("y\n");
    updateProc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([
      updateProc.stdout.text(),
      updateProc.stderr.text(),
      updateProc.exited,
    ]);

    // Should show warning (with or without ANSI codes)
    expect(stdout).toMatch(/WARN(ING)?.*lodash/);

    // Should prompt for confirmation
    expect(stdout).toContain("Security warnings found");
    expect(stdout).toContain("Continue anyway?");

    // Should continue after user confirmation
    expect(stdout).toContain("Continuing with installation");
    expect(exitCode).toBe(0);
  });

  test("bun update shows dependency paths correctly", async () => {
    const dir = tempDirWithFiles("update-dep-paths", {
      "package.json": JSON.stringify({
        name: "my-app",
        dependencies: {
          "express": "^4.0.0",
        },
      }),
      "scanner.js": `
module.exports = {
  scanner: {
    version: "1",
    scan: async function(payload) {
      const results = [];
      for (const pkg of payload.packages) {
        // Flag a transitive dependency
        if (pkg.name === "body-parser") {
          results.push({
            package: "body-parser",
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

    await Bun.$`${bunExe()} install`.cwd(dir).env(bunEnv).quiet();

    await Bun.write(
      join(dir, "bunfig.toml"),
      `
[install.security]
scanner = "./scanner.js"
`,
    );

    const updateProc = Bun.spawn({
      cmd: [bunExe(), "update"],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env: bunEnv,
    });

    // Send 'n' to not continue
    updateProc.stdin.write("n\n");
    updateProc.stdin.end();

    const [stdout] = await Promise.all([updateProc.stdout.text(), updateProc.stderr.text(), updateProc.exited]);

    // Should show the full dependency path
    expect(stdout).toContain("WARNING: body-parser");
    expect(stdout).toContain("via my-app › express › body-parser");
  });
});
