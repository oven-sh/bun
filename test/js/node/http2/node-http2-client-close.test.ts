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
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import path from "node:path";
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

// A client request that waits for a stream slot: the session is at the peer's
// SETTINGS_MAX_CONCURRENT_STREAMS, so its HEADERS frame is not sent yet. close(code) cancels it in
// place. Nothing is written for it, and it closes with that code when a slot opens.

const KEYS = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");

type FramePeerOptions = {
  secure?: boolean;
  // The peer's SETTINGS_MAX_CONCURRENT_STREAMS.
  limit?: number;
  // Send SETTINGS when the connection opens, before the client preface.
  eagerSettings?: boolean;
};

// A raw HTTP/2 peer, h2c or h2 over TLS. It records the HEADERS, DATA and RST_STREAM frames that
// the client sends. The first `limit` requests get no answer until answer(id). Every later request
// is answered at once with 200 and END_STREAM.
async function framePeer({ secure = false, limit = 1, eagerSettings = false }: FramePeerOptions = {}) {
  const FRAME = { DATA: 0, HEADERS: 1, RST_STREAM: 3, SETTINGS: 4, PING: 6, GOAWAY: 7 };
  const ACK = 0x1;
  const END_STREAM = 0x1;
  const END_HEADERS = 0x4;
  const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
  const frame = (type: number, flags: number, id: number, payload: Buffer = Buffer.alloc(0)) => {
    const header = Buffer.alloc(9);
    header.writeUIntBE(payload.length, 0, 3);
    header[3] = type;
    header[4] = flags;
    header.writeUInt32BE(id, 5);
    return Buffer.concat([header, payload]);
  };
  const maxConcurrentStreams = (streams: number) => {
    const payload = Buffer.alloc(6);
    payload.writeUInt16BE(0x3, 0);
    payload.writeUInt32BE(streams, 2);
    return frame(FRAME.SETTINGS, 0, 0, payload);
  };
  // 0x88 is the HPACK static table entry ":status: 200".
  const status200 = Buffer.from([0x88]);

  const frames: string[] = [];
  let socket: net.Socket | undefined;
  const disconnected = Promise.withResolvers<void>();
  const answer = (id: number, body?: string) => {
    if (body === undefined) {
      socket!.write(frame(FRAME.HEADERS, END_STREAM | END_HEADERS, id, status200));
    } else {
      socket!.write(frame(FRAME.HEADERS, END_HEADERS, id, status200));
      socket!.write(frame(FRAME.DATA, END_STREAM, id, Buffer.from(body)));
    }
  };
  const onConnection = (s: net.Socket) => {
    socket = s;
    let buffered = Buffer.alloc(0);
    let sawPreface = false;
    let held = 0;
    s.on("error", () => {});
    s.on("close", () => disconnected.resolve());
    if (eagerSettings) s.write(maxConcurrentStreams(limit));
    s.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!sawPreface) {
        if (buffered.length < PREFACE.length) return;
        sawPreface = true;
        buffered = buffered.subarray(PREFACE.length);
        if (!eagerSettings) s.write(maxConcurrentStreams(limit));
      }
      while (buffered.length >= 9) {
        const length = buffered.readUIntBE(0, 3);
        if (buffered.length < 9 + length) break;
        const type = buffered[3];
        const flags = buffered[4];
        const id = buffered.readUInt32BE(5) & 0x7fffffff;
        const payload = buffered.subarray(9, 9 + length);
        buffered = buffered.subarray(9 + length);
        const endStream = flags & END_STREAM ? " END_STREAM" : "";
        if (type === FRAME.SETTINGS) {
          if (!(flags & ACK)) s.write(frame(FRAME.SETTINGS, ACK, 0));
        } else if (type === FRAME.PING) {
          if (!(flags & ACK)) s.write(frame(FRAME.PING, ACK, 0, payload));
        } else if (type === FRAME.DATA) {
          frames.push(`DATA ${id}${endStream}`);
        } else if (type === FRAME.RST_STREAM) {
          frames.push(`RST_STREAM ${id} code=${payload.readUInt32BE(0)}`);
        } else if (type === FRAME.HEADERS) {
          frames.push(`HEADERS ${id}${endStream}`);
          if (held < limit) held++;
          else answer(id);
        }
      }
    });
  };
  const server = secure
    ? tls.createServer(
        {
          key: fs.readFileSync(path.join(KEYS, "agent1-key.pem")),
          cert: fs.readFileSync(path.join(KEYS, "agent1-cert.pem")),
          ALPNProtocols: ["h2"],
        },
        onConnection,
      )
    : net.createServer(onConnection);
  const port = await listen(server);
  return {
    port,
    // What the client sent, for example "HEADERS 1 END_STREAM" or "RST_STREAM 3 code=8".
    frames,
    // The connection is closed: `frames` is complete.
    disconnected: disconnected.promise,
    answer,
    raiseLimit: (streams: number) => socket!.write(maxConcurrentStreams(streams)),
    goaway(code: number, lastStreamId: number) {
      const payload = Buffer.alloc(8);
      payload.writeUInt32BE(lastStreamId, 0);
      payload.writeUInt32BE(code, 4);
      socket!.write(frame(FRAME.GOAWAY, 0, 0, payload));
    },
    end: () => socket!.end(),
    connect: (options?: http2.ClientSessionOptions | http2.SecureClientSessionOptions) =>
      http2.connect(`${secure ? "https" : "http"}://127.0.0.1:${port}`, { rejectUnauthorized: false, ...options }),
    close() {
      socket?.destroy();
      server.close();
    },
  };
}
type FramePeer = Awaited<ReturnType<typeof framePeer>>;

