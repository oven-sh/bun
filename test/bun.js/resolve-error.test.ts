import { expect, it, describe } from "bun:test";

describe("ResolveError", () => {
  it("position object does not segfault", async () => {
    try {
      await import("./file-importing-nonexistent-file.js");
    } catch (e) {
      expect(Bun.inspect(e.position).length > 0).toBe(true);
    }
  });
});
