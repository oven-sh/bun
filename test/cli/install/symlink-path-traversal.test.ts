import { spawn } from "bun";
import { describe, expect, it, setDefaultTimeout } from "bun:test";
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "fs/promises";
import { bunExe, bunEnv as env, tempDir } from "harness";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "os";
import { basename, dirname, join, relative, resolve } from "path";

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
    // Symlink entries are skipped, not treated as an error: the install succeeds.
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
    it(`writes every directory and file entry at its literal path when symlink entries have names that differ only by Unicode normalization (${mode} extraction)`, async () => {
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

    it(`does not materialize symlinks from a GitHub tarball, as npm does not (${mode} extraction)`, async () => {
      let pad = "";
      let seed = `skipped-symlink-pad-${mode}`;
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
        { name: "test-package/link-to-src", type: "symlink", linkname: "src" },
        { name: "test-package/src/", type: "dir" },
        { name: "test-package/src/index.js", type: "file", content: "module.exports = 42;" },
        { name: "test-package/src/link-to-index", type: "symlink", linkname: "./index.js" },
        { name: "test-package/nested/deep/", type: "dir" },
        { name: "test-package/nested/deep/leaf.txt", type: "file", content: "after the links" },
        { name: "test-package/pad.bin", type: "file", content: pad },
      ]);

      let tmp = "";
      await using server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
          if (!url.pathname.includes("/tarball/")) return new Response("Not Found", { status: 404 });
          return new Response(
            new ReadableStream({
              type: "direct",
              async pull(controller) {
                controller.write(tarball.subarray(0, 1024));
                await controller.flush();
                // A tarball is streamed only if its body arrives in more than one piece. The first
                // drain creates the extraction directory, so the rest waits until that exists.
                while (mode === "streaming" && !(await readdir(tmp)).some(name => name.endsWith(".test-package"))) {
                  await Bun.sleep(1);
                }
                controller.write(tarball.subarray(1024));
                await controller.flush();
                controller.close();
              },
            }),
            { headers: { "Content-Type": "application/gzip", "Content-Length": String(tarball.length) } },
          );
        },
      });

      using dir = tempDir(`skipped-symlink-${mode}-test`, {
        "package.json": JSON.stringify({
          name: "test-app",
          version: "1.0.0",
          dependencies: { "test-package": "github:user/repo#main" },
        }),
        ".tmp/.keep": "",
      });
      const installDir = String(dir);
      const cache = join(installDir, ".bun-cache");
      tmp = join(installDir, ".tmp");

      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--verbose"],
        cwd: installDir,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...env,
          GITHUB_API_URL: `http://127.0.0.1:${server.port}`,
          BUN_INSTALL_CACHE_DIR: cache,
          BUN_TMPDIR: tmp,
          BUN_INSTALL_STREAMING_MIN_SIZE: "1024",
          BUN_INSTALL_STREAMING_DRAIN_THRESHOLD: "1",
          ...(mode === "buffered" ? { BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL: "1" } : {}),
        },
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr.includes("Streamed ")).toBe(mode === "streaming");

      // The linkers drop links on Linux whatever the extractor did, so look at the cache entry.
      const [entry] = (await readdir(cache)).filter(name => name.startsWith("@GH@"));
      const listing: string[] = [];
      const walk = async (rel: string) => {
        for (const item of await readdir(join(cache, entry, rel), { withFileTypes: true })) {
          const path = rel ? `${rel}/${item.name}` : item.name;
          listing.push(item.isSymbolicLink() ? `${path} (link)` : item.isDirectory() ? `${path}/` : path);
          if (item.isDirectory()) await walk(path);
        }
      };
      await walk("");
      expect(listing.sort()).toEqual([
        ".bun-tag",
        "nested/",
        "nested/deep/",
        "nested/deep/leaf.txt",
        "package.json",
        "pad.bin",
        "src/",
        "src/index.js",
      ]);
      expect(
        await Bun.file(join(installDir, "node_modules", "test-package", "nested", "deep", "leaf.txt")).text(),
      ).toBe("after the links");
      expect(exitCode).toBe(0);
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

// The cache folder and the bun.lock entry of a `github:` package are named after the root
// directory of its tarball: the first component of the first entry's path, whatever that
// entry is. A tarball with a Content-Length and a chunked one go through different readers.
describe.concurrent.skipIf(isWindows)("the root directory of a GitHub tarball", () => {
  const readers = ["buffered", "streaming"] as const;

  async function install(reader: (typeof readers)[number], root: string, first: string[] = []) {
    const tarball = createTarball([
      ...first.map(name => ({ name, type: "dir" as const })),
      {
        name: `${root}/package.json`,
        type: "file",
        content: JSON.stringify({ name: "test-package", version: "1.0.0" }),
      },
      { name: `${root}/index.js`, type: "file", content: "module.exports = 1;" },
    ]);

    using dir = tempDir("github-tarball-root-name-test", {
      "package.json": JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        dependencies: { "test-package": "github:user/repo#main" },
      }),
      ".tmp/.keep": "",
    });
    const installDir = String(dir);
    const tmp = join(installDir, ".tmp");
    let exited = false;

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (!url.pathname.includes("/tarball/")) return new Response("Not Found", { status: 404 });
        if (reader === "buffered") return new Response(tarball, { headers: { "Content-Type": "application/gzip" } });
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller) {
              controller.write(tarball.subarray(0, 60));
              await controller.flush();
              // A body is streamed only if it arrives in more than one piece. The first
              // drain creates the extraction directory, so the rest waits until that exists.
              while (!exited && (await readdir(tmp)).length === 1) await Bun.sleep(1);
              controller.write(tarball.subarray(60));
              await controller.flush();
              controller.close();
            },
          }),
          { headers: { "Content-Type": "application/gzip" } },
        );
      },
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--verbose"],
      cwd: installDir,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        GITHUB_API_URL: `http://localhost:${server.port}`,
        BUN_INSTALL_CACHE_DIR: join(installDir, ".bun-cache"),
        BUN_TMPDIR: tmp,
        BUN_INSTALL_STREAMING_DRAIN_THRESHOLD: "1",
      },
    });
    void proc.exited.then(() => (exited = true));
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      error: stderr.match(/^error: .*$/m)?.[0],
      streamed: stderr.includes("Streamed "),
      installed: stdout.includes("1 package installed"),
      lock: (
        await Bun.file(join(installDir, "bun.lock"))
          .text()
          .catch(() => "")
      ).match(/"test-package": \[.*\]/)?.[0],
      tmp: await readdir(tmp),
      exitCode,
    };
  }

  it.each(
    readers.flatMap(reader =>
      [
        ["the root directory", ["pkg.root/"]],
        ["a directory below the root", ["pkg.root/extra/"]],
        ["a file", []],
      ].map(([what, first]) => [what, reader, first] as [string, typeof reader, string[]]),
    ),
  )("is named by the first entry when that is %s (%s)", async (_, reader, first) => {
    expect(await install(reader, "pkg.root", first)).toEqual({
      error: undefined,
      streamed: reader === "streaming",
      installed: true,
      lock: expect.stringContaining(', "pkg.root", "sha512-'),
      tmp: [".keep"],
      exitCode: 0,
    });
  });

  it.each(readers.flatMap(reader => ["..", ".", "a\\b", "@x", "a b", "-x"].map(root => [root, reader] as const)))(
    "is refused when its name is %p (%s)",
    async (root, reader) => {
      expect(await install(reader, root)).toEqual({
        error: `error: Refusing to install "test-package": tarball root directory "${root}" is not a valid folder name`,
        streamed: false,
        installed: false,
        lock: undefined,
        // The refusal comes after the extraction.
        tmp: [".keep"],
        exitCode: 1,
      });
    },
  );
});

