import { spawn } from "bun";
import { upgrade_test_helpers } from "bun:internal-for-testing";
import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { bunExe, bunEnv as env, tempDir, tls, tmpdirSync } from "harness";
import { existsSync, statSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { basename, join } from "path";
const { openTempDirWithoutSharingDelete, closeTempDirHandle } = upgrade_test_helpers;

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
    // On Windows, hold the temp dir open without FILE_SHARE_DELETE for the
    // whole run to exercise EBUSY handling. The canary path hard-codes
    // github.com, so this also doubles as the one live end-to-end check.
    openTempDirWithoutSharingDelete();
    const cwd = tmpdirSync();
    const execPath = join(cwd, basename(bunExe()));
    await copyFile(bunExe(), execPath);

    let stderr: string;
    try {
      await using proc = Bun.spawn({
        cmd: [execPath, "upgrade"],
        cwd,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
    } finally {
      closeTempDirHandle();
    }

    expect(stderr).not.toContain("This command updates Bun itself, and does not take package names.");

    // The canary release on github.com is periodically rebuilt by deleting the
    // old assets and uploading new ones, leaving a short window where the
    // asset 404s. That window is not a bug in `bun upgrade`.
    if (stderr.includes("Canary builds are not available for this platform yet")) {
      console.warn("bun upgrade: skipped live end-to-end assertions, canary asset 404'd (release re-upload window)");
    } else {
      expect(stderr).not.toContain("error:");
    }
  });
});

// https://github.com/oven-sh/bun/pull/10387 : upgrading must not EBUSY on
// Windows when another handle holds the OS temp dir without FILE_SHARE_DELETE.
// The open/close helpers are no-ops on other platforms.
it("completes the download when the OS temp dir is held open without FILE_SHARE_DELETE", async () => {
  const tagName = "bun-v9.8.7";
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

  let apiHits = 0;
  let downloadHits = 0;
  using server = Bun.serve({
    tls: tls,
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname.startsWith("/releases/")) {
        downloadHits++;
        return new Response("this is not a real zip archive");
      }
      apiHits++;
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

  // On Windows, hold a handle to the OS temp directory without FILE_SHARE_DELETE
  // for the whole upgrade run so EBUSY handling is actually exercised.
  openTempDirWithoutSharingDelete();
  let stderr: string;
  let exitCode: number;
  try {
    await using proc = Bun.spawn({
      // --stable routes through GITHUB_API_DOMAIN (the canary path hard-codes
      // github.com and would never touch this mock).
      cmd: [execPath, "upgrade", "--stable"],
      cwd,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
        // Clear ambient proxy configuration so the mock is reached directly.
        HTTPS_PROXY: "",
        HTTP_PROXY: "",
        https_proxy: "",
        http_proxy: "",
        NO_PROXY: "",
        no_proxy: "",
        ASAN_OPTIONS: [env.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
      },
    });

    [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  } finally {
    closeTempDirHandle();
  }

  // Both the release metadata and the archive must have been served locally;
  // the archive fetch is what proves we reached filesystem.tmpdir().
  expect({ apiHits, downloadHits }).toEqual({ apiHits: 1, downloadHits: 1 });
  expect(stderr).toContain("9.8.7");
  // No EBUSY while staging into the temp directory.
  expect(stderr).not.toContain("EBUSY");
  // The payload is not a real zip, so extraction fails cleanly.
  expect(exitCode).toBe(1);
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
