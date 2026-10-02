// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { describe, expect, test } from "bun:test";
import { createPrivateKey, randomBytes, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen } from "node:quic";
import { inspect } from "node:util";
import { rawQuicExchange, type RawQuicOptions, type RawQuicStream } from "./raw-quic-client";

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

    const client = await connect(server.address, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    });
    await client.opened;

    const gotHeaders = Promise.withResolvers<string>();
    const stream = await client.createBidirectionalStream({
      headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
      onheaders(headers: Record<string, string>) {
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
        onheaders(this: any, headers: Record<string, string>) {
          // Echo what the server decoded straight back to the client.
          this.sendHeaders({ ":status": "200", "x-echo": headers["x-name"] });
          this.writer.endSync();
        },
      },
    );

    const client = await connect(server.address, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    });
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
      onheaders(headers: Record<string, string>) {
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
        onheaders(this: any, headers: Record<string, string>) {
          seen.push(headers);
          this.sendHeaders({ ":status": "200" });
          this.writer.endSync();
        },
      },
    );

    const client = await connect(server.address, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    });
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
  const connectTo = async (server: { address: unknown }) => {
    const client = await connect(server.address, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    });
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
        onheaders(this: any, headers: Record<string, string>) {
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
        ontrailers(this: any, trailers: Record<string, string>) {
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

    const client = await connect(server.address, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 5 },
      onerror() {},
    });
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

  // The same engine pass with a well-formed peer: a node:quic client that queues
  // a stream before the handshake and destroys itself once it has its 1-RTT
  // keys. Its Finished, its stream and its CONNECTION_CLOSE are all sent before
  // the listener, on this thread, reads any of them.
  const closesWithItsFinished = {
    keylog: true,
    onkeylog(this: any, line: string) {
      if (line.startsWith("CLIENT_TRAFFIC_SECRET_0")) this.destroy();
    },
    onerror() {},
  };

  test("a client that presented a certificate and closes with its Finished is not read as having none", async () => {
    const clientKey = createPrivateKey(readFileSync(join(keysDir, "agent2-key.pem")));
    const clientCert = readFileSync(join(keysDir, "agent2-cert.pem"));
    const events: unknown[] = [];
    const serverClosed = Promise.withResolvers<void>();
    await using server = await listen(
      (session: any) => {
        session.onerror = () => {};
        session.onhandshake = (info: any) =>
          events.push([
            "handshake",
            { protocol: info.protocol, validationErrorCode: info.validationErrorCode },
            {
              peerCertificate: session.peerCertificate?.fingerprint256,
              // A getter that only a live connection answers.
              remoteTransportParams: session.remoteTransportParams,
            },
          ]);
        session.onstream = (stream: any) => {
          events.push(["stream"]);
          stream.closed.catch(() => {});
        };
        session.closed.then(serverClosed.resolve, serverClosed.resolve);
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        alpn: ["quic-test"],
        verifyClient: true,
        ca: [clientCert],
        transportParams: { maxIdleTimeout: 5 },
      },
    );

    const client = await connect(server.address!, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      keys: [clientKey],
      certs: [clientCert],
      transportParams: { maxIdleTimeout: 5 },
      ...closesWithItsFinished,
    });
    client.opened.catch(() => {});
    client.closed.catch(() => {});
    const stream = await client.createBidirectionalStream({ body: new TextEncoder().encode("early body") });
    stream.closed.catch(() => {});

    await serverClosed.promise;
    expect(events).toEqual([
      [
        "handshake",
        { protocol: "quic-test", validationErrorCode: undefined },
        { peerCertificate: new X509Certificate(clientCert).fingerprint256, remoteTransportParams: undefined },
      ],
      ["stream"],
    ]);
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
        onheaders(this: any, headers: Record<string, string>) {
          gotHeaders.resolve(headers[":path"]);
        },
      },
    );

    const client = await connect(server.address, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    });
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

