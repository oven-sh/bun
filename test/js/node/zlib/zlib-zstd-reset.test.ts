/**
 * The tests of streams in this file run in both Bun and Node.js: `bun test`
 * runs them here, and the last test runs this same file under Node.js. The
 * tests of handles run in Bun only, in a new process.
 *
 * reset() of a zstd stream starts a new frame and keeps the dictionary and the
 * parameters of the stream. Node does this since v26.10.0
 * (https://github.com/nodejs/node/pull/65867). Node's own test,
 * test/js/node/test/parallel/test-zlib-zstd-reset.js, resets before the first
 * write. This file has the other orders.
 */
import assert from "node:assert";
import { finished } from "node:stream/promises";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const {
  ZSTD_c_checksumFlag,
  ZSTD_c_compressionLevel,
  ZSTD_c_jobSize,
  ZSTD_c_nbWorkers,
  ZSTD_c_windowLog,
  ZSTD_d_windowLogMax,
  ZSTD_e_end,
} = zlib.constants;

// An older Node makes a new zstd context in reset(), without the dictionary and
// the parameters, so it skips the cases that need them. Bun always runs them.
const runtimeKeepsOptions = (() => {
  if (process.versions.bun) return true;
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 26 || (major === 26 && minor >= 10);
})();
const resetTest = runtimeKeepsOptions ? test : test.skip;

const dictionary = Buffer.from(
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " +
    "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
);
const input = Buffer.alloc(5700, "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ");
const half = input.subarray(0, input.length / 2);
const rest = input.subarray(input.length / 2);

const compressOptions = {
  dictionary,
  pledgedSrcSize: input.length,
  params: { [ZSTD_c_compressionLevel]: 19, [ZSTD_c_checksumFlag]: 1 },
};

/** Collects what the stream emits from now on. */
function collect(stream) {
  const chunks = [];
  stream.on("data", chunk => chunks.push(chunk));
  return chunks;
}

function write(stream, chunk) {
  return new Promise((resolve, reject) => stream.write(chunk, err => (err ? reject(err) : resolve(undefined))));
}

/**
 * Writes `first`, ends the stream with `last`, and gives the bytes the stream emits until it ends.
 * Two chunks, because zstd replaces the pledged size with the size of the input when the first chunk is also the last.
 */
async function run(stream, first, last) {
  const chunks = collect(stream);
  stream.write(first);
  stream.end(last);
  await finished(stream);
  return Buffer.concat(chunks);
}

/** The frame of a compressor that nothing reset. */
function frame(options = compressOptions) {
  return run(zlib.createZstdCompress(options), half, rest);
}

test("each option changes the frame that the other tests compare with", async () => {
  const expected = await frame();
  for (const without of ["dictionary", "pledgedSrcSize", "params"]) {
    assert.notDeepStrictEqual(await frame({ ...compressOptions, [without]: undefined }), expected, without);
  }
});

resetTest("ZstdCompress: _handle.reset() keeps the options", async () => {
  const stream = zlib.createZstdCompress(compressOptions);
  stream._handle.reset();
  assert.deepStrictEqual(await run(stream, half, rest), await frame());
});

resetTest("ZstdCompress: a second reset() keeps the options", async () => {
  const stream = zlib.createZstdCompress(compressOptions);
  stream.reset();
  stream.reset();
  assert.deepStrictEqual(await run(stream, half, rest), await frame());
});

resetTest("ZstdCompress: reset() after a write drops the open frame and keeps the options", async () => {
  const stream = zlib.createZstdCompress(compressOptions);
  const chunks = collect(stream);
  await write(stream, Buffer.from("reset() drops this frame"));
  stream.reset();
  stream.write(half);
  stream.end(rest);
  await finished(stream);
  assert.deepStrictEqual(Buffer.concat(chunks), await frame());
});

resetTest("ZstdCompress: reset() between two frames keeps the options for the second frame", async () => {
  const stream = zlib.createZstdCompress(compressOptions);
  const chunks = collect(stream);
  stream.write(half);
  stream.write(rest);
  await new Promise(resolve => stream.flush(ZSTD_e_end, resolve));
  const first = Buffer.concat(chunks.splice(0));
  assert.deepStrictEqual(zlib.zstdDecompressSync(first, { dictionary }), input);
  stream.reset();
  stream.write(half);
  stream.end(rest);
  await finished(stream);
  assert.deepStrictEqual(Buffer.concat(chunks), await frame());
});

// The old reset() kept the pledged size too, so this holds on every Node.
test("ZstdCompress: pledgedSrcSize applies again after reset()", async () => {
  const stream = zlib.createZstdCompress({ pledgedSrcSize: input.length });
  stream.reset();
  await assert.rejects(run(stream, half, rest.subarray(1)), { code: "ZSTD_error_srcSize_wrong" });
});

