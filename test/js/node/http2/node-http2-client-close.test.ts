/**
 * Http2Stream.close(code) event contract, client and server, while the peer's half is still open:
 *   NO_ERROR / CANCEL  -> 'end', 'close'             (documented 'error' exemption)
 *   any other code     -> 'error', 'close'           (no 'end': the body was killed by RST_STREAM)
 * Once the peer's half has ended (END_STREAM on a HEADERS frame, or a server push, which has no
 * inbound half) the readable already has its EOF, so 'end' comes first for every code.
 * After close() or destroy(), a client stream ignores header blocks from the same socket read.
 *
 * When the readable side ends on a stream that stays open:
 *   END_STREAM on a HEADERS frame -> the readable gets its EOF, and 'end' waits for a consumer. On Bun an
 *                                    'end' listener that's already attached counts as one.
 *   END_STREAM on a DATA frame    -> the same, and an empty readable emits 'end' at once
 *   both halves closed            -> a server stream nobody read is dumped, any other stream is read
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-client-close.test.ts
 *   node --test test/js/node/http2/node-http2-client-close.test.ts
 */
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import EventEmitter from "node:events";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import { type Duplex, duplexPair, pipeline, Writable } from "node:stream";
import { after, before, describe, test } from "node:test";
import { promisify } from "node:util";

const { NGHTTP2_NO_ERROR, NGHTTP2_CANCEL, NGHTTP2_INTERNAL_ERROR, NGHTTP2_ENHANCE_YOUR_CALM } = http2.constants;

const F = { DATA: 0, HEADERS: 1, RST_STREAM: 3, SETTINGS: 4, PUSH_PROMISE: 5, PING: 6, GOAWAY: 7, CONTINUATION: 9 };
const END_STREAM = 0x1;
const ACK = 0x1;
const END_HEADERS = 0x4;
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
// A header block of literal fields that are never indexed.
const hp = (h: [string, string][]) =>
  Buffer.concat(
    h.map(([k, v]) =>
      Buffer.concat([Buffer.from([0x10, k.length]), Buffer.from(k), Buffer.from([v.length]), Buffer.from(v)]),
    ),
  );

// Raw h2c server. By default it replies 200 + one DATA frame and never sends END_STREAM, so the
// only way the stream ends is via the client's close(code). `onPingAck` fires for each PING ACK.
function rawH2Server(
  respond = (sid: number) => [
    frame(F.HEADERS, END_HEADERS, sid, hp([[":status", "200"]])),
    frame(F.DATA, 0, sid, Buffer.alloc(600, 0x2e)),
  ],
  onPingAck?: () => void,
): net.Server {
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
        s.write(frame(F.SETTINGS, 0, 0));
      }
      while (buf.length >= 9) {
        const len = buf.readUIntBE(0, 3);
        if (buf.length < 9 + len) break;
        const t = buf[3];
        const fl = buf[4];
        const sid = buf.readUInt32BE(5) & 0x7fffffff;
        const pay = buf.slice(9, 9 + len);
        buf = buf.slice(9 + len);
        if (t === F.SETTINGS && !(fl & ACK)) s.write(frame(F.SETTINGS, ACK, 0));
        else if (t === F.PING && !(fl & ACK)) s.write(frame(F.PING, ACK, 0, pay));
        else if (t === F.PING) onPingAck?.();
        else if (t === F.HEADERS) for (const f of respond(sid)) s.write(f);
      }
    });
  });
}

