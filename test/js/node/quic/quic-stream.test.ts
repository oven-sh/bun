// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { describe, expect, test } from "bun:test";
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { open } from "node:fs/promises";
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

// A unidirectional stream that the peer opened has no send side. RFC 9000
// sections 19.4 and 19.8: an endpoint that gets a RESET_STREAM or a STREAM
// frame for a stream it only sends on closes the whole connection with
// STREAM_STATE_ERROR. Node sends neither.
describe("a unidirectional stream that the peer opened", () => {
  const encoder = new TextEncoder();
  const settled = (promise: Promise<unknown>) =>
    promise.then(
      () => "resolved",
      (err: any) => `rejected: ${err.code}` + (err.errorCode === undefined ? "" : ` ${err.errorCode}`),
    );
  async function readAll(stream: any) {
    let text = "";
    for await (const batch of stream) for (const chunk of batch) text += Buffer.from(chunk).toString("latin1");
    return text;
  }

  // Runs `work` on both ends of a new raw QUIC connection. The result is
  // "a session closed" if either end closes before `work` is done, so a
  // connection that the peer closed fails the assertion at once.
  async function onConnection<T>(work: (conn: { client: any; server: any }) => Promise<T>) {
    const sessionErrors: string[] = [];
    const accepted = Promise.withResolvers<any>();
    await using endpoint = await listen(
      (session: any) => {
        session.onerror = (err: any) => sessionErrors.push(`server: ${err.message}`);
        accepted.resolve(session);
      },
      { alpn: ["quic-test"], sni: { "*": { keys: [key], certs: [cert] } } },
    );
    const client: any = await connect(endpoint.address!, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      onerror(err: any) {
        sessionErrors.push(`client: ${err.message}`);
      },
    } as SessionOptions);
    const server = await accepted.promise;
    const died = Promise.race([settled(client.closed), settled(server.closed)]).then(() => "a session closed" as const);
    try {
      await Promise.all([client.opened, server.opened]);
      return { result: await Promise.race([work({ client, server }), died]), sessionErrors };
    } finally {
      // The endpoint closes once no session is left.
      client.destroy();
      server.destroy();
    }
  }

  // `sender` opens a unidirectional stream and writes the first half of a
  // message, so the stream is open when `onReceive` runs on the receiving end.
  // The receiver then opens a stream of its own, and the sender writes the
  // second half only when it sees that stream: every frame the call put on the
  // wire has reached the peer by then, and the peer accepted it.
  async function transfer(
    sender: any,
    receiver: any,
    onReceive: (stream: any) => unknown,
    afterRead?: (stream: any) => unknown,
  ) {
    const incoming = Promise.withResolvers<any>();
    receiver.onstream = incoming.resolve;
    const answered = Promise.withResolvers<void>();
    sender.onstream = (stream: any) => {
      stream.closed.catch(() => {});
      answered.resolve();
    };

    const out = await sender.createUnidirectionalStream();
    out.closed.catch(() => {});
    out.writer.writeSync(encoder.encode("part one, "));

    const stream = await incoming.promise;
    const closed = settled(stream.closed);
    let thrown = "nothing";
    try {
      onReceive(stream);
    } catch (err: any) {
      thrown = `${err.code}: ${err.message}`;
    }
    const received = readAll(stream).then(text => (afterRead?.(stream), text));

    const answer = await receiver.createUnidirectionalStream({ body: encoder.encode("go") });
    answer.closed.catch(() => {});
    await answered.promise;
    out.writer.writeSync(encoder.encode("part two"));
    out.writer.endSync();
    return { thrown, received: await received, closed: await closed };
  }
  const delivered = { received: "part one, part two", closed: "resolved" };
  const notWritable = "ERR_INVALID_STATE: Stream is not writable";

  describe.each([
    ["client", "server"],
    ["server", "client"],
  ] as const)("and the %s received", (receiver, sender) => {
    // [call, what it throws]. After each call every byte still arrives and
    // the stream closes without an error.
    test.each<[string, (stream: any) => unknown, string?]>([
      ["resetStream(7n) and resetStream() do nothing", stream => (stream.resetStream(7n), stream.resetStream())],
      ["setBody(bytes) is dropped", stream => stream.setBody(new Uint8Array(4096))],
      ["setBody(string) is dropped", stream => stream.setBody(Buffer.alloc(4096, "a").toString())],
      ["setBody(Blob) is dropped", stream => stream.setBody(new Blob([new Uint8Array(4096)]))],
      ["setBody(Promise of bytes) is dropped", stream => stream.setBody(Promise.resolve(new Uint8Array(4096)))],
      ["setOutbound(bytes) is dropped", stream => stream.setOutbound(new Uint8Array(4096))],
      // These three bodies need a streaming source. Node's Stream::InitStreaming refuses one.
      ["setBody(null) throws", stream => stream.setBody(null), notWritable],
      ["setBody(iterable) throws", stream => stream.setBody([new Uint8Array(4096)]), notWritable],
      ["setBody(async iterable) throws", stream => stream.setBody((async function* () {})()), notWritable],
    ])("%s", async (_, call, thrown = "nothing") => {
      const outcome = await onConnection(conn => transfer(conn[sender], conn[receiver], call));
      expect(outcome).toEqual({ result: { thrown, ...delivered }, sessionErrors: [] });
    });

    // lsquic has closed its stream by then, and `closed` is not settled yet.
    test("resetStream() after the last byte is read records no error", async () => {
      const outcome = await onConnection(conn =>
        transfer(
          conn[sender],
          conn[receiver],
          () => {},
          stream => stream.resetStream(9n),
        ),
      );
      expect(outcome).toEqual({ result: { thrown: "nothing", ...delivered }, sessionErrors: [] });
    });

    // Nothing reads a file that is the body of a receive-only stream.
    test.each<[string, (stream: any, file: any) => unknown]>([
      ["setBody(FileHandle)", (stream, file) => stream.setBody(file)],
      ["setBody(Promise of FileHandle)", (stream, file) => stream.setBody(Promise.resolve(file))],
    ])("%s closes the file and sends nothing", async (_, setBody) => {
      await using file = await open(join(keysDir, "agent1-cert.pem"));
      const outcome = await onConnection(conn =>
        transfer(conn[sender], conn[receiver], stream => setBody(stream, file)),
      );
      expect({ outcome, fd: file.fd }).toEqual({
        outcome: { result: { thrown: "nothing", ...delivered }, sessionErrors: [] },
        fd: -1,
      });
    });

    // `work` gets the receiving end of a stream the sender keeps open. The
    // session is still open afterwards if a new stream gets through.
    async function thenRoundTrip(conn: { client: any; server: any }, work: (stream: any) => Promise<unknown>) {
      const incoming = Promise.withResolvers<any>();
      conn[receiver].onstream = incoming.resolve;
      const answered = Promise.withResolvers<string>();
      conn[sender].onstream = (stream: any) => answered.resolve(readAll(stream));
      const out = await conn[sender].createUnidirectionalStream();
      out.closed.catch(() => {});
      out.writer.writeSync(encoder.encode("hello"));

      const result = await work(await incoming.promise);
      const answer = await conn[receiver].createUnidirectionalStream({ body: encoder.encode("still here") });
      answer.closed.catch(() => {});
      return { result, answer: await answered.promise };
    }

    // destroy() flushes a queued body and resets the stream when the flush
    // does not finish. With no body queued it does neither.
    test.each([4096, 8 * 1024 * 1024])("setBody(%i bytes) then destroy() keeps the session open", async size => {
      const outcome = await onConnection(conn =>
        thenRoundTrip(conn, stream => {
          const closed = settled(stream.closed);
          stream.setBody(new Uint8Array(size));
          stream.destroy();
          return closed;
        }),
      );
      expect(outcome).toEqual({ result: { result: "resolved", answer: "still here" }, sessionErrors: [] });
    });

    // The throw of a body that comes from a Promise has no caller to reach.
    test("setBody(Promise of null) destroys the stream with ERR_INVALID_STATE", async () => {
      const outcome = await onConnection(conn =>
        thenRoundTrip(conn, stream => {
          stream.setBody(Promise.resolve(null));
          return settled(stream.closed);
        }),
      );
      expect(outcome).toEqual({
        result: { result: "rejected: ERR_INVALID_STATE", answer: "still here" },
        sessionErrors: [],
      });
    });

    // stopSending() is valid on this stream, and the peer answers it with a
    // RESET_STREAM that carries its code. resetStream() must not replace it.
    test.each<[string, (stream: any) => void]>([
      ["stopSending(3n) then resetStream(7n)", stream => (stream.stopSending(3n), stream.resetStream(7n))],
      ["resetStream(7n) then stopSending(3n)", stream => (stream.resetStream(7n), stream.stopSending(3n))],
    ])("%s closes the stream with code 3", async (_, call) => {
      const outcome = await onConnection(conn =>
        thenRoundTrip(conn, stream => {
          const closed = settled(stream.closed);
          call(stream);
          return closed;
        }),
      );
      expect(outcome).toEqual({
        result: { result: "rejected: ERR_QUIC_APPLICATION_ERROR 3", answer: "still here" },
        sessionErrors: [],
      });
    });

    // The half the other end has still works: the sender resets the stream
    // and the receiver gets the code.
    test("resetStream() by the sender resets it", async () => {
      const outcome = await onConnection(async conn => {
        const incoming = Promise.withResolvers<any>();
        conn[receiver].onstream = incoming.resolve;
        const out = await conn[sender].createUnidirectionalStream();
        out.closed.catch(() => {});
        out.writer.writeSync(encoder.encode("hello"));

        const stream = await incoming.promise;
        const reset = Promise.withResolvers<string>();
        stream.onreset = (err: any) => reset.resolve(`${err.code} ${err.errorCode}`);
        const closed = settled(stream.closed);
        out.resetStream(5n);
        return { reset: await reset.promise, closed: await closed };
      });
      expect(outcome).toEqual({
        result: { reset: "ERR_QUIC_APPLICATION_ERROR 5", closed: "rejected: ERR_QUIC_APPLICATION_ERROR 5" },
        sessionErrors: [],
      });
    });
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
