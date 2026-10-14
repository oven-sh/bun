/**
 * Http2Stream.close(code) event contract, client and server, while the peer's half is still open:
 *   NO_ERROR / CANCEL  -> 'end', 'close'             (documented 'error' exemption)
 *   any other code     -> 'error', 'close'           (no 'end': the body was killed by RST_STREAM)
 * Once the peer's half has ended (END_STREAM on a HEADERS frame, or a server push, which has no
 * inbound half) the readable already has its EOF, so 'end' comes first for every code.
 *
 * A client request that waits for a stream slot (the peer's SETTINGS_MAX_CONCURRENT_STREAMS) and is
 * reset with close(code) before a slot frees is never sent. The last sections cover it.
 *
 * The node values in this file are those of node 24 to 26.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-client-close.test.ts
 *   node --test test/js/node/http2/node-http2-client-close.test.ts
 */
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import diagnosticsChannel from "node:diagnostics_channel";
import http2 from "node:http2";
import net from "node:net";
import path from "node:path";
import { PerformanceObserver } from "node:perf_hooks";
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
        // When the PING is back, the server has read what the client sent of the request. node
        // v26.3.0 writes to a freed stream when a server closes before it has read a request.
        client.ping(() => {
          client.close();
          resolve(events);
        });
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

// A request that waits for a stream slot: the peer allows one stream, and the first request
// ("/hold") has it. node gives such a request its id at once and keeps its HEADERS frame back. A
// close(code) that reaches nghttp2 before a slot frees drops the frame: nothing of the request
// reaches the peer. The request closes when a slot is free for it. It is not `pending` in node, so
// its events follow "before response" above, not "while pending".

const isBun = typeof Bun !== "undefined";
// node v26.10 and newer settle the write in flight inside _destroy, with the error of the destroy
// (nodejs/node#66016). Older releases, and Bun, fail it with ECANCELED one turn after 'close'.
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
const writeSettlesInDestroy = !isBun && (nodeMajor > 26 || (nodeMajor === 26 && nodeMinor >= 10));
// node 26 never destroys a request that is reset with a body write in flight and NGHTTP2_NO_ERROR.
// node 27 does (nodejs/node#63249), and Bun does.
const destroysAfterDroppedWrite = isBun || nodeMajor >= 27;
// An older node does not publish every http2.client.stream.* channel, and a macOS CI host can have one.
const channelTest = isBun || nodeMajor >= 26 ? test : test.skip;

// The child of the "listener that throws" test. A debug build of Bun needs seconds to load
// node:http2, so it starts here and the tests before that one run meanwhile. This file also runs
// under node: the child is process.execPath, not bunExe() of "harness".
const listenerThrows = new Promise<{ stdout: string; stderr: string; exit: unknown }>(resolve => {
  const fixture = path.join(import.meta.dirname, "node-http2-client-close-listener-throws.fixture.js");
  execFile(process.execPath, [fixture], { env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" } }, (err, stdout, stderr) =>
    resolve({ stdout: stdout.trim(), stderr: err ? stderr : "", exit: err ? (err.code ?? err.signal) : 0 }),
  );
});

// Raw h2c peer that advertises SETTINGS_MAX_CONCURRENT_STREAMS=1 and ACKs SETTINGS and PING. It
// does not answer the first stream until release(). It answers each other stream with 200 and
// END_STREAM once the request is complete, and records the frames of those streams. With
// `answerSecond: false` the second stream gets no answer: only the client can end it.
function limitedH2Peer({ answerSecond = true } = {}) {
  const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
  const NAMES = ["DATA", "HEADERS", "PRIORITY", "RST_STREAM"];
  const frame = (type: number, flags: number, id: number, payload = Buffer.alloc(0)) => {
    const head = Buffer.alloc(9);
    head.writeUIntBE(payload.length, 0, 3);
    head[3] = type;
    head[4] = flags;
    head.writeUInt32BE(id, 5);
    return Buffer.concat([head, payload]);
  };
  const uint32 = (...values: number[]) => {
    const payload = Buffer.alloc(4 * values.length);
    values.forEach((value, i) => payload.writeUInt32BE(value, 4 * i));
    return payload;
  };
  const maxConcurrentStreams = (limit: number) => {
    const payload = Buffer.alloc(6);
    payload.writeUInt16BE(3, 0);
    payload.writeUInt32BE(limit, 2);
    return frame(4, 0, 0, payload);
  };
  // :status 200 is index 8 of the HPACK static table. Flag 0x4 is END_HEADERS, 0x1 is END_STREAM.
  const ok = (id: number) => frame(1, 0x5, id, Buffer.from([0x88]));
  const okWithBody = (id: number) =>
    Buffer.concat([frame(1, 0x4, id, Buffer.from([0x88])), frame(0, 0x1, id, Buffer.from("body"))]);
  // Frames of every stream but the first, in arrival order, for example "HEADERS" or "RST_STREAM:8".
  const frames: string[] = [];
  const { promise: held, resolve: gotFirstStream } = Promise.withResolvers<void>();
  const { promise: ended, resolve: sawEnd } = Promise.withResolvers<void>();
  let first = 0;
  let second = 0;
  let socket: net.Socket | undefined;
  let wake = () => {};
  const server = net.createServer(s => {
    s.setNoDelay(true);
    socket = s;
    let buf = Buffer.alloc(0);
    let preface = false;
    s.on("error", () => {});
    s.on("close", sawEnd);
    s.write(maxConcurrentStreams(1));
    s.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (!preface) {
        if (buf.length < PREFACE.length) return;
        preface = true;
        buf = buf.subarray(PREFACE.length);
      }
      while (buf.length >= 9) {
        const len = buf.readUIntBE(0, 3);
        if (buf.length < 9 + len) break;
        const type = buf[3];
        const flags = buf[4];
        const id = buf.readUInt32BE(5) & 0x7fffffff;
        const payload = buf.subarray(9, 9 + len);
        buf = buf.subarray(9 + len);
        if (type === 4 && !(flags & 1)) s.write(frame(4, 1, 0));
        else if (type === 6 && !(flags & 1)) s.write(frame(6, 1, 0, payload));
        if (id === 0 || type > 3) continue;
        if (first === 0) {
          first = id;
          gotFirstStream();
        }
        if (id === first) continue;
        if (second === 0) second = id;
        frames.push(type === 3 ? `RST_STREAM:${payload.readUInt32BE(0)}` : NAMES[type]);
        if (type < 2 && flags & 1 && (answerSecond || id !== second)) s.write(ok(id));
      }
      wake();
    });
  });
  return {
    server,
    frames,
    // Resolves when the HEADERS of the first stream are here.
    held,
    // Resolves when the client has closed the connection: all that it sent is in `frames`.
    ended,
    // Resolves when `frame` is in `frames`.
    async saw(frame: string) {
      while (!frames.includes(frame)) await new Promise<void>(resolve => (wake = resolve));
    },
    // Frees the slot: the first stream gets its answer.
    release: () => socket!.write(ok(first)),
    releaseWithBody: () => socket!.write(okWithBody(first)),
    setLimit: (limit: number) => socket!.write(maxConcurrentStreams(limit)),
    // GOAWAY: the first stream is the last one that the peer takes.
    goaway: (code: number) => socket!.write(frame(7, 0, 0, uint32(first, code))),
    // The peer drops the connection.
    drop: () => socket!.destroy(),
    close() {
      socket?.destroy();
      server.close();
    },
  };
}

