import { expect, test } from "bun:test";
import { isASAN } from "../../../harness";

const perBatch = 2000;
const repeat = 50;
test("Printing errors does not leak", () => {
  function batch() {
    for (let i = 0; i < perBatch; i++) {
      Bun.inspect(new Error("leak"));
    }
    Bun.gc(true);
  }

  batch();
  const baseline = Math.floor(process.memoryUsage.rss() / 1024);
  for (let i = 0; i < repeat; i++) {
    batch();
  }

  const after = Math.floor(process.memoryUsage.rss() / 1024);
  const diff = ((after - baseline) / 1024) | 0;
  console.log(`RSS increased by ${diff} MB`);
  // ASAN's free quarantine (default 256 MB) plus redzones and glibc page
  // retention inflate RSS even when nothing is leaking.
  // Bun.inspect(Error) reaches ModuleLoader::reset_arena via the ZigException
  // stack-remap path, so the 8 MiB retain-with-limit arena policy raises the
  // measured delta.
  expect(diff, `RSS grew by ${diff} MB after ${perBatch * repeat} iterations`).toBeLessThan(isASAN ? 400 : 20);
}, 10_000);