// The peer answers a PING after it handled every frame that the client wrote before it.
function peerCaughtUp(session: http2.ClientHttp2Session): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  session.ping(err => (err ? reject(err) : resolve()));
  return promise;
}

type Watched = { stream: http2.ClientHttp2Stream; events: string[]; closed: Promise<void> };

function watchRequest(stream: http2.ClientHttp2Stream): Watched {
  const events: string[] = [];
  const { promise: closed, resolve } = Promise.withResolvers<void>();
  stream.on("aborted", () => events.push("aborted"));
  stream.on("response", headers => events.push("response:" + headers[":status"]));
  stream.on("end", () => events.push("end"));
  stream.on("error", e => events.push("error:" + (e as NodeJS.ErrnoException).code));
  stream.on("close", () => {
    events.push("close:" + stream.rstCode);
    resolve();
  });
  stream.resume();
  return { stream, events, closed };
}

const headersOf = (...requests: Watched[]) => requests.map(({ stream }) => `HEADERS ${stream.id} END_STREAM`);

type AtLimit = { peer: FramePeer; session: http2.ClientHttp2Session; holders: Watched[] };

// Runs `body` on a session where `limit` open requests, the holders, use every stream slot.
async function atStreamLimit(options: FramePeerOptions, body: (at: AtLimit) => Promise<void>) {
  const peer = await framePeer(options);
  const session = peer.connect();
  session.on("error", () => {});
  try {
    await once(session, "remoteSettings");
    const holders: Watched[] = [];
    for (let i = 0; i < (options.limit ?? 1); i++) {
      holders.push(watchRequest(session.request({ ":path": "/holder" })));
    }
    await peerCaughtUp(session);
    assert.deepStrictEqual(peer.frames, headersOf(...holders));
    await body({ peer, session, holders });
  } finally {
    session.destroy();
    peer.close();
  }
}

type WaitingRequest = "GET" | "POST, ended" | "POST, not ended";

// A request waits for the only stream slot and the caller gives it up. A second request is made
// behind it. Then the peer answers the holder. Returns what the peer received.
async function giveUpWaitingRequest(
  secure: boolean,
  kind: WaitingRequest,
  giveUp: (waiting: http2.ClientHttp2Stream, abort: AbortController) => void,
) {
  const result = {
    frames: [] as string[],
    expectedFrames: [] as string[],
    waiting: [] as string[],
    next: [] as string[],
  };
  await atStreamLimit({ secure }, async ({ peer, session, holders: [holder] }) => {
    const abort = new AbortController();
    const waiting = watchRequest(
      session.request({ ":path": "/waiting", ":method": kind === "GET" ? "GET" : "POST" }, { signal: abort.signal }),
    );
    if (kind === "POST, ended") waiting.stream.end("body");
    if (kind === "POST, not ended") {
      waiting.stream.write("body", err =>
        waiting.events.push("write:" + (err as NodeJS.ErrnoException | null | undefined)?.code),
      );
    }
    await peerCaughtUp(session);
    assert.deepStrictEqual(peer.frames, headersOf(holder));

    giveUp(waiting.stream, abort);
    const next = watchRequest(session.request({ ":path": "/next" }));
    await peerCaughtUp(session);
    assert.deepStrictEqual(peer.frames, headersOf(holder));

    peer.answer(holder.stream.id!);
    await Promise.all([holder.closed, waiting.closed, next.closed]);
    await peerCaughtUp(session);
    result.frames = peer.frames;
    result.expectedFrames = headersOf(holder, next);
    result.waiting = waiting.events;
    result.next = next.events;
  });
  return result;
}

