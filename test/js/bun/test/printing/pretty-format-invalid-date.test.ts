import { expect, test } from "bun:test";

test("toEqual diff prints an invalid Date as Invalid Date", () => {
  let message = "";
  try {
    expect({ a: new Date(NaN), b: new Date(0) }).toEqual({ a: 1 });
  } catch (e: any) {
    message = e.message;
  }
  expect(message).toContain('+   "a": Invalid Date,');
  expect(message).toContain('+   "b": 1970-01-01T00:00:00.000Z,');
  expect(message).not.toContain("ul,");
});
