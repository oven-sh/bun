import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import path from "node:path";

// bun-debug ships with ASAN but is not named bun-asan, so isASAN is false
// there; scale for either. The spawned fixture takes ~130ms in release but
// ~8s under debug+ASAN (crash reporting alone dominates on the failing path),
// so the default 5s per-test budget kills the child before it can exit.
const ASAN_MULTIPLIER = isDebug ? 10 : isASAN ? 3 : 1;

// H2FrameParser::on_auto_flush calls flush -> uncork -> unregister_auto_flush,
// removing its own entry from the DeferredTaskQueue mid-iteration and then
// returning true. With a second auto-flusher (an HTTPServerWritable small
// write) sitting after it in the map, DeferredTaskQueue::run would index past
// the new length and panic.
test(
  "DeferredTaskQueue::run tolerates an on_auto_flush callback that unregisters itself and returns true",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "node-http2-deferred-task-queue.fixture.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode, stderr }).toMatchObject({ stdout: "OK", exitCode: 0 });
  },
  10_000 * ASAN_MULTIPLIER,
);
