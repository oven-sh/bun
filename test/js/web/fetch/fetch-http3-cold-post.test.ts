import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// The server cannot read a request before it has the client's TLS Finished, so a large first request
// must not use up the congestion window ahead of it.
// The fixture spawns sixteen subprocess debug builds (each a cold QUIC
// handshake), which cannot fit in the 5 s default.
test("large first request on a cold connection does not strand the TLS Finished", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fetch-http3-cold-post-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
}, 30_000);
