import { expect, test } from "bun:test";
import dns from "dns";
import { bunEnv, bunExe, isMacOS } from "harness";

// libinfo parks one libdispatch worker per in-flight lookup; the dns_sd backend must not (peak ≈ baseline, not +N).

test.skipIf(!isMacOS)("many concurrent dns.lookup() do not spawn a thread per lookup on macOS", async () => {
  const N = 200;

  // Child samples its own thread count (ps -M) while N distinct .invalid lookups are in flight.
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
    // Sample until every lookup settles; workers appear within ms, well before replies.
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

  // libinfo: peak ≈ baseline+N (≈210); dns_sd: baseline + a handful. 60 splits the regimes.
  expect(peak).toBeLessThan(baseline + 60);
  expect(exitCode).toBe(0);
});

// Answer sets arrive as separate replies over one shared connection; N distinct-case lookups must all agree (real names, like node-dns.test.js).
test.skipIf(!isMacOS)("concurrent lookups return complete answer sets", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { lookup } = require("dns").promises;
        const N = 400;
        for (const base of ["www.example.com", "google.com"]) {
          // No resolver (offline/sandboxed agent): nothing to assert against.
          if (!(await lookup(base, { all: true }).catch(() => null))) { console.log(JSON.stringify({ base, skipped: true })); continue; }
          const letters = [...base].flatMap((c, k) => (c === "." ? [] : [k])); // bit j flips the j-th letter, never a dot
          const names = Array.from({ length: N }, (_, i) =>
            [...base].map((c, k) => ((i >> letters.indexOf(k)) & 1 && c !== "." ? c.toUpperCase() : c)).join(""),
          );
          if (new Set(names).size !== N) throw new Error("expected " + N + " distinct spellings");
          const results = await Promise.all(names.map(n => lookup(n, { all: true })));
          const shapes = new Set(results.map(r => r.map(a => a.family + " " + a.address).sort().join(",")));
          console.log(JSON.stringify({ base, distinct: shapes.size, records: results[0].length }));
        }
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const lines = stdout
    .trim()
    .split("\n")
    .map(l => JSON.parse(l));
  for (const l of lines) if (!l.skipped) expect(l).toEqual({ base: l.base, distinct: 1, records: expect.any(Number) });
  expect(exitCode).toBe(0);
});

// Literals, scoped IPv6 and hint bits dns_sd can't express must keep routing to getaddrinfo.
test.skipIf(!isMacOS)("literals, scoped IPv6 and hints stay on getaddrinfo", async () => {
  const results = await Promise.all([
    dns.promises.lookup("::1"),
    dns.promises.lookup("127.1"),
    dns.promises.lookup("0x7f000001"),
    dns.promises.lookup("fe80::1%lo0"),
    dns.promises.lookup("localhost", { family: 6, hints: dns.V4MAPPED }),
  ]);
  expect(results).toEqual([
    { address: "::1", family: 6 },
    { address: "127.0.0.1", family: 4 },
    { address: "127.0.0.1", family: 4 },
    { address: "fe80::1%lo0", family: 6 },
    { address: "::1", family: 6 },
  ]);
});
