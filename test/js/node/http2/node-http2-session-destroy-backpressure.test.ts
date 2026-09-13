/**
 * Session teardown while a stream's body is blocked on flow control: the teardown must not emit
 * 'drain' on the stream, and the stream must not accept another write afterwards. Also, a stream
 * that session.destroy() tears down must not end cleanly on the wire behind the GOAWAY.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-session-destroy-backpressure.test.ts
 *   node --test test/js/node/http2/node-http2-session-destroy-backpressure.test.ts
 */
import assert from "node:assert";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import { describe, test } from "node:test";

const INITIAL_WINDOW = 65535;
const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
const F = { DATA: 0, HEADERS: 1, RST_STREAM: 3, SETTINGS: 4, PING: 6, GOAWAY: 7 };
const NAMES = { [F.DATA]: "DATA", [F.HEADERS]: "HEADERS", [F.RST_STREAM]: "RST_STREAM", [F.GOAWAY]: "GOAWAY" };

function frame(type: number, flags: number, streamId: number, payload = Buffer.alloc(0)) {
  const b = Buffer.alloc(9 + payload.length);
  b.writeUIntBE(payload.length, 0, 3);
  b[3] = type;
  b[4] = flags;
  b.writeUInt32BE(streamId >>> 0, 5);
  payload.copy(b, 9);
  return b;
}

// HPACK "literal header field without indexing, new name" for each pair.
function hpack(headers: [string, string][]) {
  return Buffer.concat(
    headers.flatMap(([k, v]) => [Buffer.from([0x00, k.length]), Buffer.from(k), Buffer.from([v.length]), Buffer.from(v)]),
  );
}

/**
 * One raw h2c endpoint on `socket`. It answers SETTINGS and PING and never sends WINDOW_UPDATE, so
 * a body larger than the initial window stays queued in the bun side under test.
 *   frames           the DATA/HEADERS/RST_STREAM/GOAWAY frames received, as strings
 *   gotData          settles on the first DATA frame with a payload
 *   windowExhausted  settles once a full window of DATA arrived: the sender is now blocked
 *   closed           settles when the socket closes
 */
function rawPeer(socket: net.Socket, { isServer }: { isServer: boolean }) {
  const frames: string[] = [];
  const gotData = Promise.withResolvers<void>();
  const windowExhausted = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  let buf = Buffer.alloc(0);
  let prefaceSeen = !isServer;
  let received = 0;
  socket.on("error", () => {});
  socket.on("close", () => closed.resolve());
  socket.on("data", chunk => {
    buf = Buffer.concat([buf, chunk]);
    if (!prefaceSeen) {
      if (buf.length < PREFACE.length) return;
      prefaceSeen = true;
      buf = buf.subarray(PREFACE.length);
      socket.write(frame(F.SETTINGS, 0, 0));
    }
    while (buf.length >= 9) {
      const len = buf.readUIntBE(0, 3);
      if (buf.length < 9 + len) break;
      const type = buf[3];
      const flags = buf[4];
      const payload = buf.subarray(9, 9 + len);
      buf = buf.subarray(9 + len);
      if (type === F.SETTINGS && !(flags & 1)) socket.write(frame(F.SETTINGS, 1, 0));
      else if (type === F.PING && !(flags & 1)) socket.write(frame(F.PING, 1, 0, payload));
      if (type in NAMES) {
        const endStream = (type === F.DATA || type === F.HEADERS) && flags & 1 ? " END_STREAM" : "";
        frames.push(NAMES[type] + endStream);
      }
      if (type === F.DATA && len > 0) {
        gotData.resolve();
        if ((received += len) >= INITIAL_WINDOW) windowExhausted.resolve();
      }
    }
  });
  return {
    socket,
    frames,
    gotData: gotData.promise,
    windowExhausted: windowExhausted.promise,
    closed: closed.promise,
  };
}

/** A raw h2c server for one connection, and the client session connected to it. */
async function clientAgainstRawServer() {
  const peer = Promise.withResolvers<ReturnType<typeof rawPeer>>();
  const server = net.createServer(socket => peer.resolve(rawPeer(socket, { isServer: true })));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const session = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
  session.on("error", () => {});
  await once(session, "remoteSettings");
  return {
    session,
    peer: await peer.promise,
    close() {
      session.destroy();
      server.close();
    },
  };
}

/** An http2 server, and a raw h2c client that has sent one request (stream 1) to it. */
async function rawClientAgainstServer(onStream: (stream: http2.ServerHttp2Stream) => void) {
  const session = Promise.withResolvers<http2.ServerHttp2Session>();
  const server = http2.createServer();
  server.on("session", s => {
    s.on("error", () => {});
    session.resolve(s);
  });
  server.on("stream", onStream);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const socket = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
  const peer = rawPeer(socket, { isServer: false });
  await once(socket, "connect");
  socket.write(PREFACE);
  socket.write(frame(F.SETTINGS, 0, 0));
  const request: [string, string][] = [
    [":method", "POST"],
    [":scheme", "http"],
    [":path", "/"],
    [":authority", "localhost"],
  ];
  socket.write(frame(F.HEADERS, 0x4 /* END_HEADERS */, 1, hpack(request)));
  return {
    session: await session.promise,
    peer,
    close() {
      socket.destroy();
      server.close();
    },
  };
}

