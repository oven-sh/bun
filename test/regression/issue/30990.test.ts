// Regression test for https://github.com/oven-sh/bun/issues/30990
// `bun upgrade` download progress must render binary bytes (`KiB`/`MiB`/`GiB`)
// rather than raw integer bytes — matching the Zig `{Bi:.2}` output that the
// original implementation produced.
//
// We stand up a TLS server impersonating `api.github.com` via `GITHUB_API_DOMAIN`,
// point `browser_download_url` at the same server so the download streams
// through us, and assert that `Downloading [...]` lines in stderr contain
// binary-IEC units (e.g. `1.50MiB`) — exercising both the two-sided
// `[current/total]` arm (mock API returns a non-zero `size`) and the
// one-sided `[current]` arm (mock API omits `size`, so `version.size == 0`,
// the same render shape the canary path produces).
//
// We don't hit the `--canary` path with a mock: upgrade_command.rs hard-codes
// `https://github.com/oven-sh/bun/releases/download/canary/…`, so only the
// stable path respects `GITHUB_API_DOMAIN`. Using the stable path with
// `size` omitted gets us the same `[{Bi:.2}]` render shape regardless.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls } from "harness";

// Mirror bun's `Version::ZIP_FILENAME` — the stable upgrade loop rejects any
// asset whose name doesn't match this, so we have to produce the same string.
function triplet(): string {
  const arch = process.arch === "arm64" ? "aarch64" : "x64";
  const os =
    process.platform === "linux"
      ? "linux"
      : process.platform === "darwin"
        ? "darwin"
        : process.platform === "win32"
          ? "windows"
          : "unknown";
  return `bun-${os}-${arch}.zip`;
}

async function runUpgradeAgainstMock(opts: { zipSize: number; advertiseSize: boolean }) {
  const zipName = triplet();

  await using server = Bun.serve({
    port: 0,
    tls,
    async fetch(req) {
      const url = new URL(req.url);

      // `bun upgrade --stable` hits `Jarred-Sumner/bun-releases-for-updater`.
      if (url.pathname.endsWith("/releases/latest")) {
        const asset: Record<string, unknown> = {
          name: zipName,
          content_type: "application/zip",
          browser_download_url: `https://localhost:${server.port}/bun.zip`,
        };
        // Omitting `size` makes `version.size == 0` on the bun side, which
        // drives the one-sided `[{current}]` progress arm (same as canary).
        if (opts.advertiseSize) asset.size = opts.zipSize;
        return Response.json({
          tag_name: "bun-v99.0.0",
          name: "Bun v99.0.0",
          assets: [asset],
        });
      }

      if (url.pathname === "/bun.zip") {
        // Small chunks + a short sleep so Progress ticks through several
        // `Downloading [...]` lines (its refresh is rate-limited; one-shot
        // transfers produce no visible ticks).
        const CHUNK = 64 * 1024;
        const pad = new Uint8Array(CHUNK);
        const stream = new ReadableStream({
          async start(controller) {
            for (let off = 0; off < opts.zipSize; off += CHUNK) {
              const n = Math.min(CHUNK, opts.zipSize - off);
              controller.enqueue(n === CHUNK ? pad : pad.subarray(0, n));
              await Bun.sleep(15);
            }
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "application/zip",
            "content-length": String(opts.zipSize),
          },
        });
      }

      return new Response("not found", { status: 404 });
    },
  });

  // Confine upgrade side-effects (tmpdir for download + unzip) to a
  // throwaway directory.
  using scratch = tempDir("upgrade-30990", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), "upgrade", "--stable"],
    env: {
      ...bunEnv,
      GITHUB_API_DOMAIN: `localhost:${server.port}`,
      // Mock uses a self-signed cert; disable validation so the sync HTTP
      // client inside `bun upgrade` can connect.
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      // `bun upgrade` deliberately leaks its `cli_arena()` allocations (the
      // process is about to `execve` itself away), which ASAN happily
      // reports under `detect_leaks=1` and aborts the subprocess. Keep the
      // other options from CI's default so segv/coredump handling survives.
      ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=0",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      TMPDIR: String(scratch),
      TEMP: String(scratch),
      TMP: String(scratch),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [_stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return stderr;
}

test.skipIf(isWindows)(
  "bun upgrade [current/total] progress uses binary-bytes (MiB), not raw bytes (#30990)",
  async () => {
    // With `size` advertised, Progress renders `[current/total]` — both
    // sides go through the binary-bytes formatter.
    const stderr = await runUpgradeAgainstMock({ zipSize: 5 * 1024 * 1024, advertiseSize: true });

    const downloadingLines = stderr.split("\n").filter(l => l.includes("Downloading ["));
    expect(downloadingLines.length).toBeGreaterThan(0);

    // At least one `Downloading [...]` line must carry a binary IEC unit.
    // Exact numeric values are machine-dependent (Progress refresh is
    // rate-limited and chunk timing jitters), but the suffix is deterministic.
    const anyBinaryUnit = downloadingLines.some(l => /\[[\d.]+(MiB|KiB|GiB|B)\/[\d.]+(MiB|KiB|GiB|B)\]/.test(l));
    expect({ anyBinaryUnit, downloadingLines }).toEqual({ anyBinaryUnit: true, downloadingLines });

    // Broken shape: raw integer bytes `[<N>/5242880]` (5 × 1024²).
    const anyRawBytes = downloadingLines.some(l => /\[\d+\/5242880\]/.test(l));
    expect(anyRawBytes).toBe(false);
  },
);

test.skipIf(isWindows)("bun upgrade [current] progress (unknown size) uses binary-bytes (#30990)", async () => {
  // With `size` omitted, bun's `version.size == 0` and Progress takes the
  // `eti == 0 && completed_items != 0` branch — the one-sided `[current]`
  // arm. Same arm exercised by the canary upgrade path.
  const stderr = await runUpgradeAgainstMock({ zipSize: 5 * 1024 * 1024, advertiseSize: false });

  const downloadingLines = stderr.split("\n").filter(l => l.includes("Downloading ["));
  expect(downloadingLines.length).toBeGreaterThan(0);

  const anyBinaryUnit = downloadingLines.some(l => /\[[\d.]+(MiB|KiB|GiB|B)\]/.test(l));
  expect({ anyBinaryUnit, downloadingLines }).toEqual({ anyBinaryUnit: true, downloadingLines });

  // Broken shape: `[<many-digit-int>]` with no IEC suffix (e.g. `[3407873]`).
  // `[0B]` is fine — it's the new code printing zero.
  const anyRawBytes = downloadingLines.some(l => /\[\d{5,}\]/.test(l));
  expect(anyRawBytes).toBe(false);
});
