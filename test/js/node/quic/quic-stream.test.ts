// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { describe, expect, test } from "bun:test";
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
// the block is only its two-byte prefix. Node sends no HEADERS frame for hints
// or trailers that have no field lines, and it decodes one that a peer sends.
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
  ) {
    await using client: any = await connect(origin.address, clientOptions);
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
  // A first block with no field lines: headers that have no ":status".
  const emptyResponse = { events: ["headers undefined", "end"], trailers: [] };

  describe("are not sent for trailers or hints", () => {
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

    // lsquic takes a header block only on a request stream with an open send
    // side. Anywhere else the call goes to lsquic as before.
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

    test("sendTrailers({}) queued on a session that is not HTTP/3 leaves the body of the stream alone", async () => {
      const received = Promise.withResolvers<string>();
      await using server = await listen(
        async (serverSession: any) => {
          serverSession.onstream = (stream: any) => {
            stream.closed.catch(() => {});
            text(stream).then(body => {
              stream.writer.endSync();
              received.resolve(body);
            }, received.reject);
          };
          await serverSession.closed.catch(() => {});
        },
        { sni, alpn: ["quic-test"], transportParams },
      );
      await using client: any = await connect(server.address!, { ...clientOptions, alpn: "quic-test" });
      const stream = await client.createBidirectionalStream({});
      stream.closed.catch(() => {});
      const queued = [stream.pending, stream.sendTrailers({})];
      stream.writer.writeSync(encoder.encode("hello"));
      stream.writer.endSync();
      const outcome = { queued, received: await received.promise, response: await text(stream) };
      expect(outcome).toEqual({ queued: [true, true], received: "hello", response: "" });
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

    // lsquic resets a request stream whose FIN comes before a header block. So
    // trailers that are the first block of a stream keep their HEADERS frame.
    test("sendTrailers({}) as the first block of a response still sends the block", async () => {
      const sent: boolean[] = [];
      await using origin = await listenHolding(stream => {
        sent.push(stream.sendTrailers({}), stream.sendHeaders({ ":status": "200" }));
      });
      const outcome = await besideHeldStream(origin, getSubject);
      expect({ sent, ...outcome }).toEqual({ sent: [true, false], subject: emptyResponse, held: "first,second" });
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
    // node:quic hands the block to the application as it is.
    test("by a client, as the first block of the response", async () => {
      await using origin = await listenHolding(emptyBlock);
      expect(await besideHeldStream(origin, getSubject)).toEqual({ subject: emptyResponse, held: "first,second" });
    });

    test("by a server, as the first block of the request", async () => {
      await using origin = await listenHolding(stream => stream.sendHeaders({ ":status": "400" }, { terminal: true }));
      const outcome = await besideHeldStream(origin, client => streamEvents(client, undefined, emptyBlock));
      expect({ requests: origin.requests(), ...outcome }).toEqual({
        // The request has no ":path".
        requests: [["/held", undefined]],
        subject: { events: ["headers 400", "end"], trailers: [] },
        held: "first,second",
      });
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