// lsquic can complete a handshake, read the peer's first stream and close the
// connection in one engine pass, before any of that reaches JS. What a listener
// sees must not depend on it. The raw client puts its streams in the datagram
// of its Finished, or in a later one, and both have to report the same.
//
// RFC 9114 section 4.1 requires HEADERS first on a request stream, so a DATA
// frame first is answered with CONNECTION_CLOSE H3_FRAME_UNEXPECTED (0x105).
describe("a malformed first request stream", () => {
  // An empty DATA frame (type 0x00, length 0).
  const emptyData: RawQuicStream[] = [{ id: 0, data: Uint8Array.of(0x00, 0x00) }];
  // A control stream (type 0x00) that carries SETTINGS, then DATA "a" on the request stream.
  const dataBehindControlStream: RawQuicStream[] = [
    { id: 2, data: Uint8Array.of(0x00, 0x04, 0x00) },
    { id: 0, data: Uint8Array.of(0x00, 0x01, 0x61) },
  ];
  const streamCallbacks = ["onheaders", "ontrailers", "oninfo", "onwanttrailers"];
  function respond(this: any) {
    this.sendHeaders({ ":status": "200" }, { terminal: true });
  }

  /** What the listener's first session reports, and the status a later connection gets. */
  async function exchange(
    streams: RawQuicStream[],
    send: RawQuicOptions["send"],
    listenCallbacks: Record<string, unknown> = { onheaders: respond },
  ) {
    const events: unknown[] = [];
    const sessions: Promise<unknown>[] = [];
    await using server = await listen(
      (session: any) => {
        const closed = Promise.withResolvers<void>();
        sessions.push(closed.promise);
        const record = sessions.length === 1 ? (event: unknown[]) => events.push(event) : () => {};
        session.onerror = (err: any) => record(["error", err?.code]);
        session.onhandshake = (info: any) =>
          record([
            "handshake",
            { protocol: info.protocol, cipher: info.cipher, servername: info.servername },
            { maxDatagramSize: session.maxDatagramSize, certificate: session.certificate?.fingerprint256 },
          ]);
        session.onstream = (stream: any) => {
          record([
            "stream",
            {
              priority: stream.priority,
              callbacks: streamCallbacks.filter(name => typeof stream[name] === "function"),
            },
          ]);
          // A listener that gave listen() no `onheaders` sets it on each stream.
          if (!listenCallbacks.onheaders) stream.onheaders = respond;
          stream.closed.catch(() => {});
        };
        session.closed.then(closed.resolve, closed.resolve);
      },
      {
        alpn: ["h3"],
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 5 },
        ...listenCallbacks,
      },
    );

    const close = await rawQuicExchange({ port: server.address!.port, alpn: "h3", streams, send });

    // The listener is still serving: it answers a well-formed request on a
    // new connection.
    const client = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 5 },
    });
    const answered = Promise.withResolvers<string>();
    const stream = await client.createBidirectionalStream({
      headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
      onheaders: (headers: Record<string, string>) => answered.resolve(headers[":status"]),
    });
    stream.closed.catch(() => {});
    const status = await answered.promise;
    client.close();
    await Promise.all(sessions);
    return { close, events, status };
  }

  const expected = (listenCallbacks: string[]) => ({
    close: { application: true, code: 0x105, reason: "unexpected HTTP/3 frame on stream 0" },
    events: [
      [
        "handshake",
        { protocol: "h3", cipher: "TLS_AES_128_GCM_SHA256", servername: "localhost" },
        // The raw client's max_datagram_frame_size, less the 3 bytes of a DATAGRAM frame header.
        { maxDatagramSize: 997, certificate: new X509Certificate(cert).fingerprint256 },
      ],
      ["stream", { priority: { level: "default", incremental: false }, callbacks: listenCallbacks }],
      ["error", "ERR_QUIC_TRANSPORT_ERROR"],
    ],
    status: "200",
  });

  test.each([
    ["an empty DATA frame", emptyData],
    ["a DATA frame behind a control stream", dataBehindControlStream],
  ])("%s in the handshake's last flight closes only that connection", async (_, streams) => {
    expect(await exchange(streams, "with-finished")).toEqual(expected(["onheaders"]));
    expect(await exchange(streams, "after-handshake-done")).toEqual(expected(["onheaders"]));
  });

  // Each listen()-time stream callback has its own setter.
  test.each(["ontrailers", "oninfo", "onwanttrailers"])(
    "a listener whose only listen()-time stream callback is %s reports the same",
    async name => {
      expect(await exchange(emptyData, "with-finished", { [name]() {} })).toEqual(expected([name]));
    },
  );
});

