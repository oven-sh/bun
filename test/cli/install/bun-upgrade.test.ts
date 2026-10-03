import { spawn } from "bun";
import { upgrade_test_helpers } from "bun:internal-for-testing";
import { beforeAll, describe, expect, it } from "bun:test";
import {
  bunExe,
  bunEnv as env,
  isDebug,
  isMusl,
  isWindows,
  normalizeBunSnapshot,
  tempDir,
  tls,
  tmpdirSync,
} from "harness";
import { readdirSync, statSync } from "node:fs";
import { copyFile, link, realpath, writeFile } from "node:fs/promises";
import { basename, join } from "path";
const { openTempDirWithoutSharingDelete, closeTempDirHandle } = upgrade_test_helpers;

// The asset `bun upgrade` picks for the target this test runs on, and the
// folder inside it.
const releaseOs = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
const releaseArch = process.arch === "arm64" ? "aarch64" : "x64";
const releaseFolder = `bun-${releaseOs}-${releaseArch}${isMusl ? "-musl" : ""}`;
const releaseAsset = `${releaseFolder}.zip`;

// Last line `bun upgrade` prints when the downloaded archive is not a zip. On
// POSIX `unzip` rejects it; on Windows Expand-Archive's failure is only noticed
// when the executable it should have produced is missing.
const unpackFailure = isWindows ? "error: Failed to verify Bun (code: ENOENT)\n" : "Unzip failed (exit code: 9)\n";

// `bun upgrade` swaps out the executable it runs as, so the release flows run a
// stand-in in a temp dir instead of bunExe() itself. A hard link is enough: the
// upgrade only renames directory entries (POSIX swaps the staged file in,
// Windows renames the old image to `<name>.outdated`), so bunExe() is never
// modified through the link. Unlike a copy, a link is not a new file, so
// Windows does not re-scan the 80+ MB image on first launch (about 2.4s per
// copy on the arm64 lane). A temp dir on another volume falls back to a copy.
async function installStandIn(dir: string): Promise<string> {
  const execPath = join(dir, basename(bunExe()));
  try {
    await link(await realpath(bunExe()), execPath);
  } catch {
    await copyFile(bunExe(), execPath);
  }
  return execPath;
}

// The flows that are expected to fail never reach the swap, so they all share
// one stand-in.
let standInDir: string;
let standInExe: string;
beforeAll(async () => {
  standInDir = tmpdirSync();
  standInExe = await installStandIn(standInDir);
});

// Every release flow prints one line naming the version bun decided to install.
// Canary builds (CI and `bun bd`) word it as a downgrade; release builds
// announce the new version. It is not necessarily the first line: when the
// version fetch takes longer than the progress bar's delay (a loaded machine
// running a debug build), a "Fetching version tags" line precedes it on POSIX.
function expectTargetsRelease(stderr: string, version: string) {
  expect(stderr.split("\n")).toContainAnyValues([
    `Downgrading from Bun ${Bun.version}-canary to Bun v${version}`,
    `Bun v${version} is out! You're on v${Bun.version}`,
  ]);
}

