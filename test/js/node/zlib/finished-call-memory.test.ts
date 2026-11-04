import { heapSize } from "bun:jsc";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import zlib from "node:zlib";

const input = createHash("shake256", { outputLength: 50_000 }).update("finished-call-memory").digest();

test.each(["deflate", "gzip", "brotliCompress", "zstdCompress"] as const)(
  "an engine that outlives %s keeps neither the input nor the output",
  async method => {
    const compress = promisify(zlib[method]) as unknown as (
      input: Buffer,
      options: object,
    ) => Promise<{ buffer: Buffer; engine: object }>;
    const options = {
      info: true,
      ...(method === "brotliCompress" && { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 2 } }),
    };
    for (let i = 0; i < 10; i++) await compress(Buffer.from(input), options);

    const engines: object[] = [];
    Bun.gc(true);
    const before = heapSize();
    for (let i = 0; i < 100; i++) engines.push((await compress(Buffer.from(input), options)).engine);
    Bun.gc(true);
    const bytesPerEngine = (heapSize() - before) / engines.length;

    expect(bytesPerEngine).toBeLessThan(16_384);
  },
);
