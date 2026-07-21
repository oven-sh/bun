// c-ares 1.31+ enables an in-process query cache by default (qcache_max_ttl=3600)
// unless the embedder passes ARES_OPT_QUERY_CACHE with qcache_max_ttl=0. Node's
// dns.Resolver re-queries on every call; Bun must match that: no resolver-level
// caching, so zone changes and DNS-polling code observe fresh answers.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

test("dns.Resolver does not cache responses in-process (matches Node)", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "dns-resolver-no-cache-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ ...JSON.parse(stdout), stderr, exitCode }).toEqual({
    wire1: 2,
    wire2: 2,
    before: ["192.0.2.10"],
    after: ["192.0.2.20"],
    stderr: "",
    exitCode: 0,
  });
});
