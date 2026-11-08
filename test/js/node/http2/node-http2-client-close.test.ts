/**
 * Http2Stream.close(code) event contract, client and server, while the peer's half is still open:
 *   NO_ERROR / CANCEL  -> 'end', 'close'             (documented 'error' exemption)
 *   any other code     -> 'error', 'close'           (no 'end': the body was killed by RST_STREAM)
 * Once the peer's half has ended (END_STREAM on a HEADERS frame, or a server push, which has no
 * inbound half) the readable already has its EOF, so 'end' comes first for every code.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-client-close.test.ts
 *   node --test test/js/node/http2/node-http2-client-close.test.ts
 */
import assert from "node:assert";
import http2 from "node:http2";
import dc from "node:diagnostics_channel";
import fs from "node:fs";
import net from "node:net";
import { Duplex, Readable, pipeline } from "node:stream";
import { describe, test } from "node:test";

const { NGHTTP2_NO_ERROR, NGHTTP2_CANCEL, NGHTTP2_INTERNAL_ERROR, NGHTTP2_REFUSED_STREAM, NGHTTP2_ENHANCE_YOUR_CALM } =
  http2.constants;

const F = { DATA: 0, HEADERS: 1, RST_STREAM: 3, SETTINGS: 4, PING: 6 };
const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
const frame = (t: number, fl: number, sid: number, p: Buffer = Buffer.alloc(0)) => {
  const b = Buffer.alloc(9 + p.length);
  b.writeUIntBE(p.length, 0, 3);
  b[3] = t;
  b[4] = fl;
  b.writeUInt32BE(sid >>> 0, 5);
  p.copy(b, 9);
  return b;
};
const hp = (h: [string, string][]) =>
  Buffer.concat(
    h.map(([k, v]) =>
      Buffer.concat([Buffer.from([0x10, k.length]), Buffer.from(k), Buffer.from([v.length]), Buffer.from(v)]),
    ),
  );
const rstStream = (sid: number, code: number) => {
  const payload = Buffer.alloc(4);
  payload.writeUInt32BE(code);
  return frame(F.RST_STREAM, 0, sid, payload);
};
type RawFrame = { type: number; flags: number; payload: Buffer };

// What a raw h2c server answers to a request's HEADERS frame.
type RawAnswer = (socket: net.Socket, sid: number) => void;
// 200 + one DATA frame and never END_STREAM, so the only way the stream ends is via the client's close(code).
const answerOpen: RawAnswer = (s, sid) => {
  s.write(frame(F.HEADERS, 0x4, sid, hp([[":status", "200"]])));
  s.write(frame(F.DATA, 0, sid, Buffer.alloc(600, 0x2e)));
};
// RST_STREAM alone.
const answerReset =
  (code: number): RawAnswer =>
  (s, sid) =>
    s.write(rstStream(sid, code));

// Raw h2c server. `frames` gets every frame of a stream that the client sends.
function rawH2Server(answer: RawAnswer = answerOpen, frames?: RawFrame[], settings = Buffer.alloc(0)): net.Server {
  return net.createServer(s => {
    let buf = Buffer.alloc(0);
    let pre = false;
    s.on("error", () => {});
    s.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (!pre) {
        if (buf.length < PREFACE.length) return;
        pre = true;
        buf = buf.slice(PREFACE.length);
        s.write(frame(F.SETTINGS, 0, 0, settings));
      }
      while (buf.length >= 9) {
        const len = buf.readUIntBE(0, 3);
        if (buf.length < 9 + len) break;
        const t = buf[3];
        const fl = buf[4];
        const sid = buf.readUInt32BE(5) & 0x7fffffff;
        const pay = buf.slice(9, 9 + len);
        buf = buf.slice(9 + len);
        if (sid !== 0) frames?.push({ type: t, flags: fl, payload: pay });
        if (t === F.SETTINGS && !(fl & 1)) s.write(frame(F.SETTINGS, 1, 0));
        else if (t === F.PING && !(fl & 1)) s.write(frame(F.PING, 1, 0, pay));
        else if (t === F.HEADERS) answer(s, sid);
      }
    });
  });
}

// The bytes of a raw h2c client that opens stream 1 with a POST and 3,000 bytes of a body that stays open.
const rawPost = () =>
  Buffer.concat([
    PREFACE,
    frame(F.SETTINGS, 0, 0),
    frame(
      F.HEADERS,
      0x4 /* END_HEADERS */,
      1,
      hp([
        [":method", "POST"],
        [":scheme", "http"],
        [":path", "/"],
        [":authority", "localhost"],
      ]),
    ),
    frame(F.DATA, 0, 1, Buffer.alloc(3000)),
  ]);

function listen(server: net.Server | http2.Http2Server): Promise<number> {
  return new Promise(resolve =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
  );
}

