/**
 * Session teardown while a stream's body is blocked on flow control: the teardown must not emit
 * 'drain' on the stream, and the stream must not accept another write afterwards. Also, a stream
 * that session.destroy() tears down must not end cleanly on the wire behind the GOAWAY.
 *
 * The teardown runs the streams' listeners. What they read from the session is the second half of
 * this file: destroyed from the moment destroy() starts, not destroyed yet when the socket closes.
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
const F = { DATA: 0, HEADERS: 1, RST_STREAM: 3, SETTINGS: 4, PING: 6, GOAWAY: 7, WINDOW_UPDATE: 8 };
const NAMES = { [F.DATA]: "DATA", [F.HEADERS]: "HEADERS", [F.RST_STREAM]: "RST_STREAM", [F.GOAWAY]: "GOAWAY" };
const CONTROL_NAMES = { [F.SETTINGS]: "SETTINGS", [F.PING]: "PING", [F.WINDOW_UPDATE]: "WINDOW_UPDATE" };
// A SETTINGS payload: SETTINGS_MAX_CONCURRENT_STREAMS (0x3) = 1.
const ONE_STREAM_AT_A_TIME = Buffer.from([0, 3, 0, 0, 0, 1]);

function frame(type: number, flags: number, streamId: number, payload: Buffer = Buffer.alloc(0)) {
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
    headers.flatMap(([k, v]) => [
      Buffer.from([0x00, k.length]),
      Buffer.from(k),
      Buffer.from([v.length]),
      Buffer.from(v),
    ]),
  );
}

/**
 * One raw h2c endpoint on `socket`. It answers SETTINGS and PING and never sends WINDOW_UPDATE, so
 * a body larger than the initial window stays queued in the bun side under test.
 *   frames           the DATA/HEADERS/RST_STREAM/GOAWAY frames received, as strings
 *   control          the SETTINGS, PING and WINDOW_UPDATE frames received that are not an ACK
 *   gotData          settles on the first DATA frame with a payload
 *   windowExhausted  settles once a full window of DATA arrived: the sender is now blocked
 *   closed           settles when the socket closes
 * `settings` is the payload of the SETTINGS frame a raw server sends.
 */
function rawPeer(socket: net.Socket, { isServer, settings }: { isServer: boolean; settings?: Buffer }) {
  const frames: string[] = [];
  const control: string[] = [];
  const gotData = Promise.withResolvers<void>();
  const windowExhausted = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  let buf: Buffer = Buffer.alloc(0);
  let prefaceSeen = !isServer;
  let received = 0;
  socket.on("error", () => {});
  socket.on("close", () => closed.resolve());
  socket.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    if (!prefaceSeen) {
      if (buf.length < PREFACE.length) return;
      prefaceSeen = true;
      buf = buf.subarray(PREFACE.length);
      socket.write(frame(F.SETTINGS, 0, 0, settings));
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
      if (type in CONTROL_NAMES && !(flags & 1 /* ACK */)) control.push(CONTROL_NAMES[type]);
      if (type === F.DATA && len > 0) {
        gotData.resolve();
        if ((received += len) >= INITIAL_WINDOW) windowExhausted.resolve();
      }
    }
  });
  return {
    socket,
    frames,
    control,
    gotData: gotData.promise,
    windowExhausted: windowExhausted.promise,
    closed: closed.promise,
  };
}
type Peer = ReturnType<typeof rawPeer>;

