// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { quicSendRawHeaders } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { sensitiveHeaders } from "node:http2";
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

// RFC 9114 10.3: CR, LF and NUL are not valid in a field. These tests put CR
// and LF on the wire. Nothing in bun can frame a NUL in an HTTP/3 field.
describe("HTTP/3 fields that hold CR or LF", () => {
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
  const wireValues = [
    ["CR LF", "a\r\nb: c"],
    ["LF", "a\nb"],
    ["CR", "a\rb"],
  ];

  // nghttp3 takes such a field out of the block and delivers the rest, and
  // fails the message when the field is a pseudo-header.
  describe("received", () => {
    // QUIC_STREAM_HEADERS_KIND_* and QUIC_STREAM_HEADERS_FLAGS_TERMINAL of the node:quic binding.
    const HINTS = 0;
    const INITIAL = 1;
    const TRAILING = 2;
    const TERMINAL = 1;
    // Puts a block on the wire as it is: sendHeaders() and its siblings refuse these fields.
    const sendRaw = (stream: any, fields: Record<string, string>, kind: number, flags = 0) =>
      quicSendRawHeaders(stream, Object.entries(fields).flat(), kind, flags);

    test.each(wireValues)(
      "a field value with %s is removed from every kind of block and the rest is delivered",
      async (_, bad) => {
        const seen: Record<string, unknown> = {};
        const requestTrailers = Promise.withResolvers<Record<string, string>>();
        const responseTrailers = Promise.withResolvers<Record<string, string>>();
        await using server = await listen(quietSession, {
          ...serverOptions,
          onheaders(this: any, headers: Record<string, any>) {
            seen.request = { ...headers };
            sendRaw(this, { ":status": "103", "x-bad": bad, "x-ok": "info" }, HINTS);
            sendRaw(this, { ":status": "200", "x-bad": bad, "x-ok": "response" }, INITIAL);
            this.writer.writeSync(encoder.encode("body"));
            this.writer.endSync();
          },
          ontrailers(this: any, trailers: Record<string, any>) {
            requestTrailers.resolve({ ...trailers });
          },
          onwanttrailers(this: any) {
            // The only field of this block is the one that is removed.
            sendRaw(this, { "x-bad": bad }, TRAILING);
          },
        });
        const client = await connect(server.address!, clientOptions);
        await client.opened;

        const stream: any = await client.createBidirectionalStream({
          oninfo: (headers: Record<string, any>) => (seen.info = { ...headers }),
          onheaders: (headers: Record<string, any>) => (seen.response = { ...headers }),
          ontrailers: (trailers: Record<string, any>) => responseTrailers.resolve({ ...trailers }),
        });
        stream.closed.catch(() => {});
        sendRaw(stream, { ...request, "x-bad": bad, "x-ok": "request" }, INITIAL);
        sendRaw(stream, { "x-bad": bad, "x-ok": "request trailers" }, TRAILING);
        let body = "";
        for await (const batch of stream) {
          for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
        }
        seen.body = body;
        seen.responseGetter = { ...stream.headers };
        seen.requestTrailers = await requestTrailers.promise;
        seen.responseTrailers = await responseTrailers.promise;
        client.close();

        expect(seen).toEqual({
          request: { ...request, "x-ok": "request" },
          requestTrailers: { "x-ok": "request trailers" },
          info: { ":status": "103", "x-ok": "info" },
          response: { ":status": "200", "x-ok": "response" },
          responseGetter: { ":status": "200", "x-ok": "response" },
          responseTrailers: {},
          body: "body",
        });
      },
    );

    // What the server's application gets for one request block.
    async function requestSeenByServer(fields: Record<string, string>, options: object = {}) {
      const seen = Promise.withResolvers<Record<string, string>>();
      await using server = await listen(quietSession, {
        ...serverOptions,
        ...options,
        onheaders(this: any, headers: Record<string, any>) {
          seen.resolve({ ...headers });
          this.sendHeaders({ ":status": "200" }, { terminal: true });
        },
      } as SessionOptions);
      const client = await connect(server.address!, clientOptions);
      await client.opened;
      const stream = await client.createBidirectionalStream();
      stream.closed.catch(() => {});
      sendRaw(stream, fields, INITIAL, TERMINAL);
      const headers = await seen.promise;
      client.close();
      return headers;
    }

    test("a field name with CR LF is removed", async () => {
      expect(await requestSeenByServer({ ...request, "x-a\r\nx-b": "v", "x-ok": "kept" })).toEqual({
        ...request,
        "x-ok": "kept",
      });
    });

    // nghttp3 checks a field before Node counts it against maxHeaderPairs.
    test("a removed field does not count against maxHeaderPairs", async () => {
      // Room for the four pseudo-headers and one more field.
      const options = { application: { maxHeaderPairs: 5 } };
      expect(await requestSeenByServer({ ...request, "x-bad": "a\r\nb", "x-ok": "kept" }, options)).toEqual({
        ...request,
        "x-ok": "kept",
      });
    });

    test("a pseudo-header value with CR LF fails the connection with H3_MESSAGE_ERROR", async () => {
      const paths: string[] = [];
      await using server = await listen(
        (serverSession: any) => {
          serverSession.onerror = () => {};
          serverSession.onstream = (stream: any) => {
            stream.closed.catch(() => {});
          };
          serverSession.closed.catch(() => {});
        },
        {
          ...serverOptions,
          onheaders(this: any, headers: Record<string, any>) {
            paths.push(headers[":path"]);
            this.sendHeaders({ ":status": "200" }, { terminal: true });
          },
        },
      );

      // The response status, or how the session closed.
      const exchange = async (path: string) => {
        const client = await connect(server.address!, { ...clientOptions, onerror() {} } as SessionOptions);
        const closed = client.closed.then(
          () => "closed",
          (err: any) => `${err.code} 0x${err.errorCode.toString(16)}`,
        );
        await client.opened;
        const status = Promise.withResolvers<string>();
        const stream = await client.createBidirectionalStream({
          onheaders: (headers: Record<string, any>) => status.resolve(headers[":status"]),
        });
        stream.closed.catch(() => {});
        sendRaw(stream, { ...request, ":path": path }, INITIAL, TERMINAL);
        const outcome = await Promise.race([status.promise, closed]);
        if (!client.destroyed) client.close().catch(() => {});
        return outcome;
      };

      expect({
        malformed: await exchange("/a\r\nb"),
        next: await exchange("/next"),
        paths,
      }).toEqual({
        malformed: "ERR_QUIC_APPLICATION_ERROR 0x10e",
        next: "200",
        paths: ["/next"],
      });
    });
  });

  // Node sends such a value. Bun refuses it where the header is given, as it
  // does for a NUL, and as node:http and node:http2 do.
  describe("sent", () => {
    const values = [
      ...wireValues,
      // A header goes on the wire as the low byte of each code unit, and the
      // low bytes of U+560D and U+560A are CR and LF.
      ["code units whose low bytes are CR LF", "a\u560D\u560Ab: c"],
    ];
    const refused = (field: string) => `TypeError ERR_INVALID_CHAR: Invalid character in header content ["${field}"]`;
    const outcome = (send: () => unknown) => {
      try {
        return send();
      } catch (err: any) {
        return `${err.name} ${err.code}: ${err.message}`;
      }
    };

    test.each(values)(
      "%s: sendHeaders(), sendInformationalHeaders() and sendTrailers() throw and send nothing",
      async (_, bad) => {
        const requests: Record<string, string>[] = [];
        const info: Record<string, string>[] = [];
        const responses: Record<string, string>[] = [];
        const trailers = Promise.withResolvers<Record<string, string>>();
        const fromServer: Record<string, unknown> = {};
        await using server = await listen(quietSession, {
          ...serverOptions,
          onheaders(this: any, headers: Record<string, any>) {
            requests.push({ ...headers });
            fromServer.sendInformationalHeaders = outcome(() =>
              this.sendInformationalHeaders({ ":status": "103", "x-a": bad }),
            );
            fromServer.sendHeaders = outcome(() => this.sendHeaders({ ":status": "200", "x-a": bad }));
            this.sendHeaders({ ":status": "200" });
            this.writer.endSync();
          },
          onwanttrailers(this: any) {
            fromServer.sendTrailers = outcome(() => this.sendTrailers({ "x-a": bad }));
            this.sendTrailers({ "x-ok": "trailers" });
          },
        });
        const client = await connect(server.address!, clientOptions);
        const stream: any = await client.createBidirectionalStream({
          oninfo: (headers: Record<string, any>) => info.push({ ...headers }),
          onheaders: (headers: Record<string, any>) => responses.push({ ...headers }),
          ontrailers: (headers: Record<string, any>) => trailers.resolve({ ...headers }),
        });
        stream.closed.catch(() => {});
        const fromClient = () => ({
          sendHeaders: outcome(() => stream.sendHeaders({ ...request, "x-a": bad })),
          arrayValue: outcome(() => stream.sendHeaders({ ...request, "x-a": ["ok", bad] })),
          pseudoHeader: outcome(() => stream.sendHeaders({ ...request, ":path": bad })),
          sendTrailers: outcome(() => stream.sendTrailers({ "x-a": bad })),
        });
        // The handshake is not done, so the stream is not open yet.
        const pending = { pending: stream.pending, ...fromClient() };
        await client.opened;
        const open = { pending: stream.pending, ...fromClient() };

        stream.sendHeaders(request, { terminal: true });
        for await (const _ of stream);
        const results = { pending, open, fromServer, requests, info, responses, trailers: await trailers.promise };
        client.close();

        const clientRefusals = {
          sendHeaders: refused("x-a"),
          arrayValue: refused("x-a"),
          pseudoHeader: refused(":path"),
          sendTrailers: refused("x-a"),
        };
        expect(results).toEqual({
          pending: { pending: true, ...clientRefusals },
          open: { pending: false, ...clientRefusals },
          fromServer: {
            sendInformationalHeaders: refused("x-a"),
            sendHeaders: refused("x-a"),
            sendTrailers: refused("x-a"),
          },
          // Only the blocks that hold no CR and no LF are on the wire.
          requests: [request],
          info: [],
          responses: [{ ":status": "200" }],
          trailers: { "x-ok": "trailers" },
        });
      },
    );

    // The other checks of sendHeaders() come first, as they do in Node. Among
    // values with CR or LF, the first one in the block is named, and a block
    // has its pseudo-headers first.
    test("which error a block with more than one bad field gets", async () => {
      await using server = await listen(quietSession, serverOptions);
      const client = await connect(server.address!, clientOptions);
      await client.opened;
      const stream: any = await client.createBidirectionalStream();
      stream.closed.catch(() => {});
      const results = {
        name: outcome(() => stream.sendHeaders({ ...request, "x-a": "a\rb", "x b": "v" })),
        connectionHeader: outcome(() => stream.sendHeaders({ ...request, "x-a": "a\rb", connection: "close" })),
        nul: outcome(() => stream.sendHeaders({ ...request, "x-a": "a\rb", "x-n": "a\0b" })),
        pseudoHeader: outcome(() => stream.sendHeaders({ "x-a": "a\rb", ...request, ":path": "/\n" })),
        first: outcome(() => stream.sendHeaders({ ...request, ":method": "GE\rT", "x-a": "a\nb" })),
        last: outcome(() => stream.sendHeaders({ ...request, "x-a": "ok", "x-last": "a\nb" })),
        // One value with a code unit above U+00FF makes the whole block a 16-bit string.
        wideBlock: outcome(() => stream.sendHeaders({ ...request, "x-w": "\u4E2D", "x-a": "a\rb" })),
        // U+0100 is a NUL on the wire. The name comes from the block before that, so
        // it is the key, and never a piece of a value.
        afterNarrowedNul: outcome(() => stream.sendHeaders({ ...request, "x-n": "v\u0100", "x-a": "w\r" })),
        sameValueAsNarrowedNul: outcome(() => stream.sendHeaders({ ...request, "x-a": "secret\u0100tail\r" })),
      };
      stream.destroy();
      client.close();

      expect(results).toEqual({
        name: 'TypeError ERR_INVALID_HTTP_TOKEN: Header name must be a valid HTTP token ["x b"]',
        connectionHeader:
          'TypeError ERR_HTTP2_INVALID_CONNECTION_HEADERS: HTTP/1 Connection specific headers are forbidden: "connection"',
        nul: refused("x-n"),
        pseudoHeader: refused(":path"),
        first: refused(":method"),
        last: refused("x-last"),
        wideBlock: refused("x-a"),
        afterNarrowedNul: refused("x-a"),
        sameValueAsNarrowedNul: refused("x-a"),
      });
    });

    // U+0100 ends the value of `x-a` one byte early. `x-a` is not indexed, so
    // its flags byte is 1, and the split takes that byte as the start of the
    // next name. The number of headers does not change.
    test("a value that ends early on the wire does not move the split of the next header", async () => {
      const requests: Record<string, string>[] = [];
      await using server = await listen(quietSession, {
        ...serverOptions,
        onheaders(this: any, headers: Record<string, any>) {
          requests.push({ ...headers });
          this.sendHeaders({ ":status": "200" }, { terminal: true });
        },
      });
      const client = await connect(server.address!, clientOptions);
      await client.opened;

      const spliced = await client.createBidirectionalStream();
      const sent = spliced.sendHeaders({ ...request, "x-a": "v\u0100", "x-b": "w", [sensitiveHeaders]: ["x-a"] });
      // HTTP/3 delivers this request after anything the first stream sent.
      const answered = Promise.withResolvers<void>();
      await client.createBidirectionalStream({ headers: request, onheaders: () => answered.resolve() });
      await answered.promise;
      // Nothing else ends a stream whose headers were refused.
      spliced.destroy();
      client.close();

      expect({ sent, requests }).toEqual({ sent: false, requests: [request] });
    });

    test("a destroyed stream and a session without headers answer as they do for any value", async () => {
      const bad = { ...request, "x-a": "a\r\nb" };
      await using server = await listen(quietSession, serverOptions);
      const client = await connect(server.address!, clientOptions);
      await client.opened;
      const destroyed = await client.createBidirectionalStream();
      destroyed.destroy();

      await using rawServer = await listen(quietSession, { ...serverOptions, alpn: ["quic-test"] });
      const rawClient = await connect(rawServer.address!, { ...clientOptions, alpn: "quic-test" } as SessionOptions);
      await rawClient.opened;
      const noHeaders = await rawClient.createBidirectionalStream();
      noHeaders.closed.catch(() => {});

      const results = {
        destroyed: outcome(() => destroyed.sendHeaders(bad)),
        noHeaders: outcome(() => noHeaders.sendHeaders(bad)),
      };
      client.close();
      rawClient.close();

      expect(results).toEqual({
        destroyed: false,
        noHeaders:
          "Error ERR_INVALID_STATE: Invalid state: The negotiated QUIC application protocol does not support headers",
      });
    });
  });

  // sendHeaders() and sendTrailers() throw for these values. These are the two
  // callers inside node:quic that the throw goes through.
  describe.each([
    ["NUL", "a\0b"],
    ["CR LF", "a\r\nb: c"],
    ["code units whose low bytes are CR LF", "a\u560D\u560Ab: c"],
  ])("a header value with %s, where node:quic sends the block itself", (_, bad) => {
    // Longer than the test: an idle timeout must not be what ends a session here.
    const transportParams = { maxIdleTimeout: 60 };

    test("create*Stream({ headers }) rejects and leaves no stream that keeps the session open", async () => {
      await using server = await listen(quietSession, { ...serverOptions, transportParams });
      const client = await connect(server.address!, { ...clientOptions, transportParams } as SessionOptions);
      await client.opened;

      const headers = { ...request, "x-bad": bad };
      const code = (err: any) => err.code;
      const rejections = {
        bidirectional: await client.createBidirectionalStream({ headers }).then(() => "resolved", code),
        unidirectional: await client.createUnidirectionalStream({ headers }).then(() => "resolved", code),
      };
      // A graceful close waits for every open stream.
      await client.close();

      expect(rejections).toEqual({ bidirectional: "ERR_INVALID_CHAR", unidirectional: "ERR_INVALID_CHAR" });
    });

    test("pendingTrailers destroys the stream with the error", async () => {
      const serverStreamClosed = Promise.withResolvers<string>();
      await using server = await listen(
        async serverSession => {
          serverSession.onstream = (stream: any) => {
            stream.closed.then(
              () => serverStreamClosed.resolve("resolved"),
              (err: any) => serverStreamClosed.resolve(err.code),
            );
          };
          await serverSession.closed.catch(() => {});
        },
        {
          ...serverOptions,
          transportParams,
          onheaders(this: any) {
            this.sendHeaders({ ":status": "200" });
            this.pendingTrailers = { "x-bad": bad };
            this.writer.writeSync(encoder.encode("body"));
            this.writer.endSync();
          },
          // A stream is asked for its trailers only when this is set.
          onwanttrailers() {},
        },
      );
      const client = await connect(server.address!, { ...clientOptions, transportParams } as SessionOptions);
      await client.opened;

      const stream: any = await client.createBidirectionalStream({ headers: request, onheaders() {} });
      stream.closed.catch(() => {});
      // The trailers would have ended the response. Without them, the destroy does.
      let body = "";
      for await (const batch of stream) {
        for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
      }

      expect({ server: await serverStreamClosed.promise, body }).toEqual({ server: "ERR_INVALID_CHAR", body: "body" });
      await client.close();
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
