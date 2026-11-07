// Fixture for request-clone-leak.test.ts.
//
// Constructs one shape of Request in rounds, or constructs and clones it. Each
// round ends with a full GC and one sample of the resident memory. Prints one
// JSON line with the request the loop builds and the samples. The test decides
// what is a leak.
//
// argv: <"construct" | "clone"> <"request" | "string" | "url"> <"headers" | "no-headers"> <"smaps" | "rss"> <rounds> <iterationsPerRound>
import { readFileSync } from "node:fs";

const [op, input, headers, source] = process.argv.slice(2) as [
  "construct" | "clone",
  "request" | "string" | "url",
  "headers" | "no-headers",
  "smaps" | "rss",
];
const [rounds, iterationsPerRound] = process.argv.slice(6).map(Number);

const url = "http://foo/";
const init: RequestInit = { body: "ahoyhoy", method: "POST" };
if (headers === "headers") init.headers = { "test-header": "value" };

// Makes the arguments again on each call, so that the request the report reads
// and the request the loop copies are two objects.
function constructorArgs(): [any, RequestInit?] {
  switch (input) {
    case "request":
      return [new Request(url, init)];
    case "string":
      return [url, init];
    case "url":
      return [new URL(url), init];
  }
}

async function fieldsOf(request: Request) {
  return {
    url: request.url,
    method: request.method,
    testHeader: request.headers.get("test-header"),
    body: await request.text(),
  };
}

const first = new Request(...constructorArgs());
const report =
  op === "clone"
    ? { clone: await fieldsOf(first.clone()), request: await fieldsOf(first) }
    : { request: await fieldsOf(first) };

// On Linux, process.memoryUsage.rss() reads /proc/self/stat. Since Linux 6.2
// the kernel keeps that counter per CPU and adds each CPU's part to the total
// in batches, so on a machine with many cores it is off by several MB, and the
// error changes from one read to the next. smaps walks the page tables, so it
// is exact. `Anonymous` leaves out the pages of the bun binary, which the
// kernel can evict at any time.
//
// smaps_rollup holds the same sum in one record. Linux 6.1 to 6.9 leaves a
// mapping out of it each time another thread takes the mmap lock during the
// walk. On an ASAN build that is one read in three, and the mapping can be
// 150 MB.
function anonymousBytes(): number {
  const smaps = readFileSync("/proc/self/smaps", "utf8");
  const field = "\nAnonymous:";
  let kilobytes = 0;
  for (let at = smaps.indexOf(field); at !== -1; at = smaps.indexOf(field, at + field.length)) {
    kilobytes += parseInt(smaps.slice(at + field.length, at + field.length + 32));
  }
  return kilobytes * 1024;
}

// The test passes "smaps" where the kernel serves that file. One source serves
// the whole run, because the two do not count the same pages.
const residentBytes = source === "smaps" ? anonymousBytes : process.memoryUsage.rss;

const args = constructorArgs();
const samples: number[] = [];
let iterations = 0;
for (let round = 0; round < rounds; round++) {
  if (op === "clone") {
    for (let i = 0; i < iterationsPerRound; i++, iterations++) new Request(...args).clone();
  } else {
    for (let i = 0; i < iterationsPerRound; i++, iterations++) new Request(...args);
  }
  Bun.gc(true);
  samples.push(residentBytes());
}

console.log(JSON.stringify({ ...report, iterations, samples }));
