import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import http2 from "node:http2";
import { deflateRawSync, inflateRawSync, constants as zlibConstants } from "node:zlib";
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
  hpackLiteral,
  request,
  startFixture,
  wsClientFrame,
  wsServerFrame,
} from "./serve-http2-helpers";

// Frame-level conformance (RFC 9113 / 7541) driven by the raw client. TLS adds
// nothing at this layer, so these run over cleartext prior-knowledge only; the
// API-level suite in serve-http2.test.ts covers both transports.
const secure = false;

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};

const setting = (id: number, v: number) => {
  const b = Buffer.alloc(6);
  b.writeUInt16BE(id);
  b.writeUInt32BE(v >>> 0, 2);
  return b;
};

const received = (raw: RawH2, id: number) =>
  raw.frames.filter(f => f.type === T.DATA && f.streamId === id).reduce((a, f) => a + f.payload.length, 0);

const websocketHeaders = (path = "/ws"): [string, string][] => [
  [":method", "CONNECT"],
  [":scheme", "http"],
  [":path", path],
  [":authority", "localhost"],
  [":protocol", "websocket"],
  ["sec-websocket-version", "13"],
];

const perMessageDeflateTail = Buffer.from([0x00, 0x00, 0xff, 0xff]);
const deflateWebSocketMessage = (payload: Buffer | string) => {
  const encoded = deflateRawSync(Buffer.from(payload), {
    flush: zlibConstants.Z_SYNC_FLUSH,
    finishFlush: zlibConstants.Z_SYNC_FLUSH,
  });
  return encoded.subarray(0, encoded.length - perMessageDeflateTail.length);
};
const inflateWebSocketMessage = (payload: Buffer) =>
  inflateRawSync(Buffer.concat([payload, perMessageDeflateTail]), { finishFlush: zlibConstants.Z_SYNC_FLUSH });

/** node:http2 deliberately does not preserve peer DATA-frame boundaries.
 * Accumulate one complete RFC 6455 server frame rather than assuming one
 * stream `data` event is one WebSocket frame. */
const nextHttp2WebSocketFrame = (stream: http2.ClientHttp2Stream) =>
  new Promise<Buffer>((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const cleanup = () => {
      stream.off("data", onData);
      stream.off("error", onError);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk: Buffer | Uint8Array) => {
      buffered = Buffer.concat([buffered, Buffer.from(chunk)]);
      if (buffered.length < 2) return;
      const marker = buffered[1] & 0x7f;
      const headerLength = marker < 126 ? 2 : marker === 126 ? 4 : 10;
      if (buffered.length < headerLength) return;
      const payloadLength =
        marker < 126 ? marker : marker === 126 ? buffered.readUInt16BE(2) : Number(buffered.readBigUInt64BE(2));
      const frameLength = headerLength + payloadLength;
      if (buffered.length < frameLength) return;
      cleanup();
      resolve(buffered.subarray(0, frameLength));
    };
    stream.on("data", onData);
    stream.on("error", onError);
  });

/** Build a masked client frame with an explicitly selected length encoding.
 * RFC 6455 requires the shortest possible encoding and reserves the high bit
 * of the 64-bit form.  wsClientFrame() intentionally only emits canonical
 * frames, so malformed-wire tests use this helper. */
const wsClientFrameWithLengthEncoding = (
  opcode: number,
  payload: Buffer | string,
  marker: 126 | 127,
  declaredLength: number | bigint,
) => {
  const body = Buffer.from(payload);
  const extended = marker === 126 ? 2 : 8;
  const out = Buffer.alloc(2 + extended + 4 + body.length);
  out[0] = 0x80 | opcode;
  out[1] = 0x80 | marker;
  if (marker === 126) out.writeUInt16BE(Number(declaredLength), 2);
  else out.writeBigUInt64BE(BigInt(declaredLength), 2);
  const maskAt = 2 + extended;
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  mask.copy(out, maskAt);
  for (let i = 0; i < body.length; i++) out[maskAt + 4 + i] = body[i] ^ mask[i & 3];
  return out;
};

const barrier = async (raw: RawH2, tag: string) => {
  raw.write(frame(T.PING, 0, 0, Buffer.from(tag.padEnd(8).slice(0, 8))));
  await raw.waitFor(
    f => f.type === T.PING && (f.flags & F.ACK) !== 0 && f.payload.toString() === tag.padEnd(8).slice(0, 8),
  );
};

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
  shared?.close();
  await fx?.[Symbol.asyncDispose]();
  if (fx && fx.proc.exitCode !== 0) console.error(fx.stderr());
  expect(fx?.proc.signalCode ?? null).toBeNull();
});

