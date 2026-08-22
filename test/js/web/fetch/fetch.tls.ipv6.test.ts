// Regression test for https://github.com/oven-sh/bun/issues/30668
//
// The URL parser keeps the surrounding `[`/`]` on IPv6 hostnames. That bracketed
// form must NOT leak into TLS certificate verification:
//   - strings::is_ip_address("[::1]") is false, so the native fast path would
//     take the DNS-name branch and skip the IP-SAN match on the cert.
//   - node:tls.checkServerIdentity uses net.isIP("[::1]") === 0 and likewise
//     falls through to CN matching and emits ERR_TLS_CERT_ALTNAME_INVALID.
//
// Node.js strips brackets in urlToHttpOptions before either verification path
// runs. get_tls_hostname in src/http/lib.rs now mirrors that contract so every
// TLS consumer (native cert check, SNI's is_ip_address check, and the
// user-supplied checkServerIdentity callback) sees the bare address `::1`.
//
// This test lives in its own file rather than fetch.tls.test.ts because the
// subprocess approach is sensitive to environment setup (HTTP_PROXY,
// NO_PROXY) and we want a clean top-level env rather than sharing one with
// other concurrent tests in that file.

import { expect, it } from "bun:test";
import { bunEnv, bunExe, isIPv6, tls as validTls } from "harness";

// Skipped on Buildkite Linux — those AWS instances don't have IPv6 set up
// (see `isIPv6` in harness.ts). Matches the gating pattern already used by
// the directly analogous valkey-tls-verify.test.ts:177.
it.skipIf(!isIPv6())("fetch with IPv6 literal hostname verifies the certificate", async () => {
  using server = Bun.serve({
    port: 0,
    tls: validTls,
    fetch() {
      return new Response("Hello World");
    },
  });
  const port = server.port;

  // Drop HTTP_PROXY/HTTPS_PROXY so the container-level egress proxy doesn't
  // intercept a request to [::1] (NO_PROXY doesn't match the bracketed form
  // in some fetch paths).
  const { HTTP_PROXY, HTTPS_PROXY, http_proxy, https_proxy, ...cleanEnv } = bunEnv;
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const tls = require("node:tls");
        const cert = ${JSON.stringify(validTls.cert)};
        const url = "https://[::1]:${port}/";
        // Native fast path — no user-supplied checkServerIdentity. Native
        // check_x509_server_identity must see "::1" (not "[::1]") so that
        // strings::is_ip_address() picks the IP-SAN branch.
        {
          const res = await fetch(url, {
            keepalive: false,
            tls: { ca: cert, rejectUnauthorized: true },
          });
          console.log("native:", await res.text());
        }
        // User-supplied checkServerIdentity path — the hostname handed to
        // the callback must be bracket-stripped so that
        // node:tls.checkServerIdentity (net.isIP) accepts it, matching
        // Node.js's urlToHttpOptions behavior.
        {
          let observed;
          const res = await fetch(url, {
            keepalive: false,
            tls: {
              ca: cert,
              rejectUnauthorized: true,
              checkServerIdentity(hostname, cert) {
                observed = hostname;
                return tls.checkServerIdentity(hostname, cert);
              },
            },
          });
          console.log("callback hostname:", observed);
          console.log("js:", await res.text());
        }
      `,
    ],
    env: cleanEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Asserting stdout/stderr before exitCode produces a more useful failure
  // message when the subprocess crashes unexpectedly.
  expect(stdout).toBe("native: Hello World\ncallback hostname: ::1\njs: Hello World\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
