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
    // Cover every platform/arch/abi combination so whichever zip name the
    // upgrade command asks for is listed.
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

    let downloadHits = 0;
    using server = Bun.serve({
      tls: tls,
      port: 0,
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname.startsWith("/download/")) {
          downloadHits++;
          return new Response("this is not a real zip archive");
        }
        // Both the stable-releases endpoint and the canary-tag endpoint land
        // here; the upgrade command only looks at tag_name and the asset list,
        // so one response shape serves both.
        const tagName = pathname.endsWith("/tags/canary") ? "canary" : `bun-v9.9.9`;
        return new Response(
          JSON.stringify({
            "tag_name": tagName,
            "assets": assetNames.map(name => ({
              "url": "foo",
              "content_type": "application/zip",
              "name": name,
              "browser_download_url": `https://${server.hostname}:${server.port}/download/${tagName}/${name}`,
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
        http_proxy: undefined,
        https_proxy: undefined,
        no_proxy: undefined,
        HTTP_PROXY: undefined,
        HTTPS_PROXY: undefined,
        NO_PROXY: undefined,
        // The bogus archive makes the upgrade exit via Global::exit(1) while
        // the HTTP thread and the intentionally-leaked progress buffers are
        // still live; not what this test asserts.
        ASAN_OPTIONS: [env.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
      },
    });

    closeTempDirHandle();

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    // Zero positional arguments must not be rejected as package names.
    expect(stderr).not.toContain("does not take package names");
    // The archive is resolved via GITHUB_API_DOMAIN (for both the stable and
    // canary code paths) and fetched from the local server, not github.com or
    // any other public host.
    expect(downloadHits).toBe(1);
    // Staging the download in the temporary directory must not fail with
    // EBUSY while another handle on that directory (opened above without
    // FILE_SHARE_DELETE) is held.
    expect(stderr).not.toContain("Failed to open temporary directory");
    expect(stderr).not.toContain("Failed to create temporary directory");
    expect(stderr).not.toContain("Failed to read temporary directory");
    // Unpacking the bogus archive is expected to fail; the test only needs to
    // have reached that point.
    expect(exitCode).toBe(1);
  });

  it("canary upgrade falls back to the direct github.com URL when the releases API lookup fails", async () => {
    // The API endpoint answers 500 so get_latest_version() yields Err; the
    // canary branch must then fall back to the hardcoded github.com download
    // URL instead of surfacing the API failure.
    using api = Bun.serve({
      tls: tls,
      port: 0,
      async fetch() {
        return new Response("oops", { status: 500 });
      },
    });

    // HTTPS proxy that records the CONNECT target. The tunnel is never
    // actually established (the response isn't a valid CONNECT reply), so the
    // download fails, but only after the upgrade has committed to the
    // hardcoded URL.
    const connectTargets: string[] = [];
    using proxy = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "CONNECT") connectTargets.push(req.headers.get("host") ?? "");
        return new Response("not a tunnel", { status: 502 });
      },
    });

    const noProxy = `${api.hostname},localhost,127.0.0.1,::1`;
    const httpsProxy = `http://${proxy.hostname}:${proxy.port}`;
    const cwd = tmpdirSync();
    const execPath = join(cwd, basename(bunExe()));
    await copyFile(bunExe(), execPath);
    await using proc = Bun.spawn({
      cmd: [execPath, "upgrade", "--canary"],
      cwd,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        GITHUB_API_DOMAIN: `${api.hostname}:${api.port}`,
        http_proxy: undefined,
        HTTP_PROXY: undefined,
        https_proxy: httpsProxy,
        HTTPS_PROXY: httpsProxy,
        no_proxy: noProxy,
        NO_PROXY: noProxy,
        ASAN_OPTIONS: [env.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
      },
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(connectTargets).toContain("github.com:443");
    expect(stderr).not.toContain("does not take package names");
    expect(exitCode).toBe(1);
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
