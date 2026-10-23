/**
 * Http2Stream.close(code) event contract, client and server, while the peer's half is still open:
 *   NO_ERROR / CANCEL  -> 'end', 'close'             (documented 'error' exemption)
 *   any other code     -> 'error', 'close'           (no 'end': the body was killed by RST_STREAM)
 * Once the peer's half has ended (END_STREAM on a HEADERS frame, or a server push, which has no
 * inbound half) the readable already has its EOF, so 'end' comes first for every code.
 *
 * ClientHttp2Session.close() on a transport that was connected before http2.connect():
 *   the session is ready in the tick of connect(), so a request made there opens its stream at once
 *   and close() waits for it. Only a request that waits for the connect is rejected by close().
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-client-close.test.ts
 *   node --test test/js/node/http2/node-http2-client-close.test.ts
 */
import assert from "node:assert";
import { once } from "node:events";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import { type Duplex, duplexPair } from "node:stream";
import { describe, test } from "node:test";
import tls from "node:tls";

const { NGHTTP2_NO_ERROR, NGHTTP2_CANCEL, NGHTTP2_INTERNAL_ERROR, NGHTTP2_ENHANCE_YOUR_CALM } = http2.constants;

// Raw h2c server: replies 200 + one DATA frame and never sends END_STREAM, so the only way the
// stream ends is via the client's close(code).
function rawH2Server(): net.Server {
  const F = { DATA: 0, HEADERS: 1, SETTINGS: 4, PING: 6 };
  const frame = (t: number, fl: number, sid: number, p: Buffer) => {
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
  const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
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
        s.write(frame(F.SETTINGS, 0, 0, Buffer.alloc(0)));
      }
      while (buf.length >= 9) {
        const len = buf.readUIntBE(0, 3);
        if (buf.length < 9 + len) break;
        const t = buf[3];
        const fl = buf[4];
        const sid = buf.readUInt32BE(5) & 0x7fffffff;
        const pay = buf.slice(9, 9 + len);
        buf = buf.slice(9 + len);
        if (t === F.SETTINGS && !(fl & 1)) s.write(frame(F.SETTINGS, 1, 0, Buffer.alloc(0)));
        else if (t === F.PING && !(fl & 1)) s.write(frame(F.PING, 1, 0, pay));
        else if (t === F.HEADERS) {
          s.write(frame(F.HEADERS, 0x4, sid, hp([[":status", "200"]])));
          s.write(frame(F.DATA, 0, sid, Buffer.alloc(600, 0x2e)));
        }
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

// A raw HTTP/2 peer on one end of a transport. It acknowledges SETTINGS and PING, and it answers
// each request with a 200 that ends the stream. When the client ends the transport, the promise
// resolves with the frames that the client sent after its preface: "SETTINGS", "PING", "GOAWAY",
// "HEADERS#1", "DATA#1:hello" (a whole body), "RST_STREAM#1:8".
function answeringPeer(socket: Duplex): Promise<string[]> {
  const frames: string[] = [];
  const bodies = new Map<number, string>();
  const ended = Promise.withResolvers<string[]>();
  let buf = Buffer.alloc(0);
  let preface = false;
  // An answer to a client that has gone already fails with EPIPE.
  socket.on("error", () => {});
  socket.on("close", () => ended.resolve(frames));
  socket.on("data", (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    if (!preface) {
      if (buf.length < 24) return;
      preface = true;
      buf = buf.subarray(24);
    }
    while (buf.length >= 9) {
      const len = buf.readUIntBE(0, 3);
      if (buf.length < 9 + len) break;
      const type = buf[3];
      // Flag 0x1 is END_STREAM on DATA and HEADERS, and ACK on SETTINGS and PING.
      const endStream = (buf[4] & 1) !== 0;
      const ack = endStream;
      const id = buf.readUInt32BE(5) & 0x7fffffff;
      const payload = buf.subarray(9, 9 + len);
      buf = buf.subarray(9 + len);
      if (type === 0) {
        bodies.set(id, (bodies.get(id) ?? "") + payload.toString("latin1"));
        if (endStream) frames.push(`DATA#${id}:${bodies.get(id)}`);
      } else if (type === 1) frames.push(`HEADERS#${id}`);
      else if (type === 3) frames.push(`RST_STREAM#${id}:${payload.readUInt32BE(0)}`);
      else if (type === 4 && !ack) {
        frames.push("SETTINGS");
        socket.write(Buffer.from([0, 0, 0, 4, 1, 0, 0, 0, 0]));
      } else if (type === 6 && !ack) {
        frames.push("PING");
        socket.write(Buffer.concat([Buffer.from([0, 0, 8, 6, 1, 0, 0, 0, 0]), payload]));
      } else if (type === 7) frames.push("GOAWAY");
      if ((type === 0 || type === 1) && endStream) {
        // `:status: 200` with END_STREAM and END_HEADERS.
        const response = Buffer.from([0, 0, 1, 1, 5, 0, 0, 0, 0, 0x88]);
        response.writeUInt32BE(id, 5);
        socket.write(response);
      }
    }
  });
  socket.on("end", () => {
    socket.end();
    ended.resolve(frames);
  });
  socket.write(Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0]));
  return ended.promise;
}
const onStreams = (frames: string[]) => frames.filter(frame => frame.includes("#"));

