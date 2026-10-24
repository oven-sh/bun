// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, withoutAsanQuarantine } from "harness";
import { createPrivateKey } from "node:crypto";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
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

// The native stream delivers a received header block only while its
// `wantsHeaders` flag is set, and asks for trailers only while `wantsTrailers`
// is. Every callback and property that needs one of the two has to set it.
describe("HTTP/3 header and trailers interest", () => {
  const encoder = new TextEncoder();
  const bytes = () => encoder.encode("body");
  const OK = { ":status": "200" };
  const TRAILERS = { "x-checksum": "abc123" };
  const tls = { sni: { "*": { keys: [key], certs: [cert] } }, transportParams: { maxIdleTimeout: 2 } };
  const request = (path: string) => ({
    ":method": "GET",
    ":path": path,
    ":scheme": "https",
    ":authority": "localhost",
  });
  const serve = async (serverSession: any) => {
    serverSession.onstream = (stream: any) => {
      stream.closed.catch(() => {});
    };
    await serverSession.closed.catch(() => {});
  };
  const connectTo = async (server: QuicEndpoint): Promise<any> => {
    const client = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 2 },
    } as SessionOptions);
    await client.opened;
    return client;
  };
  // A stream that never ends fails here, when the idle timeout closes its session.
  async function bodyOf(stream: any) {
    let body = "";
    for await (const batch of stream) {
      for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
    }
    await stream.closed;
    return body;
  }
  // One response, as a client with both callbacks sees it.
  async function response(client: any, path: string): Promise<{ body?: string; trailers?: object; error?: string }> {
    let trailers: object | undefined;
    const stream = await client.createBidirectionalStream({
      headers: request(path),
      onheaders() {},
      ontrailers: (block: object) => void (trailers = { ...block }),
    });
    stream.closed.catch(() => {});
    try {
      const body = await bodyOf(stream);
      return { body, trailers };
    } catch (error: any) {
      return { error: error?.code ?? String(error) };
    }
  }

  test("a client gets trailers and interim responses without onheaders", async () => {
    await using server = await listen(serve, {
      ...tls,
      onheaders(this: any) {
        this.sendInformationalHeaders({ ":status": "103", link: "</style.css>; rel=preload" });
        this.sendHeaders(OK);
        this.writer.writeSync(bytes());
        this.writer.endSync();
      },
      onwanttrailers(this: any) {
        this.sendTrailers(TRAILERS);
      },
    });
    const client = await connectTo(server);

    // The header blocks that reach JS for each client stream, by diagnostics channel.
    const published = new Map<unknown, string[]>();
    const unsubscribers = ["info", "headers", "trailers"].map(name => {
      const onMessage = (message: any) => void published.get(message.stream)?.push(name);
      subscribe(`quic.stream.${name}`, onMessage);
      return () => unsubscribe(`quic.stream.${name}`, onMessage);
    });

    type Seen = { onheaders: number; info?: string; trailers?: object; status?: string };
    const callbacks = (seen: Seen) => ({
      onheaders: () => void seen.onheaders++,
      oninfo: (block: Record<string, string>) => void (seen.info = block[":status"]),
      ontrailers(this: any, block: object) {
        seen.trailers = { ...block };
        // A closed stream no longer has its headers, so they are read here.
        seen.status = this.headers?.[":status"];
      },
    });
    async function exchange(register: (seen: Seen) => { options?: object; afterCreate?: (stream: any) => void }) {
      const seen: Seen = { onheaders: 0 };
      const { options, afterCreate } = register(seen);
      const stream = await client.createBidirectionalStream({ headers: request("/"), ...options });
      published.set(stream, []);
      afterCreate?.(stream);
      const body = await bodyOf(stream);
      return { ...seen, body, published: published.get(stream) };
    }

    try {
      const results = {
        "ontrailers option": await exchange(seen => ({ options: { ontrailers: callbacks(seen).ontrailers } })),
        "ontrailers setter": await exchange(seen => ({
          afterCreate: stream => void (stream.ontrailers = callbacks(seen).ontrailers),
        })),
        "oninfo option": await exchange(seen => ({ options: { oninfo: callbacks(seen).oninfo } })),
        "oninfo setter": await exchange(seen => ({
          afterCreate: stream => void (stream.oninfo = callbacks(seen).oninfo),
        })),
        "onheaders cleared": await exchange(seen => ({
          options: callbacks(seen),
          afterCreate: stream => void (stream.onheaders = undefined),
        })),
        "no callback": await exchange(() => ({})),
      };
      const everyBlock = ["info", "headers", "trailers"];
      expect(results).toEqual({
        "ontrailers option": { onheaders: 0, trailers: TRAILERS, status: "200", body: "body", published: everyBlock },
        "ontrailers setter": { onheaders: 0, trailers: TRAILERS, status: "200", body: "body", published: everyBlock },
        "oninfo option": { onheaders: 0, info: "103", body: "body", published: everyBlock },
        "oninfo setter": { onheaders: 0, info: "103", body: "body", published: everyBlock },
        "onheaders cleared": {
          onheaders: 0,
          info: "103",
          trailers: TRAILERS,
          status: "200",
          body: "body",
          published: everyBlock,
        },
        "no callback": { onheaders: 0, body: "body", published: [] },
      });
    } finally {
      for (const off of unsubscribers) off();
      client.close();
    }
  });

  test("a server gets request trailers without onheaders", async () => {
    const results: Record<string, unknown> = {};
    for (const how of ["listen() option", "setter in onstream"]) {
      let trailers: object | undefined;
      const ontrailers = (block: object) => void (trailers = { ...block });
      const atClose = Promise.withResolvers<unknown>();
      await using server = await listen(
        async serverSession => {
          serverSession.onstream = (stream: any) => {
            if (how === "setter in onstream") stream.ontrailers = ontrailers;
            stream.sendHeaders(OK, { terminal: true });
            stream.closed.then(() => atClose.resolve(trailers), atClose.reject);
          };
          await serverSession.closed.catch(() => {});
        },
        how === "listen() option" ? { ...tls, ontrailers } : tls,
      );
      const client = await connectTo(server);
      const stream = await client.createBidirectionalStream();
      stream.sendHeaders(request("/"));
      stream.sendTrailers(TRAILERS);
      await bodyOf(stream);
      results[how] = await atClose.promise;
      client.close();
    }
    expect(results).toEqual({ "listen() option": TRAILERS, "setter in onstream": TRAILERS });
  });

  test("a response asks for trailers whichever way its body is given", async () => {
    const bodies: Record<string, (stream: any) => void> = {
      "writer": stream => {
        stream.sendHeaders(OK);
        stream.writer.writeSync(bytes());
        stream.writer.endSync();
      },
      "setBody(view)": stream => {
        stream.sendHeaders(OK);
        stream.setBody(bytes());
      },
      "setBody(string)": stream => {
        stream.sendHeaders(OK);
        stream.setBody("body");
      },
      "setBody(iterable)": stream => {
        stream.sendHeaders(OK);
        stream.setBody([bytes()]);
      },
      // setOutbound() refuses a stream that has sent its headers.
      "setOutbound(view)": stream => {
        stream.setOutbound(bytes());
        stream.sendHeaders(OK);
      },
    };
    const providers: Record<string, (stream: any) => void> = {
      "nothing": () => {},
      "onwanttrailers": stream => {
        stream.onwanttrailers = () => stream.sendTrailers(TRAILERS);
      },
      "pendingTrailers": stream => {
        stream.pendingTrailers = TRAILERS;
      },
    };
    await using server = await listen(serve, {
      ...tls,
      onheaders(this: any, headers: Record<string, any>) {
        const [, body, provider] = headers[":path"].split("/");
        Object.values(providers)[+provider](this);
        Object.values(bodies)[+body](this);
      },
    });
    const client = await connectTo(server);

    const results: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const [b, body] of Object.keys(bodies).entries()) {
      for (const [p, provider] of Object.keys(providers).entries()) {
        results[`${body} with ${provider}`] = await response(client, `/${b}/${p}`);
        expected[`${body} with ${provider}`] = {
          body: "body",
          trailers: provider === "nothing" ? undefined : TRAILERS,
        };
      }
    }
    client.close();
    expect(results).toEqual(expected);
  });

  test("the choice between a FIN and trailers is made once the body has been sent", async () => {
    const end = (stream: any) => {
      stream.writer.writeSync(bytes());
      stream.writer.endSync();
    };
    const scripts: Record<string, (stream: any) => void> = {
      "pendingTrailers set after endSync()": stream => {
        end(stream);
        stream.pendingTrailers = TRAILERS;
      },
      "onwanttrailers set after setBody()": stream => {
        stream.setBody(bytes());
        stream.onwanttrailers = () => stream.sendTrailers(TRAILERS);
      },
      "onwanttrailers cleared after endSync()": stream => {
        stream.onwanttrailers = () => stream.sendTrailers(TRAILERS);
        end(stream);
        stream.onwanttrailers = undefined;
      },
      "pendingTrailers cleared before endSync()": stream => {
        stream.pendingTrailers = TRAILERS;
        stream.pendingTrailers = undefined;
        end(stream);
      },
      "pendingTrailers cleared after endSync()": stream => {
        stream.pendingTrailers = TRAILERS;
        end(stream);
        stream.pendingTrailers = undefined;
      },
      "pendingTrailers and onwanttrailers": stream => {
        stream.onwanttrailers = () => stream.sendTrailers({ "x-from": "onwanttrailers" });
        stream.pendingTrailers = TRAILERS;
        end(stream);
      },
    };
    await using server = await listen(serve, {
      ...tls,
      onheaders(this: any, headers: Record<string, any>) {
        const [, script, when] = headers[":path"].split("/");
        this.sendHeaders(OK);
        const run = () => Object.values(scripts)[+script](this);
        // From a callback the body is flushed when the callback returns. From
        // here endSync() flushes it, so the request for trailers is already
        // queued when the script withdraws its interest.
        if (when === "later") setImmediate(run);
        else run();
      },
    });
    const client = await connectTo(server);

    const results: Record<string, unknown> = {};
    for (const [index, name] of Object.keys(scripts).entries()) {
      results[name] = await response(client, `/${index}/now`);
    }
    const cleared = Object.keys(scripts).indexOf("onwanttrailers cleared after endSync()");
    results["onwanttrailers cleared after endSync(), outside a callback"] = await response(client, `/${cleared}/later`);
    client.close();
    expect(results).toEqual({
      "pendingTrailers set after endSync()": { body: "body", trailers: TRAILERS },
      "onwanttrailers set after setBody()": { body: "body", trailers: TRAILERS },
      "onwanttrailers cleared after endSync()": { body: "body" },
      "pendingTrailers cleared before endSync()": { body: "body" },
      "pendingTrailers cleared after endSync()": { body: "body" },
      "pendingTrailers and onwanttrailers": { body: "body", trailers: TRAILERS },
      "onwanttrailers cleared after endSync(), outside a callback": { body: "body" },
    });
  });

  test("a request whose body is given at creation asks for trailers", async () => {
    let trailers: object | undefined;
    const atClose = Promise.withResolvers<unknown>();
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.closed.then(() => atClose.resolve(trailers), atClose.reject);
        };
        await serverSession.closed.catch(() => {});
      },
      {
        ...tls,
        onheaders(this: any) {
          this.sendHeaders(OK, { terminal: true });
        },
        ontrailers: (block: object) => void (trailers = { ...block }),
      },
    );
    const client = await connectTo(server);
    const stream = await client.createBidirectionalStream({
      headers: { ...request("/"), ":method": "POST" },
      body: bytes(),
      onwanttrailers(this: any) {
        this.sendTrailers(TRAILERS);
      },
    });
    await bodyOf(stream);
    client.close();
    expect(await atClose.promise).toEqual(TRAILERS);
  });

  // A unidirectional stream has no header blocks, so a request could not be answered.
  test("a unidirectional stream is never asked for trailers", async () => {
    await using server = await listen(serve, {
      ...tls,
      transportParams: { maxIdleTimeout: 2, initialMaxStreamsUni: 16 },
    });
    const client = await connectTo(server);
    const results: Record<string, unknown> = {};
    for (const provider of ["onwanttrailers", "pendingTrailers"]) {
      let asked = 0;
      const stream = await client.createUnidirectionalStream();
      if (provider === "onwanttrailers") stream.onwanttrailers = () => void asked++;
      else stream.pendingTrailers = TRAILERS;
      stream.writer.writeSync(bytes());
      stream.writer.endSync();
      const closed = await stream.closed.then(
        () => "resolved",
        (error: any) => `rejected: ${error.code}`,
      );
      results[provider] = { closed, asked };
    }
    client.close();
    expect(results).toEqual({
      onwanttrailers: { closed: "resolved", asked: 0 },
      pendingTrailers: { closed: "resolved", asked: 0 },
    });
  });

  test("pendingTrailers that can't be sent reject closed without onwanttrailers", async () => {
    const closed = Promise.withResolvers<unknown>();
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.closed.then(() => closed.resolve("resolved"), closed.resolve);
        };
        await serverSession.closed.catch(() => {});
      },
      {
        ...tls,
        onheaders(this: any) {
          this.sendHeaders(OK);
          this.pendingTrailers = { connection: "close" };
          this.writer.writeSync(bytes());
          this.writer.endSync();
        },
      },
    );
    const client = await connectTo(server);
    const seen = await response(client, "/");
    client.close();
    expect({ seen, closed: await closed.promise }).toEqual({
      seen: { body: "body" },
      closed: expect.objectContaining({ code: "ERR_HTTP2_INVALID_CONNECTION_HEADERS" }),
    });
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