// Collects the frames that the peer of a raw h2c client sends on its streams. `pong` runs at a PING ACK.
function collectFrames(socket: net.Socket, frames: RawFrame[], pong: () => void) {
  let buf = Buffer.alloc(0);
  socket.on("data", (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 9 && buf.length >= 9 + buf.readUIntBE(0, 3)) {
      const len = buf.readUIntBE(0, 3);
      const [type, flags] = [buf[3], buf[4]];
      if ((buf.readUInt32BE(5) & 0x7fffffff) !== 0) frames.push({ type, flags, payload: buf.slice(9, 9 + len) });
      else if (type === F.PING && flags & 1) pong();
      buf = buf.slice(9 + len);
    }
  });
}

describe("ClientHttp2Stream.close(code) event sequence after data", () => {
  async function collectEvents(port: number, code: number): Promise<string[]> {
    const events: string[] = [];
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();
    const ses = http2.connect(`http://127.0.0.1:${port}`);
    ses.on("error", reject);
    ses.on("close", () => resolve(events));
    ses.on("remoteSettings", () => {
      const st = ses.request({ ":path": "/" }, { endStream: true });
      let gotData = false;
      st.on("response", () => events.push("response"));
      st.on("data", () => {
        if (!gotData) {
          gotData = true;
          events.push("data");
          st.close(code);
        }
      });
      st.on("end", () => events.push("end"));
      st.on("error", e => events.push("error:" + (e as NodeJS.ErrnoException).code));
      st.on("close", () => {
        events.push("close:" + st.rstCode);
        ses.destroy();
      });
    });
    return promise;
  }

  for (const [code, expected] of [
    [NGHTTP2_NO_ERROR, ["response", "data", "end", "close:0"]],
    [NGHTTP2_CANCEL, ["response", "data", "end", "close:8"]],
    [NGHTTP2_INTERNAL_ERROR, ["response", "data", "error:ERR_HTTP2_STREAM_ERROR", "close:2"]],
    [NGHTTP2_ENHANCE_YOUR_CALM, ["response", "data", "error:ERR_HTTP2_STREAM_ERROR", "close:11"]],
  ] as const) {
    test(`close(${code})`, async () => {
      const srv = rawH2Server();
      const port = await listen(srv);
      try {
        assert.deepStrictEqual(await collectEvents(port, code), expected);
      } finally {
        srv.close();
      }
    });
  }
});

describe("a request that the server resets before it responds, and that nothing reads", () => {
  for (const [code, expected] of [
    [NGHTTP2_NO_ERROR, ["end", "close:0"]],
    [NGHTTP2_CANCEL, ["close:8"]],
    [NGHTTP2_INTERNAL_ERROR, ["error:ERR_HTTP2_STREAM_ERROR", "close:2"]],
  ] as const) {
    test(`RST_STREAM(${code})`, async () => {
      const srv = rawH2Server(answerReset(code));
      const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
      try {
        const events: string[] = [];
        const { promise, resolve } = Promise.withResolvers<void>();
        const req = client.request({ ":path": "/" }, { endStream: true });
        req.on("response", () => events.push("response"));
        req.on("aborted", () => events.push("aborted"));
        req.on("end", () => events.push("end"));
        req.on("error", e => events.push("error:" + (e as NodeJS.ErrnoException).code));
        req.on("close", () => {
          events.push("close:" + req.rstCode);
          resolve();
        });
        await promise;
        assert.deepStrictEqual(events, expected);
      } finally {
        client.destroy();
        srv.close();
      }
    });
  }
});

test("close(code) on a request whose writable side is open sends one RST_STREAM", async () => {
  const srv = rawH2Server();
  const { promise: accepted, resolve: accept } = Promise.withResolvers<net.Socket>();
  let received = Buffer.alloc(0);
  srv.on("connection", socket => {
    socket.on("data", (chunk: Buffer) => (received = Buffer.concat([received, chunk])));
    accept(socket);
  });
  const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
  try {
    const socket = await accepted;
    const { promise: closed, resolve } = Promise.withResolvers<void>();
    const req = client.request({ ":path": "/" }, { endStream: false });
    req.on("error", () => {});
    req.on("response", () => {
      req.close(NGHTTP2_CANCEL);
      // The client forgets a closed stream when it next reads from the socket. Make that happen before _destroy() runs.
      socket.write(Buffer.from([0, 0, 4, 8 /* WINDOW_UPDATE */, 0, 0, 0, 0, 0, 0, 0, 0, 1]));
    });
    // What _destroy() leaves for the next turn of the event loop is sent by then.
    req.on("close", () => setImmediate(resolve));
    await closed;
    // The server has read everything the client sent before this.
    await new Promise<void>((done, fail) => client.ping(error => (error ? fail(error) : done())));

    const resets: number[] = [];
    for (let at = 24 /* the preface */; at + 9 <= received.length; at += 9 + received.readUIntBE(at, 3)) {
      if (received[at + 3] === 3 /* RST_STREAM */) resets.push(received.readUInt32BE(at + 9));
    }
    assert.deepStrictEqual(resets, [NGHTTP2_CANCEL]);
  } finally {
    client.destroy();
    srv.close();
  }
});

