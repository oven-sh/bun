import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Bun.write(path, typedArray) used to snapshot the entire payload on the JS
// thread before scheduling the write: on Linux that was memfd_create +
// ftruncate + pwrite64(len), elsewhere a full memcpy, so the synchronous
// portion of the call scaled O(n) with the buffer size (roughly 0.75ms/MB
// on the memfd path). The pool-thread write now reads the pinned ArrayBuffer
// directly, matching fs.promises.writeFile.
test("Bun.write(path, largeTypedArray) does not block the JS thread copying the payload", async () => {
  using dir = tempDir("bun-write-large-buffer-nonblock", {});
  const script = `
    const path = require("path");
    const out = path.join(process.cwd(), "out.bin");
    async function sample(bytes) {
      const buf = Buffer.alloc(bytes, 0x5a);
      // warm up: open/creat/truncate the destination once so both samples pay the same fs cost.
      await Bun.write(out, new Uint8Array(1));
      const t0 = performance.now();
      const promise = Bun.write(out, buf);
      const sync = performance.now() - t0;
      const wrote = await promise;
      if (wrote !== bytes) throw new Error("wrote " + wrote + " expected " + bytes);
      return sync;
    }
    // best of a few runs to filter out scheduler noise.
    function bestOf(arr) { return Math.min(...arr); }
    const small = [], large = [];
    for (let i = 0; i < 2; i++) small.push(await sample(1 << 20));
    for (let i = 0; i < 2; i++) large.push(await sample(64 << 20));
    console.log(JSON.stringify({ small_ms: bestOf(small), large_ms: bestOf(large) }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { small_ms, large_ms } = JSON.parse(stdout);
  // With the O(n) snapshot, 64MB took roughly 64x the 1MB sample. With the
  // buffer borrowed in place, the synchronous portion is constant regardless
  // of size.
  expect(large_ms).toBeLessThan(Math.max(small_ms, 1) * 8);
  expect(exitCode).toBe(0);
});

test("Bun.write(path, typedArray) writes the correct bytes for borrowed ArrayBuffer sources", async () => {
  using dir = tempDir("bun-write-large-buffer-content", {});
  const script = `
    const crypto = require("crypto");
    const fs = require("fs");
    const path = require("path");
    const out = path.join(process.cwd(), "out.bin");
    // large enough to have skipped the synchronous <256KB fast path.
    const buf = crypto.randomBytes(1 << 20);
    const cases = [
      ["Uint8Array", buf],
      ["ArrayBuffer", buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)],
      ["DataView", new DataView(buf.buffer, buf.byteOffset, buf.byteLength)],
      ["offset view", new Uint8Array(buf.buffer, buf.byteOffset + 1024, 4096)],
    ];
    const results = {};
    for (const [name, input] of cases) {
      const wrote = await Bun.write(out, input);
      const expectedBytes =
        input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      const got = fs.readFileSync(out);
      results[name] = { wrote, len: got.length, ok: Buffer.compare(got, expectedBytes) === 0 };
    }
    console.log(JSON.stringify(results));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    "Uint8Array": { wrote: 1 << 20, len: 1 << 20, ok: true },
    "ArrayBuffer": { wrote: 1 << 20, len: 1 << 20, ok: true },
    "DataView": { wrote: 1 << 20, len: 1 << 20, ok: true },
    "offset view": { wrote: 4096, len: 4096, ok: true },
  });
  expect(exitCode).toBe(0);
});
