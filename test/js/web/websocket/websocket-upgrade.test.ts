import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("WebSocket upgrade", () => {
  // https://github.com/oven-sh/bun/issues/2896
  // BUN_CONFIG_WS_HANDSHAKE_TIMEOUT=1: uSockets sweeps every 4 s, so the
  // effective delay is ~4-8 s, hence the 30 s test budget. The child uses
  // Bun.listen instead of node:net to avoid ~800 ms of module load in debug.
  test.concurrent(
    "fails the handshake when the server never responds",
    async () => {
      const script = `
      const srv = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
      const ws = new WebSocket("ws://127.0.0.1:" + srv.port + "/");
      const events = [];
      ws.onopen = () => events.push("open");
      ws.onerror = () => events.push("error");
      ws.onclose = (e) => {
        events.push("close:" + e.code);
        console.log(JSON.stringify(events));
        srv.stop(true);
      };
    `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, BUN_CONFIG_WS_HANDSHAKE_TIMEOUT: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout.trim())).toEqual(["error", "close:1006"]);
      expect(exitCode).toBe(0);
    },
    30_000,
  );

  test.concurrent("sends the expected upgrade request headers", async () => {
    const received = Promise.withResolvers<{ upgraded: boolean; headers: Record<string, string> }>();
    await using server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request, server) {
        const headers = Object.fromEntries(request.headers);
        const upgraded = server.upgrade(request);
        received.resolve({ upgraded, headers });
        if (upgraded) return;
        return new Response("upgrade failed", { status: 500 });
      },
      websocket: {
        open(ws) {
          ws.close();
        },
        message() {},
      },
    });

    const opened = Promise.withResolvers<void>();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`);
    ws.addEventListener("open", () => opened.resolve());
    ws.addEventListener("error", opened.reject);
    await opened.promise;

    const { upgraded, headers } = await received.promise;
    expect(upgraded).toBe(true);
    expect(headers).toEqual({
      connection: "Upgrade",
      host: `127.0.0.1:${server.port}`,
      "sec-websocket-extensions": "permessage-deflate; client_max_window_bits",
      "sec-websocket-key": expect.stringMatching(/^[A-Za-z0-9+/]{22}==$/),
      "sec-websocket-version": "13",
      upgrade: "websocket",
    });

    ws.close();
  });
});
