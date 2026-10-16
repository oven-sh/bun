// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { quicSendRawHeaders } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { createPrivateKey } from "node:crypto";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
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

// RFC 9114 10.3: CR and LF are not valid in a field. nghttp3, which reads the
// fields for Node, takes such a field out of the block and delivers the rest.
describe("received HTTP/3 fields that hold CR or LF", () => {
  const encoder = new TextEncoder();
  const request = { ":method": "POST", ":path": "/", ":scheme": "https", ":authority": "localhost" };
  const serverOptions = { sni: { "*": { keys: [key], certs: [cert] } }, transportParams: { maxIdleTimeout: 1 } };
  const clientOptions = {
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: 1 },
  } as SessionOptions;
  const quietSession = async (serverSession: any) => {
    serverSession.onstream = (stream: any) => {
      stream.closed.catch(() => {});
    };
    await serverSession.closed.catch(() => {});
  };
  // The tests wait for `stream.closed` and `client.close()`, not for a callback.
  // `closed` settles after the last header callback of the stream on that side
  // and rejects when the stream failed. `close()` rejects when the connection failed.

  test.each([
    ["CR LF", "a\r\nb: c"],
    ["LF", "a\nb"],
    ["CR", "a\rb"],
  ])("a field value with %s is left out of every kind of block and the rest is delivered", async (_, bad) => {
    const seen: Record<string, unknown> = {};
    let serverStream: any;
    await using server = await listen(
      async (serverSession: any) => {
        serverSession.onstream = (stream: any) => {
          serverStream = stream;
          stream.closed.catch(() => {});
        };
        await serverSession.closed.catch(() => {});
      },
      {
        ...serverOptions,
        onheaders(this: any, headers: Record<string, any>) {
          seen.request = { ...headers };
          this.sendInformationalHeaders({ ":status": "103", "x-bad": bad, "x-ok": "info" });
          this.sendHeaders({ ":status": "200", "x-bad": bad, "x-ok": "response" });
          this.writer.writeSync(encoder.encode("body"));
          this.writer.endSync();
        },
        ontrailers(this: any, trailers: Record<string, any>) {
          seen.requestTrailers = { ...trailers };
        },
        onwanttrailers(this: any) {
          // The only field of this block is the one that is left out.
          this.sendTrailers({ "x-bad": bad });
        },
      },
    );
    const client = await connect(server.address!, clientOptions);
    await client.opened;

    const stream: any = await client.createBidirectionalStream({
      oninfo: (headers: Record<string, any>) => (seen.info = { ...headers }),
      onheaders: (headers: Record<string, any>) => (seen.response = { ...headers }),
      ontrailers: (trailers: Record<string, any>) => (seen.responseTrailers = { ...trailers }),
    });
    stream.closed.catch(() => {});
    stream.sendHeaders({ ...request, "x-bad": bad, "x-ok": "request" });
    stream.sendTrailers({ "x-bad": bad, "x-ok": "request trailers" });
    let body = "";
    for await (const batch of stream) {
      for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
    }
    seen.body = body;
    seen.responseGetter = { ...stream.headers };
    await stream.closed;
    await serverStream.closed;
    await client.close();

    expect(seen).toEqual({
      request: { ...request, "x-ok": "request" },
      requestTrailers: { "x-ok": "request trailers" },
      info: { ":status": "103", "x-ok": "info" },
      response: { ":status": "200", "x-ok": "response" },
      responseGetter: { ":status": "200", "x-ok": "response" },
      responseTrailers: {},
      body: "body",
    });
  });

  // sendHeaders() refuses a name that is not a token, so these blocks go out
  // through the raw sender. Kind 1 is the initial block and flag 1 ends the stream.
  test("a field name with CR or LF is left out, and a tab in a value is not", async () => {
    const seen: Record<string, Record<string, string>> = {};
    await using server = await listen(quietSession, {
      ...serverOptions,
      onheaders(this: any, headers: Record<string, any>) {
        const { ":path": path, ...rest } = headers;
        seen[path] = rest;
        this.sendHeaders({ ":status": "200" }, { terminal: true });
      },
    });
    const client = await connect(server.address!, clientOptions);
    await client.opened;

    const rows: Record<string, Record<string, string>> = {
      "/name-cr-lf": { "x-a\r\nx-b": "v" },
      "/name-lf": { "x-a\nx-b": "v" },
      "/name-cr": { "x-a\rx-b": "v" },
      "/value-tab": { "x-tab": "a\tb", "x-bad": "a\rb" },
      "/plain": { "x-plain": "v" },
    };
    for (const [path, fields] of Object.entries(rows)) {
      const stream = await client.createBidirectionalStream();
      stream.closed.catch(() => {});
      const block = { ...request, ":path": path, ...fields, "x-ok": "kept" };
      quicSendRawHeaders(stream, Object.entries(block).flat(), 1, 1);
      await stream.closed;
    }
    await client.close();

    const rest = { ":method": "POST", ":scheme": "https", ":authority": "localhost", "x-ok": "kept" };
    expect(seen).toEqual({
      "/name-cr-lf": rest,
      "/name-lf": rest,
      "/name-cr": rest,
      "/value-tab": { ...rest, "x-tab": "a\tb" },
      "/plain": { ...rest, "x-plain": "v" },
    });
  });

  // RFC 9114 4.1.2: a pseudo-header that holds CR or LF makes the message
  // malformed. The stream fails with H3_MESSAGE_ERROR and the session goes on.
  // Node v26.3.0 closes the whole connection there.
  const messageError = { code: "ERR_QUIC_APPLICATION_ERROR", errorCode: 0x10en };
  const outcome = (closed: Promise<unknown>) =>
    closed.then(
      () => "fulfilled",
      (err: any) => ({ code: err.code, errorCode: err.errorCode }),
    );
  // A server that answers 200 and records the `:path` of each request it is given.
  async function recordingServer(options: Record<string, any> = {}) {
    const paths: string[] = [];
    const streams: any[] = [];
    const server = await listen(
      async (serverSession: any) => {
        serverSession.onstream = (stream: any) => {
          streams.push(stream);
          stream.closed.catch(() => {});
        };
        await serverSession.closed.catch(() => {});
      },
      {
        ...serverOptions,
        onheaders(this: any, headers: Record<string, any>) {
          paths.push(headers[":path"]);
          this.sendHeaders({ ":status": "200" }, { terminal: true });
        },
        ...options,
      } as SessionOptions,
    );
    return { server, paths, streams };
  }
  // The status of a well-formed request. It rejects when the stream or the session failed.
  async function statusOf(client: any, path: string) {
    let status: string | undefined;
    const stream = await client.createBidirectionalStream({
      headers: { ...request, ":path": path },
      onheaders: (headers: Record<string, any>) => (status = headers[":status"]),
    });
    await stream.closed;
    return status;
  }

  test("a request pseudo-header with CR or LF fails that stream and no other", async () => {
    const { server, paths, streams } = await recordingServer();
    await using _server = server;
    const client = await connect(server.address!, clientOptions);
    await client.opened;

    const rows: Record<string, Record<string, string>> = {
      ":path value with CR LF": { ":path": "/a\r\nb" },
      ":path value with LF": { ":path": "/a\nb" },
      ":path value with CR": { ":path": "/a\rb" },
      ":method value with LF": { ":method": "PO\nST" },
      ":scheme value with CR": { ":scheme": "ht\rtps" },
      ":authority value with CR LF": { ":authority": "a\r\nb" },
      "name with CR": { ":pa\rth": "/" },
      "name with LF": { ":pa\nth": "/" },
      // No CR or LF: the malformed request that failed its stream before this rule.
      ":status in a request": { ":status": "200" },
    };
    const seen: Record<string, unknown> = { before: await statusOf(client, "/before") };
    for (const [row, bad] of Object.entries(rows)) {
      const stream = await client.createBidirectionalStream();
      quicSendRawHeaders(stream, Object.entries({ ...request, ...bad, "x-ok": "kept" }).flat(), 1, 1);
      seen[row] = { client: await outcome(stream.closed), server: await outcome(streams.at(-1).closed) };
    }
    seen.after = await statusOf(client, "/after");
    await client.close();

    const failed = { client: messageError, server: messageError };
    expect({ seen, paths }).toEqual({
      seen: { before: "200", ...Object.fromEntries(Object.keys(rows).map(row => [row, failed])), after: "200" },
      paths: ["/before", "/after"],
    });
  });

  // The server reads this request in the engine pass that completes the handshake.
  test("a request with such a pseudo-header that is sent before the handshake completes fails that stream", async () => {
    const { server, paths } = await recordingServer();
    await using _server = server;
    const client = await connect(server.address!, clientOptions);

    const stream = await client.createBidirectionalStream({ headers: { ...request, ":path": "/a\r\nb" } });
    const closed = await outcome(stream.closed);
    const after = await statusOf(client, "/after");
    await client.close();

    expect({ closed, after, paths }).toEqual({ closed: messageError, after: "200", paths: ["/after"] });
  });

  test("a stream of a server that has no onheaders fails too", async () => {
    const { server, streams } = await recordingServer({ onheaders: undefined });
    await using _server = server;
    const client = await connect(server.address!, clientOptions);
    await client.opened;

    const stream = await client.createBidirectionalStream({ headers: { ...request, ":path": "/a\r\nb" } });
    const closed = { client: await outcome(stream.closed), server: await outcome(streams[0].closed) };
    await client.close();

    expect(closed).toEqual({ client: messageError, server: messageError });
  });

  // nghttp3 checks a field before Node counts it, so a limit does not hide it.
  test.each([
    ["maxHeaderPairs", { maxHeaderPairs: 1 }],
    ["maxHeaderLength", { maxHeaderLength: 8 }],
  ])("a pseudo-header with CR or LF that is past %s fails the stream", async (_, application) => {
    const { server, paths } = await recordingServer({ application });
    await using _server = server;
    const client = await connect(server.address!, clientOptions);
    await client.opened;

    const stream = await client.createBidirectionalStream({ headers: { ...request, ":path": "/a\r\nb" } });
    const closed = await outcome(stream.closed);
    await client.close();

    expect({ closed, paths }).toEqual({ closed: messageError, paths: [] });
  });

  test("request trailers with such a pseudo-header fail the stream", async () => {
    const trailers: unknown[] = [];
    const published: unknown[] = [];
    const publish = (message: any) => published.push({ ...message.trailers });
    subscribe("quic.stream.trailers", publish);
    using _subscription = { [Symbol.dispose]: () => void unsubscribe("quic.stream.trailers", publish) };
    const { server, paths, streams } = await recordingServer({
      ontrailers: (block: Record<string, any>) => trailers.push({ ...block }),
    });
    await using _server = server;
    const client = await connect(server.address!, clientOptions);
    await client.opened;

    const stream = await client.createBidirectionalStream();
    stream.sendHeaders({ ...request, ":path": "/trailers" });
    // sendTrailers() refuses a pseudo-header. Kind 2 is a trailers block.
    quicSendRawHeaders(stream, ["x-ok", "kept", ":path", "/a\r\nb"], 2, 0);
    // How the client's side ends depends on what the server had sent by then.
    await outcome(stream.closed);
    const closed = await outcome(streams[0].closed);
    const after = await statusOf(client, "/after");
    await client.close();

    // The request block is read first, so onheaders runs for it.
    expect({ closed, trailers, published, paths, after }).toEqual({
      closed: messageError,
      trailers: [],
      published: [],
      paths: ["/trailers", "/after"],
      after: "200",
    });
  });

  // The client side of the same rule: the block that fails is part of a response.
  test("a response pseudo-header with CR or LF fails that stream and no other", async () => {
    await using server = await listen(quietSession, {
      ...serverOptions,
      onheaders(this: any, headers: Record<string, any>) {
        switch (headers[":path"]) {
          case "/final":
            this.sendHeaders({ ":status": "2\r0" }, { terminal: true });
            break;
          case "/interim":
            this.sendInformationalHeaders({ ":status": "1\r3" });
            this.sendHeaders({ ":status": "200" }, { terminal: true });
            break;
          case "/trailers":
            this.sendHeaders({ ":status": "200" });
            this.writer.endSync();
            break;
          default:
            this.sendHeaders({ ":status": "200" }, { terminal: true });
        }
      },
      onwanttrailers(this: any) {
        // sendTrailers() refuses a pseudo-header. Kind 2 is a trailers block.
        quicSendRawHeaders(this, [":path", "/a\r\nb"], 2, 0);
      },
    });
    const client = await connect(server.address!, clientOptions);
    await client.opened;

    const seen: Record<string, unknown> = {};
    for (const path of ["/final", "/interim", "/trailers"]) {
      const calls: string[] = [];
      const stream = await client.createBidirectionalStream({
        headers: { ...request, ":path": path },
        oninfo: () => calls.push("info"),
        onheaders: () => calls.push("headers"),
        ontrailers: () => calls.push("trailers"),
      });
      seen[path] = { closed: await outcome(stream.closed), calls };
    }
    seen.after = await statusOf(client, "/after");
    await client.close();

    expect(seen).toEqual({
      "/final": { closed: messageError, calls: [] },
      "/interim": { closed: messageError, calls: [] },
      // The response block is read before its trailers.
      "/trailers": { closed: messageError, calls: ["headers"] },
      after: "200",
    });
  });

  // nghttp3 checks a field before Node counts it against maxHeaderPairs.
  test("a field that is left out does not count against maxHeaderPairs", async () => {
    let received: Record<string, string> | undefined;
    await using server = await listen(quietSession, {
      ...serverOptions,
      // Room for the four pseudo-headers and one more field.
      application: { maxHeaderPairs: 5 },
      onheaders(this: any, headers: Record<string, any>) {
        received = { ...headers };
        this.sendHeaders({ ":status": "200" }, { terminal: true });
      },
    } as SessionOptions);
    const client = await connect(server.address!, clientOptions);
    await client.opened;

    const stream = await client.createBidirectionalStream({
      headers: { ...request, "x-bad": "a\r\nb", "x-ok": "kept" },
    });
    stream.closed.catch(() => {});
    await stream.closed;
    await client.close();

    expect(received).toEqual({ ...request, "x-ok": "kept" });
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
