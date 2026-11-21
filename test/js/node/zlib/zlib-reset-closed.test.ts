/**
 * reset() on a node:zlib stream that is closed threw the engine's TypeError
 * for a null handle. Node checks the handle with an assert that is always on,
 * so it throws ERR_INTERNAL_ASSERTION "zlib binding closed":
 * https://github.com/nodejs/node/blob/v26.12.1/lib/zlib.js#L323-L326
 * https://github.com/nodejs/node/blob/v26.12.1/lib/internal/assert.js#L8-L13
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test` (v26.12.1), which is where the expected values come from. It
 * cannot import from "harness" for the same reason.
 */
import assert from "node:assert";
import { once } from "node:events";
import { describe, test } from "node:test";
import zlib from "node:zlib";

const bindingClosed = {
  name: "Error",
  code: "ERR_INTERNAL_ASSERTION",
  message:
    "zlib binding closed\n" +
    "This is caused by either a bug in Node.js or incorrect usage of Node.js internals.\n" +
    "Please open an issue with this stack trace at https://github.com/nodejs/node/issues\n",
};

const kinds = [
  "Deflate",
  "Inflate",
  "Gzip",
  "Gunzip",
  "DeflateRaw",
  "InflateRaw",
  "Unzip",
  "BrotliCompress",
  "BrotliDecompress",
  "ZstdCompress",
  "ZstdDecompress",
] as const;

describe("reset() on a closed zlib stream throws ERR_INTERNAL_ASSERTION", () => {
  test("after destroy(), for each of the 11 kinds", () => {
    for (const kind of kinds) {
      // The 11 classes share one reset(). @types/node declares it for some of them only.
      const stream = zlib[`create${kind}`]() as zlib.Deflate;
      stream.destroy();
      assert.throws(() => stream.reset(), bindingClosed, kind);
    }
  });

  test("after close()", () => {
    const stream = zlib.createInflate();
    stream.close();
    assert.throws(() => stream.reset(), bindingClosed);
  });

  test("on the engine of a sync call with { info: true }, which is closed and not destroyed", () => {
    // @types/node does not describe the result of a call with { info: true }.
    const { engine } = zlib.deflateSync(Buffer.from("x"), { info: true }) as unknown as { engine: zlib.Deflate };
    assert.strictEqual(engine.destroyed, false);
    assert.throws(() => engine.reset(), bindingClosed);
  });

  test("after a stream ends and closes by itself", async () => {
    const stream = zlib.createDeflate();
    stream.resume();
    stream.end("abc");
    await once(stream, "close");
    assert.throws(() => stream.reset(), bindingClosed);
  });

  test("with a receiver that has no handle", () => {
    assert.throws(() => zlib.Deflate.prototype.reset.call({}), bindingClosed);
  });
});
