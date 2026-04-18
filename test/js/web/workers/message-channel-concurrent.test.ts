import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

// Regression test for the MessagePortChannelRegistry data race: the registry's
// m_openChannels HashMap and per-channel pending-message Vectors were mutated
// from worker threads with no synchronization (the upstream ASSERT(isMainThread())
// guards were commented out). This stresses the registry from several threads at
// once; before the registry was made lock-protected this would crash.
test("MessageChannel survives concurrent create/post/transfer/close from many workers", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "message-channel-concurrent-fixture.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const filteredStderr = stderr
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");

  expect(filteredStderr).toBe("");
  expect(stdout).toStartWith("PASS ");
  expect(exitCode).toBe(0);
});
