// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { describe, expect, test } from "bun:test";
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen } from "node:quic";

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

// lsquic refuses a header block with a value over 65535 bytes, so
// sendHeaders() returns false. A body write or a FIN that follows fails
// (EILSEQ, no header block): the stream must be reset with H3_INTERNAL_ERROR,
// not retried on every engine tick and not sent as a headerless response.
describe("a response after a refused header block", () => {
  const H3_INTERNAL_ERROR = 0x102n;
  const refused = { ":status": "200", "x-one": Buffer.alloc(70000, "~").toString() };

  async function roundTrip(respond: (stream: any) => boolean | undefined | Promise<boolean | undefined>) {
    const serverSide = Promise.withResolvers<{ sent: boolean | undefined; error: any }>();
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
          new Promise<boolean | undefined>(resolve => resolve(respond(this))).then(
            sent =>
              this.closed.then(
                () => serverSide.resolve({ sent, error: undefined }),
                (error: any) => serverSide.resolve({ sent, error }),
              ),
            error => serverSide.resolve({ sent: undefined, error }),
          );
        },
      },
    );

    const client = await connect(server.address, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
      onerror() {},
    });
    await client.opened;
    const stream = await client.createBidirectionalStream({
      headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
    });

    const clientError = await stream.closed.then(
      () => undefined,
      (error: any) => error,
    );
    const { sent, error: serverError } = await serverSide.promise;
    client.close();
    return { sent, clientError, serverError };
  }

  test("a body write resets the stream with H3_INTERNAL_ERROR instead of retrying forever", async () => {
    const { sent, clientError, serverError } = await roundTrip(stream => {
      const sent = stream.sendHeaders(refused);
      stream.writer.writeSync(new TextEncoder().encode("body"));
      stream.writer.endSync();
      return sent;
    });
    expect(sent).toBe(false);
    expect({ code: clientError?.code, errorCode: clientError?.errorCode }).toEqual({
      code: "ERR_QUIC_APPLICATION_ERROR",
      errorCode: H3_INTERNAL_ERROR,
    });
    expect({ code: serverError?.code, errorCode: serverError?.errorCode }).toEqual({
      code: "ERR_QUIC_APPLICATION_ERROR",
      errorCode: H3_INTERNAL_ERROR,
    });
  });

  test("an empty body resets the stream with H3_INTERNAL_ERROR instead of a bare FIN", async () => {
    const { sent, clientError, serverError } = await roundTrip(stream => {
      const sent = stream.sendHeaders(refused);
      stream.writer.endSync();
      return sent;
    });
    expect(sent).toBe(false);
    expect({ code: clientError?.code, errorCode: clientError?.errorCode }).toEqual({
      code: "ERR_QUIC_APPLICATION_ERROR",
      errorCode: H3_INTERNAL_ERROR,
    });
    expect({ code: serverError?.code, errorCode: serverError?.errorCode }).toEqual({
      code: "ERR_QUIC_APPLICATION_ERROR",
      errorCode: H3_INTERNAL_ERROR,
    });
  });

  test("a terminal header block with no body resets the stream with H3_INTERNAL_ERROR", async () => {
    const { sent, clientError, serverError } = await roundTrip(stream =>
      stream.sendHeaders(refused, { terminal: true }),
    );
    expect(sent).toBe(false);
    expect({ code: clientError?.code, errorCode: clientError?.errorCode }).toEqual({
      code: "ERR_QUIC_APPLICATION_ERROR",
      errorCode: H3_INTERNAL_ERROR,
    });
    expect({ code: serverError?.code, errorCode: serverError?.errorCode }).toEqual({
      code: "ERR_QUIC_APPLICATION_ERROR",
      errorCode: H3_INTERNAL_ERROR,
    });
  });

  test("a body parked before a refused header block resets the stream with H3_INTERNAL_ERROR", async () => {
    const { sent, clientError, serverError } = await roundTrip(async stream => {
      stream.writer.writeSync(new TextEncoder().encode("body"));
      // Let the first write fail and park while the stream has no header block.
      for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
      return stream.sendHeaders(refused);
    });
    expect(sent).toBe(false);
    expect({ code: clientError?.code, errorCode: clientError?.errorCode }).toEqual({
      code: "ERR_QUIC_APPLICATION_ERROR",
      errorCode: H3_INTERNAL_ERROR,
    });
    expect({ code: serverError?.code, errorCode: serverError?.errorCode }).toEqual({
      code: "ERR_QUIC_APPLICATION_ERROR",
      errorCode: H3_INTERNAL_ERROR,
    });
  });

  test("refused trailers reset the stream with H3_INTERNAL_ERROR", async () => {
    let trailersSent: boolean | undefined;
    const { clientError, serverError } = await roundTrip(stream => {
      stream.onwanttrailers = function (this: any) {
        trailersSent = this.sendTrailers({ "x-one": refused["x-one"] });
      };
      stream.sendHeaders({ ":status": "200" });
      stream.writer.writeSync(new TextEncoder().encode("body"));
      stream.writer.endSync();
      return undefined;
    });
    expect(trailersSent).toBe(false);
    expect({ code: clientError?.code, errorCode: clientError?.errorCode }).toEqual({
      code: "ERR_QUIC_APPLICATION_ERROR",
      errorCode: H3_INTERNAL_ERROR,
    });
    expect({ code: serverError?.code, errorCode: serverError?.errorCode }).toEqual({
      code: "ERR_QUIC_APPLICATION_ERROR",
      errorCode: H3_INTERNAL_ERROR,
    });
  });

  // The client queues its request block before lsquic opens the stream, so
  // sendHeaders() reports true and the refusal is only known at open time.
  test("a refused request block rejects the client stream's closed promise", async () => {
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
      },
    );
    const client = await connect(server.address, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
      onerror() {},
    });
    await client.opened;
    const stream = await client.createBidirectionalStream({
      headers: {
        ":method": "GET",
        ":path": "/",
        ":scheme": "https",
        ":authority": "localhost",
        "x-one": refused["x-one"],
      },
    });
    const clientError = await stream.closed.then(
      () => undefined,
      (error: any) => error,
    );
    client.close();
    expect({ code: clientError?.code, errorCode: clientError?.errorCode }).toEqual({
      code: "ERR_QUIC_APPLICATION_ERROR",
      errorCode: H3_INTERNAL_ERROR,
    });
  });
});