// A second, separate mechanism: the directories the linker makes below
// `node_modules` are input, because `node_modules` comes from whoever checked
// out the repository. git restores a committed `node_modules/@scope` symlink
// (mode 120000), and a CI cache restores one. Such a link is replaced by a real
// directory; what it leads to is never touched.
const KEEP = "do-not-touch\n";

// Cases that only need a link to an existing DIRECTORY also run on Windows, as
// a junction: `mklink /J` needs no privilege.
async function linkDir(target: string, path: string) {
  if (!isWindows) return symlink(target, path);
  await symlink(resolve(dirname(path), target), path, "junction");
}

// `<root>/victim` represents any directory outside the project.
async function plantVictim(root: string, ...subdirs: string[]) {
  const victim = join(root, "victim");
  await mkdir(join(victim, ...subdirs), { recursive: true });
  await writeFile(join(victim, ...subdirs, "keep.txt"), KEEP);
  return victim;
}

async function expectVictimUntouched(victim: string, ...subdirs: string[]) {
  const dir = join(victim, ...subdirs);
  expect(await readdir(dir)).toEqual(["keep.txt"]);
  expect(await Bun.file(join(dir, "keep.txt")).text()).toBe(KEEP);
}

// A `file:` tarball dependency, so no test reaches the network.
async function writeTarball(path: string, name: string, version: string, content: string, extra: object = {}) {
  await writeFile(
    path,
    createTarball([
      { name: "package/package.json", type: "file", content: JSON.stringify({ name, version, ...extra }) },
      { name: "package/index.js", type: "file", content },
    ]),
  );
}