// `step` waits for a promise and fails when `reject` runs first: the 'error' listener of what
// must not fail.
function failable() {
  const { promise: failed, reject } = Promise.withResolvers<never>();
  failed.catch(() => {});
  return { reject, step: <T>(promise: Promise<T>) => Promise.race([failed, promise]) };
}

// A session whose only stream slot is taken by "/hold".
async function sessionWithSlotTaken(options?: Parameters<typeof limitedH2Peer>[0]) {
  const peer = limitedH2Peer(options);
  const port = await listen(peer.server);
  const client = http2.connect(`http://127.0.0.1:${port}`);
  const { reject, step } = failable();
  client.on("error", reject);
  try {
    await step(new Promise(resolve => client.once("remoteSettings", resolve)));
    const hold = client.request({ ":path": "/hold" });
    hold.on("error", reject).resume();
    await step(peer.held);
    return { peer, client, hold, step, reject };
  } catch (e) {
    client.destroy();
    peer.close();
    throw e;
  }
}

// Resolves when a PING is back. All that the client did before the call has run by then, and
// all that the peer sent before its PING ACK is read.
function roundTrip(client: http2.ClientHttp2Session) {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  client.ping(err => (err ? reject(err) : resolve()));
  return promise;
}
const immediate = () => new Promise<void>(resolve => setImmediate(resolve));

// Records the events of a request in the order they fire. `sessionError` is recorded as
// "error:session". With `errorListener: false` an 'error' event of the request is uncaught.
function record(
  req: http2.ClientHttp2Stream,
  { sessionError = undefined as Error | undefined, errorListener = true } = {},
) {
  const events: string[] = [];
  for (const name of ["aborted", "finish", "end"]) req.on(name, () => events.push(name));
  if (errorListener) {
    req.on("error", e => events.push("error:" + (e === sessionError ? "session" : (e as NodeJS.ErrnoException).code)));
  }
  req.on("close", () => events.push("close:" + req.rstCode));
  const closed = new Promise<void>(resolve => req.on("close", () => resolve()));
  return { events, closed };
}

// A callback for write() or end() that records "ok" or the code of its error.
const callback = (events: string[], of: "write" | "end") => (err?: Error | null) =>
  events.push(`${of} callback:${err ? (err as NodeJS.ErrnoException).code : "ok"}`);

// The request after the one under test waits behind it, so its answer shows that the queue went on.
function lastRequest(client: http2.ClientHttp2Session, reject: (e: Error) => void) {
  const last = client.request({ ":path": "/last" });
  last.on("error", reject).resume();
  return new Promise<void>(resolve => last.on("close", () => resolve()));
}

type SlotWaiterReset = {
  name: string;
  method: "GET" | "POST";
  reset: (req: http2.ClientHttp2Stream, events: string[]) => void;
  // What the request emits while "/hold" still has the slot...
  waiting: string[];
  // ...and once the queue reaches the request with a free slot.
  freed: string[];
  // False when the request never closes.
  closes?: boolean;
};
const slotWaiterResets: SlotWaiterReset[] = [
  { name: "close()", method: "GET", reset: req => req.close(), waiting: ["finish"], freed: ["end", "close:0"] },
  {
    name: "close(CANCEL)",
    method: "GET",
    reset: req => req.close(NGHTTP2_CANCEL),
    waiting: ["finish"],
    freed: ["end", "close:8"],
  },
  {
    name: "close(INTERNAL_ERROR)",
    method: "GET",
    reset: req => req.close(NGHTTP2_INTERNAL_ERROR),
    waiting: ["finish"],
    freed: ["error:ERR_HTTP2_STREAM_ERROR", "close:2"],
  },
  {
    name: "close(CANCEL, callback)",
    method: "GET",
    reset: (req, events) => req.close(NGHTTP2_CANCEL, () => events.push("close callback")),
    waiting: ["finish"],
    freed: ["end", "close:8", "close callback"],
  },
  {
    name: "open POST, close()",
    method: "POST",
    reset: req => req.close(),
    waiting: ["aborted", "finish"],
    freed: ["end", "close:0"],
  },
  {
    name: "open POST, close(CANCEL)",
    method: "POST",
    reset: req => req.close(NGHTTP2_CANCEL),
    waiting: ["aborted", "finish"],
    freed: ["end", "close:8"],
  },
  {
    name: "open POST, close(INTERNAL_ERROR)",
    method: "POST",
    reset: req => req.close(NGHTTP2_INTERNAL_ERROR),
    waiting: ["aborted", "finish"],
    freed: ["error:ERR_HTTP2_STREAM_ERROR", "close:2"],
  },
  {
    name: "POST, end(), close()",
    method: "POST",
    reset: req => {
      req.end();
      req.close();
    },
    waiting: ["finish"],
    freed: ["end", "close:0"],
  },
  // A body that was written is never sent. Its callback runs when the request closes.
  {
    name: "POST, write(body), close(CANCEL)",
    method: "POST",
    reset: (req, events) => {
      req.write("body", callback(events, "write"));
      req.close(NGHTTP2_CANCEL);
    },
    waiting: ["aborted"],
    freed: writeSettlesInDestroy
      ? ["write callback:ok", "end", "close:8"]
      : ["end", "close:8", "write callback:ECANCELED"],
  },
  {
    name: "POST, write(body), close(INTERNAL_ERROR)",
    method: "POST",
    reset: (req, events) => {
      req.write("body", callback(events, "write"));
      req.close(NGHTTP2_INTERNAL_ERROR);
    },
    waiting: ["aborted"],
    freed: writeSettlesInDestroy
      ? ["write callback:ERR_HTTP2_STREAM_ERROR", "error:ERR_HTTP2_STREAM_ERROR", "close:2"]
      : ["error:ERR_HTTP2_STREAM_ERROR", "close:2", "write callback:ECANCELED"],
  },
  {
    name: "POST, end(body), close(CANCEL)",
    method: "POST",
    reset: (req, events) => {
      req.end("body", callback(events, "end"));
      req.close(NGHTTP2_CANCEL);
    },
    waiting: [],
    freed: writeSettlesInDestroy
      ? ["end callback:ERR_STREAM_DESTROYED", "end", "close:8"]
      : ["end", "close:8", "end callback:ECANCELED"],
  },
  {
    name: "POST, end(body), close(INTERNAL_ERROR)",
    method: "POST",
    reset: (req, events) => {
      req.end("body", callback(events, "end"));
      req.close(NGHTTP2_INTERNAL_ERROR);
    },
    waiting: [],
    // The callback of end() gets the error the stream closed with.
    freed: writeSettlesInDestroy
      ? ["end callback:ERR_HTTP2_STREAM_ERROR", "error:ERR_HTTP2_STREAM_ERROR", "close:2"]
      : ["error:ERR_HTTP2_STREAM_ERROR", "close:2", "end callback:ERR_HTTP2_STREAM_ERROR"],
  },
  // Bun corks a request for the tick of request(), so both writes are one batch in flight. In
  // node the second write waits behind the first.
  {
    name: "POST, write(a), write(b), close(CANCEL)",
    method: "POST",
    reset: (req, events) => {
      req.write("a", callback(events, "write"));
      req.write("b", callback(events, "write"));
      req.close(NGHTTP2_CANCEL);
    },
    waiting: ["aborted"],
    freed: writeSettlesInDestroy
      ? ["write callback:ok", "write callback:ERR_STREAM_DESTROYED", "end", "close:8"]
      : ["end", "close:8", "write callback:ECANCELED", "write callback:ECANCELED"],
  },
  // A write after close() is an error of the request, and an errored readable never ends.
  {
    name: "close(), write(body)",
    method: "GET",
    reset: req => {
      req.close();
      req.write("body");
    },
    waiting: ["finish", "error:ERR_STREAM_WRITE_AFTER_END"],
    freed: ["close:0"],
  },
  // The writable was open, so the reset is submitted at once and drops the request.
  {
    name: "POST, write(body), close()",
    method: "POST",
    reset: (req, events) => {
      req.write("body", callback(events, "write"));
      req.close();
    },
    waiting: ["aborted"],
    freed: isBun
      ? ["end", "close:0", "write callback:ECANCELED"]
      : destroysAfterDroppedWrite
        ? ["write callback:ok", "end", "close:0"]
        : ["end"],
    closes: destroysAfterDroppedWrite,
  },
];