// Records what a request emits: "response:200", "end", "error:ERR_...", "close:<rstCode>".
function watch(req: http2.ClientHttp2Stream): string[] {
  const events: string[] = [];
  req.on("response", headers => events.push(`response:${headers[":status"]}`));
  req.on("end", () => events.push("end"));
  req.on("error", e => events.push(`error:${(e as NodeJS.ErrnoException).code}`));
  req.on("close", () => events.push(`close:${req.rstCode}`));
  req.resume();
  return events;
}

const connectedTransports = ["net.Socket", "tls.TLSSocket", "duplexPair", "TLSSocket over duplexPair"] as const;
type ConnectedTransport = (typeof connectedTransports)[number];
// A session reaches a kernel socket through its native handle. Every other transport is written to from JS.
const isKernelSocket = (transport: ConnectedTransport) => transport === "net.Socket" || transport === "tls.TLSSocket";
const isEncrypted = (transport: ConnectedTransport) => transport !== "net.Socket" && transport !== "duplexPair";

const keys = new URL("../test/fixtures/keys/", import.meta.url);
const tlsPeerOptions = () => ({
  key: fs.readFileSync(new URL("agent1-key.pem", keys)),
  cert: fs.readFileSync(new URL("agent1-cert.pem", keys)),
  ALPNProtocols: ["h2"],
});
const tlsClientOptions = { ALPNProtocols: ["h2"], rejectUnauthorized: false };

// Gives the client end of a transport that is connected already. An answeringPeer has the other end.
async function connectedTransport(
  transport: ConnectedTransport,
): Promise<{ socket: Duplex; frames: Promise<string[]>; close: () => void }> {
  if (transport === "duplexPair") {
    const [socket, peerSide] = duplexPair();
    return { socket, frames: answeringPeer(peerSide), close() {} };
  }
  if (transport === "TLSSocket over duplexPair") {
    const [clientSide, peerSide] = duplexPair();
    const frames = answeringPeer(new tls.TLSSocket(peerSide, { isServer: true, ...tlsPeerOptions() }));
    const socket = tls.connect({ socket: clientSide, ...tlsClientOptions });
    await once(socket, "secureConnect");
    return { socket, frames, close() {} };
  }
  const peer = Promise.withResolvers<string[]>();
  const onConnection = (peerSide: Duplex) => peer.resolve(answeringPeer(peerSide));
  const server =
    transport === "net.Socket" ? net.createServer(onConnection) : tls.createServer(tlsPeerOptions(), onConnection);
  const port = await listen(server);
  const socket =
    transport === "net.Socket"
      ? net.connect(port, "127.0.0.1")
      : tls.connect({ port, host: "127.0.0.1", ...tlsClientOptions });
  await once(socket, transport === "net.Socket" ? "connect" : "secureConnect");
  return { socket, frames: peer.promise, close: () => void server.close() };
}