// A body queued before sendHeaders() also fails the write with EILSEQ. That
// is not a refusal: the bytes wait for the header block and follow it.
describe("a body written before the header block", () => {
  async function responseTo(respond: (stream: any) => Promise<void>) {
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
          respond(this).catch(() => {});
        },
      },
    );

    const client = await connect(server.address, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
      onerror() {},
    });
    await client.opened;
    const gotHeaders = Promise.withResolvers<string>();
    const stream = await client.createBidirectionalStream({
      headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
      onheaders(headers: Record<string, string>) {
        gotHeaders.resolve(headers[":status"]);
      },
    });

    let body = "";
    for await (const batch of stream) {
      for (const chunk of batch) body += Buffer.from(chunk).toString();
    }
    client.close();
    return { status: await gotHeaders.promise, body };
  }

  // Yield so engine passes run between the steps of a response.
  const tick = async () => {
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  };

  test("is delivered after sendHeaders()", async () => {
    const { status, body } = await responseTo(async stream => {
      stream.writer.writeSync(new TextEncoder().encode("body"));
      await tick();
      stream.sendHeaders({ ":status": "200" });
      stream.writer.endSync();
    });
    expect(status).toBe("200");
    expect(body).toBe("body");
  });

  test("a refused block after an accepted interim block leaves the stream open for a retry", async () => {
    const { status, body } = await responseTo(async stream => {
      expect(stream.sendInformationalHeaders({ ":status": "100" })).toBe(true);
      expect(stream.sendHeaders({ ":status": "200", "x-one": Buffer.alloc(70000, "~").toString() })).toBe(false);
      // The accepted block armed a write event. It must not fail the stream.
      await tick();
      expect(stream.sendHeaders({ ":status": "200" })).toBe(true);
      stream.writer.writeSync(new TextEncoder().encode("body"));
      stream.writer.endSync();
    });
    expect(status).toBe("200");
    expect(body).toBe("body");
  });

  // A peer RESET_STREAM closes the read side only. The response still goes out.
  test("is delivered after sendHeaders() when the peer reset its send side first", async () => {
    const serverSaw = Promise.withResolvers<void>();
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.closed.catch(() => {});
          stream.onreset = async () => {
            stream.writer.writeSync(new TextEncoder().encode("body"));
            await tick();
            stream.sendHeaders({ ":status": "200" });
            stream.writer.endSync();
            serverSaw.resolve();
          };
        };
        await serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 1 },
        onheaders() {},
      },
    );

    const client = await connect(server.address, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
      onerror() {},
    });
    await client.opened;
    const gotHeaders = Promise.withResolvers<string>();
    const stream = await client.createBidirectionalStream({
      onheaders(headers: Record<string, string>) {
        gotHeaders.resolve(headers[":status"]);
      },
    });
    stream.closed.catch(() => {});
    stream.sendHeaders({ ":method": "POST", ":path": "/", ":scheme": "https", ":authority": "localhost" });
    stream.resetStream(0n);

    let body = "";
    for await (const batch of stream) {
      for (const chunk of batch) body += Buffer.from(chunk).toString();
    }
    await serverSaw.promise;
    client.close();

    expect(await gotHeaders.promise).toBe("200");
    expect(body).toBe("body");
  });

  test("a retried header block after a refused terminal one keeps the body open", async () => {
    const { status, body } = await responseTo(async stream => {
      expect(
        stream.sendHeaders({ ":status": "200", "x-one": Buffer.alloc(70000, "~").toString() }, { terminal: true }),
      ).toBe(false);
      expect(stream.sendHeaders({ ":status": "200" })).toBe(true);
      stream.writer.writeSync(new TextEncoder().encode("bo"));
      await tick();
      stream.writer.writeSync(new TextEncoder().encode("dy"));
      stream.writer.endSync();
    });
    expect(status).toBe("200");
    expect(body).toBe("body");
  });
});
