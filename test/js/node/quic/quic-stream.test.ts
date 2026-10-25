// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, expectRssDeltaBelow, runCommandMaxRSS, tempDir, withoutAsanQuarantine } from "harness";
import { createPrivateKey } from "node:crypto";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen, QuicEndpoint, type SessionOptions } from "node:quic";
import { Worker } from "node:worker_threads";

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

// Native code only passes a received header block to JS while the stream's `wantsHeaders` flag is set.
describe("HTTP/3 header callbacks without onheaders", () => {
  const encoder = new TextEncoder();
  const TRAILERS = { "x-checksum": "abc123" };
  const tls = { sni: { "*": { keys: [key], certs: [cert] } }, transportParams: { maxIdleTimeout: 2 } };
  const request = { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" };
  const connectTo = async (server: QuicEndpoint): Promise<any> => {
    const client = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 2 },
    } as SessionOptions);
    await client.opened;
    return client;
  };
  async function bodyOf(stream: any) {
    let body = "";
    for await (const batch of stream) {
      for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
    }
    await stream.closed;
    return body;
  }

  type Seen = { onheaders: number; info?: string; trailers?: object; status?: string };
  type Register = (seen: Seen) => { options?: object; afterCreate?: (stream: any) => void };
  const callbacks = (seen: Seen) => ({
    onheaders: () => void seen.onheaders++,
    oninfo: (block: Record<string, string>) => void (seen.info = block[":status"]),
    ontrailers(this: any, block: object) {
      seen.trailers = { ...block };
      seen.status = this.headers?.[":status"];
    },
  });
  const everyBlock = ["info", "headers", "trailers"];
  const withTrailers = { onheaders: 0, trailers: TRAILERS, status: "200", published: everyBlock };
  const withInfo = { onheaders: 0, info: "103", published: everyBlock };
  const rows: [name: string, register: Register, expected: Seen & { published: string[] }][] = [
    ["ontrailers as an option", seen => ({ options: { ontrailers: callbacks(seen).ontrailers } }), withTrailers],
    [
      "ontrailers assigned after creation",
      seen => ({ afterCreate: stream => void (stream.ontrailers = callbacks(seen).ontrailers) }),
      withTrailers,
    ],
    ["oninfo as an option", seen => ({ options: { oninfo: callbacks(seen).oninfo } }), withInfo],
    [
      "oninfo assigned after creation",
      seen => ({ afterCreate: stream => void (stream.oninfo = callbacks(seen).oninfo) }),
      withInfo,
    ],
    [
      "onheaders cleared, ontrailers and oninfo kept",
      seen => ({ options: callbacks(seen), afterCreate: stream => void (stream.onheaders = undefined) }),
      { ...withTrailers, info: "103" },
    ],
    [
      "ontrailers and oninfo cleared",
      seen => ({
        options: { ontrailers: callbacks(seen).ontrailers, oninfo: callbacks(seen).oninfo },
        afterCreate: stream => void (stream.ontrailers = stream.oninfo = undefined),
      }),
      { onheaders: 0, published: [] },
    ],
    ["no header callback", () => ({}), { onheaders: 0, published: [] }],
  ];

  test.each(rows)("a client with %s", async (_name, register, expected) => {
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.closed.catch(() => {});
        };
        await serverSession.closed.catch(() => {});
      },
      {
        ...tls,
        onheaders(this: any) {
          this.sendInformationalHeaders({ ":status": "103", link: "</style.css>; rel=preload" });
          this.sendHeaders({ ":status": "200" });
          this.writer.writeSync(encoder.encode("body"));
          this.writer.endSync();
        },
        onwanttrailers(this: any) {
          this.sendTrailers(TRAILERS);
        },
      },
    );
    const client = await connectTo(server);
    // The header blocks that reach JS for the client's stream, by diagnostics channel.
    const published: string[] = [];
    let stream: any;
    const listeners = everyBlock.map(name => {
      const onMessage = (message: any) => void (message.stream === stream && published.push(name));
      subscribe(`quic.stream.${name}`, onMessage);
      return () => unsubscribe(`quic.stream.${name}`, onMessage);
    });
    try {
      const seen: Seen = { onheaders: 0 };
      const { options, afterCreate } = register(seen);
      stream = await client.createBidirectionalStream({ headers: request, ...options });
      afterCreate?.(stream);
      const body = await bodyOf(stream);
      expect({ ...seen, body, published }).toEqual({ ...expected, body: "body" });
    } finally {
      for (const off of listeners) off();
      client.close();
    }
  });

  test.each(["given to listen()", "assigned in onstream"])("a server with ontrailers %s", async how => {
    let trailers: object | undefined;
    const ontrailers = (block: object) => void (trailers = { ...block });
    const closed = Promise.withResolvers<void>();
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          if (how === "assigned in onstream") stream.ontrailers = ontrailers;
          stream.sendHeaders({ ":status": "200" }, { terminal: true });
          stream.closed.then(closed.resolve, closed.reject);
        };
        await serverSession.closed.catch(() => {});
      },
      how === "given to listen()" ? { ...tls, ontrailers } : tls,
    );
    const client = await connectTo(server);
    try {
      const stream = await client.createBidirectionalStream();
      stream.sendHeaders(request);
      stream.sendTrailers(TRAILERS);
      await bodyOf(stream);
      await closed.promise;
      expect(trailers).toEqual(TRAILERS);
    } finally {
      client.close();
    }
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
  const connectTo = async (server: QuicEndpoint, maxIdleTimeout = 1) => {
    const client = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout },
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

  test("a stream that isn't open yet refuses a header block after its trailers", async () => {
    let requestTrailers: Record<string, string> | undefined;
    const first = Promise.withResolvers<() => void>();
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.closed.catch(() => {});
        };
        await serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 10, initialMaxStreamsBidi: 1 },
        onheaders(this: any, headers: Record<string, any>) {
          const respond = () => void this.sendHeaders({ ":status": "200" }, { terminal: true });
          if (headers[":path"] === "/first") first.resolve(respond);
          else respond();
        },
        ontrailers(this: any, trailers: Record<string, any>) {
          requestTrailers = trailers;
        },
      },
    );
    const client = await connectTo(server, 10);
    // The server allows one stream at a time, so the second one opens when the first is done.
    const firstResponse = responseEvents(client, "/first");
    const respondToFirst = await first.promise;
    let status: string | undefined;
    const stream: any = await client.createBidirectionalStream({
      onheaders: (headers: Record<string, string>) => void (status = headers[":status"]),
    } as any);
    const sent = [
      stream.sendHeaders(request("/second")),
      stream.sendTrailers({ "x-checksum": "abc123" }),
      stream.sendTrailers({ "x-more": "1" }),
      stream.sendHeaders(request("/third")),
    ];
    respondToFirst();
    const closed = await stream.closed.then(
      () => "without an error",
      (error: any) => error.code,
    );
    await firstResponse;
    client.close();
    expect({ sent, closed, status, requestTrailers: { ...requestTrailers } }).toEqual({
      sent: [true, true, false, false],
      closed: "without an error",
      status: "200",
      requestTrailers: { "x-checksum": "abc123" },
    });
  });

  // This many bodies fill the congestion window, so lsquic is still buffering the end of some of them when their trailers are sent.
  test.each<[string, number]>([
    ["request", 6],
    ["response", 6],
    ["request", 3000],
    ["response", 3000],
  ])("the peer gets the trailers that follow a %s body (%d-byte value)", async (sender, valueLength) => {
    const streams = 200;
    const size = 1500;
    const checksum = Buffer.alloc(valueLength, "a").toString();
    // Opening the streams can block the event loop for longer than the 1-second idle timeout of the other tests.
    const maxIdleTimeout = 30;
    const received: { bytes: number; checksum?: string }[] = [];
    const receivedAll = Promise.withResolvers<void>();

    function send(stream: any) {
      stream.onwanttrailers = () => stream.sendTrailers({ "x-checksum": checksum });
      stream.writer.writeSync(new Uint8Array(size));
      stream.writer.endSync();
    }
    async function receive(stream: any) {
      const message: (typeof received)[number] = { bytes: 0 };
      stream.ontrailers = (trailers: Record<string, string>) => (message.checksum = trailers["x-checksum"]);
      for await (const batch of stream) for (const chunk of batch) message.bytes += chunk.byteLength;
      await stream.closed;
      if (received.push(message) === streams) receivedAll.resolve();
    }

    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          if (sender === "request") receive(stream).catch(receivedAll.reject);
          else stream.closed.catch(() => {});
        };
        await serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout, initialMaxStreamsBidi: streams },
        onheaders(this: any) {
          this.sendHeaders({ ":status": "200" }, { terminal: sender === "request" });
          if (sender === "response") send(this);
        },
      },
    );
    const client = await connectTo(server, maxIdleTimeout);
    for (let i = 0; i < streams; i++) {
      const stream: any = await client.createBidirectionalStream({ onheaders() {} } as any);
      stream.sendHeaders(request("/"), { terminal: sender === "response" });
      if (sender === "response") receive(stream).catch(receivedAll.reject);
      else {
        stream.closed.catch(() => {});
        send(stream);
      }
    }
    await receivedAll.promise;
    client.close();
    expect(received.filter(message => message.bytes !== size || message.checksum !== checksum)).toEqual([]);
  });

  // The second block leaves the queue in a write event that has nothing else to send, and lsquic holds the
  // part of it that the stream's window has no room for. The stream has to keep its write interest until
  // that part is out, or nothing flushes the end of the block and the client waits for it until the test
  // times out.
  test("a client gets a second interim response while the server has nothing else to send", async () => {
    // Bytes that Huffman coding doesn't shorten.
    const field = (length: number) => Buffer.alloc(length, "~").toString();
    const transportParams = { maxIdleTimeout: 2 };
    const bothSeen = Promise.withResolvers<void>();
    const answered = Promise.withResolvers<boolean[]>();
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.closed.catch(() => {});
        };
        await serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams,
        async onheaders(this: any) {
          const sent = [
            this.sendInformationalHeaders({ ":status": "103", "x-first": field(5000) }),
            this.sendInformationalHeaders({ ":status": "103", "x-second": field(3000) }),
          ];
          await bothSeen.promise;
          answered.resolve([...sent, this.sendHeaders({ ":status": "204" }, { terminal: true })]);
        },
      },
    );
    await using endpoint = new QuicEndpoint();
    // The server's send window on the stream is smaller than either block.
    const client = await connect(server.address!, {
      endpoint,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { ...transportParams, initialMaxStreamDataBidiLocal: 4096 },
      onerror() {},
    } as SessionOptions);
    client.closed.catch(() => {});
    let stream: any;
    try {
      await client.opened;
      const blocks: string[] = [];
      stream = await client.createBidirectionalStream({
        headers: request("/"),
        oninfo: (block: Record<string, string>) => {
          blocks.push(`info ${block[":status"]} ${(block["x-first"] ?? block["x-second"])?.length}`);
          if (blocks.length === 2) bothSeen.resolve();
        },
        onheaders: (block: Record<string, string>) => void blocks.push("headers " + block[":status"]),
      } as any);
      stream.closed.catch(() => {});
      expect(await answered.promise).toEqual([true, true, true]);
      for await (const _ of stream);
      expect(blocks).toEqual(["info 103 5000", "info 103 3000", "headers 204"]);
    } finally {
      stream?.destroy();
      if (!client.destroyed) client.close().catch(() => {});
    }
  });

  // lsquic keeps the part of a header block that the congestion window has no room for, and takes no
  // other header block for that stream until it has sent that part. The blocks that a server sends while
  // it answers the requests of one read share the window, so the later streams of a burst run out of it.
  test("every stream of a burst gets the response that follows its interim response", async () => {
    const streams = 24;
    // About 6 KB a stream: together several times lsquic's initial window of 32 packets.
    const link = Array.from({ length: 128 }, (_, i) => `</assets/chunk-${i}.js>; rel=preload; as=script`).join(", ");
    // Opening the streams can block the event loop for longer than the 1-second idle timeout of the other tests.
    const maxIdleTimeout = 30;
    const sent: boolean[] = [];
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.closed.catch(() => {});
        };
        await serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout, initialMaxStreamsBidi: streams },
        onheaders(this: any) {
          sent.push(this.sendInformationalHeaders({ ":status": "103", link }), this.sendHeaders({ ":status": "200" }));
          this.writer.writeSync(encoder.encode("hello"));
          this.writer.endSync();
        },
      },
    );
    const client = await connectTo(server, maxIdleTimeout);
    // What one stream gets. A stream that the server had to reset ends with the error's code.
    async function response() {
      const events: string[] = [];
      const stream: any = await client.createBidirectionalStream({
        headers: request("/"),
        oninfo: (headers: Record<string, string>) =>
          void events.push(
            `info ${headers[":status"]} ${headers.link === link ? "with its link" : "without its link"}`,
          ),
        onheaders: (headers: Record<string, string>) => void events.push("headers " + headers[":status"]),
      } as any);
      stream.closed.catch(() => {});
      let body = "";
      try {
        for await (const batch of stream) for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
        events.push("body " + body);
      } catch (error: any) {
        events.push("error " + error.code);
      }
      return events.join(", ");
    }
    const responses = await Promise.all(Array.from({ length: streams }, response));
    client.close();
    const complete = "info 103 with its link, headers 200, body hello";
    expect({ refused: sent.filter(taken => !taken).length, responses }).toEqual({
      refused: 0,
      responses: Array.from({ length: streams }, () => complete),
    });
  });

  // One block of this size is more than the window, so lsquic still holds part of it when the calls
  // that follow it in the same turn are made.
  describe.concurrent("behind a block that's larger than the congestion window", () => {
    // About 175 KB as a header block. lsquic's initial window is 32 packets.
    const value = Buffer.alloc(2000, "v").toString();
    const large = (headers: Record<string, string>) => {
      for (let i = 0; i < 100; i++) headers[`x-large-${i}`] = value;
      return headers;
    };
    // The receiver drops the fields that go over the default of 16 KB.
    const application = { maxHeaderLength: 1 << 20 };
    const transportParams = { maxIdleTimeout: 2 };
    const tls = { sni: { "*": { keys: [key], certs: [cert] } }, transportParams, application };
    // "info 103 +100" is an interim response that arrived with its 100 large fields intact.
    const label = (kind: string, block: Record<string, string>) => {
      const intact = Object.values(block).filter(field => field === value).length;
      return [kind, block[":status"] ?? block[":path"] ?? block["x-checksum"], intact && `+${intact}`]
        .filter(Boolean)
        .join(" ");
    };
    const outcome = (closed: Promise<unknown>) =>
      closed.then(
        () => "closed",
        (err: any) => `${err.code} ${err.errorCode}`,
      );
    // An endpoint keeps the limits it was created with, so not the shared one.
    const connectWith = (endpoint: QuicEndpoint, server: QuicEndpoint): Promise<any> =>
      connect(server.address!, {
        endpoint,
        servername: "localhost",
        verifyPeer: "manual",
        transportParams,
        application,
        onerror() {},
      } as SessionOptions);
    // close() waits for a stream that a failed expectation left open.
    function closeWith(client: any, stream: any) {
      stream?.destroy();
      client.close();
    }

    const hint = () => large({ ":status": "103" });
    // What the server's calls returned, the header blocks that the client got in order, and the body.
    type Row = [
      name: string,
      answer: (stream: any) => boolean[] | Promise<boolean[]>,
      sent: boolean[],
      blocks: string[],
      body?: string,
    ];
    const rows: Row[] = [
      [
        "a response with no body",
        stream => [
          stream.sendInformationalHeaders(hint()),
          stream.sendHeaders({ ":status": "204" }, { terminal: true }),
        ],
        [true, true],
        ["info 103 +100", "headers 204"],
      ],
      [
        // lsquic holds the rest of the block until the peer has acknowledged part of it, which takes longer than a turn of the event loop.
        "a response that's sent a turn later",
        async stream => {
          const hinted = stream.sendInformationalHeaders(hint());
          await new Promise(resolve => setImmediate(resolve));
          return [hinted, stream.sendHeaders({ ":status": "204" }, { terminal: true })];
        },
        [true, true],
        ["info 103 +100", "headers 204"],
      ],
      [
        // The response is queued behind two blocks. lsquic still holds the second one when it has sent the first.
        "a second large interim response, a response and its body",
        stream => {
          const sent = [
            stream.sendInformationalHeaders(hint()),
            stream.sendInformationalHeaders(hint()),
            stream.sendHeaders({ ":status": "200" }),
          ];
          stream.writer.writeSync(encoder.encode("hello"));
          stream.writer.endSync();
          return sent;
        },
        [true, true, true],
        ["info 103 +100", "info 103 +100", "headers 200"],
        "hello",
      ],
      [
        // lsquic takes the response when it has sent the interim one, and then holds part of the response in turn.
        // It would put a body that's written then into the response's own frame.
        "a large response and its body",
        stream => {
          const sent = [stream.sendInformationalHeaders(hint()), stream.sendHeaders(large({ ":status": "200" }))];
          stream.writer.writeSync(encoder.encode("hello"));
          stream.writer.endSync();
          return sent;
        },
        [true, true],
        ["info 103 +100", "headers 200 +100"],
        "hello",
      ],
      [
        "a response, its body and the trailers that onwanttrailers sends",
        stream => {
          const sent = [stream.sendInformationalHeaders(hint()), stream.sendHeaders({ ":status": "200" })];
          stream.onwanttrailers = () => void stream.sendTrailers({ "x-checksum": "abc123" });
          stream.writer.writeSync(encoder.encode("hello"));
          stream.writer.endSync();
          return sent;
        },
        [true, true],
        ["info 103 +100", "headers 200", "trailers abc123"],
        "hello",
      ],
      [
        "trailers",
        stream => [stream.sendHeaders(large({ ":status": "200" })), stream.sendTrailers({ "x-checksum": "abc123" })],
        [true, true],
        ["headers 200 +100", "trailers abc123"],
      ],
      [
        // One call sends 128 fields at most. That block isn't queued, so the next call can still answer.
        "a response after one that can't be sent",
        stream => {
          const tooMany: Record<string, string> = { ":status": "200" };
          for (let i = 0; i < 128; i++) tooMany[`x-field-${i}`] = "v";
          return [
            stream.sendInformationalHeaders(hint()),
            stream.sendHeaders(tooMany),
            stream.sendHeaders({ ":status": "500" }, { terminal: true }),
          ];
        },
        [true, false, true],
        ["info 103 +100", "headers 500"],
      ],
      [
        "a large response with no body, but not a block after it",
        stream => [
          stream.sendHeaders(large({ ":status": "200" }), { terminal: true }),
          stream.sendTrailers({ "x-checksum": "abc123" }),
        ],
        [true, false],
        ["headers 200 +100"],
      ],
      [
        // Nothing can follow the block that ends the stream, whether or not lsquic has taken that block yet.
        "a response with no body, but not a block after it",
        stream => [
          stream.sendInformationalHeaders(hint()),
          stream.sendHeaders({ ":status": "204" }, { terminal: true }),
          stream.sendTrailers({ "x-checksum": "abc123" }),
        ],
        [true, true, false],
        ["info 103 +100", "headers 204"],
      ],
    ];

    test.each(rows)("a client gets %s", async (_name, answer, expectedSent, expectedBlocks, expectedBody = "") => {
      const answered = Promise.withResolvers<boolean[]>();
      await using server = await listen(
        async serverSession => {
          serverSession.onstream = (stream: any) => {
            stream.closed.catch(() => {});
          };
          await serverSession.closed.catch(() => {});
        },
        {
          ...tls,
          onheaders(this: any) {
            answered.resolve(answer(this));
          },
        },
      );
      await using endpoint = new QuicEndpoint();
      const client = await connectWith(endpoint, server);
      let stream: any;
      try {
        await client.opened;
        const blocks: string[] = [];
        stream = await client.createBidirectionalStream({
          headers: request("/"),
          oninfo: (block: Record<string, string>) => void blocks.push(label("info", block)),
          onheaders: (block: Record<string, string>) => void blocks.push(label("headers", block)),
          ontrailers: (block: Record<string, string>) => void blocks.push(label("trailers", block)),
        });
        stream.closed.catch(() => {});
        // The stream of a block that the server doesn't take never ends, or ends in a reset.
        expect(await answered.promise).toEqual(expectedSent);
        let body = "";
        for await (const batch of stream) for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
        expect({ blocks, body }).toEqual({ blocks: expectedBlocks, body: expectedBody });
      } finally {
        closeWith(client, stream);
      }
    });

    // A stream that waits for the handshake queues both blocks, and sends them when lsquic opens it.
    test.each([
      ["an open stream", true],
      ["a stream that waits for the handshake", false],
    ])("a server gets the trailers that follow large request headers on %s", async (_name, opened) => {
      const seen: string[] = [];
      const served = Promise.withResolvers<string>();
      await using server = await listen(
        async serverSession => {
          serverSession.onstream = (stream: any) => {
            outcome(stream.closed).then(served.resolve);
          };
          await serverSession.closed.catch(() => {});
        },
        {
          ...tls,
          onheaders(this: any, block: Record<string, string>) {
            seen.push(label("headers", block));
            this.sendHeaders({ ":status": "200" }, { terminal: true });
          },
          ontrailers(this: any, block: Record<string, string>) {
            seen.push(label("trailers", block));
          },
        },
      );
      await using endpoint = new QuicEndpoint();
      const client = await connectWith(endpoint, server);
      let stream: any;
      try {
        if (opened) await client.opened;
        stream = await client.createBidirectionalStream({ onheaders() {} });
        const closed = outcome(stream.closed);
        const sent = [stream.sendHeaders(large(request("/trailers"))), stream.sendTrailers({ "x-checksum": "abc123" })];
        // Without the trailers the request never ends, and neither does the stream.
        expect({ pending: stream.pending, sent }).toEqual({ pending: !opened, sent: [true, true] });
        // The server never sees a stream that the client had to reset.
        expect(await closed).toBe("closed");
        expect({ server: await served.promise, seen }).toEqual({
          server: "closed",
          seen: ["headers /trailers +100", "trailers abc123"],
        });
      } finally {
        closeWith(client, stream);
      }
    });
  });
});

