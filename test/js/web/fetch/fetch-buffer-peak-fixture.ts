// Measures the client-side resident set across a single large buffered
// fetch().arrayBuffer(). The server lives in the parent test process so this
// process's RSS reflects only the fetch side.
//
// Uses process.memoryUsage.rss() rather than resourceUsage().maxRSS: on Linux
// ru_maxrss survives exec, so a child spawned from a heavy test runner
// inherits the parent's RSS as its initial high-water mark.
//
// Under ASAN's default quarantine (debug builds) or mimalloc's page cache
// (release) the intermediate reallocations from amortized-doubling growth stay
// resident past the fetch, so the post-arrayBuffer RSS reflects the total
// allocation volume rather than just the final live buffer.
//
// Prints one JSON line: { bodyMB, rssBeforeMB, rssAfterMB }

const url = process.env.SERVER!;
const bodyBytes = Number(process.env.BODY_BYTES!);

Bun.gc(true);
const rssBefore = process.memoryUsage.rss();

const res = await fetch(url);
const buf = await res.arrayBuffer();

const rssAfter = process.memoryUsage.rss();

if (buf.byteLength !== bodyBytes) {
  throw new Error(`expected ${bodyBytes} bytes, got ${buf.byteLength}`);
}

// Keep both referenced past the measurement so neither is collected early.
if (!res.ok) throw new Error("unreachable");
if (buf.byteLength === 0) throw new Error("unreachable");

const mb = (n: number) => Math.round(n / 1024 / 1024);
console.log(
  JSON.stringify({
    bodyMB: mb(bodyBytes),
    rssBeforeMB: mb(rssBefore),
    rssAfterMB: mb(rssAfter),
  }),
);
