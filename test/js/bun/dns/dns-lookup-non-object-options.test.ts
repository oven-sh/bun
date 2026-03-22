import { dns } from "bun";
import { describe, expect, test } from "bun:test";

describe("dns.lookup", () => {
  test("does not crash when options argument is a non-object cell", async () => {
    const result = await dns.lookup("localhost", "not-an-object" as any);
    expect(result).toBeArray();
  });
});