/** A raw h2c server for one connection, and the client session connected to it. */
async function clientAgainstRawServer(settings?: Buffer) {
  const peer = Promise.withResolvers<Peer>();
  const server = net.createServer(socket => peer.resolve(rawPeer(socket, { isServer: true, settings })));
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

/**
 * An http2 server, and a raw h2c client that has sent one request to it on each of `streamIds`.
 * `onRequest` is the compat 'request' listener.
 */
async function rawClientAgainstServer(
  onStream: (stream: http2.ServerHttp2Stream) => void,
  {
    streamIds = [1],
    onRequest,
  }: {
    streamIds?: number[];
    onRequest?: (req: http2.Http2ServerRequest, res: http2.Http2ServerResponse) => void;
  } = {},
) {
  const session = Promise.withResolvers<http2.ServerHttp2Session>();
  const server = http2.createServer();
  server.on("session", s => {
    s.on("error", () => {});
    session.resolve(s);
  });
  server.on("stream", onStream);
  if (onRequest) server.on("request", onRequest);
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
  for (const id of streamIds) socket.write(frame(F.HEADERS, 0x4 /* END_HEADERS */, id, hpack(request)));
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

const INVALID = "ERR_HTTP2_INVALID_SESSION";
// Node marks the session destroyed before it destroys a stream.
const DESTROYED = {
  destroyed: true,
  streamSession: true,
  ping: INVALID,
  settings: INVALID,
  goaway: INVALID,
  setLocalWindowSize: INVALID,
};
// Node's socketOnClose closes the streams first. The session still takes the calls.
const NOT_DESTROYED_YET = {
  destroyed: false,
  streamSession: true,
  ping: true,
  settings: undefined,
  goaway: undefined,
  setLocalWindowSize: undefined,
};

function resultOrCode(fn: () => unknown) {
  try {
    return fn();
  } catch (e) {
    return (e as NodeJS.ErrnoException).code;
  }
}

/** What a listener of `stream` reads from its session, and what the session does with its calls. */
function readSession(session: http2.Http2Session, stream: http2.Http2Stream) {
  return {
    destroyed: session.destroyed,
    streamSession: stream.session === session,
    ping: resultOrCode(() => session.ping(() => {})),
    settings: resultOrCode(() => session.settings({})),
    goaway: resultOrCode(() => session.goaway()),
    setLocalWindowSize: resultOrCode(() => session.setLocalWindowSize(1 << 20)),
  };
}

function errorGoaway(lastStreamId: number) {
  const payload = Buffer.alloc(8);
  payload.writeUInt32BE(lastStreamId, 0);
  payload.writeUInt32BE(http2.constants.NGHTTP2_INTERNAL_ERROR, 4);
  return frame(F.GOAWAY, 0, 0, payload);
}

const teardowns: {
  name: string;
  run(session: http2.Http2Session, peer: Peer, lastStreamId: number): void;
  expected: object;
}[] = [
  { name: "session.destroy()", run: session => session.destroy(), expected: DESTROYED },
  { name: "session.destroy(err)", run: session => session.destroy(new Error("boom")), expected: DESTROYED },
  {
    name: "a GOAWAY with an error code",
    run: (_, peer, lastStreamId) => peer.socket.write(errorGoaway(lastStreamId)),
    expected: DESTROYED,
  },
  { name: "the peer closing the socket", run: (_, peer) => peer.socket.destroy(), expected: NOT_DESTROYED_YET },
];

describe("what a stream's 'aborted' listener reads from its session", () => {
  for (const { name, run, expected } of teardowns) {
    test(`client session, ${name}`, async () => {
      const { session, peer, close } = await clientAgainstRawServer();
      try {
        const stream = session.request({ ":path": "/upload", ":method": "POST" });
        stream.on("error", () => {});
        const seen = Promise.withResolvers<object>();
        stream.once("aborted", () => seen.resolve(readSession(session, stream)));
        stream.write(Buffer.alloc(1000, 0x41));
        await peer.gotData;

        // The last-stream-id is the open stream, so session.destroy() is what tears it down.
        run(session, peer, 1);
        assert.deepStrictEqual(await seen.promise, expected);
      } finally {
        close();
      }
    });

    test(`server session, ${name}`, async () => {
      const seen = Promise.withResolvers<object>();
      const { session, peer, close } = await rawClientAgainstServer(stream => {
        const session = stream.session!;
        stream.on("error", () => {});
        stream.once("aborted", () => seen.resolve(readSession(session, stream)));
        stream.respond({ ":status": 200 });
        stream.write(Buffer.alloc(1000, 0x41));
      });
      try {
        await peer.gotData;

        run(session, peer, 0);
        assert.deepStrictEqual(await seen.promise, expected);
      } finally {
        close();
      }
    });
  }

  test("client session.destroy(): a request() made in the listener fails with ERR_HTTP2_INVALID_SESSION", async () => {
    const { session, peer, close } = await clientAgainstRawServer();
    try {
      const stream = session.request({ ":path": "/upload", ":method": "POST" });
      stream.on("error", () => {});
      const failed = Promise.withResolvers<string | undefined>();
      stream.once("aborted", () => {
        const second = session.request({ ":path": "/second" });
        second.on("error", err => failed.resolve((err as NodeJS.ErrnoException).code));
        second.on("close", () => failed.resolve(undefined));
      });
      stream.write(Buffer.alloc(1000, 0x41));
      await peer.gotData;

      session.destroy();
      assert.strictEqual(await failed.promise, INVALID);
    } finally {
      close();
    }
  });

  test("server session.destroy(): a stream the teardown has not reached yet still reports its state", async () => {
    const streams: http2.ServerHttp2Stream[] = [];
    const bothOpen = Promise.withResolvers<void>();
    const seen = Promise.withResolvers<object>();
    const { session, close } = await rawClientAgainstServer(
      stream => {
        const session = stream.session!;
        stream.on("error", () => {});
        stream.once("aborted", () => {
          const sibling = streams.find(other => other !== stream)!;
          seen.resolve({
            ownState: Object.keys(stream.state).length > 0,
            siblingDestroyed: sibling.destroyed,
            siblingState: Object.keys(sibling.state).length > 0,
            siblingPushAllowed: sibling.pushAllowed,
            sessionState: Object.keys(session.state).length > 0,
          });
        });
        stream.respond({ ":status": 200 });
        if (streams.push(stream) === 2) bothOpen.resolve();
      },
      { streamIds: [1, 3] },
    );
    try {
      await bothOpen.promise;
      const pushAllowedBefore = streams.map(stream => stream.pushAllowed);

      session.destroy();
      assert.deepStrictEqual(
        { pushAllowedBefore, ...(await seen.promise) },
        {
          pushAllowedBefore: [true, true],
          ownState: false,
          siblingDestroyed: false,
          siblingState: true,
          siblingPushAllowed: false,
          sessionState: false,
        },
      );
    } finally {
      close();
    }
  });

  test("server session.destroy(): a compat request still reaches its socket in the listener", async () => {
    const seen = Promise.withResolvers<string>();
    const { session, peer, close } = await rawClientAgainstServer(() => {}, {
      onRequest(req, res) {
        req.on("error", () => {});
        res.on("error", () => {});
        req.once("aborted", () => seen.resolve(typeof req.socket.remoteAddress));
        res.writeHead(200);
        res.write(Buffer.alloc(1000, 0x41));
      },
    });
    try {
      await peer.gotData;

      session.destroy();
      assert.strictEqual(await seen.promise, "string");
    } finally {
      close();
    }
  });

  test("server socket close: the stream reads rstCode 8 and gets no 'wantTrailers'", async () => {
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    const { peer, close } = await rawClientAgainstServer(stream => {
      stream.on("error", () => {});
      stream.on("aborted", () => events.push(`aborted rstCode=${stream.rstCode}`));
      stream.on("wantTrailers", () => events.push("wantTrailers"));
      stream.on("close", () => {
        events.push(`close rstCode=${stream.rstCode}`);
        closed.resolve();
      });
      stream.respond({ ":status": 200 }, { waitForTrailers: true });
      stream.write(Buffer.alloc(1000, 0x41));
    });
    try {
      await peer.gotData;

      peer.socket.destroy();
      await closed.promise;
      assert.deepStrictEqual(events, ["aborted rstCode=8", "close rstCode=8"]);
    } finally {
      close();
    }
  });
});

describe("a queued request's 'aborted' listener", () => {
  // The raw server allows one stream, so the second request waits for a slot.
  async function queuedRequest() {
    const { session, peer, close } = await clientAgainstRawServer(ONE_STREAM_AT_A_TIME);
    const first = session.request({ ":path": "/first", ":method": "POST" });
    first.on("error", () => {});
    first.write(Buffer.alloc(1000, 0x41));
    const queued = session.request({ ":path": "/queued", ":method": "POST" });
    queued.on("error", () => {});
    const sessionDestroyed = Promise.withResolvers<boolean>();
    queued.once("aborted", () => sessionDestroyed.resolve(session.destroyed));
    await peer.gotData;
    return { session, peer, close, sessionDestroyed: sessionDestroyed.promise };
  }

  test("sees the session destroyed in session.destroy()", async () => {
    const { session, close, sessionDestroyed } = await queuedRequest();
    try {
      session.destroy();
      assert.strictEqual(await sessionDestroyed, true);
    } finally {
      close();
    }
  });

  test("sees the session not destroyed yet when the peer closes the socket", async () => {
    const { peer, close, sessionDestroyed } = await queuedRequest();
    try {
      peer.socket.destroy();
      assert.strictEqual(await sessionDestroyed, false);
    } finally {
      close();
    }
  });
});

describe("the callback of a write that session.destroy() drops sees the session destroyed", () => {
  test("client session", async () => {
    const { session, peer, close } = await clientAgainstRawServer();
    try {
      const stream = session.request({ ":path": "/upload", ":method": "POST" });
      stream.on("error", () => {});
      const seen = Promise.withResolvers<boolean>();
      stream.write(BLOCKED_BODY, () => seen.resolve(session.destroyed));
      await peer.windowExhausted;

      session.destroy();
      assert.strictEqual(await seen.promise, true);
    } finally {
      close();
    }
  });

  test("server session", async () => {
    const seen = Promise.withResolvers<boolean>();
    const { session, peer, close } = await rawClientAgainstServer(stream => {
      const session = stream.session!;
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      stream.write(BLOCKED_BODY, () => seen.resolve(session.destroyed));
    });
    try {
      await peer.windowExhausted;

      session.destroy();
      assert.strictEqual(await seen.promise, true);
    } finally {
      close();
    }
  });
});

// The listener calls ping(), settings(), goaway() and setLocalWindowSize(). A destroyed session
// refuses them, so the GOAWAY of the teardown is the last frame.
describe("a listener that calls the session during session.destroy() puts no frame on the wire", () => {
  test("client session", async () => {
    const { session, peer, close } = await clientAgainstRawServer();
    try {
      const stream = session.request({ ":path": "/upload", ":method": "POST" });
      stream.on("error", () => {});
      stream.once("aborted", () => readSession(session, stream));
      stream.write(Buffer.alloc(1000, 0x41));
      await peer.gotData;

      const before = { frames: peer.frames.length, control: peer.control.length };
      session.destroy();
      await peer.closed;

      assert.deepStrictEqual(
        { wire: peer.frames.slice(before.frames), control: peer.control.slice(before.control) },
        { wire: ["GOAWAY"], control: [] },
      );
    } finally {
      close();
    }
  });

  test("server session", async () => {
    const { session, peer, close } = await rawClientAgainstServer(stream => {
      const session = stream.session!;
      stream.on("error", () => {});
      stream.once("aborted", () => readSession(session, stream));
      stream.respond({ ":status": 200 });
      stream.write(Buffer.alloc(1000, 0x41));
    });
    try {
      await peer.gotData;

      const before = { frames: peer.frames.length, control: peer.control.length };
      session.destroy();
      await peer.closed;

      assert.deepStrictEqual(
        { wire: peer.frames.slice(before.frames), control: peer.control.slice(before.control) },
        { wire: ["GOAWAY"], control: [] },
      );
    } finally {
      close();
    }
  });
});