resetTest("ZstdCompress: reset() after a second _handle.init() keeps the options of that init()", async () => {
  const other = Buffer.from(dictionary).reverse();
  const stream = zlib.createZstdCompress({ dictionary: other, params: { [ZSTD_c_compressionLevel]: 1 } });
  const params = new Uint32Array(ZSTD_c_checksumFlag + 1).fill(-1);
  params[ZSTD_c_compressionLevel] = 19;
  params[ZSTD_c_checksumFlag] = 1;
  stream._handle.init(params, input.length, stream._writeState, () => {}, dictionary);
  stream._handle.reset();
  assert.deepStrictEqual(stream._processChunk(input, ZSTD_e_end), zlib.zstdCompressSync(input, compressOptions));
});

resetTest("ZstdCompress: reset() keeps ZSTD_c_nbWorkers", async () => {
  const job = 512 * 1024;
  const params = { [ZSTD_c_jobSize]: job, [ZSTD_c_checksumFlag]: 1 };
  const oneWorker = { params: { ...params, [ZSTD_c_nbWorkers]: 1 } };
  // Two jobs. One chunk is one job: a stream with workers ends with no output
  // after a chunk of more than one job, in Node too.
  const text = Buffer.alloc(2 * job, input);
  const first = text.subarray(0, job);
  const last = text.subarray(job);
  const expected = await run(zlib.createZstdCompress(oneWorker), first, last);
  assert.deepStrictEqual(zlib.zstdDecompressSync(expected), text);
  assert.notDeepStrictEqual(await run(zlib.createZstdCompress({ params }), first, last), expected);

  const stream = zlib.createZstdCompress(oneWorker);
  stream.reset();
  assert.deepStrictEqual(await run(stream, first, last), expected);
});

resetTest("ZstdDecompress: reset() in the middle of a frame keeps the dictionary", async () => {
  const compressed = zlib.zstdCompressSync(input, { dictionary });
  const stream = zlib.createZstdDecompress({ dictionary });
  const chunks = collect(stream);
  await write(stream, compressed.subarray(0, 10));
  stream.reset();
  stream.end(compressed);
  await finished(stream);
  assert.deepStrictEqual(Buffer.concat(chunks), input);
});

resetTest("ZstdDecompress: reset() between two frames keeps the dictionary", async () => {
  const stream = zlib.createZstdDecompress({ dictionary });
  const chunks = collect(stream);
  await write(stream, zlib.zstdCompressSync(half, { dictionary }));
  stream.reset();
  stream.end(zlib.zstdCompressSync(rest, { dictionary }));
  await finished(stream);
  assert.deepStrictEqual(Buffer.concat(chunks), input);
});

resetTest("ZstdDecompress: reset() after a frame keeps ZSTD_d_windowLogMax", async () => {
  const large = await run(
    zlib.createZstdCompress({ params: { [ZSTD_c_windowLog]: 11 } }),
    Buffer.alloc(2048),
    Buffer.alloc(2048),
  );
  const stream = zlib.createZstdDecompress({ params: { [ZSTD_d_windowLogMax]: 10 } });
  const chunks = collect(stream);
  await write(stream, zlib.zstdCompressSync(Buffer.from("a frame with a small window")));
  assert.deepStrictEqual(Buffer.concat(chunks).toString(), "a frame with a small window");
  stream.reset();
  stream.end(large);
  await assert.rejects(finished(stream), { code: "ZSTD_error_frameParameter_windowTooLarge" });
});

resetTest("ZstdDecompress: _processChunk() after _handle.reset() keeps the dictionary", () => {
  const compressed = zlib.zstdCompressSync(input, { dictionary });
  const stream = zlib.createZstdDecompress({ dictionary });
  const handle = stream._handle;
  // _processChunk() closes the handle when it returns. Keep the handle open for the second call.
  const close = handle.close;
  handle.close = () => {};
  try {
    const first = stream._processChunk(compressed, ZSTD_e_end);
    stream._handle = handle;
    handle.reset();
    const second = stream._processChunk(compressed, ZSTD_e_end);
    assert.deepStrictEqual({ first, second }, { first: input, second: input });
  } finally {
    close.call(handle);
  }
});

// What the process of `handleFixture` prints when every case in it is correct.
const handleFixtureOutput = [
  "a compressor with no context, reset() and a write: []",
  "a decompressor with no context, reset() and a write: []",
  "reset() while a job waits for the worker: same frame true",
  "a job fails while another job waits for the worker: ZSTD_error_srcSize_wrong, same frame true",
  "reset() while the worker uses the dictionary: same frame true",
];

