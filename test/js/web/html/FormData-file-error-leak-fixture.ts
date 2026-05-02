// Fixture for FormData → multipart body memory leak on readFile failure.
//
// Blob.fromDOMFormData() walks the FormData entries and pushes heap-owned
// slices into a StringJoiner. If a later entry is a Bun.file() whose read
// fails, the pre-fix failure path returned Blob.initEmpty() WITHOUT calling
// joiner.deinit(), leaking every readFile buffer (and any non-ASCII string
// dup) already pushed for prior entries.
//
// This fixture appends one real on-disk file (so its contents are pushed to
// the joiner via readFile) followed by a Bun.file() pointing at a
// nonexistent path, then serializes the FormData via `new Response(fd)`.
// Without the fix, each iteration leaks ~<file size> bytes.
//
// The scratch file is created and cleaned up by the parent test via
// `using tempDir(...)` so cleanup is guaranteed even if this process is
// killed by signal.

const iterations = parseInt(process.env.ITERATIONS || "100", 10);
const warmup = parseInt(process.env.WARMUP || "10", 10);
const realPath = process.env.REAL_PATH;
const missingPath = process.env.MISSING_PATH;

if (!realPath || !missingPath) {
  throw new Error("REAL_PATH and MISSING_PATH env vars required");
}

function iterate() {
  const fd = new FormData();
  // Entry 1: real file — its contents are read into a heap buffer and
  // pushed to the joiner before the failing entry.
  fd.append("good", Bun.file(realPath));
  // Entry 2: missing file — readFile fails, context.failed = true, and the
  // pre-fix code leaked entry 1's buffer on the early return.
  fd.append("bad", Bun.file(missingPath));
  try {
    new Response(fd);
    throw new Error("expected Response constructor to throw");
  } catch (e) {
    if (!(e instanceof Error) || !("code" in e) || (e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw e;
    }
  }
}

for (let i = 0; i < warmup; i++) iterate();
Bun.gc(true);
const baselineRss = process.memoryUsage.rss();

for (let i = 0; i < iterations; i++) iterate();
Bun.gc(true);
const finalRss = process.memoryUsage.rss();

const growthMB = (finalRss - baselineRss) / (1024 * 1024);

console.log(
  JSON.stringify({
    baselineRss,
    finalRss,
    growthMB: Math.round(growthMB * 100) / 100,
    iterations,
  }),
);
