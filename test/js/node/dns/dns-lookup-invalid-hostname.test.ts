// dns.lookup must reject hostnames containing ASCII bytes outside
// `[A-Za-z0-9._-]` locally (ENOTFOUND) so the raw string never becomes a wire
// QNAME or Host header. glibc getaddrinfo enforces this; c-ares on its own
// accepts `/` and `*` (record-name charset) so Bun has to guard the query side.
//
// Runs in a subprocess because dns.setServers is process-global. Linux-only:
// dns.setServers rebinds the c-ares channel, and c-ares is the dns.lookup
// backend only on Linux; on macOS/Windows the system getaddrinfo already
// rejects these characters and the stub harness cannot intercept it.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import { join } from "node:path";

test.skipIf(!isLinux)("dns.lookup rejects '/' '*' and other non-LDH hostname chars without sending a packet", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "dns-lookup-invalid-hostname-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr.trim()).toBe("");
  const out = JSON.parse(stdout.trim());

  // Every invalid hostname errored locally; none reached the stub resolver.
  expect(out.lookupCodes).toEqual({
    "leak-a.invalid/x": "ENOTFOUND",
    "leak-b*c.invalid": "ENOTFOUND",
    "a b.invalid": "ENOTFOUND",
    "a@b.invalid": "ENOTFOUND",
    "a#b.invalid": "ENOTFOUND",
    "a:b.invalid": "ENOTFOUND",
    "a+b.invalid": "ENOTFOUND",
  });
  expect(out.promiseCode).toBe("ENOTFOUND");
  expect(out.httpCode).toBe("ENOTFOUND");
  expect(out.originHits).toBe(0);

  // The control name with an underscore resolved via the stub, proving the
  // stub is wired up and the valid-charset path is untouched.
  expect(out.underscore).toEqual({ err: null, address: "127.0.0.1" });

  // Numeric literals still resolve (IPv6 contains ':' and must be exempted).
  expect(out.v4).toEqual({ err: null, address: "127.0.0.1" });
  expect(out.v6).toEqual({ err: null, address: "::1" });

  // The stub saw only the valid underscore query (A + optional AAAA); none of
  // the invalid names appear.
  const unique = [...new Set(out.qnames)];
  expect(unique).toEqual(["ok_name.invalid"]);

  expect(exitCode).toBe(0);
});
