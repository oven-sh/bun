import { expect, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";
import { Duplex, duplexPair } from "node:stream";
import http2utils from "./helpers";

// Over an in-process transport (duplexPair) the peer reads a write, and can answer it, before
// socket.write() returns. A body larger than the flow-control window goes out one window at a
// time, so the answer to one window arrives while the rest of the body is not queued yet. The
// rest has to go out on the window as it is after that write: once it is queued, no later
// event sends it.

test("two responses larger than the window complete over duplexPair", async () => {
  // 64 KiB is the default high-water mark, except on Windows (16 KiB). With 16 KiB every
  // window-sized write reports backpressure, and the 'drain' that follows sends a queued rest.
  const [clientSide, serverSide] = duplexPair({ highWaterMark: 64 * 1024 });
  const server = http2.createServer();
  server.on("stream", (stream: http2.ServerHttp2Stream) => {
    stream.on("data", () => {});
    stream.on("end", () => {
      stream.respond({ ":status": 200 });
      stream.end(Buffer.alloc(200_000, "r"));
    });
  });
  server.emit("connection", serverSide);
  const client = http2.connect("http://localhost", { createConnection: () => clientSide });
  try {
    // Two requests: the WINDOW_UPDATE for the first response reaches the server on a later
    // turn, because clientSide is still busy with the request body. The WINDOW_UPDATE for the
    // second response arrives inside serverSide.write().
    const received: number[] = [];
    for (let i = 0; i < 2; i++) {
      const req = client.request({ ":method": "POST", ":path": "/" });
      let bytes = 0;
      req.on("data", chunk => (bytes += chunk.length));
      const closed = once(req, "close");
      req.end("hi");
      await closed;
      received.push(bytes);
    }
    expect(received).toEqual([200_000, 200_000]);
  } finally {
    client.close();
    server.close();
  }
});

const frame = (type: number, flags: number, streamId: number, payload = Buffer.alloc(0)) =>
  Buffer.concat([new http2utils.Frame(payload.length, type, flags, streamId).data, payload]);
const u32 = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
};
const FRAME = { DATA: 0, HEADERS: 1, RST_STREAM: 3, SETTINGS: 4, WINDOW_UPDATE: 8 };
const END_STREAM = 0x1;
const SETTINGS_INITIAL_WINDOW_SIZE = 4;
const DEFAULT_WINDOW = 65535;
const BODY_LENGTH = 200_000;

// The test plays the server on a hand-driven Duplex. One send window (of the connection or of
// the stream) keeps its default size and the other one is 1 MiB. When the request body has used
// up the default window, the server answers from inside the transport's _write.
test.each([
  ["connection", "WINDOW_UPDATE"],
  ["stream", "WINDOW_UPDATE"],
  ["connection", "RST_STREAM and WINDOW_UPDATE"],
])("a request body that uses up the %s window is answered with %s", async (limit, answer) => {
  const reset = answer !== "WINDOW_UPDATE";
  let unparsed = Buffer.alloc(0);
  let prefaceSeen = false;
  let answered = false;
  const body = { beforeAnswer: 0, afterAnswer: 0, endStream: false };
  const headersSent = Promise.withResolvers<void>();
  const socket = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      unparsed = Buffer.concat([unparsed, chunk]);
      if (!prefaceSeen && unparsed.length >= http2utils.kClientMagic.length) {
        unparsed = unparsed.subarray(http2utils.kClientMagic.length);
        prefaceSeen = true;
      }
      while (prefaceSeen && unparsed.length >= 9) {
        const length = unparsed.readUIntBE(0, 3);
        if (unparsed.length < 9 + length) break;
        const type = unparsed[3];
        const flags = unparsed[4];
        const streamId = unparsed.readUInt32BE(5) & 0x7fffffff;
        unparsed = unparsed.subarray(9 + length);
        if (streamId !== 1) continue;
        if (type === FRAME.HEADERS) headersSent.resolve();
        if (type !== FRAME.DATA) continue;
        body[answered ? "afterAnswer" : "beforeAnswer"] += length;
        if (flags & END_STREAM) {
          body.endStream = true;
          // The response: HEADERS with END_STREAM. 0x88 is ":status: 200" in HPACK.
          socket.push(new http2utils.HeadersFrame(1, Buffer.from([0x88]), 0, true, true).data);
        }
      }
      if (!answered && body.beforeAnswer === DEFAULT_WINDOW) {
        answered = true;
        const windowUpdate = frame(FRAME.WINDOW_UPDATE, 0, limit === "stream" ? 1 : 0, u32(1 << 20));
        const rstStream = frame(FRAME.RST_STREAM, 0, 1, u32(http2.constants.NGHTTP2_CANCEL));
        socket.push(reset ? Buffer.concat([rstStream, windowUpdate]) : windowUpdate);
      }
      callback();
    },
  });

  const client = http2.connect("http://localhost", { createConnection: () => socket });
  try {
    client.on("connect", () => {
      // The server preface and the ACK of the client's SETTINGS. The window that does not
      // limit the body becomes 1 MiB: stream windows through SETTINGS_INITIAL_WINDOW_SIZE, the
      // connection window through a WINDOW_UPDATE.
      const settings =
        limit === "connection"
          ? frame(FRAME.SETTINGS, 0, 0, Buffer.concat([Buffer.from([0, SETTINGS_INITIAL_WINDOW_SIZE]), u32(1 << 20)]))
          : Buffer.concat([frame(FRAME.SETTINGS, 0, 0), frame(FRAME.WINDOW_UPDATE, 0, 0, u32(1 << 20))]);
      socket.push(Buffer.concat([settings, new http2utils.SettingsFrame(true).data]));
    });
    await once(client, "remoteSettings");

    const req = client.request({ ":method": "POST", ":path": "/" });
    req.resume();
    // Write the body after the HEADERS frame is out. Nothing of the session is corked then, so
    // no deferred flush is pending that would send a queued rest anyway.
    await headersSent.promise;
    const closed = once(req, "close");
    const ended = Promise.withResolvers<void>();
    req.end(Buffer.alloc(BODY_LENGTH, "a"), () => ended.resolve());
    await Promise.all([closed, ended.promise]);

    expect({ ...body, rstCode: req.rstCode, outboundQueueSize: client.state.outboundQueueSize }).toEqual(
      reset
        ? {
            beforeAnswer: DEFAULT_WINDOW,
            afterAnswer: 0,
            endStream: false,
            rstCode: http2.constants.NGHTTP2_CANCEL,
            outboundQueueSize: 0,
          }
        : {
            beforeAnswer: DEFAULT_WINDOW,
            afterAnswer: BODY_LENGTH - DEFAULT_WINDOW,
            endStream: true,
            rstCode: 0,
            outboundQueueSize: 0,
          },
    );
  } finally {
    client.destroy();
  }
});
