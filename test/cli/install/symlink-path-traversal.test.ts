import { spawn } from "bun";
import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { access, chmod, lstat, readdir, readlink, rm, stat, symlink, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, tempDir } from "harness";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "os";
import { join } from "path";

// This test validates the fix for a symlink path traversal vulnerability in tarball extraction.
// CVE: Path traversal via symlink when installing packages
//
// The attack works as follows:
// 1. Create a tarball with a symlink entry pointing outside (e.g., symlink -> ../../../tmp)
// 2. Include a file entry through that symlink path (e.g., symlink/pwned.txt)
// 3. On extraction, the symlink is created first
// 4. Then when the file is written through the symlink path, it escapes the extraction directory
//
// The fix validates symlink targets before creating them, blocking those that would escape.
//
// Note: These tests only run on POSIX systems as the symlink extraction code is POSIX-only.

// Platform-agnostic temp directory for testing path traversal
const systemTmpDir = tmpdir();
const pwnedFilePath = join(systemTmpDir, "pwned.txt");

// Helper to create tar files programmatically
function createTarHeader(
  name: string,
  size: number,
  type: "0" | "2" | "5", // 0=file, 2=symlink, 5=directory
  linkname: string = "",
): Uint8Array {
  const header = new Uint8Array(512);
  const encoder = new TextEncoder();

  // Name (100 bytes)
  const nameBytes = encoder.encode(name);
  header.set(nameBytes.slice(0, 100), 0);

  // Mode (8 bytes) - octal
  const modeStr = type === "5" ? "0000755" : "0000644";
  header.set(encoder.encode(modeStr.padStart(7, "0") + " "), 100);

  // UID (8 bytes)
  header.set(encoder.encode("0000000 "), 108);

  // GID (8 bytes)
  header.set(encoder.encode("0000000 "), 116);

  // Size (12 bytes) - octal
  const sizeStr = size.toString(8).padStart(11, "0") + " ";
  header.set(encoder.encode(sizeStr), 124);

  // Mtime (12 bytes)
  const mtime = Math.floor(Date.now() / 1000)
    .toString(8)
    .padStart(11, "0");
  header.set(encoder.encode(mtime + " "), 136);

  // Checksum placeholder (8 spaces)
  header.set(encoder.encode("        "), 148);

  // Type flag (1 byte)
  header[156] = type.charCodeAt(0);

  // Link name (100 bytes) - for symlinks
  if (linkname) {
    const linkBytes = encoder.encode(linkname);
    header.set(linkBytes.slice(0, 100), 157);
  }

  // USTAR magic
  header.set(encoder.encode("ustar"), 257);
  header[262] = 0; // null terminator
  header.set(encoder.encode("00"), 263);

  // Calculate and set checksum
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i];
  }
  const checksumStr = checksum.toString(8).padStart(6, "0") + "\0 ";
  header.set(encoder.encode(checksumStr), 148);

  return header;
}

function padToBlock(data: Uint8Array): Uint8Array[] {
  const result = [data];
  const remainder = data.length % 512;
  if (remainder > 0) {
    result.push(new Uint8Array(512 - remainder));
  }
  return result;
}

function createTarball(
  entries: Array<{ name: string; type: "file" | "symlink" | "dir"; content?: string; linkname?: string }>,
): Uint8Array {
  const blocks: Uint8Array[] = [];
  const encoder = new TextEncoder();

  for (const entry of entries) {
    if (entry.type === "dir") {
      blocks.push(createTarHeader(entry.name, 0, "5"));
    } else if (entry.type === "symlink") {
      blocks.push(createTarHeader(entry.name, 0, "2", entry.linkname || ""));
    } else {
      const content = encoder.encode(entry.content || "");
      blocks.push(createTarHeader(entry.name, content.length, "0"));
      blocks.push(...padToBlock(content));
    }
  }

  // End of archive (two empty blocks)
  blocks.push(new Uint8Array(512));
  blocks.push(new Uint8Array(512));

  // Combine all blocks
  const totalLength = blocks.reduce((sum, b) => sum + b.length, 0);
  const tarball = new Uint8Array(totalLength);
  let offset = 0;
  for (const block of blocks) {
    tarball.set(block, offset);
    offset += block.length;
  }

  return Bun.gzipSync(tarball);
}

// Skip on Windows - symlink extraction is POSIX-only
const isWindows = process.platform === "win32";

