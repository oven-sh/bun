// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, withoutAsanQuarantine } from "harness";
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen, type QuicEndpoint, type SessionOptions } from "node:quic";

const keysDir = join(import.meta.dir, "..", "test", "fixtures", "keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));

describe("QuicStream.destroy after the app ended the send side", () => {
  test("delivers the committed response instead of retracting it with RESET_STREAM", async () => {
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          // `onwanttrailers` throwing destroys this stream; its `closed`
          // rejects with that error. Swallow it -- the client is the subject.
          stream.closed.catch(() => {});
        };
        await serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 1 },
        onheaders(this: any) {
          this.sendHeaders({ ":status": "200" });
          this.writer.writeSync(new TextEncoder().encode("body"));
          this.writer.endSync();
        },
        onwanttrailers() {
          throw new Error("onwanttrailers error");
        },
      },
    );

    const client = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    } as SessionOptions);
    await client.opened;

    const gotHeaders = Promise.withResolvers<string>();
    const stream = await client.createBidirectionalStream({
      headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
      onheaders(headers: Record<string, any>) {
        gotHeaders.resolve(headers[":status"]);
      },
    });

    // Read the response body to completion. This must end with the server's
    // FIN; a RESET_STREAM here makes the iterator throw ERR_QUIC_STREAM_RESET.
    let readError: any;
    let chunks = 0;
    try {
      for await (const _ of stream) chunks++;
    } catch (e) {
      readError = e;
    }

    client.close();
    expect(readError).toBeUndefined();
    expect(chunks).toBeGreaterThan(0);
    expect(await gotHeaders.promise).toBe("200");
  });
});

// H3 header octets are latin1 on the wire (as node's StringBytes LATIN1 write
// does), not UTF-8. The send and receive halves must be exact inverses, or any
// header value >= U+0080 comes back mojibake ("é" -> "Ã©").
describe("HTTP/3 header encoding", () => {
  test("round-trips non-ASCII header values byte-for-byte", async () => {
    const VALUE = "café-ÿ";
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.closed.catch(() => {});
        };
        await serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 1 },
        onheaders(this: any, headers: Record<string, any>) {
          // Echo what the server decoded straight back to the client.
          this.sendHeaders({ ":status": "200", "x-echo": headers["x-name"] });
          this.writer.endSync();
        },
      },
    );

    const client = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    } as SessionOptions);
    await client.opened;

    const echoed = Promise.withResolvers<string>();
    await client.createBidirectionalStream({
      headers: {
        ":method": "GET",
        ":path": "/",
        ":scheme": "https",
        ":authority": "localhost",
        "x-name": VALUE,
      },
      onheaders(headers: Record<string, any>) {
        echoed.resolve(headers["x-echo"]);
      },
    });

    expect(await echoed.promise).toBe(VALUE);
    client.close();
  });

  // U+0100 truncates to 0x00 under that same latin1 write, so a plain
  // `value.indexOf("\0")` guard never fires: the encoded value carries the
  // `name\0value\0flags` delimiters itself and splices an extra header out of
  // one user-supplied string. The declared pair count is what rejects it
  // (node/src/node_http_common-inl.h bails the same way on `n >= count_`).
  test("rejects a value whose latin1 encoding splices in an extra header", async () => {
    const seen: Record<string, string>[] = [];
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.closed.catch(() => {});
        };
        await serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 1 },
        onheaders(this: any, headers: Record<string, any>) {
          seen.push(headers);
          this.sendHeaders({ ":status": "200" });
          this.writer.endSync();
        },
      },
    );

    const client = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    } as SessionOptions);
    await client.opened;

    const attacker = await client.createBidirectionalStream();
    expect(
      attacker.sendHeaders({
        ":method": "GET",
        ":path": "/",
        ":scheme": "https",
        ":authority": "localhost",
        // Each Ā becomes a delimiter; the Z is eaten as the first field's
        // flags byte, aligning `authorization` onto a name boundary.
        "x-name": "safeĀZauthorizationĀBearer stolenĀ",
      }),
    ).toBe(false);

    // A benign request on the same connection proves the guard is narrow and
    // orders the assertion below: h3 delivers it after anything the attacker
    // stream managed to put on the wire.
    const answered = Promise.withResolvers<void>();
    await client.createBidirectionalStream({
      headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
      onheaders() {
        answered.resolve();
      },
    });
    await answered.promise;
    client.close();

    expect(seen.length).toBe(1);
    expect(Object.keys(seen[0])).not.toContain("authorization");
  });
});

