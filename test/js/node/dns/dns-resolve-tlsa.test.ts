import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import { join } from "node:path";
import util from "node:util";

// https://github.com/oven-sh/bun/issues/6581
// TLSA record support was added to Node.js in v22.15.0 / v23.9.0.

test("dns.resolveTlsa is exposed everywhere node:dns exposes it", () => {
  expect(typeof dns.resolveTlsa).toBe("function");
  expect(typeof dns.promises.resolveTlsa).toBe("function");
  expect(typeof dnsPromises.resolveTlsa).toBe("function");
  expect(typeof dns.Resolver.prototype.resolveTlsa).toBe("function");
  expect(typeof dns.promises.Resolver.prototype.resolveTlsa).toBe("function");

  // util.promisify(dns.resolveTlsa) uses the promises implementation.
  expect(dns.resolveTlsa[util.promisify.custom]).toBe(dns.promises.resolveTlsa);
});

test("dns.resolveTlsa error carries syscall=queryTlsa and a translated code", async () => {
  // A >255-byte label is rejected by c-ares before any network I/O.
  let err: any;
  try {
    await dns.promises.resolveTlsa(Buffer.alloc(300, "a").toString());
  } catch (e) {
    err = e;
  }
  expect(err).toBeDefined();
  expect(err.syscall).toBe("queryTlsa");
  expect(err.code).not.toStartWith("DNS_");
});

// The mock-server round-trip runs in a subprocess: a `new dns.Resolver()` native
// backing is only freed at GC finalization, which can race process exit under
// LSan. Matching the sibling dns-*-fixture.ts tests in this directory.
test("resolveTlsa / resolve(name,'TLSA') / resolveAny parse TLSA answers from a local server", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "dns-resolve-tlsa-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr.trim()).toBe("");
  const out = JSON.parse(stdout.trim());

  const certHex = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const rec = { certUsage: 3, selector: 1, match: 1, data: certHex, dataIsArrayBuffer: true };
  expect(out).toEqual({
    byMethod: [rec],
    byRrtype: [rec],
    byAny: [{ ...rec, type: "TLSA" }],
  });
  expect(exitCode).toBe(0);
});