async function resetSlotWaiter(variant: SlotWaiterReset) {
  const { peer, client, step, reject } = await sessionWithSlotTaken();
  try {
    const req = client.request({ ":path": "/waiting", ":method": variant.method });
    const { events, closed } = record(req);
    req.resume();
    variant.reset(req, events);

    // "/hold" still has the only slot. What the request emitted by now did not come from a free slot.
    await step(roundTrip(client));
    const waiting = { events: [...events], destroyed: req.destroyed };

    peer.release();
    await step(Promise.all([variant.closes === false ? undefined : closed, lastRequest(client, reject)]));
    await step(immediate());
    // A write that waited for 'ready' holds its chunk through its listener.
    const readyListeners = req.listenerCount("ready");
    return { waiting, frames: [...peer.frames], events: [...events], destroyed: req.destroyed, readyListeners };
  } finally {
    client.destroy();
    peer.close();
  }
}

describe("close(code) on a request that waits for a stream slot", () => {
  for (const variant of slotWaiterResets) {
    test(variant.name, async () => {
      assert.deepStrictEqual(await resetSlotWaiter(variant), {
        waiting: { events: variant.waiting, destroyed: false },
        // Only "/last" reached the peer.
        frames: ["HEADERS"],
        events: [...variant.waiting, ...variant.freed],
        destroyed: variant.closes !== false,
        readyListeners: 0,
      });
    });
  }
});

// node holds the reset back while the ended writable still has a body write to flush, even an
// empty one. That request is sent when a slot frees, and the reset follows it. The peer does not
// answer the request, so only the reset ends it. These bodies fit in the peer's window: Bun sends
// the reset after the first flush, so it cuts a larger body, and node sends all of it.
describe("close() on a request that waits for a stream slot with a body write to flush", () => {
  for (const [name, send, sent] of [
    ["end(body), close()", (req, events) => req.end("body", callback(events, "end")), ["end callback:ok"]],
    [
      "write(''), end(), close()",
      (req, events) => {
        req.write("", callback(events, "write"));
        req.end();
      },
      ["write callback:ok"],
    ],
    [
      "write(a), write(b), end(), close()",
      (req, events) => {
        req.write("a", callback(events, "write"));
        req.write("b", callback(events, "write"));
        req.end();
      },
      ["write callback:ok", "write callback:ok"],
    ],
  ] as [string, (req: http2.ClientHttp2Stream, events: string[]) => void, string[]][]) {
    test(name, async () => {
      const { peer, client, step, reject } = await sessionWithSlotTaken({ answerSecond: false });
      try {
        const req = client.request({ ":path": "/waiting", ":method": "POST" });
        const { events, closed } = record(req);
        req.on("error", reject);
        send(req, events);
        req.close();
        await step(roundTrip(client));
        const waiting = [...events];
        peer.release();
        await step(Promise.all([closed, lastRequest(client, reject)]));
        assert.deepStrictEqual(
          // node sends one DATA frame for each write, and Bun one for the batch.
          { waiting, frames: peer.frames.filter((f, i, all) => f !== "DATA" || all[i - 1] !== "DATA"), events },
          {
            waiting: [],
            frames: ["HEADERS", "DATA", "RST_STREAM:0", "HEADERS"],
            events: [...sent, "finish", "end", "close:0"],
          },
        );
      } finally {
        client.destroy();
        peer.close();
      }
    });
  }
});

// A request that was reset in the queue takes no slot and no stream id: the queue goes on to the
// requests behind it.
describe("the queue behind a request that was reset while it waited for a stream slot", () => {
  for (const kinds of [
    ["live", "reset", "live"],
    ["reset", "reset", "reset", "live"],
  ] as const) {
    test(kinds.join(", "), async () => {
      const { peer, client, step, reject } = await sessionWithSlotTaken();
      try {
        const requests = kinds.map(kind => {
          const req = client.request({ ":path": `/${kind}` });
          const { events, closed } = record(req);
          req.on("response", () => events.push("response"));
          req.on("error", reject).resume();
          if (kind === "reset") req.close(NGHTTP2_CANCEL);
          return { events, closed };
        });
        await step(roundTrip(client));
        peer.setLimit(10);
        await step(Promise.all(requests.map(request => request.closed)));
        assert.deepStrictEqual(
          { frames: peer.frames, events: requests.map(request => request.events.join(", ")) },
          {
            frames: kinds.filter(kind => kind === "live").map(() => "HEADERS"),
            events: kinds.map(kind => (kind === "live" ? "finish, response, end, close:0" : "finish, end, close:8")),
          },
        );
      } finally {
        client.destroy();
        peer.close();
      }
    });
  }

  // The request ahead of the reset one gets the slot, and the peer does not answer it.
  test("a reset request does not close while the request ahead of it has the slot", async () => {
    const { peer, client, step, reject } = await sessionWithSlotTaken({ answerSecond: false });
    try {
      const live = client.request({ ":path": "/live" });
      live.on("error", reject).resume();
      const req = client.request({ ":path": "/reset" });
      const { events, closed } = record(req);
      req.close(NGHTTP2_CANCEL);
      peer.release();
      await step(peer.saw("HEADERS"));
      await step(roundTrip(client));
      await step(immediate());
      const behindLive = { events: [...events], destroyed: req.destroyed };
      // A SETTINGS frame with the same limit runs the queue again, and there is still no slot.
      const settings = new Promise(resolve => client.once("remoteSettings", resolve));
      peer.setLimit(1);
      await step(settings);
      await step(immediate());
      const afterSettings = { events: [...events], destroyed: req.destroyed };
      live.close(NGHTTP2_CANCEL);
      await step(closed);
      assert.deepStrictEqual(
        { behindLive, afterSettings, headers: peer.frames.filter(f => f === "HEADERS"), events },
        {
          behindLive: { events: ["finish"], destroyed: false },
          afterSettings: { events: ["finish"], destroyed: false },
          headers: ["HEADERS"],
          events: ["finish", "close:8"],
        },
      );
    } finally {
      client.destroy();
      peer.close();
    }
  });

  // The program's code for the reset request runs after the request behind it is submitted. In
  // node that request has its id from the start.
  for (const [name, listen] of [
    [
      "a 'readable' listener",
      (req, seen) => {
        req.on("readable", seen);
        req.close();
      },
    ],
    [
      "a write() callback",
      (req, seen) => {
        req.write("body", seen);
        req.close(NGHTTP2_CANCEL);
      },
    ],
  ] as [string, (req: http2.ClientHttp2Stream, seen: () => void) => void][]) {
    test(`${name} of the reset request runs after the next request is submitted`, async () => {
      const { peer, client, step, reject } = await sessionWithSlotTaken();
      try {
        const req = client.request({ ":path": "/waiting", ":method": "POST" });
        const pending: boolean[] = [];
        const closed = new Promise<void>(resolve => req.on("close", () => resolve()));
        req.on("error", reject);
        const behind = client.request({ ":path": "/behind" });
        behind.on("error", reject).resume();
        listen(req, () => pending.push(behind.pending));
        await step(roundTrip(client));
        peer.release();
        await step(Promise.all([closed, new Promise(resolve => behind.on("close", resolve))]));
        assert.deepStrictEqual({ frames: peer.frames, pending }, { frames: ["HEADERS"], pending: [false] });
      } finally {
        client.destroy();
        peer.close();
      }
    });
  }
});

