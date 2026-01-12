import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

/**
 * Regression test for issue #25908
 * https://github.com/oven-sh/bun/issues/25908
 *
 * Bug: When running `bun install --verbose`, tarball download URLs were not
 * logged while package manifest URLs were logged correctly.
 *
 * Fix: Added `this.unsafe_http_client.verbose = .headers;` in the forTarball()
 * function in src/install/NetworkTask.zig (matching forManifest() behavior).
 */
describe("issue #25908: verbose install should log tarball downloads", () => {
  let mockRegistryServer: Server;
  let mockRegistryUrl: string;

  // Helper to create a minimal valid tarball
  const createTarball = (name: string, version: string) => {
    const packageJson = JSON.stringify({
      name,
      version,
      description: "test package",
      main: "index.js",
    });

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

        // Handle package manifest request
        if (url.pathname === "/test-pkg") {
          const packageData = {
            name: "test-pkg",
            "dist-tags": {
              latest: "1.0.0",
            },
            versions: {
              "1.0.0": {
                name: "test-pkg",
                version: "1.0.0",
                dist: {
                  tarball: `${mockRegistryUrl}/test-pkg/-/test-pkg-1.0.0.tgz`,
                },
              },
            },
          };
          return Response.json(packageData);
        }

        // Handle tarball request
        if (url.pathname === "/test-pkg/-/test-pkg-1.0.0.tgz") {
          const tarball = createTarball("test-pkg", "1.0.0");
          return new Response(tarball, {
            headers: {
              "Content-Type": "application/octet-stream",
            },
          });
        }

        return new Response("Not Found", { status: 404 });
      },
    });
    mockRegistryUrl = `http://localhost:${mockRegistryServer.port}`;
  });

  afterAll(() => {
    mockRegistryServer?.stop();
  });

  test("tarball download URLs are logged with --verbose flag", async () => {
    using dir = tempDir("issue-25908", {
      "package.json": JSON.stringify({
        name: "test-project",
        dependencies: {
          "test-pkg": "1.0.0",
        },
      }),
      ".npmrc": `registry=${mockRegistryUrl}`,
      // Use a custom bunfig to avoid global cache
      "bunfig.toml": `[install]\ncache = false`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--verbose"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Verbose output goes to stderr
    const output = stderr + stdout;

    // The manifest URL should be logged
    expect(output).toContain("/test-pkg");

    // The tarball URL should also be logged (this was the bug - it wasn't being logged)
    expect(output).toContain("/test-pkg/-/test-pkg-1.0.0.tgz");

    expect(exitCode).toBe(0);
  });
});
