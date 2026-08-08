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
    for (let i = 0; i < 3; i++) small.push(await sample(1 << 20));
    for (let i = 0; i < 3; i++) large.push(await sample(128 << 20));
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
  // With the O(n) snapshot, 128MB took roughly 128x the 1MB sample. With the
  // buffer borrowed in place, the synchronous portion is constant regardless
  // of size. The 0.05ms floor keeps the threshold meaningful on fast release
  // builds where the 1MB sample completes in a few microseconds.
  expect(large_ms).toBeLessThan(Math.max(small_ms, 0.05) * 16);
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.write(path, typedArray) writes the correct bytes for borrowed ArrayBuffer sources", async () => {
  using dir = tempDir("bun-write-large-buffer-content", {});
  const script = `
    const crypto = require("crypto");
    const fs = require("fs");
    const path = require("path");
    const out = path.join(process.cwd(), "out.bin");
    // large enough to have skipped the synchronous <256KB fast path.
    const buf = crypto.randomBytes(1 << 20);
    const resizable = new ArrayBuffer(512 * 1024, { maxByteLength: 1 << 20 });
    new Uint8Array(resizable).set(new Uint8Array(buf.buffer, buf.byteOffset, 512 * 1024));
    const cases = [
      ["Uint8Array", buf],
      ["ArrayBuffer", buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)],
      ["DataView", new DataView(buf.buffer, buf.byteOffset, buf.byteLength)],
      ["offset view", new Uint8Array(buf.buffer, buf.byteOffset + 1024, 512 * 1024)],
      // resizable and empty inputs exercise the borrow -> None fallback.
      ["resizable", new Uint8Array(resizable)],
      ["empty", new Uint8Array(0)],
    ];
    const writers = {
      "Bun.write": (p, i) => Bun.write(p, i),
      "BunFile.write": (p, i) => Bun.file(p).write(i),
    };
    const results = {};
    for (const [how, write] of Object.entries(writers)) {
      for (const [name, input] of cases) {
        const wrote = await write(out, input);
        const expectedBytes =
          input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
        const got = fs.readFileSync(out);
        results[how + " " + name] = { wrote, len: got.length, ok: Buffer.compare(got, expectedBytes) === 0 };
      }
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
  const expected: Record<string, unknown> = {};
  for (const how of ["Bun.write", "BunFile.write"]) {
    expected[`${how} Uint8Array`] = { wrote: 1 << 20, len: 1 << 20, ok: true };
    expected[`${how} ArrayBuffer`] = { wrote: 1 << 20, len: 1 << 20, ok: true };
    expected[`${how} DataView`] = { wrote: 1 << 20, len: 1 << 20, ok: true };
    expected[`${how} offset view`] = { wrote: 512 * 1024, len: 512 * 1024, ok: true };
    expected[`${how} resizable`] = { wrote: 512 * 1024, len: 512 * 1024, ok: true };
    expected[`${how} empty`] = { wrote: 0, len: 0, ok: true };
  }
  expect(JSON.parse(stdout)).toEqual(expected);
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.write(path, typedArray) releases its pin+protect on the source ArrayBuffer", async () => {
  using dir = tempDir("bun-write-large-buffer-gcstress", {});
  const script = `
    const { heapStats } = require("bun:jsc");
    const path = require("path");
    const out = path.join(process.cwd(), "out.bin");
    function protectedBufferCount() {
      const c = heapStats().protectedObjectTypeCounts;
      return (c.Uint8Array ?? 0) + (c.Buffer ?? 0) + (c.ArrayBuffer ?? 0) + (c.JSArrayBuffer ?? 0);
    }
    await Bun.write(out, new Uint8Array(1));
    Bun.gc(true);
    const base = protectedBufferCount();

    for (let i = 0; i < 64; i++) {
      await Bun.write(out, new Uint8Array(300 * 1024).fill(i & 0xff));
      Bun.gc(true);
    }
    const afterSuccess = protectedBufferCount();

    let rejected = 0;
    for (let i = 0; i < 16; i++) {
      try {
        await Bun.write(process.cwd(), new Uint8Array(300 * 1024));
      } catch {
        rejected++;
      }
      Bun.gc(true);
    }
    const afterError = protectedBufferCount();

    console.log(JSON.stringify({ base, afterSuccess, afterError, rejected }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { base, afterSuccess, afterError, rejected } = JSON.parse(stdout);
  // every Bun.write call protects the source while the pool-thread write runs
  // and releases it on completion; a missed release would leave these counts
  // climbing by one per iteration.
  expect(afterSuccess).toBeLessThanOrEqual(base + 2);
  expect(afterError).toBeLessThanOrEqual(base + 2);
  expect(rejected).toBe(16);
  expect(exitCode).toBe(0);
});
