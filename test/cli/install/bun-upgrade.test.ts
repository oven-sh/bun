import { spawn } from "bun";
import { upgrade_test_helpers } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";
import { bunExe, bunEnv as env, isMusl, isWindows, tempDir, tls, tmpdirSync } from "harness";
import { existsSync, statSync } from "node:fs";
import { copyFile, writeFile } from "node:fs/promises";
import { basename, join } from "path";
const { openTempDirWithoutSharingDelete, closeTempDirHandle } = upgrade_test_helpers;

// Cover every platform/arch/abi/cpu combination so the asset list matches
// whichever target this test runs on. Non-matching names are ignored.
function allAssetNames(profile = false) {
  const names: string[] = [];
  for (const os of ["windows", "linux", "darwin"]) {
    for (const arch of ["x64", "aarch64"]) {
      for (const abi of ["", "-musl"]) {
        for (const cpu of ["", "-baseline"]) {
          names.push(`bun-${os}-${arch}${abi}${cpu}${profile ? "-profile" : ""}.zip`);
        }
      }
    }
  }
  return names;
}

// Build a minimal ZIP archive with a single stored (uncompressed) entry.
// `unzip -o` on POSIX restores the mode from the Unix external-attrs field;
// Expand-Archive on Windows ignores it.
function makeZipStored(entryName: string, data: Buffer, unixMode: number): Buffer {
  const nameBytes = Buffer.from(entryName, "utf8");
  const crc = Bun.hash.crc32(data);
  const size = data.length;

  const lfhLen = 30 + nameBytes.length;
  const cdhLen = 46 + nameBytes.length;
  const cdOffset = lfhLen + size;

  const buf = Buffer.alloc(lfhLen + size + cdhLen + 22);
  let p = 0;
  const u16 = (v: number) => {
    buf.writeUInt16LE(v, p);
    p += 2;
  };
  const u32 = (v: number) => {
    buf.writeUInt32LE(v >>> 0, p);
    p += 4;
  };
  const raw = (b: Buffer) => {
    b.copy(buf, p);
    p += b.length;
  };

  // Local file header
  u32(0x04034b50);
  u16(20); // version needed
  u16(0); // flags
  u16(0); // method: stored
  u16(0); // mtime
  u16(0); // mdate
  u32(crc);
  u32(size);
  u32(size);
  u16(nameBytes.length);
  u16(0);
  raw(nameBytes);
  raw(data);

  // Central directory header
  u32(0x02014b50);
  u16((3 << 8) | 20); // made by: Unix, spec 2.0
  u16(20);
  u16(0);
  u16(0);
  u16(0);
  u16(0);
  u32(crc);
  u32(size);
  u32(size);
  u16(nameBytes.length);
  u16(0);
  u16(0);
  u16(0);
  u16(0);
  u32((0o100000 | unixMode) << 16);
  u32(0); // LFH offset
  raw(nameBytes);

  // End of central directory
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(1);
  u16(1);
  u32(cdhLen);
  u32(cdOffset);
  u16(0);

  return buf;
}

// Write a release zip for the current target that, once unpacked, yields an
// executable at the path `bun upgrade` verifies. On POSIX a shell script is
// enough because `unzip` preserves the mode bits; on Windows the verify step
// spawns `bun.exe` directly, so the archive has to carry a real PE image.
async function writeFakeReleaseZip(outPath: string, version: string): Promise<void> {
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "aarch64" : "x64";
  const abi = isMusl ? "-musl" : "";
  const folder = `bun-${os}-${arch}${abi}`;
  if (isWindows) {
    const exe = Buffer.from(await Bun.file(bunExe()).arrayBuffer());
    await writeFile(outPath, makeZipStored(`${folder}/bun.exe`, exe, 0o755));
  } else {
    const script = Buffer.from(`#!/bin/sh\nprintf '%s\\n' '${version}'\n`);
    await writeFile(outPath, makeZipStored(`${folder}/bun`, script, 0o755));
  }
}

type ReleaseServer = Bun.Server & { env: Record<string, string> };