async function runBun(cwd: string, args: string[], cache = join(cwd, ".bun-cache")) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...env, BUN_INSTALL_CACHE_DIR: cache },
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// The hoisted linker names a package destination as a multi-component path
// (`mkdirat(nm_fd, "@x/cron.d")`), so a symlink at `@x` redirected every write,
// and the rename-aside that clears an existing destination deleted through it
// too. The same hole existed at `.bin` and at the destination itself.
describe.concurrent("links below node_modules with the hoisted linker", () => {
  const bun = (cwd: string, ...args: string[]) => runBun(cwd, [...args, "--linker", "hoisted"]);
  const install = (cwd: string) => bun(cwd, "install", "--ignore-scripts");

  it("does not install a scoped package through node_modules/@scope", async () => {
    using root = tempDir("nm-scope", {});
    const victim = await plantVictim(String(root), "cron.d");
    const repo = join(String(root), "repo");
    await mkdir(join(repo, "node_modules"), { recursive: true });
    await writeTarball(join(repo, "pkg.tgz"), "@x/cron.d", "1.0.0", "module.exports = 'evil'");
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({ name: "coolproject", dependencies: { "@x/cron.d": "file:./pkg.tgz" } }),
    );
    // Exactly what `git checkout` restores from a committed mode-120000 entry.
    await linkDir("../../victim", join(repo, "node_modules", "@x"));

    const { stdout, stderr, exitCode } = await install(repo);

    await expectVictimUntouched(victim, "cron.d");
    // The scope directory is a real directory now, and the package is in it.
    expect((await lstat(join(repo, "node_modules", "@x"))).isSymbolicLink()).toBe(false);
    expect(await Bun.file(join(repo, "node_modules", "@x", "cron.d", "index.js")).text()).toBe(
      "module.exports = 'evil'",
    );
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("1 package installed");
    expect(exitCode).toBe(0);
  });

  it("does not install a folder dependency through node_modules/@scope", async () => {
    using dir = tempDir("nm-scope-folder", {
      "package.json": JSON.stringify({
        name: "scope-dir-symlink-app",
        version: "1.0.0",
        dependencies: { "@scope/dep": "file:./src" },
      }),
      "src/package.json": JSON.stringify({ name: "@scope/dep", version: "1.0.0" }),
      "src/index.js": `module.exports = 1;\n`,
      "victim/dep/keep.txt": KEEP,
    });
    const repo = await realpath(String(dir));
    const victim = join(repo, "victim");
    await mkdir(join(repo, "node_modules"));
    await linkDir(victim, join(repo, "node_modules", "@scope"));

    const { stderr, exitCode } = await install(repo);

    expect(await readdir(victim)).toEqual(["dep"]);
    await expectVictimUntouched(victim, "dep");
    const scopeDir = join(repo, "node_modules", "@scope");
    expect((await lstat(scopeDir)).isSymbolicLink()).toBe(false);
    expect(await readdir(scopeDir)).toEqual(["dep"]);
    expect(await readdir(join(scopeDir, "dep"))).toContain("index.js");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  // People do link the project's own `node_modules` (a Docker volume, Nix, Bazel).
  it.skipIf(isWindows)("still installs through a link at the project's own node_modules", async () => {
    using root = tempDir("nm-root", {});
    const volume = join(String(root), "volume");
    const repo = join(String(root), "repo");
    await Promise.all([mkdir(volume), mkdir(repo)]);
    await writeTarball(join(repo, "pkg.tgz"), "lodash", "1.0.0", "module.exports = 1");
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({ name: "coolproject", dependencies: { lodash: "file:./pkg.tgz" } }),
    );
    await symlink("../volume", join(repo, "node_modules"));

    const { stderr, exitCode } = await install(repo);

    expect(stderr).not.toContain("error:");
    expect((await lstat(join(repo, "node_modules"))).isSymbolicLink()).toBe(true);
    expect(await Bun.file(join(volume, "lodash", "index.js")).text()).toBe("module.exports = 1");
    expect(exitCode).toBe(0);
  });

  // A hostile package directory inside an otherwise trusted monorepo commits
  // the symlinks in its own `packages/evil/node_modules`. `lodash` has to nest
  // there because the sibling member pins an incompatible version.
  async function workspaceWithNestedDep(root: string) {
    const repo = join(root, "repo");
    await mkdir(join(repo, "packages", "app"), { recursive: true });
    await mkdir(join(repo, "packages", "evil"), { recursive: true });
    await writeTarball(join(repo, "l3.tgz"), "lodash", "3.10.1", "module.exports = 3");
    await writeTarball(join(repo, "l4.tgz"), "lodash", "4.17.21", "module.exports = 4");
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
    );
    await writeFile(
      join(repo, "packages", "app", "package.json"),
      JSON.stringify({ name: "app", version: "1.0.0", dependencies: { lodash: "file:../../l4.tgz" } }),
    );
    await writeFile(
      join(repo, "packages", "evil", "package.json"),
      JSON.stringify({ name: "evil", version: "1.0.0", dependencies: { lodash: "file:../../l3.tgz" } }),
    );
    return repo;
  }

  // People link every `node_modules` of a monorepo to a volume or a cache disk, not only the root's.
  it.skipIf(isWindows)("still installs through a link at a workspace member's node_modules", async () => {
    using root = tempDir("nm-member", {});
    const volume = join(String(root), "volume");
    await mkdir(volume);
    const repo = await workspaceWithNestedDep(String(root));
    const nodeModules = join(repo, "packages", "evil", "node_modules");
    await symlink("../../../volume", nodeModules);

    const { stderr, exitCode } = await install(repo);

    expect(stderr).not.toContain("error:");
    expect((await lstat(nodeModules)).isSymbolicLink()).toBe(true);
    expect(await Bun.file(join(volume, "lodash", "index.js")).text()).toBe("module.exports = 3");
    expect(exitCode).toBe(0);
  });

  // `lodash` is found installed through the link before `zod` is written.
  it.skipIf(isWindows)("keeps what's behind a workspace's link when one package changes", async () => {
    using root = tempDir("nm-member-change", {});
    const repo = await workspaceWithNestedDep(String(root));
    for (const major of [1, 2, 3]) {
      await writeTarball(join(repo, `z${major}.tgz`), "zod", `${major}.0.0`, `module.exports = ${major}`);
    }
    const writeMember = (name: string, lodash: string, zod: string) =>
      writeFile(
        join(repo, "packages", name, "package.json"),
        JSON.stringify({
          name,
          version: "1.0.0",
          dependencies: { lodash: `file:../../${lodash}.tgz`, zod: `file:../../${zod}.tgz` },
        }),
      );
    await Promise.all([writeMember("app", "l4", "z1"), writeMember("evil", "l3", "z2")]);
    expect((await install(repo)).exitCode).toBe(0);
    const volume = join(String(root), "volume");
    const nodeModules = join(repo, "packages", "evil", "node_modules");
    await rename(nodeModules, volume);
    await symlink(volume, nodeModules);
    await writeMember("evil", "l3", "z3");

    const { exitCode } = await install(repo);

    expect((await readdir(nodeModules)).sort()).toEqual(["lodash", "zod"]);
    expect((await lstat(nodeModules)).isSymbolicLink()).toBe(true);
    expect(await Bun.file(join(volume, "lodash", "index.js")).text()).toBe("module.exports = 3");
    expect(await Bun.file(join(volume, "zod", "index.js")).text()).toBe("module.exports = 3");
    expect(exitCode).toBe(0);
  });

  it.skipIf(isWindows)("keeps a workspace member's link when it replaces the isolated linker's tree", async () => {
    using root = tempDir("nm-member-switch", {});
    const repo = await workspaceWithNestedDep(String(root));
    expect((await runBun(repo, ["install", "--ignore-scripts", "--linker", "isolated"])).exitCode).toBe(0);
    const volume = join(String(root), "volume");
    const nodeModules = join(repo, "packages", "evil", "node_modules");
    await rm(nodeModules, { recursive: true, force: true });
    await mkdir(volume);
    await symlink(volume, nodeModules);

    const { exitCode } = await install(repo);

    expect((await lstat(nodeModules)).isSymbolicLink()).toBe(true);
    expect(await Bun.file(join(volume, "lodash", "index.js")).text()).toBe("module.exports = 3");
    expect(exitCode).toBe(0);
  });

  // The root `node_modules` is absent, so the installer takes its fresh-install
  // path and skips the rename-aside that clears an existing destination. The
  // member's nested destination is still a pre-existing symlink.
  it("does not install through the package's own directory on a fresh install", async () => {
    using root = tempDir("nm-fresh", {});
    const victim = await plantVictim(String(root));
    await writeFile(join(victim, "package.json"), JSON.stringify({ name: "victim-project", version: "7.7.7" }));
    const repo = await workspaceWithNestedDep(String(root));
    await mkdir(join(repo, "packages", "evil", "node_modules"), { recursive: true });
    await linkDir("../../../../victim", join(repo, "packages", "evil", "node_modules", "lodash"));

    const { exitCode } = await install(repo);

    // The victim's own package.json used to be replaced by lodash's.
    expect(await Bun.file(join(victim, "package.json")).json()).toEqual({ name: "victim-project", version: "7.7.7" });
    expect(await Bun.file(join(victim, "keep.txt")).text()).toBe(KEEP);
    expect((await readdir(victim)).sort()).toEqual(["keep.txt", "package.json"]);
    const dest = join(repo, "packages", "evil", "node_modules", "lodash");
    expect((await lstat(dest)).isSymbolicLink()).toBe(false);
    expect(await Bun.file(join(dest, "index.js")).text()).toBe("module.exports = 3");
    expect(exitCode).toBe(0);
  });

  // The bin linker writes `node_modules/.bin/<name>` by absolute path, and deletes whatever is in the way of its link.
  it("does not link bins through node_modules/.bin", async () => {
    using root = tempDir("nm-bin", {});
    // The victim has an entry with the same name as the bin.
    const victim = await plantVictim(String(root), "greet");
    const repo = join(String(root), "repo");
    await mkdir(join(repo, "node_modules"), { recursive: true });
    await writeTarball(join(repo, "pkg.tgz"), "greeter", "1.0.0", "#!/usr/bin/env node\nconsole.log('hi')", {
      bin: { greet: "index.js" },
    });
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({ name: "coolproject", dependencies: { greeter: "file:./pkg.tgz" } }),
    );
    const binDir = join(repo, "node_modules", ".bin");

    // On the install that links the package, and planted again for one that finds it installed.
    for (const expected of ["1 package installed", "(no changes)"]) {
      await rm(binDir, { recursive: true, force: true });
      await linkDir("../../victim", binDir);

      const { stdout, exitCode } = await install(repo);

      expect(stdout).toContain(expected);
      await expectVictimUntouched(victim, "greet");
      expect(await readdir(victim)).toEqual(["greet"]);
      expect((await lstat(binDir)).isSymbolicLink()).toBe(false);
      // The bin landed in the real `.bin`: a symlink on POSIX, a shim on Windows.
      expect((await readdir(binDir)).filter(name => name.startsWith("greet"))).not.toBeEmpty();
      expect(exitCode).toBe(0);
    }
  });

  // A `bin` key is a free-form file name. Through a link at `.bin`, a regular file of that
  // name was unlinked and replaced by a link that dangles there.
  it.skipIf(isWindows)("does not replace files in the target of node_modules/.bin", async () => {
    using dir = tempDir("nm-bin-files", {
      "package.json": JSON.stringify({
        name: "bin-dir-symlink-app",
        version: "1.0.0",
        workspaces: ["packages/*"],
        dependencies: { dep: "workspace:*" },
      }),
      "packages/dep/package.json": JSON.stringify({
        name: "dep",
        version: "1.0.0",
        bin: { dep: "bin/cli.js", "notes.txt": "bin/cli.js" },
      }),
      "packages/dep/bin/cli.js": `#!/usr/bin/env node\nconsole.log("ok");\n`,
      "victim/dep": KEEP,
      "victim/notes.txt": KEEP,
    });
    const repo = await realpath(String(dir));
    const victim = join(repo, "victim");
    await mkdir(join(repo, "node_modules"));
    await symlink(victim, join(repo, "node_modules", ".bin"));

    const { stderr, exitCode } = await install(repo);

    expect(stderr).not.toContain("error:");
    expect((await readdir(victim)).sort()).toEqual(["dep", "notes.txt"]);
    expect((await lstat(join(victim, "dep"))).isFile()).toBe(true);
    expect((await lstat(join(victim, "notes.txt"))).isFile()).toBe(true);
    expect(await Bun.file(join(victim, "dep")).text()).toBe(KEEP);
    const binDir = join(repo, "node_modules", ".bin");
    expect((await lstat(binDir)).isDirectory()).toBe(true);
    expect((await readdir(binDir)).sort()).toEqual(["dep", "notes.txt"]);
    expect(await readlink(join(binDir, "dep"))).toBe("../dep/bin/cli.js");
    expect(exitCode).toBe(0);
  });

  // The links are planted after the install, so only `bun remove` itself is between its deletes and the victim. It
  // deletes the leftover `@scope/<name>` and the dangling links in `.bin`.
  it.skipIf(isWindows)("bun remove does not delete through node_modules/@scope or .bin", async () => {
    using dir = tempDir("nm-remove-planted", {
      "package.json": JSON.stringify({
        name: "remove-scope-symlink-app",
        version: "1.0.0",
        dependencies: { "@scope/dep": "file:./dep", plain: "file:./plain" },
      }),
      "dep/package.json": JSON.stringify({ name: "@scope/dep", version: "1.0.0" }),
      "dep/index.js": `module.exports = 1;\n`,
      "plain/package.json": JSON.stringify({ name: "plain", version: "1.0.0" }),
      "plain/index.js": `module.exports = 2;\n`,
      "victim/dep/keep.txt": KEEP,
    });
    const repo = await realpath(String(dir));
    const victim = join(repo, "victim");
    // A dangling link of the user's own, which the `.bin` sweep would take for a stale bin.
    await symlink("./moved-away", join(victim, "stale"));

    expect((await install(repo)).exitCode).toBe(0);
    expect(await readdir(join(repo, "node_modules", "@scope"))).toEqual(["dep"]);

    await rm(join(repo, "node_modules", "@scope"), { recursive: true });
    await symlink(victim, join(repo, "node_modules", "@scope"));
    await symlink(victim, join(repo, "node_modules", ".bin"));

    const { stderr, exitCode } = await bun(repo, "remove", "@scope/dep");

    expect((await readdir(victim)).sort()).toEqual(["dep", "stale"]);
    await expectVictimUntouched(victim, "dep");
    expect((await Bun.file(join(repo, "package.json")).json()).dependencies).toEqual({ plain: "file:./plain" });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });
});