channelTest("a http2.client.stream.created subscriber resets a request that waits for a stream slot", async () => {
  const { peer, client, step, reject } = await sessionWithSlotTaken();
  const onCreated = (message: unknown) => {
    const { stream, headers } = message as { stream: http2.ClientHttp2Stream; headers: http2.OutgoingHttpHeaders };
    if (headers[":path"] === "/created") stream.close(NGHTTP2_CANCEL);
  };
  diagnosticsChannel.subscribe("http2.client.stream.created", onCreated);
  try {
    const req = client.request({ ":path": "/created" });
    const { events, closed } = record(req);
    await step(roundTrip(client));
    const waiting = [...events];
    peer.release();
    await step(Promise.all([closed, lastRequest(client, reject)]));
    assert.deepStrictEqual(
      { waiting, frames: peer.frames, events },
      { waiting: ["finish"], frames: ["HEADERS"], events: ["finish", "close:8"] },
    );
  } finally {
    diagnosticsChannel.unsubscribe("http2.client.stream.created", onCreated);
    client.destroy();
    peer.close();
  }
});

// node holds a reset with NGHTTP2_CANCEL back while a callback of the session runs, and sends the
// queued frames first. In a listener that runs while the slot frees, those frames include the
// HEADERS frame of the request that waits. Bun drops the request when close(code) finds it in the
// queue. It is not in the queue when the slot was released before the listener ran.
describe("close(CANCEL) on a request that waits for a stream slot, in a listener that runs while the slot frees", () => {
  test("'end' of the request that has the slot", async () => {
    const { peer, client, hold, step, reject } = await sessionWithSlotTaken();
    try {
      const waiter = client.request({ ":path": "/waiting" });
      const { events, closed } = record(waiter);
      hold.on("end", () => waiter.close(NGHTTP2_CANCEL));
      peer.release();
      await step(Promise.all([closed, lastRequest(client, reject)]));
      await step(immediate());
      await step(roundTrip(client));
      assert.deepStrictEqual(
        { frames: peer.frames, events },
        { frames: isBun ? ["HEADERS"] : ["HEADERS", "RST_STREAM:8", "HEADERS"], events: ["finish", "close:8"] },
      );
    } finally {
      client.destroy();
      peer.close();
    }
  });

  // Bun releases the slot in a 'close' listener that request() adds, ahead of the program's.
  test("'close' of the request that had the slot", async () => {
    const { peer, client, hold, step } = await sessionWithSlotTaken();
    try {
      const waiter = client.request({ ":path": "/waiting" });
      const { events, closed } = record(waiter);
      hold.on("close", () => waiter.close(NGHTTP2_CANCEL));
      peer.release();
      await step(closed);
      await step(immediate());
      await step(roundTrip(client));
      assert.deepStrictEqual(
        // Bun can reset the stream a second time when it destroys it.
        { frames: peer.frames.slice(0, 2), rest: peer.frames.slice(2).filter(f => f !== "RST_STREAM:8"), events },
        { frames: ["HEADERS", "RST_STREAM:8"], rest: [], events: ["finish", "close:8"] },
      );
    } finally {
      client.destroy();
      peer.close();
    }
  });

  // A request that waited gets that listener when it is sent, behind the listeners of the program.
  test("'close' of a request that waited for its slot", async () => {
    const { peer, client, step, reject } = await sessionWithSlotTaken();
    try {
      const second = client.request({ ":path": "/second" });
      second.on("error", reject).resume();
      const third = client.request({ ":path": "/third" });
      const { events, closed } = record(third);
      second.on("close", () => third.close(NGHTTP2_CANCEL));
      peer.release();
      await step(closed);
      await step(immediate());
      await step(roundTrip(client));
      assert.deepStrictEqual(
        { frames: peer.frames, events },
        { frames: isBun ? ["HEADERS"] : ["HEADERS", "HEADERS", "RST_STREAM:8"], events: ["finish", "close:8"] },
      );
    } finally {
      client.destroy();
      peer.close();
    }
  });

  test("'remoteSettings' of the session, after the peer raised the limit", async () => {
    const { peer, client, step } = await sessionWithSlotTaken();
    try {
      const waiter = client.request({ ":path": "/waiting" });
      const { events, closed } = record(waiter);
      client.once("remoteSettings", () => waiter.close(NGHTTP2_CANCEL));
      peer.setLimit(3);
      await step(closed);
      await step(immediate());
      await step(roundTrip(client));
      assert.deepStrictEqual(
        { frames: peer.frames, events },
        { frames: isBun ? [] : ["HEADERS", "RST_STREAM:8"], events: ["finish", "close:8"] },
      );
    } finally {
      client.destroy();
      peer.close();
    }
  });
});