// A field section with no field lines is valid QPACK (RFC 9204 section 4.5):
// the block is only its two-byte prefix. node:quic decodes one that a peer
// sends. It sends none for hints or trailers that have no field lines, because
// a peer with a decoder that fails the block closes the connection.
describe("HTTP/3 header blocks with no field lines", () => {
  const encoder = new TextEncoder();
  const sni = { "*": { keys: [key], certs: [cert] } };
  const transportParams = { maxIdleTimeout: 5 };
  const clientOptions = {
    servername: "localhost",
    verifyPeer: "manual",
    transportParams,
    // A failed session is reported by what its streams deliver.
    onerror() {},
  } as SessionOptions;
  const request = (path: string) => ({
    ":method": "GET",
    ":path": path,
    ":scheme": "https",
    ":authority": "localhost",
  });
  const text = async (stream: any) => {
    let body = "";
    for await (const batch of stream) for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
    return body;
  };
  const hello = (stream: any, headers: Record<string, string> = {}) => {
    stream.sendHeaders({ ":status": "200", ...headers });
    stream.writer.writeSync(encoder.encode("hello"));
    stream.writer.endSync();
  };
  const ignoreStreams = async (serverSession: any) => {
    serverSession.onstream = (stream: any) => {
      stream.closed.catch(() => {});
    };
    await serverSession.closed.catch(() => {});
  };

  // A server whose "/held" response stays open until `finishHeld()`. Each test
  // ends its subject stream first, so the held body is complete only if the
  // connection outlived the subject stream.
  async function listenHolding(
    respond: (stream: any, headers: Record<string, any>) => void,
    callbacks: Record<string, unknown> = {},
  ) {
    let heldStream: any;
    // The request paths of each session, in arrival order.
    const requests = new Map<unknown, string[]>();
    const server = await listen(ignoreStreams, {
      sni,
      transportParams,
      onheaders(this: any, headers: Record<string, any>) {
        requests.set(this.session, [...(requests.get(this.session) ?? []), headers[":path"]]);
        if (headers[":path"] !== "/held") return respond(this, headers);
        // `callbacks` are for the subject stream. This one ends with a FIN.
        this.onwanttrailers = undefined;
        this.sendHeaders({ ":status": "200" });
        this.writer.writeSync(encoder.encode("first,"));
        heldStream = this;
      },
      ...callbacks,
    });
    return {
      address: server.address!,
      requests: () => [...requests.values()],
      finishHeld() {
        heldStream?.writer.writeSync(encoder.encode("second"));
        heldStream?.writer.endSync();
      },
      // Not close(): that waits for the session that fetch() keeps in its pool.
      async [Symbol.asyncDispose]() {
        server.destroy();
        await server.closed;
      },
    };
  }

  // Runs `subject` on a node:quic client that also reads the held response.
  async function besideHeldStream<T>(
    origin: Awaited<ReturnType<typeof listenHolding>>,
    subject: (client: any) => Promise<T>,
    options: Partial<SessionOptions> = {},
  ) {
    await using client: any = await connect(origin.address, { ...clientOptions, ...options });
    await client.opened;
    const heldStream = await client.createBidirectionalStream({ headers: request("/held") });
    heldStream.closed.catch(() => {});
    // The subject starts once the held response is under way.
    const started = Promise.withResolvers<void>();
    const held = (async () => {
      let body = "";
      try {
        for await (const batch of heldStream) {
          for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
          started.resolve();
        }
      } catch (error: any) {
        body += " (error " + error.code + ")";
      } finally {
        started.resolve();
      }
      return body;
    })();
    await started.promise;
    const result = await subject(client);
    origin.finishHeld();
    return { subject: result, held: await held };
  }

  // What the client sees on one stream, read once the stream is closed: every
  // header block is reported by then. A trailers event has no fixed place
  // among the body events, so it is kept apart.
  async function streamEvents(client: any, headers?: Record<string, string>, send?: (stream: any) => void) {
    const events: string[] = [];
    const trailers: object[] = [];
    const stream = await client.createBidirectionalStream({
      ...(headers && { headers }),
      oninfo: (block: Record<string, any>) => events.push("info " + block[":status"]),
      onheaders: (block: Record<string, any>) => events.push("headers " + block[":status"]),
      ontrailers: (block: Record<string, any>) => trailers.push({ ...block }),
    });
    const closed = stream.closed.catch(() => {});
    send?.(stream);
    try {
      for await (const batch of stream) {
        for (const chunk of batch) events.push("data " + Buffer.from(chunk).toString("latin1"));
      }
      events.push("end");
    } catch (error: any) {
      events.push("error " + error.code);
    }
    await closed;
    return { events, trailers };
  }
  const getSubject = (client: any) => streamEvents(client, request("/subject"));
  const helloOnly = { events: ["headers 200", "data hello", "end"], trailers: [] };

  describe("as trailers or hints", () => {
    test.each([
      ["{}", {}],
      ["{ name: undefined }", { "x-none": undefined }],
      ["{ name: [] }", { "x-none": [] }],
    ])("sendTrailers(%s) from onwanttrailers ends the stream with only the FIN", async (_, zero) => {
      const sent: boolean[] = [];
      await using origin = await listenHolding(hello, {
        onwanttrailers(this: any) {
          sent.push(this.sendTrailers(zero), this.sendTrailers(zero));
        },
      });
      const outcome = await besideHeldStream(origin, getSubject);
      expect({ sent, ...outcome }).toEqual({ sent: [true, false], subject: helloOnly, held: "first,second" });
    });

    test("pendingTrailers = {} ends the stream with only the FIN", async () => {
      let wantTrailersCalls = 0;
      await using origin = await listenHolding(
        stream => {
          stream.pendingTrailers = {};
          hello(stream);
        },
        // Pending trailers are sent only from a stream that has onwanttrailers.
        { onwanttrailers: () => wantTrailersCalls++ },
      );
      const outcome = await besideHeldStream(origin, getSubject);
      expect({ wantTrailersCalls, ...outcome }).toEqual({
        wantTrailersCalls: 0,
        subject: helloOnly,
        held: "first,second",
      });
    });

    test("sendInformationalHeaders({}) sends nothing", async () => {
      let sent: boolean | undefined;
      await using origin = await listenHolding(stream => {
        sent = stream.sendInformationalHeaders({});
        hello(stream);
      });
      const outcome = await besideHeldStream(origin, getSubject);
      expect({ sent, ...outcome }).toEqual({ sent: true, subject: helloOnly, held: "first,second" });
    });

    // lsquic keeps a header block that flow control has not let out yet, and
    // it refuses the next block until then. A block with no field lines needs
    // no room: hints return true, and trailers end the stream after the block.
    test("sendInformationalHeaders({}) and sendTrailers({}) behind a header block that waits for flow control", async () => {
      const sent: boolean[] = [];
      await using origin = await listenHolding(stream => {
        sent.push(
          // More than the 4096 bytes that the client lets the server send at first.
          stream.sendHeaders({ ":status": "200", "x-pad": Buffer.alloc(8000, "p").toString() }),
          stream.sendInformationalHeaders({}),
          stream.sendTrailers({}),
          stream.sendTrailers({}),
        );
        // Ends the stream where the trailers were refused.
        stream.writer.endSync();
      });
      const outcome = await besideHeldStream(origin, getSubject, {
        transportParams: { ...transportParams, initialMaxStreamDataBidiLocal: 4096 },
      });
      expect({ sent, ...outcome }).toEqual({
        sent: [true, true, true, false],
        subject: { events: ["headers 200", "end"], trailers: [] },
        held: "first,second",
      });
    });

    // The frame is left out only on a bidirectional stream whose send side is
    // open. Anywhere else the call goes to lsquic as before.
    test("sendTrailers({}) and sendInformationalHeaders({}) are refused on a unidirectional stream", async () => {
      await using server = await listen(ignoreStreams, {
        sni,
        // HTTP/3 opens three unidirectional streams of its own.
        transportParams: { ...transportParams, initialMaxStreamsUni: 4 },
      });
      await using client: any = await connect(server.address!, clientOptions);
      await client.opened;
      const stream = await client.createUnidirectionalStream();
      const outcome = {
        pending: stream.pending,
        sendTrailers: stream.sendTrailers({}),
        sendInformationalHeaders: stream.sendInformationalHeaders({}),
        written: stream.writer.writeSync(encoder.encode("hello")),
        ended: stream.writer.endSync(),
      };
      expect(outcome).toEqual({
        pending: false,
        sendTrailers: false,
        sendInformationalHeaders: false,
        written: true,
        ended: 5,
      });
      // The send side ended with the writer, so the stream closes.
      await stream.closed;
    });

    test("sendTrailers({}) after resetStream() returns what lsquic returns for a block", async () => {
      const sent: boolean[] = [];
      await using origin = await listenHolding(stream => {
        stream.sendHeaders({ ":status": "200" });
        stream.resetStream(7n);
        sent.push(stream.sendTrailers({}), stream.sendTrailers({}));
      });
      const { held } = await besideHeldStream(origin, getSubject);
      expect({ sent, held }).toEqual({ sent: [true, false], held: "first,second" });
    });

    test.each([
      ["the writer ended the stream", hello, "hello"],
      [
        "resetStream() reached the peer",
        (stream: any) => {
          stream.sendHeaders({ ":status": "200" });
          stream.resetStream(7n);
        },
        "ERR_QUIC_STREAM_RESET",
      ],
    ])("sendInformationalHeaders({}) and sendTrailers({}) are refused after %s", async (_, respond, response) => {
      const responseRead = Promise.withResolvers<void>();
      const late = Promise.withResolvers<object>();
      await using server = await listen(ignoreStreams, {
        sni,
        transportParams,
        onheaders(this: any) {
          respond(this);
          responseRead.promise.then(() =>
            late.resolve({
              destroyed: this.destroyed,
              sendInformationalHeaders: this.sendInformationalHeaders({}),
              sendTrailers: this.sendTrailers({}),
            }),
          );
        },
      });
      await using client: any = await connect(server.address!, clientOptions);
      await client.opened;
      const stream = await client.createBidirectionalStream({});
      stream.closed.catch(() => {});
      // The request does not end, so the server's stream outlives its send side.
      stream.sendHeaders(request("/subject"));
      const read = await text(stream).catch((error: any) => error.code);
      responseRead.resolve();
      const outcome = { read, late: await late.promise };
      // Drops the open request, so that both sessions can close.
      stream.destroy();
      expect(outcome).toEqual({
        read: response,
        late: { destroyed: false, sendInformationalHeaders: false, sendTrailers: false },
      });
    });

    // lsquic resets a request stream whose FIN comes before a header block. So
    // trailers that are the first block of a stream keep their HEADERS frame.
    // The two cases pin what a peer reports today for such a message, which
    // has no pseudo-header fields: the block as it is.
    test("sendTrailers({}) as the first block of a response still sends the block", async () => {
      const sent: boolean[] = [];
      await using origin = await listenHolding(stream => {
        sent.push(stream.sendTrailers({}), stream.sendHeaders({ ":status": "200" }));
      });
      const outcome = await besideHeldStream(origin, getSubject);
      expect({ sent, ...outcome }).toEqual({
        sent: [true, false],
        // Headers that have no ":status".
        subject: { events: ["headers undefined", "end"], trailers: [] },
        held: "first,second",
      });
    });

    test("sendTrailers({}) queued as the first block of a request still sends the block", async () => {
      const requests: object[] = [];
      await using server = await listen(ignoreStreams, {
        sni,
        transportParams,
        onheaders(this: any, headers: Record<string, any>) {
          requests.push({ ...headers });
          this.sendHeaders({ ":status": "400" }, { terminal: true });
        },
      });
      await using client: any = await connect(server.address!, clientOptions);
      let queued: unknown[] = [];
      const response = await streamEvents(client, undefined, stream => {
        queued = [stream.pending, stream.sendTrailers({})];
      });
      expect({ queued, requests, response }).toEqual({
        queued: [true, true],
        requests: [{}],
        response: { events: ["headers 400", "end"], trailers: [] },
      });
    });

    // `opened` is not awaited: the stream is created before the handshake
    // completes, so both of its blocks wait in the pending queue.
    test.each([
      ["sendTrailers({})", (stream: any) => stream.sendTrailers({}), []],
      [
        "sendTrailers() with a field",
        (stream: any) => stream.sendTrailers({ "x-checksum": "abc123" }),
        [{ "x-checksum": "abc123" }],
      ],
      // An INITIAL-kind block keeps its HEADERS frame. A server reports the
      // second block of a request as trailers.
      ["sendHeaders({}, { terminal: true })", (stream: any) => stream.sendHeaders({}, { terminal: true }), [{}]],
    ])("%s queued on a stream that is not open yet", async (_, end, requestTrailers) => {
      const seen: object[] = [];
      const requestClosed = Promise.withResolvers<void>();
      await using server = await listen(
        async (serverSession: any) => {
          serverSession.onstream = (stream: any) => {
            stream.closed.then(requestClosed.resolve, requestClosed.reject);
          };
          await serverSession.closed.then(
            () => requestClosed.reject(new Error("the session closed before the request stream")),
            requestClosed.reject,
          );
        },
        {
          sni,
          transportParams,
          onheaders(this: any) {
            hello(this);
          },
          ontrailers: (trailers: Record<string, any>) => seen.push({ ...trailers }),
        },
      );
      await using client: any = await connect(server.address!, clientOptions);
      let queued: unknown[] = [];
      const [response] = await Promise.all([
        streamEvents(client, undefined, stream => {
          queued = [stream.pending, stream.sendHeaders(request("/subject")), end(stream)];
        }),
        requestClosed.promise,
      ]);
      expect({ queued, requestTrailers: seen, response }).toEqual({
        queued: [true, true, true],
        requestTrailers,
        response: helloOnly,
      });
    });
  });

  // `sendHeaders({})` puts a block with no field lines on the wire: an
  // INITIAL-kind block always has its HEADERS frame. The node:quic cases prove
  // that it does: the peer reports the block as empty trailers.
  describe("are decoded as an empty block that leaves the connection open", () => {
    const emptyBlock = (stream: any) => stream.sendHeaders({}, { terminal: true });
    const afterHeaders = (stream: any) => {
      stream.sendHeaders({ ":status": "200" });
      emptyBlock(stream);
    };
    // Ends a response body with the block.
    const afterBody = {
      onwanttrailers(this: any) {
        emptyBlock(this);
      },
    };
    // Answers with the request body once the request has ended.
    const echo = (stream: any) => {
      text(stream).then(
        body => {
          stream.sendHeaders({ ":status": "200" });
          stream.writer.writeSync(encoder.encode("echo " + body));
          stream.writer.endSync();
        },
        () => {},
      );
    };

    test.each([
      ["headers", afterHeaders, {}, ["headers 200", "end"]],
      ["body", hello, afterBody, ["headers 200", "data hello", "end"]],
    ])("by a client, after the response %s", async (_, respond, callbacks, events) => {
      await using origin = await listenHolding(respond, callbacks);
      expect(await besideHeldStream(origin, getSubject)).toEqual({
        subject: { events, trailers: [{}] },
        held: "first,second",
      });
    });

    test.each([
      [
        "headers",
        (stream: any) => {
          stream.sendHeaders(request("/subject"));
          emptyBlock(stream);
        },
        "echo ",
      ],
      [
        "body",
        (stream: any) => {
          stream.sendHeaders(request("/subject"));
          stream.onwanttrailers = () => emptyBlock(stream);
          stream.writer.writeSync(encoder.encode("abc"));
          stream.writer.endSync();
        },
        "echo abc",
      ],
    ])("by a server, after the request %s", async (_, send, body) => {
      const requestTrailers: object[] = [];
      await using origin = await listenHolding(echo, {
        ontrailers: (trailers: Record<string, any>) => requestTrailers.push({ ...trailers }),
      });
      const outcome = await besideHeldStream(origin, client => streamEvents(client, undefined, send));
      expect({ requestTrailers, ...outcome }).toEqual({
        requestTrailers: [{}],
        subject: { events: ["headers 200", "data " + body, "end"], trailers: [] },
        held: "first,second",
      });
    });

    // A message whose first block has no pseudo-header fields is malformed.
    // What its own stream reports is not asserted here, only the connection.
    test("by a client, as the first block of the response", async () => {
      await using origin = await listenHolding(emptyBlock);
      const { held } = await besideHeldStream(origin, getSubject);
      expect(held).toBe("first,second");
    });

    test("by a server, as the first block of the request", async () => {
      await using origin = await listenHolding(stream => stream.sendHeaders({ ":status": "400" }, { terminal: true }));
      const { held } = await besideHeldStream(origin, client => streamEvents(client, undefined, emptyBlock));
      expect(held).toBe("first,second");
    });

    test.each([
      ["after the response headers", afterHeaders, {}, '200 ""'],
      ["after the response body", hello, afterBody, '200 "hello"'],
      [
        "after a response body that has a content-length",
        (stream: any) => hello(stream, { "content-length": "5" }),
        afterBody,
        '200 "hello"',
      ],
      ["as the first block of the response", emptyBlock, {}, "rejected HTTP3ProtocolError"],
    ])("by fetch(), %s", async (_, respond, callbacks, subject) => {
      await using origin = await listenHolding(respond, callbacks);
      const url = `https://127.0.0.1:${origin.address.port}`;
      const init = { protocol: "http3", tls: { rejectUnauthorized: false } } as RequestInit;
      const heldResponse = await fetch(`${url}/held`, init);
      const subjectResponse = await fetch(`${url}/subject`, init).then(
        async response => `${response.status} ${JSON.stringify(await response.text())}`,
        (error: Error & { code?: string }) => `rejected ${error.code}`,
      );
      origin.finishHeld();
      // Both requests on one session: otherwise the held body proves nothing.
      expect({ subject: subjectResponse, held: await heldResponse.text(), requests: origin.requests() }).toEqual({
        subject,
        held: "first,second",
        requests: [["/held", "/subject"]],
      });
    });
  });
});

