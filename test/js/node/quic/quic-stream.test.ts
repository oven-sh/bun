// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, withoutAsanQuarantine } from "harness";
import { createPrivateKey } from "node:crypto";
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

  test("a value of more than 64 KB arrives intact in both directions, up to a raised maxHeaderLength", async () => {
    const application = { maxHeaderLength: 100_000 };
    const valueOf = (length: number) => Buffer.alloc(length, "v").toString();
    let requested = Promise.withResolvers<string | undefined>();
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
        application,
        onheaders(this: any, headers: Record<string, any>) {
          requested.resolve(headers["x-value"]);
          this.sendHeaders(
            { ":status": "200", "x-value": valueOf(Number(headers[":path"].slice(1))) },
            { terminal: true },
          );
        },
      },
    );

    // An endpoint keeps the limits it was created with, so not the shared one.
    await using endpoint = new QuicEndpoint();
    const client = await connect(server.address!, {
      endpoint,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
      application,
    } as SessionOptions);
    await client.opened;
    const exchange = async (length: number) => {
      requested = Promise.withResolvers();
      const answered = Promise.withResolvers<Record<string, any>>();
      await client.createBidirectionalStream({
        headers: {
          ":method": "GET",
          ":path": `/${length}`,
          ":scheme": "https",
          ":authority": "localhost",
          "x-value": valueOf(length),
        },
        onheaders: answered.resolve,
      });
      // Lengths and not the values: a mismatch would print them.
      const describe = (value: string | undefined) => (value === valueOf(length) ? "intact" : value?.length);
      const response = await answered.promise;
      return {
        request: describe(await requested.promise),
        status: response[":status"],
        response: describe(response["x-value"]),
      };
    };

    expect({ under: await exchange(70_000), over: await exchange(application.maxHeaderLength) }).toEqual({
      under: { request: "intact", status: "200", response: "intact" },
      // As in Node, the receiver drops the field that goes over the limit.
      over: { request: undefined, status: "200", response: undefined },
    });
    client.close();
  });

  test("reports request headers that can't be sent", async () => {
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
    const request = { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" };
    // One call sends 128 fields at most.
    const headers: Record<string, string> = { ...request };
    for (let i = 0; i < 128; i++) headers[`x-field-${i}`] = "v";

    const client = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    } as SessionOptions);
    // These wait for the handshake, so only `closed` can report them.
    const queued = await client.createBidirectionalStream({ headers });
    expect(
      await queued.closed.then(
        () => "closed",
        err => `${err.code} ${err.errorCode}`,
      ),
    ).toBe("ERR_QUIC_APPLICATION_ERROR 258");

    await client.opened;
    expect(
      await client.createBidirectionalStream({ headers }).then(
        () => "opened",
        err => err.code,
      ),
    ).toBe("ERR_QUIC_OPEN_STREAM_FAILED");

    const answered = Promise.withResolvers<string>();
    await client.createBidirectionalStream({
      headers: request,
      onheaders(received: Record<string, any>) {
        answered.resolve(received[":status"]);
      },
    });
    expect(await answered.promise).toBe("200");
    client.close();
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

// An HTTP/3 message sends its header block first. lsquic refuses body bytes before
// the first block, and it resets the stream when the write side ends before it.
// Outside a node:quic callback a stream is written to lsquic before the call
// returns, so a body that is ready first has to wait for sendHeaders().
describe("an HTTP/3 body that is ready before sendHeaders()", () => {
  const request = { ":method": "POST", ":path": "/", ":scheme": "https", ":authority": "localhost" };
  const encoder = new TextEncoder();
  const empty = new Uint8Array(0);
  const leaveCallback = () => new Promise<void>(resolve => setImmediate(resolve));
  const settled = (closed: Promise<unknown>) =>
    closed.then(
      () => "closed",
      (err: any) => `${err.code} ${err.errorCode}`,
    );
  const text = async (stream: any) => {
    let body = "";
    for await (const batch of stream) for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
    return body;
  };
  const writeBody = (stream: any) => {
    stream.writer.writeSync(encoder.encode("body"));
    stream.writer.endSync();
  };
  type Where = "outside a callback" | "in a callback" | "before the handshake";
  type Exchange = {
    // Where the client creates its stream, and where the server answers.
    where?: Where;
    options?: Record<string, unknown>;
    send?: (stream: any, client: any) => unknown;
    // `interim` settles when the client has an interim response.
    respond?: (stream: any, interim: Promise<void>) => unknown;
  };

  async function exchange({ where = "outside a callback", options = { headers: request }, send, respond }: Exchange) {
    let blocked = 0;
    const requestBody = Promise.withResolvers<string>();
    const responded = Promise.withResolvers<unknown>();
    const interim = Promise.withResolvers<void>();
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.onblocked = () => blocked++;
          stream.closed.catch(() => {});
        };
        await serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 1 },
        async onheaders(this: any) {
          requestBody.resolve(await text(this));
          if (where !== "in a callback") await leaveCallback();
          responded.resolve(
            respond ? await respond(this, interim.promise) : this.sendHeaders({ ":status": "200" }, { terminal: true }),
          );
        },
      },
    );
    const client = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    } as SessionOptions);
    if (where !== "before the handshake") await client.opened;
    if (where === "outside a callback") await leaveCallback();

    const response: string[] = [];
    let trailers: Record<string, string> | undefined;
    const stream = await client.createBidirectionalStream({
      ...options,
      oninfo: (headers: Record<string, any>) => {
        response.push("info " + headers[":status"]);
        interim.resolve();
      },
      onheaders: (headers: Record<string, any>) => response.push("headers " + headers[":status"]),
      ontrailers: (headers: Record<string, any>) => (trailers = { ...headers }),
    });
    stream.onblocked = () => blocked++;
    await send?.(stream, client);
    const closed = settled(stream.closed);
    response.push(
      await text(stream).then(
        body => "body " + JSON.stringify(body),
        (err: any) => err.code,
      ),
    );
    return {
      request: await Promise.race([requestBody.promise, closed]),
      sent: await Promise.race([responded.promise, closed]),
      response,
      trailers,
      // lsquic refuses a body before the header block. That isn't flow control.
      blocked,
      closed: await closed,
      // A stream that still waits for its header block would keep a graceful close open.
      session: await settled(client.close()),
    };
  }
  const delivered = { sent: true, trailers: undefined, blocked: 0, closed: "closed", session: "closed" };

  test.each<[string, string, Exchange["options"], Exchange["send"]]>([
    ['the body option is ""', "", { headers: request, body: "" }, undefined],
    ["the body option is an empty Uint8Array", "", { headers: request, body: empty }, undefined],
    [
      'the body option is "" and sendHeaders() is terminal',
      "",
      { body: "" },
      stream => stream.sendHeaders(request, { terminal: true }),
    ],
    [
      "setBody() gets an empty Uint8Array",
      "",
      {},
      stream => {
        stream.setBody(empty);
        stream.sendHeaders(request);
      },
    ],
    [
      "setBody() gets null",
      "",
      {},
      stream => {
        stream.setBody(null);
        stream.sendHeaders(request);
      },
    ],
    [
      "the writer ends without a write",
      "",
      {},
      stream => {
        stream.writer.endSync();
        stream.sendHeaders(request);
      },
    ],
    [
      "the writer ends a loop turn before sendHeaders()",
      "",
      {},
      async stream => {
        stream.writer.endSync();
        await leaveCallback();
        stream.sendHeaders(request);
      },
    ],
    [
      "the writer ends after a write",
      "body",
      {},
      stream => {
        writeBody(stream);
        stream.sendHeaders(request);
      },
    ],
  ])("a request arrives whole when %s", async (_, body, options, send) => {
    expect(await exchange({ options, send })).toEqual({
      ...delivered,
      request: body,
      response: ["headers 200", 'body ""'],
    });
  });

  // lsquic opens this stream inside the engine pass that ends the handshake.
  test("a request arrives whole when its stream and its empty body come before the handshake", async () => {
    const send = async (stream: any, client: any) => {
      await client.opened;
      stream.sendHeaders(request);
    };
    expect(await exchange({ where: "before the handshake", options: { body: "" }, send })).toEqual({
      ...delivered,
      request: "",
      response: ["headers 200", 'body ""'],
    });
  });

  test.each<[string, string[], NonNullable<Exchange["respond"]>]>([
    [
      "the writer ends without a write",
      ["headers 200", 'body ""'],
      stream => {
        stream.writer.endSync();
        return stream.sendHeaders({ ":status": "200" });
      },
    ],
    [
      "the writer ends a loop turn before sendHeaders()",
      ["headers 200", 'body ""'],
      async stream => {
        stream.writer.endSync();
        await leaveCallback();
        return stream.sendHeaders({ ":status": "200" });
      },
    ],
    [
      "setBody() gets an empty Uint8Array",
      ["headers 200", 'body ""'],
      stream => {
        stream.setBody(empty);
        return stream.sendHeaders({ ":status": "200" });
      },
    ],
    [
      "the writer ends after a write",
      ["headers 200", 'body "body"'],
      stream => {
        writeBody(stream);
        return stream.sendHeaders({ ":status": "200" });
      },
    ],
    // An interim response is a header block too, but the body belongs to the final response.
    [
      "the writer ends without a write after an interim response",
      ["info 103", "headers 200", 'body ""'],
      stream => {
        stream.sendInformationalHeaders({ ":status": "103" });
        stream.writer.endSync();
        return stream.sendHeaders({ ":status": "200" });
      },
    ],
    [
      "the writer ends after a write and an interim response",
      ["info 103", "headers 200", 'body "body"'],
      stream => {
        stream.sendInformationalHeaders({ ":status": "103" });
        writeBody(stream);
        return stream.sendHeaders({ ":status": "200" });
      },
    ],
    // The interim response leaves at once. The final response waits until the client has it.
    [
      "the client gets an interim response first",
      ["info 103", "headers 200", 'body ""'],
      async (stream, interim) => {
        stream.sendInformationalHeaders({ ":status": "103" });
        await interim;
        const sent = stream.sendHeaders({ ":status": "200" });
        stream.writer.endSync();
        return sent;
      },
    ],
    [
      "the client gets an interim response first and the writer ended before it",
      ["info 103", "headers 200", 'body ""'],
      async (stream, interim) => {
        stream.sendInformationalHeaders({ ":status": "103" });
        stream.writer.endSync();
        await interim;
        return stream.sendHeaders({ ":status": "200" });
      },
    ],
    [
      "the client gets an interim response first and the body was written before it",
      ["info 103", "headers 200", 'body "body"'],
      async (stream, interim) => {
        stream.sendInformationalHeaders({ ":status": "103" });
        writeBody(stream);
        await interim;
        return stream.sendHeaders({ ":status": "200" });
      },
    ],
  ])("a response arrives whole when %s", async (_, response, respond) => {
    expect(await exchange({ respond })).toEqual({ ...delivered, request: "", response });
  });

  // The request for trailers follows the end of the body, so it waits for the header block too.
  test.each<[string, string[], (stream: any) => void]>([
    ["the writer ends a loop turn before sendHeaders()", ["headers 200", 'body ""'], () => {}],
    [
      "the writer ends after an interim response and a loop turn before sendHeaders()",
      ["info 103", "headers 200", 'body ""'],
      stream => stream.sendInformationalHeaders({ ":status": "103" }),
    ],
  ])("a response arrives with its trailers when %s", async (_, response, before) => {
    const respond = async (stream: any) => {
      stream.onwanttrailers = () => stream.sendTrailers({ "x-checksum": "abc" });
      before(stream);
      stream.writer.endSync();
      await leaveCallback();
      return stream.sendHeaders({ ":status": "200" });
    };
    expect(await exchange({ respond })).toEqual({
      ...delivered,
      request: "",
      response,
      trailers: { "x-checksum": "abc" },
    });
  });

  // One sendHeaders() call takes 128 fields at most.
  const refused: Record<string, string> = { ":status": "200" };
  for (let i = 0; i < 128; i++) refused[`x-field-${i}`] = "v";
  const reset = {
    request: "",
    response: ["ERR_QUIC_STREAM_RESET"],
    trailers: undefined,
    blocked: 0,
    closed: "ERR_QUIC_APPLICATION_ERROR 258",
    session: "closed",
  };
  describe.each<Where>(["outside a callback", "in a callback"])("%s", where => {
    test.each<[string, NonNullable<Exchange["respond"]>]>([
      [
        "the writer ended before it",
        stream => {
          stream.writer.endSync();
          return stream.sendHeaders(refused);
        },
      ],
      [
        "the writer ends after it",
        stream => {
          const sent = stream.sendHeaders(refused);
          stream.writer.endSync();
          return sent;
        },
      ],
      [
        "a body was written before it",
        stream => {
          writeBody(stream);
          return stream.sendHeaders(refused);
        },
      ],
    ])("a response whose header block can't be sent resets the stream when %s", async (_, respond) => {
      expect(await exchange({ where, respond })).toEqual({ ...reset, sent: false });
    });
  });

  // Outside a callback the refused call writes to lsquic before it returns, so the stream is reset by then.
  test.each<[Where, Awaited<ReturnType<typeof exchange>>]>([
    ["in a callback", { ...delivered, sent: [false, true], request: "", response: ["headers 500", 'body "body"'] }],
    ["outside a callback", { ...reset, sent: [false, false] }],
  ])("a second sendHeaders() after one that can't be sent, with a body written first, %s", async (where, expected) => {
    const respond = (stream: any) => {
      writeBody(stream);
      return [stream.sendHeaders(refused), stream.sendHeaders({ ":status": "500" })];
    };
    expect(await exchange({ where, respond })).toEqual(expected);
  });

  // Nothing was queued for the block that can't be sent, so the write event of the interim response fails nothing.
  test("a response arrives whole when a sendHeaders() that can't be sent comes first", async () => {
    const respond = (stream: any) => [
      stream.sendHeaders(refused),
      stream.sendInformationalHeaders({ ":status": "103" }),
      stream.sendHeaders({ ":status": "200" }, { terminal: true }),
    ];
    expect(await exchange({ respond })).toEqual({
      ...delivered,
      sent: [false, true, true],
      request: "",
      response: ["info 103", "headers 200", 'body ""'],
    });
  });

  // The body belongs to the final response, so an interim response that can't be sent doesn't fail it.
  const refusedInterim = { ...refused, ":status": "103" };
  test.each<[string, string, (stream: any) => void]>([
    ["the writer ends without a write", "", stream => stream.writer.endSync()],
    ["the writer ends after a write", "body", writeBody],
  ])("a response arrives whole after an interim response that can't be sent when %s", async (_, body, end) => {
    const respond = (stream: any) => {
      const interim = stream.sendInformationalHeaders(refusedInterim);
      end(stream);
      return [interim, stream.sendHeaders({ ":status": "200" })];
    };
    expect(await exchange({ respond })).toEqual({
      ...delivered,
      sent: [false, true],
      request: "",
      response: ["headers 200", "body " + JSON.stringify(body)],
    });
  });

  test("a body or an end that waits for sendHeaders() isn't offered to lsquic", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          import { createPrivateKey } from "node:crypto";
          import { readFileSync } from "node:fs";
          import { join } from "node:path";
          import { connect, listen } from "node:quic";
          const keys = process.env.QUIC_KEYS_DIR;
          const key = createPrivateKey(readFileSync(join(keys, "agent1-key.pem")));
          const cert = readFileSync(join(keys, "agent1-cert.pem"));
          const interim = Promise.withResolvers();
          const server = await listen(
            async session => {
              session.onstream = stream => stream.closed.catch(() => {});
              await session.closed.catch(() => {});
            },
            {
              sni: { "*": { keys: [key], certs: [cert] } },
              transportParams: { maxIdleTimeout: 5 },
              async onheaders() {
                let bytes = 0;
                for await (const batch of this) for (const chunk of batch) bytes += chunk.byteLength;
                // The end of the response waits, with the write event of the interim response behind it.
                this.sendInformationalHeaders({ ":status": "103" });
                this.writer.endSync();
                await interim.promise;
                this.sendHeaders({ ":status": "200", "x-request-bytes": String(bytes) });
              },
            },
          );
          const client = await connect(server.address, {
            servername: "localhost",
            verifyPeer: "manual",
            transportParams: { maxIdleTimeout: 5 },
          });
          await client.opened;
          await new Promise(resolve => setImmediate(resolve));
          const answered = Promise.withResolvers();
          const stream = await client.createBidirectionalStream({
            headers: { ":method": "POST", ":path": "/", ":scheme": "https", ":authority": "localhost" },
            body: new Uint8Array(1024),
            oninfo: interim.resolve,
            onheaders: headers => answered.resolve(headers["x-request-bytes"]),
          });
          stream.closed.then(() => answered.reject(new Error("closed without a response")), answered.reject);
          console.log("request bytes", await answered.promise);
          process.exit(0);
        `,
      ],
      env: { ...bunEnv, QUIC_KEYS_DIR: keysDir, BUN_DEBUG_lsquic: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const count = (line: string) => stderr.split(line).length - 1;
    expect({
      stdout,
      // The log is on when this line is there.
      engines: count("engine: instantiated engine"),
      refusedWrites: count("Attempt to write to stream before sending HTTP headers"),
      // lsquic logs this when a stream keeps its write event and writes nothing.
      idleWriteEvents: count("broke suspected infinite loop"),
      exitCode,
    }).toEqual({ stdout: "request bytes 1024\n", engines: 2, refusedWrites: 0, idleWriteEvents: 0, exitCode: 0 });
  });
});

test("a header block for an HTTP/3 stream that has closed on the wire is not accepted", async () => {
  const request = { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" };
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
  const client = await connect(server.address!, {
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: 1 },
  } as SessionOptions);
  await client.opened;

  // Both sides have ended here, so lsquic closed the stream before this callback runs.
  const sent = Promise.withResolvers<boolean[]>();
  const stream = await client.createBidirectionalStream({
    headers: request,
    onheaders(this: any) {
      sent.resolve([
        this.sendHeaders(request),
        this.sendInformationalHeaders({ ":status": "103" }),
        this.sendTrailers({ "x-late": "1" }),
      ]);
    },
  });
  stream.closed.then(() => sent.reject(new Error("closed without a response")), sent.reject);
  const accepted = await sent.promise.finally(() => client.close());
  expect(accepted).toEqual([false, false, false]);
});

// lsquic can finish the handshake, read the peer's first stream and close the connection in one
// engine pass, before JS sees any of it. A request created before `opened` is sent with the
// client's Finished, and lsquic rejects its bad content-length with H3_MESSAGE_ERROR (0x10e).
test("a malformed request in the handshake's last flight closes only that connection", async () => {
  const events: unknown[] = [];
  const sessions: Promise<unknown>[] = [];
  await using server = await listen(
    (session: any) => {
      const record = sessions.length === 0 ? (event: unknown) => events.push(event) : () => {};
      const closed = Promise.withResolvers<void>();
      sessions.push(closed.promise);
      session.onerror = () => record("error");
      session.onhandshake = (info: any) => record(["handshake", info.protocol, info.servername]);
      session.onstream = (stream: any) => {
        record("stream");
        stream.closed.catch(() => {});
      };
      session.closed.then(closed.resolve, closed.resolve);
    },
    {
      alpn: ["h3"],
      sni: { "*": { keys: [key], certs: [cert] } },
      transportParams: { maxIdleTimeout: 5 },
      onheaders(this: any) {
        this.sendHeaders({ ":status": "200" }, { terminal: true });
      },
    },
  );
  const options = {
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: 5 },
    onerror() {},
  } as SessionOptions;
  const headers = { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" };

  const malformed = await connect(server.address!, options);
  malformed.opened.catch(() => {});
  const close = malformed.closed.then(
    () => undefined,
    (err: any) => ({ code: err.code, errorCode: err.errorCode }),
  );
  (await malformed.createBidirectionalStream({ headers: { ...headers, "content-length": "abc" } })).closed.catch(
    () => {},
  );
  expect(await close).toEqual({ code: "ERR_QUIC_APPLICATION_ERROR", errorCode: 0x10en });

  const client = await connect(server.address!, options);
  const answered = Promise.withResolvers<string>();
  client.closed.then(() => answered.reject(new Error("closed without an answer")), answered.reject);
  const stream = await client.createBidirectionalStream({
    headers,
    onheaders: (headers: Record<string, any>) => answered.resolve(headers[":status"]),
  });
  stream.closed.catch(() => {});
  expect(await answered.promise).toBe("200");
  client.close();
  await Promise.all(sessions);
  expect(events).toEqual([["handshake", "h3", "localhost"], "stream", "error"]);
});

test("session.close() before the handshake ends doesn't wait for a pending HTTP/3 stream", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { connect } from "node:quic";
        // This socket never answers, and the session never times out.
        const silent = await Bun.udpSocket({ hostname: "127.0.0.1" });
        const session = await connect(
          { address: "127.0.0.1", port: silent.port },
          { servername: "localhost", verifyPeer: "manual", handshakeTimeout: 600_000, transportParams: { maxIdleTimeout: 0 } },
        );
        session.opened.catch(() => {});
        const stream = await session.createBidirectionalStream({
          headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
        });
        console.log("pending", stream.pending);
        await session.close();
        await stream.closed;
        console.log("closed");
        process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("pending true\nclosed\n");
  expect(exitCode).toBe(0);
}, 30_000);

// `destroy()` sends STOP_SENDING and RESET_STREAM. Once the response is sent and
// acked, STOP_SENDING finishes the stream and lsquic frees it in the next service
// pass, so a queued RESET_STREAM packet would point to freed memory.
describe("QuicStream.destroy on a stream lsquic has already finished", () => {
  // The peer's FIN has to arrive after a gap, or lsquic closes the read side
  // before the app can call destroy(). A UDP relay in front of the server
  // drops the packet carrying the body.
  const script = String.raw`
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen } from "node:quic";

