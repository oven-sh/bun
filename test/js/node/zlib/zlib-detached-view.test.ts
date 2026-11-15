/**
 * node:zlib with a chunk whose ArrayBuffer was transferred.
 *
 * Node's native write takes the bytes of the chunk, and such a view has none:
 * https://github.com/nodejs/node/blob/v26.12.1/src/node_zlib.cc#L556-L571
 * So a stream writes it as an empty chunk. The functions that take a callback write their input to a stream
 * of the same kind, and they do not wrap a Uint8Array first:
 * https://github.com/nodejs/node/blob/v26.12.1/lib/zlib.js#L129-L145
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values come from (Node.js v26.3.0
 * and v26.12.1). It cannot import from "harness" for the same reason.
 */
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { describe, test } from "node:test";
import { promisify } from "node:util";
import zlib from "node:zlib";

type Library = Record<string, (...args: any[]) => any>;
const library = zlib as unknown as Library;

function detachedBuffer() {
  const chunk = Buffer.from(new ArrayBuffer(8));
  chunk.buffer.transfer();
  return chunk;
}

// Writes the chunks, ends the stream, and gives what each write() returned and the whole output.
async function run(stream: zlib.Gzip, chunks: (string | Buffer)[]) {
  const output: Buffer[] = [];
  stream.on("data", chunk => output.push(chunk));
  const ended = once(stream, "end");
  const writes = chunks.map(chunk => stream.write(chunk));
  stream.end();
  await ended;
  return { writes, output: Buffer.concat(output) };
}

describe("a zlib stream writes a detached Buffer as an empty chunk", () => {
  for (const [create, decompressSync] of [
    ["createDeflate", "inflateSync"],
    ["createGzip", "gunzipSync"],
    ["createDeflateRaw", "inflateRawSync"],
    ["createBrotliCompress", "brotliDecompressSync"],
    ["createZstdCompress", "zstdDecompressSync"],
  ]) {
    test(`${create} compresses the chunks around it`, async () => {
      const empty = await run(library[create](), [Buffer.alloc(0)]);
      assert.deepStrictEqual(await run(library[create](), [detachedBuffer()]), {
        writes: [true],
        output: empty.output,
      });

      const around = await run(library[create](), ["hello", detachedBuffer(), " world"]);
      assert.deepStrictEqual(
        { writes: around.writes, text: library[decompressSync](around.output).toString() },
        { writes: [true, true, true], text: "hello world" },
      );
    });
  }

  for (const [create, compressSync] of [
    ["createInflate", "deflateSync"],
    ["createGunzip", "gzipSync"],
    ["createInflateRaw", "deflateRawSync"],
    ["createUnzip", "gzipSync"],
    ["createBrotliDecompress", "brotliCompressSync"],
    ["createZstdDecompress", "zstdCompressSync"],
  ]) {
    test(`${create} decompresses the input around it`, async () => {
      const compressed: Buffer = library[compressSync]("hello world");
      const halves = [compressed.subarray(0, compressed.length >> 1), compressed.subarray(compressed.length >> 1)];
      for (const chunks of [
        [detachedBuffer(), ...halves],
        [halves[0], detachedBuffer(), halves[1]],
      ]) {
        const { writes, output } = await run(library[create](), chunks);
        assert.deepStrictEqual(
          { writes, text: output.toString() },
          { writes: [true, true, true], text: "hello world" },
        );
      }
    });
  }
});

