// Repro for aliased @memcpy in WebSocketUpgradeClient.handleProxyResponse.
//
// When the proxy CONNECT reply is split across TCP reads, the upgrade client
// buffers into `this.body`, so `body = this.body.items`. After parsing the
// 200 it does `this.body.clearRetainingCapacity()` then takes
// `remain_buf = body[bytes_read..]` — a slice into `this.body`'s retained
// capacity — and re-enters `handleData(socket, remain_buf)`. On a ShortRead
// of the upstream 101 response, `handleData` calls
// `this.body.appendSlice(remain_buf)`: source and destination overlap in the
// same allocation, which panics with "@memcpy arguments alias" in safe
// builds (UB in release).
//
// This fixture plays both the CONNECT proxy and the upstream WebSocket server
// on a single raw TCP socket so it can control exactly how the bytes are
// chunked across reads.
import net from "node:net";
import crypto from "node:crypto";

function computeAccept(key: string): string {
  return crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
}

const connectResponse = "HTTP/1.1 200 OK\r\n\r\n"; // 19 bytes
// Partial 101 — enough headers to make PicoHTTP return ShortRead (no terminating
// CRLF CRLF), and longer than the CONNECT response so the @memcpy dest[0..n]
// overlaps src[19..19+n] in the same buffer.
const partial101 =
  "HTTP/1.1 101 Switching Protocols\r\n" + //
  "Upgrade: websocket\r\n" +
  "Connection: Upgrade\r\n";

let results: string[] = [];

const proxy = net.createServer(socket => {
  socket.setNoDelay(true);
  let phase: "connect" | "upgrade" | "done" = "connect";
  let buf = "";

  socket.on("data", chunk => {
    buf += chunk.toString("latin1");

    if (phase === "connect") {
      if (buf.indexOf("\r\n\r\n") === -1) return;
      buf = "";
      phase = "upgrade";

      // First chunk: partial CONNECT response → forces the client to buffer
      // into `this.body` (ShortRead in handleProxyResponse).
      socket.write(connectResponse.slice(0, 10));
      // Second chunk: rest of CONNECT response + partial 101 → client parses
      // the 200, computes remain_buf pointing into `this.body`'s storage,
      // clears the body, sends the WS upgrade request, then re-enters
      // handleData with the aliased remain_buf.
      setTimeout(() => {
        socket.write(connectResponse.slice(10) + partial101);
      }, 20);
      return;
    }

    if (phase === "upgrade") {
      // Client sends the WebSocket upgrade request; wait for full headers.
      if (buf.indexOf("\r\n\r\n") === -1) return;
      const m = /Sec-WebSocket-Key:\s*([^\r\n]+)/i.exec(buf);
      if (!m) {
        socket.destroy();
        return;
      }
      const accept = computeAccept(m[1].trim());
      phase = "done";
      buf = "";

      // Finish the 101 response (the first three header lines were already
      // sent as `partial101` trailing the CONNECT 200). After the client
      // buffers the aliased bytes on ShortRead, this completes the parse.
      socket.write("Sec-WebSocket-Accept: " + accept + "\r\n\r\n");

      // Send a text frame "hello" so the client's onmessage fires.
      socket.write(Uint8Array.from([0x81, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]));
      return;
    }
  });

  socket.on("error", () => {});
});

await new Promise<void>(r => proxy.listen(0, "127.0.0.1", () => r()));
const proxyPort = (proxy.address() as net.AddressInfo).port;

// Run several rounds to make the split-read land reliably even if the kernel
// occasionally coalesces the two writes.
for (let i = 0; i < 10; i++) {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  // Target host/port are irrelevant — the "proxy" never dials upstream.
  const ws = new WebSocket(`ws://127.0.0.1:1/`, {
    // @ts-ignore Bun-specific option
    proxy: `http://127.0.0.1:${proxyPort}`,
  });
  ws.onmessage = ev => resolve(String(ev.data));
  ws.onerror = ev => reject(new Error("WebSocket error: " + (ev as any).message));
  ws.onclose = ev => {
    if (!ev.wasClean && ws.readyState !== WebSocket.OPEN) {
      reject(new Error("closed before open: code=" + ev.code + " reason=" + ev.reason));
    }
  };
  results.push(await promise);
  ws.close();
}

proxy.close();

if (results.every(r => r === "hello")) {
  console.log("OK");
  process.exit(0);
} else {
  console.error("unexpected results", results);
  process.exit(1);
}
