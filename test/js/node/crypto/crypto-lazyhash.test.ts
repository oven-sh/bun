import { describe, expect, test } from "bun:test";
import { Hash, createHash } from "crypto";
import { Transform } from "stream";

describe("LazyHash quirks", () => {
  test("hash instanceof Transform", () => {
    const hash = createHash("sha256");
    expect(hash instanceof Transform).toBe(true);
  });
  test("Hash.prototype instanceof Transform", () => {
    expect(Hash.prototype instanceof Transform).toBe(true);
  });
});