describe.concurrent("Bun.serve http2 protocol", () => {
  test("SETTINGS_ENABLE_CONNECT_PROTOCOL cannot be disabled after being enabled", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.write(Buffer.concat([frame(T.SETTINGS, 0, 0, setting(8, 1)), frame(T.SETTINGS, 0, 0, setting(8, 0))]));
    expect((await raw.goaway()).code).toBe(1); // PROTOCOL_ERROR
    raw.close();
  });

  for (const [name, id] of [
    ["known", 8],
    ["unknown", 0xf00d],
  ] as const) {
    test(`duplicate ${name} SETTINGS identifier → GOAWAY PROTOCOL_ERROR`, async () => {
      const raw = await RawH2.connect(fx.port, secure);
      raw.write(frame(T.SETTINGS, 0, 0, Buffer.concat([setting(id, 1), setting(id, 1)])));
      expect((await raw.goaway()).code).toBe(1);
      raw.close();
    });
  }

  test("bad preface closes the connection", async () => {
    const raw = await RawH2.connect(fx.port, secure, { sendPreface: false });
    raw.write(Buffer.from("PRI * HTTP/2.0\r\n\r\nXX\r\n\r\n"));
    raw.write(frame(T.SETTINGS, 0, 0));
    await raw.waitForClose();
    // and the server is still fine
    expect((await request(session, { ":path": "/hello" })).body.toString()).toBe("hello");
  });

  test("first frame not SETTINGS → GOAWAY PROTOCOL_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure, { sendPreface: false });
    raw.write(PREFACE);
    raw.write(frame(T.PING, 0, 0, Buffer.alloc(8)));
    expect((await raw.goaway()).code).toBe(1);
    raw.close();
  });

  test("SETTINGS with bad length → GOAWAY FRAME_SIZE_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure, { sendPreface: false });
    raw.write(PREFACE);
    raw.write(frame(T.SETTINGS, 0, 0, Buffer.alloc(5)));
    expect((await raw.goaway()).code).toBe(6);
    raw.close();
  });

  test("oversized frame → GOAWAY FRAME_SIZE_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.write(frame(T.DATA, 0, 1, Buffer.alloc(16385)));
    expect((await raw.goaway()).code).toBe(6);
    raw.close();
  });

  test("WINDOW_UPDATE of 0 on the connection → GOAWAY PROTOCOL_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.write(frame(T.WINDOW_UPDATE, 0, 0, Buffer.alloc(4)));
    expect((await raw.goaway()).code).toBe(1);
    raw.close();
  });

  test("connection WINDOW_UPDATE overflow → GOAWAY FLOW_CONTROL_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    const inc = Buffer.alloc(4);
    inc.writeUInt32BE(0x7fffffff, 0);
    raw.write(frame(T.WINDOW_UPDATE, 0, 0, inc));
    expect((await raw.goaway()).code).toBe(3);
    raw.close();
  });

  test("even stream id → GOAWAY PROTOCOL_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(2, baseHeaders("/hello"));
    expect((await raw.goaway()).code).toBe(1);
    raw.close();
  });

  test("HEADERS interleaved before CONTINUATION → GOAWAY PROTOCOL_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.write(frame(T.HEADERS, 0, 1, hpackLiteral(baseHeaders("/hello"))));
    raw.write(frame(T.PING, 0, 0, Buffer.alloc(8)));
    expect((await raw.goaway()).code).toBe(1);
    raw.close();
  });

  test("PUSH_PROMISE from client → GOAWAY PROTOCOL_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.write(frame(5, F.END_HEADERS, 1, Buffer.concat([Buffer.alloc(4), hpackLiteral(baseHeaders("/x"))])));
    expect((await raw.goaway()).code).toBe(1);
    raw.close();
  });

  test("invalid HPACK → GOAWAY COMPRESSION_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    // Indexed field with index 127+ (way past the table) is a decoding error.
    raw.write(frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 1, Buffer.from([0xff, 0xff, 0x7f])));
    expect((await raw.goaway()).code).toBe(9);
    raw.close();
  });

  for (const [name, fields] of [
    [
      "missing :path",
      [
        [":method", "GET"],
        [":scheme", "https"],
      ],
    ],
    ["unknown pseudo-header", [...baseHeaders("/hello"), [":foo", "bar"]]],
    [
      "pseudo-header after regular",
      [
        [":method", "GET"],
        ["x-a", "1"],
        [":scheme", "https"],
        [":path", "/hello"],
      ],
    ],
    ["duplicate :method", [...baseHeaders("/hello"), [":method", "GET"]]],
    ["uppercase field name", [...baseHeaders("/hello"), ["X-Upper", "1"]]],
    ["connection header", [...baseHeaders("/hello"), ["connection", "keep-alive"]]],
    ["te: gzip", [...baseHeaders("/hello"), ["te", "gzip"]]],
    ["transfer-encoding header", [...baseHeaders("/hello"), ["transfer-encoding", "chunked"]]],
    ["host differs from :authority", [...baseHeaders("/hello"), ["host", "elsewhere"]]],
    [
      ":authority with userinfo",
      [
        [":method", "GET"],
        [":scheme", "https"],
        [":path", "/hello"],
        [":authority", "user@localhost"],
      ],
    ],
    [
      "omitted :method",
      [
        [":scheme", "https"],
        [":path", "/hello"],
        [":authority", "localhost"],
      ],
    ],
    [
      "omitted :scheme",
      [
        [":method", "GET"],
        [":path", "/hello"],
        [":authority", "localhost"],
      ],
    ],
    [
      "empty :method",
      [
        [":method", ""],
        [":scheme", "https"],
        [":path", "/hello"],
        [":authority", "localhost"],
      ],
    ],
    ["duplicate :scheme", [...baseHeaders("/hello"), [":scheme", "https"]]],
    ["duplicate :path", [...baseHeaders("/hello"), [":path", "/hello"]]],
    ["upgrade header", [...baseHeaders("/hello"), ["upgrade", "x"]]],
    ["keep-alive header", [...baseHeaders("/hello"), ["keep-alive", "x"]]],
    ["proxy-connection header", [...baseHeaders("/hello"), ["proxy-connection", "x"]]],
    ["te: trailers, deflate", [...baseHeaders("/hello"), ["te", "trailers, deflate"]]],
    ["field name with colon", [...baseHeaders("/hello"), ["has:colon", "x"]]],
    ["field name with NUL", [...baseHeaders("/hello"), ["has\0nul", "x"]]],
    ["field value with LF", [...baseHeaders("/hello"), ["x-v", "a\nb"]]],
    ["field value with CR", [...baseHeaders("/hello"), ["x-v", "a\rb"]]],
    ["field value with NUL", [...baseHeaders("/hello"), ["x-v", "a\0b"]]],
    ["content-length +3", [...baseHeaders("/echo", "POST"), ["content-length", "+3"]]],
    ["content-length -3", [...baseHeaders("/echo", "POST"), ["content-length", "-3"]]],
    ["content-length abc", [...baseHeaders("/echo", "POST"), ["content-length", "abc"]]],
    ["content-length 2^63", [...baseHeaders("/echo", "POST"), ["content-length", "9223372036854775808"]]],
    ["duplicate content-length", [...baseHeaders("/echo", "POST"), ["content-length", "5"], ["content-length", "5"]]],
    ["content-length > 0 with END_STREAM", [...baseHeaders("/echo", "POST"), ["content-length", "5"]]],
    [
      "CONNECT with :path",
      [
        [":method", "CONNECT"],
        [":authority", "example.com:443"],
        [":path", "/"],
      ],
    ],
    [
      "CONNECT with :scheme",
      [
        [":method", "CONNECT"],
        [":authority", "example.com:443"],
        [":scheme", "https"],
      ],
    ],
    [":protocol without extended CONNECT", [...baseHeaders("/hello"), [":protocol", "websocket"]]],
    [
      ":path without leading slash",
      [
        [":method", "GET"],
        [":scheme", "https"],
        [":path", "hello"],
        [":authority", "localhost"],
      ],
    ],
    [
      ":path that would alias a route after its first byte",
      [
        [":method", "GET"],
        [":scheme", "https"],
        [":path", "xapi/1"],
        [":authority", "localhost"],
      ],
    ],
    [
      ":path * with GET",
      [
        [":method", "GET"],
        [":scheme", "https"],
        [":path", "*"],
        [":authority", "localhost"],
      ],
    ],
    [
      "absolute-form :path",
      [
        [":method", "GET"],
        [":scheme", "https"],
        [":path", "https://localhost/hello"],
        [":authority", "localhost"],
      ],
    ],
    [
      "no :authority and no host",
      [
        [":method", "GET"],
        [":scheme", "https"],
        [":path", "/hello"],
      ],
    ],
    [
      "empty :path",
      [
        [":method", "GET"],
        [":scheme", "https"],
        [":path", ""],
      ],
    ],
    ["response pseudo-header", [...baseHeaders("/hello"), [":status", "200"]]],
    // Bytes the HTTP/1.1 parser on the same port answers 400 or 505 for. The
    // handler must never see a method, path, or field name other than the one
    // on the wire (a stripped HTAB would alias /sta\ttic to /static).
    [":method with SP", baseHeaders("/hello", "GET /x HTTP/1.1")],
    [":method with a control byte", baseHeaders("/hello", "\x01")],
    [":method with non-token bytes", baseHeaders("/hello", "GET{}")],
    [":path with HTAB", baseHeaders("/sta\ttic")],
    [":path with SP", baseHeaders("/a b")],
    [":path with a control byte", baseHeaders("/hello\x01")],
    ["field name with trailing SP", [...baseHeaders("/hello"), ["x-a ", "1"]]],
    ["field name with trailing HTAB", [...baseHeaders("/hello"), ["x-a\t", "1"]]],
    ["field name with trailing LF", [...baseHeaders("/hello"), ["x-a\n", "1"]]],
    ["field name with parentheses", [...baseHeaders("/hello"), ["x-(a)", "1"]]],
    ["field name with comma", [...baseHeaders("/hello"), ["x-a,b", "1"]]],
    ["field name with semicolon and equals", [...baseHeaders("/hello"), ["x-a;b=c", "1"]]],
    ["field name with braces", [...baseHeaders("/hello"), ["x-{a}", "1"]]],
    ["field name with DQUOTE", [...baseHeaders("/hello"), ['x-"a"', "1"]]],
    ["field name with slash", [...baseHeaders("/hello"), ["x-a/b", "1"]]],
    ["field name with @ [ ] ?", [...baseHeaders("/hello"), ["x-a@[b]?", "1"]]],
    ["field name with DEL", [...baseHeaders("/hello"), ["x-a\x7f", "1"]]],
    ["field name with a byte above 0x7f", [...baseHeaders("/hello"), ["x-a\xe9", "1"]]],
    ["field value with a control byte", [...baseHeaders("/hello"), ["x-v", "a\x01b"]]],
    ["field value with ESC", [...baseHeaders("/hello"), ["x-v", "a\x1bb"]]],
  ] as [string, [string, string][]][]) {
    test(`malformed request (${name}) → RST_STREAM PROTOCOL_ERROR, connection survives`, async () => {
      const raw = await RawH2.connect(fx.port, secure);
      raw.headers(1, fields);
      expect(await raw.rst(1)).toBe(1);
      // HPACK state stayed in sync: a following valid request works.
      raw.headers(3, baseHeaders("/hello"));
      const d = await raw.waitFor(f => f.type === T.DATA && f.streamId === 3);
      expect(d.payload.toString()).toBe("hello");
      raw.close();
    });
  }

  // ── frame-format checks (h2spec §4–6, hyper frame::*::load, Go TestServer_Rejects_*) ──
  for (const [name, build, code] of [
    ["DATA on stream 0", () => frame(T.DATA, F.END_STREAM, 0, Buffer.from("x")), 1],
    [
      "HEADERS on stream 0",
      () => frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 0, hpackLiteral(baseHeaders("/hello"))),
      1,
    ],
    [
      "HEADERS larger than max frame size",
      () => frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 1, Buffer.alloc(16385)),
      6,
    ],
    [
      "HEADERS with PRIORITY flag but < 5 bytes",
      () => frame(T.HEADERS, F.END_HEADERS | F.PRIORITY, 1, Buffer.from([0, 0, 1])),
      1,
    ],
    [
      "HEADERS PADDED+PRIORITY, pad exceeds remainder",
      () => frame(T.HEADERS, F.END_HEADERS | F.PADDED | F.PRIORITY, 1, Buffer.from([6, 0, 0, 0, 0, 16, 1, 2, 3])),
      1,
    ],
    [
      "DATA PADDED with empty payload",
      () =>
        Buffer.concat([
          frame(T.HEADERS, F.END_HEADERS, 1, hpackLiteral(baseHeaders("/echo", "POST"))),
          frame(T.DATA, F.PADDED, 1, Buffer.alloc(0)),
        ]),
      1,
    ],
    ["PRIORITY on stream 0", () => frame(T.PRIORITY, 0, 0, Buffer.from([0, 0, 0, 1, 0])), 1],
    ["RST_STREAM on stream 0", () => frame(T.RST_STREAM, 0, 0, u32(8)), 1],
    ["RST_STREAM on an idle stream", () => frame(T.RST_STREAM, 0, 99, u32(8)), 1],
    [
      "RST_STREAM length 3",
      () =>
        Buffer.concat([
          frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 1, hpackLiteral(baseHeaders("/slow?ms=500"))),
          frame(T.RST_STREAM, 0, 1, Buffer.alloc(3)),
        ]),
      6,
    ],
    ["WINDOW_UPDATE on an odd idle stream", () => frame(T.WINDOW_UPDATE, 0, 99, u32(100)), 1],
    ["WINDOW_UPDATE length 3", () => frame(T.WINDOW_UPDATE, 0, 0, Buffer.alloc(3)), 6],
    ["SETTINGS on stream 1", () => frame(T.SETTINGS, 0, 1, setting(3, 100)), 1],
    ["SETTINGS ACK with payload", () => frame(T.SETTINGS, F.ACK, 0, Buffer.alloc(1)), 6],
    ["SETTINGS ENABLE_PUSH=2", () => frame(T.SETTINGS, 0, 0, setting(2, 2)), 1],
    ["SETTINGS ENABLE_CONNECT_PROTOCOL=2", () => frame(T.SETTINGS, 0, 0, setting(8, 2)), 1],
    ["SETTINGS MAX_FRAME_SIZE=16383", () => frame(T.SETTINGS, 0, 0, setting(5, 16383)), 1],
    ["SETTINGS MAX_FRAME_SIZE=2^24", () => frame(T.SETTINGS, 0, 0, setting(5, 1 << 24)), 1],
    ["PING on stream 1", () => frame(T.PING, 0, 1, Buffer.alloc(8)), 1],
    ["PING length 6", () => frame(T.PING, 0, 0, Buffer.alloc(6)), 6],
    ["GOAWAY on stream 1", () => frame(T.GOAWAY, 0, 1, Buffer.alloc(8)), 1],
    ["GOAWAY length 7", () => frame(T.GOAWAY, 0, 0, Buffer.alloc(7)), 6],
    [
      "CONTINUATION with no header block in progress",
      () => frame(T.CONTINUATION, F.END_HEADERS, 1, hpackLiteral(baseHeaders("/hello"))),
      1,
    ],
    [
      "CONTINUATION on stream 0",
      () =>
        Buffer.concat([
          frame(T.HEADERS, 0, 1, hpackLiteral(baseHeaders("/hello"))),
          frame(T.CONTINUATION, F.END_HEADERS, 0, hpackLiteral([["x", "y"]])),
        ]),
      1,
    ],
    [
      "CONTINUATION on a different stream",
      () =>
        Buffer.concat([
          frame(T.HEADERS, 0, 1, hpackLiteral(baseHeaders("/hello"))),
          frame(T.CONTINUATION, F.END_HEADERS, 3, hpackLiteral([["x", "y"]])),
        ]),
      1,
    ],
    [
      "CONTINUATION after END_HEADERS",
      () =>
        Buffer.concat([
          frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 1, hpackLiteral(baseHeaders("/slow?ms=500"))),
          frame(T.CONTINUATION, F.END_HEADERS, 1, hpackLiteral([["x", "y"]])),
        ]),
      1,
    ],
    [
      "truncated HPACK literal",
      () => {
        const b = hpackLiteral(baseHeaders("/hello"));
        return frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 1, b.subarray(0, b.length - 1));
      },
      9,
    ],
    [
      "HPACK literal with out-of-range name index",
      () =>
        frame(
          T.HEADERS,
          F.END_HEADERS | F.END_STREAM,
          1,
          Buffer.concat([hpackLiteral(baseHeaders("/hello")), Buffer.from([0x7f, 7, 0])]),
        ),
      9,
    ],
    [
      "HPACK indexed field 0",
      () =>
        frame(
          T.HEADERS,
          F.END_HEADERS | F.END_STREAM,
          1,
          Buffer.concat([hpackLiteral(baseHeaders("/hello")), Buffer.from([0x80])]),
        ),
      9,
    ],
    [
      "HPACK table size update after a field",
      () =>
        frame(
          T.HEADERS,
          F.END_HEADERS | F.END_STREAM,
          1,
          Buffer.concat([hpackLiteral(baseHeaders("/hello")), Buffer.from([0x21])]),
        ),
      9,
    ],
    [
      "HPACK table size update above SETTINGS_HEADER_TABLE_SIZE",
      () =>
        frame(
          T.HEADERS,
          F.END_HEADERS | F.END_STREAM,
          1,
          Buffer.concat([Buffer.from([0x3f, 0xe2, 0x1f]), hpackLiteral(baseHeaders("/hello"))]),
        ),
      9,
    ],
    [
      "HPACK huffman with EOS symbol",
      () =>
        frame(
          T.HEADERS,
          F.END_HEADERS | F.END_STREAM,
          1,
          Buffer.concat([
            hpackLiteral(baseHeaders("/hello")),
            Buffer.from([0x00, 0x85, 0xf2, 0xb2, 0x4a, 0x84, 0xff, 0x87, 0x49, 0x51, 0xff, 0xff, 0xff, 0xfa, 0x7f]),
          ]),
        ),
      9,
    ],
    [
      "HPACK huffman padding longer than 7 bits",
      () =>
        frame(
          T.HEADERS,
          F.END_HEADERS | F.END_STREAM,
          1,
          Buffer.concat([
            hpackLiteral(baseHeaders("/hello")),
            Buffer.from([0x00, 0x85, 0xf2, 0xb2, 0x4a, 0x84, 0xff, 0x84, 0x49, 0x50, 0x9f, 0xff]),
          ]),
        ),
      9,
    ],
    [
      "HPACK huffman padded with zeros",
      () =>
        frame(
          T.HEADERS,
          F.END_HEADERS | F.END_STREAM,
          1,
          Buffer.concat([
            hpackLiteral(baseHeaders("/hello")),
            Buffer.from([0x00, 0x85, 0xf2, 0xb2, 0x4a, 0x84, 0xff, 0x83, 0x49, 0x50, 0x90]),
          ]),
        ),
      9,
    ],
  ] as const) {
    test(`${name} → GOAWAY ${code}`, async () => {
      const raw = await RawH2.connect(fx.port, secure);
      await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
      raw.write(build());
      expect((await raw.goaway()).code).toBe(code);
      raw.close();
    });
  }

  for (const [name, mid] of [
    ["PRIORITY", () => frame(T.PRIORITY, 0, 1, Buffer.from([0, 0, 0, 0, 15]))],
    [
      "HEADERS on another stream",
      () => frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 3, hpackLiteral(baseHeaders("/hello"))),
    ],
    ["DATA", () => frame(T.DATA, 0, 1, Buffer.from("x"))],
    ["unknown frame type", () => frame(0x16, 0, 0, Buffer.alloc(8))],
    [
      "CONTINUATION then DATA",
      () =>
        Buffer.concat([frame(T.CONTINUATION, 0, 1, hpackLiteral([["x", "y"]])), frame(T.DATA, 0, 1, Buffer.from("x"))]),
    ],
  ] as const) {
    test(`${name} inside a header block → GOAWAY PROTOCOL_ERROR`, async () => {
      const raw = await RawH2.connect(fx.port, secure);
      raw.write(
        Buffer.concat([
          frame(T.HEADERS, 0, 1, hpackLiteral(baseHeaders("/hello"))),
          mid(),
          frame(T.CONTINUATION, F.END_HEADERS | F.END_STREAM, 1, hpackLiteral([["a", "b"]])),
        ]),
      );
      expect((await raw.goaway()).code).toBe(1);
      raw.close();
    });
  }

  test("CONTINUATION after a CONTINUATION with END_HEADERS → GOAWAY PROTOCOL_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.write(
      Buffer.concat([
        frame(T.HEADERS, F.END_STREAM, 1, hpackLiteral(baseHeaders("/slow?ms=500"))),
        frame(T.CONTINUATION, F.END_HEADERS, 1, hpackLiteral([["a", "b"]])),
        frame(T.CONTINUATION, F.END_HEADERS, 1, hpackLiteral([["c", "d"]])),
      ]),
    );
    expect((await raw.goaway()).code).toBe(1);
    raw.close();
  });

  test("frames the server must ignore keep the connection usable", async () => {
    const raw = await RawH2.connect(fx.port, secure, {
      settings: Buffer.concat([setting(0xff, 1), setting(8, 1), setting(2, 0), setting(5, (1 << 24) - 1)]),
    });
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    const hdr = Buffer.alloc(9); // PING with a reserved bit set in the stream id
    hdr.writeUIntBE(8, 0, 3);
    hdr[3] = T.PING;
    hdr[4] = 0;
    hdr.writeUInt32BE(0x80000000, 5);
    raw.write(
      Buffer.concat([
        frame(0x16, 0, 0, Buffer.alloc(8)), // unknown type, stream 0
        frame(0x87, 0xc1, 257, Buffer.alloc(5)), // unknown type, odd flags, some stream
        frame(T.PING, 0x16, 0, Buffer.from("flagflag")), // undefined flags on PING
        Buffer.concat([hdr, Buffer.from("reserved")]),
        frame(T.PRIORITY, 0, 7, Buffer.from([0, 0, 0, 0, 200])), // PRIORITY on an idle stream is allowed
        frame(T.PRIORITY, 0, 9, Buffer.from([0x80, 0, 0, 0, 0])), // exclusive, weight 1
        frame(T.PING, F.ACK, 0, Buffer.from("unsolic.")), // unsolicited PING ACK is not echoed
        frame(T.SETTINGS, F.ACK, 0), // unsolicited SETTINGS ACK
        frame(T.PING, 0, 0, Buffer.from("pingpong")),
      ]),
    );
    const pong = await raw.waitFor(f => f.type === T.PING && (f.flags & F.ACK) !== 0);
    expect(pong.payload.toString()).toBe("flagflag");
    await raw.waitFor(f => f.type === T.PING && (f.flags & F.ACK) !== 0 && f.payload.toString() === "pingpong");
    expect(raw.frames.some(f => f.type === T.PING && f.payload.toString() === "unsolic.")).toBe(false);
    // HEADERS on a stream lower than one that only saw PRIORITY is fine.
    raw.headers(7, baseHeaders("/hello"));
    expect((await raw.body(7)).toString()).toBe("hello");
    expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
    raw.close();
  });

  test("PRIORITY that depends on its own stream → RST_STREAM PROTOCOL_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.write(frame(T.PRIORITY, 0, 1, Buffer.from([0, 0, 0, 1, 255])));
    expect(await raw.rst(1)).toBe(1);
    raw.write(
      frame(
        T.HEADERS,
        F.END_HEADERS | F.END_STREAM | F.PRIORITY,
        3,
        Buffer.concat([Buffer.from([0, 0, 0, 3, 16]), hpackLiteral(baseHeaders("/hello"))]),
      ),
    );
    expect(await raw.rst(3)).toBe(1);
    raw.headers(5, baseHeaders("/hello"));
    expect((await raw.body(5)).toString()).toBe("hello");
    raw.close();
  });

  // ── stream states (h2spec §5.1, hyper recv.rs, Go TestServer_*HalfCloseRemote*) ──
  test("DATA on a half-closed (remote) stream → RST_STREAM STREAM_CLOSED, connection survives", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, baseHeaders("/slow?ms=400"));
    raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("x")));
    expect(await raw.rst(1)).toBe(5);
    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.body(3)).toString()).toBe("hello");
    raw.close();
  });

  test("HEADERS on a half-closed (remote) stream → RST_STREAM STREAM_CLOSED and the handler is aborted", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    const before = (fx.stderr().match(/ABORTED/g) ?? []).length;
    raw.headers(1, baseHeaders("/abort", "POST"), F.END_HEADERS);
    raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.alloc(0)));
    raw.write(frame(T.PING, 0, 0, Buffer.from("barrier1")));
    await raw.waitFor(f => f.type === T.PING && f.payload.toString() === "barrier1");
    raw.headers(1, [["x-late", "1"]], F.END_HEADERS);
    expect(await raw.rst(1)).toBe(5);
    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.body(3)).toString()).toBe("hello");
    while ((fx.stderr().match(/ABORTED/g) ?? []).length <= before) await request(session, { ":path": "/hello" });
    raw.close();
  });

  test("trailers without END_STREAM → RST_STREAM PROTOCOL_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, baseHeaders("/echo", "POST"), F.END_HEADERS);
    raw.write(frame(T.DATA, 0, 1, Buffer.from("body")));
    raw.headers(1, [["x-trailer", "t"]], F.END_HEADERS);
    expect(await raw.rst(1)).toBe(1);
    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.body(3)).toString()).toBe("hello");
    raw.close();
  });

  test("content-length under-run at END_STREAM and at trailers → RST_STREAM PROTOCOL_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, [...baseHeaders("/echo", "POST"), ["content-length", "10"]], F.END_HEADERS);
    raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("abc")));
    expect(await raw.rst(1)).toBe(1);
    raw.headers(3, [...baseHeaders("/echo", "POST"), ["content-length", "10"]], F.END_HEADERS);
    raw.write(frame(T.DATA, 0, 3, Buffer.from("abc")));
    raw.headers(3, [["x-t", "1"]]);
    expect(await raw.rst(3)).toBe(1);
    raw.headers(5, [...baseHeaders("/echo", "POST"), ["content-length", "6"]], F.END_HEADERS);
    raw.write(frame(T.DATA, 0, 5, Buffer.from("test")));
    raw.write(frame(T.DATA, F.END_STREAM, 5, Buffer.from("test")));
    expect(await raw.rst(5)).toBe(1);
    raw.headers(7, baseHeaders("/hello"));
    expect((await raw.body(7)).toString()).toBe("hello");
    raw.close();
  });

  test("POST with a single empty END_STREAM DATA frame has an empty body", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, baseHeaders("/echo", "POST"), F.END_HEADERS);
    raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.alloc(0)));
    const h = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
    expect(decodeStatus(h.payload)).toBe(201);
    await raw.waitFor(f => f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
    expect(
      Buffer.concat(raw.frames.filter(f => f.type === T.DATA && f.streamId === 1).map(f => f.payload)).length,
    ).toBe(0);
    raw.close();
  });

  test("responding before the request body ends: response, then RST_STREAM NO_ERROR; later DATA/trailers on that stream are ignored", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, baseHeaders("/hello", "POST"), F.END_HEADERS);
    expect((await raw.body(1)).toString()).toBe("hello");
    expect(await raw.rst(1)).toBe(0);
    const endIdx = raw.frames.findIndex(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
    const rstIdx = raw.frames.findIndex(f => f.type === T.RST_STREAM && f.streamId === 1);
    expect(rstIdx).toBeGreaterThan(endIdx);
    raw.write(frame(T.DATA, 0, 1, Buffer.alloc(16384)));
    raw.write(frame(T.DATA, 0, 1, Buffer.alloc(16384)));
    raw.headers(1, [["x-t", "1"]]);
    raw.write(frame(T.PING, 0, 0, Buffer.from("afterrst")));
    await raw.waitFor(f => f.type === T.PING && f.payload.toString() === "afterrst");
    expect(raw.frames.filter(f => f.type === T.RST_STREAM && f.streamId === 1).length).toBe(1);
    expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.body(3)).toString()).toBe("hello");
    raw.close();
  });

  test("431 for a request with a body pending also resets the stream", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    const big = Buffer.alloc(4000, "v").toString(); // 5 × 4 KB > the 16 KB list limit, under the 2× hard cap
    raw.headers(
      1,
      [...baseHeaders("/headers", "POST"), ["x-1", big], ["x-2", big], ["x-3", big], ["x-4", big], ["x-5", big]],
      F.END_HEADERS,
    );
    const h = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
    expect(decodeStatus(h.payload)).toBe(431);
    expect([0, 1]).toContain(await raw.rst(1));
    raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("x")));
    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.body(3)).toString()).toBe("hello");
    raw.close();
  });

  test("after the client resets a stream, more frames on it are a stream error, not a connection error", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, baseHeaders("/abort", "POST"), F.END_HEADERS);
    raw.write(frame(T.RST_STREAM, 0, 1, u32(8)));
    raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("late")));
    expect(
      await raw.waitFor(f => f.type === T.RST_STREAM && f.streamId === 1).then(f => f.payload.readUInt32BE(0)),
    ).toBe(5);
    raw.headers(1, baseHeaders("/hello"));
    raw.write(frame(T.PING, 0, 0, Buffer.from("afterhd1")));
    await raw.waitFor(f => f.type === T.PING && f.payload.toString() === "afterhd1");
    expect(
      raw.frames.filter(f => f.type === T.RST_STREAM && f.streamId === 1).map(f => f.payload.readUInt32BE(0)),
    ).toEqual([5, 5]);
    expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.body(3)).toString()).toBe("hello");
    raw.close();
  });

  test("DATA on a stream the client itself ended (closed) → GOAWAY STREAM_CLOSED", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, baseHeaders("/hello"));
    expect((await raw.body(1)).toString()).toBe("hello");
    raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("x")));
    expect((await raw.goaway()).code).toBe(5);
    raw.close();
  });

  test("HEADERS with a stream id lower than the last opened → GOAWAY PROTOCOL_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(5, baseHeaders("/hello"));
    expect((await raw.body(5)).toString()).toBe("hello");
    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.goaway()).code).toBe(1);
    raw.close();
  });

  test("WINDOW_UPDATE and RST_STREAM on a completed stream are ignored", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, baseHeaders("/hello"));
    expect((await raw.body(1)).toString()).toBe("hello");
    // A positive update may race stream retirement. Even an increment that
    // would overflow a live stream's window is ignored once it is closed.
    raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(0x7fffffff)));
    raw.write(frame(T.RST_STREAM, 0, 1, u32(8)));
    raw.write(frame(T.PING, 0, 0, Buffer.from("closedok")));
    await raw.waitFor(f => f.type === T.PING && f.payload.toString() === "closedok");
    expect(raw.frames.some(f => f.type === T.GOAWAY || (f.type === T.RST_STREAM && f.streamId === 1))).toBe(false);
    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.body(3)).toString()).toBe("hello");
    raw.close();
  });

  test("a stream id burned by a malformed request cannot be reused", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, [
      [":method", "GET"],
      [":scheme", "https"],
    ]);
    expect(await raw.rst(1)).toBe(1);
    raw.headers(1, baseHeaders("/hello"));
    raw.write(frame(T.PING, 0, 0, Buffer.from("burned01")));
    const f = await raw.waitFor(f => f.type === T.GOAWAY || (f.type === T.PING && f.payload.toString() === "burned01"));
    // Either ignored (we reset it) or a connection error; never served.
    expect(raw.frames.some(f => f.type === T.HEADERS && f.streamId === 1)).toBe(false);
    if (f.type !== T.GOAWAY) {
      raw.headers(3, baseHeaders("/hello"));
      expect((await raw.body(3)).toString()).toBe("hello");
    }
    raw.close();
  });

  // ── flow control (hyper flow_control.rs, Go TestServer_Response_LargeWrite*) ──

  test("initial window 0: HEADERS arrive, no DATA until WINDOW_UPDATE; exact-quota dribbles", async () => {
    const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 0) });
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    raw.headers(1, baseHeaders("/fixed?n=264"));
    await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
    await barrier(raw, "w0");
    expect(received(raw, 1)).toBe(0);
    for (const [inc, total] of [
      [123, 123],
      [1, 124],
      [13, 137],
      [127, 264],
    ] as const) {
      raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(inc)));
      while (received(raw, 1) < total)
        await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && received(raw, 1) >= total);
      await barrier(raw, "w" + total);
      expect(received(raw, 1)).toBe(total);
    }
    expect(raw.frames.some(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0)).toBe(true);
    raw.close();
  });

  test("initial window 0: empty responses are not flow-controlled", async () => {
    const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 0) });
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    raw.headers(1, baseHeaders("/status/204"));
    raw.headers(3, baseHeaders("/empty"));
    await raw.waitFor(
      f => f.streamId === 1 && (f.flags & F.END_STREAM) !== 0 && (f.type === T.HEADERS || f.type === T.DATA),
    );
    await raw.waitFor(
      f => f.streamId === 3 && (f.flags & F.END_STREAM) !== 0 && (f.type === T.HEADERS || f.type === T.DATA),
    );
    raw.close();
  });

  test("stream window resumes on small WINDOW_UPDATEs after the connection window opens", async () => {
    const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 1024) });
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    raw.headers(1, baseHeaders("/big"));
    while (received(raw, 1) < 1024)
      await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && received(raw, 1) >= 1024);
    raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(10)));
    await barrier(raw, "cw");
    raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(4)));
    raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(1)));
    while (received(raw, 1) < 1029)
      await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && received(raw, 1) >= 1029);
    await barrier(raw, "sw5");
    expect(received(raw, 1)).toBe(1029);
    raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(5)));
    while (received(raw, 1) < 1034)
      await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && received(raw, 1) >= 1034);
    await barrier(raw, "sw10");
    expect(received(raw, 1)).toBe(1034);
    raw.close();
  });

  // A streamed body that ends before the sink's first flush goes out through tryEnd() from the
  // sink's own buffer. onWritable resends what is left each time the window reopens.
  test.each([
    ["default", [10, 5, 1000]],
    ["bytes", [10, 5, 1000]],
    ["direct", [10, 5, 1000]],
    ["generator", [10, 5, 1000]],
    ["default", [1, 1, 1000]],
    ["default", [20, 1, 1000]],
    ["default", [10, 5, 7, 2, 1000]],
    ["default", [10, 1000]], // one partial write only
  ] as const)(
    "streamed body (%s source) that ends at once, windows %j: every byte is sent once",
    async (kind, windows) => {
      const path = `/stream-once?kind=${kind}`;
      const expected = Buffer.from(Array.from({ length: 100 }, (_, i) => i)).toString("hex");
      const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, windows[0]) });
      try {
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        raw.headers(1, baseHeaders(path));
        let granted: number = windows[0];
        for (const inc of windows.slice(1)) {
          // Each window but the last is smaller than what is left: the write was partial.
          while (received(raw, 1) < granted)
            await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && received(raw, 1) >= granted);
          await barrier(raw, "g" + granted);
          expect(received(raw, 1)).toBe(granted);
          raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(inc)));
          granted += inc;
        }
        expect((await raw.body(1)).toString("hex")).toBe(expected);
      } finally {
        raw.close();
      }
      // The same response over default windows: it is the content-length path that was exercised.
      const res = await request(session, { ":path": path });
      expect({ length: res.headers["content-length"], body: res.body.toString("hex") }).toEqual({
        length: "100",
        body: expected,
      });
    },
  );

  test("raising SETTINGS_INITIAL_WINDOW_SIZE mid-stream releases exactly the delta", async () => {
    const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 0) });
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    raw.headers(1, baseHeaders("/big"));
    await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
    await barrier(raw, "iws0");
    expect(received(raw, 1)).toBe(0);
    raw.write(frame(T.SETTINGS, 0, 0, setting(4, 10)));
    while (received(raw, 1) < 10)
      await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && received(raw, 1) >= 10);
    await barrier(raw, "iws10");
    expect(received(raw, 1)).toBe(10);
    raw.write(frame(T.SETTINGS, 0, 0, setting(4, 11)));
    while (received(raw, 1) < 11)
      await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && received(raw, 1) >= 11);
    await barrier(raw, "iws11");
    expect(received(raw, 1)).toBe(11);
    raw.close();
  });

  test("SETTINGS_INITIAL_WINDOW_SIZE delta that overflows an open stream's window → GOAWAY FLOW_CONTROL_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, baseHeaders("/slow?ms=2000"));
    raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(0x7fffffff - 65535)));
    raw.write(frame(T.SETTINGS, 0, 0, setting(4, 65536)));
    expect((await raw.goaway()).code).toBe(3);
    raw.close();
  });

  test("adversarial INITIAL_WINDOW_SIZE sequence with no open streams does not underflow", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.write(frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 1, Buffer.alloc(0)));
    expect(await raw.rst(1)).toBe(1);
    for (const v of [1329018135, 3809661, 1467177332, 3844989]) raw.write(frame(T.SETTINGS, 0, 0, setting(4, v)));
    await barrier(raw, "iwsseq");
    expect(raw.frames.filter(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0).length).toBeGreaterThanOrEqual(5);
    expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.body(3)).toString()).toBe("hello");
    raw.close();
  });

  test("padding counts against the receive window", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    raw.headers(1, baseHeaders("/late-read", "POST"), F.END_HEADERS);
    // 4 padded frames of exactly 16384 window-bytes each (1 + 16183 + 200), only 64732 body bytes.
    for (let i = 0; i < 4; i++)
      raw.write(
        frame(T.DATA, F.PADDED, 1, Buffer.concat([Buffer.from([200]), Buffer.alloc(16183, 1), Buffer.alloc(200)])),
      );
    raw.write(frame(T.DATA, 0, 1, Buffer.from("x")));
    expect(await raw.rst(1)).toBe(3);
    raw.headers(3, baseHeaders("/release-late-read"));
    await raw.body(3);
    raw.close();
  });

  // ── GOAWAY semantics ──

  test("client GOAWAY then a bogus connection WINDOW_UPDATE still gets GOAWAY FLOW_CONTROL_ERROR and a close", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, [...baseHeaders("/echo", "POST"), ["content-length", "12"]], F.END_HEADERS);
    raw.write(frame(T.DATA, 0, 1, Buffer.from("some ")));
    raw.write(frame(T.GOAWAY, 0, 0, Buffer.concat([u32(1), u32(0)])));
    raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(0x7fffffff)));
    expect((await raw.goaway()).code).toBe(3);
    await raw.waitForClose();
    raw.close();
  });

  // ── response encoding ──
  test("response header block larger than the peer's max frame size is split into CONTINUATION frames", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, baseHeaders("/many-headers"));
    const first = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
    expect(first.flags & F.END_HEADERS).toBe(0);
    expect(first.payload.length).toBeLessThanOrEqual(16384);
    const last = await raw.waitFor(
      f => f.type === T.CONTINUATION && f.streamId === 1 && (f.flags & F.END_HEADERS) !== 0,
    );
    expect(last.payload.length).toBeLessThanOrEqual(16384);
    expect((await raw.body(1)).toString()).toBe("ok");
    raw.close();
    // nghttp2's client defaults to 128 header pairs; raise it for this response.
    const wide = await connectH2(fx.port, secure, {
      maxHeaderListPairs: 4000,
      settings: { maxHeaderListSize: 1 << 20 },
    });
    const res = await request(wide, { ":path": "/many-headers" });
    wide.close();
    expect(res.headers["x-header-0"]).toBe("x-value-0");
    expect(res.headers["x-header-2999"]).toBe("x-value-2999");
  });

  test("hop-by-hop response headers set by the handler are not transmitted", async () => {
    const res = await request(session, { ":path": "/hop-headers" });
    expect(res.headers[":status"]).toBe(200);
    expect(res.body.toString()).toBe("hi");
    expect(res.headers["x-kept"]).toBe("1");
    for (const h of ["transfer-encoding", "connection", "keep-alive", "upgrade", "proxy-connection"])
      expect(res.headers[h]).toBeUndefined();
  });

  test("empty 200 response carries content-length: 0 and no DATA payload", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, baseHeaders("/empty"));
    const h = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
    await raw.waitFor(f => f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
    expect(received(raw, 1)).toBe(0);
    raw.close();
    const res = await request(session, { ":path": "/empty" });
    expect(res.headers["content-length"]).toBe("0");
  });

  test("peer SETTINGS_HEADER_TABLE_SIZE=0: encoder emits a size update and stops indexing", async () => {
    const raw = await RawH2.connect(fx.port, secure, { settings: setting(1, 0) });
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    raw.headers(1, baseHeaders("/set-cookies"));
    const h1 = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
    expect(h1.payload[0]).toBe(0x20);
    await raw.body(1);
    raw.headers(3, baseHeaders("/set-cookies"));
    await raw.body(3);
    raw.close();
    // And a strict decoder (nghttp2) stays happy across several responses.
    const s0 = http2.connect(`${secure ? "https" : "http"}://127.0.0.1:${fx.port}`, {
      rejectUnauthorized: false,
      settings: { headerTableSize: 0 },
    });
    await new Promise<void>((res, rej) => {
      s0.once("connect", () => res());
      s0.once("error", rej);
    });
    for (let i = 0; i < 3; i++)
      expect((await request(s0, { ":path": "/set-cookies" })).headers["x-multi"]).toBe("1, 2");
    s0.close();
  });

  test("HPACK request encodings: indexed, incremental, never-indexed, huffman, size updates are all accepted", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    const vecs = [
      Buffer.from([0x40, 0x0a, ...Buffer.from("user-agent"), 0x06, ...Buffer.from("h2spec")]), // inc-indexing raw
      Buffer.from([0x40, 0x87, 0xb5, 0x05, 0xb1, 0x61, 0xcc, 0x5a, 0x93, 0x84, 0x9c, 0x48, 0xac, 0xa4]), // inc-indexing huffman name+value
      Buffer.from([0x00, 0x87, 0xb5, 0x05, 0xb1, 0x61, 0xcc, 0x5a, 0x93, 0x84, 0x9c, 0x48, 0xac, 0xa4]), // without indexing huffman
      Buffer.from([0x00, 0x85, 0xf2, 0xb2, 0x4a, 0x84, 0xff, 0x84, 0x9c, 0x48, 0xac, 0xa4]), // without indexing new name huffman (x-test)
      Buffer.from([0x10, 0x0a, ...Buffer.from("user-agent"), 0x06, ...Buffer.from("h2spec")]), // never indexed raw
      Buffer.from([0x10, 0x87, 0xb5, 0x05, 0xb1, 0x61, 0xcc, 0x5a, 0x93, 0x84, 0x9c, 0x48, 0xac, 0xa4]), // never indexed huffman
      Buffer.from([0x10, 0x85, 0xf2, 0xb2, 0x4a, 0x84, 0xff, 0x84, 0x9c, 0x48, 0xac, 0xa4]), // never indexed new name huffman
      Buffer.from([0xbe]), // indexed: dynamic table entry 62 (user-agent: h2spec from the first vector)
    ];
    let id = 1;
    for (const v of vecs) {
      raw.write(
        frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, id, Buffer.concat([hpackLiteral(baseHeaders("/headers")), v])),
      );
      const body = JSON.parse((await raw.body(id)).toString());
      expect(body.headers["user-agent"] ?? body.headers["x-test"]).toMatch(/h2spec|test/);
      id += 2;
    }
    for (const prefix of [[0x3f, 0xe1, 0x1f], [0x3f, 0x61, 0x3f, 0xe1, 0x1f], [0x20]]) {
      raw.write(
        frame(
          T.HEADERS,
          F.END_HEADERS | F.END_STREAM,
          id,
          Buffer.concat([Buffer.from(prefix), hpackLiteral(baseHeaders("/hello"))]),
        ),
      );
      expect((await raw.body(id)).toString()).toBe("hello");
      id += 2;
    }
    raw.close();
  });

  test("whole request written one byte at a time", async () => {
    const raw = await RawH2.connect(fx.port, secure, { sendPreface: false });
    const hb = hpackLiteral([...baseHeaders("/echo", "POST"), ["x-echo", "bytewise"]]);
    const bytes = Buffer.concat([
      PREFACE,
      frame(T.SETTINGS, 0, 0),
      frame(T.HEADERS, 0, 1, hb.subarray(0, 5)),
      frame(T.CONTINUATION, F.END_HEADERS, 1, hb.subarray(5)),
      frame(T.DATA, 0, 1, Buffer.from("ab")),
      frame(T.DATA, F.END_STREAM, 1, Buffer.from("cd")),
    ]);
    for (let i = 0; i < bytes.length; i++) raw.write(bytes.subarray(i, i + 1));
    expect((await raw.body(1)).toString()).toBe("abcd");
    raw.close();
  });

  test("padded HEADERS followed by CONTINUATION: padding applies to the HEADERS frame only", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    const hb = hpackLiteral([...baseHeaders("/headers"), ["x-pad", "ok"]]);
    raw.write(
      frame(
        T.HEADERS,
        F.PADDED | F.END_STREAM,
        1,
        Buffer.concat([Buffer.from([3]), hb.subarray(0, 1), Buffer.alloc(3)]),
      ),
    );
    raw.write(frame(T.CONTINUATION, F.END_HEADERS, 1, hb.subarray(1)));
    expect(JSON.parse((await raw.body(1)).toString()).headers["x-pad"]).toBe("ok");
    raw.close();
  });

  test("host without :authority is accepted and becomes the URL host; a request with an empty regular header value is fine", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, [
      [":method", "GET"],
      [":scheme", "https"],
      [":path", "/headers"],
      ["host", "h.test"],
      ["x-empty", ""],
    ]);
    const body = JSON.parse((await raw.body(1)).toString());
    expect(new URL(body.url).host).toBe("h.test");
    expect(body.headers["x-empty"]).toBe("");
    raw.close();
  });

  test("plain CONNECT (only :method and :authority) is well-formed: answered 404 by the router, not reset", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, [
      [":method", "CONNECT"],
      [":authority", "example.com:443"],
    ]);
    const h = await raw.waitFor(f => (f.type === T.HEADERS || f.type === T.RST_STREAM) && f.streamId === 1);
    expect(h.type).toBe(T.HEADERS);
    // No :path, so nothing routes it; HTTP/1 CONNECT gets the same 404 today.
    expect(decodeStatus(h.payload)).toBe(404);
    raw.close();
  });

  test("client reset / disconnect while the handler is reading the body rejects the read", async () => {
    for (const how of ["rst", "close"] as const) {
      const before = (fx.stderr().match(/READ-ERR/g) ?? []).length;
      const raw = await RawH2.connect(fx.port, secure);
      raw.headers(1, [...baseHeaders("/read-report", "POST"), ["content-length", "100000"]], F.END_HEADERS);
      raw.write(frame(T.DATA, 0, 1, Buffer.alloc(1000)));
      await barrier(raw, "rd" + how);
      if (how === "rst") raw.write(frame(T.RST_STREAM, 0, 1, u32(8)));
      else raw.socket.destroy();
      while ((fx.stderr().match(/READ-ERR/g) ?? []).length <= before) await request(session, { ":path": "/hello" });
      if (how === "rst") raw.close();
    }
  });

  test("client disconnect while streaming an unbounded response cancels the stream source", async () => {
    const before = (fx.stderr().match(/CANCELLED/g) ?? []).length;
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, baseHeaders("/infinite"));
    await raw.waitFor(f => f.type === T.DATA && f.streamId === 1);
    raw.socket.destroy();
    while ((fx.stderr().match(/CANCELLED/g) ?? []).length <= before) await request(session, { ":path": "/hello" });
  });

  test(":path * is accepted for OPTIONS", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, [
      [":method", "OPTIONS"],
      [":scheme", "https"],
      [":path", "*"],
      [":authority", "localhost"],
    ]);
    const f = await raw.waitFor(f => f.streamId === 1 && (f.type === T.HEADERS || f.type === T.RST_STREAM));
    expect(f.type).toBe(T.HEADERS);
    raw.close();
  });

  // A token Bun.serve has no Method for. The "any" route used to take it and
  // the handler saw req.method === "GET"; HTTP/1.1 on the same port never
  // dispatches it.
  for (const method of ["BREW", "GETX", "get", "Get", "M_SEARCH"]) {
    test(`unknown :method ${method} → 501 without reaching the handler, connection survives`, async () => {
      const raw = await RawH2.connect(fx.port, secure);
      raw.headers(1, baseHeaders("/headers", method));
      const h = await raw.waitFor(f => f.streamId === 1 && (f.type === T.HEADERS || f.type === T.RST_STREAM));
      expect(h.type).toBe(T.HEADERS);
      expect(decodeStatus(h.payload)).toBe(501);
      // /headers always answers with a JSON body; END_STREAM on the HEADERS
      // frame means no handler ran.
      expect(h.flags & F.END_STREAM).toBe(F.END_STREAM);
      raw.headers(3, baseHeaders("/hello"));
      expect((await raw.body(3)).toString()).toBe("hello");
      raw.close();
    });
  }

  test("a known method with a hyphen, every tchar in a field name, and HTAB inside a value reach the handler byte-exact", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    const name = "x-a!#$%&'*+.^_`|~0";
    raw.headers(1, [...baseHeaders("/headers", "M-SEARCH"), [name, "1"], ["x-tab", "a\tb"]]);
    const body = JSON.parse((await raw.body(1)).toString());
    expect(body.method).toBe("M-SEARCH");
    expect(body.headers[name]).toBe("1");
    expect(body.headers["x-tab"]).toBe("a\tb");
    raw.close();
  });

  test("SETTINGS with more than 32 entries → GOAWAY ENHANCE_YOUR_CALM", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.write(
      frame(T.SETTINGS, 0, 0, Buffer.concat(Array.from({ length: 33 }, (_, i) => setting(4, 65535 + (i & 1))))),
    );
    expect((await raw.goaway()).code).toBe(11);
    raw.close();
  });

  test("empty CONTINUATION flood → GOAWAY ENHANCE_YOUR_CALM", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.write(
      Buffer.concat([
        frame(T.HEADERS, 0, 1, hpackLiteral(baseHeaders("/hello"))),
        ...Array.from({ length: 40 }, () => frame(T.CONTINUATION, 0, 1, Buffer.alloc(0))),
      ]),
    );
    expect((await raw.goaway()).code).toBe(11);
    raw.close();
  });

  test("hop-by-hop headers are dropped on static and file routes too", async () => {
    for (const path of ["/static-hop", "/file-hop"]) {
      const res = await request(session, { ":path": path, ":method": "HEAD" });
      expect(res.headers["x-kept"]).toBe("1");
      for (const h of ["connection", "keep-alive", "te", "upgrade"]) expect(res.headers[h]).toBeUndefined();
    }
    const res = await request(session, { ":path": "/static-hop" });
    expect(res.body.toString()).toBe("hop");
  });

  test("HEADER_TABLE_SIZE 0 then 4096 before the next block emits both size updates (strict decoder stays in sync)", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    raw.write(frame(T.SETTINGS, 0, 0, setting(1, 0)));
    raw.write(frame(T.SETTINGS, 0, 0, setting(1, 4096)));
    await raw.waitFor(f => raw.frames.filter(g => g.type === T.SETTINGS && (g.flags & F.ACK) !== 0).length >= 3);
    raw.headers(1, baseHeaders("/hello"));
    const h = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
    expect(h.payload[0]).toBe(0x20); // update to 0 (the minimum seen)…
    expect(h.payload.subarray(1, 3)).toEqual(Buffer.from([0x3f, 0xe1])); // …then to 4096 (0x3f 0xe1 0x1f)
    await raw.body(1);
    // The size updates are emitted only on the first header block. Repeating
    // identifier 1 in one SETTINGS frame is deliberately not used here:
    // RFC 9113 section 6.5 makes that a connection error.
    raw.headers(3, baseHeaders("/hello"));
    const h3 = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 3);
    expect(h3.payload[0]).not.toBe(0x20);
    await raw.body(3);
    raw.close();
    const s0 = http2.connect(`${secure ? "https" : "http"}://127.0.0.1:${fx.port}`, {
      rejectUnauthorized: false,
      settings: { headerTableSize: 0 },
    });
    await new Promise<void>((res, rej) => {
      s0.once("connect", () => res());
      s0.once("error", rej);
    });
    s0.settings({ headerTableSize: 4096 });
    for (let i = 0; i < 3; i++)
      expect((await request(s0, { ":path": "/set-cookies" })).headers["x-multi"]).toBe("1, 2");
    s0.close();
  });

  test("header list over the limit → 431 on that stream, connection survives", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    const big = Buffer.alloc(4000, "v").toString(); // 5 × 4 KB > the 16 KB list limit, under the 2× hard cap
    raw.headers(1, [...baseHeaders("/headers"), ["x-1", big], ["x-2", big], ["x-3", big], ["x-4", big], ["x-5", big]]);
    const h = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
    expect(decodeStatus(h.payload)).toBe(431);
    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.body(3)).toString()).toBe("hello");
    raw.close();
  });

  test("more than 200 header fields → 431, connection survives", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    const many: [string, string][] = [];
    for (let i = 0; i < 300; i++) many.push(["x-" + i, "1"]);
    raw.headers(1, [...baseHeaders("/headers"), ...many]);
    const h = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
    expect(decodeStatus(h.payload)).toBe(431);
    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.body(3)).toString()).toBe("hello");
    raw.close();
  });

  test("te: trailers is accepted (any case)", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, [...baseHeaders("/hello"), ["te", "trailers"]]);
    raw.headers(3, [...baseHeaders("/hello"), ["te", "Trailers"]]);
    expect((await raw.body(1)).toString()).toBe("hello");
    expect((await raw.body(3)).toString()).toBe("hello");
    raw.close();
  });

  test("a response body that errors after bytes are on the wire resets the stream with INTERNAL_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, baseHeaders("/stream-error"));
    await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload.length > 0);
    expect(await raw.rst(1)).toBe(2);
    await barrier(raw, "after-er");
    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.body(3)).toString()).toBe("hello");
    raw.close();
  });

  test("content-length mismatch → RST_STREAM PROTOCOL_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, [...baseHeaders("/echo", "POST"), ["content-length", "3"]], F.END_HEADERS);
    raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("toolong")));
    expect(await raw.rst(1)).toBe(1);
    raw.close();
  });

  test("DATA on an idle stream → GOAWAY PROTOCOL_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.write(frame(T.DATA, F.END_STREAM, 99, Buffer.from("x")));
    expect((await raw.goaway()).code).toBe(1);
    raw.close();
  });

  test("DATA / WINDOW_UPDATE on an even stream id → GOAWAY PROTOCOL_ERROR", async () => {
    for (const send of [
      (raw: RawH2) => raw.write(frame(T.DATA, F.END_STREAM, 2, Buffer.from("x"))),
      (raw: RawH2) => {
        const inc = Buffer.alloc(4);
        inc.writeUInt32BE(1);
        raw.write(frame(T.WINDOW_UPDATE, 0, 2, inc));
      },
    ]) {
      const raw = await RawH2.connect(fx.port, secure);
      raw.headers(3, baseHeaders("/hello"), F.END_HEADERS | F.END_STREAM);
      send(raw);
      expect((await raw.goaway()).code).toBe(1);
      raw.close();
    }
  });

  test("stream WINDOW_UPDATE of 0 → RST_STREAM PROTOCOL_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, baseHeaders("/slow?ms=200"), F.END_HEADERS | F.END_STREAM);
    raw.write(frame(T.WINDOW_UPDATE, 0, 1, Buffer.alloc(4)));
    expect(await raw.rst(1)).toBe(1);
    raw.close();
  });

  test("host matching :authority is accepted", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, [...baseHeaders("/hello"), ["host", "localhost"]]);
    expect((await raw.body(1)).toString()).toBe("hello");
    raw.close();
  });

  test("DATA beyond the advertised stream window → RST_STREAM FLOW_CONTROL_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    // /late-read never touches the body until released, so the window stays at 64 KB.
    raw.headers(1, baseHeaders("/late-read", "POST"), F.END_HEADERS);
    for (let i = 0; i < 4; i++) raw.write(frame(T.DATA, 0, 1, Buffer.alloc(16384)));
    raw.write(frame(T.DATA, 0, 1, Buffer.alloc(1)));
    expect(await raw.rst(1)).toBe(3);
    raw.headers(3, baseHeaders("/release-late-read"));
    await raw.body(3);
    raw.close();
  });

  test("zero-length field name is rejected (HPACK) → GOAWAY", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, [...baseHeaders("/hello"), ["", "x"]]);
    const g = await raw.goaway();
    expect([1, 9]).toContain(g.code);
    raw.close();
  });

  test("stream WINDOW_UPDATE overflow → RST_STREAM FLOW_CONTROL_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, baseHeaders("/slow?ms=200"), F.END_HEADERS | F.END_STREAM);
    const inc = Buffer.alloc(4);
    inc.writeUInt32BE(0x7fffffff, 0);
    raw.write(frame(T.WINDOW_UPDATE, 0, 1, inc));
    expect(await raw.rst(1)).toBe(3);
    raw.close();
  });

  test("SETTINGS_INITIAL_WINDOW_SIZE above 2^31-1 → GOAWAY FLOW_CONTROL_ERROR", async () => {
    const settings = Buffer.alloc(6);
    settings.writeUInt16BE(4, 0);
    settings.writeUInt32BE(0x80000000, 2);
    const raw = await RawH2.connect(fx.port, secure, { settings });
    expect((await raw.goaway()).code).toBe(3);
    raw.close();
  });

  test("PRIORITY frame with bad length → GOAWAY FRAME_SIZE_ERROR", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.write(frame(T.PRIORITY, 0, 1, Buffer.alloc(4)));
    expect((await raw.goaway()).code).toBe(6);
    raw.close();
  });

  for (const [name, type, flags] of [
    ["DATA", T.DATA, F.PADDED],
    ["HEADERS", T.HEADERS, F.PADDED | F.END_HEADERS],
  ] as const) {
    test(`${name} with pad length ≥ payload → GOAWAY PROTOCOL_ERROR`, async () => {
      const raw = await RawH2.connect(fx.port, secure);
      if (type === T.DATA) raw.headers(1, baseHeaders("/echo", "POST"), F.END_HEADERS);
      // Pad Length = 10 but only 3 bytes follow.
      raw.write(frame(type, flags, 1, Buffer.from([10, 1, 2, 3])));
      expect((await raw.goaway()).code).toBe(1);
      raw.close();
    });
  }

  test("HEADERS reusing a closed stream id → GOAWAY STREAM_CLOSED", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.body(3)).toString()).toBe("hello");
    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.goaway()).code).toBe(5);
    raw.close();
  });

  test("CONTINUATION flood past the header-block cap → GOAWAY ENHANCE_YOUR_CALM", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    // Cap is 2 × SETTINGS_MAX_HEADER_LIST_SIZE (16 KB default) = 32 KB of
    // header block; send just past it in one write so nothing is still in
    // flight when the server closes.
    const junk = hpackLiteral([["x-junk", Buffer.alloc(4000, "j").toString()]]);
    const parts = [frame(T.HEADERS, 0, 1, hpackLiteral(baseHeaders("/hello")))];
    for (let total = 0; total <= 36 * 1024; total += junk.length) parts.push(frame(T.CONTINUATION, 0, 1, junk));
    raw.write(Buffer.concat(parts));
    expect((await raw.goaway()).code).toBe(11);
    raw.close();
  });

  test("HPACK bomb: tiny block expanding via dynamic-table refs is cut off", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    // Literal with incremental indexing (0x40): name "x", value 3 KB → dynamic index 62.
    const name = Buffer.from("x");
    const value = Buffer.alloc(3000, "v");
    const lit = Buffer.concat([
      Buffer.from([0x40, name.length]),
      name,
      Buffer.from([0x7f, ...encodeInt(value.length - 127)]),
      value,
    ]);
    function encodeInt(n: number) {
      const out: number[] = [];
      while (n >= 128) {
        out.push((n & 0x7f) | 0x80);
        n >>= 7;
      }
      out.push(n);
      return out;
    }
    // Then ~12k one-byte references to it (0x80 | 62) = ~36 MB decoded from a 16 KB frame.
    const refs = Buffer.alloc(16384 - lit.length - hpackLiteral(baseHeaders("/hello")).length, 0x80 | 62);
    const block = Buffer.concat([hpackLiteral(baseHeaders("/hello")), lit, refs]);
    const t0 = performance.now();
    raw.write(frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 1, block));
    const g = await raw.goaway();
    expect(g.code).toBe(11);
    // Bounded work: the server stops decoding at the hard cap instead of expanding all refs.
    expect(performance.now() - t0).toBeLessThan(5000);
    raw.close();
  });

  test.skipIf(secure)("SETTINGS flood from a client that never reads gets the connection closed", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    await raw.waitFor(f => f.type === T.SETTINGS);
    raw.socket.pause();
    const batch = Buffer.concat(Array.from({ length: 4096 }, () => frame(T.SETTINGS, 0, 0)));
    await new Promise<void>(resolve => {
      const pump = () => {
        if (raw.closed || raw.socket.destroyed) return resolve();
        raw.socket.write(batch, err => (err ? resolve() : setImmediate(pump)));
      };
      raw.socket.on("close", () => resolve());
      raw.socket.on("error", () => resolve());
      pump();
    });
    raw.close();
    expect((await request(session, { ":path": "/hello" })).body.toString()).toBe("hello");
  });

  test("empty DATA frame flood on an open stream is tolerated and bounded by flow control", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, baseHeaders("/echo", "POST"), F.END_HEADERS);
    raw.write(Buffer.concat(Array.from({ length: 2000 }, () => frame(T.DATA, 0, 1, Buffer.alloc(0)))));
    raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("done")));
    expect((await raw.body(1)).toString()).toBe("done");
    raw.close();
  });

  test("client GOAWAY then close mid-request does not crash", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, baseHeaders("/slow?ms=100"));
    raw.write(frame(T.GOAWAY, 0, 0, Buffer.alloc(8)));
    raw.close();
    expect((await request(session, { ":path": "/hello" })).body.toString()).toBe("hello");
  });

  // Cleartext only: needs a client socket that genuinely stops reading,
  // which a paused TLSSocket here does not (it keeps draining records).
  test.skipIf(secure)("PING flood from a client that never reads gets the connection closed", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    await raw.waitFor(f => f.type === T.SETTINGS);
    raw.socket.pause();
    const ping = frame(T.PING, 0, 0, Buffer.alloc(8));
    const batch = Buffer.concat(Array.from({ length: 4096 }, () => ping));
    // Keep writing until the server hangs up; it must not buffer replies forever.
    await new Promise<void>(resolve => {
      const pump = () => {
        if (raw.closed || raw.socket.destroyed) return resolve();
        raw.socket.write(batch, err => (err ? resolve() : setImmediate(pump)));
      };
      raw.socket.on("close", () => resolve());
      raw.socket.on("error", () => resolve());
      pump();
    });
    raw.close();
    expect((await request(session, { ":path": "/hello" })).body.toString()).toBe("hello");
  });

  test("garbage after a valid request closes only that connection", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, baseHeaders("/slow?ms=50"));
    raw.write(Buffer.from("this is not a frame header at all, definitely"));
    await raw.waitForClose();
    expect((await request(session, { ":path": "/hello" })).body.toString()).toBe("hello");
  });
});