describe.concurrent.skipIf(isWindows)("symlink path traversal protection", () => {
  setDefaultTimeout(60000);

  it("rejects symlink targets that climb above the package root before re-entering a 'packages' directory (streaming extraction)", async () => {
    // The streaming extractor used to validate symlink targets by joining
    // them onto a fake absolute root ("/packages/") and checking the prefix
    // of the normalized result. POSIX normalization clamps excess ".." at
    // "/", so a target of the form "(../)+packages/<x>" normalized back
    // under the fake root and passed the check, while the kernel resolves
    // the raw ".." components from the symlink's real on-disk location and
    // lands outside the extraction directory. Such targets must be rejected.
    const escapeTarget = "../../../../packages/escape-target";

    // Incompressible padding so the tarball body is delivered over many
    // socket reads; the streaming extractor only takes over when the body
    // arrives in multiple chunks.
    let pad = "";
    let seed = "streaming-symlink-pad";
    while (pad.length < 256 * 1024) {
      seed = createHash("sha256").update(seed).digest("hex");
      pad += seed;
    }

    const tarball = createTarball([
      { name: "test-package/", type: "dir" },
      {
        name: "test-package/package.json",
        type: "file",
        content: JSON.stringify({ name: "test-package", version: "1.0.0" }),
      },
      { name: "test-package/escape-link", type: "symlink", linkname: escapeTarget },
      { name: "test-package/pad.bin", type: "file", content: pad },
    ]);

    // node:http rather than Bun.serve so the response carries an explicit
    // Content-Length *and* can be drip-fed; each write is its own packet so
    // the install's HTTP client sees multiple progress callbacks and commits
    // to the streaming extractor.
    const httpServer = createServer((req, res) => {
      const url = new URL(req.url!, "http://localhost");
      if (url.pathname.includes("/tarball/")) {
        res.setHeader("Content-Type", "application/gzip");
        res.setHeader("Content-Length", String(tarball.length));
        req.socket.setNoDelay(true);
        let offset = 0;
        const step = () => {
          if (offset >= tarball.length) {
            res.end();
            return;
          }
          res.write(Buffer.from(tarball.subarray(offset, Math.min(offset + 1024, tarball.length))));
          offset += 1024;
          setImmediate(step);
        };
        step();
        return;
      }
      if (url.pathname.includes("/repos/")) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ default_branch: "main" }));
        return;
      }
      res.statusCode = 404;
      res.end("Not Found");
    });
    await new Promise<void>(resolve => httpServer.listen(0, "127.0.0.1", () => resolve()));
    const port = (httpServer.address() as { port: number }).port;

    try {
      using dir = tempDir("streaming-symlink-target-test", {});
      const installDir = String(dir);

      await writeFile(
        join(installDir, "package.json"),
        JSON.stringify({
          name: "test-app",
          version: "1.0.0",
          dependencies: { "test-package": "github:user/repo#main" },
        }),
      );

      const proc = spawn({
        cmd: [bunExe(), "install", "--verbose"],
        cwd: installDir,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...env,
          GITHUB_API_URL: `http://127.0.0.1:${port}`,
          BUN_INSTALL_CACHE_DIR: join(installDir, ".bun-cache"),
          // Lower the streaming threshold so this tarball qualifies without
          // having to be multiple megabytes.
          BUN_INSTALL_STREAMING_MIN_SIZE: "1024",
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Confirm the streaming extractor actually handled this tarball; if the
      // buffered fallback ran instead this test would not be exercising the
      // streaming symlink validation at all.
      expect(stderr).toContain("Streamed ");

      if (exitCode !== 0) {
        console.error("Install failed with exit code:", exitCode);
        console.error("stdout:", stdout);
        console.error("stderr:", stderr);
      }
      expect(exitCode).toBe(0);

      // No symlink anywhere under the install root (node_modules and the
      // package cache included) may point at the escaping target.
      const escapingSymlinks: string[] = [];
      for (const entry of await readdir(installDir, { recursive: true, withFileTypes: true })) {
        if (!entry.isSymbolicLink()) continue;
        const linkPath = join(entry.parentPath, entry.name);
        const target = await readlink(linkPath);
        if (target.includes("escape-target")) {
          escapingSymlinks.push(`${linkPath} -> ${target}`);
        }
      }
      expect(escapingSymlinks).toEqual([]);

      // The legitimate entries are still extracted.
      const pkgDir = join(installDir, "node_modules", "test-package");
      await access(join(pkgDir, "package.json"));
      await access(join(pkgDir, "pad.bin"));
    } finally {
      httpServer.closeAllConnections?.();
      await new Promise<void>(resolve => httpServer.close(() => resolve()));
    }
  });

  it("should skip symlinks with relative path traversal targets", async () => {
    // This reproduces the exact attack from the security report:
    // 1. Symlink test-package/symlink-to-tmp -> ../../../../../../../<tmpdir>
    // 2. File test-package/symlink-to-tmp/pwned.txt

    // Calculate relative path to system temp directory (enough ../ to escape)
    const symlinkTarget = "../../../../../../../" + systemTmpDir.replace(/^\//, "");

    const tarball = createTarball([
      { name: "test-package/", type: "dir" },
      {
        name: "test-package/package.json",
        type: "file",
        content: JSON.stringify({ name: "test-package", version: "1.0.0" }),
      },
      // Malicious symlink pointing way outside
      { name: "test-package/symlink-to-tmp", type: "symlink", linkname: symlinkTarget },
      // File that would be written through the symlink
      { name: "test-package/symlink-to-tmp/pwned.txt", type: "file", content: "Arbitrary file write" },
    ]);

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.includes("/tarball/") || url.pathname.endsWith(".tar.gz")) {
          return new Response(tarball, { headers: { "Content-Type": "application/gzip" } });
        }
        if (url.pathname.includes("/repos/")) {
          return Response.json({ default_branch: "main" });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    try {
      using dir = tempDir("symlink-traversal-test", {});
      const installDir = String(dir);

      await writeFile(
        join(installDir, "package.json"),
        JSON.stringify({
          name: "test-app",
          version: "1.0.0",
          dependencies: { "test-package": "github:user/repo#main" },
        }),
      );

      await writeFile(join(installDir, "bunfig.toml"), `[install]\ncache = false\n`);

      const proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: installDir,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...env, GITHUB_API_URL: `http://localhost:${server.port}` },
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // The install should complete successfully (exit code 0)
      // If it fails, show diagnostics
      if (exitCode !== 0) {
        console.error("Install failed with exit code:", exitCode);
        console.error("stdout:", stdout);
        console.error("stderr:", stderr);
      }
      expect(exitCode).toBe(0);

      // Verify stderr doesn't leak absolute paths like the system temp directory
      expect(stderr).not.toContain(systemTmpDir);

      // CRITICAL CHECK: Verify no file was written to system temp directory
      let fileInTmp = false;
      try {
        await access(pwnedFilePath);
        fileInTmp = true;
      } catch {
        fileInTmp = false;
      }
      expect(fileInTmp).toBe(false);

      // Verify the malicious symlink was NOT created as a symlink
      // (It may exist as a directory since the tarball has a file entry through it)
      const pkgDir = join(installDir, "node_modules", "test-package");
      const symlinkPath = join(pkgDir, "symlink-to-tmp");
      try {
        const stats = await lstat(symlinkPath);
        // If it exists, it must NOT be a symlink (directory is OK - that's what happens
        // when the symlink is blocked but a file tries to write through it)
        expect(stats.isSymbolicLink()).toBe(false);
      } catch {
        // Path doesn't exist at all - also acceptable
      }
    } finally {
      server.stop();
      // Clean up pwned file in case the test failed
      try {
        await rm(pwnedFilePath, { force: true });
      } catch {}
    }
  });

  it("should skip symlinks with absolute path targets", async () => {
    const tarball = createTarball([
      { name: "test-package/", type: "dir" },
      {
        name: "test-package/package.json",
        type: "file",
        content: JSON.stringify({ name: "test-package", version: "1.0.0" }),
      },
      // Absolute symlink - directly points to system temp directory
      { name: "test-package/abs-symlink", type: "symlink", linkname: systemTmpDir },
    ]);

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.includes("/tarball/") || url.pathname.endsWith(".tar.gz")) {
          return new Response(tarball, { headers: { "Content-Type": "application/gzip" } });
        }
        if (url.pathname.includes("/repos/")) {
          return Response.json({ default_branch: "main" });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    try {
      using dir = tempDir("absolute-symlink-test", {});
      const installDir = String(dir);

      await writeFile(
        join(installDir, "package.json"),
        JSON.stringify({
          name: "test-app",
          version: "1.0.0",
          dependencies: { "test-package": "github:user/repo#main" },
        }),
      );

      await writeFile(join(installDir, "bunfig.toml"), `[install]\ncache = false\n`);

      const proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: installDir,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...env, GITHUB_API_URL: `http://localhost:${server.port}` },
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // The install should complete successfully
      if (exitCode !== 0) {
        console.error("Install failed with exit code:", exitCode);
        console.error("stdout:", stdout);
        console.error("stderr:", stderr);
      }
      expect(exitCode).toBe(0);

      // Check that no absolute symlink was created
      const pkgDir = join(installDir, "node_modules", "test-package");
      try {
        const symlinkPath = join(pkgDir, "abs-symlink");
        const stats = await lstat(symlinkPath);
        if (stats.isSymbolicLink()) {
          const target = await readlink(symlinkPath);
          // Absolute symlinks should be blocked
          expect(target.startsWith("/")).toBe(false);
        }
      } catch {
        // Symlink doesn't exist - expected behavior
      }
    } finally {
      server.stop();
    }
  });

  it("should allow safe relative symlinks within the package (install succeeds)", async () => {
    // This test verifies that safe symlinks don't cause extraction to fail.
    // Note: Safe symlinks ARE created in the cache during extraction, but bun's
    // install process doesn't preserve them in the final node_modules.
    // We verify the install succeeds, which proves safe symlinks are allowed.
    const tarball = createTarball([
      { name: "test-package/", type: "dir" },
      {
        name: "test-package/package.json",
        type: "file",
        content: JSON.stringify({ name: "test-package", version: "1.0.0" }),
      },
      { name: "test-package/src/", type: "dir" },
      { name: "test-package/src/index.js", type: "file", content: "module.exports = 'hello';" },
      // Safe symlink - points to sibling directory (stays within package)
      { name: "test-package/link-to-src", type: "symlink", linkname: "src" },
      // Safe symlink - relative path within same directory
      { name: "test-package/src/link-to-index", type: "symlink", linkname: "./index.js" },
    ]);

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.includes("/tarball/") || url.pathname.endsWith(".tar.gz")) {
          return new Response(tarball, { headers: { "Content-Type": "application/gzip" } });
        }
        if (url.pathname.includes("/repos/")) {
          return Response.json({ default_branch: "main" });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    try {
      using dir = tempDir("safe-symlink-test", {});
      const installDir = String(dir);

      await writeFile(
        join(installDir, "package.json"),
        JSON.stringify({
          name: "test-app",
          version: "1.0.0",
          dependencies: { "test-package": "github:user/repo#main" },
        }),
      );

      await writeFile(join(installDir, "bunfig.toml"), `[install]\ncache = false\n`);

      const proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: installDir,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...env, GITHUB_API_URL: `http://localhost:${server.port}` },
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Install should succeed - safe symlinks should not cause errors
      if (exitCode !== 0) {
        console.error("Install failed with exit code:", exitCode);
        console.error("stdout:", stdout);
        console.error("stderr:", stderr);
      }
      expect(exitCode).toBe(0);

      // Verify package was installed (package.json should exist)
      const pkgDir = join(installDir, "node_modules", "test-package");
      const pkgJsonPath = join(pkgDir, "package.json");
      await access(pkgJsonPath); // Throws if doesn't exist
    } finally {
      server.stop();
    }
  });
});

