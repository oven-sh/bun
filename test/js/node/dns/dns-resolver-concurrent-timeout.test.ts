import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// The resolver's per-type pending cache is a fixed 32-slot HiveArray; any query
// issued past that is dispatched to c-ares without a cache slot. Before the
// fix, `any_requests_pending()` (which gates the 1s c-ares timeout poll timer)
// looked only at the cache bitsets, so once the 32 tracked queries completed
// the timer was disarmed and any still-pending untracked query never saw its
// ETIMEOUT: its promise stayed pending forever and the process never exited.
test("dns.Resolver: unanswered queries past 32 concurrent still time out", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "dns-resolver-concurrent-timeout-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr.trim()).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({ ok: 32, errCodes: Array(8).fill("ETIMEOUT") });
  expect(exitCode).toBe(0);
}, 20_000);
