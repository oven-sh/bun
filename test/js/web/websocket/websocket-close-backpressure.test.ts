// A server-initiated Close frame must transition readyState to CLOSING as soon
// as it is received (RFC 6455 §7.1.3 / WHATWG "start the WebSocket closing
// handshake"), even if the client's outbound queue is stalled behind a
// non-reading peer. Previously the CLOSING transition was deferred until the
// outbound queue drained, so against a peer that stopped reading the client
// stayed OPEN indefinitely and send() kept queuing native memory.
import { expect, test } from "bun:test";
import crypto from "node:crypto";
import { once } from "node:events";
import { createServer, type AddressInfo, type Socket } from "node:net";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function closeFrame(code: number, reason: string) {
  const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
  payload.writeUInt16BE(code, 0);
  payload.write(reason, 2);
  return Buffer.concat([Buffer.from([0x88, payload.length]), payload]);
}

test("readyState becomes CLOSING when a Close frame arrives while the send queue is backpressured", async () => {
  let serverSocket!: Socket;
  const handshook = Promise.withResolvers<void>();

  const server = createServer(sock => {
    serverSocket = sock;
    let head = "";
    let done = false;
    sock.on("data", chunk => {
      if (done) return;
      head += chunk.toString("latin1");
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) return;
      done = true;
      const key = /sec-websocket-key:\s*(\S+)/i.exec(head)![1];
      const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
      sock.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Accept: " + accept + "\r\n\r\n",
      );
      // Stop reading so the client's sends back up into its userspace buffer.
      sock.pause();
      handshook.resolve();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(ws, "open");
    await handshook.promise;

    // Enough to overflow the kernel send buffer into the userspace queue on
    // every supported platform; the server is not reading.
    const chunk = Buffer.alloc(64 * 1024, "x").toString();
    for (let i = 0; i < 256; i++) ws.send(chunk);

    expect(ws.readyState).toBe(WebSocket.OPEN);

    // Server → client direction is still flowing; deliver a Close frame.
    serverSocket.write(closeFrame(1000, "bye"));

    // The Close frame arrives within one RTT; poll readyState for the CLOSING
    // transition. Without the fix this stays OPEN for the entire window.
    const deadline = Date.now() + 2000;
    while (ws.readyState === WebSocket.OPEN && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(ws.readyState).toBe(WebSocket.CLOSING);

    // send() after CLOSING must not reach the native queue.
    const before = ws.bufferedAmount;
    ws.send(chunk);
    expect(ws.bufferedAmount).toBeGreaterThanOrEqual(before);

    // Tearing down the TCP connection lets the deferred close event fire.
    const closed = once(ws, "close");
    serverSocket.destroy();
    const [ev] = (await closed) as [CloseEvent];
    expect(ev.code).toBe(1000);
    expect(ev.reason).toBe("bye");
  } finally {
    serverSocket?.destroy();
    server.close();
  }
});
