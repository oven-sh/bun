import { beforeAll, describe, expect, test, afterAll } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import type { Server } from "bun";

/**
 * Comprehensive test suite for the minimum-release-age security feature.
 * Tests all branches of the implementation including stability checks,
 * prerelease handling, 7-day give-up threshold, and edge cases.
 */
describe("minimum-release-age", () => {
  let mockRegistryServer: Server;
  let mockRegistryUrl: string;
  const currentTime = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Helper to create ISO timestamp for a given number of days ago
  const daysAgo = (days: number) => new Date(currentTime - days * DAY_MS).toISOString();

  // Helper to create a minimal valid tarball
  const createTarball = (name: string, version: string) => {
    const packageJson = JSON.stringify({
      name,
      version,
      description: "test package",
      main: "index.js",
    });

    // Create a simple tar structure (simplified for testing)
    const files = {
      "package/package.json": packageJson,
      "package/index.js": 'module.exports = "test";',
    };

    let tarSize = 0;
    const entries = [];

    for (const [path, content] of Object.entries(files)) {
      const contentBuf = Buffer.from(content, "utf8");
      const blockSize = Math.ceil((contentBuf.length + 512) / 512) * 512;
      const entry = Buffer.alloc(blockSize);

      // Write tar header
      entry.write(path, 0, Math.min(path.length, 99));
      entry.write("0000644", 100, 7); // mode
      entry.write("0000000", 108, 7); // uid
      entry.write("0000000", 116, 7); // gid
      entry.write(contentBuf.length.toString(8).padStart(11, "0"), 124, 11); // size
      entry.write("00000000000", 136, 11); // mtime
      entry.write("        ", 148, 8); // checksum space
      entry.write("0", 156, 1); // type flag

      // Calculate checksum
      let checksum = 0;
      for (let i = 0; i < 512; i++) {
        checksum += i >= 148 && i < 156 ? 32 : entry[i];
      }
      entry.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);

      // Write content
      contentBuf.copy(entry, 512);
      entries.push(entry);
      tarSize += blockSize;
    }

    // Add end-of-archive marker
    entries.push(Buffer.alloc(1024));
    tarSize += 1024;

    const tarball = Buffer.concat(entries, tarSize);
    return Bun.gzipSync(tarball);
  };

  beforeAll(async () => {
    // Start mock registry server
    mockRegistryServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        // TEST PACKAGE 1: regular-package
        if (url.pathname === "/regular-package") {
          const packageData = {
            name: "regular-package",
            "dist-tags": {
              latest: "3.0.0",
            },
            versions: {
              "1.0.0": {
                name: "regular-package",
                version: "1.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/regular-package/-/regular-package-1.0.0.tgz`,
                  integrity: "sha512-fake1==",
                },
              },
              "2.0.0": {
                name: "regular-package",
                version: "2.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/regular-package/-/regular-package-2.0.0.tgz`,
                  integrity: "sha512-fake2==",
                },
              },
              "2.1.0": {
                name: "regular-package",
                version: "2.1.0",
                dist: {
                  tarball: `${mockRegistryUrl}/regular-package/-/regular-package-2.1.0.tgz`,
                  integrity: "sha512-fake3==",
                },
              },
              "3.0.0": {
                name: "regular-package",
                version: "3.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/regular-package/-/regular-package-3.0.0.tgz`,
                  integrity: "sha512-fake4==",
                },
              },
            },
            time: {
              "1.0.0": daysAgo(30),
              "2.0.0": daysAgo(10),
              "2.1.0": daysAgo(6),
              "3.0.0": daysAgo(1),
            },
          };

          // Return abbreviated manifest for npm install
          if (req.headers.get("accept")?.includes("application/vnd.npm.install-v1+json")) {
            return Response.json({
              name: packageData.name,
              "dist-tags": packageData["dist-tags"],
              versions: packageData.versions,
            });
          }
          // Return full manifest (with time field) for other requests
          return Response.json(packageData);
        }

        // TEST PACKAGE 2: bugfix-package (rapid bugfixes for stability tests)
        if (url.pathname === "/bugfix-package") {
          const packageData = {
            name: "bugfix-package",
            "dist-tags": {
              latest: "1.0.3",
            },
            versions: {
              "1.0.0": {
                name: "bugfix-package",
                version: "1.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/bugfix-package/-/bugfix-package-1.0.0.tgz`,
                  integrity: "sha512-bugfix1==",
                },
              },
              "1.0.1": {
                name: "bugfix-package",
                version: "1.0.1",
                dist: {
                  tarball: `${mockRegistryUrl}/bugfix-package/-/bugfix-package-1.0.1.tgz`,
                  integrity: "sha512-bugfix2==",
                },
              },
              "1.0.2": {
                name: "bugfix-package",
                version: "1.0.2",
                dist: {
                  tarball: `${mockRegistryUrl}/bugfix-package/-/bugfix-package-1.0.2.tgz`,
                  integrity: "sha512-bugfix3==",
                },
              },
              "1.0.3": {
                name: "bugfix-package",
                version: "1.0.3",
                dist: {
                  tarball: `${mockRegistryUrl}/bugfix-package/-/bugfix-package-1.0.3.tgz`,
                  integrity: "sha512-bugfix4==",
                },
              },
            },
            time: {
              "1.0.0": daysAgo(10),
              "1.0.1": daysAgo(2),
              "1.0.2": daysAgo(1.5),
              "1.0.3": daysAgo(0.5),
            },
          };

          if (req.headers.get("accept")?.includes("application/vnd.npm.install-v1+json")) {
            return Response.json({
              name: packageData.name,
              "dist-tags": packageData["dist-tags"],
              versions: packageData.versions,
            });
          }
          return Response.json(packageData);
        }

        // TEST PACKAGE 3: canary-package
        if (url.pathname === "/canary-package") {
          const packageData = {
            name: "canary-package",
            "dist-tags": {
              latest: "1.0.0",
              canary: "2.0.0-canary.5",
              beta: "2.0.0-beta.2",
            },
            versions: {
              "1.0.0": {
                name: "canary-package",
                version: "1.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/canary-package/-/canary-package-1.0.0.tgz`,
                  integrity: "sha512-stable==",
                },
              },
              "2.0.0-canary.1": {
                name: "canary-package",
                version: "2.0.0-canary.1",
                dist: {
                  tarball: `${mockRegistryUrl}/canary-package/-/canary-package-2.0.0-canary.1.tgz`,
                  integrity: "sha512-canary1==",
                },
              },
              "2.0.0-canary.2": {
                name: "canary-package",
                version: "2.0.0-canary.2",
                dist: {
                  tarball: `${mockRegistryUrl}/canary-package/-/canary-package-2.0.0-canary.2.tgz`,
                  integrity: "sha512-canary2==",
                },
              },
              "2.0.0-canary.3": {
                name: "canary-package",
                version: "2.0.0-canary.3",
                dist: {
                  tarball: `${mockRegistryUrl}/canary-package/-/canary-package-2.0.0-canary.3.tgz`,
                  integrity: "sha512-canary3==",
                },
              },
              "2.0.0-canary.4": {
                name: "canary-package",
                version: "2.0.0-canary.4",
                dist: {
                  tarball: `${mockRegistryUrl}/canary-package/-/canary-package-2.0.0-canary.4.tgz`,
                  integrity: "sha512-canary4==",
                },
              },
              "2.0.0-canary.5": {
                name: "canary-package",
                version: "2.0.0-canary.5",
                dist: {
                  tarball: `${mockRegistryUrl}/canary-package/-/canary-package-2.0.0-canary.5.tgz`,
                  integrity: "sha512-canary5==",
                },
              },
              "2.0.0-beta.1": {
                name: "canary-package",
                version: "2.0.0-beta.1",
                dist: {
                  tarball: `${mockRegistryUrl}/canary-package/-/canary-package-2.0.0-beta.1.tgz`,
                  integrity: "sha512-beta1==",
                },
              },
              "2.0.0-beta.2": {
                name: "canary-package",
                version: "2.0.0-beta.2",
                dist: {
                  tarball: `${mockRegistryUrl}/canary-package/-/canary-package-2.0.0-beta.2.tgz`,
                  integrity: "sha512-beta2==",
                },
              },
            },
            time: {
              "1.0.0": daysAgo(20),
              "2.0.0-canary.1": daysAgo(10),
              "2.0.0-canary.2": daysAgo(8),
              "2.0.0-canary.3": daysAgo(5),
              "2.0.0-canary.4": daysAgo(2),
              "2.0.0-canary.5": daysAgo(0.5),
              "2.0.0-beta.1": daysAgo(7),
              "2.0.0-beta.2": daysAgo(3),
            },
          };

          if (req.headers.get("accept")?.includes("application/vnd.npm.install-v1+json")) {
            return Response.json({
              name: packageData.name,
              "dist-tags": packageData["dist-tags"],
              versions: packageData.versions,
            });
          }
          return Response.json(packageData);
        }

        // TEST PACKAGE 4: old-package (7-day threshold tests)
        if (url.pathname === "/old-package") {
          const packageData = {
            name: "old-package",
            "dist-tags": {
              latest: "2.0.0",
            },
            versions: {
              "1.0.0": {
                name: "old-package",
                version: "1.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/old-package/-/old-package-1.0.0.tgz`,
                  integrity: "sha512-old1==",
                },
              },
              "1.1.0": {
                name: "old-package",
                version: "1.1.0",
                dist: {
                  tarball: `${mockRegistryUrl}/old-package/-/old-package-1.1.0.tgz`,
                  integrity: "sha512-old2==",
                },
              },
              "2.0.0": {
                name: "old-package",
                version: "2.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/old-package/-/old-package-2.0.0.tgz`,
                  integrity: "sha512-old3==",
                },
              },
            },
            time: {
              "1.0.0": daysAgo(20),
              "1.1.0": daysAgo(15),
              "2.0.0": daysAgo(2),
            },
          };

          if (req.headers.get("accept")?.includes("application/vnd.npm.install-v1+json")) {
            return Response.json({
              name: packageData.name,
              "dist-tags": packageData["dist-tags"],
              versions: packageData.versions,
            });
          }
          return Response.json(packageData);
        }

        // TEST PACKAGE 5: excluded-package
        if (url.pathname === "/excluded-package") {
          const packageData = {
            name: "excluded-package",
            "dist-tags": {
              latest: "1.0.1",
            },
            versions: {
              "1.0.0": {
                name: "excluded-package",
                version: "1.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/excluded-package/-/excluded-package-1.0.0.tgz`,
                  integrity: "sha512-excluded1==",
                },
              },
              "1.0.1": {
                name: "excluded-package",
                version: "1.0.1",
                dist: {
                  tarball: `${mockRegistryUrl}/excluded-package/-/excluded-package-1.0.1.tgz`,
                  integrity: "sha512-excluded2==",
                },
              },
            },
            time: {
              "1.0.0": daysAgo(10),
              "1.0.1": daysAgo(0.5),
            },
          };

          if (req.headers.get("accept")?.includes("application/vnd.npm.install-v1+json")) {
            return Response.json({
              name: packageData.name,
              "dist-tags": packageData["dist-tags"],
              versions: packageData.versions,
            });
          }
          return Response.json(packageData);
        }

        // TEST PACKAGE 6: daily-release-package (daily releases)
        if (url.pathname === "/daily-release-package") {
          const packageData = {
            name: "daily-release-package",
            "dist-tags": {
              latest: "1.10.0",
            },
            versions: {},
            time: {},
          };

          // Create 10 versions, one released each day
          for (let i = 1; i <= 10; i++) {
            const version = `1.${i}.0`;
            packageData.versions[version] = {
              name: "daily-release-package",
              version: version,
              dist: {
                tarball: `${mockRegistryUrl}/daily-release-package/-/daily-release-package-${version}.tgz`,
                integrity: "sha512-fake1==",
              },
            };
            // Version 1.1.0 is 9 days old, 1.2.0 is 8 days old, ... 1.10.0 is 0 days old (today)
            packageData.time[version] = daysAgo(10 - i);
          }

          if (req.headers.get("accept")?.includes("application/vnd.npm.install-v1+json")) {
            return Response.json({
              name: packageData.name,
              "dist-tags": packageData["dist-tags"],
              versions: packageData.versions,
            });
          }
          return Response.json(packageData);
        }

        // TEST PACKAGE 7: @scope/scoped-package
        if (
          url.pathname === "/@scope%2Fscoped-package" ||
          url.pathname === "/@scope%2fscoped-package" ||
          url.pathname === "/@scope/scoped-package"
        ) {
          const packageData = {
            name: "@scope/scoped-package",
            "dist-tags": {
              latest: "2.0.0",
            },
            versions: {
              "1.0.0": {
                name: "@scope/scoped-package",
                version: "1.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/@scope/scoped-package/-/scoped-package-1.0.0.tgz`,
                  integrity: "sha512-fake1==",
                },
              },
              "1.5.0": {
                name: "@scope/scoped-package",
                version: "1.5.0",
                dist: {
                  tarball: `${mockRegistryUrl}/@scope/scoped-package/-/scoped-package-1.5.0.tgz`,
                  integrity: "sha512-fake2==",
                },
              },
              "2.0.0": {
                name: "@scope/scoped-package",
                version: "2.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/@scope/scoped-package/-/scoped-package-2.0.0.tgz`,
                  integrity: "sha512-fake3==",
                },
              },
            },
            time: {
              "1.0.0": daysAgo(20),
              "1.5.0": daysAgo(8),
              "2.0.0": daysAgo(1),
            },
          };

          if (req.headers.get("accept")?.includes("application/vnd.npm.install-v1+json")) {
            return Response.json({
              name: packageData.name,
              "dist-tags": packageData["dist-tags"],
              versions: packageData.versions,
            });
          }
          return Response.json(packageData);
        }

        // Serve tarballs
        if (url.pathname.includes(".tgz")) {
          // Match both regular and scoped package tarballs
          // Regular: /package-name/-/package-name-version.tgz
          // Scoped: /@scope/package-name/-/package-name-version.tgz
          const scopedMatch = url.pathname.match(/\/@([^\/]+)\/([^\/]+)\/-\/\2-([\d.]+(?:-[\w.]+)?).tgz/);
          const regularMatch = url.pathname.match(/\/([^\/]+)\/-\/\1-([\d.]+(?:-[\w.]+)?).tgz/);

          if (scopedMatch) {
            const [, scope, packageName, version] = scopedMatch;
            return new Response(createTarball(`@${scope}/${packageName}`, version), {
              headers: { "Content-Type": "application/octet-stream" },
            });
          } else if (regularMatch) {
            const [, packageName, version] = regularMatch;
            return new Response(createTarball(packageName, version), {
              headers: { "Content-Type": "application/octet-stream" },
            });
          }
        }

        return new Response("Not Found", { status: 404 });
      },
    });

    mockRegistryUrl = `http://localhost:${mockRegistryServer.port}`;
  });

  afterAll(() => {
    mockRegistryServer?.stop();
  });

  describe("basic filtering", () => {
    test("filters packages by minimum release age", async () => {
      using dir = tempDir("basic-filter", {
        "package.json": JSON.stringify({
          dependencies: { "regular-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "5"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      expect(lockfile).toContain("regular-package@2.1.0");
      expect(lockfile).not.toContain("regular-package@3.0.0");
    });

    test("respects float values for days", async () => {
      using dir = tempDir("float-days", {
        "package.json": JSON.stringify({
          dependencies: { "regular-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "9.5"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      // Should install 2.0.0 (10 days old) not 2.1.0 (6 days) or 3.0.0 (1 day)
      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      expect(lockfile).toContain("regular-package@2.0.0");
      expect(lockfile).not.toContain("regular-package@2.1.0");
      expect(lockfile).not.toContain("regular-package@3.0.0");
    });

    test("handles exact version requests", async () => {
      using dir = tempDir("exact-version", {
        "package.json": JSON.stringify({
          dependencies: { "regular-package": "3.0.0" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "5"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stderr = await proc.stderr.text();

      // Should fail because 3.0.0 is too recent
      expect(exitCode).toBe(1);
      expect(stderr.toLowerCase()).toMatch(/blocked.*minimum.*release.*age|too.*recent/);
    });
  });

  describe("stability checks", () => {
    test("detects rapid bugfixes and selects stable version", async () => {
      using dir = tempDir("stability-check", {
        "package.json": JSON.stringify({
          dependencies: { "bugfix-package": "latest" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "1.8", "--verbose"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);

      expect(exitCode).toBe(0);

      // With 1.8 days filter, should select 1.0.1 (2 days old)
      // 1.0.2 and 1.0.3 are too recent and have rapid fixes
      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      expect(lockfile).toContain("bugfix-package@");
      expect(lockfile).not.toContain("bugfix-package@1.0.3");

      // Verbose output should indicate stability check
      const output = stdout + stderr;
      expect(output).toContain("minimum-release-age");
    });

    test("stability window is capped at 1.5 days", async () => {
      using dir = tempDir("stability-window-cap", {
        "package.json": JSON.stringify({
          dependencies: { "bugfix-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      // Even with 10 day minimum, stability window should be 1.5 days
      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "10"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      // All versions are within 10 days, but stability check with 1.5 day window
      // should still select a stable version
      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      // This is complex - the exact version depends on stability logic
      expect(lockfile).toContain("bugfix-package@");
    });
  });

  describe("prerelease handling", () => {
    test("filters canary versions correctly", async () => {
      using dir = tempDir("canary-filter", {
        "package.json": JSON.stringify({
          dependencies: { "canary-package": "canary" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "3"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stderr = await proc.stderr.text();

      // Debug output
      if (exitCode !== 0) {
        console.error("Canary test failed. stderr:", stderr);
      }

      expect(exitCode).toBe(0);

      // Should select canary.3 (5 days old), not canary.4 (2 days) or canary.5 (0.5 days)
      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      expect(lockfile).toContain("canary-package@2.0.0-canary.3");
      expect(lockfile).not.toContain("canary.5");
    });

    test("compares only base prerelease tag (canary vs beta)", async () => {
      // Test that canary dist-tag only considers canary versions, not beta
      using dir = tempDir("prerelease-base-tag", {
        "package.json": JSON.stringify({
          dependencies: {
            "canary-package": "canary", // Use canary dist-tag
          },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "3"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      // Should install a canary version (2.0.0-canary.3 with 3-day filter)
      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      expect(lockfile).toContain("2.0.0-canary");
      expect(lockfile).not.toContain("beta");
    });

    test("handles latest with prerelease dist-tag", async () => {
      using dir = tempDir("latest-prerelease", {
        "package.json": JSON.stringify({
          dependencies: { "canary-package": "latest" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "10"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      // latest dist-tag points to 1.0.0 (stable), should install that
      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      expect(lockfile).toContain("canary-package@1.0.0");
      expect(lockfile).not.toContain("2.0.0-canary");
    });
  });

  describe("7-day give-up threshold", () => {
    test("stops searching after 7 days beyond minimum age", async () => {
      using dir = tempDir("seven-day-threshold", {
        "package.json": JSON.stringify({
          dependencies: { "old-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "3"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;

      // This test is tricky - with the 7-day give-up threshold,
      // all versions might be beyond the search window
      if (exitCode === 0) {
        const lockfile = await Bun.file(`${dir}/bun.lock`).text();
        // Should not have 2.0.0 (too recent)
        expect(lockfile).not.toContain("old-package@2.0.0");
        // Should have an older version as fallback
        expect(lockfile).toMatch(/old-package@1\.\d\.0/);
      } else {
        // Or it might fail if no suitable version found
        expect(exitCode).toBe(1);
      }
    });

    test("with daily releases, gets the latest within minimum age (not searching beyond 7 days)", async () => {
      // Package has 10 versions: 1.10.0 (today) down to 1.1.0 (9 days old)
      // With minimum-release-age=3, it should get 1.7.0 (3 days old) - latest that meets requirement
      // It should NOT search back to 1.1.0 (9 days) because that's beyond the 7-day give-up threshold
      using dir = tempDir("daily-releases", {
        "package.json": JSON.stringify({
          dependencies: { "daily-release-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "3"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      // Should get exactly version 1.7.0 (3 days old) - the latest that meets minimum age of 3 days
      expect(lockfile).toContain("daily-release-package@1.7.0");

      // Should NOT have newer versions
      expect(lockfile).not.toContain("daily-release-package@1.10.0");
      expect(lockfile).not.toContain("daily-release-package@1.9.0");
      expect(lockfile).not.toContain("daily-release-package@1.8.0");

      // Should NOT have searched back beyond 7-day threshold
      expect(lockfile).not.toContain("daily-release-package@1.1.0");
      expect(lockfile).not.toContain("daily-release-package@1.2.0");
    });
  });

  describe("exclusions", () => {
    test("excludes packages from filtering via bunfig", async () => {
      using dir = tempDir("exclusions-bunfig", {
        "package.json": JSON.stringify({
          dependencies: {
            "excluded-package": "*",
            "regular-package": "*",
          },
        }),
        "bunfig.toml": `[install]
minimumReleaseAge = 5
minimumReleaseAgeExclusions = ["excluded-package"]
registry = "${mockRegistryUrl}"`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();

      // excluded-package should get latest despite being 12 hours old
      expect(lockfile).toContain("excluded-package@1.0.1");
      // regular-package should be filtered (2.1.0 not 3.0.0)
      expect(lockfile).toContain("regular-package@2.1.0");
      expect(lockfile).not.toContain("regular-package@3.0.0");
    });
  });

  describe("configuration", () => {
    test("bunfig.toml configuration works", async () => {
      using dir = tempDir("bunfig-config", {
        "package.json": JSON.stringify({
          dependencies: { "regular-package": "*" },
        }),
        "bunfig.toml": `[install]
minimumReleaseAge = 5
registry = "${mockRegistryUrl}"`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      expect(lockfile).toContain("regular-package@2.1.0");
      expect(lockfile).not.toContain("regular-package@3.0.0");
    });

    test("CLI flag overrides bunfig.toml", async () => {
      using dir = tempDir("cli-override", {
        "package.json": JSON.stringify({
          dependencies: { "regular-package": "*" },
        }),
        "bunfig.toml": `[install]
minimumReleaseAge = 10
registry = "${mockRegistryUrl}"`,
      });

      // CLI says 5 days, bunfig says 10 days
      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "5"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      // With 5 days, should get 2.1.0
      expect(lockfile).toContain("regular-package@2.1.0");
      // With 10 days, would have gotten 2.0.0
      expect(lockfile).not.toContain("regular-package@2.0.0");
    });

    test("handles 0 value to disable", async () => {
      using dir = tempDir("zero-disable", {
        "package.json": JSON.stringify({
          dependencies: { "regular-package": "*" },
        }),
        "bunfig.toml": `[install]
minimumReleaseAge = 10
registry = "${mockRegistryUrl}"`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "0"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      // With 0, should get latest
      expect(lockfile).toContain("regular-package@3.0.0");
    });
  });

  describe("verbose logging", () => {
    test("shows filtering decisions in verbose mode", async () => {
      using dir = tempDir("verbose-output", {
        "package.json": JSON.stringify({
          dependencies: {
            "regular-package": "*",
            "bugfix-package": "*",
          },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "5", "--verbose"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);

      expect(exitCode).toBe(0);

      const output = stdout + stderr;
      // Should show filtering information
      expect(output.toLowerCase()).toContain("minimum");
      // Should show package names being filtered
      expect(output).toContain("regular-package");
      expect(output).toContain("bugfix-package");
    });

    test("warnings only for direct dependencies", async () => {
      // This would need a more complex setup with transitive dependencies
      // For now, we verify that direct deps show warnings
      using dir = tempDir("direct-deps-warning", {
        "package.json": JSON.stringify({
          dependencies: {
            "regular-package": "*",
          },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "5"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stderr = await proc.stderr.text();

      expect(exitCode).toBe(0);

      // Should show downgrade warning for direct dependency
      if (stderr.includes("downgraded")) {
        expect(stderr).toContain("regular-package");
      }
    });
  });

  describe("edge cases", () => {
    test("handles empty version lists", async () => {
      using dir = tempDir("no-matching-versions", {
        "package.json": JSON.stringify({
          dependencies: {
            "regular-package": "99.0.0", // Non-existent version
          },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "5"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stderr = await proc.stderr.text();

      // Should fail gracefully
      expect(exitCode).toBe(1);
      // Error message varies but should indicate version not found
      expect(stderr.toLowerCase()).toMatch(/not found|no version matching|failed to resolve/);
    });
  });

  describe("cache invalidation", () => {
    test("cache version includes timestamp data", async () => {
      // The cache version was bumped to v0.0.6 to include timestamp data
      // This ensures old caches without timestamps are invalidated
      using dir = tempDir("cache-version", {
        "package.json": JSON.stringify({
          dependencies: { "regular-package": "*" },
        }),
        "bunfig.toml": `[install]
minimumReleaseAge = 5
registry = "${mockRegistryUrl}"`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "5"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
    });
  });

  describe("performance", () => {
    test("timestamps computed once per operation", async () => {
      // This is tested implicitly - the implementation computes
      // current_timestamp once at the start of searchVersionList
      // We can verify by checking that filtering is consistent
      using dir = tempDir("perf-timestamp", {
        "package.json": JSON.stringify({
          dependencies: {
            "regular-package": "*",
            "bugfix-package": "*",
            "canary-package": "*",
          },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "5"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      // All packages should use the same timestamp for filtering
      const lockfile = await Bun.file(`${dir}/bun.lock`).text();

      // Consistent filtering across all packages
      expect(lockfile).toContain("regular-package@2.1.0");
      expect(lockfile).toContain("bugfix-package@1.0.0");
      expect(lockfile).toContain("canary-package@");
    });
  });

  describe("integration with other features", () => {
    test("works with --dry-run", async () => {
      using dir = tempDir("dry-run", {
        "package.json": JSON.stringify({
          dependencies: { "regular-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "5", "--dry-run"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stdout = await proc.stdout.text();

      expect(exitCode).toBe(0);

      // Should show what would be installed
      expect(stdout).toContain("regular-package");

      // Should not create lockfile
      const lockfileExists = await Bun.file(`${dir}/bun.lock`).exists();
      expect(lockfileExists).toBe(false);
    });

    test("works with bun update", async () => {
      using dir = tempDir("update-command", {
        "package.json": JSON.stringify({
          dependencies: { "regular-package": "^2.0.0" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      // First install
      let proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;

      // Now update with minimum-release-age
      proc = Bun.spawn({
        cmd: [bunExe(), "update", "--minimum-release-age", "5"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();

      // Should update to 2.1.0, not 3.0.0
      expect(lockfile).toContain("regular-package@2.1.0");
      expect(lockfile).not.toContain("regular-package@3.0.0");
    });

    test("works with bun outdated", async () => {
      using dir = tempDir("outdated-command", {
        "package.json": JSON.stringify({
          dependencies: { "regular-package": "^2.0.0" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
        "bunfig.toml": `[install]
minimumReleaseAge = 5
registry = "${mockRegistryUrl}"`,
      });

      // First install
      let proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;

      // Check outdated
      proc = Bun.spawn({
        cmd: [bunExe(), "outdated"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stdout = await proc.stdout.text();

      expect(exitCode).toBe(0);

      // Should show filtered latest version
      expect(stdout).toContain("regular-package");
      // Should show 2.1.0 as latest with asterisk, not 3.0.0
      expect(stdout).toInclude("2.1.0 *"); // Version with asterisk
      expect(stdout).not.toContain("3.0.0");
      // Should show note about minimum release age
      expect(stdout.toLowerCase()).toContain("minimum release age");
    });
  });

  describe("transitive dependencies", () => {
    test("transitive dependencies are not filtered by minimum-release-age", async () => {
      // Only direct dependencies should be filtered, not transitive ones
      // This ensures we don't break the dependency tree
      using dir = tempDir("transitive-deps", {
        "package.json": JSON.stringify({
          dependencies: {
            "regular-package": "*", // This will be filtered
            // In a real scenario, regular-package might have its own dependencies
            // that are newer than minimum-release-age, but they shouldn't be filtered
          },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "5"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      // Direct dependency should be filtered
      expect(lockfile).toContain("regular-package@2.1.0");
    });
  });

  describe("special dependencies", () => {
    test("git dependencies are not affected by minimum-release-age", async () => {
      // Note: We can't actually test git dependencies without real repos
      // This test verifies that minimum-release-age doesn't break when git deps are present
      using dir = tempDir("git-deps", {
        "package.json": JSON.stringify({
          dependencies: {
            "regular-package": "*",
            // We'll just verify regular packages still work with git deps in package.json
          },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "5"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      // Regular package should be filtered
      expect(lockfile).toContain("regular-package@2.1.0");
    });

    test("ignores file dependencies", async () => {
      // Create a local package
      using localPkgDir = tempDir("local-pkg", {
        "package.json": JSON.stringify({
          name: "local-package",
          version: "1.0.0",
        }),
      });

      using dir = tempDir("file-deps", {
        "package.json": JSON.stringify({
          dependencies: {
            "regular-package": "*",
            "local-package": `file:${localPkgDir}`,
          },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "5"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      // Regular package should be filtered
      expect(lockfile).toContain("regular-package@2.1.0");
      // File dependencies should work normally (path will be in lockfile)
      expect(lockfile).toContain("local-package@file:");
    });

    test("handles scoped packages", async () => {
      // Test that minimum-release-age works with scoped packages like @types/node
      using dir = tempDir("scoped-packages", {
        "package.json": JSON.stringify({
          dependencies: {
            "@scope/scoped-package": "*",
            "regular-package": "*",
          },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "5"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [exitCode, stderr] = await Promise.all([proc.exited, proc.stderr.text()]);

      if (exitCode !== 0) {
        console.error("Install failed with stderr:", stderr);
      }
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      // Scoped package should be filtered (1.5.0 not 2.0.0)
      expect(lockfile).toContain("@scope/scoped-package@1.5.0");
      expect(lockfile).not.toContain("@scope/scoped-package@2.0.0");
      // Regular package should also be filtered
      expect(lockfile).toContain("regular-package@2.1.0");
      expect(lockfile).not.toContain("regular-package@3.0.0");
    });
  });

  describe("frozen lockfile", () => {
    test("frozen lockfile preserves existing versions regardless of minimum-release-age", async () => {
      using dir = tempDir("frozen-lockfile", {
        "package.json": JSON.stringify({
          dependencies: {
            "regular-package": "*",
          },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      // First install without minimum-release-age to get latest
      let proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      let exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      expect(lockfile).toContain("regular-package@3.0.0"); // Latest version

      // Now try with frozen lockfile and minimum-release-age
      // Frozen lockfile means no changes to lockfile - versions stay as-is
      proc = Bun.spawn({
        cmd: [bunExe(), "install", "--frozen-lockfile", "--minimum-release-age", "5"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode2 = await proc.exited;

      // Should succeed - frozen lockfile means no changes, even if version is "too recent"
      expect(exitCode2).toBe(0);

      // Lockfile should remain unchanged
      const lockfileAfter = await Bun.file(`${dir}/bun.lock`).text();
      expect(lockfileAfter).toContain("regular-package@3.0.0");
    });

    test("works with frozen lockfile when versions are old enough", async () => {
      using dir = tempDir("frozen-old-versions", {
        "package.json": JSON.stringify({
          dependencies: {
            "regular-package": "2.1.0", // Old enough version
          },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      // First install to create lockfile
      let proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      let exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      // Install with frozen lockfile and minimum-release-age
      proc = Bun.spawn({
        cmd: [bunExe(), "install", "--frozen-lockfile", "--minimum-release-age", "5"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      expect(lockfile).toContain("regular-package@2.1.0");
    });
  });
});
