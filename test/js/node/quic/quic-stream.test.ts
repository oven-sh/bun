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

// A stream still open when its connection dies takes the connection's close
// error, as Node does: `closed` rejects with it and a read that never got a
// FIN rejects instead of ending as if the stream were complete.
describe("a stream left open when the connection closes", () => {
  const alpn = "quic-test";

  // One server session with one accepted stream, and the client session and
  // stream on the other side. The client wrote one byte so the server sees
  // the stream.
  async function openPair() {
    const accepted: { session: any; stream: any }[] = [];
    const waiters: ((pair: { session: any; stream: any }) => void)[] = [];
    const server = await listen(
      (session: any) => {
        session.closed.catch(() => {});
        session.onstream = (stream: any) => {
          stream.closed.catch(() => {});
          const pair = { session, stream };
          const waiter = waiters.shift();
          if (waiter) waiter(pair);
          else accepted.push(pair);
        };
      },
      { sni: { "*": { keys: [key], certs: [cert] } }, alpn, transportParams: { maxIdleTimeout: 1 } },
    );
    const client = await connect(server.address!, {
      alpn,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    } as SessionOptions);
    await client.opened;
    // Opens a client stream, writes one byte, and returns its server side.
    async function open(direction: "bidi" | "uni" = "bidi") {
      const stream =
        direction === "uni" ? await client.createUnidirectionalStream() : await client.createBidirectionalStream();
      stream.closed.catch(() => {});
      stream.writer.writeSync(Uint8Array.of(1));
      const peer = accepted.shift() ?? (await new Promise<{ session: any; stream: any }>(r => waiters.push(r)));
      return { stream, peer };
    }
    const { stream, peer } = await open();
    return { server, client, stream, peer, open };
  }

  const settle = (p: Promise<unknown>) =>
    p.then(
      () => "resolved",
      (e: any) => `rejected ${e.code}${e.errorCode !== undefined ? ` ${e.errorCode}` : ""}`,
    );
  const settleRead = (p: Promise<IteratorResult<unknown>>) =>
    p.then(
      r => (r.done ? "ended cleanly" : "returned data"),
      (e: any) => `rejected ${e.code}`,
    );

  test("a pending read with no data rejects with the connection's application error", async () => {
    const { server, client, stream, peer } = await openPair();
    await using _server = server;
    const read = settleRead(stream[Symbol.asyncIterator]().next());
    const streamClosed = settle(stream.closed);
    const sessionClosed = settle(client.closed);

    peer.session.destroy(undefined, { code: 2n, type: "application", reason: "go away" });

    expect({ read: await read, streamClosed: await streamClosed, sessionClosed: await sessionClosed }).toEqual({
      read: "rejected ERR_QUIC_APPLICATION_ERROR",
      streamClosed: "rejected ERR_QUIC_APPLICATION_ERROR 2",
      sessionClosed: "rejected ERR_QUIC_APPLICATION_ERROR 2",
    });
    expect(stream.destroyed).toBe(true);
  });

  test("a pending read after data rejects, and closed carries the connection's error", async () => {
    const { server, client, stream, peer } = await openPair();
    await using _server = server;
    const iterator = stream[Symbol.asyncIterator]();
    peer.stream.writer.writeSync(Uint8Array.of(2, 3));
    const first = await iterator.next();
    const read = settleRead(iterator.next());
    const streamClosed = settle(stream.closed);
    client.closed.catch(() => {});

    peer.session.destroy(undefined, { code: 2n, type: "application" });

    // The closing peer fails its writer, which sends RESET_STREAM before the
    // CONNECTION_CLOSE (Node's writer does the same), so the read reports
    // the reset. The close carries the connection's error.
    expect({ first: first.done, read: await read, streamClosed: await streamClosed }).toEqual({
      first: false,
      read: "rejected ERR_QUIC_STREAM_RESET",
      streamClosed: "rejected ERR_QUIC_APPLICATION_ERROR 2",
    });
  });

  test("a body received before the connection error is still delivered", async () => {
    const { server, client, stream, peer } = await openPair();
    await using _server = server;
    const streamClosed = settle(stream.closed);
    client.closed.catch(() => {});
    // The peer finishes its side of the stream. The client has not read yet.
    peer.stream.writer.writeSync(Uint8Array.of(2, 3));
    peer.stream.writer.writeSync(Uint8Array.of(4, 5));
    peer.stream.writer.endSync();
    const serverClosed = settle(peer.stream.closed);
    // Wait until the body (the FIN rides on its last frame) reached the
    // client before the peer dies.
    while (stream.stats.bytesReceived < 4n) await new Promise(r => setImmediate(r));

    peer.session.destroy(undefined, { code: 2n, type: "application" });
    await streamClosed;

    const chunks: number[] = [];
    let end = "not reached";
    try {
      for await (const batch of stream) for (const chunk of batch) chunks.push(...chunk);
      end = "ended cleanly";
    } catch (e: any) {
      end = `rejected ${e.code}`;
    }
    expect({ chunks, end, streamClosed: await streamClosed }).toEqual({
      chunks: [2, 3, 4, 5],
      end: "ended cleanly",
      streamClosed: "rejected ERR_QUIC_APPLICATION_ERROR 2",
    });
    expect(await serverClosed).toBe("resolved");
  });

  test("the stream's closed rejects without an onerror call, as in Node", async () => {
    const { server, client, stream, peer } = await openPair();
    await using _server = server;
    let onerrorCalls = 0;
    stream.onerror = () => onerrorCalls++;
    const streamClosed = settle(stream.closed);
    client.closed.catch(() => {});

    peer.session.destroy(undefined, { code: 7n, type: "application" });

    // A destroy(error) calls onerror before it settles closed, so by now a
    // call would have happened.
    expect({ streamClosed: await streamClosed, onerrorCalls }).toEqual({
      streamClosed: "rejected ERR_QUIC_APPLICATION_ERROR 7",
      onerrorCalls: 0,
    });
  });

  test("a transport error on the connection reaches the stream", async () => {
    const { server, client, stream, peer } = await openPair();
    await using _server = server;
    const read = settleRead(stream[Symbol.asyncIterator]().next());
    const streamClosed = settle(stream.closed);
    const sessionClosed = settle(client.closed);

    peer.session.destroy(undefined, { code: 5n, type: "transport" });

    expect({ read: await read, streamClosed: await streamClosed, sessionClosed: await sessionClosed }).toEqual({
      read: "rejected ERR_QUIC_TRANSPORT_ERROR",
      streamClosed: "rejected ERR_QUIC_TRANSPORT_ERROR 5",
      sessionClosed: "rejected ERR_QUIC_TRANSPORT_ERROR 5",
    });
  });

  test("a clean connection close still resolves closed", async () => {
    const { server, client, stream, peer } = await openPair();
    await using _server = server;
    const read = settleRead(stream[Symbol.asyncIterator]().next());
    const streamClosed = settle(stream.closed);
    const sessionClosed = settle(client.closed);

    peer.session.destroy(undefined, { code: 0n });

    // lsquic resets every open bidirectional stream with code 0 before it
    // sends CONNECTION_CLOSE, so the truncated read reports that reset.
    expect({ read: await read, streamClosed: await streamClosed, sessionClosed: await sessionClosed }).toEqual({
      read: "rejected ERR_QUIC_STREAM_RESET",
      streamClosed: "resolved",
      sessionClosed: "resolved",
    });
  });

  test("the server side sees the client's connection error on its open stream", async () => {
    const { server, client, stream, peer } = await openPair();
    await using _server = server;
    client.closed.catch(() => {});
    // The server already holds the byte the client wrote; take it first so
    // the next read is the pending one.
    const iterator = peer.stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    const read = settleRead(iterator.next());
    const streamClosed = settle(peer.stream.closed);

    client.destroy(undefined, { code: 3n, type: "application" });

    // As above: the closing client's writer sends RESET_STREAM first.
    expect({ first: first.done, read: await read, streamClosed: await streamClosed }).toEqual({
      first: false,
      read: "rejected ERR_QUIC_STREAM_RESET",
      streamClosed: "rejected ERR_QUIC_APPLICATION_ERROR 3",
    });
  });

  test("a locally reset write side does not hide the connection's error", async () => {
    const { server, client, stream, peer } = await openPair();
    await using _server = server;
    stream.resetStream(3n);
    const read = settleRead(stream[Symbol.asyncIterator]().next());
    const streamClosed = settle(stream.closed);
    client.closed.catch(() => {});

    peer.session.destroy(undefined, { code: 2n, type: "application" });

    expect({ read: await read, streamClosed: await streamClosed }).toEqual({
      read: "rejected ERR_QUIC_APPLICATION_ERROR",
      streamClosed: "rejected ERR_QUIC_APPLICATION_ERROR 2",
    });
  });

  test("every open stream gets the error in the same turn as the session", async () => {
    const { server, client, stream: s1, peer, open } = await openPair();
    await using _server = server;
    const { stream: s2, peer: peer2 } = await open();
    const { stream: s3 } = await open();
    // s2 completes in both directions before the connection dies.
    peer2.stream.writer.endSync();
    s2.writer.endSync();
    for await (const _ of s2) {
    }
    await s2.closed;

    const read1 = settleRead(s1[Symbol.asyncIterator]().next());
    let tick = 0;
    const ticks: Record<string, number> = {};
    const mark = (name: string) => (outcome: string) => {
      ticks[name] = tick;
      return outcome;
    };
    const results = Promise.all([
      settle(s1.closed).then(mark("s1")),
      settle(s3.closed).then(mark("s3")),
      settle(client.closed).then(mark("session")),
    ]);
    const bump = () => {
      tick++;
      timer = setImmediate(bump);
    };
    let timer = setImmediate(bump);

    peer.session.destroy(undefined, { code: 2n, type: "application" });

    const [s1Closed, s3Closed, sessionClosed] = await results;
    clearImmediate(timer);
    expect({ read1: await read1, s1Closed, s3Closed, sessionClosed }).toEqual({
      read1: "rejected ERR_QUIC_APPLICATION_ERROR",
      s1Closed: "rejected ERR_QUIC_APPLICATION_ERROR 2",
      s3Closed: "rejected ERR_QUIC_APPLICATION_ERROR 2",
      sessionClosed: "rejected ERR_QUIC_APPLICATION_ERROR 2",
    });
    expect(ticks).toEqual({ s1: ticks.session, s3: ticks.session, session: ticks.session });
  });

  test("a write-only stream the peer stops closes with the peer's code while the connection lives", async () => {
    const { server, client, open } = await openPair();
    await using _server = server;
    const { stream: uni, peer } = await open("uni");
    const closed = settle(uni.closed);

    // The peer discards its end of the stream. Its STOP_SENDING ends our
    // write side, so the stream closes once the reset is acknowledged
    // instead of living until the connection dies.
    peer.stream.destroy(new Error("not wanted"));

    expect(await closed).toBe("rejected ERR_QUIC_APPLICATION_ERROR 1");
    // The connection is still usable: a new stream reaches the peer.
    const { peer: next } = await open("bidi");
    expect(next.session).toBe(peer.session);
    client.close();
  });

  test("an iterator taken after the connection error rethrows it", async () => {
    const { server, client, stream, peer } = await openPair();
    await using _server = server;
    const streamClosed = settle(stream.closed);
    client.closed.catch(() => {});

    peer.session.destroy(undefined, { code: 2n, type: "application" });
    expect(await streamClosed).toBe("rejected ERR_QUIC_APPLICATION_ERROR 2");

    expect(await settleRead(stream[Symbol.asyncIterator]().next())).toBe("rejected ERR_QUIC_APPLICATION_ERROR");
  });

  test("iterating a write-only stream after the connection error ends without an error", async () => {
    const { server, client, peer, open } = await openPair();
    await using _server = server;
    const { stream: uni } = await open("uni");
    const closed = settle(uni.closed);
    client.closed.catch(() => {});

    peer.session.destroy(undefined, { code: 2n, type: "application" });
    expect(await closed).toBe("rejected ERR_QUIC_APPLICATION_ERROR 2");

    // There is no read side to truncate, so the iterator just finishes.
    expect(await settleRead(uni[Symbol.asyncIterator]().next())).toBe("ended cleanly");
  });

  test("stream.destroy(error) with a pending read rejects the read with that error", async () => {
    const { server, client, stream } = await openPair();
    await using _server = server;
    const read = stream[Symbol.asyncIterator]()
      .next()
      .then(
        () => "ended",
        (e: any) => e.message,
      );

    stream.destroy(new Error("local abort"));
    expect(await read).toBe("local abort");
    client.close();
  });
});