test("HTTP/1.1 still works on the same port", async () => {
  const res = await fetch(`${secure ? "https" : "http"}://127.0.0.1:${fx.port}/hello`, {
    tls: { rejectUnauthorized: false },
  } as RequestInit);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hello");
  // No HTTP/3 listener → no Alt-Svc.
  expect(res.headers.get("alt-svc")).toBeNull();
});

test("websocket upgrade over HTTP/1.1 still works alongside h2", async () => {
  const ws = new WebSocket(`${secure ? "wss" : "ws"}://127.0.0.1:${fx.port}/ws`, {
    tls: { rejectUnauthorized: false },
  } as any);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = e => reject(e);
  });
  ws.close();
});

test("GET WebSocket routes accept both HTTP/1 upgrade and RFC 8441 Extended CONNECT", async () => {
  const h1 = new WebSocket(`ws://127.0.0.1:${fx.port}/ws-route`);
  const h1Echo = new Promise<string>((resolve, reject) => {
    h1.onopen = () => h1.send("h1-route");
    h1.onmessage = event => resolve(String(event.data));
    h1.onerror = reject;
  });
  expect(await h1Echo).toBe("h1-route");
  h1.close();

  const raw = await RawH2.connect(fx.port, secure);
  raw.headers(1, websocketHeaders("/ws-route"), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);
  raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, "h2-route")));
  const echoed = wsServerFrame(
    (await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x81)).payload,
  );
  expect(echoed.payload.toString()).toBe("h2-route");

  // Only the validated websocket Extended CONNECT is mapped to the public
  // GET route. Another protocol on the same path stays on ordinary CONNECT
  // routing and reaches the fetch fallback instead.
  const unsupported = websocketHeaders("/ws-route").map(([name, value]) =>
    name === ":protocol" ? ([name, "webtransport"] as [string, string]) : ([name, value] as [string, string]),
  );
  raw.headers(3, unsupported, F.END_HEADERS | F.END_STREAM);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 3)).payload)).toBe(404);
  expect((await raw.body(3)).toString()).toBe("not found: /ws-route");

  raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
  raw.close();
});

