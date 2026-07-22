import { serve } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("WebSocket upgrade", () => {
  // https://github.com/oven-sh/bun/issues/2896
  // BUN_CONFIG_WS_HANDSHAKE_TIMEOUT=1: uSockets sweeps every 4 s, so the
  // effective delay is ~4-8 s, hence the 30 s test budget.
  test("fails the handshake when the server never responds", async () => {
    const script = `
      const net = require("node:net");
      const srv = net.createServer(() => {});
      srv.listen(0, "127.0.0.1", () => {
        const port = srv.address().port;
        const ws = new WebSocket("ws://127.0.0.1:" + port + "/");
        const events = [];
        ws.onopen = () => events.push("open");
        ws.onerror = () => events.push("error");
        ws.onclose = (e) => {
          events.push("close:" + e.code);
          console.log(JSON.stringify(events));
          srv.close();
        };
      });
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
  }, 30_000);

  test("should send correct upgrade headers", async () => {
    const server = serve({
      hostname: "localhost",
      port: 0,
      fetch(request, server) {
        expect(server.upgrade(request)).toBeTrue();
        const { headers } = request;
        expect(headers.get("connection")).toBe("upgrade");
        expect(headers.get("upgrade")).toBe("websocket");
        expect(headers.get("sec-websocket-version")).toBe("13");
        expect(headers.get("sec-websocket-key")).toBeString();
        expect(headers.get("host")).toBe(`localhost:${server.port}`);
        return;
        // FIXME: types gets annoyed if this is not here
        return new Response();
      },
      websocket: {
        open(ws) {
          // FIXME: double-free issue
          // ws.close();
          server.stop();
        },
        message(ws, message) {},
      },
    });
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${server.port}/`);
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
      ws.addEventListener("close", reject);
    });
  });
});