describe("the zlib functions that take a callback", () => {
  for (const name of [
    "gzip",
    "deflate",
    "deflateRaw",
    "brotliCompress",
    "zstdCompress",
    "gunzip",
    "inflate",
    "inflateRaw",
    "unzip",
    "brotliDecompress",
    "zstdDecompress",
  ]) {
    test(`${name}() takes a detached Buffer as an empty one`, async () => {
      const outcome = (error: NodeJS.ErrnoException | null, result?: Buffer) =>
        error ? { code: error.code } : { result };
      const withCallback = (input: Buffer) => {
        const { promise, resolve } = Promise.withResolvers<object>();
        library[name](input, (error: NodeJS.ErrnoException | null, result: Buffer) => resolve(outcome(error, result)));
        return promise;
      };
      const promisified = (input: Buffer) =>
        promisify(library[name])(input).then(
          (result: Buffer) => outcome(null, result),
          (error: NodeJS.ErrnoException) => outcome(error),
        );

      // The output of a compressor, or the error of a decompressor whose input ends too soon.
      const empty = await withCallback(Buffer.alloc(0));
      assert.deepStrictEqual(
        [await withCallback(detachedBuffer()), await promisified(detachedBuffer())],
        [empty, empty],
      );
    });
  }

  test("they still read a Uint8Array, and throw for a detached view that is no Buffer", async () => {
    const compressed = await promisify(zlib.gzip)(new TextEncoder().encode("hello world"));
    assert.strictEqual(zlib.gunzipSync(compressed).toString(), "hello world");

    for (const view of [new Uint8Array(8), new DataView(new ArrayBuffer(16), 4, 8), new Float64Array(4)]) {
      (view.buffer as ArrayBuffer).transfer();
      assert.throws(() => zlib.gzip(view, () => {}), TypeError);
    }
  });
});

// node:zlib/iter gives each chunk to the same native write, and it does not make a Buffer of a Uint8Array first.
test("each node:zlib/iter transform reads the chunks around a detached one", () => {
  const script = `
    const { pull, bytes } = require("node:stream/iter");
    const iter = require("node:zlib/iter");
    const zlib = require("node:zlib");
    const kinds = { Uint8Array: buffer => new Uint8Array(buffer), Buffer: buffer => Buffer.from(buffer) };
    const detached = kind => {
      const buffer = new ArrayBuffer(8);
      const view = kinds[kind](buffer);
      buffer.transfer();
      return view;
    };
    const transforms = [
      ["Gzip", "gzipSync", "gunzipSync"],
      ["Deflate", "deflateSync", "inflateSync"],
      ["Brotli", "brotliCompressSync", "brotliDecompressSync"],
      ["Zstd", "zstdCompressSync", "zstdDecompressSync"],
    ];
    const message = error => error.name + ": " + error.message;
    (async () => {
      const results = {};
      for (const kind of Object.keys(kinds)) {
        for (const [name, compressSync, decompressSync] of transforms) {
          const text = async function* () {
            yield [Buffer.from("hello")];
            yield [detached(kind), Buffer.from(" world")];
          };
          results["compress" + name + " " + kind] = await bytes(pull(text(), iter["compress" + name]())).then(
            output => zlib[decompressSync](output).toString(),
            message,
          );
          const compressed = zlib[compressSync]("hello world");
          const halves = async function* () {
            yield [compressed.subarray(0, 5), detached(kind)];
            yield [compressed.subarray(5)];
          };
          results["decompress" + name + " " + kind] = await bytes(pull(halves(), iter["decompress" + name]())).then(
            output => Buffer.from(output).toString(),
            message,
          );
        }
      }
      console.log(JSON.stringify(results));
    })();
  `;
  const { stdout, stderr, status } = spawnSync(process.execPath, ["--experimental-stream-iter", "-e", script], {
    encoding: "utf8",
  });
  const expected: Record<string, string> = {};
  for (const kind of ["Uint8Array", "Buffer"]) {
    for (const name of ["Gzip", "Deflate", "Brotli", "Zstd"]) {
      expected[`compress${name} ${kind}`] = "hello world";
      expected[`decompress${name} ${kind}`] = "hello world";
    }
  }
  // node:stream/iter prints an ExperimentalWarning on stderr.
  assert.deepStrictEqual(stdout ? JSON.parse(stdout) : stderr, expected);
  assert.strictEqual(status, 0);
});
