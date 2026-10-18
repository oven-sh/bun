/**
 * Http2Stream.close(code) event contract, client and server, while the peer's half is still open:
 *   NO_ERROR / CANCEL  -> 'end', 'close'             (documented 'error' exemption)
 *   any other code     -> 'error', 'close'           (no 'end': the body was killed by RST_STREAM)
 * Once the peer's half has ended (END_STREAM on a HEADERS frame, or a server push, which has no
 * inbound half) the readable already has its EOF, so 'end' comes first for every code.
 *
 * A client request that waits for a stream slot (the peer's SETTINGS_MAX_CONCURRENT_STREAMS) and is
 * reset with close(code) before a slot opens is never sent. The last sections cover it.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-client-close.test.ts
 *   node --test test/js/node/http2/node-http2-client-close.test.ts
 */
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import diagnosticsChannel from "node:diagnostics_channel";
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
// SETTINGS_MAX_CONCURRENT_STREAMS, so its HEADERS frame is not sent yet. close(code) resets it in
// the queue: no frame is written for it, and it closes with that code when a slot opens. node gives
// such a request its id at once and keeps its HEADERS frame back in nghttp2, where a reset drops it.

const isBun = typeof Bun !== "undefined";
// node 24.22 and 26.10 settle a write in flight inside _destroy(), with the error of the destroy
// and before 'close' (nodejs/node#66016). An older node fails it with ECANCELED after 'close'.
const writeSettlesInDestroy = (() => {
  if (isBun) return true;
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 26 || (major === 26 && minor >= 10) || (major === 24 && minor >= 22);
})();
// node finishes the writable of a request that has no body inside request(). Bun finishes it when
// the request is sent, or when close(code) resets it in the queue.
const finishedInRequest = isBun ? [] : ["finish"];
// Inside a callback of the session node holds a reset with NGHTTP2_CANCEL back, and sends its
// queued frames first. node 24.21 and 24.22 do that for every code.
const holdsEveryResetInCallback = (() => {
  if (isBun) return false;
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major === 24 && minor >= 21;
})();
// An older node does not publish the http2.client.stream.* channels.
const channelTest = isBun || Number(process.versions.node.split(".")[0]) >= 26 ? test : test.skip;

const KEYS = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");

