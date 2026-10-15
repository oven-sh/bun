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
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import { duplexPair, type Duplex } from "node:stream";
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

// nghttp2 refuses these requests when it sends them, so the stream fails one tick after
// request(). The call of the user comes first: the stream keeps its code and gets no 'error'.
describe("a request that is refused after close() or destroy()", () => {
  const refused = {
    "a :path with a space": { ":path": "/a b" },
    "content-length on a DELETE": { ":method": "DELETE", "content-length": "1" },
  };
  for (const [name, headers] of Object.entries(refused)) {
    for (const call of ["close", "destroy"] as const) {
      for (const listener of [true, false]) {
        test(`${call}(), ${name}, ${listener ? "an" : "no"} 'error' listener`, async () => {
          const server = http2.createServer();
          const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
          try {
            await new Promise(resolve => client.on("connect", resolve));
            const events: string[] = [];
            const req = client.request(headers);
            if (listener) req.on("error", e => events.push("error:" + (e as NodeJS.ErrnoException).code));
            req.on("close", () => events.push("close:" + req.rstCode));
            req[call]();
            // Bun's close() waited for 'ready', then queued the RST_STREAM with setImmediate for a
            // stream that has no id: an uncaught "Invalid stream id". Two turns cover that call.
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
  }
});

// From here on the peer is a socket that speaks HTTP/2 frames by hand. It sends WINDOW_UPDATE
// only when a test asks for it, so a body larger than the initial window stays partly unsent.
// An expected wire is what node v26.3.0 sends.

const isBun = typeof Bun !== "undefined";
const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
// The initial flow-control window of a stream and of the connection (RFC 9113 section 6.9.2).
const WINDOW = 65535;
// More than one window. The rest is small: it leaves in one socket write on every platform.
const BODY = Buffer.alloc(WINDOW + 8192, "b");
// What the peer has of a stream whose BODY is stuck: its HEADERS and one window of DATA.
const STALLED = `H D${WINDOW}`;
// What the peer has of a stream that sent all of BODY and END_STREAM.
const SENT = `H D${BODY.length}E`;

function frameOf(type: number, flags: number, streamId: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3);
  header[3] = type;
  header[4] = flags;
  header.writeUInt32BE(streamId, 5);
  return Buffer.concat([header, payload]);
}
function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}
// WINDOW_UPDATE with room for all of BODY.
const windowUpdate = (streamId: number) => frameOf(8, 0, streamId, u32(BODY.length));
// WINDOW_UPDATE that makes a window of the initial size as wide as a window can be.
const widest = (streamId: number) => frameOf(8, 0, streamId, u32(0x7fffffff - WINDOW));
// SETTINGS with one parameter: 3 is MAX_CONCURRENT_STREAMS, 4 is INITIAL_WINDOW_SIZE.
const settings = (id: 3 | 4, value: number) => frameOf(4, 0, 0, Buffer.concat([Buffer.from([0, id]), u32(value)]));
// HEADERS with ":status: 200" (0x88 in the HPACK static table).
const responseHeaders = (streamId: number, endStream = false) =>
  frameOf(1, endStream ? 0x5 : 0x4, streamId, Buffer.from([0x88]));
const dataFrame = (streamId: number, bytes: number, endStream = false) =>
  frameOf(0, endStream ? 0x1 : 0, streamId, Buffer.alloc(bytes, "d"));
// Bun can send the RST_STREAM of close(code) or destroy(err) a second time: #43539.
const resetOnce = (wire: string) => wire.replace(/( R\d+)\1$/, "$1");
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));
// How long RawPeer.until() waits. bun test gives a test 5000 ms.
const DEADLINE = 4000;

class RawPeer {
  socket: Duplex;
  goaway: number | undefined;
  closed: Promise<void>;
  #streams = new Map<number, string[]>();
  #windowUpdates = new Map<number, number>();
  #buffered: Buffer = Buffer.alloc(0);
  #prefaceLeft: number;
  #pings = 0;
  #acks = 0;
  #waiting: { condition: () => boolean; settle: (failure?: string) => void }[] = [];
  // Why the socket brings no more frames.
  #gone: string | undefined;

  constructor(socket: Duplex, role: "client" | "server") {
    this.socket = socket;
    this.#prefaceLeft = role === "server" ? PREFACE.length : 0;
    this.closed = new Promise(resolve => socket.on("close", () => resolve()));
    const gone = (why: string) => {
      this.#gone ??= why;
      for (const wait of this.#waiting) wait.settle(why);
    };
    socket.on("close", () => gone("the socket closed"));
    socket.on("error", (error: NodeJS.ErrnoException) => gone(`the socket failed with ${error.code ?? error.message}`));
    socket.on("data", (chunk: Buffer) => this.#read(chunk));
    // Every frame leaves in its own write, with no wait for the ACK of the one before.
    if (socket instanceof net.Socket) socket.setNoDelay(true);
    if (role === "client") socket.write(PREFACE);
    socket.write(frameOf(4, 0, 0));
  }

  /**
   * What arrived on a stream, in order: "H" for HEADERS, "D<bytes>" for DATA (frames in a row add
   * up), "R<code>" for RST_STREAM. "E" after "H" or "D<bytes>" is END_STREAM.
   */
  wire(streamId: number): string {
    return (this.#streams.get(streamId) ?? []).join(" ");
  }

  /** How many WINDOW_UPDATE frames arrived for a stream. */
  windowUpdates(streamId: number): number {
    return this.#windowUpdates.get(streamId) ?? 0;
  }

  /** Writes the frames with one socket write, so the endpoint reads them together. */
  send(...frames: Buffer[]) {
    this.socket.write(Buffer.concat(frames));
  }

  /** Opens the stream window and the connection window for the rest of BODY. */
  grant(streamId: number) {
    this.send(windowUpdate(0), windowUpdate(streamId));
  }

  /** A GET ends the request side with its HEADERS frame. A POST leaves it open. `more` goes in the same write. */
  request(streamId: number, method: "GET" | "POST", ...more: Buffer[]) {
    // ":method", ":scheme: http" and ":path: /" are in the HPACK static table. ":authority" is a
    // literal with an indexed name.
    const block = Buffer.concat([
      Buffer.from([method === "GET" ? 0x82 : 0x83, 0x86, 0x84, 0x01, 0x09]),
      Buffer.from("localhost"),
    ]);
    this.send(frameOf(1, method === "GET" ? 0x5 : 0x4, streamId, block), ...more);
  }

  /**
   * Resolves when the condition holds. Rejects with what arrived so far when the socket closes
   * or fails first, or when the condition does not hold in time.
   */
  until(condition: () => boolean): Promise<void> {
    if (condition()) return Promise.resolve();
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    // Made here, so that its stack has the line that waits.
    const error = new Error();
    const wait = {
      condition,
      settle: (failure?: string) => {
        clearTimeout(deadline);
        this.#waiting = this.#waiting.filter(other => other !== wait);
        if (failure === undefined) return resolve();
        error.message = `${failure} before ${condition} held. Received: ${this.#received()}`;
        reject(error);
      },
    };
    const deadline = setTimeout(wait.settle, DEADLINE, `${DEADLINE} ms passed`).unref();
    this.#waiting.push(wait);
    if (this.#gone !== undefined) wait.settle(this.#gone);
    return promise;
  }

  /** The wire of every stream that has one, and the code of a GOAWAY. */
  #received(): string {
    const received = Array.from(this.#streams.keys(), id => `stream ${id}: ${this.wire(id)}`);
    if (this.goaway !== undefined) received.push(`GOAWAY ${this.goaway}`);
    return received.join(" | ") || "no frame of a stream";
  }

  /**
   * Two PING round trips. The endpoint answers a PING when it reads it, so at the second answer
   * it has had a full turn of its event loop to send what close() or destroy() makes it send.
   */
  async settle() {
    for (let i = 0; i < 2; i++) {
      const sent = ++this.#pings;
      this.socket.write(frameOf(6, 0, 0, Buffer.alloc(8)));
      await this.until(() => this.#acks >= sent);
    }
  }

  #read(chunk: Buffer) {
    const skip = Math.min(this.#prefaceLeft, chunk.length);
    this.#prefaceLeft -= skip;
    let buffered = Buffer.concat([this.#buffered, chunk.subarray(skip)]);
    while (buffered.length >= 9) {
      const length = buffered.readUIntBE(0, 3);
      if (buffered.length < 9 + length) break;
      this.#frame(buffered[3], buffered[4], buffered.readUInt32BE(5), buffered.subarray(9, 9 + length));
      buffered = buffered.subarray(9 + length);
      for (const wait of this.#waiting) if (wait.condition()) wait.settle();
    }
    this.#buffered = buffered;
  }

  #frame(type: number, flags: number, streamId: number, payload: Buffer) {
    if (type === 4) {
      if (!(flags & 0x1)) this.socket.write(frameOf(4, 0x1, 0));
    } else if (type === 6) {
      if (flags & 0x1) this.#acks++;
      else this.socket.write(frameOf(6, 0x1, 0, payload));
    } else if (type === 7) {
      this.goaway = payload.readUInt32BE(4);
    } else if (type === 8) {
      this.#windowUpdates.set(streamId, this.windowUpdates(streamId) + 1);
    } else if (streamId !== 0) {
      let log = this.#streams.get(streamId);
      if (!log) this.#streams.set(streamId, (log = []));
      const last = log[log.length - 1];
      const end = flags & 0x1 ? "E" : "";
      if (type === 1) {
        log.push(`H${end}`);
      } else if (type === 0) {
        const open = last !== undefined && /^D\d+$/.test(last);
        const token = `D${(open ? Number(last.slice(1)) : 0) + payload.length}${end}`;
        if (open) log[log.length - 1] = token;
        else log.push(token);
      } else if (type === 3) {
        log.push(`R${payload.readUInt32BE(0)}`);
      }
    }
  }
}

/** Runs `run` with a client session whose server is a RawPeer. The peer exists once the session has connected. */
async function withRawServer(
  run: (session: http2.ClientHttp2Session, peer: Promise<RawPeer>) => Promise<void>,
  options?: http2.ClientSessionOptions,
) {
  const accepted = Promise.withResolvers<RawPeer>();
  const server = net.createServer(socket => accepted.resolve(new RawPeer(socket, "server")));
  const session = http2.connect(`http://127.0.0.1:${await listen(server)}`, options);
  session.on("error", () => {});
  try {
    await run(session, accepted.promise);
  } finally {
    session.destroy();
    server.close();
  }
}

/**
 * Runs `run` with the server stream of a request that a RawPeer sent as stream 1, one turn
 * after 'stream': the session is not reading then.
 */
async function withRawClient(
  method: "GET" | "POST",
  run: (stream: http2.ServerHttp2Stream, peer: RawPeer) => Promise<void>,
) {
  const opened = Promise.withResolvers<http2.ServerHttp2Stream>();
  const server = http2.createServer();
  server.on("stream", opened.resolve);
  const socket = net.connect(await listen(server), "127.0.0.1");
  try {
    const peer = new RawPeer(socket, "client");
    peer.request(1, method);
    const stream = await opened.promise;
    stream.on("error", () => {});
    await nextTurn();
    await run(stream, peer);
  } finally {
    socket.destroy();
    server.close();
  }
}

/** What the peer has of stream 1 after it opened both windows for the rest of BODY. */
async function wireAfterGrant(peer: RawPeer) {
  await peer.until(() => peer.wire(1) !== "");
  await peer.settle();
  peer.grant(1);
  await peer.settle();
  return resetOnce(peer.wire(1));
}

// One row: what the stream did before the call, the wire to wait for (none: the call is in the
// same tick), the call, and the wire of stream 1 after the peer opened both windows. `owner` is
// set for a wire that Bun does not send yet. It names the open PR for it, and the row is an
// expected failure on Bun until then.
const expectFailureOnBun = (owner?: string) => ({ expectFailure: isBun && owner !== undefined ? owner : false });

type Chunk = string | Buffer;
type Act = (req: http2.ClientHttp2Stream, peer: RawPeer) => unknown;
type RequestRow = [
  name: string,
  open: (session: http2.ClientHttp2Session) => http2.ClientHttp2Stream,
  wait: string | undefined,
  act: Act,
  wire: string,
  owner?: string,
];
function post(session: http2.ClientHttp2Session, chunks: Chunk[] = [], options?: http2.ClientSessionRequestOptions) {
  const req = session.request({ ":method": "POST" }, options).on("error", () => {});
  for (const chunk of chunks) req.write(chunk);
  return req;
}
// The call comes one turn after the event, when the session is not reading.
const afterResponse: Act = async (req, peer) => {
  const response = once(req, "response");
  peer.send(responseHeaders(1));
  await response;
  await nextTurn();
  req.close();
};
const afterResponseEnd: Act = async (req, peer) => {
  const ended = once(req, "end");
  peer.send(responseHeaders(1, true));
  await ended;
  await nextTurn();
  req.close();
};
const requestRows: Record<"connected" | "pending", RequestRow[]> = {
  connected: [
    ["write(BODY) stalled, close()", s => post(s, [BODY]), STALLED, r => r.close(), `${STALLED} R0`],
    ["resume(), write(BODY) stalled, close()", s => post(s, [BODY]).resume(), STALLED, r => r.close(), `${STALLED} R0`],
    ["write(BODY) stalled, close(8)", s => post(s, [BODY]), STALLED, r => r.close(8), `${STALLED} R8`],
    ["write(BODY) stalled, end(), close()", s => post(s, [BODY]), STALLED, r => r.end().close(), `${SENT} R0`],
    [
      "write(BODY) stalled, end(), close(2)",
      s => post(s, [BODY]),
      STALLED,
      r => r.end().close(NGHTTP2_INTERNAL_ERROR),
      `${STALLED} R2`,
    ],
    [
      "write(BODY), write('tail') stalled, end(), close()",
      s => post(s, [BODY, "tail"]),
      STALLED,
      r => r.end().close(),
      `H D${BODY.length + 4}E R0`,
    ],
    [
      "write(BODY) stalled, close(undefined, callback)",
      s => post(s, [BODY]),
      STALLED,
      r => r.close(undefined, () => {}),
      `${STALLED} R0`,
    ],
    [
      "write(BODY), write('second') stalled, close()",
      s => post(s, [BODY, "second"]),
      STALLED,
      r => r.close(),
      `${STALLED} R0`,
    ],
    [
      "waitForTrailers, write(BODY) stalled, close()",
      s => post(s, [BODY], { waitForTrailers: true }),
      STALLED,
      r => r.close(),
      `${STALLED} R0`,
    ],
    [
      "write(BODY) stalled, response ended, close()",
      s => post(s, [BODY]).resume(),
      STALLED,
      afterResponseEnd,
      `${STALLED} R0`,
    ],
    [
      "write(BODY) stalled, close(), write('more')",
      s => post(s, [BODY]),
      STALLED,
      r => (r.close(), r.write("more")),
      `${STALLED} R0`,
    ],
    ["write(BODY) stalled, destroy()", s => post(s, [BODY]), STALLED, r => r.destroy(), `${STALLED} R0`],
    ["write(BODY), close() in one tick", s => post(s, [BODY]), undefined, r => r.close(), `${STALLED} R0`],
    ["write('hello'), close() in one tick", s => post(s, ["hello"]), undefined, r => r.close(), "H D5 R0"],
    ["write('hello') sent, close()", s => post(s, ["hello"]), "H D5", r => r.close(), "H D5E R0"],
    ["write('hello') sent, response, close()", s => post(s, ["hello"]), "H D5", afterResponse, "H D5E R0"],
    ["close() in the tick of request()", s => post(s), undefined, r => r.close(), "H D0E R0"],
    ["HEADERS sent, close()", s => post(s), "H", r => r.close(), "H D0E R0"],
    ["end('hello'), close() in one tick", s => post(s), undefined, r => r.end("hello").close(), "H D5E R0"],
    ["end('hello') sent, close()", s => post(s).end("hello"), "H D5E", r => r.close(), "H D5E R0"],
    ["GET sent, close()", s => s.request({ ":path": "/" }), "HE", r => r.close(), "HE R0"],
  ],
  pending: [
    ["close()", s => post(s), undefined, r => r.close(), "H D0E R0"],
    ["close(2)", s => post(s), undefined, r => r.close(NGHTTP2_INTERNAL_ERROR), "H D0E R2"],
    ["close(8)", s => post(s), undefined, r => r.close(NGHTTP2_CANCEL), "H D0E R8"],
    ["write(BODY), close()", s => post(s, [BODY]), undefined, r => r.close(), `${STALLED} R0`],
    ["resume(), write(BODY), close()", s => post(s, [BODY]).resume(), undefined, r => r.close(), `${STALLED} R0`],
    ["write('hello'), close()", s => post(s, ["hello"]), undefined, r => r.close(), "H D5 R0", "#33380"],
    ["end('hello'), close()", s => post(s), undefined, r => r.end("hello").close(), "H D5E R0"],
    ["end(BODY), close()", s => post(s), undefined, r => r.end(BODY).close(), `${SENT} R0`],
    ["write(BODY), end(), close()", s => post(s, [BODY]), undefined, r => r.end().close(), `${SENT} R0`],
  ],
};
for (const state of ["connected", "pending"] as const) {
  describe(`wire of a ${state} request`, () => {
    for (const [name, open, wait, act, wire, owner] of requestRows[state]) {
      test(name, expectFailureOnBun(owner), async () => {
        await withRawServer(async (session, accepted) => {
          if (state === "connected") await (await accepted).settle();
          const req = open(session);
          assert.strictEqual(req.pending, state === "pending");
          const peer = await accepted;
          if (wait !== undefined) await peer.until(() => peer.wire(1) === wait);
          await act(req, peer);
          assert.strictEqual(await wireAfterGrant(peer), wire);
        });
      });
    }
  });
}

// The caller ended the request, so close() sends RST_STREAM after 'finish'. The peer opens no
// window, so the rest of BODY stays: no 'finish', no RST_STREAM, and the request stays open.
test("a pending request: end(BODY), close(), and no WINDOW_UPDATE from the peer", async () => {
  await withRawServer(async (session, accepted) => {
    const req = post(session);
    assert.strictEqual(req.pending, true);
    let closed = false;
    req.on("close", () => (closed = true));
    req.end(BODY).close();
    const peer = await accepted;
    await peer.until(() => peer.wire(1) === STALLED);
    await peer.settle();
    await peer.settle();
    assert.deepStrictEqual({ wire: peer.wire(1), closed }, { wire: STALLED, closed: false });
  });
});

type ResponseRow = [
  name: string,
  method: "GET" | "POST",
  chunks: Chunk[] | undefined,
  wait: string | undefined,
  act: (stream: http2.ServerHttp2Stream) => unknown,
  wire: string,
  owner?: string,
];
const responseRows: ResponseRow[] = [
  ["respond(), write(BODY) stalled, close()", "GET", [BODY], STALLED, st => st.close(), `${STALLED} R0`],
  ["respond(), write(BODY) stalled, close()", "POST", [BODY], STALLED, st => st.close(), `${STALLED} R0`],
  ["respond(), write(BODY) stalled, end(), close()", "GET", [BODY], STALLED, st => st.end().close(), SENT],
  ["respond(), write(BODY) stalled, close(8)", "GET", [BODY], STALLED, st => st.close(8), `${STALLED} R8`],
  ["respond(), write(BODY) stalled, destroy()", "GET", [BODY], STALLED, st => st.destroy(), `${STALLED} R0`],
  ["respond(), write(BODY), close() in one tick", "GET", [BODY], undefined, st => st.close(), `${STALLED} R0`],
  ["close() before respond()", "GET", undefined, undefined, st => st.close(), "R0", "#43558, #33380"],
  ["close() before respond()", "POST", undefined, undefined, st => st.close(), "R0", "#43558, #33380"],
  ["respond(), close()", "GET", [], undefined, st => st.close(), "H D0E"],
  ["respond(), write('hello'), close()", "GET", ["hello"], undefined, st => st.close(), "H D5 R0"],
  ["respond(), end('hello'), close()", "GET", [], undefined, st => st.end("hello").close(), "H D5E"],
];
describe("wire of a response", () => {
  for (const [name, method, chunks, wait, act, wire, owner] of responseRows) {
    test(`${method}: ${name}`, expectFailureOnBun(owner), async () => {
      await withRawClient(method, async (stream, peer) => {
        if (chunks) stream.respond({ ":status": 200 });
        for (const chunk of chunks ?? []) stream.write(chunk);
        if (wait !== undefined) await peer.until(() => peer.wire(1) === wait);
        await act(stream);
        assert.strictEqual(await wireAfterGrant(peer), wire);
      });
    });
  }

  // The file does not go through the stream's Writable.
  for (const respond of ["respondWithFile", "respondWithFD"] as const) {
    test(`GET: ${respond}() stalled, close()`, async () => {
      await withRawClient("GET", async (stream, peer) => {
        // Any file larger than the window.
        const fd = respond === "respondWithFD" ? fs.openSync(process.execPath, "r") : undefined;
        try {
          if (fd === undefined) stream.respondWithFile(process.execPath);
          else stream.respondWithFD(fd);
          await peer.until(() => peer.wire(1) === STALLED);
          stream.close();
          assert.strictEqual(await wireAfterGrant(peer), `${STALLED} R0`);
        } finally {
          if (fd !== undefined) fs.closeSync(fd);
        }
      });
    });
  }
});

// nghttp2 frees the place when it sends RST_STREAM. Bun frees it when the stream is destroyed,
// and a stream with unread data is not destroyed before its 'end'.
test("close() on a stalled request frees its place under SETTINGS_MAX_CONCURRENT_STREAMS", async () => {
  await withRawServer(async (session, accepted) => {
    const peer = await accepted;
    peer.send(settings(3, 1));
    await peer.settle();
    const req = post(session, [BODY]);
    await peer.until(() => peer.wire(1) === STALLED);
    // A response that nobody reads.
    const response = once(req, "response");
    peer.send(responseHeaders(1), dataFrame(1, 100));
    await response;
    await peer.settle();
    req.close();
    session.request({ ":path": "/" }).on("error", () => {});
    await peer.until(() => peer.wire(3) !== "");
    assert.deepStrictEqual([peer.wire(1), peer.wire(3)], [`${STALLED} R0`, "HE"]);
  });
});

// nghttp2 holds the HEADERS of a request back while the peer admits no more streams, and the
// RST_STREAM of close() cancels them. Bun sends the request when it gets a place, then the reset.
test("close() on a request that waits for a place under SETTINGS_MAX_CONCURRENT_STREAMS", async () => {
  await withRawServer(async (session, accepted) => {
    const peer = await accepted;
    peer.send(settings(3, 1));
    await peer.settle();
    const first = post(session).resume();
    await peer.until(() => peer.wire(1) === "H");
    const second = post(session);
    const closed = Promise.all([once(first, "close"), once(second, "close")]);
    second.close();
    // The first request ends on both sides, so the peer admits the next one.
    first.end();
    await peer.until(() => peer.wire(1) === "H D0E");
    peer.send(responseHeaders(1, true));
    await closed;
    await peer.settle();
    assert.strictEqual(peer.wire(3), isBun ? "H D0E R0" : "");
  });
});

// node keeps a request with unread data open after its RST_STREAM, so its session never closes
// here. Bun destroys the request, and the session closes after it.
test("close() with unread data, then session.close(): the request closes first", { skip: !isBun }, async () => {
  await withRawServer(async (session, accepted) => {
    const peer = await accepted;
    const req = post(session, [BODY]);
    await peer.until(() => peer.wire(1) === STALLED);
    // A response that nobody reads.
    const response = once(req, "response");
    peer.send(responseHeaders(1), dataFrame(1, 100));
    await response;
    const order: string[] = [];
    req.on("close", () => order.push("request"));
    const destroyed = new Promise(resolve =>
      session.on("close", () => {
        order.push("session");
        resolve(req.destroyed);
      }),
    );
    req.close();
    session.close();
    assert.deepStrictEqual({ destroyed: await destroyed, order }, { destroyed: true, order: ["request", "session"] });
  });
});

// After the write that RST_STREAM dropped, the stream's _final asks native for the END_STREAM
// frame that stands in for the trailers. A frame queued for a closed stream never leaves the
// queue, and the session then queues the DATA of every other stream behind it.
describe("close() on a response that waits for trailers leaves no frame queued", () => {
  for (const [name, act, reset] of [
    ["close()", (stream: http2.ServerHttp2Stream) => stream.close(), "R0"],
    ["close(code)", (stream: http2.ServerHttp2Stream) => stream.close(NGHTTP2_INTERNAL_ERROR), "R2"],
  ] as const) {
    test(name, async () => {
      await withRawClient("GET", async (stream, peer) => {
        const session = stream.session!;
        stream.respond({ ":status": 200 }, { waitForTrailers: true });
        stream.write(BODY);
        await peer.until(() => peer.wire(1) === STALLED);
        act(stream);
        await peer.until(() => peer.wire(1).includes("R"));
        await peer.settle();
        assert.deepStrictEqual(
          { wire: resetOnce(peer.wire(1)), queued: session.state.outboundQueueSize },
          { wire: `${STALLED} ${reset}`, queued: 0 },
        );
      });
    });
  }
});

// node emits no 'wantTrailers' on a stream that close() has marked as closed: no trailers
// leave, and RST_STREAM ends the stream.
describe("close() on a stream that waits for trailers: no 'wantTrailers'", () => {
  type Outcome = { wantTrailers: number; thrown: string | null; wire: string };
  type Close = (stream: http2.Http2Stream, peer: RawPeer) => unknown;
  const cases: [name: string, act: Close, outcome: Outcome][] = [
    [
      "write(BODY) stalled, end(), close(2)",
      async (stream, peer) => {
        stream.write(BODY);
        await peer.until(() => peer.wire(1) === STALLED);
        stream.end().close(NGHTTP2_INTERNAL_ERROR);
      },
      { wantTrailers: 0, thrown: null, wire: `${STALLED} R2` },
    ],
  ];

  // Answers 'wantTrailers' with trailers, runs `act`, and waits for 'close'.
  async function outcomeOf(stream: http2.Http2Stream, peer: RawPeer, act: Close) {
    const outcome: Outcome = { wantTrailers: 0, thrown: null, wire: "" };
    stream.on("wantTrailers", () => {
      outcome.wantTrailers++;
      try {
        stream.sendTrailers({ "x-t": "1" });
      } catch (error) {
        outcome.thrown = (error as NodeJS.ErrnoException).code!;
      }
    });
    const closed = new Promise(resolve => stream.on("close", resolve));
    await act(stream, peer);
    await closed;
    await peer.settle();
    outcome.wire = resetOnce(peer.wire(1));
    return outcome;
  }

  for (const [name, act, outcome] of cases) {
    test(`request: ${name}`, async () => {
      await withRawServer(async (session, accepted) => {
        const peer = await accepted;
        await peer.settle();
        const req = post(session, [], { waitForTrailers: true });
        assert.deepStrictEqual(await outcomeOf(req, peer, act), outcome);
      });
    });
    test(`response: ${name}`, async () => {
      await withRawClient("GET", async (stream, peer) => {
        stream.respond({ ":status": 200 }, { waitForTrailers: true });
        assert.deepStrictEqual(await outcomeOf(stream, peer, act), outcome);
      });
    });
  }

  // The last frame of the request is queued behind another stream's stuck body. It leaves in
  // front of the RST_STREAM, and the stream then asks for its trailers.
  for (const [call, act, reset] of [
    ["close(code)", req => req.close(NGHTTP2_INTERNAL_ERROR), "R2"],
    ["destroy()", req => req.destroy(), "R0"],
  ] as [string, Act, string][]) {
    test(`request behind another stream's stuck body: end('hello'), ${call}`, async () => {
      await withRawServer(async (session, accepted) => {
        const peer = await accepted;
        peer.send(windowUpdate(0));
        await peer.settle();
        post(session, [BODY]);
        await peer.until(() => peer.wire(1) === STALLED);
        const req = post(session, [], { waitForTrailers: true });
        let wantTrailers = 0;
        req.on("wantTrailers", () => {
          wantTrailers++;
          req.sendTrailers({ "x-t": "1" });
        });
        await peer.until(() => peer.wire(3) === "H");
        req.end("hello");
        act(req, peer);
        await peer.until(() => peer.wire(3).includes("R"));
        await peer.settle();
        assert.deepStrictEqual(
          { wantTrailers, wire: resetOnce(peer.wire(3)) },
          { wantTrailers: 0, wire: `H D5 ${reset}` },
        );
      });
    });
  }

  test("response behind another stream's stuck body: end('hello'), close(code)", async () => {
    await withRawClient("GET", async (stuck, peer) => {
      peer.send(windowUpdate(0));
      await peer.settle();
      stuck.respond({ ":status": 200 });
      stuck.write(BODY);
      await peer.until(() => peer.wire(1) === STALLED);
      const opened = once(stuck.session!, "stream");
      peer.request(3, "GET");
      const [stream]: http2.ServerHttp2Stream[] = await opened;
      stream.on("error", () => {});
      let wantTrailers = 0;
      stream.on("wantTrailers", () => {
        wantTrailers++;
        stream.sendTrailers({ "x-t": "1" });
      });
      await nextTurn();
      stream.respond({ ":status": 200 }, { waitForTrailers: true });
      stream.end("hello");
      stream.close(NGHTTP2_INTERNAL_ERROR);
      await peer.until(() => peer.wire(3).includes("R"));
      await peer.settle();
      assert.deepStrictEqual({ wantTrailers, wire: resetOnce(peer.wire(3)) }, { wantTrailers: 0, wire: "H D5 R2" });
    });
  });
});

// RST_STREAM dropped the rest of the body: the writable side of the stream did not finish.
describe("no 'finish' after a close() that dropped the rest of the body", () => {
  async function finishOf(stream: http2.Http2Stream, peer: RawPeer) {
    let finish = false;
    stream.on("finish", () => (finish = true));
    stream.write(BODY);
    await peer.until(() => peer.wire(1) === STALLED);
    stream.close();
    await peer.until(() => peer.wire(1).includes("R0"));
    await peer.settle();
    return { finish, writableFinished: stream.writableFinished };
  }
  const unfinished = { finish: false, writableFinished: false };

  test("request", expectFailureOnBun("#44881"), async () => {
    await withRawServer(async (session, accepted) => {
      const peer = await accepted;
      assert.deepStrictEqual(await finishOf(post(session), peer), unfinished);
    });
  });
  test("response", expectFailureOnBun("#44881"), async () => {
    await withRawClient("GET", async (stream, peer) => {
      stream.respond({ ":status": 200 });
      assert.deepStrictEqual(await finishOf(stream, peer), unfinished);
    });
  });
});

// close() and destroy() run in a setImmediate callback, so the session reads what the peer
// sent in that callback before it writes the RST_STREAM. node submits the frame to nghttp2
// inside the call. From then on nghttp2 sends no DATA of the stream.
describe("close() and destroy() on a stalled request, before the session reads the peer's next frames", () => {
  // The peer sends `early` while the request is stalled: the request must stay stalled. It sends
  // `late` in the callback that calls close() or destroy().
  async function wireAfter(act: Act, late: Buffer[], early?: Buffer) {
    let wire = "";
    await withRawServer(async (session, accepted) => {
      const peer = await accepted;
      const req = post(session, [BODY]);
      await peer.until(() => peer.wire(1) === STALLED);
      if (early) peer.send(early);
      await peer.settle();
      assert.strictEqual(peer.wire(1), STALLED);
      setImmediate(() => {
        peer.send(...late);
        act(req, peer);
      });
      await peer.until(() => peer.wire(1).includes("R"));
      await peer.settle();
      wire = resetOnce(peer.wire(1));
    });
    return wire;
  }

  for (const [name, act, reset] of [
    ["close()", req => req.close(), "R0"],
    ["close(NGHTTP2_INTERNAL_ERROR)", req => req.close(NGHTTP2_INTERNAL_ERROR), "R2"],
    ["close(NGHTTP2_CANCEL)", req => req.close(NGHTTP2_CANCEL), "R8"],
    ["destroy()", req => req.destroy(), "R0"],
  ] as [string, Act, string][]) {
    test(`${name}, WINDOW_UPDATE for the stream and the connection`, async () => {
      assert.strictEqual(await wireAfter(act, [windowUpdate(0), windowUpdate(1)]), `${STALLED} ${reset}`);
    });
  }
  test("close(), SETTINGS_INITIAL_WINDOW_SIZE and WINDOW_UPDATE for the connection", async () => {
    const wire = await wireAfter(req => req.close(), [settings(4, BODY.length), windowUpdate(0)]);
    assert.strictEqual(wire, `${STALLED} R0`);
  });
  test("close(), WINDOW_UPDATE for the connection when the stream has room", async () => {
    const wire = await wireAfter(req => req.close(), [windowUpdate(0)], windowUpdate(1));
    assert.strictEqual(wire, `${STALLED} R0`);
  });
  test("close(), WINDOW_UPDATE for the stream when the connection has room", async () => {
    const wire = await wireAfter(req => req.close(), [windowUpdate(1)], windowUpdate(0));
    assert.strictEqual(wire, `${STALLED} R0`);
  });
});

// The first write is on the wire and its callback is due. The second is still in the Writable.
describe("close(code) with a chunk that the stream's Writable still holds", () => {
  const A = Buffer.alloc(16384, "a");
  const B = Buffer.alloc(32768, "b");
  for (const code of [NGHTTP2_NO_ERROR, NGHTTP2_INTERNAL_ERROR, NGHTTP2_CANCEL]) {
    test(`request: write(A), write(B), close(${code}) sends A`, async () => {
      await withRawServer(async (session, accepted) => {
        const peer = await accepted;
        const req = post(session);
        await peer.until(() => peer.wire(1) === "H");
        req.write(A);
        req.write(B);
        req.close(code);
        await peer.until(() => peer.wire(1).includes("R"));
        await peer.settle();
        assert.strictEqual(resetOnce(peer.wire(1)), `H D${A.length} R${code}`);
      });
    });
    test(`response: write(A), write(B), close(${code}) sends A`, async () => {
      await withRawClient("POST", async (stream, peer) => {
        stream.respond({ ":status": 200 });
        await peer.until(() => peer.wire(1) === "H");
        stream.write(A);
        stream.write(B);
        stream.close(code);
        await peer.until(() => peer.wire(1).includes("R"));
        await peer.settle();
        assert.strictEqual(resetOnce(peer.wire(1)), `H D${A.length} R${code}`);
      });
    });
  }
});

// A Writable hands its next chunk to the stream before it runs the callback of the chunk
// before. The session has B when the callback of A runs, so B leaves too.
describe("close(code) and destroy() in the callback of write(A), with write(B) behind it", () => {
  const A = Buffer.alloc(1000, "a");
  const B = Buffer.alloc(2000, "b");
  for (const [name, act, reset] of [
    ["close(NGHTTP2_INTERNAL_ERROR)", req => req.close(NGHTTP2_INTERNAL_ERROR), "R2"],
    ["destroy()", req => req.destroy(), "R0"],
  ] as [string, Act, string][]) {
    test(name, async () => {
      await withRawServer(async (session, accepted) => {
        const peer = await accepted;
        const req = post(session);
        await peer.until(() => peer.wire(1) === "H");
        // No window holds a byte of A or B back.
        peer.send(widest(0), widest(1));
        await peer.settle();
        req.write(A, () => act(req, peer));
        req.write(B);
        await peer.until(() => peer.wire(1).includes("R"));
        await peer.settle();
        assert.strictEqual(resetOnce(peer.wire(1)), `H D${A.length + B.length} ${reset}`);
      });
    });
  }
});

// Stream 1 is stuck on its own window, so the session has DATA queued. Stream 3 has room in
// every window: what it wrote before close() or destroy() leaves before its RST_STREAM.
describe("close() and destroy() behind another stream's stuck body", () => {
  const hello = (req: http2.ClientHttp2Stream) => req.write("hello");
  const endHello = (req: http2.ClientHttp2Stream) => req.end("hello");
  for (const [name, act, wire] of [
    ["write('hello'), close()", req => (hello(req), req.close()), "H D5 R0"],
    ["write('hello'), close(code)", req => (hello(req), req.close(NGHTTP2_INTERNAL_ERROR)), "H D5 R2"],
    ["write('hello'), destroy()", req => (hello(req), req.destroy()), "H D5 R0"],
    ["write('hello'), close(), destroy()", req => (hello(req), req.close(), req.destroy()), "H D5 R0"],
    // Bun puts END_STREAM on the chunk inside end(chunk), node one tick later. The chunk leaves
    // as the stream queued it.
    [
      "end('hello'), close(code)",
      req => (endHello(req), req.close(NGHTTP2_INTERNAL_ERROR)),
      isBun ? "H D5E R2" : "H D5 R2",
    ],
    [
      "end('hello'), one turn, close(code)",
      async req => (endHello(req), await nextTurn(), req.close(NGHTTP2_INTERNAL_ERROR)),
      "H D5E R2",
    ],
  ] as [string, Act, string][]) {
    test(name, async () => {
      await withRawServer(async (session, accepted) => {
        const peer = await accepted;
        peer.send(windowUpdate(0));
        await peer.settle();
        post(session, [BODY]);
        await peer.until(() => peer.wire(1) === STALLED);
        const req = post(session);
        await peer.until(() => peer.wire(3) === "H");
        await act(req, peer);
        await peer.until(() => peer.wire(3).includes("R"));
        await peer.settle();
        assert.strictEqual(resetOnce(peer.wire(3)), wire);
      });
    });
  }
});

// The same for responses. Stream 3 answers a GET, so its request side has ended.
describe("close() and destroy() on a response behind another stream's stuck body", () => {
  const respond = (stream: http2.ServerHttp2Stream) => stream.respond({ ":status": 200 });
  const hello = (stream: http2.ServerHttp2Stream) => (respond(stream), stream.write("hello"));
  for (const [name, act, wire] of [
    ["respond(), write('hello'), close()", stream => (hello(stream), stream.close()), "H D5 R0"],
    [
      "respond(), write('hello'), close(code)",
      stream => (hello(stream), stream.close(NGHTTP2_INTERNAL_ERROR)),
      "H D5 R2",
    ],
    // Bun puts END_STREAM on the chunk inside end(chunk). That frame ends the stream on both
    // sides, so no RST_STREAM follows.
    [
      "respond(), end('hello'), close(code)",
      stream => (respond(stream), stream.end("hello"), stream.close(NGHTTP2_INTERNAL_ERROR)),
      isBun ? "H D5E" : "H D5 R2",
    ],
    ["respond(), write('hello'), destroy()", stream => (hello(stream), stream.destroy()), "H D5 R0"],
  ] as [string, (stream: http2.ServerHttp2Stream) => unknown, string][]) {
    test(name, async () => {
      await withRawClient("GET", async (stuck, peer) => {
        peer.send(windowUpdate(0));
        await peer.settle();
        respond(stuck);
        stuck.write(BODY);
        await peer.until(() => peer.wire(1) === STALLED);
        const opened = once(stuck.session!, "stream");
        peer.request(3, "GET");
        const [stream]: http2.ServerHttp2Stream[] = await opened;
        stream.on("error", () => {});
        // As in withRawClient(): the session is not reading one turn after 'stream'.
        await nextTurn();
        act(stream);
        // Not every row ends with RST_STREAM on every runtime, so the wait is for the DATA.
        await peer.until(() => peer.wire(3).includes("D5"));
        await peer.settle();
        assert.strictEqual(resetOnce(peer.wire(3)), wire);
      });
    });
  }
});

// node cannot send a stream's queued DATA while a socket write is in progress. close() then
// holds RST_STREAM back until that write has completed, and the queued DATA leaves first.
// destroy() does not wait, also after such a close(): its RST_STREAM leaves next, and what the
// stream has queued is dropped.
test("close() and destroy() with a socket write in progress", async t => {
  await withRawServer(async (session, accepted) => {
    const peer = await accepted;
    // More than the socket buffers of a loopback connection hold. The peer stops reading, so a
    // part of it stays with the session.
    const big = Buffer.alloc(32 * 1024 * 1024, "a");
    // More than 10 DATA frames.
    const B = Buffer.alloc(200000, "b");
    const calls: [wire: string, act: (req: http2.ClientHttp2Stream) => unknown][] = [
      // "tail" is still in the stream's Writable when RST_STREAM is submitted.
      [`H D${B.length} R2`, req => (req.write(B), req.write("tail"), req.close(NGHTTP2_INTERNAL_ERROR))],
      ["H D0E R2", req => (req.end(), req.close(NGHTTP2_INTERNAL_ERROR))],
      ["H R0", req => (req.end(B), req.destroy())],
      ["H R0", req => (req.end(), req.destroy())],
      ["H R0", req => (req.write(B), req.close(), req.destroy())],
      ["H R2", req => (req.end(), req.close(NGHTTP2_INTERNAL_ERROR), req.destroy())],
    ];
    const requests = [post(session), ...calls.map(() => post(session))];
    const last = 2 * requests.length - 1;
    await peer.until(() => peer.wire(last) === "H");
    // Room for `big` and for B in every window.
    peer.send(...[0, 1, 3].map(widest));
    await peer.settle();
    peer.socket.pause();
    requests[0].write(big);
    // node hands a write to the socket one turn of the event loop after write().
    await nextTurn();
    await nextTurn();
    // Windows can take all of `big` from the session. A write behind it then completes.
    let taken = false;
    requests[0].write("x", () => (taken = true));
    await nextTurn();
    await nextTurn();
    if (taken) return t.skip("the socket took the whole write: no write is in progress");
    for (const [i, [, act]] of calls.entries()) act(requests[1 + i]);
    // The RST_STREAM of close() and destroy() is due one turn after the call.
    await nextTurn();
    await nextTurn();
    peer.socket.resume();
    await peer.until(() => calls.every((_, i) => peer.wire(3 + 2 * i).includes("R")));
    await peer.settle();
    assert.deepStrictEqual(
      calls.map((_, i) => resetOnce(peer.wire(3 + 2 * i))),
      calls.map(([wire]) => wire),
    );
    assert.strictEqual(peer.wire(1), `H D${big.length + 1}`);
  });
});

// The peer answers with several frames in one write, and a listener for the first one calls
// close() or destroy(). The request has nothing to send, so node submits RST_STREAM inside the
// call, and nghttp2 then ignores the other frames of the stream: no event, no WINDOW_UPDATE for
// the stream, and the peer's END_STREAM does not close it in place of the RST_STREAM.
// (node 24 holds every RST_STREAM back while it reads, so its listeners get those frames.)
describe("close() and destroy() in a listener, with more frames for the stream in the same read", () => {
  // "103" as a literal ":status", and a trailer "x-t: 1".
  const earlyHints = frameOf(1, 0x4, 1, Buffer.from([0x08, 0x03, 0x31, 0x30, 0x33]));
  const trailers = frameOf(1, 0x5, 1, Buffer.from([0x00, 0x03, 0x78, 0x2d, 0x74, 0x01, 0x31]));
  // The session gives its streams a small window, so that a read of a few KiB is worth a
  // WINDOW_UPDATE: the endpoint sends one when half of the window is used.
  const smallWindow = { settings: { initialWindowSize: 4096 } };
  const quarter = dataFrame(1, smallWindow.settings.initialWindowSize / 4);
  type Read = [name: string, event: string, frames: Buffer[], options?: http2.ClientSessionOptions];
  const reads: Read[] = [
    ["'headers', then the response", "headers", [earlyHints, responseHeaders(1), dataFrame(1, 1)]],
    ["'response', then DATA and trailers with END_STREAM", "response", [responseHeaders(1), dataFrame(1, 1), trailers]],
    [
      "'response', then DATA for three quarters of the stream's window",
      "response",
      [responseHeaders(1), quarter, quarter, quarter],
      smallWindow,
    ],
  ];
  type Call = (req: http2.ClientHttp2Stream) => void;
  const calls: [name: string, act: Call, events: string[], reset: string][] = [
    ["close()", req => req.close(), ["end"], "R0"],
    ["close(NGHTTP2_INTERNAL_ERROR)", req => req.close(NGHTTP2_INTERNAL_ERROR), [], "R2"],
    ["destroy()", req => req.destroy(), ["end"], "R0"],
  ];
  // Where the call runs: in a listener of the event, or in a continuation of the read.
  type Way = (req: http2.ClientHttp2Stream, event: string, call: () => void) => unknown;
  const inListener: Way = (req, event, call) => req.once(event, call);
  const continuations: [name: string, way: Way][] = [
    ["a tick after", (req, event, call) => req.once(event, () => process.nextTick(call))],
    ["after an await of", async (req, event, call) => (await once(req, event), call())],
  ];

  async function resultOf([, event, frames, options]: Read, act: Call, way = inListener) {
    const events: string[] = [];
    let result = {};
    await withRawServer(async (session, accepted) => {
      const peer = await accepted;
      const req = post(session);
      // The events count from the one that the call follows.
      let called = false;
      for (const name of ["headers", "response", "data", "trailers", "end"]) {
        req.on(name, () => called && events.push(name));
      }
      req.once(event, () => (called = true));
      way(req, event, () => act(req));
      await peer.until(() => peer.wire(1) === "H");
      peer.send(...frames);
      await peer.until(() => peer.wire(1).includes("R"));
      await peer.settle();
      // The END_STREAM of the end() inside close() is not the subject here: node 26 sends it
      // before the RST_STREAM, node 27 does not. Bun also sends it for destroy(): #33380.
      const wire = resetOnce(peer.wire(1)).replace(" D0E", "");
      // The session has counted the stream out: a graceful close() completes.
      const closed = once(session, "close");
      session.close();
      await closed;
      result = { events, wire, windowUpdates: peer.windowUpdates(1) };
    }, options);
    return result;
  }

  for (const read of reads) {
    for (const [call, act, events, reset] of calls) {
      test(`${call} in ${read[0]}`, async () => {
        const result = await resultOf(read, act);
        assert.deepStrictEqual(result, { events, wire: `H ${reset}`, windowUpdates: 0 });
      });
    }
  }

  // node runs a tick and a microtask of a listener before it takes the next frame of the
  // read, so the outcome is that of a call in the listener.
  for (const [how, way] of continuations) {
    for (const [call, act, events, reset] of calls) {
      test(`${call} ${how} ${reads[1][0]}`, async () => {
        const result = await resultOf(reads[1], act, way);
        assert.deepStrictEqual(result, { events, wire: `H ${reset}`, windowUpdates: 0 });
      });
    }
  }

  // The control for the rows that expect no WINDOW_UPDATE.
  test("no call in 'response', then DATA for three quarters of the stream's window: WINDOW_UPDATE", async () => {
    const [, , frames, options] = reads[2];
    await withRawServer(async (session, accepted) => {
      const peer = await accepted;
      post(session).resume();
      await peer.until(() => peer.wire(1) === "H");
      peer.send(...frames);
      await peer.settle();
      assert.ok(peer.windowUpdates(1) > 0);
    }, options);
  });

  test("close(code) in 'response', then pause() and resume(): no WINDOW_UPDATE for the stream", async () => {
    const result = await resultOf(reads[2], req => {
      // Runs before the RST_STREAM that close() is about to schedule.
      setImmediate(() => req.pause().resume());
      req.close(NGHTTP2_INTERNAL_ERROR);
    });
    assert.deepStrictEqual(result, { events: [], wire: "H R2", windowUpdates: 0 });
  });

  test("server: close(code) in 'stream', with the request body in the same read", async () => {
    const events: string[] = [];
    const server = http2.createServer();
    server.on("stream", stream => {
      stream.on("error", () => {});
      for (const name of ["data", "end"]) stream.on(name, () => events.push(name));
      stream.close(NGHTTP2_INTERNAL_ERROR);
    });
    const socket = net.connect(await listen(server), "127.0.0.1");
    try {
      const peer = new RawPeer(socket, "client");
      peer.request(1, "POST", dataFrame(1, 4, true));
      await peer.until(() => peer.wire(1).includes("R"));
      await peer.settle();
      // Bun sends a DATA frame for the end() inside close(), with no HEADERS before it: #43558.
      assert.deepStrictEqual({ events, wire: resetOnce(peer.wire(1)).replace("D0E ", "") }, { events: [], wire: "R2" });
    } finally {
      socket.destroy();
      server.close();
    }
  });

  // The request has DATA queued. node sends what the windows admit and then submits RST_STREAM,
  // both inside the call: the WINDOW_UPDATE frames of the same read release nothing.
  // (node 24 and 27 hold the frame back until the read has ended: nodejs/node#64166.)
  for (const [call, act, reset] of [
    ["close()", req => req.close(), "R0"],
    ["close(NGHTTP2_REFUSED_STREAM)", req => req.close(http2.constants.NGHTTP2_REFUSED_STREAM), "R7"],
    ["destroy()", req => req.destroy(), "R0"],
  ] as [string, Act, string][]) {
    test(`${call} in 'response' with a stalled body and WINDOW_UPDATE in the same read`, async () => {
      await withRawServer(async (session, accepted) => {
        const peer = await accepted;
        const req = post(session, [BODY]);
        req.on("response", () => act(req, peer));
        await peer.until(() => peer.wire(1) === STALLED);
        peer.send(responseHeaders(1), windowUpdate(0), windowUpdate(1));
        await peer.until(() => peer.wire(1).includes("R"));
        await peer.settle();
        assert.strictEqual(resetOnce(peer.wire(1)), `${STALLED} ${reset}`);
      });
    });
  }

  // node parks RST_STREAM(CANCEL) that is submitted under a frame callback: the stream stays as
  // it is for the rest of the read.
  test("close(NGHTTP2_CANCEL) in 'response' with a stalled body and WINDOW_UPDATE in the same read", async () => {
    await withRawServer(async (session, accepted) => {
      const peer = await accepted;
      const req = post(session, [BODY]);
      req.on("response", () => req.close(NGHTTP2_CANCEL));
      await peer.until(() => peer.wire(1) === STALLED);
      peer.send(responseHeaders(1), windowUpdate(0), windowUpdate(1));
      await peer.until(() => peer.wire(1).includes("R"));
      await peer.settle();
      assert.strictEqual(resetOnce(peer.wire(1)), `${SENT} R8`);
    });
  });
  test("close(NGHTTP2_CANCEL) in 'response', then DATA with END_STREAM in the same read: no RST_STREAM", async () => {
    await withRawServer(async (session, accepted) => {
      const peer = await accepted;
      const req = session.request({ ":path": "/" }).resume();
      req.on("response", () => req.close(NGHTTP2_CANCEL));
      const closed = once(req, "close");
      await peer.until(() => peer.wire(1) === "HE");
      peer.send(responseHeaders(1), dataFrame(1, 1, true));
      await closed;
      await peer.settle();
      assert.strictEqual(peer.wire(1), "HE");
    });
  });
});

// The peer answers a GET with HEADERS that carry END_STREAM, so both sides have ended the
// stream when a listener of that frame calls close() or destroy(). node sends no RST_STREAM.
describe("close() and destroy() in a listener of the frame that ends the stream", () => {
  for (const event of ["response", "end"]) {
    for (const [call, act] of [
      ["close()", req => req.close()],
      ["close(NGHTTP2_CANCEL)", req => req.close(NGHTTP2_CANCEL)],
      ["destroy()", req => req.destroy()],
    ] as [string, Act][]) {
      test(`${call} in '${event}'`, async () => {
        await withRawServer(async (session, accepted) => {
          const peer = await accepted;
          const req = session.request({ ":path": "/" }).resume();
          req.on(event, () => act(req, peer));
          const closed = once(req, "close");
          await peer.until(() => peer.wire(1) === "HE");
          peer.send(responseHeaders(1, true));
          await closed;
          // A RST_STREAM would leave one turn after the call.
          await peer.settle();
          assert.strictEqual(peer.wire(1), "HE");
        });
      });
    }
  }
});

// The peer resets the stream after close() or destroy(), before the stream's own RST_STREAM
// has left. node's onStreamClose leaves a closed stream as it is: the stream keeps the code of
// the call, 'aborted' comes once, and only close(code) gives an 'error'.
describe("a stream that user code closed keeps its code when the peer resets it", () => {
  const rstStream = (code: number) => frameOf(3, 0, 1, u32(code));
  const calls: [name: string, act: Act, rstCode: number, errors: string[]][] = [
    ["close()", req => req.close(), NGHTTP2_NO_ERROR, []],
    ["close(2)", req => req.close(NGHTTP2_INTERNAL_ERROR), NGHTTP2_INTERNAL_ERROR, ["ERR_HTTP2_STREAM_ERROR"]],
    ["destroy()", req => req.destroy(), NGHTTP2_NO_ERROR, []],
  ];
  const bodies: [name: string, chunks: Chunk[], ready: string][] = [
    ["no body", [], "H"],
    ["a stalled body", [BODY], STALLED],
  ];
  for (const [call, act, rstCode, errors] of calls) {
    for (const [body, chunks, ready] of bodies) {
      for (const peerCode of [NGHTTP2_INTERNAL_ERROR, NGHTTP2_CANCEL]) {
        for (const inListener of [true, false]) {
          const when = inListener ? "in the read of the call" : "in the read after the call";
          test(`${call}, ${body}, RST_STREAM(${peerCode}) ${when}`, async () => {
            await withRawServer(async (session, accepted) => {
              const peer = await accepted;
              const seen = { aborted: 0, errors: [] as string[] };
              const req = session.request({ ":method": "POST" });
              req.on("aborted", () => seen.aborted++);
              req.on("error", error => seen.errors.push((error as NodeJS.ErrnoException).code!));
              const closed = new Promise(resolve => req.on("close", resolve));
              for (const chunk of chunks) req.write(chunk);
              await peer.until(() => peer.wire(1) === ready);
              if (inListener) {
                req.on("response", () => act(req, peer));
                peer.send(responseHeaders(1), rstStream(peerCode));
              } else {
                setImmediate(() => {
                  peer.send(rstStream(peerCode));
                  act(req, peer);
                });
              }
              await closed;
              assert.deepStrictEqual({ ...seen, rstCode: req.rstCode }, { aborted: 1, errors, rstCode });
              // The session has counted the stream out: a graceful close() completes.
              const sessionClosed = once(session, "close");
              session.close();
              await sessionClosed;
            });
          });
        }
      }
    }
  }

  for (const [call, act] of [
    ["close()", stream => stream.close()],
    ["destroy()", stream => stream.destroy()],
  ] as [string, (stream: http2.ServerHttp2Stream) => void][]) {
    for (const peerCode of [NGHTTP2_INTERNAL_ERROR, NGHTTP2_CANCEL]) {
      test(`response: respond(), ${call}, RST_STREAM(${peerCode}) in the read after the call`, async () => {
        await withRawClient("POST", async (stream, peer) => {
          const seen = { aborted: 0, errors: [] as string[] };
          stream.removeAllListeners("error");
          stream.on("aborted", () => seen.aborted++);
          stream.on("error", error => seen.errors.push((error as NodeJS.ErrnoException).code!));
          const closed = new Promise(resolve => stream.on("close", resolve));
          stream.respond({ ":status": 200 });
          await peer.until(() => peer.wire(1) === "H");
          setImmediate(() => {
            peer.send(rstStream(peerCode));
            act(stream);
          });
          await closed;
          assert.deepStrictEqual(
            { ...seen, rstCode: stream.rstCode },
            { aborted: 1, errors: [], rstCode: NGHTTP2_NO_ERROR },
          );
        });
      });
    }
  }

  // GOAWAY with a last stream id below the request: nghttp2 closes the request as refused.
  test("close(), GOAWAY below the stream in the read after the call", async () => {
    await withRawServer(async (session, accepted) => {
      const peer = await accepted;
      const errors: string[] = [];
      const req = session.request({ ":method": "POST" });
      req.on("error", error => errors.push((error as NodeJS.ErrnoException).code!));
      const closed = new Promise(resolve => req.on("close", resolve));
      await peer.until(() => peer.wire(1) === "H");
      setImmediate(() => {
        peer.send(frameOf(7, 0, 0, Buffer.concat([u32(0), u32(NGHTTP2_NO_ERROR)])));
        req.close();
      });
      await closed;
      assert.deepStrictEqual({ errors, rstCode: req.rstCode }, { errors: [], rstCode: NGHTTP2_NO_ERROR });
    });
  });
});

// The peer counts a stream against SETTINGS_MAX_CONCURRENT_STREAMS until it gets RST_STREAM.
// destroy() after close() emits 'close' at once, and 'close' lets the next request leave.
describe("close() then destroy() at SETTINGS_MAX_CONCURRENT_STREAMS: RST_STREAM leaves before the next HEADERS", () => {
  for (const [body, chunks, ready] of [
    ["no body", [], "H"],
    ["a stalled body", [BODY], STALLED],
  ] as [string, Chunk[], string][]) {
    test(body, async () => {
      await withRawServer(async (session, accepted) => {
        const peer = await accepted;
        peer.send(settings(3, 1));
        await peer.settle();
        const req = post(session, chunks);
        await peer.until(() => peer.wire(1) === ready);
        req.close();
        req.destroy();
        session.request({ ":path": "/" }).on("error", () => {});
        let resetFirst: boolean | undefined;
        await peer.until(() => peer.wire(3) !== "" && ((resetFirst ??= peer.wire(1).includes("R")), true));
        assert.strictEqual(resetFirst, true);
      });
    });
  }
});

test("session.destroy() with an unsent response sends GOAWAY and no RST_STREAM", async () => {
  await withRawClient("GET", async (stream, peer) => {
    stream.respond({ ":status": 200 });
    stream.write(BODY);
    await peer.until(() => peer.wire(1) === STALLED);
    stream.session!.destroy();
    await peer.closed;
    assert.deepStrictEqual({ wire: peer.wire(1), goaway: peer.goaway }, { wire: STALLED, goaway: NGHTTP2_NO_ERROR });
  });
});

// The transport is a JS stream. What the session writes reaches the peer inside the write,
// and a PING round trip is not a turn of the event loop.
describe("close() and destroy() on a session over a JS stream", () => {
  async function withDuplexPeer(run: (session: http2.ClientHttp2Session, peer: RawPeer) => Promise<void>) {
    const [clientSide, serverSide] = duplexPair();
    const peer = new RawPeer(serverSide, "server");
    const session = http2.connect("http://localhost", { createConnection: () => clientSide });
    session.on("error", () => {});
    try {
      // A session that answers a PING has connected: its requests are not pending.
      await peer.settle();
      await run(session, peer);
    } finally {
      session.destroy();
      serverSide.destroy();
    }
  }

  for (const [name, wait] of [
    ["write(BODY), close() in one tick", undefined],
    ["write(BODY) stalled, close()", STALLED],
  ] as const) {
    test(name, async () => {
      await withDuplexPeer(async (session, peer) => {
        const req = post(session, [BODY]);
        assert.strictEqual(req.pending, false);
        if (wait !== undefined) await peer.until(() => peer.wire(1) === wait);
        req.close();
        // On Bun the PING round trips take no turn of the event loop here: the windows open
        // while its RST_STREAM is still due. The wait after that is for the frame.
        await wireAfterGrant(peer);
        await peer.until(() => peer.wire(1).includes("R"));
        assert.strictEqual(resetOnce(peer.wire(1)), `${STALLED} R0`);
      });
    });
  }

  test("write(100 kB), destroy() in one tick, with room in every window", async () => {
    await withDuplexPeer(async (session, peer) => {
      const data = Buffer.alloc(100_000, "c");
      const req = post(session);
      await peer.until(() => peer.wire(1) === "H");
      peer.send(widest(0), widest(1));
      await peer.settle();
      // node completes a write to a JS stream in a setImmediate callback, and destroy() drops
      // the queued DATA while a write is in progress. Two turns complete that of the PING answer.
      await nextTurn();
      await nextTurn();
      req.write(data);
      req.destroy();
      await peer.until(() => peer.wire(1).includes("R"));
      assert.strictEqual(resetOnce(peer.wire(1)), `H D${data.length} R0`);
    });
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