// Makes a client session on a connected transport and runs `act` in the tick of connect().
// Resolves when the session has closed and the peer has every frame.
//   result:   what `act` returned
//   frames:   what the answeringPeer got
//   jsWrites: the calls of socket.write()
//   settingsRead: connect() runs only after the first frame of the peer is in the read buffer of the socket
async function inTheTickOfConnect<T>(
  transport: ConnectedTransport,
  act: (session: http2.ClientHttp2Session, socket: Duplex) => T,
  { settingsRead = false, listener }: { settingsRead?: boolean; listener?: (...args: unknown[]) => void } = {},
): Promise<{ result: T; frames: string[]; jsWrites: number }> {
  const { socket, frames, close } = await connectedTransport(transport);
  try {
    while (settingsRead && socket.readableLength === 0) await new Promise(resolve => setImmediate(resolve));
    let jsWrites = 0;
    const write = socket.write;
    socket.write = function (this: Duplex, ...args: Parameters<Duplex["write"]>) {
      jsWrites++;
      return write.apply(this, args);
    } as Duplex["write"];
    const closed = Promise.withResolvers<void>();
    const session = http2.connect("http://localhost", { createConnection: () => socket }, listener);
    session.on("error", closed.reject);
    session.on("close", closed.resolve);
    const result = act(session, socket);
    await closed.promise;
    return { result, frames: await frames, jsWrites };
  } finally {
    close();
  }
}

for (const transport of connectedTransports) {
  describe(`a client session on a connected ${transport}, in the tick of connect()`, () => {
    test("request() opens the stream at once", async () => {
      const { result } = await inTheTickOfConnect(transport, session => {
        const req = session.request({ ":path": "/" });
        watch(req);
        const state = {
          connecting: session.connecting,
          alpnProtocol: session.alpnProtocol,
          pending: req.pending,
          id: req.id,
        };
        session.close();
        return state;
      });
      assert.deepStrictEqual(result, {
        connecting: false,
        alpnProtocol: isEncrypted(transport) ? "h2" : "h2c",
        pending: false,
        id: 1,
      });
    });

    for (const settingsRead of [false, true]) {
      const when = settingsRead ? ", with the peer's SETTINGS read before connect()" : "";

      test(`close() waits for a request${when}`, async () => {
        const { result: events, frames } = await inTheTickOfConnect(
          transport,
          session => {
            const events = watch(session.request({ ":path": "/" }));
            session.close();
            return events;
          },
          { settingsRead },
        );
        assert.deepStrictEqual(
          { events, sent: onStreams(frames) },
          { events: ["response:200", "end", "close:0"], sent: ["HEADERS#1"] },
        );
      });

      test(`close() waits for a request with a body${when}`, async () => {
        const { result: events, frames } = await inTheTickOfConnect(
          transport,
          session => {
            const req = session.request({ ":path": "/", ":method": "POST" });
            const events = watch(req);
            req.end("hello");
            session.close();
            return events;
          },
          { settingsRead },
        );
        assert.deepStrictEqual(
          { events, sent: onStreams(frames) },
          { events: ["response:200", "end", "close:0"], sent: ["HEADERS#1", "DATA#1:hello"] },
        );
      });
    }

    test("close() waits for two requests", async () => {
      const { result, frames } = await inTheTickOfConnect(transport, session => {
        const first = watch(session.request({ ":path": "/first" }));
        const second = watch(session.request({ ":path": "/second" }));
        session.close();
        return { first, second };
      });
      assert.deepStrictEqual(
        { ...result, sent: onStreams(frames) },
        {
          first: ["response:200", "end", "close:0"],
          second: ["response:200", "end", "close:0"],
          sent: ["HEADERS#1", "HEADERS#3"],
        },
      );
    });

    test("close() with no request ends the session, and cancels a ping", async () => {
      const { result, frames } = await inTheTickOfConnect(transport, session => {
        const ping = Promise.withResolvers<string | undefined>();
        session.ping(error => ping.resolve((error as NodeJS.ErrnoException | null)?.code));
        session.close();
        return ping.promise;
      });
      assert.deepStrictEqual(
        { ping: await result, sent: onStreams(frames) },
        { ping: "ERR_HTTP2_PING_CANCEL", sent: [] },
      );
    });

    for (const withRequest of [false, true]) {
      test(`destroy() ${withRequest ? "after a request " : ""}sends the frames of that tick, and 'connect' follows`, async () => {
        let connects = 0;
        const { frames } = await inTheTickOfConnect(transport, session => {
          session.on("connect", () => connects++);
          if (withRequest) watch(session.request({ ":path": "/" }));
          session.destroy();
        });
        assert.deepStrictEqual(
          { connects, settings: frames.includes("SETTINGS"), sent: onStreams(frames) },
          { connects: 1, settings: true, sent: withRequest ? ["HEADERS#1"] : [] },
        );
      });
    }

    test("the listener of connect() is a 'connect' listener", async () => {
      const order: string[] = [];
      await inTheTickOfConnect(
        transport,
        session => {
          process.nextTick(() => order.push("a tick queued after connect()"));
          session.on("connect", () => order.push("'connect'"));
          session.close();
        },
        {
          listener(this: unknown, ...args) {
            order.push(`listener, ${args.length} arguments, this is the session: ${this === args[0]}`);
          },
        },
      );
      assert.deepStrictEqual(order, [
        "listener, 2 arguments, this is the session: true",
        "'connect'",
        "a tick queued after connect()",
      ]);
    });

    test("a request with a body from a 'connect' listener is sent", async () => {
      const { result, frames } = await inTheTickOfConnect(transport, session => {
        const events = Promise.withResolvers<string[]>();
        session.on("connect", () => {
          const req = session.request({ ":path": "/", ":method": "POST" });
          events.resolve(watch(req));
          req.end("hello");
          session.close();
        });
        return events.promise;
      });
      assert.deepStrictEqual(
        { events: await result, sent: onStreams(frames) },
        { events: ["response:200", "end", "close:0"], sent: ["HEADERS#1", "DATA#1:hello"] },
      );
    });

    if (isKernelSocket(transport)) {
      test("close(code) on the request resets its stream", async () => {
        const { result: events, frames } = await inTheTickOfConnect(transport, session => {
          const req = session.request({ ":path": "/" });
          const events = watch(req);
          req.close(NGHTTP2_CANCEL);
          session.close();
          return events;
        });
        assert.deepStrictEqual(
          { events, sent: onStreams(frames) },
          { events: ["end", "close:8"], sent: ["HEADERS#1", `RST_STREAM#1:${NGHTTP2_CANCEL}`] },
        );
      });

      test("the session writes through the native handle, not through socket.write()", async () => {
        const { jsWrites } = await inTheTickOfConnect(transport, session => {
          watch(session.request({ ":path": "/" }));
          session.close();
        });
        assert.strictEqual(jsWrites, 0);
      });
    }
  });
}

