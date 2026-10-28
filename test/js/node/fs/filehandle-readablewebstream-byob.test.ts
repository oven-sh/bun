/**
 * A BYOB read from FileHandle.prototype.readableWebStream() into a view that
 * does not start at byte 0 of its ArrayBuffer. The pull handler passed
 * `view.byteOffset` as the `offset` of FileHandle.read(), which is an index
 * into the view, so the read failed with ERR_OUT_OF_RANGE. Node passes 0 since
 * v26.10.0 (nodejs/node#58842):
 * https://github.com/nodejs/node/blob/v26.12.1/lib/internal/fs/promises.js#L370-L372
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values come from. It cannot
 * import from "harness" for the same reason, so it manages its own temporary
 * directory.
 */
import assert from "node:assert";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-byob-"));
const file = path.join(dir, "data.txt");
fs.writeFileSync(file, "ABCDEFGHIJ");
after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("FileHandle.readableWebStream() BYOB reads", () => {
  test("fill views at increasing offsets of one ArrayBuffer", async () => {
    const handle = await fsp.open(file);
    try {
      const reader = handle.readableWebStream().getReader({ mode: "byob" });

      // Each read transfers the buffer, so the next view goes over the returned one.
      let buffer = new ArrayBuffer(20);
      let offset = 4;
      const reads: { byteOffset: number; text: string }[] = [];
      while (true) {
        const { value, done } = await reader.read(new Uint8Array(buffer, offset, 3));
        buffer = value!.buffer;
        if (done) break;
        reads.push({ byteOffset: value!.byteOffset, text: Buffer.from(value!).toString() });
        offset += value!.byteLength;
      }

      assert.deepStrictEqual(reads, [
        { byteOffset: 4, text: "ABC" },
        { byteOffset: 7, text: "DEF" },
        { byteOffset: 10, text: "GHI" },
        { byteOffset: 13, text: "J" },
      ]);
      assert.strictEqual(Buffer.from(buffer).toString("latin1"), "\0\0\0\0ABCDEFGHIJ\0\0\0\0\0\0");
    } finally {
      await handle.close();
    }
  });

  test("fill a DataView at an offset", async () => {
    const handle = await fsp.open(file);
    try {
      const reader = handle.readableWebStream().getReader({ mode: "byob" });

      const { value, done } = await reader.read(new DataView(new ArrayBuffer(16), 8, 4));
      assert.deepStrictEqual(
        {
          done,
          type: value!.constructor.name,
          byteOffset: value!.byteOffset,
          byteLength: value!.byteLength,
          bytes: Buffer.from(value!.buffer).toString("latin1"),
        },
        { done: false, type: "DataView", byteOffset: 8, byteLength: 4, bytes: "\0\0\0\0\0\0\0\0ABCD\0\0\0\0" },
      );
      await reader.cancel();
    } finally {
      await handle.close();
    }
  });

  test("fill the rest of a view after a short read, with `min`", async () => {
    const handle = await fsp.open(file);
    try {
      const reader = handle.readableWebStream().getReader({ mode: "byob" });

      // The file has 10 bytes. The first pull fills 10 of the 12 that `min` asks for, so the stream pulls
      // again into the same view at offset 10, reads 0 bytes there, and ends.
      const { value, done } = await reader.read(new Uint8Array(16), { min: 12 });
      assert.deepStrictEqual(
        { done, byteOffset: value!.byteOffset, text: Buffer.from(value!).toString() },
        { done: true, byteOffset: 0, text: "ABCDEFGHIJ" },
      );
    } finally {
      await handle.close();
    }
  });
});
