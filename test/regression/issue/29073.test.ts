// https://github.com/oven-sh/bun/issues/29073
//
// `node:http2.createServer` fails for h2c (cleartext HTTP/2).
//
// Two separate bugs caused strict HTTP/2 peers (curl's nghttp2, Node's
// http2 client) to reject Bun's server with "callback failure":
//
//   1. The server's initial SETTINGS frame advertised `ENABLE_PUSH=1`.
//      RFC 9113 §7.2.2 says any value other than 0 for ENABLE_PUSH sent
//      by a server MUST be treated by the client as a PROTOCOL_ERROR.
//
//   2. `res.end("ok")` wrote an extra empty DATA frame followed by an
//      empty trailer HEADERS frame. The compat `Http2ServerResponse`
//      layer sets `waitForTrailers: true` and then unconditionally calls
//      `sendTrailers({})` — Bun was emitting a zero-length trailer block
//      instead of the single empty DATA with END_STREAM that Node sends.
import { test, expect } from "bun:test";
import http2 from "node:http2";
import net from "node:net";
import { once } from "node:events";

function parseFrames(buf: Buffer) {
  const frames: { length: number; type: number; flags: number; streamId: number; payload: Buffer }[] = [];
  let offset = 0;
  while (offset + 9 <= buf.length) {
    const length = buf.readUIntBE(offset, 3);
    const type = buf[offset + 3];
    const flags = buf[offset + 4];
    const streamId = buf.readUInt32BE(offset + 5) & 0x7fffffff;
    if (offset + 9 + length > buf.length) break;
    frames.push({
      length,
      type,
      flags,
      streamId,
      payload: buf.slice(offset + 9, offset + 9 + length),
    });
    offset += 9 + length;
  }
  return frames;
}

// Send a minimal HTTP/2 request over a raw TCP socket (prior-knowledge h2c)
// so we can inspect the exact bytes the server writes. This is what curl
// does with --http2-prior-knowledge.
async function rawH2cRequest(port: number) {
  const preface = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
  // SETTINGS frame (empty payload)
  const settings = Buffer.from([0, 0, 0, 0x04, 0, 0, 0, 0, 0]);

  // HEADERS frame: stream 1, END_HEADERS|END_STREAM.
  // HPACK: :method GET (0x82), :scheme http (0x86), :path / (0x84),
  // :authority localhost:PORT (literal name-indexed 0x41 + length + value).
  const authority = `localhost:${port}`;
  const authLiteral = Buffer.alloc(2 + authority.length);
  authLiteral[0] = 0x41;
  authLiteral[1] = authority.length;
  authLiteral.write(authority, 2);
  const hpack = Buffer.concat([Buffer.from([0x82, 0x86, 0x84]), authLiteral]);
  const headersFrame = Buffer.alloc(9 + hpack.length);
  headersFrame.writeUIntBE(hpack.length, 0, 3);
  headersFrame[3] = 0x01; // HEADERS
  headersFrame[4] = 0x04 | 0x01; // END_HEADERS | END_STREAM
  headersFrame.writeUInt32BE(1, 5); // stream id 1
  hpack.copy(headersFrame, 9);

  const sock = net.connect({ port, host: "127.0.0.1" });
  await once(sock, "connect");
  sock.write(preface);
  sock.write(settings);
  sock.write(headersFrame);

  const chunks: Buffer[] = [];
  sock.on("data", chunk => chunks.push(chunk));
  // Wait for the server to close the connection (after END_STREAM trailer /
  // final DATA frame).
  const timer = setTimeout(() => sock.destroy(), 3000);
  await once(sock, "close");
  clearTimeout(timer);
  return parseFrames(Buffer.concat(chunks));
}

test("http2.createServer serves h2c response with well-formed frames (#29073)", async () => {
  const server = http2.createServer((req, res) => {
    res.setHeader("X-Foo", "bar");
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
  });
  await once(server.listen(0), "listening");
  try {
    const port = (server.address() as net.AddressInfo).port;
    const frames = await rawH2cRequest(port);

    // A) The server's initial SETTINGS frame must not advertise
    // ENABLE_PUSH != 0 — that's a connection error per RFC 9113 §7.2.2.
    const serverSettings = frames.find(f => f.type === 4 && (f.flags & 0x1) === 0);
    expect(serverSettings).toBeDefined();
    // Walk settings entries (6 bytes each: 2-byte id, 4-byte value) and
    // assert there is no ENABLE_PUSH setting with a nonzero value.
    const settingsPayload = serverSettings!.payload;
    for (let i = 0; i + 6 <= settingsPayload.length; i += 6) {
      const id = settingsPayload.readUInt16BE(i);
      const value = settingsPayload.readUInt32BE(i + 2);
      if (id === 0x02) {
        // SETTINGS_ENABLE_PUSH
        expect(value).toBe(0);
      }
    }

    // B) The response HEADERS frame should be present on stream 1.
    const responseHeaders = frames.find(f => f.type === 1 && f.streamId === 1);
    expect(responseHeaders).toBeDefined();

    // C) Exactly one DATA frame should carry the body payload; the stream
    // must be terminated by a DATA frame with END_STREAM, NOT by a
    // trailer HEADERS frame with an empty header block. Empty trailer
    // blocks are rejected by strict peers (nghttp2 callback failure).
    const stream1Data = frames.filter(f => f.type === 0 && f.streamId === 1);
    expect(stream1Data.length).toBeGreaterThanOrEqual(1);
    const bodyBytes = Buffer.concat(stream1Data.map(f => f.payload));
    expect(bodyBytes.toString("utf8")).toBe("ok");
    // The last DATA frame on stream 1 must carry END_STREAM.
    const lastData = stream1Data[stream1Data.length - 1];
    expect(lastData.flags & 0x1).toBe(0x1);

    // There must be no trailer HEADERS frame emitted by the server on
    // stream 1 after the response headers (would be a second HEADERS
    // frame on the same stream).
    const stream1Headers = frames.filter(f => f.type === 1 && f.streamId === 1);
    expect(stream1Headers).toHaveLength(1);
  } finally {
    server.close();
  }
});

// Exercise the exact client→server path from the issue (curl prior
// knowledge succeeds, so Node's http2 client should too against Bun).
test("http2.connect client can read h2c response from http2.createServer (#29073)", async () => {
  const server = http2.createServer((req, res) => {
    res.setHeader("X-Foo", "bar");
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
  });
  await once(server.listen(0), "listening");
  try {
    const port = (server.address() as net.AddressInfo).port;
    const client = http2.connect(`http://127.0.0.1:${port}`);
    try {
      const req = client.request({ ":path": "/" });
      req.setEncoding("utf8");

      const { promise, resolve, reject } = Promise.withResolvers<{ status: number; body: string }>();
      let body = "";
      let status = 0;
      req.on("response", headers => {
        status = headers[":status"] as number;
      });
      req.on("data", chunk => {
        body += chunk;
      });
      req.on("end", () => resolve({ status, body }));
      req.on("error", reject);
      req.end();

      const result = await promise;
      expect(result).toEqual({ status: 200, body: "ok" });
    } finally {
      client.close();
    }
  } finally {
    server.close();
  }
});
