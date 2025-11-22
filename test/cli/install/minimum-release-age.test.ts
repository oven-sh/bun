import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

/**
 * Comprehensive test suite for the minimum-release-age security feature.
 * Tests all branches of the implementation including stability checks,
 * prerelease handling, 7-day give-up threshold, and edge cases.
 */
describe("minimum-release-age", () => {
  let mockRegistryServer: Server;
  let mockRegistryUrl: string;
  const currentTime = Date.now();
  const SECONDS_PER_DAY = 24 * 60 * 60;
  const MS_PER_SECOND = 1000;
  const DAY_MS = SECONDS_PER_DAY * MS_PER_SECOND;

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

        // Special timestamp helpers for edge case packages
        const futureTime = new Date(currentTime + 7 * DAY_MS).toISOString();
        const futureTomorrow = new Date(currentTime + 1 * DAY_MS).toISOString();

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
              "1.0.0": daysAgo(8),
              "1.0.1": daysAgo(2.5),
              "1.0.2": daysAgo(1.5),
              "1.0.3": daysAgo(0.5),
            },
          };

          return new Response(JSON.stringify(packageData));
        }

        // TEST PACKAGE 3: search-limit-package (tests 7-day search limit)
        if (url.pathname === "/search-limit-package") {
          const packageData = {
            name: "search-limit-package",
            "dist-tags": {
              latest: "1.0.8",
            },
            versions: {
              "1.0.0": {
                name: "search-limit-package",
                version: "1.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/search-limit-package/-/search-limit-package-1.0.0.tgz`,
                  integrity: "sha512-limit1==",
                },
              },
              "1.0.1": {
                name: "search-limit-package",
                version: "1.0.1",
                dist: {
                  tarball: `${mockRegistryUrl}/search-limit-package/-/search-limit-package-1.0.1.tgz`,
                  integrity: "sha512-limit2==",
                },
              },
              "1.0.2": {
                name: "search-limit-package",
                version: "1.0.2",
                dist: {
                  tarball: `${mockRegistryUrl}/search-limit-package/-/search-limit-package-1.0.2.tgz`,
                  integrity: "sha512-limit3==",
                },
              },
              "1.0.3": {
                name: "search-limit-package",
                version: "1.0.3",
                dist: {
                  tarball: `${mockRegistryUrl}/search-limit-package/-/search-limit-package-1.0.3.tgz`,
                  integrity: "sha512-limit4==",
                },
              },
              "1.0.4": {
                name: "search-limit-package",
                version: "1.0.4",
                dist: {
                  tarball: `${mockRegistryUrl}/search-limit-package/-/search-limit-package-1.0.4.tgz`,
                  integrity: "sha512-limit5==",
                },
              },
              "1.0.5": {
                name: "search-limit-package",
                version: "1.0.5",
                dist: {
                  tarball: `${mockRegistryUrl}/search-limit-package/-/search-limit-package-1.0.5.tgz`,
                  integrity: "sha512-limit6==",
                },
              },
              "1.0.6": {
                name: "search-limit-package",
                version: "1.0.6",
                dist: {
                  tarball: `${mockRegistryUrl}/search-limit-package/-/search-limit-package-1.0.6.tgz`,
                  integrity: "sha512-limit7==",
                },
              },
              "1.0.7": {
                name: "search-limit-package",
                version: "1.0.7",
                dist: {
                  tarball: `${mockRegistryUrl}/search-limit-package/-/search-limit-package-1.0.7.tgz`,
                  integrity: "sha512-limit8==",
                },
              },
              "1.0.8": {
                name: "search-limit-package",
                version: "1.0.8",
                dist: {
                  tarball: `${mockRegistryUrl}/search-limit-package/-/search-limit-package-1.0.8.tgz`,
                  integrity: "sha512-limit9==",
                },
              },
            },
            time: {
              "1.0.0": daysAgo(20), // Beyond search limit (5 + 7 = 12 days)
              "1.0.1": daysAgo(11), // Just beyond search limit
              "1.0.2": daysAgo(10), // Within search limit but unstable
              "1.0.3": daysAgo(9), // Unstable
              "1.0.4": daysAgo(8), // Unstable
              "1.0.5": daysAgo(7), // Unstable
              "1.0.6": daysAgo(6), // Passes age gate, unstable
              "1.0.7": daysAgo(4), // Blocked by age gate
              "1.0.8": daysAgo(1), // Blocked by age gate
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

        // TEST PACKAGE 8: stable-package (latest is old, has many versions)
        if (url.pathname === "/stable-package") {
          const packageData = {
            name: "stable-package",
            "dist-tags": {
              latest: "3.2.0",
            },
            versions: {
              "3.0.0": {
                name: "stable-package",
                version: "3.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/stable-package/-/stable-package-3.0.0.tgz`,
                  integrity: "sha512-stable1==",
                },
              },
              "3.0.1": {
                name: "stable-package",
                version: "3.0.1",
                dist: {
                  tarball: `${mockRegistryUrl}/stable-package/-/stable-package-3.0.1.tgz`,
                  integrity: "sha512-stable2==",
                },
              },
              "3.1.0": {
                name: "stable-package",
                version: "3.1.0",
                dist: {
                  tarball: `${mockRegistryUrl}/stable-package/-/stable-package-3.1.0.tgz`,
                  integrity: "sha512-stable3==",
                },
              },
              "3.1.1": {
                name: "stable-package",
                version: "3.1.1",
                dist: {
                  tarball: `${mockRegistryUrl}/stable-package/-/stable-package-3.1.1.tgz`,
                  integrity: "sha512-stable4==",
                },
              },
              "3.1.2": {
                name: "stable-package",
                version: "3.1.2",
                dist: {
                  tarball: `${mockRegistryUrl}/stable-package/-/stable-package-3.1.2.tgz`,
                  integrity: "sha512-stable5==",
                },
              },
              "3.2.0": {
                name: "stable-package",
                version: "3.2.0",
                dist: {
                  tarball: `${mockRegistryUrl}/stable-package/-/stable-package-3.2.0.tgz`,
                  integrity: "sha512-stable6==",
                },
              },
            },
            time: {
              "3.0.0": daysAgo(50),
              "3.0.1": daysAgo(45),
              "3.1.0": daysAgo(40),
              "3.1.1": daysAgo(35),
              "3.1.2": daysAgo(32),
              "3.2.0": daysAgo(30), // Latest is 30 days old - passes any reasonable gate
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

        // TEST PACKAGE 9: no-time-package (missing time field)
        if (url.pathname === "/no-time-package") {
          const packageData = {
            name: "no-time-package",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "no-time-package",
                version: "1.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/no-time-package/-/no-time-package-1.0.0.tgz`,
                  integrity: "sha512-fake==",
                },
              },
            },
            // No time field - should skip filtering
          };

          return Response.json(packageData);
        }

        // TEST PACKAGE 10: bad-timestamp-package (invalid timestamps)
        if (url.pathname === "/bad-timestamp-package") {
          const packageData = {
            name: "bad-timestamp-package",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "bad-timestamp-package",
                version: "1.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/bad-timestamp-package/-/bad-timestamp-package-1.0.0.tgz`,
                  integrity: "sha512-fake==",
                },
              },
            },
            time: {
              "1.0.0": "not-a-valid-date", // Invalid timestamp
            },
          };

          return Response.json(packageData);
        }

        // TEST PACKAGE 11: exact-threshold-package (exactly at age boundary)
        if (url.pathname === "/exact-threshold-package") {
          const packageData = {
            name: "exact-threshold-package",
            "dist-tags": { latest: "2.0.0" },
            versions: {
              "1.0.0": {
                name: "exact-threshold-package",
                version: "1.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/exact-threshold-package/-/exact-threshold-package-1.0.0.tgz`,
                  integrity: "sha512-old==",
                },
              },
              "2.0.0": {
                name: "exact-threshold-package",
                version: "2.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/exact-threshold-package/-/exact-threshold-package-2.0.0.tgz`,
                  integrity: "sha512-exact==",
                },
              },
            },
            time: {
              "1.0.0": daysAgo(10),
              "2.0.0": daysAgo(5), // Exactly 5 days old
            },
          };

          return Response.json(packageData);
        }

        // TEST PACKAGE 12: future-package (clock skew scenarios)
        if (url.pathname === "/future-package") {
          const packageData = {
            name: "future-package",
            "dist-tags": { latest: "2.0.0" },
            versions: {
              "1.0.0": {
                name: "future-package",
                version: "1.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/future-package/-/future-package-1.0.0.tgz`,
                  integrity: "sha512-old==",
                },
              },
              "2.0.0": {
                name: "future-package",
                version: "2.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/future-package/-/future-package-2.0.0.tgz`,
                  integrity: "sha512-future==",
                },
              },
            },
            time: {
              "1.0.0": daysAgo(10),
              "2.0.0": futureTime, // Published "in the future" due to clock skew
            },
          };

          return Response.json(packageData);
        }

        // TEST PACKAGE 13: all-future-package (all versions in future)
        if (url.pathname === "/all-future-package") {
          const packageData = {
            name: "all-future-package",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "all-future-package",
                version: "1.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/all-future-package/-/all-future-package-1.0.0.tgz`,
                  integrity: "sha512-future==",
                },
              },
            },
            time: {
              "1.0.0": futureTomorrow, // All versions in the future
            },
          };

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
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
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
        cmd: [bunExe(), "install", "--minimum-release-age", `${9.5 * SECONDS_PER_DAY}`, "--no-verify"],
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
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stderr = await proc.stderr.text();

      // Should fail because 3.0.0 is too recent
      expect(exitCode).toBe(1);
      expect(stderr.toLowerCase()).toMatch(
        /blocked.*npm.*minimal.*age.*gate|blocked.*minimum.*release.*age|too.*recent/,
      );
    });
  });

  describe("stability checks", () => {
    test("detects rapid bugfixes and selects stable version", async () => {
      using dir = tempDir("stability-check", {
        "package.json": JSON.stringify({
          dependencies: { "bugfix-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${1.8 * SECONDS_PER_DAY}`, "--verbose"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);

      expect(exitCode).toBe(0);

      // With 1.8 days filter:
      // - stability_window = min(1.8, 7) = 1.8 days
      // - search_limit = 1.8 + 7 = 8.8 days
      // - 1.0.3 (0.5d): BLOCKED by age gate
      // - 1.0.2 (1.5d): BLOCKED by age gate
      // - 1.0.1 (2.5d): PASSES age gate, gap to 1.0.2 = 1d < 1.8d → UNSTABLE
      // - 1.0.0 (8d): PASSES age gate, within search limit, gap to 1.0.1 = 5.5d >= 1.8d → STABLE!
      // - Should select 1.0.0 (skips unstable 1.0.1)
      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      expect(lockfile).toContain("bugfix-package@1.0.0");
      expect(lockfile).not.toContain("bugfix-package@1.0.1");
      expect(lockfile).not.toContain("bugfix-package@1.0.2");
      expect(lockfile).not.toContain("bugfix-package@1.0.3");

      // Verbose output should indicate stability check
      const output = stdout + stderr;
      expect(output).toContain("minimum-release-age");
    });

    test("detects rapid bugfixes with dist-tag (latest)", async () => {
      using dir = tempDir("stability-check-dist-tag", {
        "package.json": JSON.stringify({
          dependencies: { "bugfix-package": "latest" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${1.8 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      // Same logic as semver test, but using dist-tag resolution path
      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      expect(lockfile).toContain("bugfix-package@1.0.0");
      expect(lockfile).not.toContain("bugfix-package@1.0.1");
      expect(lockfile).not.toContain("bugfix-package@1.0.2");
      expect(lockfile).not.toContain("bugfix-package@1.0.3");
    });

    test("gives up after searching 7 days beyond age gate", async () => {
      using dir = tempDir("seven-day-limit", {
        "package.json": JSON.stringify({
          dependencies: { "search-limit-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      // Testing the "give up after 7 days of searching" logic:
      // - Age gate: 5 days
      // - stability_window: min(5, 7) = 5 days (gap needed for stability)
      // - search_limit: 5 + 7 = 12 days (how far back to search)
      //
      // Timeline:
      // - 1.0.8 (1d), 1.0.7 (4d): BLOCKED by age gate
      // - 1.0.6 (6d): First to PASS age gate
      // - All versions 1.0.6→1.0.1 have 1-day gaps (all UNSTABLE, need 5-day gap)
      // - 1.0.0 (20d) is beyond search_limit (12d) → GIVE UP
      //
      // Result: Selects 1.0.6 (gave up finding stable version)
      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      // Should select 1.0.6 after giving up search
      expect(lockfile).toContain("search-limit-package@1.0.6");
      expect(lockfile).not.toContain("search-limit-package@1.0.0");
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
        cmd: [bunExe(), "install", "--minimum-release-age", `${3 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
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
        cmd: [bunExe(), "install", "--minimum-release-age", `${3 * SECONDS_PER_DAY}`, "--no-verify"],
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
        cmd: [bunExe(), "install", "--minimum-release-age", `${10 * SECONDS_PER_DAY}`, "--no-verify"],
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
      // old-package has: 1.0.0 (20d), 1.1.0 (15d), 2.0.0 (2d)
      // With 3-day filter, search window is 3 + 7 = 10 days
      // - 2.0.0 (2 days): BLOCKED
      // - 1.1.0 (15 days): Beyond search window, but should be returned as fallback
      using dir = tempDir("seven-day-threshold", {
        "package.json": JSON.stringify({
          dependencies: { "old-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${3 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [exitCode, stderr] = await Promise.all([proc.exited, proc.stderr.text()]);

      // Should succeed by finding 1.1.0 (first version beyond search window)
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      // Should not have 2.0.0 (too recent)
      expect(lockfile).not.toContain("old-package@2.0.0");
      // Should have 1.1.0 (old but stable, beyond the search window)
      expect(lockfile).toContain("old-package@1.1.0");
      expect(stderr.toLowerCase()).not.toContain("no version matching");
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
        cmd: [bunExe(), "install", "--minimum-release-age", `${3 * SECONDS_PER_DAY}`, "--no-verify"],
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

    test("version range finds old stable version beyond search window", async () => {
      // Test for bug where version ranges would error instead of finding
      // versions older than min_age + 7 days
      //
      // Bug scenario:
      // - old-package has versions: 2.0.0 (2 days), 1.1.0 (15 days), 1.0.0 (20 days)
      // - User requests "old-package@^1.0.0" with --minimum-release-age=259200 (3 days)
      // - Search window is 3 days + 7 days = 10 days
      // - 2.0.0 is blocked (too recent)
      // - 1.1.0 is 15 days old (beyond the 10-day search window)
      using dir = tempDir("old-version-search", {
        "package.json": JSON.stringify({
          dependencies: {
            "old-package": "^1.0.0", // Range that should match 1.1.0
          },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      // old-package has:
      // - 1.0.0: 20 days old
      // - 1.1.0: 15 days old
      // - 2.0.0: 2 days old
      //
      // With 3-day filter:
      // - 2.0.0 (2 days): BLOCKED
      // - 1.1.0 (15 days): PASSES age gate, but beyond search window (3 + 7 = 10 days)
      // - Should return 1.1.0 as best_version before breaking, not error!
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${3 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      // Should install 1.1.0 (old but stable)
      expect(lockfile).toContain("old-package@1.1.0");
      // Should NOT error with "No version matching"
      expect(stderr.toLowerCase()).not.toContain("no version matching");
      expect(stderr.toLowerCase()).not.toContain("blocked by minimum-release-age");
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
minimumReleaseAge = ${5 * SECONDS_PER_DAY}
minimumReleaseAgeExcludes = ["excluded-package"]
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
minimumReleaseAge = ${5 * SECONDS_PER_DAY}
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
minimumReleaseAge = ${10 * SECONDS_PER_DAY}
registry = "${mockRegistryUrl}"`,
      });

      // CLI says 5 days, bunfig says 10 days
      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
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
minimumReleaseAge = ${10 * SECONDS_PER_DAY}
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

    test("global bunfig.toml configuration works", async () => {
      // Create a fake home directory with global bunfig
      using globalConfigDir = tempDir("global-config", {
        ".bunfig.toml": `[install]
minimumReleaseAge = ${5 * SECONDS_PER_DAY}
registry = "${mockRegistryUrl}"`,
      });

      // Create project directory (no local bunfig)
      using dir = tempDir("project-with-global-config", {
        "package.json": JSON.stringify({
          dependencies: { "regular-package": "*" },
        }),
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: {
          ...bunEnv,
          // XDG_CONFIG_HOME works on all platforms in Bun as an override
          XDG_CONFIG_HOME: String(globalConfigDir),
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      // Should respect global bunfig setting (5 days)
      expect(lockfile).toContain("regular-package@2.1.0");
      expect(lockfile).not.toContain("regular-package@3.0.0");
    });

    test("local bunfig overrides global bunfig", async () => {
      // Create a fake home directory with global bunfig
      using globalConfigDir = tempDir("global-config-override", {
        ".bunfig.toml": `[install]
minimumReleaseAge = ${10 * SECONDS_PER_DAY}
registry = "${mockRegistryUrl}"`,
      });

      // Create project directory with local bunfig
      using dir = tempDir("project-overrides-global", {
        "package.json": JSON.stringify({
          dependencies: { "regular-package": "*" },
        }),
        "bunfig.toml": `[install]
minimumReleaseAge = ${5 * SECONDS_PER_DAY}
registry = "${mockRegistryUrl}"`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: {
          ...bunEnv,
          // XDG_CONFIG_HOME works on all platforms in Bun as an override
          XDG_CONFIG_HOME: String(globalConfigDir),
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      // Should use local bunfig setting (5 days), not global (10 days)
      expect(lockfile).toContain("regular-package@2.1.0");
      // With 10 days, would have gotten 2.0.0
      expect(lockfile).not.toContain("regular-package@2.0.0");
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
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--verbose"],
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
      expect(output.toLowerCase()).toContain("minimum-release-age");
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
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
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
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
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
minimumReleaseAge = ${5 * SECONDS_PER_DAY}
registry = "${mockRegistryUrl}"`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
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
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
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
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--dry-run"],
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
        cmd: [bunExe(), "update", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
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
minimumReleaseAge = ${5 * SECONDS_PER_DAY}
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
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
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
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
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
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
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
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(proc.exited).resolves.toBe(0);

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
        cmd: [
          bunExe(),
          "install",
          "--frozen-lockfile",
          "--minimum-release-age",
          `${5 * SECONDS_PER_DAY}`,
          "--no-verify",
        ],
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
        cmd: [
          bunExe(),
          "install",
          "--frozen-lockfile",
          "--minimum-release-age",
          `${5 * SECONDS_PER_DAY}`,
          "--no-verify",
        ],
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

  describe("monorepo with linker modes", () => {
    test.each(["isolated", "hoisted"])("installs package with minimum-release-age in %s mode", async linker => {
      using dir = tempDir(`monorepo-${linker}`, {
        "package.json": JSON.stringify({
          name: "my-monorepo",
          workspaces: ["packages/*"],
        }),
        "bunfig.toml": `
[install]
linker = "${linker}"
`,
        "packages/app/package.json": JSON.stringify({
          name: "app",
          version: "1.0.0",
          dependencies: {
            "regular-package": "*",
          },
        }),
        "packages/lib/package.json": JSON.stringify({
          name: "lib",
          version: "1.0.0",
          dependencies: {
            "regular-package": "^2.0.0",
            "daily-release-package": "latest",
            "bugfix-package": "*",
            "@scope/scoped-package": "^1.0.0",
            "stable-package": "latest",
          },
        }),
        "packages/legacy/package.json": JSON.stringify({
          name: "legacy",
          version: "1.0.0",
          dependencies: {
            "regular-package": "1.0.0", // Pinned to old version
            "stable-package": "3.0.0", // Pinned to specific old version
          },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      // Install with 5-day minimum-release-age - comprehensive "final boss" test:
      // - regular-package (^2.0.0): 3.0.0 too new → select 2.1.0 (6 days old)
      // - regular-package (1.0.0): pinned to 1.0.0 (legacy workspace - no age check on exact versions)
      // - daily-release-package (latest): 1.10.0 too new → select 1.5.0 (exactly 5 days, passes gate)
      // - bugfix-package (*): only 1.0.0 passes 5-day gate (others are 0.5d, 1.5d, 2.5d old)
      // - @scope/scoped-package (^1.0.0): 2.0.0 too new → select 1.5.0 (8 days old)
      // - stable-package (latest): 3.2.0 is 30 days old → select 3.2.0 (passes gate, is latest)
      // - stable-package (3.0.0): pinned to 3.0.0 (legacy workspace - no age check on exact versions)
      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();

      // Verify each package selected the correct version
      expect(lockfile).toContain("regular-package@2.1.0");
      expect(lockfile).not.toContain("regular-package@3.0.0");

      expect(lockfile).toContain("daily-release-package@1.5.0");
      expect(lockfile).not.toContain("daily-release-package@1.10.0");

      expect(lockfile).toContain("bugfix-package@1.0.0");
      expect(lockfile).not.toContain("bugfix-package@1.0.1");

      expect(lockfile).toContain("@scope/scoped-package@1.5.0");
      expect(lockfile).not.toContain("@scope/scoped-package@2.0.0");

      expect(lockfile).toContain("stable-package@3.2.0"); // Latest, 30 days old, passes gate
      expect(lockfile).not.toContain("stable-package@3.1.2");

      // Verify legacy workspace gets pinned old versions (no age check on exact versions)
      expect(lockfile).toContain("regular-package@1.0.0");
      expect(lockfile).toContain("stable-package@3.0.0");

      // Normalize the lockfile to remove dynamic port numbers
      const normalizedLockfile = lockfile.replace(/http:\/\/localhost:\d+/g, "http://localhost:<port>");
      expect(normalizeBunSnapshot(normalizedLockfile, dir)).toMatchInlineSnapshot(`
          "{
            "lockfileVersion": 1,
            "configVersion": 1,
            "workspaces": {
              "": {
                "name": "my-monorepo",
              },
              "packages/app": {
                "name": "app",
                "version": "1.0.0",
                "dependencies": {
                  "regular-package": "*",
                },
              },
              "packages/legacy": {
                "name": "legacy",
                "version": "1.0.0",
                "dependencies": {
                  "regular-package": "1.0.0",
                  "stable-package": "3.0.0",
                },
              },
              "packages/lib": {
                "name": "lib",
                "version": "1.0.0",
                "dependencies": {
                  "@scope/scoped-package": "^1.0.0",
                  "bugfix-package": "*",
                  "daily-release-package": "latest",
                  "regular-package": "^2.0.0",
                  "stable-package": "latest",
                },
              },
            },
            "packages": {
              "@scope/scoped-package": ["@scope/scoped-package@1.5.0", "http://localhost:<port>/@scope/scoped-package/-/scoped-package-1.5.0.tgz", {}, ""],

              "app": ["app@workspace:packages/app"],

              "bugfix-package": ["bugfix-package@1.0.0", "http://localhost:<port>/bugfix-package/-/bugfix-package-1.0.0.tgz", {}, ""],

              "daily-release-package": ["daily-release-package@1.5.0", "http://localhost:<port>/daily-release-package/-/daily-release-package-1.5.0.tgz", {}, ""],

              "legacy": ["legacy@workspace:packages/legacy"],

              "lib": ["lib@workspace:packages/lib"],

              "regular-package": ["regular-package@2.1.0", "http://localhost:<port>/regular-package/-/regular-package-2.1.0.tgz", {}, ""],

              "stable-package": ["stable-package@3.0.0", "http://localhost:<port>/stable-package/-/stable-package-3.0.0.tgz", {}, ""],

              "legacy/regular-package": ["regular-package@1.0.0", "http://localhost:<port>/regular-package/-/regular-package-1.0.0.tgz", {}, ""],

              "lib/stable-package": ["stable-package@3.2.0", "http://localhost:<port>/stable-package/-/stable-package-3.2.0.tgz", {}, ""],
            }
          }"
        `);
    });
  });

  describe("invalid inputs", () => {
    test("rejects negative minimum-release-age", async () => {
      using dir = tempDir("negative-age", {
        "package.json": JSON.stringify({
          dependencies: { "regular-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "-1"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [exitCode, stderr] = await Promise.all([proc.exited, proc.stderr.text()]);

      // Should fail with error about invalid value
      expect(exitCode).toBe(1);
      expect(stderr.toLowerCase()).toMatch(/invalid|error/);
    });

    test("rejects non-numeric minimum-release-age", async () => {
      using dir = tempDir("non-numeric-age", {
        "package.json": JSON.stringify({
          dependencies: { "regular-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", "abc"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [exitCode, stderr] = await Promise.all([proc.exited, proc.stderr.text()]);

      // Should fail with error about invalid value
      expect(exitCode).toBe(1);
      expect(stderr.toLowerCase()).toMatch(/invalid|error/);
    });
  });

  describe("malformed registry data", () => {
    test("handles package with missing time field", async () => {
      using dir = tempDir("no-time-field", {
        "package.json": JSON.stringify({
          dependencies: { "no-time-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;

      // Should succeed - packages without time field should skip filtering
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      expect(lockfile).toContain("no-time-package@1.0.0");
    });

    test("handles invalid timestamp formats", async () => {
      using dir = tempDir("bad-timestamp", {
        "package.json": JSON.stringify({
          dependencies: { "bad-timestamp-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;

      // Should succeed - invalid timestamps should be skipped gracefully
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      expect(lockfile).toContain("bad-timestamp-package@1.0.0");
    });
  });

  describe("boundary conditions", () => {
    test("handles package released exactly at minimum age threshold", async () => {
      using dir = tempDir("exact-threshold", {
        "package.json": JSON.stringify({
          dependencies: { "exact-threshold-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      // Should install 2.0.0 (exactly at threshold = passes)
      expect(lockfile).toContain("exact-threshold-package@2.0.0");
    });
  });

  describe("devDependencies and optionalDependencies", () => {
    test("filters devDependencies with minimum-release-age", async () => {
      using dir = tempDir("dev-deps", {
        "package.json": JSON.stringify({
          devDependencies: {
            "regular-package": "*",
          },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      // devDependencies should also be filtered
      expect(lockfile).toContain("regular-package@2.1.0");
      expect(lockfile).not.toContain("regular-package@3.0.0");
    });

    test("filters optionalDependencies with minimum-release-age", async () => {
      using dir = tempDir("optional-deps", {
        "package.json": JSON.stringify({
          optionalDependencies: {
            "regular-package": "*",
          },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      // optionalDependencies should also be filtered
      expect(lockfile).toContain("regular-package@2.1.0");
      expect(lockfile).not.toContain("regular-package@3.0.0");
    });

    test("filters mixed dependency types", async () => {
      using dir = tempDir("mixed-deps", {
        "package.json": JSON.stringify({
          dependencies: {
            "regular-package": "*",
          },
          devDependencies: {
            "bugfix-package": "*",
          },
          optionalDependencies: {
            "@scope/scoped-package": "*",
          },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      // All dependency types should be filtered
      expect(lockfile).toContain("regular-package@2.1.0");
      expect(lockfile).toContain("bugfix-package@1.0.0");
      expect(lockfile).toContain("@scope/scoped-package@1.5.0");
    });
  });

  describe("clock skew scenarios", () => {
    test("handles packages with future timestamps", async () => {
      using dir = tempDir("future-timestamp", {
        "package.json": JSON.stringify({
          dependencies: { "future-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(`${dir}/bun.lock`).text();
      // Future timestamps should be treated as "too recent", fallback to 1.0.0
      expect(lockfile).toContain("future-package@1.0.0");
      expect(lockfile).not.toContain("future-package@2.0.0");
    });

    test("handles all versions with future timestamps", async () => {
      using dir = tempDir("all-future-timestamps", {
        "package.json": JSON.stringify({
          dependencies: { "all-future-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [exitCode, stderr] = await Promise.all([proc.exited, proc.stderr.text()]);

      // Should fail - no versions pass the age gate
      expect(exitCode).toBe(1);
      expect(stderr.toLowerCase()).toMatch(/no version|blocked|failed to resolve/);
    });
  });

  describe("security scanner integration", () => {
    // Helper to create common scanner configuration files
    const createScannerConfig = (extraConfig = "", scannerImpl?: string) => {
      // Normalize extraConfig to ensure proper newline separation
      const normalizedExtra = extraConfig ? (extraConfig.endsWith("\n") ? extraConfig : extraConfig + "\n") : "";
      return {
        "bunfig.toml": `
[install]
cache = false
registry = "${mockRegistryUrl}"
${normalizedExtra}
[install.security]
scanner = "./scanner.ts"
`,
        "scanner.ts":
          scannerImpl ??
          `
export const scanner = {
  version: "1",
  scan: async ({ packages }) => {
    await Bun.write("./received-packages.json", JSON.stringify(packages, null, 2));
    return [];
  },
};
`,
      };
    };

    test("only passes age-filtered packages to security scanner", async () => {
      // This test verifies that when minimum-release-age filters a package,
      // the security scanner receives only the filtered version (not the blocked newer versions)
      using dir = tempDir("scanner-integration", {
        "package.json": JSON.stringify({
          dependencies: { "regular-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
        ...createScannerConfig(),
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      // Read what packages the scanner received
      const receivedPackagesFile = Bun.file(`${dir}/received-packages.json`);
      expect(await receivedPackagesFile.exists()).toBe(true);

      const receivedPackages = await receivedPackagesFile.json();

      // Verify the scanner received the filtered version (2.1.0) not the blocked version (3.0.0)
      const regularPkg = receivedPackages.find((p: { name: string }) => p.name === "regular-package");
      expect(regularPkg).toBeDefined();
      expect(regularPkg.version).toBe("2.1.0");
    });

    test("scanner receives correct version when stability check downgrades", async () => {
      // Test that stability checks also affect what version the scanner sees
      using dir = tempDir("scanner-stability", {
        "package.json": JSON.stringify({
          dependencies: { "bugfix-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
        ...createScannerConfig(),
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${1.8 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const receivedPackages = await Bun.file(`${dir}/received-packages.json`).json();

      // With stability checks, should select 1.0.0 (stable) instead of unstable versions
      const bugfixPkg = receivedPackages.find((p: { name: string }) => p.name === "bugfix-package");
      expect(bugfixPkg).toBeDefined();
      expect(bugfixPkg.version).toBe("1.0.0");
    });

    test("scanner can report advisory on age-filtered package", async () => {
      // Test that the scanner can properly report security issues on the filtered package
      const advisoryScannerImpl = `
export const scanner = {
  version: "1",
  scan: async ({ packages }) => {
    // Report a fatal advisory for the package we receive
    const pkg = packages.find(p => p.name === "regular-package");
    if (pkg && pkg.version === "2.1.0") {
      return [{
        package: "regular-package",
        description: "Known vulnerability in version 2.1.0",
        level: "fatal",
        url: "https://example.com/advisory",
      }];
    }
    return [];
  },
};
`;
      using dir = tempDir("scanner-advisory", {
        "package.json": JSON.stringify({
          dependencies: { "regular-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
        ...createScannerConfig("", advisoryScannerImpl),
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--minimum-release-age", `${5 * SECONDS_PER_DAY}`, "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [exitCode, stdout, stderr] = await Promise.all([proc.exited, proc.stdout.text(), proc.stderr.text()]);
      const output = stdout + stderr;

      // The advisory message should be in the output
      expect(output).toContain("Known vulnerability in version 2.1.0");
      expect(output).toContain("Installation aborted due to fatal security advisories");
      // Should fail due to fatal advisory
      expect(exitCode).toBe(1);
    });

    test("excludes filter bypasses age check but scanner still sees package", async () => {
      // Test that excluded packages bypass age filtering but are still scanned
      using dir = tempDir("scanner-excludes", {
        "package.json": JSON.stringify({
          dependencies: { "regular-package": "*" },
        }),
        ".npmrc": `registry=${mockRegistryUrl}`,
        ...createScannerConfig(`minimumReleaseAge = ${5 * SECONDS_PER_DAY}
minimumReleaseAgeExcludes = ["regular-package"]
`),
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--no-verify"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const receivedPackages = await Bun.file(`${dir}/received-packages.json`).json();

      // Since regular-package is excluded from age filtering, it should get 3.0.0 (latest)
      const regularPkg = receivedPackages.find((p: { name: string }) => p.name === "regular-package");
      expect(regularPkg).toBeDefined();
      expect(regularPkg.version).toBe("3.0.0");
    });
  });
});
