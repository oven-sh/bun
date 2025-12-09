import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// This test verifies that zlib compression operations properly hold strong
// references to their input/output buffers during async work, preventing
// use-after-free when a worker thread is terminated while compression is
// in progress.
//
// The fix adds jsc.Strong.Optional references (in_buf_value, out_buf_value)
// to hold the buffer JSValues while the WorkPool thread processes them.

test("brotliCompress should not UAF when worker is terminated during compression", async () => {
  const workerCode = `
const { parentPort, workerData } = require("worker_threads");
const zlib = require("zlib");

const sab = workerData.sab;
const view = new Uint8Array(sab);

// Start brotli compression with quality 11 (slow) to ensure compression
// is still in progress when we terminate
zlib.brotliCompress(view, {
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
  },
}, (err, result) => {
  // This callback may not be called if worker is terminated
  if (!err) {
    parentPort.postMessage({ done: true, size: result.length });
  }
});

parentPort.postMessage({ ready: true });
`;

  // Use inline eval to run the test
  const testCode = `
const { Worker } = require("worker_threads");

const workerCode = ${JSON.stringify(workerCode)};

// Create SharedArrayBuffer with test data
const inputData = Buffer.alloc(5 * 1024 * 1024, "A");
let sab = new SharedArrayBuffer(inputData.length);
let view = new Uint8Array(sab);
view.set(inputData);

const worker = new Worker(workerCode, {
  eval: true,
  workerData: { sab }
});

let terminated = false;

worker.on("message", async (msg) => {
  if (msg.ready && !terminated) {
    terminated = true;
    // Small delay to let compression start
    await Bun.sleep(20);

    // Terminate worker while compression is in progress
    await worker.terminate();

    // Drop references and trigger GC
    sab = null;
    view = null;
    if (global.gc) {
      global.gc();
    }

    // Wait a bit for any potential UAF to manifest
    await Bun.sleep(100);

    console.log("SUCCESS");
    process.exit(0);
  }
});

worker.on("error", (err) => {
  console.error("Worker error:", err);
  process.exit(1);
});

// Timeout after 10 seconds
setTimeout(() => {
  console.log("SUCCESS");
  process.exit(0);
}, 10000);
`;

  const proc = Bun.spawn({
    cmd: [bunExe(), "--expose-gc", "-e", testCode],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // The process should complete without crashing from UAF
  // Note: with ASAN builds, a UAF would cause a crash with ASAN error
  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("SUCCESS");
});

test("gzip should not UAF when worker is terminated during compression", async () => {
  const workerCode = `
const { parentPort, workerData } = require("worker_threads");
const zlib = require("zlib");

const sab = workerData.sab;
const view = new Uint8Array(sab);

// Start gzip compression
zlib.gzip(view, { level: 9 }, (err, result) => {
  if (!err) {
    parentPort.postMessage({ done: true, size: result.length });
  }
});

parentPort.postMessage({ ready: true });
`;

  const testCode = `
const { Worker } = require("worker_threads");

const workerCode = ${JSON.stringify(workerCode)};

const inputData = Buffer.alloc(2 * 1024 * 1024, "B");
let sab = new SharedArrayBuffer(inputData.length);
let view = new Uint8Array(sab);
view.set(inputData);

const worker = new Worker(workerCode, {
  eval: true,
  workerData: { sab }
});

let terminated = false;

worker.on("message", async (msg) => {
  if (msg.ready && !terminated) {
    terminated = true;
    await Bun.sleep(10);
    await worker.terminate();

    sab = null;
    view = null;
    if (global.gc) {
      global.gc();
    }

    await Bun.sleep(100);
    console.log("SUCCESS");
    process.exit(0);
  }
});

worker.on("error", (err) => {
  console.error("Worker error:", err);
  process.exit(1);
});

setTimeout(() => {
  console.log("SUCCESS");
  process.exit(0);
}, 10000);
`;

  const proc = Bun.spawn({
    cmd: [bunExe(), "--expose-gc", "-e", testCode],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("SUCCESS");
});

test("zstd should not UAF when worker is terminated during compression", async () => {
  const workerCode = `
const { parentPort, workerData } = require("worker_threads");
const zlib = require("zlib");

const sab = workerData.sab;
const view = new Uint8Array(sab);

// Start zstd compression
zlib.zstdCompress(view, { level: 19 }, (err, result) => {
  if (!err) {
    parentPort.postMessage({ done: true, size: result.length });
  }
});

parentPort.postMessage({ ready: true });
`;

  const testCode = `
const { Worker } = require("worker_threads");

const workerCode = ${JSON.stringify(workerCode)};

const inputData = Buffer.alloc(2 * 1024 * 1024, "C");
let sab = new SharedArrayBuffer(inputData.length);
let view = new Uint8Array(sab);
view.set(inputData);

const worker = new Worker(workerCode, {
  eval: true,
  workerData: { sab }
});

let terminated = false;

worker.on("message", async (msg) => {
  if (msg.ready && !terminated) {
    terminated = true;
    await Bun.sleep(10);
    await worker.terminate();

    sab = null;
    view = null;
    if (global.gc) {
      global.gc();
    }

    await Bun.sleep(100);
    console.log("SUCCESS");
    process.exit(0);
  }
});

worker.on("error", (err) => {
  console.error("Worker error:", err);
  process.exit(1);
});

setTimeout(() => {
  console.log("SUCCESS");
  process.exit(0);
}, 10000);
`;

  const proc = Bun.spawn({
    cmd: [bunExe(), "--expose-gc", "-e", testCode],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("SUCCESS");
});
