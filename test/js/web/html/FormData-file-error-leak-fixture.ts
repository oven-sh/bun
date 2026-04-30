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
// Without the fix, each iteration leaks ~FILE_SIZE bytes.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";

const iterations = parseInt(process.env.ITERATIONS || "100", 10);
const warmup = parseInt(process.env.WARMUP || "10", 10);
const fileSize = parseInt(process.env.FILE_SIZE || String(256 * 1024), 10);

const realPath = join(tmpdir(), `formdata-leak-real-${process.pid}.bin`);
const missingPath = join(tmpdir(), `formdata-leak-missing-${process.pid}.bin`);
writeFileSync(realPath, Buffer.alloc(fileSize, "a"));
process.on("exit", () => {
  try {
    unlinkSync(realPath);
  } catch {}
});

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
const leakedPerIterMB = fileSize / (1024 * 1024);

console.log(
  JSON.stringify({
    baselineRss,
    finalRss,
    growthMB: Math.round(growthMB * 100) / 100,
    iterations,
    expectedLeakMB: Math.round(leakedPerIterMB * iterations * 100) / 100,
  }),
);
