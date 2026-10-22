// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, withoutAsanQuarantine } from "harness";
import { createPrivateKey, randomBytes } from "node:crypto";
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

describe.each(["bidi", "uni"] as const)("verifyClient: a %s stream", direction => {
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
    const options = { body: new TextEncoder().encode("early body") };
    const stream = await (direction === "uni"
      ? client.createUnidirectionalStream(options)
      : client.createBidirectionalStream(options));
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

// A stream that node:quic cannot open yet is a pending stream: its request
// waits in lsquic until the handshake is done and the peer's stream limit
// allows it.
describe("pending streams", () => {
  const encoder = new TextEncoder();
  const sni = { "*": { keys: [key], certs: [cert] } };
  const request = { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" };
  const raw = { server: { alpn: ["quic-test"] }, client: { alpn: "quic-test" } };
  const drain = async (stream: any) => {
    for await (const _ of stream) {
    }
  };

  // The endpoints of this block stay open until its last test ends. An
  // endpoint answers a late packet for a session that is gone with a
  // stateless reset. A reset to a closed port makes the next send of that
  // endpoint fail, and lsquic then sends nothing for a second.
  const endpoints: QuicEndpoint[] = [];
  afterAll(() => {
    for (const endpoint of endpoints) endpoint.destroy();
  });

  // A server and a client session on loopback. Disposal destroys the sessions
  // of both sides: after a failed expectation, a graceful close waits for the
  // idle timeout.
  async function connected(onsession: (session: any) => void, serverOptions: any = {}, clientOptions: any = {}) {
    const sessions: any[] = [];
    const server = await listen(
      (session: any) => {
        sessions.push(session);
        return onsession(session);
      },
      {
        sni,
        ...serverOptions,
        transportParams: { maxIdleTimeout: 10, ...serverOptions.transportParams },
      },
    );
    endpoints.push(server);
    const connectClient = async (options: any = {}) => {
      const client = await connect(server.address!, {
        servername: "localhost",
        verifyPeer: "manual",
        ...clientOptions,
        ...options,
        transportParams: { maxIdleTimeout: 10, ...clientOptions.transportParams },
      } as SessionOptions);
      client.closed.catch(() => {});
      sessions.push(client);
      return client;
    };
    return {
      client: await connectClient(),
      connectClient,
      [Symbol.dispose]() {
        for (const session of sessions) session.destroy();
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
  // A unidirectional stream closes when its body is sent. A bidirectional
  // stream is answered when the peer ends its side.
  const sent = (stream: any) => (stream.direction === "uni" ? stream.closed : drain(stream));
  const serve = (onstream: (stream: any) => void) => (session: any) => {
    session.closed.catch(() => {});
    session.onstream = onstream;
  };
  const ignoreStreams = serve(stream => stream.closed.catch(() => {}));
  // Records the body of every stream by stream id, then ends this side of a
  // bidirectional stream. `all` resolves when `count` streams are recorded.
  function record(count: number) {
    const received: Record<string, string> = {};
    const all = Promise.withResolvers<Record<string, string>>();
    const onsession = serve(async stream => {
      stream.closed.catch(() => {});
      const id = String(stream.id);
      const chunks: Buffer[] = [];
      for await (const batch of stream) for (const chunk of batch) chunks.push(Buffer.from(chunk));
      received[id] = Buffer.concat(chunks).toString();
      if (stream.direction === "bidi") stream.writer.endSync();
      if (Object.keys(received).length === count) all.resolve(received);
    });
    return { onsession, all: all.promise };
  }
  // Reads a stream, then ends this side of a bidirectional one. A stream with
  // an id under `heldBelow` waits for `release` first: it keeps its stream
  // credit until then.
  const readAndHold = (heldBelow: bigint, release: Promise<void>) => async (stream: any) => {
    stream.closed.catch(() => {});
    if (stream.id < heldBelow) await release;
    await drain(stream);
    if (stream.direction === "bidi") stream.writer.endSync();
  };
  const answers = {
    onheaders(this: any) {
      this.sendHeaders({ ":status": "200" }, { terminal: true });
    },
  };
  // A client has read the server's SETTINGS when a request is answered.
  async function settingsRead(client: any) {
    const answered = Promise.withResolvers<void>();
    const stream = await client.createBidirectionalStream({ headers: request, onheaders: () => answered.resolve() });
    stream.closed.catch(() => {});
    await answered.promise;
  }
  // The session ticket and the token of a first session with this server.
  async function ticketFrom(sessions: { connectClient: (options?: any) => Promise<any> }) {
    const sessionTicket = Promise.withResolvers<Buffer>();
    const token = Promise.withResolvers<Buffer>();
    const first = await sessions.connectClient({
      onsessionticket: (ticket: Buffer) => sessionTicket.resolve(ticket),
      onnewtoken: (newToken: Buffer) => token.resolve(newToken),
    });
    await first.opened;
    const resumption = { sessionTicket: await sessionTicket.promise, token: await token.promise };
    await first.close();
    return resumption;
  }
  // An HTTP/3 session whose server holds one request. The response stays
  // open, so a close() of either side is graceful and sends GOAWAY.
  async function withHeldRequest(serverOptions: any = {}, clientOptions: any = {}) {
    let serverSession: any;
    let response: any;
    let requests = 0;
    const serverHasRequest = Promise.withResolvers<void>();
    const sessions = await connected(
      (session: any) => {
        serverSession = session;
        ignoreStreams(session);
      },
      {
        ...serverOptions,
        onheaders(this: any) {
          requests++;
          response = this;
          this.sendHeaders({ ":status": "200" });
          serverHasRequest.resolve();
        },
      },
      clientOptions,
    );
    try {
      await sessions.client.opened;
      const gotResponse = Promise.withResolvers<void>();
      const held = await sessions.client.createBidirectionalStream({
        headers: request,
        onheaders: () => gotResponse.resolve(),
      });
      held.closed.catch(() => {});
      await Promise.all([serverHasRequest.promise, gotResponse.promise]);
      return { ...sessions, held, serverSession, response, requests: () => requests };
    } catch (err) {
      sessions[Symbol.dispose]();
      throw err;
    }
  }

  test("streams requested before the handshake open in order, and a later stream gets its own", async () => {
    const server = record(5);
    using sessions = await connected(server.onsession, raw.server, raw.client);
    const { client } = sessions;
    const open = opener(client);

    const early = [await open("uni", "uni 1"), await open("bidi", "bidi 1"), await open("uni", "uni 2")];
    await client.opened;
    expect(early.map(stream => stream.id)).toEqual([2n, 0n, 6n]);
    const late = [await open("uni", "uni 3"), await open("bidi", "bidi 2")];
    expect(late.map(stream => stream.id)).toEqual([10n, 4n]);
    expect(await server.all).toEqual({ "2": "uni 1", "0": "bidi 1", "6": "uni 2", "10": "uni 3", "4": "bidi 2" });
  });

  test.each(["uni", "bidi"] as const)("a destroyed pending %s stream does not take a stream id", async direction => {
    using sessions = await connected(ignoreStreams, raw.server, raw.client);
    const { client } = sessions;
    const open = opener(client);

    (await open(direction, "never sent")).destroy();
    await client.opened;
    expect((await open(direction, "first")).id).toBe(direction === "uni" ? 2n : 0n);
  });

  // The peer allows four streams and holds them. Four more wait for stream
  // credit and are destroyed, as a request timeout does. The credit that
  // arrives later goes to the streams that still wait for it.
  test.each(["uni", "bidi"] as const)(
    "a destroyed %s stream that waited for stream credit does not take the credit",
    async direction => {
      const release = Promise.withResolvers<void>();
      using sessions = await connected(
        serve(readAndHold(16n, release.promise)),
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

      // This stream opens with the first credit that the server returns.
      const next = await open(direction, "next");
      release.resolve();
      await sent(next);
      const later = [await open(direction, "a"), await open(direction, "b"), await open(direction, "c")];
      await Promise.all(later.map(sent));
      const first = direction === "uni" ? 18n : 16n;
      expect([next, ...later].map(stream => stream.id)).toEqual([first, first + 4n, first + 8n, first + 12n]);
    },
  );

  // `b` leaves the middle of the queue, and the collector frees its wrapper:
  // a stream created after that can get the same address.
  test.each([
    ["uni", "before the handshake"],
    ["uni", "for stream credit"],
    ["bidi", "before the handshake"],
    ["bidi", "for stream credit"],
  ] as const)("a destroyed %s stream between two that wait %s does not change their order", async (direction, wait) => {
    const credit = wait === "for stream credit";
    const release = Promise.withResolvers<void>();
    using sessions = await connected(
      serve(readAndHold(credit ? 8n : 0n, release.promise)),
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
    let b: any = await open(direction, "b");
    const c = await open(direction, "c");
    expect([a.pending, b.pending, c.pending]).toEqual([true, true, true]);
    b.destroy();
    b = undefined;
    Bun.gc(true);
    const d = await open(direction, "d");

    release.resolve();
    await Promise.all([a, c, d].map(sent));
    const e = await open(direction, "e");
    await sent(e);
    expect([a, c, d, e].map(stream => stream.id)).toEqual([first, first + 4n, first + 8n, first + 12n]);
  });

  // The roles of the credit test swapped. A Bun client returns stream credit
  // after 50 of the server's streams closed, hence a limit of 50. The limit is
  // an option of the client's endpoint, so this client has its own.
  test("a destroyed stream of a server that waited for stream credit does not take the credit", async () => {
    const release = Promise.withResolvers<void>();
    const result = Promise.withResolvers<{ pending: boolean[]; ids: bigint[] }>();
    const endpoint = new QuicEndpoint();
    endpoints.push(endpoint);
    using sessions = await connected(
      async (serverSession: any) => {
        ignoreStreams(serverSession);
        try {
          await serverSession.opened;
          const open = opener(serverSession);
          const streams: any[] = [];
          for (let i = 0; i < 54; i++) streams.push(await open("bidi", "held"));
          const pending = streams.slice(49).map(stream => stream.pending);
          for (const waiting of streams.slice(50)) waiting.destroy();
          const next = await open("bidi", "next");
          release.resolve();
          await sent(next);
          const later = [await open("bidi", "a"), await open("bidi", "b"), await open("bidi", "c")];
          await Promise.all(later.map(sent));
          result.resolve({ pending, ids: [next, ...later].map(stream => stream.id) });
        } catch (err) {
          result.reject(err);
        }
      },
      raw.server,
      {
        ...raw.client,
        endpoint,
        transportParams: { initialMaxStreamsBidi: 50 },
        // The first 50 streams of the server have the ids 1 to 197.
        onstream: readAndHold(200n, release.promise),
      },
    );
    await sessions.client.opened;
    expect(await result.promise).toEqual({
      pending: [false, true, true, true, true],
      ids: [201n, 205n, 209n, 213n],
    });
  });

  // HTTP/3 takes three unidirectional streams on each side: control, QPACK
  // encoder and QPACK decoder. The client opens its QPACK encoder stream when
  // it reads the SETTINGS. A stream that waited for the handshake opens after
  // that one, so it cannot take its stream credit. lsquic opens a request
  // made before the handshake when its handshake is done, one round trip
  // before the SETTINGS arrive. A stream requested then waits behind the
  // first one.
  test.each([
    ["ten streams", { initialMaxStreamsUni: 10 }, [14n, 18n]],
    ["the three streams of HTTP/3", {}, [null, null]],
  ] as const)(
    "an HTTP/3 session opens pending unidirectional streams in order after its own three (the peer allows %s)",
    async (_, transportParams, ids) => {
      using sessions = await connected(ignoreStreams, { transportParams, ...answers });
      const { client } = sessions;
      const open = opener(client);

      const first = await open("uni", "before the handshake");
      const handshake: any = await client.createBidirectionalStream({ headers: request });
      handshake.closed.catch(() => {});
      while (handshake.pending) await new Promise(resolve => setImmediate(resolve));
      const second = await open("uni", "before the SETTINGS");
      expect([first.pending, second.pending]).toEqual([true, true]);

      // With stream credit both open when the SETTINGS arrive, and close
      // when their body is sent.
      await (ids[0] === null ? settingsRead(client) : Promise.all([first.closed, second.closed]));
      expect([first.id, second.id]).toEqual([...ids]);
    },
  );

  // Nothing waits here: a resumed session opens the stream at once, before
  // its QPACK encoder stream, also when the peer allows only three streams.
  test("an HTTP/3 unidirectional stream on a resumed session opens before the handshake is done", async () => {
    using sessions = await connected(ignoreStreams, answers);
    const client = await sessions.connectClient(await ticketFrom(sessions));
    const stream = await opener(client)("uni", "early");
    expect({ pending: stream.pending, id: stream.id }).toEqual({ pending: false, id: 10n });
  });

  // The session ticket is from another server, so this server rejects the
  // early data, as a server does after a restart. The session then destroys
  // the streams that were early data, and only those.
  test("a stream that waited for stream credit when 0-RTT was rejected is sent after the handshake", async () => {
    const endpoint = { tokenSecret: randomBytes(16) };
    using first = await connected(
      ignoreStreams,
      { ...raw.server, endpoint, transportParams: { initialMaxStreamsUni: 1 } },
      raw.client,
    );
    using second = await connected(
      ignoreStreams,
      { ...raw.server, endpoint, enableEarlyData: false, transportParams: { initialMaxStreamsUni: 5 } },
      raw.client,
    );
    const client = await second.connectClient(await ticketFrom(first));
    const open = opener(client);
    // The client remembers a limit of one stream from the first server.
    const early = await open("uni", "early");
    const waiting = await open("uni", "waiting");
    expect([early.pending, waiting.pending]).toEqual([false, true]);
    await client.opened;
    await waiting.closed;
    expect(waiting.id).toBe(6n);
  });

  test("in the turn a GOAWAY arrives, a new unidirectional stream opens and a new request stays pending", async () => {
    const order: string[] = [];
    const goaway = Promise.withResolvers<void>();
    const created = { uni: Promise.withResolvers<string>(), bidi: Promise.withResolvers<string>() };
    const outcome = (creating: Promise<any>) =>
      creating.then(
        stream => {
          stream.closed.catch(() => {});
          return stream.pending ? "pending" : "opened";
        },
        err => err.code,
      );
    const datagrams = { application: { enableDatagrams: true }, transportParams: { maxDatagramFrameSize: 100 } };
    using sessions = await withHeldRequest(
      {
        ...datagrams,
        // The one bidirectional stream goes to the held request. There is
        // room for a unidirectional stream.
        transportParams: { ...datagrams.transportParams, initialMaxStreamsBidi: 1, initialMaxStreamsUni: 10 },
      },
      {
        ...datagrams,
        ongoaway() {
          order.push("ongoaway");
          goaway.resolve();
        },
        ondatagram(this: any) {
          order.push("ondatagram");
          created.uni.resolve(outcome(this.createUnidirectionalStream({ body: encoder.encode("late") })));
          created.bidi.resolve(outcome(this.createBidirectionalStream({ headers: request })));
        },
      },
    );
    const { client, serverSession } = sessions;

    // The server sends a datagram and its GOAWAY in one turn. When the client
    // reads both in one pass, `ondatagram` runs after lsquic has the GOAWAY
    // and before `ongoaway`. lsquic still creates the unidirectional stream,
    // as node does, and refuses the request that has no stream credit.
    await serverSession.sendDatagram(new Uint8Array([1]));
    serverSession.close();
    const [uni, bidi] = await Promise.all([created.uni.promise, created.bidi.promise]);
    await goaway.promise;
    expect({ order, uni, bidi }).toEqual({ order: ["ondatagram", "ongoaway"], uni: "opened", bidi: "pending" });

    // After `ongoaway` the session refuses both.
    const late = [client.createUnidirectionalStream({}), client.createBidirectionalStream({ headers: request })];
    expect(await Promise.all(late.map(outcome))).toEqual(["ERR_INVALID_STATE", "ERR_INVALID_STATE"]);
  });

  test("a unidirectional stream that waits for stream credit opens after a GOAWAY", async () => {
    const goaway = Promise.withResolvers<void>();
    using sessions = await withHeldRequest(
      // Six unidirectional streams: HTTP/3 and this test share them.
      { transportParams: { initialMaxStreamsUni: 6 } },
      { ongoaway: () => goaway.resolve() },
    );
    const { client, serverSession } = sessions;

    // Open streams hold the credit until they end. The first stream that
    // has to wait is the seventh, with or without the QPACK encoder stream.
    const holders: any[] = [];
    let waiting: any;
    while (!waiting) {
      const stream: any = await client.createUnidirectionalStream({});
      stream.closed.catch(() => {});
      if (stream.pending) waiting = stream;
      else holders.push(stream);
    }
    waiting.writer.endSync();
    serverSession.close();
    await goaway.promise;
    expect(waiting.pending).toBe(true);

    // A GOAWAY limits requests, not unidirectional streams. The server
    // returns the credit when the open streams end.
    for (const stream of holders) stream.writer.endSync();
    await waiting.closed;
    expect(waiting.id).toBe(26n);
  });

  // lsquic drops a request that waits for stream credit when a GOAWAY is
  // sent or received. The session drops its queue entry with it: a debug
  // build asserts that the two agree.
  test.each(["the peer's GOAWAY arrives", "close() sends a GOAWAY"] as const)(
    "a request that waits for stream credit stays pending when %s",
    async when => {
      const goaway = Promise.withResolvers<void>();
      using sessions = await withHeldRequest(
        { transportParams: { initialMaxStreamsBidi: 1 } },
        { ongoaway: () => goaway.resolve() },
      );
      const { client, held, serverSession, response } = sessions;
      const waiting: any = await client.createBidirectionalStream({ headers: request });
      waiting.closed.catch(() => {});
      expect(waiting.pending).toBe(true);

      if (when === "the peer's GOAWAY arrives") {
        serverSession.close();
        await goaway.promise;
      } else {
        client.close().catch(() => {});
        // The response ends after the GOAWAY, and its stream credit returns.
        response.writer.endSync();
        await drain(held);
      }
      expect({ pending: waiting.pending, id: waiting.id, requests: sessions.requests() }).toEqual({
        pending: true,
        id: null,
        requests: 1,
      });
    },
  );
});