// Closes a request against a real http2 server that never responds. With `whenConnected` the
// request is made after remoteSettings, so it has an id (not pending); without it the request is
// made before the session connects, so it is still pending (no id) when close() runs.
async function closeWithoutResponse(code: number, whenConnected: boolean): Promise<string[]> {
  const server = http2.createServer();
  server.on("stream", stream => {
    stream.on("error", () => {});
    stream.on("close", () => {});
  });
  const port = await listen(server);
  try {
    const events: string[] = [];
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();
    const client = http2.connect(`http://127.0.0.1:${port}`);
    client.on("error", reject);
    const run = () => {
      const req = client.request({ ":path": "/" }, { endStream: true });
      assert.strictEqual(req.pending, !whenConnected);
      req.on("response", () => events.push("response"));
      req.on("data", () => events.push("data"));
      req.on("end", () => events.push("end"));
      req.on("error", e => events.push("error:" + (e as NodeJS.ErrnoException).code));
      req.on("close", () => {
        events.push("close:" + req.rstCode);
        client.close();
        resolve(events);
      });
      req.close(code);
    };
    if (whenConnected) client.on("remoteSettings", run);
    else run();
    return await promise;
  } finally {
    server.close();
  }
}

// Non-pending stream (id assigned) with no response yet: same contract as after data.
describe("ClientHttp2Stream.close(code) before response", () => {
  for (const [code, expected] of [
    [NGHTTP2_NO_ERROR, ["end", "close:0"]],
    [NGHTTP2_CANCEL, ["end", "close:8"]],
    [NGHTTP2_INTERNAL_ERROR, ["error:ERR_HTTP2_STREAM_ERROR", "close:2"]],
    [NGHTTP2_ENHANCE_YOUR_CALM, ["error:ERR_HTTP2_STREAM_ERROR", "close:11"]],
  ] as const) {
    test(`close(${code})`, async () => {
      assert.deepStrictEqual(await closeWithoutResponse(code, true), expected);
    });
  }
});

// Pending stream (no id yet): node's finishCloseStream ends the readable for every code, so 'end'
// precedes the synthesized 'error' here.
describe("ClientHttp2Stream.close(code) while pending", () => {
  for (const [code, expected] of [
    [NGHTTP2_NO_ERROR, ["end", "close:0"]],
    [NGHTTP2_CANCEL, ["end", "close:8"]],
    [NGHTTP2_INTERNAL_ERROR, ["end", "error:ERR_HTTP2_STREAM_ERROR", "close:2"]],
    [NGHTTP2_ENHANCE_YOUR_CALM, ["end", "error:ERR_HTTP2_STREAM_ERROR", "close:11"]],
  ] as const) {
    test(`close(${code})`, async () => {
      assert.deepStrictEqual(await closeWithoutResponse(code, false), expected);
    });
  }
});

// The listeners below call close(code) once the peer's half of the stream has ended. Each one is
// the event of a HEADERS frame that carried END_STREAM (or the pushStream() callback: a server push
// has no inbound half). "server 'stream', request open" is the contrast: no END_STREAM yet.
type Site =
  | "server 'stream'"
  | "server 'stream' after respond()"
  | "server 'stream', request open"
  | "server 'trailers'"
  | "pushStream() callback"
  | "client 'response'"
  | "client 'trailers'";

