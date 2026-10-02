import { spawn } from "bun";
import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { access, chmod, lstat, mkdir, readdir, readlink, realpath, rm, stat, symlink, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, tempDir } from "harness";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "os";
import { basename, join } from "path";

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

  for (const mode of ["streaming", "buffered"] as const) {
    it(`writes every directory and file entry inside the package root before creating symlink entries whose names differ only by Unicode normalization (${mode} extraction)`, async () => {
      let pad = "";
      let seed = `deferred-symlink-pad-${mode}`;
      while (pad.length < 256 * 1024) {
        seed = createHash("sha256").update(seed).digest("hex");
        pad += seed;
      }

      const composed = "d/" + String.fromCharCode(0xe9);
      const decomposed = "d/e" + String.fromCharCode(0x301);
      const tarball = createTarball([
        { name: "test-package/", type: "dir" },
        {
          name: "test-package/package.json",
          type: "file",
          content: JSON.stringify({ name: "test-package", version: "1.0.0" }),
        },
        { name: "test-package/z/", type: "dir" },
        { name: "test-package/q/", type: "dir" },
        { name: `test-package/${composed}`, type: "symlink", linkname: "../q" },
        { name: `test-package/${decomposed}/x`, type: "symlink", linkname: "../../z" },
        { name: "test-package/q/x/marker/", type: "dir" },
        { name: "test-package/q/x/marker/proof.txt", type: "file", content: "stays inside the package" },
        { name: `test-package/${decomposed}/x/nested.txt`, type: "file", content: "written at its literal path" },
        { name: "test-package/pad.bin", type: "file", content: pad },
      ]);

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
        using dir = tempDir(`deferred-symlink-${mode}-test`, {
          "package.json": JSON.stringify({
            name: "test-app",
            version: "1.0.0",
            dependencies: { "test-package": "github:user/repo#main" },
          }),
        });
        const installDir = String(dir);
        const scratch = join(installDir, ".bun-tmp");
        const cache = join(installDir, ".bun-cache");
        await mkdir(join(scratch, "z"), { recursive: true });
        await mkdir(join(cache, "z"), { recursive: true });

        await using proc = Bun.spawn({
          cmd: [bunExe(), "install", "--verbose"],
          cwd: installDir,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...env,
            GITHUB_API_URL: `http://127.0.0.1:${port}`,
            BUN_INSTALL_CACHE_DIR: cache,
            BUN_TMPDIR: scratch,
            TMPDIR: scratch,
            BUN_INSTALL_STREAMING_MIN_SIZE: "1024",
            ...(mode === "buffered" ? { BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL: "1" } : {}),
          },
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        if (mode === "streaming") {
          expect(stderr).toContain("Streamed ");
        } else {
          expect(stderr).not.toContain("Streamed ");
        }

        if (exitCode !== 0) {
          console.error("Install failed with exit code:", exitCode);
          console.error("stdout:", stdout);
          console.error("stderr:", stderr);
        }
        expect(exitCode).toBe(0);

        const misplaced: string[] = [];
        let markerDirs = 0;
        for (const entry of await readdir(installDir, { recursive: true, withFileTypes: true })) {
          if (entry.name !== "marker") continue;
          const parentStats = await lstat(entry.parentPath);
          if (basename(entry.parentPath) === "x" && parentStats.isDirectory() && !parentStats.isSymbolicLink()) {
            markerDirs++;
          } else {
            misplaced.push(join(entry.parentPath, entry.name));
          }
        }
        expect(misplaced).toEqual([]);
        expect(markerDirs).toBeGreaterThan(0);

        const pkgDir = join(installDir, "node_modules", "test-package");
        expect((await lstat(join(pkgDir, "q", "x"))).isSymbolicLink()).toBe(false);
        expect(await Bun.file(join(pkgDir, "q", "x", "marker", "proof.txt")).text()).toBe("stays inside the package");
        const literalX = await lstat(join(pkgDir, decomposed, "x"));
        expect(literalX.isSymbolicLink()).toBe(false);
        expect(literalX.isDirectory()).toBe(true);
        expect(await Bun.file(join(pkgDir, decomposed, "x", "nested.txt")).text()).toBe("written at its literal path");
      } finally {
        httpServer.closeAllConnections?.();
        await new Promise<void>(resolve => httpServer.close(() => resolve()));
      }
    });
  }
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

