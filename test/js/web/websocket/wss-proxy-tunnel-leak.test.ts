/**
 * Regression test for the wss://-through-HTTP-proxy tunnel leak in
 * WebSocketProxyTunnel.zig: shutdown() only sent TLS close_notify and never
 * closed the underlying socket, so the upgrade client's handleClose never
 * fired, proxy.deinit never ran, and the tunnel + per-connection SSL_CTX +
 * upgrade client all leaked (~2.5MB per connection). After the fix the socket
 * closes on shutdown and the tunnel reaches refcount=0.
 */
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
import { join } from "node:path";

test(
  "wss-via-http-proxy upgrade does not leak the HTTPClient",
  async () => {
    const ITER = isDebug ? 200 : 500;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", join(import.meta.dirname, "wss-proxy-tunnel-leak-fixture.ts")],
      env: { ...bunEnv, LEAK_ITER: String(ITER), LEAK_WARMUP: "60" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    let parsed: { baseline: number; after: number; growth: number; iter: number };
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      throw new Error(`fixture did not emit JSON (exit ${exitCode}): stdout=${stdout} stderr=${stderr}`);
    }
    const { baseline, after, growth, iter } = parsed;
    expect(iter).toBe(ITER);

    // Without the fix, the upgrade client + tunnel + SSLWrapper never free
    // and growth is ~2.5MB/iter. With the fix the tunnel reaches refcount=0;
    // a residual ~1MB/iter remains (per-connection SSL_CTX cost — separate
    // from this leak). Threshold sits between the two so the test fails
    // before the fix and passes after.
    const threshold = iter * 1536 * 1024;
    if (growth >= threshold) {
      throw new Error(
        `RSS grew ${growth} bytes (${(growth / iter).toFixed(0)} B/iter) over ${iter} wss-via-proxy upgrades ` +
          `(baseline=${baseline}, after=${after}, threshold=${threshold})`,
      );
    }
    expect(exitCode).toBe(0);
  },
  isDebug ? 120_000 : 60_000,
);