// node sends the session's queued frames before it submits a reset, and it waits for 'finish'
// before it resets an ended request with NGHTTP2_NO_ERROR. When the same tick also resets the
// request that has the slot, or the slot frees in a listener of that request, node's reset can
// come after the HEADERS frame of the request that waits. Bun marks the request at close(code),
// so it is dropped in each of these cases.
describe("close(code) on a request that waits for a stream slot, in the tick that frees the slot", () => {
  type Row = {
    name: string;
    act: (hold: http2.ClientHttp2Stream, waiter: http2.ClientHttp2Stream, events: string[]) => void;
    node: { frames: string[]; events: string[] };
    bun: { frames: string[]; events: string[] };
  };
  const rows: Row[] = [
    {
      name: "hold.close(CANCEL), then close(CANCEL)",
      act: (hold, waiter) => {
        hold.close(NGHTTP2_CANCEL);
        waiter.close(NGHTTP2_CANCEL);
      },
      node: { frames: ["HEADERS", "DATA", "RST_STREAM:8"], events: ["aborted", "finish", "end", "close:8"] },
      bun: { frames: [], events: ["aborted", "finish", "end", "close:8"] },
    },
    {
      name: "hold.close(CANCEL), then write(body), close(CANCEL)",
      act: (hold, waiter, events) => {
        hold.close(NGHTTP2_CANCEL);
        waiter.write("body", callback(events, "write"));
        waiter.close(NGHTTP2_CANCEL);
      },
      node: {
        frames: ["HEADERS", "DATA", "RST_STREAM:8"],
        events: ["aborted", "write callback:ok", "finish", "end", "close:8"],
      },
      bun: { frames: [], events: ["aborted", "end", "close:8", "write callback:ECANCELED"] },
    },
    {
      name: "end(), close(), then hold.close(CANCEL)",
      act: (hold, waiter) => {
        waiter.end();
        waiter.close();
        hold.close(NGHTTP2_CANCEL);
      },
      node: { frames: ["HEADERS", "DATA", "RST_STREAM:0"], events: ["finish", "end", "close:0"] },
      bun: { frames: [], events: ["finish", "end", "close:0"] },
    },
    {
      name: "close(CANCEL), then hold.close(CANCEL)",
      act: (hold, waiter) => {
        waiter.close(NGHTTP2_CANCEL);
        hold.close(NGHTTP2_CANCEL);
      },
      node: { frames: [], events: ["aborted", "finish", "end", "close:8"] },
      bun: { frames: [], events: ["aborted", "finish", "end", "close:8"] },
    },
  ];
  for (const row of rows) {
    test(row.name, async () => {
      const { peer, client, hold, step, reject } = await sessionWithSlotTaken();
      try {
        hold.off("error", reject).on("error", () => {});
        const waiter = client.request({ ":path": "/waiting", ":method": "POST" });
        const { events, closed } = record(waiter);
        waiter.on("error", reject).resume();
        // Not in a callback of the session: node defers a reset that is submitted inside one.
        await step(immediate());
        row.act(hold, waiter, events);
        await step(Promise.all([closed, lastRequest(client, reject)]));
        await step(immediate());
        await step(roundTrip(client));
        const expected = isBun ? row.bun : row.node;
        assert.deepStrictEqual(
          // The last frame is the HEADERS of "/last".
          { frames: peer.frames.slice(0, -1), last: peer.frames.at(-1), events },
          { frames: expected.frames, last: "HEADERS", events: expected.events },
        );
      } finally {
        client.destroy();
        peer.close();
      }
    });
  }
});

