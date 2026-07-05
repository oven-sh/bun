import { spawn } from "bun";
import { upgrade_test_helpers } from "bun:internal-for-testing";
import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { bunExe, bunEnv as env, isWindows, tempDir, tls, tmpdirSync } from "harness";
import { existsSync, statSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { basename, join } from "path";
const { openTempDirWithoutSharingDelete, closeTempDirHandle, createDeltaPatch, applyDeltaPatch } = upgrade_test_helpers;

setDefaultTimeout(1000 * 60 * 5);

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

  it("two valid argument, should succeed", async () => {
    const cwd = tmpdirSync();
    const execPath = join(cwd, basename(bunExe()));
    await copyFile(bunExe(), execPath);
    await using proc = spawn({
      cmd: [execPath, "upgrade", "--stable", "--profile"],
      cwd,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await proc.stderr.text();
    // Should not contain error message
    expect(err.split(/\r?\n/)).not.toContain(
      "error: This command updates Bun itself, and does not take package names.",
    );
    expect(err.split(/\r?\n/)).not.toContain("note: Use `bun update --stable --profile` instead.");
  });

  it("zero arguments, should succeed", async () => {
    const tagName = bunExe().includes("-debug") ? "canary" : `bun-v${Bun.version}`;
    using server = Bun.serve({
      tls: tls,
      port: 0,
      async fetch() {
        return new Response(
          JSON.stringify({
            "tag_name": tagName,
            "assets": [
              {
                "url": "foo",
                "content_type": "application/zip",
                "name": "bun-windows-x64.zip",
                "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/bun-windows-x64.zip`,
              },
              {
                "url": "foo",
                "content_type": "application/zip",
                "name": "bun-windows-x64-baseline.zip",
                "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/bun-windows-x64-baseline.zip`,
              },
              {
                "url": "foo",
                "content_type": "application/zip",
                "name": "bun-windows-aarch64.zip",
                "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/bun-windows-aarch64.zip`,
              },
              {
                "url": "foo",
                "content_type": "application/zip",
                "name": "bun-linux-x64.zip",
                "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/bun-linux-x64.zip`,
              },
              {
                "url": "foo",
                "content_type": "application/zip",
                "name": "bun-linux-x64-baseline.zip",
                "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/bun-linux-x64-baseline.zip`,
              },
              {
                "url": "foo",
                "content_type": "application/zip",
                "name": "bun-linux-aarch64.zip",
                "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/bun-linux-aarch64.zip`,
              },
              {
                "url": "foo",
                "content_type": "application/zip",
                "name": "bun-darwin-x64.zip",
                "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/bun-darwin-x64.zip`,
              },
              {
                "url": "foo",
                "content_type": "application/zip",
                "name": "bun-darwin-x64-baseline.zip",
                "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/bun-darwin-x64-baseline.zip`,
              },
              {
                "url": "foo",
                "content_type": "application/zip",
                "name": "bun-darwin-aarch64.zip",
                "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/bun-darwin-aarch64.zip`,
              },
            ],
          }),
        );
      },
    });

    // On windows, open the temporary directory without FILE_SHARE_DELETE before spawning
    // the upgrade process. This is to test for EBUSY errors
    openTempDirWithoutSharingDelete();
    const cwd = tmpdirSync();
    const execPath = join(cwd, basename(bunExe()));
    await copyFile(bunExe(), execPath);

    await using proc = Bun.spawn({
      cmd: [execPath, "upgrade"],
      cwd,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
      },
    });

    closeTempDirHandle();

    // Should not contain error message
    expect(await proc.stderr.text()).not.toContain("error:");
    // Reap the subprocess: stderr can close before the child exits, and an
    // unreaped child is force-killed by the test runner at test end without
    // draining the Subprocess refcount — LSan then flags it as a leak.
    await proc.exited;
  });
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

  // Cover every platform/arch/abi/cpu combination so the asset list matches
  // whichever target this test runs on. Non-matching names are ignored.
  const assetNames: string[] = [];
  for (const os of ["windows", "linux", "darwin"]) {
    for (const arch of ["x64", "aarch64"]) {
      for (const abi of ["", "-musl"]) {
        for (const cpu of ["", "-baseline"]) {
          assetNames.push(`bun-${os}-${arch}${abi}${cpu}.zip`);
        }
      }
    }
  }

  using server = Bun.serve({
    tls: tls,
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname.startsWith("/releases/")) {
        // The downloaded artifact only needs to be non-empty so the upgrade
        // reaches the staging step; it is expected to fail when unpacking.
        return new Response("this is not a real zip archive");
      }
      return new Response(
        JSON.stringify({
          "tag_name": tagName,
          "assets": assetNames.map(name => ({
            "url": "foo",
            "content_type": "application/zip",
            "name": name,
            "browser_download_url": `https://${server.hostname}:${server.port}/releases/${tagName}/${name}`,
          })),
        }),
      );
    },
  });

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
      ...env,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
      BUN_TMPDIR: stagingRootPath,
      // The upgrade-failure path exits via Global::exit(1) while the HTTP
      // thread and the intentionally-leaked progress/download buffers are
      // still live; LeakSanitizer reports those at exit and abort_on_error
      // turns the clean exit(1) into SIGABRT on the ASAN lane. Leak
      // detection is not what this test asserts.
      ASAN_OPTIONS: [env.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
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

  const assetNames: string[] = [];
  for (const os of ["windows", "linux", "darwin"]) {
    for (const arch of ["x64", "aarch64"]) {
      for (const abi of ["", "-musl"]) {
        for (const cpu of ["", "-baseline"]) {
          assetNames.push(`bun-${os}-${arch}${abi}${cpu}.zip`);
        }
      }
    }
  }

  const runUpgrade = async (tagName: string, digest: string) => {
    using server = Bun.serve({
      tls: tls,
      port: 0,
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname.startsWith("/releases/")) {
          return new Response(archiveBody);
        }
        return new Response(
          JSON.stringify({
            "tag_name": tagName,
            "assets": assetNames.map(name => ({
              "url": "foo",
              "content_type": "application/zip",
              "name": name,
              "digest": digest,
              "browser_download_url": `https://${server.hostname}:${server.port}/releases/${tagName}/${name}`,
            })),
          }),
        );
      },
    });

    const cwd = tmpdirSync();
    const execPath = join(cwd, basename(bunExe()));
    await copyFile(bunExe(), execPath);

    await using proc = Bun.spawn({
      cmd: [execPath, "upgrade", "--stable"],
      cwd,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
        ASAN_OPTIONS: [env.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
      },
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

// ── Delta upgrades ─────────────────────────────────────────────────────────

/** Every release asset name, so the mock matches whichever target runs the test. */
function allPlatformAssetNames(): string[] {
  const names: string[] = [];
  for (const os of ["windows", "linux", "darwin"]) {
    for (const arch of ["x64", "aarch64"]) {
      for (const abi of ["", "-musl"]) {
        for (const cpu of ["", "-baseline"]) {
          names.push(`bun-${os}-${arch}${abi}${cpu}`);
        }
      }
    }
  }
  return names;
}

function sha256Hex(data: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

function sha1Hex(data: Uint8Array): string {
  return new Bun.CryptoHasher("sha1").update(data).digest("hex");
}

async function sha256HexOfFile(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) {
    hasher.update(chunk);
  }
  return hasher.digest("hex");
}

/**
 * Craft a minimal delta patch that replaces the old file with `newData`,
 * without diffing the (huge) old binary: a single bsdiff control block with
 * zero diff bytes, `newData.length` extra bytes, and zero seek — wrapped in
 * zstd like published patches are.
 */
function craftReplacementPatch(newData: Uint8Array): Uint8Array {
  const raw = new Uint8Array(24 + newData.length);
  const control = new DataView(raw.buffer, 0, 24);
  control.setBigUint64(0, 0n, true); // diff ("mix") length
  control.setBigUint64(8, BigInt(newData.length), true); // extra ("copy") length
  control.setBigUint64(16, 0n, true); // seek
  raw.set(newData, 24);
  return Bun.zstdCompressSync(raw);
}

/** The running build's version, with the `-debug` suffix of debug builds removed. */
function releaseVersions(): { current: string; target: string } {
  const current = Bun.version.replace(/-debug$/, "");
  const [major, minor, patch] = current.split(".").map(Number);
  return { current, target: `${major}.${minor}.${patch + 1}` };
}

describe.concurrent("delta patches", () => {
  it("roundtrips through createDeltaPatch and applyDeltaPatch", () => {
    const old = new Uint8Array(256 * 1024);
    for (let i = 0; i < old.length; i++) old[i] = (i * 31 + 7) & 0xff;

    // A mostly-identical file: flip a few ranges and append a tail.
    const updated = new Uint8Array(old.length + 512);
    updated.set(old);
    for (let i = 1000; i < 1300; i++) updated[i] ^= 0x5a;
    for (let i = old.length; i < updated.length; i++) updated[i] = 0x42;

    const patch = createDeltaPatch(old, updated);
    // zstd frame magic — patches are published zstd-compressed.
    expect(Array.from(patch.subarray(0, 4))).toEqual([0x28, 0xb5, 0x2f, 0xfd]);
    // A patch between mostly-identical files must be much smaller than the file.
    expect(patch.length).toBeLessThan(updated.length / 4);

    const applied = applyDeltaPatch(old, patch);
    expect(applied.equals(Buffer.from(updated))).toBe(true);
  });

  it("applies a patch to an empty file", () => {
    const old = new Uint8Array(0);
    const updated = new TextEncoder().encode("#!/bin/sh\necho hello\n");
    const patch = createDeltaPatch(old, updated);
    const applied = applyDeltaPatch(old, patch);
    expect(applied.equals(Buffer.from(updated))).toBe(true);
  });

  it("rejects a truncated patch", () => {
    const old = new Uint8Array(1024).fill(3);
    const updated = new Uint8Array(1024).fill(4);
    const patch = createDeltaPatch(old, updated);
    expect(() => applyDeltaPatch(old, patch.subarray(0, 8))).toThrow();
  });
});

// The upgraded "binary" is a shell script, which can't be spawned as an
// executable on Windows, so the happy paths are POSIX-only.
it.skipIf(isWindows)("delta upgrade applies binary patches instead of downloading the archive", async () => {
  const { current, target } = releaseVersions();
  const tagName = `bun-v${target}`;

  using cwdDir = tempDir("bun-upgrade-cwd", {});
  const cwd = String(cwdDir);
  const execPath = join(cwd, basename(bunExe()));
  await copyFile(bunExe(), execPath);

  const newBinary = new TextEncoder().encode(`#!/bin/sh\necho ${target}\n`);
  const patch = craftReplacementPatch(newBinary);
  const currentExeSha = await sha256HexOfFile(execPath);

  const requests: string[] = [];
  using server = Bun.serve({
    tls,
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      requests.push(pathname);
      if (pathname.startsWith("/releases/")) {
        // The delta path never downloads the archive; serve garbage so a
        // fallback would fail loudly.
        return new Response("this is not a real zip archive");
      }
      if (pathname.endsWith(".bsdiff.sha256sum")) {
        return new Response(`${sha256Hex(patch)}  patch.bsdiff\n`);
      }
      if (pathname.endsWith(".bsdiff")) {
        return new Response(patch);
      }
      if (pathname.endsWith(".sha256sum")) {
        // Binary checksums: the current version's is the copied executable,
        // the target version's is the patched result.
        const sha = pathname.startsWith(`/bun-v${current}/`) ? currentExeSha : sha256Hex(newBinary);
        return new Response(`${sha}  bun\n`);
      }
      return new Response(
        JSON.stringify({
          tag_name: tagName,
          assets: allPlatformAssetNames().map(name => ({
            url: "foo",
            content_type: "application/zip",
            name: `${name}.zip`,
            // Real releases report a digest for the archive. It describes the
            // archive the delta path never downloads, so it must not be
            // checked against the reconstructed binary.
            digest: `sha256:${Buffer.alloc(32, 0xab).toString("hex")}`,
            browser_download_url: `https://${server.hostname}:${server.port}/releases/${tagName}/${name}.zip`,
          })),
        }),
      );
    },
  });

  using staging = tempDir("bun-upgrade-delta", {});
  await using proc = Bun.spawn({
    // --stable forces the GitHub-release code path even on canary/debug builds.
    cmd: [execPath, "upgrade", "--stable"],
    cwd,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
      BUN_UPGRADE_TESTING_RELEASE_URL: `https://${server.hostname}:${server.port}`,
      BUN_TMPDIR: String(staging),
      // The CLI intentionally leaks process-lifetime allocations (progress
      // bars, download buffers); leak detection is not what this asserts.
      ASAN_OPTIONS: [env.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
    },
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Attempting delta upgrade");
  expect(stderr).toContain("Delta upgrade verified");
  expect(stderr).not.toContain("error:");

  // The patched binary was installed over the executable.
  expect(await Bun.file(execPath).text()).toBe(`#!/bin/sh\necho ${target}\n`);

  // The patch was downloaded; the archive never was.
  expect(requests.some(pathname => pathname.endsWith(".bsdiff"))).toBe(true);
  expect(requests.some(pathname => pathname.startsWith("/releases/"))).toBe(false);

  expect(exitCode).toBe(0);
});

it("delta upgrade falls back to the full download when the patch fails verification", async () => {
  const { current, target } = releaseVersions();
  const tagName = `bun-v${target}`;

  using cwdDir = tempDir("bun-upgrade-cwd", {});
  const cwd = String(cwdDir);
  const execPath = join(cwd, basename(bunExe()));
  await copyFile(bunExe(), execPath);

  const newBinary = new TextEncoder().encode(`#!/bin/sh\necho ${target}\n`);
  const patch = craftReplacementPatch(newBinary);
  const currentExeSha = await sha256HexOfFile(execPath);

  const requests: string[] = [];
  using server = Bun.serve({
    tls,
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      requests.push(pathname);
      if (pathname.startsWith("/releases/")) {
        // The fallback archive is bogus, so the upgrade fails at unpacking —
        // after the delta attempt.
        return new Response("this is not a real zip archive");
      }
      if (pathname.endsWith(".bsdiff.sha256sum")) {
        // Wrong checksum: the delta attempt must be abandoned.
        return new Response(`${sha256Hex(new TextEncoder().encode("not the patch"))}  patch.bsdiff\n`);
      }
      if (pathname.endsWith(".bsdiff")) {
        return new Response(patch);
      }
      if (pathname.endsWith(".sha256sum")) {
        const sha = pathname.startsWith(`/bun-v${current}/`) ? currentExeSha : sha256Hex(newBinary);
        return new Response(`${sha}  bun\n`);
      }
      return new Response(
        JSON.stringify({
          tag_name: tagName,
          assets: allPlatformAssetNames().map(name => ({
            url: "foo",
            content_type: "application/zip",
            name: `${name}.zip`,
            browser_download_url: `https://${server.hostname}:${server.port}/releases/${tagName}/${name}.zip`,
          })),
        }),
      );
    },
  });

  using staging = tempDir("bun-upgrade-delta-fallback", {});
  await using proc = Bun.spawn({
    cmd: [execPath, "upgrade", "--stable"],
    cwd,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
      BUN_UPGRADE_TESTING_RELEASE_URL: `https://${server.hostname}:${server.port}`,
      BUN_TMPDIR: String(staging),
      ASAN_OPTIONS: [env.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
    },
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Attempting delta upgrade");
  expect(stderr).toContain("Delta upgrade unavailable");

  // The full archive was downloaded after the delta attempt failed.
  const patchRequest = requests.findIndex(pathname => pathname.endsWith(".bsdiff"));
  const archiveRequest = requests.findIndex(pathname => pathname.startsWith("/releases/"));
  expect(patchRequest).toBeGreaterThanOrEqual(0);
  expect(archiveRequest).toBeGreaterThan(patchRequest);

  // The bogus archive must not be installed; the upgrade fails cleanly.
  expect(exitCode).toBe(1);
});

// Two releases behind: current -> middle -> target. No direct
// target.from-current patch exists, so the chain is used, verifying the
// intermediate binary's checksum along the way.
const chainLayouts = [
  {
    label: "consecutive patch releases",
    versions() {
      const { current, target: middle } = releaseVersions();
      const [major, minor, patch] = middle.split(".").map(Number);
      return { current, middle, target: `${major}.${minor}.${patch + 1}` };
    },
  },
  {
    label: "a minor version bump",
    versions() {
      // The chain crosses the minor boundary via the new minor's .0 release.
      const { current } = releaseVersions();
      const [major, minor] = current.split(".").map(Number);
      return { current, middle: `${major}.${minor + 1}.0`, target: `${major}.${minor + 1}.1` };
    },
  },
];

it.skipIf(isWindows).each(chainLayouts)("delta upgrade chains through $label", async ({ versions }) => {
  const { current, middle, target } = versions();
  const tagName = `bun-v${target}`;

  using cwdDir = tempDir("bun-upgrade-cwd", {});
  const cwd = String(cwdDir);
  const execPath = join(cwd, basename(bunExe()));
  await copyFile(bunExe(), execPath);

  const middleBinary = new TextEncoder().encode(`#!/bin/sh\necho ${middle}\n`);
  const targetBinary = new TextEncoder().encode(`#!/bin/sh\necho ${target}\n`);
  const middlePatch = craftReplacementPatch(middleBinary);
  // A real diff against the intermediate binary: the second hop only
  // produces the target if the first hop produced exactly `middleBinary`.
  const targetPatch = createDeltaPatch(middleBinary, targetBinary);
  const currentExeSha = await sha256HexOfFile(execPath);

  const requests: string[] = [];
  using server = Bun.serve({
    tls,
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      requests.push(pathname);
      if (pathname.startsWith("/releases/")) {
        return new Response("this is not a real zip archive");
      }
      if (pathname.includes(`/bun-v${target}/`) && pathname.includes(`.from-${current}.bsdiff`)) {
        // The direct patch doesn't exist; only per-release patches do.
        return new Response("not found", { status: 404 });
      }
      if (pathname.includes(`/bun-v${middle}/`)) {
        if (pathname.endsWith(".bsdiff.sha256sum")) {
          return new Response(`${sha256Hex(middlePatch)}  patch.bsdiff\n`);
        }
        if (pathname.endsWith(`.from-${current}.bsdiff`)) {
          return new Response(middlePatch);
        }
        if (pathname.endsWith(".sha256sum")) {
          return new Response(`${sha256Hex(middleBinary)}  bun\n`);
        }
      }
      if (pathname.includes(`/bun-v${target}/`)) {
        if (pathname.endsWith(".bsdiff.sha256sum")) {
          return new Response(`${sha256Hex(targetPatch)}  patch.bsdiff\n`);
        }
        if (pathname.endsWith(`.from-${middle}.bsdiff`)) {
          return new Response(targetPatch);
        }
        if (pathname.endsWith(".sha256sum")) {
          return new Response(`${sha256Hex(targetBinary)}  bun\n`);
        }
      }
      if (pathname.includes(`/bun-v${current}/`) && pathname.endsWith(".sha256sum")) {
        return new Response(`${currentExeSha}  bun\n`);
      }
      return new Response(
        JSON.stringify({
          tag_name: tagName,
          assets: allPlatformAssetNames().map(name => ({
            url: "foo",
            content_type: "application/zip",
            name: `${name}.zip`,
            browser_download_url: `https://${server.hostname}:${server.port}/releases/${tagName}/${name}.zip`,
          })),
        }),
      );
    },
  });

  using staging = tempDir("bun-upgrade-delta-chain", {});
  await using proc = Bun.spawn({
    cmd: [execPath, "upgrade", "--stable"],
    cwd,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
      BUN_UPGRADE_TESTING_RELEASE_URL: `https://${server.hostname}:${server.port}`,
      BUN_TMPDIR: String(staging),
      ASAN_OPTIONS: [env.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
    },
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // The direct patch 404s, then the two-step chain applies.
  expect(stderr).toContain("Attempting delta upgrade");
  expect(stderr).toContain("Downloading patch 1/2");
  expect(stderr).toContain("Downloading patch 2/2");
  expect(stderr).toContain("Delta upgrade verified");
  expect(stderr).not.toContain("error:");

  // The direct patch was tried first, then both chain patches; the
  // intermediate binary's checksum was verified; the archive was never
  // downloaded.
  expect(requests.some(p => p.includes(`/bun-v${target}/`) && p.includes(`.from-${current}.bsdiff`))).toBe(true);
  expect(requests.some(p => p.includes(`/bun-v${middle}/`) && p.endsWith(`.from-${current}.bsdiff`))).toBe(true);
  expect(
    requests.some(p => p.includes(`/bun-v${middle}/`) && p.endsWith(".sha256sum") && !p.endsWith(".bsdiff.sha256sum")),
  ).toBe(true);
  expect(requests.some(p => p.includes(`/bun-v${target}/`) && p.endsWith(`.from-${middle}.bsdiff`))).toBe(true);
  expect(requests.some(p => p.startsWith("/releases/"))).toBe(false);

  // The final chained binary was installed.
  expect(await Bun.file(execPath).text()).toBe(`#!/bin/sh\necho ${target}\n`);

  expect(exitCode).toBe(0);
});

it("delta upgrade is skipped with --no-delta", async () => {
  const { target } = releaseVersions();
  const tagName = `bun-v${target}`;

  using cwdDir = tempDir("bun-upgrade-cwd", {});
  const cwd = String(cwdDir);
  const execPath = join(cwd, basename(bunExe()));
  await copyFile(bunExe(), execPath);

  const requests: string[] = [];
  using server = Bun.serve({
    tls,
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      requests.push(pathname);
      if (pathname.startsWith("/releases/")) {
        return new Response("this is not a real zip archive");
      }
      return new Response(
        JSON.stringify({
          tag_name: tagName,
          assets: allPlatformAssetNames().map(name => ({
            url: "foo",
            content_type: "application/zip",
            name: `${name}.zip`,
            browser_download_url: `https://${server.hostname}:${server.port}/releases/${tagName}/${name}.zip`,
          })),
        }),
      );
    },
  });

  using staging = tempDir("bun-upgrade-no-delta", {});
  await using proc = Bun.spawn({
    cmd: [execPath, "upgrade", "--stable", "--no-delta"],
    cwd,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
      BUN_UPGRADE_TESTING_RELEASE_URL: `https://${server.hostname}:${server.port}`,
      BUN_TMPDIR: String(staging),
      ASAN_OPTIONS: [env.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
    },
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // No delta request was made; the archive was downloaded directly.
  expect(stderr).not.toContain("Attempting delta upgrade");
  expect(requests.some(pathname => pathname.endsWith(".bsdiff"))).toBe(false);
  expect(requests.some(pathname => pathname.startsWith("/releases/"))).toBe(true);
  expect(exitCode).toBe(1);
});

// ── Installing builds from pull requests ───────────────────────────────────

/** Minimal store-only (uncompressed) zip archive with unix file modes. */
function storeZip(entries: Record<string, { data: Uint8Array; mode?: number }>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const [name, { data, mode = 0o644 }] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const crc = Bun.hash.crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true); // local file header signature
    localView.setUint16(4, 20, true); // version needed
    localView.setUint16(8, 0, true); // method: store
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true); // compressed size
    localView.setUint32(22, data.length, true); // uncompressed size
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    chunks.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true); // central directory signature
    centralView.setUint16(4, (3 << 8) | 20, true); // made by: unix
    centralView.setUint16(6, 20, true); // version needed
    centralView.setUint16(10, 0, true); // method: store
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(38, ((0o100000 | mode) << 16) >>> 0, true); // unix mode
    centralView.setUint32(42, offset, true); // local header offset
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((total, chunk) => total + chunk.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true); // end of central directory signature
  eocdView.setUint16(8, centrals.length, true);
  eocdView.setUint16(10, centrals.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);

  return Buffer.concat([...chunks, ...centrals, eocd]);
}

const prInstallVariants = [
  { label: "", flags: [] as string[], exeName: "bun" },
  { label: " with --profile", flags: ["--profile"], exeName: "bun-profile" },
];

it.skipIf(isWindows).each(prInstallVariants)(
  "bun upgrade pr <number> installs the pull request's build$label",
  async ({ flags, exeName }) => {
    const prNumber = 12345;
    const prTitle = "fix: make something faster";
    const headSha = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
    const scriptFor = (exe: string) => `#!/bin/sh\necho ${exe} 1.2.3-pr+${headSha.slice(0, 9)}\n`;

    // Standard and -profile artifact zips for every platform, so the test
    // passes on any target and proves the requested flavor gets picked.
    const zips = new Map<string, Uint8Array>();
    for (const name of allPlatformAssetNames()) {
      for (const [folder, exe] of [
        [name, "bun"],
        [`${name}-profile`, "bun-profile"],
      ] as const) {
        zips.set(
          `${folder}.zip`,
          storeZip({
            [`${folder}/${exe}`]: { data: new TextEncoder().encode(scriptFor(exe)), mode: 0o755 },
          }),
        );
      }
    }

    using cwdDir = tempDir("bun-upgrade-cwd", {});
    const cwd = String(cwdDir);
    const execPath = join(cwd, basename(bunExe()));
    await copyFile(bunExe(), execPath);

    const artifactDownloads: string[] = [];
    using server = Bun.serve({
      tls,
      port: 0,
      async fetch(req) {
        const { pathname } = new URL(req.url);

        if (pathname === `/repos/oven-sh/bun/pulls/${prNumber}`) {
          return Response.json({
            title: prTitle,
            state: "open",
            head: { sha: headSha },
          });
        }
        if (pathname === `/repos/oven-sh/bun/commits/${headSha}/statuses`) {
          return Response.json([
            { context: "some-other-ci", state: "success", target_url: "https://example.com/nope" },
            {
              context: "buildkite/bun",
              state: "success",
              target_url: `https://${server.hostname}:${server.port}/bun/bun/builds/4242#annotation`,
            },
          ]);
        }
        if (pathname === "/bun/bun/builds/4242.json") {
          return Response.json({
            state: "passed",
            jobs: [
              { step_key: "linux-x64-test-bun", base_path: "/bun/bun/builds/4242/jobs/test" },
              { step_key: "build-bun", base_path: "/bun/bun/builds/4242/jobs/build" },
            ],
          });
        }
        if (pathname === "/bun/bun/builds/4242/jobs/build/artifacts") {
          // Real Buildkite responses carry both checksums. Each artifact is
          // listed twice: first a decoy on a lookalike origin (must be
          // skipped: the build's origin is a prefix of it, but not equal),
          // then the real entry. The profile variant uses absolute
          // same-origin URLs and the standard variant relative ones, so both
          // accepted URL forms stay covered.
          const origin = `https://${server.hostname}:${server.port}`;
          return Response.json(
            [...zips.entries()].flatMap(([name, data]) => {
              const entry = { file_name: name, sha256sum: sha256Hex(data), sha1sum: sha1Hex(data) };
              return [
                { ...entry, url: `${origin}.attacker.example/artifacts/${name}` },
                { ...entry, url: exeName === "bun-profile" ? `${origin}/artifacts/${name}` : `/artifacts/${name}` },
              ];
            }),
          );
        }
        if (pathname.startsWith("/artifacts/")) {
          artifactDownloads.push(pathname);
          const zip = zips.get(pathname.slice("/artifacts/".length));
          if (zip) return new Response(zip);
        }
        return new Response("not found", { status: 404 });
      },
    });

    using staging = tempDir("bun-upgrade-pr", {});
    await using proc = Bun.spawn({
      cmd: [execPath, "upgrade", "pr", String(prNumber), ...flags],
      cwd,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
        // Build links are pinned to Bun's Buildkite pipeline; point the pin at
        // the mock server.
        BUN_UPGRADE_TESTING_BUILDKITE_URL: `https://${server.hostname}:${server.port}/bun/bun/builds/`,
        BUN_TMPDIR: String(staging),
        ASAN_OPTIONS: [env.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
      },
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).toContain(`PR #${prNumber}`);
    expect(stderr).toContain(prTitle);
    expect(stderr).toContain(`Installed a build of Bun from pull request #${prNumber}`);
    expect(stderr).not.toContain("error:");

    // Exactly one artifact was downloaded: this platform's, in the requested
    // flavor.
    const os = process.platform === "darwin" ? "darwin" : "linux";
    const arch = process.arch === "arm64" ? "aarch64" : "x64";
    expect(artifactDownloads).toHaveLength(1);
    expect(artifactDownloads[0]).toStartWith(`/artifacts/bun-${os}-${arch}`);
    expect(artifactDownloads[0].endsWith("-profile.zip")).toBe(exeName === "bun-profile");

    // The pull request's build (of the requested flavor) was installed over
    // the executable.
    expect(await Bun.file(execPath).text()).toBe(scriptFor(exeName));

    expect(exitCode).toBe(0);
  },
);

// `#1234` and pull request URLs are accepted too; a 404 from the mocked
// GitHub API proves the number was parsed out of each spelling (the error
// echoes it back) without running a full install.
describe.concurrent("bun upgrade pr argument spellings", () => {
  it.each(["#4321", "https://github.com/oven-sh/bun/pull/4321", "http://github.com/oven-sh/bun/pull/4321"])(
    "accepts %s",
    async spelling => {
      using cwd = tempDir("bun-upgrade-pr-spelling", {});
      using server = Bun.serve({
        tls,
        port: 0,
        fetch: () => new Response("not found", { status: 404 }),
      });

      await using proc = spawn({
        cmd: [bunExe(), "upgrade", "pr", spelling],
        cwd: String(cwd),
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env: {
          ...env,
          NODE_TLS_REJECT_UNAUTHORIZED: "0",
          GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
          // The lookup reaches the HTTP path, which intentionally leaks
          // process-lifetime allocations (CLI arena); leak detection is not
          // what this asserts.
          ASAN_OPTIONS: [env.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
        },
      });

      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("Pull request #4321 was not found");
      expect(exitCode).toBe(1);
    },
  );
});

describe.concurrent("bun upgrade pr argument validation", () => {
  it("requires a pull request number", async () => {
    using cwd = tempDir("bun-upgrade-pr-args", {});
    await using proc = spawn({
      cmd: [bunExe(), "upgrade", "pr"],
      cwd: String(cwd),
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Expected a pull request number");
    expect(exitCode).toBe(1);
  });

  // Non-canonical URLs are rejected: the number is looked up in oven-sh/bun,
  // so reinterpreting another repository's PR URL (or a URL merely
  // containing the oven-sh/bun pull path) would install a build the user
  // never named.
  it.each([
    "not-a-number",
    "https://github.com/acme/widget/pull/123",
    "https://evil.example/github.com/oven-sh/bun/pull/123",
  ])("rejects %s", async arg => {
    using cwd = tempDir("bun-upgrade-pr-args", {});
    await using proc = spawn({
      cmd: [bunExe(), "upgrade", "pr", arg],
      cwd: String(cwd),
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Invalid pull request number");
    expect(exitCode).toBe(1);
  });

  it("rejects extra arguments after the pull request number", async () => {
    using cwd = tempDir("bun-upgrade-pr-args", {});
    await using proc = spawn({
      cmd: [bunExe(), "upgrade", "pr", "123", "456"],
      cwd: String(cwd),
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Unexpected extra arguments");
    expect(exitCode).toBe(1);
  });
});
