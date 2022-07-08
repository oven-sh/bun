import { describe, expect, it } from "bun:test";

describe("BigInt", () => {
  it("compares correctly (literal)", () => {
   expect(42n).toBe(42n);
  });

  it("compares correctly (object)", () => {
   expect(BigInt(42n)).toBe(BigInt(42n));
   expect(42n).toBe(BigInt(42n));
   expect(BigInt(Bun.inspect(42n).substring(0, 2))).toBe(BigInt(42n));
   expect(BigInt(42n).valueOf()).toBe(BigInt(42n));
  });
})
