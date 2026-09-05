import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "crypto";
import { bunEnv, bunExe, tempDir, tls as tlsCert } from "harness";
import http2 from "node:http2";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";
import {
  F,
  Fixture,
  PREFACE,
  RawH2,
  SharedSession,
  T,
  baseHeaders,
  connectH2,
  decodeStatus,
  frame,
  hpackFields,
  hpackLiteral,
  request,
  sha256,
  startFixture,
} from "./serve-http2-helpers";

/** One HTTP/1.1 request on the fixture's port, written byte-exact (no
 * client-side URL normalization), so HTTP/1.1 can serve as the oracle for what
 * the handler must see over h2. Resolves once `content-length` bytes of body
 * have arrived; rejects with whatever was received if the server closes first
 * (a 400, or a response without content-length). */
async function h1Request(port: number, secure: boolean, raw: string): Promise<{ status: number; body: string }> {
  const socket: net.Socket = secure
    ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] })
    : net.connect({ port, host: "127.0.0.1" });
  const { promise, resolve, reject } = Promise.withResolvers<{ status: number; body: string }>();
  let text = "";
  socket.on("error", reject);
  socket.on("close", () =>
    reject(new Error("HTTP/1.1 oracle: connection closed before a complete response: " + JSON.stringify(text))),
  );
  socket.on("data", (chunk: Buffer) => {
    text += chunk.toString("latin1");
    const sep = text.indexOf("\r\n\r\n");
    if (sep === -1) return;
    const head = text.slice(0, sep);
    const body = text.slice(sep + 4);
    const length = Number(/\r\ncontent-length: (\d+)/i.exec(head)?.[1] ?? NaN);
    if (body.length >= length) {
      socket.destroy();
      resolve({ status: Number(head.split(" ")[1]), body: body.slice(0, length) });
    }
  });
  socket.on(secure ? "secureConnect" : "connect", () => socket.write(raw, "latin1"));
  return promise;
}