test("RFC 8441 handshake uses 200, omits Key/Accept, and preserves selected response headers", async () => {
  const session = await connectH2(fx.port, secure);
  try {
    if (!session.remoteSettings.enableConnectProtocol) {
      await new Promise<void>((resolve, reject) => {
        session.once("remoteSettings", settings =>
          settings.enableConnectProtocol ? resolve() : reject(new Error("server did not advertise Extended CONNECT")),
        );
        session.once("error", reject);
      });
    }

    const stream = session.request(
      {
        ":method": "CONNECT",
        ":scheme": secure ? "https" : "http",
        ":path": "/ws-headers",
        ":authority": "localhost",
        ":protocol": "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": "not-used-by-rfc-8441",
        "sec-websocket-protocol": "chat, superchat",
      },
      { endStream: false },
    );
    const response = await new Promise<http2.IncomingHttpHeaders>((resolve, reject) => {
      stream.once("response", resolve);
      stream.once("error", reject);
    });
    expect(response[":status"]).toBe(200);
    expect(response["sec-websocket-protocol"]).toBe("chat");
    expect(response["x-upgrade-transport"]).toBe("h2");
    expect(response["sec-websocket-accept"]).toBeUndefined();
    expect(response["content-length"]).toBeUndefined();

    const echoed = nextHttp2WebSocketFrame(stream);
    stream.write(wsClientFrame(1, "headers-ok"));
    expect(wsServerFrame(await echoed).payload.toString()).toBe("headers-ok");

    const ended = new Promise<void>((resolve, reject) => {
      stream.once("end", resolve);
      stream.once("error", reject);
    });
    stream.end(wsClientFrame(8, Buffer.from([0x03, 0xe8])));
    await ended;

    const assertUnnegotiatedHeaderIsOmitted = async (
      path: string,
      requestHeaders: http2.OutgoingHttpHeaders,
      responseHeader: string,
    ) => {
      const candidate = session.request(
        {
          ":method": "CONNECT",
          ":scheme": secure ? "https" : "http",
          ":path": path,
          ":authority": "localhost",
          ":protocol": "websocket",
          "sec-websocket-version": "13",
          ...requestHeaders,
        },
        { endStream: false },
      );
      const headers = await new Promise<http2.IncomingHttpHeaders>((resolve, reject) => {
        candidate.once("response", resolve);
        candidate.once("error", reject);
      });
      expect(headers[":status"]).toBe(200);
      expect(headers[responseHeader]).toBeUndefined();
      const candidateEnded = new Promise<void>((resolve, reject) => {
        candidate.once("end", resolve);
        candidate.once("error", reject);
      });
      // The close response is a WebSocket frame in HTTP/2 DATA. Node does not
      // emit `end` for an unread response body, so explicitly drain it.
      candidate.resume();
      candidate.end(wsClientFrame(8, Buffer.from([0x03, 0xe8])));
      await candidateEnded;
    };

    await assertUnnegotiatedHeaderIsOmitted("/ws-headers", {}, "sec-websocket-protocol");
    await assertUnnegotiatedHeaderIsOmitted(
      "/ws-bogus-protocol",
      { "sec-websocket-protocol": "chat" },
      "sec-websocket-protocol",
    );
    await assertUnnegotiatedHeaderIsOmitted("/ws-force-extension", {}, "sec-websocket-extensions");

    // RFC 6455 version negotiation still applies to Extended CONNECT even
    // though Sec-WebSocket-Key/Accept do not. A rejected client must learn
    // which version this endpoint supports.
    const rejected = session.request(
      {
        ":method": "CONNECT",
        ":scheme": secure ? "https" : "http",
        ":path": "/ws",
        ":authority": "localhost",
        ":protocol": "websocket",
        "sec-websocket-version": "12",
      },
      { endStream: false },
    );
    const rejection = await new Promise<http2.IncomingHttpHeaders>((resolve, reject) => {
      rejected.once("response", resolve);
      rejected.once("error", reject);
    });
    expect(rejection[":status"]).toBe(426);
    expect(rejection["sec-websocket-version"]).toBe("13");
    rejected.close();
  } finally {
    session.destroy();
  }
});

