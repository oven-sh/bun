/**
 * Http2Stream.close(code) event contract, client and server, while the peer's half is still open:
 *   NO_ERROR / CANCEL  -> 'end', 'close'             (documented 'error' exemption)
 *   any other code     -> 'error', 'close'           (no 'end': the body was killed by RST_STREAM)
 * Once the peer's half has ended (END_STREAM on a HEADERS frame, or a server push, which has no
 * inbound half) the readable already has its EOF, so 'end' comes first for every code.
 *
 * After the close, frames that the peer still sends on the stream get no reply (RFC 9113 5.1).
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-client-close.test.ts
 *   node --test test/js/node/http2/node-http2-client-close.test.ts
 */
import assert from "node:assert";
import http2 from "node:http2";
import net from "node:net";
import { describe, test } from "node:test";

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

// A raw h2c server for one connection. The test writes its frames and reads what the client sent.
type WireFrame = { type: number; flags: number; id: number; payload: Buffer };
const T = { DATA: 0, HEADERS: 1, RST_STREAM: 3, SETTINGS: 4, PING: 6, GOAWAY: 7, WINDOW_UPDATE: 8, CONTINUATION: 9 };
const END_STREAM = 0x1;
const END_HEADERS = 0x4;
const ACK = 0x1;

function wire(type: number, flags: number, id: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3);
  header[3] = type;
  header[4] = flags;
  header.writeUInt32BE(id, 5);
  return Buffer.concat([header, payload]);
}
function u32(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value);
  return b;
}
/** An HPACK literal field that the decoder adds to its dynamic table. */
function indexedLiteral(name: string, value: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x40, name.length]),
    Buffer.from(name),
    Buffer.from([value.length]),
    Buffer.from(value),
  ]);
}
const STATUS_200 = Buffer.from([0x88]);
const responseHeaders = (id: number, flags = END_HEADERS) => wire(T.HEADERS, flags, id, STATUS_200);
const data = (id: number, body: string | Buffer, flags = 0) => wire(T.DATA, flags, id, Buffer.from(body));
const windowUpdate = (id: number, increment: number) => wire(T.WINDOW_UPDATE, 0, id, u32(increment));
const rstStream = (id: number, code: number) => wire(T.RST_STREAM, 0, id, u32(code));

class RawPeer {
  server: net.Server;
  socket: net.Socket | undefined;
  port = 0;
  frames: WireFrame[] = [];
  #pings = 0;
  #waiters: { matches: (f: WireFrame) => boolean; resolve: () => void }[] = [];

  constructor(server: net.Server) {
    this.server = server;
  }

  static async listen(): Promise<RawPeer> {
    const peer = new RawPeer(net.createServer());
    peer.server.on("connection", socket => {
      peer.socket = socket;
      let buffered = Buffer.alloc(0);
      let preface = 24;
      socket.on("error", () => {});
      socket.on("data", (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        if (preface > 0) {
          if (buffered.length < preface) return;
          buffered = buffered.subarray(preface);
          preface = 0;
        }
        while (buffered.length >= 9) {
          const length = buffered.readUIntBE(0, 3);
          if (buffered.length < 9 + length) break;
          const frame = {
            type: buffered[3],
            flags: buffered[4],
            id: buffered.readUInt32BE(5) & 0x7fffffff,
            payload: buffered.subarray(9, 9 + length),
          };
          buffered = buffered.subarray(9 + length);
          peer.frames.push(frame);
          peer.#waiters = peer.#waiters.filter(w => !(w.matches(frame) && (w.resolve(), true)));
        }
      });
    });
    peer.port = await listen(peer.server);
    return peer;
  }

  /** One write, so that the client gets these frames in one read. */
  write(...frames: Buffer[]) {
    this.socket!.write(Buffer.concat(frames));
  }

  /** Resolves once the client has sent a frame that matches. */
  async until(matches: (f: WireFrame) => boolean): Promise<void> {
    if (this.frames.some(matches)) return;
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const timer = setTimeout(() => reject(new Error("the client did not send the frame")), 10_000);
    this.#waiters.push({ matches, resolve });
    await promise.finally(() => clearTimeout(timer));
  }
  untilReset(id: number) {
    return this.until(f => f.type === T.RST_STREAM && f.id === id);
  }