for (const secure of [true, false]) {
  describe(`Bun.serve http2 (${secure ? "TLS + ALPN" : "cleartext prior-knowledge"})`, () => {
    let fx: Fixture;
    let shared: SharedSession;
    let session: http2.ClientHttp2Session;

    beforeAll(async () => {
      fx = await startFixture({ tls: secure });
      shared = new SharedSession(fx.port, secure);
    });
    beforeEach(async () => {
      session = await shared.get();
    });
    afterAll(async () => {
      shared.close();
      await fx[Symbol.asyncDispose]();
      if (fx.proc.exitCode !== 0) console.error(fx.stderr());
      expect(fx.proc.signalCode).toBeNull();
      expect(fx.proc.exitCode).toBe(0);
    });

    if (secure) {
      test("ALPN negotiated h2", () => {
        expect((session.socket as tls.TLSSocket).alpnProtocol).toBe("h2");
      });
    }

    test("GET through fetch handler", async () => {
      const res = await request(session, { ":path": "/hello" });
      expect(res.status).toBe(200);
      expect(res.headers["x-proto"]).toBe("h2");
      expect(res.headers["content-type"]).toBe("text/plain");
      expect(res.headers["content-length"]).toBe("5");
      expect(res.headers["date"]).toBeString();
      expect(res.body.toString()).toBe("hello");
    });

    // https://github.com/oven-sh/bun/issues/30248
    // RFC 9110 §10.1.1: recognized 100-continue forms dispatch the handler,
    // anything else answers 417 before the handler runs.
    test("Expect dispatch: 100-continue casings reach the handler, unknown expectations 417", async () => {
      // Like `request`, but also records interim responses so the test can
      // assert the 100 arrives before the final status.
      function requestRecordingInterims(headers: http2.OutgoingHttpHeaders, body: string) {
        return new Promise<{ interims: number[]; status: number; body: string }>((resolve, reject) => {
          const req = session.request(headers, { endStream: false });
          const interims: number[] = [];
          const chunks: Buffer[] = [];
          let responseHeaders: http2.IncomingHttpHeaders = {};
          req.on("headers", h => interims.push(Number(h[":status"])));
          req.on("response", h => (responseHeaders = h));
          req.on("data", c => chunks.push(c));
          req.on("end", () =>
            resolve({ interims, status: Number(responseHeaders[":status"]), body: Buffer.concat(chunks).toString() }),
          );
          req.on("error", reject);
          req.end(body);
        });
      }

      const results: Record<string, { interims: number[]; status: number; body: string }> = {};
      for (const value of ["100-continue", "100-Continue", "100-CONTINUE", "muffins", "x100-continue"]) {
        results[value] = await requestRecordingInterims(
          { ":path": "/echo", ":method": "POST", expect: value },
          "hello",
        );
      }
      expect(results).toEqual({
        "100-continue": { interims: [100], status: 201, body: "hello" },
        "100-Continue": { interims: [100], status: 201, body: "hello" },
        "100-CONTINUE": { interims: [100], status: 201, body: "hello" },
        "muffins": { interims: [], status: 417, body: "" },
        "x100-continue": { interims: [], status: 417, body: "" },
      });
    });

    test("POST body is echoed with status and request headers", async () => {
      const res = await request(session, { ":path": "/echo", ":method": "POST", "x-echo": "abc" }, "payload-123");
      expect(res.status).toBe(201);
      expect(res.headers["x-method"]).toBe("POST");
      expect(res.headers["x-echo"]).toBe("abc");
      expect(res.headers["x-len"]).toBe("11");
      expect(res.body.toString()).toBe("payload-123");
    });

    test("POST with END_STREAM on HEADERS (no body) resolves req.text()", async () => {
      const res = await request(session, { ":path": "/echo", ":method": "POST" }, null, { endStream: true });
      expect(res.status).toBe(201);
      expect(res.headers["x-len"]).toBe("0");
    });

    test("204 has no body", async () => {
      const res = await request(session, { ":path": "/status/204" });
      expect(res.status).toBe(204);
      expect(res.headers["x-empty"]).toBe("1");
      expect(res.body.length).toBe(0);
    });

    test("HEAD returns content-length and no body", async () => {
      const res = await request(session, { ":path": "/big", ":method": "HEAD" });
      expect(res.status).toBe(200);
      expect(res.headers["content-length"]).toBe(String(5 * 1024 * 1024));
      expect(res.body.length).toBe(0);
    });

    test("unknown route is 404 from fetch", async () => {
      const res = await request(session, { ":path": "/nope" });
      expect(res.status).toBe(404);
      expect(res.body.toString()).toBe("not found: /nope");
    });

    test("routes: params, per-method, static Response, file route", async () => {
      const api = await request(session, { ":path": "/api/42" });
      expect(api.status).toBe(200);
      expect(api.headers["x-route"]).toBe("api");
      expect(api.body.toString()).toBe("id=42");

      const wrongMethod = await request(session, { ":path": "/route-only" });
      expect(wrongMethod.status).toBe(404);
      const posted = await request(session, { ":path": "/route-only", ":method": "POST" }, "x");
      expect(posted.body.toString()).toBe("posted");

      const st = await request(session, { ":path": "/static" });
      expect(st.status).toBe(200);
      expect(st.headers["etag"]).toBe('"v1"');
      expect(st.body.toString()).toBe("from-static-route");

      const notModified = await request(session, { ":path": "/static", "if-none-match": '"v1"' });
      expect(notModified.status).toBe(304);
      expect(notModified.body.length).toBe(0);

      const file = await request(session, { ":path": "/file-route" });
      expect(file.status).toBe(200);
      expect(file.headers["content-length"]).toBe(String(3 * 1024 * 1024 + 17));
      expect(file.body.length).toBe(3 * 1024 * 1024 + 17);
      expect(sha256(file.body)).toBe(sha256(Buffer.alloc(3 * 1024 * 1024 + 17, "0123456789")));

      const ranged = await request(session, { ":path": "/file-route", range: "bytes=10-19" });
      expect(ranged.status).toBe(206);
      expect(ranged.body.toString()).toBe("0123456789");
    });

    test("request url and headers reach the handler; :authority becomes host", async () => {
      const res = await request(session, {
        ":path": "/headers?x=1",
        ":authority": "example.test:9",
        "x-a": "1",
        "x-long": Buffer.alloc(6000, "L").toString(),
        cookie: "k=v",
      });
      const json = JSON.parse(res.body.toString());
      expect(json.url).toBe(`${secure ? "https" : "http"}://example.test:9/headers?x=1`);
      expect(json.method).toBe("GET");
      expect(json.headers["x-a"]).toBe("1");
      expect(json.headers["x-long"]).toHaveLength(6000);
      expect(json.headers["host"]).toBe("example.test:9");
      expect(json.headers["cookie"]).toBe("k=v");
    });

    // The HTTP/1 path builds req.url through the WHATWG parser (dot segments
    // collapse, the path and query are percent-encoded). The h2 path used to
    // paste :path in verbatim, so a guard or cache keyed on req.url saw a
    // different string per transport for the same resource.
    test("req.url is normalized the same way HTTP/1.1 normalizes it on the same port", async () => {
      const scheme = secure ? "https" : "http";
      const raw = await RawH2.connect(fx.port, secure);
      let streamId = 1;
      for (const [path, expected] of [
        ["/a/../headers", "/headers"],
        ["/./headers", "/headers"],
        ["/%2e/headers", "/headers"],
        ['/headers?q=a"b<c>', "/headers?q=a%22b%3Cc%3E"],
      ]) {
        raw.headers(streamId, baseHeaders(path));
        const h2 = JSON.parse((await raw.body(streamId)).toString());
        expect([path, h2.url]).toEqual([path, `${scheme}://localhost${expected}`]);
        streamId += 2;
        const h1 = await h1Request(fx.port, secure, `GET ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
        expect([path, JSON.parse(h1.body).url]).toEqual([path, h2.url]);
      }
      raw.close();
    });

    // HTTP/1 gives req.body === null for a request that promises no body (no
    // Content-Length, no Transfer-Encoding, or content-length: 0). The h2
    // path used to hand every non-GET/HEAD request an empty stream instead, so
    // `if (req.body)` and `fetch(upstream, { body: req.body })` diverged.
    test.each(["GET", "POST", "DELETE", "OPTIONS", "PURGE"])(
      "req.body is null for a %s whose HEADERS frame carries END_STREAM",
      async method => {
        const res = await request(session, { ":path": "/body-null", ":method": method }, null, { endStream: true });
        expect([res.headers["x-method"], res.body.toString()]).toEqual([method, "true"]);
      },
    );

    test("req.body is null for content-length: 0 and a stream otherwise, as over HTTP/1.1", async () => {
      const withBody = await request(session, { ":path": "/body-null", ":method": "POST" }, "x");
      expect(withBody.body.toString()).toBe("false");

      const raw = await RawH2.connect(fx.port, secure);
      // content-length: 0 without END_STREAM: no byte can follow, the empty
      // DATA frame only completes the stream.
      raw.headers(1, [...baseHeaders("/body-null", "POST"), ["content-length", "0"]], F.END_HEADERS);
      raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.alloc(0)));
      expect((await raw.body(1)).toString()).toBe("true");
      // No content-length and no END_STREAM: bytes may still follow, so the
      // body is a stream (an empty one here).
      raw.headers(3, baseHeaders("/body-null", "POST"), F.END_HEADERS);
      raw.write(frame(T.DATA, F.END_STREAM, 3, Buffer.alloc(0)));
      expect((await raw.body(3)).toString()).toBe("false");
      raw.close();

      // The HTTP/1.1 oracle on the same port.
      const h1 = (headers: string, body = "") =>
        h1Request(fx.port, secure, `POST /body-null HTTP/1.1\r\nHost: localhost\r\n${headers}\r\n${body}`);
      expect((await h1("")).body).toBe("true");
      expect((await h1("Content-Length: 0\r\n")).body).toBe("true");
      expect((await h1("Content-Length: 1\r\n", "x")).body).toBe("false");
    });

    test("split cookie fields are joined with '; '", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      await raw.waitFor(f => f.type === T.SETTINGS);
      raw.headers(1, [...baseHeaders("/headers"), ["cookie", "a=1"], ["cookie", "b=2"]]);
      const data = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1);
      expect(JSON.parse(data.payload.toString()).headers.cookie).toBe("a=1; b=2");
      raw.close();
    });

    test("multi-value response headers and set-cookie", async () => {
      const res = await request(session, { ":path": "/set-cookies" });
      expect(res.headers["set-cookie"]).toEqual(["a=1", "b=2"]);
      expect(res.headers["x-multi"]).toBe("1, 2");
      const viaCookieMap = await request(session, { ":path": "/cookies", cookie: "seen=xx" });
      expect(viaCookieMap.headers["set-cookie"]).toEqual(["seen=xxx; Path=/; SameSite=Lax"]);
    });

    test("latin-1 header values are one byte per code unit for 8-bit and 16-bit strings", async () => {
      // https://fetch.spec.whatwg.org/#concept-header-value
      // U+00E9 is the single byte 0xE9 on the wire, not UTF-8 0xC3 0xA9, whether JSC
      // stores the string as 8-bit or 16-bit. Both names are in the HPACK static table
      // (content-disposition = 25, set-cookie = 55), so the fields arrive as literals
      // with an indexed name. A fresh connection per request keeps the dynamic table
      // out of the picture.
      const expected = "63 61 66 e9 2d 80 ff";
      const hex = (b: Buffer) => [...b].map(c => c.toString(16).padStart(2, "0")).join(" ");
      for (const bits of ["8", "16"]) {
        const raw = await RawH2.connect(fx.port, secure);
        try {
          await raw.waitFor(f => f.type === T.SETTINGS);
          raw.headers(1, baseHeaders(`/latin1-headers?bits=${bits}`));
          const headers = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
          const fields = hpackFields(headers.payload);
          const literal = (index: number) => {
            const field = fields.find(f => f.index === index && f.value);
            if (!field?.value) throw new Error(`no literal for static name ${index} in ${JSON.stringify(fields)}`);
            // These bytes cost more Huffman-coded than raw, so the encoder sends them as is.
            expect(field.value.huffman).toBe(false);
            return hex(field.value.bytes);
          };
          expect({ bits, "content-disposition": literal(25), "set-cookie": literal(55) }).toEqual({
            bits,
            "content-disposition": expected,
            "set-cookie": "61 3d " + expected,
          });
        } finally {
          raw.close();
        }
      }
    });

    test("5 MB response body (flow control + socket backpressure)", async () => {
      const res = await request(session, { ":path": "/big" });
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(5 * 1024 * 1024);
      expect(res.body.subarray(0, 16).toString()).toBe("abcdefghijklmnop");
      expect(sha256(res.body)).toBe(sha256(Buffer.alloc(5 * 1024 * 1024, "abcdefghijklmnop")));
    });

    test("2 MB request body streamed to the handler (WINDOW_UPDATE path)", async () => {
      const body = randomBytes(2 * 1024 * 1024);
      const res = await request(session, { ":path": "/digest", ":method": "POST" }, body);
      expect(res.status).toBe(200);
      expect(res.headers["x-len"]).toBe(String(body.length));
      expect(res.body.toString()).toBe(sha256(body));
    });

    test("request body without content-length", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      await raw.waitFor(f => f.type === T.SETTINGS);
      raw.headers(1, baseHeaders("/echo", "POST"), F.END_HEADERS);
      raw.write(frame(T.DATA, 0, 1, Buffer.from("part1-")));
      raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("part2")));
      const h = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
      expect(decodeStatus(h.payload)).toBe(201);
      const d = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload.length > 0);
      expect(d.payload.toString()).toBe("part1-part2");
      raw.close();
    });

    test("pseudo-header in request trailers → RST_STREAM PROTOCOL_ERROR", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      await raw.waitFor(f => f.type === T.SETTINGS);
      raw.headers(1, baseHeaders("/echo", "POST"), F.END_HEADERS);
      raw.write(frame(T.DATA, 0, 1, Buffer.from("body")));
      raw.headers(1, [[":path", "/x"]], F.END_HEADERS | F.END_STREAM);
      expect(await raw.rst(1)).toBe(1);
      raw.close();
    });

    test("request trailers end the body", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      await raw.waitFor(f => f.type === T.SETTINGS);
      raw.headers(1, baseHeaders("/echo", "POST"), F.END_HEADERS);
      raw.write(frame(T.DATA, 0, 1, Buffer.from("body")));
      raw.headers(1, [["x-trailer", "t"]], F.END_HEADERS | F.END_STREAM);
      const d = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload.length > 0);
      expect(d.payload.toString()).toBe("body");
      raw.close();
    });

    test("padded HEADERS and DATA, PRIORITY flag", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      await raw.waitFor(f => f.type === T.SETTINGS);
      const block = hpackLiteral(baseHeaders("/echo", "POST"));
      // PADDED + PRIORITY: [padLen][streamDep(4)][weight][block][padding]
      const hp = Buffer.concat([Buffer.from([3]), Buffer.from([0, 0, 0, 0, 15]), block, Buffer.alloc(3)]);
      raw.write(frame(T.HEADERS, F.END_HEADERS | F.PADDED | F.PRIORITY, 1, hp));
      const dp = Buffer.concat([Buffer.from([5]), Buffer.from("padded-body"), Buffer.alloc(5)]);
      raw.write(frame(T.DATA, F.END_STREAM | F.PADDED, 1, dp));
      const d = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload.length > 0);
      expect(d.payload.toString()).toBe("padded-body");
      raw.close();
    });

    test("CONTINUATION frames are reassembled", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      await raw.waitFor(f => f.type === T.SETTINGS);
      // 12 KB header (under the 16 KB default list limit) split 4K/4K/rest.
      const block = hpackLiteral([...baseHeaders("/headers"), ["x-big", Buffer.alloc(12000, "B").toString()]]);
      raw.write(frame(T.HEADERS, 0, 1, block.subarray(0, 4000)));
      raw.write(frame(T.CONTINUATION, 0, 1, block.subarray(4000, 8000)));
      raw.write(frame(T.CONTINUATION, F.END_HEADERS, 1, block.subarray(8000)));
      // No END_STREAM on HEADERS; finish the (empty) body.
      raw.write(frame(T.DATA, F.END_STREAM, 1));
      expect(JSON.parse((await raw.body(1)).toString()).headers["x-big"]).toHaveLength(12000);
      raw.close();
    });

    test("ReadableStream response", async () => {
      const res = await request(session, { ":path": "/stream" });
      expect(res.status).toBe(200);
      // 64 chunks of "chunk" + i + 1019×";"
      expect(res.body.length).toBe(64 * 1024 + 9 * 1 + 55 * 2);
      expect(res.body.subarray(0, 7).toString()).toBe("chunk1;");
    });

    test("Bun.file response via fetch handler, and via .stream()", async () => {
      const expected = sha256(Buffer.alloc(3 * 1024 * 1024 + 17, "0123456789"));
      const a = await request(session, { ":path": "/file" });
      expect(a.headers["content-length"]).toBe(String(3 * 1024 * 1024 + 17));
      expect(sha256(a.body)).toBe(expected);
      const b = await request(session, { ":path": "/file-stream" });
      expect(sha256(b.body)).toBe(expected);
    });

    test("Response(req.body) passthrough", async () => {
      const body = randomBytes(300 * 1024);
      const res = await request(session, { ":path": "/passthrough", ":method": "POST" }, body);
      expect(res.headers["x-passthrough"]).toBe("1");
      expect(sha256(res.body)).toBe(sha256(body));
    });

    test("100 concurrent streams on one connection", async () => {
      const results = await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          request(session, { ":path": "/echo", ":method": "POST", "x-echo": String(i) }, "body-" + i),
        ),
      );
      for (let i = 0; i < 100; i++) {
        expect(results[i].headers["x-echo"]).toBe(String(i));
        expect(results[i].body.toString()).toBe("body-" + i);
      }
    });

    test("8 concurrent large downloads on one connection are byte-exact", async () => {
      const results = await Promise.all(Array.from({ length: 8 }, () => request(session, { ":path": "/big" })));
      const expected = sha256(Buffer.alloc(5 * 1024 * 1024, "abcdefghijklmnop"));
      for (const r of results) expect(sha256(r.body)).toBe(expected);
    }, 30000); // 40 MB through 64 KB client windows; slow on debug/ASAN

    test("expect: 100-continue gets an interim response", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      await raw.waitFor(f => f.type === T.SETTINGS);
      raw.headers(1, [...baseHeaders("/echo", "POST"), ["expect", "100-continue"]], F.END_HEADERS);
      const interim = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
      expect(decodeStatus(interim.payload)).toBe(100);
      expect(interim.flags & F.END_STREAM).toBe(0);
      raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("after-continue")));
      const d = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload.length > 0);
      expect(d.payload.toString()).toBe("after-continue");
      raw.close();
    });

    test("server.requestIP works", async () => {
      const res = await request(session, { ":path": "/ip" });
      const ip = JSON.parse(res.body.toString());
      expect(["127.0.0.1", "::ffff:127.0.0.1", "::1"]).toContain(ip.address);
      expect(ip.port).toBeGreaterThan(0);
    });

    test("server.upgrade() returns false", async () => {
      const res = await request(session, {
        ":path": "/upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      });
      expect(res.status).toBe(200);
      expect(res.body.toString()).toBe("false");
    });

    test("client RST_STREAM fires req.signal and leaves the connection usable", async () => {
      const before = (fx.stderr().match(/ABORTED/g) ?? []).length;
      const req = session.request({ ":path": "/abort" });
      req.on("error", () => {});
      // A round trip on the same connection: HEADERS for /abort has reached the server.
      await request(session, { ":path": "/hello" });
      req.close(http2.constants.NGHTTP2_CANCEL);
      while ((fx.stderr().match(/ABORTED/g) ?? []).length === before) {
        await request(session, { ":path": "/hello" });
      }
      const ok = await request(session, { ":path": "/hello" });
      expect(ok.body.toString()).toBe("hello");
    });

    test("PING is answered", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      raw.write(frame(T.PING, 0, 0, Buffer.from("pingpong")));
      const pong = await raw.waitFor(f => f.type === T.PING && (f.flags & F.ACK) !== 0);
      expect(pong.payload.toString()).toBe("pingpong");
      raw.close();
    });

    test("server SETTINGS and SETTINGS ACK", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      const settings = await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) === 0);
      const map = new Map<number, number>();
      for (let i = 0; i + 6 <= settings.payload.length; i += 6) {
        map.set(settings.payload.readUInt16BE(i), settings.payload.readUInt32BE(i + 2));
      }
      expect(map.get(3)).toBeGreaterThanOrEqual(100); // MAX_CONCURRENT_STREAMS
      expect(map.get(4)).toBeGreaterThanOrEqual(65535); // INITIAL_WINDOW_SIZE
      expect(map.get(5)).toBeGreaterThanOrEqual(16384); // MAX_FRAME_SIZE
      expect(map.get(6)).toBeGreaterThan(0); // MAX_HEADER_LIST_SIZE advertised
      expect(map.get(8) ?? 0).toBe(0); // no extended CONNECT
      await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
      // The connection window is widened right after SETTINGS; a 1 MiB upload
      // in 16 KB frames needs no further connection-level credit.
      const wu = await raw.waitFor(f => f.type === T.WINDOW_UPDATE && f.streamId === 0);
      expect(65535 + wu.payload.readUInt32BE(0)).toBeGreaterThanOrEqual(1 << 20);
      raw.headers(1, baseHeaders("/digest", "POST"), F.END_HEADERS);
      const chunk = Buffer.alloc(16384, 7);
      for (let i = 0; i < 63; i++) raw.write(frame(T.DATA, 0, 1, chunk));
      raw.write(frame(T.DATA, F.END_STREAM, 1, chunk));
      expect((await raw.body(1)).toString()).toBe(
        new Bun.CryptoHasher("sha256").update(Buffer.alloc(1 << 20, 7)).digest("hex"),
      );
      raw.close();
    });

    test("request body: stream window stays at the initial 64 KB until the handler reads, then opens", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
      raw.headers(1, [...baseHeaders("/late-read", "POST"), ["content-length", String(1 << 20)]], F.END_HEADERS);
      // Fill exactly the advertised 64 KB stream window.
      for (let i = 0; i < 4; i++) raw.write(frame(T.DATA, 0, 1, Buffer.alloc(16384, 1)));
      raw.write(frame(T.PING, 0, 0, Buffer.from("windowed")));
      await raw.waitFor(f => f.type === T.PING && f.payload.toString() === "windowed");
      // Handler hasn't touched req.body yet: no stream-level WINDOW_UPDATE.
      expect(raw.frames.some(f => f.type === T.WINDOW_UPDATE && f.streamId === 1)).toBe(false);
      // Let the handler start reading; the window opens and the rest of the body is accepted.
      raw.headers(3, baseHeaders("/release-late-read"));
      expect((await raw.body(3)).toString()).toBe("released");
      const wu = await raw.waitFor(f => f.type === T.WINDOW_UPDATE && f.streamId === 1);
      expect(wu.payload.readUInt32BE(0)).toBeGreaterThanOrEqual((1 << 20) - 65536);
      for (let sent = 65536; sent < 1 << 20; sent += 16384) {
        raw.write(frame(T.DATA, sent + 16384 >= 1 << 20 ? F.END_STREAM : 0, 1, Buffer.alloc(16384, 1)));
      }
      expect((await raw.body(1)).toString()).toBe(String(1 << 20));
      raw.close();
    });

    test("response respects a small peer INITIAL_WINDOW_SIZE", async () => {
      const settings = Buffer.alloc(6);
      settings.writeUInt16BE(4, 0);
      settings.writeUInt32BE(1024, 2);
      const raw = await RawH2.connect(fx.port, secure, { settings });
      await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
      raw.headers(1, baseHeaders("/big"));
      await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
      // Give the server a chance to (wrongly) overrun the window.
      await raw.waitFor(f => f.type === T.DATA && f.streamId === 1);
      raw.write(frame(T.PING, 0, 0, Buffer.from("12345678")));
      await raw.waitFor(f => f.type === T.PING);
      const received = () =>
        raw.frames.filter(f => f.type === T.DATA && f.streamId === 1).reduce((a, f) => a + f.payload.length, 0);
      expect(received()).toBe(1024);
      // Open the stream window; the connection window (65535) becomes the limit.
      const inc = Buffer.alloc(4);
      inc.writeUInt32BE(10 * 1024 * 1024, 0);
      raw.write(frame(T.WINDOW_UPDATE, 0, 1, inc));
      raw.write(frame(T.PING, 0, 0, Buffer.from("abcdefgh")));
      await raw.waitFor(f => f.type === T.PING && f.payload.toString() === "abcdefgh");
      while (received() < 65535) await raw.waitFor(f => f.type === T.DATA && received() >= 65535);
      expect(received()).toBe(65535);
      // Now open the connection window and drain the rest.
      raw.write(frame(T.WINDOW_UPDATE, 0, 0, inc));
      await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
      expect(received()).toBe(5 * 1024 * 1024);
      for (const f of raw.frames) if (f.type === T.DATA) expect(f.payload.length).toBeLessThanOrEqual(16384);
      raw.close();
    });
    if (secure) {
      test("fetch(protocol: 'http2') talks h2 to Bun.serve", async () => {
        const res = await fetch(`https://127.0.0.1:${fx.port}/echo`, {
          method: "POST",
          body: "via-fetch",
          protocol: "http2",
          tls: { rejectUnauthorized: false },
        } as RequestInit);
        expect(res.status).toBe(201);
        expect(await res.text()).toBe("via-fetch");
      });

      test("ALPN http/1.1-only client is served HTTP/1.1", async () => {
        const body = await new Promise<string>((resolve, reject) => {
          const s = tls.connect(
            { port: fx.port, host: "127.0.0.1", ALPNProtocols: ["http/1.1"], rejectUnauthorized: false },
            () => {
              expect(s.alpnProtocol).toBe("http/1.1");
              s.write("GET /hello HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
            },
          );
          let out = "";
          s.on("data", d => (out += d));
          s.on("end", () => resolve(out));
          s.on("error", reject);
        });
        expect(body).toStartWith("HTTP/1.1 200 OK\r\n");
        expect(body).toEndWith("hello");
      });
    }
  });
}

