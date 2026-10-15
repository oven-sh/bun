// Regression test for the WebSocket side of
// https://github.com/oven-sh/bun/issues/30668: the client stored the
// bracketed URL host ("[::1]"), so check_server_identity took the DNS-name
// branch and never matched the cert's IP SAN, and the SNI is_ip_address gate
// sent the bracketed literal as servername. The hostname is now stored
// bracket-stripped (WebSocketUpgradeClient.rs, WebSocketProxyTunnel.rs).
//
// A standalone file for this single TLS-verification concern, following the
// fetch.tls.ipv6.test.ts precedent.

import { expect, it } from "bun:test";
import { bunEnv, bunExe, isIPv6, tls as validTls } from "harness";

// Skipped on Buildkite Linux — those AWS instances don't have IPv6 set up
// (see `isIPv6` in harness.ts).
it.skipIf(!isIPv6())("wss to an IPv6 literal verifies the certificate", async () => {
  using server = Bun.serve({
    port: 0,
    hostname: "::1",
    tls: validTls,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("Upgrade failed", { status: 500 });
    },
    websocket: {
      open(ws) {
        ws.send("hello");
      },
      message() {},
    },
  });
  const port = server.port;

  // Subprocess so proxy env vars can't reroute the wss connection.
  const cleanEnv = {
    ...bunEnv,
    HTTP_PROXY: undefined,
    HTTPS_PROXY: undefined,
    http_proxy: undefined,
    https_proxy: undefined,
  };
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const cert = ${JSON.stringify(validTls.cert)};
        const ws = new WebSocket("wss://[::1]:${port}/", {
          tls: { ca: cert, rejectUnauthorized: true },
        });
        const { promise, resolve, reject } = Promise.withResolvers();
        ws.onmessage = e => resolve(e.data);
        ws.onclose = e => reject(new Error("closed: " + e.code + " " + e.reason));
        console.log("message:", await promise);
        ws.close();
      `,
    ],
    env: cleanEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("message: hello\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
