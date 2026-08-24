// Fault-injection test: mock server so no Postgres is needed. All wire bytes
// come from wire-frames.ts via the fixture.
import { test } from "bun:test";
import { expectRssDeltaBelow } from "harness";
import path from "node:path";

const fixture = path.join(import.meta.dir, "postgres-json-bind-leak.fixture.ts");

// https://github.com/oven-sh/bun/issues/40102
test.concurrent("json/jsonb bind parameter does not leak the stringified payload", async () => {
  // Unfixed: ~300 × 512 KiB retained (≈160 MiB). Fixed: allocator slack only
  // (≈10 MiB Linux release, ≈30 MiB macOS, more under debug/ASAN).
  await expectRssDeltaBelow([fixture], { release: 60, debug: 80 });
});

// Every field of each ErrorResponse was leaked (3 × 256 KiB × 150 ≈ 110 MiB).
test.concurrent("error response fields are not leaked", async () => {
  await expectRssDeltaBelow([path.join(import.meta.dir, "postgres-error-field-leak.fixture.ts")], {
    release: 70,
    debug: 90,
  });
});