// lsquic decodes a header block that follows another one while the stream is
// read, not when its bytes arrive. The peer in these tests writes its header
// blocks in one call, so they share one STREAM frame and that is where the
// later blocks are decoded.
describe("HTTP/3 header blocks that follow another header block", () => {
  const encoder = new TextEncoder();
  const request = (path: string) => ({
    ":method": "POST",
    ":path": path,
    ":scheme": "https",
    ":authority": "localhost",
  });
  const connectTo = async (server: QuicEndpoint) => {
    const client = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    } as SessionOptions);
    await client.opened;
    return client;
  };

  // Everything the client sees on one stream, in order.
  async function responseEvents(client: any, path: string, trailers?: Record<string, string>) {
    const events: string[] = [];
    const stream = await client.createBidirectionalStream({
      oninfo: (headers: Record<string, string>) => events.push("info " + headers[":status"]),
      onheaders: (headers: Record<string, string>) => events.push("headers " + headers[":status"]),
    });
    stream.closed.catch(() => {});
    stream.sendHeaders(request(path), { terminal: trailers === undefined });
    if (trailers) stream.sendTrailers(trailers);
    for await (const batch of stream) {
      for (const chunk of batch) events.push("data " + Buffer.from(chunk).toString("latin1"));
    }
    events.push("end");
    return events;
  }

  test("a client gets two interim responses and the final response in order", async () => {
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.closed.catch(() => {});
        };
        await serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 1 },
        onheaders(this: any, headers: Record<string, any>) {
          this.sendInformationalHeaders({ ":status": "100" });
          this.sendInformationalHeaders({ ":status": "103", link: "</style.css>; rel=preload" });
          if (headers[":path"] === "/no-body") {
            this.sendHeaders({ ":status": "204" }, { terminal: true });
            return;
          }
          this.sendHeaders({ ":status": "200" });
          this.writer.writeSync(encoder.encode("hello"));
          this.writer.endSync();
        },
      },
    );
    const client = await connectTo(server);
    const events = { noBody: await responseEvents(client, "/no-body"), body: await responseEvents(client, "/body") };
    client.close();
    expect(events).toEqual({
      noBody: ["info 100", "info 103", "headers 204", "end"],
      body: ["info 100", "info 103", "headers 200", "data hello", "end"],
    });
  });

  test("a server gets the trailers that follow the request headers", async () => {
    let requestTrailers: Record<string, string> | undefined;
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.closed.catch(() => {});
        };
        await serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 1 },
        onheaders(this: any) {
          this.sendHeaders({ ":status": "200" }, { terminal: true });
        },
        ontrailers(this: any, trailers: Record<string, any>) {
          requestTrailers = trailers;
        },
      },
    );
    const client = await connectTo(server);
    // The server queues the trailers event in the lsquic callback that reads
    // the request, ahead of the packet that carries its response.
    const response = await responseEvents(client, "/trailers", { "x-checksum": "abc123" });
    client.close();
    expect({ response, requestTrailers: { ...requestTrailers } }).toEqual({
      response: ["headers 200", "end"],
      requestTrailers: { "x-checksum": "abc123" },
    });
  });
});

