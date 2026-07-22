import { spawn } from "bun";
import { upgrade_test_helpers } from "bun:internal-for-testing";
import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { bunExe, bunEnv as env, tempDir, tls, tmpdirSync } from "harness";
import { existsSync, readdirSync, statSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { basename, join } from "path";
const { openTempDirWithoutSharingDelete, closeTempDirHandle } = upgrade_test_helpers;

setDefaultTimeout(1000 * 60 * 5);

// Cover every platform/arch/abi/cpu combination so the asset list matches
// whichever target this test runs on. Non-matching names are ignored.
const assetNames: string[] = [];
for (const os of ["windows", "linux", "darwin"]) {
  for (const arch of ["x64", "aarch64"]) {
    for (const abi of ["", "-musl", "-android"]) {
      for (const cpu of ["", "-baseline"]) {
        assetNames.push(`bun-${os}-${arch}${abi}${cpu}.zip`);
        assetNames.push(`bun-${os}-${arch}${abi}${cpu}-profile.zip`);
      }
    }
  }
}

function sha256Hex(body: string) {
  return new Bun.CryptoHasher("sha256").update(body).digest("hex");
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
    const archiveBody = "this is not a real zip archive";
    const digest = `sha256:${sha256Hex(archiveBody)}`;
    using server = Bun.serve({
      tls: tls,
      port: 0,
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname.startsWith("/releases/")) {
          return new Response(archiveBody);
        }
        const tagName = pathname.endsWith("/canary") ? "canary" : `bun-v${Bun.version}`;
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
        ASAN_OPTIONS: [env.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
      },
    });

    closeTempDirHandle();

    const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
    // Should not fail argument parsing, the integrity gate, or the staging-dir
    // writes (the Windows FILE_SHARE_DELETE case above); the run proceeds into
    // unpacking, where the bogus archive is rejected.
    expect(stderr).not.toContain("error: This command updates Bun itself");
    expect(stderr).not.toContain("did not return a sha256 checksum");
    expect(stderr).not.toContain("did not match the checksum");
    expect(stderr).not.toContain("temporary directory");
    expect(stderr).not.toContain("temp file");
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

  // The downloaded artifact only needs to be non-empty so the upgrade
  // reaches the staging step; it is expected to fail when unpacking.
  const archiveBody = "this is not a real zip archive";
  const digest = `sha256:${sha256Hex(archiveBody)}`;

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

async function runUpgrade({
  tagName,
  archiveBody,
  digest,
  flag,
  extraEnv = {},
}: {
  tagName: string;
  archiveBody: string;
  digest: string | null | undefined;
  flag: "--stable" | "--canary";
  extraEnv?: Record<string, string>;
}) {
  let downloaded = false;
  using server = Bun.serve({
    tls: tls,
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname.startsWith("/releases/")) {
        downloaded = true;
        return new Response(archiveBody);
      }
      const asset: Record<string, unknown> = {
        "url": "foo",
        "content_type": "application/zip",
      };
      if (digest !== undefined) asset.digest = digest;
      return new Response(
        JSON.stringify({
          "tag_name": tagName,
          "assets": assetNames.map(name => ({
            ...asset,
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
    cmd: [execPath, "upgrade", flag],
    cwd,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
      ASAN_OPTIONS: [env.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
      ...extraEnv,
    },
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  return { stderr, exitCode, downloaded, execPath };
}

it("verifies the downloaded release archive against the digest reported by the release asset", async () => {
  const archiveBody = "this is not a real zip archive";
  const correctDigest = `sha256:${sha256Hex(archiveBody)}`;
  const wrongDigest = `sha256:${Buffer.alloc(32, 0xab).toString("hex")}`;

  const mismatched = await runUpgrade({ tagName: "bun-v9.9.7", archiveBody, digest: wrongDigest, flag: "--stable" });
  expect(mismatched.stderr).toContain("did not match the checksum reported by the GitHub API for this release");
  expect(mismatched.exitCode).toBe(1);

  const matched = await runUpgrade({ tagName: "bun-v9.9.8", archiveBody, digest: correctDigest, flag: "--stable" });
  expect(matched.stderr).toContain("9.9.8");
  expect(matched.stderr).not.toContain("did not match the checksum reported by the GitHub API for this release");
  expect(matched.exitCode).toBe(1);
});

describe.each(["--stable", "--canary"] as const)("%s", flag => {
  const tagName = flag === "--canary" ? "canary" : "bun-v9.9.9";
  const archiveBody = "this is not a real zip archive";

  it("refuses to download when the release asset has no checksum", async () => {
    // An asset with a `digest` that is absent, null, or malformed must be
    // treated as unverifiable: no download, no install, no execution.
    for (const digest of [undefined, null, "", "sha256:not-hex", "md5:" + Buffer.alloc(16).toString("hex")]) {
      const result = await runUpgrade({ tagName, archiveBody, digest, flag });
      expect({ digest, stderr: result.stderr }).toEqual({
        digest,
        stderr: expect.stringContaining("did not return a sha256 checksum"),
      });
      expect(result.downloaded).toBe(false);
      expect(result.exitCode).toBe(1);
    }
  });

  it("refuses to install when the downloaded archive does not match the checksum", async () => {
    const wrongDigest = `sha256:${Buffer.alloc(32, 0xab).toString("hex")}`;
    using stagingRoot = tempDir("bun-upgrade-integrity", {});
    const result = await runUpgrade({
      tagName,
      archiveBody,
      digest: wrongDigest,
      flag,
      extraEnv: { BUN_TMPDIR: String(stagingRoot) },
    });
    expect(result.stderr).toContain("did not match the checksum reported by the GitHub API for this release");
    expect(result.downloaded).toBe(true);
    // The archive is rejected before it is written to the staging directory,
    // so nothing from the download touches disk and nothing is executed.
    expect(existsSync(String(stagingRoot))).toBe(true);
    expect(readdirSync(String(stagingRoot))).toEqual([]);
    // The installed binary must be untouched.
    expect(statSync(result.execPath).size).toBe(statSync(bunExe()).size);
    expect(result.exitCode).toBe(1);
  });
});