// Node selects a session's application (HTTP/3 or raw QUIC) when the ALPN is
// known, not when the handshake is reported: in the Session constructor for a
// client, and after the `onsession` callback for a server.
describe("a session's application", () => {
  const listenOptions = { sni: { "*": { keys: [key], certs: [cert] } }, transportParams: { maxIdleTimeout: 5 } };
  const connectOptions = { servername: "localhost", verifyPeer: "manual", transportParams: { maxIdleTimeout: 5 } };
  const quiet = (session: any) => {
    session.onerror = () => {};
    session.onstream = (stream: any) => stream.closed.catch(() => {});
    session.closed.catch(() => {});
  };
  const thrownCode = (fn: () => unknown) => {
    try {
      fn();
    } catch (err: any) {
      return err.code;
    }
  };

  test("an HTTP/3 client can set a stream's priority before its handshake", async () => {
    await using server = await listen(quiet, { ...listenOptions, onheaders() {} });
    const client = await connect(server.address!, { ...connectOptions, onerror() {} });
    client.closed.catch(() => {});
    const stream = await client.createBidirectionalStream({});
    stream.closed.catch(() => {});
    const result = {
      setPriority: thrownCode(() => stream.setPriority({ level: "high" })),
      priority: stream.priority,
    };
    client.destroy();
    expect(result).toEqual({ setPriority: undefined, priority: { level: "high", incremental: false } });
  });

  test("a raw-QUIC client has no headers and no priority before its handshake", async () => {
    await using server = await listen(quiet, { ...listenOptions, alpn: ["quic-test"] });
    const client = await connect(server.address!, { ...connectOptions, alpn: "quic-test", onerror() {} });
    client.closed.catch(() => {});
    const stream = await client.createBidirectionalStream({});
    stream.closed.catch(() => {});
    const result = {
      onheaders: thrownCode(() => {
        stream.onheaders = () => {};
      }),
      sendHeaders: thrownCode(() => stream.sendHeaders({ ":method": "GET", ":path": "/" })),
      priority: stream.priority,
    };
    client.destroy();
    expect(result).toEqual({ onheaders: "ERR_INVALID_STATE", sendHeaders: "ERR_INVALID_STATE", priority: null });
  });

  /** The application fields of a session's state, as util.inspect prints them. */
  const applicationState = (session: unknown) => {
    const text = inspect(session, { depth: 2 });
    const fields = ["applicationType", "headersSupported", "isPrioritySupported", "internalErrorCode"];
    return Object.fromEntries(fields.map(name => [name, text.match(new RegExp(`\\b${name}: ([^,\\s]+)`))?.[1]]));
  };

  // `applicationType` is node's Session::Application::Type: 1 for raw QUIC, 2 for HTTP/3.
  test.each([
    ["h3", { applicationType: "2", headersSupported: "1", isPrioritySupported: "true", internalErrorCode: "258n" }],
    [
      "quic-test",
      { applicationType: "1", headersSupported: "2", isPrioritySupported: "false", internalErrorCode: "1n" },
    ],
  ])("a server session for %s has none inside the listen callback and its own after it", async (alpn, application) => {
    const states = Promise.withResolvers<unknown>();
    await using server = await listen(
      (session: any) => {
        quiet(session);
        const inListenCallback = applicationState(session);
        session.onhandshake = () => states.resolve({ inListenCallback, inOnhandshake: applicationState(session) });
      },
      { ...listenOptions, alpn: [alpn] },
    );
    const client = await connect(server.address!, { ...connectOptions, alpn, onerror() {} });
    client.closed.catch(() => {});
    const seen = await states.promise;
    await client.close();
    expect(seen).toEqual({
      inListenCallback: {
        applicationType: "0",
        headersSupported: "0",
        isPrioritySupported: "false",
        internalErrorCode: "1n",
      },
      inOnhandshake: application,
    });
  });

  // A server that cannot accept the 0-RTT data of a ticket makes the client
  // drop its early streams, and an HTTP/3 client resets them with
  // H3_INTERNAL_ERROR (0x102). That happens before the handshake is reported.
  test("an HTTP/3 client resets rejected 0-RTT streams with H3_INTERNAL_ERROR", async () => {
    const tokenSecret = randomBytes(16);
    const first = { ...listenOptions, endpoint: { tokenSecret }, application: { enableDatagrams: true } };
    const second = { ...listenOptions, endpoint: { tokenSecret }, application: { enableDatagrams: false } };

    const ticket = Promise.withResolvers<Buffer>();
    {
      await using server = await listen(quiet, first);
      const client = await connect(server.address!, {
        ...connectOptions,
        ...first,
        onsessionticket: ticket.resolve,
        onerror() {},
      });
      await ticket.promise;
      await client.close();
    }

    // This listener no longer offers datagrams, so the ticket's 0-RTT is refused.
    await using server = await listen(quiet, second);
    const client = await connect(server.address!, {
      ...connectOptions,
      ...second,
      sessionTicket: await ticket.promise,
      onerror() {},
    });
    client.closed.catch(() => {});
    const early = await client.createBidirectionalStream({
      headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
    });
    const reset = await early.closed.then(
      () => undefined,
      (err: any) => ({ code: err.code, errorCode: err.errorCode }),
    );
    const info = await client.opened;
    await client.close();
    expect({ reset, earlyDataAttempted: info.earlyDataAttempted, earlyDataAccepted: info.earlyDataAccepted }).toEqual({
      reset: { code: "ERR_QUIC_APPLICATION_ERROR", errorCode: 0x102n },
      earlyDataAttempted: true,
      earlyDataAccepted: false,
    });
  });
});

// A raw-QUIC session has no headers. The setter says so inside `onstream`,
// where the error is the session's: it reaches `onerror`.
describe("a header callback on a raw-QUIC stream", () => {
  test("set inside onstream destroys the session with ERR_INVALID_STATE", async () => {
    const failed = Promise.withResolvers<string>();
    await using server = await listen(
      (session: any) => {
        session.onerror = (err: any) => failed.resolve(err?.code);
        session.onstream = (stream: any) => {
          stream.closed.catch(() => {});
          stream.onheaders = () => {};
        };
      },
      {
        alpn: ["quic-test"],
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 5 },
      },
    );

    const client = await connect(server.address!, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 5 },
      onerror() {},
    });
    client.closed.catch(() => {});
    const stream = await client.createBidirectionalStream({ body: new TextEncoder().encode("hi") });
    stream.closed.catch(() => {});
    expect(await failed.promise).toBe("ERR_INVALID_STATE");
    client.close();
  });
});
