// A server-initiated Close frame must transition readyState to CLOSING as soon
// as it is received (RFC 6455 §7.1.3 / WHATWG "start the WebSocket closing
// handshake"), even if the client's outbound queue is stalled behind a
// non-reading peer. Previously the CLOSING transition was deferred until the
// outbound queue drained, so against a peer that stopped reading the client
// stayed OPEN indefinitely and send() kept queuing native memory.
import { afterEach, expect, test } from "bun:test";
import crypto from "node:crypto";
import { once } from "node:events";
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function closeFrame(code: number, reason: string) {
  const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
  payload.writeUInt16BE(code, 0);
  payload.write(reason, 2);
  return Buffer.concat([Buffer.from([0x88, payload.length]), payload]);
}

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

// Handshake, pause the server's read side, flood 16 MB from the client so the
// client's userspace send queue is non-empty, then deliver a server Close
// frame and wait for the client to observe CLOSING.
async function backpressuredCloseSetup(): Promise<{ ws: WebSocket; serverSocket: Socket; server: Server }> {
  let serverSocket!: Socket;
  const handshook = Promise.withResolvers<void>();

  const server = createServer(sock => {
    serverSocket = sock;
    let head = "";
    let done = false;
    sock.on("error", handshook.reject);
    sock.on("data", chunk => {
      if (done) return;
      head += chunk.toString("latin1");
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) return;
      done = true;
      const key = /sec-websocket-key:\s*(\S+)/i.exec(head)![1];
      const accept = crypto
        .createHash("sha1")
        .update(key + GUID)
        .digest("base64");
      sock.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Accept: " +
          accept +
          "\r\n\r\n",
      );
      // Stop reading so the client's sends back up into its userspace buffer.
      sock.pause();
      handshook.resolve();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(() => server.close());
  const port = (server.address() as AddressInfo).port;

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  cleanup.push(() => ws.terminate());
  {
    const opened = Promise.withResolvers<void>();
    ws.onopen = () => opened.resolve();
    ws.onclose = e => opened.reject(new Error(`open failed: ${e.code} ${e.reason}`));
    await opened.promise;
    ws.onopen = ws.onclose = null;
  }
  await handshook.promise;
  cleanup.push(() => serverSocket.destroy());

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
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  expect(ws.readyState).toBe(WebSocket.CLOSING);

  return { ws, serverSocket, server };
}

test("readyState becomes CLOSING when a Close frame arrives while the send queue is backpressured", async () => {
  const { ws, serverSocket } = await backpressuredCloseSetup();

  // send() after CLOSING bumps bufferedAmount instead of reaching the native
  // queue (which would leave it unchanged).
  const before = ws.bufferedAmount;
  ws.send(Buffer.alloc(64 * 1024, "x").toString());
  expect(ws.bufferedAmount).toBeGreaterThan(before);

  // Tearing down the TCP connection lets the deferred close event fire with
  // the server-provided code and reason (proving the deferred-dispatch branch
  // was taken).
  const closed = once(ws, "close");
  serverSocket.destroy();
  const [ev] = (await closed) as [CloseEvent];
  expect(ev.code).toBe(1000);
  expect(ev.reason).toBe("bye");
});

test("terminate() during CLOSING force-closes while the send queue is still backpressured", async () => {
  const { ws } = await backpressuredCloseSetup();

  // terminate() must force-close in CLOSING state (npm ws does the same);
  // before this was fixed the CLOSING gate made it a silent no-op, so with
  // the peer holding TCP open there was no JS-level way to free the queued
  // memory. The close event fires without the server destroying the socket.
  const closed = once(ws, "close");
  ws.terminate();
  const [ev] = (await closed) as [CloseEvent];
  expect(ev.code).toBe(1006);
  expect(ws.readyState).toBe(WebSocket.CLOSED);
});
