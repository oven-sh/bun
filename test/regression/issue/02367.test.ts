import { expect, test } from "bun:test";

test("should not be able to parse json from empty body", async () => {
  await expect(async () => await new Response().json()).toThrow(SyntaxError);
  await expect(async () => await new Request("http://example.com/").json()).toThrow(SyntaxError);
});
