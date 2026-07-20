import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { promisify } from "node:util";
import zlib from "node:zlib";

// Async threadpool natives borrowed a pointer+length into the caller's buffer; pin()
// blocks transfer() but not resize(), so a shrink decommits pages the pool thread is
// still reading. Fixed by copying resizable inputs into the job.

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

type Case = { src: () => Uint8Array; fn: (v: Uint8Array) => Promise<Uint8Array> };
const cases: Record<string, Case> = {
  pbkdf2: { src: () => fixed, fn: v => pbkdf2(v, "salt", 100, 32, "sha256") },
  scrypt: { src: () => fixed, fn: v => scrypt(v, "salt", 32, { N: 1024 }) as Promise<Uint8Array> },
  deflate: { src: () => fixed, fn: v => deflate(v) },
  gzip: { src: () => fixed, fn: v => gzip(v) },
  brotliCompress: { src: () => fixed, fn: v => brotliCompress(v, brotliOpts) },
  zstdCompress: { src: () => fixed, fn: v => Bun.zstdCompress(v) },
  inflate: { src: () => zlib.deflateSync(fixed), fn: v => inflate(v) },
  gunzip: { src: () => zlib.gzipSync(fixed), fn: v => gunzip(v) },
  brotliDecompress: { src: () => zlib.brotliCompressSync(fixed, brotliOpts), fn: v => brotliDecompress(v) },
  zstdDecompress: { src: () => Bun.zstdCompressSync(fixed), fn: v => Bun.zstdDecompress(v) },
};

describe("async native input survives ArrayBuffer.prototype.resize(0) mid-flight", () => {
  for (const [name, { src: mkSrc, fn }] of Object.entries(cases)) {
    test(name, async () => {
      const src = mkSrc();
      const expected = Buffer.from(await fn(src));
      for (let i = 0; i < 8; i++) {
        const ab = new ArrayBuffer(src.length, { maxByteLength: src.length + 65536 });
        const view = new Uint8Array(ab);
        view.set(src);
        const p = fn(view);
        ab.resize(0);
        expect(Buffer.from(await p)).toEqual(expected);
      }
    });
  }
});
