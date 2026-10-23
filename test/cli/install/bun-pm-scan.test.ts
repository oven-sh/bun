import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";
import { startRegistry, stopRegistry } from "./simple-dummy-registry";

let registryUrl: string;

// `bun pm scan` only reads the lockfile; it never touches node_modules or the
// network. Resolve each dependency set once in beforeAll so individual tests
// can drop the lockfile into a fresh dir instead of each running `bun install`.
let leftPadLock: string;
let isEvenLock: string;
let mixedLock: string;

const leftPadPkg = JSON.stringify({ name: "test-app", dependencies: { "left-pad": "1.3.0" } });
const isEvenPkg = JSON.stringify({ name: "my-app", dependencies: { "is-even": "1.0.0" } });
const mixedPkg = JSON.stringify({
  name: "test-app",
  dependencies: { "left-pad": "1.3.0", "is-even": "1.0.0" },
});

beforeAll(async () => {
  registryUrl = await startRegistry(false);

  async function makeLock(pkgJson: string): Promise<string> {
    await using dir = tempDir("scan-fixture", {
      "package.json": pkgJson,
      "bunfig.toml": `[install]\ncache.disable = true\nregistry = "${registryUrl}/"`,
    });
    const result = await Bun.$`${bunExe()} install`.cwd(dir).env(bunEnv).quiet().nothrow();
    if (result.exitCode !== 0) {
      throw new Error(`fixture install failed:\n${result.stderr.toString()}`);
    }
    return await Bun.file(join(String(dir), "bun.lock")).text();
  }

  [leftPadLock, isEvenLock, mixedLock] = await Promise.all([
    makeLock(leftPadPkg),
    makeLock(isEvenPkg),
    makeLock(mixedPkg),
  ]);
});

afterAll(() => {
  stopRegistry();
});

const scannerBunfig = `[install.security]\nscanner = "./scanner.js"`;

async function runScan(dir: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "scan"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return [stdout, stderr, exitCode] as const;
}

