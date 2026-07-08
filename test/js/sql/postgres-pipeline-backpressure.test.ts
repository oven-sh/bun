// A pipelined Bun.SQL postgres connection must serialize queued requests in
// FIFO order. When one same-tick burst of prepared queries carries enough
// parameter bytes that advance() stops pipelining mid-burst (write buffer
// exceeds the per-connection cap), the tail of that burst stays queued with
// status Pending. If a later query issued before the next ReadyForQuery is
// allowed to append its Bind/Execute bytes while those earlier Pending entries
// are still un-serialized, the wire order diverges from the FIFO order and the
// server's responses are attributed to the wrong promises. That is silent
// wrong data, not an error.
//
// The fixture runs in a subprocess so its process-wide SQL state and socket
// buffers are isolated from the rest of the suite.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

test("pipelined prepared queries resolve with their own rows when a burst exceeds the pipeline write cap", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "postgres-pipeline-backpressure.fixture.ts")],
    cwd: import.meta.dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const filteredStderr = stderr
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");

  // Control run: same code path with small parameters (burst never reaches the
  // cap) must also pass so the test is pinned to the ordering defect, not the
  // mock server.
  await using ctrl = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "postgres-pipeline-backpressure.fixture.ts")],
    cwd: import.meta.dir,
    env: { ...bunEnv, EPAD: "100" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [ctrlStdout, ctrlStderr, ctrlExit] = await Promise.all([
    ctrl.stdout.text(),
    ctrl.stderr.text(),
    ctrl.exited,
  ]);
  const filteredCtrlStderr = ctrlStderr
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");

  expect({
    large: { stdout: stdout.trim(), stderr: filteredStderr, exitCode },
    small: { stdout: ctrlStdout.trim(), stderr: filteredCtrlStderr, exitCode: ctrlExit },
  }).toEqual({
    large: { stdout: "OK issued=56 settled=56 pad=16000", stderr: "", exitCode: 0 },
    small: { stdout: "OK issued=56 settled=56 pad=100", stderr: "", exitCode: 0 },
  });
});
