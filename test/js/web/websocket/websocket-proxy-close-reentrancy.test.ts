import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import path from "node:path";

// Calling ws.close() on a wss:// WebSocket that is connecting through an HTTP
// CONNECT proxy while the inner TLS handshake is still in flight used to
// double-free WebSocketProxy.target_host: clearData → proxy.deinit →
// tunnel.shutdown → SSLWrapper onClose → tunnel.onClose → upgrade_client.terminate
// → fail → tcp.close → handleClose → clearData (re-entered before this.proxy was
// nulled). The corrupted mimalloc freelist then crashed a later allocation.
//
// The re-entrancy requires synchronous us_socket_close → on_close dispatch, which
// only happens on POSIX; libuv defers the close callback on Windows.
test.skipIf(isWindows)("ws.close() during proxy TLS handshake does not double-free", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "websocket-proxy-close-reentrancy-fixture.ts")],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});
