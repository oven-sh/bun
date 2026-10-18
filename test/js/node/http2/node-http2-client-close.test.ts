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
import fs from "node:fs";
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

// A 'prefinish' listener that throws. node runs Http2Stream._final, and with it the 'prefinish'
// emit, inside the try of the Writable: the error becomes 'error' on the stream, 'finish' does not
// follow, and the stream still closes on both sides. "<call> returned" shows the call did not throw.
type ThrowingFlow =
  | "pushStream() callback: close(0)"
  | "pushStream() callback: close(8)"
  | "pushStream() callback: close(2)"
  | "pushStream() callback: respond() then close()"
  | "server: respond() then end()"
  | "server: respond({ endStream: true })"
  | "server: respond() then close()"
  | "server: close() with no respond()"
  | "server: respond(), end(), then close()"
  | "server: request read to 'end', then respond() and end()"
  | "server: request read to 'end', then respond() and close()"
  | "server: respond({ waitForTrailers: true }) then end(chunk)"
  | "server: respond({ waitForTrailers: true }), end(chunk), sendTrailers()"
  | "compat: res.end(chunk)"
  | "client: close() on a ready request"
  | "client: end(chunk)"
  | "client: end(chunk) held by flow control"
  // node v26.3.0 leaves these streams open, or destroys them before 'prefinish'.
  | "pushStream() callback: end() then close()"
  | "server: respond() then end(chunk)"
  | "server: request read to 'end', then respond() and end(chunk)"
  | "server: request read to 'end', then respond() and end(200 KiB)";

