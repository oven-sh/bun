import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// #37377: Node sets ARES_FLAG_NOCHECKRESP, so a REFUSED answer ends the
// query with EREFUSED and c-ares does not try the next nameserver. Bun
// matches that. The fixture runs unchanged on Node and prints the same
// result there.
test("dns.resolve4 reports EREFUSED from the first nameserver without trying the next", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "dns-refused-failover-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr.trim()).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({ code: "EREFUSED", queries: [1, 0] });
  expect(exitCode).toBe(0);
});
