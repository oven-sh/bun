import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// MessagePortChannel / MessagePortChannelRegistry are shared between the main thread and every
// Worker thread. A Worker posting to a transferred port while the owning thread is draining that
// port's queue used to race on the same Vector<MessageWithMessagePorts>, corrupting the heap
// (ASAN unknown-crash / SEGV, or a libpas "Alloc bit not set" panic in release builds).
//
// Regression test for Node.js test/parallel/test-worker-message-port-message-before-close.js
// with a more aggressive message burst so the race reproduces reliably under ASAN while still
// completing quickly in debug builds.
test("transferred MessagePort: postMessage from Worker does not race with receive on main thread", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "message-port-message-before-close-fixture.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
}, 60_000);
