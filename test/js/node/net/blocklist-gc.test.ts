import { expect, test } from "bun:test";
import { BlockList } from "node:net";

test("BlockList structuredClone preserves rules after GC", () => {
  const bl = new BlockList();
  bl.addAddress("1.2.3.4");
  const bl2 = structuredClone(bl);
  Bun.gc(true);
  // Verify the cloned BlockList still works after GC
  expect(bl2.check("1.2.3.4")).toBe(true);
  expect(bl2.check("5.6.7.8")).toBe(false);
});
