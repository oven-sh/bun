import { expect, it } from "bun:test";

it("regex literal with non-latin1 should work", () => {
  const text = "这是一段要替换的文字";

  //Correct results: 这是一段的文字
  expect(text.replace(new RegExp("要替换"), "")).toBe("这是一段的文字");

  //Incorrect result: 这是一段要替换的文字
  expect(text.replace(/要替换/, "")).toBe("这是一段的文字");
});
