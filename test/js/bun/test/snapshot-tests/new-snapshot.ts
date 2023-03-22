import { it, test, expect, describe } from "bun:test";
test("new snapshot", () => {
  expect({ b: 2 }).toMatchSnapshot();
});
