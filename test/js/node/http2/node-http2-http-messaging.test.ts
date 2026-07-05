import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import net from "node:net";
import h2utils from "./helpers";

// RFC 9113 §8 HTTP-messaging conformance for the `node:http2` client (and the symmetric server
// inbound path). A raw TCP server writes byte-exact HTTP/2 frames so each malformed response is
// under full control; node v26.3.0 against the same frames is the reference for every case.

const { NGHTTP2_PROTOCOL_ERROR } = http2.constants;

// HPACK "literal header field with incremental indexing - new name", no Huffman
// (RFC 7541 §6.2.1). Accepted by any decoder and keeps the crafted bytes readable.
function hpackLiteral(name: string, value: string): Buffer {
  const n = Buffer.from(name, "latin1");
  const v = Buffer.from(value, "latin1");
  if (n.length > 126 || v.length > 126) throw new Error("field too long for the 7-bit test encoder");
  return Buffer.concat([Buffer.from([0x40, n.length]), n, Buffer.from([v.length]), v]);
}
function headerBlock(pairs: [string, string | number][]): Buffer {
  return Buffer.concat(pairs.map(([name, value]) => hpackLiteral(name, String(value))));
}
function headersFrame(streamId: number, pairs: [string, string | number][], endStream: boolean): Buffer {
  return new h2utils.HeadersFrame(streamId, headerBlock(pairs), 0, true, endStream).data;
}
function dataFrame(streamId: number, body: string, endStream: boolean): Buffer {
  return new h2utils.DataFrame(streamId, Buffer.from(body, "latin1"), 0, endStream).data;
}
// PUSH_PROMISE: type 0x5, END_HEADERS; payload = 4-byte promised stream id + the header block.
function pushPromiseFrame(parentId: number, promisedId: number, pairs: [string, string | number][]): Buffer {
  const payload = Buffer.concat([Buffer.alloc(4), headerBlock(pairs)]);
  payload.writeUInt32BE(promisedId & 0x7fffffff, 0);
  return Buffer.concat([new h2utils.Frame(payload.length, 0x5, 0x4, parentId).data, payload]);
}

type Exchange = {
  /** Stream events in emission order; the most precise record of what the application saw. */
  events: string[];
  /** Resolves with the error code of the first RST_STREAM the client sent back to the server. */
  rstSentToServer: Promise<number>;
};

/**
 * Stands up a raw TCP server speaking just enough HTTP/2 to answer one request with whatever
 * frames `respond` writes, drives a single `node:http2` client request at it, and returns the
 * ordered stream events once the stream closes.
 */
