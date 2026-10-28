/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * The native handle of a zlib stream takes only buffers. So Node.js sets
 * `decodeStrings` back to true, as it does for `encoding` and `objectMode`
 * (nodejs/node#66359, v26.11.0):
 * https://github.com/nodejs/node/blob/v26.12.1/lib/zlib.js#L277-L284
 */
import assert from "node:assert";
import { once } from "node:events";
import type { Transform, TransformOptions } from "node:stream";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import zlib from "node:zlib";

// @types/node declares no stream options for the zlib streams.
type Options = zlib.ZlibOptions &
  zlib.BrotliOptions &
  zlib.ZstdOptions &
  Pick<TransformOptions, "decodeStrings" | "defaultEncoding">;
type Create = (options: Options) => Transform;
type Callback = (input: string, options: Options, callback: (error: Error | null, result: Buffer) => void) => void;

const codecs: [name: string, create: Create, createInverse: Create, compress: Callback, decompress: Callback][] = [
  ["gzip", zlib.createGzip, zlib.createGunzip, zlib.gzip, zlib.gunzip],
  ["deflate", zlib.createDeflate, zlib.createInflate, zlib.deflate, zlib.inflate],
  ["deflateRaw", zlib.createDeflateRaw, zlib.createInflateRaw, zlib.deflateRaw, zlib.inflateRaw],
  ["brotli", zlib.createBrotliCompress, zlib.createBrotliDecompress, zlib.brotliCompress, zlib.brotliDecompress],
  ["zstd", zlib.createZstdCompress, zlib.createZstdDecompress, zlib.zstdCompress, zlib.zstdDecompress],
];

async function output(stream: Transform, write: (stream: Transform) => void) {
  const chunks: Buffer[] = [];
  stream.on("data", chunk => chunks.push(chunk));
  const ended = once(stream, "end");
  write(stream);
  await ended;
  return Buffer.concat(chunks);
}

describe("decodeStrings: false", () => {
  for (const [name, create, createInverse, compress, decompress] of codecs) {
    test(`${name}: the streams decode each string with its encoding`, async () => {
      const compressed = await output(create({ decodeStrings: false, defaultEncoding: "hex" }), stream => {
        // No encoding: the stream uses defaultEncoding.
        stream.write("68656c6c6f");
        stream.end(" wörld", "utf8");
      });
      const decompressed = await output(createInverse({ decodeStrings: false }), stream => {
        stream.end(compressed.toString("base64"), "base64");
      });
      assert.strictEqual(decompressed.toString(), "hello wörld");
    });

    test(`${name}: the callback functions decode a string`, async () => {
      const compressed = await promisify(compress)("hello wörld", { decodeStrings: false });
      const options: Options = { decodeStrings: false, defaultEncoding: "base64" };
      const decompressed = await promisify(decompress)(compressed.toString("base64"), options);
      assert.strictEqual(decompressed.toString(), "hello wörld");
    });
  }

  test("the options object of the caller is not changed", async () => {
    const options: Options = Object.freeze({ decodeStrings: false });
    const compressed = await output(zlib.createGzip(options), stream => stream.end("hello wörld"));
    assert.strictEqual(zlib.gunzipSync(compressed).toString(), "hello wörld");
    assert.deepStrictEqual(options, { decodeStrings: false });
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExeAtLeast } = await import("harness");
  // Before v26.11.0 the string reaches the native handle, and that aborts the process.
  const node = nodeExeAtLeast("26.11.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--v8-pool-size=1", fileURLToPath(import.meta.url)],
        env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