describe.concurrent("bun pm scan", () => {
  describe("configuration", () => {
    test("shows error when no security scanner configured", async () => {
      await using dir = tempDir("scan-no-config", {
        "package.json": leftPadPkg,
        "bun.lockb": "",
      });

      const [stdout, stderr, exitCode] = await runScan(dir);

      expect(stderr).toContain("error: no security scanner configured");
      expect(stdout).toContain("configure a security scanner in bunfig.toml");
      expect(exitCode).toBe(1);
    });

    test("shows error when lockfile doesn't exist", async () => {
      await using dir = tempDir("scan-no-lockfile", {
        "package.json": leftPadPkg,
        "bunfig.toml": `[install.security]\nscanner = "test-scanner"`,
      });

      const [stdout, stderr, exitCode] = await runScan(dir);

      expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
        "bun pm scan <version> (<revision>)
        error: missing lockfile, nothing to scan
        note: run 'bun install' first"
      `);
      expect(stdout).toBe("");
      expect(exitCode).toBe(1);
    });

    // `bun install` saves no lockfile for a project without dependencies, so the scanner gets an empty list.
    test("scans nothing when there are no dependencies and no lockfile", async () => {
      await using dir = tempDir("scan-no-dependencies", {
        "package.json": JSON.stringify({ name: "test", dependencies: {} }),
        "bunfig.toml": scannerBunfig,
        "scanner.js": `
          module.exports = {
            scanner: {
              version: "1",
              scan: async function(payload) {
                console.error("PACKAGES:", JSON.stringify(payload.packages));
                return [];
              }
            }
          };
        `,
      });

      const [stdout, stderr, exitCode] = await runScan(dir);

      expect(stderr).toContain("PACKAGES: []\n");
      expect(stderr).not.toContain("error:");
      expect(stdout).toBe("No advisories found\n");
      expect(exitCode).toBe(0);
    });

    test("shows error when package.json doesn't exist", async () => {
      await using dir = tempDir("scan-no-package-json", {});

      const [stdout, stderr, exitCode] = await runScan(dir);

      expect(stderr).toContain("No package.json was found");
      expect(stdout).toBe("");
      expect(exitCode).toBe(1);
    });
  });

  describe("scanner execution", () => {
    test("scanner receives correct package format", async () => {
      await using dir = tempDir("scan-package-format", {
        "package.json": leftPadPkg,
        "bun.lock": leftPadLock,
        "bunfig.toml": scannerBunfig,
        "scanner.js": `
          module.exports = {
            scanner: {
              version: "1",
              scan: async function(payload) {
                console.error("PACKAGES:", JSON.stringify(payload.packages));
                if (!Array.isArray(payload.packages)) {
                  throw new Error("packages should be an array");
                }
                for (const pkg of payload.packages) {
                  if (!pkg.name || !pkg.version || !pkg.requestedRange || !pkg.tarball) {
                    throw new Error("Invalid package format: " + JSON.stringify(pkg));
                  }
                }
                return [];
              }
            }
          };
        `,
      });

      const [stdout, stderr, exitCode] = await runScan(dir);

      const line = stderr.split("\n").find(l => l.startsWith("PACKAGES:"));
      expect(line).toBeDefined();
      const packages = JSON.parse(line!.slice("PACKAGES:".length));
      expect(packages).toEqual([
        {
          name: "left-pad",
          version: "1.3.0",
          requestedRange: "1.3.0",
          tarball: expect.stringMatching(/^http:\/\/localhost:\d+\/left-pad-1\.3\.0\.tgz$/),
        },
      ]);
      expect(stdout).toContain("No advisories found");
      expect(exitCode).toBe(0);
    });

    test("scanner receives every kind of dependency, without the credentials in their URLs", async () => {
      const commit = "d1bea82fe75aef4c0f63d535f40de4095c846f0d";
      const dependencies = {
        "folder-dep": "file:./folder-dep",
        "git-https": "git+https://x-access-token:s3cret@example.com/org/repo.git?token=s3cret#main",
        "git-ssh": "git+ssh://git@example.com/org/repo.git#main",
        "github-dep": "github:user/repo#main",
        "linked-dep": "link:linked-dep",
        "local-tarball": "./local-tarball.tgz",
        "member": "workspace:*",
        "remote-tarball": "https://user:s3cret@example.com/remote-tarball.tgz?token=s3cret",
        "signed": "1.0.0",
      };
      await using dir = tempDir("scan-every-kind", {
        "package.json": JSON.stringify({ name: "test-app", workspaces: ["member"], dependencies }),
        "member/package.json": JSON.stringify({ name: "member", version: "1.0.0" }),
        "bun.lock": JSON.stringify({
          lockfileVersion: 1,
          workspaces: {
            "": { name: "test-app", dependencies },
            "member": { name: "member", version: "1.0.0" },
          },
          packages: {
            "folder-dep": ["folder-dep@file:folder-dep", {}],
            "git-https": [
              `git-https@git+https://x-access-token:s3cret@example.com/org/repo.git?token=s3cret#${commit}`,
              {},
              commit,
            ],
            "git-ssh": [`git-ssh@git+ssh://git@example.com/org/repo.git#${commit}`, {}, commit],
            "github-dep": ["github-dep@github:user/repo#abc1234", {}, "user-repo-abc1234"],
            "linked-dep": ["linked-dep@link:linked-dep", {}],
            "local-tarball": ["local-tarball@./local-tarball.tgz", {}],
            "member": ["member@workspace:member"],
            "remote-tarball": ["remote-tarball@https://user:s3cret@example.com/remote-tarball.tgz?token=s3cret", {}],
            "signed": [
              "signed@1.0.0",
              "https://user:s3cret@registry.example.com/signed/-/signed-1.0.0.tgz?signature=abc#fragment",
              {},
              "sha512-" + Buffer.alloc(64).toString("base64"),
            ],
          },
        }),
        "bunfig.toml": scannerBunfig,
        "scanner.js": `
          module.exports = {
            scanner: {
              version: "1",
              scan: async function(payload) {
                console.error("PACKAGES:" + JSON.stringify(payload.packages));
                return [];
              }
            }
          };
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "pm", "scan"],
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...bunEnv, GITHUB_API_URL: "https://user:s3cret@github.example.com/api/" },
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      const line = stderr.split("\n").find(l => l.startsWith("PACKAGES:"));
      expect(line, stderr).toBeDefined();
      const packages: Bun.Security.Package[] = JSON.parse(line!.slice("PACKAGES:".length));
      expect(packages.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
        { name: "folder-dep", version: "file:folder-dep", requestedRange: "file:./folder-dep", tarball: "" },
        {
          name: "git-https",
          version: `git+https://example.com/org/repo.git#${commit}`,
          requestedRange: "git+https://example.com/org/repo.git#main",
          tarball: "",
        },
        {
          name: "git-ssh",
          version: `git+ssh://example.com/org/repo.git#${commit}`,
          requestedRange: "git+ssh://example.com/org/repo.git#main",
          tarball: "",
        },
        {
          name: "github-dep",
          version: "github:user/repo#abc1234",
          requestedRange: "github:user/repo#main",
          tarball: "https://github.example.com/api/repos/user/repo/tarball/abc1234",
        },
        { name: "linked-dep", version: "link:linked-dep", requestedRange: "link:linked-dep", tarball: "" },
        {
          name: "local-tarball",
          version: "./local-tarball.tgz",
          requestedRange: "./local-tarball.tgz",
          tarball: "./local-tarball.tgz",
        },
        {
          name: "remote-tarball",
          version: "https://example.com/remote-tarball.tgz",
          requestedRange: "https://example.com/remote-tarball.tgz",
          tarball: "https://example.com/remote-tarball.tgz",
        },
        // The manifest names this URL, not the user: a registry that signs its tarball URLs puts the signature there.
        {
          name: "signed",
          version: "1.0.0",
          requestedRange: "1.0.0",
          tarball: "https://registry.example.com/signed/-/signed-1.0.0.tgz?signature=abc#fragment",
        },
      ]);
      expect(stdout).toContain("No advisories found");
      expect(exitCode).toBe(0);
    });

    test("scanner version validation", async () => {
      await using dir = tempDir("scan-version-check", {
        "package.json": leftPadPkg,
        "bun.lock": leftPadLock,
        "bunfig.toml": scannerBunfig,
        "scanner.js": `
          module.exports = {
            scanner: {
              version: "2", // Wrong version
              scan: async () => []
            }
          };
        `,
      });

      const [stdout, stderr, exitCode] = await runScan(dir);

      expect(stderr).toContain("Security scanner must be version 1");
      expect(stdout).not.toContain("No advisories found");
      expect(exitCode).toBe(1);
    });
  });

  describe("vulnerability detection", () => {
    test("detects fatal vulnerabilities", async () => {
      await using dir = tempDir("scan-fatal", {
        "package.json": leftPadPkg,
        "bun.lock": leftPadLock,
        "bunfig.toml": scannerBunfig,
        "scanner.js": `
          module.exports = {
            scanner: {
              version: "1",
              scan: async function(payload) {
                return [{
                  package: "left-pad",
                  level: "fatal",
                  description: "Prototype pollution vulnerability",
                  url: "https://example.com/CVE-2024-1234"
                }];
              }
            }
          };
        `,
      });

      const [stdout, stderr, exitCode] = await runScan(dir);

      expect(stdout).toContain("FATAL: left-pad");
      expect(stdout).toContain("Prototype pollution vulnerability");
      expect(stdout).toContain("https://example.com/CVE-2024-1234");
      expect(stdout).toMatch(/1 advisory \(.*1 fatal.*\)/);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(1);
    });

    test("detects warning vulnerabilities", async () => {
      await using dir = tempDir("scan-warn", {
        "package.json": leftPadPkg,
        "bun.lock": leftPadLock,
        "bunfig.toml": scannerBunfig,
        "scanner.js": `
          module.exports = {
            scanner: {
              version: "1",
              scan: async function(payload) {
                return [{
                  package: "left-pad",
                  level: "warn",
                  description: "Inefficient regular expression",
                  url: "https://example.com/advisory/123"
                }];
              }
            }
          };
        `,
      });

      const [stdout, stderr, exitCode] = await runScan(dir);

      expect(stdout).toContain("WARNING: left-pad");
      expect(stdout).toContain("Inefficient regular expression");
      expect(stdout).toMatch(/1 advisory \(.*1 warning.*\)/);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(1);
    });

    test("handles mixed vulnerabilities", async () => {
      await using dir = tempDir("scan-mixed", {
        "package.json": mixedPkg,
        "bun.lock": mixedLock,
        "bunfig.toml": scannerBunfig,
        "scanner.js": `
          module.exports = {
            scanner: {
              version: "1",
              scan: async function(payload) {
                const results = [];
                for (const pkg of payload.packages) {
                  if (pkg.name === "left-pad") {
                    results.push({ package: "left-pad", level: "fatal", description: "Critical vulnerability" });
                  }
                  if (pkg.name === "is-even") {
                    results.push({ package: "is-even", level: "warn", description: "Minor issue" });
                  }
                  if (pkg.name === "is-odd") {
                    results.push({ package: "is-odd", level: "warn", description: "Another minor issue" });
                  }
                }
                return results;
              }
            }
          };
        `,
      });

      const [stdout, stderr, exitCode] = await runScan(dir);

      expect(stdout).toContain("FATAL: left-pad");
      expect(stdout).toContain("WARNING: is-even");
      expect(stdout).toContain("WARNING: is-odd");
      expect(stdout).toMatch(/3 advisories \(.*1 fatal.*2 warnings.*\)/);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(1);
    });

    // The text of an advisory comes from a database that strangers can write to.
    test("control characters in an advisory are escaped", async () => {
      await using dir = tempDir("scan-control-characters", {
        "package.json": leftPadPkg,
        "bun.lock": leftPadLock,
        "bunfig.toml": scannerBunfig,
        "scanner.js": `
          module.exports = {
            scanner: {
              version: "1",
              scan: async () => [{
                package: "left-pad\\x1b[2K\\rsafe",
                level: "fatal",
                description: "first line\\n\\tsecond line\\x1b[1A\\x1b[2K",
                url: "https://example.com/\\x1b]8;;https://evil.example\\x07",
              }],
            }
          };
        `,
      });

      const [stdout, , exitCode] = await runScan(dir);

      expect(stdout.split("\n").slice(0, 6)).toEqual([
        "",
        String.raw`  FATAL: left-pad\x1b[2K\rsafe`,
        "    first line",
        "\t" + String.raw`second line\x1b[1A\x1b[2K`,
        String.raw`    https://example.com/\x1b]8;;https://evil.example\x07`,
        "",
      ]);
      expect(exitCode).toBe(1);
    });

    test("no vulnerabilities found", async () => {
      await using dir = tempDir("scan-clean", {
        "package.json": leftPadPkg,
        "bun.lock": leftPadLock,
        "bunfig.toml": scannerBunfig,
        "scanner.js": `
          module.exports = {
            scanner: {
              version: "1",
              scan: async () => []
            }
          };
        `,
      });

      const [stdout, stderr, exitCode] = await runScan(dir);

      expect(stdout).toContain("No advisories found");
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    });
  });

  describe("dependency paths", () => {
    test("shows correct path for direct dependencies", async () => {
      await using dir = tempDir("scan-direct-dep", {
        "package.json": isEvenPkg,
        "bun.lock": isEvenLock,
        "bunfig.toml": scannerBunfig,
        "scanner.js": `
          module.exports = {
            scanner: {
              version: "1",
              scan: async function(payload) {
                const results = [];
                for (const pkg of payload.packages) {
                  if (pkg.name === "is-even") {
                    results.push({ package: "is-even", level: "fatal", description: "Test vulnerability" });
                  }
                }
                return results;
              }
            }
          };
        `,
      });

      const [stdout, stderr, exitCode] = await runScan(dir);

      expect(stdout).toContain("FATAL: is-even");
      // is-even and is-odd depend on each other in the fixture registry; anchor
      // the end of the path so a shortest-path regression that prints
      // "… › is-even › is-odd › is-even" is caught.
      expect(stdout).toMatch(/via my-app › is-even$/m);
      expect(stdout).not.toContain("is-odd");
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(1);
    });

    test("shows correct path for transitive dependencies", async () => {
      await using dir = tempDir("scan-transitive-dep", {
        "package.json": isEvenPkg,
        "bun.lock": isEvenLock,
        "bunfig.toml": scannerBunfig,
        "scanner.js": `
          module.exports = {
            scanner: {
              version: "1",
              scan: async function(payload) {
                const results = [];
                for (const pkg of payload.packages) {
                  if (pkg.name === "is-odd") {
                    results.push({ package: "is-odd", level: "warn", description: "Transitive vulnerability" });
                  }
                }
                return results;
              }
            }
          };
        `,
      });

      const [stdout, stderr, exitCode] = await runScan(dir);

      expect(stdout).toContain("WARNING: is-odd");
      expect(stdout).toMatch(/via my-app › is-even › is-odd$/m);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(1);
    });
  });

  describe("error handling", () => {
    test("handles scanner crash", async () => {
      await using dir = tempDir("scan-crash", {
        "package.json": leftPadPkg,
        "bun.lock": leftPadLock,
        "bunfig.toml": scannerBunfig,
        "scanner.js": `
          module.exports = {
            scanner: {
              version: "1",
              scan: async function() {
                process.exit(42);
              }
            }
          };
        `,
      });

      const [stdout, stderr, exitCode] = await runScan(dir);

      expect(stderr).toContain("Security scanner exited with code 42");
      expect(stdout).not.toContain("No advisories found");
      expect(exitCode).toBe(1);
    });

    test("handles invalid JSON from scanner", async () => {
      await using dir = tempDir("scan-bad-json", {
        "package.json": leftPadPkg,
        "bun.lock": leftPadLock,
        "bunfig.toml": scannerBunfig,
        "scanner.js": `
          module.exports = {
            scanner: {
              version: "1",
              scan: async function() {
                return { not: "an array" };
              }
            }
          };
        `,
      });

      const [stdout, stderr, exitCode] = await runScan(dir);

      expect(stderr).toContain("Security scanner must return an array");
      expect(stdout).not.toContain("No advisories found");
      expect(exitCode).toBe(1);
    });

    test("handles missing required fields in advisory", async () => {
      await using dir = tempDir("scan-missing-fields", {
        "package.json": leftPadPkg,
        "bun.lock": leftPadLock,
        "bunfig.toml": scannerBunfig,
        "scanner.js": `
          module.exports = {
            scanner: {
              version: "1",
              scan: async function() {
                return [{
                  package: "left-pad"
                  // Missing 'level' field
                }];
              }
            }
          };
        `,
      });

      const [stdout, stderr, exitCode] = await runScan(dir);

      expect(stderr).toContain("missing required 'level' field");
      expect(stdout).not.toContain("No advisories found");
      expect(exitCode).toBe(1);
    });
  });

  describe("output formatting", () => {
    test("singular vs plural in summary", async () => {
      await using dir = tempDir("scan-singular", {
        "package.json": leftPadPkg,
        "bun.lock": leftPadLock,
        "bunfig.toml": scannerBunfig,
        "scanner.js": `
          module.exports = {
            scanner: {
              version: "1",
              scan: async function(payload) {
                const results = [];
                for (const pkg of payload.packages) {
                  if (pkg.name === "left-pad") {
                    results.push({ package: "left-pad", level: "fatal", description: "Test" });
                  }
                }
                return results;
              }
            }
          };
        `,
      });

      const [stdout, stderr, exitCode] = await runScan(dir);

      expect(stdout).toContain("1 advisory (");
      expect(stdout).not.toContain("1 advisories");
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(1);
    });

    test("shows timing for slow scans", async () => {
      await using dir = tempDir("scan-slow", {
        "package.json": leftPadPkg,
        "bun.lock": leftPadLock,
        "bunfig.toml": scannerBunfig,
        "scanner.js": `
          module.exports = {
            scanner: {
              version: "1",
              scan: async function() {
                // Timing output is only printed when the scan takes >= 1000ms.
                await new Promise(resolve => setTimeout(resolve, 1050));
                return [];
              }
            }
          };
        `,
      });

      const [stdout, stderr, exitCode] = await runScan(dir);

      expect(stderr).toMatch(/Scanning \d+ package[s]? took \d+ms/);
      expect(stdout).toContain("No advisories found");
      expect(exitCode).toBe(0);
    });
  });

  describe("differences from bun add/install", () => {
    test("does not show 'installation aborted' message", async () => {
      await using dir = tempDir("scan-no-abort-msg", {
        "package.json": leftPadPkg,
        "bun.lock": leftPadLock,
        "bunfig.toml": scannerBunfig,
        "scanner.js": `
          module.exports = {
            scanner: {
              version: "1",
              scan: async function() {
                return [{ package: "left-pad", level: "fatal", description: "Critical" }];
              }
            }
          };
        `,
      });

      const [stdout, stderr, exitCode] = await runScan(dir);

      expect(stdout).toContain("FATAL: left-pad");
      expect(stdout.toLowerCase()).not.toContain("installation aborted");
      expect(stderr.toLowerCase()).not.toContain("installation aborted");
      expect(exitCode).toBe(1);
    });
  });
});
