import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun } from "harness";
import { join } from "path";

test.concurrent("expect dns.lookup to keep the process alive", async () => {
  expect(await bunRun(join(import.meta.dir, "dns-fixture.js"))).toSpawn();
});

// When the last outstanding query on a Resolver completes via the retransmit
// timer (c-ares timeout, not socket I/O), `check_timeouts` must not leave the
// timer re-armed: `request_completed` runs inside the c-ares callback, before
// c-ares has detached the query, so `any_requests_pending()` can still read
// true there. Without the post-`ares_process_fd` re-check the timer stays
// ACTIVE with its `+1` ref on the native Resolver. Observable as a ~1 s tail
// between the last callback and process exit; under `bun test` on the asan
// lane the exit GC runs before that timer fires and LSan flags the Resolver
// allocation as a direct leak.
describe("dns.Resolver does not keep the event loop alive after the last query times out", () => {
  async function run(stmt: string) {
    const src = `
      const dns = require("node:dns");
      const dgram = require("node:dgram");
      const sock = dgram.createSocket("udp4");
      sock.bind(0, "127.0.0.1", () => {
        const r = new dns.Resolver({ timeout: 100, tries: 1 });
        r.setServers(["127.0.0.1:" + sock.address().port]);
        let cb_t, code;
        const done = err => { cb_t = Date.now(); code = err && err.code; sock.close(); };
        ${stmt}
        process.on("exit", () => {
          console.log(JSON.stringify({ delay: Date.now() - cb_t, code }));
        });
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

  for (const [name, stmt, expected] of [
    ["resolveCaa", `r.resolveCaa("x.invalid", done);`, "ETIMEOUT"],
    ["resolve4", `r.resolve4("x.invalid", done);`, "ETIMEOUT"],
    // ares_gethostbyaddr swallows the PTR query status and reports ENOTFOUND
    // after the file-lookup fallback; the PTR query itself still completes
    // via the retransmit timer.
    ["reverse", `r.reverse("192.0.2.1", done);`, "ENOTFOUND"],
  ] as const) {
    test.concurrent(name, async () => {
      const { delay, code } = await run(stmt);
      // ETIMEOUT proves completion routed through `check_timeouts`
      // (the path changed here), not `on_dns_poll`.
      expect(code).toBe(expected);
      // Before the fix: delay ≈ 1000 ms (one retransmit-timer interval).
      expect(delay).toBeLessThan(500);
    });
  }
});