// RFC 9114 10.3. nghttp3, which parses fields for Node, removes such a regular field and delivers the rest.
describe("HTTP/3 header blocks with no field lines", () => {
  const get = { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" };

  // One request, answered by `respond`. A second request then shows that the connection survived.
  async function request(respond: (stream: any) => void, onwanttrailers?: (this: any) => void) {
    await using server = await listen(
      session => {
        session.onerror = () => {};
        session.closed.catch(() => {});
        session.onstream = (stream: any) => void stream.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        onheaders(this: any) {
          respond(this);
          respond = stream => stream.sendHeaders({ ":status": "204" }, { terminal: true });
        },
        onwanttrailers,
      },
    );
    const client = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      onerror() {},
    } as SessionOptions);
    client.closed.catch(() => {});
    try {
      await client.opened;
      const exchange = async () => {
        const events: string[] = [];
        const log = (name: string) => (headers: object) => void events.push(`${name} ${JSON.stringify(headers)}`);
        const stream = await client.createBidirectionalStream({
          headers: get,
          oninfo: log("info"),
          onheaders: log("headers"),
          ontrailers: log("trailers"),
        });
        stream.closed.catch(() => {});
        let body = "";
        try {
          for await (const batch of stream) for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
          events.push(`end ${body}`);
        } catch (err: any) {
          events.push(`error ${err.code}`);
        }
        return events;
      };
      return { first: await exchange(), second: await exchange() };
    } finally {
      client.close();
    }
  }
  const second = ['headers {":status":"204"}', "end "];

  // sendHeaders({}) still writes the block.
  test("a received block is delivered as empty trailers", async () => {
    const result = await request(stream => {
      stream.sendHeaders({ ":status": "200" });
      stream.sendHeaders({}, { terminal: true });
    });
    expect(result).toEqual({ first: ['headers {":status":"200"}', "trailers {}", "end "], second });
  });

  test("sendTrailers({}) only sends the FIN, and sendInformationalHeaders({}) sends nothing", async () => {
    const sent: boolean[] = [];
    const result = await request(
      stream => {
        sent.push(stream.sendInformationalHeaders({}));
        stream.sendHeaders({ ":status": "200" });
        stream.writer.writeSync(new TextEncoder().encode("hello"));
        stream.writer.endSync();
      },
      function () {
        sent.push(this.sendTrailers({}));
      },
    );
    expect({ sent, ...result }).toEqual({
      sent: [true, true],
      first: ['headers {":status":"200"}', "end hello"],
      second,
    });
  });
});

