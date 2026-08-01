import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS } from "harness";

// On macOS, libinfo's getaddrinfo_async_start dispatches each lookup onto the
// libdispatch overcommit root queue, so N distinct in-flight lookups park N
// worker threads in-process. The DNSServiceGetAddrInfo backend multiplexes
// every lookup over one shared mDNSResponder connection, so thread count is
// independent of in-flight count.
//
// Fail-before (libinfo backend): 200 concurrent distinct-hostname lookups
// spawns ~200 libdispatch workers (peak threads ≈ 210).
// Pass-after (dns_sd backend): peak stays near baseline.

test.skipIf(!isMacOS)("many concurrent dns.lookup() do not spawn a thread per lookup on macOS", async () => {
  const N = 200;

  // The child reports its own thread count via `ps -M <pid>` while all N
  // lookups are in flight. Distinct .invalid hostnames defeat same-host
  // coalescing and are guaranteed NXDOMAIN (RFC 6761), so the promises stay
  // pending (threads parked under libinfo) until the resolver answers.
  const script = `
    const dns = require("dns").promises;
    const { execSync } = require("child_process");
    const N = ${N};

    function threadCount() {
      const out = execSync("ps -M " + process.pid, { encoding: "utf8" });
      return out.split("\\n").filter(l => l.trim().length > 0).length - 1;
    }

    const baseline = threadCount();
    const tag = Math.random().toString(36).slice(2);
    const settled = new Int32Array(1);
    const lookups = [];
    for (let i = 0; i < N; i++) {
      lookups.push(
        dns
          .lookup("bun-dns-thread-" + tag + "-" + i + ".invalid")
          .catch(() => {})
          .finally(() => Atomics.add(settled, 0, 1)),
      );
    }
    // Sample until every lookup has settled; libdispatch workers appear within
    // a few ms, so the peak is captured well before the NXDOMAIN replies land.
    let peak = baseline;
    while (Atomics.load(settled, 0) < N) {
      const t = threadCount();
      if (t > peak) peak = t;
      await new Promise(r => setImmediate(r));
    }
    await Promise.all(lookups);
    console.log(JSON.stringify({ baseline, peak, N }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_DNS_CACHE: "1" },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const line = stdout.trim().split("\n").pop()!;
  const { baseline, peak } = JSON.parse(line);

  // Before this change: peak ≈ baseline + N (≈210). After: peak ≈ baseline
  // plus a handful for the `ps` child and runtime pool. 60 is comfortably
  // between the two regimes across debug/release.
  expect(peak).toBeLessThan(baseline + 60);
  expect(exitCode).toBe(0);
});

// All lookups share one mDNSResponder connection, and a request's answer set
// arrives as separate replies (one per address). Under enough concurrency the
// daemon interleaves and pauses those writes, so completing on "each family
// reported once" truncates multi-record answers. localhost is a 2-record
// answer set (::1 + 127.0.0.1) served from /etc/hosts, so this needs no
// network; distinct-case spellings defeat same-name coalescing so every one of
// the N lookups is its own query on the wire.
test.skipIf(!isMacOS)("concurrent lookups return complete answer sets", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { lookup } = require("dns").promises;
        const N = 400;
        const base = "localhost";
        const names = Array.from({ length: N }, (_, i) =>
          [...base].map((c, j) => ((i >> j) & 1 ? c.toUpperCase() : c)).join(""),
        );
        const results = await Promise.all(names.map(n => lookup(n, { all: true })));
        const shapes = new Set(results.map(r => r.map(a => a.family + " " + a.address).sort().join(",")));
        console.log(JSON.stringify([...shapes]));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim().split("\n").pop()!)).toEqual(["4 127.0.0.1,6 ::1"]);
  expect(exitCode).toBe(0);
});
