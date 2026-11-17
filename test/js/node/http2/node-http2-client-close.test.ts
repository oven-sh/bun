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
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import { Duplex } from "node:stream";
import { describe, test } from "node:test";

const { NGHTTP2_NO_ERROR, NGHTTP2_CANCEL, NGHTTP2_INTERNAL_ERROR, NGHTTP2_ENHANCE_YOUR_CALM } = http2.constants;

// Raw h2c server: replies 200 + one DATA frame and never sends END_STREAM, so the only way the
// stream ends is via the client's close(code). With `reset`, it replies RST_STREAM alone.
function rawH2Server(reset?: number): net.Server {
  const F = { DATA: 0, HEADERS: 1, RST_STREAM: 3, SETTINGS: 4, PING: 6 };
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
        else if (t === F.HEADERS && reset !== undefined) {
          const code = Buffer.alloc(4);
          code.writeUInt32BE(reset);
          s.write(frame(F.RST_STREAM, 0, sid, code));
        } else if (t === F.HEADERS) {
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

describe("a request that the server resets before it responds, and that nothing reads", () => {
  for (const [code, expected] of [
    [NGHTTP2_NO_ERROR, ["end", "close:0"]],
    [NGHTTP2_CANCEL, ["close:8"]],
    [NGHTTP2_INTERNAL_ERROR, ["error:ERR_HTTP2_STREAM_ERROR", "close:2"]],
  ] as const) {
    test(`RST_STREAM(${code})`, async () => {
      const srv = rawH2Server(code);
      const client = http2.connect(`http://127.0.0.1:${await listen(srv)}`);
      try {
        const events: string[] = [];
        const { promise, resolve } = Promise.withResolvers<void>();
        const req = client.request({ ":path": "/" }, { endStream: true });
        req.on("response", () => events.push("response"));
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

describe("RST_STREAM(NO_ERROR) on a stream whose data has not been read", () => {
  const frame = (type: number, flags: number, id: number, ...payload: number[]) =>
    Buffer.from([0, 0, payload.length, type, flags, 0, 0, 0, id, ...payload]);
  const settings = frame(4, 0, 0);
  const request = (method: number) => [method, 0x86, 0x84, 0x01, 1, 0x61];
  type Side = "server" | "client" | "pushed";

  // `use` gets the paused stream once the session has read the reset, and the events since just before it.
  async function afterReset(
    side: Side,
    prepare: (stream: any) => unknown,
    use: (stream: any, events: string[], session: http2.Http2Session) => unknown,
  ) {
    let onWrite: (chunk: Buffer) => void = () => {};
    const written = (type: number, flags: number, id: number) =>
      new Promise<void>(resolve => {
        onWrite = chunk => void (chunk.includes(frame(type, flags, id).subarray(3)) && resolve());
      });
    const transport = new Duplex({
      read() {},
      write(chunk, _, done) {
        onWrite(chunk);
        done();
      },
    });
    let session: http2.Http2Session, stream: http2.Http2Stream;
    if (side === "server") {
      const server = http2.createServer().on("stream", stream => stream.pause());
      const opened = once(server, "stream");
      server.emit("connection", transport);
      transport.push("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
      transport.push(Buffer.concat([settings, frame(1, 4, 1, ...request(0x83))]));
      [stream] = await opened;
      session = stream.session!;
    } else {
      const client = (session = http2.connect("http://a", { createConnection: () => transport }));
      const sent = written(1, 4, 1);
      stream = client.request({ ":method": "POST" }).pause();
      await sent;
      transport.push(settings);
      if (side === "pushed") {
        stream.on("error", () => {});
        client.on("stream", pushed => pushed.pause());
        const promised = once(client, "stream");
        transport.push(frame(5, 4, 1, 0, 0, 0, 2, ...request(0x82)));
        [stream] = await promised;
      }
      transport.push(frame(1, 4, stream.id!, 0x88));
    }
    try {
      await prepare(stream);
      // Out of the last read, so that each push below is a read of its own, in the same tick.
      await new Promise(setImmediate);
      const events: string[] = [];
      for (const event of ["aborted", "drain", "finish", "wantTrailers", "end", "close"]) {
        stream.on(event, () => events.push(event));
      }
      const acked = written(6, 1, 0);
      transport.push(Buffer.concat([frame(0, 0, stream.id!, 0x2e), frame(3, 0, stream.id!, 0, 0, 0, 0)]));
      transport.push(frame(6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0));
      await acked;
      await new Promise(setImmediate);
      await use(stream, events, session);
    } finally {
      session.destroy();
      transport.destroy();
    }
  }

  for (const [name, side, prepare, atReset] of [
    ["a request that has no response yet", "server", () => {}, ["aborted", "finish"]],
    ["a request whose response has begun", "server", stream => stream.respond(), ["aborted", "finish"]],
    [
      "a request whose response waits for trailers",
      "server",
      stream => stream.respond({}, { waitForTrailers: true }),
      ["aborted", "finish"],
    ],
    ["a request whose response is complete", "server", stream => (stream.respond(), once(stream.end(), "finish")), []],
    ["a response whose request is open", "client", () => {}, ["aborted", "finish"]],
    ["a response whose request is complete", "client", stream => once(stream.end(), "finish"), []],
    ["a pushed response", "pushed", () => {}, []],
  ] as [string, Side, (stream: any) => unknown, string[]][]) {
    test(`${name} is closed, and can still be read`, () =>
      afterReset(side, prepare, async (stream, events) => {
        assert.deepStrictEqual(
          { events, closed: stream.closed, destroyed: stream.destroyed },
          { events: atReset, closed: true, destroyed: false },
        );
        const [[chunk]] = await Promise.all([once(stream, "data"), once(stream.resume(), "close")]);
        assert.deepStrictEqual({ events, chunk: String(chunk) }, { events: [...atReset, "end", "close"], chunk: "." });
      }));
  }

  for (const side of ["server", "client"] as const) {
    test(`write() on a ${side} fails, and 'close' still follows`, () =>
      afterReset(
        side,
        () => {},
        async (stream, _, session) => {
          const closed = new Promise(resolve => stream.once("close", resolve));
          const [[emitted], passed] = await Promise.all([
            once(stream, "error"),
            new Promise<any>(resolve => stream.write("a", resolve)),
          ]);
          assert.deepStrictEqual([emitted.code, passed.code], Array(2).fill("ERR_STREAM_WRITE_AFTER_END"));
          session.destroy();
          await closed;
        },
      ));
  }

  for (const chunks of ["ab", "abc"]) {
    test(`${chunks.length - 1} write(s) behind one that has not called back are dropped`, () =>
      afterReset(
        "client",
        // In the same turn as the reset.
        stream => void setImmediate(() => [...chunks].forEach(chunk => stream.write(chunk))),
        async (stream, _, session) => {
          const closed = once(stream, "close");
          await once(stream.resume(), "end");
          session.destroy();
          await closed;
        },
      ));
  }

  test("a write that waits for the window is not followed by 'drain'", () =>
    afterReset(
      "client",
      stream => assert.strictEqual(stream.write(Buffer.alloc(70000)), false),
      async (stream, events) => {
        await once(stream.resume(), "end");
        assert.deepStrictEqual(
          events.filter(event => event !== "finish" && event !== "close"),
          ["aborted", "end"],
        );
      },
    ));

  test("'aborted' sees the stream closed", async () => {
    let seen: unknown;
    await afterReset(
      "server",
      stream => void stream.on("aborted", () => (seen = { closed: stream.closed, rstCode: stream.rstCode })),
      () => assert.deepStrictEqual(seen, { closed: true, rstCode: NGHTTP2_NO_ERROR }),
    );
  });

  test("respond() throws", () =>
    afterReset(
      "server",
      () => {},
      stream => assert.throws(() => stream.respond(), { code: "ERR_HTTP2_INVALID_STREAM" }),
    ));

  test("a response can still be read after session.close()", async () => {
    const server = net.createServer(socket => {
      socket.on("error", () => {}).write(settings);
      socket.on("data", chunk => {
        if (!chunk.includes(frame(1, 4, 1).subarray(3))) return;
        socket.write(Buffer.concat([frame(1, 4, 1, 0x88), frame(0, 0, 1, 0x2e), frame(3, 0, 1, 0, 0, 0, 0)]));
      });
    });
    const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
    try {
      await once(client, "remoteSettings");
      const stream = client.request({ ":method": "POST" }).pause();
      client.close();
      await once(stream, "finish");
      const [[chunk]] = await Promise.all([once(stream, "data"), once(stream.resume(), "end")]);
      assert.strictEqual(String(chunk), ".");
    } finally {
      client.destroy();
      server.close();
    }
  });
});

test("session.destroy(NO_ERROR) passes the code to a request that has no 'error' listener", async () => {
  const server = rawH2Server();
  const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
  try {
    const stream = client.request({ ":method": "POST" });
    await once(stream, "response");
    const { promise, resolve } = Promise.withResolvers();
    // Not once(), which listens for 'error'.
    stream.on("close", resolve);
    client.destroy(NGHTTP2_NO_ERROR as any);
    await promise;
    assert.strictEqual(stream.rstCode, NGHTTP2_NO_ERROR);
  } finally {
    server.close();
  }
});

test("respond() throws after close()", async () => {
  const server = http2.createServer();
  const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
  try {
    client.request().on("error", () => {});
    const [stream] = await once(server, "stream");
    stream.close();
    assert.throws(() => stream.respond(), { code: "ERR_HTTP2_INVALID_STREAM" });
  } finally {
    client.destroy();
    server.close();
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
