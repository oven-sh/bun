// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

// stream.opened (Node v26.10.0) and stream.onstopsending (Node v26.7.0).
// https://github.com/oven-sh/bun/issues/45501
describe("QuicStream.opened", () => {
  const serverOptions = {
    sni: { "*": { keys: [key], certs: [cert] } },
    alpn: "quic-test",
    transportParams: { maxIdleTimeout: 1, initialMaxStreamsBidi: 1 },
  };
  const clientOptions = {
    alpn: "quic-test",
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: 1 },
  } as SessionOptions;

  // The server echoes FIN so that the first stream fully closes and the
  // peer grants a new MAX_STREAMS credit for the second one.
  async function startServer() {
    return await listen(async serverSession => {
      serverSession.onstream = async (stream: any) => {
        stream.closed.catch(() => {});
        for await (const _ of stream) {
        }
        stream.writer.endSync();
      };
      await serverSession.closed.catch(() => {});
    }, serverOptions);
  }

  test("is fulfilled for a stream that had stream credit", async () => {
    await using server = await startServer();
    const client = await connect(server.address!, clientOptions);
    await client.opened;
    const stream = await client.createBidirectionalStream();
    stream.closed.catch(() => {});
    expect(stream.pending).toBe(false);
    expect(stream.opened).toBeInstanceOf(Promise);
    expect(stream.opened).toBe(stream.opened);
    await expect(stream.opened).resolves.toBeUndefined();
    client.close();
  });

  test("is fulfilled once a pending stream gets its ID", async () => {
    await using server = await startServer();
    const client = await connect(server.address!, clientOptions);
    await client.opened;
    const first = await client.createBidirectionalStream();
    first.closed.catch(() => {});
    const second = await client.createBidirectionalStream();
    second.closed.catch(() => {});
    expect(second.pending).toBe(true);
    expect(second.id).toBeNull();
    const opened = second.opened.then(() => ({ pending: second.pending, id: second.id }));

    // Close the first stream in both directions so the server grants credit.
    first.writer.writeSync(Uint8Array.of(1));
    first.writer.endSync();
    for await (const _ of first) {
    }
    await first.closed;

    expect(await opened).toEqual({ pending: false, id: 4n });
    client.close();
  });

  test("rejects when a pending stream is destroyed before it opens", async () => {
    await using server = await startServer();
    const client = await connect(server.address!, clientOptions);
    await client.opened;
    const first = await client.createBidirectionalStream();
    first.closed.catch(() => {});
    const awaited = await client.createBidirectionalStream();
    awaited.closed.catch(() => {});
    const readLater = await client.createBidirectionalStream();
    readLater.closed.catch(() => {});
    expect(awaited.pending).toBe(true);
    expect(readLater.pending).toBe(true);

    const opened = awaited.opened;
    awaited.destroy(new Error("destroyed while pending"));
    await expect(opened).rejects.toThrow("destroyed while pending");

    // `opened` read for the first time after the destroy settles the same way.
    readLater.destroy(new Error("destroyed before read"));
    await expect(readLater.opened).rejects.toThrow("destroyed before read");

    // A stream that did open stays fulfilled after a destroy with an error.
    first.destroy(new Error("after open"));
    await expect(first.opened).resolves.toBeUndefined();
    client.close();
  });
});

