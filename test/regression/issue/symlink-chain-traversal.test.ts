import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, realpathSync, symlinkSync } from "fs";
import { bunEnv, bunExe, tempDir, tls } from "harness";
import { dirname, join } from "path";

// Symlink chain path traversal vulnerability in archive extraction (libarchive.zig).
//
// The attack uses a 3-level chain of symlinks to escape extraction bounds:
// 1. `x/a` -> `.` creates a self-referencing symlink (resolves to x/ itself)
// 2. `x/a/b` -> `.` through the first symlink creates x/b -> . (also self-referencing)
// 3. `x/a/b/c` -> `../..` through both symlinks creates x/c -> ../..
//    which resolves from x/ to two levels up = parent of extraction dir
//
// isSymlinkTargetSafe passes all three because it only checks logical path
// resolution without considering previously-created symlinks on the filesystem.

describe("symlink chain path traversal", () => {
  test("chained symlinks in tarball should not escape extraction directory via bun create", async () => {
    using dir = tempDir("symlink-chain-test", {});
    const baseDir = String(dir);
    const tgzPath = join(baseDir, "malicious.tgz");

    // Create a malicious tarball with 3-level symlink chain.
    // root/ prefix gets stripped by depth_to_skip=1 (matching bun create behavior).
    const pyResult = Bun.spawnSync({
      cmd: [
        "python3",
        "-c",
        `
import tarfile, io

with tarfile.open(${JSON.stringify(tgzPath)}, 'w:gz') as tar:
    for name, typ, extra in [
        ('root/',              tarfile.DIRTYPE, {}),
        ('root/x/',            tarfile.DIRTYPE, {}),
        ('root/x/a',           tarfile.SYMTYPE, {'linkname': '.'}),
        ('root/x/a/b',         tarfile.SYMTYPE, {'linkname': '.'}),
        ('root/x/a/b/c',       tarfile.SYMTYPE, {'linkname': '../..'}),
    ]:
        info = tarfile.TarInfo(name=name)
        info.type = typ
        info.mode = 0o755
        for k, v in extra.items():
            setattr(info, k, v)
        tar.addfile(info)

    content = b'PWNED_CANARY'
    info = tarfile.TarInfo(name='root/x/c/evil.txt')
    info.type = tarfile.REGTYPE
    info.size = len(content)
    info.mode = 0o644
    tar.addfile(info, io.BytesIO(content))
`,
      ],
      env: bunEnv,
    });
    expect(pyResult.exitCode).toBe(0);
    expect(existsSync(tgzPath)).toBe(true);

    // Serve the tarball over HTTPS, mimicking the GitHub API tarball endpoint.
    await using server = Bun.serve({
      port: 0,
      tls,
      fetch(req) {
        if (new URL(req.url).pathname === "/repos/test/malicious/tarball") {
          return new Response(Bun.file(tgzPath), {
            headers: { "content-type": "application/x-gzip" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    const createDir = join(baseDir, "created-project");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "create", "test/malicious", createDir],
      env: {
        ...bunEnv,
        GITHUB_API_DOMAIN: `localhost:${server.port}`,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // x/c -> ../.. resolves from createDir/x/ up two levels to dirname(createDir)
    const evilOutside = join(dirname(createDir), "evil.txt");
    const fileEscaped = existsSync(evilOutside);

    if (fileEscaped) {
      console.log("VULNERABILITY: evil.txt written outside extraction directory at", evilOutside);
      Bun.spawnSync({ cmd: ["rm", "-f", evilOutside], env: bunEnv });
    }

    // Security requirement: no file should exist outside the extraction directory
    expect(fileEscaped).toBe(false);

    // Verify: if x/c symlink exists, it should not resolve outside createDir
    const escapeLink = join(createDir, "x", "c");
    if (existsSync(escapeLink)) {
      try {
        const resolved = realpathSync(escapeLink);
        expect(resolved.startsWith(createDir)).toBe(true);
      } catch {
        // Broken symlink is OK - the escape was prevented
      }
    }
  });

  test("concept validation: 3-level symlink chain escapes extraction directory", () => {
    // Validates the attack concept independently of Bun's extraction.
    using dir = tempDir("symlink-concept-test", {});
    const baseDir = String(dir);
    const extractDir = join(baseDir, "extract");
    mkdirSync(join(extractDir, "x"), { recursive: true });

    // Chain: x/a -> . , x/a/b -> . , x/a/b/c -> ../..
    symlinkSync(".", join(extractDir, "x", "a"));
    symlinkSync(".", join(extractDir, "x", "a", "b"));
    symlinkSync("../..", join(extractDir, "x", "a", "b", "c"));

    // x/c -> ../.. from x/ goes two levels up: extract/ -> baseDir/
    const escapeResolved = realpathSync(join(extractDir, "x", "c"));
    expect(escapeResolved).toBe(baseDir);
    expect(escapeResolved.startsWith(extractDir)).toBe(false);
  });
});