function listen(server: net.Server): Promise<number> {
  return new Promise(resolve =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
  );
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

// close() and destroy() send their RST_STREAM on a later turn, so the parser still dispatches the
// rest of the read for that stream. nghttp2 ignores frames on a closing stream, so Node emits nothing.
describe("header blocks in the same read as a handler that closes the stream", () => {
  const status = (code: string) => hp([[":status", code]]);

  async function eventsWhen(
    listener: "headers" | "response" | "stream",
    act: "close" | "destroy",
    reply: Buffer[],
  ): Promise<string[]> {
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    const dispatched = Promise.withResolvers<void>();
    const watch = (stream: http2.ClientHttp2Stream) => {
      stream.on("continue", () => events.push("continue"));
      stream.on("headers", headers => events.push("headers:" + headers[":status"]));
      stream.on("response", headers => events.push("response:" + headers[":status"]));
      stream.on("push", headers => events.push("push:" + headers[":status"]));
      stream.on("trailers", () => events.push("trailers"));
      stream.on("data", () => events.push("data"));
      stream.on("error", e => events.push("error:" + (e as NodeJS.ErrnoException).code));
      stream.on("close", () => {
        events.push("close:" + stream.rstCode);
        closed.resolve();
      });
    };
    // One write, so one read delivers every frame. The PING ACK means the client dispatched them all.
    const srv = rawH2Server(
      () => [Buffer.concat([...reply, frame(F.PING, 0, 0, Buffer.alloc(8))])],
      dispatched.resolve,
    );
    const port = await listen(srv);
    const client = http2.connect(`http://127.0.0.1:${port}`);
    // Fail the test instead of hanging if the session dies before the PING ACK.
    const fail = (err: unknown) => {
      closed.reject(err);
      dispatched.reject(err);
    };
    client.on("error", fail);
    client.on("close", () => fail(new Error("the session closed before the PING ACK")));
    try {
      const req = client.request({ ":path": "/" }, { endStream: true });
      if (listener === "stream") {
        req.on("error", () => {});
        req.resume();
        client.on("stream", pushed => {
          watch(pushed);
          pushed[act]();
        });
      } else {
        watch(req);
        req.once(listener, () => req[act]());
      }
      await Promise.all([closed.promise, dispatched.promise]);
      return events;
    } finally {
      client.destroy();
      srv.close();
    }
  }

  for (const act of ["destroy", "close"] as const) {
    test(`doesn't emit 'response' after ${act}() in 'headers'`, async () => {
      const reply = [
        frame(F.HEADERS, END_HEADERS, 1, status("103")),
        frame(F.HEADERS, END_HEADERS, 1, status("100")),
        frame(F.HEADERS, END_HEADERS, 1, status("200")),
        frame(F.DATA, END_STREAM, 1, Buffer.from("body")),
      ];
      assert.deepStrictEqual(await eventsWhen("headers", act, reply), ["headers:103", "close:0"]);
    });

    test(`doesn't emit 'trailers' after ${act}() in 'response'`, async () => {
      const reply = [
        frame(F.HEADERS, END_HEADERS, 1, status("200")),
        frame(F.DATA, 0, 1, Buffer.from("body")),
        frame(F.HEADERS, END_HEADERS | END_STREAM, 1, hp([["x-trailer", "1"]])),
      ];
      assert.deepStrictEqual(await eventsWhen("response", act, reply), ["response:200", "close:0"]);
    });
  }

  // No close() case for a pushed stream yet: pushed.close() emits 'error' ("Invalid stream id") and
  // never 'close' on Bun, where node gives ["close:0"]. That is a separate defect.
  test("doesn't emit 'push' after destroy() in the session's 'stream'", async () => {
    const pushPromise = Buffer.concat([
      Buffer.from([0, 0, 0, 2]), // promised stream id
      hp([
        [":method", "GET"],
        [":scheme", "http"],
        [":path", "/pushed"],
        [":authority", "localhost"],
      ]),
    ]);
    const reply = [
      frame(F.PUSH_PROMISE, END_HEADERS, 1, pushPromise),
      frame(F.HEADERS, END_HEADERS, 2, status("200")),
      frame(F.DATA, END_STREAM, 2, Buffer.from("pushed")),
      frame(F.HEADERS, END_HEADERS, 1, status("200")),
      frame(F.DATA, END_STREAM, 1, Buffer.from("body")),
    ];
    assert.deepStrictEqual(await eventsWhen("stream", "destroy", reply), ["close:0"]);
  });
});

// ---- When the readable side ends ----------------------------------------------------------------

const REQUEST = hp([
  [":method", "POST"],
  [":scheme", "http"],
  [":path", "/"],
  [":authority", "localhost"],
]);
const TRAILERS = hp([["x-trailer", "1"]]);

// The frames of a request on stream 1, named after the frame that carries its END_STREAM.
const requestThatEndsOn = {
  "HEADERS": [frame(F.HEADERS, END_HEADERS | END_STREAM, 1, REQUEST)],
  // A split block keeps END_STREAM on its HEADERS frame. The last CONTINUATION has END_HEADERS.
  "HEADERS before a CONTINUATION": [
    frame(F.HEADERS, END_STREAM, 1, REQUEST.subarray(0, 10)),
    frame(F.CONTINUATION, END_HEADERS, 1, REQUEST.subarray(10)),
  ],
  "trailers": [frame(F.HEADERS, END_HEADERS, 1, REQUEST), frame(F.HEADERS, END_HEADERS | END_STREAM, 1, TRAILERS)],
  "an empty DATA frame": [frame(F.HEADERS, END_HEADERS, 1, REQUEST), frame(F.DATA, END_STREAM, 1)],
  "a DATA frame": [frame(F.HEADERS, END_HEADERS, 1, REQUEST), frame(F.DATA, END_STREAM, 1, Buffer.from("hello"))],
} as const;

// What a 'stream' listener awaits before it reads the request.
const waits = {
  "a microtask": async () => {},
  "setImmediate": () => new Promise<void>(resolve => setImmediate(resolve)),
  "file I/O": async () => void (await fs.promises.stat(import.meta.filename)),
} as const;

// Ways to read the request. `done` is called with the body on 'end'.
type Consume = (stream: http2.ServerHttp2Stream, done: (body: string) => void) => void;
const consumers: Record<string, Consume> = {
  "on('data') + on('end')": (stream, done) => {
    let body = "";
    stream.on("data", chunk => (body += chunk));
    stream.on("end", () => done(body));
  },
  "on('end').resume()": (stream, done) => {
    stream.on("end", () => done("")).resume();
  },
  "on('readable') + read()": (stream, done) => {
    let body = "";
    stream.on("readable", () => {
      for (let chunk; (chunk = stream.read()) !== null;) body += chunk;
    });
    stream.on("end", () => done(body));
  },
};

const transports = ["TCP", "duplexPair"] as const;
type Transport = (typeof transports)[number];

// A raw HTTP/2 client.
//   send:    writes the client preface, the given frames and a PING
//   settled: resolves one event loop turn after the PING ACK, so the server has processed the frames
//            and run every tick they queued
//   answer:  resolves with the response body of stream 1 once the response ends
//   goaway:  resolves when the server sends GOAWAY
function rawPeer(socket: Duplex, fail: (error: Error) => void) {
  const answer = Promise.withResolvers<string>();
  const pong = Promise.withResolvers<void>();
  const goaway = Promise.withResolvers<void>();
  let buf = Buffer.alloc(0);
  let body = "";
  socket.on("error", fail);
  socket.on("data", (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 9) {
      const len = buf.readUIntBE(0, 3);
      if (buf.length < 9 + len) break;
      const t = buf[3];
      const fl = buf[4];
      if (t === F.SETTINGS && !(fl & ACK)) socket.write(frame(F.SETTINGS, ACK, 0));
      else if (t === F.PING && fl & ACK) pong.resolve();
      else if (t === F.GOAWAY) goaway.resolve();
      else if (t === F.DATA) body += buf.toString("latin1", 9, 9 + len);
      if ((t === F.DATA || t === F.HEADERS) && fl & END_STREAM) answer.resolve(body);
      buf = buf.subarray(9 + len);
    }
  });
  return {
    answer: answer.promise,
    settled: pong.promise.then(() => new Promise<void>(resolve => setImmediate(resolve))),
    goaway: goaway.promise,
    write: (f: Buffer) => void socket.write(f),
    send: (frames: readonly Buffer[]) =>
      void socket.write(
        Buffer.concat([PREFACE, frame(F.SETTINGS, 0, 0), ...frames, frame(F.PING, 0, 0, Buffer.alloc(8))]),
      ),
  };
}
type RawPeer = ReturnType<typeof rawPeer>;

