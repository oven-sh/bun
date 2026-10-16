// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { createPrivateKey, randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";
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

describe("resetStream() on a stream that cannot take a RESET_STREAM", () => {
  const decode = (payload: Uint8Array) => new TextDecoder().decode(payload);
  const encode = (text: string) => new TextEncoder().encode(text);
  const get = { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" };
  const post = { ...get, ":method": "POST" };
  // A sanitizer build under load needs more than the 10 s default for the
  // handshake. lsquic's server cap is a little over 16 s.
  const budget = { handshakeTimeout: 15_000, transportParams: { maxIdleTimeout: 30 } };

  // A UDP relay in front of `server`. Each filter sees the datagrams of one
  // direction and returns false to drop one.
  async function relayTo(
    server: QuicEndpoint,
    filter: { toServer?: (msg: Buffer) => boolean; toClient?: (msg: Buffer) => boolean },
  ) {
    const relay = createSocket("udp4");
    await new Promise<void>(resolve => relay.bind(0, "127.0.0.1", resolve));
    let upstream: ReturnType<typeof createSocket> | undefined;
    relay.on("message", (msg, from) => {
      if (!upstream) {
        upstream = createSocket("udp4");
        upstream.on("message", back => {
          if (filter.toClient?.(back) ?? true) relay.send(back, from.port, "127.0.0.1");
        });
      }
      if (filter.toServer?.(msg) ?? true) upstream.send(msg, server.address!.port, "127.0.0.1");
    });
    return {
      // A plain { address, port }, which connect() takes and its types do not.
      address: { address: "127.0.0.1", port: relay.address().port } as any,
      [Symbol.dispose]() {
        upstream?.close();
        relay.close();
      },
    };
  }

  // A response that arrives with a gap leaves the stream alive with the
  // peer's FIN received. The client's FIN is acknowledged, so ending the read
  // side finishes the stream, and lsquic frees it in the next engine pass. A
  // RESET_STREAM queued on it then left a frame record pointing at freed
  // memory (heap-use-after-free in lsquic_stream_acked). A debug build
  // aborts on lsquic's own assertion instead.
  //
  // One at a time: a debug build spends most of each run loading node:quic in
  // the new process, and three at once get close to the default timeout.
  describe("after lsquic finished the stream", () => {
    test.each([
      ["stopSending() then resetStream()", "gap-stop-reset"],
      ["destroy() alone on a request with a body", "gap-destroy"],
      ["stopSending() then resetStream() after the peer's STOP_SENDING", "ss-finished"],
    ])("%s", async (_, mode) => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          join(import.meta.dir, "quic-stream-reset-fixture.ts"),
          mode,
          join(keysDir, "agent1-key.pem"),
          join(keysDir, "agent1-cert.pem"),
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr.match(/Assertion .*failed|AddressSanitizer: \S+/)?.[0] ?? "clean").toBe("clean");
      expect(stdout.trim()).toBe("done");
      expect(exitCode).toBe(0);
    });
  });

  // The same gap, but resetStream() alone. It sends nothing, and it still
  // ends the read side the peer has finished, so the stream closes without
  // the missing packet. Passes without the fix: it keeps the rule in the next
  // test from leaving this stream open.
  test.concurrent("with the peer's FIN behind a gap: resetStream() alone closes the stream", async () => {
    const serverSide = Promise.withResolvers<{ session: any; stream: any }>();
    const serverGone = Promise.withResolvers<void>();
    await using server = await listen(
      async session => {
        session.ondatagram = (payload: Uint8Array) => {
          if (decode(payload) === "ping") session.sendDatagram("pong").catch(() => {});
        };
        session.onstream = (stream: any) => {
          stream.closed.catch(() => {});
          serverSide.resolve({ session, stream });
        };
        await session.closed.catch(() => {});
        serverGone.resolve();
      },
      { sni: { "*": { keys: [key], certs: [cert] } }, ...budget },
    );

    // The relay drops the padded response headers, and every retransmission
    // of them. Only those are this large. Random bytes keep QPACK from
    // compressing the pad away.
    let dropBig = false;
    const headersDropped = Promise.withResolvers<void>();
    using relay = await relayTo(server, {
      toClient: msg => {
        if (!dropBig || msg.length <= 450) return true;
        headersDropped.resolve();
        return false;
      },
    });

    const pong = Promise.withResolvers<void>();
    const cancelled = Promise.withResolvers<void>();
    let stream: any;
    const client = await connect(relay.address, {
      servername: "localhost",
      verifyPeer: "manual",
      ...budget,
      ondatagram(payload: Uint8Array) {
        const text = decode(payload);
        if (text === "pong") return pong.resolve();
        if (text !== "cancel") return;
        stream.resetStream(5n);
        cancelled.resolve();
      },
    } as SessionOptions);
    client.closed.catch(() => {});
    await client.opened;

    stream = await client.createBidirectionalStream({ headers: get });
    const closed = stream.closed.catch(() => {});
    const { session: serverSession, stream: serverStream } = await serverSide.promise;
    // The server acknowledges the request before it answers the datagram.
    await client.sendDatagram("ping");
    await pong.promise;

    dropBig = true;
    serverStream.sendHeaders({ ":status": "200", "x-pad": randomBytes(768).toString("base64") });
    await headersDropped.promise;
    serverStream.writer.writeSync(encode("answer"));
    serverStream.writer.endSync();
    // One datagram behind the FIN packet: its arrival proves the client
    // processed the FIN.
    await serverSession.sendDatagram("cancel");
    await cancelled.promise;

    await closed;
    const destroyed = stream.destroyed;
    client.close();
    await serverGone.promise;
    expect(destroyed).toBe(true);
  });

  // RFC 9000 section 3.3: a sender must not send RESET_STREAM once the peer
  // has acknowledged every byte and the FIN ("Data Recvd"). ngtcp2, which
  // node uses, returns early there as well.
  test.concurrent("after the peer acknowledged the FIN: the peer is told to stop and gets no reset", async () => {
    const serverStreamReady = Promise.withResolvers<any>();
    const serverGone = Promise.withResolvers<void>();
    const resets: string[] = [];
    await using server = await listen(
      async session => {
        session.ondatagram = (payload: Uint8Array) => {
          if (decode(payload) === "ping") session.sendDatagram("pong").catch(() => {});
        };
        session.onstream = (stream: any) => {
          stream.onreset = (error: any) => resets.push(String(error?.message ?? error));
          serverStreamReady.resolve(stream);
        };
        await session.closed.catch(() => {});
        serverGone.resolve();
      },
      { sni: { "*": { keys: [key], certs: [cert] } }, ...budget },
    );

    let stream: any;
    const client = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      ...budget,
      ondatagram(payload: Uint8Array) {
        if (decode(payload) !== "pong") return;
        // The server acknowledged the request before it answered. Session
        // callbacks run inside the endpoint's send scope, so both calls
        // reach lsquic before it runs a pass: what node's destroy() does.
        stream.stopSending(5n);
        stream.resetStream(5n);
      },
    } as SessionOptions);
    client.closed.catch(() => {});
    await client.opened;

    // A headers-only GET: the client's send side carries a FIN.
    stream = await client.createBidirectionalStream({ headers: get });
    stream.closed.catch(() => {});
    const serverStream = await serverStreamReady.promise;
    await client.sendDatagram("ping");

    const outcome = await serverStream.closed.then(
      () => "stopped",
      (error: any) => String(error?.message ?? error),
    );
    client.close();
    await serverGone.promise;
    expect({ outcome, resets }).toEqual({ outcome: "stopped", resets: [] });
  });

  // stopSending() on a stream whose send side is done has to schedule a pass
  // of its own: nothing else makes the connection tickable, and the frame
  // used to wait for an unrelated alarm. Passes without the fix in the shim:
  // the line it covers is in the lsquic patch.
  test.concurrent("stopSending() alone puts its STOP_SENDING on the wire at once", async () => {
    const gotMarker = Promise.withResolvers<void>();
    const serverGone = Promise.withResolvers<void>();
    await using server = await listen(
      async session => {
        session.ondatagram = (payload: Uint8Array) => {
          if (payload.length > 200) gotMarker.resolve();
          else if (decode(payload) === "ping") session.sendDatagram("pong").catch(() => {});
        };
        session.onstream = (stream: any) => {
          stream.closed.catch(() => {});
        };
        await session.closed.catch(() => {});
        serverGone.resolve();
      },
      { sni: { "*": { keys: [key], certs: [cert] } }, ...budget },
    );

    // Sizes of the client's datagrams, from the call on.
    const sizes: number[] = [];
    let stopping = false;
    using relay = await relayTo(server, {
      toServer: msg => {
        if (stopping) sizes.push(msg.length);
        return true;
      },
    });

    const pong = Promise.withResolvers<void>();
    const client = await connect(relay.address, {
      servername: "localhost",
      verifyPeer: "manual",
      ...budget,
      ondatagram(payload: Uint8Array) {
        if (decode(payload) === "pong") pong.resolve();
      },
    } as SessionOptions);
    client.closed.catch(() => {});
    await client.opened;

    const stream: any = await client.createBidirectionalStream({ headers: get });
    stream.closed.catch(() => {});
    // The server acknowledges the request before it answers the datagram.
    await client.sendDatagram("ping");
    await pong.promise;

    // A turn of its own: inside a session callback the endpoint batches what
    // the calls send, whether or not stopSending() schedules a pass.
    await new Promise(resolve => setImmediate(resolve));
    stopping = true;
    stream.stopSending(5n);
    // A large datagram. Without a pass of its own the STOP_SENDING shares
    // this packet, the first one the relay sees.
    await client.sendDatagram(Buffer.alloc(300, "m").toString());
    await gotMarker.promise;

    client.close();
    await serverGone.promise;
    expect(sizes[0]).toBeLessThan(200);
  });

  // RFC 9000 section 3.5: when data is declared lost after the peer's
  // STOP_SENDING, the endpoint sends RESET_STREAM instead of retransmitting
  // it. lsquic drops those frames without an acknowledgement, which leaves
  // nothing unacknowledged. That state is not "Data Recvd". Passes without
  // the fix: it keeps the rule above from swallowing this reset.
  test.concurrent("after STOP_SENDING made lsquic drop unacknowledged data: still sends RESET_STREAM", async () => {
    const serverStreamReady = Promise.withResolvers<any>();
    const gotAfter = Promise.withResolvers<void>();
    const serverGone = Promise.withResolvers<void>();
    const resets: string[] = [];
    await using server = await listen(
      async session => {
        session.ondatagram = (payload: Uint8Array) => {
          if (decode(payload) === "after") gotAfter.resolve();
        };
        session.onstream = (stream: any) => {
          stream.closed.catch(() => {});
          stream.onreset = (error: any) => resets.push(String(error?.message ?? error));
          serverStreamReady.resolve(stream);
        };
        await session.closed.catch(() => {});
        serverGone.resolve();
      },
      { sni: { "*": { keys: [key], certs: [cert] } }, ...budget },
    );

    // The relay drops the packet with the request body, and every
    // retransmission of it. Only those are this large.
    let dropBig = false;
    using relay = await relayTo(server, { toServer: msg => !(dropBig && msg.length > 600) });

    const client = await connect(relay.address, {
      servername: "localhost",
      verifyPeer: "manual",
      ...budget,
    } as SessionOptions);
    client.closed.catch(() => {});
    await client.opened;

    const stream: any = await client.createBidirectionalStream({});
    stream.closed.catch(() => {});
    stream.sendHeaders(post);
    const serverStream = await serverStreamReady.promise;

    const stats: any = client.stats;
    const lostBefore = stats.pktLost;
    dropBig = true;
    stream.writer.writeSync(randomBytes(900));
    stream.writer.endSync();
    serverStream.stopSending(3n);

    // lsquic drops the lost packet's frames in the pass that declares the
    // loss. From then on nothing is unacknowledged.
    while (stats.pktLost === lostBefore) await new Promise(resolve => setImmediate(resolve));

    stream.resetStream(7n);

    // The RESET_STREAM leaves before this datagram and arrives first.
    dropBig = false;
    await client.sendDatagram("after");
    await gotAfter.promise;
    // The read side is still open, and a graceful close waits for it.
    stream.destroy();
    client.close();
    await serverGone.promise;
    expect(resets).toHaveLength(1);
  });

  // RFC 9000 section 19.4: a RESET_STREAM for a stream the peer only sends
  // on is a STREAM_STATE_ERROR, and the peer closes the connection.
  test.concurrent("on a receive-only stream: the session stays open", async () => {
    const remote = Promise.withResolvers<any>();
    const answer = Promise.withResolvers<string>();
    let serverSession: any;
    await using server = await listen(
      async session => {
        serverSession = session;
        session.onerror = () => {};
        session.ondatagram = (payload: Uint8Array) => {
          if (decode(payload) === "pong") answer.resolve("pong");
        };
        session.onstream = (stream: any) => {
          stream.closed.catch(() => {});
          remote.resolve(stream);
        };
        await session.closed.catch(() => {});
        answer.resolve("session closed");
      },
      { alpn: ["quic-test"], sni: { "*": { keys: [key], certs: [cert] } }, ...budget },
    );

    const client: any = await connect(server.address!, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      ...budget,
      onerror() {},
      ondatagram(payload: Uint8Array) {
        if (decode(payload) === "ping") client.sendDatagram("pong").catch(() => {});
      },
    } as SessionOptions);
    client.closed.catch(() => {});
    await client.opened;

    const stream = await client.createUnidirectionalStream();
    stream.closed.catch(() => {});
    stream.writer.writeSync(encode("hello"));

    (await remote.promise).resetStream(7n);

    // The client answers only if the connection survived what the call put
    // on the wire before this datagram.
    await serverSession.sendDatagram("ping");
    const answered = await answer.promise;
    client.close();
    expect(answered).toBe("pong");
  });
});
