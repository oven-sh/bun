import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import path from "node:path";

// This exercises the VM-teardown ordering between Listener and its child
// TLSSocket. Before the fix, `onHandshake`/`onClose` on the server-side
// TLSSocket would read `handlers.mode` after the parent Listener had been
// finalized (ASAN use-after-poison at socket.zig onHandshake/onClose).
//
// The crash only manifests under an ASAN-enabled build with
// BUN_DESTRUCT_VM_ON_EXIT=1 so that `lastChanceToFinalize` actually sweeps
// the remaining JS cells. Release builds read garbage but don't trap, so
// skip there — the bug is the same, ASAN is just the canary.
test.skipIf(!(isASAN || isDebug))(
  "http2 secure server: TLSSocket close after Listener finalize during VM teardown does not use-after-poison",
  async () => {
    const fixture = path.join(import.meta.dir, "node-http2-tls-shutdown-uap-fixture.js");
    const keysDir = path.join(import.meta.dir, "..", "test", "fixtures", "keys");

    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: {
        ...bunEnv,
        KEYS_DIR: keysDir,
        // N≥10 reliably spans enough heap blocks for finalization order
        // between Listener and TLSSocket to vary (0/5 repro at N<10, 5/5 at
        // N≥10). 15 gives headroom without slowing the fixture further.
        N: "15",
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        BUN_GARBAGE_COLLECTOR_LEVEL: "1",
        ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=0:abort_on_error=1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The fixture throws from every 'stream' handler, so stderr is full of
    // "error: boom N" traces — that's expected. The process should exit with
    // code 1 (unhandled exception) rather than abort. With
    // `ASAN_OPTIONS=abort_on_error=1`, an ASAN trap produces SIGABRT, so the
    // signalCode/exitCode assertions are the load-bearing regression checks.
    // Dump stderr so the ASAN report is visible in the failure output.
    if (proc.signalCode !== null || exitCode !== 1) {
      console.error(stderr);
    }
    expect(stdout).toBe("");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(1);
  },
  // 15 concurrent TLS handshakes + h2 session setup + VM-destroy finalizer
  // sweep under a debug ASAN build runs ~5–6s — above the 5s default. CI
  // passes --timeout=90000 so this only matters for local `bun bd test`.
  // Matches neighbouring socket.test.ts / socket-retention.test.ts which
  // extend timeouts for the same reason.
  30_000,
);