function startReleaseServer(opts: {
  tagName: string;
  assetNames?: string[];
  zipPath?: string;
  zipBody?: string;
  digest?: string;
}): ReleaseServer {
  const assetNames = opts.assetNames ?? allAssetNames();
  const server = Bun.serve({
    tls: tls,
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname.startsWith("/download/")) {
        if (opts.zipPath) return new Response(Bun.file(opts.zipPath));
        return new Response(opts.zipBody ?? "this is not a real zip archive");
      }
      return new Response(
        JSON.stringify({
          tag_name: opts.tagName,
          assets: assetNames.map(name => ({
            url: "foo",
            content_type: "application/zip",
            name,
            ...(opts.digest ? { digest: opts.digest } : {}),
            browser_download_url: `https://${server.hostname}:${server.port}/download/${name}`,
          })),
        }),
      );
    },
  }) as ReleaseServer;
  server.env = {
    ...env,
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
    GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
    // The upgrade-failure path exits via Global::exit(1) while the HTTP
    // thread and the intentionally-leaked download buffers are still
    // live; LeakSanitizer reports those at exit and abort_on_error
    // turns the clean exit(1) into SIGABRT on the ASAN lane. Leak
    // detection is not what these tests assert.
    ASAN_OPTIONS: [env.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
  };
  return server;
}

