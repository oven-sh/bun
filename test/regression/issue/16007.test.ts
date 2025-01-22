import { it, expect } from "bun:test";

it("Set is propperly formatted in Bun.inspect()", () => {
  const set = new Set(["foo", "bar"]);
  const formatted = Bun.inspect({ set });
  expect(formatted).toBe(`{
  set: Set(2) {
    "foo",
    "bar",
  },
}`);
});