  /** Two PING round trips: what the client wrote while it read the frames before is here. */
  async settle() {
    for (let i = 0; i < 2; i++) {
      const opaque = Buffer.alloc(8);
      opaque.writeUInt32BE(++this.#pings, 4);
      this.write(wire(T.PING, 0, 0, opaque));
      await this.until(f => f.type === T.PING && (f.flags & ACK) !== 0 && f.payload.equals(opaque));
    }
  }

  /** Every RST_STREAM, GOAWAY and stream WINDOW_UPDATE of the client, and whether it gave connection credit. */
  sent(): string[] {
    const out: string[] = [];
    for (const f of this.frames) {
      if (f.type === T.RST_STREAM) out.push(`RST_STREAM ${f.id} code=${f.payload.readUInt32BE(0)}`);
      else if (f.type === T.GOAWAY) out.push(`GOAWAY code=${f.payload.readUInt32BE(4)}`);
      else if (f.type === T.WINDOW_UPDATE && f.id !== 0) out.push(`WINDOW_UPDATE ${f.id}`);
      else if (f.type === T.WINDOW_UPDATE && !out.includes("WINDOW_UPDATE 0")) out.push("WINDOW_UPDATE 0");
    }
    return out;
  }

  close() {
    this.socket?.destroy();
    this.server.close();
  }
}

describe("frames on a stream that the client closed get no reply", () => {
  type Ctx = { peer: RawPeer; client: http2.ClientHttp2Session; req: http2.ClientHttp2Stream; events: string[] };
  const ignoreErrors = (stream: http2.ClientHttp2Stream) => stream.on("error", () => {});
  const closed = (emitter: http2.ClientHttp2Stream | http2.ClientHttp2Session) =>
    new Promise<void>(resolve => emitter.once("close", () => resolve()));
  const cancel = async ({ req, peer }: Ctx) => {
    req.close(NGHTTP2_CANCEL);
    // The server sends nothing until it has the reset, as a server that did not see it yet.
    await peer.untilReset(1);
  };
  const lateBody = [data(1, "late "), data(1, "body", END_STREAM)];
  const trailers = wire(T.HEADERS, END_HEADERS | END_STREAM, 1, indexedLiteral("x-trailer", "1"));
  // An uppercase field name makes the block malformed (RFC 9113 8.2.1).
  const malformed = Buffer.concat([
    STATUS_200,
    Buffer.from([0x00, 1]),
    Buffer.from("X"),
    Buffer.from([1]),
    Buffer.from("y"),
  ]);
  const altSvc = (id: number) => wire(0xa, 0, id, Buffer.concat([Buffer.from([0, 0]), Buffer.from('h2=":443"')]));

  const cases: { name: string; sent: string[]; events?: string[]; run: (ctx: Ctx) => Promise<void> }[] = [
    {
      name: "close(NGHTTP2_CANCEL), then the whole response",
      sent: ["RST_STREAM 1 code=8"],
      async run(ctx) {
        await cancel(ctx);
        ctx.peer.write(responseHeaders(1), ...lateBody);
      },
    },
    {
      name: "close(NGHTTP2_CANCEL) after 'response', then the body",
      sent: ["RST_STREAM 1 code=8"],
      events: ["response"],
      async run(ctx) {
        ctx.peer.write(responseHeaders(1));
        await new Promise(resolve => ctx.req.once("response", resolve));
        await cancel(ctx);
        ctx.peer.write(...lateBody);
      },
    },
    {
      name: "close(NGHTTP2_CANCEL), then the response and its trailers",
      sent: ["RST_STREAM 1 code=8"],
      async run(ctx) {
        await cancel(ctx);
        ctx.peer.write(responseHeaders(1), data(1, "late "), data(1, "body"), trailers);
      },
    },
    {
      name: "close(NGHTTP2_CANCEL), then a response split over CONTINUATION",
      sent: ["RST_STREAM 1 code=8"],
      async run(ctx) {
        await cancel(ctx);
        const rest = wire(T.CONTINUATION, END_HEADERS, 1, indexedLiteral("x-late", "1"));
        ctx.peer.write(responseHeaders(1, 0), rest, data(1, "late", END_STREAM));
      },
    },
    {
      name: "close(NGHTTP2_CANCEL), then 48 KiB of DATA",
      sent: ["RST_STREAM 1 code=8", "WINDOW_UPDATE 0"],
      async run(ctx) {
        await cancel(ctx);
        const chunk = data(1, Buffer.alloc(16_384));
        ctx.peer.write(responseHeaders(1), chunk, chunk, chunk);
      },
    },
    {
      name: "close(NGHTTP2_CANCEL), then WINDOW_UPDATE and RST_STREAM",
      sent: ["RST_STREAM 1 code=8"],
      async run(ctx) {
        await cancel(ctx);
        ctx.peer.write(
          windowUpdate(1, 0),
          windowUpdate(1, 100),
          rstStream(1, NGHTTP2_NO_ERROR),
          rstStream(1, NGHTTP2_CANCEL),
        );
      },
    },
    {
      name: "close(NGHTTP2_NO_ERROR), then the whole response",
      sent: ["RST_STREAM 1 code=0"],
      async run(ctx) {
        ctx.req.close(NGHTTP2_NO_ERROR);
        await ctx.peer.untilReset(1);
        ctx.peer.write(responseHeaders(1), ...lateBody);
      },
    },
    {
      name: "destroy(), then the whole response",
      sent: ["RST_STREAM 1 code=0"],
      async run(ctx) {
        ctx.req.destroy();
        await ctx.peer.untilReset(1);
        ctx.peer.write(responseHeaders(1), ...lateBody);
      },
    },
    {
      name: "a second response after the stream finished",
      sent: [],
      events: ["response"],
      async run(ctx) {
        ctx.peer.write(responseHeaders(1, END_HEADERS | END_STREAM));
        await closed(ctx.req);
        await ctx.peer.settle();
        ctx.peer.write(responseHeaders(1), ...lateBody);
      },
    },
    {
      name: "a second response in the read that finished the stream",
      sent: [],
      events: ["response"],
      async run(ctx) {
        ctx.peer.write(responseHeaders(1, END_HEADERS | END_STREAM), responseHeaders(1));
        await closed(ctx.req);
      },
    },
    {
      name: "DATA in the read that finished the stream",
      sent: [],
      events: ["response"],
      async run(ctx) {
        ctx.peer.write(responseHeaders(1, END_HEADERS | END_STREAM), data(1, "late"));
        await closed(ctx.req);
      },
    },
    {
      name: "WINDOW_UPDATE with a 0 increment in the read that finished the stream",
      sent: [],
      events: ["response"],
      async run(ctx) {
        ctx.peer.write(responseHeaders(1, END_HEADERS | END_STREAM), windowUpdate(1, 0));
        await closed(ctx.req);
      },
    },
    {
      name: "a response after the server's RST_STREAM",
      sent: [],
      async run(ctx) {
        ctx.peer.write(rstStream(1, NGHTTP2_CANCEL));
        await closed(ctx.req);
        await ctx.peer.settle();
        ctx.peer.write(responseHeaders(1), ...lateBody);
      },
    },
    {
      name: "a malformed response, then its body and trailers",
      sent: ["RST_STREAM 1 code=1"],
      events: ["error:ERR_HTTP2_STREAM_ERROR"],
      async run(ctx) {
        ctx.peer.write(wire(T.HEADERS, END_HEADERS, 1, malformed));
        await ctx.peer.untilReset(1);
        ctx.peer.write(data(1, "late "), data(1, "body"), trailers);
      },
    },
    {
      name: "ALTSVC before and after close(NGHTTP2_CANCEL)",
      sent: ["RST_STREAM 1 code=8"],
      events: ["altsvc:1"],
      async run(ctx) {
        ctx.client.on("altsvc", (_alt, _origin, id) => ctx.events.push("altsvc:" + id));
        ctx.peer.write(altSvc(1));
        await ctx.peer.settle();
        await cancel(ctx);
        ctx.peer.write(altSvc(1));
      },
    },
  ];

  async function openRequest(options?: http2.ClientSessionRequestOptions): Promise<Ctx> {
    const peer = await RawPeer.listen();
    const client = http2.connect(`http://127.0.0.1:${peer.port}`);
    client.on("error", () => {});
    const events: string[] = [];
    const req = client.request({ ":path": "/" }, options);
    req.on("response", () => events.push("response"));
    req.on("data", () => events.push("data"));
    req.on("error", e => events.push("error:" + (e as NodeJS.ErrnoException).code));
    await peer.until(f => f.type === T.HEADERS && f.id === 1);
    peer.write(wire(T.SETTINGS, 0, 0), wire(T.SETTINGS, ACK, 0));
    await peer.settle();
    return { peer, client, req, events };
  }

  /** The late frames did not count as an open stream if close() completes. */
  async function closeSession(client: http2.ClientHttp2Session) {
    const sessionClosed = closed(client);
    client.close();
    await sessionClosed;
  }
  function cleanUp({ client, peer }: Pick<Ctx, "client" | "peer">) {
    client.destroy();
    peer.close();
  }

  for (const { name, sent, events = [], run } of cases) {
    test(name, async () => {
      const ctx = await openRequest();
      try {
        await run(ctx);
        await ctx.peer.settle();
        assert.deepStrictEqual({ sent: ctx.peer.sent(), events: ctx.events }, { sent, events });
        await closeSession(ctx.client);
      } finally {
        cleanUp(ctx);
      }
    });
  }

  test("an aborted signal, then the whole response", async () => {
    const controller = new AbortController();
    const ctx = await openRequest({ signal: controller.signal });
    try {
      controller.abort();
      await ctx.peer.untilReset(1);
      ctx.peer.write(responseHeaders(1), ...lateBody);
      await ctx.peer.settle();
      assert.deepStrictEqual(
        { sent: ctx.peer.sent(), events: ctx.events },
        { sent: ["RST_STREAM 1 code=8"], events: ["error:ABORT_ERR"] },
      );
      await closeSession(ctx.client);
    } finally {
      cleanUp(ctx);
    }
  });

  test("the client decodes a header block that it drops", async () => {
    const ctx = await openRequest();
    try {
      await cancel(ctx);
      const block = Buffer.concat([STATUS_200, indexedLiteral("x-late", "1")]);
      ctx.peer.write(wire(T.HEADERS, END_HEADERS | END_STREAM, 1, block));
      await ctx.peer.settle();
      // This response names "x-late: 1" by the index that the dropped block gave it.
      const next = ignoreErrors(ctx.client.request({ ":path": "/" }));
      const response = new Promise<http2.IncomingHttpHeaders>(resolve => next.once("response", resolve));
      await ctx.peer.until(f => f.type === T.HEADERS && f.id === 3);
      ctx.peer.write(wire(T.HEADERS, END_HEADERS | END_STREAM, 3, Buffer.from([0x88, 0xbe])));
      assert.strictEqual((await response)["x-late"], "1");
      next.resume();
      await closed(next);
      assert.deepStrictEqual(ctx.peer.sent(), ["RST_STREAM 1 code=8"]);
      await closeSession(ctx.client);
    } finally {
      cleanUp(ctx);
    }
  });

  test("setNextStreamID() does not go back to an id that the session used", async () => {
    const ctx = await openRequest();
    try {
      ctx.client.setNextStreamID(1);
      assert.strictEqual(ctx.client.state.nextStreamID, 3);
      await cancel(ctx);
      ctx.peer.write(responseHeaders(1), ...lateBody);
      await ctx.peer.settle();
      assert.deepStrictEqual(ctx.peer.sent(), ["RST_STREAM 1 code=8"]);
      await closeSession(ctx.client);
    } finally {
      cleanUp(ctx);
    }
  });

  test("close(NGHTTP2_CANCEL) before the client reads anything, then the whole response", async () => {
    const peer = await RawPeer.listen();
    const client = http2.connect(`http://127.0.0.1:${peer.port}`);
    client.on("error", () => {});
    try {
      const req = ignoreErrors(client.request({ ":path": "/" }));
      await peer.until(f => f.type === T.HEADERS && f.id === 1);
      req.close(NGHTTP2_CANCEL);
      await peer.untilReset(1);
      // The first bytes that the client reads carry the response to the stream it already reset.
      peer.write(wire(T.SETTINGS, 0, 0), wire(T.SETTINGS, ACK, 0), responseHeaders(1), ...lateBody);
      await peer.settle();
      assert.deepStrictEqual(peer.sent(), ["RST_STREAM 1 code=8"]);
      await closeSession(client);
    } finally {
      cleanUp({ peer, client });
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
