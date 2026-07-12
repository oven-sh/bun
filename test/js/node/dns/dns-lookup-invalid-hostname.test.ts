// dns.lookup must reject ASCII bytes outside `[A-Za-z0-9._-]` locally with
// ENOTFOUND so `/` and `*` (which c-ares accepts as record-name chars) never
// become a wire QNAME or Host header; glibc getaddrinfo already does this.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import { join } from "node:path";

// Subprocess (dns.setServers is process-global); Linux-only because c-ares is
// the dns.lookup backend only there so the stub can intercept the query.
test.skipIf(!isLinux)(
  "dns.lookup rejects '/' '*' and other non-LDH hostname chars without sending a packet",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "dns-lookup-invalid-hostname-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Surface stderr alongside exitCode if the fixture crashed; stderr is not
    // itself required to be empty (debug builds may emit benign noise).
    expect({ stderr, exitCode }).toMatchObject({ exitCode: 0 });
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
    // Scoped IPv6 (`fe80::1%lo`) via the system backend still resolves.
    expect(out.v6scopedErr).toBeNull();

    // The stub saw only the valid underscore query (A + optional AAAA); none of
    // the invalid names appear.
    const unique = [...new Set(out.qnames)];
    expect(unique).toEqual(["ok_name.invalid"]);
  },
);
