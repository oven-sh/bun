import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isASAN, isWindows } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
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
        env: { ...bunEnv, ASAN_OPTIONS: "symbolize=0" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("AddressSanitizer");
      expect(stdout.trim()).toBe("ok");
      expect(exitCode).toBe(0);
    },
    30_000,
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
