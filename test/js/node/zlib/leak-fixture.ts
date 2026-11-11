// Fixture for leak.test.ts.
//
// Calls one node:zlib one-shot compress method in rounds. Each round ends with
// a full GC and one sample of the resident memory and of the JS heap. Prints
// one JSON line with what the calls returned and the samples. The test decides
// what is a leak.
//
// argv: <method> <inverse> <rounds> <callsPerRound>
import { heapSize } from "bun:jsc";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import zlib from "node:zlib";

type OneShot = "deflate" | "gzip" | "brotliCompress" | "zstdCompress";
type Inverse = "inflateSync" | "gunzipSync" | "brotliDecompressSync" | "zstdDecompressSync";

const [method, inverse] = process.argv.slice(2) as [OneShot | `${OneShot}Sync`, Inverse];
const [rounds, callsPerRound] = process.argv.slice(4).map(Number);

// 50,000 bytes of SHAKE256 output: the same bytes in every run, and they do not
// compress. So the output is as large as the input, and a retained output
// costs as much as a retained input. The output also fills four of the 16 KB
// chunks that node:zlib collects, so one call makes four native writes (five
// for the async methods). An input of zeros makes one (two).
const input = createHash("shake256", { outputLength: 50_000 }).update("leak-fixture").digest();

// The leak check does not depend on the quality. A call takes 21 ms with the
// default (11) and 0.12 ms with 2.
const options = method.startsWith("brotli") ? { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 2 } } : undefined;

type Compress = (input: Buffer, options?: zlib.BrotliOptions) => Buffer | Promise<Buffer>;
const compress = (method.endsWith("Sync") ? zlib[method] : promisify(zlib[method])) as Compress;

// On Linux, process.memoryUsage.rss() reads /proc/self/stat. Since Linux 6.2
// the kernel keeps that counter per CPU and adds each CPU's part to the total
// in batches, so on a machine with many cores it is off by several MB, and the
// error changes from one read to the next. smaps_rollup walks the page tables,
// so it is exact. `Anonymous` leaves out the pages of the bun binary, which the
// kernel can evict at any time.
function anonymousBytes(): number {
  const rollup = readFileSync("/proc/self/smaps_rollup", "utf8");
  return Number(/^Anonymous:\s+(\d+) kB$/m.exec(rollup)![1]) * 1024;
}

// Kernels before 4.14 and some sandboxes have no smaps_rollup. One source
// serves the whole run, because the two do not count the same pages.
let residentBytes: () => number = process.memoryUsage.rss;
if (process.platform === "linux") {
  try {
    anonymousBytes();
    residentBytes = anonymousBytes;
  } catch {}
}

const reference = await compress(input, options);
const roundTrip = zlib[inverse](reference).equals(input);

const resident: number[] = [];
const heap: number[] = [];
let calls = 0;
let mismatches = 0;
for (let round = 0; round < rounds; round++) {
  for (let i = 0; i < callsPerRound; i++, calls++) {
    // A fresh copy for each call: a call that keeps its input keeps 50,000 bytes.
    const output = await compress(Buffer.from(input), options);
    if (!output.equals(reference)) mismatches++;
  }
  Bun.gc(true);
  resident.push(residentBytes());
  heap.push(heapSize());
}

console.log(JSON.stringify({ method, calls, mismatches, roundTrip, resident, heap }));