// The session ends while the reset request still waits. node has an open stream for it: the
// request keeps the code of close(code) and gets the error of the session. In node that error is
// uncaught when the request has no 'error' listener. Bun gives the error only to a request that
// has a listener, as it does for an open stream: the last two rows are for Bun only.
describe("close(code) on a request that waits for a stream slot, then the session ends", () => {
  const sessionError = new Error("session failed");
  type End = "destroy()" | "destroy(err)" | "GOAWAY(INTERNAL_ERROR)" | "the peer drops the connection";
  for (const [code, how, errorListener, expected] of [
    [NGHTTP2_NO_ERROR, "destroy()", true, ["finish", "close:0"]],
    [NGHTTP2_CANCEL, "destroy()", true, ["finish", "close:8"]],
    [NGHTTP2_CANCEL, "destroy()", false, ["finish", "close:8"]],
    [NGHTTP2_INTERNAL_ERROR, "destroy()", true, ["finish", "error:ERR_HTTP2_STREAM_ERROR", "close:2"]],
    [NGHTTP2_NO_ERROR, "destroy(err)", true, ["finish", "error:session", "close:0"]],
    [NGHTTP2_CANCEL, "destroy(err)", true, ["finish", "error:session", "close:8"]],
    [NGHTTP2_INTERNAL_ERROR, "destroy(err)", true, ["finish", "error:session", "close:2"]],
    [NGHTTP2_NO_ERROR, "GOAWAY(INTERNAL_ERROR)", true, ["finish", "error:ERR_HTTP2_SESSION_ERROR", "close:0"]],
    [NGHTTP2_CANCEL, "GOAWAY(INTERNAL_ERROR)", true, ["finish", "error:ERR_HTTP2_SESSION_ERROR", "close:8"]],
    [NGHTTP2_CANCEL, "the peer drops the connection", true, ["finish", "close:8"]],
    [NGHTTP2_CANCEL, "the peer drops the connection", false, ["finish", "close:8"]],
    [NGHTTP2_CANCEL, "destroy(err)", false, ["finish", "close:8"]],
    [NGHTTP2_CANCEL, "GOAWAY(INTERNAL_ERROR)", false, ["finish", "close:8"]],
  ] as [number, End, boolean, string[]][]) {
    const uncaughtInNode = !errorListener && (how === "destroy(err)" || how === "GOAWAY(INTERNAL_ERROR)");
    const run = uncaughtInNode && !isBun ? test.skip : test;
    run(`close(${code}), ${how}${errorListener ? "" : ", no 'error' listener"}`, async () => {
      const { peer, client, hold, step, reject } = await sessionWithSlotTaken();
      try {
        client.off("error", reject).on("error", () => {});
        hold.off("error", reject).on("error", () => {});
        const req = client.request({ ":path": "/waiting" });
        const { events, closed } = record(req, { sessionError, errorListener });
        req.close(code);
        await step(roundTrip(client));
        if (how === "destroy()") client.destroy();
        else if (how === "destroy(err)") client.destroy(sessionError);
        else if (how === "GOAWAY(INTERNAL_ERROR)") peer.goaway(NGHTTP2_INTERNAL_ERROR);
        else peer.drop();
        await step(closed);
        await step(peer.ended);
        assert.deepStrictEqual(
          { frames: peer.frames, events, readyListeners: req.listenerCount("ready") },
          { frames: [], events: expected, readyListeners: 0 },
        );
      } finally {
        client.destroy();
        peer.close();
      }
    });
  }

  // A GOAWAY with NO_ERROR lets the open stream finish. node closes the reset request when the
  // slot frees. Bun closes it at the GOAWAY: the session takes no request after that.
  for (const [code, freed] of [
    [NGHTTP2_NO_ERROR, ["end", "close:0"]],
    [NGHTTP2_CANCEL, ["close:8"]],
    [NGHTTP2_INTERNAL_ERROR, ["error:ERR_HTTP2_STREAM_ERROR", "close:2"]],
  ] as [number, string[]][]) {
    test(`close(${code}), GOAWAY(NO_ERROR), then the request that has the slot ends`, async () => {
      const { peer, client, step } = await sessionWithSlotTaken();
      try {
        const req = client.request({ ":path": "/waiting" });
        const { events, closed } = record(req);
        req.close(code);
        const goaway = new Promise(resolve => client.once("goaway", resolve));
        peer.goaway(NGHTTP2_NO_ERROR);
        await step(goaway);
        await step(immediate());
        const held = { events: [...events], destroyed: req.destroyed };
        peer.release();
        await step(closed);
        await step(peer.ended);
        const closedAtGoaway = { events: ["finish", ...freed], destroyed: true };
        assert.deepStrictEqual(
          { held, frames: peer.frames, events },
          {
            held: isBun ? closedAtGoaway : { events: ["finish"], destroyed: false },
            frames: [],
            events: ["finish", ...freed],
          },
        );
      } finally {
        client.destroy();
        peer.close();
      }
    });
  }

  // No stream is open and no slot can free, so only the GOAWAY can close the reset request. node
  // keeps the request and the session open here.
  test("close(8), GOAWAY(NO_ERROR) while the limit is 0", { skip: !isBun }, async () => {
    const peer = limitedH2Peer();
    const port = await listen(peer.server);
    const client = http2.connect(`http://127.0.0.1:${port}`);
    const { reject, step } = failable();
    client.on("error", reject);
    try {
      await step(new Promise(resolve => client.once("remoteSettings", resolve)));
      const noSlot = new Promise(resolve => client.once("remoteSettings", resolve));
      peer.setLimit(0);
      await step(noSlot);
      const req = client.request({ ":path": "/waiting" });
      const { events, closed } = record(req);
      req.close(NGHTTP2_CANCEL);
      const sessionClosed = new Promise(resolve => client.on("close", resolve));
      peer.goaway(NGHTTP2_NO_ERROR);
      await step(Promise.all([closed, sessionClosed]));
      assert.deepStrictEqual({ frames: peer.frames, events }, { frames: [], events: ["finish", "close:8"] });
    } finally {
      client.destroy();
      peer.close();
    }
  });

  // A request with NGHTTP2_NO_ERROR ends its readable before it closes, and the others do not.
  test("GOAWAY(NO_ERROR) keeps the order of the reset requests", async () => {
    const { peer, client, step } = await sessionWithSlotTaken();
    try {
      const order: string[] = [];
      const closed = [NGHTTP2_NO_ERROR, NGHTTP2_CANCEL, NGHTTP2_INTERNAL_ERROR].map(code => {
        const req = client.request({ ":path": "/reset" });
        req.on("error", () => {}).close(code);
        return new Promise<void>(resolve => req.on("close", () => resolve(void order.push(`close:${req.rstCode}`))));
      });
      const goaway = new Promise(resolve => client.once("goaway", resolve));
      peer.goaway(NGHTTP2_NO_ERROR);
      await step(goaway);
      peer.release();
      await step(Promise.all(closed));
      assert.deepStrictEqual({ frames: peer.frames, order }, { frames: [], order: ["close:0", "close:8", "close:2"] });
    } finally {
      client.destroy();
      peer.close();
    }
  });

  // In Bun "/hold" is complete but not read, and still has the slot. The GOAWAY rejects the request
  // that waits, so the queue is empty and the session ends. node has sent that request by then.
  test("a GOAWAY that rejects the only request in the queue ends the session", { skip: !isBun }, async () => {
    const { peer, client, hold, step } = await sessionWithSlotTaken();
    try {
      hold.pause();
      peer.releaseWithBody();
      await step(roundTrip(client));
      const req = client.request({ ":path": "/waiting" });
      const { events } = record(req);
      const sessionClosed = new Promise(resolve => client.on("close", resolve));
      peer.goaway(NGHTTP2_NO_ERROR);
      await step(sessionClosed);
      assert.deepStrictEqual(
        { frames: peer.frames, events },
        { frames: [], events: ["error:ERR_HTTP2_GOAWAY_SESSION", "close:7"] },
      );
    } finally {
      client.destroy();
      peer.close();
    }
  });

  // Bun rejects a request that is not reset when the GOAWAY arrives, and its 'aborted' listener
  // runs in that sweep. node rejects it later, so this order of events is Bun's only.
  test("a listener that resets another request in the GOAWAY sweep", { skip: !isBun }, async () => {
    const { peer, client, hold, step, reject } = await sessionWithSlotTaken();
    try {
      client.off("error", reject).on("error", () => {});
      hold.off("error", reject).on("error", () => {});
      const live = client.request({ ":path": "/live", ":method": "POST" });
      const req = client.request({ ":path": "/behind" });
      const { events, closed } = record(req, { errorListener: false });
      live.on("error", () => {}).on("aborted", () => req.close(NGHTTP2_CANCEL));
      peer.goaway(NGHTTP2_NO_ERROR);
      await step(closed);
      assert.deepStrictEqual({ frames: peer.frames, events }, { frames: [], events: ["finish", "close:8"] });
    } finally {
      client.destroy();
      peer.close();
    }
  });

  test("a listener that destroys the session in the GOAWAY sweep", { skip: !isBun }, async () => {
    const { peer, client, hold, step, reject } = await sessionWithSlotTaken();
    try {
      client.off("error", reject).on("error", () => {});
      hold.off("error", reject).on("error", () => {});
      const live = client.request({ ":path": "/live", ":method": "POST" });
      live.on("error", () => {}).on("aborted", () => client.destroy());
      const behind = record(client.request({ ":path": "/behind" }));
      const req = client.request({ ":path": "/reset" });
      const { events, closed } = record(req);
      req.close(NGHTTP2_INTERNAL_ERROR);
      peer.goaway(NGHTTP2_NO_ERROR);
      await step(Promise.all([closed, behind.closed]));
      assert.deepStrictEqual(
        { frames: peer.frames, events, readyListeners: req.listenerCount("ready"), behind: behind.events },
        {
          frames: [],
          events: ["finish", "error:ERR_HTTP2_STREAM_ERROR", "close:2"],
          readyListeners: 0,
          // The GOAWAY rejects it, not the destroy() of the listener.
          behind: ["error:ERR_HTTP2_GOAWAY_SESSION", "close:7"],
        },
      );
    } finally {
      client.destroy();
      peer.close();
    }
  });
});

