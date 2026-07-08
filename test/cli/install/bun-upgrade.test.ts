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
