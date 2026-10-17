// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { createPrivateKey } from "node:crypto";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
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

// node:quic sends a header block for the caller in three places: in
// create*Stream({ headers }), for pendingTrailers, and when lsquic opens a
// stream that had to wait.
describe("a header block that node:quic cannot send", () => {
  const encoder = new TextEncoder();
  const request = { ":method": "POST", ":path": "/", ":scheme": "https", ":authority": "localhost" };
  // What node:quic refuses with no stream to ask, and the error the caller gets.
  const refusedBlocks: { fields: Record<string, string>; code: string }[] = [
    // buildNgHeaderString() throws.
    { fields: { connection: "close" }, code: "ERR_HTTP2_INVALID_CONNECTION_HEADERS" },
    // Latin-1 on the wire makes a NUL of U+0100. The block then does not have
    // the pair count that it declares.
    { fields: { "x-bad": "a\u0100b" }, code: "ERR_QUIC_STREAM_ABORTED" },
    // One field more than node:quic puts in a block.
    {
      fields: Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`x-${i}`, "v"])),
      code: "ERR_QUIC_STREAM_ABORTED",
    },
  ];
  // Only lsquic refuses this one, and only on a stream. Each value fits in a
  // field. The encoded block is longer than the 64 KiB that lsquic takes.
  const tooLongForLsquic = {
    ...request,
    "x-a": Buffer.alloc(60_000, "a").toString(),
    "x-b": Buffer.alloc(60_000, "b").toString(),
  };

  function answer(this: any) {
    this.sendHeaders({ ":status": "200" }, { terminal: true });
  }
  const codeOf = (created: Promise<unknown>) =>
    created.then(
      () => "resolved",
      (err: any) => err.code,
    );

  // One server and one client session. A graceful close waits for every
  // stream, and a failed assertion can leave one open. So both ends are
  // destroyed on the way out.
  async function connected(serverOptions: Record<string, unknown>) {
    // An idle timeout must not be what ends a session here.
    const transportParams = { maxIdleTimeout: 60 };
    // How `closed` settled for each stream that the server got, in order.
    const serverStreams: { closed: string }[] = [];
    const server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          const seen = { closed: "open" };
          serverStreams.push(seen);
          stream.closed.then(
            () => (seen.closed = "resolved"),
            (err: any) => (seen.closed = err.code),
          );
        };
        await serverSession.closed.catch(() => {});
      },
      { sni: { "*": { keys: [key], certs: [cert] } }, transportParams, ...serverOptions },
    );
    const client: any = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams,
    } as SessionOptions);
    return {
      client,
      serverStreams,
      async [Symbol.asyncDispose]() {
        client.destroy();
        await server.destroy();
      },
    };
  }

  // One request, and the answer to it. When the answer is here, both ends
  // have handled everything that was sent before the request.
  async function answeredRequest(client: any) {
    const status = Promise.withResolvers<string>();
    const stream = await client.createBidirectionalStream({
      headers: request,
      onheaders(headers: Record<string, string>) {
        status.resolve(headers[":status"]);
      },
    });
    stream.closed.then(() => status.reject(new Error("the stream closed with no answer")), status.reject);
    return { id: stream.id, status: await status.promise };
  }

  test("create*Stream rejects and opens no stream", async () => {
    await using link = await connected({ onheaders: answer });
    const { client } = link;
    const attempts = async () => {
      const codes: string[] = [];
      for (const { fields } of refusedBlocks) {
        const headers = { ...request, ...fields };
        codes.push(await codeOf(client.createBidirectionalStream({ headers })));
        codes.push(await codeOf(client.createUnidirectionalStream({ headers })));
      }
      // HTTP/3 has no header block on a unidirectional stream.
      codes.push(await codeOf(client.createUnidirectionalStream({ headers: request })));
      return codes;
    };
    // lsquic opens no stream until the handshake ends. After that it opens a
    // stream at once.
    const beforeOpened = await attempts();
    await client.opened;
    const afterOpened = await attempts();

    const codes = [...refusedBlocks.flatMap(({ code }) => [code, code]), "ERR_QUIC_STREAM_ABORTED"];
    // The first stream that a client opens has the ID 0.
    expect({
      beforeOpened,
      afterOpened,
      next: await answeredRequest(client),
      serverStreams: link.serverStreams.length,
    }).toEqual({
      beforeOpened: codes,
      afterOpened: codes,
      next: { id: 0n, status: "200" },
      serverStreams: 1,
    });
    await client.close();
  });

  test("create*Stream checks its other options before it opens a stream", async () => {
    using dir = tempDir("quic-create-options", { "body.txt": "body" });
    const file = join(String(dir), "body.txt");
    await using link = await connected({ onheaders: answer });
    const { client } = link;
    await client.opened;

    // The stream that takes the lock is stream 0. `bun test` runs without
    // --experimental-stream-iter, which a FileHandle body needs, so this
    // stream fails at once. The lock stays.
    const locked = await open(file);
    const lockHolder = await client.createBidirectionalStream({ headers: request, body: locked });
    lockHolder.closed.catch(() => {});
    const closedHandle = await open(file);
    await closedHandle.close();

    const refused = {
      highWaterMark: await codeOf(client.createBidirectionalStream({ highWaterMark: -1 })),
      onheaders: await codeOf(client.createBidirectionalStream({ onheaders: 1 })),
      lockedFileHandle: await codeOf(client.createBidirectionalStream({ body: locked })),
      // Node checks the body before it checks highWaterMark.
      lockedFileHandleFirst: await codeOf(client.createBidirectionalStream({ body: locked, highWaterMark: -1 })),
      closedFileHandle: await codeOf(client.createBidirectionalStream({ body: closedHandle })),
    };
    expect({ refused, next: await answeredRequest(client) }).toEqual({
      refused: {
        highWaterMark: "ERR_OUT_OF_RANGE",
        onheaders: "ERR_INVALID_ARG_TYPE",
        lockedFileHandle: "ERR_INVALID_STATE",
        lockedFileHandleFirst: "ERR_INVALID_STATE",
        closedFileHandle: "EBADF",
      },
      next: { id: 4n, status: "200" },
    });
    await client.close();
  });

  test("a throw after the stream is open ends the stream", async () => {
    await using link = await connected({ onheaders: answer });
    const { client } = link;
    await client.opened;

    let closedStreams = 0;
    const onClosed = (message: any) => {
      if (message.session === client) closedStreams++;
    };
    subscribe("quic.stream.closed", onClosed);
    try {
      // bind() reads `name`. No check before the open can know that it throws.
      const onheaders = Object.defineProperty(function () {}, "name", {
        get() {
          throw new Error("the name getter");
        },
      });
      await expect(client.createBidirectionalStream({ headers: request, onheaders })).rejects.toThrow(
        "the name getter",
      );
      expect(closedStreams).toBe(1);
    } finally {
      unsubscribe("quic.stream.closed", onClosed);
    }
    await client.close();
  });

  test("a block that only lsquic refuses fails the stream with H3_INTERNAL_ERROR", async () => {
    await using link = await connected({ onheaders: answer });
    const { client } = link;
    const closedOf = (stream: any) => {
      const seen = { closed: "open" };
      stream.closed.then(
        () => (seen.closed = "resolved"),
        (err: any) => (seen.closed = `${err.code} ${err.errorCode}`),
      );
      return seen;
    };

    // lsquic opens these two when the handshake ends.
    const queuedByCreate = closedOf(await client.createBidirectionalStream({ headers: tooLongForLsquic }));
    const pending = await client.createBidirectionalStream();
    const queuedBySend = closedOf(pending);
    const queued = pending.sendHeaders(tooLongForLsquic);
    await client.opened;
    // lsquic opens this one at once.
    const sentAtOpen = closedOf(await client.createBidirectionalStream({ headers: tooLongForLsquic }));

    const { status } = await answeredRequest(client);
    expect({ queued, closed: [queuedByCreate, queuedBySend, sentAtOpen].map(seen => seen.closed), status }).toEqual({
      queued: true,
      closed: Array(3).fill("ERR_QUIC_APPLICATION_ERROR 258"),
      status: "200",
    });
    await client.close();
  });

  test("sendHeaders() on a pending stream answers false for a block that cannot be sent", async () => {
    const paths: string[] = [];
    await using link = await connected({
      onheaders(this: any, headers: Record<string, string>) {
        paths.push(headers[":path"]);
        answer.call(this);
      },
    });
    const { client } = link;

    const answers: boolean[][] = [];
    // The rows that the native side refuses.
    for (const [i, { fields }] of refusedBlocks.slice(1).entries()) {
      const stream = await client.createBidirectionalStream();
      stream.closed.catch(() => {});
      answers.push([
        // The handshake is not over, so lsquic has not opened the stream.
        stream.pending,
        stream.sendHeaders({ ...request, ...fields }),
        // The refusal changed nothing: the stream takes a block that can be sent.
        stream.sendHeaders({ ...request, ":path": `/${i}` }, { terminal: true }),
      ]);
    }
    await client.opened;
    await answeredRequest(client);

    expect({ answers, paths }).toEqual({
      answers: [
        [true, false, true],
        [true, false, true],
      ],
      paths: ["/0", "/1", "/"],
    });
    await client.close();
  });

  test("pendingTrailers destroys the stream with the error", async () => {
    const rows = new Map(refusedBlocks.map((row, i) => [`/${i}`, row]));
    await using link = await connected({
      onheaders(this: any, headers: Record<string, string>) {
        const row = rows.get(headers[":path"]);
        if (row === undefined) return answer.call(this);
        this.sendHeaders({ ":status": "200" });
        this.pendingTrailers = row.fields;
        this.writer.writeSync(encoder.encode("body"));
        this.writer.endSync();
      },
      // A stream is asked for its trailers only when this is set.
      onwanttrailers() {},
    });
    const { client } = link;
    await client.opened;

    const bodies: Promise<string>[] = [];
    for (const path of rows.keys()) {
      const stream = await client.createBidirectionalStream({ headers: { ...request, ":path": path }, onheaders() {} });
      stream.closed.catch(() => {});
      const arrived = Promise.withResolvers<void>();
      const body = (async () => {
        let text = "";
        for await (const batch of stream) {
          for (const chunk of batch) text += Buffer.from(chunk).toString("latin1");
          if (text === "body") arrived.resolve();
        }
        return text;
      })();
      body.catch(arrived.reject);
      bodies.push(body);
      await arrived.promise;
    }
    // The server asks a stream for its trailers when the body leaves. So it
    // asked all three before it got this request.
    await answeredRequest(client);

    expect(link.serverStreams.slice(0, rows.size).map(seen => seen.closed)).toEqual(
      refusedBlocks.map(({ code }) => code),
    );
    // destroy() still delivers a response that the stream wrote and ended.
    expect(await Promise.all(bodies)).toEqual(Array(rows.size).fill("body"));
    await client.close();
  });
});
