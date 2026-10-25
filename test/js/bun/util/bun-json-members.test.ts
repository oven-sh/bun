import { expect, test } from "bun:test";

test("Bun.JSON has the same members as the global JSON, hidden ones included", () => {
  const members = ["parse", "stringify", "rawJSON", "isRawJSON", Symbol.toStringTag];
  expect(Reflect.ownKeys(Bun.JSON)).toEqual(members);
  expect(new Set(Reflect.ownKeys(JSON))).toEqual(new Set(members));
});
