// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, withoutAsanQuarantine } from "harness";
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

// A stream's flow-control credit goes back to the peer when JavaScript takes
// the bytes, not when bun reads them from lsquic. A stream that nothing reads
// holds at most its receive window, and its sender waits for the reader.
describe("receive backpressure", () => {
  // The stream receive window of the side that does not read.
  const WINDOW = 65536;

  const pattern = (length: number) => {
    const bytes = Buffer.allocUnsafe(length);
    for (let i = 0; i < length; i++) bytes[i] = i % 251;
    return bytes;
  };
  const request = { ":method": "POST", ":path": "/", ":scheme": "https", ":authority": "localhost" };

  // Both ends of the one stream that a shape opens.
  type Ends = { payload: Uint8Array; sender: PromiseWithResolvers<any>; receiver: PromiseWithResolvers<any> };
  type Shape = {
    name: string;
    // Absent for HTTP/3.
    alpn?: string;
    // The session that writes the payload.
    writer: "client" | "server";
    serverParams?: Record<string, number>;
    clientParams?: Record<string, number>;
    serverOptions?: Record<string, unknown>;
    // The first stream that the peer opens on the server and on the client.
    onServerStream?: (stream: any, ends: Ends) => void;
    onClientStream?: (stream: any, ends: Ends) => void;
    onServerSession?: (session: any, ends: Ends) => void;
    onClient?: (client: any, ends: Ends) => Promise<void>;
  };

  // A stream that closed before its first `stats` access reports zeroes.
  const keep = (stream: any) => {
    void stream.stats;
    stream.closed.catch(() => {});
    return stream;
  };

  const serverBidi: Shape = {
    name: "a server and a client's bidirectional stream",
    alpn: "quic-test",
    writer: "client",
    serverParams: { initialMaxStreamDataBidiRemote: WINDOW },
    onServerStream(stream, ends) {
      stream.writer.endSync();
      ends.receiver.resolve(stream);
    },
    async onClient(client, ends) {
      ends.sender.resolve(keep(await client.createBidirectionalStream({ body: ends.payload })));
    },
  };
  const shapes: Shape[] = [
    serverBidi,
    {
      name: "a server and a client's unidirectional stream",
      alpn: "quic-test",
      writer: "client",
      serverParams: { initialMaxStreamDataUni: WINDOW },
      onServerStream: (stream, ends) => ends.receiver.resolve(stream),
      async onClient(client, ends) {
        ends.sender.resolve(keep(await client.createUnidirectionalStream({ body: ends.payload })));
      },
    },
    {
      name: "a client and the answer on its own bidirectional stream",
      alpn: "quic-test",
      writer: "server",
      // The second window is for the stream that `roundTrip()` opens from the server.
      clientParams: { initialMaxStreamDataBidiLocal: WINDOW, initialMaxStreamDataBidiRemote: WINDOW },
      onServerStream(stream, ends) {
        stream.setBody(ends.payload);
        ends.sender.resolve(stream);
      },
      async onClient(client, ends) {
        ends.receiver.resolve(keep(await client.createBidirectionalStream({ body: new Uint8Array(1) })));
      },
    },
    {
      name: "an HTTP/3 server and the body of a request that it answered",
      writer: "client",
      serverParams: { initialMaxStreamDataBidiRemote: WINDOW },
      serverOptions: {
        onheaders(this: any) {
          this.sendHeaders({ ":status": "200" }, { terminal: true });
        },
      },
      onServerStream: (stream, ends) => ends.receiver.resolve(stream),
      async onClient(client, ends) {
        ends.sender.resolve(keep(await client.createBidirectionalStream({ headers: request, body: ends.payload })));
      },
    },
  ];

  // Runs `shape` with `payload` and gives back both ends of the one stream.
  async function open(shape: Shape, payload: Uint8Array) {
    const ends: Ends = { payload, sender: Promise.withResolvers(), receiver: Promise.withResolvers() };
    const serverSession = Promise.withResolvers<any>();
    // A session's `onstream`: `first` gets the first stream. Each later one is
    // the stream of a `roundTrip()`, which HTTP/3 answers in `onheaders`.
    const route = (first?: (stream: any, ends: Ends) => void) => (stream: any) => {
      keep(stream);
      if (first) {
        const handler = first;
        first = undefined;
        handler(stream, ends);
      } else if (shape.alpn) {
        stream.writer.endSync();
      }
    };
    const server = await listen(
      (session: any) => {
        session.onerror = () => {};
        session.closed.catch(() => {});
        session.onstream = route(shape.onServerStream);
        shape.onServerSession?.(session, ends);
        serverSession.resolve(session);
      },
      {
        ...(shape.alpn ? { alpn: [shape.alpn] } : {}),
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 10, ...shape.serverParams },
        ...shape.serverOptions,
      },
    );
    // An endpoint of its own: the transport parameters belong to the endpoint,
    // so a reused one keeps those of its first session.
    const client = await connect(server.address!, {
      ...(shape.alpn ? { alpn: shape.alpn } : {}),
      reuseEndpoint: false,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 10, ...shape.clientParams },
      onerror() {},
      onstream: route(shape.onClientStream),
    } as SessionOptions);
    const clientEndpoint = client.endpoint!;
    client.closed.catch(() => {});
    await client.opened;
    await shape.onClient?.(client, ends);
    const [sender, receiver] = await Promise.all([ends.sender.promise, ends.receiver.promise]);
    const writer = shape.writer === "client" ? client : await serverSession.promise;
    // The writer opens one more stream and waits for the answer to it. The
    // other session gets that stream after every packet the writer sent
    // before, and the writer gets the answer after every packet the other
    // session sent before it.
    async function roundTrip() {
      const stream = shape.alpn
        ? await writer.createBidirectionalStream({ body: new Uint8Array(1) })
        : await writer.createBidirectionalStream({ headers: request });
      await stream.closed;
    }
    return {
      client,
      serverSession: await serverSession.promise,
      sender,
      receiver,
      roundTrip,
      // What the sender got out once it has used `floor` bytes of the window
      // and two more round trips: by then it has every limit that the
      // receiver gave without a reader.
      async sent(floor: number) {
        while (Number(sender.stats.bytesSent) < floor) await roundTrip();
        await roundTrip();
        await roundTrip();
        return Number(sender.stats.bytesSent);
      },
      async [Symbol.asyncDispose]() {
        await Promise.all([clientEndpoint.destroy(), server.destroy()]);
      },
    };
  }

  // How much of `payload` the stream still delivers, and whether it is the same bytes.
  // `betweenBatches` runs after each batch that the reader gets.
  async function delivered(stream: any, payload: Buffer, betweenBatches?: (batch: Uint8Array[]) => unknown) {
    const chunks: Uint8Array[] = [];
    for await (const batch of stream) {
      chunks.push(...batch);
      await betweenBatches?.(batch);
    }
    const got = Buffer.concat(chunks);
    return { length: got.length, same: got.equals(payload) };
  }

  // The most bytes that the stream's unread queue held.
  const queued = (stream: any) => Number(stream.stats.maxBytesAccumulated);

  test.each(shapes)("$name: the sender stops at the window until the stream is read", async shape => {
    const payload = pattern(3 * WINDOW);
    await using pair = await open(shape, payload);
    const { sender, receiver } = pair;
    // HTTP/3 frames and the header block use a little of the window.
    const floor = shape.alpn ? WINDOW : WINDOW - 1024;

    const sent = await pair.sent(floor);
    expect(sent).toBeGreaterThanOrEqual(floor);
    expect(sent).toBeLessThanOrEqual(WINDOW);
    expect(queued(receiver)).toBe(sent);

    expect(await delivered(receiver, payload)).toEqual({ length: payload.length, same: true });
    await Promise.all([sender.closed, receiver.closed]);
    expect(queued(receiver)).toBeLessThanOrEqual(WINDOW);
  });

  test("a window of 256 bytes holds a sender of 8192 at 256", async () => {
    const payload = pattern(8192);
    await using pair = await open({ ...serverBidi, serverParams: { initialMaxStreamDataBidiRemote: 256 } }, payload);
    expect(await pair.sent(256)).toBe(256);
    expect(await delivered(pair.receiver, payload)).toEqual({ length: 8192, same: true });
    await Promise.all([pair.sender.closed, pair.receiver.closed]);
    expect(queued(pair.receiver)).toBeLessThanOrEqual(256);
  });

  // A FIN uses no flow-control credit, so the end of a body that stops at the
  // limit does not wait for the reader.
  test.each([
    { body: "given whole", later: false },
    { body: "written and ended later", later: true },
  ])("a body that fills the window exactly, $body, closes the stream without a reader", async ({ later }) => {
    const exact = pattern(WINDOW);
    const written: Shape = {
      ...serverBidi,
      async onClient(client, ends) {
        const stream = keep(await client.createBidirectionalStream({}));
        stream.writer.writeSync(ends.payload);
        ends.sender.resolve(stream);
      },
    };
    await using pair = await open(later ? written : serverBidi, exact);
    if (later) {
      expect(await pair.sent(WINDOW)).toBe(WINDOW);
      pair.sender.writer.endSync();
    }
    await Promise.all([pair.sender.closed, pair.receiver.closed]);
    expect(await delivered(pair.receiver, exact)).toEqual({ length: WINDOW, same: true });
  });

  test("a reader that lags has at most one window queued", async () => {
    const payload = pattern(1024 * 1024);
    await using pair = await open(serverBidi, payload);
    await pair.sent(WINDOW);
    // A round trip after each batch: the sender uses every limit it gets
    // before the reader takes the next batch.
    expect(await delivered(pair.receiver, payload, pair.roundTrip)).toEqual({ length: payload.length, same: true });
    await Promise.all([pair.sender.closed, pair.receiver.closed]);
    expect(queued(pair.receiver)).toBeLessThanOrEqual(WINDOW);
  });

  // Fits one packet, so each is one chunk of the receiver's queue, and a
  // batch of the reader is 16 of them.
  const piece = pattern(1100);
  const batch = 16 * piece.length;

  // A client's stream with `count` pieces on it, each sent by itself, and a
  // receive window of `window`. Nothing reads it and nothing ends it.
  async function pieces(count: number, window: number) {
    const shape: Shape = {
      ...serverBidi,
      serverParams: { initialMaxStreamDataBidiRemote: window },
      onServerStream: (stream, ends) => ends.receiver.resolve(stream),
      async onClient(client, ends) {
        const stream = keep(await client.createBidirectionalStream({}));
        stream.writer.writeSync(piece);
        ends.sender.resolve(stream);
      },
    };
    const pair = await open(shape, piece);
    await pair.roundTrip();
    for (let sent = 1; sent < count; sent++) {
      pair.sender.writer.writeSync(piece);
      await pair.roundTrip();
    }
    return pair;
  }

  // Starts a reader of `stream` that stops after its first batch. `taken` is
  // the size of that batch, and `rest()` reads on to the end.
  function readOneBatch(stream: any, payload: Buffer) {
    const taken = Promise.withResolvers<number>();
    const resume = Promise.withResolvers<void>();
    const done = delivered(stream, payload, chunks => {
      taken.resolve(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
      return resume.promise;
    });
    return { taken: taken.promise, rest: () => (resume.resolve(), done) };
  }

  // The limit moves when the reader has taken more than half of the window.
  // Inside a QUIC callback the endpoint sends the new limit when the callback
  // ends. A read outside of one has to start the send itself.
  test.each([
    { reader: "takes more than half of the window", queued: 20, window: 20, packet: true },
    // bun has read more than half of the window from lsquic. That does not count.
    { reader: "takes less than half of the window", queued: 24, window: 40, packet: false },
    { reader: "starts after the end of the body", queued: 20, window: 20, end: true, packet: false },
    { reader: "starts after stopSending()", queued: 20, window: 20, stop: true, packet: false },
  ])("a read outside a QUIC callback sends a packet at once ($packet) when the reader $reader", async row => {
    // `row.queued` pieces wait in a window of `row.window` pieces.
    await using pair = await pieces(row.queued, row.window * piece.length);
    if (row.end) {
      pair.sender.writer.endSync();
      await pair.roundTrip();
    }
    // Leave the callback that ended the last round trip.
    await new Promise<void>(resolve => setImmediate(resolve));
    if (row.stop) pair.receiver.stopSending();
    const packets = () => pair.serverSession.endpoint.stats.packetsSent;
    const before = packets();
    // A reader pulls its first batch, 16 pieces, before `next()` returns.
    const first = pair.receiver[Symbol.asyncIterator]().next();
    expect(packets() > before).toBe(row.packet);
    await first;
  });

  // The limit is one window past what the reader took, not one window past
  // what bun read from lsquic.
  test("a reader that stops part-way leaves the sender one window past what it took", async () => {
    // 15 pieces are half of this window: the last piece of the batch is the
    // one that moves the limit.
    const window = 30 * piece.length;
    const rest = pattern(3 * window);
    const payload = Buffer.concat([...Array(20).fill(piece), rest]);
    await using pair = await pieces(20, window);
    expect(queued(pair.receiver)).toBe(20 * piece.length);

    const reader = readOneBatch(pair.receiver, payload);
    expect(await reader.taken).toBe(batch);
    pair.sender.writer.writeSync(rest);
    pair.sender.writer.endSync();
    expect(await pair.sent(batch + window)).toBe(batch + window);
    expect(queued(pair.receiver)).toBe(window);

    expect(await reader.rest()).toEqual({ length: payload.length, same: true });
    expect(queued(pair.receiver)).toBe(window);
  });

  // Inside a QUIC callback the new limit waits for the end of the callback.
  // The reader takes 16 pieces and the 11th moves the limit: the frame has to
  // carry the limit of the 16th. lsquic's reset of the write side drops what
  // a stream has queued to send, and the sender would wait for that frame for
  // ever.
  test("a batch read in a QUIC callback moves the limit by the whole batch, also past resetStream()", async () => {
    const window = 20 * piece.length;
    const rest = pattern(3 * window);
    const payload = Buffer.concat([...Array(20).fill(piece), rest]);
    await using pair = await pieces(20, window);

    const started = Promise.withResolvers<ReturnType<typeof readOneBatch>>();
    const echo = pair.serverSession.onstream;
    pair.serverSession.onstream = (stream: any) => {
      pair.serverSession.onstream = echo;
      echo(stream);
      started.resolve(readOneBatch(pair.receiver, payload));
      pair.receiver.resetStream();
    };
    await pair.roundTrip();
    const reader = await started.promise;
    expect(await reader.taken).toBe(batch);
    pair.sender.writer.writeSync(rest);
    pair.sender.writer.endSync();
    expect(await pair.sent(batch + window)).toBe(batch + window);
    expect(queued(pair.receiver)).toBe(window);

    expect(await reader.rest()).toEqual({ length: payload.length, same: true });
  });

  // lsquic takes the send limit of a bidirectional stream from the role of
  // the connection, so on a stream that the server opened the sender does not
  // see the limit that the receiver gives it. Such a stream keeps the rule of
  // a read: with a limit that waits for the reader, every body larger than
  // one window would end the session with a flow control error. The writes
  // here stay inside the limits that the reads give.
  test("a bidirectional stream that the server opened is not held back", async () => {
    const parts = [pattern(49152), pattern(32768), pattern(32768), pattern(32768)];
    const payload = Buffer.concat(parts);
    const shape: Shape = {
      name: "",
      alpn: "quic-test",
      writer: "server",
      clientParams: { initialMaxStreamDataBidiRemote: WINDOW },
      onClientStream(stream, ends) {
        stream.writer.endSync();
        ends.receiver.resolve(stream);
      },
      onServerSession(session, ends) {
        session.opened.then(async () => {
          const stream = keep(await session.createBidirectionalStream({}));
          stream.writer.writeSync(parts[0]);
          ends.sender.resolve(stream);
        }, ends.sender.reject);
      },
    };
    await using pair = await open(shape, parts[0]);
    const { sender, receiver } = pair;
    expect(await pair.sent(parts[0].length)).toBe(parts[0].length);
    sender.writer.writeSync(parts[1]);
    const unread = parts[0].length + parts[1].length;
    expect(await pair.sent(unread)).toBe(unread);
    expect(unread).toBeGreaterThan(WINDOW);
    expect(queued(receiver)).toBe(unread);

    // What the reader takes does not count for this stream: the limit moves
    // as before when more arrives.
    const reader = readOneBatch(receiver, payload);
    await reader.taken;
    sender.writer.writeSync(parts[2]);
    await pair.sent(unread + parts[2].length);
    sender.writer.writeSync(parts[3]);
    sender.writer.endSync();
    expect(await reader.rest()).toEqual({ length: payload.length, same: true });
  });

  // The connection window is still returned when bun reads lsquic, so a
  // stream that nothing reads takes no credit from the other streams. Here
  // the unread stream alone fills the connection window.
  test("a second stream is delivered while the first is held at the connection window", async () => {
    const payload = pattern(3 * WINDOW);
    const other = pattern(3 * WINDOW);
    await using pair = await open(
      { ...serverBidi, serverParams: { initialMaxStreamDataBidiRemote: WINDOW, initialMaxData: WINDOW } },
      payload,
    );
    expect(await pair.sent(WINDOW)).toBe(WINDOW);

    const second = Promise.withResolvers<any>();
    const echo = pair.serverSession.onstream;
    pair.serverSession.onstream = (stream: any) => {
      pair.serverSession.onstream = echo;
      echo(stream);
      second.resolve(stream);
    };
    const sender = keep(await pair.client.createBidirectionalStream({ body: other }));
    expect(await delivered(await second.promise, other)).toEqual({ length: other.length, same: true });
    await sender.closed;
    expect(Number(pair.sender.stats.bytesSent)).toBe(WINDOW);
    expect(queued(pair.receiver)).toBe(WINDOW);

    expect(await delivered(pair.receiver, payload)).toEqual({ length: payload.length, same: true });
  });

  // A peer's STOP_SENDING is for the other half of the stream. lsquic counted
  // every byte received so far as consumed when it arrived, which gave the
  // sender a second window.
  test("a sender's stopSending() between two writes does not move its limit", async () => {
    const window = 8192;
    const shape: Shape = {
      ...serverBidi,
      serverParams: { initialMaxStreamDataBidiRemote: window },
      onServerStream: (stream, ends) => ends.receiver.resolve(stream),
      async onClient(client, ends) {
        const stream = keep(await client.createBidirectionalStream({}));
        // Outside of a QUIC callback each call sends its own packets.
        await new Promise<void>(resolve => setImmediate(resolve));
        stream.writer.writeSync(ends.payload.subarray(0, 5000));
        stream.stopSending();
        stream.writer.writeSync(ends.payload.subarray(5000));
        ends.sender.resolve(stream);
      },
    };
    await using pair = await open(shape, pattern(4 * window));
    expect(await pair.sent(window)).toBe(window);
    expect(queued(pair.receiver)).toBe(window);
  });

  // A stream that nothing reads stays open and keeps its place in the peer's
  // stream count. destroy() and stopSending() are how a receiver gives it up.
  test.each(["destroy", "stopSending"])("a held stream gives its stream slot back after %s()", async method => {
    const uni: Shape = {
      ...shapes[1],
      serverParams: { initialMaxStreamDataUni: WINDOW, initialMaxStreamsUni: 1 },
    };
    await using pair = await open(uni, pattern(3 * WINDOW));
    expect(await pair.sent(WINDOW)).toBe(WINDOW);

    const small = pattern(100);
    const second = Promise.withResolvers<any>();
    pair.serverSession.onstream = (stream: any) => second.resolve(keep(stream));
    const opened = pair.client.createUnidirectionalStream({ body: small }).then(keep);
    pair.receiver[method]();
    await opened;
    expect(await delivered(await second.promise, small)).toEqual({ length: small.length, same: true });
  });

  // A client that resumes a session opens streams before the handshake ends.
  // At its end lsquic gave every one of them the peer's limit for
  // bidirectional streams, so a unidirectional one could send past its window.
  test("a unidirectional stream that a client opens in 0-RTT stops at the window", async () => {
    const payload = pattern(3 * WINDOW);
    const unread = Promise.withResolvers<any>();
    let sessions = 0;
    const server = await listen(
      (session: any) => {
        session.onerror = () => {};
        session.closed.catch(() => {});
        const resumed = ++sessions === 2;
        session.onstream = (stream: any) => {
          keep(stream);
          if (stream.direction === "bidi") stream.writer.endSync();
          else if (resumed) unread.resolve(stream);
        };
      },
      {
        alpn: ["quic-test"],
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 10, initialMaxStreamDataUni: WINDOW },
      },
    );
    await using endpoints = new AsyncDisposableStack();
    endpoints.defer(() => server.destroy());
    const options = {
      alpn: "quic-test",
      reuseEndpoint: false,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 10 },
      onerror() {},
    };
    const roundTrip = async (session: any) => {
      await keep(await session.createBidirectionalStream({ body: new Uint8Array(1) })).closed;
    };

    let ticket: Buffer | undefined;
    const gotTicket = Promise.withResolvers<void>();
    const gotToken = Promise.withResolvers<Buffer>();
    const first = await connect(server.address!, {
      ...options,
      onsessionticket(value: Buffer) {
        ticket = value;
        gotTicket.resolve();
      },
      onnewtoken: gotToken.resolve,
    } as SessionOptions);
    endpoints.use(first.endpoint!);
    await first.opened;
    const [token] = await Promise.all([gotToken.promise, gotTicket.promise]);
    first.destroy();

    const second = await connect(server.address!, { ...options, sessionTicket: ticket, token } as SessionOptions);
    const secondEndpoint = second.endpoint!;
    endpoints.defer(() => secondEndpoint.destroy());
    second.closed.catch(() => {});
    const sender = keep(await second.createUnidirectionalStream({ body: payload }));
    const { earlyDataAccepted } = await second.opened;
    expect(earlyDataAccepted).toBe(true);

    while (Number(sender.stats.bytesSent) < WINDOW) await roundTrip(second);
    await roundTrip(second);
    await roundTrip(second);
    expect(Number(sender.stats.bytesSent)).toBe(WINDOW);
    expect(await delivered(await unread.promise, payload)).toEqual({ length: payload.length, same: true });
  });

  // The header block is larger than the stream window. lsquic takes HTTP/3
  // framing and header blocks out of the stream by itself, so they never wait
  // for a reader.
  test("HTTP/3 headers larger than the stream window arrive without a reader", async () => {
    const big = Buffer.alloc(6000, "v").toString();
    const seen = Promise.withResolvers<string>();
    const shape: Shape = {
      name: "",
      writer: "client",
      serverParams: { initialMaxStreamDataBidiRemote: 4096 },
      serverOptions: {
        onheaders(this: any, headers: Record<string, string>) {
          if (headers["x-big"] !== undefined) seen.resolve(headers["x-big"]);
          this.sendHeaders({ ":status": "200" }, { terminal: true });
        },
      },
      onServerStream: (stream, ends) => ends.receiver.resolve(stream),
      async onClient(client, ends) {
        ends.sender.resolve(keep(await client.createBidirectionalStream({ headers: { ...request, "x-big": big } })));
      },
    };
    await using pair = await open(shape, new Uint8Array(0));
    expect(await seen.promise).toBe(big);
    await pair.sender.closed;
  });

  describe("a stream whose body arrived and that nothing has read", () => {
    // Less than the window, so the sender finishes.
    const body = pattern(60000);

    test("is read in full after the peer closed the session", async () => {
      await using pair = await open(serverBidi, body);
      await pair.sender.closed;
      await pair.roundTrip();
      pair.client.close();
      await pair.serverSession.closed;
      expect(await delivered(pair.receiver, body)).toEqual({ length: body.length, same: true });
    });

    test.each(["resetStream", "stopSending"])("is read in full after %s()", async method => {
      await using pair = await open(serverBidi, body);
      await pair.sender.closed;
      await pair.roundTrip();
      pair.receiver[method]();
      expect(await delivered(pair.receiver, body)).toEqual({ length: body.length, same: true });
    });
  });
});
