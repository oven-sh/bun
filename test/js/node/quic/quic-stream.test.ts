// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, runCommandMaxRSS, withoutAsanQuarantine } from "harness";
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

// A debug build takes about 3 s to load node:quic in a fixture.
const fixtureTimeout = 60_000;

// The native side keeps the unsent body of a stream in one queue. Every write
// to lsquic used to copy all of that queue first, and setBody() copied the
// body twice on the way in. The native side must hold the body once,
// whichever way it is handed over. The fixture says what it measures.
describe.concurrent("a queued body is buffered natively exactly once", () => {
  async function fixturePeak(mode: string) {
    const { stdout, stderr, exitCode, maxRSS } = await runCommandMaxRSS({
      cmd: [bunExe(), join(import.meta.dir, "outbound-body-rss-fixture.ts"), mode],
      env: withoutAsanQuarantine(bunEnv),
    });
    if (exitCode !== 0) throw new Error(`the fixture exited with ${exitCode}:\n${stderr}`);
    const { bodyBytes, bytesSent }: { bodyBytes: number; bytesSent: number } = JSON.parse(stdout);
    return { maxRSS, bodyBytes, bytesSent };
  }
  let baseline: ReturnType<typeof fixturePeak> | undefined;

  test.each(["open", "setBody", "writer"])(
    "%s",
    async mode => {
      const [none, handedOver] = await Promise.all([(baseline ??= fixturePeak("none")), fixturePeak(mode)]);
      expect(handedOver.bytesSent).toBeGreaterThan(0);
      // About 1 measured. About 2 with a copy of the queue for every write.
      expect((handedOver.maxRSS - none.maxRSS) / handedOver.bodyBytes).toBeLessThan(1.5);
    },
    fixtureTimeout,
  );
});

// A write offers lsquic all of the queue, and lsquic takes at most one stream
// window of it. Every write used to copy the whole queue first, so a body
// cost the sender the square of its size. The fixture queues 48 MiB behind a
// window of 16 KiB and says how it measures.
describe("a large body handed to a stream in one piece", () => {
  // process.cpuUsage() advances in ticks of about 15.6 ms on Windows.
  test.skipIf(isWindows)(
    "costs the CPU time of the same bytes in 64 KiB bodies",
    async () => {
      const measuredMiB = isDebug ? 1 : isASAN ? 4 : 16;
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(import.meta.dir, "outbound-body-cpu-fixture.ts"), "48", String(measuredMiB)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (exitCode !== 0) throw new Error(`the fixture exited with ${exitCode}:\n${stderr}`);
      const { pieces, whole, blockedWrites } = JSON.parse(stdout);
      // Every one of these writes had the rest of the 48 MiB queued behind it.
      expect(blockedWrites).toBeGreaterThanOrEqual(measuredMiB * 64);
      // About 1 when a write costs what lsquic takes. 6 and up, whatever the
      // build, when every write copies the queue first.
      expect(whole / pieces).toBeLessThan(4);
    },
    fixtureTimeout,
  );
});

// lsquic refuses every write of an HTTP/3 body that comes before the header
// block: it returns -1. The queue must stay as it is, and the body must go
// out after sendHeaders().
describe("a body written before the header block", () => {
  test("waits for sendHeaders() and arrives intact", async () => {
    const body = Buffer.alloc(1024 * 1024);
    for (let offset = 0; offset < body.length; offset += 4) body.writeUInt32LE(offset, offset);

    const refused = Promise.withResolvers<{ stream: any; bytesSent: bigint }>();
    async function respond(stream: any) {
      const blocked = Promise.withResolvers<void>();
      stream.onblocked = () => blocked.resolve();
      stream.closed.then(
        () => blocked.reject(new Error("the stream closed before a write was refused")),
        blocked.reject,
      );
      stream.writer.writeSync(body);
      await blocked.promise;
      refused.resolve({ stream, bytesSent: stream.stats.bytesSent });
      stream.sendHeaders({ ":status": "200" });
      stream.writer.endSync();
    }

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
          respond(this).catch(refused.reject);
        },
      },
    );

    const client = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    } as SessionOptions);
    await client.opened;
    const status = Promise.withResolvers<string>();
    const stream = await client.createBidirectionalStream({
      headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
      onheaders(headers: Record<string, any>) {
        status.resolve(headers[":status"]);
      },
    });
    stream.closed.catch(status.reject);

    const chunks: Uint8Array[] = [];
    for await (const batch of stream) chunks.push(...batch);
    const received = Buffer.concat(chunks);
    const atRefusal = await refused.promise;
    client.close();

    expect({
      status: await status.promise,
      bytesSentAtRefusal: atRefusal.bytesSent,
      bytesSentAtEnd: atRefusal.stream.stats.bytesSent,
      receivedLength: received.length,
      receivedEqualsBody: received.equals(body),
    }).toEqual({
      status: "200",
      bytesSentAtRefusal: 0n,
      bytesSentAtEnd: BigInt(body.length),
      receivedLength: body.length,
      receivedEqualsBody: true,
    });
  });
});

// The queue is a ring buffer, and lsquic gets its two halves in one write.
// This test makes the queue wrap and checks the bytes that arrive. The
// receiver's stream window is smaller than a chunk, so lsquic takes a part of
// every chunk. highWaterMark equals the chunk size, so the next chunk is
// queued while the previous one still has a tail in the queue. Chunk 1 sizes
// the buffer, chunk 2 grows it and ends at its physical end, and from then on
// every other chunk wraps around to the front.
describe("outbound queue wrap-around", () => {
  test("a body fed through a wrapped queue arrives intact", async () => {
    const CHUNK = 48 * 1024;
    const chunks = Array.from({ length: 8 }, (_, i) => Buffer.alloc(CHUNK, `chunk ${i} `));

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
    const stream = await client.createBidirectionalStream({ highWaterMark: CHUNK });
    stream.closed.catch(() => {});
    stream.setBody(
      (async function* () {
        yield* chunks;
      })(),
    );

    const expected = Buffer.concat(chunks);
    const got = await received.promise;
    client.close();
    const firstMismatch = got.findIndex((byte, i) => byte !== expected[i]);
    expect({ length: got.length, firstMismatch }).toEqual({ length: expected.length, firstMismatch: -1 });
  });
});