const keysDir = process.env.QUIC_KEYS_DIR;
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));
const quiet = x => (x.closed?.catch?.(() => {}), x);
const dec = new TextDecoder();
const read = async s => {
  let out = "";
  try {
    for await (const chunk of s) for (const b of [chunk].flat()) out += dec.decode(b);
  } catch {}
  return out;
};

let stuck = null;
let nth = 0;
const destroyed = Promise.withResolvers();

const server = await listen(
  session => {
    quiet(session).onerror = () => {};
    session.onstream = stream => {
      quiet(stream);
      stream.sendHeaders({ ":status": "200" });
      stream.setBody(Buffer.from("answer"));
      const i = nth++;
      if (i === 0) {
        stuck = stream; // never read, so the peer's FIN is stuck behind the gap
        return;
      }
      if (i > 1) return;
      (async () => {
        for await (const _ of stream) {
          stuck.destroy();
          destroyed.resolve();
          break;
        }
      })();
    };
  },
  {
    alpn: ["h3"],
    sni: { "*": { keys: [key], certs: [cert] } },
    transportParams: { maxIdleTimeout: 5 },
  },
);

const serverPort = server.address.port;
const front = createSocket("udp4");
await new Promise(r => front.bind(0, "127.0.0.1", r));
const dropped = Promise.withResolvers();
let up = null;
let gap = false;
front.on("message", (m, from) => {
  up ??= createSocket("udp4").on("message", back => front.send(back, from.port, "127.0.0.1"));
  if (gap && m.length > 400) {
    dropped.resolve();
    return;
  }
  up.send(m, serverPort, "127.0.0.1");
});