describe("Bun.serve http2 with SNI (serverName + tls[])", () => {
  // A named handshake goes through the per-name SSL_CTX that addServerName()
  // built, so ALPN has to be enabled on that context too.
  const sniFixture = (http1: boolean) => `
    const tls = ${JSON.stringify(tlsCert)};
    const server = Bun.serve({
      port: 0,
      http2: true,
      http1: ${http1},
      tls: [{ ...tls, serverName: "default.test" }, { ...tls, serverName: "named.test" }],
      fetch: () => new Response("sni"),
    });
    console.log(JSON.stringify({ port: server.port }));
    setInterval(() => {}, 1 << 30);
  `;
  async function start(http1: boolean) {
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", sniFixture(http1)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const reader = proc.stdout.getReader();
    let line = "";
    while (!line.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("fixture exited");
      line += Buffer.from(value).toString();
    }
    reader.releaseLock();
    return { proc, port: JSON.parse(line).port as number };
  }
  // Resolves the negotiated ALPN protocol, or "refused" if the server aborts
  // the handshake (no_application_protocol). Never destroys from inside the
  // handshake callback.
  const alpnFor = (port: number, servername: string | undefined, protos: string[]) =>
    new Promise<string | false | null>(resolve => {
      let settled = false;
      const done = (v: string | false | null) => {
        if (settled) return;
        settled = true;
        resolve(v);
        setImmediate(() => s.destroy());
      };
      const s = tls.connect({ port, host: "127.0.0.1", servername, ALPNProtocols: protos, rejectUnauthorized: false });
      s.once("secureConnect", () => done(s.alpnProtocol));
      s.once("error", () => done("refused"));
      s.once("close", () => done("refused"));
    });

  test("h2 is negotiated for the default name, a matched serverName, and an unmatched one", async () => {
    const { proc, port } = await start(true);
    try {
      expect(await alpnFor(port, undefined, ["h2", "http/1.1"])).toBe("h2");
      expect(await alpnFor(port, "named.test", ["h2", "http/1.1"])).toBe("h2");
      expect(await alpnFor(port, "default.test", ["h2", "http/1.1"])).toBe("h2");
      expect(await alpnFor(port, "unknown.test", ["h2", "http/1.1"])).toBe("h2");
      expect(await alpnFor(port, "named.test", ["http/1.1"])).toBe("http/1.1");
    } finally {
      proc.kill();
      await proc.exited;
    }
  });

  test("http1: false refuses an http/1.1-only client through a named context too", async () => {
    const { proc, port } = await start(false);
    try {
      expect(await alpnFor(port, "named.test", ["h2"])).toBe("h2");
      expect(await alpnFor(port, "named.test", ["http/1.1"])).toBe("refused");
    } finally {
      proc.kill();
      await proc.exited;
    }
  });
});

