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
