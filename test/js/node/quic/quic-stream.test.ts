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

// The period is 251 bytes, so a chunk that is lost, repeated or moved changes
// the hash.
function pattern(size: number, seed: number) {
  const period = Buffer.alloc(251);
  for (let i = 0; i < period.length; i++) period[i] = (i * 7 + seed) & 0xff;
  return Buffer.alloc(size, period);
}

function summary(bytes: Uint8Array) {
  return { length: bytes.byteLength, sha1: new Bun.CryptoHasher("sha1").update(bytes).digest("hex") };
}

async function readAll(stream: any) {
  const chunks: Uint8Array[] = [];
  for await (const batch of stream) chunks.push(...batch);
  return Buffer.concat(chunks);
}

type TransportParams = Record<string, number>;

// One connection. After the handshake the server opens one bidirectional
// stream with `down` as its body, and the client sends `up` on that stream.
// Resolves with what each end read.
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
    (session: any) => {
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
    { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"], transportParams: options.server ?? {} },
  );
  // A client endpoint keeps the transport parameters of its first connect().
  await using endpoint = new QuicEndpoint();
  const client = await connect(server.address!, {
    endpoint,
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
  const [down, up] = await Promise.all([clientRead.promise, serverRead.promise]);
  client.close();
  return { down: summary(down), up: summary(up), errors };
}

// A client resumes a session and opens a stream with `body` before the
// handshake completes. Resolves with what the server read.
async function resumedEarlyStream(body: Uint8Array, setup: { bidirectional?: boolean; server?: TransportParams } = {}) {
  const errors: string[] = [];
  const received = Promise.withResolvers<Uint8Array>();
  let sessions = 0;
  await using server = await listen(
    (session: any) => {
      const resumed = ++sessions === 2;
      session.onerror = (err: any) => errors.push(`server: ${err?.message}`);
      session.closed.catch(() => {});
      session.onstream = (stream: any) => {
        stream.closed.catch(() => {});
        stream.writer.endSync();
        const read = readAll(stream);
        if (resumed) read.then(received.resolve, received.reject);
      };
    },
    { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"], transportParams: setup.server ?? {} },
  );
  await using endpoint = new QuicEndpoint();
  const options = { endpoint, alpn: "quic-test", servername: "localhost", verifyPeer: "manual" };

  const ticket = Promise.withResolvers<Buffer>();
  const token = Promise.withResolvers<Buffer>();
  const first: any = await connect(server.address!, {
    ...options,
    onsessionticket: ticket.resolve,
    onnewtoken: token.resolve,
  } as SessionOptions);
  await first.opened;
  const [sessionTicket, newToken] = await Promise.all([ticket.promise, token.promise]);
  await first.close();

  const second: any = await connect(server.address!, {
    ...options,
    sessionTicket,
    token: newToken,
    onerror(err: any) {
      errors.push(`client: ${err?.message}`);
    },
  } as SessionOptions);
  second.closed.catch(() => {});
  const stream = setup.bidirectional
    ? await second.createBidirectionalStream({ body })
    : await second.createUnidirectionalStream({ body });
  stream.closed.catch(() => {});
  const opened = await second.opened.then(
    (info: any) => ({ earlyDataAccepted: info.earlyDataAccepted }),
    (err: any) => ({ error: err?.message }),
  );
  const result = { opened, received: summary(await received.promise), errors };
  second.close();
  return result;
}

// lsquic's defaults are for HTTP/3: a window of 0 for a bidirectional stream
// that the server opens, and a small one for a unidirectional stream. lsquic
// also picks a stream's first send limit by the role of the connection, and
// after 0-RTT it gives a unidirectional stream the limit of a bidirectional
// one. With one window for every kind of stream it reads the right number.
describe("default stream windows", () => {
  test("are one value per endpoint", async () => {
    const serverParams = Promise.withResolvers<any>();
    await using server = await listen(
      (session: any) => {
        session.closed.catch(() => {});
        session.opened
          .then(() => ({ local: session.localTransportParams, remote: session.remoteTransportParams }))
          .then(serverParams.resolve, serverParams.reject);
      },
      { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"] },
    );
    await using endpoint = new QuicEndpoint();
    const client: any = await connect(server.address!, {
      endpoint,
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
    } as SessionOptions);
    client.closed.catch(() => {});
    await client.opened;
    const clientParams = { local: client.localTransportParams, remote: client.remoteTransportParams };
    const windows = (params: any) => ({
      bidiLocal: params.initialMaxStreamDataBidiLocal,
      bidiRemote: params.initialMaxStreamDataBidiRemote,
      uni: params.initialMaxStreamDataUni,
    });
    const sent = { server: windows((await serverParams.promise).local), client: windows(clientParams.local) };
    const received = { server: windows(clientParams.remote), client: windows((await serverParams.promise).remote) };
    client.close();
    expect({ sent, received }).toEqual({
      sent: {
        server: { bidiLocal: 1048576n, bidiRemote: 1048576n, uni: 1048576n },
        client: { bidiLocal: 6291456n, bidiRemote: 6291456n, uni: 6291456n },
      },
      received: sent,
    });
  });

  // 16 times the 16 KiB that lsquic accepted on such a stream while the
  // window it advertised was 0.
  test.each([
    ["to the client", 256 * 1024, 1024],
    ["from the client", 1024, 256 * 1024],
  ])("let a bidirectional stream that the server opens carry 256 KiB %s", async (_, downSize, upSize) => {
    const down = pattern(downSize, 1);
    const up = pattern(upSize, 2);
    expect(await serverOpenedExchange({ down, up })).toEqual({ down: summary(down), up: summary(up), errors: [] });
  });

  test("let a unidirectional stream that a client opens in 0-RTT carry 400000 bytes", async () => {
    const body = pattern(400000, 3);
    expect(await resumedEarlyStream(body)).toEqual({
      opened: { earlyDataAccepted: true },
      received: summary(body),
      errors: [],
    });
  });
});

// RFC 9000 section 18.2: the first send limit of a bidirectional stream is the
// peer's initial_max_stream_data_bidi_remote on the side that opened the
// stream, and the peer's initial_max_stream_data_bidi_local on the other side.
// lsquic picked it by the role of the connection, which is the same only for a
// stream that the client opens.
describe("a bidirectional stream that the server opens", () => {
  // Each end has a window of 1000 bytes for one kind of stream and 100000
  // bytes for the other kind. A sender that takes the other kind's window
  // either sends 50000 bytes into the window of 1000, or stops after 1000
  // bytes and waits for credit that the receiver has no reason to send.
  test.each([
    [
      "the client's window for it is the small one",
      { client: { initialMaxStreamDataBidiRemote: 1000, initialMaxStreamDataBidiLocal: 100000 } },
    ],
    [
      "the client's window for it is the large one",
      { client: { initialMaxStreamDataBidiRemote: 100000, initialMaxStreamDataBidiLocal: 1000 } },
    ],
    [
      "the server's window for it is the small one",
      { server: { initialMaxStreamDataBidiLocal: 1000, initialMaxStreamDataBidiRemote: 100000 } },
    ],
    [
      "the server's window for it is the large one",
      { server: { initialMaxStreamDataBidiLocal: 100000, initialMaxStreamDataBidiRemote: 1000 } },
    ],
  ] as [string, { client?: TransportParams; server?: TransportParams }][])(
    "carries 50000 bytes each way when %s",
    async (_, windows) => {
      const down = pattern(50000, 4);
      const up = pattern(50000, 5);
      expect(await serverOpenedExchange({ down, up, ...windows })).toEqual({
        down: summary(down),
        up: summary(up),
        errors: [],
      });
    },
  );

  // 4096 bytes fit the window whichever window the sender takes. That row
  // shows that the other row needs the byte past the window to fail.
  test.each([4096, 4097])("carries %d bytes into a window of 4096 bytes", async size => {
    const down = pattern(size, 6);
    const up = pattern(size, 7);
    const windows = {
      client: { initialMaxStreamDataBidiRemote: 4096 },
      server: { initialMaxStreamDataBidiLocal: 4096 },
    };
    expect(await serverOpenedExchange({ down, up, ...windows })).toEqual({
      down: summary(down),
      up: summary(up),
      errors: [],
    });
  });
});

// lsquic gives a write event only to a stream that has flow-control credit,
// from the stream and from the connection. A FIN takes none.
//
// These sessions have no idle timeout. With one, a session whose FIN never
// leaves ends after the timeout, and both readers then see the same clean end
// as after a FIN.
describe("a stream that ends without data", () => {
  const noIdleTimeout = { maxIdleTimeout: 0 };

  // An lsquic that picks the limit by the role of the connection takes the
  // other window here, which is not 0, so only the FIN path is under test.
  test("ends in both directions on a stream the server opens when both windows for it are 0", async () => {
    const empty = new Uint8Array(0);
    expect(
      await serverOpenedExchange({
        down: empty,
        up: empty,
        client: { ...noIdleTimeout, initialMaxStreamDataBidiRemote: 0 },
        server: { ...noIdleTimeout, initialMaxStreamDataBidiLocal: 0 },
      }),
    ).toEqual({ down: summary(empty), up: summary(empty), errors: [] });
  });

  // One connection. The client opens a stream with `open` and the server ends
  // its side with `answer`. Resolves with the bytes that each end read.
  async function clientOpenedEnd(options: {
    open: (session: any) => Promise<any>;
    answer: (stream: any) => void;
    server?: TransportParams;
    client?: TransportParams;
    beforeHandshake?: boolean;
  }) {
    const errors: string[] = [];
    const serverRead = Promise.withResolvers<Uint8Array>();
    await using server = await listen(
      (session: any) => {
        session.onerror = (err: any) => errors.push(`server: ${err?.message}`);
        session.closed.catch(() => {});
        session.onstream = (stream: any) => {
          stream.closed.catch(() => {});
          options.answer(stream);
          readAll(stream).then(serverRead.resolve, serverRead.reject);
        };
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        alpn: ["quic-test"],
        transportParams: { ...noIdleTimeout, ...options.server },
      },
    );
    await using endpoint = new QuicEndpoint();
    const client: any = await connect(server.address!, {
      endpoint,
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { ...noIdleTimeout, ...options.client },
      onerror(err: any) {
        errors.push(`client: ${err?.message}`);
      },
    } as SessionOptions);
    client.closed.catch(() => {});
    if (!options.beforeHandshake) await client.opened;
    const stream = await options.open(client);
    stream.closed.catch(() => {});
    const [up, down] = await Promise.all([serverRead.promise, readAll(stream)]);
    client.close();
    return { up: up.byteLength, down: down.byteLength, errors };
  }

  const emptyBody = (session: any) => session.createBidirectionalStream({ body: new Uint8Array(0) });
  const endWriter = async (session: any) => {
    const stream = await session.createBidirectionalStream();
    stream.writer.endSync();
    return stream;
  };
  const ways = [
    ["an empty body", emptyBody, (stream: any) => stream.setBody(new Uint8Array(0))],
    ["writer.endSync()", endWriter, (stream: any) => stream.writer.endSync()],
  ] as [string, (session: any) => Promise<any>, (stream: any) => void][];

  test.each(ways)(
    "ends in both directions on a stream the client opens when both windows for it are 0 (%s)",
    async (_, open, answer) => {
      expect(
        await clientOpenedEnd({
          open,
          answer,
          server: { initialMaxStreamDataBidiRemote: 0 },
          client: { initialMaxStreamDataBidiLocal: 0 },
        }),
      ).toEqual({ up: 0, down: 0, errors: [] });
    },
  );

  test("reaches a server whose window for it is 0 when lsquic opens the stream after the handshake", async () => {
    expect(
      await clientOpenedEnd({
        open: emptyBody,
        answer: stream => stream.writer.endSync(),
        server: { initialMaxStreamDataBidiRemote: 0 },
        beforeHandshake: true,
      }),
    ).toEqual({ up: 0, down: 0, errors: [] });
  });

  // The window of the stream is the default here.
  test.each(ways)("reaches a server whose connection window is 0 (%s)", async (_, open, answer) => {
    expect(await clientOpenedEnd({ open, answer, server: { initialMaxData: 0 } })).toEqual({
      up: 0,
      down: 0,
      errors: [],
    });
  });

  // The end that opens a unidirectional stream has no read side, so the FIN
  // also closes the stream there.
  test.each(["client", "server"] as const)(
    "reaches the peer on a unidirectional stream that the %s opens when the window for it is 0",
    async opener => {
      const errors: string[] = [];
      const received = Promise.withResolvers<Uint8Array>();
      const sent = Promise.withResolvers<void>();
      const open = async (session: any) => {
        const stream = await session.createUnidirectionalStream({ body: new Uint8Array(0) });
        await stream.closed;
      };
      const onstream = (stream: any) => {
        stream.closed.catch(() => {});
        readAll(stream).then(received.resolve, received.reject);
      };
      const transportParams = { ...noIdleTimeout, initialMaxStreamDataUni: 0 };
      await using server = await listen(
        (session: any) => {
          session.onerror = (err: any) => errors.push(`server: ${err?.message}`);
          session.closed.catch(() => {});
          session.onstream = onstream;
          if (opener === "server") session.opened.then(() => open(session)).then(sent.resolve, sent.reject);
        },
        { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"], transportParams },
      );
      await using endpoint = new QuicEndpoint();
      const client: any = await connect(server.address!, {
        endpoint,
        alpn: "quic-test",
        servername: "localhost",
        verifyPeer: "manual",
        transportParams,
        onerror(err: any) {
          errors.push(`client: ${err?.message}`);
        },
        onstream,
      } as SessionOptions);
      client.closed.catch(() => {});
      await client.opened;
      if (opener === "client") open(client).then(sent.resolve, sent.reject);
      const [bytes] = await Promise.all([received.promise, sent.promise]);
      client.close();
      expect({ length: bytes.byteLength, errors }).toEqual({ length: 0, errors: [] });
    },
  );
});

// On HTTP/3 the FIN follows the header block, and JS can end the body of a
// stream before it hands over the headers. An HTTP/3 stream therefore keeps
// the write event for its FIN.
describe("an HTTP/3 stream whose body ends before its headers are sent", () => {
  const requestHeaders = { ":method": "POST", ":path": "/", ":scheme": "https", ":authority": "localhost" };

  async function roundTrip(
    request: (client: any, onheaders: (headers: Record<string, string>) => void) => Promise<any>,
    respond: (stream: any) => void,
  ) {
    const requests: string[] = [];
    await using server = await listen(
      async (session: any) => {
        session.onstream = (stream: any) => stream.closed.catch(() => {});
        await session.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        onheaders(this: any, headers: Record<string, string>) {
          requests.push(headers[":path"]);
          respond(this);
        },
      },
    );
    await using endpoint = new QuicEndpoint();
    const client: any = await connect(server.address!, {
      endpoint,
      servername: "localhost",
      verifyPeer: "manual",
    } as SessionOptions);
    client.closed.catch(() => {});
    await client.opened;
    let status: string | undefined;
    const stream = await request(client, headers => (status = headers[":status"]));
    stream.closed.catch(() => {});
    const end = await readAll(stream).then(
      body => `end after ${body.byteLength} bytes`,
      err => `error: ${err?.message}`,
    );
    client.close();
    return { requests, status, end };
  }

  const respondWithEmptyBody = (stream: any) => {
    stream.sendHeaders({ ":status": "200" });
    stream.writer.endSync();
  };

  test.each([
    [
      "createBidirectionalStream({ headers, body })",
      (client: any, onheaders: any) =>
        client.createBidirectionalStream({ headers: requestHeaders, body: new Uint8Array(0), onheaders }),
    ],
    [
      "createBidirectionalStream({ body }), then sendHeaders()",
      async (client: any, onheaders: any) => {
        const stream = await client.createBidirectionalStream({ body: new Uint8Array(0), onheaders });
        stream.sendHeaders(requestHeaders);
        return stream;
      },
    ],
  ])("the server gets the request of %s", async (_, request) => {
    expect(await roundTrip(request, respondWithEmptyBody)).toEqual({
      requests: ["/"],
      status: "200",
      end: "end after 0 bytes",
    });
  });

  test.each([
    [
      "setBody(), then sendHeaders()",
      (stream: any) => {
        stream.setBody(new Uint8Array(0));
        stream.sendHeaders({ ":status": "200" });
      },
    ],
    [
      "writer.endSync(), then sendHeaders()",
      (stream: any) => {
        stream.writer.endSync();
        stream.sendHeaders({ ":status": "200" });
      },
    ],
  ])("the client gets the response of %s", async (_, respond) => {
    const request = (client: any, onheaders: any) =>
      client.createBidirectionalStream({ headers: requestHeaders, body: new Uint8Array([65]), onheaders });
    expect(await roundTrip(request, respond)).toEqual({
      requests: ["/"],
      status: "200",
      end: "end after 0 bytes",
    });
  });
});

// A client that resumes a session opens streams before the handshake ends,
// with the limits of the earlier session. When the handshake ends, lsquic sets
// the limit of each of those streams again. It took the limit of a
// bidirectional stream for a unidirectional one.
describe("a stream that a client opens in 0-RTT", () => {
  test("carries 400000 bytes when it is unidirectional and that window of the server is the smaller one", async () => {
    const body = pattern(400000, 8);
    expect(await resumedEarlyStream(body, { server: { initialMaxStreamDataUni: 12288 } })).toEqual({
      opened: { earlyDataAccepted: true },
      received: summary(body),
      errors: [],
    });
  });

  test("keeps its limit when it is unidirectional and the server's bidirectional window is smaller than the bytes sent", async () => {
    const body = pattern(5000, 9);
    expect(await resumedEarlyStream(body, { server: { initialMaxStreamDataBidiRemote: 256 } })).toEqual({
      opened: { earlyDataAccepted: true },
      received: summary(body),
      errors: [],
    });
  });

  // The server's window for a stream that it opens is smaller than the bytes
  // sent. The limit of this stream is the other window.
  test("keeps its limit when it is bidirectional", async () => {
    const body = pattern(3000, 10);
    const server = { initialMaxStreamDataBidiLocal: 1000, initialMaxStreamDataBidiRemote: 100000 };
    expect(await resumedEarlyStream(body, { bidirectional: true, server })).toEqual({
      opened: { earlyDataAccepted: true },
      received: summary(body),
      errors: [],
    });
  });
});
