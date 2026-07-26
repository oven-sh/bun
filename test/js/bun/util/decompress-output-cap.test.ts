import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import os from "os";

// The Bun-native decompress APIs must throw ERR_BUFFER_TOO_LARGE (a RangeError)
// instead of aborting when the decompressed output would exceed the ArrayBuffer
// limit. The reader's max_output_size caps the output Vec at the limit so an
// arbitrarily large bomb (here 500 x 64 MiB = 31.25 GiB) stops growing at the
// cap instead of allocating the whole thing and then failing at the sink.
// Spawned so the multi-GB allocation dies with the child and so a regression
// (process abort / OOM kill) fails the test instead of killing the runner.
const hasMemory = os.totalmem() >= 16 * 1024 ** 3;

test.skipIf(!hasMemory)(
  "Bun.zstdDecompressSync / Bun.zstdDecompress reject a > 4 GiB output with ERR_BUFFER_TOO_LARGE without allocating it",
  async () => {
    const script = `
      const frame = Bun.zstdCompressSync(Buffer.alloc(64 << 20));
      const bomb = Buffer.concat(Array(500).fill(frame));
      const results = {};
      try {
        Bun.zstdDecompressSync(bomb);
        results.sync = { threw: false };
      } catch (e) {
        results.sync = { threw: true, code: e.code, isRangeError: e instanceof RangeError };
      }
      try {
        await Bun.zstdDecompress(bomb);
        results.async = { threw: false };
      } catch (e) {
        results.async = { threw: true, code: e.code, isRangeError: e instanceof RangeError };
      }
      console.log(JSON.stringify(results));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const out = JSON.parse(stdout.trim() || "null");
    expect({ out, stderr }).toEqual({
      out: {
        sync: { threw: true, code: "ERR_BUFFER_TOO_LARGE", isRangeError: true },
        async: { threw: true, code: "ERR_BUFFER_TOO_LARGE", isRangeError: true },
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  },
  300_000,
);

test.skipIf(!hasMemory)(
  "Bun.gunzipSync rejects a > 4 GiB output with ERR_BUFFER_TOO_LARGE",
  async () => {
    const script = `
    const zlib = require("node:zlib");
    const chunks = [];
    const gz = zlib.createGzip({ level: 1 });
    gz.on("data", c => chunks.push(c));
    const done = new Promise(r => gz.on("end", r));
    const zero = Buffer.alloc(64 << 20);
    let left = 4 * 1024 ** 3;
    const feed = () => {
      while (left > 0) {
        const n = Math.min(zero.length, left);
        left -= n;
        if (!gz.write(zero.subarray(0, n))) return gz.once("drain", feed);
      }
      gz.end();
    };
    feed();
    await done;
    const bomb = Buffer.concat(chunks);
    try {
      Bun.gunzipSync(bomb);
      console.log(JSON.stringify({ threw: false }));
    } catch (e) {
      console.log(JSON.stringify({ threw: true, code: e.code, isRangeError: e instanceof RangeError }));
    }
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const out = JSON.parse(stdout.trim() || "null");
    expect({ out, stderr }).toEqual({
      out: { threw: true, code: "ERR_BUFFER_TOO_LARGE", isRangeError: true },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  },
  300_000,
);
