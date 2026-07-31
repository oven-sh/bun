import { expect, test } from "bun:test";
import { bunRun } from "harness";
import path from "path";

test.concurrent("SharedArrayBuffer with workers doesn't crash", async () => {
  expect(await bunRun(path.join(import.meta.dir, "15787.fixture.ts"))).toSpawn();
});
