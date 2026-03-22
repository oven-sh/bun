import { test, expect } from "bun:test";
import { gcTick } from "harness";
import net from "net";

test("BlockList does not crash during GC", () => {
  // Allocate and discard many BlockList instances to stress
  // the GC path that calls estimatedSize on each one.
  for (let i = 0; i < 500; i++) {
    const bl = new net.BlockList();
    bl.addAddress("127.0.0.1");
  }
  gcTick();
  gcTick();
  // If we get here without SIGFPE, the fix works.
  expect(true).toBe(true);
});
