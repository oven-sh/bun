// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { createPrivateKey, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen, QuicEndpoint, type SessionOptions } from "node:quic";

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

  // The endpoints of this block stay open until its last test ends. An
  // endpoint answers a late packet for a session that is gone with a
  // stateless reset. A reset to a closed port makes the next send of that
  // endpoint fail. lsquic then sends nothing for a second, and it leaks a
  // reset that it could not send.
  const endpoints: QuicEndpoint[] = [];
  afterAll(() => {
    for (const endpoint of endpoints) endpoint.destroy();
  });

  // A server and a client session on loopback. Disposal destroys the sessions
  // of both sides: after a failed expectation, a graceful close waits for the
  // idle timeout.
  async function connected(onsession: (session: any) => void, serverOptions: any = {}, clientOptions: any = {}) {
    const sessions: any[] = [];
    const server = await listen(
      (session: any) => {
        sessions.push(session);
        return onsession(session);
      },
      {
        sni,
        ...serverOptions,
        transportParams: { maxIdleTimeout: 10, ...serverOptions.transportParams },
      },
    );
    endpoints.push(server);
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
      },
    };
  }
  const opener = (session: any) => async (direction: "uni" | "bidi", body: string) => {
    const options = { body: encoder.encode(body) };
    const stream = await (direction === "uni"
      ? session.createUnidirectionalStream(options)
      : session.createBidirectionalStream(options));
    stream.closed.catch(() => {});
    return stream;
  };
  // A unidirectional stream closes when its body is sent. A bidirectional
  // stream is answered when the peer ends its side.
  const sent = (stream: any) => (stream.direction === "uni" ? stream.closed : drain(stream));
  const serve = (onstream: (stream: any) => void) => (session: any) => {
    session.closed.catch(() => {});
    session.onstream = onstream;
  };
  const ignoreStreams = serve(stream => stream.closed.catch(() => {}));
  // Records the body of every stream by stream id, then ends this side of a
  // bidirectional stream.
  const record = (received: Record<string, string>) =>
    serve(async stream => {
      stream.closed.catch(() => {});
      const id = String(stream.id);
      const chunks: Buffer[] = [];
      for await (const batch of stream) for (const chunk of batch) chunks.push(Buffer.from(chunk));
      received[id] = Buffer.concat(chunks).toString();
      if (stream.direction === "bidi") stream.writer.endSync();
    });
  // Reads a stream, then ends this side of a bidirectional one. A stream with
  // an id under `heldBelow` waits for `release` first: it keeps its stream
  // credit until then.
  const readAndHold = (heldBelow: bigint, release: Promise<void>) => async (stream: any) => {
    stream.closed.catch(() => {});
    if (stream.id < heldBelow) await release;
    await drain(stream);
    if (stream.direction === "bidi") stream.writer.endSync();
  };
  const answers = {
    onheaders(this: any) {
      this.sendHeaders({ ":status": "200" }, { terminal: true });
    },
  };
  // A client has read the server's SETTINGS when a request is answered.
  async function settingsRead(client: any) {
    const answered = Promise.withResolvers<void>();
    const stream = await client.createBidirectionalStream({ headers: request, onheaders: () => answered.resolve() });
    stream.closed.catch(() => {});
    await answered.promise;
  }
  // The session ticket and the token of a first session with this server.
  async function ticketFrom(sessions: { connectClient: (options?: any) => Promise<any> }) {
    const sessionTicket = Promise.withResolvers<Buffer>();
    const token = Promise.withResolvers<Buffer>();
    const first = await sessions.connectClient({
      onsessionticket: (ticket: Buffer) => sessionTicket.resolve(ticket),
      onnewtoken: (newToken: Buffer) => token.resolve(newToken),
    });
    await first.opened;
    const resumption = { sessionTicket: await sessionTicket.promise, token: await token.promise };
    await first.close();
    return resumption;
  }
  // An HTTP/3 session whose server holds one request. The response stays
  // open, so a close() of either side is graceful and sends GOAWAY.
  async function withHeldRequest(serverOptions: any = {}, clientOptions: any = {}) {
    let serverSession: any;
    let response: any;
    let requests = 0;
    const serverHasRequest = Promise.withResolvers<void>();
    const sessions = await connected(
      (session: any) => {
        serverSession = session;
        ignoreStreams(session);
      },
      {
        ...serverOptions,
        onheaders(this: any) {
          requests++;
          response = this;
          this.sendHeaders({ ":status": "200" });
          serverHasRequest.resolve();
        },
      },
      clientOptions,
    );
    try {
      await sessions.client.opened;
      const gotResponse = Promise.withResolvers<void>();
      const held = await sessions.client.createBidirectionalStream({
        headers: request,
        onheaders: () => gotResponse.resolve(),
      });
      held.closed.catch(() => {});
      await Promise.all([serverHasRequest.promise, gotResponse.promise]);
      return { ...sessions, held, serverSession, response, requests: () => requests };
    } catch (err) {
      sessions[Symbol.dispose]();
      throw err;
    }
  }

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
        serve(readAndHold(16n, release.promise)),
        { ...raw.server, transportParams: { initialMaxStreamsBidi: 4, initialMaxStreamsUni: 4 } },
        raw.client,
      );
      const { client } = sessions;
      const open = opener(client);
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

  // `b` leaves the middle of the queue, and the collector frees its wrapper:
  // a stream created after that can get the same address.
  test.each([
    ["uni", "before the handshake"],
    ["uni", "for stream credit"],
    ["bidi", "before the handshake"],
    ["bidi", "for stream credit"],
  ] as const)("a destroyed %s stream between two that wait %s does not change their order", async (direction, wait) => {
    const credit = wait === "for stream credit";
    const release = Promise.withResolvers<void>();
    using sessions = await connected(
      serve(readAndHold(credit ? 8n : 0n, release.promise)),
      { ...raw.server, transportParams: credit ? { initialMaxStreamsBidi: 2, initialMaxStreamsUni: 2 } : {} },
      raw.client,
    );
    const { client } = sessions;
    const open = opener(client);
    let first = direction === "uni" ? 2n : 0n;
    if (credit) {
      await client.opened;
      await open(direction, "held");
      await open(direction, "held");
      first += 8n;
    }

    const a = await open(direction, "a");
    let b: any = await open(direction, "b");
    const c = await open(direction, "c");
    expect([a.pending, b.pending, c.pending]).toEqual([true, true, true]);
    b.destroy();
    b = undefined;
    Bun.gc(true);
    const d = await open(direction, "d");

    release.resolve();
    await Promise.all([a, c, d].map(sent));
    const e = await open(direction, "e");
    await sent(e);
    expect([a, c, d, e].map(stream => stream.id)).toEqual([first, first + 4n, first + 8n, first + 12n]);
  });

  // The roles of the credit test swapped. A Bun client returns stream credit
  // after 50 of the server's streams closed, hence a limit of 50. The limit is
  // an option of the client's endpoint, so this client has its own.
  test("a destroyed stream of a server that waited for stream credit does not take the credit", async () => {
    const release = Promise.withResolvers<void>();
    const result = Promise.withResolvers<{ pending: boolean[]; ids: bigint[] }>();
    const endpoint = new QuicEndpoint();
    endpoints.push(endpoint);
    using sessions = await connected(
      async (serverSession: any) => {
        ignoreStreams(serverSession);
        try {
          await serverSession.opened;
          const open = opener(serverSession);
          const streams: any[] = [];
          for (let i = 0; i < 54; i++) streams.push(await open("bidi", "held"));
          const pending = streams.slice(49).map(stream => stream.pending);
          for (const waiting of streams.slice(50)) waiting.destroy();
          const next = await open("bidi", "next");
          release.resolve();
          await sent(next);
          const later = [await open("bidi", "a"), await open("bidi", "b"), await open("bidi", "c")];
          await Promise.all(later.map(sent));
          result.resolve({ pending, ids: [next, ...later].map(stream => stream.id) });
        } catch (err) {
          result.reject(err);
        }
      },
      raw.server,
      {
        ...raw.client,
        endpoint,
        transportParams: { initialMaxStreamsBidi: 50 },
        // The first 50 streams of the server have the ids 1 to 197.
        onstream: readAndHold(200n, release.promise),
      },
    );
    await sessions.client.opened;
    expect(await result.promise).toEqual({
      pending: [false, true, true, true, true],
      ids: [201n, 205n, 209n, 213n],
    });
  });

  test("an HTTP/3 session opens a pending unidirectional stream after its own three", async () => {
    using sessions = await connected(ignoreStreams, {
      // HTTP/3 takes three unidirectional streams on each side: control,
      // QPACK encoder and QPACK decoder. The default limit is those three.
      transportParams: { initialMaxStreamsUni: 10 },
      ...answers,
    });
    const { client } = sessions;

    const pending = await opener(client)("uni", "early");
    await client.opened;
    // The client opens its QPACK encoder stream when it reads the SETTINGS.
    await settingsRead(client);
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

  // HTTP/3 is different: the stream waits for the SETTINGS on a resumed
  // session too. As early data it would take the id of the QPACK encoder
  // stream, and its credit when the peer allows only three streams.
  test.each([
    ["ten streams", { initialMaxStreamsUni: 10 }, 14n],
    ["the three streams of HTTP/3", {}, null],
  ] as const)(
    "an HTTP/3 unidirectional stream on a resumed session waits for the SETTINGS (the peer allows %s)",
    async (_, transportParams, id) => {
      using sessions = await connected(ignoreStreams, { transportParams, ...answers });
      const client = await sessions.connectClient(await ticketFrom(sessions));
      const stream = await opener(client)("uni", "not early");
      const info: any = await client.opened;
      await settingsRead(client);
      expect({ accepted: info.earlyDataAccepted, id: stream.id }).toEqual({ accepted: true, id });
    },
  );

  // The session ticket is from another server, so this server rejects the
  // early data, as a server does after a restart. The session then destroys
  // the streams that were early data, and only those.
  test("an HTTP/3 stream requested before a rejected 0-RTT handshake ends is sent after it", async () => {
    const options = { endpoint: { tokenSecret: randomBytes(16) }, transportParams: { initialMaxStreamsUni: 10 } };
    using first = await connected(ignoreStreams, options);
    using second = await connected(ignoreStreams, { ...options, enableEarlyData: false });
    const client = await second.connectClient(await ticketFrom(first));
    const stream = await opener(client)("uni", "after the handshake");
    const info: any = await client.opened;
    await stream.closed;
    expect({ accepted: info.earlyDataAccepted, id: stream.id }).toEqual({ accepted: false, id: 14n });
    await client.close();
  });

  test("a stream that waited for stream credit when 0-RTT was rejected is sent after the handshake", async () => {
    const endpoint = { tokenSecret: randomBytes(16) };
    using first = await connected(
      ignoreStreams,
      { ...raw.server, endpoint, transportParams: { initialMaxStreamsUni: 1 } },
      raw.client,
    );
    using second = await connected(
      ignoreStreams,
      { ...raw.server, endpoint, enableEarlyData: false, transportParams: { initialMaxStreamsUni: 5 } },
      raw.client,
    );
    const client = await second.connectClient(await ticketFrom(first));
    const open = opener(client);
    // The client remembers a limit of one stream from the first server.
    const early = await open("uni", "early");
    const waiting = await open("uni", "waiting");
    expect([early.pending, waiting.pending]).toEqual([false, true]);
    await client.opened;
    await waiting.closed;
    expect(waiting.id).toBe(6n);
  });

  test("streams created in the turn a GOAWAY arrives open or stay pending, as lsquic decides", async () => {
    const order: string[] = [];
    const goaway = Promise.withResolvers<void>();
    const created = { uni: Promise.withResolvers<string>(), bidi: Promise.withResolvers<string>() };
    const outcome = (creating: Promise<any>) =>
      creating.then(
        stream => {
          stream.closed.catch(() => {});
          return stream.pending ? "pending" : "opened";
        },
        err => err.code,
      );
    const datagrams = { application: { enableDatagrams: true }, transportParams: { maxDatagramFrameSize: 100 } };
    using sessions = await withHeldRequest(
      {
        ...datagrams,
        // The one bidirectional stream goes to the held request. There is
        // room for a unidirectional stream.
        transportParams: { ...datagrams.transportParams, initialMaxStreamsBidi: 1, initialMaxStreamsUni: 10 },
      },
      {
        ...datagrams,
        ongoaway() {
          order.push("ongoaway");
          goaway.resolve();
        },
        ondatagram(this: any) {
          order.push("ondatagram");
          created.uni.resolve(outcome(this.createUnidirectionalStream({ body: encoder.encode("late") })));
          created.bidi.resolve(outcome(this.createBidirectionalStream({ headers: request })));
        },
      },
    );
    const { client, serverSession } = sessions;

    // The server sends a datagram and its GOAWAY in one turn. When the client
    // reads both in one pass, `ondatagram` runs after lsquic has the GOAWAY
    // and before `ongoaway`. lsquic still creates the unidirectional stream,
    // as node does, and refuses the request that has no stream credit.
    await serverSession.sendDatagram(new Uint8Array([1]));
    serverSession.close();
    const [uni, bidi] = await Promise.all([created.uni.promise, created.bidi.promise]);
    await goaway.promise;
    const inTurn = { order: ["ondatagram", "ongoaway"], uni: "opened", bidi: "pending" };
    const afterGoaway = { order: ["ongoaway", "ondatagram"], uni: "ERR_INVALID_STATE", bidi: "ERR_INVALID_STATE" };
    expect({ order, uni, bidi }).toEqual(order[0] === "ondatagram" ? inTurn : afterGoaway);

    // After `ongoaway` the session refuses both.
    const late = [client.createUnidirectionalStream({}), client.createBidirectionalStream({ headers: request })];
    expect(await Promise.all(late.map(outcome))).toEqual(["ERR_INVALID_STATE", "ERR_INVALID_STATE"]);
  });

  test("a unidirectional stream that waits for stream credit opens after a GOAWAY", async () => {
    const goaway = Promise.withResolvers<void>();
    using sessions = await withHeldRequest(
      // Three unidirectional streams for HTTP/3 and three for this test.
      { transportParams: { initialMaxStreamsUni: 6 } },
      { ongoaway: () => goaway.resolve() },
    );
    const { client, serverSession } = sessions;

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

  // lsquic drops a request that waits for stream credit when a GOAWAY is
  // sent or received. The session drops its queue entry with it: a debug
  // build asserts that the two agree.
  test.each(["the peer's GOAWAY arrives", "close() sends a GOAWAY"] as const)(
    "a request that waits for stream credit stays pending when %s",
    async when => {
      const goaway = Promise.withResolvers<void>();
      using sessions = await withHeldRequest(
        { transportParams: { initialMaxStreamsBidi: 1 } },
        { ongoaway: () => goaway.resolve() },
      );
      const { client, held, serverSession, response } = sessions;
      const waiting: any = await client.createBidirectionalStream({ headers: request });
      waiting.closed.catch(() => {});
      expect(waiting.pending).toBe(true);

      if (when === "the peer's GOAWAY arrives") {
        serverSession.close();
        await goaway.promise;
      } else {
        client.close().catch(() => {});
        // The response ends after the GOAWAY, and its stream credit returns.
        response.writer.endSync();
        await drain(held);
      }
      expect({ pending: waiting.pending, id: waiting.id, requests: sessions.requests() }).toEqual({
        pending: true,
        id: null,
        requests: 1,
      });
    },
  );

  // A close event that is still queued when its stream is destroyed can
  // reach a new stream: a release build gives the new wrapper the address of
  // the collected one. That stream then reports `closed` while it waits in
  // the queue, and it has to leave the queue with that. In a child process:
  // the session bound a collected wrapper, and the process crashed. A debug
  // build takes about three seconds to load node:quic, hence the timeout.
  test("a waiting stream that is reported closed leaves the queue", async () => {
    const script = `
      import { createPrivateKey } from "node:crypto";
      import { readFileSync } from "node:fs";
      import { connect, listen } from "node:quic";
      const key = createPrivateKey(readFileSync(${JSON.stringify(join(keysDir, "agent1-key.pem"))}));
      const cert = readFileSync(${JSON.stringify(join(keysDir, "agent1-cert.pem"))});
      const encoder = new TextEncoder();
      const drain = async stream => {
        for await (const _ of stream) {
        }
      };
      const server = await listen(
        session => {
          session.closed.catch(() => {});
          session.onstream = async stream => {
            stream.closed.catch(() => {});
            await drain(stream);
            stream.writer.endSync();
          };
        },
        {
          sni: { "*": { keys: [key], certs: [cert] } },
          alpn: ["quic-test"],
          transportParams: { maxIdleTimeout: 10, initialMaxStreamsBidi: 1 },
        },
      );
      const client = await connect(server.address, {
        servername: "localhost",
        verifyPeer: "manual",
        alpn: "quic-test",
        transportParams: { maxIdleTimeout: 10 },
      });
      client.closed.catch(() => {});
      await client.opened;
      const open = async body => {
        const stream = await client.createBidirectionalStream({ body: encoder.encode(body) });
        stream.closed.catch(() => {});
        return stream;
      };
      // The close event of the first stream is queued when destroy() runs.
      await (async () => {
        const first = await open("first");
        await drain(first);
        first.destroy();
      })();
      Bun.gc(true);
      const streams = [];
      for (let i = 0; i < 8; i++) streams.push(await open("waiting"));
      // The queued close event runs in the next turn.
      await new Promise(resolve => setImmediate(resolve));
      const waiting = streams.filter(stream => !stream.destroyed);
      streams.length = 0;
      Bun.gc(true);
      Bun.gc(true);
      await Promise.all(waiting.map(drain));
      const ids = waiting.map(stream => stream.id);
      console.log(ids.every((id, i) => id === 4n * BigInt(i + 1)) ? "in order" : "ids " + ids.join(","));
      process.exit(0);
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, crashed: stderr.includes("Segmentation fault") || stderr.includes("AddressSanitizer") }).toEqual({
      stdout: "in order\n",
      crashed: false,
    });
    expect(exitCode).toBe(0);
  }, 30_000);
});
