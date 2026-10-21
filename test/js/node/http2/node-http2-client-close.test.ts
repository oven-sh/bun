/**
 * Http2Stream.close(code) event contract, client and server, while the peer's half is still open:
 *   NO_ERROR / CANCEL  -> 'end', 'close'             (documented 'error' exemption)
 *   any other code     -> 'error', 'close'           (no 'end': the body was killed by RST_STREAM)
 * Once the peer's half has ended (END_STREAM on a HEADERS frame, or a server push, which has no
 * inbound half) the readable already has its EOF, so 'end' comes first for every code.
 *
 * When the readable side ends, for a stream that nothing closes:
 *   END_STREAM on a HEADERS frame -> the readable gets its EOF, and 'end' waits for a consumer
 *   END_STREAM on a DATA frame    -> the same, and an empty readable emits 'end' at once
 *   both halves closed            -> a server stream that nothing read is dumped, any other is read
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-client-close.test.ts
 *   node --test test/js/node/http2/node-http2-client-close.test.ts
 */
import assert from "node:assert";
import { execFile } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import { type Duplex, duplexPair } from "node:stream";
import { after, before, describe, test } from "node:test";
import { promisify } from "node:util";

const { NGHTTP2_NO_ERROR, NGHTTP2_CANCEL, NGHTTP2_INTERNAL_ERROR, NGHTTP2_ENHANCE_YOUR_CALM } = http2.constants;

const F = { DATA: 0, HEADERS: 1, RST_STREAM: 3, SETTINGS: 4, PING: 6, GOAWAY: 7, CONTINUATION: 9 };
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
// only way the stream ends is via the client's close(code).
function rawH2Server(
  respond = (sid: number) => [
    frame(F.HEADERS, END_HEADERS, sid, hp([[":status", "200"]])),
    frame(F.DATA, 0, sid, Buffer.alloc(600, 0x2e)),
  ],
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

// What a listener awaits before it reads its stream.
const waits = {
  "a microtask": async () => {},
  "setImmediate": () => new Promise<void>(resolve => setImmediate(resolve)),
  "file I/O": async () => void (await fs.promises.stat(import.meta.filename)),
} as const;

// How a 'stream' listener reads the request. `done` gets what it read when 'end' comes.
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

// The client end of a connection as a raw HTTP/2 peer.
//   send:    writes the client preface, then the given frames, then a PING
//   settled: the server acknowledged that PING, so it has processed the frames, and the event
//            loop has turned once more, so every tick those frames queued has run
//   answer:  the body of the response to stream 1, once that response ends
//   goaway:  the server sent GOAWAY
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

// A server session whose 'stream' listener is `onStream`, and a raw peer as its client. Over a
// duplexPair the session reads from a JS stream, not from a socket.
//   until: the given promise, or a rejection when the session or the peer's socket fails first
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

const record = (stream: http2.Http2Stream, events: string[]) => {
  for (const name of ["aborted", "end", "finish", "close"]) stream.on(name, () => events.push(name));
  stream.on("error", e => events.push("error:" + (e as NodeJS.ErrnoException).code));
};

// One request whose 'stream' listener awaits `wait`, then reads the request with `consume` and
// answers with what it read. Resolves to the stream as the wait left it, and the answer.
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
    // An 'end' that came before the listeners never reaches them: there is no answer to wait for.
    const answer = state.readableEnded ? "none: 'end' came before the listeners" : await until(peer.answer);
    return { before: state, answer };
  } finally {
    close();
  }
}