async function prefinishThrows(flow: ThrowingFlow, errorListener = true) {
  const events: string[] = [];
  const { promise, resolve, reject } = Promise.withResolvers<{ events: string[]; peer: number | undefined }>();
  let peerCode: number | undefined;
  let open = 2;
  const closed = () => {
    if (--open === 0) resolve({ events, peer: peerCode });
  };
  const ignoreErrors = <T extends http2.Http2Stream>(stream: T) => stream.on("error", () => {}) as T;
  const watch = (stream: http2.Http2Stream) => {
    stream.on("aborted", () => events.push("aborted"));
    stream.once("prefinish", () => {
      events.push("prefinish");
      throw new Error("boom");
    });
    if (errorListener) stream.on("error", e => events.push("error:" + e.message));
    stream.on("finish", () => events.push("finish"));
    stream.on("close", () => {
      events.push("close:" + stream.rstCode);
      closed();
    });
  };
  const peer = (stream: http2.Http2Stream) => {
    ignoreErrors(stream).resume();
    stream.on("close", () => {
      peerCode = stream.rstCode;
      closed();
    });
  };
  const call = (label: string, fn: () => void) => {
    try {
      fn();
      events.push(label + " returned");
    } catch (e) {
      events.push(label + " threw " + (e as Error).message);
      // An 'error' listener takes the error: nothing may leave the call.
      if (errorListener) reject(e);
    }
  };

  const server = http2.createServer();
  server.on("error", reject);
  if (flow === "compat: res.end(chunk)") {
    server.on("request", (_req, res) => {
      watch(res.stream);
      call("res.end()", () => res.end("ok"));
    });
  } else {
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      const push = (fn: (pushed: http2.ServerHttp2Stream) => void) => {
        ignoreErrors(stream);
        stream.pushStream({ ":path": "/pushed" }, (err, pushed) => {
          if (err) return reject(err);
          watch(pushed);
          fn(pushed);
        });
        stream.respond({ ":status": 200 });
        stream.end("ok");
      };
      switch (flow) {
        case "pushStream() callback: close(0)":
          return push(pushed => call("close()", () => pushed.close(0)));
        case "pushStream() callback: close(8)":
          return push(pushed => call("close()", () => pushed.close(8)));
        case "pushStream() callback: close(2)":
          return push(pushed => call("close()", () => pushed.close(2)));
        case "pushStream() callback: respond() then close()":
          return push(pushed => {
            pushed.respond({ ":status": 200 });
            call("close()", () => pushed.close());
          });
        case "pushStream() callback: end() then close()":
          return push(pushed => {
            call("end()", () => pushed.end());
            call("close()", () => pushed.close());
          });
        case "server: respond() then end(chunk)":
          watch(stream);
          stream.respond({ ":status": 200 });
          return call("end()", () => stream.end("ok"));
        case "server: respond() then end()":
          watch(stream);
          stream.respond({ ":status": 200 });
          return call("end()", () => stream.end());
        case "server: respond({ endStream: true })":
          watch(stream);
          return call("respond()", () => stream.respond({ ":status": 200 }, { endStream: true }));
        case "server: respond() then close()":
          watch(stream);
          stream.respond({ ":status": 200 });
          return call("close()", () => stream.close());
        case "server: close() with no respond()":
          watch(stream);
          return call("close()", () => stream.close());
        case "server: respond(), end(), then close()":
          watch(stream);
          stream.respond({ ":status": 200 });
          call("end()", () => stream.end());
          return call("close()", () => stream.close());
        case "server: request read to 'end', then respond() and end()":
        case "server: request read to 'end', then respond() and close()":
        case "server: request read to 'end', then respond() and end(chunk)":
        case "server: request read to 'end', then respond() and end(200 KiB)":
          watch(stream);
          stream.resume();
          return stream.on("end", () => {
            stream.respond({ ":status": 200 });
            if (flow.endsWith("end()")) call("end()", () => stream.end());
            else if (flow.endsWith("end(chunk)")) call("end()", () => stream.end("ok"));
            else if (flow.endsWith("end(200 KiB)")) call("end()", () => stream.end(Buffer.alloc(200 * 1024, "a")));
            else call("close()", () => stream.close());
          });
        case "server: respond({ waitForTrailers: true }), end(chunk), sendTrailers()":
          stream.on("wantTrailers", () => stream.sendTrailers({ "x-trailer": "1" }));
        // fallthrough
        case "server: respond({ waitForTrailers: true }) then end(chunk)":
          watch(stream);
          stream.respond({ ":status": 200 }, { waitForTrailers: true });
          return call("end()", () => stream.end("ok"));
        case "client: close() on a ready request":
          return peer(stream);
        case "client: end(chunk)":
        case "client: end(chunk) held by flow control":
          peer(stream);
          stream.respond({ ":status": 200 });
          return stream.on("end", () => stream.end("ok"));
      }
    });
  }
  const port = await listen(server);
  const client = http2.connect(`http://127.0.0.1:${port}`);
  client.on("error", reject);
  client.on("stream", peer);
  try {
    switch (flow) {
      case "client: close() on a ready request": {
        const req = client.request({ ":path": "/", ":method": "POST" });
        watch(req);
        req.resume();
        req.on("ready", () => call("close()", () => req.close()));
        break;
      }
      case "client: end(chunk)":
      case "client: end(chunk) held by flow control": {
        const req = client.request({ ":path": "/", ":method": "POST" });
        watch(req);
        req.resume();
        // 200 KiB is more than the 64 KiB window: the frame with END_STREAM leaves on a later
        // WINDOW_UPDATE.
        call("end()", () => req.end(flow === "client: end(chunk)" ? "hello" : Buffer.alloc(200 * 1024, "a")));
        break;
      }
      case "server: request read to 'end', then respond() and end()":
      case "server: request read to 'end', then respond() and close()":
      case "server: request read to 'end', then respond() and end(chunk)":
      case "server: request read to 'end', then respond() and end(200 KiB)": {
        const req = client.request({ ":path": "/", ":method": "POST" });
        peer(req);
        req.end("body");
        break;
      }
      default:
        if (flow.startsWith("pushStream()")) ignoreErrors(client.request({ ":path": "/" })).resume();
        else peer(client.request({ ":path": "/" }));
    }
    return await promise;
  } finally {
    client.destroy();
    server.close();
  }
}