// session.close() completes when no stream is open and the queue is empty. The raw peer keeps the
// socket open after the GOAWAY, so only the client can end the session. Not covered here: when
// the last open stream ends after close(), Bun cancels a request that still waits. node sends it.
describe("session.close() with a request that waits for a stream slot", () => {
  // The answer of "/hold" is complete but not read yet, so close() finds no open stream and
  // waits for the queue only. The queue then empties with no request submitted.
  for (const [name, drop] of [
    ["close(CANCEL)", client => client.request({ ":path": "/waiting" }).close(NGHTTP2_CANCEL)],
    ["destroy()", client => client.request({ ":path": "/waiting" }).destroy()],
    [
      "an aborted signal",
      client => {
        const controller = new AbortController();
        client.request({ ":path": "/waiting" }, { signal: controller.signal }).on("error", () => {});
        controller.abort();
      },
    ],
  ] as [string, (client: http2.ClientHttp2Session) => void][]) {
    test(`completes when a request that left the queue with ${name} was the last one in it`, async () => {
      const { peer, client, hold, step } = await sessionWithSlotTaken();
      try {
        hold.pause();
        drop(client);
        peer.releaseWithBody();
        // The PING ACK follows the answer on the wire.
        await step(roundTrip(client));
        const sessionClosed = new Promise(resolve => client.on("close", resolve));
        client.close();
        hold.resume();
        await step(sessionClosed);
        await step(peer.ended);
        assert.deepStrictEqual(peer.frames, []);
      } finally {
        client.destroy();
        peer.close();
      }
    });
  }

  // In Bun "/hold" is complete but not read: no stream is open, "/hold" still has the slot, and the
  // queue has a reset request and one that is not reset. node frees the slot when the answer
  // arrives, so it sends "/waiting" before close().
  test("does not end the session while a request that is not reset waits", async () => {
    const { peer, client, hold, step } = await sessionWithSlotTaken();
    try {
      hold.pause();
      client.request({ ":path": "/reset" }).close(NGHTTP2_CANCEL);
      const req = client.request({ ":path": "/waiting" });
      const { events, closed } = record(req);
      req.on("response", headers => events.push("response:" + headers[":status"]));
      req.resume();
      peer.releaseWithBody();
      await step(roundTrip(client));
      const sessionClosed = new Promise(resolve => client.on("close", resolve));
      client.close();
      // A SETTINGS frame with the same limit runs the queue of Bun. node can miss it: after close()
      // it reads no frame once nghttp2 has no open stream.
      const settings = new Promise(resolve => client.once("remoteSettings", resolve));
      peer.setLimit(1);
      if (isBun) await step(settings);
      // A session that ended itself here would be gone two turns later.
      await step(immediate());
      await step(immediate());
      hold.resume();
      await step(Promise.all([closed, sessionClosed]));
      await step(peer.ended);
      assert.deepStrictEqual(
        { frames: peer.frames, events },
        { frames: ["HEADERS"], events: ["finish", "response:200", "end", "close:0"] },
      );
    } finally {
      client.destroy();
      peer.close();
    }
  });

  test("does not end the session while another request has the slot", async () => {
    const { peer, client, hold, step } = await sessionWithSlotTaken();
    try {
      const { events } = record(hold);
      hold.on("response", headers => events.push("response:" + headers[":status"]));
      const req = client.request({ ":path": "/waiting" });
      const closed = new Promise<void>(resolve => req.on("close", () => resolve()));
      req.close(NGHTTP2_CANCEL);
      const sessionClosed = new Promise(resolve => client.on("close", resolve));
      client.close();
      // The new limit lets the reset request out of the queue: the queue is empty, "/hold" is open.
      peer.setLimit(3);
      await step(closed);
      // A session that ended itself here would be gone two turns later.
      await step(immediate());
      await step(immediate());
      peer.release();
      await step(sessionClosed);
      await step(peer.ended);
      assert.deepStrictEqual(
        { frames: peer.frames, events },
        { frames: [], events: ["response:200", "end", "close:0"] },
      );
    } finally {
      client.destroy();
      peer.close();
    }
  });

  // node finishes the writable of a request that waits at end(), and Bun when the request is sent.
  // In both, close() in the callback of end() lets the request complete.
  test("close() in the end() callback of a request that waits", async () => {
    const { peer, client, step } = await sessionWithSlotTaken();
    try {
      const req = client.request({ ":path": "/waiting", ":method": "POST" });
      const { events, closed } = record(req);
      req.on("response", headers => events.push("response:" + headers[":status"]));
      req.resume();
      const sessionClosed = new Promise(resolve => client.on("close", resolve));
      req.end(() => client.close());
      await step(roundTrip(client));
      peer.release();
      await step(Promise.all([closed, sessionClosed]));
      await step(peer.ended);
      assert.deepStrictEqual(
        { frames: peer.frames, events },
        { frames: ["HEADERS", "DATA"], events: ["finish", "response:200", "end", "close:0"] },
      );
    } finally {
      client.destroy();
      peer.close();
    }
  });
});

// In Bun the writable of a request that waits finishes inside close(code), so a 'prefinish'
// listener runs there. The request is marked by then: the session closes it with its own code.
test("a 'prefinish' listener that destroys the session inside close(code)", { skip: !isBun }, async () => {
  const { peer, client, hold, step, reject } = await sessionWithSlotTaken();
  try {
    hold.off("error", reject).on("error", () => {});
    const req = client.request({ ":path": "/waiting" });
    const { events, closed } = record(req, { errorListener: false });
    req.on("prefinish", () => client.destroy());
    req.close(NGHTTP2_CANCEL);
    await step(closed);
    await step(immediate());
    // No error, and the code of close(code). 'finish' follows 'close' here.
    assert.deepStrictEqual({ frames: peer.frames, events }, { frames: [], events: ["close:8", "finish"] });
  } finally {
    client.destroy();
    peer.close();
  }
});

// The queue empties with no request submitted, on a session that close() was not called on.
test("the session stays open after a reset request was the last one in the queue", async () => {
  const { peer, client, step, reject } = await sessionWithSlotTaken();
  try {
    const req = client.request({ ":path": "/waiting" });
    const closed = new Promise<void>(resolve => req.on("close", () => resolve()));
    req.close(NGHTTP2_CANCEL);
    peer.release();
    await step(closed);
    await step(immediate());
    await step(lastRequest(client, reject));
    assert.deepStrictEqual(
      { frames: peer.frames, destroyed: client.destroyed },
      { frames: ["HEADERS"], destroyed: false },
    );
  } finally {
    client.destroy();
    peer.close();
  }
});

// In node 'finish' runs in the store of the end() of the writable: request() ends a GET, and
// close() an open POST. In Bun a writable that ended before close(code) finishes at close(code),
// in the store of the request.
for (const [name, method, endIn, finish] of [
  ["GET", "GET", undefined, "waiter"],
  ["open POST", "POST", undefined, "caller of close()"],
  ["POST that ended in another store", "POST", "caller of end()", isBun ? "waiter" : "caller of end()"],
] as const) {
  test(`a reset ${name} that waited for a stream slot closes in its own AsyncLocalStorage store`, async () => {
    const als = new AsyncLocalStorage<string>();
    const { peer, client, step } = await als.run("holder", sessionWithSlotTaken);
    try {
      const req = als.run("waiter", () => client.request({ ":path": "/waiting", ":method": method }));
      if (endIn) als.run(endIn, () => req.end());
      const stores: string[] = [];
      for (const name of ["finish", "error"]) req.on(name, () => stores.push(`${name}:${als.getStore()}`));
      const closed = new Promise<void>(resolve =>
        req.on("close", () => resolve(void stores.push(`close:${als.getStore()}`))),
      );
      als.run("caller of close()", () => {
        req.close(NGHTTP2_INTERNAL_ERROR, () => stores.push(`close callback:${als.getStore()}`));
      });
      als.run("peer", () => peer.release());
      await step(closed);
      assert.deepStrictEqual(stores, [`finish:${finish}`, "error:waiter", "close:waiter", "close callback:waiter"]);
    } finally {
      client.destroy();
      peer.close();
    }
  });
}

