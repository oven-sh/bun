import { it, describe, expect } from "bun:test";

describe("body-mixin-errors", () => {
  it("should fail when bodyUsed", async () => {
    var res = new Response("a");
    expect(res.bodyUsed).toBe(false);
    await res.text();
    expect(res.bodyUsed).toBe(true);

    try {
      await res.text();
      throw new Error("should not get here");
    } catch (e) {
      expect(e.message).toBe("Body already used");
    }
  });
});
