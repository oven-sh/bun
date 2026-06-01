// The native zlib/brotli/zstd handle caches a raw pointer into `_writeState`'s
// backing store at init() and writes two u32s through it on every async-write
// completion. Detaching that backing store while a write is in flight must not
// leave the native side writing through a stale pointer — the buffer is pinned
// (and kept in a GC-visited slot) for the handle's lifetime so transfer()
// becomes a copy and the stream still produces correct output.

import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("_writeState buffer lifetime", () => {
  // Run in a subprocess because an unpinned build corrupts stream bookkeeping
  // (or faults) rather than throwing.
  it.concurrent.each([
    ["Inflate", "deflateSync", "createInflate"],
    ["BrotliDecompress", "brotliCompressSync", "createBrotliDecompress"],
    ["ZstdDecompress", "zstdCompressSync", "createZstdDecompress"],
  ])("%s decompresses correctly when _writeState.buffer is transferred mid-write", async (_, compress, create) => {
    const script = `
      const z = require("zlib");
      const raw = Buffer.alloc(65536, 0x41);
      const d = z.${compress}(raw);
      const s = z.${create}({ chunkSize: 65536 });
      const out = [];
      s.on("error", e => { console.log("err:" + e.message); process.exit(1); });
      s.on("data", c => out.push(c));
      s.on("end", () => {
        const r = Buffer.concat(out);
        if (r.length === 65536 && r.equals(raw)) console.log("OK");
        else console.log("BAD len=" + r.length);
      });
      s.write(d);
      s._writeState.buffer.transfer(0);
      s.end();
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  });
});
