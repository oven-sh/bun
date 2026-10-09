/**
 * Http2Stream.close(code) event contract, client and server, while the peer's half is still open:
 *   NO_ERROR / CANCEL  -> 'end', 'close'             (documented 'error' exemption)
 *   any other code     -> 'error', 'close'           (no 'end': the body was killed by RST_STREAM)
 * Once the peer's half has ended (END_STREAM on a HEADERS frame, or a server push, which has no
 * inbound half) the readable already has its EOF, so 'end' comes first for every code.
 * close(code) stores its code before it emits 'aborted'. A destroy() or close() made inside that
 * event (stream.pipeline() destroys the stream there) does not change the code, and a listener that
 * throws does not stop the close.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-client-close.test.ts
 *   node --test test/js/node/http2/node-http2-client-close.test.ts
 */
import assert from "node:assert";
import dc from "node:diagnostics_channel";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import { PassThrough, Writable, compose, finished, pipeline, promises } from "node:stream";
import { after, before, describe, test } from "node:test";

const { NGHTTP2_NO_ERROR, NGHTTP2_CANCEL, NGHTTP2_INTERNAL_ERROR, NGHTTP2_REFUSED_STREAM, NGHTTP2_ENHANCE_YOUR_CALM } =
  http2.constants;

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

// close(code) stores its code before it hands control to a listener. What the listener then does
// to the stream does not change the code: stream.pipeline() and its relatives destroy the stream
// from inside 'aborted' when end-of-stream reports a premature close, and a second close(code) is
// a no-op.
const codes = [NGHTTP2_NO_ERROR, NGHTTP2_CANCEL, NGHTTP2_REFUSED_STREAM];
const discard = () =>
  new Writable({
    write(chunk, encoding, callback) {
      callback();
    },
  });

// Attached before close(code). Each one acts on the stream from inside 'aborted': destroy(),
// close(3) or end().
const readers: [name: string, attach: (stream: http2.Http2Stream) => unknown][] = [
  ["pipeline(stream, sink, cb)", stream => pipeline(stream, discard(), () => {})],
  ["promises.pipeline(stream, sink)", stream => promises.pipeline(stream, discard()).catch(() => {})],
  ["compose(stream, PassThrough)", stream => compose(stream, new PassThrough()).on("error", () => {})],
  ["pipeline(stream, PassThrough, stream, cb)", stream => pipeline(stream, new PassThrough(), stream, () => {})],
  ["finished(stream, () => stream.destroy())", stream => finished(stream, () => stream.destroy())],
  ["on('aborted', () => stream.destroy(err))", stream => stream.on("aborted", () => stream.destroy(new Error("boom")))],
  ["on('aborted', () => stream.destroy())", stream => stream.on("aborted", () => stream.destroy())],
  ["on('aborted', () => stream.close(3))", stream => stream.on("aborted", () => stream.close(3))],
  ["on('aborted', () => stream.end())", stream => stream.on("aborted", () => stream.end())],
];

// The stream shows the code given to close(code) inside 'aborted', at 'close' and one turn later.
const codeIsKept = {
  [NGHTTP2_NO_ERROR]: ["aborted:0", "close:0", "immediate:0"],
  [NGHTTP2_CANCEL]: ["aborted:8", "close:8", "immediate:8"],
  [NGHTTP2_REFUSED_STREAM]: ["aborted:7", "close:7", "immediate:7"],
};

// Records the 'error' and 'close' events of a stream and resolves at 'close'.
function errorAndClose(stream: http2.Http2Stream): Promise<string[]> {
  const events: string[] = [];
  const { promise, resolve } = Promise.withResolvers<string[]>();
  stream.on("error", err => events.push("error:" + ((err as NodeJS.ErrnoException).code ?? err.message)));
  stream.on("close", () => {
    events.push("close:" + stream.rstCode);
    resolve(events);
  });
  return promise;
}

