/**
 * Regression test for the tunnel-mode HTTPClient leak in
 * WebSocketUpgradeClient.zig. The wss://-through-HTTP-proxy success path took
 * `outgoing_websocket` without dropping the cpp_websocket ref, so each
 * upgrade left an HTTPClient (~4KB struct including 128 PicoHTTP.Header
 * headers_buf) at refcount=1 forever. 500 upgrades ≈ 2MB+ of unreclaimable
 * RSS — well above the noise floor under --smol.
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

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    const { baseline, after, growth, iter } = JSON.parse(stdout.trim());
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
  },
  isDebug ? 120_000 : 60_000,
);
