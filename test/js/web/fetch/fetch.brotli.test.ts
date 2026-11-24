import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { brotliCompressSync, constants, createBrotliCompress } from "node:zlib";

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

describe("fetch takes the same window sizes as DecompressionStream", () => {
  function serve(windowBits: number, largeWindow: number) {
    const body = brotliCompressSync("hello hello hello", {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 5,
        [constants.BROTLI_PARAM_LARGE_WINDOW]: largeWindow,
        [constants.BROTLI_PARAM_LGWIN]: windowBits,
      },
    });
    return Bun.serve({ port: 0, fetch: () => new Response(body, { headers: { "Content-Encoding": "br" } }) });
  }
  const throughStream = (raw: Response) => raw.body!.pipeThrough(new DecompressionStream("brotli")).text();

  test.each([10, 24])("a window of %d bits", async windowBits => {
    using server = serve(windowBits, 0);
    expect(await (await fetch(server.url)).text()).toBe("hello hello hello");
    expect(await throughStream(await fetch(server.url, { decompress: false }))).toBe("hello hello hello");
  });

  test.each([10, 25])("no large window of %d bits", async windowBits => {
    using server = serve(windowBits, 1);
    const response = await fetch(server.url);
    await expect(response.text()).rejects.toMatchObject({ code: "BrotliDecompressionError" });
    await expect(throughStream(await fetch(server.url, { decompress: false }))).rejects.toMatchObject({
      name: "TypeError",
      code: "ERR__ERROR_FORMAT_WINDOW_BITS",
      message: "brotli decode failed",
      cause: { code: "ERR__ERROR_FORMAT_WINDOW_BITS", message: "_ERROR_FORMAT_WINDOW_BITS" },
    });
  });
});

test.each(["with the stream", "after the stream"])("fetch ignores bytes that follow the end, sent %s", async when => {
  const stream = brotliCompressSync("hello");
  const junk = Buffer.from("junk");
  const { promise: firstRead, resolve } = Promise.withResolvers<void>();
  using server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(
        async function* () {
          if (when === "with the stream") return yield Buffer.concat([stream, junk]);
          yield stream;
          await firstRead;
          yield junk;
        },
        { headers: { "Content-Encoding": "br" } },
      ),
  });
  let text = "";
  for await (const chunk of (await fetch(server.url)).body!) {
    text += Buffer.from(chunk);
    resolve();
  }
  expect(text).toBe("hello");
});
