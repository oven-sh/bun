import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
import path from "node:path";

// initWithTunnel() creates the WebSocket client with ref_count=1 (I/O-layer
// ref, analogous to the adopted-socket ref that handleClose() releases in the
// non-tunnel path) and then ws.ref() → 2 for C++'s m_connectedWebSocket. The
// C++ ref is released by dispatchClose/dispatchAbruptClose/finalize, but
// nothing released the I/O ref because tcp is .detached in tunnel mode so
// handleClose() never fires. Every wss://-through-HTTP-proxy connection leaked
// the entire NewWebSocketClient(false) struct.
//
// The assertion counts `[alloc] new(…NewWebSocketClient(…))` vs
// `[alloc] destroy(…NewWebSocketClient(…))` in the alloc debug scope, which
// is only emitted by debug builds.
test.skipIf(!isDebug)(
  "wss:// through HTTP proxy does not leak NewWebSocketClient",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "websocket-proxy-tunnel-client-leak-fixture.ts")],
      env: {
        ...bunEnv,
        BUN_DEBUG_alloc: "1",
        // NO_PROXY in CI environments short-circuits the explicit `proxy:` option
        // for 127.0.0.1, so the fixture would bypass tunnel mode entirely.
        NO_PROXY: undefined,
        no_proxy: undefined,
        HTTP_PROXY: undefined,
        HTTPS_PROXY: undefined,
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // `bun.new`/`bun.destroy` log via Output.scoped(.alloc) in debug builds:
    //   [alloc] new(http.websocket_client.NewWebSocketClient(false)) = …
    //   [alloc] destroy(http.websocket_client.NewWebSocketClient(false)) = …
    const lines = (stdout + stderr)
      .split("\n")
      .filter(l => l.startsWith("[alloc] ") && l.includes("NewWebSocketClient"));
    const created = lines.filter(l => l.startsWith("[alloc] new(")).length;
    const destroyed = lines.filter(l => l.startsWith("[alloc] destroy(")).length;

    // Must have exercised the tunnel path — guards against NO_PROXY or a
    // fixture regression silently skipping the scenario.
    expect(created).toBeGreaterThan(0);
    expect({ created, destroyed }).toEqual({ created, destroyed: created });
    if (exitCode !== 0) console.error(stderr);
    expect(exitCode).toBe(0);
  },
  30_000,
);
