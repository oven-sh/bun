import { describe, test, expect } from "bun:test";
import { Database } from "duckdb";

describe("duckdb", () => {
  test("basic usage", () => {
    const db = new Database(":memory:");
    db.all("SELECT 42 AS fortytwo", (err, res) => {
      expect(err).toBeNull();
      expect(res[0].fortytwo).toBe(42);
    });
  });
});