describe("QuicStream.onstopsending", () => {
  test("is called with the peer's application error when STOP_SENDING arrives", async () => {
    const accepted = Promise.withResolvers<any>();
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.closed.catch(() => {});
          accepted.resolve(stream);
        };
        await serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        alpn: "quic-test",
        transportParams: { maxIdleTimeout: 1 },
      },
    );
    const client = await connect(server.address!, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    } as SessionOptions);
    await client.opened;

    const stream = await client.createBidirectionalStream();
    stream.closed.catch(() => {});
    expect(() => {
      (stream as any).onstopsending = 1;
    }).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));

    const stopped = Promise.withResolvers<{ sameStream: boolean; error: any }>();
    (stream as any).onstopsending = function (this: any, error: any) {
      stopped.resolve({ sameStream: this === stream, error });
    };
    expect(typeof (stream as any).onstopsending).toBe("function");

    stream.writer.writeSync(Uint8Array.of(1));
    const remote = await accepted.promise;
    remote.stopSending(42n);

    const { sameStream, error } = await stopped.promise;
    expect(sameStream).toBe(true);
    expect(error).toMatchObject({ code: "ERR_QUIC_APPLICATION_ERROR", errorCode: 42n });
    // The writer is errored with the same error (Node's writer does this).
    expect(stream.writer.desiredSize).toBeNull();
    await expect(stream.writer.write(Uint8Array.of(2))).rejects.toBe(error);
    client.close();
  });

  // lsquic applies a STOP_SENDING that opens a stream before it announces the
  // stream, so the native side has to report it from the announce path.
  test("is called when STOP_SENDING is the first frame of a peer-opened stream", async () => {
    const stopped = Promise.withResolvers<{ before: number | null; error: any; after: number | null }>();
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.closed.catch(() => {});
          const before = stream.writer.desiredSize;
          stream.onstopsending = (error: any) => {
            stopped.resolve({ before, error, after: stream.writer.desiredSize });
          };
        };
        await serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        alpn: "quic-test",
        transportParams: { maxIdleTimeout: 1 },
      },
    );
    const client = await connect(server.address!, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    } as SessionOptions);
    await client.opened;

    const stream = await client.createBidirectionalStream();
    stream.closed.catch(() => {});
    stream.stopSending(11n);

    const { before, error, after } = await stopped.promise;
    expect(before).toBeGreaterThan(0);
    expect(error).toMatchObject({ code: "ERR_QUIC_APPLICATION_ERROR", errorCode: 11n });
    expect(after).toBeNull();
    client.close();
  });

  // The writer marks `closed` handled when it fails. The STOP_SENDING path
  // errors the writer first, so it has to do the same, or a peer reset on a
  // stream with a handler turns into an unhandled rejection.
  test("does not leave an unhandled closed rejection when the peer then resets the stream", async () => {
    using dir = tempDir("quic-onstopsending", {
      "main.mjs": `
        import { listen, connect } from "node:quic";
        import { createPrivateKey } from "node:crypto";
        import { readFileSync } from "node:fs";
        const key = createPrivateKey(readFileSync(${JSON.stringify(join(keysDir, "agent1-key.pem"))}));
        const cert = readFileSync(${JSON.stringify(join(keysDir, "agent1-cert.pem"))});
        process.on("unhandledRejection", e => {
          console.log("unhandledRejection " + e.code);
          process.exit(1);
        });
        const accepted = Promise.withResolvers();
        const server = await listen(
          session => {
            session.closed.catch(() => {});
            session.onstream = stream => {
              stream.closed.catch(() => {});
              accepted.resolve(stream);
            };
          },
          { sni: { "*": { keys: [key], certs: [cert] } }, alpn: "quic-test" },
        );
        const client = await connect(server.address, { alpn: "quic-test", servername: "localhost", verifyPeer: "manual" });
        client.closed.catch(() => {});
        await client.opened;
        const stream = await client.createBidirectionalStream();
        const stopped = Promise.withResolvers();
        stream.onstopsending = () => stopped.resolve();
        stream.writer.writeSync(Uint8Array.of(1));
        const remote = await accepted.promise;
        remote.destroy(new Error("peer error"), { code: 9n });
        await stopped.promise;
        // The closed promise is never observed on purpose.
        for (let i = 0; !stream.destroyed; i++) {
          if (i === 5000) {
            console.log("stream never closed");
            process.exit(1);
          }
          await new Promise(r => setImmediate(r));
        }
        client.close();
        await client.closed.catch(() => {});
        await server.close();
        console.log("ok");
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      env: { ...bunEnv, NODE_NO_WARNINGS: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("ok\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
