// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isCI } from "harness";
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen, QuicEndpoint } from "node:quic";

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

// A close that waits for a pending stream gives no signal. It ends when a
// timer fires, and the sessions of the last describe block have no timer that
// can. This deadline reports that wait as a value, so it fails an assertion.
// CI runs many files at once, so a close that is only slow gets more time there.
const parkedAfter = isCI ? 15_000 : 3_000;

// The HTTP/3 cases of the last describe block used to crash, so
// quic-close-before-handshake-fixture.ts runs them in a process of its own. It
// starts before the first test of this file: a debug build needs most of a
// test's default timeout to load node:quic again.
let fixture: ReturnType<typeof Bun.spawn> | undefined;
let fixtureResult: Promise<{ stdout: string[]; stderr: string; exitCode: number; signalCode: string | null }>;
beforeAll(() => {
  const proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "quic-close-before-handshake-fixture.ts")],
    env: { ...bunEnv, PARKED_AFTER_MS: String(parkedAfter) },
    stdout: "pipe",
    stderr: "pipe",
  });
  fixture = proc;
  fixtureResult = Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]).then(
    ([stdout, stderr, exitCode]) => ({
      stdout: stdout.trim().split("\n"),
      stderr,
      exitCode,
      signalCode: proc.signalCode,
    }),
  );
});
afterAll(() => fixture?.kill());

// A stream is pending until lsquic opens it: before the handshake ends, or
// while the peer's stream limit is used up. A pending stream does not hold a
// graceful close open.
describe("session.close() with a stream that is still pending", () => {
  const GET = { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" };
  const outcome = (promise: Promise<unknown>) =>
    promise.then(
      () => "fulfilled",
      e => e?.code ?? String(e),
    );

  async function unlessParked<T>(result: Promise<T>) {
    const deadline = Promise.withResolvers<"still parked">();
    const timer = setTimeout(deadline.resolve, parkedAfter, "still parked");
    try {
      return await Promise.race([result, deadline.promise]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Raw QUIC sends no GOAWAY. Its close waited for the body of the pending
  // stream, which cannot leave before the handshake ends.
  test("before the handshake ends, closes a raw QUIC session at once", async () => {
    // Nothing answers on this socket.
    const silent = await Bun.udpSocket({ hostname: "127.0.0.1" });
    // An endpoint takes `handshakeTimeout` from its first connect(), so this
    // session gets an endpoint of its own. No timer can then end the session.
    // 0 would turn the handshake timer off, but Node aborts on it.
    const endpoint = new QuicEndpoint();
    try {
      const session = await connect(
        { address: "127.0.0.1", port: silent.port },
        {
          endpoint,
          alpn: "quic-test",
          servername: "localhost",
          verifyPeer: "manual",
          handshakeTimeout: 600_000,
          transportParams: { maxIdleTimeout: 0 },
        },
      );
      const opened = outcome(session.opened);
      const stream = await session.createBidirectionalStream({ body: new TextEncoder().encode("hello") });
      const streamClosed = outcome(stream.closed);
      const pending = stream.pending;
      const result = await unlessParked(
        (async () => ({ closed: await outcome(session.close()), opened: await opened, stream: await streamClosed }))(),
      );

      expect({ pending, result }).toEqual({
        pending: true,
        result: { closed: "fulfilled", opened: "ERR_INVALID_STATE", stream: "fulfilled" },
      });
    } finally {
      await endpoint.destroy();
      silent.close();
    }
  });

  // The peer allows two streams. Two requests are open and a third one is
  // pending when close() runs. close() sends a GOAWAY, waits for the two open
  // requests, and never opens the third one.
  test("after the handshake, waits for the open streams and not for one over the peer's stream limit", async () => {
    const paths: string[] = [];
    const firstOnServer = Promise.withResolvers<any>();
    const server = await listen(
      serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.closed.catch(() => {});
        };
        serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { initialMaxStreamsBidi: 2, maxIdleTimeout: 0 },
        async onheaders(this: any, headers: Record<string, string>) {
          const path = headers[":path"];
          paths.push(path);
          this.sendHeaders({ ":status": "200" });
          if (path === "/first") return firstOnServer.resolve(this);
          if (path === "/upload") {
            try {
              for await (const _ of this);
            } catch {}
            this.writer.writeSync(new TextEncoder().encode("late"));
          }
          this.writer.endSync();
        },
      },
    );
    let client: any;
    try {
      client = await connect(server.address, {
        servername: "localhost",
        verifyPeer: "manual",
        transportParams: { maxIdleTimeout: 0 },
      });
      await client.opened;
      const firstAnswered = Promise.withResolvers<void>();
      const uploadAnswered = Promise.withResolvers<void>();
      const first = await client.createBidirectionalStream({
        headers: { ...GET, ":path": "/first" },
        onheaders: () => firstAnswered.resolve(),
      });
      const upload = await client.createBidirectionalStream({ onheaders: () => uploadAnswered.resolve() });
      upload.sendHeaders({ ...GET, ":method": "POST", ":path": "/upload" });
      const third = await client.createBidirectionalStream({ headers: { ...GET, ":path": "/third" } });
      const pending = [first.pending, upload.pending, third.pending];
      const thirdClosed = outcome(third.closed);
      // Both requests are answered, so the server has everything the client sent.
      await Promise.all([firstAnswered.promise, uploadAnswered.promise]);

      const closed = client.close();
      const result = await unlessParked(
        (async () => {
          // The end of the first request frees a stream at the server. The
          // client ends its upload after that, and the packet that carries
          // the end acknowledges the first response. So the stream credit of
          // the server reaches the client before the answer to the upload.
          (await firstOnServer.promise).writer.endSync();
          await outcome(first.closed);
          upload.writer.endSync();
          let body = "";
          try {
            for await (const batch of upload) for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
          } catch {}
          return { body, closed: await outcome(closed), third: await thirdClosed };
        })(),
      );

      expect({ pending, result, paths }).toEqual({
        pending: [false, false, true],
        result: { body: "late", closed: "fulfilled", third: "fulfilled" },
        paths: ["/first", "/upload"],
      });
    } finally {
      client?.destroy();
      await server.destroy();
    }
  });

  // The GOAWAY of an HTTP/3 close needs the control stream, which the client
  // creates when the handshake ends. The write used to go through a null list.
  test("before the handshake ends, closes an HTTP/3 session at once and does not crash", async () => {
    const closedAtOnce = "closed fulfilled, opened ERR_INVALID_STATE, stream.closed fulfilled";
    expect(await fixtureResult).toEqual({
      stdout: [
        `close(), an empty stream: ${closedAtOnce}`,
        `close(), a request: ${closedAtOnce}`,
        `close(), a stream with a body: ${closedAtOnce}`,
        `close(), a unidirectional stream: ${closedAtOnce}`,
        `Symbol.asyncDispose: ${closedAtOnce}`,
        `close() in a callback of another session: ${closedAtOnce}`,
      ],
      stderr: expect.stringContaining("ExperimentalWarning: quic is an experimental feature"),
      exitCode: 0,
      signalCode: null,
    });
  });
});
