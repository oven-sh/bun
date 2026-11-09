/**
 * Http2Stream.close(code) event contract, client and server, while the peer's half is still open:
 *   NO_ERROR / CANCEL  -> 'end', 'close'             (documented 'error' exemption)
 *   any other code     -> 'error', 'close'           (no 'end': the body was killed by RST_STREAM)
 * Once the peer's half has ended (END_STREAM on a HEADERS frame, or a server push, which has no
 * inbound half) the readable already has its EOF, so 'end' comes first for every code.
 *
 * And the other direction: what a stream does when the peer resets it with NO_ERROR.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-client-close.test.ts
 *   node --test test/js/node/http2/node-http2-client-close.test.ts
 */
import assert from "node:assert";
import { execFile } from "node:child_process";
import dc from "node:diagnostics_channel";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Duplex, Readable, Writable, finished, pipeline } from "node:stream";
import { text } from "node:stream/consumers";
import { describe, test } from "node:test";
import { inspect } from "node:util";

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

// The first bytes of a raw h2c client.
const rawHandshake = () => Buffer.concat([PREFACE, frame(F.SETTINGS, 0, 0)]);
// Stream 1: a POST, and 3,000 bytes of a body that stays open.
const rawPostFrames = () =>
  Buffer.concat([
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
// The bytes of a raw h2c client that opens stream 1 with that POST.
const rawPost = () => Buffer.concat([rawHandshake(), rawPostFrames()]);

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

// A raw h2c client of an http2 server. The first bytes that a test writes start with the preface, as rawPost() does.
// `frames` gets the frames of the server on a stream. ping() resolves at the PING ACK: by then the server has handled
// everything written before it, and the client has read everything that the server wrote before the ACK.
function rawH2Client(port: number, options?: { allowHalfOpen: boolean }) {
  const socket = net.connect({ port, host: "127.0.0.1", ...options });
  const frames: RawFrame[] = [];
  const pongs: (() => void)[] = [];
  socket.on("error", () => {});
  collectFrames(socket, frames, () => pongs.shift()!());
  const ping = () =>
    new Promise<void>(resolve => {
      pongs.push(resolve);
      socket.write(frame(F.PING, 0, 0, Buffer.alloc(8)));
    });
  return { socket, frames, ping };
}
// The same round trip, from an http2 client.
const sessionPing = (session: http2.ClientHttp2Session) =>
  new Promise<void>((resolve, reject) => session.ping(error => (error ? reject(error) : resolve())));
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

// A Duplex in front of a socket. A session over it handles a chunk of the socket in one turn: the ticks that its
// frames queue run after the last frame of the chunk.
function duplexOver(socket: net.Socket) {
  const transport = new Duplex({
    read() {},
    write: (chunk, encoding, callback) => void socket.write(chunk, encoding, callback),
    destroy: (error, callback) => (socket.destroy(), callback(error)),
  });
  socket.on("data", chunk => transport.push(chunk));
  socket.on("error", () => {});
  socket.on("close", () => transport.destroy());
  return transport;
}
function duplexH2Server(onSession: (session: http2.ServerHttp2Session) => void): net.Server {
  return net.createServer(socket => onSession(http2.performServerHandshake(duplexOver(socket))));
}

// PUSH_PROMISE of a GET on the stream `promised`, sent on the stream `sid`.
function pushPromise(socket: net.Socket, sid: number, promised: number) {
  const id = Buffer.alloc(4);
  id.writeUInt32BE(promised);
  const request = hp([
    [":method", "GET"],
    [":scheme", "http"],
    [":path", "/pushed"],
    [":authority", "localhost"],
  ]);
  socket.write(frame(5 /* PUSH_PROMISE */, 0x4, sid, Buffer.concat([id, request])));
}

// Node before 26.9 destroys a stream that the peer reset only after its 'finish', and a write that the reset cut
// never finishes.
const nodeWaitsForFinish =
  typeof Bun === "undefined" &&
  (([major, minor]) => major < 26 || (major === 26 && minor < 9))(process.versions.node.split(".").map(Number));

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

// A request whose writable is open when the peer resets it, and one whose writable has ended. `atReset` is what such a
// request has emitted when the reset has been handled and nothing has read the response.
const requestShapes = [
  ["a POST", { ":path": "/", ":method": "POST" }, undefined, ["aborted", "finish"]],
  ["a GET", { ":path": "/" }, { endStream: true }, ["finish"]],
] as const;
// What a raw h2c server answers so that the client's stream is reset while it can still be read.
const answerOpenThenReset: RawAnswer = (socket, sid) => {
  answerOpen(socket, sid);
  socket.write(rstStream(sid, NGHTTP2_NO_ERROR));
};

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

  for (const [shape, headers, options, atReset] of requestShapes) {
    test(`${shape} is closed at 'end'`, async () => {
      const srv = rawH2Server(answerOpenThenReset);
      const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
      try {
        const events: string[] = [];
        const { promise, resolve } = Promise.withResolvers<void>();
        const req = client.request(headers, options);
        req.on("response", () => events.push("response"));
        req.on("data", () => {});
        req.on("aborted", () => events.push("aborted"));
        req.on("end", () => events.push(atEnd(req)));
        req.on("close", () => {
          events.push("close:" + req.rstCode);
          resolve();
        });
        await promise;
        const aborted = (atReset as readonly string[]).includes("aborted");
        assert.deepStrictEqual(events, [
          "response",
          ...(aborted ? ["aborted"] : []),
          `end, aborted ${aborted}, closed true`,
          "close:0",
        ]);
      } finally {
        client.destroy();
        srv.close();
      }
    });
  }

  test("over a transport that is no socket, a server stream is closed at an 'end' that came with the reset", async () => {
    const { promise, resolve } = Promise.withResolvers<string[]>();
    const server = duplexH2Server(session => {
      session.on("error", () => {});
      session.on("stream", stream => {
        const events: string[] = [];
        stream.on("data", () => {});
        stream.on("end", () => {
          events.push(atEnd(stream));
          try {
            stream.respond({ ":status": 200 });
            events.push("respond() returned");
          } catch (error) {
            events.push("respond() threw " + (error as NodeJS.ErrnoException).code);
          }
        });
        stream.on("close", () => resolve([...events, "close:" + stream.rstCode]));
      });
    });
    const { socket, ping } = rawH2Client(await listen(server));
    try {
      socket.write(rawPost());
      await ping();
      // One chunk: the session handles the end of the request and the reset in one turn, and 'end' is the first
      // tick of the two.
      socket.write(Buffer.concat([frame(F.DATA, 0x1 /* END_STREAM */, 1), rstStream(1, NGHTTP2_NO_ERROR)]));
      assert.deepStrictEqual(await promise, [
        "end, aborted true, closed true",
        "respond() threw ERR_HTTP2_INVALID_STREAM",
        "close:0",
      ]);
    } finally {
      socket.destroy();
      server.close();
    }
  });
});

