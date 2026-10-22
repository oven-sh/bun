// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, withoutAsanQuarantine } from "harness";
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { BlockList } from "node:net";
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
    // lsxpack holds the length of a value in 16 bits.
    const headers = { ...request, "x-value": Buffer.alloc(70_000, "v").toString() };

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

// A STREAM frame that carries only the FIN bit uses no flow-control credit
// (RFC 9000 section 4.1). On a raw QUIC session the end of a body leaves
// without a MAX_STREAM_DATA or a MAX_DATA from the peer.
describe("the end of a body on a stream with no flow-control credit left", () => {
  const empty = new Uint8Array(0);
  // No credit for any stream, whichever side opens it.
  const noStreamCredit = {
    initialMaxStreamDataBidiLocal: 0,
    initialMaxStreamDataBidiRemote: 0,
    initialMaxStreamDataUni: 0,
  };

  // A connected pair. Each side reads every stream that the other side opens
  // and counts the datagrams that it sends.
  async function setup({
    server = {},
    client = {},
    h3 = false,
    listenOptions = {},
    early = async (_client: any) => {},
  } = {}) {
    // Stream id to the bytes read so far, and to the length of an ended body.
    const got = new Map<bigint, number>();
    const ends = new Map<bigint, number | string>();
    let datagrams = 0;
    let progress = Promise.withResolvers<void>();
    const step = () => {
      progress.resolve();
      progress = Promise.withResolvers<void>();
    };
    const onstream = async (stream: any) => {
      stream.closed.catch(() => {});
      let bytes = 0;
      try {
        for await (const batch of stream) {
          for (const chunk of batch) bytes += chunk.byteLength;
          got.set(stream.id, bytes);
          step();
        }
        ends.set(stream.id, bytes);
      } catch (err: any) {
        ends.set(stream.id, String(err?.code));
      }
      step();
    };
    const ondatagram = () => {
      datagrams++;
      step();
    };

    const accepted = Promise.withResolvers<any>();
    const listener = await listen(
      serverSession => {
        serverSession.closed.catch(() => {});
        serverSession.onstream = onstream;
        serverSession.ondatagram = ondatagram;
        accepted.resolve(serverSession);
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        alpn: [h3 ? "h3" : "quic-test"],
        transportParams: { maxIdleTimeout: 5, ...server },
        ...listenOptions,
      },
    );
    const blockList = new BlockList();
    const endpoint = new QuicEndpoint({ blockList });
    const session = await connect(listener.address!, {
      endpoint,
      alpn: h3 ? "h3" : "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 5, ...client },
      onstream,
      ondatagram,
    } as SessionOptions);
    const closed = session.closed.then(
      () => "closed",
      () => "closed",
    );
    await early(session);
    await session.opened;
    const serverSession = await accepted.promise;
    await serverSession.opened;

    // Resolves when `done()` holds, or when the session is gone.
    const until = async (done: () => boolean) => {
      while (!done() && (await Promise.race([progress.promise, closed])) !== "closed");
    };

    return {
      client: session,
      server: serverSession,
      got,
      ends,
      until,
      // The lengths of the bodies that ended, once there are `count` of them.
      ended: (count = 1) => until(() => ends.size >= count).then(() => [...ends.values()]),
      // Three datagrams from `from`, each sent after the one before it
      // arrived. A datagram needs no credit. An end that `from` sent before
      // the first of them arrives before the last.
      noEnd: (from: any = session) =>
        Promise.race([
          closed,
          (async () => {
            for (let i = 0; i < 3; i++) {
              const seen = datagrams;
              await from.sendDatagram(new Uint8Array(1));
              await until(() => datagrams > seen);
            }
            return "no end";
          })(),
        ]),
      // From here on the client drops every datagram from the server: no
      // MAX_STREAM_DATA and no MAX_DATA can raise a limit.
      deafen: () => blockList.addAddress(listener.address!.address),
      // How many datagrams from the server the client dropped, once it
      // dropped one. The server acknowledges what the client sends, so it
      // sends one. Nothing reports a dropped datagram, so this looks once per
      // turn of the event loop until the session is gone.
      async dropped() {
        const turn = () => new Promise(resolve => setImmediate(resolve));
        while (endpoint.stats.packetsBlocked === 0n && (await Promise.race([turn(), closed])) !== "closed");
        return Number(endpoint.stats.packetsBlocked);
      },
      async [Symbol.asyncDispose]() {
        session.destroy();
        serverSession.destroy();
        await Promise.all([endpoint.close(), listener.close()]);
      },
    };
  }

  const ways: Record<string, (session: any) => Promise<any>> = {
    "writer.endSync()": async session => (await session.createBidirectionalStream()).writer.endSync(),
    "writer.end()": async session => (await session.createBidirectionalStream()).writer.end(),
    "setBody(null)": async session => (await session.createBidirectionalStream()).setBody(null),
    'setBody("")': async session => (await session.createBidirectionalStream()).setBody(""),
    "createBidirectionalStream({ body })": session => session.createBidirectionalStream({ body: empty }),
  };

  test.each([
    ["a stream that the client opens, at a stream limit of 0", "client", noStreamCredit],
    ["a stream that the server opens, at a stream limit of 0", "server", noStreamCredit],
    // Node holds the end at a limit of the connection until MAX_DATA. bun
    // sends it, as RFC 9000 allows.
    ["a stream that the client opens, at a connection limit of 0", "client", { initialMaxData: 0 }],
  ] as const)("reaches the peer on %s, however the body ends", async (_, opener, limits) => {
    await using peers = await setup(opener === "client" ? { server: limits } : { client: limits });
    const sender = peers[opener];
    for (const end of Object.values(ways)) await end(sender);
    await Promise.race([peers.ended(Object.keys(ways).length), peers.noEnd(sender)]);
    // Bidirectional stream ids are 0, 4, 8, ... from the client and 1, 5, 9,
    // ... from the server.
    const first = opener === "client" ? 0 : 1;
    const missing = Object.keys(ways).filter((_, i) => peers.ends.get(BigInt(first + i * 4)) !== 0);
    expect(missing).toEqual([]);
  });

  test("reaches the peer when the stream ended before the handshake completed", async () => {
    await using peers = await setup({
      server: noStreamCredit,
      async early(client) {
        (await client.createBidirectionalStream()).writer.endSync();
        await client.createBidirectionalStream({ body: empty });
      },
    });
    expect(await Promise.race([peers.ended(2), peers.noEnd()])).toEqual([0, 0]);
  });

  test.each(["client", "server"] as const)(
    "reaches the peer on a unidirectional stream that the %s opens, and the stream closes",
    async opener => {
      await using peers = await setup(opener === "client" ? { server: noStreamCredit } : { client: noStreamCredit });
      const sender = peers[opener];
      const first = await sender.createUnidirectionalStream();
      first.writer.endSync();
      const second = await sender.createUnidirectionalStream({ body: empty });
      expect(await Promise.race([peers.ended(2), peers.noEnd(sender)])).toEqual([0, 0]);
      const closed = Promise.all([first.closed, second.closed]).then(() => "streams closed");
      expect(await Promise.race([closed, peers.client.closed])).toBe("streams closed");
    },
  );

  // `initialMaxData` is the limit of the connection. Node holds the end there
  // until MAX_DATA. bun sends it.
  test.each(["initialMaxStreamDataBidiRemote", "initialMaxData"])(
    "reaches the peer after the body used all of %s",
    async limit => {
      const body = new Uint8Array(1000).fill(0x61);
      await using peers = await setup({ server: { [limit]: body.byteLength } });
      const stream = await peers.client.createBidirectionalStream();
      peers.deafen();
      expect(stream.writer.writeSync(body)).toBe(true);
      await peers.until(() => peers.got.get(stream.id) === body.byteLength);
      stream.writer.endSync();
      expect(await Promise.race([peers.ended(), peers.noEnd()])).toEqual([body.byteLength]);
      // The client dropped what the server sent after the block. So the end
      // did not leave with new credit.
      expect(await peers.dropped()).toBeGreaterThan(0);
    },
  );

  test("reaches the peer from a stream handler of the accepting side", async () => {
    // The client gives no credit for the answer on a stream that it opens.
    await using peers = await setup({ client: noStreamCredit });
    const answered = Promise.withResolvers<void>();
    peers.server.onstream = (stream: any) => {
      stream.closed.catch(() => {});
      stream.writer.endSync();
      answered.resolve();
    };
    const stream = await peers.client.createBidirectionalStream();
    stream.closed.catch(() => {});
    stream.writer.endSync();
    const answer = (async () => {
      let bytes = 0;
      for await (const batch of stream) for (const chunk of batch) bytes += chunk.byteLength;
      return bytes;
    })();
    await answered.promise;
    expect(await Promise.race([answer, peers.noEnd(peers.server)])).toBe(0);
  });

  // A stream with credit keeps lsquic's write event. In a stream handler its
  // FIN is not with lsquic yet when endSync() returns.
  test("gives the end to lsquic in the call only when the stream has no credit", async () => {
    const script = `
      import { createPrivateKey } from "node:crypto";
      import { readFileSync } from "node:fs";
      import { join } from "node:path";
      import { connect, listen, QuicEndpoint } from "node:quic";
      const { getQuicStreamState } = (await import("internal/quic/quic")).default;

      const keysDir = process.env.QUIC_KEYS_DIR;
      const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
      const cert = readFileSync(join(keysDir, "agent1-cert.pem"));
      const noCredit = { initialMaxStreamDataBidiLocal: 0, initialMaxStreamDataBidiRemote: 0 };
      const finSent = {};
      for (const [name, limits] of [["credit", {}], ["noCredit", noCredit]]) {
        const answered = Promise.withResolvers();
        const server = await listen(
          session => {
            session.closed.catch(() => {});
            session.onstream = stream => {
              stream.closed.catch(() => {});
              stream.writer.endSync();
              answered.resolve(getQuicStreamState(stream).finSent);
            };
          },
          { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"], transportParams: { maxIdleTimeout: 30 } },
        );
        const client = await connect(server.address, {
          endpoint: new QuicEndpoint(),
          alpn: "quic-test",
          servername: "localhost",
          verifyPeer: "manual",
          transportParams: { maxIdleTimeout: 30, ...limits },
        });
        client.closed.catch(() => {});
        await client.opened;
        const stream = await client.createBidirectionalStream();
        stream.closed.catch(() => {});
        stream.writer.endSync();
        finSent[name] = await answered.promise;
      }
      console.log(JSON.stringify(finSent));
      process.exit(0);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--expose-internals", "-e", script],
      env: { ...bunEnv, QUIC_KEYS_DIR: keysDir },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe(JSON.stringify({ credit: false, noCredit: true }) + "\n");
    expect(exitCode).toBe(0);
  }, 30_000);

  test("waits for credit when a byte of the body is still queued", async () => {
    await using peers = await setup({ server: noStreamCredit });
    const stream = await peers.client.createBidirectionalStream();
    stream.closed.catch(() => {});
    expect(stream.writer.writeSync(new Uint8Array(1))).toBe(true);
    stream.writer.endSync();
    expect(await Promise.race([peers.ended(), peers.noEnd()])).toBe("no end");
  });

  test("does not end a stream on stopSending()", async () => {
    await using peers = await setup({ server: noStreamCredit });
    const stream = await peers.client.createBidirectionalStream();
    stream.closed.catch(() => {});
    stream.stopSending();
    expect(await Promise.race([peers.ended(), peers.noEnd()])).toBe("no end");
  });

  test("does not close a stream that the peer opened for its own data only", async () => {
    // The server has no credit on this connection, and this stream gives it
    // no side to send on.
    await using peers = await setup({ client: { initialMaxData: 0 } });
    const read = peers.server.onstream;
    peers.server.onstream = (stream: any) => {
      stream.setBody("");
      return read(stream);
    };
    const chunk = new Uint8Array(1000);
    const stream = await peers.client.createUnidirectionalStream();
    stream.closed.catch(() => {});
    stream.writer.writeSync(chunk);
    await peers.until(() => peers.got.get(stream.id) === chunk.byteLength);
    stream.writer.writeSync(chunk);
    stream.writer.endSync();
    expect(await Promise.race([peers.ended(), peers.noEnd()])).toEqual([2 * chunk.byteLength]);
  });

  // On HTTP/3 the end of a body is not the last thing on a stream: a header
  // block can follow it in the same turn. HTTP/3 keeps the write event.
  test.each([
    ["after a 103", true],
    ["before a header block", false],
  ])("on HTTP/3, an answer whose body ends %s still gets its headers", async (_, interim) => {
    const sent: unknown[] = [];
    let answer: any;
    await using peers = await setup({
      h3: true,
      // What the server can send on the connection before a MAX_DATA.
      client: { initialMaxData: 16384 },
      listenOptions: {
        onheaders(this: any, headers: Record<string, string>) {
          if (headers[":path"] === "/answer") {
            answer = this;
            if (interim) sent.push(this.sendInformationalHeaders({ ":status": "103" }));
            return;
          }
          // lsquic reports this stream as blocked when its body has used all
          // of the connection's credit.
          this.onblocked = () => {
            this.onblocked = undefined;
            sent.push(answer.writer.endSync(), answer.sendHeaders({ ":status": "200" }));
          };
          this.sendHeaders({ ":status": "200" });
          this.writer.writeSync(new Uint8Array(65536));
          this.writer.endSync();
        },
      },
    });
    const get = (path: string) => ({ ":method": "GET", ":path": path, ":scheme": "https", ":authority": "localhost" });
    const events: string[] = [];
    const stream = await peers.client.createBidirectionalStream({
      headers: get("/answer"),
      oninfo: (headers: Record<string, string>) => events.push("info " + headers[":status"]),
      onheaders: (headers: Record<string, string>) => events.push("headers " + headers[":status"]),
    });
    stream.closed.catch(() => {});
    const filler = await peers.client.createBidirectionalStream({ headers: get("/filler"), onheaders() {} });
    filler.closed.catch(() => {});
    // The client reads the large answer, so the server gets credit again.
    const drained = (async () => {
      for await (const _ of filler);
    })();
    try {
      for await (const _ of stream);
      events.push("end");
    } catch (err: any) {
      events.push(String(err?.code));
    }
    await drained;
    expect({ sent, events }).toEqual({
      sent: interim ? [true, 0, true] : [0, true],
      events: interim ? ["info 103", "headers 200", "end"] : ["headers 200", "end"],
    });
  });
});
