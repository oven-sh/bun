import { expect, test } from "bun:test";
import http2 from "node:http2";
import net from "node:net";

// A peer that raises SETTINGS_INITIAL_WINDOW_SIZE keeps enforcing its old receive
// window until it has processed our SETTINGS ACK (RFC 9113 §6.5.3). Any DATA the
// enlarged window unblocks must therefore be written after the ACK, or nghttp2 and
// grpc-go count it against the old window and reset the stream with
// FLOW_CONTROL_ERROR. This test stalls a client on a 65535-byte stream window,
// raises the window via SETTINGS, and asserts no DATA arrives between that
// SETTINGS frame and the client's ACK.

const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1");
const INITIAL_WINDOW = 65535;
const RAISED_WINDOW = 1024 * 1024;
const BODY = 256 * 1024;

function frame(type: number, flags: number, streamId: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3);
  header.writeUInt8(type, 3);
  header.writeUInt8(flags, 4);
  header.writeUInt32BE(streamId & 0x7fffffff, 5);
  return Buffer.concat([header, payload]);
}

function settingsFrame(entries: Array<[number, number]>): Buffer {
  const payload = Buffer.alloc(entries.length * 6);
  entries.forEach(([id, value], i) => {
    payload.writeUInt16BE(id, i * 6);
    payload.writeUInt32BE(value, i * 6 + 2);
  });
  return frame(0x4, 0, 0, payload);
}

test("client sends the SETTINGS ACK before DATA unblocked by a larger INITIAL_WINDOW_SIZE", async () => {
  const { promise: done, resolve: bodyReceived, reject: failed } = Promise.withResolvers<void>();
  let raised = false;
  // The server sends two SETTINGS frames (the initial one and the raise), so the
  // raise is acknowledged by the second ACK. Matching ACKs by count matters: the
  // client may ACK the initial SETTINGS late, after DATA already flowed.
  let acksReceived = 0;
  let dataBeforeAck = 0;
  let framesBeforeAck = 0;
  let dataTotal = 0;

  const server = net.createServer(socket => {
    let buf = Buffer.alloc(0);
    let prefaceStripped = false;
    socket.on("error", () => {});

    // A default 65535 stream window but a huge connection window, so the
    // per-stream window is the only thing that can block the client.
    socket.write(
      settingsFrame([
        [0x4, INITIAL_WINDOW],
        [0x5, 16384],
      ]),
    );
    const windowUpdate = Buffer.alloc(4);
    windowUpdate.writeUInt32BE(64 * 1024 * 1024);
    socket.write(frame(0x8, 0, 0, windowUpdate));

    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!prefaceStripped) {
        if (buf.length < PREFACE.length) return;
        buf = buf.subarray(PREFACE.length);
        prefaceStripped = true;
      }
      while (buf.length >= 9) {
        const len = buf.readUIntBE(0, 3);
        const type = buf.readUInt8(3);
        const flags = buf.readUInt8(4);
        if (buf.length < 9 + len) break;
        const payload = buf.subarray(9, 9 + len);
        buf = buf.subarray(9 + len);

        if (type === 0x0) {
          // DATA. The body is never read and no stream WINDOW_UPDATE is ever
          // sent, so the client stalls once it exhausts the 65535-byte window.
          // At that point raise the window via SETTINGS: every DATA frame that
          // arrives after this SETTINGS and before the client's ACK was sent
          // against a window the server has not applied yet.
          dataTotal += len;
          // At raise time the 65535-byte window is fully exhausted, so any DATA
          // that arrives between the raise and its ACK uses the unacknowledged
          // enlarged window.
          if (raised && acksReceived < 2) {
            dataBeforeAck += len;
            framesBeforeAck++;
          }
          if (!raised && dataTotal >= INITIAL_WINDOW) {
            raised = true;
            socket.write(settingsFrame([[0x4, RAISED_WINDOW]]));
          }
          if (dataTotal >= BODY) bodyReceived();
        } else if (type === 0x4) {
          // SETTINGS
          if (flags & 0x1) {
            acksReceived++;
          } else {
            socket.write(frame(0x4, 0x1, 0));
          }
        } else if (type === 0x6 && !(flags & 0x1)) {
          socket.write(frame(0x6, 0x1, 0, payload));
        }
      }
    });
  });

  const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => onListening());
  await listening;
  const { port } = server.address() as net.AddressInfo;

  const client = http2.connect(`http://127.0.0.1:${port}`);
  client.on("error", failed);
  try {
    const req = client.request({ ":method": "POST", ":path": "/" });
    req.on("error", failed);
    req.write(Buffer.alloc(BODY, 0x61));

    await done;

    expect({ dataBeforeAck, framesBeforeAck }).toEqual({ dataBeforeAck: 0, framesBeforeAck: 0 });
    expect(dataTotal).toBe(BODY);
  } finally {
    client.destroy();
    server.close();
  }
});