async function closeIn(site: Site, code: number, defer: boolean): Promise<string[]> {
  const events: string[] = [];
  const { promise, resolve, reject } = Promise.withResolvers<string[]>();
  const watch = (stream: http2.Http2Stream) => {
    stream.on("end", () => events.push("end"));
    stream.on("error", e => events.push("error:" + (e as NodeJS.ErrnoException).code));
    stream.on("close", () => {
      events.push("close:" + stream.rstCode);
      resolve(events);
    });
    stream.resume();
  };
  const close = (stream: http2.Http2Stream) => {
    if (defer) process.nextTick(() => stream.close(code));
    else stream.close(code);
  };
  const ignoreErrors = (stream: http2.Http2Stream) => stream.on("error", () => {});

  const server = http2.createServer();
  server.on("stream", (stream: http2.ServerHttp2Stream) => {
    switch (site) {
      case "server 'stream'":
      case "server 'stream', request open":
        watch(stream);
        close(stream);
        break;
      case "server 'stream' after respond()":
        watch(stream);
        stream.respond({ ":status": 200 }, { endStream: true });
        close(stream);
        break;
      case "server 'trailers'":
        watch(stream);
        stream.respond({ ":status": 200 });
        stream.on("trailers", () => close(stream));
        break;
      case "pushStream() callback":
        ignoreErrors(stream);
        stream.pushStream({ ":path": "/pushed" }, (err, pushed) => {
          if (err) return reject(err);
          watch(pushed);
          close(pushed);
        });
        stream.respond({ ":status": 200 });
        stream.end();
        break;
      case "client 'response'":
        ignoreErrors(stream);
        stream.respond({ ":status": 204 }, { endStream: true });
        break;
      case "client 'trailers'":
        ignoreErrors(stream);
        stream.respond({ ":status": 200 }, { waitForTrailers: true });
        stream.on("wantTrailers", () => stream.sendTrailers({ "x-trailer": "1" }));
        stream.end("body");
        break;
    }
  });
  const port = await listen(server);
  const client = http2.connect(`http://127.0.0.1:${port}`);
  client.on("error", reject);
  client.on("stream", pushed => ignoreErrors(pushed).resume());
  try {
    switch (site) {
      case "server 'trailers'": {
        const req = client.request({ ":path": "/", ":method": "POST" }, { waitForTrailers: true });
        req.on("wantTrailers", () => req.sendTrailers({ "x-trailer": "1" }));
        ignoreErrors(req).resume();
        req.end("body");
        break;
      }
      case "client 'response'":
      case "client 'trailers'": {
        // The request stays open, so nothing but close(code) can close the stream.
        const req = client.request({ ":path": "/", ":method": "POST" });
        watch(req);
        req.on(site === "client 'response'" ? "response" : "trailers", () => close(req));
        break;
      }
      case "server 'stream', request open":
        ignoreErrors(client.request({ ":path": "/", ":method": "POST" })).resume();
        break;
      default:
        ignoreErrors(client.request({ ":path": "/" }, { endStream: true })).resume();
    }
    return await promise;
  } finally {
    client.destroy();
    server.close();
  }
}

const endThenClose = [
  [NGHTTP2_NO_ERROR, ["end", "close:0"]],
  [NGHTTP2_CANCEL, ["end", "close:8"]],
  [NGHTTP2_INTERNAL_ERROR, ["end", "error:ERR_HTTP2_STREAM_ERROR", "close:2"]],
  [NGHTTP2_ENHANCE_YOUR_CALM, ["end", "error:ERR_HTTP2_STREAM_ERROR", "close:11"]],
] as const;
const noEndForErrorCodes = [
  [NGHTTP2_NO_ERROR, ["end", "close:0"]],
  [NGHTTP2_CANCEL, ["end", "close:8"]],
  [NGHTTP2_INTERNAL_ERROR, ["error:ERR_HTTP2_STREAM_ERROR", "close:2"]],
  [NGHTTP2_ENHANCE_YOUR_CALM, ["error:ERR_HTTP2_STREAM_ERROR", "close:11"]],
] as const;

for (const [site, table] of [
  ["server 'stream'", endThenClose],
  ["server 'stream' after respond()", endThenClose],
  ["server 'trailers'", endThenClose],
  ["pushStream() callback", endThenClose],
  ["client 'response'", endThenClose],
  ["client 'trailers'", endThenClose],
  ["server 'stream', request open", noEndForErrorCodes],
] as const) {
  for (const defer of [false, true]) {
    describe(`close(code) ${defer ? "a tick after" : "in"} ${site}`, () => {
      for (const [code, expected] of table) {
        test(`close(${code})`, async () => {
          assert.deepStrictEqual(await closeIn(site, code, defer), expected);
        });
      }
    });
  }
}

