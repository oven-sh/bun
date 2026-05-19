// Regression: ProxyTunnel SSLWrapper callbacks firing with a freed
// *HTTPClient after the request completed inside the same handleReading().
//
// SSLWrapper.handleReading → triggerDataCallback → ProxyTunnel.onData →
// progressUpdate → onAsyncHTTPCallback frees the ThreadlocalAsyncHTTP
// (and the embedded HTTPClient) synchronously. If the same handleReading
// then hits SSL_ERROR_SSL, triggerCloseCallback → onClose dereferences the
// freed pointer. The proxy in the fixture appends a malformed TLS record
// right after the HTTP-response record so both land in one BIO fill.
//
// Under debug+ASAN the pre-fix binary aborts with use-after-poison at
// ProxyTunnel.onClose. Release builds read poisoned memory without
// trapping, so this test is only meaningful on sanitizer builds.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";
import { join } from "node:path";

test("ProxyTunnel onClose does not use freed HTTPClient after response completes", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fetch-proxy-tunnel-onclose-uaf-fixture.ts")],
    env: {
      ...bunEnv,
      TLS_CERT: tlsCert.cert,
      TLS_KEY: tlsCert.key,
      // bunEnv sets NO_PROXY=localhost,127.0.0.1,... which makes fetch
      // bypass the explicit `proxy:` option for our 127.0.0.1 target.
      NO_PROXY: "",
      no_proxy: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    console.error("Fixture stderr:", stderr);
  }
  expect(exitCode).toBe(0);

  const lastLine = stdout.trim().split("\n").pop()!;
  const result = JSON.parse(lastLine);
  expect(result.ok).toBeGreaterThan(0);
}, 30_000);