it.skipIf(isWindows)(
  "does not change permissions of a directory reached through a symlinked bin target with a trailing slash",
  async () => {
    // Same as above, but the bin target is written as "payload/". The kernel
    // follows a symlink named with a trailing slash even when chmod is told not
    // to follow symlinks, so the installer has to drop the slash before it
    // stats, links and chmods the target.
    using dir = tempDir("bin-target-symlink-trailing-slash-test", {
      "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
      "package.json": JSON.stringify({
        name: "bin-target-symlink-slash-app",
        version: "1.0.0",
        workspaces: ["packages/*"],
      }),
      "packages/dep/package.json": JSON.stringify({
        name: "dep-with-symlinked-dir-bin",
        version: "1.0.0",
        bin: { "dep-with-symlinked-dir-bin": "./payload/" },
      }),
      "victim-dir/keep": "",
    });
    const installDir = String(dir);

    const victimDir = join(installDir, "victim-dir");
    await chmod(victimDir, 0o700);
    await symlink(join("..", "..", "victim-dir"), join(installDir, "packages", "dep", "payload"));

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: installDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect((await stat(victimDir)).mode & 0o777).toBe(0o700);

    // Without the slash this target links (see above), so with it the result is the same.
    const binLink = join(installDir, "node_modules", ".bin", "dep-with-symlinked-dir-bin");
    expect(await readlink(binLink)).toBe(join("..", "dep-with-symlinked-dir-bin", "payload"));

    if (exitCode !== 0) {
      console.error("Install failed with exit code:", exitCode);
      console.error("stdout:", stdout);
      console.error("stderr:", stderr);
    }
    expect(exitCode).toBe(0);
  },
  60000,
);