test("RFC 8441 handshake, binary echo, and close work over TLS/ALPN", async () => {
  await using tlsFixture = await startFixture({ tls: true });
  const tlsSession = await connectH2(tlsFixture.port, true);
  try {
    if (!tlsSession.remoteSettings.enableConnectProtocol) {
      await new Promise<void>((resolve, reject) => {
        tlsSession.once("remoteSettings", settings =>
          settings.enableConnectProtocol
            ? resolve()
            : reject(new Error("TLS server did not advertise Extended CONNECT")),
        );
        tlsSession.once("error", reject);
      });
    }

    const stream = tlsSession.request(
      {
        ":method": "CONNECT",
        ":scheme": "https",
        ":path": "/ws",
        ":authority": "localhost",
        ":protocol": "websocket",
        "sec-websocket-version": "13",
      },
      { endStream: false },
    );
    const response = await new Promise<http2.IncomingHttpHeaders>((resolve, reject) => {
      stream.once("response", resolve);
      stream.once("error", reject);
    });
    expect(response[":status"]).toBe(200);

    const payload = Buffer.from([0x00, 0xff, 0x54, 0x4c, 0x53]);
    const echoed = nextHttp2WebSocketFrame(stream);
    stream.write(wsClientFrame(2, payload));
    const message = wsServerFrame(await echoed);
    expect(message).toMatchObject({ opcode: 2, fin: true });
    expect(message.payload).toEqual(payload);

    const ended = new Promise<void>((resolve, reject) => {
      stream.once("end", resolve);
      stream.once("error", reject);
    });
    stream.resume();
    stream.end(wsClientFrame(8, Buffer.from([0x03, 0xe8])));
    await ended;
  } finally {
    tlsSession.destroy();
  }
});

test("server.reload keeps an existing HTTP/1 WebSocket handler reference valid", async () => {
  await using reloadFixture = await startFixture({ tls: secure });
  const ws = new WebSocket(`ws://127.0.0.1:${reloadFixture.port}/ws`);
  const messages: string[] = [];
  let wake: (() => void) | undefined;
  ws.onmessage = event => {
    messages.push(String(event.data));
    wake?.();
    wake = undefined;
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = event => reject(event);
  });
  const waitForMessage = async (expected: string) => {
    while (!messages.includes(expected)) await new Promise<void>(resolve => (wake = resolve));
  };

  ws.send("reload-handlers");
  await waitForMessage("reload-complete");
  ws.send("after");
  await waitForMessage("reloaded:after");
  ws.close();
});

test("pub/sub bridges HTTP/1 and RFC 8441 subscribers", async () => {
  await using pubsubFixture = await startFixture({ tls: secure });
  const h1 = new WebSocket(`ws://127.0.0.1:${pubsubFixture.port}/ws`);
  const h1Messages: string[] = [];
  let h1Wake: (() => void) | undefined;
  h1.onmessage = event => {
    h1Messages.push(String(event.data));
    h1Wake?.();
    h1Wake = undefined;
  };
  await new Promise<void>((resolve, reject) => {
    h1.onopen = () => resolve();
    h1.onerror = event => reject(event);
  });
  const waitForH1 = async (expected: string) => {
    while (!h1Messages.includes(expected)) await new Promise<void>(resolve => (h1Wake = resolve));
  };

  const h2 = await RawH2.connect(pubsubFixture.port, secure);
  h2.headers(1, websocketHeaders(), F.END_HEADERS);
  expect(decodeStatus((await h2.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);
  const waitForH2Stream = (streamId: number, expected: string) =>
    h2.waitFor(f => {
      if (f.type !== T.DATA || f.streamId !== streamId || f.payload.length < 2 || f.payload[0] !== 0x81) return false;
      return wsServerFrame(f.payload).payload.toString() === expected;
    });
  const waitForH2 = (expected: string) => waitForH2Stream(1, expected);

  h1.send("subscribe:from-h2");
  await waitForH1("subscribed:from-h2");
  h2.write(frame(T.DATA, 0, 1, wsClientFrame(1, "publish:from-h2:h2-to-h1")));
  await waitForH1("h2-to-h1");

  h2.write(frame(T.DATA, 0, 1, wsClientFrame(1, "subscribe:from-h1")));
  await waitForH2("subscribed:from-h1");
  h2.write(frame(T.DATA, 0, 1, wsClientFrame(1, "subscriptions")));
  expect(JSON.parse(wsServerFrame((await waitForH2('["from-h1"]')).payload).payload.toString())).toEqual(["from-h1"]);
  h1.send("publish:from-h1:h1-to-h2");
  await waitForH2("h1-to-h2");

  // The public server.publish() API must use the same cross-transport
  // aggregator as ws.publish(), including delivery to both topic trees.
  h1.send("subscribe:from-server");
  await waitForH1("subscribed:from-server");
  h2.write(frame(T.DATA, 0, 1, wsClientFrame(1, "subscribe:from-server")));
  await waitForH2("subscribed:from-server");
  h2.write(frame(T.DATA, 0, 1, wsClientFrame(1, "server-publish:from-server:server-to-both")));
  await Promise.all([waitForH1("server-to-both"), waitForH2("server-to-both")]);
  await waitForH2("server-publish-status:14");

  // Small H2-to-H2 publications use TopicTree's loop-batched queue. They
  // must be delivered even when no later direct send happens on the receiver.
  h2.headers(3, websocketHeaders(), F.END_HEADERS);
  expect(decodeStatus((await h2.waitFor(f => f.type === T.HEADERS && f.streamId === 3)).payload)).toBe(200);
  h2.write(frame(T.DATA, 0, 3, wsClientFrame(1, "subscribe:h2-only")));
  await waitForH2Stream(3, "subscribed:h2-only");
  h2.write(frame(T.DATA, 0, 1, wsClientFrame(1, "publish:h2-only:queued-h2-delivery")));
  await waitForH2Stream(3, "queued-h2-delivery");

  // Fill stream 3's peer window without WINDOW_UPDATE. A small queued
  // publication must report the same -1/Backpressure result as H1 while the
  // independent publisher on stream 1 can still send its acknowledgement.
  const beforeFill = received(h2, 3);
  h2.write(frame(T.DATA, 0, 3, wsClientFrame(1, "fill-backpressure")));
  await h2.waitFor(f => f.type === T.DATA && f.streamId === 3 && received(h2, 3) >= beforeFill + 60_000);
  // DATA consumes both the stream and connection windows. Reopen only the
  // connection window so stream 1 can report the result while stream 3 stays
  // flow-control blocked.
  h2.write(frame(T.WINDOW_UPDATE, 0, 0, u32(65_535)));
  h2.write(frame(T.DATA, 0, 1, wsClientFrame(1, "publish-status:h2-only:backpressured")));
  await waitForH2("publish-status:-1");

  h2.write(frame(T.DATA, 0, 1, wsClientFrame(1, "unsubscribe:from-h1")));
  await waitForH2("unsubscribed:from-h1");
  h2.write(frame(T.DATA, 0, 1, wsClientFrame(1, "subscriptions")));
  await waitForH2('["from-server"]');

  h1.close();
  h2.write(frame(T.RST_STREAM, 0, 3, u32(8)));
  h2.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  await h2.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
  h2.close();
});

test("RFC 8441 pub/sub honors closeOnBackpressureLimit", async () => {
  for (const closeOnLimit of [false, true]) {
    await using pubsubFixture = await startFixture({
      tls: secure,
      websocketBackpressureLimit: 1024,
      websocketCloseOnBackpressureLimit: closeOnLimit,
    });
    const raw = await RawH2.connect(pubsubFixture.port, secure);
    raw.headers(1, websocketHeaders(), F.END_HEADERS);
    raw.headers(3, websocketHeaders(), F.END_HEADERS);
    expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);
    expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 3)).payload)).toBe(200);

    const waitText = (streamId: number, expected: string, afterFrame = 0) =>
      raw.waitFor(f => {
        if (raw.frames.indexOf(f) < afterFrame || f.type !== T.DATA || f.streamId !== streamId) return false;
        if (f.payload.length < 2 || f.payload[0] !== 0x81) return false;
        return wsServerFrame(f.payload).payload.toString() === expected;
      });

    raw.write(frame(T.DATA, 0, 3, wsClientFrame(1, "subscribe:bounded-topic")));
    await waitText(3, "subscribed:bounded-topic");
    const beforeFill = received(raw, 3);
    raw.write(frame(T.DATA, 0, 3, wsClientFrame(1, "fill-bounded-backpressure")));
    await raw.waitFor(() => received(raw, 3) >= beforeFill + 65_000);

    // Keep stream 3 flow-control blocked while stream 1 publishes more than
    // its remaining 1 KiB budget. The option controls whether the subscriber
    // is retained or reset; the publication itself is dropped in both cases.
    raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(70_000)));
    const publishAckAfter = raw.frames.length;
    raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, `publish:bounded-topic:${"p".repeat(2048)}`)));
    await waitText(1, "published:bounded-topic", publishAckAfter);

    if (closeOnLimit) {
      expect(await raw.rst(3)).toBe(8); // CANCEL
      const aliveAfter = raw.frames.length;
      raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, "publisher-alive")));
      await waitText(1, "publisher-alive", aliveAfter);
    } else {
      await Bun.sleep(50);
      expect(raw.frames.some(f => f.type === T.RST_STREAM && f.streamId === 3)).toBe(false);
      raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(70_000)));
      raw.write(frame(T.WINDOW_UPDATE, 0, 3, u32(70_000)));
      await raw.waitFor(() => received(raw, 3) >= beforeFill + 66_010);
      const aliveAfter = raw.frames.length;
      raw.write(frame(T.DATA, 0, 3, wsClientFrame(1, "subscriber-alive")));
      await waitText(3, "subscriber-alive", aliveAfter);
      raw.write(frame(T.RST_STREAM, 0, 3, u32(8)));
    }

    raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
    await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
    raw.close();
  }
}, 20_000);

test("SETTINGS_ENABLE_CONNECT_PROTOCOL remains a transport capability without a WebSocket handler", async () => {
  await using noWebSocket = await startFixture({ tls: secure, websocket: false });
  const raw = await RawH2.connect(noWebSocket.port, secure);
  const settings = await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) === 0);
  const advertised = new Map<number, number>();
  for (let i = 0; i < settings.payload.length; i += 6) {
    advertised.set(settings.payload.readUInt16BE(i), settings.payload.readUInt32BE(i + 2));
  }
  expect(advertised.get(0x8)).toBe(1);

  // Capability advertisement does not promise support for every protocol.
  // A 2xx CONNECT response would claim that a tunnel exists, so an ordinary
  // fetch response is forced to a non-success status when no adapter adopts
  // this stream.
  raw.headers(1, websocketHeaders("/hello"), F.END_HEADERS);
  const response = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
  expect(decodeStatus(response.payload)).toBe(501);
  expect((await raw.body(1)).toString()).toBe("hello");
  raw.close();
});

test("an already half-closed Extended CONNECT is refused as HTTP, not a protocol error", async () => {
  const raw = await RawH2.connect(fx.port, secure);
  raw.headers(1, websocketHeaders());
  const response = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
  expect(decodeStatus(response.payload)).toBe(400);
  expect((await raw.body(1)).toString()).toBe("upgrade failed");
  expect(raw.frames.some(f => f.type === T.RST_STREAM && f.streamId === 1)).toBe(false);
  raw.close();
});

test("END_STREAM during an asynchronous RFC 8441 decision is refused as HTTP", async () => {
  const raw = await RawH2.connect(fx.port, secure);
  raw.write(
    Buffer.concat([
      frame(T.HEADERS, F.END_HEADERS, 1, hpackLiteral(websocketHeaders("/ws-delayed-end"))),
      frame(T.DATA, F.END_STREAM, 1),
    ]),
  );
  const response = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
  expect(decodeStatus(response.payload)).toBe(400);
  expect((await raw.body(1)).toString()).toBe("upgrade failed");
  expect(raw.frames.some(f => f.type === T.RST_STREAM && f.streamId === 1)).toBe(false);
  raw.close();
});

for (const [name, fields] of [
  ["missing version", websocketHeaders().filter(([header]) => header !== "sec-websocket-version")],
  [
    "unsupported version",
    websocketHeaders().map(([header, value]) =>
      header === "sec-websocket-version" ? ([header, "12"] as [string, string]) : ([header, value] as [string, string]),
    ),
  ],
] as const) {
  test(`RFC 8441 rejects ${name} without adopting the stream`, async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, fields as [string, string][], F.END_HEADERS);
    const response = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
    expect(decodeStatus(response.payload)).toBe(426);

    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.body(3)).toString()).toBe("hello");
    expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
    raw.close();
  });
}

test("Content-Length does not classify RFC 8441 tunnel bytes as an HTTP request body", async () => {
  const raw = await RawH2.connect(fx.port, secure);
  raw.headers(1, [...websocketHeaders(), ["content-length", "0"]], F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, "not an HTTP body")));
  const echo = wsServerFrame((await raw.waitFor(f => f.type === T.DATA && f.streamId === 1)).payload);
  expect(echo.payload.toString()).toBe("not an HTTP body");

  raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
  raw.close();
});

const malformedExtendedConnectCases: [string, [string, string][]][] = [
  ["missing :method", websocketHeaders().filter(([name]) => name !== ":method")],
  ["missing :scheme", websocketHeaders().filter(([name]) => name !== ":scheme")],
  ["missing :path", websocketHeaders().filter(([name]) => name !== ":path")],
  ["missing :authority", websocketHeaders().filter(([name]) => name !== ":authority")],
  ["missing :protocol", websocketHeaders().filter(([name]) => name !== ":protocol")],
  ["duplicate :protocol", [...websocketHeaders(), [":protocol", "websocket"]]],
  ["empty :protocol", websocketHeaders().map(([name, value]) => (name === ":protocol" ? [name, ""] : [name, value]))],
  [
    "non-token :protocol",
    websocketHeaders().map(([name, value]) => (name === ":protocol" ? [name, "web socket"] : [name, value])),
  ],
  [
    "WebSocket :scheme inconsistent with cleartext transport",
    websocketHeaders().map(([name, value]) => (name === ":scheme" ? [name, "https"] : [name, value])),
  ],
  [
    "GET with :protocol",
    websocketHeaders().map(([name, value]) => (name === ":method" ? [name, "GET"] : [name, value])),
  ],
  [
    ":protocol after a regular field",
    [
      [":method", "CONNECT"],
      [":scheme", "http"],
      [":path", "/ws"],
      [":authority", "localhost"],
      ["sec-websocket-version", "13"],
      [":protocol", "websocket"],
    ],
  ],
];

for (const [name, fields] of malformedExtendedConnectCases) {
  test(`RFC 8441 malformed Extended CONNECT (${name}) → RST_STREAM PROTOCOL_ERROR`, async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, fields);
    expect(await raw.rst(1)).toBe(1);

    // A malformed Extended CONNECT is a stream error.  It must not tear down
    // unrelated streams on the multiplexed HTTP/2 connection.
    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.body(3)).toString()).toBe("hello");
    expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
    raw.close();
  });
}

test("RFC 8441 does not treat an unsupported :protocol as a WebSocket", async () => {
  const raw = await RawH2.connect(fx.port, secure);
  const fields = websocketHeaders().map(([name, value]) =>
    name === ":protocol" ? ([name, "webtransport"] as [string, string]) : ([name, value] as [string, string]),
  );
  // The fixture only implements the websocket protocol.  The request is
  // still a valid Extended CONNECT, but must reach the ordinary HTTP route
  // and fail its WebSocket upgrade instead of receiving a 200 tunnel.
  raw.headers(1, fields);
  const response = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
  expect(decodeStatus(response.payload)).toBe(400);
  expect((await raw.body(1)).toString()).toBe("upgrade failed");
  expect(raw.frames.some(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x81)).toBe(false);
  expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);

  raw.headers(3, baseHeaders("/hello"));
  expect((await raw.body(3)).toString()).toBe("hello");
  raw.close();
});

test("RFC 8441 WebSocket Extended CONNECT uses one HTTP/2 stream", async () => {
  const raw = await RawH2.connect(fx.port, secure);
  const settings = await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) === 0);
  const advertised = new Map<number, number>();
  for (let i = 0; i < settings.payload.length; i += 6) {
    advertised.set(settings.payload.readUInt16BE(i), settings.payload.readUInt32BE(i + 2));
  }
  expect(advertised.get(0x8)).toBe(1);

  raw.headers(1, websocketHeaders(), F.END_HEADERS);
  const response = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
  expect(decodeStatus(response.payload)).toBe(200);
  expect(response.flags & F.END_STREAM).toBe(0);

  // The uWebSockets frame parser must retain its state across H2 DATA
  // boundaries, including a split masking key.
  const clientMessage = wsClientFrame(1, "hello over h2");
  raw.write(frame(T.DATA, 0, 1, clientMessage.subarray(0, 4)));
  raw.write(frame(T.DATA, 0, 1, clientMessage.subarray(4)));
  const echoed = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload.length > 0);
  const message = wsServerFrame(echoed.payload);
  expect(message).toMatchObject({ opcode: 1, fin: true });
  expect(message.payload.toString()).toBe("hello over h2");

  // The shared RFC 6455 parser must preserve binary opcode/payload across the
  // H2 adapter and Bun's default Buffer binaryType conversion.
  const binaryPayload = Buffer.from([0x00, 0xff, 0x7f, 0x80, 0x42]);
  raw.write(frame(T.DATA, 0, 1, wsClientFrame(2, binaryPayload)));
  const binary = wsServerFrame(
    (await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x82)).payload,
  );
  expect(binary).toMatchObject({ opcode: 2, fin: true });
  expect(binary.payload).toEqual(binaryPayload);

  const closePayload = Buffer.alloc(2);
  closePayload.writeUInt16BE(1000);
  raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, closePayload)));
  const close = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x88);
  expect(wsServerFrame(close.payload).payload.readUInt16BE(0)).toBe(1000);
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);

  // Closing the tunnel retires only stream 1; the H2 connection remains usable.
  raw.headers(3, baseHeaders("/hello"));
  const sibling = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 3);
  expect(decodeStatus(sibling.payload)).toBe(200);
  expect((await raw.body(3)).toString()).toBe("hello");
  raw.close();
});

