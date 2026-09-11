import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isASAN, isWindows } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import path from "node:path";

const skip = !fault.available() || isWindows;

// fault.clear() throws on a build without the hooks, and the real-reset cases below run there too.
afterEach(() => {
  if (fault.available()) fault.clear();
});

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

describe("node:http2 closes its transport after a send() the kernel rejects", () => {
  // That close runs the socket's JS close handlers, and they finish the teardown from
  // process.nextTick. It ran inside the deferred task queue. No microtask checkpoint follows that
  // queue, and the closed socket was the last handle: the process exited 0 with no 'close' on the
  // stream or on the session. That queue also runs under a read callback, when the JS the read
  // dispatched returns. The rest of the read then wrote through the detached transport, and the
  // session reported that write's error.
  //
  // Each fixture starts no timer, because a timer wakes the loop and hides the first bug. It
  // reports what it saw when the process exits on its own.
  const bothClosed = { streamClosed: true, sessionClosed: true };

  // No injection, so these run on every build and platform. One process holds both ends of the
  // connection. The peer resets and the client writes in the same turn, so the kernel has the
  // RST and the loop has not polled it. Node reports a clean close when a write sees the reset
  // and ECONNRESET when a read does: any other error is an artifact.
  describe.concurrent("a real reset that a client's send() sees first", () => {
    const fixture = (whenSettingsArrive: string) => `
      const http2 = require("node:http2");
      const seen = { streamClosed: false, sessionClosed: false, unexpectedErrors: [] };
      const onError = err => {
        if (err.code !== "ECONNRESET") seen.unexpectedErrors.push(err.code);
      };
      let peer;
      const listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          open(socket) {
            peer = socket;
            // One connection only: from here the two sockets are the only handles.
            listener.stop();
            socket.write(Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0])); // empty SETTINGS
          },
          data() {},
          error() {},
        },
      });
      const session = http2.connect("http://127.0.0.1:" + listener.port);
      session.on("error", onError);
      session.on("close", () => (seen.sessionClosed = true));
      function resetThenRequest() {
        peer.terminate(); // closes with an RST
        const req = session.request({ ":path": "/" });
        req.on("error", onError);
        req.on("close", () => (seen.streamClosed = true));
        req.resume();
        req.end();
      }
      session.on("remoteSettings", ${whenSettingsArrive});
      process.on("exit", () => console.log(JSON.stringify(seen)));
    `;

    test.each([
      // Nothing is left on the stack to run a checkpoint after the close: no event at all.
      ["from setImmediate", "() => setImmediate(resetThenRequest)"],
      // 'remoteSettings' is emitted from the read that parsed the frame: EBADF (EPIPE on Windows).
      ["inside a read callback", "resetThenRequest"],
    ])("request made %s", async (_, when) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture(when)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ ...bothClosed, unexpectedErrors: [] });
      expect(exitCode).toBe(0);
    });
  });

  // The fault rules are process-global, so the faulted side runs in a subprocess and its raw
  // peer lives here.
  describe.skipIf(skip)("an injected errno", () => {
    test("client: the failing send is the request's HEADERS inside the connect flush", async () => {
      const fixture = `
        const { socketFaultInjection: fault } = require("bun:internal-for-testing");
        const http2 = require("node:http2");
        const seen = { streamClosed: false, sessionClosed: false };
        // The connect flush sends the preface, then the queued request's HEADERS: fail the second send.
        fault.set({ syscall: "send", action: "errno", errno: "ECONNRESET", after: 1, repeat: -1 });
        const session = http2.connect("http://127.0.0.1:" + process.env.H2_PEER_PORT);
        session.on("error", () => {});
        session.on("close", () => (seen.sessionClosed = true));
        const req = session.request({ ":path": "/" });
        req.on("error", () => {});
        req.on("close", () => (seen.streamClosed = true));
        req.resume();
        req.end();
        process.on("exit", () => console.log(JSON.stringify(seen)));
      `;
      const accepted: net.Socket[] = [];
      const peer = net.createServer(socket => {
        accepted.push(socket);
        socket.on("error", () => {});
        // An empty SETTINGS: the client owes an ACK, so a send follows the preface in any case.
        socket.write(Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0]));
      });
      peer.listen(0, "127.0.0.1");
      await once(peer, "listening");
      try {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", fixture],
          env: { ...bunEnv, H2_PEER_PORT: String((peer.address() as net.AddressInfo).port) },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(bothClosed);
        expect(exitCode).toBe(0);
      } finally {
        for (const socket of accepted) socket.destroy();
        peer.close();
      }
    });

    test("server: the failing send is a response, after the listener closed", async () => {
      // A server that shuts down while a request is in flight. The stream has no 'error' listener:
      // a client that vanishes is routine for a server, and it has to close quietly. The response
      // is written from a read callback, and the deferred task queue ran under it: the rest of the
      // read wrote through the detached transport and the stream got that write's ERR_SOCKET_CLOSED.
      const fixture = `
        const { socketFaultInjection: fault } = require("bun:internal-for-testing");
        const fs = require("node:fs");
        const http2 = require("node:http2");
        const seen = { streamClosed: false, sessionClosed: false };
        const server = http2.createServer();
        server.on("session", session => session.on("close", () => (seen.sessionClosed = true)));
        server.on("stream", stream => {
          stream.on("close", () => (seen.streamClosed = true));
          // With the listener closed, the accepted socket is the last handle.
          server.close();
          // The response stays open, so only the transport can close the stream.
          stream.once("data", () => {
            fault.set({ syscall: "send", action: "errno", errno: "ECONNRESET", repeat: -1 });
            stream.respond({ ":status": 200 });
            stream.write("x");
          });
          fs.writeSync(1, "stream\\n");
        });
        process.on("exit", () => fs.writeSync(1, JSON.stringify(seen) + "\\n"));
        server.listen(0, "127.0.0.1", () => fs.writeSync(1, "port=" + server.address().port + "\\n"));
      `;
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", fixture], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      // A raw client: preface, SETTINGS, and the headers of one POST. Its body follows once the
      // server has the stream, so the response is written in a later turn than server.close().
      const frame = (type: number, flags: number, streamId: number, payload = Buffer.alloc(0)) => {
        const header = Buffer.alloc(9);
        header.writeUIntBE(payload.length, 0, 3);
        header[3] = type;
        header[4] = flags;
        header.writeUInt32BE(streamId, 5);
        return Buffer.concat([header, payload]);
      };
      // :method POST, :scheme http and :path / from the static table, then a literal :authority.
      const requestBlock = Buffer.concat([Buffer.from([0x83, 0x86, 0x84, 0x01, 0x09]), Buffer.from("localhost")]);
      let stdout = "";
      let client: net.Socket | undefined;
      let sentBody = false;
      try {
        for await (const chunk of proc.stdout) {
          stdout += Buffer.from(chunk).toString();
          const port = /port=(\d+)/.exec(stdout);
          if (port && !client) {
            client = net.connect(Number(port[1]), "127.0.0.1", () => {
              client!.write(
                Buffer.concat([
                  Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1"),
                  frame(4, 0, 0),
                  frame(1, 0x4, 1, requestBlock),
                ]),
              );
            });
            client.on("error", () => {});
          }
          if (!sentBody && stdout.includes("stream\n")) {
            sentBody = true;
            client!.write(frame(0, 0, 1, Buffer.from("body")));
          }
        }
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        const lines = stdout.trim().split("\n");
        expect(JSON.parse(lines[lines.length - 1])).toEqual(bothClosed);
        expect(exitCode).toBe(0);
      } finally {
        client?.destroy();
      }
    });
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
