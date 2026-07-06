// https.createServer is backed by Bun.serve (idleTimeout: 0), not node:tls's
// Server, so its handshakeTimeout option used to be dropped on the floor: a
// peer that connected over TCP and never started the TLS handshake was kept
// open indefinitely (a slowloris against the handshake). The watchdog now fires
// 'tlsClientError' with ERR_TLS_HANDSHAKE_TIMEOUT and closes the peer, while a
// real handshake within the window is left alone.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

test("https.createServer enforces handshakeTimeout", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "node-https-handshake-timeout-fixture.mjs")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const results = Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .filter(l => l.startsWith("RESULT "))
      .map(l => {
        const rest = l.slice("RESULT ".length);
        const sp = rest.indexOf(" ");
        return [rest.slice(0, sp), rest.slice(sp + 1)];
      }),
  );

  expect(results).toEqual({
    silent_code: "ERR_TLS_HANDSHAKE_TIMEOUT",
    live_body: "ok",
    live_client_error: "false",
    invalid_throw: "ERR_INVALID_ARG_TYPE",
  });
  expect(exitCode).toBe(0);
  // Debug+ASAN TLS accept is slow; the scenarios run in one process but each
  // handshake still takes seconds, so this needs headroom over the 5s default.
}, 30_000);
