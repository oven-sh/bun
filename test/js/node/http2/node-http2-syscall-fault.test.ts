import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isASAN, isWindows } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import path from "node:path";

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
      const [headers] = (await once(req, "response")) as [http2.IncomingHttpHeaders];
      expect(headers[":status"]).toBe(200);
      const chunks: Buffer[] = [];
      req.on("data", c => chunks.push(c));
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
      stream.on("data", c => (received = Buffer.concat([received, c])));
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
      stream.on("data", c => chunks.push(c));
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
      req.on("data", c => chunks.push(c));
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
      const [headers] = (await once(req, "response")) as [http2.IncomingHttpHeaders];
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
    server.on("stream", stream => {
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
        req.on("data", c => chunks.push(c));
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
        req.on("data", c => chunks.push(c));
        await Promise.all([once(req, "response"), once(req, "end")]);
        expect(Buffer.concat(chunks).equals(body)).toBe(true);
      } finally {
        fault.clear();
        client.close();
      }
    }
  });
});

describe.skipIf(skip)("node:http2 transport write errors", () => {
  // A send() the kernel rejects is the only report that the peer is gone: the
  // transport closes before the read side is polled again. A client session and
  // its request have to report it, and the process must not exit before they do
  // when the socket is its only handle (the client below starts no timer).
  //
  // One peer reset gives a different send errno per platform: linux reports
  // ECONNRESET, darwin EPIPE. The read side reports ECONNRESET for it on every
  // platform, and that is the only side Node reports a reset from (it drops the
  // status of a failed write, see the note in node_http2.cc ClearOutgoing).
  // Injecting each errno pins the code bun reports on every platform.
  //
  // phase "request": the failing send is a later request() on an idle session.
  // phase "connect": it is inside the connect flush, which sends the preface
  // (the first send) and then the queued request's HEADERS (the second).
  const cases = [
    { errno: "EPIPE", phase: "request" },
    { errno: "ECONNRESET", phase: "request" },
    { errno: "ECONNRESET", phase: "connect" },
  ];
  test.each(cases)("send → $errno during the $phase flush is reported as ECONNRESET", async ({ errno, phase }) => {
    // The client runs in a subprocess: the fault rules are process-global, so
    // the raw peer below has to live in a process that is not faulted.
    const fixture = `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const http2 = require("node:http2");
      const state = { streamError: null, sessionError: null, rstCode: null };
      const failSends = after =>
        fault.set({ syscall: "send", action: "errno", errno: process.env.H2_FAULT_ERRNO, after, repeat: -1 });
      const session = http2.connect("http://127.0.0.1:" + process.env.H2_PEER_PORT);
      session.on("error", err => (state.sessionError = err.code));
      let req;
      function request() {
        req = session.request({ ":path": "/" });
        req.on("error", err => (state.streamError = err.code));
        req.on("close", () => (state.rstCode = req.rstCode));
        req.resume();
        req.end();
      }
      if (process.env.H2_FAULT_PHASE === "connect") {
        failSends(1);
        request();
      } else {
        session.on("remoteSettings", () => {
          failSends(0);
          request();
        });
      }
      process.on("exit", () => {
        const destroyed = { sessionDestroyed: session.destroyed, streamDestroyed: !!req && req.destroyed };
        console.log(JSON.stringify({ ...state, ...destroyed }));
      });
    `;
    const frame = (type: number, flags: number) => Buffer.from([0, 0, 0, type, flags, 0, 0, 0, 0]);
    const server = net.createServer(socket => {
      socket.on("error", () => {});
      socket.write(frame(4, 0)); // empty SETTINGS
      socket.once("data", () => socket.write(frame(4, 1))); // ACK the client's SETTINGS
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    try {
      const port = (server.address() as import("node:net").AddressInfo).port;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: { ...bunEnv, H2_PEER_PORT: String(port), H2_FAULT_ERRNO: errno, H2_FAULT_PHASE: phase },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout.trim())).toEqual({
        streamError: "ECONNRESET",
        sessionError: "ECONNRESET",
        rstCode: http2.constants.NGHTTP2_INTERNAL_ERROR,
        sessionDestroyed: true,
        streamDestroyed: true,
      });
      expect(exitCode).toBe(0);
    } finally {
      server.close();
    }
  });

  test("a server session whose response write fails closes quietly", async () => {
    // A client that vanishes is routine for a server, and it has nobody to report it to.
    // Node's server sessions close without an 'error', and an 'error' on a stream with no
    // listener would end the process. This server attaches no 'error' listener at all.
    const fixture = `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const http2 = require("node:http2");
      const events = [];
      const server = http2.createServer();
      server.on("session", session => {
        session.on("close", () => {
          events.push("session.close");
          server.close();
        });
      });
      server.on("stream", stream => {
        events.push("stream");
        stream.on("close", () => events.push("stream.close(rstCode=" + stream.rstCode + ")"));
        fault.set({ syscall: "send", action: "errno", errno: "ECONNRESET", repeat: -1 });
        stream.respond({ ":status": 200 });
        stream.end();
      });
      process.on("uncaughtException", err => {
        events.push("uncaught:" + err.code);
        console.log(JSON.stringify(events));
        process.exit(1);
      });
      process.on("exit", code => code === 0 && console.log(JSON.stringify(events)));
      server.listen(0, "127.0.0.1", () => console.log("port=" + server.address().port));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    // A raw client: preface, SETTINGS, and one GET with END_STREAM. It sends nothing more.
    const frame = (type: number, flags: number, streamId: number, payload = Buffer.alloc(0)) => {
      const header = Buffer.alloc(9);
      header.writeUIntBE(payload.length, 0, 3);
      header[3] = type;
      header[4] = flags;
      header.writeUInt32BE(streamId, 5);
      return Buffer.concat([header, payload]);
    };
    // :method GET, :scheme http and :path / from the static table, then a literal :authority.
    const requestBlock = Buffer.concat([Buffer.from([0x82, 0x86, 0x84, 0x01, 0x09]), Buffer.from("localhost")]);
    let stdout = "";
    let socket: net.Socket | undefined;
    for await (const chunk of proc.stdout) {
      stdout += Buffer.from(chunk).toString();
      const port = /port=(\d+)/.exec(stdout);
      if (port && !socket) {
        socket = net.connect(Number(port[1]), "127.0.0.1", () => {
          socket!.write(
            Buffer.concat([
              Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1"),
              frame(4, 0, 0),
              frame(1, 0x4 | 0x1, 1, requestBlock),
            ]),
          );
        });
        socket.on("error", () => {});
      }
    }
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    socket?.destroy();
    expect(stderr).toBe("");
    const lines = stdout.trim().split("\n");
    expect(JSON.parse(lines[lines.length - 1])).toEqual(["stream", "stream.close(rstCode=0)", "session.close"]);
    expect(exitCode).toBe(0);
  });
});
