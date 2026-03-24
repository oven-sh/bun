import { expect, test } from "bun:test";

// BlockList.estimatedSize previously divided by ref_count, which
// can be zero during GC finalization, causing SIGFPE on x86-64.
test("BlockList does not crash during GC", () => {
  const { BlockList } = require("net");

  for (let i = 0; i < 1000; i++) {
    const bl = new BlockList();
    bl.addAddress("1.2.3.4", "ipv4");
  }

  Bun.gc(true);
  Bun.gc(true);

  expect().pass();
});
