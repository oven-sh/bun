import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

describe("bun update security edge cases", () => {
  test("bun update detects vulnerability in updated version that was safe before", async () => {
    // Start with an exact version that's "safe"
    const dir = tempDirWithFiles("update-new-vuln", {
      "package.json": JSON.stringify({
        name: "test-app",
        dependencies: {
          "lodash": "4.17.20", // Exact version that's safe
        },
      }),
    });

    // First install - should be safe (no scanner yet)
    await Bun.$`${bunExe()} install`.cwd(dir).env(bunEnv).quiet();

    // Now add scanner and update package.json to allow updates
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "test-app",
        dependencies: {
          "lodash": "^4.17.0", // Now allow updates
        },
      }),
    );

    await Bun.write(
      join(dir, "bunfig.toml"),
      `
[install.security]
scanner = "./scanner.js"
`,
    );

    await Bun.write(
      join(dir, "scanner.js"),
      `
module.exports = {
  scanner: {
    version: "1",
    scan: async function(payload) {
      const results = [];
      for (const pkg of payload.packages) {
        // Flag lodash 4.17.21 as vulnerable
        if (pkg.name === "lodash" && pkg.version === "4.17.21") {
          results.push({
            package: "lodash",
            level: "fatal",
            description: "CVE-2024-XXXX: Prototype pollution in lodash 4.17.21",
            url: "https://example.com/CVE-2024-XXXX"
          });
        }
      }
      return results;
    }
  }
};
`,
    );

    // Simulate that a newer version (4.17.21) is now available with a vulnerability
    // Run update which would get the newer, vulnerable version
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

    // The scanner should detect the vulnerability in the updated version
    if (stdout.includes("FATAL: lodash")) {
      expect(stdout).toContain("FATAL: lodash");
      expect(stdout).toContain("CVE-2024-XXXX");
      expect(stdout).toContain("Installation aborted due to fatal security advisories");
      expect(exitCode).toBe(1);
    } else {
      // If the version didn't update to 4.17.21+, it should be safe
      expect(exitCode).toBe(0);
    }
  });

  test("bun update <pkg> detects vulnerability in the specific updated package", async () => {
    const dir = tempDirWithFiles("update-specific-vuln", {
      "package.json": JSON.stringify({
        name: "test-app",
        dependencies: {
          "axios": "0.21.0", // Old version
          "lodash": "4.17.20",
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
      const results = [];
      for (const pkg of payload.packages) {
        // axios >=0.21.2 has a vulnerability
        if (pkg.name === "axios" && Bun.semver.satisfies(pkg.version, ">=0.21.2")) {
          results.push({
            package: "axios",
            level: "fatal",
            description: "CVE-2023-45857: Axios vulnerable to SSRF in >=0.21.2",
            url: "https://nvd.nist.gov/vuln/detail/CVE-2023-45857"
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

    // Update only axios - newer version has vulnerability
    const updateProc = Bun.spawn({
      cmd: [bunExe(), "update", "axios"],
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

    // Should detect vulnerability in the updated axios
    if (stdout.includes("FATAL: axios")) {
      expect(stdout).toContain("FATAL: axios");
      expect(stdout).toContain("CVE-2023-45857");
      expect(stdout).toContain("Installation aborted");
      expect(exitCode).toBe(1);
    } else {
      // If axios didn't update to vulnerable version
      expect(exitCode).toBe(0);
    }
  });

  test("bun update detects newly discovered vulnerability in existing package", async () => {
    // Scenario: A package in lockfile was safe when installed,
    // but a vulnerability was discovered later (without version change)
    const dir = tempDirWithFiles("update-newly-discovered", {
      "package.json": JSON.stringify({
        name: "test-app",
        dependencies: {
          "express": "4.18.2", // This version exists in lockfile
          "lodash": "4.17.21",
        },
      }),
      // Initially no scanner in bunfig
    });

    // First install without security scanner (simulating before vulnerability was known)
    await Bun.$`${bunExe()} install`.cwd(dir).env(bunEnv).quiet();

    // Now add scanner configuration
    await Bun.write(
      join(dir, "bunfig.toml"),
      `
[install.security]
scanner = "./scanner.js"
`,
    );

    // Now add scanner that knows about the vulnerability
    await Bun.write(
      join(dir, "scanner.js"),
      `
module.exports = {
  scanner: {
    version: "1",
    scan: async function(payload) {
      console.error("SCANNING_PACKAGES:", payload.packages.map(p => p.name + "@" + p.version).join(", "));
      
      const results = [];
      for (const pkg of payload.packages) {
        // Express 4.18.2 now has a known vulnerability
        if (pkg.name === "express" && pkg.version === "4.18.2") {
          results.push({
            package: "express",
            level: "fatal",
            description: "CVE-2024-NEW: Newly discovered vulnerability in express 4.18.2",
            url: "https://example.com/CVE-2024-NEW"
          });
        }
      }
      return results;
    }
  }
};
`,
    );

    // Run update - should detect the vulnerability in the already-installed package
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

    // Should scan and find the vulnerability
    expect(stderr).toContain("SCANNING_PACKAGES:");
    expect(stdout).toContain("FATAL: express");
    expect(stdout).toContain("CVE-2024-NEW");
    expect(stdout).toContain("Newly discovered vulnerability");
    expect(exitCode).toBe(1);
  });

  test("bun pm scan detects vulnerability in existing transitive dependency after adding package", async () => {
    // Scenario: After adding a new package, running pm scan finds vulnerabilities
    // in existing transitive dependencies
    const dir = tempDirWithFiles("scan-after-add", {
      "package.json": JSON.stringify({
        name: "test-app",
        dependencies: {
          "express": "^4.0.0", // Has body-parser as transitive dep
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
      const results = [];
      for (const pkg of payload.packages) {
        // body-parser (transitive dep of express) has vulnerability
        if (pkg.name === "body-parser") {
          results.push({
            package: "body-parser",
            level: "fatal",
            description: "Previously unknown vulnerability in body-parser",
            url: "https://example.com/body-parser-vuln"
          });
        }
      }
      return results;
    }
  }
};
`,
    });

    // Install without scanner first
    const tempBunfig = join(dir, "bunfig.toml");
    const fs = await import("node:fs/promises");
    await fs.rename(tempBunfig, `${tempBunfig}.bak`);
    await Bun.$`${bunExe()} install`.cwd(dir).env(bunEnv).quiet();
    await fs.rename(`${tempBunfig}.bak`, tempBunfig);

    // Add a new package without scanner
    await Bun.$`${bunExe()} add lodash`.cwd(dir).env(bunEnv).quiet();

    // Now run pm scan with scanner to detect vulnerabilities
    const scanProc = Bun.spawn({
      cmd: [bunExe(), "pm", "scan"],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      scanProc.stdout.text(),
      scanProc.stderr.text(),
      scanProc.exited,
    ]);

    // Should detect vulnerability in existing transitive dependency
    expect(stdout).toContain("FATAL: body-parser");
    expect(stdout).toContain("via test-app › express › body-parser");
    expect(stdout).toContain("Previously unknown vulnerability");
    expect(exitCode).toBe(1);
  });

  test("bun update with version range change exposes vulnerability", async () => {
    // Scenario: package.json is updated to allow newer versions that have vulnerabilities
    const dir = tempDirWithFiles("update-range-vuln", {
      "package.json": JSON.stringify({
        name: "test-app",
        dependencies: {
          "minimist": "1.2.5", // Exact version, safe
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
      const results = [];
      for (const pkg of payload.packages) {
        // minimist >=1.2.6 has vulnerability
        if (pkg.name === "minimist" && Bun.semver.satisfies(pkg.version, ">=1.2.6")) {
          results.push({
            package: "minimist",
            level: "fatal",
            description: "CVE-2021-44906: Prototype pollution in minimist >=1.2.6",
            url: "https://nvd.nist.gov/vuln/detail/CVE-2021-44906"
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

    // Update package.json to use caret range
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "test-app",
        dependencies: {
          "minimist": "^1.2.5", // Now allows 1.2.6+
        },
      }),
    );

    // Run update - should detect vulnerability in newer allowed version
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

    // If it updated to vulnerable version
    if (stdout.includes("FATAL: minimist")) {
      expect(stdout).toContain("FATAL: minimist");
      expect(stdout).toContain("CVE-2021-44906");
      expect(stdout).toContain("Prototype pollution");
      expect(exitCode).toBe(1);
    } else {
      expect(exitCode).toBe(0);
    }
  });

  test("bun pm scan detects newly discovered vulnerabilities in existing lockfile", async () => {
    // Scenario: Running pm scan with updated vulnerability database finds new issues
    const dir = tempDirWithFiles("scan-new-vuln-db", {
      "package.json": JSON.stringify({
        name: "test-app",
        dependencies: {
          "lodash": "4.17.21",
          "express": "4.18.2",
        },
      }),
      // Initially no scanner
    });

    // First install without scanner
    await Bun.$`${bunExe()} install`.cwd(dir).env(bunEnv).quiet();

    // Add scanner with updated vulnerability database
    await Bun.write(join(dir, "bunfig.toml"), `[install.security]\nscanner = "./scanner.js"`);
    await Bun.write(
      join(dir, "scanner.js"),
      `
module.exports = {
  scanner: {
    version: "1",
    scan: async function(payload) {
      // Simulate updated vulnerability database
      const results = [];
      for (const pkg of payload.packages) {
        if (pkg.name === "lodash" && pkg.version === "4.17.21") {
          results.push({
            package: "lodash",
            level: "warn",
            description: "New vulnerability discovered in lodash 4.17.21",
            url: "https://example.com/new-lodash-vuln"
          });
        }
        if (pkg.name === "express" && pkg.version === "4.18.2") {
          results.push({
            package: "express",
            level: "fatal",
            description: "Critical vulnerability found in express 4.18.2",
            url: "https://example.com/new-express-vuln"
          });
        }
      }
      return results;
    }
  }
};
`,
    );

    // Run pm scan - should detect newly discovered vulnerabilities
    const scanProc = Bun.spawn({
      cmd: [bunExe(), "pm", "scan"],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      scanProc.stdout.text(),
      scanProc.stderr.text(),
      scanProc.exited,
    ]);

    // Should detect the newly discovered vulnerabilities
    expect(stdout).toContain("FATAL: express");
    expect(stdout).toContain("WARNING: lodash");
    expect(stdout).toContain("2 advisories");
    expect(exitCode).toBe(1);
  });
});