describe("a 'prefinish' listener that throws becomes 'error' and the stream closes", () => {
  for (const [flow, events, peer] of [
    ["pushStream() callback: close(0)", ["aborted", "prefinish", "error:boom", "close() returned", "close:0"], 0],
    ["pushStream() callback: close(8)", ["aborted", "prefinish", "error:boom", "close() returned", "close:8"], 8],
    ["pushStream() callback: close(2)", ["aborted", "prefinish", "error:boom", "close() returned", "close:2"], 2],
    [
      "pushStream() callback: respond() then close()",
      ["aborted", "prefinish", "error:boom", "close() returned", "close:0"],
      0,
    ],
    ["server: respond() then end()", ["prefinish", "error:boom", "end() returned", "close:0"], 0],
    ["server: respond({ endStream: true })", ["prefinish", "error:boom", "respond() returned", "close:0"], 0],
    ["server: respond() then close()", ["aborted", "prefinish", "error:boom", "close() returned", "close:0"], 0],
    ["server: close() with no respond()", ["aborted", "prefinish", "error:boom", "close() returned", "close:0"], 0],
    [
      "server: respond(), end(), then close()",
      ["prefinish", "error:boom", "end() returned", "close() returned", "close:0"],
      0,
    ],
    [
      "server: request read to 'end', then respond() and end()",
      ["prefinish", "error:boom", "end() returned", "close:0"],
      0,
    ],
    [
      "server: request read to 'end', then respond() and close()",
      ["aborted", "prefinish", "error:boom", "close() returned", "close:0"],
      0,
    ],
    [
      "server: respond({ waitForTrailers: true }) then end(chunk)",
      ["end() returned", "prefinish", "error:boom", "close:0"],
      0,
    ],
    [
      "server: respond({ waitForTrailers: true }), end(chunk), sendTrailers()",
      ["end() returned", "prefinish", "error:boom", "close:0"],
      0,
    ],
    ["compat: res.end(chunk)", ["res.end() returned", "prefinish", "error:boom", "close:0"], 0],
    ["client: close() on a ready request", ["aborted", "prefinish", "error:boom", "close() returned", "close:0"], 0],
    ["client: end(chunk)", ["end() returned", "prefinish", "error:boom", "close:0"], 0],
    ["client: end(chunk) held by flow control", ["end() returned", "prefinish", "error:boom", "close:0"], 0],
  ] as const) {
    test(flow, async () => {
      assert.deepStrictEqual(await prefinishThrows(flow), { events, peer });
    });
  }
});

describe("without an 'error' listener the call throws the error and the stream closes", () => {
  for (const [flow, events] of [
    ["server: respond() then end()", ["prefinish", "end() threw boom", "close:0"]],
    ["server: respond() then close()", ["aborted", "prefinish", "close() threw boom", "close:0"]],
  ] as const) {
    test(flow, async () => {
      assert.deepStrictEqual(await prefinishThrows(flow, false), { events, peer: 0 });
    });
  }
});

// The writable of a pushed stream can end before respond(): there is no body, so the response ends
// on its HEADERS frame. 'prefinish' is synchronous inside the call that ends the writable.
describe("a pushed stream that ends before respond()", () => {
  for (const how of ["end() then respond()", "pushStream({ endStream: true }) then respond()"] as const) {
    test(how, async () => {
      const pushEvents: string[] = [];
      const peerEvents: string[] = [];
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const server = http2.createServer();
      server.on("stream", stream => {
        stream.on("error", () => {});
        const options = how === "end() then respond()" ? {} : { endStream: true };
        stream.pushStream({ ":path": "/pushed" }, options, (err, pushed) => {
          if (err) return reject(err);
          pushed.on("error", reject);
          pushed.on("prefinish", () => pushEvents.push("prefinish"));
          pushed.on("finish", () => pushEvents.push("finish"));
          if (how === "end() then respond()") {
            pushed.end();
            pushEvents.push("end() returned");
          }
          pushed.respond({ ":status": 200 });
          pushEvents.push("respond() returned");
        });
        stream.respond({ ":status": 200 });
        stream.end("ok");
      });
      const port = await listen(server);
      const client = http2.connect(`http://127.0.0.1:${port}`);
      client.on("error", reject);
      client.on("stream", pushed => {
        pushed.on("error", reject);
        pushed.on("push", headers => peerEvents.push("push:" + headers[":status"]));
        pushed.on("end", () => peerEvents.push("end"));
        pushed.on("close", () => {
          peerEvents.push("close:" + pushed.rstCode);
          resolve();
        });
        pushed.resume();
      });
      try {
        client.request({ ":path": "/" }).on("error", reject).resume();
        await promise;
        assert.deepStrictEqual(peerEvents, ["push:200", "end", "close:0"]);
        assert.deepStrictEqual(
          pushEvents,
          how === "end() then respond()"
            ? ["prefinish", "end() returned", "respond() returned", "finish"]
            : ["respond() returned"],
        );
      } finally {
        client.destroy();
        server.close();
      }
    });
  }
});