describe("Bun.serve http2 with http1: false", () => {
  test("TLS: h2 works, http/1.1-only ALPN is refused, no-ALPN client gets 505", async () => {
    await using fx = await startFixture({ tls: true, http1: false });
    const session = await connectH2(fx.port, true);
    expect((await request(session, { ":path": "/hello" })).body.toString()).toBe("hello");
    session.close();

    const alpnError = await new Promise<Error | string>(resolve => {
      const s = tls.connect(
        { port: fx.port, host: "127.0.0.1", ALPNProtocols: ["http/1.1"], rejectUnauthorized: false },
        () => resolve("connected:" + s.alpnProtocol),
      );
      s.on("error", e => resolve(e));
    });
    expect(alpnError).toBeInstanceOf(Error);

    const noAlpn = await new Promise<string>((resolve, reject) => {
      const s = tls.connect({ port: fx.port, host: "127.0.0.1", rejectUnauthorized: false }, () => {
        s.write("GET /hello HTTP/1.1\r\nHost: x\r\n\r\n");
      });
      let out = "";
      s.on("data", d => (out += d));
      s.on("close", () => resolve(out));
      s.on("error", reject);
    });
    expect(noAlpn).toStartWith("HTTP/1.1 505 ");
  });

  test("cleartext: preface trickled in 1-3 byte reads is still HTTP/2; a short HTTP/1 first read is replayed", async () => {
    await using fx = await startFixture({ tls: false });
    // h2: "PR", "I", " * H", rest — the first two reads are too short to decide.
    const sock = net.connect(fx.port, "127.0.0.1");
    await new Promise<void>(r => sock.once("connect", () => r()));
    const writeAndFlush = (b: Buffer | string) =>
      new Promise<void>((res, rej) => sock.write(b, e => (e ? rej(e) : setTimeout(res, 20))));
    await writeAndFlush(PREFACE.subarray(0, 2));
    await writeAndFlush(PREFACE.subarray(2, 3));
    await writeAndFlush(PREFACE.subarray(3, 7));
    sock.write(Buffer.concat([PREFACE.subarray(7), frame(T.SETTINGS, 0, 0)]));
    sock.write(frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 1, hpackLiteral(baseHeaders("/hello"))));
    const got = await new Promise<string>(resolve => {
      let buf = Buffer.alloc(0);
      sock.on("data", d => {
        buf = Buffer.concat([buf, d]);
        for (let off = 0; off + 9 <= buf.length; ) {
          const len = buf.readUIntBE(off, 3);
          if (off + 9 + len > buf.length) break;
          if (buf[off + 3] === T.DATA && (buf.readUInt32BE(off + 5) & 0x7fffffff) === 1)
            return resolve(buf.subarray(off + 9, off + 9 + len).toString());
          off += 9 + len;
        }
      });
    });
    expect(got).toBe("hello");
    sock.destroy();

    // HTTP/1: "PR" alone matches the preface prefix and is held; the next read
    // decides against HTTP/2 and both pieces reach the HTTP/1 parser.
    const h1 = net.connect(fx.port, "127.0.0.1");
    await new Promise<void>(r => h1.once("connect", () => r()));
    await new Promise<void>((res, rej) => h1.write("PR", e => (e ? rej(e) : setTimeout(res, 20))));
    h1.write("OPFIND /hello HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    const response = await new Promise<string>(resolve => {
      let out = "";
      h1.on("data", d => (out += d));
      h1.on("close", () => resolve(out));
    });
    expect(response).toStartWith("HTTP/1.1 200 OK\r\n");
    expect(response).toEndWith("hello");
  });

  test("cleartext: prior-knowledge works, HTTP/1.1 gets 505", async () => {
    await using fx = await startFixture({ tls: false, http1: false });
    const session = await connectH2(fx.port, false);
    expect((await request(session, { ":path": "/hello" })).body.toString()).toBe("hello");
    session.close();
    const res = await fetch(`http://127.0.0.1:${fx.port}/hello`);
    expect(res.status).toBe(505);
  });

  test("development server with HTML imports: http2 is ignored, and http1: false is rejected", async () => {
    using dir = tempDir("serve-http2-dev", {
      "index.html": "<!doctype html><script src='./a.js'></script>",
      "a.js": "console.log(1)",
      "serve.ts": `
        import index from "./index.html";
        try {
          Bun.serve({ port: 0, http2: true, http1: process.argv[2] !== "no-h1", development: true, routes: { "/": index }, fetch: () => new Response("x") }).stop();
          console.log("ok");
        } catch (e) { console.log("threw: " + e.message); }
      `,
    });
    for (const [arg, expected] of [
      ["", "ok"],
      [
        "no-h1",
        "threw: http1: false with http2: true is not supported while the development server (HTML imports with HMR) is active",
      ],
    ]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "serve.ts", arg],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.trim()).toBe(expected);
      if (arg === "") expect(stderr).toContain("http2: true is ignored");
    }
  });

  test("validation: http1: false alone throws", () => {
    expect(() => Bun.serve({ port: 0, http1: false, fetch: () => new Response("x") })).toThrow(
      "Cannot disable http1 without enabling http2 or http3",
    );
  });
});