for (const side of ["server", "client"] as const) {
  describe(`${side} stream keeps the code given to close(code)`, () => {
    let server: http2.Http2Server;
    let client: http2.ClientHttp2Session;
    let sessionFailed: Promise<never>;
    before(async () => {
      server = http2.createServer();
      server.on("stream", stream => stream.on("error", () => {}));
      client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
      sessionFailed = new Promise((_, reject) => client.on("error", reject));
      sessionFailed.catch(() => {});
    });
    after(() => {
      client.destroy();
      server.close();
    });

    // Opens a POST whose body stays open, so both halves of the stream are open, and calls
    // run(stream, peer) with this side's end first. The server side runs inside the server's
    // 'stream' event. The client side runs once the server has the stream: node v26.3.0 spins
    // when a request is destroyed inside 'aborted' in the same tick as request().
    type Run<T> = (stream: http2.Http2Stream, peer: http2.Http2Stream) => Promise<T>;
    async function open<T>(run: Run<T>): Promise<T> {
      const req = client.request({ ":method": "POST", ":path": "/" });
      req.on("error", () => {});
      req.on("response", () => {});
      if (side === "client") {
        const [stream] = await once(server, "stream");
        return run(req, stream);
      }
      const { promise, resolve } = Promise.withResolvers<T>();
      server.once("stream", stream => resolve(run(stream, req)));
      return promise;
    }
    const withStream = <T>(run: Run<T>) => Promise.race([open(run), sessionFailed]);

    // The peer sends 3000 bytes and ends its half. Resolves once this side has all of it: one ping
    // round trip after the peer's 'finish'. This side has not read it.
    async function peerEnds(stream: http2.Http2Stream, peer: http2.Http2Stream) {
      if (side === "client") {
        // A server stream that reads its request stays open after its response.
        peer.resume();
        (peer as http2.ServerHttp2Stream).respond({ ":status": 200 });
      }
      peer.end(Buffer.alloc(3000, "a"));
      await once(peer, "finish");
      const { promise: pinged, resolve: onPing } = Promise.withResolvers<Error | null>();
      stream.session!.ping(onPing);
      assert.strictEqual(await pinged, null);
    }

    // For each code: attaches the reader, calls close(code) and records rstCode inside 'aborted'
    // (after the reader's own 'aborted' listener), at 'close' and one setImmediate turn after
    // 'close'. With peerEnded, the peer's half has ended first and its data is unread.
    async function closeEachCode(attach: (stream: http2.Http2Stream) => unknown, peerEnded = false) {
      const seen: Record<number, string[]> = {};
      for (const code of codes) {
        seen[code] = await withStream(async (stream, peer) => {
          if (peerEnded) await peerEnds(stream, peer);
          const events: string[] = [];
          const { promise, resolve } = Promise.withResolvers<string[]>();
          attach(stream);
          // node never closes a client stream whose data nothing reads.
          if (peerEnded && stream.readableFlowing === null) stream.resume();
          stream.on("aborted", () => events.push("aborted:" + stream.rstCode));
          stream.on("close", () => {
            events.push("close:" + stream.rstCode);
            setImmediate(() => {
              events.push("immediate:" + stream.rstCode);
              resolve(events);
            });
          });
          stream.close(code);
          return promise;
        });
      }
      return seen;
    }

    for (const peerEnded of [false, true]) {
      const state = peerEnded ? ", peer's half ended" : "";
      test(`close(code): 'aborted' sees rstCode${state}`, async () => {
        assert.deepStrictEqual(await closeEachCode(() => {}, peerEnded), codeIsKept);
      });

      for (const [name, attach] of readers) {
        test(`close(code) under ${name}${state}`, async () => {
          assert.deepStrictEqual(await closeEachCode(attach, peerEnded), codeIsKept);
        });
      }
    }

    test("close(code) then destroy() inside 'aborted': 'error' for an error code only", async () => {
      const seen: Record<number, string[]> = {};
      for (const code of codes) {
        seen[code] = await withStream(stream => {
          const atClose = errorAndClose(stream);
          stream.on("aborted", () => stream.destroy());
          stream.close(code);
          return atClose;
        });
      }
      assert.deepStrictEqual(seen, {
        [NGHTTP2_NO_ERROR]: ["close:0"],
        [NGHTTP2_CANCEL]: ["close:8"],
        [NGHTTP2_REFUSED_STREAM]: ["error:ERR_HTTP2_STREAM_ERROR", "close:7"],
      });
    });

    test("close(0) then destroy(err)", async () => {
      const events = await withStream(stream => {
        const atClose = errorAndClose(stream);
        stream.close(NGHTTP2_NO_ERROR);
        stream.destroy(new Error("boom"));
        return atClose;
      });
      assert.deepStrictEqual(events, ["error:boom", "close:0"]);
    });

    // With a body still queued, the reset that drops it carries the code of close() too, so the
    // peer does not learn from the code that the body is cut short.
    for (const [name, error] of [
      ["destroy(err)", () => new Error("boom")],
      ["destroy(AbortError)", () => Object.assign(new Error("aborted"), { name: "AbortError", code: "ABORT_ERR" })],
    ] as const) {
      test(`write(1 MiB) then close() then ${name}: the peer's stream closes with code 0`, async () => {
        const events = await withStream((stream, peer) => {
          const atClose = errorAndClose(peer);
          peer.resume();
          if (side === "server") (stream as http2.ServerHttp2Stream).respond({ ":status": 200 });
          stream.write(Buffer.alloc(1024 * 1024, "a"));
          stream.close();
          stream.destroy(error());
          return atClose;
        });
        assert.strictEqual(events.at(-1), "close:0");
      });
    }

    test("destroy(err) with close(0) inside its 'aborted'", async () => {
      const events = await withStream(stream => {
        const atClose = errorAndClose(stream);
        stream.on("aborted", () => stream.close(NGHTTP2_NO_ERROR));
        stream.destroy(new Error("boom"));
        return atClose;
      });
      assert.deepStrictEqual(events, ["error:boom", "close:2"]);
    });

    // node v26.3.0 shows the same state and then never ends or resets the stream. node main
    // (nodejs/node#66314) and bun close it with the first code.
    test("close(code) when an 'aborted' listener throws: the stream is closed with that code", async () => {
      const seen: Record<number, unknown[]> = {};
      for (const code of codes) {
        seen[code] = await withStream(async stream => {
          stream.once("aborted", () => {
            throw new Error("boom");
          });
          let thrown: unknown;
          try {
            stream.close(code);
          } catch (err) {
            thrown = (err as Error).message;
          }
          const state = [thrown, stream.closed, stream.rstCode];
          stream.close(NGHTTP2_ENHANCE_YOUR_CALM);
          return [...state, stream.rstCode];
        });
      }
      assert.deepStrictEqual(seen, {
        [NGHTTP2_NO_ERROR]: ["boom", true, 0, 0],
        [NGHTTP2_CANCEL]: ["boom", true, 8, 8],
        [NGHTTP2_REFUSED_STREAM]: ["boom", true, 7, 7],
      });
    });

    // Inside 'aborted', node reports closed === true and ignores the call. bun reports false there,
    // so it keeps the callback: code that closes a stream that is not closed yet still completes.
    test("close() inside 'aborted' of close(7): bad arguments throw, a callback is not lost", async () => {
      const seen = await withStream(stream => {
        const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
        let bad: string[] = [];
        let closedInside = false;
        let called = false;
        stream.on("aborted", () => {
          bad = [["x"], [-1], [0, "notfn"]].map(args => {
            try {
              Reflect.apply(stream.close, stream, args);
              return "returned";
            } catch (err) {
              return (err as NodeJS.ErrnoException).code!;
            }
          });
          closedInside = stream.closed;
          stream.close(NGHTTP2_CANCEL, () => (called = true));
        });
        stream.on("close", () =>
          setImmediate(() => resolve({ bad, completes: closedInside || called, rstCode: stream.rstCode })),
        );
        stream.close(NGHTTP2_REFUSED_STREAM);
        return promise;
      });
      assert.deepStrictEqual(seen, {
        bad: ["ERR_INVALID_ARG_TYPE", "ERR_OUT_OF_RANGE", "ERR_INVALID_ARG_TYPE"],
        completes: true,
        rstCode: NGHTTP2_REFUSED_STREAM,
      });
    });

    // The peer's half has ended and its 3000 bytes are unread. close(code) ends the writable, and
    // that closes the stream while close(code) is still running.
    test("close(code) in the tick a consumer attaches: the consumer gets the data and 'end'", async () => {
      const seen: Record<number, string[]> = {};
      for (const code of [...codes, NGHTTP2_INTERNAL_ERROR]) {
        seen[code] = await withStream(async (stream, peer) => {
          await peerEnds(stream, peer);
          const events: string[] = [];
          const { promise, resolve } = Promise.withResolvers<string[]>();
          let bytes = 0;
          stream.on("data", chunk => (bytes += chunk.length));
          stream.on("aborted", () => events.push("aborted"));
          stream.on("end", () => events.push("end:" + bytes));
          stream.on("error", err => events.push("error:" + (err as NodeJS.ErrnoException).code));
          stream.on("close", () => {
            events.push("close:" + stream.rstCode);
            resolve(events);
          });
          stream.close(code);
          return promise;
        });
      }
      assert.deepStrictEqual(seen, {
        [NGHTTP2_NO_ERROR]: ["aborted", "end:3000", "close:0"],
        [NGHTTP2_CANCEL]: ["aborted", "end:3000", "close:8"],
        [NGHTTP2_REFUSED_STREAM]: ["aborted", "end:3000", "error:ERR_HTTP2_STREAM_ERROR", "close:7"],
        [NGHTTP2_INTERNAL_ERROR]: ["aborted", "end:3000", "error:ERR_HTTP2_STREAM_ERROR", "close:2"],
      });
    });

    test("close(7) under pipeline(stream, sink, cb): diagnostics channel", async () => {
      const channel = `http2.${side}.stream.close`;
      const published: number[] = [];
      let closing: http2.Http2Stream | undefined;
      const onClose = (message: unknown) => {
        const { stream } = message as { stream: http2.Http2Stream };
        if (stream === closing) published.push(stream.rstCode);
      };
      dc.subscribe(channel, onClose);
      try {
        await withStream(stream => {
          closing = stream;
          const atClose = errorAndClose(stream);
          pipeline(stream, discard(), () => {});
          stream.close(NGHTTP2_REFUSED_STREAM);
          return atClose;
        });
      } finally {
        dc.unsubscribe(channel, onClose);
      }
      assert.deepStrictEqual(published, [NGHTTP2_REFUSED_STREAM]);
    });
  });
}