// END_STREAM of such a request rides on its trailers. 'finish' does not wait for them, and a
// close() after it resets the stream.
describe("a client request with waitForTrailers and no 'wantTrailers' listener", () => {
  for (const body of [undefined, "body"] as const) {
    test(`end(${body === undefined ? "" : "chunk"}) then close()`, async () => {
      const requestEvents: string[] = [];
      const serverEvents: string[] = [];
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      let open = 2;
      const closed = () => {
        if (--open === 0) resolve();
      };
      const server = http2.createServer();
      // The server never responds: only the reset of the client closes the stream.
      server.on("stream", stream => {
        stream.on("error", reject);
        stream.on("end", () => {
          serverEvents.push("end");
          req.close();
        });
        stream.on("aborted", () => serverEvents.push("aborted"));
        stream.on("close", () => {
          serverEvents.push("close:" + stream.rstCode);
          closed();
        });
        stream.resume();
      });
      const port = await listen(server);
      const client = http2.connect(`http://127.0.0.1:${port}`);
      client.on("error", reject);
      const req = client.request({ ":path": "/", ":method": "POST" }, { waitForTrailers: true });
      req.on("error", reject);
      req.on("finish", () => requestEvents.push("finish"));
      req.on("close", () => {
        requestEvents.push("close:" + req.rstCode);
        closed();
      });
      req.resume();
      try {
        req.end(body);
        await promise;
        assert.deepStrictEqual(requestEvents, ["finish", "close:0"]);
        assert.deepStrictEqual(serverEvents, ["end", "aborted", "close:0"]);
      } finally {
        client.destroy();
        server.close();
      }
    });
  }
});

