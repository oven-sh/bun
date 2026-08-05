import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

// Async threadpool natives borrowed a pointer+length into the caller's buffer; pin()
// blocks transfer() but not resize(), so a shrink decommits pages the pool thread is
// still reading. Fixed by copying resizable inputs into the job.

const driver = /* js */ `
  const crypto = require("node:crypto");
  const zlib = require("node:zlib");
  const { promisify } = require("node:util");

  const pbkdf2 = promisify(crypto.pbkdf2);
  const scrypt = promisify(crypto.scrypt);
  const deflate = promisify(zlib.deflate);
  const inflate = promisify(zlib.inflate);
  const gzip = promisify(zlib.gzip);
  const gunzip = promisify(zlib.gunzip);
  const brotliCompress = promisify(zlib.brotliCompress);
  const brotliDecompress = promisify(zlib.brotliDecompress);

  const SIZE = 128 * 1024;
  const fixed = new Uint8Array(SIZE).fill(0x41);
  const brotliOpts = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 } };

  const apis = {
    pbkdf2: { src: () => fixed, fn: v => pbkdf2(v, "salt", 100, 32, "sha256") },
    scrypt: { src: () => fixed, fn: v => scrypt(v, "salt", 32, { N: 1024 }) },
    deflate: { src: () => fixed, fn: v => deflate(v) },
    gzip: { src: () => fixed, fn: v => gzip(v) },
    brotliCompress: { src: () => fixed, fn: v => brotliCompress(v, brotliOpts) },
    zstdCompress: { src: () => fixed, fn: v => Bun.zstdCompress(v) },
    inflate: { src: () => zlib.deflateSync(fixed), fn: v => inflate(v) },
    gunzip: { src: () => zlib.gzipSync(fixed), fn: v => gunzip(v) },
    brotliDecompress: { src: () => zlib.brotliCompressSync(fixed, brotliOpts), fn: v => brotliDecompress(v) },
    zstdDecompress: { src: () => Bun.zstdCompressSync(fixed), fn: v => Bun.zstdDecompress(v) },
  };

  for (const [name, { src: mkSrc, fn }] of Object.entries(apis)) {
    const src = mkSrc();
    const expected = Buffer.from(await fn(src));
    for (let i = 0; i < 4; i++) {
      const ab = new ArrayBuffer(src.length, { maxByteLength: src.length + 65536 });
      const view = new Uint8Array(ab);
      view.set(src);
      const p = fn(view);
      ab.resize(0);
      const got = Buffer.from(await p);
      if (Buffer.compare(expected, got) !== 0) {
        console.error(name, "mismatch at iteration", i, "expected", expected.length, "got", got.length);
        process.exit(1);
      }
    }
    console.log(name, "ok");
  }
`;

// The wild read only reliably faults under ASAN; on release the pool thread often
// finishes before resize(0) decommits the pages. Run in a subprocess so the SEGV
// is contained and the runner can report a clean failure.
test.skipIf(!isASAN)(
  "async native input survives ArrayBuffer.prototype.resize(0) mid-flight",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", driver],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: [
        "pbkdf2 ok",
        "scrypt ok",
        "deflate ok",
        "gzip ok",
        "brotliCompress ok",
        "zstdCompress ok",
        "inflate ok",
        "gunzip ok",
        "brotliDecompress ok",
        "zstdDecompress ok",
      ].join("\n"),
      stderr: expect.any(String),
      exitCode: 0,
    });
  },
  30_000,
);
