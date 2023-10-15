import { test, expect, describe } from "bun:test";
describe("util file tests", () => {
  test("custom type respected (#6507)", () => {
    const file = Bun.file("test", {
      type: "text/markdown",
    });
    expect(file.type).toBe("text/markdown");
  });
});