const client = await connect(
  { address: "127.0.0.1", port: front.address().port },
  {
    alpn: "h3",
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: 5 },
    onerror() {},
  },
);
await client.opened;

const headers = { ":method": "POST", ":path": "/", ":scheme": "https", ":authority": "localhost" };

// A gets a full response and is then abandoned.
const a = quiet(await client.createBidirectionalStream({}));
a.sendHeaders(headers);
console.log("A:" + (await read(a)));

// B tells the server when to destroy A. Its headers reach the server before the relay starts dropping packets.
const b = quiet(await client.createBidirectionalStream({}));
b.sendHeaders(headers);
console.log("B:" + (await read(b)));

// The relay drops the body packet, but the byte and the FIN after it arrive.
gap = true;
a.writer.writeSync(new Uint8Array(1000).fill(0x41));
await dropped.promise;
a.writer.writeSync(new Uint8Array([0x42]));
a.writer.endSync();
b.writer.writeSync(new Uint8Array([0x43]));
await destroyed.promise;

// One more round trip, so the server ticks after the destroy.
const c = quiet(await client.createBidirectionalStream({}));
c.sendHeaders(headers);
console.log("C:" + (await read(c)));
process.exit(0);
`;

  test("answers on the same connection instead of resetting the freed stream", async () => {
    using dir = tempDir("quic-destroy-finished", { "repro.mjs": script });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repro.mjs"],
      env: { ...bunEnv, QUIC_KEYS_DIR: keysDir },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.split("\n").filter(Boolean), stderr: stderr.includes("Assertion") ? stderr : "" }).toEqual({
      stdout: ["A:answer", "B:answer", "C:answer"],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  }, 30_000);
});

test("a stream that reuses a destroyed stream's allocation doesn't get its queued close event", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      join(import.meta.dir, "quic-stream-recycled-close-fixture.ts"),
      join(keysDir, "agent1-key.pem"),
      join(keysDir, "agent1-cert.pem"),
    ],
    // ASAN only reuses a freed block right away when its quarantine is off.
    env: withoutAsanQuarantine(bunEnv),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe(JSON.stringify({ opened: 16, delivered: 16, closedBeforeSent: [] }) + "\n");
  expect(exitCode).toBe(0);
}, 30_000);