// Connects a raw client to a server session that calls `onStream` for each request. Over a
// duplexPair the session reads from a JS stream instead of a socket.
//   until: races a promise against a session or socket error
async function rawConnection(
  transport: Transport,
  onStream: (stream: http2.ServerHttp2Stream, peer: RawPeer) => void,
): Promise<{ peer: RawPeer; until: <T>(wait: Promise<T>) => Promise<T>; close: () => void }> {
  const failed = Promise.withResolvers<never>();
  failed.promise.catch(() => {});
  const until = <T>(wait: Promise<T>) => Promise.race([wait, failed.promise]);
  if (transport === "duplexPair") {
    const [socket, serverSide] = duplexPair();
    const peer = rawPeer(socket, failed.reject);
    const session = http2.performServerHandshake(serverSide);
    session.on("stream", stream => onStream(stream, peer));
    session.on("error", failed.reject);
    return { peer, until, close: () => session.destroy() };
  }
  const server = http2.createServer();
  let peer!: RawPeer;
  server.on("stream", stream => onStream(stream, peer));
  server.on("sessionError", failed.reject);
  const socket = net.connect(await listen(server), "127.0.0.1");
  peer = rawPeer(socket, failed.reject);
  return {
    peer,
    until,
    close: () => {
      socket.destroy();
      server.close();
    },
  };
}

type Seen = { readableFlowing: boolean | null; readableEnded: boolean };
const seen = (stream: http2.Http2Stream): Seen => ({
  readableFlowing: stream.readableFlowing,
  readableEnded: stream.readableEnded,
});
const untouched: Seen = { readableFlowing: null, readableEnded: false };

const record = (stream: http2.Http2Stream, events: string[], names = ["aborted", "end", "finish", "close"]) => {
  for (const name of names) stream.on(name, () => events.push(name));
  stream.on("error", e => events.push("error:" + (e as NodeJS.ErrnoException).code));
};
// For streams that have to keep their EOF unread. On Bun an early 'end' listener reads it.
const withoutEnd = ["aborted", "finish", "close"];

// Sends one request. Its 'stream' listener awaits `wait`, reads the request with `consume` and
// answers with the body. Returns the stream's state after the wait, and the answer.
async function readLate(transport: Transport, frames: readonly Buffer[], wait: () => Promise<void>, consume: Consume) {
  const before = Promise.withResolvers<Seen>();
  const { peer, until, close } = await rawConnection(transport, async stream => {
    stream.on("error", before.reject);
    await wait();
    before.resolve(seen(stream));
    consume(stream, body => {
      stream.respond({ ":status": 200 });
      stream.end(`read ${JSON.stringify(body)}`);
    });
  });
  try {
    peer.send(frames);
    const state = await until(before.promise);
    // If 'end' already fired, the listeners missed it and no answer will come.
    const answer = state.readableEnded ? "none: 'end' came before the listeners" : await until(peer.answer);
    return { before: state, answer };
  } finally {
    close();
  }
}

// Returns a server stream's events up to 'close'. `scenario` handles the stream.
async function serverStreamEvents(
  transport: Transport,
  frames: readonly Buffer[],
  scenario: (stream: http2.ServerHttp2Stream, peer: RawPeer, events: string[]) => unknown,
  names?: string[],
) {
  const events: string[] = [];
  const closed = Promise.withResolvers<void>();
  const { peer, until, close } = await rawConnection(transport, (stream, peer) => {
    record(stream, events, names);
    stream.on("close", closed.resolve);
    scenario(stream, peer, events);
  });
  try {
    peer.send(frames);
    await until(closed.promise);
    return events;
  } finally {
    close();
  }
}