describe("verifyClient", () => {
  test("a server requiring a client certificate never surfaces streams from a client that presented none", async () => {
    let announcedStreams = 0;
    const serverClosed = Promise.withResolvers<any>();
    await using server = await listen(
      (serverSession: any) => {
        serverSession.onerror = () => {};
        serverSession.onstream = (stream: any) => {
          announcedStreams++;
          stream.closed.catch(() => {});
        };
        serverSession.closed.then(
          () => serverClosed.resolve(undefined),
          (err: any) => serverClosed.resolve(err),
        );
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        alpn: ["quic-test"],
        verifyClient: true,
        transportParams: { maxIdleTimeout: 5 },
      },
    );

    const client = await connect(server.address!, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 5 },
      onerror() {},
    } as SessionOptions);
    const clientClosed = client.closed.then(
      () => undefined,
      (err: any) => err,
    );
    client.opened.catch(() => {});
    const stream = await client.createBidirectionalStream({ body: new TextEncoder().encode("early body") });
    stream.closed.catch(() => {});

    const [serverError, clientError] = await Promise.all([serverClosed.promise, clientClosed]);
    expect({
      announcedStreams,
      server: serverError?.code,
      client: clientError?.code,
    }).toEqual({
      announcedStreams: 0,
      server: "ERR_QUIC_TRANSPORT_ERROR",
      client: "ERR_QUIC_TRANSPORT_ERROR",
    });
  });
});

