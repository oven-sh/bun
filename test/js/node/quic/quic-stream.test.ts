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

// A locally opened stream takes its ID and one unit of the peer's MAX_STREAMS
// credit (its place) when it is created. The peer returns the place only
// after it has seen the stream end, so destroy() before the first write still
// has to put RESET_STREAM / STOP_SENDING on the wire, whatever the session
// does next.
describe("QuicStream.destroy before the first write", () => {
  type Direction = "bidi" | "uni";
  type How = "destroy(err)" | "destroy()";
  type StreamLog = { seen: string[]; resets: string[]; ended: string[]; bodies: Record<string, string> };

  const directions = ["bidi", "uni"] as const;
  const hows = [
    ["destroy(err)", 1],
    ["destroy()", 0],
  ] as const;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const readAll = async (stream: any) => {
    let text = "";
    for await (const batch of stream) for (const chunk of batch) text += decoder.decode(chunk);
    return text;
  };
  const newLog = (): StreamLog => ({ seen: [], resets: [], ended: [], bodies: {} });

  // Records every stream the peer opens on `session`: its id, what was read
  // from it, every reset, and its end. A bidirectional stream that was read
  // to its end gets its data echoed, after `beforeAnswer` when there is one.
  // A stream whose read fails gets no answer and its writer stays untouched,
  // so it ends at this side only when the peer also sent STOP_SENDING.
  function record(session: any, log: StreamLog, beforeAnswer?: (body: string) => Promise<void>) {
    session.onstream = async (stream: any) => {
      const id = String(stream.id);
      log.seen.push(id);
      const ended = () => log.ended.push(id);
      stream.closed.then(ended, ended);
      stream.onreset = (err: any) => log.resets.push(`${id}:${err?.errorCode}`);
      const body = await readAll(stream).catch(() => undefined);
      if (body === undefined) return;
      log.bodies[id] = body;
      await beforeAnswer?.(body);
      try {
        if (body) stream.writer.writeSync(encoder.encode(body));
        stream.writer.endSync();
      } catch {}
    };
    return log;
  }

  // An echo server that allows `limit` streams of each direction at a time.
  // `logs[n]` is what its n-th session was shown, and `log` is `logs[0]`.
  async function echoServer(
    limit: number,
    options: {
      transportParams?: Record<string, number>;
      onsession?: (serverSession: any) => void;
      beforeAnswer?: (serverSession: any, body: string) => Promise<void>;
    } = {},
  ) {
    const logs = [newLog()];
    const sessions: any[] = [];
    const sessionClosed = Promise.withResolvers<void>();
    const endpoint = await listen(
      (serverSession: any) => {
        const log = (logs[sessions.length] ??= newLog());
        sessions.push(serverSession);
        serverSession.onerror = () => {};
        serverSession.closed.then(sessionClosed.resolve, sessionClosed.resolve);
        record(serverSession, log, options.beforeAnswer && (body => options.beforeAnswer!(serverSession, body)));
        options.onsession?.(serverSession);
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        alpn: ["quic-test"],
        transportParams: {
          maxIdleTimeout: 5,
          initialMaxStreamsBidi: limit,
          initialMaxStreamsUni: limit,
          ...options.transportParams,
        },
      },
    );
    return { endpoint, log: logs[0], logs, sessions, sessionClosed: sessionClosed.promise };
  }

  async function dial(endpoint: QuicEndpoint, options: Record<string, unknown> = {}) {
    const client: any = await connect(endpoint.address!, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 5 },
      onerror() {},
      ...options,
    } as SessionOptions);
    client.closed.catch(() => {});
    return client;
  }

  // Returns inside the dispatch that reported the handshake: what the caller
  // does next, up to its first macrotask, is the client's opening flight.
  async function connectTo(endpoint: QuicEndpoint, options?: Record<string, unknown>) {
    const client = await dial(endpoint, options);
    await client.opened;
    return client;
  }

  async function open(session: any, direction: Direction = "bidi") {
    const stream =
      direction === "uni" ? await session.createUnidirectionalStream() : await session.createBidirectionalStream();
    stream.closed.catch(() => {});
    return stream;
  }

  const write = (stream: any, text: string) => {
    stream.writer.writeSync(encoder.encode(text));
    stream.writer.endSync();
    return stream;
  };

  // A whole request on a new stream. The server handles packets in order, so
  // once the echo is back it has handled everything the client sent before it.
  const echo = async (client: any, text: string) => readAll(write(await open(client), text));

  const destroy = (stream: any, how: How = "destroy(err)") =>
    how === "destroy()" ? stream.destroy() : stream.destroy(new Error("abandoned"));

  // Opens a stream that has its place, and destroys it before anything is
  // written on it. `before` runs between the two.
  async function abandon(
    session: any,
    direction: Direction = "bidi",
    how: How = "destroy(err)",
    before?: (stream: any) => void,
  ) {
    const stream = await open(session, direction);
    expect(stream.pending).toBe(false);
    const id = String(stream.id);
    before?.(stream);
    destroy(stream, how);
    return id;
  }

  // Runs `fn` from a timer callback: no node:quic dispatch is on the stack.
  function fromTimer<T>(fn: () => Promise<T>): Promise<T> {
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    setTimeout(() => fn().then(resolve, reject), 0);
    return promise;
  }

  const sessionEnd = (session: any) =>
    session.closed.then(
      () => "closed",
      () => "closed",
    );

  // What the peer was shown of stream `id`.
  const shown = (log: StreamLog, id: string) => ({
    seen: log.seen.includes(id),
    resets: log.resets.filter(reset => reset.startsWith(`${id}:`)),
  });
  const streamsCounted = (session: any) => {
    const { bidiInStreamCount, uniInStreamCount } = session.stats;
    return { bidi: bidiInStreamCount, uni: uniInStreamCount };
  };

  describe.each(hows)("%s", (how, code) => {
    describe.each(directions)("of a %s stream reaches the peer", direction => {
      const reached = (id: string) => ({ echoed: "next", seen: true, resets: [`${id}:${code}`] });

      test("from a timer callback, although another stream writes in the same turn", async () => {
        const { endpoint, log } = await echoServer(4);
        await using server = endpoint;
        const client = await connectTo(server);
        const { id, echoed } = await fromTimer(async () => {
          const id = await abandon(client, direction, how);
          return { id, echoed: await echo(client, "next") };
        });
        client.close();
        expect({ echoed, ...shown(log, id) }).toEqual(reached(id));
      });

      test("inside a dispatch, although another stream writes in the same turn", async () => {
        const { endpoint, log } = await echoServer(4);
        await using server = endpoint;
        const client = await connectTo(server);
        // What follows an echo runs inside the dispatch that delivered it.
        await fromTimer(() => echo(client, "first"));
        const id = await abandon(client, direction, how);
        const echoed = await echo(client, "next");
        await fromTimer(() => echo(client, "later"));
        client.close();
        expect({ echoed, ...shown(log, id) }).toEqual(reached(id));
      });

      test("inside the handshake dispatch, although another stream writes in a later turn", async () => {
        const { endpoint, log } = await echoServer(4);
        await using server = endpoint;
        const client = await connectTo(server);
        const id = await abandon(client, direction, how);
        const echoed = await fromTimer(() => echo(client, "next"));
        client.close();
        expect({ echoed, ...shown(log, id) }).toEqual(reached(id));
      });

      // `onblocked` reports a flow-control limit that the client's own write
      // ran into. No packet delivers it: the microtask-drain pass does.
      test("inside a callback that the microtask-drain pass delivers, although another stream writes in it", async () => {
        const { endpoint, log } = await echoServer(4, { transportParams: { initialMaxStreamDataBidiRemote: 1024 } });
        await using server = endpoint;
        const client = await connectTo(server);
        const { id, echoed } = await fromTimer(async () => {
          const unwritten = await open(client, direction);
          const id = String(unwritten.id);
          const blocked = await open(client);
          const next = Promise.withResolvers<string>();
          blocked.onblocked = () => {
            if (unwritten.destroyed) return;
            destroy(unwritten, how);
            next.resolve(echo(client, "next"));
          };
          // More than the stream's window: the write blocks in this turn.
          blocked.writer.writeSync(new Uint8Array(4096).fill(97));
          blocked.writer.endSync();
          return { id, echoed: await next.promise };
        });
        client.close();
        expect({ echoed, ...shown(log, id) }).toEqual(reached(id));
      });
    });
  });

  test("from timer callbacks, abandoned streams give their place back", async () => {
    // With 3 places the server returns credit only once 2 streams have ended,
    // so the request below opens only if both abandoned streams were retired.
    const limit = 3;
    const { endpoint, log } = await echoServer(limit);
    await using server = endpoint;
    const client = await connectTo(server);
    // One stream stays open and writes after each destroy. The others are
    // abandoned, so together they use every place the server allows.
    const busy = await open(client);
    const abandoned: string[] = [];
    for (let i = 1; i < limit; i++) {
      await fromTimer(async () => {
        abandoned.push(await abandon(client));
        busy.writer.writeSync(encoder.encode("busy"));
      });
    }
    const echoed = await Promise.race([echo(client, "again"), sessionEnd(client)]);
    client.close();
    expect({ echoed, unseen: abandoned.filter(id => !log.seen.includes(id)), resets: log.resets }).toEqual({
      echoed: "again",
      unseen: [],
      resets: abandoned.map(id => `${id}:1`),
    });
  });

  test.each(directions)(
    "inside a dispatch, a loop that abandons a %s stream before each request keeps its places",
    async direction => {
      const limit = 2;
      const { endpoint, log } = await echoServer(limit);
      await using server = endpoint;
      const client = await connectTo(server);
      // What follows an echo runs inside the dispatch that delivered it.
      await fromTimer(() => echo(client, "first"));
      const abandoned: string[] = [];
      const echoed: string[] = [];
      const end = sessionEnd(client);
      for (let i = 0; i <= limit + 1; i++) {
        abandoned.push(await abandon(client, direction));
        echoed.push(await Promise.race([echo(client, `request ${i}`), end]));
      }
      client.close();
      expect({ echoed, unseen: abandoned.filter(id => !log.seen.includes(id)), resets: log.resets }).toEqual({
        echoed: ["request 0", "request 1", "request 2", "request 3"],
        unseen: [],
        resets: abandoned.map(id => `${id}:1`),
      });
    },
  );

  // destroy() delivers what the app wrote and ended before it, as it does for
  // a stream that lsquic already holds data of.
  describe("after a write and an end inside a dispatch", () => {
    test.each(hows)("%s delivers the data", async how => {
      const { endpoint, log } = await echoServer(4);
      await using server = endpoint;
      const client = await connectTo(server);
      await fromTimer(() => echo(client, "first"));
      const stream = write(await open(client), "payload");
      const id = String(stream.id);
      destroy(stream, how);
      await echo(client, "next");
      await fromTimer(() => echo(client, "later"));
      client.close();
      expect({ body: log.bodies[id], ...shown(log, id) }).toEqual({ body: "payload", seen: true, resets: [] });
    });

    test("destroy() resets the stream when the peer's window is smaller than the data", async () => {
      const { endpoint, log } = await echoServer(4, { transportParams: { initialMaxStreamDataBidiRemote: 1024 } });
      await using server = endpoint;
      const client = await connectTo(server);
      await fromTimer(() => echo(client, "first"));
      const stream = await open(client);
      const id = String(stream.id);
      stream.writer.writeSync(new Uint8Array(4096).fill(97));
      stream.writer.endSync();
      stream.destroy();
      await echo(client, "next");
      await fromTimer(() => echo(client, "later"));
      client.close();
      // Never a short body with a clean end.
      expect({ body: log.bodies[id], ...shown(log, id) }).toEqual({ body: undefined, seen: true, resets: [`${id}:0`] });
    });
  });

  // The client's opening flight is what follows `await session.opened`, up to
  // the first macrotask. It runs inside the callback that reports the
  // handshake.
  describe("in the opening flight", () => {
    test("data queued on a stream that waits for a place does not retract the reset", async () => {
      const { endpoint, log } = await echoServer(1);
      await using server = endpoint;
      const client = await connectTo(server);
      const id = await abandon(client);
      // This request can only open once the abandoned place is back.
      const echoed = await Promise.race([echo(client, "next"), sessionEnd(client)]);
      client.close();
      expect({ echoed, ...shown(log, id) }).toEqual({ echoed: "next", seen: true, resets: [`${id}:1`] });
    });

    test("a stream that wrote and was destroyed does not retract the reset", async () => {
      const { endpoint, log } = await echoServer(4);
      await using server = endpoint;
      const client = await connectTo(server);
      const id = await abandon(client);
      const other = await open(client);
      const otherId = String(other.id);
      other.writer.writeSync(encoder.encode("dropped"));
      destroy(other);
      const echoed = await fromTimer(() => echo(client, "next"));
      client.close();
      expect({ echoed, first: shown(log, id), other: shown(log, otherId) }).toEqual({
        echoed: "next",
        first: { seen: true, resets: [`${id}:1`] },
        other: { seen: true, resets: [`${otherId}:1`] },
      });
    });

    test.each([
      [
        "a write on an older stream before the destroy",
        async (client: any) => {
          const busy = write(await open(client), "next");
          return { busy, id: await abandon(client) };
        },
      ],
      [
        "a write on a newer stream before the destroy",
        async (client: any) => {
          const unwritten = await open(client);
          const id = String(unwritten.id);
          const busy = write(await open(client), "next");
          destroy(unwritten);
          return { busy, id };
        },
      ],
      [
        "a body on a stream created after the destroy",
        async (client: any) => {
          const id = await abandon(client);
          const busy = await client.createBidirectionalStream({ body: encoder.encode("next") });
          busy.closed.catch(() => {});
          return { busy, id };
        },
      ],
    ] as const)("another stream with data to send does not retract the reset (%s)", async (_, arrange) => {
      const { endpoint, log } = await echoServer(4);
      await using server = endpoint;
      const client = await connectTo(server);
      const { busy, id } = await arrange(client);
      const echoed = await readAll(busy);
      await fromTimer(() => echo(client, "later"));
      client.close();
      expect({ echoed, ...shown(log, id) }).toEqual({ echoed: "next", seen: true, resets: [`${id}:1`] });
    });

    // The one case in which the peer never hears of the stream: a writer
    // write, later in the same flight, on a stream that is still open when the
    // flight ends. Node does the same, and
    // test-quic-callback-error-stream-onerror.mjs depends on it. The place of
    // each hidden stream is lost.
    test.each([
      [
        "on a newer stream",
        async (client: any) => {
          const ids = [await abandon(client)];
          return { ids, busy: write(await open(client), "next") };
        },
      ],
      [
        "on an older stream",
        async (client: any) => {
          const busy = await open(client);
          const ids = [await abandon(client)];
          return { ids, busy: write(busy, "next") };
        },
      ],
      [
        "after two destroys",
        async (client: any) => {
          const [first, second] = [await open(client), await open(client)];
          const ids = [String(first.id), String(second.id)];
          destroy(first);
          destroy(second);
          return { ids, busy: write(await open(client), "next") };
        },
      ],
      [
        "after two destroys in the other order",
        async (client: any) => {
          const [first, second] = [await open(client), await open(client)];
          const ids = [String(first.id), String(second.id)];
          destroy(second);
          destroy(first);
          return { ids, busy: write(await open(client), "next") };
        },
      ],
    ] as const)("a writer write after the destroy keeps the stream from the peer (%s)", async (_, arrange) => {
      const { endpoint, log } = await echoServer(4);
      await using server = endpoint;
      const client = await connectTo(server);
      const { ids, busy } = await arrange(client);
      const echoed = await readAll(busy);
      await fromTimer(() => echo(client, "later"));
      client.close();
      expect({ echoed, shown: ids.map(id => shown(log, id)) }).toEqual({
        echoed: "next",
        shown: ids.map(() => ({ seen: false, resets: [] })),
      });
    });

    test("a writer write after the destroy keeps the stream from the peer although the endpoint sends in between", async () => {
      const { endpoint, logs, sessions } = await echoServer(4);
      await using server = endpoint;
      await using clientEndpoint = new QuicEndpoint();
      const other = await connectTo(server, { endpoint: clientEndpoint });
      const client = await connectTo(server, { endpoint: clientEndpoint });
      const id = await abandon(client);
      const busy = write(await open(client), "next");
      // Sends what the endpoint has queued, inside this opening flight.
      other.destroy();
      const echoed = await readAll(busy);
      await fromTimer(() => echo(client, "later"));
      client.close();
      // The server is not told that `other` is gone.
      sessions[0].destroy();
      expect({ echoed, ...shown(logs[1], id) }).toEqual({ echoed: "next", seen: false, resets: [] });
    });

    // A stream that has used its read or write side is not hidden: the peer
    // is shown both frames of the destroy, so the stream also ends there.
    describe.each(directions)("on a %s stream", direction => {
      test.each([
        ["stopSending()", (stream: any) => stream.stopSending(7n), 1],
        ["stopSending() from its onerror", (stream: any) => void (stream.onerror = () => stream.stopSending(7n)), 1],
        ["resetStream()", (stream: any) => stream.resetStream(7n), 7],
        ["a read of stream.writer", (stream: any) => void stream.writer, 1],
      ] as const)(
        "after %s, a newer stream's write does not hide or split the frames of the destroy",
        async (_, touch, code) => {
          const { endpoint, log } = await echoServer(4);
          await using server = endpoint;
          const client = await connectTo(server);
          const id = await abandon(client, direction, "destroy(err)", touch);
          const echoed = await echo(client, "next");
          await fromTimer(() => echo(client, "later"));
          await fromTimer(() => echo(client, "later still"));
          client.close();
          expect({ echoed, ...shown(log, id), ended: log.ended.includes(id) }).toEqual({
            echoed: "next",
            seen: true,
            resets: [`${id}:${code}`],
            ended: true,
          });
        },
      );
    });

    test("a destroy from a later callback of the session is not retracted by the write before it", async () => {
      // The server opens a stream as soon as its handshake is done. When that
      // stream arrives with the packet that confirms the handshake, the client
      // is shown it right after its `opened` continuation ran, in one pass.
      const { endpoint, log } = await echoServer(4, {
        onsession: serverSession =>
          void serverSession.opened.then(async () => {
            const pushed = await serverSession.createUnidirectionalStream({ body: encoder.encode("pushed") });
            pushed.closed.catch(() => {});
          }),
      });
      await using server = endpoint;
      const client = await dial(server);
      // Waits for its place: lsquic opens it when the handshake completes.
      const unwritten = await open(client);
      const destroyed = Promise.withResolvers<string>();
      client.onstream = (stream: any) => {
        stream.closed.catch(() => {});
        readAll(stream).catch(() => {});
        if (unwritten.pending) return destroyed.reject(new Error("the unwritten stream has no place yet"));
        destroyed.resolve(String(unwritten.id));
        destroy(unwritten);
      };
      await client.opened;
      const echoed = await echo(client, "next");
      const id = await destroyed.promise;
      await fromTimer(() => echo(client, "later"));
      client.close();
      expect({ echoed, ...shown(log, id) }).toEqual({ echoed: "next", seen: true, resets: [`${id}:1`] });
    });

    test("of another session on the same endpoint, a destroy is not retracted", async () => {
      const { endpoint, logs } = await echoServer(4);
      await using server = endpoint;
      await using clientEndpoint = new QuicEndpoint();
      const first = await connectTo(server, { endpoint: clientEndpoint });
      await fromTimer(() => echo(first, "first"));
      // What follows runs inside the opening flight of `second`.
      const second = await connectTo(server, { endpoint: clientEndpoint });
      const id = await abandon(first);
      const echoed = await echo(first, "next");
      await fromTimer(() => echo(first, "later"));
      first.close();
      second.close();
      expect({ echoed, ...shown(logs[0], id) }).toEqual({ echoed: "next", seen: true, resets: [`${id}:1`] });
    });

    test.each(directions)(
      "of a server, the client sees the reset of a %s stream although a newer stream's writer writes next",
      async direction => {
        const abandoned = Promise.withResolvers<string>();
        const { endpoint } = await echoServer(4, {
          onsession: serverSession =>
            void serverSession.opened.then(async () => {
              abandoned.resolve(await abandon(serverSession, direction));
              write(await open(serverSession, "uni"), "pushed");
            }),
        });
        await using server = endpoint;
        const client = await dial(server);
        const log = record(client, newLog());
        await client.opened;
        const id = await abandoned.promise;
        await fromTimer(() => echo(client, "later"));
        await fromTimer(() => echo(client, "later still"));
        client.close();
        expect(shown(log, id)).toEqual({ seen: true, resets: [`${id}:1`] });
      },
    );
  });

  // 0-RTT: lsquic opens the streams of a resumed session before the handshake
  // is done. A packet that it sends then with only RESET_STREAM / STOP_SENDING
  // in it is one the server cannot read, so the frames of a destroyed stream
  // that has sent nothing wait for the handshake.
  describe("on a resumed session, before `opened`", () => {
    async function resume(endpoint: QuicEndpoint) {
      const ticket = Promise.withResolvers<unknown>();
      const first = await connectTo(endpoint, { onsessionticket: ticket.resolve });
      await fromTimer(() => echo(first, "first"));
      const sessionTicket = await ticket.promise;
      first.close();
      await sessionEnd(first);
      return dial(endpoint, { sessionTicket });
    }

    // `limit` 3 leaves one place beside the two destroyed streams, so the
    // later requests open only when those two places come back. An explicit
    // stopSending() leaves before the handshake, in a packet that the server
    // cannot read, so that row does not depend on the places.
    test.each([
      ["an unwritten stream", 3, () => {}],
      ["a stream with a writer", 3, (stream: any) => void stream.writer],
      ["a stream after stopSending()", 8, (stream: any) => stream.stopSending(7n)],
    ] as const)("the destroy of %s reaches the server once the handshake is done", async (_, limit, touch) => {
      const { endpoint, logs } = await echoServer(limit);
      await using server = endpoint;
      const resumed = await resume(server);
      const abandoned = [
        await abandon(resumed, "bidi", "destroy(err)", touch),
        await abandon(resumed, "bidi", "destroy(err)", touch),
      ];
      await resumed.opened;
      // A writer write in the opening flight does not hide a stream that was
      // destroyed before it.
      const echoed = [await echo(resumed, "request 0")];
      const end = sessionEnd(resumed);
      for (let i = 1; i <= 2; i++) {
        echoed.push(await Promise.race([fromTimer(() => echo(resumed, `request ${i}`)), end]));
      }
      resumed.close();
      expect({ echoed, shown: abandoned.map(id => shown(logs[1], id)) }).toEqual({
        echoed: ["request 0", "request 1", "request 2"],
        shown: abandoned.map(id => ({ seen: true, resets: [`${id}:1`] })),
      });
    });

    // lsquic frees a stream on the tick that finishes it. The peer can cause
    // that while the frames of the destroy still wait for the handshake.
    test("of a stream the peer ends first are dropped", async () => {
      const refused = Promise.withResolvers<string>();
      const { endpoint, sessions } = await echoServer(8, {
        onsession(serverSession: any) {
          if (sessions.length < 2) return;
          const answer = serverSession.onstream;
          serverSession.onstream = (stream: any) => {
            // The client's STOP_SENDING opens this stream here. The destroy
            // sends RESET_STREAM and STOP_SENDING back, which ends it at the
            // client before its own held frames go out.
            if (stream.id !== 0n) return answer(stream);
            stream.closed.catch(() => {});
            refused.resolve(String(stream.id));
            stream.destroy(new Error("refused"));
          };
        },
      });
      await using server = endpoint;
      const resumed = await resume(server);
      const ended = await open(resumed);
      const busy = await open(resumed);
      ended.stopSending(7n);
      // The data of `busy` makes the packet one the server can read.
      busy.writer.writeSync(encoder.encode("data"));
      busy.writer.endSync();
      destroy(ended);
      const echoed = [await readAll(busy)];
      await resumed.opened;
      const end = sessionEnd(resumed);
      for (let i = 0; i < 2; i++) {
        echoed.push(await Promise.race([fromTimer(() => echo(resumed, `request ${i}`)), end]));
      }
      resumed.close();
      expect({ echoed, refused: await Promise.race([refused.promise, end]) }).toEqual({
        echoed: ["data", "request 0", "request 1"],
        refused: String(ended.id),
      });
    });

    test("the held frames leave with the flight that follows the handshake", async () => {
      const { endpoint } = await echoServer(4);
      await using server = endpoint;
      const resumed = await resume(server);
      await abandon(resumed);
      await resumed.opened;
      const before = resumed.endpoint.stats.packetsSent;
      // No request follows: only the flight of this dispatch can carry them.
      await new Promise(resolve => setImmediate(resolve));
      const after = resumed.endpoint.stats.packetsSent;
      resumed.close();
      expect(after).toBeGreaterThan(before);
    });
  });

  // When the graceful close is applied, a stream that the peer cannot know is
  // retired with no frame: the peer never counts it. When the close has to
  // wait for data, the reset goes out first.
  describe("followed by session.close() in the same dispatch", () => {
    test.each(directions)("with no other stream, the peer sees the close and no %s stream", async direction => {
      const { endpoint, log, sessions, sessionClosed } = await echoServer(4);
      await using server = endpoint;
      const client = await connectTo(server);
      await abandon(client, direction);
      client.close();
      await Promise.all([sessionEnd(client), sessionClosed]);
      expect({ seen: log.seen, resets: log.resets, counted: streamsCounted(sessions[0]) }).toEqual({
        seen: [],
        resets: [],
        counted: { bidi: 0n, uni: 0n },
      });
    });

    test("with another stream idle, the peer sees the close and no uni stream", async () => {
      const { endpoint, log, sessions, sessionClosed } = await echoServer(4);
      await using server = endpoint;
      const client = await connectTo(server);
      await fromTimer(() => echo(client, "first"));
      await open(client);
      const id = await abandon(client, "uni");
      client.close();
      await Promise.all([sessionEnd(client), sessionClosed]);
      expect({ ...shown(log, id), uni: streamsCounted(sessions[0]).uni }).toEqual({ seen: false, resets: [], uni: 0n });
    });

    test.each([
      ["the handshake dispatch", false],
      ["a later dispatch", true],
    ] as const)(
      "in %s, with a stream that waits for a place, the peer sees the close and no stream",
      async (_, later) => {
        const { endpoint, log, sessions, sessionClosed } = await echoServer(later ? 2 : 1);
        await using server = endpoint;
        const client = await connectTo(server);
        if (later) await fromTimer(() => echo(client, "first"));
        const id = await abandon(client);
        const waiting = await open(client);
        const waits = waiting.pending;
        client.close();
        await Promise.all([sessionEnd(client), sessionClosed]);
        expect({ waits, ...shown(log, id), bidi: streamsCounted(sessions[0]).bidi }).toEqual({
          waits: true,
          seen: false,
          resets: [],
          bidi: later ? 1n : 0n,
        });
      },
    );

    test.each(directions)(
      "when it ends the wait of an earlier close(), the peer counts no %s stream",
      async direction => {
        const { endpoint, log, sessions, sessionClosed } = await echoServer(4, {
          transportParams: { initialMaxStreamDataBidiRemote: 1024 },
        });
        await using server = endpoint;
        const client = await connectTo(server);
        const id = await fromTimer(async () => {
          const unwritten = await open(client, direction);
          const blocked = await open(client);
          // Runs inside a dispatch. The close waits for `blocked` alone, so
          // the dispatch that destroys it is the one that applies the close.
          blocked.onblocked = () => {
            destroy(unwritten);
            destroy(blocked);
          };
          // More than the stream's window: the write blocks in this turn, and
          // the close waits for the rest of the data.
          blocked.writer.writeSync(new Uint8Array(4096).fill(97));
          client.close();
          return String(unwritten.id);
        });
        await Promise.all([sessionEnd(client), sessionClosed]);
        // The one stream that the peer counts is `blocked`.
        expect({ ...shown(log, id), counted: streamsCounted(sessions[0]) }).toEqual({
          seen: false,
          resets: [],
          counted: { bidi: 1n, uni: 0n },
        });
      },
    );

    test.each(directions)(
      "of a server, with no other stream, the client sees the close and no %s stream",
      async direction => {
        const { endpoint } = await echoServer(4, {
          onsession: serverSession =>
            void serverSession.opened.then(async () => {
              await abandon(serverSession, direction);
              serverSession.close();
            }),
        });
        await using server = endpoint;
        const client = await dial(server);
        client.opened.catch(() => {});
        const log = record(client, newLog());
        await sessionEnd(client);
        expect({ seen: log.seen, resets: log.resets, counted: streamsCounted(client) }).toEqual({
          seen: [],
          resets: [],
          counted: { bidi: 0n, uni: 0n },
        });
      },
    );

    test("with another stream still sending, the peer sees the reset", async () => {
      // More data than the stream's window: it is still queued when the close
      // is applied, so the close has to wait.
      const { endpoint, log, sessionClosed } = await echoServer(4, {
        transportParams: { initialMaxStreamDataBidiRemote: 1024 },
      });
      await using server = endpoint;
      const client = await connectTo(server);
      // Leave the opening flight: what follows an echo runs inside the
      // dispatch that delivered it.
      await fromTimer(() => echo(client, "first"));
      write(await open(client), Buffer.alloc(4096, "s").toString());
      const id = await abandon(client);
      client.close();
      await Promise.all([sessionEnd(client), sessionClosed]);
      expect(shown(log, id)).toEqual({ seen: true, resets: [`${id}:1`] });
    });

    test.each(directions)("from a timer callback, the %s stream is sent before the close", async direction => {
      const { endpoint, sessions, sessionClosed } = await echoServer(4);
      await using server = endpoint;
      const client = await connectTo(server);
      await fromTimer(async () => {
        await abandon(client, direction);
        client.close();
      });
      await Promise.all([sessionEnd(client), sessionClosed]);
      expect(streamsCounted(sessions[0])).toEqual(direction === "uni" ? { bidi: 0n, uni: 1n } : { bidi: 1n, uni: 0n });
    });
  });

  describe("on an HTTP/3 session", () => {
    async function h3Server() {
      const log = newLog();
      const endpoint = await listen(
        (serverSession: any) => {
          serverSession.onerror = () => {};
          serverSession.onstream = (stream: any) => {
            const id = String(stream.id);
            log.seen.push(id);
            stream.closed.catch(() => {});
            stream.onreset = (err: any) => log.resets.push(`${id}:${err?.errorCode}`);
          };
        },
        {
          sni: { "*": { keys: [key], certs: [cert] } },
          transportParams: { maxIdleTimeout: 5 },
          onheaders(this: any) {
            this.sendHeaders({ ":status": "200" }, { terminal: true });
          },
        },
      );
      return { endpoint, log };
    }

    // A request that is written with sendHeaders() and the writer.
    async function post(client: any) {
      const status = Promise.withResolvers<string>();
      const request = await client.createBidirectionalStream({
        onheaders(headers: Record<string, any>) {
          status.resolve(String(headers[":status"]));
        },
      });
      request.closed.catch(() => {});
      request.sendHeaders({ ":method": "POST", ":path": "/", ":scheme": "https", ":authority": "localhost" });
      write(request, "body");
      return status.promise;
    }

    describe.each([
      ["destroy(err)", 258],
      ["destroy()", 0],
    ] as const)("%s reaches the peer as RESET_STREAM(%d)", (how, code) => {
      test("from a timer callback, although a request is written in the same turn", async () => {
        const { endpoint, log } = await h3Server();
        await using server = endpoint;
        const client = await connectTo(server, { alpn: undefined });
        const { id, status } = await fromTimer(async () => {
          const id = await abandon(client, "bidi", how);
          return { id, status: await post(client) };
        });
        client.close();
        expect({ status, ...shown(log, id) }).toEqual({ status: "200", seen: true, resets: [`${id}:${code}`] });
      });

      test("inside a dispatch, although a request is written in the same turn", async () => {
        const { endpoint, log } = await h3Server();
        await using server = endpoint;
        const client = await connectTo(server, { alpn: undefined });
        // What follows a response runs inside the dispatch that delivered it.
        await fromTimer(() => post(client));
        const id = await abandon(client, "bidi", how);
        const status = await post(client);
        await fromTimer(() => post(client));
        client.close();
        expect({ status, ...shown(log, id) }).toEqual({ status: "200", seen: true, resets: [`${id}:${code}`] });
      });
    });
  });

  describe("on a stream that the server opened", () => {
    test.each(directions)(
      "inside an onstream continuation, the client sees the reset of a %s stream although the answer is written next",
      async direction => {
        const abandoned: string[] = [];
        const { endpoint } = await echoServer(4, {
          async beforeAnswer(serverSession, body) {
            if (body === "abandon") abandoned.push(await abandon(serverSession, direction));
          },
        });
        await using server = endpoint;
        const client = await connectTo(server);
        const log = record(client, newLog());
        const echoed = await fromTimer(() => echo(client, "abandon"));
        await fromTimer(() => echo(client, "later"));
        client.close();
        expect({ echoed, shown: abandoned.map(id => shown(log, id)) }).toEqual({
          echoed: "abandon",
          shown: [{ seen: true, resets: [`${abandoned[0]}:1`] }],
        });
      },
    );
  });
});
