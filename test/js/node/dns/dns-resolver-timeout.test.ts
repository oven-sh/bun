// Before the fix, Resolver drove c-ares from a fixed 1-second repeating timer,
// so every sub-second `timeout` option was quantized up to ~1 s and c-ares's
// own retransmission schedule was deferred to the next 1 s tick. The fixture
// runs a UDP "DNS server" that never answers and timestamps every incoming
// query so the test can observe both total elapsed time and the on-wire
// retransmit gap.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function run(opt: { timeout: number; tries: number }) {
  const src = `
    import dns from "node:dns";
    import dgram from "node:dgram";
    const log = [];
    const u = dgram.createSocket("udp4");
    await new Promise(r => u.bind(0, "127.0.0.1", r));
    u.on("message", () => log.push(Date.now()));
    const r = new dns.promises.Resolver(${JSON.stringify(opt)});
    r.setServers(["127.0.0.1:" + u.address().port]);
    const t0 = Date.now();
    const err = await r.resolve4("x.test").then(() => "?", e => e.code);
    const elapsed = Date.now() - t0;
    await new Promise(r2 => setTimeout(r2, 50));
    const gaps = log.map((t, i) => (i ? t - log[i - 1] : 0)).slice(1);
    console.log(JSON.stringify({ err, elapsed, wire_queries: log.length, gaps }));
    u.close();
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  return JSON.parse(stdout.trim()) as {
    err: string;
    elapsed: number;
    wire_queries: number;
    gaps: number[];
  };
}

test.concurrent("Resolver honors sub-second timeout (tries=1)", async () => {
  // c-ares enforces MIN_TIMEOUT_MS=250, so 200 clamps to ~250 ms. Before the
  // fix this waited ~1000 ms regardless.
  const { err, elapsed, wire_queries } = await run({ timeout: 200, tries: 1 });
  expect({ err, wire_queries }).toEqual({ err: "ETIMEOUT", wire_queries: 1 });
  expect(elapsed).toBeLessThan(800);
});

test.concurrent("Resolver retransmits before 1s for sub-second timeout (tries=3)", async () => {
  // First retransmit is at the base timeout (~250 ms, no jitter on round 0).
  // Before the fix the first gap was ~1000 ms.
  const { err, wire_queries, gaps } = await run({ timeout: 200, tries: 3 });
  expect({ err, wire_queries }).toEqual({ err: "ETIMEOUT", wire_queries: 3 });
  expect(gaps.length).toBe(2);
  expect(gaps[0]).toBeLessThan(800);
});

test.concurrent("Resolver timeout >= 1s is unaffected", async () => {
  const { err, elapsed, wire_queries } = await run({ timeout: 2000, tries: 1 });
  expect({ err, wire_queries }).toEqual({ err: "ETIMEOUT", wire_queries: 1 });
  expect(elapsed).toBeGreaterThanOrEqual(1900);
  expect(elapsed).toBeLessThan(3000);
});
