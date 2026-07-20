import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Async threadpool natives borrowed a pointer+length into the caller's buffer.
// The in-flight pin blocks transfer() but not ArrayBuffer.prototype.resize();
// a shrink on the JS thread decommits pages the pool thread is still reading,
// which segfaults the process. Fixed by copying resizable inputs into the job.

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

  const SIZE = 64 * 1024;
  const fixed = new Uint8Array(SIZE).fill(0x41);
  const brotliOpts = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 } };
  const deflated = zlib.deflateSync(fixed);
  const gzipped = zlib.gzipSync(fixed);
  const brotlied = zlib.brotliCompressSync(fixed, brotliOpts);
  const zstded = Bun.zstdCompressSync(fixed);

  const apis = {
    pbkdf2: { src: fixed, fn: v => pbkdf2(v, "salt", 100, 32, "sha256") },
    scrypt: { src: fixed, fn: v => scrypt(v, "salt", 32, { N: 1024 }) },
    deflate: { src: fixed, fn: v => deflate(v) },
    gzip: { src: fixed, fn: v => gzip(v) },
    brotliCompress: { src: fixed, fn: v => brotliCompress(v, brotliOpts) },
    zstdCompress: { src: fixed, fn: v => Bun.zstdCompress(v) },
    inflate: { src: deflated, fn: v => inflate(v) },
    gunzip: { src: gzipped, fn: v => gunzip(v) },
    brotliDecompress: { src: brotlied, fn: v => brotliDecompress(v) },
    zstdDecompress: { src: zstded, fn: v => Bun.zstdDecompress(v) },
  };

  const which = process.env.CELL;
  const { src, fn } = apis[which];
  const expected = Buffer.from(await fn(src));

  for (let i = 0; i < 20; i++) {
    const ab = new ArrayBuffer(src.length, { maxByteLength: src.length + 65536 });
    const view = new Uint8Array(ab);
    view.set(src);
    const p = fn(view);
    ab.resize(0);
    const got = Buffer.from(await p);
    if (Buffer.compare(expected, got) !== 0) {
      console.error("mismatch at iteration", i, "expected", expected.length, "got", got.length);
      process.exit(1);
    }
  }
  console.log("ok");
`;

const cases = [
  "pbkdf2",
  "scrypt",
  "deflate",
  "gzip",
  "brotliCompress",
  "zstdCompress",
  "inflate",
  "gunzip",
  "brotliDecompress",
  "zstdDecompress",
];

describe("async native input survives ArrayBuffer.prototype.resize(0) mid-flight", () => {
  for (const name of cases) {
    test.concurrent(name, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", driver],
        env: { ...bunEnv, CELL: name },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("ok");
      expect(exitCode).toBe(0);
    });
  }
});
