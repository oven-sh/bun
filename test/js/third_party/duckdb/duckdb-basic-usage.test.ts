import { libcFamily } from "harness";
if (libcFamily == "musl") {
  // duckdb does not distribute musl binaries, so we skip this test on musl to avoid CI noise
  process.exit(0);
}
if (process.platform === "win32" && process.arch === "arm64") {
  // duckdb does not distribute win32-arm64 binaries
  process.exit(0);
}
if (Number(process.versions.modules) > 137) {
  // The deprecated `duckdb` package only publishes prebuilts up to
  // NODE_MODULE_VERSION 137 (checked npm.duckdb.org for 1.3.1-1.4.1: no
  // node-v141/-v147 binaries), and node-pre-gyp's --fallback-to-build source
  // compile is not viable in CI. Drop this gate if the test migrates to
  // @duckdb/node-api, which is N-API based and ABI-independent.
  process.exit(0);
}

import { describe, expect, test } from "bun:test";
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