describe("received HTTP/3 fields with CR or LF", () => {
  const encoder = new TextEncoder();
  const request = { ":method": "POST", ":path": "/", ":scheme": "https", ":authority": "localhost" };
  const serverOptions = { sni: { "*": { keys: [key], certs: [cert] } }, transportParams: { maxIdleTimeout: 1 } };
  const clientOptions = {
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: 1 },
  } as SessionOptions;
  const quietSession = async (serverSession: any) => {
    serverSession.onerror = () => {};
    serverSession.onstream = (stream: any) => {
      stream.closed.catch(() => {});
    };
    await serverSession.closed.catch(() => {});
  };

  test.each([
    ["CR LF", "a\r\nb: c"],
    ["LF", "a\nb"],
    ["CR", "a\rb"],
  ])("drops a field whose value has %s from every kind of block", async (_, bad) => {
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
    await stream.closed;
    await serverStream.closed;
    await client.close();

    expect(seen).toEqual({
      request: { ...request, "x-ok": "request" },
      requestTrailers: { "x-ok": "request trailers" },
      info: { ":status": "103", "x-ok": "info" },
      response: { ":status": "200", "x-ok": "response" },
      responseTrailers: {},
      body: "body",
    });
  });

  // sendHeaders() rejects a name that isn't a token, so this peer drives the native binding, like Node's internal tests.
  // The binding's callbacks are per VM, so it needs its own. Kind 1 is the initial block, flag 1 ends the stream.
  const rawClient = `
    const { parentPort, workerData } = require("node:worker_threads");
    const quic = require("internal/test/binding").internalBinding("quic");
    let open = workerData.requests.length;
    const callbacks = {
      onStreamClose: () => --open === 0 && session.gracefulClose(),
      onSessionClose: () => parentPort.postMessage("closed"),
    };
    // setCallbacks() wants every callback, and its error names the first one that's missing.
    for (;;) {
      try {
        quic.setCallbacks(callbacks);
        break;
      } catch (err) {
        callbacks[err.message.slice("Missing Callback: ".length)] = () => {};
      }
    }
    const session = new quic.Endpoint({}).connect(
      new (require("node:net").SocketAddress)({ address: "127.0.0.1", port: workerData.port }),
      { tls: { alpn: Buffer.from("\\x02h3"), servername: "localhost", groups: quic.DEFAULT_GROUPS }, verifyPeer: "manual" },
    );
    for (const pairs of workerData.requests) {
      let block = "";
      for (let i = 0; i < pairs.length; i += 2) block += pairs[i] + "\\0" + pairs[i + 1] + "\\0\\0";
      session.openStream(0).sendHeaders(1, [block, pairs.length / 2], 1);
    }
  `;

  test("drops a field with CR or LF anywhere in its name or value, and keeps a tab", async () => {
    const seen: Record<string, Record<string, string>> = {};
    await using server = await listen(quietSession, {
      ...serverOptions,
      // The client closes the session, and its thread can take a second to start.
      transportParams: { maxIdleTimeout: 10 },
      onheaders(this: any, headers: Record<string, any>) {
        const { ":path": path, ...rest } = headers;
        seen[path] = rest;
        this.sendHeaders({ ":status": "200" }, { terminal: true });
      },
    });
    const rows: Record<string, Record<string, string>> = {
      "/name-cr-lf": { "x-a\r\nx-b": "v" },
      "/name-lf-first": { "\nx-b": "v" },
      "/name-cr-last": { "x-a\r": "v" },
      "/value-lf-first": { "x-bad": "\nb" },
      "/value-cr-last": { "x-bad": "a\r" },
      "/value-is-lf": { "x-bad": "\n" },
      "/value-tab": { "x-tab": "a\tb", "x-bad": "a\rb" },
    };
    const requests = Object.entries(rows).map(([path, fields]) =>
      Object.entries({ ...request, ":path": path, ...fields, "x-ok": "kept" }).flat(),
    );
    const client = new Worker(rawClient, { eval: true, workerData: { port: server.address!.port, requests } });
    try {
      await once(client, "message");
    } finally {
      await client.terminate();
    }

    const rest = { ":method": "POST", ":scheme": "https", ":authority": "localhost", "x-ok": "kept" };
    expect(seen).toEqual({
      "/name-cr-lf": rest,
      "/name-lf-first": rest,
      "/name-cr-last": rest,
      "/value-lf-first": rest,
      "/value-cr-last": rest,
      "/value-is-lf": rest,
      "/value-tab": { ...rest, "x-tab": "a\tb" },
    });
  });

  test("closes the connection when a pseudo-header has CR or LF", async () => {
    let delivered = false;
    await using server = await listen(quietSession, {
      ...serverOptions,
      onheaders(this: any) {
        delivered = true;
        this.sendHeaders({ ":status": "200" }, { terminal: true });
      },
    });
    const client = await connect(server.address!, { ...clientOptions, onerror() {} } as SessionOptions);
    await client.opened;

    const stream = await client.createBidirectionalStream({ headers: { ...request, ":path": "/a\r\nb" } });
    stream.closed.catch(() => {});
    expect(
      await client.closed.then(
        () => "closed",
        (err: any) => `${err.code} ${err.errorCode}`,
      ),
    ).toBe(`ERR_QUIC_APPLICATION_ERROR ${0x10e}`);
    expect(delivered).toBe(false);
  });

  test.each([
    // Room for the four pseudo-headers and one more field.
    ["maxHeaderPairs", { maxHeaderPairs: 5 }],
    // The pseudo-headers take 48 bytes. x-bad (9) fits, and x-ok (8) only fits if x-bad isn't counted.
    ["maxHeaderLength", { maxHeaderLength: 57 }],
  ])("doesn't count a dropped field against %s", async (_, application) => {
    let received: Record<string, string> | undefined;
    await using server = await listen(quietSession, {
      ...serverOptions,
      application,
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

describe("STOP_SENDING on a stream whose send side is finished", () => {
  test.each<[string, (stream: any) => void, bigint]>([
    ["stopSending()", stream => stream.stopSending(5n), 5n],
    ["destroy() with a code", stream => stream.destroy(undefined, { code: 7n }), 7n],
  ])("%s sends the frame right away on an idle connection", async (_name, abort, code) => {
    const requested = Promise.withResolvers<any>();
    const stopped = Promise.withResolvers<any>();
    const acknowledged = { server: Promise.withResolvers<void>(), client: Promise.withResolvers<void>() };
    await using server = await listen(
      session => {
        session.closed.catch(() => {});
        session.ondatagramstatus = () => acknowledged.server.resolve();
        session.onstream = (stream: any) => {
          stream.closed.catch(() => {});
          stream.onstopsending = stopped.resolve;
          requested.resolve(session);
        };
      },
      { sni: { "*": { keys: [key], certs: [cert] } }, ondatagram() {} },
    );
    const client = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      ondatagram() {},
      ondatagramstatus: () => acknowledged.client.resolve(),
    } as SessionOptions);
    try {
      await client.opened;
      const stream = await client.createBidirectionalStream({
        headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
      });
      stream.closed.catch(() => {});
      const serverSession = await requested.promise;
      // Once each side's last packet is acknowledged, the client has no packet of its own to put the frame in.
      await client.sendDatagram(new Uint8Array(1));
      await acknowledged.client.promise;
      await serverSession.sendDatagram(new Uint8Array(1));
      await acknowledged.server.promise;

      const stats = client.endpoint!.stats;
      const sentBefore = stats.packetsSent;
      abort(stream);
      expect(stats.packetsSent).toBeGreaterThan(sentBefore);
      expect(await stopped.promise).toMatchObject({ code: "ERR_QUIC_APPLICATION_ERROR", errorCode: code });
    } finally {
      client.close();
    }
  });
});

describe("a resumed client before its handshake is done", () => {
  test.each<[string, (stream: any) => void, string[]]>([
    ["resetStream()", stream => stream.resetStream(42n), ["stream 0", "reset 0 42"]],
    ["stopSending()", stream => stream.stopSending(42n), ["stream 0", "stop 0 42"]],
  ])("%s reaches the server", async (_name, abort, expected) => {
    const events: string[] = [];
    await using server = await listen(
      session => {
        session.onerror = () => {};
        session.closed.catch(() => {});
        session.onstream = async (stream: any) => {
          stream.closed.catch(() => {});
          events.push(`stream ${stream.id}`);
          stream.onreset = (error: any) => events.push(`reset ${stream.id} ${error.errorCode}`);
          stream.onstopsending = (error: any) => events.push(`stop ${stream.id} ${error.errorCode}`);
          try {
            for await (const _ of stream);
          } catch {
            return;
          }
          stream.writer.endSync();
        };
      },
      { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"] },
    );
    const options = { alpn: "quic-test", servername: "localhost", verifyPeer: "manual", onerror() {} };
    const ticket = Promise.withResolvers<any>();
    const first = await connect(server.address!, { ...options, onsessionticket: ticket.resolve } as SessionOptions);
    await first.opened;
    const sessionTicket = await ticket.promise;
    await first.close();

    const client = await connect(server.address!, { ...options, sessionTicket } as SessionOptions);
    try {
      client.closed.catch(() => {});
      const early = await client.createBidirectionalStream();
      early.closed.catch(() => {});
      abort(early);
      const { earlyDataAccepted } = await client.opened;

      // The server gets this request after everything the client sent before it.
      const request = await client.createBidirectionalStream({ body: new Uint8Array(1) });
      request.closed.catch(() => {});
      for await (const _ of request);
      expect({ earlyDataAccepted, events: events.filter(event => event !== `stream ${request.id}`) }).toEqual({
        earlyDataAccepted: true,
        events: expected,
      });
    } finally {
      client.close();
    }
  });
});

describe("stream flow control", () => {
  type TransportParams = Record<string, number>;
  const sni = { "*": { keys: [key], certs: [cert] } };

  // The period is 251 bytes, so a lost, repeated or reordered chunk changes the hash.
  function pattern(size: number, seed: number) {
    const period = Buffer.alloc(251);
    for (let i = 0; i < period.length; i++) period[i] = (i * 7 + seed) & 0xff;
    return Buffer.alloc(size, period);
  }
  const summary = (bytes: Uint8Array) => ({ length: bytes.byteLength, sha1: Bun.SHA1.hash(bytes, "hex") });
  async function readAll(stream: any) {
    const chunks: Uint8Array[] = [];
    for await (const batch of stream) chunks.push(...batch);
    return Buffer.concat(chunks);
  }

  // The server opens a bidirectional stream with `down` as its body, and the client answers with `up`.
  async function serverOpenedExchange(options: {
    down: Uint8Array;
    up: Uint8Array;
    server?: TransportParams;
    client?: TransportParams;
  }) {
    const errors: string[] = [];
    const serverRead = Promise.withResolvers<Uint8Array>();
    const clientRead = Promise.withResolvers<Uint8Array>();
    await using server = await listen(
      session => {
        session.onerror = (err: any) => errors.push(`server: ${err?.message}`);
        session.closed.catch(() => {});
        session.opened
          .then(async () => {
            const stream = await session.createBidirectionalStream({ body: options.down });
            stream.closed.catch(() => {});
            return readAll(stream);
          })
          .then(serverRead.resolve, serverRead.reject);
      },
      { sni, alpn: ["quic-test"], transportParams: options.server ?? {} },
    );
    const client = await connect(server.address!, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: options.client ?? {},
      onerror(err: any) {
        errors.push(`client: ${err?.message}`);
      },
      onstream(stream: any) {
        stream.closed.catch(() => {});
        stream.setBody(options.up);
        readAll(stream).then(clientRead.resolve, clientRead.reject);
      },
    } as SessionOptions);
    client.closed.catch(() => {});
    try {
      const [down, up] = await Promise.all([clientRead.promise, serverRead.promise]);
      return { down: summary(down), up: summary(up), errors };
    } finally {
      client.close();
    }
  }

  // A resumed client opens a unidirectional stream with `body` before its handshake is done.
  async function earlyUnidirectionalStream(body: Uint8Array, serverParams: TransportParams = {}) {
    const errors: string[] = [];
    const received = Promise.withResolvers<Uint8Array>();
    await using server = await listen(
      session => {
        session.onerror = (err: any) => errors.push(`server: ${err?.message}`);
        session.closed.catch(() => {});
        session.onstream = (stream: any) => {
          stream.closed.catch(() => {});
          readAll(stream).then(received.resolve, received.reject);
        };
      },
      { sni, alpn: ["quic-test"], transportParams: serverParams },
    );
    const options = { alpn: "quic-test", servername: "localhost", verifyPeer: "manual" };
    const ticket = Promise.withResolvers<any>();
    const first = await connect(server.address!, { ...options, onsessionticket: ticket.resolve } as SessionOptions);
    await first.opened;
    const sessionTicket = await ticket.promise;
    await first.close();

    const client = await connect(server.address!, {
      ...options,
      sessionTicket,
      onerror(err: any) {
        errors.push(`client: ${err?.message}`);
      },
    } as SessionOptions);
    client.closed.catch(() => {});
    try {
      const stream = await client.createUnidirectionalStream({ body });
      stream.closed.catch(() => {});
      const { earlyDataAccepted } = await client.opened;
      return { earlyDataAccepted, received: summary(await received.promise), errors };
    } finally {
      client.close();
    }
  }

  describe("with default transportParams", () => {
    test("a bidirectional stream the server opens carries 256 KiB each way", async () => {
      const down = pattern(256 * 1024, 1);
      const up = pattern(256 * 1024, 2);
      expect(await serverOpenedExchange({ down, up })).toEqual({ down: summary(down), up: summary(up), errors: [] });
    });

    test("a unidirectional stream a client opens in 0-RTT carries 400,000 bytes", async () => {
      const body = pattern(400_000, 3);
      expect(await earlyUnidirectionalStream(body)).toEqual({
        earlyDataAccepted: true,
        received: summary(body),
        errors: [],
      });
    });
  });

  // A sender that reads the wrong window either overruns the 1,000 bytes or stops at 1,000 and waits for credit forever.
  test.each<[string, { client?: TransportParams; server?: TransportParams }]>([
    [
      "client's bidiRemote is 1,000",
      { client: { initialMaxStreamDataBidiRemote: 1000, initialMaxStreamDataBidiLocal: 100_000 } },
    ],
    [
      "client's bidiLocal is 1,000",
      { client: { initialMaxStreamDataBidiRemote: 100_000, initialMaxStreamDataBidiLocal: 1000 } },
    ],
    [
      "server's bidiLocal is 1,000",
      { server: { initialMaxStreamDataBidiLocal: 1000, initialMaxStreamDataBidiRemote: 100_000 } },
    ],
    [
      "server's bidiRemote is 1,000",
      { server: { initialMaxStreamDataBidiLocal: 100_000, initialMaxStreamDataBidiRemote: 1000 } },
    ],
  ])("a bidirectional stream the server opens carries 50,000 bytes each way when the %s", async (_name, windows) => {
    const down = pattern(50_000, 4);
    const up = pattern(50_000, 5);
    expect(await serverOpenedExchange({ down, up, ...windows })).toEqual({
      down: summary(down),
      up: summary(up),
      errors: [],
    });
  });

  test("a unidirectional stream a client opens in 0-RTT stays within the server's unidirectional window", async () => {
    const body = pattern(400_000, 6);
    expect(await earlyUnidirectionalStream(body, { initialMaxStreamDataUni: 12288 })).toEqual({
      earlyDataAccepted: true,
      received: summary(body),
      errors: [],
    });
  });

  test.each([
    { name: "raw QUIC", alpn: "quic-test" },
    { name: "HTTP/3", alpn: "h3" },
  ])("a sender stops while nothing reads its $name stream, and the reader then gets every byte", async ({ alpn }) => {
    const WINDOW = 64 * 1024;
    const body = pattern(2 * 1024 * 1024, 7);
    const headers = { ":method": "POST", ":path": "/", ":scheme": "https", ":authority": "localhost" };
    const unread = Promise.withResolvers<any>();
    await using server = await listen(
      session => {
        session.onerror = () => {};
        session.closed.catch(() => {});
        let first = true;
        session.onstream = (stream: any) => {
          stream.closed.catch(() => {});
          if (first) unread.resolve(stream);
          else if (alpn !== "h3") stream.writer.endSync();
          first = false;
        };
      },
      {
        sni,
        alpn: [alpn],
        transportParams: { initialMaxStreamDataBidiRemote: WINDOW },
        ...(alpn === "h3" && {
          onheaders(this: any) {
            this.sendHeaders({ ":status": "200" }, { terminal: true });
          },
        }),
      },
    );
    const client = await connect(server.address!, {
      alpn,
      servername: "localhost",
      verifyPeer: "manual",
      onerror() {},
    } as SessionOptions);
    client.closed.catch(() => {});
    try {
      await client.opened;
      const sender = await client.createBidirectionalStream(alpn === "h3" ? { headers, body } : { body });
      sender.closed.catch(() => {});
      const receiver = await unread.promise;
      // The answer to a later stream arrives after every MAX_STREAM_DATA the server sent before it.
      const roundTrip = async () => {
        const stream = await client.createBidirectionalStream(
          alpn === "h3" ? { headers, onheaders() {} } : { body: new Uint8Array(1) },
        );
        await stream.closed;
      };
      let sent = -1n;
      while (sent !== sender.stats.bytesSent) {
        sent = sender.stats.bytesSent;
        await roundTrip();
        await roundTrip();
      }
      expect(Number(sent)).toBeGreaterThanOrEqual(WINDOW);
      expect(Number(sent)).toBeLessThan(512 * 1024);

      expect(summary(await readAll(receiver))).toEqual(summary(body));
    } finally {
      client.close();
    }
  });

  test("resetStream() in the callback whose reads unblock the sender doesn't leave the sender blocked", async () => {
    const body = pattern(2 * 1024 * 1024, 11);
    const received = Promise.withResolvers<Uint8Array>();
    let receiver: any;
    let stalledAt = -1n;
    let stalled = false;
    // Packets go out when a native callback returns, so the reads and the reset share one flush.
    async function readThenReset() {
      const chunks: Uint8Array[] = [];
      let got = 0n;
      for await (const batch of receiver) {
        chunks.push(...batch);
        for (const chunk of batch) got += BigInt(chunk.byteLength);
        if (got === stalledAt) receiver.resetStream(1n);
      }
      return Buffer.concat(chunks);
    }
    await using server = await listen(
      session => {
        session.onerror = () => {};
        session.closed.catch(() => {});
        session.onstream = (stream: any) => {
          stream.closed.catch(() => {});
          if (!receiver) return void (receiver = stream);
          stream.writer.endSync();
          if (stalled) readThenReset().then(received.resolve, received.reject);
        };
      },
      { sni, alpn: ["quic-test"], transportParams: { initialMaxStreamDataBidiRemote: 64 * 1024 } },
    );
    const client = await connect(server.address!, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      onerror() {},
    } as SessionOptions);
    client.closed.catch(() => {});
    try {
      await client.opened;
      const sender = await client.createBidirectionalStream({ body });
      sender.closed.catch(() => {});
      const roundTrip = async () => {
        const stream = await client.createBidirectionalStream({ body: new Uint8Array(1) });
        await stream.closed;
      };
      while (stalledAt !== sender.stats.bytesSent) {
        stalledAt = sender.stats.bytesSent;
        await roundTrip();
        await roundTrip();
      }
      expect(Number(stalledAt)).toBeLessThan(body.length);
      stalled = true;
      await roundTrip();

      expect(summary(await received.promise)).toEqual(summary(body));
    } finally {
      client.close();
    }
  });

  // Without an idle timeout, a FIN that's never sent can't pass for the clean end of an idle session.
  describe("a FIN on a stream that has no credit", () => {
    const empty = new Uint8Array(0);
    const noStreamCredit = {
      maxIdleTimeout: 0,
      initialMaxStreamDataBidiLocal: 0,
      initialMaxStreamDataBidiRemote: 0,
      initialMaxStreamDataUni: 0,
    };

    test("reaches both ends of a bidirectional stream", async () => {
      expect(
        await serverOpenedExchange({ down: empty, up: empty, server: noStreamCredit, client: noStreamCredit }),
      ).toEqual({ down: summary(empty), up: summary(empty), errors: [] });
    });

    test("reaches the peer of a unidirectional stream, and the stream closes", async () => {
      const received = Promise.withResolvers<Uint8Array>();
      await using server = await listen(
        session => {
          session.closed.catch(() => {});
          session.onstream = (stream: any) => {
            stream.closed.catch(() => {});
            readAll(stream).then(received.resolve, received.reject);
          };
        },
        { sni, alpn: ["quic-test"], transportParams: noStreamCredit },
      );
      const client = await connect(server.address!, {
        alpn: "quic-test",
        servername: "localhost",
        verifyPeer: "manual",
        transportParams: noStreamCredit,
      } as SessionOptions);
      try {
        await client.opened;
        const stream = await client.createUnidirectionalStream();
        stream.writer.endSync();
        expect((await received.promise).byteLength).toBe(0);
        await stream.closed;
      } finally {
        client.close();
      }
    });
  });

  describe.concurrent("trailers that wait for the stream's flow-control credit", () => {
    const bodySize = 5000;
    // One connection per window, from too small for the response's body to large enough for some of its trailers.
    const windows = Array.from({ length: 12 }, (_, i) => bodySize + 6 + i);

    async function* lines(stream: ReadableStream<Uint8Array>) {
      const decoder = new TextDecoder();
      let text = "";
      for await (const chunk of stream) {
        const complete = (text += decoder.decode(chunk, { stream: true })).split("\n");
        text = complete.pop()!;
        yield* complete;
      }
    }
    const spawn = (...args: (string | number)[]) =>
      Bun.spawn({
        cmd: [bunExe(), "--no-warnings", join(import.meta.dir, "quic-trailers-credit-fixture.ts"), ...args.map(String)],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      });

    // The client prints one row per window and stops at its first error.
    async function expectEveryRow(action: string, expected: object, expectedIfTheyWaited = expected) {
      await using server = spawn("server", join(keysDir, "agent1-key.pem"), join(keysDir, "agent1-cert.pem"), bodySize);
      const serverLines = lines(server.stdout);
      await using client = spawn("client", action, (await serverLines.next()).value!, ...windows);
      // The client returns no credit until the server has either run out of it or sent its trailers.
      const ranInto: string[] = [];
      const relayed = (async () => {
        for await (const line of serverLines) {
          ranInto.push(line);
          client.stdin.write("x");
          client.stdin.flush();
        }
        client.stdin.end();
      })();
      const rows: object[] = [];
      for await (const line of lines(client.stdout)) rows.push(JSON.parse(line));
      server.kill();
      await relayed;
      // The trailers wait in the window that the body uses up exactly, and in the two after it.
      const first = ranInto.indexOf("trailers");
      expect(rows).toEqual(windows.map((_, i) => (i >= first && i < first + 3 ? expectedIfTheyWaited : expected)));
      expect(first).toBeWithin(1, windows.length - 2);
    }
    const whole = { bytes: bodySize, trailers: "abc123", again: "204" };

    test("are sent when the credit arrives", async () => {
      await expectEveryRow("finish", whole);
    }, 30_000);

    test("end the response, so sending another header block returns false", async () => {
      await expectEveryRow("more", { ...whole, sentLater: "false,false,false" });
    }, 30_000);

    test("make destroy() reset the stream", async () => {
      await expectEveryRow("destroy", whole, { failed: "ERR_QUIC_STREAM_RESET", again: "204" });
    }, 30_000);

    // The request is still open, so only the server's close ends the connection before it idles out.
    test.each([
      ["the peer's STOP_SENDING", "stop"],
      ["resetStream()", "reset"],
    ] as const)(
      "don't delay session.close() after %s",
      async (_, action) => {
        await expectEveryRow(action, { closed: "QUIC application error 5" });
      },
      60_000,
    );
  });
});

describe("a client's limit for the streams its server opens", () => {
  test.each([
    { kind: "bidi", params: { initialMaxStreamsBidi: 2 }, ids: [1n, 5n, 9n, 13n, 17n, 21n] },
    { kind: "uni", params: { initialMaxStreamsUni: 2 }, ids: [3n, 7n, 11n, 15n, 19n, 23n] },
  ])("is advertised, and credit comes back for closed $kind streams", async ({ kind, params, ids }) => {
    const accepted = Promise.withResolvers<any>();
    await using server = await listen(
      session => {
        session.onerror = () => {};
        session.closed.catch(() => {});
        accepted.resolve(session);
      },
      // A stream that never opens ends the test through `closed`, not through the test's timeout.
      { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"], transportParams: { maxIdleTimeout: 1 } },
    );
    const received: bigint[] = [];
    let read = Promise.withResolvers<void>();
    const client = await connect(server.address!, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1, ...params },
      onerror() {},
      async onstream(stream: any) {
        stream.closed.catch(() => {});
        for await (const _ of stream);
        // Credit only comes back for a stream that's closed in both directions.
        if (kind === "bidi") stream.writer.endSync();
        received.push(stream.id);
        read.resolve();
      },
    } as SessionOptions);
    try {
      const closed = client.closed.then(
        () => "client closed",
        () => "client closed",
      );
      const serverSession = await accepted.promise;
      await serverSession.opened;
      const openAll = async () => {
        for (const _ of ids) {
          read = Promise.withResolvers<void>();
          const body = new Uint8Array(1);
          const stream = await (kind === "bidi"
            ? serverSession.createBidirectionalStream({ body })
            : serverSession.createUnidirectionalStream({ body }));
          stream.closed.catch(() => {});
          await read.promise;
        }
        return "opened all";
      };
      const { initialMaxStreamsBidi, initialMaxStreamsUni } = serverSession.remoteTransportParams;
      expect({
        advertised: kind === "bidi" ? initialMaxStreamsBidi : initialMaxStreamsUni,
        outcome: await Promise.race([openAll(), closed]),
        received,
      }).toEqual({ advertised: 2n, outcome: "opened all", received: [...ids] });
    } finally {
      client.close();
    }
  });
});

describe("pendingTrailers that can't be sent", () => {
  test.each([
    ["sendTrailers() throws", { connection: "close" }, "ERR_HTTP2_INVALID_CONNECTION_HEADERS"],
    // U+0100 becomes a NUL in Latin-1, so the block has more pairs than it declares and the native side refuses it.
    ["sendTrailers() returns false", { "x-bad": "a\u0100b" }, "ERR_QUIC_STREAM_ABORTED"],
  ])("destroy the stream when %s", async (_name, trailers, code) => {
    const closed = Promise.withResolvers<string>();
    await using server = await listen(
      session => {
        session.closed.catch(() => {});
        session.onstream = () => {};
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        onheaders(this: any) {
          this.closed.then(
            () => closed.resolve("resolved"),
            (err: any) => closed.resolve(err.code),
          );
          this.sendHeaders({ ":status": "200" });
          this.pendingTrailers = trailers;
          this.writer.writeSync(new TextEncoder().encode("body"));
          this.writer.endSync();
        },
        // The native side only asks a stream for its trailers when this is set.
        onwanttrailers() {},
      },
    );
    const client = await connect(server.address!, { servername: "localhost", verifyPeer: "manual" } as SessionOptions);
    try {
      await client.opened;
      const stream = await client.createBidirectionalStream({
        headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
        onheaders() {},
      });
      stream.closed.catch(() => {});
      expect(await closed.promise).toBe(code);
    } finally {
      client.close();
    }
  });
});

// A peer that gets RESET_STREAM or STREAM frames on a stream it only sends on closes the connection (RFC 9000 §19.4, §19.8).
describe("a unidirectional stream the peer opened", () => {
  const encoder = new TextEncoder();
  const settled = (promise: Promise<unknown>) =>
    promise.then(
      () => "resolved",
      (err: any) => `rejected: ${err.code}`,
    );

  // The server writes half a message, so its stream is still open when `call` runs on the client's end of it.
  async function receive(call: (stream: any) => unknown) {
    const sessionErrors: string[] = [];
    const answered = Promise.withResolvers<void>();
    const out = Promise.withResolvers<any>();
    await using server = await listen(
      session => {
        session.onerror = (err: any) => sessionErrors.push(`server: ${err.message}`);
        session.closed.catch(() => {});
        session.onstream = (stream: any) => {
          stream.closed.catch(() => {});
          answered.resolve();
        };
        session.opened.then(() => session.createUnidirectionalStream()).then(out.resolve, out.reject);
      },
      { alpn: ["quic-test"], sni: { "*": { keys: [key], certs: [cert] } } },
    );
    const incoming = Promise.withResolvers<any>();
    const client = await connect(server.address!, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      onstream: incoming.resolve,
      onerror(err: any) {
        sessionErrors.push(`client: ${err.message}`);
      },
    } as SessionOptions);
    const died = settled(client.closed).then(() => "the session closed");
    try {
      const sender = await out.promise;
      sender.closed.catch(() => {});
      sender.writer.writeSync(encoder.encode("part one, "));

      const stream = await incoming.promise;
      const closed = settled(stream.closed);
      let thrown = "nothing";
      try {
        call(stream);
      } catch (err: any) {
        thrown = `${err.code}: ${err.message}`;
      }
      const received = (async () => {
        let text = "";
        for await (const batch of stream) for (const chunk of batch) text += Buffer.from(chunk).toString("latin1");
        return text;
      })().catch((err: any) => `rejected: ${err.code}`);

      // Once the server sees this stream, it has also seen every frame that `call` sent.
      const answer = await client.createUnidirectionalStream({ body: encoder.encode("go") });
      answer.closed.catch(() => {});
      if ((await Promise.race([answered.promise, died])) === "the session closed") return { sessionErrors };
      sender.writer.writeSync(encoder.encode("part two"));
      sender.writer.endSync();
      return { thrown, received: await received, closed: await closed, sessionErrors };
    } finally {
      client.close();
    }
  }

  test.each<[string, (stream: any) => unknown, string?]>([
    ["ignores resetStream()", stream => stream.resetStream(7n)],
    ["drops setBody(bytes)", stream => stream.setBody(new Uint8Array(4096))],
    ["drops setBody(Blob)", stream => stream.setBody(new Blob([new Uint8Array(4096)]))],
    ["drops setOutbound(bytes)", stream => stream.setOutbound(new Uint8Array(4096))],
    ["throws for setBody(null)", stream => stream.setBody(null), "ERR_INVALID_STATE: Stream is not writable"],
  ])("%s and still delivers every byte", async (_name, call, thrown = "nothing") => {
    expect(await receive(call)).toEqual({
      thrown,
      received: "part one, part two",
      closed: "resolved",
      sessionErrors: [],
    });
  });

  test.each<[string, (stream: any) => unknown]>([
    ["setBody(iterable)", stream => stream.setBody([new Uint8Array(4096)])],
    ["setBody(Promise of null)", stream => stream.setBody(Promise.resolve(null))],
  ])("is destroyed with ERR_INVALID_STATE by %s, and the session stays open", async (_name, call) => {
    expect(await receive(call)).toMatchObject({
      thrown: "nothing",
      closed: "rejected: ERR_INVALID_STATE",
      sessionErrors: [],
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

// Node keeps `headers` and `pendingTrailers` on a closed stream since v26.6.0 (nodejs/node#64289).
describe("a closed stream", () => {
  const request = { ":method": "POST", ":path": "/", ":scheme": "https", ":authority": "localhost" };
  const serve = (onheaders: (this: any, headers: Record<string, any>) => void) =>
    listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.closed.catch(() => {});
        };
        await serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 1 },
        onheaders,
        // A stream is asked for its trailers only when this is set.
        onwanttrailers() {},
      },
    );
  const connectTo = async (server: QuicEndpoint) => {
    const client = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    } as SessionOptions);
    await client.opened;
    return client;
  };

  test("keeps the headers it received", async () => {
    const served = Promise.withResolvers<any>();
    const received = Promise.withResolvers<Record<string, any>>();
    await using server = await serve(function () {
      served.resolve(this);
      this.sendHeaders({ ":status": "200", "x-served-by": "bun" }, { terminal: true });
    });
    const client = await connectTo(server);
    try {
      const stream = await client.createBidirectionalStream({ headers: request, onheaders: received.resolve });
      const [serverStream, response] = await Promise.all([served.promise, received.promise]);
      await Promise.all([stream.closed, serverStream.closed]);
      expect({
        client: { destroyed: stream.destroyed, headers: stream.headers },
        server: { destroyed: serverStream.destroyed, headers: serverStream.headers },
      }).toEqual({
        client: { destroyed: true, headers: response },
        server: { destroyed: true, headers: request },
      });
    } finally {
      client.close();
    }
  });

  test("keeps the pendingTrailers it did not send", async () => {
    const trailers = { "x-checksum": "abc123" };
    const served: Record<string, any> = {};
    await using server = await serve(function (headers) {
      served[headers[":path"]] = this;
      this.pendingTrailers = trailers;
      if (headers[":path"] === "/body") {
        this.sendHeaders({ ":status": "200" });
        this.writer.writeSync(new TextEncoder().encode("body"));
        this.writer.endSync();
      } else {
        // No body follows these headers, so the stream is never asked for its trailers.
        this.sendHeaders({ ":status": "200" }, { terminal: true });
      }
    });
    const client = await connectTo(server);
    try {
      // The trailers that the client got, and what the server's stream has left once both ends are closed.
      const respond = async (path: string) => {
        let peer: Record<string, any> | undefined;
        const stream = await client.createBidirectionalStream({
          headers: { ...request, ":path": path },
          onheaders() {},
          ontrailers(block: Record<string, any>) {
            peer = block;
          },
        });
        for await (const _ of stream);
        await Promise.all([stream.closed, served[path].closed]);
        return { peer, pendingTrailers: served[path].pendingTrailers };
      };
      const sent = await respond("/body");
      const noBody = await respond("/no-body");

      const stream = await client.createBidirectionalStream({});
      stream.closed.catch(() => {});
      // The request body is still open when the stream is destroyed.
      stream.sendHeaders(request);
      stream.pendingTrailers = trailers;
      stream.destroy();
      const destroyed = { pendingTrailers: stream.pendingTrailers };

      expect({ sent, noBody, destroyed }).toEqual({
        sent: { peer: trailers, pendingTrailers: undefined },
        noBody: { peer: undefined, pendingTrailers: trailers },
        destroyed: { pendingTrailers: trailers },
      });
    } finally {
      client.close();
    }
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

// https://github.com/oven-sh/bun/issues/45500
describe("a stream that's still open when its connection closes", () => {
  const alpn = "quic-test";
  type Pair = { session: any; stream: any };

  // Returns a client stream that wrote one byte, and the server's session and stream for it.
  async function openPair() {
    const accepted: Pair[] = [];
    const waiters: ((pair: Pair) => void)[] = [];
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
    async function open(direction: "bidi" | "uni" = "bidi", { observeClosed = true } = {}) {
      const stream: any =
        direction === "uni" ? await client.createUnidirectionalStream() : await client.createBidirectionalStream();
      if (observeClosed) stream.closed.catch(() => {});
      stream.writer.writeSync(Uint8Array.of(1));
      const peer = accepted.shift() ?? (await new Promise<Pair>(resolve => waiters.push(resolve)));
      return { stream, peer };
    }
    return { server, client, open, ...(await open()) };
  }

  const settle = (promise: Promise<unknown>) =>
    promise.then(
      () => "resolved",
      (err: any) => `rejected ${err.code} ${err.errorCode}`,
    );
  const settleRead = (promise: Promise<IteratorResult<unknown>>) =>
    promise.then(
      result => (result.done ? "ended cleanly" : "returned data"),
      (err: any) => `rejected ${err.code}`,
    );

  test.each([
    ["application", "ERR_QUIC_APPLICATION_ERROR"],
    ["transport", "ERR_QUIC_TRANSPORT_ERROR"],
  ])("rejects a pending read and closed with the connection's %s error", async (type, code) => {
    const { server, client, stream, peer } = await openPair();
    await using _ = server;
    let onerrorCalls = 0;
    stream.onerror = () => onerrorCalls++;
    const read = settleRead(stream[Symbol.asyncIterator]().next());
    const streamClosed = settle(stream.closed);
    const sessionClosed = settle(client.closed);

    peer.session.destroy(undefined, { code: 2n, type });

    expect({ read: await read, streamClosed: await streamClosed, sessionClosed: await sessionClosed }).toEqual({
      read: `rejected ${code}`,
      streamClosed: `rejected ${code} 2`,
      sessionClosed: `rejected ${code} 2`,
    });
    // Node doesn't call onerror for a stream that its connection closed.
    expect({ destroyed: stream.destroyed, onerrorCalls }).toEqual({ destroyed: true, onerrorCalls: 0 });
  });

  test("rejects a read that starts after the connection closed", async () => {
    const { server, client, stream, peer } = await openPair();
    await using _ = server;
    const streamClosed = settle(stream.closed);
    client.closed.catch(() => {});

    peer.session.destroy(undefined, { code: 2n, type: "application" });

    expect(await streamClosed).toBe("rejected ERR_QUIC_APPLICATION_ERROR 2");
    expect(await settleRead(stream[Symbol.asyncIterator]().next())).toBe("rejected ERR_QUIC_APPLICATION_ERROR");
  });

  test("rejects closed with the connection's error after the closing peer's writer reset the stream", async () => {
    const { server, client, stream, peer } = await openPair();
    await using _ = server;
    const iterator = stream[Symbol.asyncIterator]();
    peer.stream.writer.writeSync(Uint8Array.of(2, 3));
    const first = await iterator.next();
    const read = settleRead(iterator.next());
    const streamClosed = settle(stream.closed);
    client.closed.catch(() => {});

    peer.session.destroy(undefined, { code: 2n, type: "application" });

    expect({ first: first.done, read: await read, streamClosed: await streamClosed }).toEqual({
      first: false,
      read: "rejected ERR_QUIC_STREAM_RESET",
      streamClosed: "rejected ERR_QUIC_APPLICATION_ERROR 2",
    });
  });

  test("still delivers a complete body that arrived before the connection's error", async () => {
    const { server, client, stream, peer } = await openPair();
    await using _ = server;
    const streamClosed = settle(stream.closed);
    client.closed.catch(() => {});
    peer.stream.writer.writeSync(Uint8Array.of(2, 3));
    peer.stream.writer.writeSync(Uint8Array.of(4, 5));
    peer.stream.writer.endSync();
    // The FIN rides on the last frame of the body.
    while (stream.stats.bytesReceived < 4n) await new Promise(resolve => setImmediate(resolve));

    peer.session.destroy(undefined, { code: 2n, type: "application" });
    await streamClosed;

    const bytes: number[] = [];
    for await (const batch of stream) for (const chunk of batch) bytes.push(...chunk);
    expect({ bytes, streamClosed: await streamClosed }).toEqual({
      bytes: [2, 3, 4, 5],
      streamClosed: "rejected ERR_QUIC_APPLICATION_ERROR 2",
    });
  });

  test("resolves closed when the connection closes without an error", async () => {
    const { server, client, stream, peer } = await openPair();
    await using _ = server;
    const streamClosed = settle(stream.closed);
    const sessionClosed = settle(client.closed);

    peer.session.destroy(undefined, { code: 0n });

    expect({ streamClosed: await streamClosed, sessionClosed: await sessionClosed }).toEqual({
      streamClosed: "resolved",
      sessionClosed: "resolved",
    });
  });

  test("rejects closed with the peer's reset code when the connection then idles out", async () => {
    const { server, client, stream, peer } = await openPair();
    await using _ = server;
    const reset = Promise.withResolvers<void>();
    stream.onreset = () => reset.resolve();
    const streamClosed = settle(stream.closed);
    const sessionClosed = settle(client.closed);

    // The client's write side stays open, so only the idle timeout closes the stream.
    peer.stream.resetStream(7n);
    await reset.promise;

    expect({ streamClosed: await streamClosed, sessionClosed: await sessionClosed }).toEqual({
      streamClosed: "rejected ERR_QUIC_APPLICATION_ERROR 7",
      sessionClosed: "resolved",
    });
  });

  test("doesn't raise an unhandled rejection for a stream whose closed was never read", async () => {
    const { server, client, peer, open } = await openPair();
    await using _ = server;
    const { stream: unobserved } = await open("bidi", { observeClosed: false });
    // A finished writer has no failure that would mark `closed` as handled.
    unobserved.writer.endSync();
    const sessionClosed = settle(client.closed);

    peer.session.destroy(undefined, { code: 2n, type: "application" });

    expect(await sessionClosed).toBe("rejected ERR_QUIC_APPLICATION_ERROR 2");
  });

  test("ends the iterator of a write-only stream without an error", async () => {
    const { server, client, peer, open } = await openPair();
    await using _ = server;
    const { stream: uni } = await open("uni");
    const closed = settle(uni.closed);
    client.closed.catch(() => {});

    peer.session.destroy(undefined, { code: 2n, type: "application" });

    expect(await closed).toBe("rejected ERR_QUIC_APPLICATION_ERROR 2");
    expect(await settleRead(uni[Symbol.asyncIterator]().next())).toBe("ended cleanly");
  });

  test("stream.destroy(error) rejects a pending read with that error", async () => {
    const { server, client, stream } = await openPair();
    await using _ = server;
    const read = stream[Symbol.asyncIterator]()
      .next()
      .then(
        () => "ended",
        (err: Error) => err.message,
      );

    stream.destroy(new Error("local abort"));

    expect(await read).toBe("local abort");
    client.close();
  });

  // The peer's STOP_SENDING ends the write side, so these don't wait for the connection to close.
  test("a write-only stream that the peer stops closes with the peer's code", async () => {
    const { server, client, open } = await openPair();
    await using _ = server;
    const { stream: uni, peer } = await open("uni");
    const closed = settle(uni.closed);

    peer.stream.destroy(new Error("not wanted"));

    expect(await closed).toBe("rejected ERR_QUIC_APPLICATION_ERROR 1");
    expect((await open()).peer.session).toBe(peer.session);
    client.close();
  });

  test("a stream that the peer finished and then stopped closes", async () => {
    const { server, client, stream, peer, open } = await openPair();
    await using _ = server;
    peer.stream.writer.endSync();
    for await (const _ of stream);
    const closed = settle(stream.closed);

    peer.stream.stopSending(4n);

    expect(await closed).toBe("resolved");
    expect((await open()).peer.session).toBe(peer.session);
    client.close();
  });
});

// One sendHeaders() call takes 128 fields at most, so it returns false for this block.
describe("a response after sendHeaders() returned false", () => {
  const refused: Record<string, string> = { ":status": "200" };
  for (let i = 0; i < 128; i++) refused[`x-field-${i}`] = "v";
  const encoder = new TextEncoder();
  const outcome = (closed: Promise<unknown>) =>
    closed.then(
      () => "closed",
      (err: any) => `${err.code} ${err.errorCode}`,
    );

  async function roundTrip(respond: (stream: any) => unknown) {
    const serverSide = Promise.withResolvers<[unknown, string]>();
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
        async onheaders(this: any) {
          const sent = await respond(this);
          serverSide.resolve([sent, await outcome(this.closed)]);
        },
      },
    );
    const client = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
      onerror() {},
    } as SessionOptions);
    await client.opened;
    let status: string | undefined;
    const stream = await client.createBidirectionalStream({
      headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
      onheaders: (headers: Record<string, any>) => (status = headers[":status"]),
    });
    const clientClosed = await outcome(stream.closed);
    const [sent, serverClosed] = await serverSide.promise;
    client.close();
    return { sent, status, client: clientClosed, server: serverClosed };
  }

  const reset = {
    sent: false,
    status: undefined,
    client: "ERR_QUIC_APPLICATION_ERROR 258",
    server: "ERR_QUIC_APPLICATION_ERROR 258",
  };

  test("a body write resets the stream with H3_INTERNAL_ERROR", async () => {
    expect(
      await roundTrip(stream => {
        const sent = stream.sendHeaders(refused);
        stream.writer.writeSync(encoder.encode("body"));
        stream.writer.endSync();
        return sent;
      }),
    ).toEqual(reset);
  });

  test("ending the stream resets it instead of sending a bare FIN", async () => {
    expect(
      await roundTrip(stream => {
        const sent = stream.sendHeaders(refused);
        stream.writer.endSync();
        return sent;
      }),
    ).toEqual(reset);
  });

  test("a body that was already waiting for the header block resets the stream", async () => {
    expect(
      await roundTrip(async stream => {
        stream.writer.writeSync(encoder.encode("body"));
        for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
        return stream.sendHeaders(refused);
      }),
    ).toEqual(reset);
  });

  test("another sendHeaders() call can still answer", async () => {
    expect(
      await roundTrip(stream => {
        const sent = stream.sendHeaders(refused);
        stream.sendHeaders({ ":status": "500" }, { terminal: true });
        return sent;
      }),
    ).toEqual({ sent: false, status: "500", client: "closed", server: "closed" });
  });

  test("a body written before sendHeaders() follows the header block", async () => {
    expect(
      await roundTrip(async stream => {
        stream.writer.writeSync(encoder.encode("body"));
        stream.writer.endSync();
        for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
        return stream.sendHeaders({ ":status": "200" });
      }),
    ).toEqual({ sent: true, status: "200", client: "closed", server: "closed" });
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

describe.concurrent("a queued body", () => {
  async function peakRSS(mode: string) {
    const { stdout, stderr, exitCode, maxRSS } = await runCommandMaxRSS({
      cmd: [bunExe(), "--no-warnings", join(import.meta.dir, "outbound-body-rss-fixture.ts"), mode],
      env: withoutAsanQuarantine(bunEnv),
    });
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return { maxRSS, ...(JSON.parse(stdout) as { bodyBytes: number; bytesSent: number }) };
  }
  let baseline: ReturnType<typeof peakRSS> | undefined;

  test.each(["open", "setBody", "writer"])(
    "is held once natively while lsquic drains it (%s)",
    async mode => {
      const [none, queued] = await Promise.all([(baseline ??= peakRSS("none")), peakRSS(mode)]);
      expect(queued.bytesSent).toBeGreaterThan(0);
      // About 1 with one queue, about 2 if each write copies the queue first.
      expect((queued.maxRSS - none.maxRSS) / queued.bodyBytes).toBeLessThan(1.5);
    },
    20_000,
  );

  test("is freed when the stream's FIN is sent, not when the stream is collected", async () => {
    // Eight kept queues are 32 MiB.
    await expectRssDeltaBelow(["--no-warnings", join(import.meta.dir, "outbound-body-release-fixture.ts"), "8"], {
      release: 20,
      debug: 20,
    });
  }, 20_000);

  test("arrives intact after the queue's ring buffer wraps", async () => {
    // Each chunk is larger than the receiver's window, so the next one is queued behind a partly sent tail.
    const chunks = Array.from({ length: 8 }, (_, i) => Buffer.alloc(48 * 1024, `chunk ${i} `));
    const received = Promise.withResolvers<Buffer>();
    await using server = await listen(
      (session: any) => {
        session.closed.catch(() => {});
        session.onstream = async (stream: any) => {
          stream.closed.catch(() => {});
          try {
            const parts: Uint8Array[] = [];
            for await (const batch of stream) parts.push(...batch);
            received.resolve(Buffer.concat(parts));
          } catch (e) {
            received.reject(e);
          }
        };
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        alpn: ["wrap-test"],
        transportParams: { initialMaxStreamDataBidiRemote: 16 * 1024 },
      },
    );

    const client = await connect(server.address!, { alpn: "wrap-test", verifyPeer: "manual" } as SessionOptions);
    client.closed.catch(() => {});
    await client.opened;
    const stream = await client.createBidirectionalStream({ highWaterMark: chunks[0].length });
    stream.closed.catch(() => {});
    stream.setBody(
      (async function* () {
        yield* chunks;
      })(),
    );

    const got = await received.promise;
    client.close();
    expect(got.equals(Buffer.concat(chunks))).toBe(true);
  });
});

// A stream is pending until lsquic creates it: once the handshake is done and the peer's stream limit allows it.
describe("pending streams", () => {
  const encoder = new TextEncoder();
  const raw = { server: { alpn: ["quic-test"] }, client: { alpn: "quic-test" } };
  const drain = async (stream: any) => {
    for await (const _ of stream);
  };

  async function connected(onsession: (session: any) => void, serverOptions: any = {}, clientOptions: any = {}) {
    const sessions: any[] = [];
    const server = await listen(
      (session: any) => {
        sessions.push(session);
        session.closed.catch(() => {});
        return onsession(session);
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        ...serverOptions,
        transportParams: { maxIdleTimeout: 10, ...serverOptions.transportParams },
      },
    );
    const client = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      ...clientOptions,
      transportParams: { maxIdleTimeout: 10 },
    } as SessionOptions);
    client.closed.catch(() => {});
    sessions.push(client);
    return {
      client,
      // A graceful close after a failed expectation would wait for the idle timeout.
      async [Symbol.asyncDispose]() {
        for (const session of sessions) session.destroy();
        await server.close();
      },
    };
  }
  const opener = (session: any) => async (direction: "uni" | "bidi", body: string) => {
    const options = { body: encoder.encode(body) };
    const stream = await (direction === "uni"
      ? session.createUnidirectionalStream(options)
      : session.createBidirectionalStream(options));
    stream.closed.catch(() => {});
    return stream;
  };
  // A unidirectional stream closes once its body is sent. A bidirectional one is answered when the peer ends its side.
  const sent = (stream: any) => (stream.direction === "uni" ? stream.closed : drain(stream));
  // Reads each stream and ends its own side. A stream with an id below `heldBelow` keeps its stream credit until `release`.
  const readAndHold = (heldBelow: bigint, release: Promise<void>) => (session: any) => {
    session.onstream = async (stream: any) => {
      stream.closed.catch(() => {});
      if (stream.id < heldBelow) await release;
      await drain(stream);
      if (stream.direction === "bidi") stream.writer.endSync();
    };
  };

  // https://github.com/oven-sh/bun/issues/44749
  test("streams requested before the handshake open in order", async () => {
    const received: Record<string, string> = {};
    await using sessions = await connected(
      session => {
        session.onstream = async (stream: any) => {
          stream.closed.catch(() => {});
          const chunks: Buffer[] = [];
          for await (const batch of stream) for (const chunk of batch) chunks.push(Buffer.from(chunk));
          received[String(stream.id)] = Buffer.concat(chunks).toString();
          if (stream.direction === "bidi") stream.writer.endSync();
        };
      },
      raw.server,
      raw.client,
    );
    const { client } = sessions;
    const open = opener(client);

    await open("uni", "uni 1");
    const answered = await open("bidi", "bidi 1");
    await open("uni", "uni 2");
    await client.opened;
    await drain(answered);
    expect(received).toEqual({ "2": "uni 1", "0": "bidi 1", "6": "uni 2" });

    await open("uni", "uni 3");
    await drain(await open("bidi", "bidi 2"));
    expect(received).toEqual({ "2": "uni 1", "0": "bidi 1", "6": "uni 2", "10": "uni 3", "4": "bidi 2" });
  });

  test.each(["uni", "bidi"] as const)(
    "a %s stream destroyed before the handshake doesn't use a stream ID",
    async direction => {
      await using sessions = await connected(readAndHold(0n, Promise.resolve()), raw.server, raw.client);
      const { client } = sessions;
      const open = opener(client);

      (await open(direction, "never sent")).destroy();
      await client.opened;
      expect((await open(direction, "first")).id).toBe(direction === "uni" ? 2n : 0n);
    },
  );

  // The peer allows four streams and holds them. Four more wait for credit and are destroyed, as a request timeout does.
  test.each(["uni", "bidi"] as const)(
    "a %s stream destroyed while it waits for stream credit doesn't use the credit",
    async direction => {
      const release = Promise.withResolvers<void>();
      await using sessions = await connected(
        readAndHold(16n, release.promise),
        { ...raw.server, transportParams: { initialMaxStreamsBidi: 4, initialMaxStreamsUni: 4 } },
        raw.client,
      );
      const { client } = sessions;
      const open = opener(client);
      await client.opened;

      const streams: any[] = [];
      for (let i = 0; i < 8; i++) streams.push(await open(direction, "held"));
      expect(streams.map(stream => stream.pending)).toEqual([false, false, false, false, true, true, true, true]);
      for (const waiting of streams.slice(4)) waiting.destroy();

      const next = await open(direction, "next");
      release.resolve();
      await sent(next);
      const later = [await open(direction, "a"), await open(direction, "b"), await open(direction, "c")];
      await Promise.all(later.map(sent));
      const first = direction === "uni" ? 18n : 16n;
      expect([next, ...later].map(stream => stream.id)).toEqual([first, first + 4n, first + 8n, first + 12n]);
    },
  );

  // The peer allows one stream and holds it, so the second one waits for stream credit.
  test.each(["uni", "bidi"] as const)(
    "the peer gets the resetStream() and stopSending() of a %s stream that waited for stream credit",
    async direction => {
      const release = Promise.withResolvers<void>();
      const peerSaw: string[] = [];
      await using sessions = await connected(
        session => {
          session.onstream = async (stream: any) => {
            stream.closed.catch(() => {});
            stream.onreset = (error: any) => peerSaw.push(`reset ${stream.id} ${error.errorCode}`);
            stream.onstopsending = (error: any) => peerSaw.push(`stopSending ${stream.id} ${error.errorCode}`);
            if (stream.id < 4n) await release.promise;
            try {
              await drain(stream);
              if (stream.direction === "bidi") stream.writer.endSync();
            } catch {}
          };
        },
        { ...raw.server, transportParams: { initialMaxStreamsBidi: 1, initialMaxStreamsUni: 1 } },
        raw.client,
      );
      const { client } = sessions;
      const open = opener(client);
      await client.opened;

      await open(direction, "held");
      const waiting = await open(direction, "never sent");
      expect(waiting.pending).toBe(true);
      waiting.resetStream(7n);
      waiting.stopSending(9n);
      // This one opens once the peer is done with the stream that was reset.
      const next = await open(direction, "next");
      release.resolve();
      await Promise.race([sent(next), client.closed]).catch(() => {});
      expect({ peerSaw: peerSaw.sort(), next: next.id }).toEqual(
        direction === "uni"
          ? { peerSaw: ["reset 6 7"], next: 10n }
          : { peerSaw: ["reset 4 7", "stopSending 4 9"], next: 8n },
      );
    },
    30_000,
  );

  test.each([
    ["uni", "the handshake"],
    ["uni", "stream credit"],
    ["bidi", "the handshake"],
    ["bidi", "stream credit"],
  ] as const)("destroying a %s stream between two that wait for %s keeps their order", async (direction, wait) => {
    const credit = wait === "stream credit";
    const release = Promise.withResolvers<void>();
    await using sessions = await connected(
      readAndHold(credit ? 8n : 0n, release.promise),
      { ...raw.server, transportParams: credit ? { initialMaxStreamsBidi: 2, initialMaxStreamsUni: 2 } : {} },
      raw.client,
    );
    const { client } = sessions;
    const open = opener(client);
    let first = direction === "uni" ? 2n : 0n;
    if (credit) {
      await client.opened;
      await open(direction, "held");
      await open(direction, "held");
      first += 8n;
    }

    const a = await open(direction, "a");
    const b = await open(direction, "b");
    const c = await open(direction, "c");
    expect([a.pending, b.pending, c.pending]).toEqual([true, true, true]);
    b.destroy();
    const d = await open(direction, "d");

    release.resolve();
    await Promise.all([a, c, d].map(sent));
    const e = await open(direction, "e");
    await sent(e);
    expect([a, c, d, e].map(stream => stream.id)).toEqual([first, first + 4n, first + 8n, first + 12n]);
  });

  test("an HTTP/3 session opens a unidirectional stream requested before the handshake after its own three", async () => {
    await using sessions = await connected(readAndHold(0n, Promise.resolve()), {
      // Each side's control, QPACK encoder and QPACK decoder streams use up the default limit of three.
      transportParams: { initialMaxStreamsUni: 10 },
      onheaders(this: any) {
        this.sendHeaders({ ":status": "200" }, { terminal: true });
      },
    });
    const { client } = sessions;

    const pending = await opener(client)("uni", "early");
    await client.opened;
    // The client has read the server's SETTINGS, and opened its QPACK encoder stream, once a request is answered.
    const answered = Promise.withResolvers<void>();
    const request = await client.createBidirectionalStream({
      headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
      onheaders: () => answered.resolve(),
    });
    request.closed.catch(() => {});
    await answered.promise;
    expect(pending.id).toBe(14n);
  });
});

// https://github.com/oven-sh/bun/issues/45501
describe("QuicStream.opened", () => {
  const serverOptions = {
    sni: { "*": { keys: [key], certs: [cert] } },
    alpn: "quic-test",
    transportParams: { initialMaxStreamsBidi: 1 },
  };
  const clientOptions = {
    alpn: "quic-test",
    servername: "localhost",
    verifyPeer: "manual",
  } as SessionOptions;

  // The server answers each FIN with its own, so a finished stream closes and frees its stream credit.
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
    try {
      await client.opened;
      const stream: any = await client.createBidirectionalStream();
      stream.closed.catch(() => {});
      expect(stream.pending).toBe(false);
      expect(stream.opened).toBeInstanceOf(Promise);
      expect(stream.opened).toBe(stream.opened);
      await expect(stream.opened).resolves.toBeUndefined();
    } finally {
      client.close();
    }
  });

  test("is fulfilled once a pending stream gets its ID", async () => {
    await using server = await startServer();
    const client = await connect(server.address!, clientOptions);
    try {
      await client.opened;
      const first: any = await client.createBidirectionalStream();
      first.closed.catch(() => {});
      const second: any = await client.createBidirectionalStream();
      second.closed.catch(() => {});
      expect(second.pending).toBe(true);
      expect(second.id).toBeNull();
      const opened = second.opened.then(() => ({ pending: second.pending, id: second.id }));

      first.writer.writeSync(Uint8Array.of(1));
      first.writer.endSync();
      for await (const _ of first) {
      }
      await first.closed;

      expect(await opened).toEqual({ pending: false, id: 4n });
    } finally {
      client.close();
    }
  });

  test("rejects when a pending stream is destroyed before it opens", async () => {
    await using server = await startServer();
    const client = await connect(server.address!, clientOptions);
    try {
      await client.opened;
      const first: any = await client.createBidirectionalStream();
      first.closed.catch(() => {});
      const awaited: any = await client.createBidirectionalStream();
      awaited.closed.catch(() => {});
      const readLater: any = await client.createBidirectionalStream();
      readLater.closed.catch(() => {});
      expect(awaited.pending).toBe(true);
      expect(readLater.pending).toBe(true);

      const opened = awaited.opened;
      awaited.destroy(new Error("destroyed while pending"));
      await expect(opened).rejects.toThrow("destroyed while pending");

      // Reading `opened` for the first time after destroy() gives the same result.
      readLater.destroy(new Error("destroyed before read"));
      await expect(readLater.opened).rejects.toThrow("destroyed before read");

      // It stays fulfilled for a stream that did open.
      first.destroy(new Error("after open"));
      await expect(first.opened).resolves.toBeUndefined();
    } finally {
      client.close();
    }
  });
});