describe("Bun.serve http2 over a unix socket", () => {
  test("prior-knowledge h2c", async () => {
    using dir = tempDir("serve-http2-unix", {});
    const sock = join(String(dir), "h2.sock");
    await using server = Bun.serve({
      unix: sock,
      http2: true,
      fetch: req => new Response("unix:" + new URL(req.url).pathname),
    });
    const session = http2.connect("http://localhost", {
      createConnection: () => net.connect(sock) as any,
    });
    await new Promise<void>((resolve, reject) => {
      session.once("connect", () => resolve());
      session.once("error", reject);
    });
    const res = await request(session, { ":path": "/u" });
    expect(res.body.toString()).toBe("unix:/u");
    await new Promise<void>(r => session.close(() => r()));
  });
});

describe("Bun.serve http2 in-process", () => {
  test("routes + fetch, reload, stop", async () => {
    await using server = Bun.serve({
      port: 0,
      http2: true,
      routes: { "/r": new Response("route-v1") },
      fetch: () => new Response("fetch-v1"),
    });
    const session = await connectH2(server.port, false);
    expect((await request(session, { ":path": "/r" })).body.toString()).toBe("route-v1");
    expect((await request(session, { ":path": "/x" })).body.toString()).toBe("fetch-v1");
    server.reload({ routes: { "/r": new Response("route-v2") }, fetch: () => new Response("fetch-v2") });
    expect((await request(session, { ":path": "/r" })).body.toString()).toBe("route-v2");
    expect((await request(session, { ":path": "/x" })).body.toString()).toBe("fetch-v2");
    const closed = new Promise<void>(r => session.once("close", () => r()));
    await server.stop();
    // Graceful stop sent GOAWAY; the idle session is closed by the server.
    await closed;
  });

  test("handler throwing produces 500 over h2", async () => {
    await using server = Bun.serve({
      port: 0,
      http2: true,
      development: false,
      fetch() {
        throw new Error("boom");
      },
      error() {
        return new Response("handled", { status: 555 });
      },
    });
    const session = await connectH2(server.port, false);
    const res = await request(session, { ":path": "/" });
    expect(res.status).toBe(555);
    expect(res.body.toString()).toBe("handled");
    await new Promise<void>(r => session.close(() => r()));
  });

  test("async handler that responds after the client reset the stream", async () => {
    const { promise: gotRequest, resolve: markRequest } = Promise.withResolvers<void>();
    const { promise: release, resolve: doRelease } = Promise.withResolvers<void>();
    let aborted = 0;
    await using server = Bun.serve({
      port: 0,
      http2: true,
      async fetch(req) {
        req.signal.addEventListener("abort", () => aborted++);
        markRequest();
        await release;
        return new Response("late");
      },
    });
    const session = await connectH2(server.port, false);
    const req = session.request({ ":path": "/" });
    req.on("error", () => {});
    await gotRequest;
    req.close(http2.constants.NGHTTP2_CANCEL);
    // Round-trip a PING so the RST_STREAM has been processed.
    while (aborted === 0) {
      await new Promise<void>((resolve, reject) => session.ping((err: any) => (err ? reject(err) : resolve())));
    }
    doRelease();
    // The late Response lands on a dead stream; the connection must survive it.
    await new Promise<void>((resolve, reject) => session.ping((err: any) => (err ? reject(err) : resolve())));
    expect(aborted).toBe(1);
    await new Promise<void>(r => session.close(() => r()));
  });
});
