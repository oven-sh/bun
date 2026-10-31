import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// The timer for timeouts has to stay armed for as long as any query is in
// flight, however many there are and whatever became of the others. A table of
// 32 requests once decided that, and a query past the 32nd never saw its
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
