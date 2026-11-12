import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isASAN, isWindows } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import path from "node:path";
import http2utils from "./helpers";

const skip = !fault.available() || isWindows;

afterEach(() => fault.clear());

// http2 sessions go through the same uSockets bsd_recv/bsd_send chokepoints.
// Faults are process-global, so client and server (both in this process)
// share the rule table — short-I/O tests are safe; errno tests target only
// recv (loop.c on the receiving side).

async function makeServer(handler: (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => void) {
  const server = http2.createServer();
  server.on("stream", handler);
  server.on("sessionError", () => {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as import("node:net").AddressInfo).port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    [Symbol.dispose]() {
      server.close();
    },
  };
}

describe.skipIf(skip)("node:http2 under injected syscall faults", () => {
  test("recv → short reads (1 byte) deliver complete HEADERS + DATA frames", async () => {
    const body = Buffer.alloc(1024, "h");
    using server = await makeServer((stream, headers) => {
      stream.respond({ ":status": 200, "content-type": "text/plain" });
      stream.end(body);
    });
    fault.set({ syscall: "recv", action: "short", bytes: 1, repeat: -1 });
    const client = http2.connect(server.url);
    client.on("error", () => {});
    try {
      const req = client.request({ ":path": "/" });
      const [headers] = (await once(req, "response")) as [http2.IncomingHttpHeaders & http2.IncomingHttpStatusHeader];
      expect(headers[":status"]).toBe(200);
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      await once(req, "end");
      expect(Buffer.concat(chunks).equals(body)).toBe(true);
    } finally {
      fault.clear();
      client.close();
    }
  });

  test("send → short writes (256 bytes) deliver complete request body to server", async () => {
    const reqBody = Buffer.alloc(2048, "p");
    let received = Buffer.alloc(0);
    const { promise: gotBody, resolve } = Promise.withResolvers<void>();
    using server = await makeServer((stream, headers) => {
      stream.on("data", (c: Buffer) => (received = Buffer.concat([received, c])));
      stream.on("end", () => {
        stream.respond({ ":status": 200 });
        stream.end();
        resolve();
      });
    });
    fault.set({ syscall: "send", action: "short", bytes: 256, repeat: -1 });
    const client = http2.connect(server.url);
    client.on("error", () => {});
    try {
      const req = client.request({ ":path": "/", ":method": "POST" });
      req.write(reqBody);
      req.end();
      await once(req, "response");
      await once(req, "end");
      await gotBody;
      expect(received.equals(reqBody)).toBe(true);
    } finally {
      fault.clear();
      client.close();
    }
  });

  // A payload over one DATA frame (16 KiB) is not corked frame by frame: send_data batches
  // the frame headers and points at the payload slices, and the batch leaves as one writev.
  // When writev takes nothing, the same slices are copied into the session's write buffer
  // and drained on writable. Every u32 holds its own offset, so a slice taken from the
  // wrong place or with the wrong length changes the bytes, not only their count.
  const batchBody = Buffer.alloc(3 * 16384 + 4096);
  for (let i = 0; i < batchBody.length; i += 4) batchBody.writeUInt32LE(i, i);

  test.each([
    ["writev takes the batch", () => {}],
    ["writev → 0 re-buffers the batch", () => fault.set({ syscall: "writev", action: "zero", repeat: -1 })],
  ])("multi-frame DATA batch arrives intact: %s", async (_, arm) => {
    const chunks: Buffer[] = [];
    const { promise: gotBody, resolve } = Promise.withResolvers<void>();
    using server = await makeServer(stream => {
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        stream.respond({ ":status": 200 });
        stream.end();
        resolve();
      });
    });
    const client = http2.connect(server.url);
    client.on("error", () => {});
    try {
      await once(client, "connect");
      const req = client.request({ ":path": "/", ":method": "POST" });
      arm();
      req.write(batchBody);
      req.end();
      await once(req, "response");
      await once(req, "end");
      await gotBody;
      const received = Buffer.concat(chunks);
      expect(received.length).toBe(batchBody.length);
      expect(received.equals(batchBody)).toBe(true);
    } finally {
      fault.clear();
      client.close();
    }
  });

  test("recv → short reads at HTTP/2 frame header boundary (9 bytes) still parse correctly", async () => {
    // HTTP/2 frame header is exactly 9 bytes; clamping recv to 9 forces the
    // frame parser to reassemble header and payload across separate reads.
    const body = Buffer.alloc(512, "x");
    using server = await makeServer(stream => {
      stream.respond({ ":status": 200 });
      stream.end(body);
    });
    fault.set({ syscall: "recv", action: "short", bytes: 9, repeat: -1 });
    const client = http2.connect(server.url);
    client.on("error", () => {});
    try {
      const req = client.request({ ":path": "/" });
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      await Promise.all([once(req, "response"), once(req, "end")]);
      expect(Buffer.concat(chunks).equals(body)).toBe(true);
    } finally {
      fault.clear();
      client.close();
    }
  });

  test("recv → ECONNRESET after connect surfaces as session 'error'", async () => {
    using server = await makeServer(stream => {
      stream.respond({ ":status": 200 });
      stream.end();
    });
    const client = http2.connect(server.url);
    const errP = once(client, "error");
    await once(client, "connect");
    fault.set({ syscall: "recv", action: "errno", errno: "ECONNRESET", repeat: -1 });
    // Trigger a recv by requesting.
    const req = client.request({ ":path": "/" });
    req.on("error", () => {});
    const [err] = (await errP) as [NodeJS.ErrnoException];
    expect(err).toBeInstanceOf(Error);
    expect(client.destroyed).toBe(true);
  });

  test("send → short writes (8 bytes) during connection preface still establish session", async () => {
    using server = await makeServer(stream => {
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });
    fault.set({ syscall: "send", action: "short", bytes: 8, repeat: -1 });
    const client = http2.connect(server.url);
    client.on("error", () => {});
    try {
      await once(client, "connect");
      const req = client.request({ ":path": "/" });
      const [headers] = (await once(req, "response")) as [http2.IncomingHttpHeaders & http2.IncomingHttpStatusHeader];
      expect(headers[":status"]).toBe(200);
      req.resume();
      await once(req, "end");
    } finally {
      fault.clear();
      client.close();
    }
  });

  test("https/2: recv → short reads (3 bytes) over TLS deliver complete response", async () => {
    const body = Buffer.alloc(256, "s");
    const server = http2.createSecureServer({ key: certs.key, cert: certs.cert });
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.respond({ ":status": 200 });
      stream.end(body);
    });
    server.on("sessionError", () => {});
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as import("node:net").AddressInfo).port;
    try {
      fault.set({ syscall: "recv", action: "short", bytes: 3, repeat: -1 });
      const client = http2.connect(`https://127.0.0.1:${port}`, { ca: certs.cert });
      client.on("error", () => {});
      try {
        const req = client.request({ ":path": "/" });
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        await Promise.all([once(req, "response"), once(req, "end")]);
        expect(Buffer.concat(chunks).equals(body)).toBe(true);
      } finally {
        fault.clear();
        client.close();
      }
    } finally {
      server.close();
    }
  });

  // Hive-pool user-poison, so only ASAN observes the freed-slot read.
  test.skipIf(!isASAN)(
    "send → backpressure then session.destroy() inside the drained write callback does not UAF",
    async () => {
      // Runs in a subprocess: the failure mode is an ASAN abort inside
      // on_native_writable, not an exception the test runner can catch.
      await using proc = Bun.spawn({
        cmd: [bunExe(), path.join(import.meta.dir, "node-http2-writable-destroy-fixture.ts")],
        env: { ...bunEnv, ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0"].filter(Boolean).join(":") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("AddressSanitizer");
      expect(stdout.trim()).toBe("ok");
      expect(exitCode).toBe(0);
    },
  );
});

// The session gives such a transport up, and the socket layer closes it. Before that close the session
// has to get what the peer sent, and the close has to reach it as the close of any socket does.
describe.skipIf(skip)("node:http2 after a send() that the kernel rejects", () => {
  // :method GET, :scheme http and :path / from the static table, then a literal :authority.
  const requestBlock = Buffer.concat([Buffer.from([0x82, 0x86, 0x84, 0x01, 0x09]), Buffer.from("localhost")]);
  const requestFrame = (id: number) => new http2utils.HeadersFrame(id, requestBlock, 0, true, true).data;
  const requests = Buffer.concat([
    http2utils.kClientMagic,
    new http2utils.SettingsFrame().data,
    requestFrame(1),
    requestFrame(3),
  ]);

  // A server whose every send fails from the moment `peer` runs, and a raw peer that stays connected.
  async function serve(
    connect: net.NetConnectOpts,
    peer: (socket: net.Socket, session: http2.ServerHttp2Session) => void,
  ) {
    const events: string[] = [];
    const server = http2.createServer();
    server.on("sessionError", err => events.push(`sessionError:${(err as NodeJS.ErrnoException).code}`));
    const accepted = Promise.withResolvers<number>();
    server.on("connection", socket => accepted.resolve((socket as any)._handle.fd));
    const sessionOpened = Promise.withResolvers<http2.ServerHttp2Session>();
    const sessionClosed = Promise.withResolvers<void>();
    server.on("session", session => {
      session.on("goaway", code => events.push(`goaway:${code}`));
      session.on("close", () => {
        events.push("session-close");
        sessionClosed.resolve();
      });
      sessionOpened.resolve(session);
    });
    server.on("stream", stream => {
      events.push(`stream:${stream.id}`);
      stream.on("error", err => events.push(`error:${(err as NodeJS.ErrnoException).code}`));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const socket = net.connect({ ...connect, port: (server.address() as net.AddressInfo).port, host: "127.0.0.1" });
    socket.on("error", () => {});
    try {
      const [fd, session] = await Promise.all([accepted.promise, sessionOpened.promise]);
      // The server's SETTINGS have left, so the rule fails what the server sends from here on.
      await once(socket, "data");
      fault.set({ syscall: "send", action: "errno", errno: "ECONNRESET", repeat: -1, fd });
      peer(socket, session);
      await sessionClosed.promise;
    } finally {
      fault.clear();
      socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
    return events;
  }

  test("reads what a peer that stays connected sent before", async () => {
    const events = await serve({}, (socket, session) => {
      // The server writes in the turn in which the peer writes, so its send fails before the loop reads.
      socket.write(Buffer.concat([requests, new http2utils.GoAwayFrame(0, 0).data]));
      session.ping(() => {});
    });
    expect(events).toEqual(["stream:1", "stream:3", "goaway:0", "session-close"]);
  });

  test("closes without the FIN of a peer that stays connected, once it has read what was queued", async () => {
    // This peer does not answer the server's FIN with its own, and it sends no GOAWAY.
    const events = await serve({ allowHalfOpen: true }, (socket, session) => {
      socket.write(requests);
      session.ping(() => {});
    });
    expect(events).toEqual(["stream:1", "stream:3", "session-close"]);
  });

  // A frame that the program submits in the turn of the rejected send corks and flushes again. That flush must
  // not release the deferred tick with the cork: the peer sends nothing, so no read ends this session either.
  test.each([
    ["session.close()", (client: http2.ClientHttp2Session) => client.close()],
    ["session.settings()", (client: http2.ClientHttp2Session) => client.settings({ enablePush: false })],
    [
      "a second session.request()",
      (client: http2.ClientHttp2Session) => {
        const second = client.request({ ":path": "/second" });
        second.on("error", () => {});
        second.end();
      },
    ],
  ])("ends the writes when %s flushes before the deferred tick", async (_name, flushAgain) => {
    const settingsAcked = Promise.withResolvers<void>();
    const peer = net.createServer(socket => {
      socket.on("error", () => {});
      let received = Buffer.alloc(0);
      socket.on("data", chunk => {
        received = Buffer.concat([received, chunk]);
        // After the preface: a SETTINGS frame with the ACK flag means that the client's write path is idle.
        for (let at = 24; at + 9 <= received.length; at += 9 + received.readUIntBE(at, 3)) {
          if (received[at + 3] === 4 && received[at + 4] & 1) settingsAcked.resolve();
        }
      });
      socket.write(new http2utils.SettingsFrame().data);
    });
    peer.listen(0, "127.0.0.1");
    await once(peer, "listening");
    const events: string[] = [];
    const client = http2.connect(`http://127.0.0.1:${(peer.address() as net.AddressInfo).port}`);
    client.on("error", err => events.push(`session-error:${(err as NodeJS.ErrnoException).code}`));
    const sessionClosed = Promise.withResolvers<void>();
    client.on("close", () => {
      events.push("session-close");
      sessionClosed.resolve();
    });
    try {
      await settingsAcked.promise;
      const fd = (client.socket as any)._handle.fd;
      fault.set({ syscall: "send", action: "errno", errno: "ECONNRESET", repeat: -1, fd });
      const req = client.request({ ":path": "/" });
      req.on("error", err => events.push(`stream-error:${(err as NodeJS.ErrnoException).code}`));
      req.on("close", () => events.push(`stream-close:${req.rstCode}`));
      req.end();
      flushAgain(client);
      await sessionClosed.promise;
    } finally {
      fault.clear();
      client.destroy();
      await new Promise(resolve => peer.close(resolve));
    }
    expect(events).toEqual(["stream-close:8", "session-close"]);
  });
});

describe.skipIf(skip)("node:http2 seeded short-I/O fuzz", () => {
  const seed = Number(process.env.BUN_SOCKET_FUZZ_SEED ?? 0x1f2e) >>> 0 || 1;
  function makePrng(s: number) {
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 0x1_0000_0000;
    };
  }

  test("randomized short recv/send still deliver intact body", async () => {
    const rand = makePrng(seed);
    const body = Buffer.alloc(2048, "F");
    using server = await makeServer(stream => {
      stream.respond({ ":status": 200 });
      stream.end(body);
    });
    for (let i = 0; i < 6; i++) {
      const sc: "recv" | "send" = rand() < 0.5 ? "recv" : "send";
      const bytes = 1 + Math.floor(rand() * 16);
      fault.set({ syscall: sc, action: "short", bytes, repeat: -1 });
      const client = http2.connect(server.url);
      client.on("error", () => {});
      try {
        const req = client.request({ ":path": "/" });
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        await Promise.all([once(req, "response"), once(req, "end")]);
        expect(Buffer.concat(chunks).equals(body)).toBe(true);
      } finally {
        fault.clear();
        client.close();
      }
    }
  });
});