describe("session.destroy() with no close() before it", () => {
  const settings = Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0]);
  const listen = (server: net.Server) =>
    new Promise<number>(resolve =>
      server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
    );

  // The peer greets and then never closes its side, so only destroy() itself can close the socket.
  async function destroyed(session: http2.Http2Session, socket: net.Socket) {
    const seen: string[] = [];
    socket.on("close", () => seen.push("socket"));
    const closed = new Promise<void>(resolve => session.on("close", () => (seen.push("session"), resolve())));
    session.destroy();
    await new Promise<void>(resolve => process.nextTick(resolve));
    const atNextTick = [...seen];
    await closed;
    return { atNextTick, seen };
  }
  const expected = { atNextTick: [], seen: ["socket", "session"] };

  test("a client session's 'close' follows its socket's", async () => {
    const peer = net.createServer({ allowHalfOpen: true }, socket => {
      socket.on("error", () => {});
      socket.resume();
      socket.write(settings);
    });
    const port = await listen(peer);
    try {
      const socket = net.connect(port, "127.0.0.1");
      const session = http2.connect(`http://127.0.0.1:${port}`, { createConnection: () => socket });
      session.on("error", () => {});
      await new Promise(resolve => session.once("remoteSettings", resolve));
      assert.deepStrictEqual(await destroyed(session, socket), expected);
    } finally {
      peer.close();
    }
  });

  test("a server session's 'close' follows its socket's", async () => {
    const server = http2.createServer();
    const port = await listen(server);
    const peer = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
    try {
      peer.on("error", () => {});
      peer.resume();
      const socket = new Promise<net.Socket>(resolve => server.once("connection", resolve));
      const session = new Promise<http2.ServerHttp2Session>(resolve => server.once("session", resolve));
      peer.write(Buffer.concat([Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"), settings]));
      (await session).on("error", () => {});
      assert.deepStrictEqual(await destroyed(await session, await socket), expected);
    } finally {
      peer.destroy();
      server.close();
    }
  });

  test("a client session over a Duplex that never emits 'close' still emits its own", async () => {
    const peer = net.createServer({ allowHalfOpen: true }, socket => {
      socket.on("error", () => {});
      socket.resume();
      socket.write(settings);
    });
    const port = await listen(peer);
    const socket = net.connect(port, "127.0.0.1");
    try {
      const transport = new Duplex({
        emitClose: false,
        read() {},
        write: (chunk, encoding, callback) => void socket.write(chunk, encoding, callback),
        destroy: (error, callback) => (socket.destroy(), callback(error)),
      });
      socket.on("data", chunk => transport.push(chunk));
      socket.on("error", () => {});
      const session = http2.connect(`http://127.0.0.1:${port}`, { createConnection: () => transport });
      session.on("error", () => {});
      await new Promise(resolve => session.once("remoteSettings", resolve));
      const closed = new Promise<void>(resolve => session.on("close", resolve));
      session.destroy();
      await closed;
    } finally {
      socket.destroy();
      peer.close();
    }
  });
});

// request() rejects invalid headers one tick later, so the user's close() or destroy() runs first.
describe("closing a request before its invalid headers are rejected keeps rstCode 0 and doesn't emit 'error'", () => {
  const invalidHeaders = {
    "a :path with a space": { ":path": "/a b" },
    "content-length on a DELETE": { ":method": "DELETE", "content-length": "1" },
  };
  const nextTurn = () => new Promise(resolve => setImmediate(resolve));

  for (const [name, headers] of Object.entries(invalidHeaders)) {
    for (const call of ["close", "destroy"] as const) {
      test(`${call}() with ${name}`, async () => {
        const server = http2.createServer();
        const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
        try {
          await new Promise(resolve => client.on("connect", resolve));
          const events: string[] = [];
          const req = client.request(headers);
          req.on("close", () => events.push("close:" + req.rstCode));
          req[call]();
          // close() waits for 'ready' and then queues the RST_STREAM with setImmediate.
          await nextTurn();
          await nextTurn();
          assert.deepStrictEqual(events, ["close:0"]);
        } finally {
          client.destroy();
          server.close();
        }
      });
    }
  }
});

describe("a stream that the peer resets with NO_ERROR while its body is open", () => {
  const atEnd = (stream: http2.Http2Stream) => `end, aborted ${stream.aborted}, closed ${stream.closed}`;

  test("a server stream emits 'aborted' before 'end', and respond() throws", async () => {
    const server = http2.createServer();
    const socket = net.connect(await listen(server), "127.0.0.1");
    const fd = fs.openSync(import.meta.filename, "r");
    try {
      const { promise, resolve } = Promise.withResolvers<string[]>();
      server.on("stream", stream => {
        const events: string[] = [];
        // The client gives up its upload once the server has some of it.
        stream.once("data", () => socket.write(rstStream(1, NGHTTP2_NO_ERROR)));
        stream.on("aborted", () => events.push("aborted, rstCode " + stream.rstCode));
        stream.on("end", () => {
          events.push(atEnd(stream));
          for (const [name, respond] of [
            ["respond()", () => stream.respond({ ":status": 200 })],
            ["respondWithFD()", () => stream.respondWithFD(fd)],
            ["respondWithFile()", () => stream.respondWithFile(import.meta.filename)],
          ] as const) {
            try {
              respond();
              events.push(name + " returned");
            } catch (error) {
              events.push(name + " threw " + (error as NodeJS.ErrnoException).code);
            }
          }
        });
        stream.on("close", () => resolve([...events, "close:" + stream.rstCode]));
      });
      socket.on("error", () => {});
      socket.resume();
      socket.write(rawPost());
      assert.deepStrictEqual(await promise, [
        "aborted, rstCode 0",
        "end, aborted true, closed true",
        "respond() threw ERR_HTTP2_INVALID_STREAM",
        "respondWithFD() threw ERR_HTTP2_INVALID_STREAM",
        "respondWithFile() threw ERR_HTTP2_INVALID_STREAM",
        "close:0",
      ]);
    } finally {
      fs.closeSync(fd);
      socket.destroy();
      server.close();
    }
  });

  test("a server stream whose request already ended is closed at 'aborted'", async () => {
    const server = http2.createServer();
    const socket = net.connect(await listen(server), "127.0.0.1");
    try {
      const { promise, resolve } = Promise.withResolvers<string[]>();
      server.on("stream", stream => {
        const events: string[] = [];
        stream.on("data", () => {});
        // The request is complete. The reset comes after it.
        stream.on("end", () => (events.push("end"), socket.write(rstStream(1, NGHTTP2_NO_ERROR))));
        stream.on("aborted", () => events.push(`aborted, closed ${stream.closed}, destroyed ${stream.destroyed}`));
        stream.on("close", () => resolve([...events, "close:" + stream.rstCode]));
      });
      socket.on("error", () => {});
      socket.resume();
      socket.write(Buffer.concat([rawPost(), frame(F.DATA, 0x1 /* END_STREAM */, 1)]));
      assert.deepStrictEqual(await promise, ["end", "aborted, closed true, destroyed false", "close:0"]);
    } finally {
      socket.destroy();
      server.close();
    }
  });

  for (const [shape, begin] of [
    ["before respond()", () => {}],
    ["after respond()", (stream: http2.ServerHttp2Stream) => stream.respond({ ":status": 200 })],
  ] as const) {
    test(`a server stream that nothing reads emits 'finish', ${shape}`, async () => {
      const server = http2.createServer();
      const socket = net.connect(await listen(server), "127.0.0.1");
      try {
        const { promise, resolve } = Promise.withResolvers<{ events: string[]; writableFinished: boolean }>();
        server.on("stream", stream => {
          const events: string[] = [];
          for (const event of ["aborted", "finish", "end"]) stream.on(event, () => events.push(event));
          stream.on("close", () => resolve({ events, writableFinished: stream.writableFinished }));
          begin(stream);
        });
        socket.on("error", () => {});
        socket.resume();
        // One write: the reset is behind the HEADERS frame that emits 'stream'.
        socket.write(Buffer.concat([rawPost(), rstStream(1, NGHTTP2_NO_ERROR)]));
        assert.deepStrictEqual(await promise, { events: ["aborted", "finish", "end"], writableFinished: true });
      } finally {
        socket.destroy();
        server.close();
      }
    });
  }

  test("a client stream emits 'aborted' before 'end'", async () => {
    const srv = rawH2Server((socket, sid) => {
      answerOpen(socket, sid);
      socket.write(rstStream(sid, NGHTTP2_NO_ERROR));
    });
    const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
    try {
      const events: string[] = [];
      const { promise, resolve } = Promise.withResolvers<void>();
      const req = client.request({ ":path": "/", ":method": "POST" });
      req.on("response", () => events.push("response"));
      req.on("data", () => {});
      req.on("aborted", () => events.push("aborted"));
      req.on("end", () => events.push(atEnd(req)));
      req.on("close", () => {
        events.push("close:" + req.rstCode);
        resolve();
      });
      await promise;
      assert.deepStrictEqual(events, ["response", "aborted", "end, aborted true, closed true", "close:0"]);
    } finally {
      client.destroy();
      srv.close();
    }
  });
});

describe("respond() after close(code)", () => {
  for (const code of [NGHTTP2_INTERNAL_ERROR, NGHTTP2_REFUSED_STREAM]) {
    for (const [when, wait] of [
      ["in the same turn", () => {}],
      ["one microtask later", () => Promise.resolve()],
    ] as const) {
      test(`close(${code}), respond() ${when} throws, and the client gets no 'response'`, async () => {
        const server = http2.createServer();
        const { promise: responded, resolve: respond } = Promise.withResolvers<string>();
        server.on("stream", async stream => {
          stream.on("error", () => {});
          stream.close(code);
          await wait();
          try {
            stream.respond({ ":status": 200 });
            stream.end("ok");
            respond("respond() returned");
          } catch (error) {
            respond("respond() threw " + (error as NodeJS.ErrnoException).code);
          }
        });
        const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
        try {
          const events: string[] = [];
          const { promise: closed, resolve } = Promise.withResolvers<void>();
          const req = client.request({ ":path": "/" }, { endStream: true });
          req.on("response", headers => events.push("response " + headers[":status"]));
          req.on("error", error => events.push("error:" + (error as NodeJS.ErrnoException).code));
          req.on("close", () => {
            events.push("close:" + req.rstCode);
            resolve();
          });
          req.resume();
          await closed;
          assert.deepStrictEqual(
            { server: await responded, client: events },
            {
              server: "respond() threw ERR_HTTP2_INVALID_STREAM",
              client: ["error:ERR_HTTP2_STREAM_ERROR", `close:${code}`],
            },
          );
        } finally {
          client.destroy();
          server.close();
        }
      });
    }
  }
});

describe("the close step of a stream that the peer resets with NO_ERROR", () => {
  test("a stream that close(code) closed before the reset keeps its code", async () => {
    const server = http2.createServer();
    const socket = net.connect(await listen(server), "127.0.0.1");
    try {
      const { promise, resolve } = Promise.withResolvers<number | undefined>();
      server.on("stream", stream => {
        stream.on("close", () => resolve(stream.rstCode));
        stream.close(NGHTTP2_CANCEL);
      });
      socket.on("error", () => {});
      socket.resume();
      // One write: the reset is behind the HEADERS frame that runs close(code).
      socket.write(Buffer.concat([rawPost(), rstStream(1, NGHTTP2_NO_ERROR)]));
      assert.strictEqual(await promise, NGHTTP2_CANCEL);
    } finally {
      socket.destroy();
      server.close();
    }
  });

  test("a response that waits for trailers sends nothing after the reset", async () => {
    const server = http2.createServer();
    const socket = net.connect(await listen(server), "127.0.0.1");
    try {
      const { promise: closed, resolve } = Promise.withResolvers<void>();
      server.on("stream", stream => {
        stream.respond({ ":status": 200 }, { waitForTrailers: true });
        // The client gives up its upload once the server has some of it.
        stream.once("data", () => socket.write(rstStream(1, NGHTTP2_NO_ERROR)));
        stream.on("close", resolve);
      });
      socket.on("error", () => {});
      const frames: RawFrame[] = [];
      const { promise: ponged, resolve: pong } = Promise.withResolvers<void>();
      collectFrames(socket, frames, pong);
      socket.write(rawPost());
      await closed;
      // The client has read everything the server sent before the answer to this.
      socket.write(frame(F.PING, 0, 0, Buffer.alloc(8)));
      await ponged;
      assert.deepStrictEqual(
        frames.map(({ type }) => type),
        [F.HEADERS],
      );
    } finally {
      socket.destroy();
      server.close();
    }
  });

  test("a client stream that nothing reads is closed at the reset, and a late reader gets its data", async () => {
    const srv = rawH2Server((socket, sid) => {
      answerOpen(socket, sid);
      socket.write(rstStream(sid, NGHTTP2_NO_ERROR));
    });
    const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
    const ping = () => new Promise<void>((done, fail) => client.ping(error => (error ? fail(error) : done())));
    try {
      const events: string[] = [];
      const { promise: responded, resolve: respond } = Promise.withResolvers<void>();
      const { promise: closed, resolve } = Promise.withResolvers<void>();
      const req = client.request({ ":path": "/", ":method": "POST" });
      req.on("response", respond);
      for (const event of ["aborted", "finish", "end"]) req.on(event, () => events.push(event));
      req.on("close", () => (events.push("close:" + req.rstCode), resolve()));
      await responded;
      // The reset is behind the response, and the client has handled it after a round trip.
      await ping();
      await ping();
      events.push(`closed ${req.closed}, destroyed ${req.destroyed}`);
      let bytes = 0;
      req.on("data", (chunk: Buffer) => (bytes += chunk.length));
      await closed;
      assert.deepStrictEqual(
        { events, bytes },
        { events: ["aborted", "finish", "closed true, destroyed false", "end", "close:0"], bytes: 600 },
      );
    } finally {
      client.destroy();
      srv.close();
    }
  });

  test("a pushed stream emits no 'aborted'", async () => {
    const srv = rawH2Server((socket, sid) => {
      const promised = Buffer.alloc(4);
      promised.writeUInt32BE(2);
      const request = hp([
        [":method", "GET"],
        [":scheme", "http"],
        [":path", "/pushed"],
        [":authority", "localhost"],
      ]);
      socket.write(frame(5 /* PUSH_PROMISE */, 0x4, sid, Buffer.concat([promised, request])));
      answerOpen(socket, 2);
      socket.write(rstStream(2, NGHTTP2_NO_ERROR));
    });
    const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
    try {
      const { promise, resolve } = Promise.withResolvers<string[]>();
      client.on("stream", pushed => {
        const events: string[] = [];
        pushed.on("data", () => {});
        pushed.on("aborted", () => events.push("aborted"));
        pushed.on("end", () => events.push("end"));
        pushed.on("close", () => resolve([...events, "close:" + pushed.rstCode]));
      });
      const req = client.request({ ":path": "/" });
      req.on("error", () => {});
      req.resume();
      assert.deepStrictEqual(await promise, ["end", "close:0"]);
    } finally {
      client.destroy();
      srv.close();
    }
  });

  test("the close channel sees the stream closed, and not destroyed yet", async () => {
    const seen: string[] = [];
    const onClose = (message: unknown) => {
      const { stream } = message as { stream: http2.ServerHttp2Stream };
      seen.push(`closed ${stream.closed}, destroyed ${stream.destroyed}, rstCode ${stream.rstCode}`);
    };
    dc.subscribe("http2.server.stream.close", onClose);
    const server = http2.createServer();
    const socket = net.connect(await listen(server), "127.0.0.1");
    try {
      const { promise: closed, resolve } = Promise.withResolvers<void>();
      server.on("stream", stream => stream.on("close", resolve));
      socket.on("error", () => {});
      socket.resume();
      socket.write(Buffer.concat([rawPost(), rstStream(1, NGHTTP2_NO_ERROR)]));
      await closed;
      assert.deepStrictEqual(seen, ["closed true, destroyed false, rstCode 0"]);
    } finally {
      dc.unsubscribe("http2.server.stream.close", onClose);
      socket.destroy();
      server.close();
    }
  });
});

describe("a stream that the peer reset with NO_ERROR, until it is destroyed", () => {
  test("a closing session emits 'close' after the last stream that the peer resets", async () => {
    let peer: net.Socket | undefined;
    const srv = rawH2Server((socket, sid) => {
      answerOpen(socket, sid);
      peer = socket;
    });
    const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
    try {
      const events: string[] = [];
      const { promise, resolve } = Promise.withResolvers<void>();
      client.on("close", () => {
        events.push("session close");
        resolve();
      });
      const req = client.request({ ":path": "/", ":method": "POST" });
      req.on("response", () => {
        client.close();
        peer!.write(rstStream(1, NGHTTP2_NO_ERROR));
      });
      req.on("data", () => {});
      req.on("end", () => events.push(`end, destroyed ${req.destroyed}`));
      req.on("close", () => events.push("close:" + req.rstCode));
      await promise;
      assert.deepStrictEqual(events, ["end, destroyed false", "close:0", "session close"]);
    } finally {
      client.destroy();
      srv.close();
    }
  });

  test("destroy(error) keeps rstCode 0", async () => {
    const server = http2.createServer();
    const socket = net.connect(await listen(server), "127.0.0.1");
    try {
      const { promise, resolve } = Promise.withResolvers<string[]>();
      server.on("stream", stream => {
        const events: string[] = [];
        stream.on("aborted", () => stream.destroy(new Error("boom")));
        stream.on("error", error => events.push("error:" + error.message));
        stream.on("close", () => resolve([...events, "close:" + stream.rstCode]));
      });
      socket.on("error", () => {});
      socket.resume();
      socket.write(Buffer.concat([rawPost(), rstStream(1, NGHTTP2_NO_ERROR)]));
      assert.deepStrictEqual(await promise, ["error:boom", "close:0"]);
    } finally {
      socket.destroy();
      server.close();
    }
  });

  test("a request that nothing reads gives its slot back", async () => {
    const maxConcurrentStreams1 = Buffer.from([0, 3, 0, 0, 0, 1]);
    const srv = rawH2Server(
      (socket, sid) => {
        if (sid !== 1) return socket.write(frame(F.HEADERS, 0x5, sid, hp([[":status", "200"]])));
        answerOpen(socket, sid);
        socket.write(rstStream(sid, NGHTTP2_NO_ERROR));
      },
      undefined,
      maxConcurrentStreams1,
    );
    const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
    try {
      await new Promise(resolve => client.once("remoteSettings", resolve));
      const unread = client.request({ ":path": "/", ":method": "POST" });
      unread.on("error", () => {});
      const { promise, resolve } = Promise.withResolvers<unknown>();
      const next = client.request({ ":path": "/" });
      next.on("error", () => {});
      next.on("response", headers => resolve(headers[":status"]));
      next.resume();
      assert.strictEqual(await promise, 200);
    } finally {
      client.destroy();
      srv.close();
    }
  });
});

if (typeof Bun !== "undefined") {
  const node = Bun.which("node");
  // Alpine's node segfaults at a random point of this file (alpine 3.23 aarch64, on main too), and
  // the CI runner fails a file for any new core dump, whichever process wrote it. The glibc, macOS
  // and Windows lanes keep the cross-check.
  const isMusl =
    process.platform === "linux" &&
    !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime;
  describe("Node.js compatibility", () => {
    test("tests should run on node.js", { skip: !node || isMusl }, async () => {
      await using proc = Bun.spawn({
        cmd: [node as string, "--test", import.meta.filename],
        stdout: "inherit",
        stderr: "inherit",
        stdin: "ignore",
      });
      assert.strictEqual(await proc.exited, 0);
    });
  });
}
