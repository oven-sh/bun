import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The native zlib/brotli/zstd handles receive a `Uint32Array(2)` "writeState"
// from JS at init() time and write avail_in/avail_out back into it after every
// write()/writeSync(). Previously the native side captured a raw `[*]u32` into
// the typed array's backing store. If the backing ArrayBuffer was later
// detached (transfer()/postMessage()/structuredClone transfer), the native
// handle would keep writing through that stale pointer into memory it no
// longer owns — a use-after-free if the transferred buffer is freed, or silent
// corruption of whoever now owns that memory.
//
// These tests re-init() the handle with a writeState whose backing store is a
// real heap ArrayBuffer (materialized before init() so the captured vector
// points into it), transfer ownership of that storage to a separate typed
// array, fill it with sentinels, and then perform another write. The handle
// must not scribble over the transferred memory.

const fixture = /* js */ `
  const zlib = require("zlib");

  const z = zlib.createDeflate();
  const handle = z._handle;

  // Re-init with our own writeState. Touch .buffer first so the typed array
  // is backed by a real ArrayBuffer (WastefulTypedArray) before init()
  // observes it; otherwise a later .buffer access would move the vector on
  // its own.
  const state = new Uint32Array(8);
  void state.buffer;
  handle.init(15, -1, 8, 0, state, () => {}, undefined);

  const inBuf = Buffer.from("hello");
  const outBuf = Buffer.alloc(1024);
  handle.writeSync(zlib.constants.Z_NO_FLUSH, inBuf, 0, inBuf.length, outBuf, 0, outBuf.length);
  if (state[0] === 0) throw new Error("sanity: writeSync did not update writeState");

  // Detach: the backing store now belongs exclusively to 'stolen'.
  const stolen = new Uint32Array(state.buffer.transfer());
  if (state.byteLength !== 0) throw new Error("sanity: buffer not detached");
  stolen.fill(0xdeadbeef);

  // This write must not touch 'stolen'. If the handle kept a raw pointer to
  // the original backing store, it writes avail_out/avail_in into stolen[0..1].
  handle.writeSync(zlib.constants.Z_NO_FLUSH, inBuf, 0, inBuf.length, outBuf, 0, outBuf.length);

  for (let i = 0; i < stolen.length; i++) {
    if (stolen[i] !== 0xdeadbeef) {
      console.log("CORRUPTED", i, stolen[i].toString(16));
      process.exit(1);
    }
  }
  console.log("OK");
`;

test("zlib: writeSync does not write through stale writeState pointer after detach", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});

const asyncFixture = /* js */ `
  const zlib = require("zlib");

  const z = zlib.createDeflate();
  const handle = z._handle;

  const state = new Uint32Array(8);
  void state.buffer;
  let stolen;
  handle.init(15, -1, 8, 0, state, () => {
    // Async write completed; native has just run updateWriteResult.
    for (let i = 0; i < stolen.length; i++) {
      if (stolen[i] !== 0xdeadbeef) {
        console.log("CORRUPTED", i, stolen[i].toString(16));
        process.exit(1);
      }
    }
    console.log("OK");
    process.exit(0);
  }, undefined);
  handle.onerror = () => {};

  stolen = new Uint32Array(state.buffer.transfer());
  stolen.fill(0xdeadbeef);

  const inBuf = Buffer.from("hello");
  const outBuf = Buffer.alloc(1024);
  handle.write(zlib.constants.Z_NO_FLUSH, inBuf, 0, inBuf.length, outBuf, 0, outBuf.length);
`;

test("zlib: async write does not write through stale writeState pointer after detach", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", asyncFixture],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});

const brotliFixture = /* js */ `
  const zlib = require("zlib");

  const z = zlib.createBrotliCompress();
  const handle = z._handle;

  const state = new Uint32Array(8);
  void state.buffer;
  // Brotli init(params, writeResult, writeCallback)
  const params = new Uint32Array(0);
  handle.init(params, state, () => {});

  const inBuf = Buffer.from("hello");
  const outBuf = Buffer.alloc(1024);
  handle.writeSync(0, inBuf, 0, inBuf.length, outBuf, 0, outBuf.length);

  const stolen = new Uint32Array(state.buffer.transfer());
  stolen.fill(0xdeadbeef);

  handle.writeSync(0, inBuf, 0, inBuf.length, outBuf, 0, outBuf.length);

  for (let i = 0; i < stolen.length; i++) {
    if (stolen[i] !== 0xdeadbeef) {
      console.log("CORRUPTED", i, stolen[i].toString(16));
      process.exit(1);
    }
  }
  console.log("OK");
`;

test("brotli: writeSync does not write through stale writeState pointer after detach", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", brotliFixture],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
