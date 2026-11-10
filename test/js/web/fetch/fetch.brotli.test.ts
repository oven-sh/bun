import { expect, test } from "bun:test";
import { once } from "node:events";
import { createBrotliCompress } from "node:zlib";

import brotliFile from "./fetch.brotli.test.ts.br" with { type: "file" };
import gzipFile from "./fetch.brotli.test.ts.gzip" with { type: "file" };

test("fetch brotli response works", async () => {
  const brotli = await Bun.file(brotliFile).arrayBuffer();
  const gzip = await Bun.file(gzipFile).arrayBuffer();

  using server = Bun.serve({
    port: 0,
    fetch(req) {
      if (req.headers.get("Accept-Encoding") === "br") {
        return new Response(brotli, {
          headers: {
            "Content-Encoding": "br",
          },
        });
      }

      if (req.headers.get("Accept-Encoding") === "gzip") {
        return new Response(gzip, {
          headers: {
            "Content-Encoding": "gzip",
          },
        });
      }

      return new Response("bad!", {
        status: 400,
      });
    },
  });
  const [firstText, secondText, { headers }] = await Promise.all([
    fetch(`${server.url}/logo.svg`, {
      headers: {
        "Accept-Encoding": "br",
      },
    }).then(res => res.text()),
    fetch(`${server.url}/logo.svg`, {
      headers: {
        "Accept-Encoding": "gzip",
      },
    }).then(res => res.text()),
    fetch(`${server.url}/logo.svg`, {
      headers: {
        "Accept-Encoding": "br",
      },
      decompress: false,
    }),
  ]);

  expect(firstText).toBe(secondText);
  expect(headers.get("Content-Encoding")).toBe("br");
});

// https://github.com/oven-sh/bun/issues/41439
// A flushed brotli chunk that decodes to more than 4096 bytes must reach the
// reader in full. The decoder used to hand over 4096 bytes and keep the rest
// until the next compressed chunk arrived.
test("fetch brotli streaming body delivers the whole flushed chunk at once", async () => {
  const firstLine = Buffer.alloc(8000, "x").toString() + "\n";
  const secondLine = "done\n";

  // Compress the two lines as one brotli stream, with a flush after the first
  // line, so the server can send each compressed part on its own.
  const compressor = createBrotliCompress();
  const compressed: Buffer[] = [];
  compressor.on("data", chunk => compressed.push(chunk));
  await new Promise<void>(resolve => {
    compressor.write(firstLine);
    compressor.flush(resolve);
  });
  const firstPart = Buffer.concat(compressed.splice(0));
  compressor.end(secondLine);
  await once(compressor, "end");
  const restPart = Buffer.concat(compressed.splice(0));
  expect(firstPart.byteLength).toBeGreaterThan(0);
  expect(restPart.byteLength).toBeGreaterThan(0);

  const { promise: sendRest, resolve: releaseRest } = Promise.withResolvers<void>();
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(firstPart);
            await sendRest;
            controller.enqueue(restPart);
            controller.close();
          },
        }),
        { headers: { "Content-Encoding": "br", "Content-Type": "application/x-ndjson" } },
      );
    },
  });

  const response = await fetch(server.url, { headers: { "Accept-Encoding": "br" } });
  const reader = response.body!.getReader();

  const first = await reader.read();
  expect(first.done).toBe(false);
  expect(first.value!.byteLength).toBe(firstLine.length);
  expect(Buffer.from(first.value!).toString()).toBe(firstLine);

  releaseRest();
  let rest = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += Buffer.from(value).toString();
  }
  expect(rest).toBe(secondLine);
});