it.skipIf(isWindows)(
  "rejects symlink targets that climb through other symlinks from the same archive (.bun-tag write stays inside the package)",
  async () => {
    // A tarball can ship symlinks whose targets each normalize to a path
    // inside the package (`l1 -> .`, `l2 -> l1/..`, `l3 -> l2/..`, ...).
    // Lexically every hop is "safe", but the kernel resolves each link before
    // applying `..`, so each hop climbs one directory until it clamps at `/`.
    // A final `.bun-tag -> lN/<absolute path minus leading slash>` entry then
    // makes the post-extraction `.bun-tag` marker write (O_CREAT|O_TRUNC) land
    // on an arbitrary file. The extractor must reject symlink targets with a
    // `..` component that follows a named component, and must not follow a
    // pre-existing `.bun-tag` when writing the marker.
    const victimPath = join(systemTmpDir, `bun-tag-victim-${Math.random().toString(36).slice(2, 10)}.txt`);
    await writeFile(victimPath, "original-content");

    const chainLength = 30;
    const entries: Parameters<typeof createTarball>[0] = [
      { name: "test-package/", type: "dir" },
      {
        name: "test-package/package.json",
        type: "file",
        content: JSON.stringify({ name: "test-package", version: "1.0.0" }),
      },
      { name: "test-package/l1", type: "symlink", linkname: "." },
    ];
    for (let i = 2; i <= chainLength; i++) {
      // Normalizes to "" (inside the package), but resolves one directory
      // above wherever l(i-1) resolves to.
      entries.push({ name: `test-package/l${i}`, type: "symlink", linkname: `l${i - 1}/..` });
    }
    // After `chainLength` hops the chain is clamped at `/`, so this resolves to
    // the absolute victim path while still normalizing to a path inside the
    // package directory.
    entries.push({
      name: "test-package/.bun-tag",
      type: "symlink",
      linkname: `l${chainLength}/${victimPath.replace(/^\/+/, "")}`,
    });
    const tarball = createTarball(entries);

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.includes("/tarball/") || url.pathname.endsWith(".tar.gz")) {
          return new Response(tarball, { headers: { "Content-Type": "application/gzip" } });
        }
        if (url.pathname.includes("/repos/")) {
          return Response.json({ default_branch: "main" });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    try {
      using dir = tempDir("bun-tag-symlink-chain-test", {});
      const installDir = String(dir);

      await writeFile(
        join(installDir, "package.json"),
        JSON.stringify({
          name: "test-app",
          version: "1.0.0",
          dependencies: { "test-package": "github:user/repo#main" },
        }),
      );

      const proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: installDir,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...env,
          GITHUB_API_URL: `http://localhost:${server.port}`,
          BUN_INSTALL_CACHE_DIR: join(installDir, ".bun-cache"),
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // The file outside the extraction directory must be untouched: same
      // content, not truncated, not replaced with the github tag string.
      expect(await Bun.file(victimPath).text()).toBe("original-content");

      // The legitimate package contents are still installed.
      const pkgDir = join(installDir, "node_modules", "test-package");
      await access(join(pkgDir, "package.json"));

      if (exitCode !== 0) {
        console.error("Install failed with exit code:", exitCode);
        console.error("stdout:", stdout);
        console.error("stderr:", stderr);
      }
      expect(exitCode).toBe(0);
    } finally {
      server.stop();
      await rm(victimPath, { force: true });
    }
  },
  60000,
);

