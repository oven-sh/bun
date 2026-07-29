import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

test("expect dns.lookup to keep the process alive", () => {
  expect([join(import.meta.dir, "dns-fixture.js")]).toRun();
});

// c-ares rejects some inputs client-side (no wire query) and invokes the
// completion callback synchronously inside the dispatch call. Before the fix,
// `Resolver::request_sent()` ran *after* dispatch, so the synchronous
// `request_completed()` was a no-op and the retransmit timer (1 s, +1 ref on
// the native Resolver) was left armed with nothing pending. Observable as a
// ~1 s exit delay; under LSAN with an early exit, as a ~25 KB leak of the
// Resolver allocation.
describe("dns.Resolver does not keep the event loop alive after a synchronously-rejected query", () => {
  async function run(stmt: string) {
    const src = `
      const dns = require("node:dns");
      const r = new dns.Resolver();
      r.setServers(["127.0.0.1:1"]);
      let cb_t, code;
      const cb = err => { cb_t = Date.now(); code = err && err.code; };
      ${stmt}
      process.on("exit", () => {
        console.log(JSON.stringify({ delay: Date.now() - cb_t, code }));
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return JSON.parse(stdout.trim()) as { delay: number; code: string };
  }

  test.concurrent("resolve4 with a malformed hostname (ARES_EBADNAME)", async () => {
    // "a..b" has an empty interior label; c-ares rejects it before sending.
    const { delay, code } = await run(`r.resolve4("a..b", cb);`);
    expect(typeof code).toBe("string");
    // Before the fix: delay ≈ 1000 ms (the retransmit timer interval).
    expect(delay).toBeLessThan(500);
  });

  test.concurrent("reverse with an unparseable address (ARES_ENOTIMP)", async () => {
    const { delay, code } = await run(`r.reverse("not-an-ip", cb);`);
    expect(typeof code).toBe("string");
    expect(delay).toBeLessThan(500);
  });

  test.concurrent("Bun.dns.lookup backend=c-ares with a .onion name (ARES_ENOTFOUND)", async () => {
    // ares_getaddrinfo refuses .onion (RFC 7686) before sending; this covers
    // the global resolver's `c_ares_lookup_with_normalized_name` entry point.
    const { delay, code } = await run(`Bun.dns.lookup("example.onion", { backend: "c-ares" }).catch(cb);`);
    expect(typeof code).toBe("string");
    expect(delay).toBeLessThan(500);
  });
});
