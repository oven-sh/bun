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

describe.each(["bidi", "uni"] as const)("verifyClient: a %s stream", direction => {
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
    const options = { body: new TextEncoder().encode("early body") };
    const stream = await (direction === "uni"
      ? client.createUnidirectionalStream(options)
      : client.createBidirectionalStream(options));
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

// A stream that node:quic cannot open yet is a pending stream: its request
// waits in lsquic until the handshake is done and the peer's stream limit
// allows it. Each test here leaves a stream pending first.
describe("pending streams", () => {
  const encoder = new TextEncoder();
  const sni = { "*": { keys: [key], certs: [cert] } };
  const request = { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" };
  const raw = { server: { alpn: ["quic-test"] }, client: { alpn: "quic-test" } };
  const drain = async (stream: any) => {
    for await (const _ of stream) {
    }
  };

  // A server and a client session on loopback. Disposal destroys both: after
  // a failed expectation, a graceful close waits for the idle timeout.
  async function connected(onsession: (session: any) => void, serverOptions: any = {}, clientOptions: any = {}) {
    const server = await listen(onsession, {
      sni,
      ...serverOptions,
      transportParams: { maxIdleTimeout: 10, ...serverOptions.transportParams },
    });
    const sessions: any[] = [];
    const connectClient = async (options: any = {}) => {
      const client = await connect(server.address!, {
        servername: "localhost",
        verifyPeer: "manual",
        ...clientOptions,
        ...options,
        transportParams: { maxIdleTimeout: 10, ...clientOptions.transportParams },
      } as SessionOptions);
      client.closed.catch(() => {});
      sessions.push(client);
      return client;
    };
    return {
      client: await connectClient(),
      connectClient,
      [Symbol.dispose]() {
        for (const session of sessions) session.destroy();
        server.destroy();
      },
    };
  }
  const opener = (client: any) => async (direction: "uni" | "bidi", body: string) => {
    const options = { body: encoder.encode(body) };
    const stream = await (direction === "uni"
      ? client.createUnidirectionalStream(options)
      : client.createBidirectionalStream(options));
    stream.closed.catch(() => {});
    return stream;
  };
  // Records the body of every stream by stream id, then ends this side of a
  // bidirectional stream.
  const record = (received: Record<string, string>) => (serverSession: any) => {
    serverSession.closed.catch(() => {});
    serverSession.onstream = async (stream: any) => {
      stream.closed.catch(() => {});
      const id = String(stream.id);
      const chunks: Buffer[] = [];
      for await (const batch of stream) for (const chunk of batch) chunks.push(Buffer.from(chunk));
      received[id] = Buffer.concat(chunks).toString();
      if (stream.direction === "bidi") stream.writer.endSync();
    };
  };
  const ignoreStreams = (serverSession: any) => {
    serverSession.closed.catch(() => {});
    serverSession.onstream = (stream: any) => stream.closed.catch(() => {});
  };

  test("streams requested before the handshake open in order, and a later stream gets its own", async () => {
    const received: Record<string, string> = {};
    using sessions = await connected(record(received), raw.server, raw.client);
    const { client } = sessions;
    const open = opener(client);

    await open("uni", "uni 1");
    const answered = await open("bidi", "bidi 1");
    await open("uni", "uni 2");
    await client.opened;
    // The server ends a bidirectional stream after it read it. By then it
    // has read everything that the client sent with it.
    await drain(answered);
    expect(received).toEqual({ "2": "uni 1", "0": "bidi 1", "6": "uni 2" });

    await open("uni", "uni 3");
    await drain(await open("bidi", "bidi 2"));
    expect(received).toEqual({ "2": "uni 1", "0": "bidi 1", "6": "uni 2", "10": "uni 3", "4": "bidi 2" });
  });

  test.each(["uni", "bidi"] as const)("a destroyed pending %s stream does not take a stream id", async direction => {
    using sessions = await connected(ignoreStreams, raw.server, raw.client);
    const { client } = sessions;
    const open = opener(client);

    (await open(direction, "never sent")).destroy();
    await client.opened;
    expect((await open(direction, "first")).id).toBe(direction === "uni" ? 2n : 0n);
  });

  // The peer allows four streams and holds them. Four more wait for stream
  // credit and are destroyed, as a request timeout does. The credit that
  // arrives later goes to the streams that still wait for it.
  test.each(["uni", "bidi"] as const)(
    "a destroyed %s stream that waited for stream credit does not take the credit",
    async direction => {
      const release = Promise.withResolvers<void>();
      using sessions = await connected(
        (serverSession: any) => {
          serverSession.closed.catch(() => {});
          serverSession.onstream = async (stream: any) => {
            stream.closed.catch(() => {});
            if (stream.id < 16n) await release.promise;
            await drain(stream);
            if (stream.direction === "bidi") stream.writer.endSync();
          };
        },
        { ...raw.server, transportParams: { initialMaxStreamsBidi: 4, initialMaxStreamsUni: 4 } },
        raw.client,
      );
      const { client } = sessions;
      const open = opener(client);
      // A unidirectional stream closes when its body is sent. A bidirectional
      // stream is answered when the server ends its side.
      const sent = (stream: any) => (direction === "uni" ? stream.closed : drain(stream));
      await client.opened;

      const streams: any[] = [];
      for (let i = 0; i < 8; i++) streams.push(await open(direction, "held"));
      expect(streams.map(stream => stream.pending)).toEqual([false, false, false, false, true, true, true, true]);
      for (const waiting of streams.slice(4)) waiting.destroy();

      // This stream opens with the first credit that the server returns.
      const next = await open(direction, "next");
      release.resolve();
      await sent(next);
      const later = [await open(direction, "a"), await open(direction, "b"), await open(direction, "c")];
      await Promise.all(later.map(sent));
      const first = direction === "uni" ? 18n : 16n;
      expect([next, ...later].map(stream => stream.id)).toEqual([first, first + 4n, first + 8n, first + 12n]);
    },
  );

  test("an HTTP/3 session opens a pending unidirectional stream after its own three", async () => {
    using sessions = await connected(ignoreStreams, {
      // HTTP/3 takes three unidirectional streams on each side: control,
      // QPACK encoder and QPACK decoder. The default limit is those three.
      transportParams: { initialMaxStreamsUni: 10 },
      onheaders(this: any) {
        this.sendHeaders({ ":status": "200" }, { terminal: true });
      },
    });
    const { client } = sessions;

    const pending = await opener(client)("uni", "early");
    await client.opened;
    // The server sends its SETTINGS before it answers a request, and the
    // client opens its QPACK encoder stream when it reads them.
    const answered = Promise.withResolvers<void>();
    const stream = await client.createBidirectionalStream({ headers: request, onheaders: () => answered.resolve() });
    stream.closed.catch(() => {});
    await answered.promise;
    expect(pending.id).toBe(14n);
  });

  test("a unidirectional stream on a resumed session is sent as early data", async () => {
    const early: boolean[] = [];
    const read = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    let sessionTicket: Buffer | undefined;
    const gotTicket = Promise.withResolvers<void>();
    const gotToken = Promise.withResolvers<Buffer>();
    let accepted = 0;
    using sessions = await connected(
      (serverSession: any) => {
        const session = accepted++;
        serverSession.closed.catch(() => {});
        serverSession.onstream = async (stream: any) => {
          stream.closed.catch(() => {});
          await drain(stream);
          early[session] = stream.early;
          read[session].resolve();
        };
      },
      raw.server,
      {
        ...raw.client,
        onsessionticket(ticket: Buffer) {
          sessionTicket = ticket;
          gotTicket.resolve();
        },
        onnewtoken: (token: Buffer) => gotToken.resolve(token),
      },
    );
    const first = sessions.client;
    await first.opened;
    await opener(first)("uni", "first");
    const [token] = await Promise.all([gotToken.promise, gotTicket.promise, read[0].promise]);
    await first.close();

    const second = await sessions.connectClient({ sessionTicket, token });
    await opener(second)("uni", "early");
    const info: any = await second.opened;
    await read[1].promise;
    expect({ early, attempted: info.earlyDataAttempted, accepted: info.earlyDataAccepted }).toEqual({
      early: [false, true],
      attempted: true,
      accepted: true,
    });
  });

  test("streams created in the turn a GOAWAY arrives open or stay pending, as lsquic decides", async () => {
    let serverSession: any;
    const serverHasRequest = Promise.withResolvers<void>();
    const created = { uni: Promise.withResolvers<string>(), bidi: Promise.withResolvers<string>() };
    const datagrams = { application: { enableDatagrams: true }, transportParams: { maxDatagramFrameSize: 100 } };
    using sessions = await connected(
      (session: any) => {
        serverSession = session;
        ignoreStreams(session);
      },
      {
        ...datagrams,
        // The one bidirectional stream goes to the request that the server
        // holds. There is room for a unidirectional stream.
        transportParams: { ...datagrams.transportParams, initialMaxStreamsBidi: 1, initialMaxStreamsUni: 10 },
        // The response stays open, so the server's close() is graceful and
        // sends GOAWAY.
        onheaders(this: any) {
          this.sendHeaders({ ":status": "200" });
          serverHasRequest.resolve();
        },
      },
      {
        ...datagrams,
        ondatagram(this: any) {
          const report = (direction: "uni" | "bidi", creating: Promise<any>) =>
            creating.then(
              stream => {
                stream.closed.catch(() => {});
                created[direction].resolve(stream.pending ? "pending" : "opened");
              },
              err => created[direction].resolve(err.code),
            );
          report("uni", this.createUnidirectionalStream({ body: encoder.encode("late") }));
          report("bidi", this.createBidirectionalStream({ headers: request }));
        },
      },
    );
    const { client } = sessions;
    await client.opened;
    const gotResponse = Promise.withResolvers<void>();
    const held = await client.createBidirectionalStream({ headers: request, onheaders: () => gotResponse.resolve() });
    held.closed.catch(() => {});
    await Promise.all([serverHasRequest.promise, gotResponse.promise]);

    // The server sends a datagram and its GOAWAY in one turn. When the client
    // reads both in one pass, `ondatagram` runs after lsquic has the GOAWAY
    // and before `ongoaway`. lsquic still creates the unidirectional stream,
    // as node does, and refuses the request that has no stream credit. When
    // `ongoaway` ran first, the session refuses both.
    await serverSession.sendDatagram(new Uint8Array([1]));
    serverSession.close();
    expect(["opened", "ERR_INVALID_STATE"]).toContain(await created.uni.promise);
    expect(["pending", "ERR_INVALID_STATE"]).toContain(await created.bidi.promise);
  });

  test("a unidirectional stream that waits for stream credit opens after a GOAWAY", async () => {
    let serverSession: any;
    const serverHasRequest = Promise.withResolvers<void>();
    const goaway = Promise.withResolvers<void>();
    using sessions = await connected(
      (session: any) => {
        serverSession = session;
        ignoreStreams(session);
      },
      {
        // Three unidirectional streams for HTTP/3 and three for this test.
        transportParams: { initialMaxStreamsUni: 6 },
        // The response stays open, so the server's close() is graceful and
        // sends GOAWAY.
        onheaders(this: any) {
          this.sendHeaders({ ":status": "200" });
          serverHasRequest.resolve();
        },
      },
      { ongoaway: () => goaway.resolve() },
    );
    const { client } = sessions;
    await client.opened;
    const gotResponse = Promise.withResolvers<void>();
    const held = await client.createBidirectionalStream({ headers: request, onheaders: () => gotResponse.resolve() });
    held.closed.catch(() => {});
    await Promise.all([serverHasRequest.promise, gotResponse.promise]);

    // Three open streams hold the credit until they end.
    const holders: any[] = [];
    for (let i = 0; i < 3; i++) {
      const stream = await client.createUnidirectionalStream({});
      stream.closed.catch(() => {});
      holders.push(stream);
    }
    const waiting = await opener(client)("uni", "after the GOAWAY");
    serverSession.close();
    await goaway.promise;
    expect(waiting.pending).toBe(true);

    // A GOAWAY limits requests, not unidirectional streams. The server
    // returns the credit when the three streams end.
    for (const stream of holders) stream.writer.endSync();
    await waiting.closed;
    expect(waiting.id).toBe(26n);
  });
});