test("RFC 8441 preserves DATA received before an asynchronous upgrade decision", async () => {
  const raw = await RawH2.connect(fx.port, secure);
  const firstMessage = wsClientFrame(1, "arrived with HEADERS");

  // One socket write deliberately contains the complete field section and the
  // first tunnel DATA. The fixture yields a microtask before upgrade(), so the
  // transport must hold these bytes until the RFC 6455 codec is attached.
  raw.write(
    Buffer.concat([
      frame(T.HEADERS, F.END_HEADERS, 1, hpackLiteral(websocketHeaders("/ws-delayed"))),
      frame(T.DATA, 0, 1, firstMessage),
    ]),
  );

  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);
  const echoed = wsServerFrame((await raw.waitFor(f => f.type === T.DATA && f.streamId === 1)).payload);
  expect(echoed.payload.toString()).toBe("arrived with HEADERS");

  raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
  raw.close();
});

test("server.reload keeps an existing RFC 8441 stream on a stable handler slot", async () => {
  await using reloadFixture = await startFixture({ tls: secure });
  const raw = await RawH2.connect(reloadFixture.port, secure);
  raw.headers(1, websocketHeaders(), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, "reload-handlers")));
  const reloaded = await raw.waitFor(f => {
    if (f.type !== T.DATA || f.streamId !== 1 || f.payload[0] !== 0x81) return false;
    return wsServerFrame(f.payload).payload.toString() === "reload-complete";
  });
  expect(wsServerFrame(reloaded.payload).payload.toString()).toBe("reload-complete");

  raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, "after")));
  const after = await raw.waitFor(f => {
    if (f.type !== T.DATA || f.streamId !== 1 || f.payload[0] !== 0x81) return false;
    return wsServerFrame(f.payload).payload.toString() === "reloaded:after";
  });
  expect(wsServerFrame(after.payload).payload.toString()).toBe("reloaded:after");

  raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
  raw.close();
});

test("RFC 8441 open callback can reload handlers synchronously", async () => {
  await using reloadFixture = await startFixture({ tls: secure });
  const raw = await RawH2.connect(reloadFixture.port, secure);
  raw.headers(1, websocketHeaders("/ws-open-reload"), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  const opened = await raw.waitFor(f => {
    if (f.type !== T.DATA || f.streamId !== 1 || f.payload[0] !== 0x81) return false;
    return wsServerFrame(f.payload).payload.toString() === "open-reload-complete";
  });
  expect(wsServerFrame(opened.payload).payload.toString()).toBe("open-reload-complete");

  raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, "after-open")));
  const after = await raw.waitFor(f => {
    if (f.type !== T.DATA || f.streamId !== 1 || f.payload[0] !== 0x81) return false;
    return wsServerFrame(f.payload).payload.toString() === "reloaded:after-open";
  });
  expect(wsServerFrame(after.payload).payload.toString()).toBe("reloaded:after-open");

  raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
  raw.close();
  expect(reloadFixture.proc.signalCode).toBeNull();
});

test("RFC 8441 open callback can stop the server synchronously", async () => {
  await using stopFixture = await startFixture({ tls: secure });
  const raw = await RawH2.connect(stopFixture.port, secure, { sendPreface: false });
  // Exercise the adoption fast path: the first TCP read can already contain
  // the complete preface, SETTINGS and request that enters user JavaScript.
  raw.write(
    Buffer.concat([
      PREFACE,
      frame(T.SETTINGS, 0, 0),
      frame(T.HEADERS, F.END_HEADERS, 1, hpackLiteral(websocketHeaders("/ws-open-stop"))),
    ]),
  );
  await Promise.race([
    raw.waitForClose(),
    Bun.sleep(5_000).then(() => {
      throw new Error("server.stop(true) in WebSocket open did not close the H2 connection");
    }),
  ]);
  expect(stopFixture.proc.signalCode).toBeNull();
}, 10_000);

test("RFC 8441 snapshots a retained Request before detaching the H2 stream", async () => {
  const raw = await RawH2.connect(fx.port, secure);
  raw.headers(
    1,
    [...websocketHeaders("/ws-retain-request"), ["x-retained-request", "present-after-upgrade"]],
    F.END_HEADERS,
  );
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);
  raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, "retained-request")));
  const report = wsServerFrame(
    (await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x81)).payload,
  );
  expect(JSON.parse(report.payload.toString())).toEqual({
    url: "http://localhost/ws-retain-request",
    header: "present-after-upgrade",
  });

  raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
  raw.close();
});

test("RFC 8441 idle timeout is per stream, not refreshed by an active sibling", async () => {
  await using timeoutFixture = await startFixture({
    tls: secure,
    idleTimeout: 30,
    websocketIdleTimeout: 1,
    websocketPings: false,
  });
  const raw = await RawH2.connect(timeoutFixture.port, secure);
  raw.headers(1, websocketHeaders(), F.END_HEADERS);
  raw.headers(3, websocketHeaders(), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 3)).payload)).toBe(200);

  // Keep stream 1 active across multiple native timer ticks. Stream 3 must
  // still expire independently with CANCEL, without GOAWAY.
  const activity = setInterval(() => {
    if (!raw.closed) raw.write(frame(T.DATA, 0, 1, wsClientFrame(9, "keepalive")));
  }, 250);
  try {
    const reset = await Promise.race([
      raw.rst(3),
      Bun.sleep(10_000).then(() => {
        const stream3Data = raw.frames
          .filter(f => f.type === T.DATA && f.streamId === 3)
          .map(f => f.payload.toString("hex"));
        throw new Error(
          "idle WebSocket stream did not time out; stream 3 DATA=" +
            JSON.stringify(stream3Data) +
            "; got " +
            raw.describe(),
        );
      }),
    ]);
    expect(reset).toBe(8); // CANCEL
  } finally {
    clearInterval(activity);
  }
  expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);

  raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, "still alive")));
  const echo = await raw.waitFor(f => {
    if (f.type !== T.DATA || f.streamId !== 1 || f.payload[0] !== 0x81) return false;
    return wsServerFrame(f.payload).payload.toString() === "still alive";
  });
  expect(wsServerFrame(echo.payload).payload.toString()).toBe("still alive");
  raw.headers(5, baseHeaders("/hello"));
  expect((await raw.body(5)).toString()).toBe("hello");

  raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
  raw.close();
}, 15_000);

test("RFC 8441 idle timeout is not hidden by outbound-only sibling traffic", async () => {
  await using timeoutFixture = await startFixture({
    tls: secure,
    idleTimeout: 30,
    websocketIdleTimeout: 1,
    websocketPings: false,
  });
  const raw = await RawH2.connect(timeoutFixture.port, secure);
  raw.headers(1, websocketHeaders(), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  // After this request HEADERS, the client sends nothing. The server produces
  // DATA periodically on stream 3 for twelve seconds. Those connection-wide
  // writes must not keep the silent WebSocket stream alive.
  raw.headers(3, baseHeaders("/slow-outbound"), F.END_HEADERS | F.END_STREAM);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 3)).payload)).toBe(200);
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 3 && f.payload.length > 0);

  const reset = await Promise.race([
    raw.rst(1),
    Bun.sleep(10_000).then(() => {
      throw new Error("outbound sibling traffic hid the idle WebSocket deadline; got " + raw.describe());
    }),
  ]);
  expect(reset).toBe(8); // CANCEL
  expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);

  // The timeout is stream-local: the producing sibling and the connection
  // remain usable after stream 1 is reset.
  expect(await raw.body(3)).toHaveLength(48);
  raw.headers(5, baseHeaders("/hello"));
  expect((await raw.body(5)).toString()).toBe("hello");
  raw.close();
}, 20_000);

test("RFC 8441 automatic ping uses the uWebSockets idle/grace timeout split", async () => {
  await using timeoutFixture = await startFixture({
    tls: secure,
    idleTimeout: 30,
    websocketIdleTimeout: 8,
    websocketPings: true,
  });
  const raw = await RawH2.connect(timeoutFixture.port, secure);
  raw.headers(1, websocketHeaders(), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  const started = performance.now();
  const ping = await Promise.race([
    raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x89),
    Bun.sleep(9_000).then(() => {
      throw new Error("automatic ping did not use the shortened idle phase; got " + raw.describe());
    }),
  ]);
  expect(wsServerFrame(ping.payload)).toMatchObject({ opcode: 9, fin: true });
  const pingElapsed = performance.now() - started;
  // idleTimeout=8 is split into a four-second idle phase and four-second
  // grace phase. The uSockets wheel may wake late, but never before the
  // monotonic stream deadline.
  expect(pingElapsed).toBeGreaterThanOrEqual(3_000);
  expect(pingElapsed).toBeLessThan(9_000);

  // Ignore the ping. The short grace period closes only this stream; the
  // connection remains available for ordinary multiplexed requests.
  expect(
    await Promise.race([
      raw.rst(1),
      Bun.sleep(9_000).then(() => {
        throw new Error("automatic ping grace period did not reset the idle stream");
      }),
    ]),
  ).toBe(8); // CANCEL
  raw.headers(3, baseHeaders("/hello"));
  expect((await raw.body(3)).toString()).toBe("hello");
  expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
  raw.close();
}, 22_000);

test("RFC 8441 close callback keeps the full reason while the wire reason is bounded", async () => {
  await using closeFixture = await startFixture({ tls: secure });
  const raw = await RawH2.connect(closeFixture.port, secure);
  raw.headers(1, websocketHeaders("/ws-close-report"), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, "close-long")));
  const close = wsServerFrame(
    (await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x88)).payload,
  );
  expect(close.payload.readUInt16BE(0)).toBe(1000);
  expect(close.payload.subarray(2)).toEqual(Buffer.alloc(123, "x"));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);

  await Promise.race([
    (async () => {
      while (!closeFixture.stderr().includes("WS-CLOSE-REASON:200:" + "x".repeat(200))) await Bun.sleep(10);
    })(),
    Bun.sleep(2_000).then(() => {
      throw new Error("close callback did not receive the complete application reason: " + closeFixture.stderr());
    }),
  ]);
  raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  raw.close();
}, 10_000);

test("RFC 8441 removes subscriptions before the close callback and close-grace period", async () => {
  await using closeFixture = await startFixture({ tls: secure });
  const raw = await RawH2.connect(closeFixture.port, secure);
  raw.headers(1, websocketHeaders("/ws-close-subscriptions"), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);
  raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, "subscribe:closing-topic")));
  await raw.waitFor(f => {
    if (f.type !== T.DATA || f.streamId !== 1 || f.payload[0] !== 0x81) return false;
    return wsServerFrame(f.payload).payload.toString() === "subscribed:closing-topic";
  });

  // Leave the peer half open after the local close. The stream remains in its
  // close-grace period, but it must no longer be a topic subscriber.
  raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, "close-local")));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x88);
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);

  raw.headers(3, websocketHeaders(), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 3)).payload)).toBe(200);
  raw.write(frame(T.DATA, 0, 3, wsClientFrame(1, "server-subscriber-count:closing-topic")));
  await raw.waitFor(f => {
    if (f.type !== T.DATA || f.streamId !== 3 || f.payload[0] !== 0x81) return false;
    return wsServerFrame(f.payload).payload.toString() === "server-subscriber-count:0";
  });
  expect(closeFixture.stderr()).toContain("WS-CLOSE-SUBSCRIPTIONS:[]");

  raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  raw.write(frame(T.DATA, F.END_STREAM, 3, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 3 && (f.flags & F.END_STREAM) !== 0);
  raw.close();
}, 10_000);

test("RFC 8441 terminate removes subscriptions synchronously", async () => {
  await using terminateFixture = await startFixture({ tls: secure });
  const raw = await RawH2.connect(terminateFixture.port, secure);
  raw.headers(1, websocketHeaders(), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);
  raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, "subscribe:terminated-topic")));
  await raw.waitFor(f => {
    if (f.type !== T.DATA || f.streamId !== 1 || f.payload[0] !== 0x81) return false;
    return wsServerFrame(f.payload).payload.toString() === "subscribed:terminated-topic";
  });

  raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, "terminate-and-count")));
  expect(await raw.rst(1)).toBe(8); // CANCEL
  // The RST can reach the peer while the message callback is still resuming
  // from terminate(), especially under ASAN. Wait for the observation made
  // immediately after terminate() returns rather than racing stderr delivery.
  await Promise.race([
    (async () => {
      while (!terminateFixture.stderr().includes("WS-TERMINATE-SUBSCRIBERS:0")) await Bun.sleep(10);
    })(),
    Bun.sleep(5_000).then(() => {
      throw new Error("terminate() did not remove the subscription synchronously: " + terminateFixture.stderr());
    }),
  ]);
  expect(terminateFixture.stderr()).toContain("WS-TERMINATE-SUBSCRIBERS:0");
  expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);

  raw.headers(3, baseHeaders("/hello"));
  expect((await raw.body(3)).toString()).toBe("hello");
  raw.close();
}, 10_000);

test("RFC 8441 close handshake timeout resets only the unresponsive stream", async () => {
  await using closeTimeoutFixture = await startFixture({
    tls: secure,
    websocketIdleTimeout: 8,
  });
  const raw = await RawH2.connect(closeTimeoutFixture.port, secure);
  raw.headers(1, websocketHeaders(), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  // Ask the application to initiate a normal WebSocket close, but deliberately
  // leave the client half of the H2 stream open and send no close reply.
  raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, "close-local")));
  const close = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x88);
  expect(wsServerFrame(close.payload)).toMatchObject({ opcode: 8, fin: true });
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);

  // Multiplexed work must continue while the WebSocket close deadline runs.
  raw.headers(3, baseHeaders("/hello"));
  expect((await raw.body(3)).toString()).toBe("hello");

  // DATA received after local close must not refresh the short close-grace
  // deadline. Otherwise a malicious half-open peer can keep the stream and
  // its application state alive forever.
  const keepSending = setInterval(() => {
    if (!raw.closed) raw.write(frame(T.DATA, 0, 1, wsClientFrame(9, "still-open")));
  }, 100);
  const reset = await Promise.race([
    raw.rst(1),
    Bun.sleep(10_000).then(() => {
      throw new Error("inbound DATA postponed the WebSocket close deadline");
    }),
  ]).finally(() => clearInterval(keepSending));
  expect(reset).toBe(8); // CANCEL
  expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);

  raw.headers(5, baseHeaders("/hello"));
  expect((await raw.body(5)).toString()).toBe("hello");
  raw.close();
}, 18_000);

test("RFC 8441 keeps WebSocket fragmentation and control frames stream-local", async () => {
  const raw = await RawH2.connect(fx.port, secure);
  raw.headers(1, websocketHeaders(), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  raw.write(
    frame(
      T.DATA,
      0,
      1,
      Buffer.concat([wsClientFrame(1, "hello ", false), wsClientFrame(9, "ping"), wsClientFrame(0, "fragmented")]),
    ),
  );
  const pong = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x8a);
  expect(wsServerFrame(pong.payload).payload.toString()).toBe("ping");
  const echoed = await raw.waitFor(f => {
    if (f.type !== T.DATA || f.streamId !== 1 || f.payload[0] !== 0x81) return false;
    return wsServerFrame(f.payload).payload.toString() === "hello fragmented";
  });
  expect(wsServerFrame(echoed.payload).fin).toBe(true);

  // A normal request remains independent while the tunnel is still open.
  raw.headers(3, baseHeaders("/hello"));
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 3)).payload)).toBe(200);
  expect((await raw.body(3)).toString()).toBe("hello");

  raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
  raw.close();
});

test("RFC 8441 dispatches WebSocket ping and pong callbacks", async () => {
  const raw = await RawH2.connect(fx.port, secure);
  raw.headers(1, websocketHeaders("/ws-control"), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  raw.write(frame(T.DATA, 0, 1, wsClientFrame(9, "client-ping")));
  const pongFrame = wsServerFrame(
    (await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x8a)).payload,
  );
  expect(pongFrame.payload.toString()).toBe("client-ping");
  const pingCallback = wsServerFrame(
    (
      await raw.waitFor(
        f =>
          f.type === T.DATA &&
          f.streamId === 1 &&
          f.payload[0] === 0x81 &&
          wsServerFrame(f.payload).payload.toString() === "ping-callback:client-ping",
      )
    ).payload,
  );
  expect(pingCallback.payload.toString()).toBe("ping-callback:client-ping");

  raw.write(frame(T.DATA, 0, 1, wsClientFrame(10, "client-pong")));
  const pongCallback = wsServerFrame(
    (
      await raw.waitFor(
        f =>
          f.type === T.DATA &&
          f.streamId === 1 &&
          f.payload[0] === 0x81 &&
          wsServerFrame(f.payload).payload.toString() === "pong-callback:client-pong",
      )
    ).payload,
  );
  expect(pongCallback.payload.toString()).toBe("pong-callback:client-pong");

  raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
  raw.close();
});

