// https://github.com/oven-sh/bun/issues/11250
//
// On Windows, after `bun install` extracts a tarball into a temporary
// directory, it renames that directory into the cache. Antivirus / Search
// Indexer / MDM agents commonly open freshly written files for scanning
// without FILE_SHARE_DELETE, and while such a handle is open NTFS fails the
// parent directory rename with STATUS_ACCESS_DENIED (EPERM). The install then
// fails with:
//
//   error: moving "<pkg>" to cache dir failed
//   EPERM: Operation not permitted (NtSetInformationFile())
//
// The rename is already retried on PERM/BUSY, but the total backoff was only
// ~150ms which is shorter than a typical scanner hold. This test simulates a
// scanner that holds the handle for ~500ms and asserts the install still
// succeeds.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, stderrForInstall, tempDir } from "harness";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

describe.skipIf(!isWindows)("bun install with a scanner holding an extracted file open", () => {
  test("retries EPERM until the handle is released", async () => {
    using dir = tempDir("issue-11250", {});
    const root = String(dir);

    // Build a package with a 2MB incompressible payload. The registry below
    // serves half of it and then stalls until the blocker has grabbed its
    // handle, so the streaming extractor has written bin.exe to the temp dir
    // and is waiting for more input when the blocker runs.
    const pkgSrc = join(root, "pkg-src", "package");
    mkdirSync(pkgSrc, { recursive: true });
    writeFileSync(join(pkgSrc, "bin.exe"), randomBytes(2 * 1024 * 1024));
    writeFileSync(join(pkgSrc, "package.json"), JSON.stringify({ name: "av-test-pkg", version: "1.0.0" }));
    const tgz = join(root, "pkg-src", "av-test-pkg-1.0.0.tgz");
    await Bun.$`tar -czf ${tgz} -C ${join(root, "pkg-src")} package`.quiet();
    const tgzBytes = readFileSync(tgz);
    const sha1 = createHash("sha1").update(tgzBytes).digest("hex");

    const held = Promise.withResolvers<void>();

    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/av-test-pkg") {
          return Response.json({
            name: "av-test-pkg",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "av-test-pkg",
                version: "1.0.0",
                dist: {
                  tarball: `http://localhost:${server.port}/av-test-pkg/-/av-test-pkg-1.0.0.tgz`,
                  shasum: sha1,
                },
              },
            },
          });
        }
        if (url.pathname === "/av-test-pkg/-/av-test-pkg-1.0.0.tgz") {
          const half = tgzBytes.length >> 1;
          return new Response(
            new ReadableStream({
              type: "direct",
              async pull(ctrl) {
                ctrl.write(tgzBytes.subarray(0, half));
                await ctrl.flush();
                await held.promise;
                ctrl.write(tgzBytes.subarray(half));
                await ctrl.flush();
                ctrl.close();
              },
            }),
            {
              headers: {
                "content-type": "application/octet-stream",
                "content-length": String(tgzBytes.length),
              },
            },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });

    const packageDir = join(root, "project");
    const tmp = join(root, "tmp");
    const cache = join(root, "cache");
    mkdirSync(packageDir, { recursive: true });
    mkdirSync(tmp, { recursive: true });
    mkdirSync(cache, { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "issue-11250", version: "1.0.0", dependencies: { "av-test-pkg": "1.0.0" } }),
    );
    writeFileSync(
      join(packageDir, "bunfig.toml"),
      `[install]\ncache = "${cache.replaceAll("\\", "/")}"\nregistry = "http://localhost:${server.port}/"\n`,
    );

    // Hold the handle for 500ms: longer than the unfixed 150ms retry
    // budget, shorter than the fixed ~1.3s budget.
    await using blocker = Bun.spawn({
      cmd: [
        bunExe(),
        join(import.meta.dir, "../../cli/install/bun-install-windows-locked-temp-fixture.ts"),
        tmp,
        "500",
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });
    const reader = blocker.stdout.getReader();
    const decoder = new TextDecoder();
    let blockerOut = "";
    const ready = Promise.withResolvers<void>();
    const drained = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        blockerOut += decoder.decode(value, { stream: true });
        if (blockerOut.includes("READY")) ready.resolve();
        if (blockerOut.includes("HELD") || blockerOut.includes("MISSED")) held.resolve();
      }
      ready.resolve();
      held.resolve();
    })();
    await ready.promise;

    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: cache,
        BUN_TMPDIR: tmp,
        TMPDIR: tmp,
        TEMP: tmp,
        TMP: tmp,
        BUN_INSTALL_STREAMING_MIN_SIZE: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [, stderr, exitCode] = await Promise.all([
      install.stdout.text(),
      install.stderr.text().then(stderrForInstall),
      install.exited,
    ]);

    // The install has finished; either the blocker caught the extraction
    // (printed HELD and is sleeping or has exited) or it is still polling.
    // Kill it so the background reader reaches EOF, then inspect its output.
    // The test requires HELD so that a pass is meaningful.
    blocker.kill();
    await blocker.exited;
    await drained;

    expect({ blocker: blockerOut, stderr, exitCode }).toEqual({
      blocker: expect.stringContaining("HELD"),
      stderr: expect.not.stringContaining("NtSetInformationFile"),
      exitCode: 0,
    });
  });
});
