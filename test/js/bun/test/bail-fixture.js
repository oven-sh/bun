import { afterAll, beforeAll, describe, expect, it } from "bun:test";

describe("test", () => {
  beforeAll(async () => {
    console.log(process.env.BEFORE);
  });

  afterAll(async () => {
    console.log(process.env.AFTER);
  });

  it("should work", async () => {
    expect(true).toBe(false);
  });

  it("should work2", async () => {
    expect(true).toBe(true);
  });
});