if (typeof Bun !== "undefined") {
  // node v26.3.0 does not close these streams, or closes them another way.
  describe("a 'prefinish' listener that throws: streams that node leaves open", () => {
    const closes = ["end() returned", "prefinish", "error:boom", "close:0"];
    for (const [flow, events] of [
      // The user called close(): it does not wait for a 'finish' that cannot come.
      [
        "pushStream() callback: end() then close()",
        ["prefinish", "error:boom", "end() returned", "close() returned", "close:0"],
      ],
      ["server: respond() then end(chunk)", closes],
      // The frame with END_STREAM closes the stream natively before the Writable runs _final, and
      // the stream waits for 'finish' before it is destroyed. The error cancels that 'finish'.
      ["server: request read to 'end', then respond() and end(chunk)", closes],
      ["server: request read to 'end', then respond() and end(200 KiB)", closes],
    ] as const) {
      test(flow, async () => {
        assert.deepStrictEqual(await prefinishThrows(flow), { events, peer: 0 });
      });
    }
    // close() finishes its work before it throws the error that no 'error' listener took.
    for (const flow of ["pushStream() callback: close(0)", "client: close() on a ready request"] as const) {
      test(`${flow}, no 'error' listener`, async () => {
        assert.deepStrictEqual(await prefinishThrows(flow, false), {
          events: ["aborted", "prefinish", "close() threw boom", "close:0"],
          peer: 0,
        });
      });
    }
  });

  describe("flows that end the writable inside another call", () => {
    test("close() sends the response headers of a chunk that cork() held", async () => {
      // close() ends the writable, which flushes the corked chunk, and _write sends the implicit
      // response headers for it: the stream is not closed yet at that point. node throws
      // ERR_HTTP2_INVALID_STREAM from close() here.
      const { promise, resolve, reject } = Promise.withResolvers<object>();
      const server = http2.createServer();
      server.on("stream", stream => {
        stream.on("error", reject);
        stream.cork();
        stream.write("x");
        stream.close();
      });
      const port = await listen(server);
      const client = http2.connect(`http://127.0.0.1:${port}`);
      client.on("error", reject);
      try {
        const req = client.request({ ":path": "/" });
        let status: unknown;
        let text = "";
        req.on("error", reject);
        req.on("response", headers => (status = headers[":status"]));
        req.setEncoding("utf8");
        req.on("data", chunk => (text += chunk));
        req.on("close", () => resolve({ status, text, rstCode: req.rstCode }));
        assert.deepStrictEqual(await promise, { status: 200, text: "x", rstCode: 0 });
      } finally {
        client.destroy();
        server.close();
      }
    });

    for (const how of ["end() first", "pushStream({ endStream: true })"] as const) {
      test(`respondWithFile() sends the file on a pushed stream whose writable ended (${how})`, async () => {
        // respond() puts END_STREAM on the HEADERS frame of such a stream, but not for a file
        // response. node v26.3.0 crashes here.
        const { promise, resolve, reject } = Promise.withResolvers<number>();
        const server = http2.createServer();
        server.on("stream", stream => {
          stream.on("error", reject);
          const options = how === "end() first" ? {} : { endStream: true };
          stream.pushStream({ ":path": "/pushed" }, options, (err, pushed) => {
            if (err) return reject(err);
            pushed.on("error", reject);
            if (how === "end() first") pushed.end();
            pushed.respondWithFile(import.meta.filename, { ":status": 200 });
          });
          stream.respond({ ":status": 200 });
          stream.end("ok");
        });
        const port = await listen(server);
        const client = http2.connect(`http://127.0.0.1:${port}`);
        client.on("error", reject);
        client.on("stream", pushed => {
          let bytes = 0;
          pushed.on("error", reject);
          pushed.on("data", chunk => (bytes += chunk.length));
          pushed.on("end", () => resolve(bytes));
        });
        try {
          client.request({ ":path": "/" }).on("error", reject).resume();
          assert.strictEqual(await promise, fs.statSync(import.meta.filename).size);
        } finally {
          client.destroy();
          server.close();
        }
      });
    }

    test("end() without a body finishes while socket backpressure holds its END_STREAM frame, and close() does not reset before that frame", async () => {
      // The peer stops reading, so the body of stream 3 fills the socket and the engine queues the
      // empty END_STREAM frame of stream 1. Like node, whose shutdown is synchronous, 'prefinish'
      // fires inside end() and 'finish' does not wait for the socket. The NO_ERROR reset of close()
      // then waits for the queued frame: a reset sent first would drop it.
      const events: string[] = [];
      const handled = Promise.withResolvers<void>();
      const received = Promise.withResolvers<void>();
      let held: http2.ServerHttp2Stream | undefined;
      let queuedAfterEnd = 0;
      // The default of 10 MB resets a stream that buffers more.
      const server = http2.createServer({ maxSessionMemory: 64 });
      server.on("stream", stream => {
        stream.on("error", handled.reject);
        if (stream.id === 1) {
          held = stream;
          stream.on("prefinish", () => events.push("prefinish"));
          stream.on("finish", () => events.push("finish"));
          return;
        }
        stream.respond({ ":status": 200 });
        // Far more than the socket buffers of both ends take from a peer that does not read.
        stream.write(Buffer.alloc(16 * 1024 * 1024, "b"));
        held!.respond({ ":status": 200 });
        held!.end();
        events.push("end() returned");
        queuedAfterEnd = stream.session!.state.outboundQueueSize!;
        held!.close();
        // 'finish' is one tick after 'prefinish': this tick is queued behind it.
        process.nextTick(handled.resolve);
      });
      const port = await listen(server);
      const frame = (type: number, flags: number, streamId: number, payload = Buffer.alloc(0)) => {
        const header = Buffer.alloc(9);
        header.writeUIntBE(payload.length, 0, 3);
        header[3] = type;
        header[4] = flags;
        header.writeUInt32BE(streamId, 5);
        return Buffer.concat([header, payload]);
      };
      // GET http://localhost/ with static-table indexes and a literal :authority.
      const request = Buffer.concat([Buffer.from([0x82, 0x86, 0x84, 0x01, 9]), Buffer.from("localhost")]);
      // A stream window and a connection window of 2^31-1: only the socket limits the server.
      const window = Buffer.from([0x00, 0x04, 0x7f, 0xff, 0xff, 0xff]);
      const increment = Buffer.alloc(4);
      increment.writeUInt32BE(0x7fffffff - 65535);
      const socket = net.connect(port, "127.0.0.1");
      socket.on("error", received.reject);
      // [type, END_STREAM] of each frame of stream 1, up to its END_STREAM or its RST_STREAM.
      const frames: number[][] = [];
      let buffered = Buffer.alloc(0);
      socket.on("data", chunk => {
        buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk;
        while (buffered.length >= 9) {
          const length = buffered.readUIntBE(0, 3);
          if (buffered.length < 9 + length) break;
          const type = buffered[3];
          const endStream = buffered[4] & 0x1;
          if ((buffered.readUInt32BE(5) & 0x7fffffff) === 1) {
            frames.push([type, endStream]);
            if (type === 3 || (type === 0 && endStream)) received.resolve();
          }
          buffered = buffered.subarray(9 + length);
        }
      });
      try {
        socket.write(
          Buffer.concat([
            Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"),
            frame(4, 0, 0, window),
            frame(8, 0, 0, increment),
            frame(1, 0x5, 1, request),
            frame(1, 0x5, 3, request),
          ]),
        );
        socket.pause();
        await handled.promise;
        // queuedAfterEnd is the premise: the engine holds the END_STREAM frame.
        assert.deepStrictEqual(
          { events, queuedAfterEnd },
          { events: ["prefinish", "end() returned", "finish"], queuedAfterEnd: 1 },
        );
        socket.resume();
        await received.promise;
        // HEADERS, then DATA with END_STREAM. No RST_STREAM comes first.
        assert.deepStrictEqual(frames, [
          [1, 0],
          [0, 1],
        ]);
      } finally {
        socket.destroy();
        server.close();
      }
    });
  });

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
