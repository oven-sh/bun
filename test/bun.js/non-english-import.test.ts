import { expect, test } from "bun:test";

test("non-english import works (utf16)", async () => {
  {
    const { default: value } = await import("./not-english-食物.js");
    expect(value).toBe(42);
  }
  {
    const dynamic = "./not-english-食物.js";
    const { default: value } = await import(dynamic);
    expect(value).toBe(42);
  }
});

test("non-english import works (latin1)", async () => {
  {
    const { default: value } = await import("./not-english-àⒸ.js");
    expect(value).toBe(42);
  }

  {
    const dynamic = "./not-english-àⒸ.js";
    const { default: value } = await import(dynamic);
    expect(value).toBe(42);
  }
});
