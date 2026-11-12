import { expect, test } from "bun:test";
import { bunRun } from "harness";
import path from "path";

test.concurrent(
  "should not leak memory with already aborted signals",
  async () => {
    const fixture = path.join(import.meta.dir, "abort-signal-leak-read-write-file-fixture.ts");
    // JSC's own allocator: on ASAN's the fixture is several times slower, and the time limit is near.
    expect(await bunRun(fixture, { WebKitMallocForceEnabled: "1" })).toSpawn();
  },
  300_000,
);