// A server refuses a stream that opens after the GOAWAY of the client. Bun writes the frames in
// call order, so the request is open when the GOAWAY of close() arrives. node writes the GOAWAY first.
test(
  "close() in the tick of connect() waits for a request to http2.createServer()",
  { skip: typeof Bun === "undefined" },
  async () => {
    const server = http2.createServer((req, res) => res.end("ok"));
    const port = await listen(server);
    const socket = net.connect(port, "127.0.0.1");
    try {
      await once(socket, "connect");
      const session = http2.connect(`http://127.0.0.1:${port}`, { createConnection: () => socket });
      const closed = once(session, "close");
      const req = session.request({ ":path": "/" });
      const events = watch(req);
      let body = "";
      req.setEncoding("utf8").on("data", chunk => (body += chunk));
      session.close();
      await closed;
      assert.deepStrictEqual({ events, body }, { events: ["response:200", "end", "close:0"], body: "ok" });
    } finally {
      socket.destroy();
      server.close();
    }
  },
);

// The contrast: this request waits for the connect, so close() rejects it, as node's requestOnConnect does.
test("close() rejects a request that was made while the socket of createConnection() still connects", async () => {
  const peer = Promise.withResolvers<string[]>();
  const server = net.createServer(peerSide => peer.resolve(answeringPeer(peerSide)));
  const port = await listen(server);
  try {
    const closed = Promise.withResolvers<void>();
    const session = http2.connect("http://localhost", { createConnection: () => net.connect(port, "127.0.0.1") });
    session.on("error", closed.reject);
    session.on("close", closed.resolve);
    const req = session.request({ ":path": "/" });
    const state = { connecting: session.connecting, pending: req.pending };
    const events = watch(req);
    session.close();
    await closed.promise;
    assert.deepStrictEqual(
      // The code of the reset is 7 on Bun and 2 on node.
      { state, events: events.filter(event => !event.startsWith("close:")), sent: onStreams(await peer.promise) },
      { state: { connecting: true, pending: true }, events: ["error:ERR_HTTP2_GOAWAY_SESSION"], sent: [] },
    );
  } finally {
    server.close();
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
