// Regression test: heap-use-after-free in the proxied-TLS read dispatch.
//
// When fetch() goes through an HTTP CONNECT proxy to an `https://` target and a
// response's final body byte and the TLS close_notify arrive in a single read,
// the inner-TLS `SSL_read` loop returns the body, then `SSL_ERROR_ZERO_RETURN`,
// inside one `SSLWrapper::handle_reading`. The body flush completes the request
// and frees the `HTTPClient`; the close callback that follows in the same
// dispatch then dereferenced the freed client (`ProxyTunnel::on_close`,
// src/http/ProxyTunnel.rs). The guard between the two callbacks only checked
// SSLWrapper state, not client liveness, and the completion's
// `wrapper.shutdown(true)` early-returned without setting `closed_notified`.
//
// The fixture forces the body+close_notify coalescing the bug needs and runs
// several sequential proxied fetches; under ASAN the use-after-free aborts the
// subprocess before it prints its success marker.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";

async function runFixture(mode: "ok" | "malformed") {
  await using proc = Bun.spawn({
    cmd: [bunExe(), import.meta.dir + "/fetch-proxy-tunnel-close-uaf-fixture.ts"],
    env: (() => {
      // Strip proxy env so the explicit loopback `proxy:` option is honored
      // (NO_PROXY commonly covers 127.0.0.1, which would bypass the tunnel).
      const e: Record<string, string | undefined> = { ...bunEnv };
      for (const k of ["NO_PROXY", "no_proxy", "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"]) {
        delete e[k];
      }
      e.UAF_CERT = tlsCert.cert;
      e.UAF_KEY = tlsCert.key;
      e.UAF_ITERS = "30";
      e.UAF_MODE = mode;
      return e;
    })(),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) console.error(`[${mode}] stderr:`, stderr, "stdout:", stdout);
  return { stdout, stderr, exitCode };
}

// A heap-use-after-free aborts the subprocess under ASAN; assert the markers are
// absent so an abort can never hide behind stdout handling.
function expectNoAsanAbort(stderr: string) {
  expect(stderr).not.toContain("AddressSanitizer");
  expect(stderr).not.toContain("heap-use-after-free");
  expect(stderr).not.toContain("ProxyTunnel");
}

// Before the fix the subprocess aborts with a heap-use-after-free in
// ProxyTunnel::on_close (typically within the first couple of iterations) and
// never prints the marker. Assert the exact resolved/rejected split so a
// proxy/TLS/setup failure cannot pass as the expected outcome. stdout is asserted
// before the exit code for a useful failure message.
test("fetch through a CONNECT proxy does not use-after-free on a coalesced response+close_notify", async () => {
  const { stdout, stderr, exitCode } = await runFixture("ok");
  expect(stdout).toContain("PROXY_TUNNEL_CLOSE_UAF connects=30 served=30 resolved=30 rejected=0 of 30");
  expectNoAsanAbort(stderr);
  expect(exitCode).toBe(0);
});

// A malformed response coalesced with close_notify must be delivered as a
// rejection, not swallowed/hung/UAF'd. This single-read variant errors in the
// ProxyHeaders stage (handle_on_data_headers -> fail), so it guards error
// delivery on a coalesced read but does not itself drive the body-stage
// close_from_callback -> close_raw teardown; that path needs two separated reads
// (no deterministic JS signal for the BodyChunk transition) and is verified
// out-of-test via the v1-vs-v2 differential noted in the PR.
test("a malformed proxied response coalesced with close_notify still rejects", async () => {
  const { stdout, stderr, exitCode } = await runFixture("malformed");
  expect(stdout).toContain("PROXY_TUNNEL_CLOSE_UAF connects=30 served=30 resolved=0 rejected=30 of 30");
  expectNoAsanAbort(stderr);
  expect(exitCode).toBe(0);
});