// The child of the "listener that throws" test. A debug build of Bun needs seconds to load
// node:http2, so the child starts here and the tests before that one run meanwhile. This file also
// runs under node: the child is process.execPath, not bunExe() of "harness".
const listenerThrows = new Promise<{ stdout: string; stderr: string; exit: unknown }>(resolve => {
  const fixture = path.join(import.meta.dirname, "node-http2-client-close-listener-throws.fixture.js");
  execFile(process.execPath, [fixture], { env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" } }, (err, stdout, stderr) =>
    resolve({ stdout: stdout.trim(), stderr: err ? stderr : "", exit: err ? (err.code ?? err.signal) : 0 }),
  );
});

type FramePeerOptions = {
  secure?: boolean;
  // The peer's SETTINGS_MAX_CONCURRENT_STREAMS.
  limit?: number;
  // The first `held` requests get no answer until answer(id). The default is `limit`.
  held?: number;
  // Send SETTINGS when the connection opens, before the client preface.
  eagerSettings?: boolean;
};

// A raw HTTP/2 peer, h2c or h2 over TLS. It records the HEADERS, DATA and RST_STREAM frames that
// the client sends. Each request after the first `held` ones gets 200 with END_STREAM when it is
// complete.
async function framePeer({ secure = false, limit = 1, held = limit, eagerSettings = false }: FramePeerOptions = {}) {
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
  const unanswered = new Set<number>();
  let socket: net.Socket | undefined;
  let wake = () => {};
  const disconnected = Promise.withResolvers<void>();
  const answer = (id: number, body?: string) => {
    unanswered.delete(id);
    if (body === undefined) {
      socket!.write(frame(FRAME.HEADERS, END_STREAM | END_HEADERS, id, status200));
    } else {
      socket!.write(frame(FRAME.HEADERS, END_HEADERS, id, status200));
      socket!.write(frame(FRAME.DATA, END_STREAM, id, Buffer.from(body)));
    }
  };
  const onConnection = (s: net.Socket) => {
    socket = s;
    // node keeps Nagle's algorithm on for a net.Socket: without this line the run under node
    // waits for a delayed ACK in most tests. Bun never delays.
    s.setNoDelay(true);
    let buffered = Buffer.alloc(0);
    let sawPreface = false;
    let requests = 0;
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
        } else if (type === FRAME.RST_STREAM) {
          frames.push(`RST_STREAM ${id} code=${payload.readUInt32BE(0)}`);
        } else if (type === FRAME.HEADERS || type === FRAME.DATA) {
          frames.push(`${type === FRAME.HEADERS ? "HEADERS" : "DATA"} ${id}${endStream}`);
          if (type === FRAME.HEADERS && requests++ < held) unanswered.add(id);
          if (endStream && !unanswered.has(id)) answer(id);
        }
      }
      wake();
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
    // Resolves when `entry` is in `frames`.
    async saw(entry: string) {
      while (!frames.includes(entry)) await new Promise<void>(resolve => (wake = resolve));
    },
    // The connection is closed: `frames` is complete.
    disconnected: disconnected.promise,
    answer,
    setLimit: (streams: number) => socket!.write(maxConcurrentStreams(streams)),
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

// Records the events of a request in the order they fire.
function watchRequest(stream: http2.ClientHttp2Stream, { read = true } = {}): Watched {
  const events: string[] = [];
  const { promise: closed, resolve } = Promise.withResolvers<void>();
  for (const name of ["aborted", "finish", "end"]) stream.on(name, () => events.push(name));
  stream.on("response", headers => events.push("response:" + headers[":status"]));
  stream.on("error", e => events.push("error:" + (e as NodeJS.ErrnoException).code));
  stream.on("close", () => {
    events.push("close:" + stream.rstCode);
    resolve();
  });
  if (read) stream.resume();
  return { stream, events, closed };
}

// The events of a request without a body that the peer answers.
const SERVED = ["finish", "response:200", "end", "close:0"];

const headersOf = (...requests: Watched[]) => requests.map(({ stream }) => `HEADERS ${stream.id} END_STREAM`);

const writeCallback = (events: string[]) => (err?: Error | null) =>
  events.push("write:" + (err ? (err as NodeJS.ErrnoException).code : "ok"));

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

type GiveUp = {
  name: string;
  method?: "POST";
  // Runs in the tick of request().
  send?: (request: http2.ClientHttp2Stream, events: string[]) => void;
  // Runs while the holder has the only slot.
  giveUp: (request: http2.ClientHttp2Stream, events: string[], abort: AbortController) => void;
  // The events of the request while the holder still has the slot...
  waiting: string[];
  // ...and all of its events.
  closed: string[];
};

// close(code) resets the request in the queue. It has no event of its end before a slot opens.
const resets: GiveUp[] = [
  {
    name: "close(CANCEL), GET",
    giveUp: request => request.close(NGHTTP2_CANCEL),
    waiting: ["finish"],
    closed: ["finish", "end", "close:8"],
  },
  {
    name: "close(INTERNAL_ERROR), GET",
    giveUp: request => request.close(NGHTTP2_INTERNAL_ERROR),
    waiting: ["finish"],
    closed: ["finish", "error:ERR_HTTP2_STREAM_ERROR", "close:2"],
  },
  {
    name: "close(), GET",
    giveUp: request => request.close(),
    waiting: ["finish"],
    closed: ["finish", "end", "close:0"],
  },
  {
    name: "close(CANCEL, callback), GET",
    giveUp: (request, events) => request.close(NGHTTP2_CANCEL, () => events.push("close callback")),
    waiting: ["finish"],
    closed: ["finish", "end", "close:8", "close callback"],
  },
  {
    name: "close(CANCEL), POST with end(body)",
    method: "POST",
    send: request => request.end("body"),
    giveUp: request => request.close(NGHTTP2_CANCEL),
    waiting: [],
    closed: ["end", "close:8"],
  },
  {
    name: "close(INTERNAL_ERROR), POST with end(body)",
    method: "POST",
    send: request => request.end("body"),
    giveUp: request => request.close(NGHTTP2_INTERNAL_ERROR),
    waiting: [],
    closed: ["error:ERR_HTTP2_STREAM_ERROR", "close:2"],
  },
  {
    name: "close(), POST with end()",
    method: "POST",
    send: request => request.end(),
    giveUp: request => request.close(),
    waiting: ["finish"],
    closed: ["finish", "end", "close:0"],
  },
  // The body is never sent. The callback of its write() runs when the request closes.
  {
    name: "close(CANCEL), POST with write(body)",
    method: "POST",
    send: (request, events) => request.write("body", writeCallback(events)),
    giveUp: request => request.close(NGHTTP2_CANCEL),
    waiting: ["aborted"],
    closed: writeSettlesInDestroy
      ? ["aborted", "write:ok", "end", "close:8"]
      : ["aborted", "end", "close:8", "write:ECANCELED"],
  },
  {
    name: "close(INTERNAL_ERROR), POST with write(body)",
    method: "POST",
    send: (request, events) => request.write("body", writeCallback(events)),
    giveUp: request => request.close(NGHTTP2_INTERNAL_ERROR),
    waiting: ["aborted"],
    closed: writeSettlesInDestroy
      ? ["aborted", "write:ERR_HTTP2_STREAM_ERROR", "error:ERR_HTTP2_STREAM_ERROR", "close:2"]
      : ["aborted", "error:ERR_HTTP2_STREAM_ERROR", "close:2", "write:ECANCELED"],
  },
  // Bun corks a request for the tick of request(), so both writes are one batch in flight. In node
  // the second write waits behind the first.
  {
    name: "close(CANCEL), POST with write(a) and write(b)",
    method: "POST",
    send: (request, events) => {
      request.write("a", writeCallback(events));
      request.write("b", writeCallback(events));
    },
    giveUp: request => request.close(NGHTTP2_CANCEL),
    waiting: ["aborted"],
    closed: writeSettlesInDestroy
      ? ["aborted", "write:ok", `write:${isBun ? "ok" : "ERR_STREAM_DESTROYED"}`, "end", "close:8"]
      : ["aborted", "end", "close:8", "write:ECANCELED", "write:ECANCELED"],
  },
];

// destroy() and a signal abort take the request out of the queue at once.
const destroys: GiveUp[] = [
  {
    name: "destroy(), GET",
    giveUp: request => request.destroy(),
    waiting: [...finishedInRequest, "end", "close:0"],
    closed: [...finishedInRequest, "end", "close:0"],
  },
  {
    name: "destroy(), POST with write(body)",
    method: "POST",
    send: request => request.write("body"),
    giveUp: request => request.destroy(),
    waiting: ["aborted", "end", "close:0"],
    closed: ["aborted", "end", "close:0"],
  },
  {
    name: "signal abort, GET",
    giveUp: (_request, _events, abort) => abort.abort(),
    waiting: [...finishedInRequest, "error:ABORT_ERR", "close:8"],
    closed: [...finishedInRequest, "error:ABORT_ERR", "close:8"],
  },
];

// A request waits for the only stream slot and the caller gives it up. A second request waits
// behind it. Then the peer answers the holder, and a third request is made.
async function giveUpWaitingRequest(secure: boolean, row: GiveUp) {
  await atStreamLimit({ secure }, async ({ peer, session, holders: [holder] }) => {
    const abort = new AbortController();
    const waiting = watchRequest(
      session.request({ ":path": "/waiting", ":method": row.method ?? "GET" }, { signal: abort.signal }),
    );
    row.send?.(waiting.stream, waiting.events);
    await peerCaughtUp(session);

    row.giveUp(waiting.stream, waiting.events, abort);
    const next = watchRequest(session.request({ ":path": "/next" }));
    await peerCaughtUp(session);
    const whileHolderHasSlot = { frames: [...peer.frames], waiting: [...waiting.events] };

    peer.answer(holder.stream.id!);
    await Promise.all([holder.closed, waiting.closed, next.closed]);
    const later = watchRequest(session.request({ ":path": "/later" }));
    await later.closed;
    await peerCaughtUp(session);
    assert.deepStrictEqual(
      { whileHolderHasSlot, frames: peer.frames, waiting: waiting.events, next: next.events, later: later.events },
      {
        whileHolderHasSlot: { frames: headersOf(holder), waiting: row.waiting },
        // No frame has the id of the request that was given up.
        frames: headersOf(holder, next, later),
        waiting: row.closed,
        next: SERVED,
        later: SERVED,
      },
    );
  });
}

for (const secure of [false, true]) {
  describe(`a request that waits for a stream slot and is given up${secure ? ", TLS" : ""}`, () => {
    for (const row of [...resets, ...destroys]) {
      test(row.name, () => giveUpWaitingRequest(secure, row));
    }

    // The reset drops the request, as it does for every other code. A released node (24 to 26) then
    // never destroys the request: its writable cannot finish. node 27 destroys it
    // (nodejs/node#63249), and so does Bun.
    test("close(), POST with write(body)", async () => {
      await atStreamLimit({ secure }, async ({ peer, session, holders: [holder] }) => {
        const waiting = watchRequest(session.request({ ":path": "/waiting", ":method": "POST" }));
        waiting.stream.write("body", writeCallback(waiting.events));
        await peerCaughtUp(session);
        waiting.stream.close(NGHTTP2_NO_ERROR, () => waiting.events.push("close callback"));
        const next = watchRequest(session.request({ ":path": "/next" }));
        await peerCaughtUp(session);
        const whileHolderHasSlot = { frames: [...peer.frames], waiting: [...waiting.events] };

        peer.answer(holder.stream.id!);
        await Promise.all([holder.closed, next.closed, isBun ? waiting.closed : undefined]);
        await peerCaughtUp(session);
        assert.deepStrictEqual(
          { whileHolderHasSlot, frames: peer.frames, next: next.events },
          {
            whileHolderHasSlot: { frames: headersOf(holder), waiting: ["aborted"] },
            frames: headersOf(holder, next),
            next: SERVED,
          },
        );
        if (isBun) {
          assert.deepStrictEqual(waiting.events, ["aborted", "write:ok", "end", "close:0", "close callback"]);
        }
      });
    });
  });
}

// close() with NGHTTP2_NO_ERROR on a request that has ended and still has a body write in flight:
// node resets it after 'finish', so the request is sent first. Bun sends it too.
describe("close() on an ended request that waits for a stream slot with a body to send", () => {
  for (const [name, send] of [
    ["end(body)", request => request.end("body")],
    [
      "write(''), end()",
      request => {
        request.write("");
        request.end();
      },
    ],
  ] as [string, (request: http2.ClientHttp2Stream) => void][]) {
    test(`${name}, close()`, async () => {
      // The peer does not answer the request either: only the reset of the client closes it.
      await atStreamLimit({ held: 2 }, async ({ peer, session, holders: [holder] }) => {
        const waiting = watchRequest(session.request({ ":path": "/waiting", ":method": "POST" }));
        send(waiting.stream);
        await peerCaughtUp(session);
        waiting.stream.close();
        await peerCaughtUp(session);
        const whileHolderHasSlot = [...peer.frames];

        peer.answer(holder.stream.id!);
        await Promise.all([holder.closed, waiting.closed]);
        const id = waiting.stream.id!;
        await peer.saw(`RST_STREAM ${id} code=0`);
        await peerCaughtUp(session);
        assert.deepStrictEqual(
          {
            whileHolderHasSlot,
            // node sends one DATA frame for each write and one for END_STREAM, and Bun one in all.
            frames: peer.frames.filter(entry => entry !== `DATA ${id}`),
            rstCode: waiting.stream.rstCode,
          },
          {
            whileHolderHasSlot: headersOf(holder),
            frames: [...headersOf(holder), `HEADERS ${id}`, `DATA ${id} END_STREAM`, `RST_STREAM ${id} code=0`],
            rstCode: NGHTTP2_NO_ERROR,
          },
        );
      });
    });
  }
});

describe("a request that close(code) reset while it waited for a stream slot", () => {
  test("limit 2: the request behind it takes the slot", async () => {
    await atStreamLimit({ limit: 2 }, async ({ peer, session, holders }) => {
      const waiting = watchRequest(session.request({ ":path": "/waiting" }));
      await peerCaughtUp(session);
      waiting.stream.close(NGHTTP2_CANCEL);
      const next = watchRequest(session.request({ ":path": "/next" }));

      peer.answer(holders[0].stream.id!);
      await Promise.all([holders[0].closed, waiting.closed, next.closed]);
      await peerCaughtUp(session);
      assert.deepStrictEqual(
        { frames: peer.frames, waiting: waiting.events, next: next.events },
        { frames: headersOf(...holders, next), waiting: ["finish", "end", "close:8"], next: SERVED },
      );
    });
  });

  test("one free slot closes three of them in queue order, and serves the request behind them", async () => {
    await atStreamLimit({}, async ({ peer, session, holders: [holder] }) => {
      const codes = [NGHTTP2_NO_ERROR, NGHTTP2_CANCEL, NGHTTP2_INTERNAL_ERROR];
      const order: string[] = [];
      const reset = codes.map(code => {
        const request = watchRequest(session.request({ ":path": "/reset" }));
        request.stream.on("close", () => order.push("close:" + code));
        return request;
      });
      const behind = watchRequest(session.request({ ":path": "/behind" }));
      await peerCaughtUp(session);
      reset.forEach((request, i) => request.stream.close(codes[i]));
      await peerCaughtUp(session);
      const whileHolderHasSlot = [...order];

      peer.answer(holder.stream.id!);
      await Promise.all([holder.closed, ...reset.map(request => request.closed), behind.closed]);
      await peerCaughtUp(session);
      assert.deepStrictEqual(
        {
          whileHolderHasSlot,
          frames: peer.frames,
          order,
          reset: reset.map(({ events }) => events),
          behind: behind.events,
        },
        {
          whileHolderHasSlot: [],
          frames: headersOf(holder, behind),
          order: ["close:0", "close:8", "close:2"],
          reset: [
            ["finish", "end", "close:0"],
            ["finish", "end", "close:8"],
            ["finish", "error:ERR_HTTP2_STREAM_ERROR", "close:2"],
          ],
          behind: SERVED,
        },
      );
    });
  });

  test("has no event while the request ahead of it has the slot", async () => {
    await atStreamLimit({ held: 2 }, async ({ peer, session, holders: [holder] }) => {
      const ahead = watchRequest(session.request({ ":path": "/ahead" }));
      const waiting = watchRequest(session.request({ ":path": "/waiting" }));
      await peerCaughtUp(session);
      waiting.stream.close(NGHTTP2_CANCEL);

      peer.answer(holder.stream.id!);
      await holder.closed;
      await peer.saw(headersOf(ahead)[0]);
      await peerCaughtUp(session);
      const behindOpenRequest = { frames: [...peer.frames], waiting: [...waiting.events] };
      // A SETTINGS frame with the same limit runs the queue again, and there is still no slot.
      const settings = once(session, "remoteSettings");
      peer.setLimit(1);
      await settings;
      await peerCaughtUp(session);
      const afterSettings = [...waiting.events];

      peer.answer(ahead.stream.id!);
      await Promise.all([ahead.closed, waiting.closed]);
      await peerCaughtUp(session);
      assert.deepStrictEqual(
        { behindOpenRequest, afterSettings, frames: peer.frames, waiting: waiting.events },
        {
          behindOpenRequest: { frames: headersOf(holder, ahead), waiting: ["finish"] },
          afterSettings: ["finish"],
          frames: headersOf(holder, ahead),
          waiting: ["finish", "end", "close:8"],
        },
      );
    });
  });

  test("is not sent when the peer raises its limit", async () => {
    await atStreamLimit({}, async ({ peer, session, holders: [holder] }) => {
      const waiting = watchRequest(session.request({ ":path": "/waiting" }));
      await peerCaughtUp(session);
      waiting.stream.close(NGHTTP2_CANCEL);
      const next = watchRequest(session.request({ ":path": "/next" }));
      await peerCaughtUp(session);
      const beforeSettings = [...waiting.events];

      peer.setLimit(2);
      await Promise.all([waiting.closed, next.closed]);
      await peerCaughtUp(session);
      assert.deepStrictEqual(
        { beforeSettings, frames: peer.frames, waiting: waiting.events, next: next.events, holder: holder.events },
        {
          beforeSettings: ["finish"],
          frames: headersOf(holder, next),
          waiting: ["finish", "end", "close:8"],
          next: SERVED,
          holder: ["finish"],
        },
      );
    });
  });

  test("closes after the request that had the slot", async () => {
    await atStreamLimit({}, async ({ peer, session, holders: [holder] }) => {
      const log: string[] = [];
      holder.stream.on("close", () => log.push("holder close"));
      const waiting = watchRequest(session.request({ ":path": "/waiting" }));
      for (const name of ["end", "close"]) waiting.stream.on(name, () => log.push("waiting " + name));
      await peerCaughtUp(session);
      waiting.stream.close(NGHTTP2_CANCEL);

      peer.answer(holder.stream.id!);
      await waiting.closed;
      assert.deepStrictEqual(log, ["holder close", "waiting end", "waiting close"]);
    });
  });

  for (const [code, expected] of [
    [NGHTTP2_NO_ERROR, ["finish", "end", "close:0"]],
    [NGHTTP2_CANCEL, ["finish", "close:8"]],
  ] as [number, string[]][]) {
    test(`close(${code}) on a request that nothing reads`, async () => {
      await atStreamLimit({}, async ({ peer, session, holders: [holder] }) => {
        const waiting = watchRequest(session.request({ ":path": "/waiting" }), { read: false });
        await peerCaughtUp(session);
        waiting.stream.close(code);

        peer.answer(holder.stream.id!);
        await Promise.all([holder.closed, waiting.closed]);
        await peerCaughtUp(session);
        assert.deepStrictEqual(
          { frames: peer.frames, waiting: waiting.events },
          { frames: headersOf(holder), waiting: expected },
        );
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

  test("is not sent on a socket that was connected before connect()", async () => {
    const peer = await framePeer({ eagerSettings: true });
    const socket = net.connect(peer.port, "127.0.0.1");
    try {
      await once(socket, "connect");
      const session = peer.connect({ createConnection: () => socket });
      session.on("error", () => {});
      await Promise.all([once(session, "connect"), once(session, "remoteSettings")]);
      const holder = watchRequest(session.request({ ":path": "/holder" }));
      const waiting = watchRequest(session.request({ ":path": "/waiting" }));
      waiting.stream.close(NGHTTP2_CANCEL);
      const next = watchRequest(session.request({ ":path": "/next" }));
      await peerCaughtUp(session);
      const whileHolderHasSlot = [...peer.frames];

      peer.answer(holder.stream.id!);
      await Promise.all([holder.closed, waiting.closed, next.closed]);
      await peerCaughtUp(session);
      assert.deepStrictEqual(
        { whileHolderHasSlot, frames: peer.frames, waiting: waiting.events },
        {
          whileHolderHasSlot: headersOf(holder),
          frames: headersOf(holder, next),
          waiting: ["finish", "end", "close:8"],
        },
      );
      session.destroy();
    } finally {
      socket.destroy();
      peer.close();
    }
  });

  // A server with one stream slot, and a client that cancels the request that waits for it.
  test("never reaches the 'stream' listener of a server", async () => {
    const server = http2.createServer({ settings: { maxConcurrentStreams: 1 } });
    const seen: string[] = [];
    const holding = Promise.withResolvers<http2.ServerHttp2Stream>();
    server.on("stream", (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => {
      stream.on("error", () => {});
      seen.push(headers[":path"] as string);
      if (headers[":path"] === "/hold") return holding.resolve(stream);
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });
    const port = await listen(server as unknown as net.Server);
    const session = http2.connect(`http://127.0.0.1:${port}`);
    session.on("error", () => {});
    try {
      await once(session, "remoteSettings");
      const hold = watchRequest(session.request({ ":path": "/hold" }));
      const held = await holding.promise;
      const cancelled = watchRequest(session.request({ ":path": "/cancelled" }));
      cancelled.stream.close(NGHTTP2_CANCEL);
      const last = watchRequest(session.request({ ":path": "/last" }));
      held.respond({ ":status": 200 });
      held.end("late");
      await Promise.all([hold.closed, cancelled.closed, last.closed]);
      assert.deepStrictEqual(
        { seen, cancelled: cancelled.events, last: last.events },
        { seen: ["/hold", "/last"], cancelled: ["finish", "end", "close:8"], last: SERVED },
      );
    } finally {
      session.destroy();
      server.close();
    }
  });

  // A listener that throws is an uncaught exception, in node too. The child process handles it.
  test("does not stop the queue when one of its listeners throws", async () => {
    // The request behind it is answered, and it was not sent.
    assert.deepStrictEqual(await listenerThrows, {
      stdout: JSON.stringify({ seen: ["/hold", "/last"], uncaught: ["readable listener"] }),
      stderr: "",
      exit: 0,
    });
  });
});

// session.close() completes when no stream is open and the queue is empty.
describe("session.close() with a request that waits for a stream slot", () => {
  test("completes after a request that close(code) reset", async () => {
    await atStreamLimit({}, async ({ peer, session, holders: [holder] }) => {
      const waiting = watchRequest(session.request({ ":path": "/waiting" }));
      await peerCaughtUp(session);
      waiting.stream.close(NGHTTP2_CANCEL);

      const sessionClosed = once(session, "close");
      session.close();
      peer.answer(holder.stream.id!);
      await Promise.all([sessionClosed, holder.closed, waiting.closed, peer.disconnected]);
      assert.deepStrictEqual(
        { frames: peer.frames, waiting: waiting.events },
        { frames: headersOf(holder), waiting: ["finish", "end", "close:8"] },
      );
    });
  });

  // The session has the whole response of the holder, and nothing has read its body: the holder
  // still has the slot. When it closes, the queue empties and no request is sent.
  for (const [name, giveUp, expected] of [
    ["close(CANCEL)", request => request.close(NGHTTP2_CANCEL), ["finish", "end", "close:8"]],
    ["destroy()", request => request.destroy(), [...finishedInRequest, "end", "close:0"]],
    ["a signal abort", (_request, abort) => abort.abort(), [...finishedInRequest, "error:ABORT_ERR", "close:8"]],
  ] as [string, (request: http2.ClientHttp2Stream, abort: AbortController) => void, string[]][]) {
    test(`completes when ${name} took the last request out of the queue`, async () => {
      await atStreamLimit({}, async ({ peer, session, holders: [holder] }) => {
        holder.stream.pause();
        const abort = new AbortController();
        const waiting = watchRequest(session.request({ ":path": "/waiting" }, { signal: abort.signal }));
        await peerCaughtUp(session);
        giveUp(waiting.stream, abort);

        peer.answer(holder.stream.id!, "body");
        await peerCaughtUp(session);
        const sessionClosed = once(session, "close");
        session.close();
        holder.stream.resume();
        await Promise.all([sessionClosed, holder.closed, waiting.closed, peer.disconnected]);
        assert.deepStrictEqual(
          { frames: peer.frames, waiting: waiting.events },
          { frames: headersOf(holder), waiting: expected },
        );
      });
    });
  }

  test("does not end the session while another request is open", async () => {
    await atStreamLimit({ limit: 2 }, async ({ peer, session, holders: [first, second] }) => {
      const waiting = watchRequest(session.request({ ":path": "/waiting" }));
      await peerCaughtUp(session);
      waiting.stream.close(NGHTTP2_CANCEL);

      const sessionClosed = once(session, "close");
      session.close();
      peer.answer(first.stream.id!);
      await Promise.all([first.closed, waiting.closed]);
      // A session that ends here does so within one turn of the event loop. node rejects a ping() after close().
      for (let turn = 0; turn < 2; turn++) await new Promise(resolve => setImmediate(resolve));
      const destroyedWhileOpen = session.destroyed;
      peer.answer(second.stream.id!);
      await Promise.all([sessionClosed, second.closed, peer.disconnected]);
      assert.deepStrictEqual(
        { destroyedWhileOpen, frames: peer.frames, second: second.events },
        { destroyedWhileOpen: false, frames: headersOf(first, second), second: SERVED },
      );
    });
  });
});

// The session ends while the request still waits. node has an open stream for it: the request
// keeps the code of close(code), and gets the error of the session if there is one.
describe("close(code) on a request that waits for a stream slot, then the session ends", () => {
  const sessionError = Object.assign(new Error("session error"), { code: "E_SESSION" });
  for (const [label, code, endSession, expected] of [
    ["session.destroy()", NGHTTP2_CANCEL, ({ session }) => session.destroy(), ["finish", "end", "close:8"]],
    [
      "session.destroy()",
      NGHTTP2_INTERNAL_ERROR,
      ({ session }) => session.destroy(),
      ["finish", "error:ERR_HTTP2_STREAM_ERROR", "close:2"],
    ],
    [
      "session.destroy(error)",
      NGHTTP2_CANCEL,
      ({ session }) => session.destroy(sessionError),
      ["finish", "error:E_SESSION", "close:8"],
    ],
    [
      "session.destroy(error)",
      NGHTTP2_NO_ERROR,
      ({ session }) => session.destroy(sessionError),
      ["finish", "error:E_SESSION", "close:0"],
    ],
    [
      "a GOAWAY frame with an error code",
      NGHTTP2_CANCEL,
      ({ peer, holders: [holder] }) => peer.goaway(NGHTTP2_ENHANCE_YOUR_CALM, holder.stream.id!),
      ["finish", "error:ERR_HTTP2_SESSION_ERROR", "close:8"],
    ],
    [
      "a GOAWAY frame with NO_ERROR and the answer to the holder",
      NGHTTP2_CANCEL,
      ({ peer, holders: [holder] }) => {
        peer.goaway(NGHTTP2_NO_ERROR, holder.stream.id!);
        peer.answer(holder.stream.id!);
      },
      ["finish", "end", "close:8"],
    ],
    ["the end of the connection", NGHTTP2_CANCEL, ({ peer }) => peer.end(), ["finish", "end", "close:8"]],
  ] as [string, number, (at: AtLimit) => void, string[]][]) {
    test(`close(${code}), then ${label}`, async () => {
      await atStreamLimit({}, async at => {
        const waiting = watchRequest(at.session.request({ ":path": "/waiting" }));
        await peerCaughtUp(at.session);
        waiting.stream.close(code);
        endSession(at);
        await Promise.all([waiting.closed, at.peer.disconnected]);
        assert.deepStrictEqual(
          { frames: at.peer.frames, waiting: waiting.events },
          { frames: headersOf(...at.holders), waiting: expected },
        );
      });
    });
  }

  // The write that waited for the stream id settles when the session ends. node 24.22 and 26.10
  // settle it with the error of the session, before 'close'.
  for (const [label, endSession, settled, old] of [
    ["session.destroy()", ({ session }) => session.destroy(), ["write:ok", "end"], ["end"]],
    [
      "session.destroy(error)",
      ({ session }) => session.destroy(sessionError),
      ["write:E_SESSION", "error:E_SESSION"],
      ["error:E_SESSION"],
    ],
    [
      "a GOAWAY frame with an error code",
      ({ peer, holders: [holder] }) => peer.goaway(NGHTTP2_ENHANCE_YOUR_CALM, holder.stream.id!),
      ["write:ERR_HTTP2_SESSION_ERROR", "error:ERR_HTTP2_SESSION_ERROR"],
      ["error:ERR_HTTP2_SESSION_ERROR"],
    ],
    ["the end of the connection", ({ peer }) => peer.end(), ["write:ok", "end"], ["end"]],
  ] as [string, (at: AtLimit) => void, string[], string[]][]) {
    test(`close(CANCEL) with a write in flight, then ${label}`, async () => {
      await atStreamLimit({}, async at => {
        const waiting = watchRequest(at.session.request({ ":path": "/waiting", ":method": "POST" }));
        const written = Promise.withResolvers<void>();
        waiting.stream.write("body", err => {
          writeCallback(waiting.events)(err);
          written.resolve();
        });
        await peerCaughtUp(at.session);
        waiting.stream.close(NGHTTP2_CANCEL);
        endSession(at);
        await Promise.all([waiting.closed, written.promise, at.peer.disconnected]);
        assert.deepStrictEqual(
          { frames: at.peer.frames, waiting: waiting.events },
          {
            frames: headersOf(...at.holders),
            waiting: writeSettlesInDestroy
              ? ["aborted", ...settled, "close:8"]
              : ["aborted", ...old, "close:8", "write:ECANCELED"],
          },
        );
      });
    });
  }

  // The GOAWAY rejects the request ahead of it first, and a listener of that request destroys the
  // session. The reset request still gets the error of the GOAWAY.
  for (const code of [NGHTTP2_CANCEL, NGHTTP2_INTERNAL_ERROR]) {
    test(`close(${code}), then a GOAWAY frame with an error code while a listener destroys the session`, async () => {
      await atStreamLimit({ limit: 0 }, async ({ peer, session }) => {
        const ahead = watchRequest(session.request({ ":path": "/ahead", ":method": "POST" }));
        ahead.stream.on("aborted", () => session.destroy());
        const waiting = watchRequest(session.request({ ":path": "/waiting" }));
        await peerCaughtUp(session);
        waiting.stream.close(code);
        peer.goaway(NGHTTP2_ENHANCE_YOUR_CALM, 0);
        await Promise.all([waiting.closed, ahead.closed]);
        assert.deepStrictEqual(
          { frames: peer.frames, waiting: waiting.events },
          { frames: [], waiting: ["finish", "error:ERR_HTTP2_SESSION_ERROR", `close:${code}`] },
        );
      });
    });
  }

  test("close(CANCEL), then session.destroy(error): an 'error' listener that is added after it gets the error", async () => {
    await atStreamLimit({}, async ({ peer, session, holders }) => {
      const waiting = session.request({ ":path": "/waiting" });
      const events: string[] = [];
      const closed = Promise.withResolvers<void>();
      waiting.on("close", () => {
        events.push("close:" + waiting.rstCode);
        closed.resolve();
      });
      waiting.resume();
      await peerCaughtUp(session);
      waiting.close(NGHTTP2_CANCEL);
      session.destroy(sessionError);
      waiting.on("error", e => events.push("error:" + (e as NodeJS.ErrnoException).code));
      await Promise.all([closed.promise, peer.disconnected]);
      assert.deepStrictEqual(
        { frames: peer.frames, events },
        { frames: headersOf(...holders), events: ["error:E_SESSION", "close:8"] },
      );
    });
  });

  // node closes the request when the holder ends. Bun closes it when the GOAWAY frame arrives: it
  // decides the fate of every queued request at that moment.
  test("close(CANCEL), then a GOAWAY frame with NO_ERROR while the holder keeps the slot", async () => {
    await atStreamLimit({}, async ({ peer, session, holders: [holder] }) => {
      const waiting = watchRequest(session.request({ ":path": "/waiting" }));
      await peerCaughtUp(session);
      waiting.stream.close(NGHTTP2_CANCEL, () => waiting.events.push("close callback"));
      const goaway = once(session, "goaway");
      const sessionClosed = once(session, "close");
      peer.goaway(NGHTTP2_NO_ERROR, holder.stream.id!);
      await goaway;
      if (isBun) await waiting.closed;
      // A request that closes at the GOAWAY does so within one turn of the event loop. node rejects a ping() after close().
      else for (let turn = 0; turn < 2; turn++) await new Promise(resolve => setImmediate(resolve));
      const whileHolderHasSlot = {
        waiting: [...waiting.events],
        holder: [...holder.events],
        destroyed: session.destroyed,
      };
      peer.answer(holder.stream.id!);
      await Promise.all([holder.closed, waiting.closed, sessionClosed, peer.disconnected]);
      assert.deepStrictEqual(
        { whileHolderHasSlot, frames: peer.frames, waiting: waiting.events, holder: holder.events },
        {
          whileHolderHasSlot: {
            waiting: isBun ? ["finish", "end", "close:8", "close callback"] : ["finish"],
            holder: ["finish"],
            destroyed: false,
          },
          frames: headersOf(holder),
          waiting: ["finish", "end", "close:8", "close callback"],
          holder: SERVED,
        },
      );
    });
  });

  // With a limit of 0 no slot opens: node keeps the request until the connection ends. Bun closes
  // it at the GOAWAY frame, so the session can end.
  test("close(CANCEL), then a GOAWAY frame with NO_ERROR while no slot opens", { skip: !isBun }, async () => {
    await atStreamLimit({ limit: 0 }, async ({ peer, session }) => {
      const waiting = watchRequest(session.request({ ":path": "/waiting" }));
      await peerCaughtUp(session);
      waiting.stream.close(NGHTTP2_CANCEL, () => waiting.events.push("close callback"));
      const sessionClosed = once(session, "close");
      peer.goaway(NGHTTP2_NO_ERROR, 0);
      await Promise.all([waiting.closed, sessionClosed]);
      assert.deepStrictEqual(
        { frames: peer.frames, waiting: waiting.events },
        { frames: [], waiting: ["finish", "end", "close:8", "close callback"] },
      );
    });
  });
});

// node submits a reset with NGHTTP2_CANCEL late in two cases: close(code) runs in a callback of
// the session, or the same tick first resets the request that has the slot. The HEADERS frame of
// the request that waits is then sent before its reset. Bun resets the request at close(code)
// and sends nothing for it.
describe("close(CANCEL) on a request that waits for a stream slot, where node sends the request first", () => {
  for (const [name, act] of [
    [
      "the request that has the slot is closed first in the same tick",
      ({ holders: [holder] }, waiting) => {
        holder.stream.close(NGHTTP2_CANCEL);
        waiting.close(NGHTTP2_CANCEL);
      },
    ],
    [
      "in the 'response' listener of the request that has the slot",
      ({ peer, holders: [holder] }, waiting) => {
        holder.stream.on("response", () => waiting.close(NGHTTP2_CANCEL));
        peer.answer(holder.stream.id!);
      },
    ],
  ] as [string, (at: AtLimit, waiting: http2.ClientHttp2Stream) => void][]) {
    test(name, async () => {
      await atStreamLimit({}, async at => {
        const { peer, session } = at;
        const waiting = watchRequest(session.request({ ":path": "/waiting" }));
        await peerCaughtUp(session);
        // Not in a callback of the session, where node holds every reset with NGHTTP2_CANCEL back.
        await new Promise(resolve => setImmediate(resolve));
        const sentBefore = peer.frames.length;
        act(at, waiting.stream);
        await waiting.closed;
        if (!isBun) await peer.saw("RST_STREAM 3 code=8");
        const later = watchRequest(session.request({ ":path": "/later" }));
        await later.closed;
        await peerCaughtUp(session);
        assert.deepStrictEqual(
          {
            frames: peer.frames.slice(sentBefore).filter(entry => !entry.startsWith("RST_STREAM 1 ")),
            waiting: waiting.events,
            later: later.events,
          },
          {
            frames: isBun ? headersOf(later) : ["HEADERS 3 END_STREAM", "RST_STREAM 3 code=8", ...headersOf(later)],
            waiting: ["finish", "end", "close:8"],
            later: SERVED,
          },
        );
      });
    });
  }
});

// node submits the reset of another code at once, and nothing is sent. node 24.21 and 24.22 hold
// it back like NGHTTP2_CANCEL, and send the request first.
describe("close(code) on a request that waits for a stream slot, in the 'response' listener of the request that has the slot", () => {
  for (const [code, expected] of [
    [NGHTTP2_NO_ERROR, ["finish", "end", "close:0"]],
    [NGHTTP2_INTERNAL_ERROR, ["finish", "error:ERR_HTTP2_STREAM_ERROR", "close:2"]],
  ] as [number, string[]][]) {
    test(`close(${code})`, async () => {
      await atStreamLimit({}, async ({ peer, session, holders: [holder] }) => {
        const waiting = watchRequest(session.request({ ":path": "/waiting" }));
        await peerCaughtUp(session);
        holder.stream.on("response", () => waiting.stream.close(code));
        peer.answer(holder.stream.id!);
        await Promise.all([holder.closed, waiting.closed]);
        const sent = holdsEveryResetInCallback ? ["HEADERS 3 END_STREAM", `RST_STREAM 3 code=${code}`] : [];
        if (sent.length > 0) await peer.saw(sent[1]);
        const later = watchRequest(session.request({ ":path": "/later" }));
        await later.closed;
        await peerCaughtUp(session);
        assert.deepStrictEqual(
          { frames: peer.frames, waiting: waiting.events, later: later.events },
          { frames: [...headersOf(holder), ...sent, ...headersOf(later)], waiting: expected, later: SERVED },
        );
      });
    });
  }
});

// A 'close' listener of the request that had the slot. The session releases the slot in a 'close'
// listener of its own, which it adds when it submits the request.

// The request was submitted inside request(), so the slot is free before the listener of the
// program runs: the request that waited is sent by then, and the reset follows its HEADERS frame.
test("close(CANCEL) in the 'close' listener of a request that got its slot in request() resets a request that is sent", async () => {
  // The peer does not answer the request either: only the reset of the client closes it.
  await atStreamLimit({ held: 2 }, async ({ peer, session, holders: [holder] }) => {
    const waiting = watchRequest(session.request({ ":path": "/waiting" }));
    await peerCaughtUp(session);
    holder.stream.on("close", () => waiting.stream.close(NGHTTP2_CANCEL));
    peer.answer(holder.stream.id!);
    await waiting.closed;
    const id = waiting.stream.id!;
    const reset = `RST_STREAM ${id} code=8`;
    await peer.saw(reset);
    await peerCaughtUp(session);
    assert.deepStrictEqual(
      // Bun can write the reset a second time when it destroys the request.
      {
        frames: peer.frames.slice(0, 3),
        rest: peer.frames.slice(3).filter(entry => entry !== reset),
        rstCode: waiting.stream.rstCode,
      },
      { frames: [...headersOf(holder), `HEADERS ${id} END_STREAM`, reset], rest: [], rstCode: NGHTTP2_CANCEL },
    );
  });
});

// The request itself waited for its slot, so the listener of the program runs first: the request
// behind it still waits, and close(code) resets it in the queue.
describe("close(code) in the 'close' listener of a request that waited for its slot", () => {
  for (const [code, expected] of [
    [NGHTTP2_CANCEL, ["finish", "end", "close:8"]],
    [NGHTTP2_NO_ERROR, ["finish", "end", "close:0"]],
    [NGHTTP2_INTERNAL_ERROR, ["finish", "error:ERR_HTTP2_STREAM_ERROR", "close:2"]],
  ] as [number, string[]][]) {
    test(`close(${code})`, async () => {
      await atStreamLimit({ held: 2 }, async ({ peer, session, holders: [first] }) => {
        const holder = watchRequest(session.request({ ":path": "/holder-that-waited" }));
        const waiting = watchRequest(session.request({ ":path": "/waiting" }));
        holder.stream.on("close", () => waiting.stream.close(code));
        await peerCaughtUp(session);
        peer.answer(first.stream.id!);
        await first.closed;
        await peer.saw(headersOf(holder)[0]);
        await peerCaughtUp(session);
        const sentBefore = peer.frames.length;

        peer.answer(holder.stream.id!);
        await Promise.all([holder.closed, waiting.closed]);
        // Inside the callback node holds the reset back, and sends the request first.
        const sent =
          !isBun && (code === NGHTTP2_CANCEL || holdsEveryResetInCallback)
            ? ["HEADERS 5 END_STREAM", `RST_STREAM 5 code=${code}`]
            : [];
        if (sent.length > 0) await peer.saw(sent[1]);
        const later = watchRequest(session.request({ ":path": "/later" }));
        await later.closed;
        await peerCaughtUp(session);
        assert.deepStrictEqual(
          { frames: peer.frames.slice(sentBefore), waiting: waiting.events, later: later.events },
          { frames: [...sent, ...headersOf(later)], waiting: expected, later: SERVED },
        );
      });
    });
  }
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
        await peer.saw(`RST_STREAM 1 code=${code}`);
        await peerCaughtUp(session);
        assert.deepStrictEqual(peer.frames, ["HEADERS 1 END_STREAM", `RST_STREAM 1 code=${code}`]);
      } finally {
        session.destroy();
        peer.close();
      }
    });
  }

  // The socket is connected and holds the SETTINGS frame of the peer before the session exists.
  // The request is made before the session handles the connect, and a slot is free for it.
  for (const code of [NGHTTP2_NO_ERROR, NGHTTP2_CANCEL]) {
    test(`close(${code}) in the tick of connect() on a connected socket sends HEADERS, then RST_STREAM`, async () => {
      const peer = await framePeer({ eagerSettings: true });
      const socket = net.connect(peer.port, "127.0.0.1");
      try {
        await once(socket, "connect");
        while (socket.readableLength === 0) await new Promise(resolve => setImmediate(resolve));
        const session = peer.connect({ createConnection: () => socket });
        session.on("error", () => {});
        const request = watchRequest(session.request({ ":path": "/" }));
        request.stream.close(code);
        await request.closed;
        const reset = `RST_STREAM 1 code=${code}`;
        await peer.saw(reset);
        await peerCaughtUp(session);
        assert.deepStrictEqual(
          // Bun can write the reset a second time when it destroys the request.
          { frames: peer.frames.slice(0, 2), rest: peer.frames.slice(2).filter(entry => entry !== reset) },
          { frames: ["HEADERS 1 END_STREAM", reset], rest: [] },
        );
        session.destroy();
      } finally {
        socket.destroy();
        peer.close();
      }
    });
  }

  // Both requests are made before the connect. The session sends the first one, and a subscriber
  // closes the second one at that moment: it is sent too, and its reset follows.
  channelTest("close(CANCEL) while the session sends the requests that waited for the connect", async () => {
    // The peer answers neither request: only the reset of the client closes the second one.
    const peer = await framePeer({ limit: 10, held: 2 });
    const session = peer.connect();
    session.on("error", () => {});
    const first = watchRequest(session.request({ ":path": "/first" }));
    const second = watchRequest(session.request({ ":path": "/second" }));
    const onStart = (message: unknown) => {
      if ((message as { stream: http2.ClientHttp2Stream }).stream === first.stream) second.stream.close(NGHTTP2_CANCEL);
    };
    diagnosticsChannel.subscribe("http2.client.stream.start", onStart);
    try {
      await second.closed;
      await peer.saw("RST_STREAM 3 code=8");
      await peerCaughtUp(session);
      assert.deepStrictEqual(peer.frames, ["HEADERS 1 END_STREAM", "HEADERS 3 END_STREAM", "RST_STREAM 3 code=8"]);
    } finally {
      diagnosticsChannel.unsubscribe("http2.client.stream.start", onStart);
      session.destroy();
      peer.close();
    }
  });

  // The request is not in the session's streams yet: session.destroy() cancels it, as before.
  for (const [code, error] of [
    [NGHTTP2_CANCEL, undefined],
    [NGHTTP2_INTERNAL_ERROR, new Error("session error")],
  ] as [number, Error | undefined][]) {
    test(`close(${code}), then session.destroy(${error ? "error" : ""})`, async () => {
      const peer = await framePeer();
      const session = peer.connect();
      session.on("error", () => {});
      try {
        const request = watchRequest(session.request({ ":path": "/" }));
        request.stream.close(code);
        session.destroy(error);
        await request.closed;
        assert.deepStrictEqual(request.events, ["error:ERR_HTTP2_STREAM_CANCEL", `close:${code}`]);
      } finally {
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