describe("respond() after close(code)", () => {
  for (const code of [NGHTTP2_NO_ERROR, NGHTTP2_CANCEL, NGHTTP2_INTERNAL_ERROR, NGHTTP2_REFUSED_STREAM]) {
    for (const [when, wait] of [
      ["in the same turn", null],
      ["one microtask later", () => Promise.resolve()],
    ] as const) {
      // One microtask after close(NO_ERROR), a stream that has no request body is destroyed.
      if (code === NGHTTP2_NO_ERROR && wait !== null) continue;
      test(`close(${code}), respond() ${when} throws, and the client gets no 'response'`, async () => {
        const server = http2.createServer();
        const { promise: responded, resolve: respond } = Promise.withResolvers<string>();
        server.on("stream", async stream => {
          stream.on("error", () => {});
          stream.close(code);
          if (wait !== null) await wait();
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
          const isError = code !== NGHTTP2_NO_ERROR && code !== NGHTTP2_CANCEL;
          assert.deepStrictEqual(
            { server: await responded, client: events },
            {
              server: "respond() threw ERR_HTTP2_INVALID_STREAM",
              client: isError ? ["error:ERR_HTTP2_STREAM_ERROR", `close:${code}`] : [`close:${code}`],
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
    const { socket, frames, ping } = rawH2Client(await listen(server));
    try {
      const { promise: closed, resolve } = Promise.withResolvers<void>();
      server.on("stream", stream => {
        stream.respond({ ":status": 200 }, { waitForTrailers: true });
        // The client gives up its upload once the server has some of it.
        stream.once("data", () => socket.write(rstStream(1, NGHTTP2_NO_ERROR)));
        stream.on("close", resolve);
      });
      socket.write(rawPost());
      await closed;
      await ping();
      assert.deepStrictEqual(
        frames.map(({ type }) => type),
        [F.HEADERS],
      );
    } finally {
      socket.destroy();
      server.close();
    }
  });

  for (const [shape, headers, options, atReset] of requestShapes) {
    test(`${shape} that nothing reads is closed at the reset, and a late reader gets its data`, async () => {
      const srv = rawH2Server(answerOpenThenReset);
      const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
      try {
        const events: string[] = [];
        const { promise: responded, resolve: respond } = Promise.withResolvers<void>();
        const { promise: closed, resolve } = Promise.withResolvers<void>();
        const req = client.request(headers, options);
        req.on("response", respond);
        for (const event of ["aborted", "finish", "end"]) req.on(event, () => events.push(event));
        req.on("close", () => (events.push("close:" + req.rstCode), resolve()));
        await responded;
        // The reset is behind the response, and the client has handled it after a round trip.
        await sessionPing(client);
        await sessionPing(client);
        events.push(`closed ${req.closed}, destroyed ${req.destroyed}`);
        let bytes = 0;
        req.on("data", (chunk: Buffer) => (bytes += chunk.length));
        await closed;
        assert.deepStrictEqual(
          { events, bytes },
          { events: [...atReset, "closed true, destroyed false", "end", "close:0"], bytes: 600 },
        );
      } finally {
        client.destroy();
        srv.close();
      }
    });
  }

  test("a pushed stream emits no 'aborted'", async () => {
    const srv = rawH2Server((socket, sid) => {
      pushPromise(socket, sid, 2);
      answerOpenThenReset(socket, 2);
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

  test("the close channel sees a server stream closed, and not destroyed yet", async () => {
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

  for (const [shape, headers, options] of requestShapes) {
    test(`the close channel sees ${shape} closed, and not destroyed yet`, async () => {
      const seen: string[] = [];
      const onClose = (message: unknown) => {
        const { stream } = message as { stream: http2.ClientHttp2Stream };
        seen.push(`closed ${stream.closed}, destroyed ${stream.destroyed}, rstCode ${stream.rstCode}`);
      };
      dc.subscribe("http2.client.stream.close", onClose);
      const srv = rawH2Server(answerOpenThenReset);
      const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
      try {
        const { promise: closed, resolve } = Promise.withResolvers<void>();
        const req = client.request(headers, options);
        req.on("data", () => {});
        req.on("close", resolve);
        await closed;
        assert.deepStrictEqual(seen, ["closed true, destroyed false, rstCode 0"]);
      } finally {
        dc.unsubscribe("http2.client.stream.close", onClose);
        client.destroy();
        srv.close();
      }
    });
  }

  test("the body of a request counts as sent when the reset ends it", async () => {
    let sent = 0;
    const onBodySent = () => void sent++;
    dc.subscribe("http2.client.stream.bodySent", onBodySent);
    const srv = rawH2Server(answerOpenThenReset);
    const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
    try {
      const { promise: closed, resolve } = Promise.withResolvers<void>();
      const req = client.request({ ":path": "/", ":method": "POST" });
      req.on("data", () => {});
      req.on("close", resolve);
      await closed;
      assert.strictEqual(sent, 1);
    } finally {
      dc.unsubscribe("http2.client.stream.bodySent", onBodySent);
      client.destroy();
      srv.close();
    }
  });
});

// A server stream that has responded and that nothing reads, so it is still there after the reset. `sent` is the number
// of its frames that the client has read by then.
async function resetServerStream(prepare: (stream: http2.ServerHttp2Stream) => void = () => {}) {
  const server = http2.createServer();
  const client = rawH2Client(await listen(server));
  const { promise, resolve } = Promise.withResolvers<http2.ServerHttp2Stream>();
  server.on("stream", stream => {
    stream.respond({ ":status": 200 });
    stream.pause();
    prepare(stream);
    resolve(stream);
  });
  client.socket.write(rawPost());
  const stream = await promise;
  // The response is out, as far as the client's window takes it.
  await client.ping();
  const sent = client.frames.length;
  client.socket.write(rstStream(1, NGHTTP2_NO_ERROR));
  await client.ping();
  return { server, ...client, stream, sent };
}

describe("the writable of a stream that the peer reset with NO_ERROR", () => {
  test("write() returns false, gives its callback an error, and sends nothing", async () => {
    const { server, socket, frames, ping, stream, sent } = await resetServerStream();
    try {
      const errors: (string | undefined)[] = [];
      stream.on("error", error => errors.push((error as NodeJS.ErrnoException).code));
      const { promise, resolve } = Promise.withResolvers<string | undefined>();
      const returned = stream.write("late", error =>
        resolve((error as NodeJS.ErrnoException | null | undefined)?.code),
      );
      const callback = await promise;
      await ping();
      assert.deepStrictEqual(
        { closed: stream.closed, returned, callback, errors, frames: frames.slice(sent).map(({ type }) => type) },
        {
          closed: true,
          returned: false,
          callback: "ERR_STREAM_WRITE_AFTER_END",
          // Node emits 'error' for this write. Bun refuses it without one.
          errors: typeof Bun === "undefined" ? ["ERR_STREAM_WRITE_AFTER_END"] : [],
          frames: [],
        },
      );
    } finally {
      socket.destroy();
      server.close();
    }
  });

  test("a write() that was taken from the stream before the reset emits 'error'", async () => {
    let write!: (chunk: string) => boolean;
    const { server, socket, ping, stream } = await resetServerStream(stream => (write = stream.write.bind(stream)));
    try {
      const events: string[] = [];
      stream.on("error", error => events.push("error:" + (error as NodeJS.ErrnoException).code));
      stream.on("close", () => events.push("close:" + stream.rstCode));
      write("late");
      await ping();
      assert.deepStrictEqual(events, [
        "error:ERR_STREAM_WRITE_AFTER_END",
        // Node leaves the stream to its session. Bun destroys a stream that waits for its reader and then errors.
        ...(typeof Bun === "undefined" ? [] : ["close:0"]),
      ]);
    } finally {
      socket.destroy();
      server.close();
    }
  });

  test("an 'error' event that user code emits leaves the stream to its reader", async () => {
    const { server, socket, ping, stream } = await resetServerStream();
    try {
      const events: string[] = [];
      stream.on("error", error => events.push("error:" + error.message));
      stream.on("close", () => events.push("close"));
      stream.emit("error", new Error("not of the stream"));
      await ping();
      assert.deepStrictEqual(
        { events, destroyed: stream.destroyed },
        { events: ["error:not of the stream"], destroyed: false },
      );
    } finally {
      socket.destroy();
      server.close();
    }
  });

  for (const behind of [0, 1, 2]) {
    const name = `a response that the reset cut emits no 'finish', with ${behind} writes behind the one in flight`;
    test(name, { skip: nodeWaitsForFinish }, async () => {
      const callbacks: Record<string, string | undefined> = {};
      const callback = (name: string) => (error?: Error | null) =>
        void (callbacks[name] = error ? (error as NodeJS.ErrnoException).code : "ok");
      let finished = false;
      const { server, socket, stream } = await resetServerStream(stream => {
        stream.on("finish", () => (finished = true));
        // The client's window takes 65,535 bytes of this write. The rest waits in the session.
        stream.write(Buffer.alloc(70000), callback("in flight"));
        for (let i = 0; i < behind; i++) stream.write(Buffer.alloc(1000), callback("behind " + i));
        stream.end(callback("end"));
      });
      try {
        const { promise: closed, resolve } = Promise.withResolvers<void>();
        stream.on("close", resolve);
        // The 'end' of the request destroys the stream.
        stream.resume();
        await closed;
        assert.deepStrictEqual(
          { finished, writableFinished: stream.writableFinished, callbacks },
          {
            finished: false,
            writableFinished: false,
            callbacks: {
              "in flight": "ok",
              ...Object.fromEntries(Array.from({ length: behind }, (_, i) => ["behind " + i, "ERR_STREAM_DESTROYED"])),
              end: "ERR_STREAM_DESTROYED",
            },
          },
        );
      } finally {
        socket.destroy();
        server.close();
      }
    });
  }

  test(
    "over a transport that is no socket, an upload that the reset cut raises nothing",
    { skip: nodeWaitsForFinish },
    async () => {
      // An h2c server in a Duplex. It answers the first DATA frame of an upload with 200, 100 bytes, and the reset.
      let received = Buffer.alloc(0);
      let answered = false;
      const transport = new Duplex({
        read() {},
        write(chunk: Buffer, _encoding, callback) {
          received = Buffer.concat([received, chunk]);
          if (received.length >= PREFACE.length && received.subarray(0, PREFACE.length).equals(PREFACE)) {
            received = received.subarray(PREFACE.length);
          }
          while (received.length >= 9 && received.length >= 9 + received.readUIntBE(0, 3)) {
            const [type, flags, sid] = [received[3], received[4], received.readUInt32BE(5)];
            const payload = received.subarray(9, 9 + received.readUIntBE(0, 3));
            received = received.subarray(9 + payload.length);
            if (type === F.SETTINGS && !(flags & 1)) transport.push(frame(F.SETTINGS, 1, 0));
            else if (type === F.PING && !(flags & 1)) transport.push(frame(F.PING, 1, 0, payload));
            else if (type === F.DATA && !answered) {
              answered = true;
              // One chunk, in a later tick: the session reads the answer and the reset in one turn.
              process.nextTick(() =>
                transport.push(
                  Buffer.concat([
                    frame(F.HEADERS, 0x4, sid, hp([[":status", "200"]])),
                    frame(F.DATA, 0, sid, Buffer.alloc(100, 0x2e)),
                    rstStream(sid, NGHTTP2_NO_ERROR),
                  ]),
                ),
              );
            }
          }
          callback();
        },
      });
      transport.push(frame(F.SETTINGS, 0, 0));
      const client = http2.connect("http://localhost", { createConnection: () => transport });
      try {
        client.on("error", () => {});
        const events: string[] = [];
        const req = client.request({ ":path": "/", ":method": "POST" });
        req.on("response", headers => events.push("response " + headers[":status"]));
        req.on("error", error => events.push("error:" + error.message));
        req.on("close", () => events.push("close:" + req.rstCode));
        pipeline(
          Readable.from(Array.from({ length: 8 }, () => Buffer.alloc(1024, 0x61))),
          req,
          error => void events.push("pipeline:" + (error as NodeJS.ErrnoException | null | undefined)?.code),
        );
        await new Promise(resolve => req.once("response", resolve));
        // The session has handled the reset, and then the writes of the upload that were behind it.
        await sessionPing(client);
        await sessionPing(client);
        events.push(`closed ${req.closed}, destroyed ${req.destroyed}`);
        // The 'end' of the response destroys the stream.
        req.resume();
        await new Promise(resolve => req.once("close", resolve));
        await nextTurn();
        assert.deepStrictEqual(events, [
          "response 200",
          "closed true, destroyed false",
          "close:0",
          // Node calls back with no error here, although the server has 1 of the 8 chunks.
          "pipeline:" + (typeof Bun === "undefined" ? undefined : "ERR_STREAM_PREMATURE_CLOSE"),
        ]);
      } finally {
        client.destroy();
      }
    },
  );
});

describe("a stream that the peer reset with NO_ERROR and that nothing reads", () => {
  const teardowns = [
    ["session.destroy()", (session: http2.Http2Session) => session.destroy(), ["close:0"]],
    [
      "session.destroy(error)",
      (session: http2.Http2Session) => session.destroy(new Error("boom")),
      ["error:boom", "close:0"],
    ],
    ["the end of the connection", (_session: http2.Http2Session, peer: net.Socket) => void peer.end(), ["close:0"]],
  ] as const;

  for (const [teardown, run, expected] of teardowns) {
    test(`${teardown} destroys a server stream before the session's 'close'`, async () => {
      const server = http2.createServer();
      const { promise: sessioned, resolve: onSession } = Promise.withResolvers<http2.ServerHttp2Session>();
      server.on("session", onSession);
      const { socket, ping } = rawH2Client(await listen(server));
      try {
        const events: string[] = [];
        server.on("stream", stream => {
          stream.pause();
          stream.on("error", error => events.push("error:" + error.message));
          stream.on("close", () => events.push("close:" + stream.rstCode));
        });
        socket.write(Buffer.concat([rawPost(), rstStream(1, NGHTTP2_NO_ERROR)]));
        await ping();
        const session = await sessioned;
        session.on("error", () => {});
        const { promise: closed, resolve } = Promise.withResolvers<void>();
        session.on("close", () => {
          events.push("session close");
          resolve();
        });
        run(session, socket);
        await closed;
        assert.deepStrictEqual(events, [...expected, "session close"]);
      } finally {
        socket.destroy();
        server.close();
      }
    });

    test(`${teardown} destroys a client stream before the session's 'close'`, async () => {
      let peer!: net.Socket;
      const srv = rawH2Server((socket, sid) => {
        peer = socket;
        answerOpenThenReset(socket, sid);
      });
      const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
      try {
        const events: string[] = [];
        client.on("error", () => {});
        const req = client.request({ ":path": "/", ":method": "POST" });
        req.on("error", error => events.push("error:" + error.message));
        req.on("close", () => events.push("close:" + req.rstCode));
        await new Promise(resolve => req.once("response", resolve));
        await sessionPing(client);
        const { promise: closed, resolve } = Promise.withResolvers<void>();
        client.on("close", () => {
          events.push("session close");
          resolve();
        });
        run(client, peer);
        await closed;
        assert.deepStrictEqual(events, [...expected, "session close"]);
      } finally {
        client.destroy();
        srv.close();
      }
    });
  }

  test("session.close() leaves a client stream to a late reader", async () => {
    const srv = rawH2Server(answerOpenThenReset);
    const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
    try {
      const events: string[] = [];
      const { promise: closed, resolve } = Promise.withResolvers<void>();
      const req = client.request({ ":path": "/", ":method": "POST" });
      req.on("end", () => events.push("end"));
      req.on("close", () => (events.push("close:" + req.rstCode), resolve()));
      await new Promise(resolve => req.once("response", resolve));
      await sessionPing(client);
      const sessionClosed = new Promise(resolve => client.once("close", resolve));
      client.close();
      // Bun's session does not wait for this stream. Node's does.
      if (typeof Bun !== "undefined") await sessionClosed;
      let bytes = 0;
      req.on("data", (chunk: Buffer) => (bytes += chunk.length));
      await closed;
      assert.deepStrictEqual({ events, bytes }, { events: ["end", "close:0"], bytes: 600 });
    } finally {
      client.destroy();
      srv.close();
    }
  });

  test("session.close() leaves a server stream to a late reader", async () => {
    const server = http2.createServer();
    const { promise: sessioned, resolve: onSession } = Promise.withResolvers<http2.ServerHttp2Session>();
    server.on("session", onSession);
    // Half-open: the client keeps the connection when the server ends its side.
    const { socket, ping } = rawH2Client(await listen(server), { allowHalfOpen: true });
    try {
      const events: string[] = [];
      const { promise: streamed, resolve: onStream } = Promise.withResolvers<http2.ServerHttp2Stream>();
      const { promise: closed, resolve } = Promise.withResolvers<void>();
      server.on("stream", stream => {
        stream.pause();
        stream.on("end", () => events.push("end"));
        stream.on("close", () => (events.push("close:" + stream.rstCode), resolve()));
        onStream(stream);
      });
      socket.write(Buffer.concat([rawPost(), rstStream(1, NGHTTP2_NO_ERROR)]));
      await ping();
      const session = await sessioned;
      const sessionClosed = new Promise(resolve => session.once("close", resolve));
      session.close();
      // Bun's session does not wait for this stream. Node's does.
      if (typeof Bun !== "undefined") await sessionClosed;
      let bytes = 0;
      (await streamed).on("data", (chunk: Buffer) => (bytes += chunk.length)).resume();
      await closed;
      assert.deepStrictEqual({ events, bytes }, { events: ["end", "close:0"], bytes: 3000 });
    } finally {
      socket.destroy();
      server.close();
    }
  });

  test("the end of the connection after session.close() destroys a client stream", async () => {
    let peer!: net.Socket;
    const srv = rawH2Server((socket, sid) => {
      peer = socket;
      // The second request stays open, so close() does not destroy the session.
      if (sid === 1) answerOpenThenReset(socket, sid);
    });
    const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
    try {
      const events: string[] = [];
      client.on("error", () => {});
      const req = client.request({ ":path": "/", ":method": "POST" });
      req.on("error", () => {});
      req.on("close", () => events.push("close:" + req.rstCode));
      client.request({ ":path": "/" }).on("error", () => {});
      await new Promise(resolve => req.once("response", resolve));
      await sessionPing(client);
      const { promise: closed, resolve } = Promise.withResolvers<void>();
      client.on("close", resolve);
      client.close();
      peer.end();
      await closed;
      await nextTurn();
      assert.deepStrictEqual(events, ["close:0"]);
    } finally {
      client.destroy();
      srv.close();
    }
  });

  // Node's session waits for this stream after close(), and it keeps the connection for that.
  const nodeKeepsTheConnection = typeof Bun === "undefined";
  test(
    "a server stream is destroyed when its connection ends after session.close()",
    { skip: nodeKeepsTheConnection },
    async () => {
      const server = http2.createServer();
      const { promise: sessioned, resolve: onSession } = Promise.withResolvers<http2.ServerHttp2Session>();
      server.on("session", onSession);
      const ended = new Promise<void>(resolve => server.once("connection", socket => socket.once("close", resolve)));
      const { socket, ping } = rawH2Client(await listen(server));
      try {
        const events: string[] = [];
        server.on("stream", stream => {
          stream.pause();
          stream.on("close", () => events.push("close:" + stream.rstCode));
        });
        socket.write(Buffer.concat([rawPost(), rstStream(1, NGHTTP2_NO_ERROR)]));
        await ping();
        const session = await sessioned;
        const sessionClosed = new Promise(resolve => session.once("close", resolve));
        session.close();
        await sessionClosed;
        socket.end();
        await ended;
        await nextTurn();
        assert.deepStrictEqual(events, ["close:0"]);
      } finally {
        socket.destroy();
        server.close();
      }
    },
  );

  // The handler has not read the request yet, so the stream is still there after the reset.
  for (const [shape, respond, afterReset] of [
    [
      "a source that is piped into res",
      (res: http2.Http2ServerResponse) => {
        res.writeHead(200);
        // 1 MiB: it fills the client's window, and then it waits for 'drain'.
        let chunks = 64;
        new Readable({
          read() {
            this.push(chunks-- > 0 ? Buffer.alloc(16384) : null);
          },
        }).pipe(res);
      },
      () => {},
    ],
    ["res.end(body) after the reset", () => {}, (res: http2.Http2ServerResponse) => void res.end("late")],
  ] as const) {
    test(`${shape}: the request and the response close when the connection ends`, async () => {
      const events: string[] = [];
      const { promise: handled, resolve: handle } = Promise.withResolvers<http2.Http2ServerResponse>();
      const server = http2.createServer((req, res) => {
        req.pause();
        respond(res);
        req.on("close", () => events.push("req close"));
        res.on("close", () => events.push("res close"));
        handle(res);
      });
      const ended = new Promise<void>(resolve => server.once("connection", socket => socket.once("close", resolve)));
      const { socket, ping } = rawH2Client(await listen(server));
      try {
        socket.write(rawPost());
        const res = await handled;
        await ping();
        socket.write(rstStream(1, NGHTTP2_NO_ERROR));
        await ping();
        afterReset(res);
        await ping();
        const open = [...events];
        socket.end();
        await ended;
        await nextTurn();
        assert.deepStrictEqual({ open, ended: events.sort() }, { open: [], ended: ["req close", "res close"] });
      } finally {
        socket.destroy();
        server.close();
      }
    });
  }

  test("over a transport that is no socket, a session that is destroyed in the turn of the reset destroys the stream", async () => {
    let peer!: net.Socket;
    const srv = rawH2Server(socket => (peer = socket));
    const port = await listen(srv);
    const client = http2.connect(`http://127.0.0.1:${port}`, {
      createConnection: () => duplexOver(net.connect(port, "127.0.0.1")),
    });
    try {
      const events: string[] = [];
      const { promise: closed, resolve } = Promise.withResolvers<void>();
      client.on("error", () => {});
      client.on("close", resolve);
      // Nothing reads the response, so the stream would wait for its reader.
      const req = client.request({ ":path": "/", ":method": "POST" });
      req.on("error", () => {});
      req.on("close", () => events.push("close:" + req.rstCode));
      await sessionPing(client);
      const goaway = Buffer.alloc(8);
      goaway.writeUInt32BE(1, 0);
      goaway.writeUInt32BE(NGHTTP2_INTERNAL_ERROR, 4);
      // One chunk: the session handles the answer, the reset, and a GOAWAY that destroys it, in one turn.
      peer.write(
        Buffer.concat([
          frame(F.HEADERS, 0x4, 1, hp([[":status", "200"]])),
          frame(F.DATA, 0, 1, Buffer.alloc(600, 0x2e)),
          rstStream(1, NGHTTP2_NO_ERROR),
          frame(7 /* GOAWAY */, 0, 0, goaway),
        ]),
      );
      await closed;
      await nextTurn();
      assert.deepStrictEqual(events, ["close:0"]);
    } finally {
      client.destroy();
      srv.close();
    }
  });

  test("a session does not hold a stream that was read to its end", { skip: typeof Bun === "undefined" }, async () => {
    const srv = rawH2Server(answerOpenThenReset);
    const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
    try {
      let collected = 0;
      const registry = new FinalizationRegistry(() => void collected++);
      const streams = 100;
      for (let i = 0; i < streams; i++) {
        await new Promise(resolve => {
          const req = client.request({ ":path": "/", ":method": "POST" });
          registry.register(req, undefined);
          req.on("close", resolve);
          req.resume();
        });
      }
      for (let i = 0; i < 10 && collected < streams / 2; i++) {
        Bun.gc(true);
        await nextTurn();
      }
      assert.ok(
        collected >= streams / 2,
        `${collected} of ${streams} streams were collected while their session is open`,
      );
    } finally {
      client.destroy();
      srv.close();
    }
  });

  test("its state is that of an idle stream", async () => {
    const { server, socket, ping, stream } = await resetServerStream();
    try {
      // The session has read again since the reset.
      await ping();
      assert.deepStrictEqual(
        { state: stream.state, inspected: inspect(stream).includes("closed: true") },
        {
          state: { state: 1, weight: 0, sumDependencyWeight: 0, localClose: 0, remoteClose: 0, localWindowSize: 0 },
          inspected: true,
        },
      );
    } finally {
      socket.destroy();
      server.close();
    }
  });
});

describe("the requests of a session after the peer reset one with NO_ERROR", () => {
  const maxConcurrentStreams1 = Buffer.from([0, 3, 0, 0, 0, 1]);
  const answerEnd: RawAnswer = (socket, sid) => socket.write(frame(F.HEADERS, 0x5, sid, hp([[":status", "200"]])));

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
        stream.on("resume", () => events.push("resume"));
        stream.on("error", error => events.push("error:" + error.message));
        stream.on("close", () => {
          events.push("close:" + stream.rstCode);
          // After what the reset still had to do when the listener returned.
          setImmediate(resolve, events);
        });
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

  test("destroy() in a listener of 'aborted' does not end the writable first", async () => {
    const server = http2.createServer();
    const socket = net.connect(await listen(server), "127.0.0.1");
    try {
      const { promise, resolve } = Promise.withResolvers<string[]>();
      server.on("stream", stream => {
        const events: string[] = [];
        stream.on("aborted", () => stream.destroy());
        // finished() listens for 'aborted' too, after the listener above.
        finished(stream, error => events.push("finished:" + (error as NodeJS.ErrnoException | null | undefined)?.code));
        stream.on("close", () => resolve([...events, `close:${stream.rstCode}, finished ${stream.writableFinished}`]));
      });
      socket.on("error", () => {});
      socket.resume();
      socket.write(Buffer.concat([rawPost(), rstStream(1, NGHTTP2_NO_ERROR)]));
      assert.deepStrictEqual(await promise, ["finished:ERR_STREAM_PREMATURE_CLOSE", "close:0, finished false"]);
    } finally {
      socket.destroy();
      server.close();
    }
  });

  test("session.destroy(NGHTTP2_NO_ERROR) is no reset of the peer", async () => {
    const srv = rawH2Server();
    const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
    try {
      const events: string[] = [];
      const { promise, resolve } = Promise.withResolvers<void>();
      const req = client.request({ ":path": "/", ":method": "POST" });
      req.on("error", error => events.push("error:" + (error as NodeJS.ErrnoException).code));
      req.on("close", () => (events.push("close:" + req.rstCode), resolve()));
      await new Promise(resolve => req.once("response", resolve));
      client.destroy(NGHTTP2_NO_ERROR);
      await promise;
      // Node closes the request with code 0 and no error. Bun cancels a request that is open, as for destroy().
      assert.deepStrictEqual(
        events,
        typeof Bun === "undefined" ? ["close:0"] : ["error:ERR_HTTP2_STREAM_CANCEL", "close:2"],
      );
    } finally {
      client.destroy();
      srv.close();
    }
  });

  for (const [shape, headers, options, atReset] of requestShapes) {
    test(`${shape} that nothing reads gives its slot back before its 'aborted'`, async () => {
      const srv = rawH2Server(
        (socket, sid) => (sid === 1 ? answerOpenThenReset : answerEnd)(socket, sid),
        undefined,
        maxConcurrentStreams1,
      );
      const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
      try {
        await new Promise(resolve => client.once("remoteSettings", resolve));
        const unread = client.request(headers, options);
        unread.on("error", () => {});
        let status: unknown;
        const next = client.request({ ":path": "/" });
        next.on("error", () => {});
        next.on("response", responseHeaders => (status = responseHeaders[":status"]));
        next.resume();
        let pendingAtAborted: boolean | undefined;
        unread.on("aborted", () => (pendingAtAborted = next.pending));
        await new Promise(resolve => unread.once("response", resolve));
        // The reset is behind the response. The queued request is sent at the reset, and answered a round trip later.
        await sessionPing(client);
        await sessionPing(client);
        assert.deepStrictEqual(
          { status, pendingAtAborted },
          { status: 200, pendingAtAborted: (atReset as readonly string[]).includes("aborted") ? false : undefined },
        );
      } finally {
        client.destroy();
        srv.close();
      }
    });
  }

  test("a request that the peer reset gives its slot back once", async () => {
    const opened: number[] = [];
    let peer!: net.Socket;
    const srv = rawH2Server(
      (socket, sid) => {
        peer = socket;
        opened.push(sid);
        // The third request stays open until the test answers it.
        if (sid === 1) answerOpenThenReset(socket, sid);
        else if (sid !== 5) answerEnd(socket, sid);
      },
      undefined,
      maxConcurrentStreams1,
    );
    const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
    try {
      await new Promise(resolve => client.once("remoteSettings", resolve));
      const requests = [{ ":path": "/", ":method": "POST" }, { ":path": "/" }, { ":path": "/" }, { ":path": "/" }].map(
        headers => client.request(headers),
      );
      for (const req of requests) req.on("error", () => {}).resume();
      // The first two requests are done: the reset one through its 'end', the next one through its response.
      await Promise.all(requests.slice(0, 2).map(req => new Promise(resolve => req.once("close", resolve))));
      await sessionPing(client);
      await sessionPing(client);
      assert.deepStrictEqual(opened, [1, 3, 5]);
      answerEnd(peer, 5);
      await new Promise(resolve => requests[3].once("response", resolve));
      assert.deepStrictEqual(opened, [1, 3, 5, 7]);
    } finally {
      client.destroy();
      srv.close();
    }
  });

  test("a pushed stream that nothing reads gives its reserved slot back", async () => {
    const frames: RawFrame[] = [];
    let promised = 0;
    const srv = rawH2Server((socket, sid) => {
      // Each request gets a push that the server resets, then its own response.
      promised += 2;
      pushPromise(socket, sid, promised);
      answerOpenThenReset(socket, promised);
      answerEnd(socket, sid);
    }, frames);
    const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`, { maxReservedRemoteStreams: 1 });
    try {
      let pushed = 0;
      client.on("stream", stream => {
        stream.on("error", () => {});
        pushed++;
      });
      for (let i = 0; i < 3; i++) {
        const req = client.request({ ":path": "/" });
        req.on("error", () => {});
        req.resume();
        await new Promise(resolve => req.once("close", resolve));
        // The client has handled the push and its reset after a round trip.
        await sessionPing(client);
      }
      // A client refuses a push over its limit with RST_STREAM.
      assert.deepStrictEqual(
        { pushed, resets: frames.filter(({ type }) => type === F.RST_STREAM).length },
        { pushed: 3, resets: 0 },
      );
    } finally {
      client.destroy();
      srv.close();
    }
  });

  test("a pushed stream that the peer reset gives its reserved slot back once", async () => {
    const frames: RawFrame[] = [];
    const srv = rawH2Server((socket, sid) => {
      if (sid === 1) {
        // A push that the server resets.
        pushPromise(socket, sid, 2);
        answerOpenThenReset(socket, 2);
      } else {
        // Two pushes that stay reserved: one more than the client allows.
        pushPromise(socket, sid, 4);
        pushPromise(socket, sid, 6);
      }
      answerEnd(socket, sid);
    }, frames);
    const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`, { maxReservedRemoteStreams: 1 });
    try {
      const pushed: number[] = [];
      client.on("stream", stream => {
        pushed.push(stream.id!);
        stream.on("error", () => {});
        // The first push is read to its end, so it also gets its 'close'.
        stream.resume();
      });
      for (let i = 0; i < 2; i++) {
        const req = client.request({ ":path": "/" });
        req.on("error", () => {});
        req.resume();
        await new Promise(resolve => req.once("close", resolve));
        await sessionPing(client);
      }
      assert.deepStrictEqual(
        { pushed, resets: frames.filter(({ type }) => type === F.RST_STREAM).length },
        { pushed: [2, 4], resets: 1 },
      );
    } finally {
      client.destroy();
      srv.close();
    }
  });

  test("session.close(), then the reset of its only stream: a queued request is answered before 'close'", async () => {
    let peer!: net.Socket;
    const srv = rawH2Server(
      (socket, sid) => {
        peer = socket;
        if (sid !== 1) answerEnd(socket, sid);
      },
      undefined,
      maxConcurrentStreams1,
    );
    const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
    try {
      await new Promise(resolve => client.once("remoteSettings", resolve));
      const events: string[] = [];
      const { promise, resolve } = Promise.withResolvers<void>();
      client.on("close", () => (events.push("session close"), resolve()));
      const first = client.request({ ":path": "/", ":method": "POST" });
      const next = client.request({ ":path": "/" });
      for (const [name, req] of [
        ["first", first],
        ["next", next],
      ] as const) {
        req.on("response", headers => events.push(`${name}: response ${headers[":status"]}`));
        req.on("error", error => events.push(`${name}: error ${(error as NodeJS.ErrnoException).code}`));
        req.on("close", () => events.push(`${name}: close:${req.rstCode}`));
        req.resume();
      }
      // The server has the first request.
      await sessionPing(client);
      client.close();
      answerOpenThenReset(peer, 1);
      await promise;
      assert.deepStrictEqual(events, [
        "first: response 200",
        "first: close:0",
        "next: response 200",
        "next: close:0",
        "session close",
      ]);
    } finally {
      client.destroy();
      srv.close();
    }
  });

  test("a listener of 'aborted' that throws leaves the session with its slot, and with its stream", async () => {
    // In a process of its own: an exception that nothing catches fails a test of node:test.
    const script = `
      const http2 = require("node:http2");
      const uncaught = [];
      process.on("uncaughtException", error => uncaught.push(error.message));
      const server = http2.createServer({ settings: { maxConcurrentStreams: 1 } });
      server.on("stream", (stream, headers) => {
        stream.respond({ ":status": 200 });
        if (headers[":path"] === "/next") return stream.end();
        // An early answer to an upload: the client's stream is reset with NO_ERROR while its request is open.
        stream.write("early");
        stream.close();
      });
      server.listen(0, "127.0.0.1", async () => {
        const client = http2.connect("http://127.0.0.1:" + server.address().port);
        const ping = () => new Promise(resolve => client.ping(resolve));
        await new Promise(resolve => client.once("remoteSettings", resolve));
        const first = client.request({ ":path": "/first", ":method": "POST" });
        let firstClosed = false;
        first.on("aborted", () => { throw new Error("from the listener"); });
        first.on("error", () => {});
        first.on("close", () => (firstClosed = true));
        const next = client.request({ ":path": "/next" });
        let status = "none";
        next.on("response", headers => (status = headers[":status"]));
        next.on("error", () => {});
        next.resume();
        await new Promise(resolve => first.once("response", resolve));
        await ping();
        await ping();
        client.destroy();
        await new Promise(resolve => client.once("close", resolve));
        await new Promise(resolve => setImmediate(resolve));
        console.log(JSON.stringify({ uncaught, status, firstClosed }));
        process.exit(0);
      });
    `;
    const { promise, resolve } = Promise.withResolvers<{ code: number | string | null | undefined; stdout: string }>();
    execFile(
      process.execPath,
      ["-e", script],
      { env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" } },
      (error, stdout) => resolve({ code: error ? error.code : 0, stdout: stdout.trim() }),
    );
    assert.deepStrictEqual(await promise, {
      code: 0,
      stdout: JSON.stringify({ uncaught: ["from the listener"], status: 200, firstClosed: true }),
    });
  });
});

describe("a file response to a stream that the peer resets with NO_ERROR", () => {
  // Node's respondWithFD() starts to read the descriptor at once. Node 26 can crash when the stream closes before
  // that read is done (SIGSEGV in the callback of FileHandle::ReadStart()), so these two cases run on Bun only.
  // Node passes both when its read is done in time.
  const nodeReadsAtOnce = typeof Bun === "undefined";

  test("respondWithFD(): the reset before the response is out raises nothing", { skip: nodeReadsAtOnce }, async () => {
    const fd = fs.openSync(import.meta.filename, "r");
    // Bun's respondWithFD() sends the response after an fstat().
    const fstat = fs.fstat;
    const { promise: stated, resolve: onStat } = Promise.withResolvers<void>();
    (fs as { fstat: unknown }).fstat = (descriptor: number, callback: (...args: unknown[]) => void) =>
      fstat(descriptor, (...args) => (callback(...args), descriptor === fd && onStat()));
    const server = http2.createServer();
    const { socket, ping } = rawH2Client(await listen(server));
    try {
      const events: string[] = [];
      server.on("stream", stream => {
        // Nothing reads the request, so the stream is still there after the reset.
        stream.pause();
        stream.on("error", error => events.push("error:" + (error as NodeJS.ErrnoException).code));
        stream.on("close", () => events.push("close"));
        stream.respondWithFD(fd);
      });
      // One write: the reset is behind the HEADERS frame that runs respondWithFD().
      socket.write(Buffer.concat([rawPost(), rstStream(1, NGHTTP2_NO_ERROR)]));
      await stated;
      await ping();
      // The descriptor is still the caller's.
      assert.deepStrictEqual({ events, file: fs.fstatSync(fd).isFile() }, { events: [], file: true });
    } finally {
      fs.fstat = fstat;
      socket.destroy();
      server.close();
      fs.closeSync(fd);
    }
  });

  test("respondWithFD(), then close(code) in the same turn, raises nothing", { skip: nodeReadsAtOnce }, async () => {
    const fd = fs.openSync(import.meta.filename, "r");
    const server = http2.createServer();
    const socket = net.connect(await listen(server), "127.0.0.1");
    try {
      const { promise, resolve } = Promise.withResolvers<string[]>();
      server.on("stream", stream => {
        const events: string[] = [];
        stream.on("error", error => events.push("error:" + (error as NodeJS.ErrnoException).code));
        stream.on("close", () => resolve([...events, "close:" + stream.rstCode]));
        stream.respondWithFD(fd);
        stream.close(NGHTTP2_CANCEL);
      });
      socket.on("error", () => {});
      socket.resume();
      socket.write(rawPost());
      assert.deepStrictEqual(await promise, ["close:8"]);
    } finally {
      socket.destroy();
      server.close();
      fs.closeSync(fd);
    }
  });

  test("respondWithFile(): a close before the answer of fstat() destroys the stream", async () => {
    const fstat = fs.fstat;
    const server = http2.createServer();
    const socket = net.connect(await listen(server), "127.0.0.1");
    try {
      const { promise, resolve } = Promise.withResolvers<string[]>();
      server.on("stream", stream => {
        const events: string[] = [];
        stream.on("error", error => events.push("error:" + (error as NodeJS.ErrnoException).code));
        stream.on("close", () => resolve([...events, "close:" + stream.rstCode]));
        // respondWithFile() opens the file, and then it asks for its size.
        (fs as { fstat: unknown }).fstat = (descriptor: number, callback: (...args: unknown[]) => void) =>
          fstat(descriptor, (...args) => (stream.close(NGHTTP2_CANCEL), callback(...args)));
        stream.respondWithFile(import.meta.filename);
      });
      socket.on("error", () => {});
      socket.resume();
      socket.write(rawPost());
      assert.deepStrictEqual(await promise, ["error:ERR_HTTP2_INVALID_STREAM", "close:8"]);
    } finally {
      fs.fstat = fstat;
      socket.destroy();
      server.close();
    }
  });

  test("respondWithFD() with a statCheck: the reset before the response is out destroys the stream", async () => {
    const fd = fs.openSync(import.meta.filename, "r");
    const server = http2.createServer();
    const socket = net.connect(await listen(server), "127.0.0.1");
    try {
      const { promise, resolve } = Promise.withResolvers<string[]>();
      let checked = false;
      server.on("stream", stream => {
        const events: string[] = [];
        stream.pause();
        stream.on("error", error => events.push("error:" + (error as NodeJS.ErrnoException).code));
        stream.on("close", () => resolve([...events, `close:${stream.rstCode}, checked ${checked}`]));
        stream.respondWithFD(fd, {}, { statCheck: () => void (checked = true) });
      });
      socket.on("error", () => {});
      socket.resume();
      socket.write(Buffer.concat([rawPost(), rstStream(1, NGHTTP2_NO_ERROR)]));
      assert.deepStrictEqual(await promise, ["error:ERR_HTTP2_INVALID_STREAM", "close:0, checked false"]);
    } finally {
      socket.destroy();
      server.close();
      fs.closeSync(fd);
    }
  });

  test("a response that is on its way reads no more of its file", async () => {
    // Each block of 64 KiB holds its own number, so one byte at the position of a descriptor tells where it is.
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "h2-reset-"));
    const file = path.join(directory, "blocks");
    fs.writeFileSync(file, Buffer.concat(Array.from({ length: 64 }, (_, block) => Buffer.alloc(65536, block))));
    const fd = fs.openSync(file, "r");
    const block = () => {
      const byte = Buffer.alloc(1);
      return fs.readSync(fd, byte, 0, 1, null) === 1 ? byte[0] : "the end";
    };
    const server = http2.createServer();
    const { socket, frames, ping } = rawH2Client(await listen(server));
    try {
      server.on("stream", stream => {
        // Nothing reads the request, so the stream is still there after the reset.
        stream.pause();
        stream.on("error", () => {});
        stream.respondWithFD(fd);
      });
      socket.write(rawPost());
      // The client's window takes 65,535 bytes. Then the response waits, and so does its file.
      const received = () =>
        frames.reduce((bytes, { type, payload }) => bytes + (type === F.DATA ? payload.length : 0), 0);
      while (received() < 65535) await ping();
      // The read that was on its way when the response began to wait is done: the position no longer moves.
      let waiting = block();
      for (let same = 0; same < 3; same++) {
        await ping();
        const now = block();
        if (now !== waiting) [waiting, same] = [now, -1];
      }
      socket.write(rstStream(1, NGHTTP2_NO_ERROR));
      // A response that reads on gets to a later block in one of these round trips.
      let later = waiting;
      for (let i = 0; i < 50 && later === waiting; i++) {
        await ping();
        later = block();
      }
      assert.deepStrictEqual({ waiting: typeof waiting, later }, { waiting: "number", later: waiting });
    } finally {
      socket.destroy();
      server.close();
      fs.closeSync(fd);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("a consumer of a stream that the peer resets with NO_ERROR while its body is open", () => {
  test("for await on a server stream rejects after the bytes that arrived", async () => {
    const server = http2.createServer();
    const socket = net.connect(await listen(server), "127.0.0.1");
    try {
      const { promise, resolve } = Promise.withResolvers<string>();
      server.on("stream", async stream => {
        stream.on("error", () => {});
        let bytes = 0;
        try {
          for await (const chunk of stream) {
            bytes += chunk.length;
            // The client gives up its upload once the server has all of what it sent.
            if (bytes === 3000) socket.write(rstStream(1, NGHTTP2_NO_ERROR));
          }
          resolve(`resolved as a complete body, ${bytes} bytes`);
        } catch (error) {
          resolve(`rejected ${(error as NodeJS.ErrnoException).code}, ${bytes} bytes`);
        }
      });
      socket.on("error", () => {});
      socket.resume();
      socket.write(rawPost());
      assert.strictEqual(await promise, "rejected ERR_STREAM_PREMATURE_CLOSE, 3000 bytes");
    } finally {
      socket.destroy();
      server.close();
    }
  });

  test("text() on a client stream rejects", async () => {
    let peer!: net.Socket;
    const srv = rawH2Server((socket, sid) => {
      peer = socket;
      answerOpen(socket, sid);
    });
    const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
    try {
      client.on("error", () => {});
      const req = client.request({ ":path": "/", ":method": "POST" });
      req.on("error", () => {});
      // The reset comes once the client has the 600 bytes of the answer.
      req.once("readable", () => peer.write(rstStream(1, NGHTTP2_NO_ERROR)));
      const outcome = await text(req).then(
        body => `resolved as a complete body, ${body.length} bytes`,
        error => `rejected ${(error as NodeJS.ErrnoException).code}`,
      );
      assert.strictEqual(outcome, "rejected ERR_STREAM_PREMATURE_CLOSE");
    } finally {
      client.destroy();
      srv.close();
    }
  });

  // The stream keeps rstCode 0, and the server writes no RST_STREAM.
  for (const [name, consume, frames] of [
    [
      "pipeline(stream, sink)",
      (stream: http2.ServerHttp2Stream, events: string[], reset: () => void) => {
        let sent = false;
        const sink = new Writable({
          write(_chunk, _encoding, callback) {
            // The client gives up its upload once the server has some of it.
            if (!sent) ((sent = true), reset());
            callback();
          },
        });
        pipeline(stream, sink, error => events.push("pipeline:" + (error as NodeJS.ErrnoException | null)?.code));
      },
      [],
    ],
    [
      "pipeline(source, stream)",
      (stream: http2.ServerHttp2Stream, events: string[], reset: () => void) => {
        stream.respond({ ":status": 200 });
        stream.once("data", reset);
        const source = new Readable({ read() {} });
        pipeline(source, stream, error => events.push("pipeline:" + (error as NodeJS.ErrnoException | null)?.code));
      },
      [F.HEADERS],
    ],
  ] as const) {
    test(name, async () => {
      const server = http2.createServer();
      const { socket, frames: sent, ping } = rawH2Client(await listen(server));
      try {
        const events: string[] = [];
        const { promise: closed, resolve } = Promise.withResolvers<void>();
        server.on("stream", stream => {
          stream.on("aborted", () => events.push("aborted"));
          stream.on("close", () => {
            events.push("close:" + stream.rstCode);
            // After the callbacks that 'close' queued.
            setImmediate(resolve);
          });
          consume(stream, events, () => socket.write(rstStream(1, NGHTTP2_NO_ERROR)));
        });
        socket.write(rawPost());
        await closed;
        await ping();
        assert.deepStrictEqual(
          { events, frames: sent.map(({ type }) => type) },
          { events: ["aborted", "close:0", "pipeline:ERR_STREAM_PREMATURE_CLOSE"], frames },
        );
      } finally {
        socket.destroy();
        server.close();
      }
    });
  }

  test("the signal of a request that nothing reads", async () => {
    const frames: RawFrame[] = [];
    const srv = rawH2Server(answerOpenThenReset, frames);
    const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
    try {
      const events: string[] = [];
      const controller = new AbortController();
      const { promise: responded, resolve: respond } = Promise.withResolvers<void>();
      const { promise: closed, resolve } = Promise.withResolvers<void>();
      const req = client.request({ ":path": "/", ":method": "POST" }, { signal: controller.signal });
      req.on("response", respond);
      req.on("error", error => events.push("error:" + (error as NodeJS.ErrnoException).code));
      req.on("close", () => (events.push("close:" + req.rstCode), resolve()));
      await responded;
      // The reset is behind the response, and the client has handled it after a round trip.
      await sessionPing(client);
      await sessionPing(client);
      events.push(`closed ${req.closed}, destroyed ${req.destroyed}`);
      controller.abort();
      await closed;
      // The server has read everything the client sent before this.
      await sessionPing(client);
      assert.deepStrictEqual(
        { events, frames: frames.map(({ type }) => type) },
        { events: ["closed true, destroyed false", "error:ABORT_ERR", "close:0"], frames: [F.HEADERS] },
      );
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