// A request that is not reset keeps its place in the queue and is sent when the slot frees.
describe("a request that waits for a stream slot and is not reset", () => {
  channelTest("POST, end(body)", async () => {
    const { peer, client, step } = await sessionWithSlotTaken();
    let bodySent = 0;
    const onBodySent = () => bodySent++;
    diagnosticsChannel.subscribe("http2.client.stream.bodySent", onBodySent);
    try {
      const req = client.request({ ":path": "/waiting", ":method": "POST" });
      const { events, closed } = record(req);
      req.on("response", headers => events.push("response:" + headers[":status"]));
      req.resume();
      req.end("body", callback(events, "end"));
      await step(roundTrip(client));
      const waiting = [...events];
      peer.release();
      await step(closed);
      assert.deepStrictEqual(
        { waiting, frames: peer.frames, events, bodySent },
        {
          waiting: [],
          frames: ["HEADERS", "DATA"],
          events: ["end callback:ok", "finish", "response:200", "end", "close:0"],
          bodySent: 1,
        },
      );
    } finally {
      diagnosticsChannel.unsubscribe("http2.client.stream.bodySent", onBodySent);
      client.destroy();
      peer.close();
    }
  });

  // node gives the request its handle at once, so a writable with no body to flush finishes
  // while the request still waits. In Bun it finishes when the request is sent.
  for (const method of ["GET", "POST"] as const) {
    test(`${method}, end()`, async () => {
      const { peer, client, step } = await sessionWithSlotTaken();
      try {
        const req = client.request({ ":path": "/waiting", ":method": method });
        const { events, closed } = record(req);
        req.on("response", headers => events.push("response:" + headers[":status"]));
        req.resume();
        req.end();
        await step(roundTrip(client));
        const waiting = [...events];
        peer.release();
        await step(closed);
        assert.deepStrictEqual(
          { waiting, frames: peer.frames, events },
          {
            waiting: isBun ? [] : ["finish"],
            frames: method === "GET" ? ["HEADERS"] : ["HEADERS", "DATA"],
            events: ["finish", "response:200", "end", "close:0"],
          },
        );
      } finally {
        client.destroy();
        peer.close();
      }
    });
  }
});

// Before the connect the limit of the peer is not known: the request is sent, and the reset follows it.
test("close(code) before the connect still sends the request and then the reset", async () => {
  const peer = limitedH2Peer({ answerSecond: false });
  const port = await listen(peer.server);
  const client = http2.connect(`http://127.0.0.1:${port}`);
  const { reject, step } = failable();
  client.on("error", reject);
  try {
    client.request({ ":path": "/hold" }).on("error", reject).resume();
    const req = client.request({ ":path": "/early" });
    assert.strictEqual(req.pending, true);
    const { events, closed } = record(req);
    req.resume();
    req.close(NGHTTP2_CANCEL);
    await step(closed);
    await step(immediate());
    await step(roundTrip(client));
    assert.deepStrictEqual(
      // Bun can reset the stream a second time when it destroys it.
      { frames: peer.frames.slice(0, 2), rest: peer.frames.slice(2).filter(f => f !== "RST_STREAM:8"), events },
      { frames: ["HEADERS", "RST_STREAM:8"], rest: [], events: ["end", "finish", "close:8"] },
    );
  } finally {
    client.destroy();
    peer.close();
  }
});

// A listener that throws is an uncaught exception, in node too. The child process handles it.
test("a listener that throws does not stop the queue of requests that wait for a stream slot", async () => {
  // The request behind the reset one is answered, and the reset one was not sent.
  assert.deepStrictEqual(await listenerThrows, {
    stdout: JSON.stringify({ seen: ["/hold", "/last"], uncaught: ["readable listener"] }),
    stderr: "",
    exit: 0,
  });
});

// node gives a request that waits its id at once, and publishes `start` in request(). In Bun the
// request gets its id when it is sent: a request that is dropped has none, and only `created` and
// `close` are published for it.
channelTest("perf_hooks entry and diagnostics channels of a request that was reset while it waited", async () => {
  const ids: number[] = [];
  const { promise: observed, resolve: sawAll } = Promise.withResolvers<void>();
  // The entry of a stream of an earlier test can still arrive: its stream started before this test.
  const start = performance.now();
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      if (entry.name !== "Http2Stream" || entry.startTime < start) continue;
      ids.push((entry as unknown as { detail: { id: number } }).detail.id);
    }
    if (ids.length === 3) sawAll();
  });
  observer.observe({ entryTypes: ["http2"] });
  const published: string[] = [];
  const waiters = new WeakSet<object>();
  const channels = ["created", "start", "error", "close"].map(name => {
    const onMessage = (message: unknown) => {
      const { stream, headers } = message as { stream: object; headers?: http2.OutgoingHttpHeaders };
      // node publishes `start` before `created`.
      if ((name === "created" || name === "start") && headers?.[":path"] === "/waiting") waiters.add(stream);
      if (waiters.has(stream)) published.push(name);
    };
    diagnosticsChannel.subscribe(`http2.client.stream.${name}`, onMessage);
    return { name, onMessage };
  });
  try {
    const { peer, client, step, reject } = await sessionWithSlotTaken();
    try {
      const req = client.request({ ":path": "/waiting", ":method": "POST" });
      const closed = new Promise<void>(resolve => req.on("close", () => resolve()));
      req.on("error", reject).resume();
      req.write("body");
      req.close(NGHTTP2_CANCEL);
      await step(roundTrip(client));
      peer.release();
      await step(Promise.all([closed, lastRequest(client, reject), observed]));
      assert.deepStrictEqual(
        { frames: peer.frames, ids, published },
        isBun
          ? { frames: ["HEADERS"], ids: [1, 0, 3], published: ["created", "close"] }
          : { frames: ["HEADERS"], ids: [1, 3, 5], published: ["start", "created", "close"] },
      );
    } finally {
      client.destroy();
      peer.close();
    }
  } finally {
    observer.disconnect();
    for (const { name, onMessage } of channels)
      diagnosticsChannel.unsubscribe(`http2.client.stream.${name}`, onMessage);
  }
});

// A server with one stream slot, and a client that cancels the request that waits for it.
test("a server never sees a request that was cancelled while it waited for a stream slot", async () => {
  const server = http2.createServer({ settings: { maxConcurrentStreams: 1 } });
  const seen: string[] = [];
  const { promise: holding, resolve: gotHold } = Promise.withResolvers<http2.ServerHttp2Stream>();
  server.on("stream", (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => {
    stream.on("error", () => {});
    seen.push(headers[":path"] as string);
    if (headers[":path"] === "/hold") return gotHold(stream);
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });
  const port = await listen(server as unknown as net.Server);
  const client = http2.connect(`http://127.0.0.1:${port}`);
  const { reject, step } = failable();
  client.on("error", reject);
  try {
    await step(new Promise(resolve => client.once("remoteSettings", resolve)));
    client.request({ ":path": "/hold" }).on("error", reject).resume();
    const first = await step(holding);
    const cancelled = client.request({ ":path": "/cancelled" });
    const { events, closed } = record(cancelled);
    cancelled.close(NGHTTP2_CANCEL);
    first.respond({ ":status": 200 });
    first.end("late");
    await step(Promise.all([closed, lastRequest(client, reject)]));
    assert.deepStrictEqual({ seen, events }, { seen: ["/hold", "/last"], events: ["finish", "close:8"] });
  } finally {
    client.destroy();
    server.close();
  }
});

if (typeof Bun !== "undefined") {
  const node = Bun.which("node");
  // node segfaulted at a random point of this file on alpine 3.23 aarch64, and the CI runner
  // fails a file for any new core dump, whichever process wrote it. One cause is gone:
  // closeWithoutResponse() lets the server read the request before it closes. No alpine lane has
  // confirmed that it was the only cause, so the skip stays. The glibc, macOS and Windows lanes
  // keep the cross-check.
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