/** The usual producer: on 'drain', write until write() reports backpressure again. */
function produceOnDrain(stream: http2.Http2Stream) {
  const seen = { drains: 0, accepted: 0 };
  stream.on("drain", () => {
    seen.drains++;
    for (let budget = 32; budget > 0 && stream.write(Buffer.alloc(16384)); budget--) seen.accepted++;
  });
  return seen;
}

/**
 * Not events.once(): that rejects on the stream's 'error', which is not under test here. Settles a
 * turn after 'close' so that a late 'drain' is still counted.
 */
function closedAndSettled(stream: http2.Http2Stream) {
  const { promise, resolve } = Promise.withResolvers<void>();
  stream.on("close", () => setImmediate(resolve));
  return promise;
}

function recordEvents(stream: http2.Http2Stream) {
  const events: string[] = [];
  for (const name of ["aborted", "finish", "end", "close"]) stream.on(name, () => events.push(name));
  return events;
}

// One window goes out at once. The other 32 KiB stays queued with the write callback held.
const BLOCKED_BODY = Buffer.alloc(INITIAL_WINDOW + 32768, 0x41);

describe("a flow-control-blocked write gets no 'drain' and the stream accepts no more writes", () => {
  test("when the client session is destroyed", async () => {
    const { session, peer, close } = await clientAgainstRawServer();
    try {
      const stream = session.request({ ":path": "/upload", ":method": "POST" });
      stream.on("error", () => {});
      const backpressured = !stream.write(BLOCKED_BODY);
      const seen = produceOnDrain(stream);
      await peer.windowExhausted;

      const closed = closedAndSettled(stream);
      session.destroy();
      await closed;

      assert.deepStrictEqual({ backpressured, ...seen }, { backpressured: true, drains: 0, accepted: 0 });
    } finally {
      close();
    }
  });

  test("when the server session's socket closes", async () => {
    const result = Promise.withResolvers<object>();
    const { peer, close } = await rawClientAgainstServer(stream => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      const backpressured = !stream.write(BLOCKED_BODY);
      const seen = produceOnDrain(stream);
      closedAndSettled(stream).then(() => result.resolve({ backpressured, ...seen }));
    });
    try {
      await peer.windowExhausted;
      peer.socket.destroy();
      assert.deepStrictEqual(await result.promise, { backpressured: true, drains: 0, accepted: 0 });
    } finally {
      close();
    }
  });

  test("when the server session receives a GOAWAY with an error code", async () => {
    const result = Promise.withResolvers<object>();
    const { peer, close } = await rawClientAgainstServer(stream => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      const backpressured = !stream.write(BLOCKED_BODY);
      const seen = produceOnDrain(stream);
      closedAndSettled(stream).then(() => result.resolve({ backpressured, ...seen }));
    });
    try {
      await peer.windowExhausted;
      const goaway = Buffer.alloc(8);
      goaway.writeUInt32BE(0, 0); // last stream id
      goaway.writeUInt32BE(http2.constants.NGHTTP2_INTERNAL_ERROR, 4);
      peer.socket.write(frame(F.GOAWAY, 0, 0, goaway));
      assert.deepStrictEqual(await result.promise, { backpressured: true, drains: 0, accepted: 0 });
    } finally {
      close();
    }
  });
});

// The stream has no 'error' listener and nothing queued: the case where destroy() can still
// reach _final. An END_STREAM here tells the peer that a truncated body is complete.
describe("session.destroy() does not end an open stream on the wire", () => {
  test("client session", async () => {
    const { session, peer, close } = await clientAgainstRawServer();
    try {
      const stream = session.request({ ":path": "/upload", ":method": "POST" });
      const events = recordEvents(stream);
      stream.write(Buffer.alloc(1000, 0x41));
      await peer.gotData;

      const before = peer.frames.length;
      const closed = closedAndSettled(stream);
      session.destroy();
      await Promise.all([closed, peer.closed]);

      assert.deepStrictEqual(
        { events, wire: peer.frames.slice(before) },
        { events: ["aborted", "close"], wire: ["GOAWAY"] },
      );
    } finally {
      close();
    }
  });

  test("server session", async () => {
    const result = Promise.withResolvers<string[]>();
    const { session, peer, close } = await rawClientAgainstServer(stream => {
      const events = recordEvents(stream);
      stream.respond({ ":status": 200 });
      stream.write(Buffer.alloc(1000, 0x41));
      closedAndSettled(stream).then(() => result.resolve(events));
    });
    try {
      await peer.gotData;

      const before = peer.frames.length;
      session.destroy();
      const [events] = await Promise.all([result.promise, peer.closed]);

      assert.deepStrictEqual(
        { events, wire: peer.frames.slice(before) },
        { events: ["aborted", "close"], wire: ["GOAWAY"] },
      );
    } finally {
      close();
    }
  });
});
