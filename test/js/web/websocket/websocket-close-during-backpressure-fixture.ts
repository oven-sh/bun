// Fixture for websocket-close-during-backpressure.test.ts.
//
// Raw TCP server that completes the WebSocket handshake, then stops reading
// (socket.pause()) and sends a Close(1000) frame. The client queues large
// binary sends before the Close arrives, so its echo Close frame sits behind
// an undrained send buffer. Previously the client never transitioned to
// CLOSING, bufferedAmount stayed 0, and no close event fired.
//
// Run with BUN_CONFIG_WS_CLOSE_TIMEOUT set low so the bounded-drain teardown
// fires within the test timeout.

import crypto from "node:crypto";
import net from "node:net";

const CHUNK = 1 << 20; // 1 MiB
const NUM_CHUNKS = Number(process.env.NUM_CHUNKS ?? "64");

function closeFrame(code: number) {
  const f = Buffer.alloc(4);
  f[0] = 0x88;
  f[1] = 2;
  f[2] = (code >> 8) & 0xff;
  f[3] = code & 0xff;
  return f;
}

const upgraded = Promise.withResolvers<void>();
let serverSock: net.Socket;

const server = net.createServer(sock => {
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
    // Stop reading: the client's send buffer fills and never drains.
    sock.pause();
    // Send the Close after the client has had a chance to fill its send
    // buffer; 10ms is ample on the same loop and the condition checks below
    // don't assume any timing beyond "Close eventually arrives".
    setTimeout(() => {
      sock.write(closeFrame(1000));
      upgraded.resolve();
    }, 10);
  });
  sock.on("error", e => upgraded.reject(e));
});

await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
const address = server.address() as net.AddressInfo;

const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);

const opened = Promise.withResolvers<void>();
ws.onopen = () => opened.resolve();
ws.onerror = e => opened.reject(new Error("WebSocket error before open: " + (e as ErrorEvent).message));
const closed = Promise.withResolvers<{ code: number; wasClean: boolean }>();
ws.onclose = e => closed.resolve({ code: e.code, wasClean: e.wasClean });

await opened.promise;
ws.onerror = () => {};

const payload = new Uint8Array(CHUNK);
let maxBufferedBeforeClose = 0;
for (let i = 0; i < NUM_CHUNKS; i++) {
  ws.send(payload);
  if (ws.bufferedAmount > maxBufferedBeforeClose) maxBufferedBeforeClose = ws.bufferedAmount;
}

await upgraded.promise;

// Wait for readyState to leave OPEN (the client has received the Close frame).
// Poll with a deadline rather than sleeping for a fixed interval.
const deadline = Date.now() + 1500;
while (ws.readyState === WebSocket.OPEN && Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 5));
}

const readyStateAfterServerClose = ws.readyState;

// send() after the server's Close is observed: per spec this is a no-op (adds
// to bufferedAmountAfterClose but does not hit the wire). Previously these
// were queued into the drain buffer and ballooned RSS.
const bufferedBeforeLateSends = ws.bufferedAmount;
for (let i = 0; i < 8; i++) ws.send(payload);
const bufferedAfterLateSends = ws.bufferedAmount;

// Wait for the close event. The bounded-drain timeout (BUN_CONFIG_WS_CLOSE_TIMEOUT)
// tears the socket down when the server never drains, yielding 1006/unclean.
// uSockets' short-timeout wheel sweeps every ~4 s, so a 1 s timeout can take
// up to ~5 s to fire; 8 s of headroom covers debug builds.
const closeResult = await Promise.race([
  closed.promise,
  new Promise<"timeout">(r => setTimeout(() => r("timeout"), 8000)),
]);

serverSock!.destroy();
server.close();

const result = {
  maxBufferedBeforeClose,
  readyStateAfterServerClose,
  bufferedBeforeLateSends,
  bufferedAfterLateSends,
  close: closeResult,
};
console.log(JSON.stringify(result));
process.exit(0);
