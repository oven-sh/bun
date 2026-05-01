import { describe, expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "path";
import { Readable } from "stream";
describe("#09555", () => {
  test("fetch() Response body", async () => {
    const full = crypto.getRandomValues(new Uint8Array(1024 * 3));
    const sha = Bun.hash(full);
    using server = Bun.serve({
      port: 0,
      async fetch() {
        const chunks = [full.slice(0, 1024), full.slice(1024, 1024 * 2), full.slice(1024 * 2)];

        return new Response(
          new ReadableStream({
            async pull(controller) {
              if (chunks.length === 0) {
                controller.close();
                return;
              }
              controller.enqueue(chunks.shift());
              await Bun.sleep(100);
            },
          }),
        );
      },
    });

    let total = 0;
    const res = await fetch(server.url.href);
    const stream = Readable.fromWeb(res.body!);
    let chunks: any[] = [];
    for await (const chunk of stream) {
      total += chunk.length;
      chunks.push(chunk);
    }

    const out = Bun.hash(Buffer.concat(chunks));
    expect(out).toBe(sha);
    expect(total).toBe(1024 * 3);
  });

  test("Bun.serve() Request body streaming", async () => {
    const full = crypto.getRandomValues(new Uint8Array(1024 * 3));
    const sha = Bun.CryptoHasher.hash("sha256", full, "base64");
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const readable = Readable.fromWeb(req.body);
        let chunks = [];

        for await (const chunk of readable) {
          chunks.push(chunk);
        }

        const out = Bun.CryptoHasher.hash("sha256", Buffer.concat(chunks), "base64");
        console.log(out);
        return new Response(out);
      },
    });

    const { promise, resolve } = Promise.withResolvers();
    const chunks = [];
    await Bun.connect({
      hostname: server.url.hostname,
      port: server.url.port,

      socket: {
        async open(socket) {
          socket.write(
            "POST / HTTP/1.1\r\n" +
              "Connection: close\r\n" +
              "Content-Length: " +
              full.length +
              "\r\n" +
              "Host: " +
              server.url.hostname +
              "\r\n\r\n",
          );
          const chunks = [full.slice(0, 1024), full.slice(1024, 1024 * 2), full.slice(1024 * 2)];

          for (const chunk of chunks) {
            socket.write(chunk);
            await Bun.sleep(100);
          }
        },
        drain() {},
        data(socket, received) {
          chunks.push(received);
        },
        close() {
          resolve(Buffer.concat(chunks).toString());
        },
      },
    });
    const outHTTPResponse = (await promise).toString();
    const out = outHTTPResponse.split("\r\n\r\n")[1];
    expect(out).toEqual(sha);
  });

  test("Bun.serve() Request body buffered", async () => {
    const full = crypto.getRandomValues(new Uint8Array(1024 * 3));
    const sha = Bun.CryptoHasher.hash("sha256", full, "base64");
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const readable = Readable.fromWeb(req.body);
        let chunks = [];

        for await (const chunk of readable) {
          chunks.push(chunk);
        }

        const out = Bun.CryptoHasher.hash("sha256", Buffer.concat(chunks), "base64");
        return new Response(out);
      },
    });

    const outHTTPResponse = await fetch(server.url.href, {
      method: "POST",
      body: full,
    });
    const out = await outHTTPResponse.text();
    expect(out).toEqual(sha);
  });

  test("Bun.file() NativeReadable", async () => {
    const full = crypto.getRandomValues(new Uint8Array(1024 * 3));
    const sha = Bun.CryptoHasher.hash("sha256", full, "base64");
    const dir = tempDirWithFiles("09555", {
      "/file.blob": full,
    });
    await Bun.write(join(dir, "file.blob"), full);
    const web = Bun.file(join(dir, "file.blob")).stream();
    const stream = Readable.fromWeb(web);

    const chunks = [];
    let total = 0;
    for await (const chunk of stream) {
      chunks.push(chunk);
      total += chunk.length;
    }

    const out = Bun.CryptoHasher.hash("sha256", Buffer.concat(chunks), "base64");
    expect(out).toEqual(sha);
    expect(total).toBe(1024 * 3);
  });

  test("Readable.fromWeb consumes the ReadableStream", async () => {
    const bytes = new Blob([crypto.getRandomValues(new Uint8Array(1024 * 3)), new ArrayBuffer(1024 * 1024 * 10)]);
    const response = new Response(bytes);

    const web = response.body;
    expect(response.bodyUsed).toBe(false);
    const stream = Readable.fromWeb(web);
    expect(response.bodyUsed).toBe(true);
    expect(() => response.body?.getReader()).toThrow();
    const methods = ["arrayBuffer", "blob", "formData", "json", "text"];
    for (const method of methods) {
      expect(() => response[method]()).toThrow();
    }
  });
});
