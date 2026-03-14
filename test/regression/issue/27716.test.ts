import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Issue #27716: bun install skips all processing when a security scanner is
// present and the project has many packages. The root cause was that the
// packages JSON was inlined into the -e argument to the scanner subprocess,
// exceeding the OS maximum argument length (MAX_ARG_STRLEN = 128KB on Linux).
//
// The fix writes the JSON to a temp file instead of inlining it.

const PACKAGE_COUNT = 1000; // ~160KB of JSON, exceeds MAX_ARG_STRLEN

test("security scanner receives packages via temp file with large package count", async () => {
  // Generate many dependencies
  const dependencies: Record<string, string> = {};
  for (let i = 0; i < PACKAGE_COUNT; i++) {
    dependencies[`pkg-${String(i).padStart(4, "0")}`] = "0.0.1";
  }

  using dir = tempDir("issue-27716", {
    "package.json": JSON.stringify({
      name: "test-large-scanner",
      version: "1.0.0",
      dependencies,
    }),
    "scanner.ts": `
      export const scanner = {
        version: "1",
        scan: async ({ packages }) => {
          // Log the count so the parent can verify
          console.log("SCANNER_PACKAGE_COUNT:" + packages.length);
          return [];
        },
      };
    `,
    "bunfig.toml": `
[install]
registry = "http://localhost:__PORT__/"

[install.security]
scanner = "./scanner.ts"
`,
  });

  // Start a tiny registry that serves identical tarballs for all packages
  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      if (pathname.endsWith(".tgz")) {
        // Serve a minimal valid npm tarball (empty package)
        return new Response(makeTarball(pathname));
      }

      // Registry metadata response
      const name = pathname.slice(1); // strip leading /
      return Response.json({
        name,
        versions: {
          "0.0.1": {
            name,
            version: "0.0.1",
            dist: {
              tarball: `http://localhost:${server.port}/${name}-0.0.1.tgz`,
            },
          },
        },
        "dist-tags": { latest: "0.0.1" },
      });
    },
  });

  // Patch bunfig with the actual port
  const bunfigPath = join(String(dir), "bunfig.toml");
  const bunfig = await Bun.file(bunfigPath).text();
  await Bun.write(bunfigPath, bunfig.replace("__PORT__", String(server.port)));

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--ignore-scripts"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The scanner should have received all packages and logged the count.
  // On the broken system bun, the scanner subprocess fails to start because
  // the inlined JSON exceeds MAX_ARG_STRLEN, so this line won't appear.
  expect(stdout).toContain(`SCANNER_PACKAGE_COUNT:${PACKAGE_COUNT}`);
  expect(exitCode).toBe(0);
}, 120_000);

// Creates a minimal valid npm tarball containing just a package.json
function makeTarball(name: string): Uint8Array {
  // Create a minimal tar.gz with just a package/package.json
  const packageJson = JSON.stringify({ name: "pkg", version: "0.0.1" });

  // Use pre-built minimal tarball bytes
  // This is a gzipped tar containing package/package.json with {"name":"pkg","version":"0.0.1"}
  return createMinimalTarGz(packageJson);
}

function createMinimalTarGz(content: string): Uint8Array {
  // Build a minimal tar archive
  const encoder = new TextEncoder();
  const contentBytes = encoder.encode(content);

  // Tar header (512 bytes)
  const header = new Uint8Array(512);
  const filename = "package/package.json";

  // Write filename
  for (let i = 0; i < filename.length; i++) {
    header[i] = filename.charCodeAt(i);
  }

  // File mode (0644)
  writeOctal(header, 100, 8, 0o644);
  // Owner/Group ID
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  // File size
  writeOctal(header, 124, 12, contentBytes.length);
  // Modification time
  writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  // Type flag (regular file)
  header[156] = 0x30; // '0'
  // USTAR magic
  const magic = "ustar\0";
  for (let i = 0; i < magic.length; i++) {
    header[257 + i] = magic.charCodeAt(i);
  }
  header[263] = 0x30; // version '0'
  header[264] = 0x30; // version '0'

  // Calculate checksum
  // First fill checksum field with spaces
  for (let i = 148; i < 156; i++) {
    header[i] = 0x20;
  }
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i];
  }
  writeOctal(header, 148, 7, checksum);
  header[155] = 0x20; // space after checksum

  // Content padded to 512-byte boundary
  const contentPadded = new Uint8Array(Math.ceil(contentBytes.length / 512) * 512);
  contentPadded.set(contentBytes);

  // End-of-archive marker (two 512-byte blocks of zeros)
  const endMarker = new Uint8Array(1024);

  // Concatenate tar
  const tar = new Uint8Array(header.length + contentPadded.length + endMarker.length);
  tar.set(header, 0);
  tar.set(contentPadded, header.length);
  tar.set(endMarker, header.length + contentPadded.length);

  // Gzip compress
  return Bun.gzipSync(tar);
}

function writeOctal(buf: Uint8Array, offset: number, length: number, value: number): void {
  const str = value.toString(8).padStart(length - 1, "0");
  for (let i = 0; i < str.length && i < length - 1; i++) {
    buf[offset + i] = str.charCodeAt(i);
  }
  buf[offset + length - 1] = 0;
}
