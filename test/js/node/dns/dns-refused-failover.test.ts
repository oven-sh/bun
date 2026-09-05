import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

async function runFixture(mode: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "dns-refused-failover-fixture.ts"), mode],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr.trim()).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.trim());
}

// #37377: REFUSED from a nameserver is a per-server failure. Like glibc's
// res_send, c-ares must fall through to the next configured nameserver
// instead of failing the whole lookup at the first one.
test.concurrent("dns.resolve4 falls through to the next nameserver on REFUSED", async () => {
  expect(await runFixture("failover")).toEqual({ addresses: ["192.0.2.42"] });
});

test.concurrent("dns.resolve4 still reports EREFUSED when every nameserver refuses", async () => {
  expect(await runFixture("all-refused")).toEqual({ code: "EREFUSED" });
});