describe.concurrent(() => {
  it("two invalid arguments, should display error message and suggest command", async () => {
    const cwd = tmpdirSync();
    await using proc = spawn({
      cmd: [bunExe(), "upgrade", "bun-types", "--dev"],
      cwd,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await proc.stderr.text();
    expect(err.split(/\r?\n/)).toContain("error: This command updates Bun itself, and does not take package names.");
    expect(err.split(/\r?\n/)).toContain("note: Use `bun update bun-types --dev` instead.");
  });

  it("two invalid arguments flipped, should display error message and suggest command", async () => {
    const cwd = tmpdirSync();
    await using proc = spawn({
      cmd: [bunExe(), "upgrade", "--dev", "bun-types"],
      cwd,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await proc.stderr.text();
    expect(err.split(/\r?\n/)).toContain("error: This command updates Bun itself, and does not take package names.");
    expect(err.split(/\r?\n/)).toContain("note: Use `bun update --dev bun-types` instead.");
  });

  it("one invalid argument, should display error message and suggest command", async () => {
    const cwd = tmpdirSync();
    await using proc = spawn({
      cmd: [bunExe(), "upgrade", "bun-types"],
      cwd,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await proc.stderr.text();
    expect(err.split(/\r?\n/)).toContain("error: This command updates Bun itself, and does not take package names.");
    expect(err.split(/\r?\n/)).toContain("note: Use `bun update bun-types` instead.");
  });

  it("one valid argument, should succeed", async () => {
    const cwd = tmpdirSync();
    await using proc = spawn({
      cmd: [bunExe(), "upgrade", "--help"],
      cwd,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await proc.stderr.text();
    // Should not contain error message
    expect(err.split(/\r?\n/)).not.toContain(
      "error: This command updates bun itself, and does not take package names.",
    );
    expect(err.split(/\r?\n/)).not.toContain("note: Use `bun update --help` instead.");
  });

  it("two valid arguments, should succeed", async () => {
    // `--stable --profile` are both recognised flags; argument validation must
    // let them through. The release server returns a garbage archive so the
    // upgrade fails later, after argument parsing has already accepted them.
    using server = startReleaseServer({ tagName: "bun-v9.9.9", assetNames: allAssetNames(true) });
    const cwd = tmpdirSync();
    const execPath = join(cwd, basename(bunExe()));
    await copyFile(bunExe(), execPath);
    await using proc = spawn({
      cmd: [execPath, "upgrade", "--stable", "--profile"],
      cwd,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env: server.env,
    });

    const err = await proc.stderr.text();
    // Should not contain error message
    expect(err.split(/\r?\n/)).not.toContain(
      "error: This command updates Bun itself, and does not take package names.",
    );
    expect(err.split(/\r?\n/)).not.toContain("note: Use `bun update --stable --profile` instead.");
    await proc.exited;
  });
});

it("completes against a locally-served release with the system temp dir held open without FILE_SHARE_DELETE", async () => {
  // `--stable` routes through the GitHub releases API (overridable via
  // GITHUB_API_DOMAIN) instead of the compiled-in canary URL, so the whole
  // download/unpack/verify path runs against the local server. On non-canary
  // builds the current-version check short-circuits before the download,
  // which still produces no `error:` and is fine: canary covers the temp-dir
  // path on Windows.
  const version = Bun.version;
  const cwd = tmpdirSync();
  const execPath = join(cwd, basename(bunExe()));
  const zipPath = join(cwd, "release.zip");
  await Promise.all([copyFile(bunExe(), execPath), writeFakeReleaseZip(zipPath, version)]);

  using server = startReleaseServer({ tagName: `bun-v${version}`, zipPath });

  // On Windows, open the temporary directory without FILE_SHARE_DELETE before spawning
  // the upgrade process. This is to test for EBUSY errors.
  openTempDirWithoutSharingDelete();

  await using proc = Bun.spawn({
    cmd: [execPath, "upgrade", "--stable"],
    cwd,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: server.env,
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  closeTempDirHandle();

  expect(stderr).not.toContain("error:");
  // Canary builds always download (the current-version short-circuit is gated
  // on !IS_CANARY); a non-canary build whose version matches the served tag
  // takes the "already on the latest" exit instead.
  expect(stderr).toMatch(/Upgraded\.|already on the latest/);
  expect(exitCode).toBe(0);
});

it("recreates the staging directory in the temp dir instead of reusing a pre-existing one", async () => {
  const tagName = "bun-v9.9.9";
  // Simulate a directory that already exists at the predictable staging path
  // ($TMPDIR/<version>) before the upgrade runs, with content planted inside it.
  using stagingRoot = tempDir("bun-upgrade-staging", {
    "9.9.9": {
      "planted-before-upgrade.txt": "planted",
      "planted-subdir": {
        "bun": "#!/bin/sh\necho 9.9.9\n",
      },
    },
  });
  const stagingRootPath = String(stagingRoot);

  using server = startReleaseServer({ tagName });

  const cwd = tmpdirSync();
  const execPath = join(cwd, basename(bunExe()));
  await copyFile(bunExe(), execPath);

  await using proc = Bun.spawn({
    // --stable forces the GitHub-release code path (with a predictable
    // version-named staging directory) even on canary/debug builds.
    cmd: [execPath, "upgrade", "--stable"],
    cwd,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...server.env,
      BUN_TMPDIR: stagingRootPath,
    },
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // Sanity check: the upgrade got past the version fetch and targeted v9.9.9.
  expect(stderr).toContain("9.9.9");

  // Nothing that existed in the staging directory before the upgrade started
  // may survive into the directory the new binary is unpacked and verified in.
  expect(existsSync(join(stagingRootPath, "9.9.9", "planted-before-upgrade.txt"))).toBe(false);
  expect(existsSync(join(stagingRootPath, "9.9.9", "planted-subdir", "bun"))).toBe(false);

  if (process.platform !== "win32" && existsSync(join(stagingRootPath, "9.9.9"))) {
    // The staging directory must be freshly created with no group/other access.
    expect(statSync(join(stagingRootPath, "9.9.9")).mode & 0o077).toBe(0);
  }

  // The bogus archive must not be installed; the upgrade fails cleanly.
  expect(exitCode).toBe(1);
});

it("verifies the downloaded release archive against the digest reported by the release asset", async () => {
  const archiveBody = "this is not a real zip archive";
  const correctDigest = `sha256:${new Bun.CryptoHasher("sha256").update(archiveBody).digest("hex")}`;
  const wrongDigest = `sha256:${Buffer.alloc(32, 0xab).toString("hex")}`;

  const runUpgrade = async (tagName: string, digest: string) => {
    using server = startReleaseServer({ tagName, digest, zipBody: archiveBody });

    const cwd = tmpdirSync();
    const execPath = join(cwd, basename(bunExe()));
    await copyFile(bunExe(), execPath);

    await using proc = Bun.spawn({
      cmd: [execPath, "upgrade", "--stable"],
      cwd,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env: server.env,
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { stderr, exitCode };
  };

  const mismatched = await runUpgrade("bun-v9.9.7", wrongDigest);
  expect(mismatched.stderr).toContain("did not match the checksum reported by the GitHub API for this release");
  expect(mismatched.exitCode).toBe(1);

  const matched = await runUpgrade("bun-v9.9.8", correctDigest);
  expect(matched.stderr).toContain("9.9.8");
  expect(matched.stderr).not.toContain("did not match the checksum reported by the GitHub API for this release");
  expect(matched.exitCode).toBe(1);
});
