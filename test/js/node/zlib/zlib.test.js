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

  it("should throw on invalid raw deflate data", () => {
    const data = new TextEncoder().encode("Hello World!".repeat(1));
    expect(() => inflateSync(data)).toThrow(new Error("invalid stored block lengths"));
  });

  it("should throw on invalid gzip data", () => {
    const data = new TextEncoder().encode("Hello World!".repeat(1));
    expect(() => gunzipSync(data)).toThrow(new Error("incorrect header check"));
  });
});

import * as zlib from "node:zlib";
import * as fs from "node:fs";
import * as buffer from "node:buffer";
import * as util from "node:util";

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

describe("zlib.brotli", () => {
  it("returns stub", () => {
    for (const method of [
      "BrotliCompress",
      "BrotliDecompress",
      "brotliCompressSync",
      "brotliDecompressSync",
      "createBrotliCompress",
      "createBrotliDecompress",
    ]) {
      expect(() => zlib[method]()).toThrow(new Error(`zlib.${method} is not implemented`));
    }
  });

  const inputString =
    "ΩΩLorem ipsum dolor sit amet, consectetur adipiscing eli" +
    "t. Morbi faucibus, purus at gravida dictum, libero arcu " +
    "convallis lacus, in commodo libero metus eu nisi. Nullam" +
    " commodo, neque nec porta placerat, nisi est fermentum a" +
    "ugue, vitae gravida tellus sapien sit amet tellus. Aenea" +
    "n non diam orci. Proin quis elit turpis. Suspendisse non" +
    " diam ipsum. Suspendisse nec ullamcorper odio. Vestibulu" +
    "m arcu mi, sodales non suscipit id, ultrices ut massa. S" +
    "ed ac sem sit amet arcu malesuada fermentum. Nunc sed. ";
  const compressedString =
    "G/gBQBwHdky2aHV5KK9Snf05//1pPdmNw/7232fnIm1IB" +
    "K1AA8RsN8OB8Nb7Lpgk3UWWUlzQXZyHQeBBbXMTQXC1j7" +
    "wg3LJs9LqOGHRH2bj/a2iCTLLx8hBOyTqgoVuD1e+Qqdn" +
    "f1rkUNyrWq6LtOhWgxP3QUwdhKGdZm3rJWaDDBV7+pDk1" +
    "MIkrmjp4ma2xVi5MsgJScA3tP1I7mXeby6MELozrwoBQD" +
    "mVTnEAicZNj4lkGqntJe2qSnGyeMmcFgraK94vCg/4iLu" +
    "Tw5RhKhnVY++dZ6niUBmRqIutsjf5TzwF5iAg8a9UkjF5" +
    "2eZ0tB2vo6v8SqVfNMkBmmhxr0NT9LkYF69aEjlYzj7IE" +
    "KmEUQf1HBogRYhFIt4ymRNEgHAIzOyNEsQM=";
  const compressedBuffer = Buffer.from(compressedString, "base64");

  it("brotliCompress", async () => {
    const compressed = await util.promisify(zlib.brotliCompress)(inputString);
    expect(compressed.toString()).toEqual(compressedBuffer.toString());
  });

  it("brotliDecompress", async () => {
    const roundtrip = await util.promisify(zlib.brotliDecompress)(compressedBuffer);
    expect(roundtrip.toString()).toEqual(inputString);
  });
});