describe("QuicStream.onstopsending", () => {
  const serverOptions = { sni: { "*": { keys: [key], certs: [cert] } }, alpn: "quic-test" };
  const clientOptions = { alpn: "quic-test", servername: "localhost", verifyPeer: "manual" } as SessionOptions;

  test("is called with the peer's application error when STOP_SENDING arrives", async () => {
    const accepted = Promise.withResolvers<any>();
    await using server = await listen(async serverSession => {
      serverSession.onstream = (stream: any) => {
        stream.closed.catch(() => {});
        accepted.resolve(stream);
      };
      await serverSession.closed.catch(() => {});
    }, serverOptions);
    const client = await connect(server.address!, clientOptions);
    try {
      await client.opened;

      const stream: any = await client.createBidirectionalStream();
      stream.closed.catch(() => {});
      expect(() => {
        stream.onstopsending = 1;
      }).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));

      const stopped = Promise.withResolvers<{ sameStream: boolean; error: any }>();
      stream.onstopsending = function (this: any, error: any) {
        stopped.resolve({ sameStream: this === stream, error });
      };
      expect(typeof stream.onstopsending).toBe("function");

      stream.writer.writeSync(Uint8Array.of(1));
      const remote = await accepted.promise;
      remote.stopSending(42n);

      const { sameStream, error } = await stopped.promise;
      expect(sameStream).toBe(true);
      expect(error).toMatchObject({ code: "ERR_QUIC_APPLICATION_ERROR", errorCode: 42n });
      // Node's writer fails with the same error.
      expect(stream.writer.desiredSize).toBeNull();
      await expect(stream.writer.write(Uint8Array.of(2))).rejects.toBe(error);
    } finally {
      client.close();
    }
  });

  test("is called when STOP_SENDING is the first frame of a peer-opened stream", async () => {
    const stopped = Promise.withResolvers<{ before: number | null; error: any; after: number | null }>();
    await using server = await listen(async serverSession => {
      serverSession.onstream = (stream: any) => {
        stream.closed.catch(() => {});
        const before = stream.writer.desiredSize;
        stream.onstopsending = (error: any) => {
          stopped.resolve({ before, error, after: stream.writer.desiredSize });
        };
      };
      await serverSession.closed.catch(() => {});
    }, serverOptions);
    const client = await connect(server.address!, clientOptions);
    try {
      await client.opened;

      const stream: any = await client.createBidirectionalStream();
      stream.closed.catch(() => {});
      stream.stopSending(11n);

      const { before, error, after } = await stopped.promise;
      expect(before).toBeGreaterThan(0);
      expect(error).toMatchObject({ code: "ERR_QUIC_APPLICATION_ERROR", errorCode: 11n });
      expect(after).toBeNull();
    } finally {
      client.close();
    }
  });

  // An unhandled rejection fails the test.
  test("doesn't leave closed's rejection unhandled when the peer resets the stream too", async () => {
    const accepted = Promise.withResolvers<any>();
    await using server = await listen(async serverSession => {
      serverSession.onstream = (stream: any) => {
        stream.closed.catch(() => {});
        accepted.resolve(stream);
      };
      await serverSession.closed.catch(() => {});
    }, serverOptions);
    const client = await connect(server.address!, clientOptions);
    try {
      client.closed.catch(() => {});
      await client.opened;

      // Nothing reads `stream.closed`.
      const stream: any = await client.createBidirectionalStream();
      const stopped = Promise.withResolvers<void>();
      stream.onstopsending = () => stopped.resolve();
      stream.writer.writeSync(Uint8Array.of(1));
      const remote = await accepted.promise;
      remote.destroy(new Error("peer error"), { code: 9n });
      await stopped.promise;
      while (!stream.destroyed) await new Promise(r => setImmediate(r));
      await new Promise(r => setImmediate(r));
    } finally {
      client.close();
    }
    await client.closed;
  });
});