async function exchange(
  requestHeaders: Record<string, string>,
  respond: (socket: net.Socket, streamId: number) => void,
): Promise<Exchange> {
  const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
  const { promise: rstSentToServer, resolve: onRst, reject: onMissingRst } = Promise.withResolvers<number>();
  const server = net.createServer(socket => {
    socket.on("error", () => {});
    // A missing RST_STREAM must fail the awaiting assertion, never hang: the connection
    // closing (client.destroy() below) before a RST_STREAM was seen rejects the promise.
    // Settle-once semantics make this a no-op when the RST already arrived.
    socket.on("close", () => onMissingRst(new Error("the client closed without sending RST_STREAM")));
    socket.setNoDelay(true);
    socket.write(new h2utils.SettingsFrame(false).data);
    let buf = Buffer.alloc(0);
    let sawPreface = false;
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!sawPreface) {
        if (buf.length < h2utils.kClientMagic.length) return;
        buf = buf.subarray(h2utils.kClientMagic.length);
        sawPreface = true;
      }
      while (buf.length >= 9) {
        const length = buf.readUIntBE(0, 3);
        if (buf.length < 9 + length) break;
        const type = buf[3];
        const flags = buf[4];
        const streamId = buf.readUInt32BE(5) & 0x7fffffff;
        const payload = buf.subarray(9, 9 + length);
        buf = buf.subarray(9 + length);
        if (type === 0x4 && (flags & 0x1) === 0) socket.write(new h2utils.SettingsFrame(true).data);
        else if (type === 0x1) respond(socket, streamId);
        else if (type === 0x3) onRst(payload.readUInt32BE(0));
      }
    });
  });
  server.listen(0, "127.0.0.1", onListening);
  await listening;

  const events: string[] = [];
  const client = http2.connect(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  client.on("error", () => {});
  try {
    await once(client, "connect");
    const req = client.request(requestHeaders);
    let body = "";
    req.setEncoding("latin1");
    req.on("headers", h => events.push(`headers ${h[":status"]}`));
    req.on("response", h => events.push(`response ${h[":status"]} cl=${h["content-length"]}`));
    req.on("trailers", h => events.push(`trailers ${JSON.stringify(h)}`));
    req.on("data", chunk => (body += chunk));
    req.on("end", () => events.push(`end ${JSON.stringify(body)}`));
    req.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code}`));
    const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
    req.on("close", () => {
      events.push(`close rst=${req.rstCode}`);
      onClose();
    });
    req.end();
    await closed;
  } finally {
    client.destroy();
    server.close();
  }
  // Most cases never send (or await) a RST_STREAM, so the teardown above rejects the promise.
  // Mark it handled here so that never surfaces as an unhandled rejection; callers that do
  // await it still observe the rejection.
  rstSentToServer.catch(() => {});
  return { events, rstSentToServer };
}

// Like `exchange`, but the raw server also PUSH_PROMISEs stream 2 (carrying `promisedRequest`)
// and answers it with the frames `respondPushed` writes. Returns the PUSHED stream's events.
// `mainRequestClosed` settles after a `receive()` batch containing the main response has been
// fully processed (including the engine's end-of-batch stream eviction): a `respondPushed` that
// defers a frame behind it is guaranteed a fresh batch for it.
async function pushExchange(
  promisedRequest: [string, string | number][],
  respondPushed: (socket: net.Socket, promisedId: number, mainRequestClosed: Promise<void>) => void,
): Promise<string[]> {
  const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
  const { promise: mainRequestClosed, resolve: onMainRequestClosed } = Promise.withResolvers<void>();
  const server = net.createServer(socket => {
    socket.on("error", () => {});
    socket.setNoDelay(true);
    socket.write(new h2utils.SettingsFrame(false).data);
    let buf = Buffer.alloc(0);
    let sawPreface = false;
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!sawPreface) {
        if (buf.length < h2utils.kClientMagic.length) return;
        buf = buf.subarray(h2utils.kClientMagic.length);
        sawPreface = true;
      }
      while (buf.length >= 9) {
        const length = buf.readUIntBE(0, 3);
        if (buf.length < 9 + length) break;
        const type = buf[3];
        const flags = buf[4];
        const streamId = buf.readUInt32BE(5) & 0x7fffffff;
        buf = buf.subarray(9 + length);
        if (type === 0x4 && (flags & 0x1) === 0) socket.write(new h2utils.SettingsFrame(true).data);
        else if (type === 0x1) {
          socket.write(pushPromiseFrame(streamId, 2, promisedRequest));
          socket.write(headersFrame(streamId, [[":status", 200]], true));
          respondPushed(socket, 2, mainRequestClosed);
        }
      }
    });
  });
  server.listen(0, "127.0.0.1", onListening);
  await listening;

  const events: string[] = [];
  const client = http2.connect(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  client.on("error", () => {});
  const { promise: pushClosed, resolve: onPushClose, reject: onNoPush } = Promise.withResolvers<void>();
  // The server writes the PUSH_PROMISE before the main response, so 'stream' always fires
  // before the main request's 'close'; a main request ending without one is a terminal failure.
  let sawPush = false;
  client.on("stream", pushed => {
    sawPush = true;
    let body = "";
    pushed.setEncoding("latin1");
    pushed.on("push", h => events.push(`push-response ${h[":status"]} cl=${h["content-length"]}`));
    pushed.on("data", chunk => (body += chunk));
    pushed.on("end", () => events.push(`push-end ${JSON.stringify(body)}`));
    pushed.on("error", (e: NodeJS.ErrnoException) => events.push(`push-error ${e.code}`));
    pushed.on("close", () => {
      events.push(`push-close rst=${pushed.rstCode}`);
      onPushClose();
    });
  });
  client.on("close", () => onNoPush(new Error("the session closed before the pushed stream did")));
  try {
    await once(client, "connect");
    const req = client.request({ ":path": "/" });
    req.on("error", () => {});
    req.on("close", () => {
      if (!sawPush) onNoPush(new Error("the main request closed before a pushed stream arrived"));
      onMainRequestClosed();
    });
    req.resume();
    req.end();
    await pushClosed;
  } finally {
    client.destroy();
    server.close();
  }
  return events;
}

describe.concurrent("node:http2 client rejects RFC 9113 §8.1.1 content-length violations", () => {
  test("response shorter than its content-length (END_STREAM on DATA) is a stream error", async () => {
    // HEADERS{:status 200, content-length: 5} then DATA("xy", END_STREAM): 2 bytes, claims 5.
    const { events, rstSentToServer } = await exchange({}, (socket, id) => {
      socket.write(
        headersFrame(
          id,
          [
            [":status", 200],
            ["content-length", 5],
          ],
          false,
        ),
      );
      socket.write(dataFrame(id, "xy", true));
    });
    // The truncated body must never be delivered as a clean 'end'.
    expect(events).toEqual(["response 200 cl=5", "error ERR_HTTP2_STREAM_ERROR", "close rst=1"]);
    // The stream error also goes on the wire (nghttp2 / node do the same).
    expect(await rstSentToServer).toBe(NGHTTP2_PROTOCOL_ERROR);
  });

  test("response shorter than its content-length (END_STREAM on HEADERS) is a stream error", async () => {
    // The violation is detected on the same header block, so no 'response' is ever emitted.
    const { events } = await exchange({}, (socket, id) => {
      socket.write(
        headersFrame(
          id,
          [
            [":status", 200],
            ["content-length", 5],
          ],
          true,
        ),
      );
    });
    expect(events).toEqual(["error ERR_HTTP2_STREAM_ERROR", "close rst=1"]);
  });

  test("response shorter than its content-length (END_STREAM on trailers) is a stream error", async () => {
    const { events } = await exchange({}, (socket, id) => {
      socket.write(
        headersFrame(
          id,
          [
            [":status", 200],
            ["content-length", 5],
          ],
          false,
        ),
      );
      socket.write(dataFrame(id, "xy", false));
      socket.write(headersFrame(id, [["x-trailer", "1"]], true));
    });
    expect(events).toEqual(["response 200 cl=5", "error ERR_HTTP2_STREAM_ERROR", "close rst=1"]);
  });

  test("DATA exceeding the declared content-length is a stream error", async () => {
    const { events } = await exchange({}, (socket, id) => {
      socket.write(
        headersFrame(
          id,
          [
            [":status", 200],
            ["content-length", 1],
          ],
          false,
        ),
      );
      socket.write(dataFrame(id, "xy", true));
    });
    // The excess is never delivered and the stream never reports a clean end.
    expect(events).toEqual(["response 200 cl=1", "error ERR_HTTP2_STREAM_ERROR", "close rst=1"]);
  });

  test("repeated content-length is a stream error and the response is never surfaced", async () => {
    const { events } = await exchange({}, (socket, id) => {
      socket.write(
        headersFrame(
          id,
          [
            [":status", 200],
            ["content-length", 2],
            ["content-length", 2],
          ],
          false,
        ),
      );
      socket.write(dataFrame(id, "xy", true));
    });
    expect(events).toEqual(["error ERR_HTTP2_STREAM_ERROR", "close rst=1"]);
  });

  test("non-integer content-length is a stream error and the response is never surfaced", async () => {
    // RFC 9110 §8.6: digits only. "+5" parses with a lenient parser but is not a valid value.
    const { events } = await exchange({}, (socket, id) => {
      socket.write(
        headersFrame(
          id,
          [
            [":status", 200],
            ["content-length", "+5"],
          ],
          false,
        ),
      );
      socket.write(dataFrame(id, "abcde", true));
    });
    expect(events).toEqual(["error ERR_HTTP2_STREAM_ERROR", "close rst=1"]);
  });
});

describe.concurrent("node:http2 client accepts valid content-length shapes", () => {
  test("a body exactly matching its content-length ends cleanly", async () => {
    const { events } = await exchange({}, (socket, id) => {
      socket.write(
        headersFrame(
          id,
          [
            [":status", 200],
            ["content-length", 2],
          ],
          false,
        ),
      );
      socket.write(dataFrame(id, "xy", true));
    });
    expect(events).toEqual(["response 200 cl=2", 'end "xy"', "close rst=0"]);
  });

  test("a body with no content-length ends cleanly", async () => {
    const { events } = await exchange({}, (socket, id) => {
      socket.write(headersFrame(id, [[":status", 200]], false));
      socket.write(dataFrame(id, "xy", true));
    });
    expect(events).toEqual(["response 200 cl=undefined", 'end "xy"', "close rst=0"]);
  });

  test("trailers after an exact-length body are delivered", async () => {
    const { events } = await exchange({}, (socket, id) => {
      socket.write(
        headersFrame(
          id,
          [
            [":status", 200],
            ["content-length", 2],
          ],
          false,
        ),
      );
      socket.write(dataFrame(id, "xy", false));
      socket.write(headersFrame(id, [["x-trailer", "1"]], true));
    });
    expect(events).toEqual(["response 200 cl=2", 'trailers {"x-trailer":"1"}', 'end "xy"', "close rst=0"]);
  });

  test("HEAD response with a content-length and no body is not an error", async () => {
    // RFC 9113 §8.1.1: the response to a HEAD never carries a body, whatever content-length it
    // declares. This is the case that needs the engine to know the request's method.
    const { events } = await exchange({ ":method": "HEAD" }, (socket, id) => {
      socket.write(
        headersFrame(
          id,
          [
            [":status", 200],
            ["content-length", 1234],
          ],
          true,
        ),
      );
    });
    expect(events).toEqual(["response 200 cl=1234", 'end ""', "close rst=0"]);
  });

  test("204 and 304 responses with a content-length and no body are not errors", async () => {
    const r204 = await exchange({}, (socket, id) => {
      socket.write(
        headersFrame(
          id,
          [
            [":status", 204],
            ["content-length", 0],
          ],
          true,
        ),
      );
    });
    expect(r204.events).toEqual(["response 204 cl=0", 'end ""', "close rst=0"]);
    const r304 = await exchange({}, (socket, id) => {
      socket.write(
        headersFrame(
          id,
          [
            [":status", 304],
            ["content-length", 100],
          ],
          true,
        ),
      );
    });
    expect(r304.events).toEqual(["response 304 cl=100", 'end ""', "close rst=0"]);
  });

  test("the content-length governing the body comes from the final (non-1xx) response", async () => {
    const { events } = await exchange({}, (socket, id) => {
      socket.write(headersFrame(id, [[":status", 100]], false));
      socket.write(
        headersFrame(
          id,
          [
            [":status", 200],
            ["content-length", 2],
          ],
          false,
        ),
      );
      socket.write(dataFrame(id, "xy", true));
    });
    expect(events).toEqual(["headers 100", "response 200 cl=2", 'end "xy"', "close rst=0"]);
  });
});

describe.concurrent("node:http2 client rejects malformed response header sections (RFC 9113 §8.3)", () => {
  test("a response with no :status pseudo-header is a stream error, never surfaced to JS", async () => {
    const { events, rstSentToServer } = await exchange({}, (socket, id) => {
      socket.write(headersFrame(id, [["cache-control", "private"]], true));
    });
    expect(events).toEqual(["error ERR_HTTP2_STREAM_ERROR", "close rst=1"]);
    expect(await rstSentToServer).toBe(NGHTTP2_PROTOCOL_ERROR);
  });

  test("a response with an empty header block is a stream error", async () => {
    const { events } = await exchange({}, (socket, id) => {
      socket.write(new h2utils.HeadersFrame(id, Buffer.alloc(0), 0, true, true).data);
    });
    expect(events).toEqual(["error ERR_HTTP2_STREAM_ERROR", "close rst=1"]);
  });

  test("the header block following a 1xx interim response still requires :status", async () => {
    const { events } = await exchange({}, (socket, id) => {
      socket.write(headersFrame(id, [[":status", 100]], false));
      socket.write(headersFrame(id, [["x-foo", "bar"]], true));
    });
    expect(events).toEqual(["headers 100", "error ERR_HTTP2_STREAM_ERROR", "close rst=1"]);
  });

  test.each([["abc"], ["99"], ["101"]])("an invalid :status value (%s) is a stream error", async value => {
    const { events } = await exchange({}, (socket, id) => {
      socket.write(headersFrame(id, [[":status", value]], true));
    });
    expect(events).toEqual(["error ERR_HTTP2_STREAM_ERROR", "close rst=1"]);
  });

  test("a request pseudo-header in a response is a stream error", async () => {
    const { events } = await exchange({}, (socket, id) => {
      socket.write(
        headersFrame(
          id,
          [
            [":status", 200],
            [":method", "GET"],
          ],
          true,
        ),
      );
    });
    expect(events).toEqual(["error ERR_HTTP2_STREAM_ERROR", "close rst=1"]);
  });

  test("a pseudo-header in a trailer section is a stream error", async () => {
    const { events } = await exchange({}, (socket, id) => {
      socket.write(headersFrame(id, [[":status", 200]], false));
      socket.write(dataFrame(id, "xy", false));
      socket.write(headersFrame(id, [[":status", 200]], true));
    });
    expect(events).toEqual(["response 200 cl=undefined", "error ERR_HTTP2_STREAM_ERROR", "close rst=1"]);
  });

  test("a trailer section without END_STREAM is a stream error, not a hung stream", async () => {
    // RFC 9113 §8.1: a trailer section ends the stream. Previously this left the stream open
    // forever (neither 'end' nor 'error' nor 'close').
    const { events } = await exchange({}, (socket, id) => {
      socket.write(headersFrame(id, [[":status", 200]], false));
      socket.write(dataFrame(id, "xy", false));
      socket.write(headersFrame(id, [["x-trailer", "1"]], false));
    });
    expect(events).toEqual(["response 200 cl=undefined", "error ERR_HTTP2_STREAM_ERROR", "close rst=1"]);
  });
});

describe.concurrent("node:http2 pushed streams get the same RFC 9113 §8.1.1 semantics", () => {
  // The engine learns the promised request's :method from the PUSH_PROMISE block it decoded
  // (nghttp2's nghttp2_http_record_request_method): the Sink shim only knows request()-opened
  // streams, so without this a pushed HEAD response with a content-length would be reset.
  const promised = (method: string): [string, string | number][] => [
    [":method", method],
    [":scheme", "http"],
    [":path", "/pushed"],
    [":authority", "raw"],
  ];

  test("a pushed HEAD response with a content-length and no body is not an error", async () => {
    const events = await pushExchange(promised("HEAD"), (socket, id) => {
      socket.write(
        headersFrame(
          id,
          [
            [":status", 200],
            ["content-length", 1234],
          ],
          true,
        ),
      );
    });
    expect(events).toEqual(["push-response 200 cl=1234", 'push-end ""', "push-close rst=0"]);
  });

  test("a pushed response shorter than its content-length is a stream error", async () => {
    const events = await pushExchange(promised("GET"), (socket, id) => {
      socket.write(
        headersFrame(
          id,
          [
            [":status", 200],
            ["content-length", 5],
          ],
          false,
        ),
      );
      socket.write(dataFrame(id, "xy", true));
    });
    expect(events).toEqual(["push-response 200 cl=5", "push-error ERR_HTTP2_STREAM_ERROR", "push-close rst=1"]);
  });

  test("a pushed response with no :status pseudo-header is a stream error", async () => {
    const events = await pushExchange(promised("GET"), (socket, id) => {
      socket.write(headersFrame(id, [["x-foo", "1"]], true));
    });
    expect(events).toEqual(["push-error ERR_HTTP2_STREAM_ERROR", "push-close rst=1"]);
  });

  test("a pushed HEAD response split across HEADERS and CONTINUATION is not an error", async () => {
    // The promised stream's engine entry carries the request's :method for the HEAD exemption;
    // it must survive the receive() batch boundary between HEADERS(END_STREAM, no END_HEADERS)
    // and the CONTINUATION that completes the block (RFC 9113 §4.3).
    const events = await pushExchange(promised("HEAD"), (socket, id, mainRequestClosed) => {
      const block = headerBlock([
        [":status", 200],
        ["content-length", 1234],
      ]);
      socket.write(new h2utils.HeadersFrame(id, block, 0, /* endOfHeaders */ false, /* final */ true).data);
      // Complete the block only after the client has fully processed the batch above.
      void mainRequestClosed.then(() =>
        socket.write(new h2utils.ContinuationFrame(id, Buffer.alloc(0), 0, false).data),
      );
    });
    expect(events).toEqual(["push-response 200 cl=1234", 'push-end ""', "push-close rst=0"]);
  });
});

describe.concurrent("node:http2 server rejects RFC 9113 §8.1.1 content-length violations", () => {
  test("a request body shorter than its content-length is a stream error", async () => {
    const { promise: gotStream, resolve: onStream } = Promise.withResolvers<http2.ServerHttp2Stream>();
    const { promise: errored, resolve: onError, reject: onNoError } = Promise.withResolvers<NodeJS.ErrnoException>();
    const server = http2.createServer();
    server.on("stream", stream => {
      // The violating DATA is already on the wire behind the request HEADERS, so the error
      // can fire before the awaited `gotStream` continuation runs: subscribe synchronously.
      // A stream that closes without erroring is a regression, never a hang.
      stream.once("error", onError);
      stream.once("close", () => onNoError(new Error("the server stream closed without emitting 'error'")));
      onStream(stream);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));

    const { promise: rstFromServer, resolve: onRst, reject: onMissingRst } = Promise.withResolvers<number>();
    const socket = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
    socket.on("error", () => {});
    // A missing RST_STREAM must fail the assertion, never hang the test.
    socket.on("close", () => onMissingRst(new Error("the server closed without sending RST_STREAM")));
    // One rejecting fails the test before the other is awaited; mark both handled so neither
    // surfaces as a stray unhandled rejection.
    errored.catch(() => {});
    rstFromServer.catch(() => {});
    try {
      await once(socket, "connect");
      let buf = Buffer.alloc(0);
      socket.on("data", chunk => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 9) {
          const length = buf.readUIntBE(0, 3);
          if (buf.length < 9 + length) break;
          if (buf[3] === 0x3) onRst(buf.readUInt32BE(9));
          buf = buf.subarray(9 + length);
        }
      });
      socket.write(h2utils.kClientMagic);
      socket.write(new h2utils.SettingsFrame(false).data);
      // POST /, content-length: 5, then a 2-byte body with END_STREAM.
      socket.write(
        headersFrame(
          1,
          [
            [":method", "POST"],
            [":scheme", "http"],
            [":path", "/"],
            [":authority", "raw"],
            ["content-length", "5"],
          ],
          false,
        ),
      );
      socket.write(dataFrame(1, "xy", true));

      const stream = await gotStream;
      stream.resume();
      // §8.1.1: the server must reset the stream, never report a complete request body.
      expect((await errored).code).toBe("ERR_HTTP2_STREAM_ERROR");
      expect(stream.rstCode).toBe(NGHTTP2_PROTOCOL_ERROR);
      expect(await rstFromServer).toBe(NGHTTP2_PROTOCOL_ERROR);
    } finally {
      socket.destroy();
      server.close();
    }
  });
});

describe.concurrent("node:http2 client request() on a dead session returns an erroring stream", () => {
  // node (v26.3.0) never throws from request(): a destroyed session yields a stream destroyed
  // on the next tick with ERR_HTTP2_INVALID_SESSION, a closed one with ERR_HTTP2_GOAWAY_SESSION.
  async function withServer(run: (client: http2.ClientHttp2Session) => Promise<void>) {
    const server = http2.createServer((req, res) => res.end("ok"));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const client = http2.connect(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    client.on("error", () => {});
    try {
      await once(client, "connect");
      await run(client);
    } finally {
      client.destroy();
      server.close();
    }
  }

  // Resolves with the emitted error once the stream also closes. The terminal paths a regression
  // would produce (the request reaching the peer, or a close with no error) reject immediately.
  function streamErroredAndClosed(req: http2.ClientHttp2Stream): Promise<NodeJS.ErrnoException> {
    const { promise, resolve, reject } = Promise.withResolvers<NodeJS.ErrnoException>();
    let error: NodeJS.ErrnoException | undefined;
    req.on("error", e => (error = e));
    req.on("response", () => reject(new Error("request() on a dead session reached the peer")));
    req.on("close", () => (error ? resolve(error) : reject(new Error("the stream closed without emitting 'error'"))));
    return promise;
  }

  test("after destroy(): ERR_HTTP2_INVALID_SESSION on the stream", async () => {
    await withServer(async client => {
      client.destroy();
      const req = client.request({ ":path": "/" });
      expect(await streamErroredAndClosed(req)).toEqual(
        expect.objectContaining({ code: "ERR_HTTP2_INVALID_SESSION", message: "The session has been destroyed" }),
      );
    });
  });

  test("after close(): ERR_HTTP2_GOAWAY_SESSION on the stream", async () => {
    await withServer(async client => {
      client.close();
      const req = client.request({ ":path": "/" });
      expect(await streamErroredAndClosed(req)).toEqual(
        expect.objectContaining({
          code: "ERR_HTTP2_GOAWAY_SESSION",
          message: "New streams cannot be created after receiving a GOAWAY",
        }),
      );
    });
  });
});