test("RFC 8441 resets only a Ping-flooded tunnel when Pong backpressure reaches its limit", async () => {
  await using boundedFixture = await startFixture({
    tls: secure,
    websocketBackpressureLimit: 1024,
  });
  const raw = await RawH2.connect(boundedFixture.port, secure, { settings: setting(4, 0) });
  await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
  raw.headers(1, websocketHeaders(), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  // Each 125-byte Ping requires a 127-byte Pong frame. With a zero peer
  // stream window, an unlimited control-frame bypass would queue all 15 KiB.
  // Once the configured 1 KiB budget is full, the server must fail this
  // tunnel instead of retaining more Pongs or silently dropping the newest.
  const ping = wsClientFrame(9, Buffer.alloc(125, 0x70));
  raw.write(frame(T.DATA, 0, 1, Buffer.concat(Array.from({ length: 120 }, () => ping))));
  expect(await raw.rst(1)).toBe(8); // CANCEL
  expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);

  // The multiplexed connection and independent streams remain healthy.
  raw.headers(3, baseHeaders("/hello"));
  // SETTINGS_INITIAL_WINDOW_SIZE=0 applies to every subsequently opened
  // stream, not only the flooded tunnel. Give this sibling enough credit to
  // prove that it can still make progress after stream 1 is reset.
  raw.write(frame(T.WINDOW_UPDATE, 0, 3, u32(1024)));
  expect((await raw.body(3)).toString()).toBe("hello");
  raw.close();
}, 10_000);

test("RFC 8441 dispatches drain after H2 flow-control backpressure clears", async () => {
  await using drainFixture = await startFixture({ tls: secure });
  const raw = await RawH2.connect(drainFixture.port, secure);
  raw.headers(1, websocketHeaders("/ws-drain"), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, "fill-backpressure")));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && received(raw, 1) >= 60_000);
  raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(70_000)));
  raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(70_000)));

  await Promise.race([
    (async () => {
      while (!drainFixture.stderr().includes("WS-DRAIN")) await Bun.sleep(10);
    })(),
    Bun.sleep(2_000).then(() => {
      throw new Error("drain callback did not run after reopening flow-control windows: " + raw.describe());
    }),
  ]);

  raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
  raw.close();
}, 10_000);

test("RFC 8441 preserves a WebSocket frame split inside its header by H2 flow control", async () => {
  const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 0) });
  await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
  raw.headers(1, websocketHeaders(), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  const firstFrame = raw.frames.length;
  const text = "split-output";
  const encodedLength = 2 + Buffer.byteLength(text);
  raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, text)));
  await barrier(raw, "ws-zero");
  expect(received(raw, 1)).toBe(0);

  // Release only the first RFC 6455 header byte, then the rest. The queued
  // suffix must remain byte-exact even though H2 DATA boundaries bisect it.
  raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(1)));
  await raw.waitFor(() => received(raw, 1) === 1);
  await barrier(raw, "ws-one");
  expect(received(raw, 1)).toBe(1);
  raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(encodedLength - 1)));
  await raw.waitFor(() => received(raw, 1) === encodedLength);

  const encoded = Buffer.concat(
    raw.frames
      .slice(firstFrame)
      .filter(f => f.type === T.DATA && f.streamId === 1)
      .map(f => f.payload),
  );
  expect(wsServerFrame(encoded).payload.toString()).toBe(text);
  raw.write(frame(T.RST_STREAM, 0, 1, u32(8)));
  raw.close();
});

test("RFC 8441 outbound drain progress refreshes the idle deadline", async () => {
  await using drainFixture = await startFixture({
    tls: secure,
    websocketIdleTimeout: 8,
    websocketPings: false,
  });
  const raw = await RawH2.connect(drainFixture.port, secure);
  raw.headers(1, websocketHeaders("/ws-drain"), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, "fill-slow-backpressure")));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && received(raw, 1) >= 60_000);

  // Keep making real, bounded outbound progress for longer than the eight
  // second idle timeout. WINDOW_UPDATE alone is not activity; each increment
  // is immediately consumed by queued WebSocket bytes before the next one.
  for (let i = 0; i < 10; i++) {
    await Bun.sleep(1_000);
    raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(16_000)));
    raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(16_000)));
    const expected = 60_000 + (i + 1) * 16_000;
    await raw.waitFor(() => received(raw, 1) >= expected);
    expect(raw.frames.some(f => f.type === T.RST_STREAM && f.streamId === 1)).toBe(false);
  }

  raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(256 * 1024)));
  raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(256 * 1024)));
  await Promise.race([
    (async () => {
      while (!drainFixture.stderr().includes("WS-DRAIN")) await Bun.sleep(10);
    })(),
    Bun.sleep(2_000).then(() => {
      throw new Error("slow WebSocket backpressure never completed its drain: " + raw.describe());
    }),
  ]);

  raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
  raw.close();
}, 20_000);

test("RFC 8441 preserves a publication scheduled re-entrantly from drain", async () => {
  await using drainFixture = await startFixture({ tls: secure });
  const raw = await RawH2.connect(drainFixture.port, secure);

  raw.headers(1, websocketHeaders("/ws-drain-publish"), F.END_HEADERS);
  raw.headers(3, websocketHeaders(), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 3)).payload)).toBe(200);
  raw.write(frame(T.DATA, 0, 3, wsClientFrame(1, "subscribe:drain-topic")));
  await raw.waitFor(f => {
    if (f.type !== T.DATA || f.streamId !== 3 || f.payload[0] !== 0x81) return false;
    return wsServerFrame(f.payload).payload.toString() === "subscribed:drain-topic";
  });

  // Block stream 1, then reopen it. Its drain callback publishes a small
  // TopicTree message while the context-wide drain pass is already active.
  // Stream 3 must receive it in the automatically retained next pass, with no
  // subsequent client traffic needed to wake the queue.
  raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, "fill-backpressure")));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && received(raw, 1) >= 60_000);
  raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(140_000)));
  raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(70_000)));

  await Promise.race([
    raw.waitFor(f => {
      if (f.type !== T.DATA || f.streamId !== 3 || f.payload[0] !== 0x81) return false;
      return wsServerFrame(f.payload).payload.toString() === "published-from-drain";
    }),
    Bun.sleep(2_000).then(() => {
      throw new Error("publication queued from drain lost its deferred wake-up: " + raw.describe());
    }),
  ]);

  raw.write(frame(T.RST_STREAM, 0, 1, u32(8)));
  raw.write(frame(T.DATA, F.END_STREAM, 3, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 3 && (f.flags & F.END_STREAM) !== 0);
  raw.close();
}, 10_000);

test("RST_STREAM dispatches an abnormal WebSocket close callback", async () => {
  await using closeFixture = await startFixture({ tls: secure });
  const raw = await RawH2.connect(closeFixture.port, secure);
  raw.headers(1, websocketHeaders("/ws-abnormal-close"), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  raw.write(frame(T.RST_STREAM, 0, 1, u32(8)));
  await Promise.race([
    (async () => {
      while (!closeFixture.stderr().includes("WS-ABNORMAL-CLOSE:1006:0")) await Bun.sleep(10);
    })(),
    Bun.sleep(2_000).then(() => {
      throw new Error("RST_STREAM did not dispatch the expected abnormal close: " + closeFixture.stderr());
    }),
  ]);

  raw.headers(3, baseHeaders("/hello"));
  expect((await raw.body(3)).toString()).toBe("hello");
  raw.close();
}, 10_000);

test("HEADERS after an RFC 8441 tunnel is active reset only that stream", async () => {
  const raw = await RawH2.connect(fx.port, secure);
  raw.headers(1, websocketHeaders(), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  raw.headers(1, [["x-not-a-trailer", "inside-a-websocket-tunnel"]], F.END_HEADERS | F.END_STREAM);
  expect(await raw.rst(1)).toBe(1); // PROTOCOL_ERROR
  expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);

  raw.headers(3, baseHeaders("/hello"));
  expect((await raw.body(3)).toString()).toBe("hello");
  raw.close();
});

test("RFC 8441 streams a large WebSocket frame without a contiguous outbound copy", async () => {
  const payload = Buffer.allocUnsafe(1024 * 1024 + 37);
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + 17) & 0xff;

  // Give the server enough peer-side stream and connection credit for the
  // complete echo. The WebSocket frame itself is deliberately split across
  // many legal H2 DATA frames in both directions.
  const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 2 * 1024 * 1024) });
  await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
  raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(2 * 1024 * 1024)));
  raw.headers(1, websocketHeaders(), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  const clientFrame = wsClientFrame(2, payload);
  for (let offset = 0; offset < clientFrame.length; offset += 16_000) {
    raw.write(frame(T.DATA, 0, 1, clientFrame.subarray(offset, offset + 16_000)));
  }

  const expectedWireLength = payload.length + 10;
  await raw.waitFor(
    () =>
      raw.frames.filter(f => f.type === T.DATA && f.streamId === 1).reduce((total, f) => total + f.payload.length, 0) >=
      expectedWireLength,
  );
  const dataFrames = raw.frames.filter(f => f.type === T.DATA && f.streamId === 1 && f.payload.length !== 0);
  expect(dataFrames.length).toBeGreaterThan(1);
  const echoed = wsServerFrame(Buffer.concat(dataFrames.map(f => f.payload)));
  expect(echoed).toMatchObject({ opcode: 2, fin: true, compressed: false });
  expect(echoed.payload).toEqual(payload);

  raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
  raw.close();
}, 15_000);

test("RFC 8441 rejects a projected fragmented message before reserving past maxPayloadLength", async () => {
  await using limitedFixture = await startFixture({
    tls: secure,
    websocketMaxPayloadLength: 64 * 1024,
  });
  const raw = await RawH2.connect(limitedFixture.port, secure);
  raw.headers(1, websocketHeaders(), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  const first = wsClientFrame(2, Buffer.alloc(40 * 1024, 0x61), false);
  for (let offset = 0; offset < first.length; offset += 16_000) {
    raw.write(frame(T.DATA, 0, 1, first.subarray(offset, offset + 16_000)));
  }

  // Each individual RFC 6455 frame is legal, but their aggregate message is
  // not. Sending only the next continuation's header and first payload byte
  // is enough to expose its declared remainder; the server must reject that
  // projected size before reserving or waiting for the rest of the frame.
  const continuation = wsClientFrame(0, Buffer.alloc(40 * 1024, 0x62));
  raw.write(frame(T.DATA, 0, 1, continuation.subarray(0, 9)));
  const close = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x88);
  expect(wsServerFrame(close.payload).payload.readUInt16BE(0)).toBe(1009);
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);

  raw.headers(3, baseHeaders("/hello"));
  expect((await raw.body(3)).toString()).toBe("hello");
  expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
  raw.close();
});

test("RFC 8441 reuses uWebSockets permessage-deflate in both directions", async () => {
  const raw = await RawH2.connect(fx.port, secure);
  raw.headers(
    1,
    [
      ...websocketHeaders(),
      ["sec-websocket-extensions", "permessage-deflate; client_no_context_takeover; server_no_context_takeover"],
    ],
    F.END_HEADERS,
  );
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  const original = Buffer.from("compressed over an extended CONNECT stream ".repeat(32));
  const compressed = deflateWebSocketMessage(original);
  // Split inside the compressed payload and interleave a control frame.  The
  // codec must retain RFC 7692 message state while H2 independently splits
  // and multiplexes DATA frames.
  const first = Math.max(1, Math.floor(compressed.length / 2));
  raw.write(frame(T.DATA, 0, 1, wsClientFrame(1, compressed.subarray(0, first), false, true)));
  raw.write(frame(T.DATA, 0, 1, wsClientFrame(9, "compressed-ping")));
  raw.write(frame(T.DATA, 0, 1, wsClientFrame(0, compressed.subarray(first), true)));

  const pong = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x8a);
  expect(wsServerFrame(pong.payload).payload.toString()).toBe("compressed-ping");
  const echoed = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.payload[0] & 0xcf) === 0xc1);
  const message = wsServerFrame(echoed.payload);
  expect(message.compressed).toBe(true);
  expect(inflateWebSocketMessage(message.payload)).toEqual(original);

  // Also cover the direct parser path where an entire compressed WebSocket
  // frame is present in one H2 DATA chunk (no compressed fragment buffer).
  const singleFrameOriginal = Buffer.from("one complete compressed binary frame");
  raw.write(frame(T.DATA, 0, 1, wsClientFrame(2, deflateWebSocketMessage(singleFrameOriginal), true, true)));
  const singleFrameEcho = await raw.waitFor(
    f => f.type === T.DATA && f.streamId === 1 && (f.payload[0] & 0xcf) === 0xc2,
  );
  const singleFrameMessage = wsServerFrame(singleFrameEcho.payload);
  expect(singleFrameMessage.compressed).toBe(true);
  expect(inflateWebSocketMessage(singleFrameMessage.payload)).toEqual(singleFrameOriginal);

  raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
  raw.close();
});

test("RFC 8441 reports malformed permessage-deflate data as invalid payload", async () => {
  const raw = await RawH2.connect(fx.port, secure);
  raw.headers(1, [...websocketHeaders(), ["sec-websocket-extensions", "permessage-deflate"]], F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  // BTYPE=3 is reserved by DEFLATE and must not be conflated with a message
  // that expanded past maxPayloadLength.
  raw.write(frame(T.DATA, 0, 1, wsClientFrame(2, Buffer.from([0x06]), true, true)));
  const close = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x88);
  expect(wsServerFrame(close.payload).payload.readUInt16BE(0)).toBe(1007);
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);

  raw.headers(3, baseHeaders("/hello"));
  expect((await raw.body(3)).toString()).toBe("hello");
  expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
  raw.close();
});

test("RFC 8441 reports an inflated message past maxPayloadLength as too large", async () => {
  await using limitedFixture = await startFixture({
    tls: secure,
    websocketMaxPayloadLength: 32,
  });
  const raw = await RawH2.connect(limitedFixture.port, secure);
  raw.headers(1, [...websocketHeaders(), ["sec-websocket-extensions", "permessage-deflate"]], F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  const compressed = deflateWebSocketMessage(Buffer.alloc(64, 0x61));
  raw.write(frame(T.DATA, 0, 1, wsClientFrame(2, compressed, true, true)));
  const close = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x88);
  expect(wsServerFrame(close.payload).payload.readUInt16BE(0)).toBe(1009);
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);

  raw.headers(3, baseHeaders("/hello"));
  expect((await raw.body(3)).toString()).toBe("hello");
  expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
  raw.close();
});

test("RFC 8441 accepts a dedicated-compressor frame when its exact output fits backpressure", async () => {
  await using compressionFixture = await startFixture({
    tls: secure,
    websocketBackpressureLimit: 2048,
    websocketDedicatedCompression: true,
  });
  const raw = await RawH2.connect(compressionFixture.port, secure, { settings: setting(4, 0) });
  await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
  raw.headers(1, [...websocketHeaders(), ["sec-websocket-extensions", "permessage-deflate"]], F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  // The conservative deflate bound is far above 2 KiB, but the exact
  // compressed frame is tiny. With a zero peer window it must be retained
  // inside the configured budget, not rejected based on the worst case.
  const repeatedBlock = Buffer.allocUnsafe(1024);
  let random = 0x9e3779b9;
  for (let i = 0; i < repeatedBlock.length; i++) {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    repeatedBlock[i] = random & 0xff;
  }
  const first = Buffer.allocUnsafe(64 * 1024);
  for (let offset = 0; offset < first.length; offset += repeatedBlock.length) repeatedBlock.copy(first, offset);
  const firstFrame = wsClientFrame(2, first);
  for (let offset = 0; offset < firstFrame.length; offset += 16_000) {
    raw.write(frame(T.DATA, 0, 1, firstFrame.subarray(offset, offset + 16_000)));
  }
  await Bun.sleep(50);
  expect(received(raw, 1)).toBe(0);

  raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(4096)));
  raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(4096)));
  const firstEcho = wsServerFrame(
    (
      await raw.waitFor(
        f => f.type === T.DATA && f.streamId === 1 && f.payload.length > 2 && (f.payload[0] & 0xc2) === 0xc2,
      )
    ).payload,
  );
  expect(firstEcho).toMatchObject({ opcode: 2, fin: true, compressed: true });

  // A following message must continue from the committed takeover state.
  const afterFirst = raw.frames.length;
  const second = repeatedBlock;
  raw.write(frame(T.DATA, 0, 1, wsClientFrame(2, second)));
  const secondEcho = wsServerFrame(
    (
      await raw.waitFor(
        f =>
          raw.frames.indexOf(f) >= afterFirst &&
          f.type === T.DATA &&
          f.streamId === 1 &&
          f.payload.length > 2 &&
          (f.payload[0] & 0xc2) === 0xc2,
      )
    ).payload,
  );
  expect(secondEcho.payload.length).toBeLessThan(deflateWebSocketMessage(second).length / 4);
  const inflated = inflateRawSync(
    Buffer.concat([firstEcho.payload, perMessageDeflateTail, secondEcho.payload, perMessageDeflateTail]),
    { finishFlush: zlibConstants.Z_SYNC_FLUSH },
  );
  expect(inflated).toEqual(Buffer.concat([first, second]));

  raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
  raw.close();
});

test("RFC 8441 does not advance a dedicated compressor when backpressure drops a message", async () => {
  await using compressionFixture = await startFixture({
    tls: secure,
    websocketBackpressureLimit: 2048,
    websocketDedicatedCompression: true,
  });
  const raw = await RawH2.connect(compressionFixture.port, secure, { settings: setting(4, 0) });
  await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
  raw.headers(1, [...websocketHeaders(), ["sec-websocket-extensions", "permessage-deflate"]], F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  // The peer stream window is zero and this incompressible echo cannot fit
  // the configured budget. A dedicated compressor must reject it before
  // mutating its context, otherwise the following message can refer to bytes
  // the peer never received.
  const first = Buffer.allocUnsafe(64 * 1024);
  let random = 0x6d2b79f5;
  for (let i = 0; i < first.length; i++) {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    first[i] = random & 0xff;
  }
  const firstFrame = wsClientFrame(2, first);
  for (let offset = 0; offset < firstFrame.length; offset += 16_000) {
    raw.write(frame(T.DATA, 0, 1, firstFrame.subarray(offset, offset + 16_000)));
  }
  await Bun.sleep(50);
  expect(received(raw, 1)).toBe(0);

  raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(4096)));
  raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(4096)));
  const second = first.subarray(first.length - 1024);
  raw.write(frame(T.DATA, 0, 1, wsClientFrame(2, second)));
  const echoed = await raw.waitFor(
    f => f.type === T.DATA && f.streamId === 1 && f.payload.length > 2 && (f.payload[0] & 0xc2) === 0xc2,
  );
  const message = wsServerFrame(echoed.payload);
  expect(message).toMatchObject({ opcode: 2, fin: true, compressed: true });
  expect(inflateWebSocketMessage(message.payload)).toEqual(second);

  raw.write(frame(T.DATA, F.END_STREAM, 1, wsClientFrame(8, Buffer.from([0x03, 0xe8]))));
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
  raw.close();
});