// The isolated linker addresses everything by its path from the project's root: the store `node_modules/.bun`, the
// fallback directory and its entries, and the links in the `node_modules` of the project and of its workspaces. Where a
// link belongs, it deletes whatever is in the way.
describe.concurrent("links below node_modules with the isolated linker", () => {
  const bun = (cwd: string, ...args: string[]) => runBun(cwd, [...args, "--linker", "isolated"]);
  const install = (cwd: string, ...args: string[]) => bun(cwd, "install", "--ignore-scripts", ...args);
  const storeOf = (repo: string) => join(repo, "node_modules", ".bun");
  async function entryOf(repo: string, prefix: string) {
    const entry = (await readdir(storeOf(repo))).find(entry => entry.startsWith(prefix));
    expect(entry).toBeString();
    return join(storeOf(repo), entry!);
  }

  // `@x/dep` has a bin. The project, its member `evil` and the folder `top` depend on it.
  async function project(root: string) {
    const repo = join(root, "repo");
    await Promise.all([mkdir(join(repo, "top"), { recursive: true }), mkdir(join(repo, "evil"), { recursive: true })]);
    const dep = (path: string) => ({ version: "1.0.0", dependencies: { "@x/dep": `file:${path}/dep.tgz` } });
    await Promise.all([
      writeTarball(join(repo, "dep.tgz"), "@x/dep", "1.0.0", "#!/usr/bin/env node\nconsole.log('hi')", {
        bin: { greet: "index.js" },
      }),
      writeFile(
        join(repo, "package.json"),
        JSON.stringify({
          name: "coolproject",
          workspaces: ["evil"],
          dependencies: { "@x/dep": "file:./dep.tgz", top: "file:./top" },
        }),
      ),
      writeFile(join(repo, "top", "package.json"), JSON.stringify({ name: "top", ...dep("..") })),
      writeFile(join(repo, "top", "index.js"), "module.exports = 1"),
      writeFile(join(repo, "evil", "package.json"), JSON.stringify({ name: "evil", ...dep("..") })),
    ]);
    return repo;
  }

  async function expectInstalled(repo: string, { stderr, exitCode }: Awaited<ReturnType<typeof runBun>>) {
    expect(stderr).not.toContain("error:");
    const top = await realpath(join(repo, "node_modules", "top"));
    for (const nodeModules of [join(repo, "node_modules"), join(repo, "evil", "node_modules"), dirname(top)]) {
      expect(await Bun.file(join(nodeModules, "@x", "dep", "package.json")).json()).toMatchObject({ name: "@x/dep" });
    }
    expect(exitCode).toBe(0);
  }

  // [where the link is, what the victim has under the name that Bun wants there]
  const places: Record<string, [(repo: string) => string | Promise<string>, string[]]> = {
    "node_modules/.bin": [repo => join(repo, "node_modules", ".bin"), ["greet"]],
    "node_modules/@scope": [repo => join(repo, "node_modules", "@x"), ["dep"]],
    "a member's node_modules/.bin": [repo => join(repo, "evil", "node_modules", ".bin"), ["greet"]],
    "node_modules/.bun/node_modules": [repo => join(storeOf(repo), "node_modules"), []],
    "node_modules/.bun/node_modules/@scope": [repo => join(storeOf(repo), "node_modules", "@x"), ["dep"]],
    "a store entry's node_modules": [async repo => join(await entryOf(repo, "@x+dep@.+"), "node_modules"), []],
    "a store entry's node_modules/@scope": [
      async repo => join(await entryOf(repo, "@x+dep@.+"), "node_modules", "@x"),
      [],
    ],
    "a folder's store entry": [repo => entryOf(repo, "top@"), []],
    "a folder's store entry's node_modules": [async repo => join(await entryOf(repo, "top@"), "node_modules"), []],
    "a folder's store entry's node_modules/@scope": [
      async repo => join(await entryOf(repo, "top@"), "node_modules", "@x"),
      ["dep"],
    ],
    "a folder's store entry's node_modules/.bin": [
      async repo => join(await entryOf(repo, "top@"), "node_modules", ".bin"),
      ["greet"],
    ],
    "a folder's copy in its store entry": [async repo => join(await entryOf(repo, "top@"), "node_modules", "top"), []],
  };

  // A tree without `node_modules/.bun` is moved aside as a whole, so the link is planted in an installed tree.
  it.each(Object.keys(places))("does not write or delete through %s", async place => {
    using root = tempDir("nm-isolated", {});
    const [where, taken] = places[place];
    const victim = await plantVictim(String(root), ...taken);
    const repo = await project(String(root));
    await expectInstalled(repo, await install(repo));

    const link = await where(repo);
    await rm(link, { recursive: true, force: true });
    await linkDir(victim, link);
    // The bins of a store entry are only linked again with the entry.
    await writeFile(join(repo, "top", "new.js"), "");

    const result = await install(repo);

    expect(await readdir(victim)).toEqual([taken[0] ?? "keep.txt"]);
    await expectVictimUntouched(victim, ...taken);
    expect((await lstat(link)).isDirectory()).toBe(true);
    await expectInstalled(repo, result);
  });

  // Links of a store entry whose package is in place.
  it("does not write or delete through a store entry's node_modules/@scope while it only links", async () => {
    using root = tempDir("nm-relink", {});
    const victim = await plantVictim(String(root), "dep");
    const repo = await project(String(root));
    await expectInstalled(repo, await install(repo));
    const link = join(await entryOf(repo, "top@"), "node_modules", "@x");
    await rm(link, { recursive: true });
    await linkDir(victim, link);

    const result = await install(repo);

    expect(await readdir(victim)).toEqual(["dep"]);
    await expectVictimUntouched(victim, "dep");
    expect((await lstat(link)).isDirectory()).toBe(true);
    await expectInstalled(repo, result);
  });

  // The victim has every file an installed package is known by. Linking a bin sets the mode of its file.
  it.skipIf(isWindows).each([
    ["node_modules", ["@x", "dep"]],
    ["node_modules/@scope", ["dep"]],
    ["node_modules/@scope/<package>", []],
  ])("installs the package again when a store entry's %s is a link", async (_, below) => {
    using root = tempDir("nm-in-place", {});
    const repo = await project(String(root));
    await expectInstalled(repo, await install(repo));
    const dep = join(await entryOf(repo, "@x+dep@.+"), "node_modules", "@x", "dep");
    const link = resolve(dep, ...below.map(() => ".."));
    const victim = join(String(root), "victim");
    await cp(dep, join(victim, ...below), { recursive: true });
    const bin = join(victim, ...below, "index.js");
    await writeFile(bin, KEEP);
    await chmod(bin, 0o600);
    await rm(link, { recursive: true });
    await symlink(victim, link);

    const result = await install(repo);

    expect((await stat(bin)).mode & 0o777).toBe(0o600);
    expect(await Bun.file(bin).text()).toBe(KEEP);
    expect((await lstat(link)).isDirectory()).toBe(true);
    expect(await Bun.file(join(dep, "index.js")).text()).toContain("console.log('hi')");
    await expectInstalled(repo, result);
  });

  // With `hoist = false`, the fallback directory that an earlier install left is deleted first: `<the link's
  // target>/node_modules`. A repository can commit both the bunfig and the link.
  it.each([true, false])("does not write or delete through node_modules/.bun (hoist = %p)", async hoist => {
    using root = tempDir("nm-store", {});
    const victim = await plantVictim(String(root), "node_modules");
    const repo = await project(String(root));
    await writeFile(join(repo, "bunfig.toml"), `[install]\nhoist = ${hoist}\n`);
    await mkdir(join(repo, "node_modules"));
    await linkDir(victim, storeOf(repo));

    const result = await install(repo);

    expect(await readdir(victim)).toEqual(["node_modules"]);
    await expectVictimUntouched(victim, "node_modules");
    expect((await lstat(storeOf(repo))).isDirectory()).toBe(true);
    await expectInstalled(repo, result);
  });

  // People link every `node_modules` of a monorepo to a volume or a cache disk, not only the root's.
  // A first install resets the `node_modules` of the members, but not with `--filter`.
  it.skipIf(isWindows).each([
    ["", []],
    [" with --filter", ["--filter", "evil"]],
  ] as const)("still installs through a link at a workspace member's node_modules%s", async (_, args) => {
    using root = tempDir("nm-member", {});
    const volume = join(String(root), "volume");
    await mkdir(volume);
    const repo = await project(String(root));
    const link = join(repo, "evil", "node_modules");
    await symlink("../../volume", link);

    for (const expected of ["installed", "(no changes)"]) {
      const { stdout, stderr, exitCode } = await install(repo, ...args);

      expect(stderr).not.toContain("error:");
      expect(stderr).not.toContain("warn:");
      expect(stdout).toContain(expected);
      expect((await lstat(link)).isSymbolicLink()).toBe(true);
      expect((await readdir(volume)).sort()).toEqual([".bin", "@x"]);
      expect(await Bun.file(join(link, "@x", "dep", "package.json")).json()).toMatchObject({ name: "@x/dep" });
      expect(await Bun.file(join(link, ".bin", "greet")).text()).toContain("console.log('hi')");
      expect(exitCode).toBe(0);
    }
  });

  // The leftovers of an optional dependency that can't be installed are deleted: its copy in the store, and the links
  // to it.
  it("does not delete through the links of an optional dependency that is left out", async () => {
    using root = tempDir("nm-left-out", {});
    const victim = await plantVictim(String(root), "@x", "gone");
    await writeFile(join(victim, "gone"), KEEP);
    using p = await projectWithOptionalPackage(String(root), {});
    for (const link of [
      join(await entryOf(p.repo, "@x+gone@"), "node_modules"),
      join(storeOf(p.repo), "node_modules", "@x"),
    ]) {
      await rm(link, { recursive: true });
      await linkDir(victim, link);
    }

    const { stderr, exitCode } = await p.install();

    expect(stderr).toContain("404");
    expect((await readdir(victim)).sort()).toEqual(["@x", "gone"]);
    expect(await Bun.file(join(victim, "gone")).text()).toBe(KEEP);
    await expectVictimUntouched(victim, "@x", "gone");
    expect(exitCode).toBe(0);
  });

  // `@x/gone` is installed from a registry. Then it is in no cache and its tarball is a 404.
  async function projectWithOptionalPackage(root: string, config: object) {
    const [repo, cache] = [join(root, "repo"), join(root, "cache")];
    await mkdir(repo);
    const tarball = createTarball([
      { name: "package/package.json", type: "file", content: JSON.stringify({ name: "@x/gone", version: "1.0.0" }) },
    ]);
    let gone = false;
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const { origin, pathname } = new URL(request.url);
        if (pathname.endsWith(".tgz")) return gone ? new Response("gone", { status: 404 }) : new Response(tarball);
        const version = { name: "@x/gone", version: "1.0.0", dist: { tarball: `${origin}/gone.tgz` } };
        return Response.json({ name: "@x/gone", "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": version } });
      },
    });
    await writeFile(
      join(repo, "bunfig.toml"),
      Bun.TOML.stringify({ install: { registry: server.url.href, ...config } }),
    );
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({
        name: "coolproject",
        optionalDependencies: { "@x/gone": "1.0.0" },
        trustedDependencies: ["@x/gone"],
      }),
    );
    const install = () => runBun(repo, ["install", "--ignore-scripts", "--linker", "isolated"], cache);
    expect((await install()).exitCode).toBe(0);
    gone = true;
    await rm(cache, { recursive: true });
    return { repo, cache, install, [Symbol.dispose]: () => void server.stop(true) };
  }

  // People do link the project's own `node_modules` (a Docker volume, Nix, Bazel).
  it.skipIf(isWindows)("still installs through a link at the project's own node_modules", async () => {
    using root = tempDir("nm-root", {});
    const volume = join(String(root), "volume");
    await mkdir(volume);
    const repo = await project(String(root));
    await symlink("../volume", join(repo, "node_modules"));

    for (const expected of ["packages installed", "(no changes)"]) {
      const result = await install(repo);
      expect(result.stdout).toContain(expected);
      expect(result.stderr).not.toContain("warn:");
      expect((await lstat(join(repo, "node_modules"))).isSymbolicLink()).toBe(true);
      expect((await lstat(join(volume, ".bun"))).isDirectory()).toBe(true);
      await expectInstalled(repo, result);
    }
  });

  // Behind a junction, Windows resolves a relative link from the path that goes through the junction.
  it.skipIf(!isWindows).each(["node_modules", "packages/a/node_modules"])(
    "the links behind a junction at %s lead to their packages",
    async folder => {
      using root = tempDir("nm-junction", {
        "elsewhere/.keep": "",
        "repo/package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: { a: "workspace:*", dep: "file:./dep.tgz" },
        }),
        "repo/packages/a/package.json": JSON.stringify({
          name: "a",
          version: "1.0.0",
          dependencies: { b: "workspace:*", dep: "file:../../dep.tgz" },
        }),
        "repo/packages/b/package.json": JSON.stringify({ name: "b", version: "1.0.0" }),
      });
      const repo = join(String(root), "repo");
      await writeTarball(join(repo, "dep.tgz"), "dep", "1.0.0", "module.exports = 1");
      await symlink(join(String(root), "elsewhere"), join(repo, folder), "junction");
      const nameAt = async (...path: string[]) => (await Bun.file(join(repo, ...path, "package.json")).json()).name;

      for (const expected of ["installed", "(no changes)"]) {
        const { stdout, stderr, exitCode } = await install(repo);

        expect(stderr).not.toContain("error:");
        expect({
          "node_modules/a": await nameAt("node_modules", "a"),
          "node_modules/dep": await nameAt("node_modules", "dep"),
          "packages/a/node_modules/b": await nameAt("packages", "a", "node_modules", "b"),
          "packages/a/node_modules/dep": await nameAt("packages", "a", "node_modules", "dep"),
        }).toEqual({
          "node_modules/a": "a",
          "node_modules/dep": "dep",
          "packages/a/node_modules/b": "b",
          "packages/a/node_modules/dep": "dep",
        });
        expect((await lstat(join(repo, folder))).isSymbolicLink()).toBe(true);
        expect(stdout).toContain(expected);
        expect(exitCode).toBe(0);
      }
    },
  );

  // With the global store, an entry IS a link, to the one path that Bun computes for it. Nothing is read or written
  // through whatever has its name, which is replaced.
  describe.each([
    ["<cache>/links/../..", (cache: string) => `${join(cache, "links")}/../..`],
    ["a sibling of <cache>/links", (cache: string) => join(cache, "links-evil", "x")],
  ])("global store: an entry that is a link to %s", (_, target) => {
    it.each([
      ["is pointed at the global store", true, []],
      ["is pointed at the global store by --force", true, ["--force"]],
      ["is replaced by a directory once the global store is off", false, []],
    ] as const)("%s", async (_, globalStore, args) => {
      using root = tempDir("nm-global", {});
      const cache = join(String(root), "cache");
      const repo = await project(String(root));
      const run = (globalStore: boolean, ...args: string[]) =>
        writeFile(join(repo, "bunfig.toml"), `[install]\nglobalStore = ${globalStore}\n`).then(() =>
          runBun(repo, ["install", "--ignore-scripts", "--linker", "isolated", ...args], cache),
        );
      await expectInstalled(repo, await run(true));
      const entry = await entryOf(repo, "@x+dep@.+");
      const computed = await readlink(entry);
      expect(dirname(computed)).toBe(join(cache, "links"));

      // This is what a write to `<entry>/node_modules/@x/dep` would reach.
      const victim = join(resolve(target(cache)), "node_modules", "@x", "dep");
      await mkdir(victim, { recursive: true });
      await writeFile(join(victim, "keep.txt"), KEEP);
      await rm(entry);
      await linkDir(target(cache), entry);

      const result = await run(globalStore, ...args);

      await expectVictimUntouched(victim);
      if (globalStore) expect(await readlink(entry)).toBe(computed);
      else expect((await lstat(entry)).isDirectory()).toBe(true);
      await expectInstalled(repo, result);
    });

    // The entry of a trusted package is a directory in the project.
    it("is not deleted through when its package is left out", async () => {
      using root = tempDir("nm-global-left-out", {});
      using p = await projectWithOptionalPackage(String(root), { globalStore: true });
      const entry = await entryOf(p.repo, "@x+gone@");
      expect((await lstat(entry)).isDirectory()).toBe(true);
      await mkdir(join(p.cache, "links"), { recursive: true });
      const victim = join(resolve(target(p.cache)), "node_modules", "@x", "gone");
      await mkdir(victim, { recursive: true });
      await writeFile(join(victim, "keep.txt"), KEEP);
      await rm(entry, { recursive: true });
      await linkDir(target(p.cache), entry);

      const { stderr, exitCode } = await p.install();

      expect(stderr).toContain("404");
      await expectVictimUntouched(victim);
      expect(exitCode).toBe(0);
    });
  });

  it("bun prune does not delete through node_modules/.bun", async () => {
    using root = tempDir("nm-prune", {});
    const victim = await plantVictim(String(root), "stray@1.0.0");
    const repo = await project(String(root));
    await expectInstalled(repo, await install(repo));
    await rm(storeOf(repo), { recursive: true });
    await linkDir(victim, storeOf(repo));

    const { stderr, exitCode } = await bun(repo, "prune");

    expect(stderr.replaceAll("\\", "/")).toContain("error: cannot prune symlink node_modules/.bun");
    await expectVictimUntouched(victim, "stray@1.0.0");
    expect(exitCode).toBe(1);
  });

  // The victim has the files that identify an installed package. The package is installed again, except on Windows,
  // where noticing the link would take a system call for each package, so the link stays.
  it("does not write or delete through a link at a package's own directory", async () => {
    using root = tempDir("nm-leaf", {});
    const victim = await plantVictim(String(root));
    const manifest = JSON.stringify({ name: "@x/dep", version: "1.0.0" });
    await writeFile(join(victim, "package.json"), manifest);
    const repo = await project(String(root));
    await expectInstalled(repo, await install(repo));
    const link = join(await entryOf(repo, "@x+dep@.+"), "node_modules", "@x", "dep");
    // A tarball copy counts as installed if its .bun-tag has the hash that bun.lock pins.
    const tag = await Bun.file(join(link, ".bun-tag")).text();
    await writeFile(join(victim, ".bun-tag"), tag);
    await rm(link, { recursive: true });
    await linkDir(victim, link);

    const result = await install(repo);

    expect(result.stdout).toContain(isWindows ? "(no changes)" : "1 package installed");
    expect((await lstat(link)).isSymbolicLink()).toBe(isWindows);
    expect((await readdir(victim)).sort()).toEqual([".bun-tag", "keep.txt", "package.json"]);
    expect(await Bun.file(join(victim, "package.json")).text()).toBe(manifest);
    await expectInstalled(repo, result);
  });

  it("replaces a link where a tarball package should be, without touching its target", async () => {
    using root = tempDir("nm-leaf-replaced", {});
    const victim = await plantVictim(String(root));
    const manifest = JSON.stringify({ name: "@x/dep", version: "1.0.0" });
    await writeFile(join(victim, "package.json"), manifest);
    const repo = await project(String(root));
    await expectInstalled(repo, await install(repo));
    const link = join(await entryOf(repo, "@x+dep@.+"), "node_modules", "@x", "dep");
    await rm(link, { recursive: true });
    await linkDir(victim, link);

    const result = await install(repo);

    expect(result.stdout).toContain("1 package installed");
    expect((await lstat(link)).isSymbolicLink()).toBe(false);
    expect((await readdir(victim)).sort()).toEqual(["keep.txt", "package.json"]);
    expect(await Bun.file(join(victim, "package.json")).text()).toBe(manifest);
    await expectInstalled(repo, result);
  });
});