// The events of a server stream that `scenario` handles, up to its 'close'.
async function serverStreamEvents(
  transport: Transport,
  frames: readonly Buffer[],
  scenario: (stream: http2.ServerHttp2Stream, peer: RawPeer, events: string[]) => unknown,
) {
  const events: string[] = [];
  const closed = Promise.withResolvers<void>();
  const { peer, until, close } = await rawConnection(transport, (stream, peer) => {
    record(stream, events);
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

// The events and the state of a server stream that nothing closes, once the session has processed
// the peer's frames and every tick they queued has run.
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
// `bun` is Bun's exact sequence. node orders 'end' and 'finish' differently in some rows, so
// under node only the set of events and the last one are compared.
const assertEvents = (events: string[], bun: string[], message?: string) =>
  process.versions.bun
    ? assert.deepStrictEqual(events, bun, message)
    : assert.deepStrictEqual(
        { last: events.at(-1), all: events.toSorted() },
        { last: bun.at(-1), all: bun.toSorted() },
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

    test("emits no 'end' while nothing reads the stream", async () => {
      assert.deepStrictEqual(await afterFrames(transport, requestThatEndsOn["HEADERS"]), { events: [], ...untouched });
    });

    test("ends and closes a stream that nothing read, once it is answered", async () => {
      for (const [waitName, wait] of Object.entries(waits)) {
        const events = await serverStreamEvents(transport, requestThatEndsOn["HEADERS"], async stream => {
          await wait();
          answer(stream);
        });
        const finishFirst = transport === "TCP" && waitName === "a microtask";
        assertEvents(events, finishFirst ? ["finish", "end", "close"] : ["end", "finish", "close"], waitName);
      }
    });

    // The stream closes inside respond() here. main reported such a request as aborted.
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

    test("ends a stream that the peer resets with NO_ERROR", async () => {
      for (const consume of [null, consumers["on('data') + on('end')"]]) {
        const events = await serverStreamEvents(transport, requestThatEndsOn["HEADERS"], async (stream, peer) => {
          consume?.(stream, () => {});
          await peer.settled;
          peer.write(frame(F.RST_STREAM, 0, 1, Buffer.alloc(4)));
        });
        assertEvents(events, consume ? ["end", "aborted", "finish", "close"] : ["aborted", "end", "finish", "close"]);
      }
    });

    test("ends for a late reader that calls close(code)", async () => {
      const actual: Record<string, string[]> = {};
      for (const code of [NGHTTP2_NO_ERROR, NGHTTP2_CANCEL, NGHTTP2_INTERNAL_ERROR]) {
        actual[code] = await serverStreamEvents(transport, requestThatEndsOn["HEADERS"], async stream => {
          await waits["setImmediate"]();
          stream.resume();
          stream.close(code);
        });
      }
      assert.deepStrictEqual(actual, {
        [NGHTTP2_NO_ERROR]: ["aborted", "finish", "end", "close"],
        [NGHTTP2_CANCEL]: ["aborted", "finish", "end", "close"],
        [NGHTTP2_INTERNAL_ERROR]: ["aborted", "finish", "end", "error:ERR_HTTP2_STREAM_ERROR", "close"],
      });
    });

    // The 'trailers' event itself is not asserted: Bun does not emit it on a closed session.
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

    // node's onStreamClose: nobody tried to read the request, so its data is dumped.
    test("is dumped and closes when it is answered before anything reads it", async () => {
      for (const [waitName, wait] of Object.entries(waits)) {
        const events = await serverStreamEvents(transport, requestThatEndsOn["a DATA frame"], async stream => {
          await wait();
          answer(stream);
        });
        const finishFirst = transport === "TCP" && waitName === "a microtask";
        assertEvents(events, finishFirst ? ["finish", "end", "close"] : ["end", "finish", "close"], waitName);
      }
    });

    // node's onStreamRead reads at EOF: an empty readable ends at once and does not start to flow.
    test("ends by itself when the frame is empty", async () => {
      assert.deepStrictEqual(await afterFrames(transport, requestThatEndsOn["an empty DATA frame"]), {
        events: ["end"],
        readableFlowing: null,
        readableEnded: true,
      });
    });

    // The same read: a pause() holds back data, not the 'end' of a readable that has none left.
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

  describe(`${transport}: a paused server stream`, () => {
    const paused: Record<string, (stream: http2.ServerHttp2Stream) => unknown> = {
      "paused at once, answered at once": stream => {
        stream.pause();
        answer(stream);
      },
      "paused at once, answered after setImmediate": async stream => {
        stream.pause();
        await waits["setImmediate"]();
        answer(stream);
      },
      "paused after setImmediate, then answered": async stream => {
        await waits["setImmediate"]();
        stream.pause();
        answer(stream);
      },
    };
    for (const [name, scenario] of Object.entries(paused)) {
      test(`ends and closes when both halves have closed (${name})`, async () => {
        const events = await serverStreamEvents(transport, requestThatEndsOn["HEADERS"], scenario);
        const finishFirst = transport === "TCP" && name === "paused at once, answered at once";
        assertEvents(events, finishFirst ? ["finish", "end", "close"] : ["end", "finish", "close"]);
      });
    }

    // 'end' comes before the answer here, and node then destroys the stream before its 'finish'.
    test("ends when an empty DATA frame carries END_STREAM", async () => {
      const events = await serverStreamEvents(transport, requestThatEndsOn["an empty DATA frame"], stream => {
        stream.pause();
        answer(stream);
      });
      assert.deepStrictEqual(
        events.filter(name => name !== "finish"),
        ["end", "close"],
      );
    });

    test("ends when END_STREAM comes after the response", async () => {
      const events = await serverStreamEvents(
        transport,
        [frame(F.HEADERS, END_HEADERS, 1, REQUEST)],
        (stream, peer) => {
          stream.pause();
          answer(stream);
          peer.answer.then(() => peer.write(frame(F.DATA, END_STREAM, 1)));
        },
      );
      assertEvents(events, transport === "TCP" ? ["finish", "end", "close"] : ["end", "finish", "close"]);
    });

    for (const [waitName, wait] of Object.entries(waits)) {
      test(`emits 'end' when close(code) closes it after ${waitName}, for NO_ERROR only`, async () => {
        const actual: Record<string, string[]> = {};
        for (const code of [NGHTTP2_NO_ERROR, NGHTTP2_CANCEL, NGHTTP2_INTERNAL_ERROR]) {
          actual[code] = await serverStreamEvents(transport, requestThatEndsOn["HEADERS"], async stream => {
            stream.pause();
            await wait();
            stream.close(code);
          });
        }
        assert.deepStrictEqual(actual, {
          [NGHTTP2_NO_ERROR]: ["aborted", "finish", "end", "close"],
          [NGHTTP2_CANCEL]: ["aborted", "finish", "close"],
          [NGHTTP2_INTERNAL_ERROR]: ["aborted", "finish", "error:ERR_HTTP2_STREAM_ERROR", "close"],
        });
      });
    }

    const answersThenDestroys: Record<string, (stream: http2.ServerHttp2Stream) => void> = {
      "respond({ endStream: true })": stream => stream.respond({ ":status": 401 }, { endStream: true }),
      "end(chunk)": stream => {
        stream.respond({ ":status": 401 });
        stream.end("no");
      },
      "end()": stream => {
        stream.respond({ ":status": 401 });
        stream.end();
      },
    };
    for (const [name, respond] of Object.entries(answersThenDestroys)) {
      test(`gets no 'end' when destroy() follows ${name}`, async () => {
        const events = await serverStreamEvents(transport, requestThatEndsOn["HEADERS"], async stream => {
          stream.pause();
          await waits["setImmediate"]();
          respond(stream);
          stream.destroy();
        });
        assert.deepStrictEqual(events, name === "end(chunk)" ? ["close"] : ["finish", "close"]);
      });
    }

    test("keeps unread data until the user reads it", async () => {
      const delivered = Promise.withResolvers<http2.ServerHttp2Stream>();
      const events: string[] = [];
      const { peer, until, close } = await rawConnection(transport, stream => {
        stream.pause();
        record(stream, events);
        answer(stream);
        delivered.resolve(stream);
      });
      try {
        peer.send(requestThatEndsOn["a DATA frame"]);
        const stream = await until(delivered.promise);
        await until(peer.answer);
        if (!stream.writableFinished) await once(stream, "finish");
        // An 'error' event that user code emits is not an error of the stream: the wait goes on.
        stream.emit("error", new Error("from user code"));
        await waits["setImmediate"]();
        assert.deepStrictEqual(
          { events, destroyed: stream.destroyed, readableLength: stream.readableLength },
          { events: ["finish", "error:undefined"], destroyed: false, readableLength: 5 },
        );
        const closed = once(stream, "close");
        assert.strictEqual(String(stream.read()), "hello");
        await closed;
        assert.deepStrictEqual(events, ["finish", "error:undefined", "end", "close"]);
      } finally {
        close();
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

  test("is closed with its response when it is paused", async () => {
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    const server = http2.createServer((req, res) => {
      req.pause();
      req.on("close", () => events.push("req close"));
      res.on("finish", () => events.push("res finish"));
      res.on("close", () => {
        events.push("res close");
        closed.resolve();
      });
      res.end("ok");
    });
    const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
    try {
      client.request({ ":path": "/" }).resume();
      await closed.promise;
      assert.deepStrictEqual(events, ["req close", "res finish", "res close"]);
    } finally {
      client.destroy();
      server.close();
    }
  });
});

// In a child process: the session of a test is created inside the test runner's async context,
// which hides the store of the caller from the stream's handlers.
test("a server stream emits 'end' outside the AsyncLocalStorage store of the call that answers", async () => {
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

// Over a duplexPair the trailers are dispatched before close(code) takes effect, on node as well.
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

describe("a stream that the peer resets with NO_ERROR before its half ended", () => {
  for (const transport of transports) {
    test(`${transport}: a server stream is aborted, and its 'end' cannot answer`, async () => {
      const upload = [frame(F.HEADERS, END_HEADERS, 1, REQUEST), frame(F.DATA, 0, 1, Buffer.from("first half"))];
      const events = await serverStreamEvents(transport, upload, async (stream, peer, events) => {
        stream.on("data", () => {});
        stream.on("end", () => {
          try {
            stream.respond({ ":status": 200 });
          } catch (e) {
            events.push("respond: " + (e as NodeJS.ErrnoException).code);
          }
        });
        await peer.settled;
        peer.write(frame(F.RST_STREAM, 0, 1, Buffer.alloc(4)));
      });
      assertEvents(events, ["aborted", "end", "respond: ERR_HTTP2_INVALID_STREAM", "finish", "close"]);
    });
  }

  // Bun ends a readable at this reset only when it already has its EOF: it emits no 'end' here.
  test("a server stream that nothing read ends as well", { todo: !!process.versions.bun }, async () => {
    const open = [frame(F.HEADERS, END_HEADERS, 1, REQUEST)];
    const events = await serverStreamEvents("TCP", open, async (stream, peer) => {
      await peer.settled;
      peer.write(frame(F.RST_STREAM, 0, 1, Buffer.alloc(4)));
    });
    assertEvents(events, ["aborted", "end", "finish", "close"]);
  });

  for (const [name, respond, read] of [
    ["DATA without END_STREAM, read", [frame(F.DATA, 0, 1, Buffer.from("hello"))], true],
    ["END_STREAM on HEADERS, not read", [], false],
  ] as const) {
    test(`a client stream is aborted before 'end' (${name})`, async () => {
      const server = rawH2Server(sid => [
        frame(F.HEADERS, END_HEADERS | (read ? 0 : END_STREAM), sid, hp([[":status", "200"]])),
        ...respond,
        frame(F.RST_STREAM, 0, sid, Buffer.alloc(4)),
      ]);
      const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
      try {
        const req = client.request({ ":method": "POST", ":path": "/" });
        const events: string[] = [];
        record(req, events);
        if (read) req.on("data", () => {});
        await once(req, "close");
        assertEvents(events, ["aborted", "end", "finish", "close"]);
      } finally {
        client.destroy();
        server.close();
      }
    });
  }
});

describe("a stream that errors after both halves have closed", () => {
  // A write() after the response ended errors the stream, so its 'end' never comes.
  const answers: Record<string, (stream: http2.ServerHttp2Stream) => void> = {
    "respond({ endStream: true })": stream => stream.respond({ ":status": 200 }, { endStream: true }),
    "respond(), end()": stream => {
      stream.respond({ ":status": 200 });
      stream.end();
    },
  };
  for (const [answerName, respond] of Object.entries(answers)) {
    for (const [waitName, wait] of Object.entries(waits)) {
      test(`server: ${answerName} after ${waitName}, then write()`, async () => {
        const events = await serverStreamEvents("TCP", requestThatEndsOn["HEADERS"], async stream => {
          await wait();
          respond(stream);
          stream.write("late");
        });
        assert.deepStrictEqual(events, ["finish", "error:ERR_STREAM_WRITE_AFTER_END", "close"]);
      });
    }
  }

  // respond() ends the response to a HEAD request by itself. node emits no 'finish' for it.
  test("server: respond() to a HEAD request after setImmediate, then write()", async () => {
    const head = hp([
      [":method", "HEAD"],
      [":scheme", "http"],
      [":path", "/"],
      [":authority", "localhost"],
    ]);
    const request = [frame(F.HEADERS, END_HEADERS | END_STREAM, 1, head)];
    const events = await serverStreamEvents("TCP", request, async stream => {
      await waits["setImmediate"]();
      stream.respond({ ":status": 200 });
      stream.write("late");
    });
    assert.deepStrictEqual(
      events.filter(name => name !== "finish"),
      ["error:ERR_STREAM_WRITE_AFTER_END", "close"],
    );
  });

  test("client: end(), then write(), after a response that ended on HEADERS", async () => {
    const server = rawH2Server(sid => [frame(F.HEADERS, END_HEADERS | END_STREAM, sid, hp([[":status", "204"]]))]);
    const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
    try {
      const req = client.request({ ":method": "POST", ":path": "/" });
      const events: string[] = [];
      const closed = Promise.withResolvers<void>();
      record(req, events);
      req.on("close", closed.resolve);
      await once(req, "response");
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
          await once(req, "response");
          await wait();
          const before = seen(req);
          if (!before.readableEnded) {
            const ended = once(req, "end");
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

  // node refuses this frame with PROTOCOL_ERROR. Bun delivers it, so the readable needs its EOF.
  test("settles when an informational HEADERS frame carries END_STREAM", async () => {
    const server = rawH2Server(sid => [frame(F.HEADERS, END_HEADERS | END_STREAM, sid, hp([[":status", "103"]]))]);
    const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
    try {
      const req = client.request({ ":method": "POST", ":path": "/" });
      const settled = Promise.withResolvers<string>();
      req.on("end", () => settled.resolve("end"));
      req.on("error", error => settled.resolve((error as NodeJS.ErrnoException).code!));
      req.resume();
      assert.strictEqual(await settled.promise, process.versions.bun ? "end" : "ERR_HTTP2_STREAM_ERROR");
    } finally {
      client.destroy();
      server.close();
    }
  });

  // A server stream that nothing read ends for NO_ERROR only. A client stream ends for every code.
  test("ends when close(code) closes it before anything read it", async () => {
    const actual: Record<string, string[]> = {};
    for (const code of [NGHTTP2_NO_ERROR, NGHTTP2_CANCEL, NGHTTP2_INTERNAL_ERROR]) {
      const server = rawH2Server(responses["HEADERS"]);
      const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
      try {
        const req = client.request({ ":method": "POST", ":path": "/" });
        const events: string[] = [];
        const closed = Promise.withResolvers<void>();
        record(req, events);
        req.on("close", closed.resolve);
        await once(req, "response");
        await waits["setImmediate"]();
        req.close(code);
        await closed.promise;
        actual[code] = events;
      } finally {
        client.destroy();
        server.close();
      }
    }
    assert.deepStrictEqual(actual, {
      [NGHTTP2_NO_ERROR]: ["aborted", "finish", "end", "close"],
      [NGHTTP2_CANCEL]: ["aborted", "finish", "end", "close"],
      [NGHTTP2_INTERNAL_ERROR]: ["aborted", "finish", "end", "error:ERR_HTTP2_STREAM_ERROR", "close"],
    });
  });

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

if (typeof Bun !== "undefined") {
  const node = Bun.which("node");
  // Alpine's node segfaults at a random point of this file (alpine 3.23 aarch64, on main too), and
  // the CI runner fails a file for any new core dump, whichever process wrote it. The glibc, macOS
  // and Windows lanes keep the cross-check.
  const isMusl =
    process.platform === "linux" &&
    !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime;
  // node runs this file while Bun runs it. The test then only waits for the result.
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
