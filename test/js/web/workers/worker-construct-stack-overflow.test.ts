import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// Constructing a Worker emits the "worker" event on the next tick, which
// lazily initializes process.nextTick by calling a JS function. When the
// constructor is reached with a nearly-exhausted stack, that inner call
// throws a stack-overflow RangeError. This used to abort the process with an
// EXCEPTION_ASSERT in JSObject::get instead of surfacing the error cleanly.
test("constructing a Worker with a nearly-exhausted stack does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "worker-construct-stack-overflow-fixture.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "ok\n",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});
