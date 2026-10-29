// std::sort and std::stable_sort compile to 3 to 5 KB of code for every pair of an element type and an order. AOT::sort and
// AOT::stableSort (aot/support/AOTSort.h) give the same answers and compile only the loops that compare for each order.
// Goes by the text of the engine's sources.
import { expect, test } from "bun:test";
import { filesOfCompiler, sayWhenSkipped, sources } from "./harness/engine-text";

sayWhenSkipped("test/aot/the-compiler-sorts-with-its-own-sort.test.ts");

test.skipIf(!sources)("only AOTSort.h calls the standard library's sorts", () => {
  let numberOfFiles = 0;
  const found: string[] = [];
  for (const { name, text } of filesOfCompiler()) {
    numberOfFiles++;
    if (/\bstd::(?:ranges::)?(?:stable_)?sort\s*\(/.test(text)) found.push(name);
  }
  expect(numberOfFiles).toBeGreaterThan(1000);
  expect(found).toEqual(["support/AOTSort.h"]);
});
