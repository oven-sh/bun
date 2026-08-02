import { dnsSdReplay } from "bun:internal-for-testing";
import { expect, jest, test } from "bun:test";
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

// NXDOMAIN and multi-record lookups interleaved on one connection: a negative reply can carry MoreComing for a sibling's answer.
test.skipIf(!isMacOS)("interleaved NXDOMAIN and multi-record lookups all settle", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { lookup } = require("dns").promises;
        const base = "www.example.com";
        const nxProbe = await lookup("nx-probe-" + Math.random().toString(36).slice(2) + ".example").then(() => "resolved", e => e.code);
        if (nxProbe !== "ENOTFOUND" || !(await lookup(base, { all: true }).catch(() => null))) { console.log(JSON.stringify({ skipped: true, nxProbe })); process.exit(0); }
        const letters = [...base].flatMap((c, k) => (c === "." ? [] : [k]));
        const spell = i => [...base].map((c, k) => ((i >> letters.indexOf(k)) & 1 && c !== "." ? c.toUpperCase() : c)).join("");
        let nx = 0, ok = 0, other = [];
        for (let round = 0; round < 4; round++) {
          const tag = Math.random().toString(36).slice(2);
          const batch = [];
          for (let i = 0; i < 30; i++) {
            batch.push(lookup("nx-" + tag + "-" + i + ".example").then(() => other.push("nx resolved"), e => (e.code === "ENOTFOUND" ? nx++ : other.push(e.code))));
            batch.push(lookup(spell(round * 30 + i), { all: true }).then(r => (r.length ? ok++ : other.push("empty")), e => other.push(e.code)));
          }
          await Promise.all(batch);
        }
        console.log(JSON.stringify({ nx, ok, other }));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const result = JSON.parse(stdout.trim().split("\n").pop()!);
  if (!result.skipped) expect(result).toEqual({ nx: 120, ok: 120, other: [] });
  expect(exitCode).toBe(0);
});

// Deterministic QueryState checks via synthetic replies (mask 1=v4, 2=v6, 3=both; "family:add|nsr|timeout[:more]").
test.skipIf(!isMacOS)("dns_sd query state: readiness and early-out coverage", () => {
  const both = 3;
  expect(dnsSdReplay(both, ["4:add", "6:nsr"])).toEqual({ ready: true, hasDeadline: false, results: 1 });
  expect(dnsSdReplay(both, ["4:add", "6:add"])).toEqual({ ready: true, hasDeadline: false, results: 2 });
  expect(dnsSdReplay(both, ["4:nsr", "6:nsr"])).toEqual({ ready: true, hasDeadline: false, results: 0 });
  // One family answered, the other silent: not ready, but the second-family bound is armed.
  expect(dnsSdReplay(both, ["4:add"])).toEqual({ ready: false, hasDeadline: true, results: 1 });
  // Nothing in hand and a family genuinely pending: keep waiting on the daemon, no early-out.
  expect(dnsSdReplay(both, ["4:nsr"])).toEqual({ ready: false, hasDeadline: false, results: 0 });
  // Every family reported but the last reply carried MoreComing (possibly for a dead sibling): bounded, with results...
  expect(dnsSdReplay(both, ["4:add", "6:add:more"])).toEqual({ ready: false, hasDeadline: true, results: 2 });
  // ...and without (NXDOMAIN whose final reply carries an orphaned MoreComing must not hang on the keep-alive).
  expect(dnsSdReplay(both, ["4:nsr", "6:nsr:more"])).toEqual({ ready: false, hasDeadline: true, results: 0 });
  // A later reply for the same query clears MoreComing.
  expect(dnsSdReplay(both, ["4:add:more", "6:nsr"])).toEqual({ ready: true, hasDeadline: false, results: 1 });
  expect(dnsSdReplay(1, ["4:timeout"])).toEqual({ ready: true, hasDeadline: false, results: 0 });
  // An early-out give-up followed by the unsuppressed reissue starts fresh: not ready until its own replies arrive.
  expect(dnsSdReplay(both, ["4:nsr", "6:nsr:more", "giveup", "retry"])).toEqual({
    ready: false,
    hasDeadline: false,
    results: 0,
  });
  expect(dnsSdReplay(both, ["4:nsr", "6:nsr:more", "giveup", "retry", "6:add", "4:nsr"])).toEqual({
    ready: true,
    hasDeadline: false,
    results: 1,
  });
});

// The early-out timer is exempt from fake timers, so it must read real time too; a mocked clock would arm it in the past and spin.
test.skipIf(!isMacOS)("lookups complete under jest.useFakeTimers()", async () => {
  jest.useFakeTimers();
  try {
    const results = await Promise.all([
      dns.promises.lookup("localhost", { all: true }),
      dns.promises.lookup("www.example.com", { all: true }).catch(e => e.code),
      dns.promises.lookup("nx-" + Math.random().toString(36).slice(2) + ".example").catch(e => e.code),
    ]);
    expect(results[0]).toEqual(expect.arrayContaining([{ address: "127.0.0.1", family: 4 }]));
    expect(Array.isArray(results[1]) || typeof results[1] === "string").toBe(true);
    expect(typeof results[2]).toBe("string");
  } finally {
    jest.useRealTimers();
  }
});