for (const secure of [false, true]) {
  describe(`close(code) on a request that waits for a stream slot${secure ? ", TLS" : ""}`, () => {
    for (const [label, kind, args, expected] of [
      ["close(CANCEL), GET", "GET", [NGHTTP2_CANCEL], ["end", "close:8"]],
      ["close(CANCEL), ended POST", "POST, ended", [NGHTTP2_CANCEL], ["end", "close:8"]],
      ["close(INTERNAL_ERROR), GET", "GET", [NGHTTP2_INTERNAL_ERROR], ["error:ERR_HTTP2_STREAM_ERROR", "close:2"]],
      [
        "close(INTERNAL_ERROR), ended POST",
        "POST, ended",
        [NGHTTP2_INTERNAL_ERROR],
        ["error:ERR_HTTP2_STREAM_ERROR", "close:2"],
      ],
      ["close(), GET", "GET", [], ["end", "close:0"]],
      // The write that waits for the stream id completes with an error, after 'close'.
      [
        "close(CANCEL), POST that is not ended",
        "POST, not ended",
        [NGHTTP2_CANCEL],
        ["aborted", "end", "close:8", "write:ECANCELED"],
      ],
    ] as const) {
      test(label, async () => {
        const result = await giveUpWaitingRequest(secure, kind, waiting => waiting.close(...args));
        assert.deepStrictEqual(result.frames, result.expectedFrames);
        assert.deepStrictEqual(result.waiting, expected);
        assert.deepStrictEqual(result.next, ["response:200", "end", "close:0"]);
      });
    }

    test("close(CANCEL, callback), GET", async () => {
      let calls = 0;
      const result = await giveUpWaitingRequest(secure, "GET", waiting => waiting.close(NGHTTP2_CANCEL, () => calls++));
      assert.deepStrictEqual(result.frames, result.expectedFrames);
      assert.deepStrictEqual(result.waiting, ["end", "close:8"]);
      assert.strictEqual(calls, 1);
    });

    test("destroy(), GET", async () => {
      const result = await giveUpWaitingRequest(secure, "GET", waiting => waiting.destroy());
      assert.deepStrictEqual(result.frames, result.expectedFrames);
      assert.deepStrictEqual(result.waiting, ["end", "close:0"]);
      assert.deepStrictEqual(result.next, ["response:200", "end", "close:0"]);
    });

    test("destroy(), POST that is not ended", async () => {
      const result = await giveUpWaitingRequest(secure, "POST, not ended", waiting => waiting.destroy());
      assert.deepStrictEqual(result.frames, result.expectedFrames);
      assert.deepStrictEqual(result.waiting, ["aborted", "end", "close:0", "write:ECANCELED"]);
    });

    test("signal abort, GET", async () => {
      const result = await giveUpWaitingRequest(secure, "GET", (_, abort) => abort.abort());
      assert.deepStrictEqual(result.frames, result.expectedFrames);
      assert.deepStrictEqual(result.waiting, ["error:ABORT_ERR", "close:8"]);
      assert.deepStrictEqual(result.next, ["response:200", "end", "close:0"]);
    });
  });
}

