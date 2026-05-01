import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
import path from "node:path";

// The tunnel-mode success branch in WebSocketUpgradeClient.processResponse()
// took `outgoing_websocket` without releasing the ref that paired with C++'s
// `m_upgradeClient`. didConnectWithTunnel() nulls m_upgradeClient so C++ never
// calls cancel() to drop it; when the socket later closed, handleClose's single
// deref left the struct at refcount 1 forever — one leaked HTTPUpgradeClient
// per wss://-through-HTTP-proxy connection.
//
// The assertion counts `[alloc] new(…NewHTTPUpgradeClient(…))` vs
// `[alloc] destroy(…NewHTTPUpgradeClient(…))` in the alloc debug scope, which
// is only emitted by debug builds (Environment.allow_assert).
test.skipIf(!isDebug)(
  "wss:// through HTTP proxy does not leak HTTPUpgradeClient",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "websocket-proxy-tunnel-upgrade-leak-fixture.ts")],
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
    //   [alloc] new(http.websocket_client.WebSocketUpgradeClient.NewHTTPUpgradeClient(false)) = …
    //   [alloc] destroy(http.websocket_client.WebSocketUpgradeClient.NewHTTPUpgradeClient(false)) = …
    // Scoped debug output writes to the raw stdout stream, but search both
    // streams in case that ever changes.
    const lines = (stdout + stderr)
      .split("\n")
      .filter(l => l.startsWith("[alloc] ") && l.includes("NewHTTPUpgradeClient"));
    const created = lines.filter(l => l.startsWith("[alloc] new(")).length;
    const destroyed = lines.filter(l => l.startsWith("[alloc] destroy(")).length;

    // Must have exercised the tunnel path at all — guards against NO_PROXY or
    // a fixture regression silently skipping the scenario.
    expect(created).toBeGreaterThan(0);
    expect({ created, destroyed }).toEqual({ created, destroyed: created });
    if (exitCode !== 0) console.error(stderr);
    expect(exitCode).toBe(0);
  },
  30_000,
);
