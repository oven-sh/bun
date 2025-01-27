import { libcFamily } from "harness";
if (libcFamily == "musl") {
  // duckdb does not distribute musl binaries, so we skip this test on musl to avoid CI noise
  process.exit(0);
}

import { describe, test, expect } from "bun:test";
// Must be CJS require so that the above code can exit before we attempt to import DuckDB
const { Database } = require("duckdb");

describe("duckdb", () => {
  test("basic usage", () => {
    const db = new Database(":memory:");
    db.all("SELECT 42 AS fortytwo", (err, res) => {
      expect(err).toBeNull();
      expect(res[0].fortytwo).toBe(42);
    });
  });
});