it.skipIf(isWindows)(
  "does not change permissions of a file reached through a symlinked bin target",
  async () => {
    // After creating `node_modules/.bin/<name>`, the installer chmods the bin
    // target to make it executable. If the bin target inside the package is
    // itself a symlink (git/file/workspace dependencies can ship one — the npm
    // tarball extractor never materializes one), chmod follows it and changes
    // the mode of whatever file it points at, including files outside
    // node_modules. The chmod must be skipped when the bin target is a symlink.
    using dir = tempDir("bin-target-symlink-test", {
      // Pin the hoisted linker so the bin link lands at node_modules/.bin and
      // the chmod runs against the package's own bin target.
      "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
      "package.json": JSON.stringify({
        name: "bin-target-symlink-app",
        version: "1.0.0",
        workspaces: ["packages/*"],
      }),
      "packages/dep/package.json": JSON.stringify({
        name: "dep-with-symlinked-bin",
        version: "1.0.0",
        bin: { "dep-with-symlinked-bin": "./payload" },
      }),
      "victim.txt": "do not make me executable",
    });
    const installDir = String(dir);

    const victimPath = join(installDir, "victim.txt");
    await chmod(victimPath, 0o600);
    // The bin target is a symlink whose destination is outside the package
    // directory.
    await symlink(join("..", "..", "victim.txt"), join(installDir, "packages", "dep", "payload"));

    const proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: installDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The file the symlink points at keeps its original permissions; the
    // installer must not chmod through a symlinked bin target.
    expect((await stat(victimPath)).mode & 0o777).toBe(0o600);

    // The bin link itself is still created.
    const binLink = join(installDir, "node_modules", ".bin", "dep-with-symlinked-bin");
    expect((await lstat(binLink)).isSymbolicLink()).toBe(true);

    if (exitCode !== 0) {
      console.error("Install failed with exit code:", exitCode);
      console.error("stdout:", stdout);
      console.error("stderr:", stderr);
    }
    expect(exitCode).toBe(0);
  },
  60000,
);
