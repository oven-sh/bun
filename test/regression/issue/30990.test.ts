// Regression test for https://github.com/oven-sh/bun/issues/30990
// `bun upgrade` download progress must render binary bytes (`KiB`/`MiB`/`GiB`)
// rather than raw integer bytes — matching the Zig `{Bi:.2}` output that the
// original implementation produced.
//
// We stand up a TLS server impersonating `api.github.com` via `GITHUB_API_DOMAIN`,
// point `browser_download_url` at the same server so the download streams back
// through us, and assert that `Downloading [...]` lines in stderr contain
// binary-IEC units (e.g. `1.50MiB`) — both in the two-sided
// `[current/total]` form (stable path, non-zero `size`) and the one-sided
// `[current]` form (canary path, `size == 0`).
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls } from "harness";

// The expected `bun-<platform>.zip` filename in the mock release's asset list.
// Built from bun's own triplet detection so the test works on whatever host ran it.
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

async function runUpgradeAgainstMock(opts: { stable: boolean; zipSize: number }) {
  const zipName = triplet();

  await using server = Bun.serve({
    port: 0,
    tls,
    async fetch(req) {
      const url = new URL(req.url);

      // `bun upgrade` stable path hits the Jarred-Sumner/bun-releases-for-updater repo.
      if (url.pathname.endsWith("/releases/latest")) {
        return Response.json({
          tag_name: "bun-v99.0.0",
          name: "Bun v99.0.0",
          assets: [
            {
              name: zipName,
              content_type: "application/zip",
              browser_download_url: `https://localhost:${server.port}/bun.zip`,
              size: opts.zipSize,
            },
          ],
        });
      }

      if (url.pathname === "/bun.zip") {
        // Stream garbage bytes with small chunks and a sleep so progress has
        // time to tick through several `Downloading [...]` lines.
        const CHUNK = 64 * 1024;
        const pad = new Uint8Array(CHUNK);
        const stream = new ReadableStream({
          async start(controller) {
            for (let off = 0; off < opts.zipSize; off += CHUNK) {
              const n = Math.min(CHUNK, opts.zipSize - off);
              controller.enqueue(n === CHUNK ? pad : pad.subarray(0, n));
              await Bun.sleep(10);
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

  // Confine bun's upgrade side-effects (tmpdir, installation path) to a
  // throwaway directory so if zip-extraction somehow succeeds it can't touch
  // the running bun.
  using scratch = tempDir("upgrade-30990", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), "upgrade", ...(opts.stable ? ["--stable"] : ["--canary"])],
    env: {
      ...bunEnv,
      GITHUB_API_DOMAIN: `localhost:${server.port}`,
      // Our mock server uses a self-signed cert; disable validation so the
      // sync HTTP client inside `bun upgrade` can connect.
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      // Force non-colored output — we match on literal strings.
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

test.concurrent.skipIf(isWindows)("bun upgrade shows binary-bytes progress (MiB), not raw bytes (#30990)", async () => {
  // --stable gets a known size from the mock API, so both sides of
  // `[current/total]` exercise the binary-bytes formatter.
  const stderr = await runUpgradeAgainstMock({ stable: true, zipSize: 5 * 1024 * 1024 });

  const downloadingLines = stderr.split("\n").filter(l => l.includes("Downloading ["));
  expect(downloadingLines.length).toBeGreaterThan(0);

  // At least one `Downloading [...]` line must mention a binary IEC unit.
  // We don't pin an exact numeric value — timing of progress ticks is
  // machine-dependent — but the formatter output always ends in `MiB` (or
  // `KiB`/`B`) when the stable download completes.
  const anyBinaryUnit = downloadingLines.some(l => /\[[\d.]+(MiB|KiB|GiB|B)\/[\d.]+(MiB|KiB|GiB|B)\]/.test(l));
  expect({ anyBinaryUnit, downloadingLines }).toEqual({ anyBinaryUnit: true, downloadingLines });

  // And crucially: the broken output shape (raw integer bytes
  // `[<current-int>/<total-int>]`) must not appear. `5242880` = 5 × 1024².
  const anyRawBytes = downloadingLines.some(l => /\[\d+\/5242880\]/.test(l));
  expect(anyRawBytes).toBe(false);
});

test.concurrent.skipIf(isWindows)("bun upgrade --canary progress uses binary-bytes (#30990)", async () => {
  // Canary path: `size` isn't known up-front, so progress renders only
  // `[current]`. `Unit::Bytes` still applies — the one-sided arm must also
  // format through the binary-bytes helper.
  const stderr = await runUpgradeAgainstMock({ stable: false, zipSize: 5 * 1024 * 1024 });

  const downloadingLines = stderr.split("\n").filter(l => l.includes("Downloading ["));
  expect(downloadingLines.length).toBeGreaterThan(0);

  const anyBinaryUnit = downloadingLines.some(l => /\[[\d.]+(MiB|KiB|GiB|B)\]/.test(l));
  expect({ anyBinaryUnit, downloadingLines }).toEqual({ anyBinaryUnit: true, downloadingLines });

  // The broken shape is `[<large-int>]` with no suffix — e.g. `[3407873]`.
  // Strings like `[0B]` are fine (new code); we only care about the raw
  // many-digit integer without any unit suffix.
  const anyRawBytes = downloadingLines.some(l => /\[\d{5,}\]/.test(l));
  expect(anyRawBytes).toBe(false);
});
