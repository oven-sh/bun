import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import * as os from "node:os";

// zlib's z_stream.avail_in is a u32. node:zlib's processChunkSync passed
// `chunk.byteLength` (up to buffer.constants.MAX_LENGTH = 2^32) straight to
// the native writeSync() as in_len, where it saturated to 2^32 - 1. The JS
// loop still book-kept inDelta against the unclamped 2^32, so one input byte
// was silently skipped: gzipSync(Buffer.alloc(2^32)) round-tripped to
// 2^32 - 1 bytes with the tail sentinel gone, on a success return.

const MAX_LENGTH = 2 ** 32;
const skip = os.totalmem() < 14 * 1024 * 1024 * 1024;

test.skipIf(skip)(
  "node:zlib gzipSync round-trips a 2^32-byte chunk without dropping a byte",
  async () => {
    const script = `
      const zlib = require("node:zlib");
      let b;
      try {
        b = Buffer.alloc(${MAX_LENGTH});
      } catch {
        console.log(JSON.stringify("SKIP"));
        process.exit(0);
      }
      // Uint8Array [] indexing tops out below 2^32-1; use DataView for the final byte.
      const bv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      bv.setUint8(0, 0x41);
      bv.setUint8(${MAX_LENGTH - 2}, 0x59);
      bv.setUint8(${MAX_LENGTH - 1}, 0x5a);

      const result = {};
      for (const chunkSize of ["default", 64 * 1024 * 1024]) {
        const g = zlib.gzipSync(b, chunkSize === "default" ? undefined : { chunkSize });
        const r = zlib.gunzipSync(g);
        const rv = new DataView(r.buffer, r.byteOffset, r.byteLength);
        const at = i => (i < r.length ? rv.getUint8(i) : null);
        result[chunkSize] = {
          rtLen: r.length,
          first: at(0),
          penult: at(${MAX_LENGTH - 2}),
          last: at(${MAX_LENGTH - 1}),
        };
      }
      console.log(JSON.stringify(result));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1"].filter(Boolean).join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const out = JSON.parse(stdout.trim() || '"NO_OUTPUT"');
    if (out === "SKIP") return;

    expect(stderr).toBe("");
    // With the bug: default -> { rtLen: 4294967295, first: 65, penult: 90, last: null }.
    const want = { rtLen: MAX_LENGTH, first: 0x41, penult: 0x59, last: 0x5a };
    expect(out).toEqual({ default: want, [64 * 1024 * 1024]: want });
    expect(exitCode).toBe(0);
  },
  240_000,
);

test.skipIf(skip)(
  "node:zlib async gzip round-trips a 2^32-byte chunk without dropping a byte",
  async () => {
    const script = `
      const zlib = require("node:zlib");
      const { promisify } = require("node:util");
      let b;
      try {
        b = Buffer.alloc(${MAX_LENGTH});
      } catch {
        console.log(JSON.stringify("SKIP"));
        process.exit(0);
      }
      new DataView(b.buffer, b.byteOffset, b.byteLength).setUint8(${MAX_LENGTH - 1}, 0x5a);

      const g = await promisify(zlib.gzip)(b);
      b = null;
      Bun.gc(true);

      const r = await promisify(zlib.gunzip)(g);
      const rv = new DataView(r.buffer, r.byteOffset, r.byteLength);
      console.log(
        JSON.stringify({
          rtLen: r.length,
          last: ${MAX_LENGTH - 1} < r.length ? rv.getUint8(${MAX_LENGTH - 1}) : null,
        }),
      );
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1"].filter(Boolean).join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const out = JSON.parse(stdout.trim() || '"NO_OUTPUT"');
    if (out === "SKIP") return;

    expect(stderr).toBe("");
    expect(out).toEqual({ rtLen: MAX_LENGTH, last: 0x5a });
    expect(exitCode).toBe(0);
  },
  240_000,
);
