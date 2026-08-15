import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// A client WebSocket's `open` fires from inside uSockets' on_data dispatch for
// that socket. The fixture stops the server from there and spins the event
// loop synchronously (expect().resolves), so the socket is closed by a nested
// tick while the outer dispatch still holds it. Closed sockets must only be
// freed by the outermost tick. The libuv (Windows) loop freed them in the
// nested tick, and libuv then queued the already-closed poll handle's endgame
// a second time, so the fixture crashed (debug builds: use-after-free of the
// poisoned socket) or corrupted the heap and hung (release builds). The same
// sequence is what made test/bake/deinitialization.test.ts crash or hang on
// the Windows CI lanes.
//
// The fixture needs bun:test's synchronous promise matchers, so it runs under
// `bun test`; it is deliberately not named *.test.ts.
test("client socket closed by a nested tick inside open is not freed under the outer dispatch", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", path.join(import.meta.dir, "websocket-close-during-nested-tick-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    // Hanging on a corrupted heap is one of the failure modes.
    timeout: 20_000,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // On failure this shows how far the fixture got; the crash report, if any, is in stderr.
  expect(stdout + stderr).toContain("fixture done");
  expect(stderr).toContain(" 1 pass");
  expect(exitCode).toBe(0);
}, 30_000);
