// `/` and `*` are in c-ares's record-name charset, so without a query-side check a
// lookup for `evil.tld/path` or `a*b.tld` becomes a real QNAME on the wire (and,
// if it resolves, a connection with that string as the Host header). glibc
// getaddrinfo and Node refuse such names locally; Bun must too, on every backend.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";

// Subprocess because dns.setServers() is process-global.
test.skipIf(isWindows)("lookup rejects '/' and '*' in a hostname before any packet is sent", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "lookup-invalid-hostname-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stderr, exitCode }).toMatchObject({ exitCode: 0 });
  expect(JSON.parse(stdout.trim())).toEqual({
    cares: {
      "leak-a.invalid/x": "DNS_ENOTFOUND",
      "leak-b*c.invalid": "DNS_ENOTFOUND",
      "*.leak-c.invalid": "DNS_ENOTFOUND",
    },
    node: {
      "leak-a.invalid/x": "ENOTFOUND",
      "leak-b*c.invalid": "ENOTFOUND",
      "*.leak-c.invalid": "ENOTFOUND",
    },
    httpGet: "ENOTFOUND",
    originHits: 0,
    control: "127.0.0.1",
    // Only the control name reached the stub resolver.
    qnames: ["ok_name.invalid"],
  });
});