// Cases that drive the native handle. A process that gets one of them wrong
// can crash, and Node v26.10.0 does crash in four of the five.
const handleFixture = /* js */ `
  const zlib = require("node:zlib");
  const { ZSTD_c_checksumFlag, ZSTD_c_jobSize, ZSTD_c_nbWorkers, ZSTD_e_continue, ZSTD_e_end } = zlib.constants;

  // reset() works on the context that init() made. A handle that has none
  // gets none from reset(), so the write after it does nothing.
  const Handle = zlib.createZstdCompress()._handle.constructor;
  for (const [name, mode, chunk] of [
    ["compressor", zlib.constants.ZSTD_COMPRESS, Buffer.from("x")],
    ["decompressor", zlib.constants.ZSTD_DECOMPRESS, zlib.zstdCompressSync("x")],
  ]) {
    const handle = new Handle(mode);
    handle.reset();
    const written = Buffer.alloc(64);
    handle.writeSync(ZSTD_e_end, chunk, 0, chunk.length, written, 0, written.length);
    const bytes = written.toString("hex").replace(/(00)+$/, "");
    console.log("a " + name + " with no context, reset() and a write: [" + bytes + "]");
  }

  // The other cases use one worker thread. zstd prepares a job and keeps it
  // (mtctx->jobReady) while the worker is busy. It erased its job table at
  // the start of the next frame and still took the job for prepared, so the
  // worker ran an erased job: SIGSEGV in ZSTDMT_compressionJob.
  // patches/zstd/mt-clear-job-ready.patch clears the flag.
  const job = 512 * 1024;
  const params = { [ZSTD_c_nbWorkers]: 1, [ZSTD_c_jobSize]: job, [ZSTD_c_checksumFlag]: 1 };
  // Two jobs of hex digits with no repeats in them: the worker needs longer
  // for a job than the next call needs to prepare one.
  const cipher = require("node:crypto").createCipheriv("aes-128-ctr", Buffer.alloc(16), Buffer.alloc(16));
  const slow = Buffer.from(cipher.update(Buffer.alloc(job)).toString("hex"));
  const out = Buffer.alloc(2 * slow.length);

  // A frame of 256 bytes. The first call does not end the frame, so zstd
  // does not know that the frame is small, and gives it to the worker.
  function smallFrame(stream) {
    stream._handle.writeSync(ZSTD_e_continue, slow, 0, 256, out, 0, out.length);
    stream._handle.writeSync(ZSTD_e_end, null, 0, 0, out, 0, out.length);
    return Buffer.from(out.subarray(0, out.length - stream._writeState[0]));
  }
  // Compares the next frame of the stream with the frame of a new stream.
  const sameFrame = (stream, options) =>
    "same frame " + smallFrame(stream).equals(smallFrame(zlib.createZstdCompress(options)));

  {
    // reset() in that state. The worker takes the first job. The second job
    // waits when the worker is still busy, and then the two writes have
    // given no output.
    let stream, produced, attempts = 0;
    do {
      stream = zlib.createZstdCompress({ params });
      produced = 0;
      for (const offset of [0, job]) {
        stream._handle.writeSync(ZSTD_e_continue, slow, offset, job, out, 0, out.length);
        produced += out.length - stream._writeState[0];
      }
    } while (produced !== 0 && ++attempts < 10);
    stream._handle.reset();
    const waits = produced === 0 ? "a job waits" : "no job waits";
    console.log("reset() while " + waits + " for the worker: " + sameFrame(stream, { params }));
  }

  {
    // No reset(). The first job is longer than the pledged size, so it fails
    // while the second job waits, and zstd starts a new session by itself.
    // The pledged size is more than 512 KiB, or zstd uses no worker.
    const options = { params: { ...params, [ZSTD_c_jobSize]: 2 * job } };
    const stream = zlib.createZstdCompress({ ...options, pledgedSrcSize: job + 1 });
    const errors = [];
    // The onerror that zlib.ts installs closes the handle.
    stream._handle.onerror = (message, errno, code) => errors.push(code);
    for (let i = 0; i < 2; i++) stream._handle.writeSync(ZSTD_e_continue, slow, 0, 2 * job, out, 0, out.length);
    stream._handle.writeSync(ZSTD_e_end, null, 0, 0, out, 0, out.length);
    console.log("a job fails while another job waits for the worker: " + errors + ", " + sameFrame(stream, options));
  }

  {
    // With a dictionary. reset() used to free the context, and zstd frees
    // the dictionary before it stops the worker that reads it (#44201).
    const options = { params, dictionary: slow.subarray(0, 64 * 1024) };
    const stream = zlib.createZstdCompress(options);
    stream._handle.writeSync(ZSTD_e_continue, slow, 0, job, out, 0, out.length);
    stream._handle.reset();
    console.log("reset() while the worker uses the dictionary: " + sameFrame(stream, options));
  }
`;

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, bunExe, nodeExe } = await import("harness");
  const node = nodeExe();

  // The process starts before the first test and runs beside the tests above.
  let fixture: ReturnType<typeof spawnHandleFixture> | undefined;
  const spawnHandleFixture = () =>
    Bun.spawn({
      cmd: [bunExe(), "-e", handleFixture],
      // The finalizer of every handle runs at exit, as on the ASAN CI lanes.
      env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
  before(() => {
    fixture = spawnHandleFixture();
  });
  after(() => {
    fixture?.kill();
  });

  test("reset() of a zstd handle, in a new process", async () => {
    const proc = fixture!;
    // stderr is drained and not compared: a debug build writes to it.
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    assert.deepStrictEqual(
      { stdout: stdout.trim().split(/\r?\n/), exitCode },
      { stdout: handleFixtureOutput, exitCode: 0 },
    );
  });

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, fileURLToPath(import.meta.url)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
