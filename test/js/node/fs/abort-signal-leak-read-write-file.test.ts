import { expect, test } from "bun:test";
import { bunRun } from "harness";
import path from "path";

test.concurrent(
  "should not leak memory with already aborted signals",
  async () => {
    expect(await bunRun(path.join(import.meta.dir, "abort-signal-leak-read-write-file-fixture.ts"))).toSpawn();
  },
  300_000,
);