describe("a request that close(code) cancelled while it waited for a stream slot", () => {
  test("limit 2: the next request takes the slot", async () => {
    await atStreamLimit({ limit: 2 }, async ({ peer, session, holders }) => {
      const waiting = watchRequest(session.request({ ":path": "/waiting" }));
      await peerCaughtUp(session);
      waiting.stream.close(NGHTTP2_CANCEL);
      const next = watchRequest(session.request({ ":path": "/next" }));

      peer.answer(holders[0].stream.id!);
      await Promise.all([holders[0].closed, waiting.closed, next.closed]);
      await peerCaughtUp(session);
      assert.deepStrictEqual(peer.frames, headersOf(...holders, next));
      assert.deepStrictEqual(waiting.events, ["end", "close:8"]);
      assert.deepStrictEqual(next.events, ["response:200", "end", "close:0"]);
    });
  });

  test("a request queued behind it before the close takes the slot", async () => {
    await atStreamLimit({}, async ({ peer, session, holders: [holder] }) => {
      const waiting = watchRequest(session.request({ ":path": "/waiting" }));
      const behind = watchRequest(session.request({ ":path": "/behind" }));
      await peerCaughtUp(session);
      waiting.stream.close(NGHTTP2_CANCEL);

      peer.answer(holder.stream.id!);
      await Promise.all([holder.closed, waiting.closed, behind.closed]);
      await peerCaughtUp(session);
      assert.deepStrictEqual(peer.frames, headersOf(holder, behind));
      assert.deepStrictEqual(waiting.events, ["end", "close:8"]);
      assert.deepStrictEqual(behind.events, ["response:200", "end", "close:0"]);
    });
  });

  test("is not sent when the peer raises its limit", async () => {
    await atStreamLimit({}, async ({ peer, session, holders: [holder] }) => {
      const waiting = watchRequest(session.request({ ":path": "/waiting" }));
      await peerCaughtUp(session);
      waiting.stream.close(NGHTTP2_CANCEL);
      const next = watchRequest(session.request({ ":path": "/next" }));

      peer.raiseLimit(2);
      await Promise.all([waiting.closed, next.closed]);
      await peerCaughtUp(session);
      assert.deepStrictEqual(peer.frames, headersOf(holder, next));
      assert.deepStrictEqual(waiting.events, ["end", "close:8"]);
      assert.deepStrictEqual(next.events, ["response:200", "end", "close:0"]);
      assert.deepStrictEqual(holder.events, []);
    });
  });

  test("does not keep session.close() from completing", async () => {
    await atStreamLimit({}, async ({ peer, session, holders: [holder] }) => {
      const waiting = watchRequest(session.request({ ":path": "/waiting" }));
      await peerCaughtUp(session);
      waiting.stream.close(NGHTTP2_CANCEL);

      const sessionClosed = once(session, "close");
      session.close();
      peer.answer(holder.stream.id!);
      await Promise.all([sessionClosed, holder.closed, waiting.closed, peer.disconnected]);
      assert.deepStrictEqual(peer.frames, headersOf(holder));
      assert.deepStrictEqual(waiting.events, ["end", "close:8"]);
    });
  });

  test("does not keep session.close() from completing when the holder's response is read late", async () => {
    await atStreamLimit({}, async ({ peer, session, holders: [holder] }) => {
      holder.stream.pause();
      const waiting = watchRequest(session.request({ ":path": "/waiting" }));
      await peerCaughtUp(session);
      waiting.stream.close(NGHTTP2_CANCEL);

      // The session has the whole response of the holder. Nothing has read its body.
      peer.answer(holder.stream.id!, "body");
      await peerCaughtUp(session);
      const sessionClosed = once(session, "close");
      session.close();
      holder.stream.resume();
      await Promise.all([sessionClosed, holder.closed, waiting.closed, peer.disconnected]);
      assert.deepStrictEqual(peer.frames, headersOf(holder));
      assert.deepStrictEqual(waiting.events, ["end", "close:8"]);
    });
  });

  test("is not sent when request() ran before 'connect' on a connected socket", async () => {
    const peer = await framePeer({ eagerSettings: true });
    const socket = net.connect(peer.port, "127.0.0.1");
    try {
      await once(socket, "connect");
      // The socket holds the peer's SETTINGS frame before the session exists.
      while (socket.readableLength === 0) await new Promise(resolve => setImmediate(resolve));
      const session = peer.connect({ createConnection: () => socket });
      session.on("error", () => {});
      const started = Promise.withResolvers<[Watched, Watched]>();
      session.once("remoteSettings", () => {
        const holder = watchRequest(session.request({ ":path": "/holder" }));
        const waiting = watchRequest(session.request({ ":path": "/waiting" }));
        waiting.stream.close(NGHTTP2_CANCEL);
        started.resolve([holder, waiting]);
      });
      const [holder, waiting] = await started.promise;
      const next = watchRequest(session.request({ ":path": "/next" }));
      await peerCaughtUp(session);
      assert.deepStrictEqual(peer.frames, headersOf(holder));

      peer.answer(holder.stream.id!);
      await Promise.all([holder.closed, waiting.closed, next.closed]);
      await peerCaughtUp(session);
      assert.deepStrictEqual(peer.frames, headersOf(holder, next));
      assert.deepStrictEqual(waiting.events, ["end", "close:8"]);
      session.destroy();
    } finally {
      socket.destroy();
      peer.close();
    }
  });

  // The session ends while the request is still queued. The request keeps the code of close().
  const sessionError = Object.assign(new Error("session error"), { code: "E_SESSION" });
  for (const [label, code, endSession, expected] of [
    ["session.destroy()", NGHTTP2_CANCEL, ({ session }) => session.destroy(), ["end", "close:8"]],
    [
      "session.destroy()",
      NGHTTP2_INTERNAL_ERROR,
      ({ session }) => session.destroy(),
      ["error:ERR_HTTP2_STREAM_ERROR", "close:2"],
    ],
    [
      "session.destroy(error)",
      NGHTTP2_CANCEL,
      ({ session }) => session.destroy(sessionError),
      ["error:E_SESSION", "close:8"],
    ],
    [
      "session.destroy(error)",
      NGHTTP2_NO_ERROR,
      ({ session }) => session.destroy(sessionError),
      ["error:E_SESSION", "close:0"],
    ],
    [
      "a GOAWAY frame with an error code",
      NGHTTP2_CANCEL,
      ({ peer, holders: [holder] }) => peer.goaway(NGHTTP2_ENHANCE_YOUR_CALM, holder.stream.id!),
      ["error:ERR_HTTP2_SESSION_ERROR", "close:8"],
    ],
    [
      "a GOAWAY frame with NO_ERROR and the answer to the holder",
      NGHTTP2_CANCEL,
      ({ peer, holders: [holder] }) => {
        peer.goaway(NGHTTP2_NO_ERROR, holder.stream.id!);
        peer.answer(holder.stream.id!);
      },
      ["end", "close:8"],
    ],
    ["the end of the connection", NGHTTP2_CANCEL, ({ peer }) => peer.end(), ["end", "close:8"]],
  ] as [string, number, (at: AtLimit) => void, string[]][]) {
    test(`close(${code}), then ${label}`, async () => {
      await atStreamLimit({}, async at => {
        const waiting = watchRequest(at.session.request({ ":path": "/waiting" }));
        await peerCaughtUp(at.session);
        waiting.stream.close(code);
        endSession(at);
        await Promise.all([waiting.closed, at.peer.disconnected]);
        assert.deepStrictEqual(waiting.events, expected);
        assert.deepStrictEqual(at.peer.frames, headersOf(...at.holders));
      });
    });
  }

  test("emits its events in the async context of request()", async () => {
    const context = new AsyncLocalStorage<string>();
    await atStreamLimit({}, async ({ peer, session, holders: [holder] }) => {
      const waiting = context.run("request()", () => watchRequest(session.request({ ":path": "/waiting" })));
      const stores: (string | undefined)[] = [];
      waiting.stream.on("end", () => stores.push(context.getStore()));
      waiting.stream.on("close", () => stores.push(context.getStore()));
      await peerCaughtUp(session);
      context.run("close()", () => waiting.stream.close(NGHTTP2_CANCEL));

      context.run("slot opens", () => peer.answer(holder.stream.id!));
      await waiting.closed;
      assert.deepStrictEqual(stores, ["request()", "request()"]);
    });
  });
});

// A request made before the socket connects is still sent: node sends its HEADERS, then the reset.
describe("close(code) on a request made before the session connects", () => {
  for (const code of [NGHTTP2_NO_ERROR, NGHTTP2_CANCEL, NGHTTP2_INTERNAL_ERROR]) {
    test(`close(${code}) sends HEADERS, then one RST_STREAM`, async () => {
      const peer = await framePeer();
      const session = peer.connect();
      session.on("error", () => {});
      try {
        const request = watchRequest(session.request({ ":path": "/" }));
        assert.strictEqual(request.stream.pending, true);
        request.stream.close(code);
        await request.closed;
        await peerCaughtUp(session);
        assert.deepStrictEqual(peer.frames, ["HEADERS 1 END_STREAM", `RST_STREAM 1 code=${code}`]);
      } finally {
        session.destroy();
        peer.close();
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
