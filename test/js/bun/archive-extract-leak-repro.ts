// Minimal reproduction of memory leak in Bun.Archive.extract()
// Run with: bun run test/js/bun/archive-extract-leak-repro.ts

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const dir = mkdtempSync(join(tmpdir(), "archive-leak-"));

const files = {
  "a.txt": "hello",
  "b.txt": "world",
};

const archive = Bun.Archive.from(files);

function formatMB(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(0) + " MB";
}

console.log("Extracting archive 10,000 times per round...\n");

for (let round = 0; round < 20; round++) {
  for (let i = 0; i < 10_000; i++) {
    await archive.extract(dir);
  }

  Bun.gc(true);
  const rss = process.memoryUsage.rss();
  console.log(`Round ${round + 1}: RSS = ${formatMB(rss)}`);
}

rmSync(dir, { recursive: true });