// The symlink install backend (used for `file:` folders outside the project and
// for `--backend symlink`) fills node_modules/<pkg> with one symlink per file.
// A symlink cannot carry the executable bit, so the bin linker has to set it on
// the file behind the installer's own link (npm likewise chmods the file in a
// `file:` folder), while still refusing to follow a symlink that the installer
// did not create (the two tests above).
async function runBun(cwd: string, args: string[], extraEnv: Record<string, string> = {}) {
  await using proc = spawn({
    cmd: [bunExe(), ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...env, ...extraEnv },
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const isOwnerExecutable = async (path: string) => ((await stat(path)).mode & 0o100) !== 0;

it.skipIf(isWindows)("makes the files behind a symlink-installed file: dependency's bins executable", async () => {
  using dir = tempDir("file-dep-bin-executable", {
    "app/bunfig.toml": `[install]\nlinker = "hoisted"\n`,
    "app/package.json": JSON.stringify({
      name: "file-dep-bin-app",
      version: "1.0.0",
      dependencies: { "file-dep-with-bins": "file:../dep" },
    }),
    "dep/package.json": JSON.stringify({
      name: "file-dep-with-bins",
      version: "1.0.0",
      bin: { "file-dep-cli": "cli.js", "file-dep-nested-cli": "bin/nested.js" },
    }),
    "dep/cli.js": `#!/usr/bin/env node\nconsole.log("cli");\n`,
    "dep/bin/nested.js": `#!/usr/bin/env node\nconsole.log("nested");\n`,
    "dep/lib.js": `module.exports = 1;\n`,
  });
  const appDir = join(String(dir), "app");
  const depDir = join(String(dir), "dep");
  const depFiles = ["cli.js", "bin/nested.js", "lib.js", "package.json"];
  const executableDepFiles = async () =>
    Object.fromEntries(await Promise.all(depFiles.map(async f => [f, await isOwnerExecutable(join(depDir, f))])));

  expect(await executableDepFiles()).toEqual({
    "cli.js": false,
    "bin/nested.js": false,
    "lib.js": false,
    "package.json": false,
  });

  expect(await runBun(appDir, ["install"])).toMatchObject({ exitCode: 0 });

  // The layout this is about: the package directory holds the installer's
  // per-file symlinks, and node_modules/.bin points at them.
  expect((await lstat(join(appDir, "node_modules", "file-dep-with-bins", "cli.js"))).isSymbolicLink()).toBe(true);
  expect((await lstat(join(appDir, "node_modules", "file-dep-with-bins", "bin", "nested.js"))).isSymbolicLink()).toBe(
    true,
  );

  // Only the bin targets become executable, in the folder itself.
  expect(await executableDepFiles()).toEqual({
    "cli.js": true,
    "bin/nested.js": true,
    "lib.js": false,
    "package.json": false,
  });

  expect(await runBun(appDir, ["run", "file-dep-cli"])).toMatchObject({ stdout: "cli\n", exitCode: 0 });
  expect(await runBun(appDir, ["run", "file-dep-nested-cli"])).toMatchObject({ stdout: "nested\n", exitCode: 0 });
});

it.skipIf(isWindows)("makes the cached file behind a --backend symlink bin executable", async () => {
  // `createTarball` writes every file with mode 0644, so the extracted cache
  // entry is not executable and the bin linker is what has to make it so.
  const tarball = createTarball([
    {
      name: "package/package.json",
      type: "file",
      content: JSON.stringify({
        name: "symlink-backend-pkg",
        version: "1.0.0",
        bin: { "symlink-backend-cli": "cli.js" },
      }),
    },
    { name: "package/cli.js", type: "file", content: `#!/usr/bin/env node\nconsole.log("from the cache");\n` },
  ]);
  using dir = tempDir("symlink-backend-bin-executable", {
    "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
    "package.json": JSON.stringify({
      name: "symlink-backend-app",
      version: "1.0.0",
      dependencies: { "symlink-backend-pkg": "file:./symlink-backend-pkg-1.0.0.tgz" },
    }),
    "symlink-backend-pkg-1.0.0.tgz": Buffer.from(tarball),
  });
  const installDir = String(dir);
  const cacheDir = join(installDir, ".bun-cache");

  expect(
    await runBun(installDir, ["install", "--backend", "symlink"], { BUN_INSTALL_CACHE_DIR: cacheDir }),
  ).toMatchObject({ exitCode: 0 });

  const installedCli = join(installDir, "node_modules", "symlink-backend-pkg", "cli.js");
  const cachedCli = await readlink(installedCli);
  expect(cachedCli.startsWith(`${await realpath(cacheDir)}/`)).toBe(true);
  expect(await isOwnerExecutable(cachedCli)).toBe(true);

  expect(await runBun(installDir, ["run", "symlink-backend-cli"])).toMatchObject({
    stdout: "from the cache\n",
    exitCode: 0,
  });
});

it.skipIf(isWindows)(
  "does not change permissions of files reached through bin target symlinks the installer did not create",
  async () => {
    // An npm package installed with `--backend symlink` is left alone by later
    // installs as long as its package.json still reads back, while its bins are
    // linked again every time. Swapping the installer's links for foreign ones
    // in between therefore puts a symlink the installer did not write at a bin
    // target of a package whose other files legitimately are installer links.
    // Both links lead outside the cache the package was installed from, so
    // neither destination may be chmodded.
    // For registry packages the bin field is read from the registry manifest.
    const manifest = {
      name: "relinked-bin-pkg",
      version: "1.0.0",
      bin: { "relinked-abs": "abs.js", "relinked-rel": "rel.js" },
    };
    const tarball = createTarball([
      { name: "package/package.json", type: "file", content: JSON.stringify(manifest) },
      { name: "package/abs.js", type: "file", content: `#!/usr/bin/env node\n` },
      { name: "package/rel.js", type: "file", content: `#!/usr/bin/env node\n` },
    ]);
    using registry = Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/relinked-bin-pkg") {
          return Response.json({
            name: manifest.name,
            "dist-tags": { latest: manifest.version },
            versions: {
              [manifest.version]: {
                ...manifest,
                dist: { tarball: `http://localhost:${registry.port}/relinked-bin-pkg-1.0.0.tgz` },
              },
            },
          });
        }
        if (pathname === "/relinked-bin-pkg-1.0.0.tgz") {
          return new Response(tarball, { headers: { "Content-Type": "application/octet-stream" } });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    using dir = tempDir("relinked-bin-target-test", {
      "bunfig.toml": `[install]\nlinker = "hoisted"\nregistry = "http://localhost:${registry.port}/"\n`,
      "package.json": JSON.stringify({
        name: "relinked-bin-app",
        version: "1.0.0",
        dependencies: { "relinked-bin-pkg": "1.0.0" },
      }),
      "victim-abs.txt": "reached through an absolute symlink",
      "victim-rel.txt": "reached through a relative symlink",
    });
    const installDir = String(dir);
    const installEnv = { BUN_INSTALL_CACHE_DIR: join(installDir, ".bun-cache") };
    const victimAbs = join(installDir, "victim-abs.txt");
    const victimRel = join(installDir, "victim-rel.txt");
    await chmod(victimAbs, 0o600);
    await chmod(victimRel, 0o600);

    expect(await runBun(installDir, ["install", "--backend", "symlink"], installEnv)).toMatchObject({ exitCode: 0 });

    const pkgDir = join(installDir, "node_modules", "relinked-bin-pkg");
    expect((await lstat(join(pkgDir, "package.json"))).isSymbolicLink()).toBe(true);
    await rm(join(pkgDir, "abs.js"));
    await rm(join(pkgDir, "rel.js"));
    await symlink(victimAbs, join(pkgDir, "abs.js"));
    await symlink(join("..", "..", "victim-rel.txt"), join(pkgDir, "rel.js"));
    await rm(join(installDir, "node_modules", ".bin"), { recursive: true });

    expect(await runBun(installDir, ["install", "--backend", "symlink"], installEnv)).toMatchObject({ exitCode: 0 });

    // The bins were linked again, against the swapped-in symlinks.
    expect((await readdir(join(installDir, "node_modules", ".bin"))).sort()).toEqual(["relinked-abs", "relinked-rel"]);
    expect(await readlink(join(pkgDir, "abs.js"))).toBe(victimAbs);
    expect(await readlink(join(pkgDir, "rel.js"))).toBe(join("..", "..", "victim-rel.txt"));

    expect((await stat(victimAbs)).mode & 0o777).toBe(0o600);
    expect((await stat(victimRel)).mode & 0o777).toBe(0o600);
  },
);

it.skipIf(isWindows)(
  "skips a package bin entry whose name contains a NUL byte and links the remaining entries",
  async () => {
    using dir = tempDir("bin-name-nul-test", {
      "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
      "package.json": JSON.stringify({
        name: "bin-name-nul-app",
        version: "1.0.0",
        workspaces: ["packages/*"],
      }),
      "packages/dep/package.json": JSON.stringify({
        name: "dep-with-nul-bin",
        version: "1.0.0",
        bin: { ["extra" + String.fromCharCode(0) + "ignoredtail"]: "./cli.js", "good-bin": "./cli.js" },
      }),
      "packages/dep/cli.js": `#!/usr/bin/env node\nconsole.log("ok");\n`,
    });
    const installDir = String(dir);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: installDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect((await readdir(join(installDir, "node_modules", ".bin"))).sort()).toEqual(["good-bin"]);

    if (exitCode !== 0) {
      console.error("Install failed with exit code:", exitCode);
      console.error("stdout:", stdout);
      console.error("stderr:", stderr);
    }
    expect(exitCode).toBe(0);
  },
  60000,
);

it.skipIf(isWindows)(
  "does not link a bin target that resolves outside the package through a symlinked directory",
  async () => {
    using dir = tempDir("bin-target-symlinked-dir-test", {
      "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
      "package.json": JSON.stringify({
        name: "bin-target-dir-app",
        version: "1.0.0",
        workspaces: ["packages/*"],
      }),
      "packages/dep/package.json": JSON.stringify({
        name: "dep-with-linked-dir-bin",
        version: "1.0.0",
        bin: { "linked-dir-tool": "lnk/tool.js" },
      }),
    });
    const installDir = await realpath(String(dir));

    const outsideDir = `${installDir}/abcdefghijkl${installDir}/packages/dep/y`;
    await mkdir(outsideDir, { recursive: true });
    const toolPath = join(outsideDir, "tool.js");
    await writeFile(toolPath, `#!/usr/bin/env node\nconsole.log("ok");\n`);
    await chmod(toolPath, 0o600);
    await symlink(outsideDir, join(installDir, "packages", "dep", "lnk"));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: installDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect((await stat(toolPath)).mode & 0o777).toBe(0o600);
    expect(await readdir(join(installDir, "node_modules", ".bin")).catch(() => [])).toEqual([]);

    if (exitCode !== 0) {
      console.error("Install failed with exit code:", exitCode);
      console.error("stdout:", stdout);
      console.error("stderr:", stderr);
    }
    expect(exitCode).toBe(0);
  },
  60000,
);

it.skipIf(isWindows)(
  "rejects a GitHub tarball whose root directory name contains a path separator",
  async () => {
    const tarball = createTarball([
      { name: "pkg.root/extra/", type: "dir" },
      {
        name: "pkg.root/package.json",
        type: "file",
        content: JSON.stringify({ name: "test-package", version: "1.0.0" }),
      },
      { name: "pkg.root/index.js", type: "file", content: "module.exports = 1;" },
    ]);

    using server = Bun.serve({
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

    using dir = tempDir("github-tarball-root-name-test", {
      "package.json": JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        dependencies: { "test-package": "github:user/repo#main" },
      }),
    });
    const installDir = String(dir);

    await using proc = Bun.spawn({
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

    expect(stderr).toContain('tarball root directory "pkg.root/extra" is not a valid folder name');
    expect(stdout).not.toContain("1 package installed");
    expect(exitCode).not.toBe(0);
  },
  60000,
);