describe("headers queued before the handshake", () => {
  // The HEADERS frame of a stream created before the handshake completes
  // must leave once lsquic opens the stream, not once the writer is used.
  test("reach the server without a write to the stream", async () => {
    const gotHeaders = Promise.withResolvers<string>();
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.closed.catch(() => {});
        };
        await serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 1 },
        onheaders(this: any, headers: Record<string, any>) {
          gotHeaders.resolve(headers[":path"]);
        },
      },
    );

    const client = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    } as SessionOptions);
    const stream = await client.createBidirectionalStream({});
    stream.closed.catch(() => {});
    stream.sendHeaders({ ":method": "POST", ":path": "/queued", ":scheme": "https", ":authority": "localhost" });

    const closed = client.closed.then(
      () => "closed",
      () => "closed",
    );
    expect(await Promise.race([gotHeaders.promise, closed])).toBe("/queued");
    client.close();
  });
});

// lsquic can finish the handshake, read the peer's first stream and close the connection in one
// engine pass, before JS sees any of it. A request created before `opened` is sent with the
// client's Finished, and lsquic rejects its bad content-length with H3_MESSAGE_ERROR (0x10e).
test("a malformed request in the handshake's last flight closes only that connection", async () => {
  const events: unknown[] = [];
  const sessions: Promise<unknown>[] = [];
  await using server = await listen(
    (session: any) => {
      const record = sessions.length === 0 ? (event: unknown) => events.push(event) : () => {};
      const closed = Promise.withResolvers<void>();
      sessions.push(closed.promise);
      session.onerror = () => record("error");
      session.onhandshake = (info: any) => record(["handshake", info.protocol, info.servername]);
      session.onstream = (stream: any) => {
        record("stream");
        stream.closed.catch(() => {});
      };
      session.closed.then(closed.resolve, closed.resolve);
    },
    {
      alpn: ["h3"],
      sni: { "*": { keys: [key], certs: [cert] } },
      transportParams: { maxIdleTimeout: 5 },
      onheaders(this: any) {
        this.sendHeaders({ ":status": "200" }, { terminal: true });
      },
    },
  );
  const options = {
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: 5 },
    onerror() {},
  } as SessionOptions;
  const headers = { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" };

  const malformed = await connect(server.address!, options);
  malformed.opened.catch(() => {});
  const close = malformed.closed.then(
    () => undefined,
    (err: any) => ({ code: err.code, errorCode: err.errorCode }),
  );
  (await malformed.createBidirectionalStream({ headers: { ...headers, "content-length": "abc" } })).closed.catch(
    () => {},
  );
  expect(await close).toEqual({ code: "ERR_QUIC_APPLICATION_ERROR", errorCode: 0x10en });

  const client = await connect(server.address!, options);
  const answered = Promise.withResolvers<string>();
  client.closed.then(() => answered.reject(new Error("closed without an answer")), answered.reject);
  const stream = await client.createBidirectionalStream({
    headers,
    onheaders: (headers: Record<string, any>) => answered.resolve(headers[":status"]),
  });
  stream.closed.catch(() => {});
  expect(await answered.promise).toBe("200");
  client.close();
  await Promise.all(sessions);
  expect(events).toEqual([["handshake", "h3", "localhost"], "stream", "error"]);
});

