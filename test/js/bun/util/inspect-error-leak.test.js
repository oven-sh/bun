import { expect, test } from "bun:test";
import { isASAN, rss } from "../../../harness";

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
  const baseline = Math.floor(rss() / 1024);
  for (let i = 0; i < repeat; i++) {
    batch();
  }

  const after = Math.floor(rss() / 1024);
  const diff = ((after - baseline) / 1024) | 0;
  console.log(`RSS increased by ${diff} MB`);
  // ASAN's free quarantine (default 256 MB) plus redzones and glibc page
  // retention inflate RSS even when nothing is leaking.
  expect(diff, `RSS grew by ${diff} MB after ${perBatch * repeat} iterations`).toBeLessThan(isASAN ? 400 : 10);
}, 10_000);

test("Printing a depth-exceeded object's name does not leak its string", () => {
  // Each iteration hands the formatter a distinct 64 KiB Symbol.toStringTag, so a
  // leaked reference to the name retains 64 KiB: ~640 MB over the run, above both
  // bounds below, while a correct build frees all of it.
  const tagPerBatch = 500;
  const tagRepeat = 20;
  const padding = Buffer.alloc(64 * 1024, "x").toString();
  let n = 0;
  function batch() {
    for (let i = 0; i < tagPerBatch; i++) {
      Bun.inspect({ a: { [Symbol.toStringTag]: `Tag${n++}${padding}` } }, { depth: 0 });
    }
    Bun.gc(true);
  }

  batch();
  const baseline = Math.floor(rss() / 1024);
  for (let i = 0; i < tagRepeat; i++) {
    batch();
  }

  const after = Math.floor(rss() / 1024);
  const diff = ((after - baseline) / 1024) | 0;
  console.log(`RSS increased by ${diff} MB`);
  // Same ASAN allowance as above: the quarantine (256 MB by default) holds the freed tags for a while.
  expect(diff, `RSS grew by ${diff} MB after ${tagPerBatch * tagRepeat} iterations`).toBeLessThan(isASAN ? 400 : 32);
}, 20_000);
