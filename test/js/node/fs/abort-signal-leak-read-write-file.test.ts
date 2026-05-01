import { expect, test } from "bun:test";
import path from "path";

test("should not leak memory with already aborted signals", async () => {
  expect([path.join(import.meta.dir, "abort-signal-leak-read-write-file-fixture.ts")]).toRun();
});
