import { serve } from "bun";
import { describe, expect, it } from "bun:test";
import { bunRun, isASAN, isDebug, isLinux, tls } from "harness";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";

// The server reads an HTTP/1 request body from the socket only while the body's reader waits for
// bytes. serve.test.ts ("request body backpressure") covers bodies that nothing reads yet.
describe("request body backpressure for a body that a reader consumes", () => {
  // Raw-socket PUT whose body the test sends piece by piece. `reply` is
  // everything the server sent by the time the connection closed.
  async function openUpload(port: number, total: number, connection = "close") {
    const sock = net.connect(port, "127.0.0.1");
    await once(sock, "connect");
    sock.on("error", () => {});
    let received = "";
    sock.on("data", d => (received += d.toString("latin1")));
    const reply = new Promise<string>(resolve => sock.once("close", () => resolve(received)));
    const send = (bytes: string | Uint8Array) =>
      new Promise<void>((resolve, reject) => sock.write(bytes, err => (err ? reject(err) : resolve())));
    await send(`PUT /up HTTP/1.1\r\nHost: x\r\nContent-Length: ${total}\r\nConnection: ${connection}\r\n\r\n`);
    return { sock, send, reply, received: () => received };
  }

  // Lets the server's side of the loop take what the client just wrote. The
  // tests below hold whether or not it did: this only picks the interleaving.
  async function turns() {
    for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
  }

  it.each(["keeps up", "is away when the end arrives", "starts after the end arrived"] as const)(
    "closes the body stream after its last chunk without another read() when the reader %s",
    async pacing => {
      const TOTAL = 768 * 1024;
      const body = Buffer.alloc(TOTAL, 4);
      const firstRead = Promise.withResolvers<void>();
      const uploaded = Promise.withResolvers<void>();

      using server = serve({
        port: 0,
        idleTimeout: 0,
        async fetch(req) {
          const stream = req.body!;
          if (pacing === "starts after the end arrived") await uploaded.promise;
          const reader = stream.getReader();
          let received = 0;
          while (received < TOTAL) {
            const { done, value } = await reader.read();
            if (done) break;
            const isFirst = received === 0;
            received += value.length;
            if (isFirst) {
              firstRead.resolve();
              if (pacing === "is away when the end arrives") await uploaded.promise;
            }
          }
          // Every byte is in: the stream has to close with no read() to ask for it.
          await reader.closed;
          return new Response(String(received));
        },
      });

      const upload = await openUpload(server.port!, TOTAL);
      try {
        await upload.send(body.subarray(0, 256 * 1024));
        if (pacing !== "starts after the end arrived") await firstRead.promise;
        await upload.send(body.subarray(256 * 1024));
        await turns();
        uploaded.resolve();
        expect(await upload.reply).toEndWith(`\r\n\r\n${TOTAL}`);
      } finally {
        upload.sock.destroy();
      }
    },
  );

  it("hands the rest of the body to a second reader after the first one released it mid-body", async () => {
    const TOTAL = 4 * 1024 * 1024;
    const body = Buffer.alloc(TOTAL);
    for (let i = 0; i < TOTAL; i += 4) body.writeUInt32LE(i, i);
    const firstRead = Promise.withResolvers<void>();
    const restSent = Promise.withResolvers<void>();

    using server = serve({
      port: 0,
      idleTimeout: 0,
      maxRequestBodySize: TOTAL + 1,
      async fetch(req) {
        const stream = req.body!;
        const chunks: Uint8Array[] = [];
        const first = stream.getReader();
        chunks.push((await first.read()).value!);
        first.releaseLock();
        firstRead.resolve();
        await restSent.promise;
        const second = stream.getReader();
        while (true) {
          const { done, value } = await second.read();
          if (done) break;
          chunks.push(value);
        }
        return new Response(Buffer.concat(chunks).equals(body) ? "intact" : "corrupt");
      },
    });

    const upload = await openUpload(server.port!, TOTAL);
    try {
      await upload.send(body.subarray(0, 256 * 1024));
      await firstRead.promise;
      const rest = upload.send(body.subarray(256 * 1024));
      await turns();
      restSent.resolve();
      await rest;
      expect(await upload.reply).toEndWith("\r\n\r\nintact");
    } finally {
      upload.sock.destroy();
    }
  });

  it("serves the next request on the connection after the handler cancels a body it was reading", async () => {
    const TOTAL = 8 * 1024 * 1024;
    const body = Buffer.alloc(TOTAL, 6);
    const firstRead = Promise.withResolvers<void>();
    const restSent = Promise.withResolvers<void>();

    using server = serve({
      port: 0,
      idleTimeout: 0,
      maxRequestBodySize: TOTAL + 1,
      async fetch(req) {
        if (req.method === "GET") return new Response("next");
        const reader = req.body!.getReader();
        await reader.read();
        firstRead.resolve();
        await restSent.promise;
        await reader.cancel();
        return new Response("cancelled");
      },
    });

    const upload = await openUpload(server.port!, TOTAL, "keep-alive");
    try {
      await upload.send(body.subarray(0, 256 * 1024));
      await firstRead.promise;
      const rest = upload.send(body.subarray(256 * 1024));
      await turns();
      restSent.resolve();
      // The server takes the rest of the cancelled body off the socket, then the next request.
      await rest;
      await upload.send("GET /next HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      const reply = await upload.reply;
      expect(reply).toContain("\r\n\r\ncancelled");
      expect(reply).toEndWith("\r\n\r\nnext");
    } finally {
      upload.sock.destroy();
    }
  });

  it("rejects with AbortError when the handler reads on after the client ended the upload mid-body", async () => {
    const TOTAL = 4 * 1024 * 1024;
    const sent = Buffer.alloc(1024 * 1024, 8);
    const firstRead = Promise.withResolvers<void>();
    const clientEnded = Promise.withResolvers<void>();
    const outcome = Promise.withResolvers<string>();

    using server = serve({
      port: 0,
      idleTimeout: 0,
      maxRequestBodySize: TOTAL + 1,
      async fetch(req) {
        const reader = req.body!.getReader();
        await reader.read();
        firstRead.resolve();
        await clientEnded.promise;
        try {
          while (!(await reader.read()).done);
          outcome.resolve("done");
        } catch (error) {
          outcome.resolve((error as Error).name);
        }
        return new Response("unreachable by the client");
      },
    });

    const upload = await openUpload(server.port!, TOTAL);
    try {
      await upload.send(sent.subarray(0, 256 * 1024));
      await firstRead.promise;
      // A FIN after 1 MiB of the 4 MiB the request promised.
      upload.sock.end(sent.subarray(256 * 1024));
      await turns();
      clientEnded.resolve();
      expect(await outcome.promise).toBe("AbortError");
    } finally {
      upload.sock.destroy();
    }
  });

  // uWS checks its timeouts every 4 seconds, so the handler stays away from the reader for longer than that.
  // The server used to read 900 KiB ahead in full, and to pause 4 MiB at 1 MiB and then time the connection out.
  it.concurrent.each([
    ["900 KiB", 900 * 1024],
    ["4 MiB", 4 * 1024 * 1024],
  ])(
    "does not idle out an upload of %s while the handler is away from the reader",
    async (_, TOTAL) => {
      const body = Buffer.alloc(TOTAL, 1);
      const firstRead = Promise.withResolvers<void>();

      using server = serve({
        port: 0,
        idleTimeout: 1,
        maxRequestBodySize: TOTAL + 1,
        async fetch(req) {
          const reader = req.body!.getReader();
          let received = (await reader.read()).value!.length;
          firstRead.resolve();
          await Bun.sleep(5000);
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.length;
          }
          return new Response(String(received));
        },
      });

      const upload = await openUpload(server.port!, TOTAL);
      try {
        await upload.send(body.subarray(0, 100 * 1024));
        await firstRead.promise;
        upload.sock.write(body.subarray(100 * 1024));
        expect(await upload.reply).toEndWith(`\r\n\r\n${TOTAL}`);
      } finally {
        upload.sock.destroy();
      }
    },
    20_000,
  );

  // The fixture's handler takes one chunk of a 32 MiB body and stays away while the client sends
  // until nothing more is accepted. `held` is the native buffer of the body stream then.
  it("reads nothing ahead of a reader that is away", async () => {
    const result = await bunRun(join(import.meta.dirname, "serve-request-body-backpressure-fixture.ts"), {
      TLS_CERT: tls.cert,
      TLS_KEY: tls.key,
    });
    expect(result).toSpawn();
    const { results } = JSON.parse(result.stdout);
    const received = 32 * 1024 * 1024;
    expect(results).toEqual([
      { via: "getReader()", held: expect.any(Number), readAhead: false, received, intact: true },
      { via: "getReader() over TLS", held: expect.any(Number), readAhead: false, received, intact: true },
      // node:stream reads ahead by itself: one socket read at most waits beyond its buffer.
      { via: "Readable.fromWeb()", held: expect.any(Number), received, intact: true },
    ]);
    // The server used to read on until the stream held 1 MiB.
    for (const { held } of results) expect(held).toBeLessThan(1024 * 1024);
  }, 30_000);

  // Allocator and sanitizer overhead hide the per-upload difference in debug and ASAN builds, and
  // the test above covers the path there.
  it.skipIf(isASAN || isDebug || !isLinux)(
    "holds less than 1 MiB for each upload whose sink is stalled",
    async () => {
      const result = await bunRun(join(import.meta.dirname, "serve-request-body-backpressure-fixture.ts"), {
        MODE: "rss",
        UPLOADS: "64",
      });
      expect(result).toSpawn();
      // 2150 to 2230 KiB for each upload before, 340 to 530 KiB now.
      expect(JSON.parse(result.stdout).rssPerUploadKiB).toBeLessThan(1024);
    },
    30_000,
  );
});
