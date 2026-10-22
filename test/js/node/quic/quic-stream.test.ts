// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, withoutAsanQuarantine } from "harness";
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
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

// A client that resumes a session seals what it sends before its handshake is
// done with the 0-RTT keys. lsquic gave each of those packets the Handshake
// long-header type, and changed that to 0-RTT only where it wrote a STREAM or
// DATAGRAM frame. A packet with only RESET_STREAM, STOP_SENDING, DATA_BLOCKED
// or STREAM_DATA_BLOCKED kept the Handshake type: the server could not open
// it, and the client sent it again in that form for the whole session.
describe("frames a resumed client sends before its handshake is done", () => {
  const alpn = "quic-test";
  const encoder = new TextEncoder();
  const sni = { "*": { keys: [key], certs: [cert] } };

  // Resolves with the length of the first packet that matches, of the packets
  // that the client sent before its handshake.
  type Until = (match: (length: number) => boolean) => Promise<number>;

  // The long-header type of each QUIC packet in a datagram (RFC 9000 section
  // 17.2, and RFC 9369 section 3.2 for the type bits of version 2). `lengths`
  // gets the Length field of each packet that is not an Initial packet.
  function packetTypes(datagram: Buffer, lengths: number[]) {
    const types: string[] = [];
    let at = 0;
    const varint = () => {
      const length = 1 << (datagram[at] >> 6);
      let value = datagram[at] & 0x3f;
      for (let i = 1; i < length; i++) value = value * 256 + datagram[at + i];
      at += length;
      return value;
    };
    // A 1-RTT packet has a short header and ends the datagram.
    while (at < datagram.length && datagram[at] & 0x80) {
      const v2 = datagram.readUInt32BE(at + 1) === 0x6b3343cf;
      const names = v2 ? ["Retry", "Initial", "0-RTT", "Handshake"] : ["Initial", "0-RTT", "Handshake", "Retry"];
      const type = names[(datagram[at] >> 4) & 3];
      types.push(type);
      at += 5;
      at += 1 + datagram[at]; // destination connection id
      at += 1 + datagram[at]; // source connection id
      if (type === "Initial") {
        const token = varint();
        at += token;
      }
      const length = varint(); // packet number and payload
      if (type !== "Initial") lengths.push(length);
      at += length;
    }
    return types;
  }

  async function readAll(stream: any) {
    const chunks: Uint8Array[] = [];
    for await (const batch of stream) chunks.push(...batch);
    return Buffer.concat(chunks).toString();
  }

  const onEarlyStream = (use: (stream: any) => void) => async (client: any) => {
    const stream = await client.createBidirectionalStream();
    stream.closed.catch(() => {});
    use(stream);
  };

  // Resumes a session with 0-RTT through a relay that holds the server's
  // datagrams until `act` is done and the client has sent `packets` packets
  // after its Initial: each of them leaves before the client can have
  // Handshake keys. With `ticketParams` the session ticket comes from another
  // server that has those transport parameters, so the server behind the
  // relay rejects the 0-RTT. With `later` the client connects in a later turn
  // of the event loop, outside the node:quic callback that gave the ticket,
  // and each call sends its own packet. With `close` the client closes the
  // session when its request has an answer. Returns the packet types from
  // before the handshake, and what the server saw when it answered a request
  // that the client sent after it.
  async function beforeHandshake(
    setup: { transportParams?: object; ticketParams?: object; packets?: number; later?: boolean; close?: boolean },
    act: (client: any, until: Until) => unknown,
  ) {
    const { transportParams = {}, ticketParams, packets = 1 } = setup;
    const events: string[] = [];
    const onSession = (session: any) => {
      session.onerror = () => {};
      session.closed.catch(() => {});
      session.ondatagram = (data: Uint8Array) => events.push(`datagram ${Buffer.from(data).toString("hex")}`);
      session.onstream = async (stream: any) => {
        const id = String(stream.id);
        events.push(`stream ${id}`);
        stream.closed.catch(() => {});
        stream.onreset = (error: any) => {
          events.push(`reset ${id} ${error.errorCode}`);
          // Both halves of the stream are closed then, and the server gives
          // the client the credit for another stream.
          stream.writer.endSync();
        };
        if ((await readAll(stream).catch(() => "")) === "marker") {
          stream.writer.writeSync(encoder.encode("marker"));
          stream.writer.endSync();
        }
      };
    };
    const server = await listen(onSession, { sni, alpn: [alpn], transportParams });
    const ticketServer = ticketParams
      ? await listen(onSession, { sni, alpn: [alpn], transportParams: ticketParams })
      : server;
    const serverPort = server.address!.port;
    const relay = createSocket("udp4");
    let client: any;
    try {
      let clientPort = 0;
      let held: Buffer[] | undefined = [];
      const types: string[] = [];
      const lengths: number[] = [];
      let wake = () => {};
      const until: Until = async match => {
        while (!lengths.some(match)) await new Promise<void>(resolve => (wake = resolve));
        return lengths.find(match)!;
      };
      const sent = Promise.withResolvers<void>();
      sent.promise.catch(() => {});
      relay.on("error", sent.reject);
      relay.on("message", (datagram, from) => {
        if (from.port === serverPort) {
          if (held) held.push(datagram);
          else relay.send(datagram, clientPort, "127.0.0.1");
          return;
        }
        clientPort = from.port;
        if (held) {
          types.push(...packetTypes(datagram, lengths));
          if (lengths.length >= packets) sent.resolve();
          wake();
        }
        relay.send(datagram, serverPort, "127.0.0.1");
      });
      relay.bind(0, "127.0.0.1");
      await once(relay, "listening");
      const options = { alpn, servername: "localhost", verifyPeer: "manual", onerror() {} };

      const ticket = Promise.withResolvers<any>();
      const first = await connect(ticketServer.address!, {
        ...options,
        onsessionticket: (t: any) => ticket.resolve(t),
      } as SessionOptions);
      first.closed.catch(() => {});
      await first.opened;
      const sessionTicket = await ticket.promise;
      first.destroy();
      events.length = 0;
      if (setup.later) await new Promise(resolve => setImmediate(resolve));

      client = await connect(`127.0.0.1:${relay.address().port}`, { ...options, sessionTicket } as SessionOptions);
      client.closed.then(() => sent.reject(new Error("the session closed before it sent the frame")), sent.reject);
      await Promise.all([act(client, until), sent.promise]);
      for (const datagram of held) relay.send(datagram, clientPort, "127.0.0.1");
      held = undefined;
      const { earlyDataAccepted } = await client.opened;

      // The server answers this request after every packet that the client
      // sent before it.
      const marker = await client.createBidirectionalStream();
      marker.closed.catch(() => {});
      marker.writer.writeSync(encoder.encode("marker"));
      marker.writer.endSync();
      await readAll(marker);
      if (setup.close) await client.close();

      return {
        earlyDataAccepted,
        types: [...new Set(types)].sort(),
        server: events.filter(event => event !== `stream ${marker.id}`),
      };
    } finally {
      relay.close();
      // A graceful close waits for the early stream, and that is the whole
      // idle timeout when the server never saw its frame.
      client?.destroy();
      await server.destroy();
      if (ticketServer !== server) await ticketServer.destroy();
    }
  }

  const reset = onEarlyStream(stream => stream.resetStream(42n));
  const stop = onEarlyStream(stream => stream.stopSending(42n));

  test("resetStream() goes out in a 0-RTT packet and resets the server's stream", async () => {
    expect(await beforeHandshake({}, reset)).toEqual({
      earlyDataAccepted: true,
      types: ["0-RTT", "Initial"],
      server: ["stream 0", "reset 0 42"],
    });
  });

  test("stopSending() goes out in a 0-RTT packet and shows the server the stream", async () => {
    expect(await beforeHandshake({}, stop)).toEqual({
      earlyDataAccepted: true,
      types: ["0-RTT", "Initial"],
      server: ["stream 0"],
    });
  });

  // The write fills the connection's flow control window of 1000 bytes with
  // one STREAM packet. The second packet is DATA_BLOCKED.
  test("DATA_BLOCKED goes out in a 0-RTT packet", async () => {
    const write = onEarlyStream(stream => stream.writer.writeSync(new Uint8Array(5000)));
    expect(await beforeHandshake({ transportParams: { initialMaxData: 1000 }, packets: 2 }, write)).toEqual({
      earlyDataAccepted: true,
      types: ["0-RTT", "Initial"],
      server: ["stream 0"],
    });
  });

  // STREAM_DATA_BLOCKED (4 bytes) gets a packet of its own when the STREAM
  // frame that reaches the stream's window leaves less room than that. The
  // first stream shows how long a full packet is. The second stream sends a
  // first chunk of a size that makes its next frame end 1 byte before the end
  // of a full packet.
  test("STREAM_DATA_BLOCKED in a packet of its own goes out in a 0-RTT packet", async () => {
    const window = 1300;
    const write = async (client: any, until: Until) => {
      const first = await client.createBidirectionalStream();
      first.closed.catch(() => {});
      first.writer.writeSync(new Uint8Array(5000));
      const full = await until(length => length > 1100);
      const second = await client.createBidirectionalStream();
      second.closed.catch(() => {});
      // Around the data of the chunk: 1 byte of packet number, 1 each of frame
      // type and stream id, 2 of length, and 16 of tag. The next frame has 2
      // bytes of offset in addition.
      const overhead = 1 + 1 + 1 + 2 + 16;
      const chunk = window - (full - overhead) + 3;
      second.writer.writeSync(new Uint8Array(chunk));
      await until(length => length === chunk + overhead);
      second.writer.writeSync(new Uint8Array(5000));
      await until(length => length === 1 + 4 + 16);
    };
    expect(await beforeHandshake({ transportParams: { initialMaxStreamDataBidiRemote: window } }, write)).toEqual({
      earlyDataAccepted: true,
      types: ["0-RTT", "Initial"],
      server: ["stream 0", "stream 4"],
    });
  });

  // lsquic's DATAGRAM writer set this type itself before the type became the
  // default, so this test also passes without the new default.
  test("a datagram goes out in a 0-RTT packet", async () => {
    const send = (client: any) => client.sendDatagram(new Uint8Array([0xca, 0xfe]));
    expect(await beforeHandshake({}, send)).toEqual({
      earlyDataAccepted: true,
      types: ["0-RTT", "Initial"],
      server: ["datagram cafe"],
    });
  });

  // The two early streams use all of the server's stream credit. The server
  // gives the credit for the later request only when the RESET_STREAM of an
  // early stream has reached it.
  test("a request gets an answer after the early streams used all the stream credit", async () => {
    const resetTwo = async (client: any) => {
      await reset(client);
      await reset(client);
    };
    expect(await beforeHandshake({ transportParams: { initialMaxStreamsBidi: 2 } }, resetTwo)).toEqual({
      earlyDataAccepted: true,
      types: ["0-RTT", "Initial"],
      server: ["stream 0", "reset 0 42", "stream 4", "reset 4 42"],
    });
  });

  // A close() waits until the server has acknowledged the early RESET_STREAM.
  // A server that cannot open the packet never does, and close() then lasts
  // until the idle timeout ends the session. The client connects in a later
  // turn of the event loop here, so the frame has a packet of its own.
  test("close() does not wait for the idle timeout after an early resetStream()", async () => {
    expect(await beforeHandshake({ later: true, close: true }, reset)).toEqual({
      earlyDataAccepted: true,
      types: ["0-RTT", "Initial"],
      server: ["stream 0", "reset 0 42"],
    });
  });

  // The server behind the relay has another stream limit than the server that
  // gave the ticket, so it rejects the 0-RTT. What that server sees of the
  // early stream is not part of this test: lsquic sends a rejected 0-RTT
  // packet again as a 1-RTT packet, and Node discards the early streams.
  test("a rejected 0-RTT leaves the session usable after an early resetStream()", async () => {
    const setup = { ticketParams: { initialMaxStreamsBidi: 100 }, transportParams: { initialMaxStreamsBidi: 10 } };
    const { earlyDataAccepted, types } = await beforeHandshake(setup, reset);
    expect({ earlyDataAccepted, types }).toEqual({ earlyDataAccepted: false, types: ["0-RTT", "Initial"] });
  });
});
