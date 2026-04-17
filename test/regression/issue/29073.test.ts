// https://github.com/oven-sh/bun/issues/29073
//
// `node:http2.createServer` fails for h2c (cleartext HTTP/2).
//
// Two separate bugs caused strict HTTP/2 peers (curl's nghttp2, Node's
// http2 client) to reject Bun's server with "callback failure":
//
//   1. The server's initial SETTINGS frame advertised `ENABLE_PUSH=1`.
//      RFC 9113 §6.5.2 says any value other than 0 for ENABLE_PUSH sent
//      by a server MUST be treated by the client as a PROTOCOL_ERROR.
//
//   2. `res.end("ok")` wrote an extra empty DATA frame followed by an
//      empty trailer HEADERS frame. The compat `Http2ServerResponse`
//      layer sets `waitForTrailers: true` and then unconditionally calls
//      `sendTrailers({})` — Bun was emitting a zero-length trailer block
//      instead of the single empty DATA with END_STREAM that Node sends.
import { expect, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";

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
//
// HTTP/2 keeps the TCP connection open after a stream ends — only the stream
// half-closes via END_STREAM on the final DATA (or trailer HEADERS) frame.
// So we can't wait for socket "close"; instead, parse frames as they arrive
// and resolve as soon as we see the stream's terminating frame. This also
// catches the bug case where Bun used to emit an empty trailer HEADERS with
// END_STREAM — that path also ends the stream, so the test is driven by the
// actual wire behaviour rather than a timeout backstop.
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

  const { promise, resolve, reject } = Promise.withResolvers<ReturnType<typeof parseFrames>>();
  let buf = Buffer.alloc(0);
  sock.on("data", chunk => {
    buf = Buffer.concat([buf, chunk]);
    // Scan for stream 1's terminating frame: DATA or HEADERS with END_STREAM.
    let offset = 0;
    while (offset + 9 <= buf.length) {
      const len = buf.readUIntBE(offset, 3);
      if (offset + 9 + len > buf.length) break;
      const type = buf[offset + 3];
      const flags = buf[offset + 4];
      const sid = buf.readUInt32BE(offset + 5) & 0x7fffffff;
      if (sid === 1 && (type === 0 || type === 1) && (flags & 0x1) === 0x1) {
        const frames = parseFrames(buf);
        sock.destroy();
        resolve(frames);
        return;
      }
      offset += 9 + len;
    }
  });
  sock.on("error", reject);
  sock.on("close", () => resolve(parseFrames(buf)));
  return promise;
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
    // ENABLE_PUSH != 0 — that's a connection error per RFC 9113 §6.5.2.
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

// RFC 9113 §6.5.2 is unconditional: a server MUST NOT advertise
// SETTINGS_ENABLE_PUSH != 0. The override must apply even when the
// caller explicitly passes `enablePush: true` in createServer settings —
// the spread order inside ServerHttp2Session puts `enablePush: false`
// last so user-supplied settings can't re-enable push.
test("http2.createServer forces enablePush=0 even when caller requests true (#29073)", async () => {
  const server = http2.createServer({ settings: { enablePush: true } }, (req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
  });
  await once(server.listen(0), "listening");
  try {
    const port = (server.address() as net.AddressInfo).port;
    const frames = await rawH2cRequest(port);

    const serverSettings = frames.find(f => f.type === 4 && (f.flags & 0x1) === 0);
    expect(serverSettings).toBeDefined();
    const settingsPayload = serverSettings!.payload;
    for (let i = 0; i + 6 <= settingsPayload.length; i += 6) {
      const id = settingsPayload.readUInt16BE(i);
      const value = settingsPayload.readUInt32BE(i + 2);
      if (id === 0x02) {
        // SETTINGS_ENABLE_PUSH must be 0 regardless of caller input.
        expect(value).toBe(0);
      }
    }

    // And the response still arrives intact.
    const stream1Data = frames.filter(f => f.type === 0 && f.streamId === 1);
    const bodyBytes = Buffer.concat(stream1Data.map(f => f.payload));
    expect(bodyBytes.toString("utf8")).toBe("ok");
    const lastData = stream1Data[stream1Data.length - 1];
    expect(lastData.flags & 0x1).toBe(0x1);
  } finally {
    server.close();
  }
});

// RFC 9113 §6.5.2 is unconditional for BOTH the initial SETTINGS frame AND
// any subsequent SETTINGS updates the server sends mid-connection. A caller
// that passes `enablePush: true` to session.settings(...) on a server
// session must not re-enable push on the wire. ServerHttp2Session.settings
// force-overrides the value before forwarding to the parser.
test("ServerHttp2Session.settings forces enablePush=0 mid-connection (#29073)", async () => {
  const server = http2.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
  });
  // Attempt to re-enable push mid-connection as soon as the session comes up.
  server.on("session", session => {
    try {
      session.settings({ enablePush: true });
    } catch {
      // Node throws on invalid settings; Bun may or may not — either way,
      // the wire assertion below is the real guarantee.
    }
  });
  await once(server.listen(0), "listening");
  try {
    const port = (server.address() as net.AddressInfo).port;
    const frames = await rawH2cRequest(port);

    // Check EVERY non-ACK SETTINGS frame the server sent: initial + any
    // updates. None may advertise ENABLE_PUSH != 0.
    const serverSettings = frames.filter(f => f.type === 4 && (f.flags & 0x1) === 0);
    expect(serverSettings.length).toBeGreaterThanOrEqual(1);
    for (const frame of serverSettings) {
      const payload = frame.payload;
      for (let i = 0; i + 6 <= payload.length; i += 6) {
        const id = payload.readUInt16BE(i);
        const value = payload.readUInt32BE(i + 2);
        if (id === 0x02) {
          // SETTINGS_ENABLE_PUSH
          expect(value).toBe(0);
        }
      }
    }
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

// `stream.respond()` forces endStream=true for 204/205/304 and HEAD.
// The HEADERS frame carries END_STREAM, so the stream is already
// half-closed when `_final` fires. If the compat layer's waitForTrailers
// path runs on such a stream, it would call `noTrailers` (or emit
// `wantTrailers` and then `sendTrailers`) on an already-ended stream,
// corrupting state. The guard in `respond()` gates the trailer tracking
// on `!endStream` to keep 204/304/HEAD handlers safe.
test("http2.createServer responds with 204 without corrupting stream state (#29073)", async () => {
  const server = http2.createServer((req, res) => {
    res.writeHead(204);
    res.end();
  });
  await once(server.listen(0), "listening");
  try {
    const port = (server.address() as net.AddressInfo).port;
    const client = http2.connect(`http://127.0.0.1:${port}`);
    try {
      const { promise, resolve, reject } = Promise.withResolvers<{ status: number; body: string }>();
      const req = client.request({ ":path": "/" });
      req.setEncoding("utf8");
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
      expect(result).toEqual({ status: 204, body: "" });
    } finally {
      client.close();
    }
  } finally {
    server.close();
  }
});

// Wire-level check for the above. Bun's own http2.connect client is lenient
// about a DATA frame following HEADERS+END_STREAM, so the previous test
// passes even when the server violates RFC 9113 §5.1. Inspect the raw
// frames: a 204 must terminate via HEADERS+END_STREAM with NO subsequent
// DATA frame. Before the fix, respond() forwarded waitForTrailers:true to
// the native layer alongside the forced endStream:true, and native
// request() dispatched onWantTrailers AFTER writing HEADERS+END_STREAM —
// the compat trailers handler then called noTrailers → sendData("", true)
// emitting a spurious empty DATA frame on the already-half-closed stream.
test("http2.createServer 204 terminates via HEADERS+END_STREAM with no spurious DATA (#29073)", async () => {
  const server = http2.createServer((req, res) => {
    res.writeHead(204);
    res.end();
  });
  await once(server.listen(0), "listening");
  try {
    const port = (server.address() as net.AddressInfo).port;
    const frames = await rawH2cRequest(port);

    // The response HEADERS frame on stream 1 must carry END_STREAM.
    const stream1Headers = frames.filter(f => f.type === 1 && f.streamId === 1);
    expect(stream1Headers).toHaveLength(1);
    expect(stream1Headers[0].flags & 0x1).toBe(0x1);

    // RFC 9113 §5.1: after HEADERS+END_STREAM the stream is half-closed
    // (local); the server MUST NOT send DATA on it. A DATA frame here is
    // exactly what strict peers (nghttp2) reject as STREAM_CLOSED.
    const stream1Data = frames.filter(f => f.type === 0 && f.streamId === 1);
    expect(stream1Data).toHaveLength(0);
  } finally {
    server.close();
  }
});