// A link at the `node_modules` of the project or of a workspace is followed: people keep theirs on a
// volume or a cache disk. Not all that is behind such a link need be bun's.
describe.concurrent.skipIf(isWindows)("the target of a link at node_modules", () => {
  const MINE: Record<string, string> = {
    "notes.txt": KEEP,
    ".hidden": KEEP,
    "thesis/chapter.tex": KEEP,
    "@me/notes/a.txt": KEEP,
    "node_modules/x/a.txt": KEEP,
    "other/package.json": JSON.stringify({ name: "other", version: "1.0.0" }),
  };
  const NOT_CLEARED = (folder: string) =>
    `warn: cannot clear symlink ${folder}, packages from another linker remain\n` +
    "note: remove the link and run 'bun install'";

  async function plant(root: string, files = MINE) {
    const outside = join(root, "outside");
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(outside, path)), { recursive: true });
      await writeFile(join(outside, path), content);
    }
    return outside;
  }

  async function read(outside: string, files = MINE) {
    const text = (path: string) =>
      Bun.file(join(outside, path))
        .text()
        .catch(() => "(gone)");
    return Object.fromEntries(await Promise.all(Object.keys(files).map(async path => [path, await text(path)])));
  }

  // The project and its workspace `app` depend on two versions of `dep`.
  async function workspace(root: string) {
    const repo = join(root, "repo");
    await mkdir(join(repo, "packages", "app"), { recursive: true });
    await Promise.all([
      writeTarball(join(repo, "dep1.tgz"), "dep", "1.0.0", "module.exports = 1", { bin: { dep: "index.js" } }),
      writeTarball(join(repo, "dep2.tgz"), "dep", "2.0.0", "module.exports = 2", { bin: { dep: "index.js" } }),
      writeTarball(join(repo, "dev.tgz"), "dev", "1.0.0", "module.exports = 1"),
      writeTarball(join(repo, "extra.tgz"), "extra", "1.0.0", "module.exports = 1"),
      writeFile(
        join(repo, "package.json"),
        JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: { app: "workspace:*", dep: "file:./dep1.tgz" },
          devDependencies: { dev: "file:./dev.tgz" },
        }),
      ),
      writeFile(
        join(repo, "packages", "app", "package.json"),
        JSON.stringify({ name: "app", version: "1.0.0", dependencies: { dep: "file:../../dep2.tgz" } }),
      ),
    ]);
    return repo;
  }

  // One dependency, of the name of its tarball.
  async function projectWith(root: string, ...names: string[]) {
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    await Promise.all(names.map(name => writeTarball(join(repo, `${name}.tgz`), name, "1.0.0", "module.exports = 1")));
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({
        name: "root",
        dependencies: Object.fromEntries(names.map(name => [name, `file:./${name}.tgz`])),
      }),
    );
    return repo;
  }

  it.each([
    ["the project's", "isolated", "hoisted"],
    ["the project's", "hoisted", "isolated"],
    ["a workspace's", "isolated", "hoisted"],
    ["a workspace's", "hoisted", "isolated"],
  ])("stays whatever is run: %s node_modules, the %s linker first", async (where, linker, other) => {
    using root = tempDir("nm-outside", {});
    const outside = await plant(String(root));
    const repo = await workspace(String(root));
    const owner = where === "the project's" ? repo : join(repo, "packages", "app");
    const link = join(owner, "node_modules");
    await symlink(relative(owner, outside), link);

    const commands = [
      [linker, repo, "install"],
      [linker, repo, "install"],
      [linker, repo, "install", "--force"],
      [linker, owner, "add", relative(owner, join(repo, "extra.tgz"))],
      [linker, owner, "remove", "extra"],
      [linker, repo, "prune"],
      [linker, repo, "install", "--production"],
      [linker, repo, "prune", "--production"],
      [other, repo, "install"],
      [other, repo, "install"],
      [other, repo, "prune"],
      [linker, repo, "install"],
      [linker, repo, "install", "--frozen-lockfile"],
    ];
    const versionIn = async (dir: string) =>
      (await Bun.file(join(dir, "node_modules/dep/package.json")).json()).version;
    for (const [linker, cwd, ...args] of commands) {
      const command = `${args.join(" ")} --linker ${linker}`;
      const result = await runBun(cwd, [...args, "--ignore-scripts", "--linker", linker], join(String(root), "cache"));

      expect({ command, mine: await read(outside), isLink: (await lstat(link)).isSymbolicLink() }).toEqual({
        command,
        mine: MINE,
        isLink: true,
      });
      if (args[0] === "prune") {
        expect(result.stderr).toContain(`error: cannot prune symlink ${relative(repo, link)}`);
        expect({ command, exitCode: result.exitCode }).toEqual({ command, exitCode: 1 });
        continue;
      }
      expect({
        command,
        root: await versionIn(repo),
        app: await versionIn(join(repo, "packages", "app")),
        linkToApp: await realpath(join(repo, "node_modules", "app")),
        exitCode: result.exitCode,
      }).toEqual({
        command,
        root: "1.0.0",
        app: "2.0.0",
        linkToApp: await realpath(join(repo, "packages", "app")),
        exitCode: 0,
      });
    }
  });

  it.each([
    ["node_modules", ""],
    ["packages/app/node_modules", "packages/app"],
  ])("the isolated linker says that it clears nothing behind %s", async (folder, owner) => {
    using root = tempDir("nm-outside-warning", {});
    const outside = await plant(String(root));
    const repo = await workspace(String(root));
    await symlink(relative(join(repo, owner), outside), join(repo, folder));

    const { stderr, exitCode } = await runBun(repo, ["install", "--ignore-scripts", "--linker", "isolated"]);

    expect(stderr).toContain(NOT_CLEARED(folder));
    expect(await read(outside)).toEqual(MINE);
    expect(exitCode).toBe(0);
  });

  it("the hoisted linker doesn't reinstall everything because of a .bun there", async () => {
    using root = tempDir("nm-outside-store", {});
    const files = { ...MINE, ".bun/bin/tool": KEEP };
    const outside = await plant(String(root), files);
    const repo = await workspace(String(root));
    await symlink("../outside", join(repo, "node_modules"));

    for (const expected of ["packages installed", "(no changes)"]) {
      const { stdout, stderr, exitCode } = await runBun(repo, ["install", "--ignore-scripts", "--linker", "hoisted"]);

      expect(await read(outside, files)).toEqual(files);
      expect(stderr).toContain(NOT_CLEARED("node_modules"));
      expect(stdout).toContain(expected);
      expect(exitCode).toBe(0);
    }
  });

  it.each(["hoisted", "isolated"])("has a name that was removed from package.json (%s)", async linker => {
    using root = tempDir("nm-outside-left", {});
    const outside = await plant(String(root));
    const repo = await projectWith(String(root), "dep", "thesis");
    const install = () => runBun(repo, ["install", "--ignore-scripts", "--linker", linker]);
    expect((await install()).exitCode).toBe(0);
    await rm(join(repo, "node_modules"), { recursive: true });
    await projectWith(String(root), "dep");
    await symlink("../outside", join(repo, "node_modules"));

    const { exitCode } = await install();

    expect(await read(outside)).toEqual(MINE);
    expect(await Bun.file(join(outside, "dep", "package.json")).json()).toMatchObject({ name: "dep" });
    expect(exitCode).toBe(0);
  });

  it.each(["thesis", "notes.txt"])("is in the way of the isolated linker's link: %s", async name => {
    using root = tempDir("nm-outside-taken", {});
    const outside = await plant(String(root));
    const repo = await projectWith(String(root), name);
    await symlink("../outside", join(repo, "node_modules"));

    const { stderr, exitCode } = await runBun(repo, ["install", "--ignore-scripts", "--linker", "isolated"]);

    expect(await read(outside)).toEqual(MINE);
    expect(stderr).toContain("EEXIST");
    expect(exitCode).toBe(1);
  });

  // `dep` has a command of its name.
  const linkersAndFolders = ["hoisted", "isolated"].flatMap(linker =>
    ["node_modules", "packages/app/node_modules"].map(folder => [linker, folder]),
  );

  it.each(linkersAndFolders)("a directory is in the way of the link to a command (%s, %s)", async (linker, folder) => {
    using root = tempDir("nm-outside-bin", {});
    const files = { ...MINE, ".bin/dep/x": KEEP };
    const outside = await plant(String(root), files);
    const repo = await workspace(String(root));
    await symlink(relative(dirname(join(repo, folder)), outside), join(repo, folder));

    const { stderr, exitCode } = await runBun(repo, ["install", "--ignore-scripts", "--linker", linker]);

    expect(await read(outside, files)).toEqual(files);
    expect(stderr).toContain("EEXIST");
    expect(exitCode).toBe(1);
  });

  // pnpm writes its commands as files, so a project that it installed has them.
  it.each(linkersAndFolders)("a file is replaced by the link to a command (%s, %s)", async (linker, folder) => {
    using root = tempDir("nm-outside-bin-file", {});
    const outside = await plant(String(root), { ...MINE, ".bin/dep": "#!/bin/sh\n", ".bin/other": KEEP });
    const repo = await workspace(String(root));
    await symlink(relative(dirname(join(repo, folder)), outside), join(repo, folder));

    const { stderr, exitCode } = await runBun(repo, ["install", "--ignore-scripts", "--linker", linker]);

    expect(stderr).not.toContain("error:");
    expect((await lstat(join(outside, ".bin", "dep"))).isSymbolicLink()).toBe(true);
    expect(await read(outside, { ...MINE, ".bin/other": KEEP })).toEqual({ ...MINE, ".bin/other": KEEP });
    expect(exitCode).toBe(0);
  });
});