// Returns the events and state of a server stream that stays open, once the session has processed
// the client's frames and run every tick they queued.
async function afterFrames(
  transport: Transport,
  frames: readonly Buffer[],
  listen?: (stream: http2.ServerHttp2Stream, events: string[]) => void,
) {
  const delivered = Promise.withResolvers<http2.ServerHttp2Stream>();
  const events: string[] = [];
  const { peer, until, close } = await rawConnection(transport, stream => {
    record(stream, events);
    listen?.(stream, events);
    delivered.resolve(stream);
  });
  try {
    peer.send(frames);
    const stream = await until(delivered.promise);
    await until(peer.settled);
    return { events: [...events], ...seen(stream) };
  } finally {
    close();
  }
}

const answer = (stream: http2.ServerHttp2Stream) => {
  stream.respond({ ":status": 200 });
  stream.end("ok");
};
// 'end' and 'finish' can come in either order, on Node too. Only the set of events and the last one are compared.
const assertEvents = (events: string[], expected: string[], message?: string) =>
  assert.deepStrictEqual(
    { last: events.at(-1), all: events.toSorted() },
    { last: expected.at(-1), all: expected.toSorted() },
    message,
  );

for (const transport of transports) {
  describe(`${transport}: a request that ends on a HEADERS frame`, () => {
    for (const carrier of ["HEADERS", "HEADERS before a CONTINUATION", "trailers"] as const) {
      test(`keeps 'end' for a consumer that comes after an await (END_STREAM on ${carrier})`, async () => {
        const actual: Record<string, unknown> = {};
        const expected: Record<string, unknown> = {};
        for (const [waitName, wait] of Object.entries(waits)) {
          for (const [consumerName, consume] of Object.entries(consumers)) {
            const cell = `${consumerName} after ${waitName}`;
            actual[cell] = await readLate(transport, requestThatEndsOn[carrier], wait, consume);
            expected[cell] = { before: untouched, answer: 'read ""' };
          }
        }
        assert.deepStrictEqual(actual, expected);
      });
    }

    // Node holds 'end' back here too, so a handler that only waits for 'end' before it answers hangs there.
    test("emits 'end' for a listener the 'stream' event attached, even if nothing reads the stream", async () => {
      const expected = process.versions.bun
        ? { events: ["end"], readableFlowing: true, readableEnded: true }
        : { events: [], ...untouched };
      assert.deepStrictEqual(await afterFrames(transport, requestThatEndsOn["HEADERS"]), expected);
    });

    test("ends and closes once it's answered, even if nothing read it", async () => {
      for (const [waitName, wait] of Object.entries(waits)) {
        const events = await serverStreamEvents(transport, requestThatEndsOn["HEADERS"], async stream => {
          await wait();
          answer(stream);
        });
        assertEvents(events, ["end", "finish", "close"], waitName);
      }
    });

    // The stream closes inside respond() here.
    const endsInRespond: Record<string, (stream: http2.ServerHttp2Stream) => void> = {
      "a 204": stream => stream.respond({ ":status": 204 }),
      "a 304": stream => stream.respond({ ":status": 304 }),
      "respond({ endStream: true })": stream => stream.respond({ ":status": 200 }, { endStream: true }),
    };
    for (const [answerName, respond] of Object.entries(endsInRespond)) {
      test(`is not aborted when ${answerName} answers it after an await`, async () => {
        for (const [waitName, wait] of Object.entries(waits)) {
          const events = await serverStreamEvents(transport, requestThatEndsOn["HEADERS"], async stream => {
            await wait();
            respond(stream);
          });
          assertEvents(events, ["finish", "end", "close"], waitName);
        }
      });
    }

    test("ends for a late reader that calls close(code)", async () => {
      const actual: Record<string, string[]> = {};
      for (const code of [NGHTTP2_NO_ERROR, NGHTTP2_CANCEL, NGHTTP2_INTERNAL_ERROR]) {
        actual[code] = await serverStreamEvents(
          transport,
          requestThatEndsOn["HEADERS"],
          async (stream, _peer, events) => {
            await waits["setImmediate"]();
            stream.on("end", () => events.push("end")).resume();
            stream.close(code);
          },
          withoutEnd,
        );
      }
      assert.deepStrictEqual(actual, {
        [NGHTTP2_NO_ERROR]: ["aborted", "finish", "end", "close"],
        [NGHTTP2_CANCEL]: ["aborted", "finish", "end", "close"],
        [NGHTTP2_INTERNAL_ERROR]: ["aborted", "finish", "end", "error:ERR_HTTP2_STREAM_ERROR", "close"],
      });
    });

    test("ends when its trailers arrive after session.close()", async () => {
      const { peer, until, close } = await rawConnection(transport, stream => {
        consumers["on('data') + on('end')"](stream, () => answer(stream));
        stream.session!.close();
      });
      try {
        peer.send([frame(F.HEADERS, END_HEADERS, 1, REQUEST)]);
        await until(peer.goaway);
        peer.write(frame(F.HEADERS, END_HEADERS | END_STREAM, 1, TRAILERS));
        assert.strictEqual(await until(peer.answer), "ok");
      } finally {
        close();
      }
    });
  });

  describe(`${transport}: a request that ends on a DATA frame`, () => {
    test("keeps its data and 'end' for a consumer that comes after an await", async () => {
      const actual: Record<string, unknown> = {};
      const expected: Record<string, unknown> = {};
      for (const [waitName, wait] of Object.entries(waits)) {
        const consume = consumers["on('data') + on('end')"];
        actual[waitName] = await readLate(transport, requestThatEndsOn["a DATA frame"], wait, consume);
        expected[waitName] = { before: untouched, answer: 'read "hello"' };
      }
      assert.deepStrictEqual(actual, expected);
    });

    // Like node's onStreamClose, a request nobody tried to read is dumped.
    test("is dumped and closes when it's answered before anything reads it", async () => {
      for (const [waitName, wait] of Object.entries(waits)) {
        const events = await serverStreamEvents(transport, requestThatEndsOn["a DATA frame"], async stream => {
          await wait();
          answer(stream);
        });
        assertEvents(events, ["end", "finish", "close"], waitName);
      }
    });

    // Like node's onStreamRead, EOF on a DATA frame ends an empty readable at once without making it flow.
    test("ends by itself when the frame is empty", async () => {
      assert.deepStrictEqual(await afterFrames(transport, requestThatEndsOn["an empty DATA frame"]), {
        events: ["end"],
        readableFlowing: null,
        readableEnded: true,
      });
    });

    // pause() holds back data, not the 'end' of a readable with nothing buffered.
    test("ends while its consumer has paused it, when no data is left", async () => {
      const hello = frame(F.DATA, 0, 1, Buffer.from("hello"));
      for (const frames of [
        requestThatEndsOn["a DATA frame"],
        [frame(F.HEADERS, END_HEADERS, 1, REQUEST), hello, frame(F.DATA, END_STREAM, 1)],
      ]) {
        const state = await afterFrames(transport, frames, (stream, events) => {
          stream.on("data", chunk => {
            events.push(`data: ${chunk}`);
            stream.pause();
          });
        });
        assert.deepStrictEqual(state, { events: ["data: hello", "end"], readableFlowing: false, readableEnded: true });
      }
    });
  });
}

