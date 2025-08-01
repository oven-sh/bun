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
  expect(diff, `RSS grew by ${diff} MB after ${perBatch * repeat} iterations`).toBeLessThan(isASAN ? 20 : 10);
}, 10_000);
