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
  // The module loader's transpile arena intentionally retains up to 8 MiB of
  // warm heap between resets (see ModuleLoader::reset_arena), and the retained
  // footprint oscillates between zero and that cap, so RSS sampled at the
  // baseline vs the end can differ by up to ~8 MB without any leak.
  expect(diff, `RSS grew by ${diff} MB after ${perBatch * repeat} iterations`).toBeLessThan(isASAN ? 400 : 20);
}, 10_000);