describe("a compat request", () => {
  test("is not aborted when a 204 answers it after an await", async () => {
    const aborted = Promise.withResolvers<boolean>();
    const server = http2.createServer(async (req, res) => {
      await waits["setImmediate"]();
      res.on("close", () => aborted.resolve(req.aborted));
      res.writeHead(204);
      res.end();
    });
    const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
    try {
      client.request({ ":path": "/" }).resume();
      assert.strictEqual(await aborted.promise, false);
    } finally {
      client.destroy();
      server.close();
    }
  });
});

// Runs in a child process. A session created inside a test inherits the test runner's async context,
// which hides the caller's store from the stream's handlers.
test("a server stream's 'end' doesn't run in the AsyncLocalStorage store of the call that answered", async () => {
  const script = `
    const http2 = require("node:http2");
    const storage = new (require("node:async_hooks").AsyncLocalStorage)();
    const stores = {};
    const server = http2.createServer();
    server.on("stream", async stream => {
      stream.on("end", () => (stores.end = storage.getStore() ?? "none"));
      stream.on("finish", () => (stores.finish = storage.getStore() ?? "none"));
      stream.on("close", () => {
        console.log(JSON.stringify(stores));
        process.exit(0);
      });
      await new Promise(setImmediate);
      storage.run("answer", () => {
        stream.respond({ ":status": 200 });
        stream.end("ok");
      });
    });
    server.listen(0, "127.0.0.1", () => {
      http2.connect("http://127.0.0.1:" + server.address().port).request({ ":path": "/" }).resume();
    });
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ["-e", script]);
  assert.deepStrictEqual(JSON.parse(stdout), { end: "none", finish: "answer" });
});

// Over a duplexPair the trailers are dispatched before close(code) takes effect, on Node too.
for (const transport of transports) {
  test(`${transport}: a server stream that close(code) closed ignores trailers in the same write`, async () => {
    const upload = [
      frame(F.HEADERS, END_HEADERS, 1, REQUEST),
      frame(F.DATA, 0, 1, Buffer.from("hello")),
      frame(F.HEADERS, END_HEADERS | END_STREAM, 1, TRAILERS),
    ];
    const events = await serverStreamEvents(transport, upload, stream => {
      stream.on("data", () => stream.close(NGHTTP2_INTERNAL_ERROR));
    });
    assert.deepStrictEqual(events, [
      "aborted",
      ...(transport === "TCP" ? [] : ["end"]),
      "finish",
      "error:ERR_HTTP2_STREAM_ERROR",
      "close",
    ]);
  });
}

describe("a stream that errors after both halves have closed", () => {
  // write() after end() errors the stream, so it never emits 'end'.
  for (const [waitName, wait] of Object.entries(waits)) {
    test(`server: respond(), end() after ${waitName}, then write()`, async () => {
      const events = await serverStreamEvents(
        "TCP",
        requestThatEndsOn["HEADERS"],
        async stream => {
          await wait();
          stream.respond({ ":status": 200 });
          stream.end();
          stream.write("late");
        },
        withoutEnd,
      );
      assert.deepStrictEqual(events, ["finish", "error:ERR_STREAM_WRITE_AFTER_END", "close"]);
    });
  }

  test("client: end(), then write(), after a response that ended on HEADERS", async () => {
    const server = rawH2Server(sid => [frame(F.HEADERS, END_HEADERS | END_STREAM, sid, hp([[":status", "204"]]))]);
    const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
    try {
      const req = client.request({ ":method": "POST", ":path": "/" });
      const events: string[] = [];
      const closed = Promise.withResolvers<void>();
      record(req, events, withoutEnd);
      req.on("close", closed.resolve);
      await EventEmitter.once(req, "response");
      await waits["setImmediate"]();
      req.end();
      req.write("late");
      await closed.promise;
      assert.deepStrictEqual(events, ["finish", "error:ERR_STREAM_WRITE_AFTER_END", "close"]);
    } finally {
      client.destroy();
      server.close();
    }
  });
});

// respond() ends the response to a HEAD request itself. Node emits 'error' for the write(), which is uncaught here.
test(
  "a handler that awaits and then answers HEAD like GET doesn't crash the server",
  { skip: !process.versions.bun },
  async () => {
    const script = `
    const http2 = require("node:http2");
    const server = http2.createServer();
    server.on("stream", async stream => {
      await new Promise(setImmediate);
      stream.respond({ ":status": 200 });
      stream.write("body");
      stream.end();
    });
    server.listen(0, "127.0.0.1", async () => {
      const client = http2.connect("http://127.0.0.1:" + server.address().port);
      const results = [];
      for (const method of ["HEAD", "GET"]) {
        const req = client.request({ ":method": method, ":path": "/" });
        const result = { method, body: "" };
        req.on("response", headers => (result.status = headers[":status"]));
        req.on("data", chunk => (result.body += chunk));
        await new Promise(resolve => req.on("close", resolve));
        results.push({ ...result, rstCode: req.rstCode });
      }
      console.log(JSON.stringify(results));
      client.close();
      server.close();
    });
  `;
    const { stdout } = await promisify(execFile)(process.execPath, ["-e", script]);
    assert.deepStrictEqual(JSON.parse(stdout), [
      { method: "HEAD", body: "", status: 200, rstCode: 0 },
      { method: "GET", body: "body", status: 200, rstCode: 0 },
    ]);
  },
);

describe("a client stream whose response ends on a HEADERS frame", () => {
  const NO_CONTENT = hp([[":status", "204"]]);
  const responses = {
    "HEADERS": (sid: number) => [frame(F.HEADERS, END_HEADERS | END_STREAM, sid, NO_CONTENT)],
    "HEADERS before a CONTINUATION": (sid: number) => [
      frame(F.HEADERS, END_STREAM, sid, NO_CONTENT.subarray(0, 5)),
      frame(F.CONTINUATION, END_HEADERS, sid, NO_CONTENT.subarray(5)),
    ],
  };
  // The request stays open, so the stream is only half closed when the response ends.
  for (const [waitName, wait] of Object.entries(waits)) {
    test(`keeps 'end' for listeners that come after ${waitName}`, async () => {
      for (const [carrier, respond] of Object.entries(responses)) {
        const server = rawH2Server(respond);
        const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
        try {
          const req = client.request({ ":method": "POST", ":path": "/" });
          await EventEmitter.once(req, "response");
          await wait();
          const before = seen(req);
          if (!before.readableEnded) {
            const ended = EventEmitter.once(req, "end");
            req.resume();
            await ended;
          }
          assert.deepStrictEqual(before, untouched, `END_STREAM on ${carrier}`);
        } finally {
          client.destroy();
          server.close();
        }
      }
    });
  }

  test("emits no 'end' after close(code) when the closing HEADERS frame follows in the same write", async () => {
    const server = rawH2Server(sid => [
      Buffer.concat([
        frame(F.HEADERS, END_HEADERS, sid, hp([[":status", "200"]])),
        frame(F.DATA, 0, sid, Buffer.from("hello")),
        frame(F.HEADERS, END_HEADERS | END_STREAM, sid, hp([["x-trailer", "1"]])),
      ]),
    ]);
    const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
    try {
      const req = client.request({ ":method": "POST", ":path": "/" });
      const events: string[] = [];
      const closed = Promise.withResolvers<void>();
      record(req, events);
      req.on("close", closed.resolve);
      req.on("data", () => req.close(NGHTTP2_INTERNAL_ERROR));
      await closed.promise;
      assert.deepStrictEqual(events, ["aborted", "finish", "error:ERR_HTTP2_STREAM_ERROR", "close"]);
    } finally {
      client.destroy();
      server.close();
    }
  });

  test("still ends and closes a pushed stream", async () => {
    const server = http2.createServer();
    server.on("stream", stream => {
      stream.on("error", () => {});
      stream.pushStream({ ":path": "/pushed" }, (err, pushed) => {
        assert.ifError(err);
        pushed.on("error", () => {});
        pushed.respond({ ":status": 204 }, { endStream: true });
      });
      answer(stream);
    });
    const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
    try {
      const events: string[] = [];
      const closed = Promise.withResolvers<void>();
      client.on("stream", pushed => {
        record(pushed, events);
        pushed.on("push", () => events.push("push"));
        pushed.on("close", closed.resolve);
        pushed.resume();
      });
      client
        .request({ ":path": "/" })
        .on("error", () => {})
        .resume();
      await closed.promise;
      assert.deepStrictEqual(events, ["push", "end", "close"]);
    } finally {
      client.destroy();
      server.close();
    }
  });
});

// Raw h2c server that sends `settings` as its SETTINGS payload and records the client's HEADERS, DATA
// and RST_STREAM frames by name. It answers every request but the first with 200 and END_STREAM.
// `finishFirst()` answers the first one.
function recordingServer(settings: Buffer, onRstStream?: (code: number) => void) {
  const PREFACE_LENGTH = 24;
  const RST_STREAM = 3;
  const names: Record<number, string> = { [F.DATA]: "DATA", [F.HEADERS]: "HEADERS", [RST_STREAM]: "RST_STREAM" };
  const frames: string[] = [];
  const ok = (id: number) => frame(F.HEADERS, END_HEADERS | END_STREAM, id, hp([[":status", "200"]]));
  let socket: net.Socket;
  const server = net.createServer(s => {
    socket = s;
    let buf = Buffer.alloc(0);
    let pre = false;
    s.on("error", () => {});
    s.write(frame(F.SETTINGS, 0, 0, settings));
    s.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (!pre) {
        if (buf.length < PREFACE_LENGTH) return;
        pre = true;
        buf = buf.subarray(PREFACE_LENGTH);
      }
      while (buf.length >= 9) {
        const len = buf.readUIntBE(0, 3);
        if (buf.length < 9 + len) break;
        const [t, fl] = [buf[3], buf[4]];
        const sid = buf.readUInt32BE(5) & 0x7fffffff;
        const pay = buf.subarray(9, 9 + len);
        buf = buf.subarray(9 + len);
        if (names[t]) frames.push(names[t]);
        if (t === F.SETTINGS && !(fl & 1)) s.write(frame(F.SETTINGS, 1, 0, Buffer.alloc(0)));
        else if (t === F.PING && !(fl & 1)) s.write(frame(F.PING, 1, 0, pay));
        else if (t === RST_STREAM) onRstStream?.(pay.readUInt32BE(0));
        else if ((t === F.HEADERS || t === F.DATA) && fl & END_STREAM && sid !== 1) s.write(ok(sid));
      }
    });
  });
  return { server, frames, finishFirst: () => socket.write(ok(1)) };
}
const maxConcurrentStreams = (n: number) => Buffer.from([0, 3, 0, 0, 0, n]);
const once = (emitter: NodeJS.EventEmitter, event: string) =>
  new Promise<void>(resolve => emitter.once(event, resolve));
const ping = (session: http2.ClientHttp2Session) =>
  new Promise<void>((resolve, reject) => session.ping(err => (err ? reject(err) : resolve())));

describe("close(code) on a request that waits for a stream slot", () => {
  const sent = ["HEADERS", "HEADERS", "DATA", "HEADERS"];
  const dropped = ["HEADERS", "HEADERS"];
  for (const [name, act, code, expected] of [
    ["close()", req => req.close(), NGHTTP2_NO_ERROR, dropped],
    ["close(CANCEL)", req => req.close(NGHTTP2_CANCEL), NGHTTP2_CANCEL, dropped],
    ["close(INTERNAL_ERROR)", req => req.close(NGHTTP2_INTERNAL_ERROR), NGHTTP2_INTERNAL_ERROR, dropped],
    ["write(body), close(CANCEL)", req => void (req.write("body"), req.close(NGHTTP2_CANCEL)), NGHTTP2_CANCEL, dropped],
    ["end(body), close(CANCEL)", req => void (req.end("body"), req.close(NGHTTP2_CANCEL)), NGHTTP2_CANCEL, dropped],
    ["end(), close()", req => void (req.end(), req.close()), NGHTTP2_NO_ERROR, dropped],
    // The reset waits for 'finish', so the request goes out first.
    ["end(body), close()", req => void (req.end("body"), req.close()), NGHTTP2_NO_ERROR, sent],
  ] as [string, (req: http2.ClientHttp2Stream) => void, number, string[]][]) {
    test(`${name} ${expected === sent ? "sends" : "doesn't send"} the request`, async () => {
      const { server, frames, finishFirst } = recordingServer(maxConcurrentStreams(1));
      const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
      try {
        await once(client, "remoteSettings");
        client.request({ ":path": "/first" }).resume();
        const req = client.request({ ":path": "/closed", ":method": "POST" });
        req.on("error", () => {});
        const closed = once(req, "close");
        act(req);
        const last = client.request({ ":path": "/last" }).resume();
        // The requests behind the first one must not move before its slot is free.
        await ping(client);
        finishFirst();
        await Promise.all([closed, once(last, "close")]);
        await ping(client);
        assert.deepStrictEqual(
          { rstCode: req.rstCode, frames: frames.filter(f => f !== "RST_STREAM") },
          { rstCode: code, frames: expected },
        );
        if (expected === dropped) assert.deepStrictEqual(frames, dropped);
      } finally {
        client.destroy();
        server.close();
      }
    });
  }
});

test("session.close() doesn't wait for a request that was destroyed while it waited for a stream slot", async () => {
  // No slot ever frees, so only the request leaving the queue can finish the close.
  const { server, frames } = recordingServer(maxConcurrentStreams(0));
  const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
  try {
    // An unacknowledged SETTINGS frame would finish the close on its own when the ACK arrives.
    await Promise.all([once(client, "remoteSettings"), once(client, "localSettings")]);
    const req = client.request({ ":path": "/" });
    const closed = Promise.all([once(req, "close"), once(client, "close")]);
    req.destroy();
    client.close();
    await closed;
    assert.deepStrictEqual(frames, []);
  } finally {
    client.destroy();
    server.close();
  }
});

test("a request that waited for a stream slot runs in its request() caller's async context", async () => {
  const als = new AsyncLocalStorage<string>();
  const server = http2.createServer({ settings: { maxConcurrentStreams: 1 } });
  server.on("stream", stream => {
    stream.resume();
    stream.on("end", () => {
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });
  });
  const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
  try {
    await once(client, "remoteSettings");
    const stores: Record<string, (string | undefined)[]> = {};
    await Promise.all(
      ["alice", "bob", "carol"].map(user =>
        als.run(user, () => {
          const seen: (string | undefined)[] = (stores[user] = []);
          const req = client.request({ ":path": "/", ":method": "POST" });
          req.write("chunk", () => seen.push(als.getStore()));
          req.on("finish", () => seen.push(als.getStore()));
          req.on("response", () => seen.push(als.getStore()));
          req.end();
          return once(req.resume(), "close");
        }),
      ),
    );
    assert.deepStrictEqual(stores, {
      alice: ["alice", "alice", "alice"],
      bob: ["bob", "bob", "bob"],
      carol: ["carol", "carol", "carol"],
    });
  } finally {
    client.destroy();
    server.close();
  }
});

describe("close(code) with a reader that destroys the stream from 'aborted'", () => {
  const sink = () => new Writable({ write: (_chunk, _encoding, callback) => callback() });
  for (const [name, read] of [
    ["pipeline(stream, sink)", req => void pipeline(req, sink(), () => {})],
    ["on('aborted', () => stream.destroy())", req => void req.on("aborted", () => req.destroy())],
  ] as [string, (req: http2.ClientHttp2Stream) => void][]) {
    for (const code of [NGHTTP2_CANCEL, NGHTTP2_ENHANCE_YOUR_CALM]) {
      test(`${name}, close(${code})`, async () => {
        const { promise: rstStream, resolve: onRstStream } = Promise.withResolvers<number>();
        const { server } = recordingServer(Buffer.alloc(0), onRstStream);
        const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
        try {
          await once(client, "remoteSettings");
          const req = client.request({ ":path": "/", ":method": "POST" });
          req.on("error", () => {});
          let inAborted: number | undefined;
          req.on("aborted", () => (inAborted = req.rstCode));
          read(req);
          const closed = once(req, "close");
          req.close(code);
          await closed;
          assert.deepStrictEqual({ inAborted, atClose: req.rstCode }, { inAborted: code, atClose: code });
          // Node before nodejs/node#66314 writes no RST_STREAM at all here.
          if (process.versions.bun) assert.strictEqual(await rstStream, code);
        } finally {
          client.destroy();
          server.close();
        }
      });
    }
  }
});

// Both sessions run in this process, so the server answers close()'s END_STREAM inside the write of
// that frame and the client parses the response before close() returns.
describe("close(code) on a duplexPair() whose server answers END_STREAM right away", () => {
  for (const code of [NGHTTP2_NO_ERROR, NGHTTP2_CANCEL]) {
    test(`close(${code}) doesn't emit 'error'`, async () => {
      const [clientSide, serverSide] = duplexPair();
      const server = http2.createServer();
      server.on("stream", (stream: http2.ServerHttp2Stream) => {
        stream.on("error", () => {});
        // The request has no DATA, so the first 'readable' is its EOF.
        stream.on("readable", () => {
          while (stream.read() !== null);
          if (stream.headersSent) return;
          stream.respond({ ":status": 200 });
          stream.end("ok");
        });
      });
      server.emit("connection", serverSide);
      const client = http2.connect("http://localhost", { createConnection: () => clientSide });
      try {
        const events: string[] = [];
        const { promise: settled, resolve, reject } = Promise.withResolvers<void>();
        client.on("error", reject);
        const opened = once(server, "stream");
        const req = client.request({ ":method": "POST", ":path": "/" });
        await opened;
        req.on("error", err => {
          events.push("error:" + (err as NodeJS.ErrnoException).code);
          // This error can leave the stream open, with no 'close'.
          resolve();
        });
        req.on("close", () => {
          events.push("close:" + req.rstCode);
          resolve();
        });
        req.resume();
        req.close(code);
        await settled;
        assert.deepStrictEqual(events, ["close:" + code]);
      } finally {
        client.destroy();
        server.close();
      }
    });
  }
});

if (typeof Bun !== "undefined") {
  const node = Bun.which("node");
  // Alpine's node segfaults at a random point of this file (alpine 3.23 aarch64, on main too), and
  // the CI runner fails a file for any new core dump, whichever process wrote it. The glibc, macOS
  // and Windows lanes keep the cross-check.
  const isMusl =
    process.platform === "linux" &&
    !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime;
  // Node runs this file in parallel with Bun, so the test only waits for the result.
  const runOnNode = () =>
    Bun.spawn({
      cmd: [node as string, "--test", import.meta.filename],
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
  let run: ReturnType<typeof runOnNode> | undefined;
  let output: Promise<string[]> | undefined;
  before(() => {
    if (!node || isMusl) return;
    run = runOnNode();
    output = Promise.all([run.stdout.text(), run.stderr.text()]);
  });
  after(() => run?.kill());
  describe("Node.js compatibility", () => {
    test("tests should run on node.js", { skip: !node || isMusl }, async () => {
      const [stdout, stderr] = await output!;
      assert.strictEqual(await run!.exited, 0, stdout + stderr);
    });
  });
}
