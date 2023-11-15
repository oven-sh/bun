import { describe, it, expect } from "bun:test";
import { gzipSync, deflateSync, inflateSync, gunzipSync } from "bun";

describe("zlib", () => {
  it("should be able to deflate and inflate", () => {
    const data = new TextEncoder().encode("Hello World!".repeat(1));
    const compressed = deflateSync(data);
    const decompressed = inflateSync(compressed);
    expect(decompressed.join("")).toBe(data.join(""));
  });

  it("should be able to gzip and gunzip", () => {
    const data = new TextEncoder().encode("Hello World!".repeat(1));
    const compressed = gzipSync(data);
    const decompressed = gunzipSync(compressed);
    expect(decompressed.join("")).toBe(data.join(""));
  });
});

import * as zlib from "node:zlib";
import * as fs from "node:fs";
import * as buffer from "node:buffer";

describe("zlib.gunzip", () => {
  it("should be able to unzip a Buffer and return an unzipped Buffer", async () => {
    const content = fs.readFileSync(import.meta.dir + "/fixture.html.gz");
    return new Promise((resolve, reject) => {
      zlib.gunzip(content, (error, data) => {
        if (error) {
          reject(error);
          return;
        }
        expect(data !== null).toBe(true);
        expect(buffer.Buffer.isBuffer(data)).toBe(true);
        resolve(true);
      });
    });
  });
});

describe("zlib.brotli*", () => {
  it("returns stub", () => {
    for (const method of [
      "BrotliCompress",
      "BrotliDecompress",
      "brotliCompress",
      "brotliCompressSync",
      "brotliDecompress",
      "brotliDecompressSync",
      "createBrotliCompress",
      "createBrotliDecompress",
    ]) {
      expect(() => zlib[method]()).toThrow(new Error(`zlib.${method} is not implemented`));
    }
  });
});
