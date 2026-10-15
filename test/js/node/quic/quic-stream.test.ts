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

// lsquic gives the peer flow-control credit for every byte that is read from
// a stream. A stream that nothing reads is therefore not read from lsquic once
// its unread queue is above its receive window: the queue holds about one
// window, lsquic holds up to one more, and the peer waits.
describe("receive backpressure", () => {
  // The stream receive window of the side that does not read.
  const WINDOW = 65536;
  // The most that one read takes from lsquic (the buffer of on_stream_read in
  // src/runtime/node/quic/stream.rs).
  const READ_PIECE = 16384;
  // Above WINDOW + READ_PIECE, so the reads stop while lsquic still holds the
  // end of the body and the FIN. Not above 1.5 * WINDOW: lsquic advertises a
  // new window before less than half of it is left, so the sender can send
  // all of it to a receiver that reads nothing.
  const BODY = 90000;

  const pattern = (length: number) => {
    const bytes = Buffer.allocUnsafe(length);
    for (let i = 0; i < length; i++) bytes[i] = i % 251;
    return bytes;
  };
  const body = pattern(BODY);
  const request = { ":method": "POST", ":path": "/", ":scheme": "https", ":authority": "localhost" };

  // Both ends of the one stream that a shape opens.
  type Ends = { payload: Uint8Array; sender: PromiseWithResolvers<any>; receiver: PromiseWithResolvers<any> };
  type Shape = {
    name: string;
    // Absent for HTTP/3.
    alpn?: string;
    // The session that writes the payload.
    writer: "client" | "server";
    serverParams?: Record<string, number>;
    clientParams?: Record<string, number>;
    serverOptions?: Record<string, unknown>;
    // The first stream that the peer opens on the server and on the client.
    onServerStream?: (stream: any, ends: Ends) => void;
    onClientStream?: (stream: any, ends: Ends) => void;
    onServerSession?: (session: any, ends: Ends) => void;
    onClient?: (client: any, ends: Ends) => Promise<void>;
  };

  // A stream that closed before its first `stats` access reports zeroes.
  const keep = (stream: any) => {
    void stream.stats;
    stream.closed.catch(() => {});
    return stream;
  };

  const serverReadsBidi: Shape = {
    name: "a server does not read a client's bidirectional stream",
    alpn: "quic-test",
    writer: "client",
    serverParams: { initialMaxStreamDataBidiRemote: WINDOW },
    onServerStream(stream, ends) {
      stream.writer.endSync();
      ends.receiver.resolve(stream);
    },
    async onClient(client, ends) {
      ends.sender.resolve(keep(await client.createBidirectionalStream({ body: ends.payload })));
    },
  };
  const shapes: Shape[] = [
    serverReadsBidi,
    {
      name: "a server does not read a client's unidirectional stream",
      alpn: "quic-test",
      writer: "client",
      serverParams: { initialMaxStreamDataUni: WINDOW },
      onServerStream: (stream, ends) => ends.receiver.resolve(stream),
      async onClient(client, ends) {
        ends.sender.resolve(keep(await client.createUnidirectionalStream({ body: ends.payload })));
      },
    },
    {
      name: "a client does not read the answer on its own bidirectional stream",
      alpn: "quic-test",
      writer: "server",
      clientParams: { initialMaxStreamDataBidiLocal: WINDOW },
      onServerStream(stream, ends) {
        stream.setBody(ends.payload);
        ends.sender.resolve(stream);
      },
      async onClient(client, ends) {
        ends.receiver.resolve(keep(await client.createBidirectionalStream({ body: new Uint8Array(1) })));
      },
    },
    {
      name: "a client does not read a bidirectional stream that the server opened",
      alpn: "quic-test",
      writer: "server",
      clientParams: { initialMaxStreamDataBidiRemote: WINDOW },
      onClientStream(stream, ends) {
        stream.writer.endSync();
        ends.receiver.resolve(stream);
      },
      onServerSession(session, ends) {
        session.opened.then(async () => {
          ends.sender.resolve(keep(await session.createBidirectionalStream({ body: ends.payload })));
        }, ends.sender.reject);
      },
    },
    {
      name: "an HTTP/3 server answers a request and does not read its body",
      writer: "client",
      serverParams: { initialMaxStreamDataBidiRemote: WINDOW },
      serverOptions: {
        onheaders(this: any) {
          this.sendHeaders({ ":status": "200" }, { terminal: true });
        },
      },
      onServerStream: (stream, ends) => ends.receiver.resolve(stream),
      async onClient(client, ends) {
        ends.sender.resolve(keep(await client.createBidirectionalStream({ headers: request, body: ends.payload })));
      },
    },
  ];

  // Runs `shape` with `payload` and gives back both ends of the one stream.
  async function open(shape: Shape, payload: Uint8Array, idle = 10) {
    const ends: Ends = { payload, sender: Promise.withResolvers(), receiver: Promise.withResolvers() };
    const serverSession = Promise.withResolvers<any>();
    const markers: PromiseWithResolvers<void>[] = [];
    // A session's `onstream`: `first` gets the first stream, a marker waiter each later one.
    const route = (first?: (stream: any, ends: Ends) => void) => (stream: any) => {
      keep(stream);
      if (first) {
        const handler = first;
        first = undefined;
        handler(stream, ends);
      } else {
        markers.shift()?.resolve();
      }
    };
    const server = await listen(
      (session: any) => {
        session.onerror = () => {};
        session.closed.catch(() => {});
        session.onstream = route(shape.onServerStream);
        shape.onServerSession?.(session, ends);
        serverSession.resolve(session);
      },
      {
        ...(shape.alpn ? { alpn: [shape.alpn] } : {}),
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: idle, ...shape.serverParams },
        ...shape.serverOptions,
      },
    );
    const client = await connect(server.address!, {
      ...(shape.alpn ? { alpn: shape.alpn } : {}),
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: idle, ...shape.clientParams },
      onerror() {},
      onstream: route(shape.onClientStream),
    } as SessionOptions);
    client.closed.catch(() => {});
    await client.opened;
    await shape.onClient?.(client, ends);
    const [sender, receiver] = await Promise.all([ends.sender.promise, ends.receiver.promise]);
    const writer = shape.writer === "client" ? client : await serverSession.promise;
    return {
      client,
      serverSession: await serverSession.promise,
      sender,
      receiver,
      // Resolves when the other session has every packet that the writer sent
      // before this call: a stream that the writer opens now arrives after them.
      async arrived() {
        const marker = Promise.withResolvers<void>();
        markers.push(marker);
        keep(
          shape.alpn
            ? await writer.createUnidirectionalStream({ body: new Uint8Array(1) })
            : await writer.createBidirectionalStream({ headers: request }),
        );
        await marker.promise;
      },
      async [Symbol.asyncDispose]() {
        client.destroy();
        await server.destroy();
      },
    };
  }

  // How much of `payload` the stream still delivers, and whether it is the same bytes.
  async function delivered(stream: any, payload: Buffer) {
    const chunks: Uint8Array[] = [];
    for await (const batch of stream) chunks.push(...batch);
    const got = Buffer.concat(chunks);
    return { length: got.length, same: got.equals(payload) };
  }

  // The most bytes that the stream's unread queue held.
  const queued = (stream: any) => Number(stream.stats.maxBytesAccumulated);

  test.each(shapes)("$name", async shape => {
    await using pair = await open(shape, body);
    const { sender, receiver } = pair;
    let receiverClosed = false;
    receiver.closed.then(
      () => (receiverClosed = true),
      () => (receiverClosed = true),
    );

    await sender.closed;
    await pair.arrived();
    expect(queued(receiver)).toBeGreaterThan(WINDOW);
    expect(queued(receiver)).toBeLessThanOrEqual(WINDOW + READ_PIECE);
    expect(receiverClosed).toBe(false);

    // Reading takes the rest out of lsquic, then the FIN.
    expect(await delivered(receiver, body)).toEqual({ length: BODY, same: true });
    await receiver.closed;
    expect(queued(receiver)).toBeLessThanOrEqual(WINDOW + READ_PIECE);
  });

  test("a body that fills the window exactly closes the stream without a reader", async () => {
    const exact = pattern(WINDOW);
    await using pair = await open(serverReadsBidi, exact);
    await Promise.all([pair.sender.closed, pair.receiver.closed]);
    expect(await delivered(pair.receiver, exact)).toEqual({ length: WINDOW, same: true });
  });

  // The sender has far more than two windows to send. `onblocked` also fires
  // when the congestion window is the limit, so wait for the one that flow
  // control causes: it comes after the sender is past 1.5 windows, and with
  // nothing read the sender cannot pass two windows and one read.
  test.each([
    { window: WINDOW, total: 1024 * 1024 },
    { window: 256, total: 8192 },
  ])("a sender with $total bytes stops at a $window-byte window until the stream is read", async ({ window, total }) => {
    const payload = pattern(total);
    const piece = Math.min(READ_PIECE, window);
    const shape = { ...serverReadsBidi, serverParams: { initialMaxStreamDataBidiRemote: window } };
    await using pair = await open(shape, payload);
    const { sender, receiver } = pair;

    const blocked = Promise.withResolvers<number>();
    sender.onblocked = () => {
      const sent = Number(sender.stats.bytesSent);
      if (sent > window * 1.5) blocked.resolve(sent);
    };
    sender.closed.then(() => blocked.resolve(Number(sender.stats.bytesSent)), blocked.reject);

    expect(await blocked.promise).toBeLessThanOrEqual(2 * window + piece);
    expect(queued(receiver)).toBeLessThanOrEqual(window + piece);

    expect(await delivered(receiver, payload)).toEqual({ length: total, same: true });
    await Promise.all([sender.closed, receiver.closed]);
    expect(queued(receiver)).toBeLessThanOrEqual(window + piece);
  });

  describe("a stream that is closed while lsquic holds the end of its body", () => {
    test("is read in full after the peer closed the session", async () => {
      await using pair = await open(serverReadsBidi, body);
      await pair.sender.closed;
      await pair.arrived();
      pair.client.close();
      await pair.serverSession.closed;
      expect(await delivered(pair.receiver, body)).toEqual({ length: BODY, same: true });
    });

    test.each(["resetStream", "stopSending"])("is read in full after %s()", async method => {
      await using pair = await open(serverReadsBidi, body);
      await pair.sender.closed;
      await pair.arrived();
      pair.receiver[method]();
      expect(await delivered(pair.receiver, body)).toEqual({ length: BODY, same: true });
    });

    test("is read in full after its own session closed", async () => {
      await using pair = await open(serverReadsBidi, body);
      await pair.sender.closed;
      await pair.arrived();
      await pair.serverSession.close();
      expect(await delivered(pair.receiver, body)).toEqual({ length: BODY, same: true });
    });

    // Nothing tells bun that lsquic is about to drop a connection that timed
    // out, so the bytes that lsquic held are lost. The reader must learn that.
    test("ends with ERR_QUIC_STREAM_ABORTED after the session timed out", async () => {
      await using pair = await open(serverReadsBidi, body, 1);
      await pair.sender.closed;
      await pair.arrived();
      await pair.serverSession.closed.catch(() => {});

      const chunks: Uint8Array[] = [];
      let error: any;
      try {
        for await (const batch of pair.receiver) chunks.push(...batch);
      } catch (e) {
        error = e;
      }
      const got = Buffer.concat(chunks);
      expect(error?.code).toBe("ERR_QUIC_STREAM_ABORTED");
      expect(got.length).toBeGreaterThan(WINDOW);
      expect(got.length).toBeLessThanOrEqual(WINDOW + READ_PIECE);
      expect(got.equals(body.subarray(0, got.length))).toBe(true);
    });
  });
});
