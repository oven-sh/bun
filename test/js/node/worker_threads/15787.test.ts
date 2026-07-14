import { expect, test } from "bun:test";
import path from "path";

test.skipIf(isOhos)("SharedArrayBuffer with workers doesn't crash", async () => {
  expect([path.join(import.meta.dir, "15787.fixture.ts")]).toRun();
});
