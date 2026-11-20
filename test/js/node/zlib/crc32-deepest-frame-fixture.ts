// The deepest JS frame of a Worker leaves native code 128 KiB of stack.
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import { crc32 } from "node:zlib";

function mapAtTheDeepestFrame<T, U>(values: T[], callback: (value: T) => U): U[] {
  try {
    return mapAtTheDeepestFrame(values, callback);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return values.map(callback);
  }
}

if (isMainThread) {
  new Worker(new URL(import.meta.url)).on("message", sums => console.log(JSON.stringify(sums)));
} else {
  const inputs = [50, 1000, 20_000, 100_000, 600_000].map(length => new Uint8Array(length).fill(7));
  const gzip = (library: "zlib" | "libdeflate") =>
    mapAtTheDeepestFrame(inputs, input => Bun.gzipSync(input, { level: 0, library }));
  const trailer = (bytes: Uint8Array) => Buffer.from(bytes).readUInt32LE(bytes.length - 8);
  const gzipped = gzip("zlib");

  parentPort!.postMessage({
    crc32: mapAtTheDeepestFrame(inputs, input => crc32(input)),
    hash: mapAtTheDeepestFrame(inputs, input => Bun.hash.crc32(input)),
    gzip: gzipped.map(trailer),
    libdeflate: gzip("libdeflate").map(trailer),
    gunzip: mapAtTheDeepestFrame(gzipped, bytes => Bun.gunzipSync(bytes)).map(bytes => crc32(bytes)),
  });
}