function fakeReleaseScript(version: string): string {
  return `#!/bin/sh\nprintf '%s\\n' '${version}'\n`;
}

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
  if (isWindows) {
    const exe = Buffer.from(await Bun.file(bunExe()).arrayBuffer());
    await writeFile(outPath, makeZipStored(`${releaseFolder}/bun.exe`, exe, 0o755));
  } else {
    const script = Buffer.from(fakeReleaseScript(version));
    await writeFile(outPath, makeZipStored(`${releaseFolder}/bun`, script, 0o755));
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
    // thread and the intentionally-leaked progress/download buffers are
    // still live; LeakSanitizer reports those at exit and abort_on_error
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
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(out).toBe("");
    expect(normalizeBunSnapshot(err)).toMatchInlineSnapshot(`
      "error: This command updates Bun itself, and does not take package names.
      note: Use \`bun update bun-types --dev\` instead."
    `);
    expect(exitCode).toBe(1);
  });

  it("two invalid arguments flipped, should display error message and suggest command", async () => {
    const cwd = tmpdirSync();
    await using proc = spawn({
      cmd: [bunExe(), "upgrade", "--dev", "bun-types"],
      cwd,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(out).toBe("");
    expect(normalizeBunSnapshot(err)).toMatchInlineSnapshot(`
      "error: This command updates Bun itself, and does not take package names.
      note: Use \`bun update --dev bun-types\` instead."
    `);
    expect(exitCode).toBe(1);
  });

  it("one invalid argument, should display error message and suggest command", async () => {
    const cwd = tmpdirSync();
    await using proc = spawn({
      cmd: [bunExe(), "upgrade", "bun-types"],
      cwd,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(out).toBe("");
    expect(normalizeBunSnapshot(err)).toMatchInlineSnapshot(`
      "error: This command updates Bun itself, and does not take package names.
      note: Use \`bun update bun-types\` instead."
    `);
    expect(exitCode).toBe(1);
  });

  it("one valid argument, should succeed", async () => {
    const cwd = tmpdirSync();
    await using proc = spawn({
      cmd: [bunExe(), "upgrade", "--help"],
      cwd,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(out).toStartWith("Usage: bun upgrade [flags]\n");
    expect(err).toBe("");
    expect(exitCode).toBe(0);
  });

  it("two valid arguments, should succeed", async () => {
    // `--stable --profile` are both recognised flags; argument validation must
    // let them through. Only profile assets are served, so reaching the version
    // announcement also proves `--profile` was honored. The archive is garbage,
    // so the upgrade fails later, after argument parsing has accepted the flags.
    using server = startReleaseServer({ tagName: "bun-v9.9.9", assetNames: allAssetNames(true) });
    using stagingRoot = tempDir("bun-upgrade-args", {});
    await using proc = spawn({
      cmd: [standInExe, "upgrade", "--stable", "--profile"],
      cwd: standInDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env: { ...server.env, BUN_TMPDIR: String(stagingRoot) },
    });

    const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("does not take package names");
    expectTargetsRelease(err, "9.9.9");
    expect(err).toEndWith(unpackFailure);
    expect(exitCode).toBe(1);
  });
});

it.concurrent(
  "completes against a locally-served release with the system temp dir held open without FILE_SHARE_DELETE",
  async () => {
    // `--stable` routes through the GitHub releases API (overridable via
    // GITHUB_API_DOMAIN) instead of the compiled-in canary URL, so the whole
    // download/unpack/verify/swap path runs against the local server. This flow
    // really swaps the executable, so it gets a stand-in of its own. The staging
    // directory must stay in the default temp dir: that is the directory held
    // open below.
    const version = Bun.version;
    const exeName = basename(bunExe());
    const installDir = tmpdirSync();
    const zipPath = join(tmpdirSync(), "release.zip");
    const [execPath] = await Promise.all([installStandIn(installDir), writeFakeReleaseZip(zipPath, version)]);

    using server = startReleaseServer({ tagName: `bun-v${version}`, zipPath });

    // On Windows, open the temporary directory without FILE_SHARE_DELETE before spawning
    // the upgrade process. This is to test for EBUSY errors.
    openTempDirWithoutSharingDelete();

    await using proc = Bun.spawn({
      cmd: [execPath, "upgrade", "--stable"],
      cwd: installDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env: server.env,
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    closeTempDirHandle();

    if (stderr.includes("Congrats!")) {
      // A non-canary build is "already on" the version the server advertises
      // (its own) and stops before the download, so nothing may have changed.
      expect(stderr).toEndWith(`Congrats! You're already on the latest version of Bun (which is v${version})\n`);
      expect(readdirSync(installDir)).toEqual([exeName]);
    } else {
      expectTargetsRelease(stderr, version);
      expect(stderr).toEndWith(
        ` Upgraded.\n\nWelcome to Bun v${version}!\n\nWhat's new in Bun v${version}:\n\n    https://bun.com/blog/release-notes/bun-v${version}\n\nReport any bugs:\n\n    https://github.com/oven-sh/bun/issues\n\nCommit log:\n\n    https://github.com/oven-sh/bun/compare/bun-v${Bun.version}...bun-v${version}\n`,
      );
      if (isWindows) {
        // A running image cannot be deleted, so the old one is parked as
        // `.outdated`. The upgrade then ran `completions` with the installed
        // executable, which recreates the bunx hard link next to itself.
        expect(readdirSync(installDir).sort()).toEqual(
          [exeName, `${exeName}.outdated`, isDebug ? "bunx-debug.exe" : "bunx.exe"].sort(),
        );
      } else {
        expect(readdirSync(installDir)).toEqual([exeName]);
        expect(await Bun.file(execPath).text()).toBe(fakeReleaseScript(version));
      }
    }
    expect(exitCode).toBe(0);
  },
);

it.concurrent("recreates the staging directory in the temp dir instead of reusing a pre-existing one", async () => {
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

  await using proc = Bun.spawn({
    // --stable forces the GitHub-release code path (with a predictable
    // version-named staging directory) even on canary/debug builds.
    cmd: [standInExe, "upgrade", "--stable"],
    cwd: standInDir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...server.env,
      BUN_TMPDIR: stagingRootPath,
    },
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // The upgrade targeted v9.9.9 and got as far as unpacking into the staging
  // directory, where the bogus archive made it fail.
  expectTargetsRelease(stderr, "9.9.9");
  expect(stderr).toEndWith(unpackFailure);

  // Nothing that existed in the staging directory before the upgrade started
  // may survive into the directory the new binary is unpacked and verified in.
  // The failed unpack leaves nothing behind either: bun removes its own
  // download (bun.zip) again.
  expect(readdirSync(join(stagingRootPath, "9.9.9"))).toEqual([]);

  if (!isWindows) {
    // The staging directory must be freshly created with no group/other
    // access. The planted one was created with the default mode, so a reused
    // directory fails here.
    expect(statSync(join(stagingRootPath, "9.9.9")).mode & 0o077).toBe(0);
  }

  // The bogus archive must not be installed; the upgrade fails cleanly.
  expect(exitCode).toBe(1);
});

it.concurrent("verifies the downloaded release archive against the digest reported by the release asset", async () => {
  const archiveBody = "this is not a real zip archive";
  const correctDigest = `sha256:${new Bun.CryptoHasher("sha256").update(archiveBody).digest("hex")}`;
  const wrongDigest = `sha256:${Buffer.alloc(32, 0xab).toString("hex")}`;

  const runUpgrade = async (tagName: string, digest: string) => {
    using server = startReleaseServer({ tagName, digest, zipBody: archiveBody });
    using stagingRoot = tempDir("bun-upgrade-digest", {});

    await using proc = Bun.spawn({
      cmd: [standInExe, "upgrade", "--stable"],
      cwd: standInDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env: { ...server.env, BUN_TMPDIR: String(stagingRoot) },
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return {
      stderr,
      exitCode,
      // Whatever the upgrade staged before it gave up.
      staged: readdirSync(String(stagingRoot)),
      downloadUrl: `https://${server.hostname}:${server.port}/download/${releaseAsset}`,
    };
  };

  const [mismatched, matched] = await Promise.all([
    runUpgrade("bun-v9.9.7", wrongDigest),
    runUpgrade("bun-v9.9.8", correctDigest),
  ]);

  expectTargetsRelease(mismatched.stderr, "9.9.7");
  expect(mismatched.stderr).toEndWith(
    `error: The file downloaded from ${mismatched.downloadUrl} did not match the checksum reported by the GitHub API for this release.\n` +
      "note: run bun upgrade again to retry the download\n",
  );
  // Rejected before anything was written to disk.
  expect(mismatched.staged).toEqual([]);
  expect(mismatched.exitCode).toBe(1);

  expectTargetsRelease(matched.stderr, "9.9.8");
  // With a matching digest the archive is accepted and staged; this run only
  // fails afterwards because the body is not a zip.
  expect(matched.stderr).not.toContain("did not match the checksum");
  expect(matched.stderr).toEndWith(unpackFailure);
  expect(matched.staged).toEqual(["9.9.8"]);
  expect(matched.exitCode).toBe(1);
});