// A listener of close(code) can run another closer of the stream: a session teardown, or the
// AbortSignal of the request. 'close' still shows the code given to close(code).
describe("close(code) keeps its code when a listener runs another closer", () => {
  let server: http2.Http2Server;
  let port: number;
  before(async () => {
    server = http2.createServer();
    server.on("sessionError", () => {});
    server.on("stream", stream => stream.on("error", () => {}));
    port = await listen(server);
  });
  after(() => {
    server.close();
  });
  const connect = () => http2.connect(`http://127.0.0.1:${port}`).on("error", () => {});

  const teardowns: [name: string, teardown: (session: http2.Http2Session) => void][] = [
    ["session.destroy()", session => session.destroy()],
    ["session.destroy(err)", session => session.destroy(new Error("s"))],
    ["session.destroy(err, 11)", session => session.destroy(new Error("s"), NGHTTP2_ENHANCE_YOUR_CALM)],
  ];

  for (const [name, teardown] of teardowns) {
    test(`pending request: close(7) with ${name} inside 'aborted'`, async () => {
      const client = connect();
      const req = client.request({ ":method": "POST", ":path": "/" });
      assert.strictEqual(req.pending, true);
      req.once("aborted", () => teardown(client));
      const atClose = errorAndClose(req);
      req.close(NGHTTP2_REFUSED_STREAM);
      assert.strictEqual((await atClose).at(-1), "close:7");
    });
  }

  for (const code of [NGHTTP2_NO_ERROR, NGHTTP2_REFUSED_STREAM]) {
    test(`close(${code}) with the AbortSignal of the request aborted inside 'aborted'`, async () => {
      const client = connect();
      try {
        const ac = new AbortController();
        const streamEvent = once(server, "stream");
        const req = client.request({ ":method": "POST", ":path": "/" }, { signal: ac.signal });
        await streamEvent;
        req.once("aborted", () => ac.abort());
        const atClose = errorAndClose(req);
        req.close(code);
        assert.strictEqual((await atClose).at(-1), "close:" + code);
      } finally {
        client.destroy();
      }
    });
  }

  for (const [name, teardown] of teardowns.slice(1)) {
    for (const when of ["inside 'aborted'", "after close(0) returned"]) {
      test(`server stream: close(0) with ${name} ${when}`, async () => {
        const client = connect();
        try {
          const { promise, resolve } = Promise.withResolvers<string[]>();
          server.once("stream", stream => {
            const session = stream.session!;
            session.on("error", () => {});
            if (when === "inside 'aborted'") stream.once("aborted", () => teardown(session));
            resolve(errorAndClose(stream));
            stream.close(NGHTTP2_NO_ERROR);
            if (when !== "inside 'aborted'") teardown(session);
          });
          client.request({ ":method": "POST", ":path": "/" }).on("error", () => {});
          assert.strictEqual((await promise).at(-1), "close:0");
        } finally {
          client.destroy();
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
