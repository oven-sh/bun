import { expect, test } from "bun:test";
import { BlockList } from "node:net";

test("BlockList does not crash during GC", () => {
  for (let i = 0; i < 10; i++) {
    const bl = new BlockList();
    bl.addAddress("1.2.3.4");
  }
  Bun.gc(true);
  expect(true).toBe(true);
});
