import { expect, test } from "bun:test";
import net from "node:net";

test("BlockList.estimatedSize does not crash during GC", () => {
  for (let i = 0; i < 100; i++) {
    const bl = new net.BlockList();
    bl.addAddress("127.0.0.1");
  }
  Bun.gc(true);
  Bun.gc(true);

  const bl = new net.BlockList();
  bl.addAddress("127.0.0.1");
  expect(bl.check("127.0.0.1")).toBe(true);
});
