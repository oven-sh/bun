import { expect, test } from "bun:test";
import { Readable } from "node:stream";
import zlib from "node:zlib";

test("yields data in more than one chunk", () => {
  const hasher_in = new Bun.CryptoHasher("sha256");
  const hasher_out = new Bun.CryptoHasher("sha256");

  // Generate 512 KB of random data
  const randomData = Buffer.alloc(512 * 1024);
  for (let i = 0; i < randomData.length; i++) {
    randomData[i] = Math.floor(Math.random() * 256);
  }
  hasher_in.update(randomData);

  console.log("Original data size:", randomData.length, "bytes");

  // Compress the data
  const compressed = zlib.deflateSync(randomData);
  console.log("Compressed data size:", compressed.length, "bytes");

  // Create a readable stream from the compressed data
  const compressedStream = Readable.from(compressed);

  // Decompress the data using a streaming approach
  const decompressor = zlib.createInflate();

  let totalReceived = 0;
  let chunksReceived = 0;

  decompressor.on("data", chunk => {
    totalReceived += chunk.length;
    chunksReceived += 1;
    console.count(`Received chunk: ${chunk.length} bytes`);
    hasher_out.update(chunk);
  });

  decompressor.on("end", () => {
    console.log("Decompression complete");
    console.log("Total data received:", totalReceived, "bytes");

    const digest_in = hasher_in.digest().toString("hex");
    const digest_out = hasher_out.digest().toString("hex");
    expect(digest_out).toEqual(digest_in);
    expect(chunksReceived).toBeGreaterThan(2);
  });

  // Pipe the compressed data through the decompressor
  compressedStream.pipe(decompressor);
});
