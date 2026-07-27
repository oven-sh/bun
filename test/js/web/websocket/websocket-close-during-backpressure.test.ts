// Receiving a server Close frame while the client's send buffer is stalled
// behind a non-reading peer left the WebSocket in readyState OPEN forever with
// no close event; send() after the Close still queued to the drain buffer.
// https://github.com/oven-sh/bun/issues/31760 covers bufferedAmount always
// reporting 0.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import crypto from "node:crypto";
import net from "node:net";

const FIXTURE = require.resolve("./websocket-close-during-backpressure-fixture.ts");

// uSockets' timeout wheel sweeps on a ~4 s cadence, so even with
// BUN_CONFIG_WS_CLOSE_TIMEOUT=1 the close may take up to ~5 s to fire; the
// fixture races that against an 8 s deadline. The default 5 s test timeout is
// too tight for this path.
test.concurrent(
  "WebSocket client: server Close during stalled drain transitions to CLOSING and eventually closes",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), FIXTURE],
      env: {
        ...bunEnv,
        // Keep the drain-timeout short so the test completes quickly.
        BUN_CONFIG_WS_CLOSE_TIMEOUT: "1",
      },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const last = stdout.trim().split("\n").pop()!;
    const result = JSON.parse(last) as {
      maxBufferedBeforeClose: number;
      readyStateAfterServerClose: number;
      bufferedBeforeLateSends: number;
      bufferedAfterLateSends: number;
      close: "timeout" | { code: number; wasClean: boolean };
    };

    // #31760: bufferedAmount reflects the queued send buffer while OPEN.
    expect(result.maxBufferedBeforeClose).toBeGreaterThan(0);

    // On receiving the server's Close, readyState is CLOSING (2), not
    // still OPEN (1). CLOSED (3) is also acceptable if teardown already ran.
    expect(result.readyStateAfterServerClose).not.toBe(WebSocket.OPEN);

    // send() after the closing handshake has started is a spec no-op on the wire
    // and contributes only to bufferedAmountAfterClose: the late sends add
    // exactly 8 MiB of payload plus framing overhead (8 × 14 bytes), not the
    // tens-of-megabytes growth that would happen if they were queued into the
    // drain buffer behind the stalled Close echo.
    const delta = result.bufferedAfterLateSends - result.bufferedBeforeLateSends;
    expect(delta).toBeGreaterThanOrEqual(8 * (1 << 20));
    expect(delta).toBeLessThanOrEqual(8 * ((1 << 20) + 14));

    // A close event fires within the drain timeout. If the peer truly never
    // drained, the bounded teardown reports 1006 / wasClean=false; on platforms
    // where socket.pause() does not fully stop kernel reads (observed on
    // Windows), the queue drains and the received code echoes cleanly instead.
    expect(result.close).not.toBe("timeout");
    expect([
      { code: 1006, wasClean: false },
      { code: 1000, wasClean: true },
    ]).toContainEqual(result.close);
  },
  30000,
);

// #31760 without the stall: bufferedAmount is the live queue length and falls
// to 0 once the socket drains. Needs no env tuning, so this runs in-process.
test.concurrent(
  "WebSocket client: bufferedAmount tracks the outbound queue",
  async () => {
    let serverSock: net.Socket | undefined;
    let ws: WebSocket | undefined;
    const server = await new Promise<net.Server>(resolve => {
      const s = net.createServer(sock => {
        serverSock = sock;
        let buf = "";
        let done = false;
        sock.on("data", chunk => {
          if (done) return;
          buf += chunk.toString("latin1");
          if (!buf.includes("\r\n\r\n")) return;
          const key = /Sec-WebSocket-Key:\s*(.*)\r\n/i.exec(buf)![1].trim();
          const accept = crypto
            .createHash("sha1")
            .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
            .digest("base64");
          sock.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              "Sec-WebSocket-Accept: " +
              accept +
              "\r\n\r\n",
          );
          done = true;
          sock.on("data", () => {}); // drain everything the client sends
        });
        sock.on("error", () => {});
      });
      s.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const { port } = server.address() as net.AddressInfo;
      ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve, reject) => {
        ws!.onopen = () => resolve();
        ws!.onerror = () => reject(new Error("connect failed"));
      });

      expect(ws.bufferedAmount).toBe(0);
      const payload = new Uint8Array(1 << 20);
      let max = 0;
      for (let i = 0; i < 32; i++) {
        ws.send(payload);
        if (ws.bufferedAmount > max) max = ws.bufferedAmount;
      }
      // The OS socket buffer absorbs the first write(s); the remainder lands in
      // the client's send buffer and must be reported.
      expect(max).toBeGreaterThan(0);

      // The server is reading, so the queue drains back to 0.
      const deadline = Date.now() + 10000;
      while (ws.bufferedAmount > 0 && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 5));
      }
      expect(ws.bufferedAmount).toBe(0);
    } finally {
      ws?.close();
      serverSock?.destroy();
      await new Promise(r => server.close(r));
    }
  },
  20000,
);