test("RFC 8441 rejects malformed WebSocket framing on only that stream", async () => {
  const raw = await RawH2.connect(fx.port, secure);
  raw.headers(1, websocketHeaders(), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  // Client-to-server frames must be masked. A protocol failure is expressed
  // as a WebSocket close frame, not a connection-level GOAWAY.
  raw.write(frame(T.DATA, 0, 1, Buffer.from([0x81, 0x01, 0x78])));
  const close = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x88);
  expect(wsServerFrame(close.payload).payload.readUInt16BE(0)).toBe(1002);
  await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
  raw.write(frame(T.DATA, F.END_STREAM, 1));

  raw.headers(3, baseHeaders("/hello"));
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 3)).payload)).toBe(200);
  expect((await raw.body(3)).toString()).toBe("hello");
  expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
  raw.close();
});

const withFirstByte = (input: Buffer, transform: (byte: number) => number) => {
  const output = Buffer.from(input);
  output[0] = transform(output[0]);
  return output;
};

for (const [name, malformedFrame] of [
  ["RSV1 without a negotiated extension", wsClientFrame(1, "x", true, true)],
  ["RSV2", withFirstByte(wsClientFrame(1, "x"), byte => byte | 0x20)],
  ["RSV3 on a control frame", withFirstByte(wsClientFrame(9, "x"), byte => byte | 0x10)],
  ["reserved data opcode", wsClientFrame(3, "x")],
  ["reserved control opcode", wsClientFrame(11, "x")],
  ["fragmented control frame", wsClientFrame(9, "x", false)],
  ["oversized control frame", wsClientFrame(9, Buffer.alloc(126))],
  ["continuation without an open fragmented message", wsClientFrame(0, "x")],
  [
    "new text frame during a fragmented message",
    Buffer.concat([wsClientFrame(1, "first", false), wsClientFrame(1, "second")]),
  ],
  [
    "new binary frame during a fragmented text message",
    Buffer.concat([wsClientFrame(1, "first", false), wsClientFrame(2, "second")]),
  ],
] as const) {
  test(`RFC 6455 protocol error (${name}) closes only the tunnel stream`, async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, websocketHeaders(), F.END_HEADERS);
    expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

    raw.write(frame(T.DATA, 0, 1, malformedFrame));
    const close = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x88);
    expect(wsServerFrame(close.payload).payload.readUInt16BE(0)).toBe(1002);
    await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);

    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.body(3)).toString()).toBe("hello");
    expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
    raw.close();
  });
}

for (const [name, malformedFrame] of [
  ["invalid text payload", wsClientFrame(1, Buffer.from([0xc3, 0x28]))],
  ["invalid close reason", wsClientFrame(8, Buffer.from([0x03, 0xe8, 0xc3, 0x28]))],
] as const) {
  test(`RFC 6455 invalid UTF-8 (${name}) returns close code 1007`, async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, websocketHeaders(), F.END_HEADERS);
    expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

    raw.write(frame(T.DATA, 0, 1, malformedFrame));
    const close = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x88);
    expect(wsServerFrame(close.payload).payload.readUInt16BE(0)).toBe(1007);
    raw.close();
  });
}

for (const [name, malformedFrame] of [
  ["126 marker for a payload of 125 bytes", wsClientFrameWithLengthEncoding(1, "x", 126, 125)],
  ["127 marker for a payload of 65535 bytes", wsClientFrameWithLengthEncoding(1, "x", 127, 65_535)],
  [
    "127 marker with the 64-bit high bit set",
    wsClientFrameWithLengthEncoding(1, Buffer.alloc(0), 127, 0x8000000000000000n),
  ],
] as const) {
  test(`RFC 6455 rejects non-canonical or out-of-range payload length (${name})`, async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, websocketHeaders(), F.END_HEADERS);
    expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

    raw.write(frame(T.DATA, 0, 1, malformedFrame));
    const close = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload[0] === 0x88);
    expect(wsServerFrame(close.payload).payload.readUInt16BE(0)).toBe(1002);
    await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);

    // A frame-level WebSocket error retires only the tunnel stream.  The
    // connection remains available for a fresh HTTP/2 request.
    expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.body(3)).toString()).toBe("hello");
    raw.close();
  });
}

test("client RST_STREAM retires only an open WebSocket tunnel", async () => {
  const raw = await RawH2.connect(fx.port, secure);
  raw.headers(1, websocketHeaders(), F.END_HEADERS);
  expect(decodeStatus((await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1)).payload)).toBe(200);

  // CANCEL is the peer-side stream reset; no WebSocket close frame is
  // required because the stream has already been reset at the HTTP/2 layer.
  raw.write(frame(T.RST_STREAM, 0, 1, u32(8)));
  await barrier(raw, "wsreset");

  raw.headers(3, baseHeaders("/hello"));
  const sibling = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 3);
  expect(decodeStatus(sibling.payload)).toBe(200);
  expect((await raw.body(3)).toString()).toBe("hello");
  expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
  raw.close();
});

// Heavier transfers: kept out of the concurrent group so they are not timing-sensitive to sibling load.
describe("Bun.serve http2 protocol (serial)", () => {
  for (const [name, abort] of [
    ["client RST_STREAM", (id: number) => frame(T.RST_STREAM, 0, id, Buffer.from([0, 0, 0, 8]))],
    ["server-induced reset (WINDOW_UPDATE 0)", (id: number) => frame(T.WINDOW_UPDATE, 0, id, Buffer.alloc(4))],
  ] as const) {
    test(`rapid reset flood via ${name} → GOAWAY ENHANCE_YOUR_CALM`, async () => {
      const raw = await RawH2.connect(fx.port, secure);
      await raw.waitFor(f => f.type === T.SETTINGS);
      const block = hpackLiteral(baseHeaders("/slow?ms=30000"));
      // The bucket holds 1000 resets. Send 50 open+reset pairs per write and
      // round-trip a PING between batches so the GOAWAY isn't lost behind
      // unread input when the server closes.
      let id = 1;
      for (let batch = 0; ; batch++) {
        expect(batch).toBeLessThan(40);
        const parts: Buffer[] = [];
        for (let n = 0; n < 50; n++, id += 2) {
          parts.push(frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, id, block), abort(id));
        }
        const opaque = Buffer.alloc(8);
        opaque.writeUInt32BE(batch, 4);
        parts.push(frame(T.PING, 0, 0, opaque));
        raw.write(Buffer.concat(parts));
        const f = await raw.waitFor(
          f => f.type === T.GOAWAY || (f.type === T.PING && f.payload.readUInt32BE(4) === batch),
        );
        if (f.type === T.GOAWAY) {
          expect(f.payload.readUInt32BE(4)).toBe(11);
          break;
        }
      }
      raw.close();
    });
  }
  test("streaming response with a huge peer window completes without inbound frames to pump it", async () => {
    // 8 × 1 MiB pulls with `await null` between them; the client opens
    // stream+connection windows to 2^31-1 up front so it never sends
    // WINDOW_UPDATEs mid-body. Each write past the 256 KB high-water mark
    // must schedule its own drain.
    const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 0x7fffffff) });
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(0x7fffffff - 65535)));
    raw.headers(1, baseHeaders("/pull-1mb"));
    const body = await raw.body(1);
    expect(body.length).toBe(8 << 20);
    expect(raw.frames.filter(f => f.type === T.WINDOW_UPDATE).length).toBe(1); // just the server's initial one
    raw.close();
  }, 20000);
  test("client GOAWAY (unknown code, debug data) does not stop in-flight responses or PINGs; connection closes once drained", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    raw.headers(1, baseHeaders("/slow?ms=200"));
    raw.write(frame(T.GOAWAY, 0, 0, Buffer.concat([u32(0), u32(0xff), Buffer.from("bye")])));
    await barrier(raw, "aftergo");
    expect((await raw.body(1)).toString()).toBe("slow");
    await raw.waitForClose();
    expect(raw.frames.some(f => f.type === T.GOAWAY && f.payload.readUInt32BE(4) !== 0)).toBe(false);
    raw.close();
  });
  test("with 24 large responses in flight, a later small one still completes early", async () => {
    const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 0) });
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    for (let i = 0; i < 24; i++) raw.headers(1 + 2 * i, baseHeaders("/big"));
    raw.headers(49, baseHeaders("/fixed?n=200"));
    await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 49);
    raw.write(
      Buffer.concat([
        frame(T.SETTINGS, 0, 0, setting(4, 0x7fffffff)),
        frame(T.WINDOW_UPDATE, 0, 0, u32(0x7fffffff - 65535)),
      ]),
    );
    await raw.waitFor(f => f.streamId === 49 && (f.flags & F.END_STREAM) !== 0 && f.type === T.DATA);
    const idx = raw.frames.findIndex(f => f.streamId === 49 && (f.flags & F.END_STREAM) !== 0);
    const bigBefore = raw.frames
      .slice(0, idx)
      .filter(f => f.type === T.DATA && f.streamId !== 49)
      .reduce((a, f) => a + f.payload.length, 0);
    // One 16 KB slice per large stream per pass: 24 × 16 KB = 384 KB before the
    // small one's turn. Without the per-pass slice it would be 24 × 256 KB.
    expect(bigBefore).toBeLessThan(512 * 1024);
    raw.close();
  }, 30000);

  test("a small response is not starved behind a large one on the same connection", async () => {
    // Both requests are dispatched while the window is 0, then everything
    // opens at once: /small must complete within a couple of /big slices.
    const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 0) });
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    raw.headers(1, baseHeaders("/big"));
    raw.headers(3, baseHeaders("/fixed?n=200"));
    await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
    await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 3);
    raw.write(
      Buffer.concat([
        frame(T.SETTINGS, 0, 0, setting(4, 0x7fffffff)),
        frame(T.WINDOW_UPDATE, 0, 0, u32(0x7fffffff - 65535)),
      ]),
    );
    await raw.waitFor(f => f.streamId === 3 && (f.flags & F.END_STREAM) !== 0 && f.type === T.DATA);
    const idx = raw.frames.findIndex(f => f.streamId === 3 && (f.flags & F.END_STREAM) !== 0);
    const bigBefore = raw.frames
      .slice(0, idx)
      .filter(f => f.type === T.DATA && f.streamId === 1)
      .reduce((a, f) => a + f.payload.length, 0);
    expect(bigBefore).toBeLessThanOrEqual(512 * 1024);
    expect((await raw.body(1)).length).toBe(5 * 1024 * 1024);
    raw.close();
  }, 20000);
  test("lowering SETTINGS_INITIAL_WINDOW_SIZE mid-stream stops the response (negative window), WINDOW_UPDATE resumes it", async () => {
    const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 3) });
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    raw.headers(1, baseHeaders("/big"));
    await raw.waitFor(() => received(raw, 1) >= 3);
    raw.write(frame(T.SETTINGS, 0, 0, setting(4, 2))); // window is now -1
    await barrier(raw, "neg");
    raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(2))); // -1 + 2 = 1
    while (received(raw, 1) < 4) await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && received(raw, 1) >= 4);
    await barrier(raw, "neg2");
    expect(received(raw, 1)).toBe(4);
    // Now open everything and drain the full 5 MB byte-exact.
    raw.write(frame(T.SETTINGS, 0, 0, setting(4, 1 << 30)));
    raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(1 << 30)));
    const body = await raw.body(1);
    expect(body.length).toBe(5 * 1024 * 1024);
    expect(Bun.hash(body)).toBe(Bun.hash(Buffer.alloc(5 * 1024 * 1024, "abcdefghijklmnop")));
    raw.close();
  }, 20000);
  test("RST_STREAM on a flow-control-blocked response frees it; a sibling completes byte-exact", async () => {
    const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 1024) });
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    raw.headers(1, baseHeaders("/big"));
    raw.headers(3, baseHeaders("/big"));
    await raw.waitFor(() => received(raw, 1) >= 1024 && received(raw, 3) >= 1024);
    raw.write(frame(T.RST_STREAM, 0, 1, u32(8)));
    await barrier(raw, "rst1");
    const r1 = received(raw, 1);
    raw.write(frame(T.WINDOW_UPDATE, 0, 3, u32(8 << 20)));
    raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(8 << 20)));
    const body = await raw.body(3);
    expect(body.length).toBe(5 * 1024 * 1024);
    expect(received(raw, 1)).toBe(r1);
    raw.close();
  }, 20000);
  test("connection window is credited back for bodies on streams that were reset unread", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    const chunk = Buffer.alloc(16384);
    // 80 streams × 64 KB = 5 MB > the 4 MB replenish threshold; each reset right away.
    for (let i = 0, id = 1; i < 80; i++, id += 2) {
      const parts = [frame(T.HEADERS, F.END_HEADERS, id, hpackLiteral(baseHeaders("/late-read", "POST")))];
      for (let j = 0; j < 4; j++) parts.push(frame(T.DATA, 0, id, chunk));
      parts.push(frame(T.RST_STREAM, 0, id, u32(8)));
      raw.write(Buffer.concat(parts));
      if (i % 10 === 9) await barrier(raw, "cr" + i);
    }
    const credited = raw.frames
      .filter(f => f.type === T.WINDOW_UPDATE && f.streamId === 0)
      .reduce((a, f) => a + f.payload.readUInt32BE(0), 0);
    // The first WINDOW_UPDATE(0) is the initial widening; anything past that is credit for our DATA.
    expect(credited).toBeGreaterThanOrEqual((1 << 24) - 65535 + 4 * 1024 * 1024);
    expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
    raw.headers(161, baseHeaders("/release-late-read"));
    await raw.body(161);
    raw.close();
  }, 20000);
  test("MAX_CONCURRENT_STREAMS: the stream past the limit is refused, earlier streams are unaffected, a slot frees up", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    const settings = await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) === 0);
    let max = 0;
    for (let i = 0; i + 6 <= settings.payload.length; i += 6)
      if (settings.payload.readUInt16BE(i) === 3) max = settings.payload.readUInt32BE(i + 2);
    expect(max).toBeGreaterThan(0);
    const block = hpackLiteral(baseHeaders("/abort"));
    const parts: Buffer[] = [];
    for (let i = 0; i < max; i++) parts.push(frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 1 + 2 * i, block));
    // The refused one is split across HEADERS+CONTINUATION so HPACK state must still be consumed.
    const over = 1 + 2 * max;
    const hb = hpackLiteral(baseHeaders("/hello"));
    parts.push(
      frame(T.HEADERS, F.END_STREAM, over, hb.subarray(0, 3)),
      frame(T.CONTINUATION, F.END_HEADERS, over, hb.subarray(3)),
    );
    raw.write(Buffer.concat(parts));
    expect(await raw.rst(over)).toBe(7);
    raw.write(frame(T.RST_STREAM, 0, 1, u32(8)));
    raw.write(frame(T.PING, 0, 0, Buffer.from("slotfree")));
    await raw.waitFor(f => f.type === T.PING && f.payload.toString() === "slotfree");
    raw.headers(over + 2, baseHeaders("/hello"));
    expect((await raw.body(over + 2)).toString()).toBe("hello");
    raw.close();
  }, 20000);
  test("a client that stops reading is not cut off for the server's own queued responses", async () => {
    // 200 streams × 12 KB of response headers ≈ 2.4 MB queued while the client
    // isn't reading; that's backpressure, not abuse.
    const raw = await RawH2.connect(fx.port, secure);
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    raw.socket.pause();
    const parts: Buffer[] = [];
    for (let i = 0, id = 1; i < 200; i++, id += 2)
      parts.push(frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, id, hpackLiteral(baseHeaders("/big-headers?kb=12"))));
    raw.write(Buffer.concat(parts));
    // The read side is paused, so use another connection's PING round-trip
    // as the signal that the server has taken the batch off the wire.
    const probe = await RawH2.connect(fx.port, secure);
    await barrier(probe, "queued");
    probe.close();
    raw.socket.resume();
    for (let id = 1; id < 400; id += 2) await raw.body(id);
    expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
    raw.close();
  }, 20000);
  test("peer MAX_FRAME_SIZE above 16384 is honoured for DATA", async () => {
    const raw = await RawH2.connect(fx.port, secure, {
      settings: Buffer.concat([setting(5, (1 << 24) - 1), setting(4, 0x7fffffff)]),
    });
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(0x7fffffff - 65535)));
    raw.headers(1, baseHeaders("/big"));
    const body = await raw.body(1);
    expect(body.length).toBe(5 * 1024 * 1024);
    expect(
      Math.max(...raw.frames.filter(f => f.type === T.DATA && f.streamId === 1).map(f => f.payload.length)),
    ).toBeGreaterThan(16384);
    raw.close();
  });
  test("response blocked on flow control is torn down cleanly by RST_STREAM, repeatedly", async () => {
    const s2 = await connectH2(fx.port, secure);
    for (let i = 0; i < 30; i++) {
      await new Promise<void>(resolve => {
        const r = s2.request({ ":path": "/big" });
        r.on("response", () => {
          r.close(http2.constants.NGHTTP2_CANCEL);
          resolve();
        });
        r.on("error", () => {});
        r.resume();
      });
    }
    expect((await request(s2, { ":path": "/hello" })).body.toString()).toBe("hello");
    const big = await request(s2, { ":path": "/big" });
    expect(big.body.length).toBe(5 * 1024 * 1024);
    s2.close();
  }, 20000);
  test("64 POSTs answered before their bodies arrive: late DATA for all of them is ignored", async () => {
    const raw = await RawH2.connect(fx.port, secure);
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    const hb = hpackLiteral(baseHeaders("/hello", "POST"));
    raw.write(Buffer.concat(Array.from({ length: 64 }, (_, i) => frame(T.HEADERS, F.END_HEADERS, 1 + 2 * i, hb))));
    for (let i = 0; i < 64; i++) await raw.body(1 + 2 * i);
    raw.write(
      Buffer.concat(Array.from({ length: 64 }, (_, i) => frame(T.DATA, F.END_STREAM, 1 + 2 * i, Buffer.from("late")))),
    );
    raw.write(frame(T.PING, 0, 0, Buffer.from("late64  ")));
    await raw.waitFor(f => f.type === T.PING && (f.flags & F.ACK) !== 0 && f.payload.toString() === "late64  ");
    expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
    raw.headers(129, baseHeaders("/hello"));
    expect((await raw.body(129)).toString()).toBe("hello");
    raw.close();
  });
});