test("session.close() before the handshake ends doesn't wait for a pending HTTP/3 stream", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { connect } from "node:quic";
        // This socket never answers, and the session never times out.
        const silent = await Bun.udpSocket({ hostname: "127.0.0.1" });
        const session = await connect(
          { address: "127.0.0.1", port: silent.port },
          { servername: "localhost", verifyPeer: "manual", handshakeTimeout: 600_000, transportParams: { maxIdleTimeout: 0 } },
        );
        session.opened.catch(() => {});
        const stream = await session.createBidirectionalStream({
          headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
        });
        console.log("pending", stream.pending);
        await session.close();
        await stream.closed;
        console.log("closed");
        process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("pending true\nclosed\n");
  expect(exitCode).toBe(0);
}, 30_000);

// `destroy()` sends STOP_SENDING and RESET_STREAM. Once the response is sent and
// acked, STOP_SENDING finishes the stream and lsquic frees it in the next service
// pass, so a queued RESET_STREAM packet would point to freed memory.
describe("QuicStream.destroy on a stream lsquic has already finished", () => {
  // The peer's FIN has to arrive after a gap, or lsquic closes the read side
  // before the app can call destroy(). A UDP relay in front of the server
  // drops the packet carrying the body.
  const script = String.raw`
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen } from "node:quic";

const keysDir = process.env.QUIC_KEYS_DIR;
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));
const quiet = x => (x.closed?.catch?.(() => {}), x);
const dec = new TextDecoder();
const read = async s => {
  let out = "";
  try {
    for await (const chunk of s) for (const b of [chunk].flat()) out += dec.decode(b);
  } catch {}
  return out;
};

let stuck = null;
let nth = 0;
const destroyed = Promise.withResolvers();

const server = await listen(
  session => {
    quiet(session).onerror = () => {};
    session.onstream = stream => {
      quiet(stream);
      stream.sendHeaders({ ":status": "200" });
      stream.setBody(Buffer.from("answer"));
      const i = nth++;
      if (i === 0) {
        stuck = stream; // never read, so the peer's FIN is stuck behind the gap
        return;
      }
      if (i > 1) return;
      (async () => {
        for await (const _ of stream) {
          stuck.destroy();
          destroyed.resolve();
          break;
        }
      })();
    };
  },
  {
    alpn: ["h3"],
    sni: { "*": { keys: [key], certs: [cert] } },
    transportParams: { maxIdleTimeout: 5 },
  },
);

const serverPort = server.address.port;
const front = createSocket("udp4");
await new Promise(r => front.bind(0, "127.0.0.1", r));
const dropped = Promise.withResolvers();
let up = null;
let gap = false;
front.on("message", (m, from) => {
  up ??= createSocket("udp4").on("message", back => front.send(back, from.port, "127.0.0.1"));
  if (gap && m.length > 400) {
    dropped.resolve();
    return;
  }
  up.send(m, serverPort, "127.0.0.1");
});

const client = await connect(
  { address: "127.0.0.1", port: front.address().port },
  {
    alpn: "h3",
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: 5 },
    onerror() {},
  },
);
await client.opened;

const headers = { ":method": "POST", ":path": "/", ":scheme": "https", ":authority": "localhost" };

// A gets a full response and is then abandoned.
const a = quiet(await client.createBidirectionalStream({}));
a.sendHeaders(headers);
console.log("A:" + (await read(a)));

// B tells the server when to destroy A. Its headers reach the server before the relay starts dropping packets.
const b = quiet(await client.createBidirectionalStream({}));
b.sendHeaders(headers);
console.log("B:" + (await read(b)));

// The relay drops the body packet, but the byte and the FIN after it arrive.
gap = true;
a.writer.writeSync(new Uint8Array(1000).fill(0x41));
await dropped.promise;
a.writer.writeSync(new Uint8Array([0x42]));
a.writer.endSync();
b.writer.writeSync(new Uint8Array([0x43]));
await destroyed.promise;

// One more round trip, so the server ticks after the destroy.
const c = quiet(await client.createBidirectionalStream({}));
c.sendHeaders(headers);
console.log("C:" + (await read(c)));
process.exit(0);
`;

  test("answers on the same connection instead of resetting the freed stream", async () => {
    using dir = tempDir("quic-destroy-finished", { "repro.mjs": script });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repro.mjs"],
      env: { ...bunEnv, QUIC_KEYS_DIR: keysDir },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.split("\n").filter(Boolean), stderr: stderr.includes("Assertion") ? stderr : "" }).toEqual({
      stdout: ["A:answer", "B:answer", "C:answer"],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  }, 30_000);
});

test("a stream that reuses a destroyed stream's allocation doesn't get its queued close event", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      join(import.meta.dir, "quic-stream-recycled-close-fixture.ts"),
      join(keysDir, "agent1-key.pem"),
      join(keysDir, "agent1-cert.pem"),
    ],
    // ASAN only reuses a freed block right away when its quarantine is off.
    env: withoutAsanQuarantine(bunEnv),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe(JSON.stringify({ opened: 16, delivered: 16, closedBeforeSent: [] }) + "\n");
  expect(exitCode).toBe(0);
}, 30_000);
